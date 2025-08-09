const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const productHistorySchema = new Schema({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  name: String,
  price: Number,
  stock: Number,
  salesCount: Number,
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ProductHistory', productHistorySchema);
