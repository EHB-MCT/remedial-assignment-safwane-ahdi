const Product = require('../models/Product');
const Event = require('../models/Event');
const ProductHistory = require('../models/ProductHistory');

const activeEvents = [];

// -----------------------------------------------------------------------------
// Configuration knobs
// -----------------------------------------------------------------------------
const TICK = {
  purchasesPerTick: 5,            // how many simulated purchases to try per tick
  coldDropThresholdMs: 30_000,    // time since lastSoldAt to mark "cold"
  restockBatchSize: 200,          // max products to restock sample per tick
  restockChance: 0.10,            // probability that a zero-stock product is considered for restock
  restockIncMin: 3,
  restockIncMax: 5,
  deltaDebounceMs: 300            // coalesce outbound WebSocket deltas
};

// -----------------------------------------------------------------------------
// Price/stock bounds
// -----------------------------------------------------------------------------
const PRICE_CEILING = {
  cpu: 1200,
  'video-card': 2500,
  motherboard: 600,
  memory: 400,
  'power-supply': 400,
  'cpu-cooler': 250,
  case: 400,
  'case-fan': 80,
  'internal-hard-drive': 500,
  'solid-state-drive': 700
};
function maxPriceFor(type) { return PRICE_CEILING[type] ?? 10_000; }

const MAX_STOCK = {
  cpu: 30, 'video-card': 40, motherboard: 60, memory: 120, 'power-supply': 80,
  'cpu-cooler': 120, case: 60, 'case-fan': 400, 'internal-hard-drive': 120, 'solid-state-drive': 200
};
function maxStockFor(type) { return MAX_STOCK[type] ?? 100; }

// -----------------------------------------------------------------------------
// Internal buffers for history and deltas
// -----------------------------------------------------------------------------
const historyBuffer = [];
const changed = new Map(); // _id -> partial projection for client

function bufferHistory(doc, now) {
  historyBuffer.push({
    productId: doc._id,
    name: doc.name,
    price: doc.price,
    stock: doc.stock,
    salesCount: doc.salesCount,
    timestamp: now
  });
}

function markChanged(doc) {
  changed.set(String(doc._id), {
    _id: doc._id,
    price: doc.price,
    stock: doc.stock,
    salesCount: doc.salesCount,
    lastSoldAt: doc.lastSoldAt
  });
}

async function flushHistory() {
  if (historyBuffer.length === 0) return;
  const batch = historyBuffer.splice(0, historyBuffer.length);
  await ProductHistory.insertMany(batch, { ordered: false });
}

// Debounced WebSocket deltas
let flushTimer = null;
function scheduleFlush(io) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    const payload = Array.from(changed.values());
    changed.clear();
    flushTimer = null;
    if (payload.length) io.emit('productsDelta', payload);
  }, TICK.deltaDebounceMs);
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
async function pickRandom(boostedIds) {
  // Prefer a boosted product with stock
  if (boostedIds?.length) {
    const [p] = await Product.aggregate([
      { $match: { _id: { $in: boostedIds }, stock: { $gt: 0 } } },
      { $sample: { size: 1 } },
      { $project: { name: 1, price: 1, type: 1, stock: 1, salesCount: 1 } }
    ]);
    if (p) return p;
  }
  // Fallback: any in-stock product
  const [p] = await Product.aggregate([
    { $match: { stock: { $gt: 0 } } },
    { $sample: { size: 1 } },
    { $project: { name: 1, price: 1, type: 1, stock: 1, salesCount: 1 } }
  ]);
  return p || null;
}

async function tryPurchase(productId, now) {
  // Atomic decrement to avoid oversell; include priceFloor for clamping logic
  const doc = await Product.findOneAndUpdate(
    { _id: productId, stock: { $gt: 0 } },
    { $inc: { stock: -1, salesCount: 1 }, $set: { lastSoldAt: now } },
    { new: true, projection: { name: 1, price: 1, type: 1, stock: 1, salesCount: 1, lastSoldAt: 1, priceFloor: 1 } }
  ).lean();
  if (!doc) return null;

  // Every 5th sale → +10%, then clamp to [priceFloor, type ceiling]
  if (doc.salesCount % 5 === 0) {
    const next = Math.round(doc.price * 1.1);
    const floor = typeof doc.priceFloor === 'number' ? doc.priceFloor : 10;
    const clamped = Math.min(maxPriceFor(doc.type), Math.max(floor, next));

    if (clamped !== doc.price) {
      const updated = await Product.findOneAndUpdate(
        { _id: productId },
        { $set: { price: clamped } },
        { new: true, projection: { name: 1, price: 1, type: 1, stock: 1, salesCount: 1, lastSoldAt: 1, priceFloor: 1 } }
      ).lean();
      return updated;
    }
  }
  return doc;
}

async function applyColdDrops(now = new Date()) {
  const cutoff = new Date(now.getTime() - TICK.coldDropThresholdMs);
  const res = await Product.updateMany(
    { lastSoldAt: { $ne: null, $lte: cutoff } }, // exclude nulls so we don't keep re-dropping
    [
      {
        $set: {
          price: {
            $min: [
              {
                $switch: {
                  branches: [
                    { case: { $eq: ["$type", "cpu"] }, then: 1200 },
                    { case: { $eq: ["$type", "video-card"] }, then: 2500 },
                    { case: { $eq: ["$type", "motherboard"] }, then: 600 },
                    { case: { $eq: ["$type", "memory"] }, then: 400 },
                    { case: { $eq: ["$type", "power-supply"] }, then: 400 },
                    { case: { $eq: ["$type", "cpu-cooler"] }, then: 250 },
                    { case: { $eq: ["$type", "case"] }, then: 400 },
                    { case: { $eq: ["$type", "case-fan"] }, then: 80 },
                    { case: { $eq: ["$type", "internal-hard-drive"] }, then: 500 },
                    { case: { $eq: ["$type", "solid-state-drive"] }, then: 700 }
                  ],
                  default: 10000
                }
              },
              {
                $max: [
                  "$priceFloor",
                  { $round: [{ $multiply: ["$price", 0.9] }, 0] }
                ]
              }
            ]
          },
          lastSoldAt: null
        }
      }
    ]
  );
  return res.modifiedCount || 0;
}

function randInt(minIncl, maxIncl) {
  return Math.floor(Math.random() * (maxIncl - minIncl + 1)) + minIncl;
}

// Single, parameterized restock function
async function restockSome(limit = 0) {
  if (limit <= 0) return 0;

  const candidates = await Product.aggregate([
    { $match: { stock: 0 } },
    { $sample: { size: Math.min(TICK.restockBatchSize, limit * 2) } }, // small headroom
    { $project: { _id: 1, type: 1, stock: 1 } }
  ]);

  if (!candidates.length) return 0;

  let used = 0;
  const ops = [];

  for (const c of candidates) {
    if (used >= limit) break;
    if (Math.random() >= TICK.restockChance) continue;

    const inc = randInt(TICK.restockIncMin, TICK.restockIncMax);
    const ceiling = maxStockFor(c.type);
    const nextStock = Math.min(ceiling, inc); // c.stock is 0 by match
    if (nextStock <= 0) continue;

    ops.push({
      updateOne: {
        filter: { _id: c._id, stock: 0 },
        update: { $set: { stock: nextStock } }
      }
    });
    used += 1;
  }

  if (!ops.length) return 0;
  const res = await Product.bulkWrite(ops, { ordered: false });
  return res.modifiedCount || 0;
}

async function applyGlobalPriceEvent(event) {
  const stamp = `${event.name}-${new Date(event.startedAt).toISOString()}`;
  const multiplier = Number(event.magnitude) || 1;

  const res = await Product.updateMany(
    { lastEventApplied: { $ne: stamp } },
    [
      {
        $set: {
          price: {
            $min: [
              {
                $switch: {
                  branches: [
                    { case: { $eq: ["$type", "cpu"] }, then: 1200 },
                    { case: { $eq: ["$type", "video-card"] }, then: 2500 },
                    { case: { $eq: ["$type", "motherboard"] }, then: 600 },
                    { case: { $eq: ["$type", "memory"] }, then: 400 },
                    { case: { $eq: ["$type", "power-supply"] }, then: 400 },
                    { case: { $eq: ["$type", "cpu-cooler"] }, then: 250 },
                    { case: { $eq: ["$type", "case"] }, then: 400 },
                    { case: { $eq: ["$type", "case-fan"] }, then: 80 },
                    { case: { $eq: ["$type", "internal-hard-drive"] }, then: 500 },
                    { case: { $eq: ["$type", "solid-state-drive"] }, then: 700 }
                  ],
                  default: 10000
                }
              },
              {
                $max: [
                  "$priceFloor",
                  { $round: [{ $multiply: ["$price", multiplier] }, 0] }
                ]
              }
            ]
          },
          lastEventApplied: stamp
        }
      }
    ]
  );

  return { modified: res.modifiedCount || 0, stamp };
}

async function clearEventStamp(stamp) {
  await Product.updateMany(
    { lastEventApplied: stamp },
    { $set: { lastEventApplied: null } }
  );
}

async function cleanupExpiredEventsFast(list) {
  const now = Date.now();
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    const ended = now - new Date(e.startedAt).getTime() > e.durationMs;
    if (!ended) continue;

    const stamp = `${e.name}-${new Date(e.startedAt).toISOString()}`;
    await Promise.all([
      Event.updateOne({ name: e.name, startedAt: e.startedAt }, { endedAt: new Date() }),
      clearEventStamp(stamp)
    ]);
    list.splice(i, 1);
  }
}

// -----------------------------------------------------------------------------
// Event trigger logic (no full scans)
// -----------------------------------------------------------------------------
async function maybeTriggerEvent() {
  const alreadyActive = activeEvents.some(
    (event) => event.name === 'Flash Sale' && !event.endedAt
  );
  if (alreadyActive) return;

  if (Math.random() < 0.05) {
    const eventTypes = ['Flash Sale', 'Price Surge', 'Supply Chain Disruption', 'Hype Wave'];
    const typePicked = eventTypes[Math.floor(Math.random() * eventTypes.length)];

    const now = new Date();
    let event = {
      name: '',
      type: '',
      effect: '',
      magnitude: 1,
      durationMs: 1000 * 60 * 2,
      startedAt: now,
      endedAt: null,
      affected: [],
      description: ''
    };

    if (typePicked === 'Flash Sale') {
      event = { ...event, name: 'Flash Sale', type: 'global', effect: 'priceDrop', magnitude: 0.8,
        description: 'A sudden discount across all products. Prices drop by 20%.' };
    } else if (typePicked === 'Price Surge') {
      event = { ...event, name: 'Price Surge', type: 'global', effect: 'priceIncrease', magnitude: 1.2,
        description: 'Market demand is high. Prices increase by 20%.' };
    } else if (typePicked === 'Supply Chain Disruption') {
      event = { ...event, name: 'Supply Chain Disruption', type: 'global', effect: 'restrictStock',
        description: 'Restocking is temporarily halted due to logistics issues.' };
    } else if (typePicked === 'Hype Wave') {
      const [rp] = await Product.aggregate([
        { $sample: { size: 1 } },
        { $project: { _id: 1, name: 1 } }
      ]);
      if (rp) {
        event = { ...event, name: 'Hype Wave', type: 'product', effect: 'boostDemand',
          productId: rp._id, description: `Sudden hype around ${rp.name}. It will sell much faster.` };
      } else {
        return;
      }
    }

    activeEvents.push(event);
    await Event.create(event);
  }
}

// -----------------------------------------------------------------------------
// Main tick
// -----------------------------------------------------------------------------
async function runSimulationStep(io) {
  try {
    const now = new Date();

    // 1) Resolve boosted product ids from active events
    const boostedIds = activeEvents
      .filter(e => e.effect === 'boostDemand' && e.productId)
      .map(e => e.productId);

    // 2) Simulate purchases atomically; bias toward boosted when present
    let purchasesMade = 0;
    const purchasesToTry = TICK.purchasesPerTick;
    for (let i = 0; i < purchasesToTry; i++) {
      const candidate = await pickRandom(boostedIds);
      if (!candidate) break;

      const updated = await tryPurchase(candidate._id, now);
      if (updated) {
        purchasesMade += 1;
        // Clamp to per-doc floor after read (safety if pipeline missed it)
        const floor = typeof updated.priceFloor === 'number' ? updated.priceFloor : 10;
        if (updated.price < floor) {
          const fixed = await Product.findOneAndUpdate(
            { _id: updated._id },
            { $set: { price: floor } },
            { new: true, projection: { name: 1, price: 1, type: 1, stock: 1, salesCount: 1, lastSoldAt: 1, priceFloor: 1 } }
          ).lean();
          if (fixed) {
            bufferHistory(fixed, now);
            markChanged(fixed);
            continue;
          }
        }
        bufferHistory(updated, now);
        markChanged(updated);
      }
    }

    // 3) Apply cold price drops in one batch
    await applyColdDrops(now);

    // 4) Restock some zero-stock products in one batch (unless restricted)
    const stockRestricted = activeEvents.some(e => e.effect === 'restrictStock');
    if (!stockRestricted) {
      await restockSome(Math.max(purchasesMade, 1)); // single call; no 'restocked' var
    }

    // 5) Apply any active global price events in one batch
    for (const e of activeEvents) {
      if (e.effect === 'priceDrop' || e.effect === 'priceIncrease') {
        await applyGlobalPriceEvent(e);
      }
    }

    // 6) Possibly trigger a new event
    await maybeTriggerEvent();

    // 7) Cleanup expired events
    await cleanupExpiredEventsFast(activeEvents);

    // 8) Flush history once
    await flushHistory();

    // 9) Emit coalesced deltas
    scheduleFlush(io);
  } catch (err) {
    console.error('Simulation error:', err);
  }
}

module.exports = runSimulationStep;
