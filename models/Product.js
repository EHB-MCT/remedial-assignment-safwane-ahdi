const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true }, 
  price: { type: Number, required: true },
  stock: { type: Number, required: true },
  salesCount: { type: Number, default: 0 },
  lastSoldAt: { type: Date, default: null },
  lastEventApplied: { type: String, default: null }
});

module.exports = mongoose.model('Product', productSchema);
