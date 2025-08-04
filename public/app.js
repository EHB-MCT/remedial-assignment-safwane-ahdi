const API_URL = 'http://localhost:5000/products';

// Fallback: initial load in case no socket event fires
loadProducts();

// Connect to WebSocket server
const socket = io('http://localhost:5000');

socket.on('connect', () => {
  console.log('✅ Connected to WebSocket server');
});

socket.on('productsUpdated', (products) => {
  console.log('🔄 Real-time update received');
  renderProducts(products);
});

async function loadProducts() {
  try {
    const res = await fetch(API_URL);
    const products = await res.json();
    renderProducts(products);
  } catch (err) {
    console.error('Failed to load products:', err);
  }
}

let previousData = {};

function renderProducts(products) {
  const tbody = document.getElementById('product-body');
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
      <td>€${(product.price / 100).toFixed(2)}</td>
      <td>${product.salesCount}</td>
      <td>${product.lastSoldAt ? new Date(product.lastSoldAt).toLocaleString() : '-'}</td>
    `;

    if (changed) {
      tr.classList.add('flash-update');
      setTimeout(() => tr.classList.remove('flash-update'), 800);
    }

    tbody.appendChild(tr);
    previousData[product.name] = product;

    // Accumulate stats
    totalValue += product.price * product.stock;
    if (!topProduct || product.salesCount > topProduct.salesCount) {
      topProduct = product;
    }
    if (product.stock === 0) outOfStock++;
  });

  // Display analytics
  document.getElementById('totalValue').textContent =
    `Total stock value: €${(totalValue / 100).toFixed(2)}`;
  document.getElementById('topSeller').textContent =
    topProduct ? `Top-selling product: ${topProduct.name} (${topProduct.salesCount} sales)` : '';
  document.getElementById('outOfStockCount').textContent =
    `Out of stock products: ${outOfStock}`;
}


