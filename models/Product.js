const mongoose = require('mongoose');

const PRICE_FLOOR = {
  cpu: 50,
  'video-card': 120,
  motherboard: 40,
  memory: 12,
  'power-supply': 25,
  'cpu-cooler': 10,
  case: 20,
  'case-fan': 5,
  'internal-hard-drive': 20,
  'solid-state-drive': 25
};

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, required: true }, 
  price: { type: Number, required: true },
  stock: { type: Number, required: true },
  salesCount: { type: Number, default: 0 },
  lastSoldAt: { type: Date, default: null },
  lastEventApplied: { type: String, default: null },

  // New: persist per-doc floor used by update pipelines
  priceFloor: { type: Number, default: null }
}, { timestamps: true });

// Indexes that your engine will leverage
productSchema.index({ stock: 1 });
productSchema.index({ lastSoldAt: 1 });
productSchema.index({ lastEventApplied: 1 });
productSchema.index({ type: 1 });
productSchema.index({ updatedAt: -1 });

// Safety: ensure priceFloor is set for new docs
productSchema.pre('save', function nextHook(next) {
  if (this.priceFloor == null) {
    this.priceFloor = PRICE_FLOOR[this.type] ?? 10;
  }
  next();
});

module.exports = mongoose.model('Product', productSchema);
module.exports.PRICE_FLOOR = PRICE_FLOOR;
