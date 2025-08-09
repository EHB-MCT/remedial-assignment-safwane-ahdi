const Product = require('../models/Product');
const Event = require('../models/Event');
const ProductHistory = require('../models/ProductHistory');
const activeEvents = [];

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
function clampPrice(val, type) {
  const floor = minPriceFor(type);
  const n = Math.round(Number(val) || 0);
  return Math.max(floor, n);
}

async function runSimulationStep(io) {
  try {
    const products = await Product.find();
    if (products.length === 0) {
      console.log('No products to simulate.');
      return;
    }

    const now = new Date();

    // Check for boostDemand (Hype Wave)
    const boostedProductIds = activeEvents
      .filter(e => e.effect === 'boostDemand')
      .map(e => e.productId?.toString());

    let randomProduct;
    if (boostedProductIds.length && Math.random() < 0.7) {
      const boosted = products.filter(p => boostedProductIds.includes(p._id.toString()));
      randomProduct = boosted[Math.floor(Math.random() * boosted.length)] || products[Math.floor(Math.random() * products.length)];
    } else {
      randomProduct = products[Math.floor(Math.random() * products.length)];
    }

    // Purchase simulation
    if (randomProduct.stock > 0) {
      randomProduct.stock -= 1;
      randomProduct.salesCount += 1;
      randomProduct.lastSoldAt = now;

      // Selling fast → price up, with clamp
      if (randomProduct.salesCount % 5 === 0) {
        const nextPrice = randomProduct.price * 1.1;
        randomProduct.price = clampPrice(nextPrice, randomProduct.type); // CHANGED
        console.log(`[sales] ${randomProduct.name} is selling fast. Price increased to €${randomProduct.price}.`);
      }

      await randomProduct.save();
      await logProductHistory(randomProduct);

      console.log(`[purchase] ${randomProduct.name} | stock: ${randomProduct.stock} | price: €${randomProduct.price}`);
    } else {
      console.log(`[oos] ${randomProduct.name} is out of stock.`);
    }

    // Price drop for cold products (hasn't sold recently)
    // NOTE: after a drop we null lastSoldAt so it won't drop again until it sells again.
    for (const product of products) {
      if (!product.lastSoldAt) continue;
      const timeSinceLastSale = now - new Date(product.lastSoldAt);
      if (timeSinceLastSale > 1000 * 60 * 0.5) { // 30s
        const nextPrice = product.price * 0.9;
        product.price = clampPrice(nextPrice, product.type); // CHANGED
        product.lastSoldAt = null;
        await product.save();
        await logProductHistory(product);
        console.log(`[cold] ${product.name} price dropped to €${product.price}.`);
      }
    }

    // Restock unless restricted by an event
    const stockRestricted = activeEvents.some(e => e.effect === 'restrictStock');
    if (!stockRestricted) {
      for (const product of products) {
        if (product.stock === 0 && Math.random() < 0.1) {
          const restockAmount = Math.floor(Math.random() * 3) + 3;
          product.stock += restockAmount;
          await product.save();
          await logProductHistory(product);
          console.log(`[restock] ${product.name} +${restockAmount} units.`);
        }
      }
    }

    await maybeTriggerEvent(products);
    await applyEvents(products);       // will clamp and set lastEventApplied
    await cleanupExpiredEvents();

    const updatedProducts = await Product.find();
    io.emit('productsUpdated', updatedProducts);

  } catch (err) {
    console.error('Simulation error:', err);
  }
}

async function logProductHistory(product) {
  try {
    await ProductHistory.create({
      productId: product._id,
      name: product.name,
      price: product.price,
      stock: product.stock,
      salesCount: product.salesCount,
      timestamp: new Date()
    });
  } catch (err) {
    console.error('[history] Failed to log history:', err);
  }
}

async function maybeTriggerEvent(products) {
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
      const rp = products[Math.floor(Math.random() * products.length)];
      event = { ...event, name: 'Hype Wave', type: 'product', effect: 'boostDemand',
        productId: rp._id, description: `Sudden hype around ${rp.name}. It will sell much faster.` };
    }

    activeEvents.push(event);
    await Event.create(event);
    console.log(`[event] TRIGGERED: ${event.name}`);
  }
}

async function applyEvents(products) {
  for (const event of activeEvents) {
    if (!event.affected) event.affected = [];

    if (event.effect === 'priceDrop' || event.effect === 'priceIncrease') {
      const multiplier = event.magnitude;

      for (const product of products) {
        const id = product._id.toString();

        // --- NEW: avoid double-application of the same event instance ---
        const stamp = `${event.name}-${new Date(event.startedAt).toISOString()}`;
        if (product.lastEventApplied === stamp) continue;

        // apply once per product
        const nextPrice = product.price * multiplier;
        product.price = clampPrice(nextPrice, product.type); // CHANGED
        product.lastEventApplied = stamp;                     // NEW
        await product.save();
        await logProductHistory(product);

        event.affected.push(id);
        console.log(`[event] ${event.name} applied to ${product.name}: €${product.price}`);
      }
    }
  }
}

async function cleanupExpiredEvents() {
  const now = Date.now();
  for (let i = activeEvents.length - 1; i >= 0; i--) {
    const event = activeEvents[i];
    const duration = now - new Date(event.startedAt).getTime();
    if (duration > event.durationMs) {
      console.log(`[event] ENDED: ${event.name}`);
      await Event.updateOne(
        { name: event.name, startedAt: event.startedAt },
        { endedAt: new Date() }
      );

      // Clear the event marker so future events can apply again
      await Product.updateMany(
        { lastEventApplied: `${event.name}-${new Date(event.startedAt).toISOString()}` },
        { $set: { lastEventApplied: null } }
      );

      activeEvents.splice(i, 1);
    }
  }
}

module.exports = runSimulationStep;
