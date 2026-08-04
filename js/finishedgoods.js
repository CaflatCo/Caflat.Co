/* ═══════════════════════════════════════════════════════
   FINISHEDGOODS.JS — Finished Goods Inventory
   Per-category mode: 'finished_goods' | 'direct'
   
   FG Mode flow:
     Production DONE  → credit finishedGoods stock
     POS Sale         → deduct finishedGoods stock (not ingredients)
     Supply ORDERED   → reserve finishedGoods stock
     Supply PAID      → deduct finishedGoods stock
     Adjustment       → spoilage/disposal/correction
     
   Direct Mode (default):
     POS Sale         → deduct ingredients (as today, unchanged)
═══════════════════════════════════════════════════════ */

/* ── Getters ── */
function getFinishedGoods() {
  return Array.isArray(APP_STATE.finishedGoods) ? APP_STATE.finishedGoods : [];
}

function getFGMovements() {
  return Array.isArray(APP_STATE.fgMovements) ? APP_STATE.fgMovements : [];
}

function getFGRecord(productId) {
  return getFinishedGoods().find(r => String(r.productId) === String(productId)) || null;
}

function getFGStock(productId) {
  const rec = getFGRecord(productId);
  return rec ? Number(rec.stock || 0) : 0;
}

function getFGReserved(productId) {
  const rec = getFGRecord(productId);
  return rec ? Number(rec.reserved || 0) : 0;
}

function getFGAvailable(productId) {
  return Math.max(0, getFGStock(productId) - getFGReserved(productId));
}

/* ── Shared stock accessor: routes to FG ledger for finished_goods-category
   products, or the plain product.stock field for direct-mode products.
   Use this everywhere stock is displayed, validated, or deducted in POS. ── */
function getEffectiveStock(product) {
  if (!product) return 0;
  if (typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(product)) {
    return getFGAvailable(product.id);
  }
  return Number(product.stock || 0);
}

/* ── Core write ── */
function _setFGRecord(productId, productName, delta, reservedDelta, reason, type) {
  const goods = getFinishedGoods();
  const idx   = goods.findIndex(r => String(r.productId) === String(productId));
  const prev  = idx >= 0 ? goods[idx] : { productId, productName, stock: 0, reserved: 0 };
  const newStock    = Math.max(0, Number(prev.stock    || 0) + delta);
  const newReserved = Math.max(0, Number(prev.reserved || 0) + reservedDelta);
  const updated     = { ...prev, productId, productName, stock: newStock, reserved: newReserved, updatedAt: new Date().toISOString() };

  if (idx >= 0) goods[idx] = updated;
  else          goods.push(updated);

  updateState('finishedGoods', () => goods);

  // Log movement
  const movements = getFGMovements();
  movements.push({
    id:          generateId(),
    productId,
    productName,
    type,
    delta,
    reservedDelta,
    stockBefore:    Number(prev.stock    || 0),
    stockAfter:     newStock,
    reservedBefore: Number(prev.reserved || 0),
    reservedAfter:  newReserved,
    reason,
    createdAt:   new Date().toISOString(),
    createdBy:   APP_STATE.currentUserRole || 'STAFF'
  });
  updateState('fgMovements', () => movements);
}

/* ── Production credits finished goods on Done ── */
function creditFinishedGoods(productId, productName, qty, jobName) {
  _setFGRecord(productId, productName, qty, 0,
    'Production: ' + (jobName || 'Production run'), 'production-credit');
  if (typeof renderFinishedGoodsTable === 'function') renderFinishedGoodsTable();
}

/* ── POS deducts finished goods (FG mode only) ── */
function deductFGForCart(cart) {
  cart.forEach(line => {
    const product = (APP_STATE.products || []).find(p => String(p.id) === String(line.productId));
    if (!product) return;
    if (!isFinishedGoodsProduct(product)) return; // direct mode — skip
    const qty = Number(line.quantity || 0) * Number(line.multiplier || 1);
    _setFGRecord(product.id, product.name, -qty, 0,
      'POS Sale', 'sale-deduction');
  });
  if (typeof renderFinishedGoodsTable === 'function') renderFinishedGoodsTable();
}

/* ── Supply — reserve and deduct finished goods ──
   These take a supply ORDER, whose line items carry `qty` (see
   _supplyItemsToCart, which maps item.qty -> cart.quantity). Reading
   `item.quantity` here therefore resolved to undefined and every amount
   computed to 0, so delivering a supply order logged a movement but never
   moved any finished-goods stock — the goods left the building and the count
   stayed put. Cart-shaped objects use `quantity`, so accept either. */
function _fgLineQty(item) {
  return Number(item.qty ?? item.quantity ?? 0) || 0;
}

function reserveFGForSupply(order) {
  (order.items || []).forEach(item => {
    const product = (APP_STATE.products || []).find(p => String(p.id) === String(item.productId));
    if (!product || !isFinishedGoodsProduct(product)) return;
    const qty = _fgLineQty(item);
    if (!qty) return;
    _setFGRecord(product.id, product.name, 0, qty,
      'Supply reserved: ' + (order.clientName || order.id), 'supply-reserve');
  });
  if (typeof renderFinishedGoodsTable === 'function') renderFinishedGoodsTable();
}

function deductFGForSupply(order) {
  (order.items || []).forEach(item => {
    const product = (APP_STATE.products || []).find(p => String(p.id) === String(item.productId));
    if (!product || !isFinishedGoodsProduct(product)) return;
    const qty = _fgLineQty(item);
    if (!qty) return;
    // Remove stock and release the reservation simultaneously
    _setFGRecord(product.id, product.name, -qty, -qty,
      'Supply delivered: ' + (order.clientName || order.id), 'supply-deduction');
  });
  if (typeof renderFinishedGoodsTable === 'function') renderFinishedGoodsTable();
}

/* Inverse of deductFGForSupply — puts delivered goods back on the shelf when a
   supply order is cancelled, voided, or moved back before DELIVERED. Only the
   stock side is restored: the delivery already zeroed the reservation, so
   adding reserved back here would hold stock against an order that no longer
   exists. */
function restoreFGForSupply(order) {
  (order.items || []).forEach(item => {
    const product = (APP_STATE.products || []).find(p => String(p.id) === String(item.productId));
    if (!product || !isFinishedGoodsProduct(product)) return;
    const qty = _fgLineQty(item);
    if (!qty) return;
    _setFGRecord(product.id, product.name, qty, 0,
      'Supply restored: ' + (order.clientName || order.id), 'supply-restore');
  });
  if (typeof renderFinishedGoodsTable === 'function') renderFinishedGoodsTable();
}

function releaseFGReserveForSupply(order) {
  (order.items || []).forEach(item => {
    const product = (APP_STATE.products || []).find(p => String(p.id) === String(item.productId));
    if (!product || !isFinishedGoodsProduct(product)) return;
    const qty = _fgLineQty(item);
    if (!qty) return;
    _setFGRecord(product.id, product.name, 0, -qty,
      'Supply cancelled: ' + (order.clientName || order.id), 'supply-reserve-release');
  });
  if (typeof renderFinishedGoodsTable === 'function') renderFinishedGoodsTable();
}

/* ── Adjustments (spoilage, disposal, correction) ── */
const FG_ADJUSTMENT_TYPES = ['Spoiled','Disposed','Expired','Damaged','Correction','Other'];

function openFGAdjustmentModal(productId) {
  const product = (APP_STATE.products || []).find(p => String(p.id) === String(productId));
  if (!product) return;
  const rec = getFGRecord(productId);

  setElementValue('fgAdjProductId',   productId);
  setElementValue('fgAdjProductName', product.name);
  setElementValue('fgAdjCurrent',     getFGStock(productId) + ' units');
  setElementValue('fgAdjType',        'Spoiled');
  setElementValue('fgAdjQty',         '');
  setElementValue('fgAdjReason',      '');

  openModal('fgAdjustmentModal');
}

function saveFGAdjustment() {
  const productId   = getElementValue('fgAdjProductId');
  const productName = getElementValue('fgAdjProductName');
  const type        = getElementValue('fgAdjType') || 'Spoiled';
  const qty         = safeNumber(getElementValue('fgAdjQty'));
  const reason      = sanitizeText(getElementValue('fgAdjReason')) || type;

  if (!productId) { showNotification('No product selected', 'error'); return; }
  if (!qty)       { showNotification('Enter quantity', 'error'); return; }

  const delta = type === 'Correction' ? qty : -Math.abs(qty);
  _setFGRecord(productId, productName, delta, 0,
    type + (reason ? ': ' + reason : ''), 'adjustment');

  closeModal('fgAdjustmentModal');
  renderFinishedGoodsTable();
  if (typeof renderFGMovementLog === 'function') renderFGMovementLog();
  showNotification('Adjustment saved', 'success');
}

/* ════════════════════════════════════════════════════════
   INVENTORY VIEWS
════════════════════════════════════════════════════════ */

function renderFinishedGoodsTable() {
  const container = document.getElementById('fgInventoryContainer');
  if (!container) return;

  // Only show FG-mode products
  const fgProducts = (APP_STATE.products || []).filter(p => isFinishedGoodsProduct(p));

  if (!fgProducts.length) {
    container.innerHTML = `<div class="empty-state">
      No products in Finished Goods mode yet.<br>
      <span style="font-size:12px;color:var(--gray-400);">
        Switch a category to Finished Goods mode in Settings → Categories.
      </span>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Category</th>
            <th>Stock</th>
            <th>Reserved</th>
            <th>Available</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${fgProducts.map(p => {
            const stock     = getFGStock(p.id);
            const reserved  = getFGReserved(p.id);
            const available = getFGAvailable(p.id);
            const reorder   = Number(p.reorderLevel || 0);
            const low       = available <= reorder;
            const soldOut   = available <= 0;
            const statusBadge = soldOut
              ? '<span class="badge-sold-out">Sold Out</span>'
              : low
                ? '<span class="badge-low-stock">Low Stock</span>'
                : '<span class="badge dark">OK</span>';

            return `
              <tr ${soldOut ? 'class="low-stock-row"' : ''}>
                <td style="font-weight:700;">${escapeHtml(p.name)}</td>
                <td>${escapeHtml(p.category)}</td>
                <td style="font-variant-numeric:tabular-nums;">${round2(stock)}</td>
                <td style="font-variant-numeric:tabular-nums;color:${reserved>0?'#ea580c':'var(--gray-400)'};">
                  ${reserved > 0 ? round2(reserved) : '—'}
                </td>
                <td style="font-variant-numeric:tabular-nums;font-weight:800;">
                  ${available}
                </td>
                <td>${statusBadge}</td>
                <td>
                  <div class="table-actions">
                    <button class="btn btn-sm btn-secondary"
                      data-action="open-fg-adjustment" data-id="${p.id}">Adjust</button>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ── Inventory Movement Log (both raw + FG) ── */
function renderFGMovementLog(limit) {
  const ingFilterEl  = document.getElementById('movementLogIngredientFilter');
  const typeFilterEl = document.getElementById('movementLogTypeFilter');
  if (ingFilterEl) {
    const current = ingFilterEl.value;
    ingFilterEl.innerHTML = '<option value="">All Ingredients</option>';
    (APP_STATE.ingredients || []).slice().sort((a,b) => (a.name||'').localeCompare(b.name||'')).forEach(ing => {
      const opt = document.createElement('option');
      opt.value = ing.id; opt.textContent = ing.name;
      if (ing.id === current) opt.selected = true;
      ingFilterEl.appendChild(opt);
    });
  }

  // Merge raw + FG movements, newest first
  const rawMovements = (APP_STATE.inventoryMovements || []).map(m => ({
    ...m, logType: 'raw', displayName: m.ingredientName || m.productName || m.description || ''
  }));
  const fgMovements = getFGMovements().map(m => ({
    ...m, logType: 'fg', displayName: m.productName || ''
  }));

  let all = [...rawMovements, ...fgMovements]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Apply filters
  const ingVal  = ingFilterEl?.value  || '';
  const typeVal = typeFilterEl?.value || '';
  if (ingVal)  all = all.filter(m => String(m.ingredientId || m.productId) === ingVal);
  if (typeVal) all = all.filter(m => m.type === typeVal);

  if (!all.length) {
    container.innerHTML = '<div class="empty-state" style="padding:24px 0;">No movements recorded yet.</div>';
    return;
  }

  const SHOW    = typeof limit === 'number' ? limit : 10;
  const total   = all.length;
  const shown   = all.slice(0, SHOW);
  const hasMore = total > SHOW;

  const typeLabels = {
    'restock':'Restock','sale-deduction':'Sale','production':'Production',
    'production-cancel':'Prod. Cancelled','manual-adjustment':'Manual',
    'pending-cancel-restoration':'Pending Cancel','pending-cancel-restore':'Pending Cancel',
    'supply-reservation':'Reserved','supply-delivery-deduction':'Supply Delivered',
    'supply-stock-restored':'Supply Restored','supply-reservation-released':'Rsv. Released',
    'void-restoration':'Void Restored','production-credit':'Produced',
    'supply-reserve':'Reserved','supply-deduction':'Supply Delivered',
    'supply-reserve-release':'Rsv. Released','adjustment':'Adjustment','void-restore':'Void Restored',
  };

  const badgeCss = (type) => {
    if (!type) return 'background:var(--gray-50);color:var(--gray-600);';
    if (type==='restock'||type==='production-credit'||type==='void-restore'||type==='void-restoration'||type==='supply-stock-restored') return 'background:#dcfce7;color:#15803d;';
    if (type==='sale-deduction') return 'background:#fef3c7;color:#92400e;';
    if (type.startsWith('supply-delivery')||type==='supply-deduction') return 'background:#eff6ff;color:#1d4ed8;';
    if (type.startsWith('supply-reserv')||type==='supply-reserve') return 'background:#f0f9ff;color:#0369a1;';
    if (type.startsWith('production')) return 'background:#faf5ff;color:#7e22ce;';
    if (type.includes('cancel')||type.includes('restoration')||type.includes('released')) return 'background:#fef2f2;color:#dc2626;';
    if (type==='manual-adjustment'||type==='adjustment') return 'background:#f8fafc;color:#475569;';
    return 'background:var(--gray-50);color:var(--gray-600);';
  };

  const rows = shown.map(m => {
    const isRaw  = m.logType === 'raw';
    const label  = typeLabels[m.type] || m.type || '—';
    const before = isRaw ? (m.previousStock ?? '—') : (m.stockBefore ?? '—');
    const after  = isRaw ? (m.newStock ?? '—') : (m.stockAfter ?? '—');
    let changeLabel, changeColor;
    if (isRaw) {
      const n = Number(m.quantityAdded||0) - Number(m.quantityUsed||0);
      changeLabel = n > 0 ? '+'+n.toFixed(2) : n === 0 ? '—' : n.toFixed(2);
      changeColor = n > 0 ? '#15803d' : n < 0 ? 'var(--danger)' : 'var(--gray-400)';
    } else {
      const d = Number(m.delta||0);
      changeLabel = d > 0 ? '+'+d : d === 0 ? '—' : String(d);
      changeColor = d > 0 ? '#15803d' : d < 0 ? 'var(--danger)' : 'var(--gray-400)';
    }
    const invBadge = isRaw
      ? '<span style="font-size:10px;padding:1px 6px;border-radius:999px;background:var(--gray-100);color:var(--gray-600);font-weight:700;">Raw</span>'
      : '<span style="font-size:10px;padding:1px 6px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-weight:700;">Finished</span>';
    const date = m.createdAt ? new Date(m.createdAt).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true}) : '—';
    return `<tr>
      <td style="font-size:11px;color:var(--gray-400);white-space:nowrap;">${date}</td>
      <td><span style="font-size:9px;font-weight:800;padding:2px 8px;border-radius:999px;white-space:nowrap;display:inline-block;${badgeCss(m.type)}">${label}</span></td>
      <td style="font-weight:700;">${escapeHtml(m.displayName||'—')}</td>
      <td>${invBadge}</td>
      <td style="font-variant-numeric:tabular-nums;font-weight:800;color:${changeColor};">${changeLabel}</td>
      <td style="font-variant-numeric:tabular-nums;color:var(--gray-500);">${before}</td>
      <td style="font-variant-numeric:tabular-nums;">${after}</td>
      <td style="font-size:11px;color:var(--gray-500);">${escapeHtml(m.reason||'—')}</td>
    </tr>`;
  }).join('');

  const btn = 'padding:7px 20px;border:1.5px solid var(--border);border-radius:var(--radius-full);background:var(--white);font-size:12px;font-weight:700;cursor:pointer;font-family:var(--font-main);';
  const footer = hasMore
    ? `<div style="text-align:center;padding:12px 0;"><button type="button" onclick="renderFGMovementLog(${SHOW+20})" style="${btn}">Show more <span style="color:var(--gray-400);font-weight:600;">(${total-SHOW} remaining)</span></button></div>`
    : SHOW > 10
      ? `<div style="text-align:center;padding:12px 0;"><button type="button" onclick="renderFGMovementLog(10)" style="${btn}">Show less</button></div>`
      : '';

  container.innerHTML = `<div class="table-wrapper"><table>
    <thead><tr><th>Date</th><th>Type</th><th>Item</th><th>Inventory</th><th>Change</th><th>Before</th><th>After</th><th>Reason</th></tr></thead>
    <tbody>${rows}</tbody></table></div>${footer}`;
}


/* ── Exports ── */
window._setFGRecord               = _setFGRecord;   // exposed for manual sync
window.getFinishedGoods           = getFinishedGoods;
window.getFGMovements             = getFGMovements;
window.getFGRecord                = getFGRecord;
window.getFGStock                 = getFGStock;
window.getFGAvailable             = getFGAvailable;
window.getEffectiveStock          = getEffectiveStock;
window.creditFinishedGoods        = creditFinishedGoods;
window.deductFGForCart            = deductFGForCart;
window.reserveFGForSupply         = reserveFGForSupply;
window.deductFGForSupply          = deductFGForSupply;
window.releaseFGReserveForSupply  = releaseFGReserveForSupply;
window.restoreFGForSupply         = restoreFGForSupply;
window.openFGAdjustmentModal      = openFGAdjustmentModal;
window.saveFGAdjustment           = saveFGAdjustment;
window.renderFinishedGoodsTable   = renderFinishedGoodsTable;
window.renderFGMovementLog        = renderFGMovementLog;
window.FG_ADJUSTMENT_TYPES        = FG_ADJUSTMENT_TYPES;
