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

    const randomProduct = products[Math.floor(Math.random() * products.length)];

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

    const now = new Date();
    for (const product of products) {
      if (!product.lastSoldAt) continue;

      const timeSinceLastSale = now - new Date(product.lastSoldAt);
      const timeLimit = 1000 * 60 * 0.5;

      if (timeSinceLastSale > timeLimit) {
        product.price = Math.max(1, Math.round(product.price * 0.9));
        product.lastSoldAt = null;
        await product.save();
        console.log(`📉 ${product.name} is cold. Price dropped to €${product.price}`);
      }
    }

    for (const product of products) {
      if (product.stock === 0) {
        if (Math.random() < 0.1) {
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
  const alreadyActive = activeEvents.some(
    (event) => event.name === 'Flash Sale' && !event.endedAt
  );

  if (alreadyActive) {
    return; // Don't trigger another Flash Sale while one is active
  }

  if (Math.random() < 0.05) {
    const event = {
      name: 'Flash Sale',
      type: 'global',
      effect: 'priceDrop',
      magnitude: 0.8,
      durationMs: 1000 * 60 * 2, // 2 minutes
      startedAt: new Date(),
      endedAt: null
    };

    activeEvents.push(event);
    await Event.create(event);
    console.log(`⚡ EVENT TRIGGERED: ${event.name}`);
  }
}


async function applyEvents(products) {
  for (const event of activeEvents) {
    if (event.type === 'global' && event.effect === 'priceDrop') {
      const eventId = `${event.name}-${new Date(event.startedAt).toISOString()}`;

      for (const product of products) {
        if (product.lastEventApplied !== eventId) {
          const newPrice = Math.max(2, Math.round(product.price * event.magnitude));
          product.price = newPrice;
          product.lastEventApplied = eventId;
          await product.save();
          console.log(`💥 EVENT EFFECT: ${product.name} discounted to €${product.price}`);
        }
      }
    }
  }
}

async function cleanupExpiredEvents() {
  const now = Date.now();

  for (let i = activeEvents.length - 1; i >= 0; i--) {
    const event = activeEvents[i];
    const eventDuration = now - new Date(event.startedAt).getTime();

    if (eventDuration > event.durationMs) {
      console.log(`⏱️ EVENT ENDED: ${event.name}`);

      await Event.updateOne(
        { name: event.name, startedAt: event.startedAt },
        { endedAt: new Date() }
      );

      // Reset event marker on all affected products
      await Product.updateMany(
        { lastEventApplied: `${event.name}-${event.startedAt.toISOString()}` },
        { $set: { lastEventApplied: null } }
      );

      activeEvents.splice(i, 1);
    }
  }
}

module.exports = runSimulationStep;
