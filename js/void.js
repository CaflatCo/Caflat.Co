/* ═══════════════════════════════════════════════════════
   VOID.JS — Void/Refund system
   Admin only. 6-digit PIN. Reason required.
   Full audit trail on every attempt.
═══════════════════════════════════════════════════════ */

/* ── Audit log ── */
function pushAuditEntry(entry) {
  const log = Array.isArray(APP_STATE.auditLog) ? APP_STATE.auditLog : [];
  log.push({
    id: generateId(),
    timestamp: new Date().toISOString(),
    role: APP_STATE.currentUserRole || 'UNKNOWN',
    ...entry
  });
  updateState('auditLog', () => log);
}

/* ── PIN validation ──
   Prefers the hashed settings.voidPinHash; falls back to legacy plaintext
   settings.voidPin (defaulting to '000000') for installs that haven't saved
   a PIN through the new hashing path yet. On a successful legacy match, the
   PIN is opportunistically re-hashed and the plaintext copy is cleared. */
async function validateVoidPin(enteredPin) {
  const pin = String(enteredPin).trim();
  const stored = APP_STATE.settings?.voidPinHash;

  if (stored) {
    return verifySecret(pin, stored);
  }

  const legacyPin = String(APP_STATE.settings?.voidPin || '000000');
  const match = pin === legacyPin;
  if (match) {
    const voidPinHash = await hashSecret(pin);
    updateState('settings', current => {
      const next = { ...current, voidPinHash };
      delete next.voidPin;
      return next;
    });
  }
  return match;
}

/* ── PIN attempt lockout ── (mirrors the login lockout in js/auth.js) */
const VOID_PIN_LOCKOUT_KEY   = 'caflat_voidpin_lockout';
const VOID_PIN_FREE_ATTEMPTS = 4;
const VOID_PIN_MAX_LOCK_MS   = 10 * 60 * 1000;

function _getVoidPinLockout() {
  try { return JSON.parse(localStorage.getItem(VOID_PIN_LOCKOUT_KEY)) || { count: 0, lockedUntil: 0 }; }
  catch { return { count: 0, lockedUntil: 0 }; }
}
function _recordFailedVoidPin() {
  const state = _getVoidPinLockout();
  state.count += 1;
  if (state.count > VOID_PIN_FREE_ATTEMPTS) {
    const overBy = state.count - VOID_PIN_FREE_ATTEMPTS;
    state.lockedUntil = Date.now() + Math.min(VOID_PIN_MAX_LOCK_MS, 1000 * Math.pow(2, overBy));
  }
  localStorage.setItem(VOID_PIN_LOCKOUT_KEY, JSON.stringify(state));
}
function _resetVoidPinLockout() { localStorage.removeItem(VOID_PIN_LOCKOUT_KEY); }
function _voidPinLockRemainingMs() { return Math.max(0, (_getVoidPinLockout().lockedUntil || 0) - Date.now()); }

/* ── Open void modal ── */
function openVoidModal(saleId) {
  // Role check
  if ((APP_STATE.currentUserRole || '').toUpperCase() !== 'ADMIN') {
    showNotification('Void requires Admin access', 'error');
    pushAuditEntry({
      action: 'VOID_REJECTED',
      reason: 'Insufficient role',
      saleId,
      outcome: 'DENIED'
    });
    return;
  }

  const sale = getSales().find(s => String(s.id) === String(saleId));
  if (!sale) { showNotification('Sale not found', 'error'); return; }

  if ((sale.status || '').toUpperCase() === 'VOIDED') {
    showNotification('Sale is already voided', 'error');
    return;
  }

  if ((sale.status || '').toUpperCase() !== 'COMPLETED') {
    showNotification('Only completed sales can be voided', 'error');
    return;
  }

  // Populate modal
  const el = id => document.getElementById(id);
  if (el('voidSaleId'))     el('voidSaleId').value     = saleId;
  if (el('voidReceiptNum')) el('voidReceiptNum').textContent = sale.receiptNumber || sale.id;
  if (el('voidSaleTotal'))  el('voidSaleTotal').textContent  = formatCurrency(sale.totals?.total ?? sale.total ?? 0);
  if (el('voidSaleDate')) {
    const d = new Date(sale.audit?.completedAt || sale.completedAt || sale.createdAt);
    el('voidSaleDate').textContent = d.toLocaleString();
  }
  if (el('voidReason'))  el('voidReason').value  = '';
  if (el('voidPin'))     el('voidPin').value      = '';
  if (el('voidPinDots')) renderPinDots('');

  openModal('voidModal');
  setTimeout(() => el('voidReason')?.focus(), 100);
}

/* ── PIN dot display ── */
function renderPinDots(value) {
  const container = document.getElementById('voidPinDots');
  if (!container) return;
  const len = Math.min(String(value).length, 6);
  container.innerHTML = Array.from({ length: 6 }, (_, i) =>
    `<div class="pin-dot${i < len ? ' filled' : ''}"></div>`
  ).join('');
}

/* ── Confirm void ── */
async function confirmVoid() {
  const el = id => document.getElementById(id);

  const saleId = el('voidSaleId')?.value;
  const reason = String(el('voidReason')?.value || '').trim();
  const pin    = String(el('voidPin')?.value    || '').trim();

  // Validations
  if (!reason) {
    showNotification('Void reason is required', 'error');
    el('voidReason')?.focus();
    return;
  }

  if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
    showNotification('PIN must be exactly 6 digits', 'error');
    el('voidPin')?.focus();
    return;
  }

  const remainingMs = _voidPinLockRemainingMs();
  if (remainingMs > 0) {
    const secs = Math.ceil(remainingMs / 1000);
    showNotification(`Too many failed PIN attempts. Try again in ${secs >= 60 ? Math.ceil(secs / 60) + ' min' : secs + 's'}.`, 'error');
    return;
  }

  // PIN check
  if (!(await validateVoidPin(pin))) {
    _recordFailedVoidPin();
    pushAuditEntry({
      action: 'VOID_PIN_FAILED',
      saleId,
      reason,
      outcome: 'DENIED',
      note: 'Incorrect PIN entered'
    });
    showNotification('Incorrect PIN — void rejected', 'error');
    el('voidPin').value = '';
    renderPinDots('');
    el('voidPin')?.focus();
    return;
  }

  _resetVoidPinLockout();

  // Execute void
  executeVoid(saleId, reason);
}

async function executeVoid(saleId, reason) {
  const sales = getSales();
  const sale  = sales.find(s => String(s.id) === String(saleId));
  if (!sale) return;

  const timestamp = new Date().toISOString();

  // Lock the sale as VOIDED
  sale.status        = 'VOIDED';
  sale.paymentStatus = 'VOIDED';
  sale.void = {
    reason,
    voidedAt:  timestamp,
    voidedBy:  APP_STATE.currentUserRole || 'ADMIN',
    receiptNumber: sale.receiptNumber
  };
  sale.audit = sale.audit || {};
  sale.audit.voidedAt = timestamp;
  sale.audit.voidedBy = APP_STATE.currentUserRole || 'ADMIN';

  // Re-seal — the integrity hash covers status, so it must be recomputed
  // after this legitimate transition or verifyTransaction() will flag it
  // as tampered (HASH_MISMATCH) even though the void was authorized.
  if (typeof sealTransaction === 'function') {
    await sealTransaction(sale);
  }

  updateState('sales', () => sales);

  // Restore product stock
  restoreProductStockForSale(sale);

  // Restore ingredient stock
  restoreIngredientStockForSale(sale);

  // Audit entry
  pushAuditEntry({
    action:        'VOID_COMPLETED',
    saleId:        sale.id,
    receiptNumber: sale.receiptNumber,
    total:         sale.totals?.total ?? sale.total ?? 0,
    reason,
    outcome:       'SUCCESS',
    stockRestored: true
  });

  closeModal('voidModal');
  renderSalesTable();
  if (typeof refreshEventBreakEven === 'function') refreshEventBreakEven();
  if (typeof refreshDashboard === 'function') refreshDashboard();
  showNotification(`Sale ${sale.receiptNumber} voided — stock restored`, 'success');
}

/* ── Stock restoration ── */
function restoreProductStockForSale(sale) {
  const updatedProducts = (APP_STATE.products || []).map(product => {
    // FG-mode products restore via the FG ledger in restoreIngredientStockForSale below —
    // never touch product.stock for these, it isn't the source of truth.
    if (typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(product)) {
      return product;
    }
    const restoreUnits = (sale.items || []).reduce((sum, line) => {
      if (String(line.productId) !== String(product.id)) return sum;
      return sum + Number(line.quantity || 0) * Number(line.multiplier || 1);
    }, 0);
    if (!restoreUnits) return product;
    return { ...product, stock: Number(product.stock || 0) + restoreUnits };
  });
  updateState('products', () => updatedProducts);
}

function restoreIngredientStockForSale(sale) {
  const ingredientReturns = new Map();

  let hasFGItems = false;
  (sale.items || []).forEach(line => {
    const product = (APP_STATE.products || []).find(p => String(p.id) === String(line.productId));
    if (!product || !Array.isArray(product.recipe)) return;

    // FG-mode products: restore finished goods stock, not ingredients
    if (typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(product)) {
      hasFGItems = true;
      return; // Ingredients were consumed at production — don't restore them on void
    }

    const batchYield  = Math.max(1, Number(product.batchYield || 1));
    const recipeMode  = String(product.recipeMode || 'unit');
    const lineUnits   = Number(line.quantity || 0) * Number(line.multiplier || 1);

    product.recipe.forEach(recipeItem => {
      const perRecipe     = Number(recipeItem.quantity || 0);
      const perUnit       = recipeMode === 'batch' ? perRecipe / batchYield : perRecipe;
      const restoreQty    = perUnit * lineUnits;
      const key           = recipeItem.ingredientId;
      ingredientReturns.set(key, (ingredientReturns.get(key) || 0) + restoreQty);
    });
  });

  // Restore FG stock for finished goods products
  if (hasFGItems && typeof _setFGRecord === 'function') {
    (sale.items || []).forEach(line => {
      const product = (APP_STATE.products || []).find(p => String(p.id) === String(line.productId));
      if (!product || !(typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(product))) return;
      const units = Number(line.quantity || 0) * Number(line.multiplier || 1);
      _setFGRecord(product.id, product.name, units, 0,
        `Void restored: ${sale.receiptNumber}`, 'void-restore');
    });
  }

  if (!ingredientReturns.size) return;

  const updatedIngredients = (APP_STATE.ingredients || []).map(ingredient => {
    const restoreQty = ingredientReturns.get(ingredient.id);
    if (!restoreQty) return ingredient;
    return { ...ingredient, stock: Number(ingredient.stock || 0) + restoreQty };
  });

  updateState('ingredients', () => updatedIngredients);

  // Log each ingredient restoration
  const movements = Array.isArray(APP_STATE.inventoryMovements) ? APP_STATE.inventoryMovements : [];
  ingredientReturns.forEach((qty, ingredientId) => {
    const ingredient = (APP_STATE.ingredients || []).find(i => String(i.id) === String(ingredientId));
    if (!ingredient) return;
    movements.push({
      id: generateId(),
      ingredientId,
      ingredientName: ingredient.name,
      type: 'void-restoration',
      quantityAdded: qty,
      quantityUsed: 0,
      reason: `Void: ${sale.receiptNumber}`,
      previousStock: Number(ingredient.stock || 0) - qty,
      newStock: Number(ingredient.stock || 0),
      createdAt: new Date().toISOString(),
      createdBy: APP_STATE.currentUserRole || 'ADMIN'
    });
  });
  updateState('inventoryMovements', () => movements);
}

/* ── Audit log viewer ── */
function renderAuditLog() {
  const tbody = document.querySelector('#auditLogTable tbody');
  if (!tbody) return;

  const log   = Array.isArray(APP_STATE.auditLog) ? APP_STATE.auditLog : [];
  const limit = window.auditLimit || 20;
  tbody.innerHTML = '';

  if (!log.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No audit entries yet</td></tr>`;
    return;
  }

  log.slice().reverse().slice(0, limit).forEach(entry => {
    const date = new Date(entry.timestamp);
    const outcomeClass = entry.outcome === 'SUCCESS'  ? 'badge-ok'
                       : entry.outcome === 'DENIED'   ? 'badge-refunded'
                       : entry.outcome === 'TAMPERED' ? 'badge-sold-out'
                       : 'badge-low-stock';

    const ref = entry.receiptNumber || entry.invoiceNumber || entry.saleId
             || entry.referenceId   || '—';

    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="white-space:nowrap;font-size:11px;">
        ${date.toLocaleDateString()} ${date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
      </td>
      <td style="font-family:var(--font-mono);font-size:10px;font-weight:700;">
        ${escapeHtml(entry.action || '')}
      </td>
      <td style="font-size:11px;">${escapeHtml(ref)}</td>
      <td style="font-size:11px;">${escapeHtml(entry.role || entry.by || '—')}</td>
      <td style="font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
        title="${escapeHtml(entry.note || entry.reason || entry.details || '')}">
        ${escapeHtml(entry.note || entry.reason || entry.details || '—')}
      </td>
      <td><span class="${outcomeClass}">${escapeHtml(entry.outcome || '—')}</span></td>`;
    tbody.appendChild(row);
  });

  // See more (5 default, +5 on expand)
  if (typeof _renderSeeMore === 'function') {
    _renderSeeMore(
      'auditSeeMore', log.length, limit,
      () => { window.auditLimit = (window.auditLimit || 20) + 20; renderAuditLog(); },
      () => { window.auditLimit = 20; renderAuditLog(); }
    );
  }
}

window.openVoidModal    = openVoidModal;
window.confirmVoid      = confirmVoid;
window.executeVoid      = executeVoid;
window.renderPinDots    = renderPinDots;
window.renderAuditLog   = renderAuditLog;
window.pushAuditEntry   = pushAuditEntry;
