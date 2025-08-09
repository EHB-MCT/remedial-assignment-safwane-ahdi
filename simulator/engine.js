// simulationEngine.js
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
  restockBatchSize: 200,          // max products to restock per tick
  restockChance: 0.10,            // probability that a zero-stock product is considered for restock
  restockIncMin: 3,
  restockIncMax: 5,
  deltaDebounceMs: 300            // coalesce outbound WebSocket deltas
};

// -----------------------------------------------------------------------------
// Price clamping
// -----------------------------------------------------------------------------
const PRICE_FLOOR = {
  cpu: 50,
  'video-card': 120,
  motherboard: 40,
  memory: 12,
  'power-supply': 25,
  'cpu-cooler': 10,
  case: 20,
  'case-fan': 5,
  'internal-hard-drive': 20,
  'solid-state-drive': 25
};
function minPriceFor(type) { return PRICE_FLOOR[type] ?? 10; }

// If you can, persist priceFloor per document once and reference "$priceFloor" in pipelines
// to avoid a JS roundtrip. For now we clamp after reads or via $max("$priceFloor", ...).

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
  // Atomic decrement to avoid oversell
  const doc = await Product.findOneAndUpdate(
    { _id: productId, stock: { $gt: 0 } },
    {
      $inc: { stock: -1, salesCount: 1 },
      $set: { lastSoldAt: now }
    },
    { new: true, projection: { name: 1, price: 1, type: 1, stock: 1, salesCount: 1, lastSoldAt: 1 } }
  ).lean();
  if (!doc) return null;

  // Apply "selling fast" price bump every 5th sale, then clamp
  if (doc.salesCount % 5 === 0) {
    const next = Math.round(doc.price * 1.1);
    const clamped = Math.max(minPriceFor(doc.type), next);
    if (clamped !== doc.price) {
      const updated = await Product.findOneAndUpdate(
        { _id: productId },
        { $set: { price: clamped } },
        { new: true, projection: { name: 1, price: 1, type: 1, stock: 1, salesCount: 1, lastSoldAt: 1 } }
      ).lean();
      return updated;
    }
  }
  return doc;
}

async function applyColdDrops(now = new Date()) {
  const cutoff = new Date(now.getTime() - TICK.coldDropThresholdMs);
  // Pipeline update: drop price by 10%, clamp, and null lastSoldAt
  const res = await Product.updateMany(
    { lastSoldAt: { $lte: cutoff } },
    [
      {
        $set: {
          price: {
            $max: [
              "$priceFloor", // if present; else it will be null and max ignores it
              { $round: [{ $multiply: ["$price", 0.9] }, 0] }
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

async function restockSome() {
  // Sample potential zero-stock docs; probabilistic selection by restockChance
  const candidates = await Product.aggregate([
    { $match: { stock: 0 } },
    { $sample: { size: TICK.restockBatchSize } },
    { $project: { _id: 1 } }
  ]);

  if (!candidates.length) return 0;

  const ops = [];
  for (const c of candidates) {
    if (Math.random() < TICK.restockChance) {
      const inc = randInt(TICK.restockIncMin, TICK.restockIncMax);
      ops.push({
        updateOne: {
          filter: { _id: c._id, stock: 0 },
          update: { $inc: { stock: inc } }
        }
      });
    }
  }
  if (!ops.length) return 0;

  const res = await Product.bulkWrite(ops, { ordered: false });
  return res.modifiedCount || 0;
}

async function applyGlobalPriceEvent(event) {
  const stamp = `${event.name}-${new Date(event.startedAt).toISOString()}`;
  const multiplier = event.magnitude ?? 1;

  const res = await Product.updateMany(
    { lastEventApplied: { $ne: stamp } },
    [
      {
        $set: {
          price: {
            $max: [
              "$priceFloor",
              { $round: [{ $multiply: ["$price", multiplier] }, 0] }
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
// Event trigger logic (unchanged except no full scans)
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
      // Use one random product id without loading all products
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
    // Not pushing to all products here; application happens in the tick
  }
}

// -----------------------------------------------------------------------------
// Main tick
// -----------------------------------------------------------------------------
async function runSimulationStep(io) {
  try {
    const now = new Date();

    // 1) Resolve boosted product ids from active events without loading all products
    const boostedIds = activeEvents
      .filter(e => e.effect === 'boostDemand' && e.productId)
      .map(e => e.productId);

    // 2) Simulate purchases atomically; bias toward boosted when present
    const purchasesToTry = TICK.purchasesPerTick;
    for (let i = 0; i < purchasesToTry; i++) {
      const candidate = await pickRandom(boostedIds);
      if (!candidate) break;

      const updated = await tryPurchase(candidate._id, now);
      if (updated) {
        // Clamp after read in case the doc lacks priceFloor pipeline clamp
        const floor = minPriceFor(updated.type);
        if (updated.price < floor) {
          const fixed = await Product.findOneAndUpdate(
            { _id: updated._id },
            { $set: { price: floor } },
            { new: true, projection: { name: 1, price: 1, type: 1, stock: 1, salesCount: 1, lastSoldAt: 1 } }
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
    const coldModified = await applyColdDrops(now);
    if (coldModified > 0) {
      // Optional: fetch a small sample of modified docs for deltas.
      // For simplicity, omit here; UI will catch next change stream or next tick.
    }

    // 4) Restock some zero-stock products in one batch (unless restricted)
    const stockRestricted = activeEvents.some(e => e.effect === 'restrictStock');
    if (!stockRestricted) {
      const restocked = await restockSome();
      if (restocked > 0) {
        // Optionally fetch a sample for deltas; omitted for brevity.
      }
    }

    // 5) Apply any active global price events in one batch
    for (const e of activeEvents) {
      if (e.effect === 'priceDrop' || e.effect === 'priceIncrease') {
        const { modified } = await applyGlobalPriceEvent(e);
        if (modified > 0) {
          // Optionally sample changed docs; omitted.
        }
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
