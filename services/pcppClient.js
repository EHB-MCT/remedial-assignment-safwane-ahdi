const fetch = require('node-fetch');

const BASE = process.env.PCPP_PROXY_URL_BASE || 'http://localhost:8081';
const DEFAULT_REGION = process.env.PCPP_REGION || 'be';

async function fetchCategory(category) {
  const url = `${BASE}/parts/${encodeURIComponent(category)}?region=${encodeURIComponent(DEFAULT_REGION)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`PCPP proxy ${r.status} for ${category}`);
  const payload = await r.json();
  // Some proxy versions return {timestamp, data:[...]}, others {timestamp, data:{category:[...]}}
  const arr = Array.isArray(payload.data)
    ? payload.data
    : payload.data?.[category] || payload.data?.[category.toLowerCase()] || [];
  return arr;
}

module.exports = { fetchCategory };
