const Product = require('../models/Product');

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

        // ✅ Emit real-time update to dashboard clients
        const updatedProducts = await Product.find();
        io.emit('productsUpdated', updatedProducts);

    } catch (err) {
        console.error('❌ Simulation error:', err);
    }
}

module.exports = runSimulationStep;
