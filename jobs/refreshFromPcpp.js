const Product = require('../models/Product');
const { fetchCategory } = require('../services/pcppClient');

const ALLOWED = [
  "cpu",
  "video-card",
  "motherboard",
  "memory",
  "power-supply",
  "cpu-cooler",
  "case",
  "case-fan",
  "internal-hard-drive",
  "solid-state-drive"
];

const MAX_PER_CATEGORY = 1000;

function toNumber(x) {
  if (x == null) return 0;
  if (typeof x === 'number') return x;
  if (Array.isArray(x)) {
    const n = x.find(v => typeof v === 'number') ??
              x.find(v => typeof v === 'string' && /\d/.test(v));
    return n ? Number(String(n).replace(/[^\d.]/g, '')) : 0;
  }
  if (typeof x === 'string') {
    const m = x.match(/[\d,.]+/);
    return m ? Number(m[0].replace(/,/g, '')) : 0;
  }
  return 0;
}

function extractPrice(p) {
  if (p.price != null) return toNumber(p.price);
  if (p.price_usd != null) return toNumber(p.price_usd);
  if (p.prices && Array.isArray(p.prices)) {
    const first = p.prices.find(x => x && x.price != null);
    if (first) return toNumber(first.price);
  }
  return 0;
}

async function refreshFromPcpp() {
  const ops = [];
  let total = 0, cats = 0;

  for (const category of ALLOWED) {
    try {
      const parts = await fetchCategory(category);
      if (!Array.isArray(parts) || parts.length === 0) {
        console.warn(`[PCPP] ${category}: no parts returned`);
        continue;
      }
      const slice = parts.slice(0, MAX_PER_CATEGORY);

      for (const p of slice) {
        const name = p.name || p.model || 'Unknown';
        const price = extractPrice(p);
        const type = category;

        ops.push({
          updateOne: {
            filter: { name, type },
            update: {
              $set: { name, type, price },
              $setOnInsert: {
                stock: 0,
                salesCount: 0,
                lastSoldAt: null,
                lastEventApplied: null
              }
            },
            upsert: true
          }
        });
      }

      total += slice.length;
      cats += 1;
    } catch (e) {
      console.error(`[PCPP] ${category} fetch failed: ${e.message}`);
    }
  }

  if (!ops.length) {
    console.warn('[PCPP] No ops to upsert; check proxy and categories.');
    return 0;
  }

  await Product.bulkWrite(ops, { ordered: false });
  console.log(`[PCPP] Upserted ${total} parts across ${cats} categories.`);
  return ops.length;
}

module.exports = { refreshFromPcpp };
