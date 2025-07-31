require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('./models/Product');

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('🌱 Connected to DB... Seeding data');

    await Product.deleteMany({}); // Clear previous

    await Product.insertMany([
      { name: 'Intel i9 12900K', type: 'CPU', price: 550, stock: 10 },
      { name: 'NVIDIA RTX 4090', type: 'GPU', price: 1600, stock: 5 },
      { name: 'Corsair Vengeance 16GB', type: 'RAM', price: 80, stock: 20 }
    ]);

    console.log('✅ Seeding done!');
    process.exit();
  })
  .catch(err => console.error('❌ Error:', err));
