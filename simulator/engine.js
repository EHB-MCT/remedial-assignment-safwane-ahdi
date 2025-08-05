const Product = require('../models/Product');
const Event = require('../models/Event');
const activeEvents = [];

async function runSimulationStep() {
  try {
    const products = await Product.find();

    if (products.length === 0) {
      console.log('No products to simulate.');
      return;
    }

    // 1. Pick a random product
    const randomProduct = products[Math.floor(Math.random() * products.length)];

    // 2. Simulate a purchase (if in stock)
    if (randomProduct.stock > 0) {
      randomProduct.stock -= 1;
      randomProduct.salesCount += 1;
      randomProduct.lastSoldAt = new Date();

      // Price increase if sales are high
      if (randomProduct.salesCount % 5 === 0) {
        randomProduct.price = Math.round(randomProduct.price * 1.1);
        console.log(`🔥 ${randomProduct.name} is selling fast. Price increased!`);
      }

      await randomProduct.save();
      console.log(`💸 Simulated purchase: ${randomProduct.name} | New stock: ${randomProduct.stock} | Price: €${randomProduct.price}`);
    } else {
      console.log(`${randomProduct.name} is out of stock.`);
    }

    // 3. Price drop for cold products
    const now = new Date();
    for (const product of products) {
      if (!product.lastSoldAt) continue;

      const timeSinceLastSale = now - new Date(product.lastSoldAt);
      const timeLimit = 1000 * 60 * 0.5; // 30 seconds

      if (timeSinceLastSale > timeLimit) {
        product.price = Math.max(1, Math.round(product.price * 0.9));
        product.lastSoldAt = null;
        await product.save();
        console.log(`📉 ${product.name} is cold. Price dropped to €${product.price}`);
      }
    }

    // 4. Restock out-of-stock products
    for (const product of products) {
      if (product.stock === 0) {
        if (Math.random() < 0.1) { // 10% chance to restock
          const restockAmount = Math.floor(Math.random() * 3) + 3;
          product.stock += restockAmount;
          await product.save();
          console.log(`📦 ${product.name} was restocked with ${restockAmount} units!`);
        }
      }
    }

    // 5. Event simulation
    await maybeTriggerEvent(products);
    await applyEvents(products);
    await cleanupExpiredEvents();

  } catch (err) {
    console.error('❌ Simulation error:', err);
  }
}

async function maybeTriggerEvent(products) {
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
    await Event.create(event); // Save to DB
    console.log(`⚡ EVENT TRIGGERED: ${event.name}`);
  }
}

async function applyEvents(products) {
  for (const event of activeEvents) {
    if (event.type === 'global' && event.effect === 'priceDrop') {
      for (const product of products) {
        product.price = Math.round(product.price * event.magnitude);
        await product.save();
        console.log(`💥 EVENT EFFECT: ${product.name} discounted to €${product.price}`);
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

      activeEvents.splice(i, 1);
    }
  }
}

module.exports = runSimulationStep;
