/* ═══════════════════════════════════════════════════════
   REFUND.JS — Refund system
   Admin only. Reason required. Stock restored.
   Separate from void — both coexist independently.
   Refund = money returned. Void = sale never happened.
═══════════════════════════════════════════════════════ */

function openRefundModal(saleId) {
  if ((APP_STATE.currentUserRole || '').toUpperCase() !== 'ADMIN') {
    showNotification('Refund requires Admin access', 'error');
    if (typeof pushAuditEntry === 'function') {
      pushAuditEntry({
        action: 'REFUND_REJECTED', saleId,
        reason: 'Insufficient role', outcome: 'DENIED'
      });
    }
    return;
  }

  const sale = (APP_STATE.sales || []).find(s => String(s.id) === String(saleId));
  if (!sale) { showNotification('Sale not found', 'error'); return; }

  const status = (sale.status || '').toUpperCase();
  if (status === 'REFUNDED') {
    showNotification('Sale already refunded', 'error'); return;
  }
  if (status === 'VOIDED') {
    showNotification('Voided sales cannot be refunded', 'error'); return;
  }
  if (status === 'PENDING') {
    showNotification('Cancel pending orders instead of refunding', 'error'); return;
  }

  // Populate summary
  const el = id => document.getElementById(id);
  if (el('refundSaleId'))    el('refundSaleId').value          = saleId;
  if (el('refundReceiptNum'))el('refundReceiptNum').textContent = sale.receiptNumber || sale.id;
  if (el('refundSaleTotal')) el('refundSaleTotal').textContent  =
    formatCurrency(sale.totals?.total ?? sale.total ?? 0);
  if (el('refundSaleDate')) {
    const d = new Date(sale.audit?.completedAt || sale.completedAt || sale.createdAt);
    el('refundSaleDate').textContent = d.toLocaleString();
  }

  // Items list
  const itemsEl = el('refundItemsSummary');
  if (itemsEl && Array.isArray(sale.items)) {
    itemsEl.innerHTML = sale.items.map(item => `
      <div style="display:flex;justify-content:space-between;align-items:center;
        padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;">
        <span>
          <span style="font-weight:700;">${escapeHtml(item.name)}</span>
          <span style="color:var(--gray-400);"> ×${item.quantity}</span>
        </span>
        <span style="font-weight:700;">${formatCurrency(
          item.total ?? (Number(item.price||0) * Number(item.quantity||0))
        )}</span>
      </div>`).join('');
  }

  if (el('refundReason')) el('refundReason').value = '';
  openModal('refundModal');
  setTimeout(() => el('refundReason')?.focus(), 100);
}

async function confirmRefund() {
  const saleId = document.getElementById('refundSaleId')?.value || '';
  const reason = String(document.getElementById('refundReason')?.value || '').trim();

  if (!reason) {
    showNotification('Refund reason is required', 'error');
    document.getElementById('refundReason')?.focus();
    return;
  }

  const sales = Array.isArray(APP_STATE.sales) ? APP_STATE.sales : [];
  const sale  = sales.find(s => String(s.id) === String(saleId));
  if (!sale) { showNotification('Sale not found', 'error'); return; }

  const timestamp = new Date().toISOString();

  sale.status        = 'REFUNDED';
  sale.paymentStatus = 'REFUNDED';
  sale.refund = {
    reason, refundedAt: timestamp,
    refundedBy: APP_STATE.currentUserRole || 'ADMIN'
  };
  sale.audit = sale.audit || {};
  sale.audit.refundedAt = timestamp;
  sale.audit.refundedBy = APP_STATE.currentUserRole || 'ADMIN';

  // Re-seal — the integrity hash covers status, so it must be recomputed
  // after this legitimate transition or verifyTransaction() will flag it
  // as tampered (HASH_MISMATCH) even though the refund was authorized.
  if (typeof sealTransaction === 'function') {
    await sealTransaction(sale);
  }

  updateState('sales', () => sales);

  // Stock restoration
  _refundRestoreProductStock(sale);
  _refundRestoreIngredientStock(sale);

  // Audit trail
  if (typeof pushAuditEntry === 'function') {
    pushAuditEntry({
      action: 'REFUND_COMPLETED',
      saleId: sale.id,
      receiptNumber: sale.receiptNumber,
      total: sale.totals?.total ?? sale.total ?? 0,
      reason, outcome: 'SUCCESS', stockRestored: true
    });
  }

  closeModal('refundModal');
  if (typeof renderSalesTable === 'function') renderSalesTable();
  if (typeof refreshEventBreakEven === 'function') refreshEventBreakEven();
  if (typeof renderAuditLog   === 'function') renderAuditLog();
  if (typeof refreshDashboard === 'function') refreshDashboard();
  showNotification(`Refund processed for ${sale.receiptNumber} — stock restored`, 'success');
}

function _refundRestoreProductStock(sale) {
  const products = (APP_STATE.products || []).map(product => {
    // FG-mode products restore via the FG ledger in _refundRestoreIngredientStock below.
    if (typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(product)) {
      return product;
    }
    const units = (sale.items || []).reduce((sum, line) => {
      if (String(line.productId) !== String(product.id)) return sum;
      return sum + Number(line.quantity || 0) * Number(line.multiplier || 1);
    }, 0);
    if (!units) return product;
    return { ...product, stock: Number(product.stock || 0) + units };
  });
  updateState('products', () => products);
}

function _refundRestoreIngredientStock(sale) {
  const deltas = new Map();
  (sale.items || []).forEach(line => {
    const product = (APP_STATE.products || []).find(p => String(p.id) === String(line.productId));
    if (!product || !Array.isArray(product.recipe)) return;

    // FG-mode products: restore finished goods stock, not ingredients
    if (typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(product)) {
      const units = Number(line.quantity || 0) * Number(line.multiplier || 1);
      if (typeof _setFGRecord === 'function') {
        _setFGRecord(product.id, product.name, units, 0,
          `Refund restored: ${sale.receiptNumber}`, 'refund-restore');
      }
      return; // Ingredients consumed at production — don't restore on refund
    }

    const batchYield = Math.max(1, Number(product.batchYield || 1));
    const recipeMode = String(product.recipeMode || 'unit');
    const lineUnits  = Number(line.quantity || 0) * Number(line.multiplier || 1);
    product.recipe.forEach(ri => {
      const perUnit = recipeMode === 'batch'
        ? Number(ri.quantity||0) / batchYield
        : Number(ri.quantity||0);
      deltas.set(ri.ingredientId, (deltas.get(ri.ingredientId) || 0) + perUnit * lineUnits);
    });
  });
  if (!deltas.size) return;

  const ingredients = (APP_STATE.ingredients || []).map(ing => {
    const restore = deltas.get(ing.id);
    if (!restore) return ing;
    return { ...ing, stock: Number(ing.stock || 0) + restore };
  });
  updateState('ingredients', () => ingredients);

  // Inventory movement log
  const movements = Array.isArray(APP_STATE.inventoryMovements) ? APP_STATE.inventoryMovements : [];
  deltas.forEach((qty, ingredientId) => {
    const ing = (APP_STATE.ingredients || []).find(i => String(i.id) === String(ingredientId));
    if (!ing) return;
    movements.push({
      id: generateId(), ingredientId, ingredientName: ing.name,
      type: 'refund-restoration', quantityAdded: qty, quantityUsed: 0,
      reason: `Refund: ${sale.receiptNumber}`,
      previousStock: Number(ing.stock || 0) - qty,
      newStock: Number(ing.stock || 0),
      createdAt: new Date().toISOString(),
      createdBy: APP_STATE.currentUserRole || 'ADMIN'
    });
  });
  updateState('inventoryMovements', () => movements);
}

window.openRefundModal = openRefundModal;
window.confirmRefund   = confirmRefund;
