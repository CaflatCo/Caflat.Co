/* ═══════════════════════════════════════════════════════
   PRODUCTS.JS — Product management + POS product grid
═══════════════════════════════════════════════════════ */

function getProducts() {
  return Array.isArray(APP_STATE.products) ? APP_STATE.products : [];
}

function setProducts(products) {
  updateState('products', () => Array.isArray(products) ? products : []);
  renderProductsTable();
  renderPOSProducts();
  if (typeof refreshDashboard === 'function') refreshDashboard();
}

function getProductFormData() {
  return {
    id: getElementValue('productId') || generateId(),
    name: sanitizeText(getElementValue('productName')),
    category: sanitizeText(getElementValue('productCategory')),
    price: safeNumber(getElementValue('productPrice')),
    stock: safeNumber(getElementValue('productStock')),
    reorderLevel: safeNumber(getElementValue('productReorderLevel')),
    shelfLifeDays: safeNumber(getElementValue('productShelfLifeDays')),
    variantType: getElementValue('variantType') || 'custom',
    variants: collectVariants(),
    recipe: collectRecipeRows(),
    packagingItems: collectPackagingRows(),
    recipeMode: getElementValue('recipeMode') || 'unit',
    batchYield: safeNumber(getElementValue('batchYield')) || 1,
    createdAt: new Date().toISOString()
  };
}

function collectVariants() {
  return Array.from(document.querySelectorAll('.variant-row'))
    .map(row => {
      const name = sanitizeText(row.querySelector('.variant-name')?.value);
      const price = safeNumber(row.querySelector('.variant-price')?.value);
      if (!name) return null;
      const multiplier = safeNumber(row.querySelector('.variant-multiplier')?.value) || 1;
      return { id: row.dataset.variantId || generateId(), name, price, multiplier };
    })
    .filter(Boolean);
}

function collectRecipeRows() {
  return Array.from(document.querySelectorAll('.recipe-row'))
    .map(row => {
      const ingredientId = row.querySelector('.recipe-ingredient')?.value;
      const quantity = safeNumber(row.querySelector('.recipe-qty')?.value);
      if (!ingredientId) return null;
      return { ingredientId, quantity };
    })
    .filter(Boolean);
}

function collectPackagingRows() {
  return Array.from(document.querySelectorAll('.packaging-row'))
    .map(row => {
      const name = sanitizeText(row.querySelector('.packaging-name')?.value);
      const cost = safeNumber(row.querySelector('.packaging-cost')?.value);
      if (!name) return null;
      return { id: row.dataset.pkgId || generateId(), name, cost };
    })
    .filter(Boolean);
}

window.collectPackagingRows = collectPackagingRows;

function saveProduct() {
  const data = getProductFormData();
  if (!data.name) { showNotification('Product name is required', 'error'); return; }
  if (!data.category) { showNotification('Category is required', 'error'); return; }

  const products = getProducts();
  const existing = products.find(p => String(p.id) === String(data.id));

  // Free tier product limit — only block NEW products, not edits
  if (!existing && typeof isAtProductLimit === 'function' && isAtProductLimit()) {
    showNotification(`Free plan is limited to ${FREE_PRODUCT_LIMIT || 50} products. Upgrade to PRO to add more.`, 'error');
    if (typeof openLicenseModal === 'function') {
      setTimeout(() => openLicenseModal(
        `The Free plan holds up to ${FREE_PRODUCT_LIMIT || 50} products and you've reached it. Upgrade to PRO for unlimited products — everything you've built is safe.`
      ), 600);
    }
    return;
  }

  const idx = products.findIndex(p => String(p.id) === String(data.id));
  if (idx >= 0) products[idx] = data;
  else products.push(data);

  setProducts(products);

  // Finished-goods products keep their real stock in the FG ledger, and
  // deductProductStockForCart() deliberately never writes product.stock for
  // them — so that field is a frozen snapshot that goes stale the moment
  // anything sells.
  //
  // The delta therefore has to be measured against the LIVE ledger, not that
  // stale mirror. Measuring against product.stock silently shrank every
  // restock by however much had sold since the last edit, and once a product
  // sold out the delta went negative and _setFGRecord's Math.max(0, …) clamp
  // swallowed the restock completely, pinning the product at zero forever.
  //
  // Treat the number typed in the form as the absolute count on hand, which
  // is what "Stock" reads as. openProductModal() pre-fills the same live
  // figure, so opening and saving without touching the field is a no-op.
  if (typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(data)) {
    const target  = Number(data.stock || 0);
    // Raw ledger stock, not getFGAvailable() — reserved units are physically
    // on the shelf, so they belong in the count the owner is entering.
    const current = typeof getFGStock === 'function' ? Number(getFGStock(data.id) || 0) : 0;
    const delta   = target - current;

    if (delta !== 0 && typeof _setFGRecord === 'function') {
      _setFGRecord(data.id, data.name, delta, 0,
        existing ? 'Manual stock adjustment via Products'
                 : 'Opening stock — set on product creation',
        'manual-entry');
    }
    if (typeof renderFinishedGoodsTable === 'function') renderFinishedGoodsTable();
  }

  closeModal('productModal');
  clearProductForm();
  showNotification('Product saved', 'success');
}

/* What the Stock field should show. For finished-goods products product.stock
   is a frozen mirror (see saveProduct), so the form has to read the live FG
   ledger — otherwise it offers a stale number as the starting point and the
   owner "corrects" a figure that was already wrong. Raw stock, not available,
   to match what saveProduct writes back. */
function _productStockForForm(product) {
  if (typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(product)
      && typeof getFGStock === 'function') {
    return getFGStock(product.id);
  }
  return product.stock;
}

function clearProductForm() {
  ['productId','productName','productCategory','productPrice','productStock','productReorderLevel','productShelfLifeDays','batchYield'].forEach(id => setElementValue(id, ''));
  const vb = document.getElementById('variantBuilder'); if (vb) vb.innerHTML = '';
  const rb = document.getElementById('recipeBuilder'); if (rb) rb.innerHTML = '';
  const pb = document.getElementById('packagingBuilder'); if (pb) pb.innerHTML = '';
}

function openProductModal(productId = null) {
  clearProductForm();
  let editing = null;
  if (productId) {
    editing = getProducts().find(p => String(p.id) === String(productId));
    if (editing) hydrateProductForm(editing);
  }
  const titleEl = document.getElementById('productModalTitle');
  if (titleEl) titleEl.textContent = editing ? `Edit · ${editing.name}` : 'New Product';
  if (typeof renderIngredientDropdowns === 'function') {
    renderIngredientDropdowns();
    document.querySelectorAll('#recipeBuilder .recipe-ingredient[data-wanted-ingredient]').forEach(el => {
      el.value = el.dataset.wantedIngredient;
      el.removeAttribute('data-wanted-ingredient');
    });
  }

  openModal('productModal');

  setTimeout(() => {
    if (typeof renderProductTemplates   === 'function') renderProductTemplates();
    if (typeof renderProductCostPreview === 'function') renderProductCostPreview();
  }, 80);
}

function hydrateProductForm(product) {
  setElementValue('productId', product.id);
  setElementValue('productName', product.name);
  setElementValue('productPrice', product.price);
  setElementValue('productStock', _productStockForForm(product));
  setElementValue('productReorderLevel', product.reorderLevel);
  setElementValue('productShelfLifeDays', product.shelfLifeDays);
  setElementValue('variantType', product.variantType || 'custom');
  setElementValue('recipeMode', product.recipeMode || 'unit');
  setElementValue('batchYield', product.batchYield || 1);

  // category
  const catSelect = document.getElementById('productCategory');
  if (catSelect) catSelect.value = product.category;

  if (Array.isArray(product.variants)) product.variants.forEach(v => addVariantRow(v));
  if (Array.isArray(product.recipe)) product.recipe.forEach(r => addRecipeRow(r, true));
  if (Array.isArray(product.packagingItems)) product.packagingItems.forEach(p => addPackagingRow(p));
}

function deleteProduct(productId) {
  if (!confirm('Delete this product?')) return;
  setProducts(getProducts().filter(p => String(p.id) !== String(productId)));
  showNotification('Product deleted', 'success');
}

function renderProductsTable() {
  const tableBody = document.querySelector('#productsTable tbody');
  if (!tableBody) return;

  const search = sanitizeText(getElementValue('productSearch')).toLowerCase();
  const category = getElementValue('productCategoryFilter');

  const products = getProducts().filter(p => {
    const matchesSearch = !search || p.name.toLowerCase().includes(search);
    const matchesCategory = !category || category === 'All' || p.category === category;
    return matchesSearch && matchesCategory;
  });

  tableBody.innerHTML = '';

  if (!products.length) {
    tableBody.innerHTML = `<tr><td colspan="8" class="empty-state">No products found</td></tr>`;
    return;
  }

  products.forEach(product => {
    const stock = typeof getEffectiveStock === "function" ? getEffectiveStock(product) : Number(product.stock || 0);
    const soldOut = stock <= 0;
    const lowStock = !soldOut && stock <= Number(product.reorderLevel || 0);
    const row = document.createElement('tr');
    if (soldOut) row.classList.add('sold-out-row');
    else if (lowStock) row.classList.add('low-stock-row');

    const be = typeof calculateBreakEven === 'function' ? calculateBreakEven(product) : null;
    row.innerHTML = `
      <td style="font-weight:700;">${escapeHtml(product.name)}</td>
      <td>${escapeHtml(product.category)}</td>
      <td>${formatCurrency(product.price)}</td>
      <td style="font-variant-numeric:tabular-nums;">${round2(stock)}</td>
      <td>${round2(product.reorderLevel)}</td>
      <td style="font-variant-numeric:tabular-nums;">
        ${be && be.hasBatchContext
          ? `<span style="font-weight:800;">${be.breakEvenUnits}</span>
             <span style="font-size:10px;color:var(--gray-400);"> of ${be.batchYield}</span>`
          : be
            ? `<span style="font-size:10px;color:var(--gray-400);">Set batch yield</span>`
            : '—'}
      </td>
      <td>${soldOut ? `<span class="badge-sold-out">Sold Out</span>` : lowStock ? `<span class="badge-low-stock">Low Stock</span>` : `<span class="badge-ok">OK</span>`}</td>
      <td>
        <div class="table-actions">
          ${!window._staffMode ? `<button type="button" class="btn btn-sm" data-action="edit-product" data-id="${product.id}">Edit</button>` : ''}
          ${!window._staffMode ? `
          <div class="three-dot-wrap" style="position:relative;">
            <button type="button" class="btn btn-sm btn-secondary three-dot-btn"
              onclick="toggleProductMenu(this, '${product.id}')"
              style="padding:5px 10px;font-size:14px;letter-spacing:2px;line-height:1;">···</button>
            <div class="three-dot-menu" id="pmenu-${product.id}"
              style="display:none;position:fixed;
                background:var(--white);border:1.5px solid var(--border);
                border-radius:var(--radius-md);box-shadow:var(--shadow-md);
                min-width:130px;z-index:900;overflow:hidden;">
              <button type="button" data-action="clone-product" data-id="${product.id}"
                class="three-dot-item">Clone</button>
              <button type="button" data-action="delete-product" data-id="${product.id}"
                class="three-dot-item">Archive</button>
            </div>
          </div>` : ''}
        </div>
      </td>`;
    tableBody.appendChild(row);
  });
}

function renderPOSProducts() {
  const grid = document.getElementById('productGrid');
  if (!grid) return;

  const activeCategory = APP_STATE.ui?.activeCategory || 'All';
  const searchQuery = (APP_STATE.ui?.posSearch || '').toLowerCase();

  let products = getProducts().filter(p => activeCategory === 'All' || p.category === activeCategory);
  if (searchQuery) products = products.filter(p => p.name.toLowerCase().includes(searchQuery));

  grid.innerHTML = '';

  if (!products.length) {
    grid.innerHTML = `<div class="empty-state">No products found</div>`;
    return;
  }

  const cart = getCart();

  products.forEach(product => {
    const stock = typeof getEffectiveStock === "function" ? getEffectiveStock(product) : Number(product.stock || 0);
    const soldOut = stock <= 0;
    const lowStock = !soldOut && stock <= Number(product.reorderLevel || 0);
    const cartQty = cart.filter(i => String(i.productId) === String(product.id)).reduce((s, i) => s + i.quantity, 0);
    const hasVariants = Array.isArray(product.variants) && product.variants.length;

    const card = document.createElement('div');
    card.className = `pos-product-card${lowStock ? ' low-stock' : ''}${soldOut ? ' out-of-stock' : ''}`;

    card.innerHTML = `
      ${cartQty > 0 ? `<div class="pos-card-cart-qty">${cartQty}</div>` : ''}
      <div class="pos-card-top">
        <div class="pos-category-badge">${escapeHtml(product.category)}</div>
        ${lowStock && !soldOut ? `<div class="pos-low-stock-pill">Low</div>` : ''}
      </div>
      <div class="pos-product-body">
        <div class="pos-product-name">${escapeHtml(product.name)}</div>
      </div>
      <div class="pos-product-footer">
        <div class="pos-product-footer-left">
          <div class="pos-product-price">${formatCurrency(product.price)}</div>
          <div class="pos-product-stock${lowStock ? ' low' : ''}">${soldOut ? 'SOLD OUT' : `${round2(stock)} left`}</div>
        </div>
        ${hasVariants && !soldOut ? `<button class="pos-options-btn" type="button" title="Options">&#x22EF;</button>` : ''}
      </div>`;

    // Ellipsis button opens variant selector; stopPropagation keeps card tap clean
    if (hasVariants && !soldOut) {
      card.querySelector('.pos-options-btn').addEventListener('click', e => {
        e.stopPropagation();
        openVariantSelector(product.id);
      });
    }

    // Card tap always adds base product to cart (spammable)
    if (!soldOut) {
      card.addEventListener('click', () => addToCart(product.id));
    }

    grid.appendChild(card);
  });
}

window.getProducts = getProducts;
window.setProducts = setProducts;
window.saveProduct = saveProduct;
window.openProductModal = openProductModal;
window.deleteProduct = deleteProduct;
window.renderProductsTable = renderProductsTable;
window.renderPOSProducts = renderPOSProducts;
window.clearProductForm = clearProductForm;

function toggleProductMenu(btn, productId) {
  const menu = document.getElementById('pmenu-' + productId);
  if (!menu) return;
  const isOpen = menu.style.display !== 'none';
  document.querySelectorAll('.three-dot-menu').forEach(m => { m.style.display = 'none'; });
  if (isOpen) return;

  // Fixed positioning escapes .table-wrapper's overflow clipping, which
  // otherwise hides the menu for rows near the bottom of the list.
  menu.style.display = 'block';
  const r = btn.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  menu.style.left = Math.max(8, r.right - w) + 'px';
  const fitsBelow = r.bottom + 4 + h <= window.innerHeight - 8;
  menu.style.top = (fitsBelow ? r.bottom + 4 : r.top - 4 - h) + 'px';
}

document.addEventListener('click', e => {
  if (!e.target.closest('.three-dot-wrap')) {
    document.querySelectorAll('.three-dot-menu').forEach(m => { m.style.display = 'none'; });
  }
});

// A fixed-position menu doesn't follow its button when anything scrolls —
// close instead of drifting.
document.addEventListener('scroll', () => {
  document.querySelectorAll('.three-dot-menu').forEach(m => { m.style.display = 'none'; });
}, true);

window.toggleProductMenu = toggleProductMenu;

/* ═══════════════════════════════════════════════════════
   PRODUCT COST PREVIEW
   Reads from DOM via analytics.js. Pure renderer.
═══════════════════════════════════════════════════════ */

function renderProductCostPreview() {
  const container = document.getElementById('productCostPreview');
  if (!container) return;

  const recipeRows    = document.querySelectorAll('.recipe-row');
  const packagingRows = document.querySelectorAll('.packaging-row');
  const hasContent    = recipeRows.length > 0 || packagingRows.length > 0;

  // Ingredient cost
  const ingredients = APP_STATE.ingredients || [];
  const recipeMode  = document.getElementById('recipeMode')?.value || 'unit';
  const batchYield  = Math.max(1, Number(document.getElementById('batchYield')?.value || 1));
  let ingredientCost = 0;
  recipeRows.forEach(row => {
    const ingredientId = row.querySelector('.recipe-ingredient')?.value;
    const qty          = Number(row.querySelector('.recipe-qty')?.value || 0);
    if (!ingredientId || !qty) return;
    const ing = ingredients.find(i => String(i.id) === String(ingredientId));
    if (!ing) return;
    const perUnit = recipeMode === 'batch' ? qty / batchYield : qty;
    ingredientCost += perUnit * Number(ing.costPerUnit || 0);
  });

  // Packaging cost
  let packagingCost = 0;
  packagingRows.forEach(row => {
    packagingCost += Number(row.querySelector('.packaging-cost')?.value || 0);
  });

  const totalCost = ingredientCost + packagingCost;
  const price     = Number(document.getElementById('productPrice')?.value || 0);
  const profit    = price - totalCost;
  const margin    = price > 0 ? (profit / price) * 100 : 0;
  const profitNeg = profit < 0;

  if (!hasContent && totalCost === 0) {
    container.innerHTML = `
      <div class="cost-preview-empty">Add recipe ingredients or packaging to see cost breakdown</div>`;
    return;
  }

  // Break-even calculation
  const be = typeof calculateBreakEvenFromForm === 'function'
    ? calculateBreakEvenFromForm() : null;

  container.innerHTML = `
    <div class="cost-preview-grid" style="margin-bottom:12px;">
      <div class="cost-preview-item">
        <div class="cost-preview-label">Total Cost</div>
        <div class="cost-preview-value">${formatCurrency(totalCost)}</div>
      </div>
      <div class="cost-preview-item">
        <div class="cost-preview-label">Price</div>
        <div class="cost-preview-value">${price > 0 ? formatCurrency(price) : '—'}</div>
      </div>
      <div class="cost-preview-item">
        <div class="cost-preview-label">Profit</div>
        <div class="cost-preview-value" style="${profitNeg ? 'color:#dc2626;' : 'color:#16a34a;'}">
          ${price > 0 ? formatCurrency(profit) : '—'}
        </div>
      </div>
      <div class="cost-preview-item">
        <div class="cost-preview-label">Margin</div>
        <div class="cost-preview-value" style="${profitNeg ? 'color:#dc2626;' : 'color:#16a34a;'}">
          ${price > 0 ? margin.toFixed(1) + '%' : '—'}
        </div>
      </div>
    </div>
    ${(ingredientCost > 0 || packagingCost > 0) ? `
    <div style="display:flex;gap:16px;padding-top:10px;border-top:1px solid var(--border);">
      <div style="font-size:11px;color:var(--gray-500);">
        Ingredients: <span style="font-weight:700;">${formatCurrency(ingredientCost)}</span>
      </div>
      <div style="font-size:11px;color:var(--gray-500);">
        Packaging: <span style="font-weight:700;">${formatCurrency(packagingCost)}</span>
      </div>
    </div>

    ${(() => {
      const be = typeof calculateBreakEvenFromForm === 'function' ? calculateBreakEvenFromForm() : null;
      if (!be) return '';
      const batchYield      = be.batchYield || 1;
      const breakEvenUnits  = be.breakEvenUnits || 0;
      const pureProfitUnits = Math.max(0, batchYield - breakEvenUnits);
      const costBarPct      = be.hasBatchContext && batchYield > 0
        ? Math.min(100, Math.round((breakEvenUnits / batchYield) * 100)) : 0;
      const profitBarPct    = 100 - costBarPct;

      const _s  = function(css){ return 'style="'+css+'"'; };
      const sec = _s('margin-top:14px;padding:14px 16px;border-radius:12px;background:var(--gray-50);border:1.5px solid var(--border);');
      const ttl = _s('font-size:9px;letter-spacing:2px;text-transform:uppercase;font-weight:800;color:var(--gray-400);margin-bottom:12px;');
      const grd = _s('display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;');
      const crd = _s('background:var(--white);border-radius:8px;padding:12px 14px;border:1px solid var(--border);text-align:center;');
      const lbl = _s('font-size:10px;color:var(--gray-400);margin-bottom:4px;');
      const big = _s('font-size:28px;font-weight:900;line-height:1;');
      const grn = _s('font-size:28px;font-weight:900;line-height:1;color:#16a34a;');
      const sub = _s('font-size:11px;color:var(--gray-500);margin-top:2px;');
      const sg  = _s('font-size:11px;color:#16a34a;margin-top:2px;');

      if (!be.hasBatchContext) {
        return '<div '+sec+'>'
          + '<div '+ttl+'>Break-Even</div>'
          + '<div '+_s('font-size:12px;color:var(--gray-500);')+'>Set <strong>Batch Yield &gt; 1</strong> in the recipe section to see break-even per production run.</div>'
          + '</div>';
      }

      return '<div '+sec+'>'
        + '<div '+ttl+'>Break-Even</div>'
        + '<div '+grd+'>'
          + '<div '+crd+'>'
            + '<div '+lbl+'>Sell to break even</div>'
            + '<div '+big+'>'+breakEvenUnits+'</div>'
            + '<div '+sub+'>of '+batchYield+' units</div>'
          + '</div>'
          + '<div '+crd+'>'
            + '<div '+lbl+'>Pure profit units</div>'
            + '<div '+grn+'>'+pureProfitUnits+'</div>'
            + '<div '+sg+'>+'+formatCurrency(be.pureProfit)+' each</div>'
          + '</div>'
        + '</div>'
        + '<div '+_s('height:14px;display:flex;border-radius:999px;overflow:hidden;margin-bottom:6px;')+'>'
          + '<div '+_s('width:'+costBarPct+'%;background:#2563eb;height:100%;')+'></div>'
          + '<div '+_s('width:'+profitBarPct+'%;background:#bbf7d0;height:100%;')+'></div>'
        + '</div>'
        + '<div '+_s('display:flex;justify-content:space-between;font-size:10px;font-weight:700;')+'>'
          + '<span '+_s('color:#2563eb;')+'>'+breakEvenUnits+' cost recovery</span>'
          + '<span '+_s('color:#16a34a;')+'>'+pureProfitUnits+' pure profit</span>'
        + '</div>'
        + '</div>';
    })()}` : ''}`;
}

/* ═══════════════════════════════════════════════════════
   PRODUCT TEMPLATES
   Preset base configurations per category.
   Templates are starting points — all fields editable.
═══════════════════════════════════════════════════════ */

const PRODUCT_TEMPLATES = {
  'Cookies': [
    {
      label: 'Classic Cookie',
      icon: '',
      data: { price: 65, stock: 24, reorderLevel: 6, recipeMode: 'batch', batchYield: 12,
              variantType: 'quantity',
              variants: [
                { name: 'Single',   price: 65,  multiplier: 1 },
                { name: 'Box of 4', price: 240, multiplier: 4 },
                { name: 'Box of 6', price: 350, multiplier: 6 }
              ]}
    },
    {
      label: 'Chewy Cookie',
      icon: '',
      data: { price: 85, stock: 24, reorderLevel: 6, recipeMode: 'batch', batchYield: 12,
              variantType: 'quantity',
              variants: [
                { name: 'Single',    price: 85,  multiplier: 1  },
                { name: 'Box of 4',  price: 320, multiplier: 4  },
                { name: 'Box of 12', price: 900, multiplier: 12 }
              ]}
    }
  ],
  'Drinks': [
    {
      label: 'Iced Drink',
      icon: '',
      data: { price: 120, stock: 30, reorderLevel: 5, recipeMode: 'unit', batchYield: 1,
              variantType: 'size',
              variants: [
                { name: 'Small',  price: 100, multiplier: 1 },
                { name: 'Medium', price: 120, multiplier: 1 },
                { name: 'Large',  price: 150, multiplier: 1 }
              ]}
    },
    {
      label: 'Hot Drink',
      icon: '',
      data: { price: 100, stock: 30, reorderLevel: 5, recipeMode: 'unit', batchYield: 1,
              variantType: 'size',
              variants: [
                { name: 'Regular', price: 100, multiplier: 1 },
                { name: 'Large',   price: 130, multiplier: 1 }
              ]}
    }
  ],
  'Pastries': [
    {
      label: 'Slice / Piece',
      icon: '',
      data: { price: 95, stock: 12, reorderLevel: 3, recipeMode: 'unit', batchYield: 1,
              variants: [] }
    }
  ]
};

function getTemplatesForCategory(category) {
  if (!category) return [];
  // Exact match first, then partial
  const exact = PRODUCT_TEMPLATES[category];
  if (exact) return exact;
  const key = Object.keys(PRODUCT_TEMPLATES).find(k =>
    category.toLowerCase().includes(k.toLowerCase()) ||
    k.toLowerCase().includes(category.toLowerCase())
  );
  return key ? PRODUCT_TEMPLATES[key] : [];
}

function renderProductTemplates() {
  const container = document.getElementById('productTemplateRow');
  if (!container) return;

  const category  = document.getElementById('productCategory')?.value || '';
  const templates = getTemplatesForCategory(category);

  // Templates prefill the whole form — only offer them for NEW products,
  // never while editing (one tap would overwrite the product being edited).
  const isEditing = !!document.getElementById('productId')?.value;
  if (!templates.length || isEditing) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  const list = document.getElementById('productTemplateList');
  if (!list) return;

  list.innerHTML = templates.map((t, i) => `
    <button type="button" class="template-chip" data-template-index="${i}"
      title="Apply template: ${escapeHtml(t.label)}">
      ${escapeHtml(t.label)}
    </button>`).join('');

  list.querySelectorAll('.template-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx      = Number(btn.dataset.templateIndex);
      const template = templates[idx];
      if (!template) return;
      applyProductTemplate(template.data, category);
    });
  });
}

function applyProductTemplate(templateData, category) {
  // Only fill fields that aren't already filled — don't overwrite name
  if (!document.getElementById('productPrice')?.value)
    setElementValue('productPrice', templateData.price);
  if (!document.getElementById('productStock')?.value)
    setElementValue('productStock', templateData.stock);
  if (!document.getElementById('productReorderLevel')?.value)
    setElementValue('productReorderLevel', templateData.reorderLevel);
  if (!document.getElementById('productShelfLifeDays')?.value)
    setElementValue('productShelfLifeDays', templateData.shelfLifeDays);

  setElementValue('recipeMode',   templateData.recipeMode  || 'unit');
  setElementValue('batchYield',   templateData.batchYield  || 1);
  setElementValue('variantType',  templateData.variantType || 'custom');

  // Apply variants — clear existing first
  const vb = document.getElementById('variantBuilder');
  if (vb) vb.innerHTML = '';
  if (Array.isArray(templateData.variants)) {
    templateData.variants.forEach(v =>
      addVariantRow({ ...v, id: generateId() })
    );
  }

  renderProductCostPreview();
  showNotification('Template applied', 'success');
}

/* ═══════════════════════════════════════════════════════
   CLONE PRODUCT
   Copies all fields into a new product form.
   Prefixes name with "Copy of". New ID assigned.
═══════════════════════════════════════════════════════ */

function cloneProduct(productId) {
  const product = getProducts().find(p => String(p.id) === String(productId));
  if (!product) { showNotification('Product not found', 'error'); return; }

  clearProductForm();

  // Clear ID so it gets a new one on save
  setElementValue('productId', '');
  setElementValue('productName', `Copy of ${product.name}`);
  setElementValue('productPrice', product.price);
  setElementValue('productStock', _productStockForForm(product));
  setElementValue('productReorderLevel', product.reorderLevel);
  setElementValue('productShelfLifeDays', product.shelfLifeDays);
  setElementValue('recipeMode',  product.recipeMode  || 'unit');
  setElementValue('batchYield',  product.batchYield  || 1);
  setElementValue('variantType', product.variantType || 'custom');

  const catSelect = document.getElementById('productCategory');
  if (catSelect) catSelect.value = product.category;

  if (Array.isArray(product.variants))
    product.variants.forEach(v => addVariantRow({ ...v, id: generateId() }));

  if (Array.isArray(product.recipe)) {
    product.recipe.forEach(r => addRecipeRow(r, true));
  }

  if (typeof renderIngredientDropdowns === 'function') {
    renderIngredientDropdowns();
    document.querySelectorAll('#recipeBuilder .recipe-ingredient[data-wanted-ingredient]').forEach(el => {
      el.value = el.dataset.wantedIngredient;
      el.removeAttribute('data-wanted-ingredient');
    });
  }

  openModal('productModal');

  // Give modal paint cycle time, then render cost + templates
  setTimeout(() => {
    if (typeof renderProductTemplates   === 'function') renderProductTemplates();
    if (typeof renderProductCostPreview === 'function') renderProductCostPreview();
  }, 80);

  showNotification(`Cloning "${product.name}" — edit and save`, 'info');
}

window.renderProductCostPreview = renderProductCostPreview;
window.renderProductTemplates   = renderProductTemplates;
window.applyProductTemplate     = applyProductTemplate;
window.cloneProduct             = cloneProduct;

/* ── Category tabs + order type tabs ── */
function setActiveCategory(category = 'All') {
  updateState('ui', current => ({ ...current, activeCategory: category }));
  renderCategoryTabs();
  renderPOSProducts();
}

function setOrderType(type) {
  updateState('ui', current => ({ ...current, orderType: type }));
  renderOrderTypeTabs();
}

function renderOrderTypeTabs() {
  const container = document.getElementById('orderTypeTabs');
  if (!container) return;

  const coffeeCartOn = APP_STATE.settings?.coffeeCartModeEnabled === true;

  if (coffeeCartOn) {
    // Coffee Cart Mode: show channels instead of order types
    // Hide the old separate channel container
    const chanSel = document.getElementById('channelSelectorContainer');
    if (chanSel) chanSel.style.display = 'none';

    const current = APP_STATE.ui?.activeChannel || APP_STATE.ui?.orderType || 'Dine In';
    const channels = Object.keys(typeof CART_CHANNELS !== 'undefined' ? CART_CHANNELS : {});
    const available = channels.length
      ? channels
      : ['Dine In', 'Take Out', 'Delivery'];

    container.innerHTML = available.map(ch => `
      <button type="button" class="order-type-btn${current === ch ? ' active' : ''}"
        data-action="set-channel" data-channel="${escapeHtml(ch)}">${escapeHtml(ch)}</button>`
    ).join('');
  } else {
    // Normal mode: show order types
    const chanSel = document.getElementById('channelSelectorContainer');
    if (chanSel) chanSel.style.display = 'none';

    const types   = APP_STATE.settings?.orderTypes || ['Dine In', 'Take Out', 'Delivery'];
    const current = APP_STATE.ui?.orderType || 'Dine In';
    container.innerHTML = types.map(t => `
      <button type="button" class="order-type-btn${current === t ? ' active' : ''}"
        data-action="set-order-type" data-type="${escapeHtml(t)}">${escapeHtml(t)}</button>`
    ).join('');
  }
}

function renderCategoryTabs() {
  const container = document.getElementById('categoryTabs');
  if (!container) return;
  const categories = Array.isArray(APP_STATE.categories) ? APP_STATE.categories : [];
  const active = APP_STATE.ui?.activeCategory || 'All';
  container.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.textContent = 'All';
  allBtn.dataset.action = 'filter-category';
  allBtn.dataset.category = 'All';
  if (active === 'All') allBtn.classList.add('active');
  container.appendChild(allBtn);

  categories.forEach(cat => {
    const catName = typeof cat === 'object' ? cat.name : cat;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = catName;
    btn.dataset.action = 'filter-category';
    btn.dataset.category = catName;
    if (String(active) === String(catName)) btn.classList.add('active');
    container.appendChild(btn);
  });
}

window.setActiveCategory    = setActiveCategory;
window.setOrderType         = setOrderType;
window.renderCategoryTabs   = renderCategoryTabs;
window.renderOrderTypeTabs  = renderOrderTypeTabs;

/* ── Variant / Recipe / Packaging form builders ── */
function addVariantRow(variant = null) {
  const container = document.getElementById('variantBuilder');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'variant-row';
  row.dataset.variantId = variant?.id || generateId();
  row.innerHTML = `
    <input type="text"   class="variant-name"       placeholder="Name"       value="${escapeHtml(variant?.name || '')}">
    <input type="number" class="variant-price"      placeholder="Price"      value="${variant?.price || ''}">
    <input type="number" class="variant-multiplier" placeholder="Multiplier" value="${variant?.multiplier || 1}">
    <button type="button" class="btn btn-sm btn-secondary remove-variant-btn">✕</button>`;
  row.querySelector('.remove-variant-btn').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function addPackagingRow(pkg = null) {
  const container = document.getElementById('packagingBuilder');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'packaging-row';
  row.dataset.pkgId = pkg?.id || generateId();
  row.innerHTML = `
    <input type="text"   class="packaging-name" placeholder="e.g. Cookie Box, Sticker, Paper Bag"
      value="${escapeHtml(pkg?.name || '')}"
      style="flex:2;padding:7px 10px;border:1px solid var(--border);
        border-radius:var(--radius-md);font-family:var(--font-main);font-size:12px;" />
    <input type="number" class="packaging-cost" placeholder="Cost"
      value="${pkg?.cost || ''}" min="0" step="0.01"
      style="width:110px;padding:7px 10px;border:1px solid var(--border);
        border-radius:var(--radius-md);font-family:var(--font-main);font-size:12px;" />
    <button type="button" class="btn btn-sm btn-secondary remove-packaging-btn">✕</button>`;
  row.querySelector('.remove-packaging-btn').addEventListener('click', () => {
    row.remove();
    if (typeof renderProductCostPreview === 'function') renderProductCostPreview();
  });
  row.querySelector('.packaging-name')?.addEventListener('input', () => {
    if (typeof renderProductCostPreview === 'function') renderProductCostPreview();
  });
  row.querySelector('.packaging-cost')?.addEventListener('input', () => {
    if (typeof renderProductCostPreview === 'function') renderProductCostPreview();
  });
  container.appendChild(row);
  if (typeof renderProductCostPreview === 'function') {
    requestAnimationFrame(() => renderProductCostPreview());
  }
}

function addRecipeRow(recipe = null, skipDropdownRebuild = false) {
  const container = document.getElementById('recipeBuilder');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'recipe-row';
  row.innerHTML = `
    <select class="recipe-ingredient"></select>
    <input type="number" class="recipe-qty" placeholder="Qty" value="${recipe?.quantity || ''}">
    <button type="button" class="btn btn-sm btn-secondary remove-recipe-btn">✕</button>`;
  row.querySelector('.remove-recipe-btn').addEventListener('click', () => {
    row.remove();
    if (typeof renderProductCostPreview === 'function') renderProductCostPreview();
  });
  row.querySelector('.recipe-ingredient')?.addEventListener('change', () => {
    if (typeof renderProductCostPreview === 'function') renderProductCostPreview();
  });
  row.querySelector('.recipe-qty')?.addEventListener('input', () => {
    if (typeof renderProductCostPreview === 'function') renderProductCostPreview();
  });

  container.appendChild(row);

  if (skipDropdownRebuild) {
    if (recipe?.ingredientId) {
      row.querySelector('.recipe-ingredient').dataset.wantedIngredient = recipe.ingredientId;
    }
    return;
  }

  renderIngredientDropdowns();
  if (recipe?.ingredientId) {
    row.querySelector('.recipe-ingredient').value = recipe.ingredientId;
  }
  if (typeof renderProductCostPreview === 'function') {
    requestAnimationFrame(() => renderProductCostPreview());
  }
}

/* ── Variant selector modal ── */
function openVariantSelector(productId) {
  const product = getProducts().find(p => String(p.id) === String(productId));
  if (!product || !Array.isArray(product.variants) || !product.variants.length) return;

  const container = document.getElementById('variantOptions');
  if (!container) return;

  const title = document.getElementById('variantModalTitle');
  if (title) title.textContent = product.name;

  container.innerHTML = '';
  product.variants.forEach(variant => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'variant-option';
    option.dataset.action = 'add-to-cart-variant';
    option.dataset.productId = product.id;
    option.dataset.variantId = variant.id;
    option.innerHTML = `
      <div class="variant-option-name">${escapeHtml(variant.name)}</div>
      <div class="variant-option-price">${formatCurrency(variant.price)}</div>`;
    container.appendChild(option);
  });
  openModal('variantModal');
}

window.addVariantRow       = addVariantRow;
window.addRecipeRow        = addRecipeRow;
window.addPackagingRow     = addPackagingRow;
window.openVariantSelector = openVariantSelector;
