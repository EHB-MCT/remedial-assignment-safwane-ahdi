const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ['CPU', 'GPU', 'RAM'], required: true },
  price: { type: Number, required: true },
  stock: { type: Number, required: true },
  salesCount: { type: Number, default: 0 }
});

module.exports = mongoose.model('Product', productSchema);
