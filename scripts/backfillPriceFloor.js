require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const { PRICE_FLOOR } = require('../models/Product');

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/yourdb';
  await mongoose.connect(uri);

  // Backfill priceFloor for docs that miss it
  const cursor = Product.find({ $or: [{ priceFloor: null }, { priceFloor: { $exists: false } }] })
    .select({ _id: 1, type: 1 })
    .lean()
    .cursor();

  const ops = [];
  let count = 0;

  for await (const doc of cursor) {
    const floor = PRICE_FLOOR[doc.type] ?? 10;
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { priceFloor: floor } }
      }
    });
    if (ops.length === 1000) {
      await Product.bulkWrite(ops, { ordered: false });
      count += ops.length;
      ops.length = 0;
    }
  }
  if (ops.length) {
    await Product.bulkWrite(ops, { ordered: false });
    count += ops.length;
  }

  // Ensure indexes exist (safe to call repeatedly)
  await Product.syncIndexes();

  console.log(`Backfilled priceFloor for ${count} products.`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
