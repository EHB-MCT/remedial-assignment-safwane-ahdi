document.addEventListener('DOMContentLoaded', () => {
  console.log('[INIT] DOM fully loaded.');

  const API_URL = 'http://localhost:5000/products';

  const byId = new Map();
  const previousData = new Map();

  let initialLoaded = false;
  const queuedDeltas = [];

  // Kick initial loads
  loadProducts().then(() => {
    initialLoaded = true;
    if (queuedDeltas.length) {
      mergeDeltas(queuedDeltas.splice(0, queuedDeltas.length));
    }
    renderProducts(Array.from(byId.values()));
  });
  loadEvents();

  // Socket wiring (supports full snapshot and deltas)
  const socket = io('http://localhost:5000');
  socket.on('connect', () => console.log('[WebSocket] Connected to server.'));

  socket.on('productsUpdated', (products) => {
    console.log('[WebSocket] Full snapshot received:', products.length);
    byId.clear();
    products.forEach(p => byId.set(p._id, p));
    debouncedRender();
  });

  socket.on('productsDelta', (updates) => {
    if (!Array.isArray(updates) || updates.length === 0) return;
    if (!initialLoaded) {
      queuedDeltas.push(...updates);
      return;
    }
    mergeDeltas(updates);
    debouncedRender();
  });

  function mergeDeltas(updates) {
    for (const u of updates) {
      const cur = byId.get(u._id);
      if (cur) {
        Object.assign(cur, u);
      } else {
        // Skip creating placeholder docs; initial snapshot will supply full fields
        // If you want placeholders, you could set: byId.set(u._id, { _id: u._id, name: '(loading...)', type: 'unknown', ...u });
      }
    }
  }

  async function loadProducts() {
    console.log('[LOAD] Fetching initial product data...');
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const products = await res.json();
    console.log('[LOAD] Products received:', products.length);
    byId.clear();
    products.forEach(p => byId.set(p._id, p));
  }

  async function loadEvents() {
    console.log('[LOAD] Fetching event data...');
    try {
      const [activeRes, historyRes] = await Promise.all([
        fetch('http://localhost:5000/events/active'),
        fetch('http://localhost:5000/events'),
      ]);
      const activeEvent = activeRes.ok ? await activeRes.json() : null;
      const eventHistory = historyRes.ok ? await historyRes.json() : [];
      renderActiveEvent(activeEvent);
      renderEventHistory(eventHistory);
    } catch (err) {
      console.error('[LOAD] Failed to fetch events:', err);
    }
  }

  function renderActiveEvent(event) {
    const el = document.getElementById('activeEvent');
    if (!el) return console.warn('[RENDER] activeEvent element not found.');
    if (!event) {
      el.innerHTML = `<h3>Active Event</h3><p>No active event at the moment.</p>`;
      return;
    }
    el.innerHTML = `
      <h3>Active Event</h3>
      <p><strong>${event.name}</strong></p>
      <p>Started: ${new Date(event.startedAt).toLocaleString()}</p>
      <p>${event.description || 'No description available.'}</p>
    `;
  }

  function renderEventHistory(events) {
    const el = document.getElementById('eventHistory');
    if (!el) return console.warn('[RENDER] eventHistory element not found.');
    el.innerHTML = `<h3>Event History</h3>`;
    for (const ev of events) {
      const div = document.createElement('div');
      div.classList.add('event-entry');
      div.innerHTML = `
        <p><strong>${ev.name}</strong> - ${new Date(ev.startedAt).toLocaleString()}</p>
        <p>${ev.description || 'No description available.'}</p>
      `;
      el.appendChild(div);
    }
  }

  const debouncedRender = debounce(() => {
    renderProducts(Array.from(byId.values()));
  }, 250);

  function renderProducts(products) {
    console.log('[RENDER] Rendering', products.length, 'products...');
    const tbody = document.getElementById('product-body');
    if (!tbody) return console.error('[RENDER] product-body element not found.');

    tbody.innerHTML = '';

    let totalValue = 0;
    let topProduct = null;
    let outOfStock = 0;

    for (const product of products) {
      const prev = previousData.get(product._id);
      const tr = document.createElement('tr');

      const changed = !!prev && (
        product.stock !== prev.stock ||
        product.salesCount !== prev.salesCount ||
        product.price !== prev.price
      );

      tr.innerHTML = `
        <td>${product.name || '(no name)'}</td>
        <td>${Number(product.stock ?? 0)}</td>
        <td>€${Number(product.price ?? 0).toFixed(2)}</td>
        <td>${Number(product.salesCount ?? 0)}</td>
        <td>${product.lastSoldAt ? new Date(product.lastSoldAt).toLocaleString() : '-'}</td>
      `;

      if (changed) {
        tr.classList.add('flash-update');
        setTimeout(() => tr.classList.remove('flash-update'), 800);
      }

      tbody.appendChild(tr);
      previousData.set(product._id, { ...product });

      totalValue += Number(product.price ?? 0) * Number(product.stock ?? 0);
      if (!topProduct || Number(product.salesCount ?? 0) > Number(topProduct.salesCount ?? 0)) {
        topProduct = product;
      }
      if (Number(product.stock ?? 0) === 0) outOfStock++;
    }

    const totalEl = document.getElementById('totalValue');
    const topEl = document.getElementById('topSeller');
    const outEl = document.getElementById('outOfStockCount');

    if (totalEl) totalEl.textContent = `Total stock value: €${totalValue.toFixed(2)}`;
    if (topEl) topEl.textContent = topProduct
      ? `Top-selling product: ${topProduct.name || '(no name)'} (${topProduct.salesCount || 0} sales)`
      : 'Top-selling product: -';
    if (outEl) outEl.textContent = `Out of stock products: ${outOfStock}`;

    updateTopSellersChart(products);
    renderStockDistributionChart(products);
    updateStockTimelineChart(products);
  }

  function updateTopSellersChart(products) {
    console.log('[CHART] Updating top sellers chart...');
    const topProducts = [...products]
      .sort((a, b) => Number(b.salesCount ?? 0) - Number(a.salesCount ?? 0))
      .slice(0, 10);

    const labels = topProducts.map(p => p.name || '(no name)');
    const sales = topProducts.map(p => Number(p.salesCount ?? 0));

    const canvas = document.getElementById('topSellersChart');
    if (!canvas) return console.error('[CHART] Canvas element not found.');
    const ctx = canvas.getContext('2d');
    if (!ctx) return console.error('[CHART] Failed to get canvas context.');
    const ChartLib = Chart.Chart || Chart;

    if (window.topSellersChart && window.topSellersChart.data && window.topSellersChart.data.datasets[0]) {
      window.topSellersChart.data.labels = labels;
      window.topSellersChart.data.datasets[0].data = sales;
      window.topSellersChart.update();
    } else {
      window.topSellersChart = new ChartLib(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Sales Count', data: sales, backgroundColor: '#00ffff', borderColor: '#00ffff', borderWidth: 1 }] },
        options: {
          responsive: true,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { backgroundColor: '#111', titleColor: '#ffff00', bodyColor: '#ffffff', borderColor: '#00ffff', borderWidth: 1 } },
          scales: {
            x: { ticks: { color: '#ffffff' }, grid: { display: false } },
            y: { beginAtZero: true, ticks: { color: '#ffffff' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
          }
        }
      });
    }
  }

  let stockDistributionChart;
  function renderStockDistributionChart(products) {
    const stockByType = {};
    for (const p of products) {
      const t = p.type || 'unknown';
      stockByType[t] = (stockByType[t] || 0) + Number(p.stock ?? 0);
    }
    const labels = Object.keys(stockByType);
    const data = Object.values(stockByType);

    const canvas = document.getElementById('stockDistributionChart');
    if (!canvas) return console.error('[CHART] stockDistributionChart canvas not found.');
    const ctx = canvas.getContext('2d');

    if (stockDistributionChart) stockDistributionChart.destroy();
    stockDistributionChart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ label: 'Stock by Product Type', data, backgroundColor: ['#00ffff', '#ffff00', '#ff00ff', '#00ff88', '#ffaa00', '#ff0044'], borderColor: '#111', borderWidth: 2 }] },
      options: {
        responsive: true,
        animation: false,
        plugins: {
          legend: { position: 'right', labels: { color: '#ffffff' } },
          tooltip: { backgroundColor: '#111', titleColor: '#ffff00', bodyColor: '#ffffff', borderColor: '#00ffff', borderWidth: 1 }
        }
      }
    });
  }

  let stockTimelineChart;
  const stockTimelineData = { labels: [], data: [] };

  function updateStockTimelineChart(products) {
    const timestamp = new Date().toLocaleTimeString();
    const totalStockUnits = products.reduce((sum, p) => sum + Number(p.stock ?? 0), 0);

    if (stockTimelineData.labels.length >= 20) {
      stockTimelineData.labels.shift();
      stockTimelineData.data.shift();
    }
    stockTimelineData.labels.push(timestamp);
    stockTimelineData.data.push(totalStockUnits);

    const canvas = document.getElementById('stockTimelineChart');
    if (!canvas) return console.error('[CHART] stockTimelineChart canvas not found.');
    const ctx = canvas.getContext('2d');

    if (stockTimelineChart) {
      stockTimelineChart.data.labels = stockTimelineData.labels;
      stockTimelineChart.data.datasets[0].data = stockTimelineData.data;
      stockTimelineChart.update();
    } else {
      stockTimelineChart = new Chart(ctx, {
        type: 'line',
        data: { labels: stockTimelineData.labels, datasets: [{ label: 'Total Stock Over Time', data: stockTimelineData.data, fill: false, borderColor: '#00ffff', pointBackgroundColor: '#ffff00', pointRadius: 3, tension: 0.3 }] },
        options: {
          responsive: true,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { backgroundColor: '#111', titleColor: '#ffff00', bodyColor: '#ffffff', borderColor: '#00ffff', borderWidth: 1 } },
          scales: {
            x: { title: { display: true, text: 'Time', color: '#ffff00' }, ticks: { color: '#ffffff' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
            y: { beginAtZero: true, title: { display: true, text: 'Total Stock Units', color: '#ffff00' }, ticks: { color: '#ffffff' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
          }
        }
      });
    }
  }

  function debounce(fn, wait) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }
});
