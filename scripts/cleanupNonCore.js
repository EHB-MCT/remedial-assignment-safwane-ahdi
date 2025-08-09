const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const Product = require('../models/Product');

const CORE = new Set([
  'cpu','video-card','motherboard','memory','power-supply',
  'cpu-cooler','case','case-fan','internal-hard-drive','solid-state-drive'
]);

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGO_URI. Check your .env at project root.');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const res = await Product.deleteMany({ type: { $nin: [...CORE] } });
  console.log(`Removed ${res.deletedCount} non-core products.`);
  await mongoose.disconnect();
})();
