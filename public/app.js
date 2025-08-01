const API_URL = 'http://localhost:5000/products';

async function loadProducts() {
  try {
    const res = await fetch(API_URL);
    const products = await res.json();

    const tbody = document.getElementById('product-body');
    tbody.innerHTML = '';

    products.forEach(product => {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${product.name}</td>
        <td>${product.stock}</td>
        <td>€${(product.price / 100).toFixed(2)}</td>
        <td>${product.salesCount}</td>
        <td>${product.lastSoldAt ? new Date(product.lastSoldAt).toLocaleString() : '-'}</td>
      `;

      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load products:', err);
  }
}

loadProducts();
