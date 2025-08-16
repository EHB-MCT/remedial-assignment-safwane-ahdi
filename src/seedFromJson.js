const mongoose = require('mongoose');
const Product = require('../models/Product');
const data = require('../data/pc_parts_static_dataset.json');
require('dotenv').config();

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(async () => {
    console.log('🌱 Connected to MongoDB... Seeding static dataset');

    try {
      await mongoose.connection.db.dropCollection('products');
      console.log('🗑️ Dropped existing products collection');
    } catch (err) {
      if (err.code === 26) {
        console.log('ℹ️ Collection does not exist. Skipping drop.');
      } else {
        throw err;
      }
    }

    await Product.insertMany(data);
    console.log('✅ Static seeding complete');
    process.exit();
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));
