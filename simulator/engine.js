const Product = require('../models/Product');
const Event = require('../models/Event');
const activeEvents = [];

async function runSimulationStep(io) {
  try {
    const products = await Product.find();

    if (products.length === 0) {
      console.log('No products to simulate.');
      return;
    }

    const now = new Date();

    // Check for boostDemand (Hype Wave)
    let boostedProductIds = activeEvents
      .filter(e => e.effect === 'boostDemand')
      .map(e => e.productId?.toString());

    let randomProduct;
    if (boostedProductIds.length && Math.random() < 0.7) {
      const boosted = products.filter(p => boostedProductIds.includes(p._id.toString()));
      randomProduct = boosted[Math.floor(Math.random() * boosted.length)];
    } else {
      randomProduct = products[Math.floor(Math.random() * products.length)];
    }

    if (randomProduct.stock > 0) {
      randomProduct.stock -= 1;
      randomProduct.salesCount += 1;
      randomProduct.lastSoldAt = new Date();

      if (randomProduct.salesCount % 5 === 0) {
        randomProduct.price = Math.round(randomProduct.price * 1.1);
        console.log(`🔥 ${randomProduct.name} is selling fast. Price increased!`);
      }

      await randomProduct.save();
      console.log(`💸 Simulated purchase: ${randomProduct.name} | New stock: ${randomProduct.stock} | Price: €${randomProduct.price}`);
    } else {
      console.log(`${randomProduct.name} is out of stock.`);
    }

    // Price drop for cold products
    for (const product of products) {
      if (!product.lastSoldAt) continue;
      const timeSinceLastSale = now - new Date(product.lastSoldAt);
      if (timeSinceLastSale > 1000 * 60 * 0.5) {
        product.price = Math.max(1, Math.round(product.price * 0.9));
        product.lastSoldAt = null;
        await product.save();
        console.log(`📉 ${product.name} is cold. Price dropped to €${product.price}`);
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
          console.log(`📦 ${product.name} was restocked with ${restockAmount} units!`);
        }
      }
    }

    await maybeTriggerEvent(products);
    await applyEvents(products);
    await cleanupExpiredEvents();

    const updatedProducts = await Product.find();
    io.emit('productsUpdated', updatedProducts);

  } catch (err) {
    console.error('❌ Simulation error:', err);
  }
}

async function maybeTriggerEvent(products) {
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
      affected: []
    };

    if (typePicked === 'Flash Sale') {
      event = { ...event, name: 'Flash Sale', type: 'global', effect: 'priceDrop', magnitude: 0.8 };
    } else if (typePicked === 'Price Surge') {
      event = { ...event, name: 'Price Surge', type: 'global', effect: 'priceIncrease', magnitude: 1.2 };
    } else if (typePicked === 'Supply Chain Disruption') {
      event = { ...event, name: 'Supply Chain Disruption', type: 'global', effect: 'restrictStock' };
    } else if (typePicked === 'Hype Wave') {
      const randomProduct = products[Math.floor(Math.random() * products.length)];
      event = {
        ...event,
        name: 'Hype Wave',
        type: 'product',
        effect: 'boostDemand',
        productId: randomProduct._id
      };
    }

    activeEvents.push(event);
    await Event.create(event);
    console.log(`⚡ EVENT TRIGGERED: ${event.name}`);
  }
}

async function applyEvents(products) {
  for (const event of activeEvents) {
    if (!event.affected) event.affected = [];

    if (event.effect === 'priceDrop' || event.effect === 'priceIncrease') {
      const multiplier = event.magnitude;
      for (const product of products) {
        const id = product._id.toString();
        if (!event.affected.includes(id)) {
          product.price = Math.max(1, Math.round(product.price * multiplier));
          await product.save();
          event.affected.push(id);
          console.log(`💥 ${event.name} effect applied to ${product.name}: €${product.price}`);
        }
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
      console.log(`⏱️ EVENT ENDED: ${event.name}`);
      await Event.updateOne(
        { name: event.name, startedAt: event.startedAt },
        { endedAt: new Date() }
      );
      activeEvents.splice(i, 1);
    }
  }
}

module.exports = runSimulationStep;
