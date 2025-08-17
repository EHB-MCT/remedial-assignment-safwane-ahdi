document.addEventListener('DOMContentLoaded', () => {
  console.log('[INIT] DOM fully loaded.');

  const API_URL = 'http://localhost:5000/products';

  const byId = new Map();
  const previousData = new Map();

  let initialLoaded = false;
  const queuedDeltas = [];

  // Filter state
  const filterState = {
    types: new Set(),   // empty = All
    priceMin: '',
    priceMax: '',
    stock: '',
    salesMin: '',
    salesMax: ''
  };

  // Hold full dataset for filters/charts
  let allProducts = [];

  // Kick initial loads
  loadProducts().then(() => {
    initialLoaded = true;
    if (queuedDeltas.length) {
      mergeDeltas(queuedDeltas.splice(0, queuedDeltas.length));
    }
    allProducts = Array.from(byId.values());
    buildTypeTabs(allProducts);
    renderProducts(allProducts);
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
    allProducts = Array.from(byId.values());
    renderProducts(allProducts);
  }, 200);

  // Build type tabs dynamically
  function buildTypeTabs(products) {
    const tabs = document.getElementById('typeTabs');
    if (!tabs) return;

    const types = Array.from(new Set(products.map(p => p.type || 'unknown'))).sort();
    tabs.innerHTML = '';

    const makeBtn = (label, value) => {
      const btn = document.createElement('button');
      btn.className = 'tab';
      btn.textContent = label;
      btn.dataset.type = value;
      return btn;
    };

    // All button
    const allBtn = makeBtn('All', '');
    const syncAllActive = () => {
      allBtn.classList.toggle('active', filterState.types.size === 0);
    };
    allBtn.addEventListener('click', () => {
      filterState.types.clear();   // clear to mean "All"
      // update UI states
      Array.from(tabs.children).forEach(b => b.classList.remove('active'));
      syncAllActive();
      renderProducts(allProducts);
    });
    tabs.appendChild(allBtn);

    // Type buttons
    types.forEach(t => {
      const b = makeBtn(t, t);
      if (filterState.types.has(t)) b.classList.add('active');
      b.addEventListener('click', () => {
        if (filterState.types.has(t)) {
          filterState.types.delete(t);
          b.classList.remove('active');
        } else {
          filterState.types.add(t);
          b.classList.add('active');
        }
        // If nothing selected, "All" becomes active; otherwise, it's off
        syncAllActive();
        renderProducts(allProducts);
      });
      tabs.appendChild(b);
    });

    // set initial state for "All"
    syncAllActive();
  }

  // Filters apply function
  function applyFilters(products) {
    const minP = filterState.priceMin !== '' ? Number(filterState.priceMin) : -Infinity;
    const maxP = filterState.priceMax !== '' ? Number(filterState.priceMax) : Infinity;
    const minS = filterState.salesMin !== '' ? Number(filterState.salesMin) : -Infinity;
    const maxS = filterState.salesMax !== '' ? Number(filterState.salesMax) : Infinity;

    return products.filter(p => {
      const typeOk = filterState.types.size === 0 || filterState.types.has(p.type || 'unknown');
      const price = Number(p.price ?? 0);
      const priceOk = price >= minP && price <= maxP;

      const inStock = Number(p.stock ?? 0) > 0;
      const stockOk =
        filterState.stock === '' ||
        (filterState.stock === 'in' && inStock) ||
        (filterState.stock === 'out' && !inStock);

      const sales = Number(p.salesCount ?? 0);
      const salesOk = sales >= minS && sales <= maxS;

      return typeOk && priceOk && stockOk && salesOk;
    });
  }

  // Hook up filter controls
  const elPriceMin = document.getElementById('filter-price-min');
  const elPriceMax = document.getElementById('filter-price-max');
  const elStock = document.getElementById('filter-stock');
  const elSalesMin = document.getElementById('filter-sales-min');
  const elSalesMax = document.getElementById('filter-sales-max');

  const elApply = document.getElementById('filter-apply');
  const elReset = document.getElementById('filter-reset');

  if (elApply) {
    elApply.addEventListener('click', () => {
      filterState.priceMin = elPriceMin.value.trim();
      filterState.priceMax = elPriceMax.value.trim();
      filterState.stock = elStock.value;
      filterState.salesMin = elSalesMin.value.trim();
      filterState.salesMax = elSalesMax.value.trim();
      renderProducts(allProducts);
    });
  }

  if (elReset) {
    elReset.addEventListener('click', () => {
      filterState.type = '';
      filterState.priceMin = '';
      filterState.priceMax = '';
      filterState.stock = '';
      filterState.salesMin = '';
      filterState.salesMax = '';

      if (elPriceMin) elPriceMin.value = '';
      if (elPriceMax) elPriceMax.value = '';
      if (elStock) elStock.value = '';
      if (elSalesMin) elSalesMin.value = '';
      if (elSalesMax) elSalesMax.value = '';

      // Reset active tab to "All"
      filterState.types.clear();

      const tabs = document.getElementById('typeTabs');
      if (tabs) {
        Array.from(tabs.children).forEach((b, i) => {
          b.classList.toggle('active', i === 0); // first is "All"
        });
      }

      renderProducts(allProducts);
    });
  }

  function renderProducts(all) {
    // Rebuild tabs if new types appear
    buildTypeTabs(all);

    const products = applyFilters(all);

    console.log('[RENDER] Rendering', products.length, 'filtered of', all.length);

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
        <td>${product.type || '-'}</td>
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

    // Charts that follow current filters
    updateTopSellersChart(products);
    renderStockDistributionChart(products);

    // Timeline charts should remain global for consistency
    updateStockTimelineChart(all);
    updateRevenueTimelineChart(all);

    // Low stock chart should respect filters so you can focus per type
    renderLowStockChart(products);
  }

  // Charts: Top Sellers
  function updateTopSellersChart(products) {
    const topProducts = [...products]
      .sort((a, b) => Number(b.salesCount ?? 0) - Number(a.salesCount ?? 0))
      .slice(0, 10);

    const labels = topProducts.map(p => p.name || '(no name)');
    const sales = topProducts.map(p => Number(p.salesCount ?? 0));

    const canvas = document.getElementById('topSellersChart');
    if (!canvas) return console.error('[CHART] topSellersChart canvas not found.');
    const ctx = canvas.getContext('2d');
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

  // Charts: Stock Distribution by type (filtered)
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
      data: { labels, datasets: [{ label: 'Stock by Product Type', data, backgroundColor: ['#00ffff', '#ffff00', '#ff00ff', '#00ff88', '#ffaa00', '#ff0044', '#88aaff'], borderColor: '#111', borderWidth: 2 }] },
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

  // Charts: Stock Timeline (global)
  let stockTimelineChart;
  const stockTimelineData = { labels: [], data: [] };
  function updateStockTimelineChart(productsAll) {
    const timestamp = new Date().toLocaleTimeString();
    const totalStockUnits = productsAll.reduce((sum, p) => sum + Number(p.stock ?? 0), 0);

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

  // New Chart: Revenue Over Time (global)
  let revenueTimelineChart;
  const revenueTimelineData = { labels: [], data: [] };
  function updateRevenueTimelineChart(productsAll) {
    const timestamp = new Date().toLocaleTimeString();
    const totalRevenue = productsAll.reduce((sum, p) => {
      const price = Number(p.price ?? 0);
      const sales = Number(p.salesCount ?? 0);
      return sum + price * sales;
    }, 0);

    if (revenueTimelineData.labels.length >= 20) {
      revenueTimelineData.labels.shift();
      revenueTimelineData.data.shift();
    }
    revenueTimelineData.labels.push(timestamp);
    revenueTimelineData.data.push(Number(totalRevenue.toFixed(2)));

    const canvas = document.getElementById('revenueTimelineChart');
    if (!canvas) return console.error('[CHART] revenueTimelineChart canvas not found.');
    const ctx = canvas.getContext('2d');

    if (revenueTimelineChart) {
      revenueTimelineChart.data.labels = revenueTimelineData.labels;
      revenueTimelineChart.data.datasets[0].data = revenueTimelineData.data;
      revenueTimelineChart.update();
    } else {
      revenueTimelineChart = new Chart(ctx, {
        type: 'line',
        data: { labels: revenueTimelineData.labels, datasets: [{ label: 'Total Revenue Index', data: revenueTimelineData.data, fill: false, borderColor: '#ffaa00', pointBackgroundColor: '#ffeb00', pointRadius: 3, tension: 0.3 }] },
        options: {
          responsive: true,
          animation: false,
          plugins: { legend: { display: false }, tooltip: { backgroundColor: '#111', titleColor: '#ffff00', bodyColor: '#ffffff', borderColor: '#ffaa00', borderWidth: 1 } },
          scales: {
            x: { title: { display: true, text: 'Time', color: '#ffff00' }, ticks: { color: '#ffffff' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } },
            y: { beginAtZero: true, title: { display: true, text: 'Revenue Index (price × sales)', color: '#ffff00' }, ticks: { color: '#ffffff' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
          }
        }
      });
    }
  }

  // New Chart: Low Stock Alerts (filtered)
  let lowStockChart;
  function renderLowStockChart(products) {
    const threshold = 5;
    const low = products
      .filter(p => Number(p.stock ?? 0) <= threshold)
      .sort((a, b) => Number(a.stock ?? 0) - Number(b.stock ?? 0))
      .slice(0, 10);

    const labels = low.map(p => p.name || '(no name)');
    const data = low.map(p => Number(p.stock ?? 0));

    const canvas = document.getElementById('lowStockChart');
    if (!canvas) return console.error('[CHART] lowStockChart canvas not found.');
    const ctx = canvas.getContext('2d');

    if (lowStockChart) lowStockChart.destroy();
    lowStockChart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Units in Stock', data, backgroundColor: '#ff0044', borderColor: '#ff0044' }] },
      options: {
        responsive: true,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { backgroundColor: '#111', titleColor: '#ffff00', bodyColor: '#ffffff', borderColor: '#ff0044', borderWidth: 1 } },
        scales: {
          x: { ticks: { color: '#ffffff' }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: '#ffffff' }, grid: { color: 'rgba(255, 255, 255, 0.05)' } }
        }
      }
    });
  }

  function debounce(fn, wait) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }
});
