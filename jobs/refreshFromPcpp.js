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

// ---------- helpers ----------
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

function isLikelySSD(p) {
  const name = (p.name || p.model || '').toLowerCase();
  const iface = (p.interface || p.form_factor || p.type || '').toLowerCase();
  if (/(^|[^a-z])ssd([^a-z]|$)/.test(name)) return true;
  if (/nvme|m\.2|m2/.test(name) || /nvme|m\.2|m2/.test(iface)) return true;
  if (/solid\s*state/.test(name)) return true;
  if (/nand|tlc|mlc/.test(name)) return true;
  if (/hdd|hard\s*drive|\b(54|57|59|72|10)00\s*rpm\b/.test(name)) return false;
  return false;
}

function isLikelyHDD(p) {
  const name = (p.name || p.model || '').toLowerCase();
  if (/hdd|hard\s*drive|\b(54|57|59|72|10)00\s*rpm\b/.test(name)) return true;
  if (isLikelySSD(p)) return false;
  return /3\.5"|2\.5"/.test(name);
}

// NEW: initial stock generator (per category) + env toggle
const PRESTOCK_ENABLED = process.env.PRESTOCK !== 'false';
function initialStockFor(type) {
  if (!PRESTOCK_ENABLED) return 0;
  const ranges = {
    cpu: [2, 6],
    'video-card': [1, 4],
    motherboard: [2, 8],
    memory: [5, 15],
    'power-supply': [2, 8],
    'cpu-cooler': [3, 10],
    case: [1, 5],
    'case-fan': [5, 20],
    'internal-hard-drive': [2, 8],
    'solid-state-drive': [2, 8]
  };
  const [lo, hi] = ranges[type] || [2, 6];
  return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

// For regions where "solid-state-drive" doesn't exist (e.g., BE),
// fetch from "internal-hard-drive" and filter.
const FETCH_MAP = {
  "solid-state-drive": { fetch: "internal-hard-drive", filter: isLikelySSD, note: "aliased from internal-hard-drive" },
  "internal-hard-drive": { fetch: "internal-hard-drive", filter: isLikelyHDD }
};

async function refreshFromPcpp() {
  const ops = [];
  let total = 0, cats = 0;

  for (const category of ALLOWED) {
    const plan = FETCH_MAP[category] || { fetch: category, filter: null };

    try {
      if (plan.note) {
        console.log(`[PCPP] ${category}: ${plan.note}`);
      }

      const parts = await fetchCategory(plan.fetch);
      if (!Array.isArray(parts) || parts.length === 0) {
        console.warn(`[PCPP] ${category}: no parts returned`);
        continue;
      }

      const sliced = parts.slice(0, MAX_PER_CATEGORY);
      const filtered = plan.filter ? sliced.filter(plan.filter) : sliced;

      if (filtered.length === 0) {
        console.warn(`[PCPP] ${category}: no items after filtering`);
        continue;
      }

      let imported = 0;
      let skippedNoPrice = 0;

      for (const p of filtered) {
        const name = p.name || p.model || 'Unknown';
        const rawPrice = extractPrice(p);

        // skip placeholder/no regional price
        if (rawPrice <= 1) {
          skippedNoPrice++;
          continue;
        }

        const price = rawPrice;
        const type = category;

        ops.push({
          updateOne: {
            filter: { name, type },
            update: {
              $set: { name, type, price },
              $setOnInsert: {
                stock: initialStockFor(type), // was 0
                salesCount: 0,
                lastSoldAt: null,
                lastEventApplied: null
              }
            },
            upsert: true
          }
        });

        imported++;
      }

      console.log(`[PCPP] ${category}: imported ${imported}, skipped(no-price) ${skippedNoPrice}`);

      total += imported;
      if (imported > 0) cats += 1;
    } catch (e) {
      console.warn(`[PCPP] Skipping ${category}: ${e.message}`);
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
