const Product = require('../models/Product');

async function runSimulationStep() {
  try {
    const products = await Product.find();

    if (products.length === 0) {
      console.log('No products to simulate.');
      return;
    }

    // 1. Pick a random product
    const randomProduct = products[Math.floor(Math.random() * products.length)];

    if (randomProduct.stock <= 0) {
      console.log(`${randomProduct.name} is out of stock.`);
      return;
    }

    // 2. Simulate a purchase
    randomProduct.stock -= 1;
    randomProduct.salesCount += 1;

    // 3. Adjust price based on sales count 
    if (randomProduct.salesCount % 5 === 0) {
      randomProduct.price = Math.round(randomProduct.price * 1.1); // Increase by 10%
      console.log(`🔥 ${randomProduct.name} is selling fast. Price increased!`);
    }

    await randomProduct.save();
    console.log(`💸 Simulated purchase: ${randomProduct.name} | New stock: ${randomProduct.stock} | Price: €${randomProduct.price}`);

  } catch (err) {
    console.error('❌ Simulation error:', err);
  }
}

module.exports = runSimulationStep;
