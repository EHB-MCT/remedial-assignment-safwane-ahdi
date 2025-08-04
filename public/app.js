document.addEventListener('DOMContentLoaded', () => {
  console.log('[INIT] DOM fully loaded.');

  const API_URL = 'http://localhost:5000/products';
  let previousData = {};

  loadProducts();

  const socket = io('http://localhost:5000');
  socket.on('connect', () => console.log('[WebSocket] ✅ Connected to server.'));
  socket.on('productsUpdated', (products) => {
    console.log('[WebSocket] 🔄 Update received:', products);
    renderProducts(products);
  });

  async function loadProducts() {
    console.log('[LOAD] Fetching initial product data...');
    try {
      const res = await fetch(API_URL);
      console.log('[LOAD] Response status:', res.status);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const products = await res.json();
      console.log('[LOAD] Products received:', products);
      renderProducts(products);
    } catch (err) {
      console.error('[LOAD] ❌ Failed to fetch products:', err);
    }
  }

  function renderProducts(products) {
    console.log('[RENDER] Rendering products...');
    const tbody = document.getElementById('product-body');
    if (!tbody) {
      console.error('[RENDER] ❌ product-body element not found.');
      return;
    }

    tbody.innerHTML = '';

    let totalValue = 0;
    let topProduct = null;
    let outOfStock = 0;

    products.forEach(product => {
      const prev = previousData[product.name];
      const tr = document.createElement('tr');

      const changed = prev && (
        product.stock !== prev.stock ||
        product.salesCount !== prev.salesCount
      );

      tr.innerHTML = `
        <td>${product.name}</td>
        <td>${product.stock}</td>
        <td>€${(product.price).toFixed(2)}</td>
        <td>${product.salesCount}</td>
        <td>${product.lastSoldAt ? new Date(product.lastSoldAt).toLocaleString() : '-'}</td>
      `;

      if (changed) {
        tr.classList.add('flash-update');
        setTimeout(() => tr.classList.remove('flash-update'), 800);
        console.log(`[RENDER] Change detected for ${product.name}`);
      }

      tbody.appendChild(tr);
      previousData[product.name] = product;

      totalValue += product.price * product.stock;
      if (!topProduct || product.salesCount > topProduct.salesCount) {
        topProduct = product;
      }
      if (product.stock === 0) outOfStock++;
    });

    const totalEl = document.getElementById('totalValue');
    const topEl = document.getElementById('topSeller');
    const outEl = document.getElementById('outOfStockCount');

    if (!totalEl || !topEl || !outEl) {
      console.warn('[RENDER] One or more summary elements not found.');
    } else {
      totalEl.textContent = `Total stock value: €${(totalValue / 100).toFixed(2)}`;
      topEl.textContent = topProduct ? `Top-selling product: ${topProduct.name} (${topProduct.salesCount} sales)` : '';
      outEl.textContent = `Out of stock products: ${outOfStock}`;
    }

    updateTopSellersChart(products);
  }

  function updateTopSellersChart(products) {
    console.log('[CHART] Updating chart...');
  
    const topProducts = [...products]
      .sort((a, b) => b.salesCount - a.salesCount)
      .slice(0, 10);
  
    const labels = topProducts.map(p => p.name);
    const sales = topProducts.map(p => p.salesCount);
  
    console.log('[CHART] Labels:', labels);
    console.log('[CHART] Sales:', sales);
  
    const canvas = document.getElementById('topSellersChart');
    if (!canvas) {
      console.error('[CHART] ❌ Canvas element not found.');
      return;
    }
  
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('[CHART] ❌ Failed to get canvas context.');
      return;
    }
  
    const ChartLib = Chart.Chart || Chart;
  
    if (window.topSellersChart) {
      console.log('[CHART] Updating existing chart...');
      window.topSellersChart.data.labels = labels;
      window.topSellersChart.data.datasets[0].data = sales;
      window.topSellersChart.update();
    } else {
      console.log('[CHART] Creating new chart...');
      window.topSellersChart = new ChartLib(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Sales Count',
            data: sales,
            backgroundColor: 'rgba(54, 162, 235, 0.7)'
          }]
        },
        options: {
          responsive: true,
          scales: {
            y: { beginAtZero: true }
          }
        }
      });
      console.log('[CHART] Chart created successfully');
    }
  }
});  