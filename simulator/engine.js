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
            const timeLimit = 1000 * 60 * 0.5;

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
                    const restockAmount = Math.floor(Math.random() * 3) + 3; // Restock 3–5 units
                    product.stock += restockAmount;
                    await product.save();
                    console.log(`📦 ${product.name} was restocked with ${restockAmount} units!`);
                }
            }
        }

    } catch (err) {
        console.error('❌ Simulation error:', err);
    }
}

module.exports = runSimulationStep;
