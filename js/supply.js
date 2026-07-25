window.supplyTableLimit=5;

function _auditSupplyEvent(action, order, outcome='SUCCESS', details='') {
  try {
    if (typeof pushAuditEntry === 'function') {
      pushAuditEntry({
        action,
        outcome,
        referenceId: order?.id || '',
        invoiceNumber: order?.invoiceNumber || '',
        details: details || `${order?.clientName || ''}`
      });
    }
  } catch(e) { console.error(e); }
}


async function _createSupplySalesRecord(order, paymentInfo) {
  if (!order || order.salesRecordId) return;
  const paymentMethod    = paymentInfo?.method    || 'invoice';
  const paymentReference = paymentInfo?.reference || '';

  const timestamp     = new Date().toISOString();
  const saleId        = typeof generateId === 'function' ? generateId()
                        : `SUP-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  // receiptNumber must match what _buildCanonicalString reads
  const receiptNumber = order.invoiceNumber || saleId;

  // Normalise items to match POS sale structure
  const items = (order.items || []).map(item => ({
    id:          typeof generateId === 'function' ? generateId() : String(Date.now()),
    productId:   item.productId   || '',
    variantId:   '',
    name:        item.productName || item.description || '',
    quantity:    Number(item.qty  || item.quantity || 0),
    multiplier:  1,
    price:       Number(item.unitPrice || item.price || 0),
    total:       Number(item.total     || 0)
  }));

  const subtotal = items.reduce((s, i) => s + i.total, 0);
  const discount = Number(order.discount || 0);
  const tax      = Number(order.tax      || 0);
  const total    = Number(order.grandTotal || subtotal);

  const sale = {
    id: saleId,
    receiptNumber,                        // canonical hash reads this field
    channel:       'SUPPLY',
    status:        'COMPLETED',
    paymentStatus: 'PAID',
    orderType:     'Supply Order',
    customer: {
      name:     order.clientName || 'B2B Client',
      clientId: order.clientId   || ''
    },
    payment: {
      method:          paymentInfo?.splitAmount > 0 ? `${paymentMethod} + ${paymentInfo.splitMethod}` : paymentMethod,
      tendered:        total,
      change:          0,
      referenceNumber: paymentReference || receiptNumber,
      ...(paymentInfo?.splitAmount > 0 ? {
        splitMethod:    paymentInfo.splitMethod,
        splitAmount:    paymentInfo.splitAmount,
        splitReference: paymentInfo.splitReference || ''
      } : {})
    },
    totals: { subtotal, discount, tax, total },
    items,
    sourceOrderId: order.id,
    // Legacy flat fields for analytics compatibility
    customerName:  order.clientName || 'B2B Client',
    paymentMethod: paymentMethod,
    subtotal, discount, tax, total,
    tendered: total, change: 0,
    referenceNumber: paymentReference || receiptNumber,
    createdAt:  timestamp,
    completedAt: timestamp,
    audit: {
      createdAt:   timestamp,
      completedAt: timestamp,
      completedBy: APP_STATE.currentUserRole || 'ADMIN'
    }
  };

  // Seal BEFORE pushing to state — await guarantees hash is present
  if (typeof sealTransaction === 'function') {
    await sealTransaction(sale);
  }

  const sales = Array.isArray(APP_STATE.sales) ? APP_STATE.sales : [];
  sales.push(sale);
  updateState('sales', () => sales);

  order.salesRecordId = saleId;

  // Audit trail
  if (typeof pushAuditEntry === 'function') {
    pushAuditEntry({
      action:        'SUPPLY_SALE_CREATED',
      saleId:        saleId,
      receiptNumber: receiptNumber,
      referenceId:   order.id,
      invoiceNumber: order.invoiceNumber,
      total,
      outcome:       'SUCCESS',
      note:          `B2B sale created from supply order ${order.invoiceNumber} · ${order.clientName || ''}`
    });
  }

  if (typeof refreshDashboard  === 'function') refreshDashboard();
  if (typeof renderSalesTable  === 'function') renderSalesTable();
  if (typeof renderAuditLog    === 'function') renderAuditLog();
}

/* ═══════════════════════════════════════════════════════
   SUPPLY.JS — Supplier Order Tracking v2
   Product-linked line items (productId required).
   Inventory integration:
     ORDERED   → reserve stock (soft hold)
     DELIVERED → deduct stock (hard deduction)
     CANCELLED → release reservation
     VOIDED    → release reservation
   Feature-toggled via settings.supplierModeEnabled.
═══════════════════════════════════════════════════════ */

const SUPPLY_STATUSES = ['DRAFTED', 'ORDERED', 'DELIVERED', 'INVOICED', 'PAID'];
const SUPPLY_STATUS_LABELS = {
  DRAFTED:   'Draft',
  ORDERED:   'Ordered',
  DELIVERED: 'Delivered',
  INVOICED:  'Invoiced',
  PAID:      'Paid',
  CANCELLED: 'Cancelled',
  VOIDED:    'Voided'
};

/* ── Data accessors ── */
function getSupplyOrders() {
  return Array.isArray(APP_STATE.supplyOrders) ? APP_STATE.supplyOrders : [];
}
function getSupplierClients() {
  return Array.isArray(APP_STATE.supplierClients) ? APP_STATE.supplierClients : [];
}
function getSupplyOrderById(id) {
  return getSupplyOrders().find(o => String(o.id) === String(id));
}

/* ═══════════════════════════════════════════════════════
   CLIENT MANAGEMENT
═══════════════════════════════════════════════════════ */

function saveSupplierClient() {
  const name    = sanitizeText(document.getElementById('clientName')?.value || '');
  const contact = sanitizeText(document.getElementById('clientContact')?.value || '');
  const email   = sanitizeText(document.getElementById('clientEmail')?.value || '');
  const address = sanitizeText(document.getElementById('clientAddress')?.value || '');
  const editId  = document.getElementById('clientId')?.value || '';

  if (!name) { showNotification('Client name is required', 'error'); return; }

  const clients = getSupplierClients();
  if (editId) {
    const idx = clients.findIndex(c => String(c.id) === String(editId));
    if (idx >= 0) clients[idx] = { ...clients[idx], name, contact, email, address };
  } else {
    clients.push({ id: generateId(), name, contact, email, address,
      createdAt: new Date().toISOString() });
  }

  updateState('supplierClients', () => clients);
  closeModal('clientModal');
  clearClientForm();
  renderClientsList();
  renderClientDropdowns();
  showNotification('Client saved', 'success');
}

function deleteSupplierClient(clientId) {
  if (!confirm('Delete this client?')) return;
  updateState('supplierClients', () =>
    getSupplierClients().filter(c => String(c.id) !== String(clientId)));
  renderClientsList();
  renderClientDropdowns();
  showNotification('Client deleted', 'success');
}

function openClientModal(clientId = null) {
  clearClientForm();
  if (clientId) {
    const client = getSupplierClients().find(c => String(c.id) === String(clientId));
    if (client) {
      setElementValue('clientId',      client.id);
      setElementValue('clientName',    client.name);
      setElementValue('clientContact', client.contact || '');
      setElementValue('clientEmail',   client.email   || '');
      setElementValue('clientAddress', client.address || '');
    }
  }
  openModal('clientModal');
}

function clearClientForm() {
  ['clientId','clientName','clientContact','clientEmail','clientAddress']
    .forEach(id => setElementValue(id, ''));
}

function renderClientsList() {
  const container = document.getElementById('clientsList');
  if (!container) return;
  const clients = getSupplierClients();

  if (!clients.length) {
    container.innerHTML = `<div class="empty-state">No clients yet — add your first client</div>`;
    return;
  }

  container.innerHTML = clients.map(c => {
    const ar = getClientReceivables(c.id);
    const ageChip = ar.total > 0
      ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:800;
          padding:2px 8px;border-radius:999px;margin-left:8px;
          background:${ar.oldestDays > 60 ? 'rgba(220,38,38,.12)' : ar.oldestDays > 30 ? 'rgba(234,88,12,.12)' : 'var(--gray-100)'};
          color:${ar.oldestDays > 60 ? '#dc2626' : ar.oldestDays > 30 ? '#ea580c' : 'var(--gray-500)'};">
          ${formatCurrency(ar.total)} due${ar.oldestDays > 0 ? ` · ${ar.oldestDays}d` : ''}</span>`
      : '';
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;
      padding:10px 14px;border:1.5px solid var(--border);border-radius:var(--radius-lg);
      margin-bottom:8px;background:var(--white);">
      <div>
        <div style="font-weight:800;font-size:13px;display:flex;align-items:center;">${escapeHtml(c.name)}${ageChip}</div>
        <div style="font-size:11px;color:var(--gray-400);">
          ${[c.contact, c.email].filter(Boolean).map(escapeHtml).join(' · ') || 'No contact info'}
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center;">
        <button class="btn btn-sm" data-action="client-portal" data-id="${c.id}"
          style="display:inline-flex;align-items:center;gap:5px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          Order Portal
        </button>
        <button class="btn btn-sm btn-secondary" data-action="client-statement" data-id="${c.id}">Statement</button>
        <div class="row-menu">
          <button type="button" class="row-menu-btn" data-action="toggle-client-row-menu"
            data-menu-scope="client" data-id="${c.id}" aria-label="More actions">⋯</button>
          <template class="row-menu-template">
            <div class="row-menu-dropdown">
              ${c.portal?.termsMode === 'consignment'
                ? `<button type="button" data-action="consignment-ledger"
                    data-id="${c.id}">Consignment Stock</button>`
                : ''}
              <button type="button" data-action="edit-client" data-id="${c.id}">Edit</button>
              <button type="button" class="danger" data-action="delete-client"
                data-id="${c.id}">Delete</button>
            </div>
          </template>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderClientDropdowns() {
  const selects = document.querySelectorAll('.supply-client-select');
  const clients = getSupplierClients();
  selects.forEach(select => {
    const current = select.value;
    select.innerHTML = `<option value="">Select Client</option>` +
      clients.map(c =>
        `<option value="${c.id}"${current === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`
      ).join('');
  });
}

/* ═══════════════════════════════════════════════════════
   STATEMENT OF ACCOUNT — AR aging + shareable read-only link
   Balance follows the same convention as Reports' Receivables card
   (getOutstandingReceivables): DELIVERED/INVOICED orders are fully
   outstanding at grandTotal — this app has no partial-payment tracking
   on B2B orders, only a binary paid/unpaid state.
═══════════════════════════════════════════════════════ */

function getClientReceivables(clientId) {
  const orders = getSupplyOrders().filter(o =>
    String(o.clientId) === String(clientId) &&
    ['DELIVERED', 'INVOICED'].includes(String(o.status || '').toUpperCase()));

  const now = Date.now();
  const items = orders.map(o => {
    const history = Array.isArray(o.statusHistory) ? o.statusHistory : [];
    // Age from the most recent time this order was invoiced (falling back
    // to delivered, then created) — matches the pipeline stepper's own
    // "last matching entry" convention for a status that can be re-set.
    const lastOf = s => { let e = null; history.forEach(h => { if (h.status === s) e = h; }); return e; };
    const anchor = lastOf('INVOICED') || lastOf('DELIVERED');
    const invoicedAt = anchor?.changedAt || o.createdAt || new Date().toISOString();
    const ageDays = Math.max(0, Math.floor((now - new Date(invoicedAt).getTime()) / 86400000));
    const bucket = ageDays === 0 ? 'current' : ageDays <= 30 ? '1-30' : ageDays <= 60 ? '31-60' : '60+';
    return {
      id: o.id, invoiceNumber: o.invoiceNumber || o.id,
      amount: Number(o.grandTotal || 0), invoicedAt, ageDays, bucket,
    };
  }).sort((a, b) => b.ageDays - a.ageDays);

  const buckets = { current: 0, '1-30': 0, '31-60': 0, '60+': 0 };
  items.forEach(i => { buckets[i.bucket] += i.amount; });
  const total = items.reduce((s, i) => s + i.amount, 0);
  const oldestDays = items.length ? items[0].ageDays : 0;

  return { items, buckets, total, oldestDays };
}

function openClientStatementModal(clientId) {
  const client = getSupplierClients().find(c => String(c.id) === String(clientId));
  if (!client) return;

  let m = document.getElementById('clientStatementModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'clientStatementModal';
    m.className = 'modal-overlay';
    document.body.appendChild(m);
  }

  const ar = getClientReceivables(clientId);
  const hasLink = !!client.statementShare?.token;
  const bucketCards = [
    ['Current', ar.buckets.current, ''],
    ['1–30 Days', ar.buckets['1-30'], ''],
    ['31–60 Days', ar.buckets['31-60'], '#ea580c'],
    ['60+ Days', ar.buckets['60+'], '#dc2626'],
  ];

  m.innerHTML = `
    <div class="modal" style="max-width:560px;">
      <h3>Statement of Account</h3>
      <input type="hidden" id="stmtClientId" value="${clientId}" />
      <div style="font-size:13px;font-weight:800;margin-bottom:2px;">${escapeHtml(client.name)}</div>
      <div style="font-size:11px;color:var(--gray-400);margin-bottom:16px;">
        ${[client.contact, client.email].filter(Boolean).map(escapeHtml).join(' · ') || 'No contact info'}
      </div>

      <div class="cost-preview-card" style="margin-top:0;margin-bottom:16px;">
        <div class="cost-preview-grid">
          ${bucketCards.map(([label, amt, color]) => `
            <div class="cost-preview-item">
              <div class="cost-preview-label">${label}</div>
              <div class="cost-preview-value" style="${color && amt > 0 ? `color:${color};` : ''}">${formatCurrency(amt)}</div>
            </div>`).join('')}
        </div>
        <div style="text-align:right;font-size:12px;color:var(--gray-500);margin-top:10px;border-top:1px solid var(--border);padding-top:10px;">
          Total Outstanding <strong style="color:var(--black);font-size:14px;">${formatCurrency(ar.total)}</strong>
        </div>
      </div>

      ${ar.items.length ? `
      <div class="table-wrapper" style="margin-bottom:16px;">
        <table>
          <thead><tr><th>Invoice</th><th>Invoiced</th><th>Age</th><th>Amount</th></tr></thead>
          <tbody>
            ${ar.items.map(i => `<tr>
              <td style="font-weight:700;">${escapeHtml(i.invoiceNumber)}</td>
              <td>${new Date(i.invoicedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
              <td style="color:${i.ageDays > 60 ? '#dc2626' : i.ageDays > 30 ? '#ea580c' : 'inherit'};">${i.ageDays}d</td>
              <td style="font-weight:700;">${formatCurrency(i.amount)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : `<div class="empty-state" style="margin-bottom:16px;">No outstanding invoices — fully paid up</div>`}

      <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
        color:var(--gray-500);margin-bottom:10px;">Share Link</div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;margin-bottom:10px;">
        <input type="checkbox" id="stmtIncludePayment" style="width:16px;height:16px;" />
        Include payment/QR details on the shared page
      </label>
      <div id="stmtShareSection" style="display:${hasLink ? 'block' : 'none'};background:var(--gray-50);
        border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:12px 14px;margin-bottom:14px;">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          <input id="stmtLinkInput" type="text" readonly value="${hasLink ? escapeHtml(getClientStatementUrl(clientId) || '') : ''}"
            style="flex:1;padding:8px 10px;font-size:11px;border:1.5px solid var(--border);
              border-radius:8px;font-family:var(--font-mono, monospace);background:var(--white);" />
          <button class="btn btn-sm btn-secondary" data-action="stmt-copy-link">Copy</button>
        </div>
        <div style="font-size:11px;color:var(--gray-500);">
          Anyone with this link sees a read-only version of this statement.
          Re-sharing refreshes the same link with today's numbers.<br>
          <button data-action="stmt-revoke" data-id="${clientId}" style="background:none;border:none;padding:0;margin-top:4px;
            font-size:11px;font-weight:800;color:var(--danger);cursor:pointer;font-family:inherit;
            text-decoration:underline;">Revoke this link</button>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-secondary" type="button" onclick="closeModal('clientStatementModal')">Close</button>
        <button class="btn btn-secondary" type="button" data-action="stmt-print" data-id="${clientId}">Print</button>
        <button class="btn" type="button" data-action="stmt-share" data-id="${clientId}">
          ${hasLink ? 'Update & Re-share' : 'Share Statement'}
        </button>
      </div>
    </div>`;

  openModal('clientStatementModal');
}

function _clientStatementPayload(clientId, includePayment) {
  const client = getSupplierClients().find(c => String(c.id) === String(clientId));
  const ar = getClientReceivables(clientId);
  const paymentInfo = includePayment
    ? (APP_STATE.settings?.paymentMethods || [])
        .filter(m => m.type === 'qr' && m.qrImage)
        .map(m => ({ name: m.name, qrImage: m.qrImage }))
    : [];
  return {
    brand:       APP_STATE.settings?.brandName || 'Caflat.CORE',
    clientName:  client?.name || '',
    generatedAt: new Date().toISOString(),
    total:       ar.total,
    buckets:     ar.buckets,
    items:       ar.items.map(i => ({ invoiceNumber: i.invoiceNumber, amount: i.amount, invoicedAt: i.invoicedAt, ageDays: i.ageDays })),
    paymentInfo,
  };
}

async function shareClientStatement(clientId) {
  if (typeof requireTier === 'function' && !requireTier('pro', 'Shareable statements')) return;
  const tenantId = typeof getTenantId === 'function' ? getTenantId() : null;
  if (!tenantId) { showNotification('Activate your license first — statement links need your cloud workspace', 'error'); return; }

  const client = getSupplierClients().find(c => String(c.id) === String(clientId));
  if (!client) return;

  const includePayment = document.getElementById('stmtIncludePayment')?.checked === true;
  const payload = _clientStatementPayload(clientId, includePayment);

  let token = client.statementShare?.token;
  let hash  = client.statementShare?.hash;
  if (!token) {
    token = ((crypto.randomUUID?.() || '') + (crypto.randomUUID?.() || '')).replace(/-/g, '');
    hash  = await _sha256Hex(token);
  }

  const btn = document.querySelector('[data-action="stmt-share"]');
  if (btn) { btn.textContent = 'Sharing…'; btn.disabled = true; }

  try {
    const res = await fetch(`${CAFLAT_SB_URL}/rest/v1/client_statements?on_conflict=tenant_id,client_key`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        CAFLAT_SB_ANON,
        'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
        'Prefer':        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({ tenant_id: tenantId, client_key: String(clientId), token_hash: hash, payload }),
    });
    if (!res.ok) {
      showNotification('Could not create statement link — run migration 012 in Supabase', 'error');
      return;
    }

    const clients = getSupplierClients();
    const idx = clients.findIndex(c => String(c.id) === String(clientId));
    if (idx >= 0) clients[idx] = { ...clients[idx], statementShare: { token, hash, updatedAt: new Date().toISOString() } };
    updateState('supplierClients', () => clients);

    openClientStatementModal(clientId);
    showNotification('Statement link ready — share it with your client', 'success');
  } finally {
    if (btn) { btn.disabled = false; }
  }
}

async function revokeClientStatementLink(clientId) {
  const client = getSupplierClients().find(c => String(c.id) === String(clientId));
  if (!client?.statementShare) return;
  if (!confirm(`Revoke ${client.name}'s statement link? It will stop working immediately.`)) return;

  try {
    await fetch(`${CAFLAT_SB_URL}/rest/v1/client_statements?token_hash=eq.${client.statementShare.hash}`, {
      method: 'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'apikey':        CAFLAT_SB_ANON,
        'Authorization': `Bearer ${CAFLAT_SB_ANON}`,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({ revoked: true }),
    });
  } catch (e) { /* revoke best-effort; local removal below always happens */ }

  const clients = getSupplierClients();
  const idx = clients.findIndex(c => String(c.id) === String(clientId));
  if (idx >= 0) { const c = { ...clients[idx] }; delete c.statementShare; clients[idx] = c; }
  updateState('supplierClients', () => clients);

  openClientStatementModal(clientId);
  showNotification('Statement link revoked', 'success');
}

function getClientStatementUrl(clientId) {
  const client = getSupplierClients().find(c => String(c.id) === String(clientId));
  return client?.statementShare?.token ? `${location.origin}/statement.html#${client.statementShare.token}` : null;
}

function copyClientStatementLink(clientId) {
  const url = getClientStatementUrl(clientId);
  if (!url) return;
  navigator.clipboard?.writeText(url)
    .then(() => showNotification('Statement link copied', 'success'))
    .catch(() => showNotification(url, 'info'));
}

function printClientStatement(clientId) {
  const client = getSupplierClients().find(c => String(c.id) === String(clientId));
  if (!client) return;
  const ar = getClientReceivables(clientId);
  const brand = APP_STATE.settings?.brandName || 'Caflat.CORE';
  const today = new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Statement — ${escapeHtml(client.name)}</title>
    <style>
      * { box-sizing:border-box; margin:0; padding:0; }
      body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#0c0b0a; padding:32px; }
      .hdr { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #0c0b0a; padding-bottom:16px; margin-bottom:20px; }
      .brand { font-size:18px; font-weight:900; letter-spacing:-.02em; }
      .title { font-size:11px; font-weight:800; letter-spacing:2px; text-transform:uppercase; color:#666; margin-top:4px; }
      .meta { text-align:right; font-size:12px; color:#666; }
      .client { font-size:15px; font-weight:800; margin-bottom:20px; }
      .buckets { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px; }
      .bucket { border:1px solid #ddd; border-radius:8px; padding:10px 12px; }
      .bucket .l { font-size:9px; font-weight:800; letter-spacing:1px; text-transform:uppercase; color:#999; margin-bottom:4px; }
      .bucket .v { font-size:15px; font-weight:900; }
      table { width:100%; border-collapse:collapse; font-size:12px; margin-bottom:20px; }
      th { text-align:left; font-size:9px; font-weight:800; letter-spacing:1px; text-transform:uppercase; color:#999; padding:8px 6px; border-bottom:2px solid #0c0b0a; }
      td { padding:8px 6px; border-bottom:1px solid #eee; }
      .total { text-align:right; font-size:14px; font-weight:900; padding-top:12px; border-top:2px solid #0c0b0a; }
      @media print { body { padding:0; } }
    </style></head><body>
    <div class="hdr">
      <div><div class="brand">${escapeHtml(brand)}</div><div class="title">Statement of Account</div></div>
      <div class="meta">Generated ${today}</div>
    </div>
    <div class="client">${escapeHtml(client.name)}</div>
    <div class="buckets">
      <div class="bucket"><div class="l">Current</div><div class="v">${formatCurrency(ar.buckets.current)}</div></div>
      <div class="bucket"><div class="l">1&ndash;30 Days</div><div class="v">${formatCurrency(ar.buckets['1-30'])}</div></div>
      <div class="bucket"><div class="l">31&ndash;60 Days</div><div class="v">${formatCurrency(ar.buckets['31-60'])}</div></div>
      <div class="bucket"><div class="l">60+ Days</div><div class="v">${formatCurrency(ar.buckets['60+'])}</div></div>
    </div>
    ${ar.items.length ? `
    <table>
      <thead><tr><th>Invoice</th><th>Invoiced</th><th>Age</th><th>Amount</th></tr></thead>
      <tbody>${ar.items.map(i => `<tr>
        <td>${escapeHtml(i.invoiceNumber)}</td>
        <td>${new Date(i.invoicedAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
        <td>${i.ageDays}d</td>
        <td>${formatCurrency(i.amount)}</td>
      </tr>`).join('')}</tbody>
    </table>` : `<p style="color:#999;margin-bottom:20px;">No outstanding invoices.</p>`}
    <div class="total">Total Outstanding: ${formatCurrency(ar.total)}</div>
    <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`;

  const win = window.open('', '_blank');
  if (!win) { showNotification('Allow pop-ups to print the statement', 'error'); return; }
  win.document.write(html);
  win.document.close();
}

/* ═══════════════════════════════════════════════════════
   CLIENT ORDER PORTAL
   Per-client pricing + a shareable order form link.
   The cafe publishes the client's catalog (with resolved
   prices) to Supabase under an unguessable token; the
   client orders at /order.html?t=TOKEN and submissions
   land back here as DRAFTED supply orders.
═══════════════════════════════════════════════════════ */
let _portalModalClientId = null;

function _getPortalConfig(client) {
  const p = client?.portal || {};
  return {
    pricing: {
      mode:       p.pricing?.mode || 'retail',       // retail | percent | amount
      percentOff: Number(p.pricing?.percentOff || 0),
      amountOff:  Number(p.pricing?.amountOff  || 0),
      custom:     { ...(p.pricing?.custom || {}) },   // productId → flat price
      // productId → [{minQty, price}] — this client's own volume-pricing
      // breaks for that product (each client can have a different schedule,
      // or none at all).
      tiers: Object.fromEntries(
        Object.entries(p.pricing?.tiers || {})
          .map(([productId, tiers]) => [productId, Array.isArray(tiers) ? tiers.map(t => ({ ...t })) : []])
      )
    },
    // null = all products; array = chosen subset
    allowedProductIds: Array.isArray(p.allowedProductIds) ? [...p.allowedProductIds] : null,
    // productId → order-in-multiples-of (e.g. 12 = sold by the dozen)
    multiples: { ...(p.multiples || {}) },
    // Built-in payment methods this client's form offers (QR/bank methods
    // from Settings are always offered — these two are the only ones a
    // cafe might want to switch off for a given client, e.g. cash-only
    // clients who shouldn't see "Invoice / On Account").
    builtinMethods: {
      cash:    p.builtinMethods?.cash    !== false,
      invoice: p.builtinMethods?.invoice !== false
    },
    token:       p.token       || '',
    publishedAt: p.publishedAt || '',
    revoked:     p.revoked === true,
    // sale = today's buy-and-pay portal. consignment = the client holds
    // stock and only owes for what they report as sold (see order.html's
    // consignment tabs and submit_sell_through).
    termsMode: p.termsMode === 'consignment' ? 'consignment' : 'sale',
    // Which settlement paths a consignment client may use when reporting
    // sell-through. Meaningless for termsMode 'sale'.
    settlementModes: {
      payNow:       p.settlementModes?.payNow === true,
      invoiceAfter: p.settlementModes?.invoiceAfter !== false
    },
    // A short-notice delivery request (within thresholdHrs) adds percent%
    // to the order total. Applies to both sale-mode checkout and
    // consignment restock requests, wherever a delivery date is picked.
    rushFee: {
      enabled:      p.rushFee?.enabled !== false,
      thresholdHrs: Number(p.rushFee?.thresholdHrs || 24),
      percent:      Number(p.rushFee?.percent || 5)
    }
  };
}

function resolvePortalPrice(portalCfg, product) {
  const retail = Number(product.price || 0);
  const customRaw = portalCfg?.pricing?.custom?.[product.id];
  if (customRaw !== undefined && customRaw !== null && customRaw !== '') {
    const custom = Number(customRaw);
    if (Number.isFinite(custom)) return Math.max(0, round2(custom));
  }
  const mode = portalCfg?.pricing?.mode || 'retail';
  if (mode === 'percent') {
    return Math.max(0, round2(retail * (1 - Number(portalCfg.pricing.percentOff || 0) / 100)));
  }
  if (mode === 'amount') {
    return Math.max(0, round2(retail - Number(portalCfg.pricing.amountOff || 0)));
  }
  return round2(retail);
}

// Highest-threshold-met wins; falls back to basePrice when qty is below
// every tier (or there are no tiers at all — the opt-in default).
function resolveTieredPrice(basePrice, tiers, qty) {
  if (!Array.isArray(tiers) || !tiers.length) return basePrice;
  const hit = [...tiers].sort((a, b) => a.minQty - b.minQty)
    .filter(t => qty >= t.minQty).pop();
  return hit ? hit.price : basePrice;
}

// The actual price a client pays for a product at a given order quantity:
// this client's own volume-pricing tiers for that product always take
// over once qty meets a threshold — a custom price (or retail/percent/
// amount-off mode) is just the price below the lowest threshold.
function resolveClientProductPrice(portalCfg, product, qty) {
  const base = resolvePortalPrice(portalCfg, product);
  const tiers = portalCfg?.pricing?.tiers?.[product.id] || [];
  return resolveTieredPrice(base, tiers, qty);
}

function _newPortalToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function _portalOrderFormBase() {
  // Same convention as the receipt QR link: configured base wins, else current dir
  const configured = String(APP_STATE.settings?.receiptBaseUrl || '').trim().replace(/\/+$/, '');
  const auto = window.location.href.split('?')[0].replace(/\/[^/]*$/, '');
  return (configured || auto) + '/order.html';
}

function _portalLink(token) {
  return `${_portalOrderFormBase()}?t=${token}`;
}

function openClientPortalModal(clientId) {
  const client = getSupplierClients().find(c => String(c.id) === String(clientId));
  if (!client) return;

  if (typeof getTenantId !== 'function' || !getTenantId()) {
    showNotification('Activate your license first — the order portal link needs your cloud workspace', 'error');
    return;
  }

  _portalModalClientId = String(clientId);
  const cfg      = _getPortalConfig(client);
  const products = Array.isArray(APP_STATE.products) ? APP_STATE.products : [];
  const sym      = typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₱';

  let m = document.getElementById('clientPortalModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'clientPortalModal';
    m.className = 'modal-overlay';
    document.body.appendChild(m);
  }

  const cards = products.map(p => {
    const included = !cfg.allowedProductIds || cfg.allowedProductIds.includes(String(p.id));
    const custom   = cfg.pricing.custom[p.id];
    const multiple = cfg.multiples[p.id];
    const tiers    = cfg.pricing.tiers?.[p.id] || [];
    return `
      <div class="portal-card" data-portal-product="${p.id}" style="border:1.5px solid var(--border);
        border-radius:var(--radius-md);padding:12px 14px;margin-bottom:8px;background:var(--white);
        transition:opacity .15s;">
        <label style="display:flex;align-items:center;gap:12px;cursor:pointer;">
          <input type="checkbox" class="portal-include" data-product-id="${p.id}"
            ${included ? 'checked' : ''} onchange="updatePortalPricePreviews()"
            style="width:20px;height:20px;flex-shrink:0;" />
          <div style="flex:1;min-width:0;">
            <div style="font-weight:800;font-size:14px;">${escapeHtml(p.name)}</div>
            <div style="font-size:11.5px;color:var(--gray-400);margin-top:1px;">Retail ${formatCurrency(Number(p.price || 0))}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:9px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--gray-400);">They Pay</div>
            <div class="portal-preview" style="font-weight:900;font-size:16px;white-space:nowrap;"></div>
          </div>
        </label>
        <div class="portal-card-detail" style="display:flex;gap:10px;margin-top:10px;padding-top:10px;
          border-top:1px dashed var(--gray-200);">
          <div style="flex:1;">
            <label style="display:block;font-size:9.5px;font-weight:800;letter-spacing:.5px;
              text-transform:uppercase;color:var(--gray-500);margin-bottom:4px;">Custom Price <span style="text-transform:none;font-weight:600;opacity:.7;">(optional)</span></label>
            <input type="number" min="0" step="0.01" class="portal-custom" data-product-id="${p.id}"
              value="${custom !== undefined && custom !== null && custom !== '' ? custom : ''}"
              placeholder="${escapeHtml(sym)} —" oninput="updatePortalPricePreviews()"
              style="width:100%;padding:9px 10px;font-size:13px;border:1.5px solid var(--border);
                border-radius:8px;font-family:inherit;box-sizing:border-box;" />
          </div>
          <div style="flex:1;">
            <label style="display:block;font-size:9.5px;font-weight:800;letter-spacing:.5px;
              text-transform:uppercase;color:var(--gray-500);margin-bottom:4px;">Sold In Packs Of <span style="text-transform:none;font-weight:600;opacity:.7;">(optional)</span></label>
            <input type="number" min="2" step="1" class="portal-multiple" data-product-id="${p.id}"
              value="${multiple && Number(multiple) >= 2 ? Number(multiple) : ''}"
              placeholder="e.g. 12" title="Only sold in multiples of this quantity (e.g. 12 = by the dozen)"
              oninput="updatePortalPricePreviews()"
              style="width:100%;padding:9px 10px;font-size:13px;border:1.5px solid var(--border);
                border-radius:8px;font-family:inherit;box-sizing:border-box;" />
          </div>
        </div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--gray-200);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
            <label style="font-size:9.5px;font-weight:800;letter-spacing:.5px;
              text-transform:uppercase;color:var(--gray-500);">Volume Pricing <span style="text-transform:none;font-weight:600;opacity:.7;">(optional, this client only)</span></label>
            <button type="button" class="btn btn-sm btn-secondary" onclick="addPortalTierRow('${p.id}')"
              style="padding:4px 10px;font-size:11px;">+ Add break</button>
          </div>
          <div class="portal-tier-rows" data-product-id="${p.id}">${tiers.map(t => portalTierRowHtml(p.id, t)).join('')}</div>
        </div>
      </div>`;
  }).join('');

  const hasLink = cfg.token && !cfg.revoked;
  const modeBtn = (mode, label) => `
    <button type="button" class="portal-mode-btn" data-mode="${mode}"
      onclick="setPortalPricingMode('${mode}')"
      style="padding:9px 16px;border-radius:99px;border:1.5px solid var(--border);
        background:var(--white);color:var(--black);font-size:12.5px;font-weight:800;
        font-family:inherit;cursor:pointer;white-space:nowrap;">${label}</button>`;
  const termsBtn = (mode, label) => `
    <button type="button" class="portal-terms-btn" data-terms="${mode}"
      onclick="setPortalTermsMode('${mode}')"
      style="padding:9px 16px;border-radius:99px;border:1.5px solid var(--border);
        background:var(--white);color:var(--black);font-size:12.5px;font-weight:800;
        font-family:inherit;cursor:pointer;white-space:nowrap;">${label}</button>`;

  m.innerHTML = `
    <div class="modal" style="max-width:min(680px, 94vw);">
      <h3 style="margin-bottom:2px;">Order Portal — ${escapeHtml(client.name)}</h3>
      <div style="font-size:12px;color:var(--gray-400);margin-bottom:18px;">
        Set this client's prices, pick their products, then share their private order link.
      </div>

      <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
        color:var(--gray-500);margin-bottom:10px;">1 · Terms</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
        ${termsBtn('sale', 'Standard Sale')}
        ${termsBtn('consignment', 'Consignment')}
      </div>
      <div id="portalSettlementWrap" style="display:none;flex-wrap:wrap;gap:16px;margin-bottom:12px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:700;">
          <input type="checkbox" id="portalSettlePayNow" ${cfg.settlementModes.payNow ? 'checked' : ''}
            style="width:18px;height:18px;" /> Client can pay in-portal when reporting sales
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:700;">
          <input type="checkbox" id="portalSettleInvoice" ${cfg.settlementModes.invoiceAfter ? 'checked' : ''}
            style="width:18px;height:18px;" /> Bill after you reconcile their report
        </label>
      </div>
      <div id="portalTermsHint" style="font-size:11px;color:var(--gray-400);margin-bottom:18px;">
        Consignment: this client holds stock and only owes for what they report as sold. Damaged/expired units are written off, not billed.
      </div>

      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:700;margin-bottom:8px;">
        <input type="checkbox" id="portalRushEnabled" ${cfg.rushFee.enabled ? 'checked' : ''}
          onchange="updatePortalRushVisibility()" style="width:18px;height:18px;" />
        Charge a rush fee for short-notice delivery requests
      </label>
      <div id="portalRushWrap" style="display:${cfg.rushFee.enabled ? 'flex' : 'none'};align-items:center;
        gap:8px;flex-wrap:wrap;margin-bottom:18px;">
        <span style="font-size:13px;font-weight:700;color:var(--gray-500);">Within</span>
        <input type="number" step="1" min="0" id="portalRushHours" value="${cfg.rushFee.thresholdHrs}"
          style="width:70px;padding:9px 10px;font-size:14px;font-weight:800;border:1.5px solid var(--border);
            border-radius:8px;font-family:inherit;" />
        <span style="font-size:13px;font-weight:700;color:var(--gray-500);">hours of the requested delivery date, add</span>
        <input type="number" step="0.5" min="0" id="portalRushPercent" value="${cfg.rushFee.percent}"
          style="width:70px;padding:9px 10px;font-size:14px;font-weight:800;border:1.5px solid var(--border);
            border-radius:8px;font-family:inherit;" />
        <span style="font-size:13px;font-weight:700;color:var(--gray-500);">% to the order total.</span>
      </div>

      <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
        color:var(--gray-500);margin-bottom:10px;">2 · General Pricing</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
        ${modeBtn('retail', 'Standard retail')}
        ${modeBtn('percent', 'Percent off')}
        ${modeBtn('amount', 'Amount off')}
      </div>
      <div id="portalPercentWrap" style="display:none;align-items:center;gap:8px;margin-bottom:12px;">
        <input type="number" step="0.1" id="portalPercentOff" value="${cfg.pricing.percentOff || ''}"
          placeholder="10" oninput="updatePortalPricePreviews()"
          style="width:90px;padding:9px 10px;font-size:14px;font-weight:800;border:1.5px solid var(--border);
            border-radius:8px;font-family:inherit;" />
        <span style="font-size:13px;font-weight:700;color:var(--gray-500);">% off every product's retail price</span>
      </div>
      <div id="portalAmountWrap" style="display:none;align-items:center;gap:8px;margin-bottom:12px;">
        <span style="font-size:14px;font-weight:800;">${escapeHtml(sym)}</span>
        <input type="number" step="0.01" id="portalAmountOff" value="${cfg.pricing.amountOff || ''}"
          placeholder="15" oninput="updatePortalPricePreviews()"
          style="width:90px;padding:9px 10px;font-size:14px;font-weight:800;border:1.5px solid var(--border);
            border-radius:8px;font-family:inherit;" />
        <span style="font-size:13px;font-weight:700;color:var(--gray-500);">off every product's retail price</span>
      </div>
      <div style="font-size:11px;color:var(--gray-400);margin-bottom:18px;">
        A custom price set on a product below always overrides this.
      </div>

      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:10px;">
        <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
          color:var(--gray-500);">3 · Products <span id="portalIncludedCount" style="color:var(--gray-400);font-weight:600;letter-spacing:0;text-transform:none;"></span></div>
        <div style="display:flex;gap:12px;">
          <button type="button" onclick="togglePortalIncludeAll(true)" style="background:none;border:none;
            padding:0;font-size:11.5px;font-weight:800;color:var(--black);cursor:pointer;
            font-family:inherit;text-decoration:underline;">Select all</button>
          <button type="button" onclick="togglePortalIncludeAll(false)" style="background:none;border:none;
            padding:0;font-size:11.5px;font-weight:800;color:var(--gray-500);cursor:pointer;
            font-family:inherit;text-decoration:underline;">Select none</button>
        </div>
      </div>

      <div style="max-height:min(48vh, 440px);overflow-y:auto;margin-bottom:18px;padding-right:2px;">
        ${cards || `<div class="empty-state">No products yet</div>`}
      </div>

      <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
        color:var(--gray-500);margin-bottom:10px;">4 · Payment Methods</div>
      <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:18px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:700;">
          <input type="checkbox" id="portalAcceptCash" ${cfg.builtinMethods.cash ? 'checked' : ''}
            style="width:18px;height:18px;" /> Accept Cash
        </label>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:700;">
          <input type="checkbox" id="portalAcceptInvoice" ${cfg.builtinMethods.invoice ? 'checked' : ''}
            style="width:18px;height:18px;" /> Accept Invoice / On Account
        </label>
      </div>
      <div style="font-size:11px;color:var(--gray-400);margin-top:-10px;margin-bottom:18px;">
        Any QR/bank methods configured in Settings are always offered too. Uncheck both only if this client must pay another way you've set up in Settings.
      </div>

      <div style="font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
        color:var(--gray-500);margin-bottom:10px;">5 · Share Link</div>
      <div id="portalShareSection" style="display:${hasLink ? 'block' : 'none'};background:var(--gray-50);
        border:1.5px solid var(--border);border-radius:var(--radius-lg);
        padding:12px 14px;margin-bottom:14px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
          color:var(--gray-500);margin-bottom:8px;">Private Order Link</div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;">
          <input id="portalLinkInput" type="text" readonly value="${hasLink ? escapeHtml(_portalLink(cfg.token)) : ''}"
            style="flex:1;padding:8px 10px;font-size:11px;border:1.5px solid var(--border);
              border-radius:8px;font-family:var(--font-mono, monospace);background:var(--white);" />
          <button class="btn btn-sm btn-secondary" data-action="portal-copy-link">Copy</button>
        </div>
        <div style="display:flex;gap:14px;align-items:center;">
          <div id="portalQrBox" style="width:110px;height:110px;flex-shrink:0;border:1.5px solid var(--border);
            border-radius:10px;overflow:hidden;background:#fff;display:grid;place-items:center;"></div>
          <div style="font-size:11px;color:var(--gray-500);line-height:1.6;">
            Send this link (or let them scan the QR).<br>
            Sharing again after price changes refreshes their form.<br>
            <button data-action="portal-revoke" style="background:none;border:none;padding:0;margin-top:4px;
              font-size:11px;font-weight:800;color:var(--danger);cursor:pointer;font-family:inherit;
              text-decoration:underline;">Revoke this link</button>
          </div>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-secondary" type="button" onclick="closeModal('clientPortalModal')">Close</button>
        <button class="btn btn-secondary" type="button" data-action="portal-save">Save</button>
        <button class="btn" type="button" data-action="portal-share" id="portalShareBtn">
          ${hasLink ? 'Update & Re-share Link' : 'Save & Get Link'}
        </button>
      </div>
    </div>`;

  openModal('clientPortalModal');
  setPortalPricingMode(cfg.pricing.mode);
  setPortalTermsMode(cfg.termsMode);
  if (hasLink) _renderPortalQR(cfg.token);
}

function setPortalTermsMode(mode) {
  const modal = document.getElementById('clientPortalModal');
  if (!modal) return;
  modal.dataset.termsMode = mode;
  modal.querySelectorAll('.portal-terms-btn').forEach(btn => {
    const active = btn.dataset.terms === mode;
    btn.style.background  = active ? 'var(--black)' : 'var(--white)';
    btn.style.color       = active ? '#fff' : 'var(--black)';
    btn.style.borderColor = active ? 'var(--black)' : 'var(--border)';
  });
  const wrap = document.getElementById('portalSettlementWrap');
  if (wrap) wrap.style.display = mode === 'consignment' ? 'flex' : 'none';
}

function updatePortalRushVisibility() {
  const wrap = document.getElementById('portalRushWrap');
  const enabled = document.getElementById('portalRushEnabled')?.checked === true;
  if (wrap) wrap.style.display = enabled ? 'flex' : 'none';
}

function setPortalPricingMode(mode) {
  const modal = document.getElementById('clientPortalModal');
  if (!modal) return;
  modal.dataset.pricingMode = mode;
  modal.querySelectorAll('.portal-mode-btn').forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.style.background    = active ? 'var(--black)' : 'var(--white)';
    btn.style.color         = active ? '#fff' : 'var(--black)';
    btn.style.borderColor   = active ? 'var(--black)' : 'var(--border)';
  });
  const percentWrap = document.getElementById('portalPercentWrap');
  const amountWrap  = document.getElementById('portalAmountWrap');
  if (percentWrap) percentWrap.style.display = mode === 'percent' ? 'flex' : 'none';
  if (amountWrap)  amountWrap.style.display  = mode === 'amount'  ? 'flex' : 'none';
  updatePortalPricePreviews();
}

function togglePortalIncludeAll(checked) {
  document.querySelectorAll('#clientPortalModal .portal-include')
    .forEach(cb => { cb.checked = checked; });
  updatePortalPricePreviews();
}

function portalTierRowHtml(productId, tier) {
  return `
    <div class="portal-tier-row" data-product-id="${productId}" style="display:flex;gap:6px;margin-bottom:6px;align-items:center;">
      <input type="number" class="portal-tier-minqty" min="1" step="1" placeholder="Qty ≥"
        value="${tier?.minQty || ''}" oninput="updatePortalPricePreviews()"
        style="width:70px;padding:6px 8px;font-size:12px;border:1.5px solid var(--border);
          border-radius:6px;font-family:inherit;box-sizing:border-box;" />
      <span style="font-size:11px;color:var(--gray-400);">→</span>
      <input type="number" class="portal-tier-price" min="0" step="0.01" placeholder="Price"
        value="${tier?.price ?? ''}" oninput="updatePortalPricePreviews()"
        style="width:80px;padding:6px 8px;font-size:12px;border:1.5px solid var(--border);
          border-radius:6px;font-family:inherit;box-sizing:border-box;" />
      <button type="button" onclick="this.parentElement.remove(); updatePortalPricePreviews();"
        style="background:none;border:none;color:var(--gray-400);cursor:pointer;font-size:14px;padding:2px 4px;">✕</button>
    </div>`;
}

function addPortalTierRow(productId) {
  const container = document.querySelector(
    `#clientPortalModal .portal-tier-rows[data-product-id="${CSS.escape(String(productId))}"]`);
  if (!container) return;
  container.insertAdjacentHTML('beforeend', portalTierRowHtml(productId, null));
}

function _readPortalModalConfig() {
  const modal = document.getElementById('clientPortalModal');
  if (!modal) return null;

  const mode = modal.dataset.pricingMode || 'retail';
  const percentOff = Number(document.getElementById('portalPercentOff')?.value || 0);
  const amountOff  = Number(document.getElementById('portalAmountOff')?.value  || 0);

  const custom = {};
  modal.querySelectorAll('.portal-custom').forEach(inp => {
    const v = String(inp.value).trim();
    if (v !== '' && Number.isFinite(Number(v))) custom[inp.dataset.productId] = Number(v);
  });

  const multiples = {};
  modal.querySelectorAll('.portal-multiple').forEach(inp => {
    const v = Math.floor(Number(String(inp.value).trim()));
    if (Number.isFinite(v) && v >= 2) multiples[inp.dataset.productId] = v;
  });

  const tiers = {};
  modal.querySelectorAll('.portal-tier-row').forEach(row => {
    const productId = row.dataset.productId;
    const minQty = Number(row.querySelector('.portal-tier-minqty')?.value || 0);
    const priceRaw = row.querySelector('.portal-tier-price')?.value;
    if (!productId || !minQty || priceRaw === '' || priceRaw === null || priceRaw === undefined) return;
    const price = Number(priceRaw);
    if (!Number.isFinite(price)) return;
    if (!tiers[productId]) tiers[productId] = [];
    tiers[productId].push({ minQty, price });
  });
  Object.keys(tiers).forEach(productId => tiers[productId].sort((a, b) => a.minQty - b.minQty));

  const allowed = [];
  modal.querySelectorAll('.portal-include').forEach(cb => {
    if (cb.checked) allowed.push(String(cb.dataset.productId));
  });

  const builtinMethods = {
    cash:    document.getElementById('portalAcceptCash')?.checked    !== false,
    invoice: document.getElementById('portalAcceptInvoice')?.checked !== false
  };

  const termsMode = modal.dataset.termsMode === 'consignment' ? 'consignment' : 'sale';
  const settlementModes = {
    payNow:       document.getElementById('portalSettlePayNow')?.checked === true,
    invoiceAfter: document.getElementById('portalSettleInvoice')?.checked !== false
  };
  const rushFee = {
    enabled:      document.getElementById('portalRushEnabled')?.checked !== false,
    thresholdHrs: Number(document.getElementById('portalRushHours')?.value || 24),
    percent:      Number(document.getElementById('portalRushPercent')?.value || 5)
  };

  return { pricing: { mode, percentOff, amountOff, custom, tiers }, allowedProductIds: allowed,
    multiples, builtinMethods, termsMode, settlementModes, rushFee };
}

// Returns an error message if any product's volume-pricing rows are
// invalid (non-positive qty, negative price, or a duplicate threshold),
// else null. Checked before persisting — the live preview reader above
// doesn't block on this so typing mid-edit never shows an error.
function _validatePortalTiers(tiersByProduct) {
  for (const productId of Object.keys(tiersByProduct)) {
    const tiers = tiersByProduct[productId];
    if (tiers.some(t => t.minQty <= 0 || t.price < 0)) {
      return 'Volume pricing: quantity must be positive and price cannot be negative';
    }
    const seen = new Set(tiers.map(t => t.minQty));
    if (seen.size !== tiers.length) {
      return 'Volume pricing: each quantity threshold must be unique per product';
    }
  }
  return null;
}

function updatePortalPricePreviews() {
  const modal = document.getElementById('clientPortalModal');
  if (!modal) return;
  const cfg = _readPortalModalConfig();
  const products = Array.isArray(APP_STATE.products) ? APP_STATE.products : [];
  let includedCount = 0;

  modal.querySelectorAll('.portal-card[data-portal-product]').forEach(card => {
    const product  = products.find(p => String(p.id) === String(card.dataset.portalProduct));
    const cell     = card.querySelector('.portal-preview');
    const detail   = card.querySelector('.portal-card-detail');
    const included = card.querySelector('.portal-include')?.checked;
    if (!product || !cell) return;

    if (!included) {
      cell.innerHTML = `<span style="color:var(--gray-300);">not offered</span>`;
      card.style.opacity = '.5';
      if (detail) detail.style.display = 'none';
      return;
    }
    includedCount++;
    card.style.opacity = '1';
    if (detail) detail.style.display = 'flex';

    const price  = resolvePortalPrice(cfg, product);
    const retail = round2(Number(product.price || 0));
    const diff   = price !== retail
      ? `<div style="font-size:10px;color:${price < retail ? '#15803d' : 'var(--danger)'};font-weight:700;">
           ${price < retail ? '▾ ' : '▴ '}vs ${formatCurrency(retail)}</div>`
      : '';
    const multRaw = Math.floor(Number(card.querySelector('.portal-multiple')?.value || 0));
    const multTag = multRaw >= 2
      ? `<div style="font-size:10px;color:var(--gray-400);font-weight:700;">packs of ${multRaw}</div>` : '';
    cell.innerHTML = `${formatCurrency(price)}${diff}${multTag}`;
  });

  const countEl = document.getElementById('portalIncludedCount');
  if (countEl) countEl.textContent = `(${includedCount} of ${products.length} offered)`;
}

function saveClientPortalConfig(silent = false) {
  const clientId = _portalModalClientId;
  const read = _readPortalModalConfig();
  if (!clientId || !read) return null;

  const tierError = _validatePortalTiers(read.pricing.tiers);
  if (tierError) { showNotification(tierError, 'error'); return null; }

  const clients = getSupplierClients();
  const idx = clients.findIndex(c => String(c.id) === String(clientId));
  if (idx < 0) return null;

  const prev = _getPortalConfig(clients[idx]);
  clients[idx] = {
    ...clients[idx],
    portal: { ...prev, pricing: read.pricing, allowedProductIds: read.allowedProductIds,
      multiples: read.multiples, builtinMethods: read.builtinMethods,
      termsMode: read.termsMode, settlementModes: read.settlementModes, rushFee: read.rushFee }
  };
  updateState('supplierClients', () => clients);
  if (!silent) showNotification('Client pricing saved', 'success');
  return clients[idx];
}

// Plain "Save" only persists the pricing config app-side — if this
// client's order link is already published, the live page would keep
// showing stale prices until someone separately clicks "Update &
// Re-share Link". Silently re-publish here too so Save always means
// "this is what the client sees now" whenever a link already exists.
async function saveAndSyncClientPortal() {
  const client = saveClientPortalConfig();
  if (!client || !client.portal?.token || client.portal?.revoked) return;
  await _publishClientPortal(client);
}

async function shareClientPortal() {
  const client = saveClientPortalConfig(true);
  if (!client) return;

  const btn = document.getElementById('portalShareBtn');
  if (btn) { btn.textContent = 'Publishing…'; btn.disabled = true; }

  try {
    const token = await _publishClientPortal(client);
    if (!token) return;

    const linkInput = document.getElementById('portalLinkInput');
    const section   = document.getElementById('portalShareSection');
    if (linkInput) linkInput.value = _portalLink(token);
    if (section)   section.style.display = 'block';
    _renderPortalQR(token);
    showNotification('Order portal published — link is ready to share', 'success');
  } finally {
    if (btn) { btn.textContent = 'Update & Re-share Link'; btn.disabled = false; }
  }
}

async function _publishClientPortal(client) {
  const tenantId = typeof getTenantId === 'function' ? getTenantId() : null;
  if (!tenantId) {
    showNotification('Activate your license to share order portals', 'error');
    return null;
  }

  const cfg      = _getPortalConfig(client);
  const products = (Array.isArray(APP_STATE.products) ? APP_STATE.products : [])
    .filter(p => !cfg.allowedProductIds || cfg.allowedProductIds.includes(String(p.id)));

  if (!products.length) {
    showNotification('Select at least one product for this client', 'error');
    return null;
  }

  const catalog = products.map(p => {
    const tiers = cfg.pricing.tiers?.[p.id] || [];
    return {
      productId: String(p.id),
      name:      p.name,
      category:  p.category || '',
      price:     resolvePortalPrice(cfg, p),
      multiple:  Number(cfg.multiples[p.id]) >= 2 ? Math.floor(Number(cfg.multiples[p.id])) : 1,
      // This client's own volume-pricing tiers for this product, if any —
      // these always take over once qty meets a threshold, regardless of
      // any custom price/mode (see resolveClientProductPrice).
      ...(tiers.length ? { priceTiers: tiers } : {})
    };
  });

  // Payment methods the client can choose from — the supply checkout's
  // built-ins plus everything configured in Settings (QR images included
  // so the form can display them).
  const configured = (APP_STATE.settings?.paymentMethods || []).map(pm => ({
    name:          pm.name,
    type:          pm.type || 'cash',
    qrImage:       pm.type === 'qr'  ? (pm.qrImage       || '') : '',
    bankName:      pm.type === 'bank' ? (pm.bankName      || '') : '',
    accountNumber: pm.type === 'bank' ? (pm.accountNumber || '') : ''
  }));
  const paymentMethods = [
    ...(cfg.builtinMethods.cash    ? [{ name: 'Cash', type: 'cash' }] : []),
    ...(cfg.builtinMethods.invoice ? [{ name: 'Invoice / On Account', type: 'invoice' }] : []),
    ...configured.filter(pm => pm.name && pm.name.toLowerCase() !== 'cash')
  ];

  if (!paymentMethods.length) {
    showNotification('Turn on at least one payment method for this client', 'error');
    return null;
  }

  // Reuse the live token; rotate if never shared or previously revoked
  const token = (cfg.token && !cfg.revoked) ? cfg.token : _newPortalToken();

  const row = {
    token,
    tenant_id:       tenantId,
    client_id:       String(client.id),
    client_name:     client.name || '',
    brand_name:      APP_STATE.settings?.brandName || 'Caflat.CORE',
    currency:        APP_STATE.settings?.currency  || 'PHP',
    currency_symbol: typeof getCurrencySymbol === 'function' ? getCurrencySymbol() : '₱',
    catalog,
    payment_methods:  paymentMethods,
    terms_mode:       cfg.termsMode,
    settlement_modes: cfg.settlementModes,
    rush_fee:         cfg.rushFee,
    revoked:          false,
    updated_at:       new Date().toISOString()
  };

  const res = await _sbFetch('order_portals?on_conflict=tenant_id,client_id', {
    method: 'POST',
    headers: {
      'x-tenant-id': tenantId,
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(row)
  });

  if (!res.ok) {
    console.error('Portal publish failed', res.status, res.data);
    showNotification('Could not publish the order portal — check your connection', 'error');
    return null;
  }

  // Persist token locally
  const clients = getSupplierClients();
  const idx = clients.findIndex(c => String(c.id) === String(client.id));
  if (idx >= 0) {
    clients[idx] = {
      ...clients[idx],
      portal: {
        ..._getPortalConfig(clients[idx]),
        token,
        publishedAt: new Date().toISOString(),
        revoked: false
      }
    };
    updateState('supplierClients', () => clients);
  }

  _auditSupplyEvent('SUPPLY_PORTAL_PUBLISHED', { id: client.id, clientName: client.name },
    'SUCCESS', `Order portal published for ${client.name}`);
  return token;
}

async function revokeClientPortal() {
  const clientId = _portalModalClientId;
  const client = getSupplierClients().find(c => String(c.id) === String(clientId));
  if (!client) return;

  const cfg = _getPortalConfig(client);
  if (!cfg.token) return;
  if (!confirm(`Revoke ${client.name}'s order link? Their form stops working until you share a new one.`)) return;

  const tenantId = typeof getTenantId === 'function' ? getTenantId() : null;
  if (tenantId) {
    const res = await _sbFetch(`order_portals?token=eq.${encodeURIComponent(cfg.token)}`, {
      method: 'PATCH',
      headers: { 'x-tenant-id': tenantId, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ revoked: true, updated_at: new Date().toISOString() })
    });
    if (!res.ok) {
      showNotification('Could not revoke the link — check your connection', 'error');
      return;
    }
  }

  const clients = getSupplierClients();
  const idx = clients.findIndex(c => String(c.id) === String(clientId));
  if (idx >= 0) {
    clients[idx] = { ...clients[idx], portal: { ..._getPortalConfig(clients[idx]), revoked: true } };
    updateState('supplierClients', () => clients);
  }

  const section = document.getElementById('portalShareSection');
  if (section) section.style.display = 'none';
  const btn = document.getElementById('portalShareBtn');
  if (btn) btn.textContent = 'Save & Get Link';

  _auditSupplyEvent('SUPPLY_PORTAL_REVOKED', { id: client.id, clientName: client.name },
    'SUCCESS', `Order link revoked for ${client.name}`);
  showNotification('Order link revoked', 'success');
}

function copyPortalLink() {
  const input = document.getElementById('portalLinkInput');
  if (!input || !input.value) return;
  navigator.clipboard?.writeText(input.value)
    .then(() => showNotification('Link copied', 'success'))
    .catch(() => {
      input.select();
      document.execCommand('copy');
      showNotification('Link copied', 'success');
    });
}

function _renderPortalQR(token) {
  const box = document.getElementById('portalQrBox');
  if (!box || typeof CaflatQR === 'undefined') return;
  const svg = CaflatQR.generateSVG(_portalLink(token), { size: 110 });
  box.innerHTML = svg;
  const el = box.querySelector('svg');
  if (el) { el.style.width = '100%'; el.style.height = '100%'; }
}

/* ── Portal inbox — pull client-submitted orders into Supply ── */
let _portalInboxTimer   = null;
let _portalInboxRunning = false;
/* Consignment sell-through reports awaiting reconciliation — a live mirror
   of pending portal_reports rows, not persisted to APP_STATE (re-fetchable
   anytime; unlike portal orders, reports need a manual Accept, not
   auto-import, so they stay in this list until reconciled). */
let _pendingReports     = [];
let _reportInboxTimer   = null;
let _reportInboxRunning = false;

function initPortalInboxPolling() {
  checkPortalInbox();
  if (_portalInboxTimer) return;
  _portalInboxTimer = setInterval(checkPortalInbox, 60 * 1000);
}

async function checkPortalInbox() {
  if (_portalInboxRunning) return;
  if (APP_STATE.settings?.supplierModeEnabled !== true) return;
  // Never import before products are hydrated — a poll that races state
  // restoration would mis-flag every line as "no longer in your products".
  if (!(Array.isArray(APP_STATE.products) && APP_STATE.products.length)) return;
  const tenantId = typeof getTenantId === 'function' ? getTenantId() : null;
  if (!tenantId || typeof _sbFetch !== 'function') return;

  _portalInboxRunning = true;
  try {
    const res = await _sbFetch(
      'portal_orders?status=eq.pending&order=created_at.asc&limit=50&select=*',
      { headers: { 'x-tenant-id': tenantId } }
    );
    if (!res.ok || !Array.isArray(res.data) || !res.data.length) return;

    const orders   = getSupplyOrders();
    const imported = new Set(orders.map(o => o.portalOrderId).filter(Boolean));
    let importedCount = 0;

    for (const row of res.data) {
      if (imported.has(row.id)) {
        // Already imported but the status flip didn't land — retry it
        await _markPortalOrderImported(row.id, tenantId);
        continue;
      }
      const order = _convertPortalOrder(row);
      if (!order) continue;

      orders.push(order);
      updateState('supplyOrders', () => orders);   // persist BEFORE the flip
      await _markPortalOrderImported(row.id, tenantId);
      imported.add(row.id);
      importedCount++;

      _auditSupplyEvent('SUPPLY_PORTAL_ORDER_RECEIVED', order, 'SUCCESS',
        `Client order from ${order.clientName} · ${formatCurrency(order.grandTotal)}`);
    }

    if (importedCount > 0) {
      renderSupplyTable();
      renderSupplyKPIs();
      if (typeof refreshDashboard === 'function') refreshDashboard();
      showNotification(
        importedCount === 1
          ? `New client order received — review it in Supply`
          : `${importedCount} new client orders received — review them in Supply`,
        'success');
    }
  } catch (e) {
    console.error('Portal inbox check failed', e);
  } finally {
    _portalInboxRunning = false;
    updatePortalInboxBadge();
  }
}

function _convertPortalOrder(row) {
  const rawItems = Array.isArray(row.items) ? row.items : [];
  if (!rawItems.length) return null;

  const products = Array.isArray(APP_STATE.products) ? APP_STATE.products : [];
  const missing  = [];

  const items = rawItems.map(it => {
    const product = products.find(p => String(p.id) === String(it.productId));
    if (!product) missing.push(it.name || it.productId);
    const qty       = Number(it.qty || 0);
    const unitPrice = Number(it.unitPrice || 0);
    return {
      productId:   String(it.productId || ''),
      productName: it.name || product?.name || 'Unknown product',
      description: '',
      qty,
      unitPrice,
      total: Number(it.total || round2(qty * unitPrice)),
      multiplier: 1
    };
  });

  const subtotal  = round2(items.reduce((s, i) => s + i.total, 0));
  const timestamp = new Date().toISOString();

  const sourceClient = (Array.isArray(APP_STATE.supplierClients) ? APP_STATE.supplierClients : [])
    .find(c => String(c.id) === String(row.client_id));
  const terms = sourceClient?.portal?.termsMode === 'consignment' ? 'consignment' : 'sale';

  const noteParts = ['Received via client order portal'];
  if (row.requested_date)    noteParts.push(`Requested delivery: ${row.requested_date}`);
  if (row.payment_method)    noteParts.push(`Client will pay by: ${row.payment_method}`
    + (row.payment_reference ? ` (ref ${row.payment_reference})` : ''));
  if (row.payment_split === 'half') {
    const half = round2(subtotal / 2);
    noteParts.push(`50% DOWNPAYMENT: ${formatCurrency(half)} sent, balance ${formatCurrency(subtotal - half)} on delivery`);
  }
  if (row.payment_method_2) {
    const amt2 = Number(row.payment_amount_2 || 0);
    const amt1 = Math.max(0, subtotal - amt2);
    noteParts.push(`SPLIT PAYMENT: ${formatCurrency(amt1)} via ${row.payment_method} + ${formatCurrency(amt2)} via ${row.payment_method_2}`
      + (row.payment_reference_2 ? ` (ref ${row.payment_reference_2})` : ''));
  }
  if (row.payment_proof)     noteParts.push('Payment screenshot attached — open the order to view it');
  if (row.notes)             noteParts.push(`Client notes: ${row.notes}`);
  if (missing.length)        noteParts.push(`⚠ No longer in your products: ${missing.join(', ')}`);

  return {
    id:            generateId(),
    invoiceNumber: typeof generateInvoiceNumber === 'function' ? generateInvoiceNumber() : `INV-${Date.now()}`,
    clientId:      String(row.client_id || ''),
    clientName:    row.client_name || 'B2B Client',
    orderDate:     String(row.created_at || timestamp).slice(0, 10),
    notes:         noteParts.join(' · '),
    items,
    subtotal,
    discount:      0,
    discountType:  'percent',
    grandTotal:    subtotal,
    status:        'DRAFTED',
    terms,
    reservedStock: false,
    stockDeducted: false,
    statusHistory: [{ status: 'DRAFTED', changedAt: timestamp,
      note: 'Submitted by client through their order portal' }],
    portalOrderId:          row.id,
    clientPaymentMethod:    row.payment_method    || '',
    clientPaymentReference: row.payment_reference || '',
    clientPaymentSplit:     row.payment_split === 'half' ? 'half' : 'full',
    clientPaymentProof:     row.payment_proof     || '',
    clientPaymentMethod2:    row.payment_method_2    || '',
    clientPaymentAmount2:    Number(row.payment_amount_2 || 0),
    clientPaymentReference2: row.payment_reference_2 || '',
    requestedDate:          row.requested_date    || '',
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

async function _markPortalOrderImported(rowId, tenantId) {
  try {
    await _sbFetch(`portal_orders?id=eq.${encodeURIComponent(rowId)}`, {
      method: 'PATCH',
      headers: { 'x-tenant-id': tenantId, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status: 'imported', imported_at: new Date().toISOString() })
    });
  } catch (e) {
    console.error('Could not mark portal order imported', e);
  }
}

function updatePortalInboxBadge() {
  const nav = document.getElementById('navSupply');
  if (!nav) return;
  const count = getSupplyOrders()
    .filter(o => o.portalOrderId && o.status === 'DRAFTED').length
    + _pendingReports.length;

  let badge = document.getElementById('portalInboxBadge');
  if (!count) { badge?.remove(); return; }

  if (!badge) {
    badge = document.createElement('span');
    badge.id = 'portalInboxBadge';
    badge.style.cssText = 'position:absolute;top:4px;right:4px;min-width:16px;height:16px;' +
      'padding:0 4px;border-radius:99px;background:var(--danger,#dc2626);color:#fff;' +
      'font-size:9px;font-weight:900;display:flex;align-items:center;justify-content:center;' +
      'line-height:1;pointer-events:none;';
    if (getComputedStyle(nav).position === 'static') nav.style.position = 'relative';
    nav.appendChild(badge);
  }
  badge.textContent = count > 9 ? '9+' : String(count);
}

/* ═══════════════════════════════════════════════════════
   CONSIGNMENT RECONCILIATION
   Pending client sell-through reports (portal_reports, see migration 006)
   surface here for the cafe to review and Accept. Accepting a report:
     · creates a supply "order" record containing only the SOLD units
       (status INVOICED, or PAID immediately if the client paid in-portal),
       reusing _createSupplySalesRecord exactly as a normal PAID order does
     · leaves damaged/expired units as an informational write-off — no
       stock action needed, since submit_sell_through already set the
       client's consignment_stock.on_hand to their reported remaining count
     · marks the portal_reports row reconciled server-side
   The reconciliation record never touches the cafe's own product stock —
   that stock already left the building at the original DELIVERED event
   (see _adjustConsignmentStock in the DELIVERED transition), so this
   record is stockDeducted:false to prevent a later cancel/void from
   incorrectly restoring stock the cafe never held.
═══════════════════════════════════════════════════════ */
function initReportInboxPolling() {
  checkReportInbox();
  if (_reportInboxTimer) return;
  _reportInboxTimer = setInterval(checkReportInbox, 60 * 1000);
}

async function checkReportInbox() {
  if (_reportInboxRunning) return;
  if (APP_STATE.settings?.supplierModeEnabled !== true) return;
  const tenantId = typeof getTenantId === 'function' ? getTenantId() : null;
  if (!tenantId || typeof _sbFetch !== 'function') return;

  _reportInboxRunning = true;
  try {
    const res = await _sbFetch(
      'portal_reports?status=eq.pending&order=created_at.asc&limit=50&select=*',
      { headers: { 'x-tenant-id': tenantId } }
    );
    if (!res.ok || !Array.isArray(res.data)) return;

    const previousIds = new Set(_pendingReports.map(r => r.id));
    const newCount = res.data.filter(r => !previousIds.has(r.id)).length;
    _pendingReports = res.data;

    renderReportInbox();
    updatePortalInboxBadge();

    if (newCount > 0) {
      showNotification(
        newCount === 1
          ? 'New consignment sell-through report received — review it in Supply'
          : `${newCount} new consignment sell-through reports received — review them in Supply`,
        'success');
    }
  } catch (e) {
    console.error('Report inbox check failed', e);
  } finally {
    _reportInboxRunning = false;
  }
}

function renderReportInbox() {
  const container = document.getElementById('reportInboxList');
  const section    = document.getElementById('reportInboxSection');
  if (!container || !section) return;

  if (!_pendingReports.length) { section.style.display = 'none'; container.innerHTML = ''; return; }
  section.style.display = 'block';

  container.innerHTML = _pendingReports.map(r => {
    const items       = Array.isArray(r.items) ? r.items : [];
    const soldLines    = items.filter(it => Number(it.sold    || 0) > 0);
    const damagedLines = items.filter(it => Number(it.damaged || 0) > 0);

    const lineHtml = soldLines.length
      ? soldLines.map(it => `
          <div style="display:flex;justify-content:space-between;font-size:12.5px;padding:3px 0;">
            <span>${escapeHtml(it.name || it.productId)} × ${it.sold}</span>
            <span style="font-weight:800;">${formatCurrency(it.total || 0)}</span>
          </div>`).join('')
      : `<div style="font-size:12.5px;color:var(--gray-400);">Nothing sold this period</div>`;

    const damagedHtml = damagedLines.length
      ? `<div style="font-size:11px;color:var(--danger);margin-top:6px;">Written off: ${
          escapeHtml(damagedLines.map(it => `${it.damaged} × ${it.name || it.productId}`).join(', '))}</div>`
      : '';

    const settleLabel = r.settlement === 'pay_now'
      ? `Paid via ${escapeHtml(r.payment_method || '—')}` : 'To be invoiced';

    return `
      <div style="border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:12px 14px;
        margin-bottom:10px;background:var(--white);">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;">
          <div style="font-weight:800;font-size:13.5px;">${escapeHtml(r.client_name || 'B2B Client')}</div>
          <div style="font-size:10.5px;color:var(--gray-400);">
            ${r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</div>
        </div>
        ${lineHtml}
        ${damagedHtml}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;
          padding-top:8px;border-top:1px dashed var(--gray-200);">
          <div>
            <div style="font-size:9.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;
              color:var(--gray-400);">${settleLabel}</div>
            <div style="font-size:16px;font-weight:900;">${formatCurrency(r.subtotal || 0)}</div>
          </div>
          <button class="btn btn-sm" data-action="accept-portal-report" data-id="${r.id}">Accept</button>
        </div>
      </div>`;
  }).join('');
}

async function acceptPortalReport(reportId) {
  const report = _pendingReports.find(r => String(r.id) === String(reportId));
  if (!report) return;
  const tenantId = typeof getTenantId === 'function' ? getTenantId() : null;
  if (!tenantId) { showNotification('Activate your license first', 'error'); return; }

  const products = Array.isArray(APP_STATE.products) ? APP_STATE.products : [];
  const rawItems = Array.isArray(report.items) ? report.items : [];

  const soldItems = rawItems.filter(it => Number(it.sold || 0) > 0).map(it => {
    const product = products.find(p => String(p.id) === String(it.productId));
    const qty       = Number(it.sold || 0);
    const unitPrice = Number(it.unitPrice || 0);
    return {
      productId:   String(it.productId || ''),
      productName: it.name || product?.name || 'Unknown product',
      description: '',
      qty, unitPrice,
      total:       Number(it.total || round2(qty * unitPrice)),
      multiplier:  1
    };
  });
  const damagedSummary = rawItems
    .filter(it => Number(it.damaged || 0) > 0)
    .map(it => `${it.damaged} × ${it.name || it.productId}`)
    .join(', ');

  const timestamp = new Date().toISOString();
  const orders = getSupplyOrders();

  if (soldItems.length) {
    const subtotal = round2(soldItems.reduce((s, i) => s + i.total, 0));
    const newOrder = {
      id: generateId(),
      invoiceNumber: typeof generateInvoiceNumber === 'function' ? generateInvoiceNumber() : `INV-${Date.now()}`,
      clientId:   String(report.client_id || ''),
      clientName: report.client_name || 'B2B Client',
      orderDate:  timestamp.slice(0, 10),
      notes: ['Consignment sell-through reconciliation',
        damagedSummary ? `Written off (damaged/expired): ${damagedSummary}` : '',
        report.notes ? `Client notes: ${report.notes}` : ''].filter(Boolean).join(' · '),
      items: soldItems,
      subtotal, discount: 0, discountType: 'percent', grandTotal: subtotal,
      status: 'INVOICED',
      terms: 'consignment',
      // The physical stock this represents already left the cafe at the
      // original DELIVERED event — this record must never re-touch it.
      reservedStock: false,
      stockDeducted: false,
      statusHistory: [{ status: 'INVOICED', changedAt: timestamp,
        note: 'Reconciled from client sell-through report' }],
      consignmentReportId: report.id,
      createdAt: timestamp, updatedAt: timestamp
    };
    orders.push(newOrder);

    if (report.settlement === 'pay_now') {
      await _createSupplySalesRecord(newOrder, {
        method:    report.payment_method || 'Cash',
        reference: report.payment_reference || ''
      });
      newOrder.status = 'PAID';
      newOrder.statusHistory.push({ status: 'PAID', changedAt: timestamp,
        note: 'Client paid in-portal when reporting' });
    }

    updateState('supplyOrders', () => orders);
    _auditSupplyEvent('SUPPLY_CONSIGNMENT_RECONCILED', newOrder, 'SUCCESS',
      `Reconciled ${soldItems.length} product(s) sold · ${formatCurrency(subtotal)}`);
  }

  await _sbFetch(`portal_reports?id=eq.${encodeURIComponent(report.id)}`, {
    method: 'PATCH',
    headers: { 'x-tenant-id': tenantId, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ status: 'reconciled', reconciled_at: new Date().toISOString() })
  });

  _pendingReports = _pendingReports.filter(r => String(r.id) !== String(reportId));
  renderReportInbox();
  updatePortalInboxBadge();
  renderSupplyTable();
  renderSupplyKPIs();
  showNotification(
    soldItems.length ? 'Report reconciled — sale recorded' : 'Report reconciled — nothing was sold',
    'success');
}

/* Shows the shelf-life duration (if the product has one configured) and,
   once a delivery has actually started the countdown, either how long
   until the client can report it sold or that it's reportable now — the
   same "reportableAt" the client portal computes, just displayed for the
   cafe here since it wasn't visible admin-side at all before. */
function _shelfLifeBadgesHtml(s) {
  const days = Number(s.shelf_life_days || 0);
  if (days <= 0) return '';
  const durationBadge = `<span class="badge-refunded">${days}d shelf life</span>`;
  if (!s.last_delivered_at) return durationBadge;

  const remainingMs = new Date(s.last_delivered_at).getTime() + days * 86400000 - Date.now();
  if (remainingMs <= 0) {
    return durationBadge + ` <span class="badge-completed">Reportable now</span>`;
  }
  const totalMin = Math.max(1, Math.ceil(remainingMs / 60000));
  const d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60);
  const label = d > 0 ? `${d}d ${h}h` : `${h}h`;
  return durationBadge + ` <span class="badge-pending">Reportable in ${label}</span>`;
}

/* ── Per-client consignment ledger: current on-hand + reconciled history ── */
async function openConsignmentLedger(clientId) {
  const client = getSupplierClients().find(c => String(c.id) === String(clientId));
  if (!client) return;
  const tenantId = typeof getTenantId === 'function' ? getTenantId() : null;
  if (!tenantId) { showNotification('Activate your license first', 'error'); return; }

  let m = document.getElementById('consignmentLedgerModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'consignmentLedgerModal';
    m.className = 'modal-overlay';
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div class="modal" style="max-width:min(560px, 94vw);">
      <h3 style="margin-bottom:2px;">Consignment Stock — ${escapeHtml(client.name)}</h3>
      <div style="font-size:12px;color:var(--gray-400);margin-bottom:16px;">
        Your stock currently held at this client's location, and what has
        sold through so far.
      </div>
      <div id="ledgerTotals" style="margin-bottom:18px;"></div>
      <div class="section-title" style="margin-top:0;">On Hand Now</div>
      <div id="ledgerOnHand" style="margin-bottom:20px;">Loading…</div>
      <div class="section-title" style="margin-top:0;">Reconciled Sell-Through</div>
      <div id="ledgerHistory">Loading…</div>
      <div class="modal-actions">
        <button class="btn btn-secondary" type="button" onclick="closeModal('consignmentLedgerModal')">Close</button>
      </div>
    </div>`;
  openModal('consignmentLedgerModal');

  const [stockRes, historyRes] = await Promise.all([
    _sbFetch(`consignment_stock?tenant_id=eq.${encodeURIComponent(tenantId)}` +
      `&client_id=eq.${encodeURIComponent(clientId)}&order=product_name.asc`,
      { headers: { 'x-tenant-id': tenantId } }),
    _sbFetch(`portal_reports?tenant_id=eq.${encodeURIComponent(tenantId)}` +
      `&client_id=eq.${encodeURIComponent(clientId)}&status=eq.reconciled` +
      `&order=reconciled_at.desc&limit=15`,
      { headers: { 'x-tenant-id': tenantId } })
  ]);

  const stock = (stockRes.ok && Array.isArray(stockRes.data)) ? stockRes.data : [];

  // Headline totals — what's out there, and what it's worth. Derived from the
  // same rows listed below, so the two can never disagree.
  const totalsEl = document.getElementById('ledgerTotals');
  if (totalsEl) {
    const totalUnits = stock.reduce((s, r) => s + Number(r.on_hand || 0), 0);
    const totalValue = stock.reduce((s, r) =>
      s + Number(r.on_hand || 0) * Number(r.unit_price || 0), 0);
    const figure = (label, value) => `
      <div style="flex:1;">
        <div style="font-size:9px;font-weight:800;letter-spacing:1px;
          text-transform:uppercase;color:var(--gray-400);margin-bottom:4px;">${label}</div>
        <div style="font-size:20px;font-weight:800;font-variant-numeric:tabular-nums;">${value}</div>
      </div>`;
    totalsEl.innerHTML = `
      <div style="display:flex;gap:16px;padding:12px 14px;
        border:1.5px solid var(--border);border-radius:var(--radius-lg);">
        ${figure('Units on hand', totalUnits)}
        ${figure('Value on hand', formatCurrency(totalValue))}
      </div>`;
  }

  const onHandEl = document.getElementById('ledgerOnHand');
  if (onHandEl) {
    onHandEl.innerHTML = stock.length
      ? stock.map(s => {
          const badges = _shelfLifeBadgesHtml(s);
          return `
          <div style="padding:6px 0;border-bottom:1px solid var(--gray-100);font-size:13px;">
            <div style="display:flex;justify-content:space-between;">
              <span>${escapeHtml(s.product_name)}</span>
              <span style="font-weight:800;">${Number(s.on_hand)} × ${formatCurrency(s.unit_price)}</span>
            </div>
            ${badges ? `<div style="margin-top:5px;">${badges}</div>` : ''}
          </div>`;
        }).join('')
      : `<div class="empty-state">No stock currently on hand</div>`;
  }

  const history = (historyRes.ok && Array.isArray(historyRes.data)) ? historyRes.data : [];
  const historyEl = document.getElementById('ledgerHistory');
  if (historyEl) {
    historyEl.innerHTML = history.length
      ? history.map(r => {
          const items = Array.isArray(r.items) ? r.items : [];
          const sold  = items.reduce((s, i) => s + Number(i.sold || 0), 0);
          const dateStr = new Date(r.reconciled_at || r.created_at).toLocaleDateString();
          return `
            <div style="display:flex;justify-content:space-between;padding:6px 0;
              border-bottom:1px solid var(--gray-100);font-size:12.5px;">
              <span>${escapeHtml(dateStr)} · ${sold} sold</span>
              <span style="font-weight:800;">${formatCurrency(r.subtotal || 0)}</span>
            </div>`;
        }).join('')
      : `<div class="empty-state">No reconciled reports yet</div>`;
  }
}

/* ═══════════════════════════════════════════════════════
   PRODUCT-LINKED LINE ITEMS
   Each row has a product dropdown (productId required).
   Supplier price defaults to product retail price.
   Qty defaults to 1, editable.
═══════════════════════════════════════════════════════ */

function buildProductOptions(selectedProductId = '') {
  const products = Array.isArray(APP_STATE.products) ? APP_STATE.products : [];
  return `<option value="">Select Product</option>` +
    products.map(p =>
      `<option value="${p.id}" data-price="${Number(p.price||0)}"
        ${String(selectedProductId) === String(p.id) ? ' selected' : ''}>
        ${escapeHtml(p.name)}
      </option>`
    ).join('');
}

function addSupplyLineItemRow(item = null) {
  const container = document.getElementById('supplyLineItems');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'supply-line-row';
  row.dataset.productId = item?.productId || '';
  // A loaded/saved line item's price was set deliberately (by staff or a
  // prior save) and must never be silently recomputed on reopen; a brand
  // new blank row starts in "auto" mode until the staff types into the
  // price field directly.
  row.dataset.priceAuto = item ? 'false' : 'true';

  row.innerHTML = `
    <select class="supply-item-product" style="flex:2;padding:7px 10px;
      border:1px solid var(--border);border-radius:var(--radius-md);
      font-family:var(--font-main);font-size:12px;background:var(--white);">
      ${buildProductOptions(item?.productId || '')}
    </select>
    <input type="number" class="supply-item-qty" placeholder="Qty"
      value="${item?.qty || 1}" min="0.01" step="0.01"
      style="width:72px;padding:7px 10px;border:1px solid var(--border);
        border-radius:var(--radius-md);font-family:var(--font-main);font-size:12px;" />
    <input type="number" class="supply-item-price" placeholder="Unit Price"
      value="${item?.unitPrice || ''}" min="0" step="0.01"
      style="width:110px;padding:7px 10px;border:1px solid var(--border);
        border-radius:var(--radius-md);font-family:var(--font-main);font-size:12px;" />
    <div class="supply-item-total"
      style="width:90px;text-align:right;font-weight:800;font-size:13px;
        font-variant-numeric:tabular-nums;flex-shrink:0;">
      ${item ? formatCurrency((item.qty||0) * (item.unitPrice||0)) : getCurrencySymbol() + '0.00'}
    </div>
    <button type="button" class="btn btn-sm btn-secondary supply-remove-line"
      style="flex-shrink:0;">✕</button>`;

  // Product select → auto-fill price from product retail price
  const productSelect = row.querySelector('.supply-item-product');
  const priceInput    = row.querySelector('.supply-item-price');

  productSelect.addEventListener('change', () => {
    const selectedOption = productSelect.options[productSelect.selectedIndex];
    const retailPrice    = Number(selectedOption?.dataset?.price || 0);
    // Only auto-fill if price is currently empty
    if (!priceInput.value && retailPrice > 0) {
      priceInput.value = retailPrice;
    }
    row.dataset.productId = productSelect.value;
    // Switching products re-arms tier auto-pricing — the old price belonged
    // to a different product's tier list.
    row.dataset.priceAuto = 'true';
    recomputeTierPrice(row);
    updateSupplyLineTotal(row);
  });

  row.querySelector('.supply-item-qty')?.addEventListener('input', () => {
    recomputeTierPrice(row);
    updateSupplyLineTotal(row);
  });
  row.querySelector('.supply-item-price')?.addEventListener('input', () => {
    // The staff typed directly into the price field — stop auto-recomputing
    // it from qty/tiers from now on for this row.
    row.dataset.priceAuto = 'false';
    updateSupplyLineTotal(row);
  });

  row.querySelector('.supply-remove-line').addEventListener('click', () => {
    row.remove();
    updateSupplyOrderTotal();
  });

  container.appendChild(row);
}

// Recomputes a line's unit price from the selected order client's
// volume-pricing tiers for that product (configured per client, per
// product, in the Client Portal pricing modal) as qty changes — but only
// while the price is still in "auto" mode (i.e. the staff hasn't manually
// typed a price for this row/product pick).
function recomputeTierPrice(row) {
  if (row.dataset.priceAuto !== 'true') return;
  const productSelect = row.querySelector('.supply-item-product');
  const priceInput    = row.querySelector('.supply-item-price');
  const qtyInput      = row.querySelector('.supply-item-qty');
  const productId     = productSelect?.value;
  const product = (Array.isArray(APP_STATE.products) ? APP_STATE.products : [])
    .find(p => String(p.id) === String(productId));
  if (!product) return;

  const qty = Number(qtyInput?.value || 0);
  const clientId = document.getElementById('supplyClientSelect')?.value || '';
  const client = clientId
    ? getSupplierClients().find(c => String(c.id) === String(clientId))
    : null;

  priceInput.value = client
    ? resolveClientProductPrice(_getPortalConfig(client), product, qty)
    : Number(product.price || 0);
}

function updateSupplyLineTotal(row) {
  const qty   = Number(row.querySelector('.supply-item-qty')?.value   || 0);
  const price = Number(row.querySelector('.supply-item-price')?.value || 0);
  const totalEl = row.querySelector('.supply-item-total');
  if (totalEl) totalEl.textContent = formatCurrency(qty * price);
  updateSupplyOrderTotal();
}

function updateSupplyOrderTotal() {
  let subtotal = 0;
  document.querySelectorAll('#supplyLineItems .supply-line-row').forEach(row => {
    subtotal += Number(row.querySelector('.supply-item-qty')?.value   || 0) *
                Number(row.querySelector('.supply-item-price')?.value || 0);
  });
  const discountValue = Number(document.getElementById('supplyDiscountValue')?.value || 0);
  const discountType  = document.getElementById('supplyDiscountType')?.value || 'percent';
  const discount      = discountType === 'percent'
    ? subtotal * (discountValue / 100)
    : Math.min(discountValue, subtotal);
  const grandTotal    = Math.max(0, subtotal - discount);

  const subEl  = document.getElementById('supplyOrderSubtotal');
  const discEl = document.getElementById('supplyOrderDiscount');
  const totEl  = document.getElementById('supplyOrderTotal');
  if (subEl)  subEl.textContent  = formatCurrency(subtotal);
  if (discEl) discEl.textContent = discount > 0 ? `-${formatCurrency(discount)}` : '—';
  if (totEl)  totEl.textContent  = formatCurrency(grandTotal);
}

function collectSupplyLineItems() {
  return Array.from(document.querySelectorAll('#supplyLineItems .supply-line-row'))
    .map(row => {
      const productId   = row.querySelector('.supply-item-product')?.value || '';
      const qty         = Number(row.querySelector('.supply-item-qty')?.value   || 0);
      const unitPrice   = Number(row.querySelector('.supply-item-price')?.value || 0);
      const product     = (APP_STATE.products||[]).find(p => String(p.id) === String(productId));
      if (!productId || !product) return null;
      return {
        productId,
        productName: product.name,
        description: product.name,          // kept for CSV/display compat
        qty,
        unitPrice,
        total: qty * unitPrice,
        multiplier: 1                       // supply orders are always unit-based
      };
    })
    .filter(Boolean);
}

/* ═══════════════════════════════════════════════════════
   SUPPLY ORDER CRUD
═══════════════════════════════════════════════════════ */

function openSupplyOrderModal(orderId = null) {
  clearSupplyOrderForm();
  renderClientDropdowns();
  renderSupplyLineItems([]);

  if (orderId) {
    const order = getSupplyOrderById(orderId);
    if (order) hydrateSupplyOrderForm(order);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    setElementValue('supplyOrderDate',     today);
    setElementValue('supplyInvoiceNumber', generateInvoiceNumber());
  }

  // Volume pricing is configured per-client (Client Portal pricing), so
  // switching the order's client changes which tiers apply — recompute
  // every still-auto-priced line when that happens.
  const clientSelect = document.getElementById('supplyClientSelect');
  if (clientSelect && !clientSelect.dataset.tierRecomputeBound) {
    clientSelect.dataset.tierRecomputeBound = 'true';
    clientSelect.addEventListener('change', () => {
      document.querySelectorAll('#supplyLineItems .supply-line-row').forEach(row => {
        recomputeTierPrice(row);
        updateSupplyLineTotal(row);
      });
    });
  }

  openModal('supplyOrderModal');
}

function hydrateSupplyOrderForm(order) {
  setElementValue('supplyOrderId',       order.id);
  setElementValue('supplyInvoiceNumber', order.invoiceNumber);
  setElementValue('supplyOrderDate',     order.orderDate || '');
  setElementValue('supplyNotes',         order.notes || '');
  const clientSelect = document.getElementById('supplyClientSelect');
  if (clientSelect) clientSelect.value = order.clientId || '';

  // Hydrate discount
  const discountPct = order.discount && order.subtotal
    ? ((order.discount / order.subtotal) * 100).toFixed(2) : '';
  const savedType = order.discountType || (discountPct ? 'percent' : 'amount');
  const savedVal  = savedType === 'percent' ? discountPct : (order.discount || '');
  setElementValue('supplyDiscountValue', savedVal);
  setElementValue('supplyDiscountType',  savedType);

  renderSupplyLineItems(order.items || []);
  // Recalculate totals after rows are populated
  if (typeof updateSupplyOrderTotal === 'function') updateSupplyOrderTotal();
}

function renderSupplyLineItems(items = []) {
  const container = document.getElementById('supplyLineItems');
  if (!container) return;
  container.innerHTML = '';
  if (!items.length) {
    addSupplyLineItemRow(); // always start with one empty row
    return;
  }
  items.forEach(item => addSupplyLineItemRow(item));
}

function clearSupplyOrderForm() {
  ['supplyOrderId','supplyInvoiceNumber','supplyOrderDate','supplyNotes']
    .forEach(id => setElementValue(id, ''));
  const container = document.getElementById('supplyLineItems');
  if (container) container.innerHTML = '';
}

function saveSupplyOrder() {
  const id            = getElementValue('supplyOrderId') || generateId();
  const invoiceNumber = sanitizeText(getElementValue('supplyInvoiceNumber'));
  const clientId      = document.getElementById('supplyClientSelect')?.value || '';
  const orderDate     = getElementValue('supplyOrderDate');
  const notes         = sanitizeText(getElementValue('supplyNotes'));
  const items         = collectSupplyLineItems();

  if (!clientId)    { showNotification('Please select a client',          'error'); return; }
  if (!orderDate)   { showNotification('Order date is required',           'error'); return; }
  if (!items.length){ showNotification('Add at least one product line',    'error'); return; }

  const client     = getSupplierClients().find(c => String(c.id) === String(clientId));
  const subtotal       = items.reduce((s, i) => s + i.total, 0);
  const discountValue  = Number(document.getElementById('supplyDiscountValue')?.value || 0);
  const discountType   = document.getElementById('supplyDiscountType')?.value || 'percent';
  const discount       = discountType === 'percent'
    ? subtotal * (discountValue / 100)
    : discountValue;
  const grandTotal     = Math.max(0, subtotal - discount);
  const orders     = getSupplyOrders();
  const existing   = orders.find(o => String(o.id) === String(id));

  if (existing) {
    existing.invoiceNumber = invoiceNumber;
    existing.clientId      = clientId;
    existing.clientName    = client?.name || '';
    existing.orderDate     = orderDate;
    existing.notes         = notes;
    existing.items         = items;
    existing.subtotal      = subtotal;
    existing.discount      = discount;
    existing.discountType  = discountType;
    existing.grandTotal    = grandTotal;
    existing.updatedAt     = new Date().toISOString();
    updateState('supplyOrders', () => orders);
  } else {
    const timestamp = new Date().toISOString();
    // New orders inherit this client's current terms (sale/consignment) at
    // creation time — later changes to the client's portal don't retroactively
    // change existing orders.
    const terms = client?.portal?.termsMode === 'consignment' ? 'consignment' : 'sale';
    orders.push({
      id, invoiceNumber, clientId,
      clientName: client?.name || '',
      orderDate, notes, items, subtotal, discount, discountType, grandTotal,
      status: 'DRAFTED',
      terms,
      reservedStock: false,
      stockDeducted: false,
      statusHistory: [{ status: 'DRAFTED', changedAt: timestamp, note: 'Order created' }],
      createdAt: timestamp,
      updatedAt: timestamp
    });
    updateState('supplyOrders', () => orders);
  }

  closeModal('supplyOrderModal');
  renderSupplyTable();
  renderSupplyKPIs();
  showNotification('Supply order saved', 'success');
}

async function deleteSupplyOrder(orderId) {
  if (!confirm('Delete this supply order?')) return;
  const order = getSupplyOrderById(orderId);
  // Release any reservation and restore stock before deleting
  if (order?.stockDeducted) {
    _restoreSupplyStock(order);
    order.stockDeducted = false;
    if (order.terms === 'consignment') await _adjustConsignmentStock(order, -1);
  }
  _releaseSupplyReservation(order);
  // Also release FG reservations if applicable
  if (typeof releaseFGReserveForSupply === 'function') releaseFGReserveForSupply(order);
  updateState('supplyOrders', () => getSupplyOrders().filter(o => String(o.id) !== String(orderId)));
  renderSupplyTable();
  showNotification('Order deleted', 'success');
}

/* ═══════════════════════════════════════════════════════
   INVENTORY INTEGRATION
   ORDERED   → reserve (soft hold — reduces available qty)
   DELIVERED → hard deduct (uses same engine as POS sales)
   CANCELLED/VOIDED → release reservation
═══════════════════════════════════════════════════════ */

/* Build a cart-compatible array from supply order items */
function _supplyItemsToCart(order) {
  return (order.items || []).map(item => ({
    productId:  item.productId,
    name:       item.productName || item.description || '',
    quantity:   Number(item.qty || 0),
    multiplier: 1,
    price:      Number(item.unitPrice || 0),
    total:      Number(item.total || 0)
  }));
}

/* ORDERED — reserve stock (subtract from available, not from actual stock) */
function _reserveSupplyStock(order) {
  // We record reservation in a separate field so available = stock - reserved
  const reservations = Array.isArray(APP_STATE.stockReservations)
    ? APP_STATE.stockReservations : [];

  (order.items || []).forEach(item => {
    reservations.push({
      id:        generateId(),
      orderId:   order.id,
      productId: item.productId,
      qty:       Number(item.qty || 0),
      createdAt: new Date().toISOString()
    });
  });

  updateState('stockReservations', () => reservations);

  _logInventoryMovements(order, 'supply-reservation', 0,
    `Reserved for supply order ${order.invoiceNumber}`);
}

/* CANCELLED / VOIDED — release reservation */
function _releaseSupplyReservation(order) {
  const reservations = (APP_STATE.stockReservations || [])
    .filter(r => String(r.orderId) !== String(order.id));
  updateState('stockReservations', () => reservations);

  _logInventoryMovements(order, 'supply-reservation-released', 0,
    `Reservation released: ${order.invoiceNumber}`);
}

/* DELIVERED — hard deduct using same engine as POS sales */

/* CANCELLED / VOIDED / REFUNDED — restore stock previously deducted */
function _restoreSupplyStock(order) {
  const cart = _supplyItemsToCart(order);
  if (!cart.length) return;

  const updatedProducts = (APP_STATE.products || []).map(product => {
    const units = cart.reduce((sum, line) => {
      if (String(line.productId) !== String(product.id)) return sum;
      return sum + Number(line.quantity || 0);
    }, 0);
    if (!units) return product;
    // FG-mode products restore via the FG reservation release only —
    // never touch product.stock for these, it isn't the source of truth.
    if (typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(product)) {
      return product;
    }
    return { ...product, stock: Number(product.stock || 0) + units };
  });
  updateState('products', () => updatedProducts);

  // Release FG reservations for any FG-mode products in this order
  if (typeof releaseFGReserveForSupply === 'function') releaseFGReserveForSupply(order);

  _logInventoryMovements(order, 'supply-stock-restored', 0,
    `Restored from supply order ${order.invoiceNumber}`);
}

function _deductSupplyStock(order) {
  const cart = _supplyItemsToCart(order);
  if (!cart.length) return;

  // Deduct product stock — DIRECT mode products only.
  // FG-mode products deduct via deductFGForSupply() further below.
  const updatedProducts = (APP_STATE.products || []).map(product => {
    if (typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(product)) {
      return product;
    }
    const units = cart.reduce((sum, line) => {
      if (String(line.productId) !== String(product.id)) return sum;
      return sum + Number(line.quantity || 0);
    }, 0);
    if (!units) return product;
    return { ...product, stock: Math.max(0, Number(product.stock || 0) - units) };
  });
  updateState('products', () => updatedProducts);

  // Deduct ingredient stock via recipe — DIRECT mode products only
  // Finished Goods mode products deduct from finishedGoods[], not ingredients
  const ingredientDeltas = new Map();
  cart.forEach(line => {
    const product = (APP_STATE.products || []).find(p => String(p.id) === String(line.productId));
    if (!product || !Array.isArray(product.recipe)) return;
    // Skip FG-mode products — their ingredients were consumed at production, not supply
    // FG deduction handled separately below after the loop (not per-line to avoid duplicate calls)
    if (typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(product)) {
      return;
    }
    const batchYield = Math.max(1, Number(product.batchYield || 1));
    const recipeMode = String(product.recipeMode || 'unit');
    product.recipe.forEach(ri => {
      const perUnit = recipeMode === 'batch'
        ? Number(ri.quantity||0) / batchYield
        : Number(ri.quantity||0);
      ingredientDeltas.set(ri.ingredientId,
        (ingredientDeltas.get(ri.ingredientId) || 0) + perUnit * Number(line.quantity||0));
    });
  });

  if (ingredientDeltas.size) {
    const updatedIngredients = (APP_STATE.ingredients || []).map(ing => {
      const used = ingredientDeltas.get(ing.id);
      if (!used) return ing;
      return { ...ing, stock: Math.max(0, Number(ing.stock||0) - used) };
    });
    updateState('ingredients', () => updatedIngredients);
  }

  // Deduct from Finished Goods stock for FG-mode products (once per order, not per line)
  const hasFGItems = (order.items || []).some(item => {
    const prod = (APP_STATE.products || []).find(p => String(p.id) === String(item.productId));
    return typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(prod);
  });
  if (hasFGItems && typeof deductFGForSupply === 'function') deductFGForSupply(order);

  // Release any reservation now that stock is hard-deducted
  _releaseSupplyReservation(order);

  _logInventoryMovements(order, 'supply-delivery-deduction', 0,
    `Stock deducted on delivery: ${order.invoiceNumber}`);

  // Refresh product/inventory views
  if (typeof renderProductsTable   === 'function') renderProductsTable();
  if (typeof renderInventoryTable  === 'function') renderInventoryTable();
  if (typeof renderPOSProducts     === 'function') renderPOSProducts();
  if (typeof refreshDashboard      === 'function') refreshDashboard();
}

/* ── Consignment on-hand balance (server-authoritative, see migration 006) ──
   Adjusts every line of this order against the client's consignment_stock
   row (upserted directly — this call is made by the cafe app with its
   tenant header, the same RLS-protected table-write pattern used by
   _publishClientPortal, not the public token RPCs).
     delta = +1  → DELIVERED: stock now leaves the cafe (already handled by
                   _deductSupplyStock) AND becomes stock the client holds —
                   on_hand increases, unit_price refreshes to this order's price,
                   and the shelf-life countdown (see migration 009) resets to
                   this product's configured shelf_life_days from now.
     delta = -1  → a delivery is reversed (status moved back, cancelled, or
                   the order is deleted) — on_hand decreases by the same
                   qty, floored at 0, unit_price/shelf-life fields carried
                   forward unchanged (a reversal never resets the countdown). */
async function _adjustConsignmentStock(order, delta) {
  const tenantId = typeof getTenantId === 'function' ? getTenantId() : null;
  if (!tenantId) {
    if (delta > 0) showNotification('Could not sync consignment stock — activate your license first', 'error');
    return;
  }
  const clientId = String(order.clientId || '');
  const products  = Array.isArray(APP_STATE.products) ? APP_STATE.products : [];

  for (const item of (order.items || [])) {
    const productId = String(item.productId || '');
    const qty = Number(item.qty || 0);
    if (!productId || qty <= 0) continue;

    const existing = await _sbFetch(
      `consignment_stock?tenant_id=eq.${encodeURIComponent(tenantId)}` +
      `&client_id=eq.${encodeURIComponent(clientId)}` +
      `&product_id=eq.${encodeURIComponent(productId)}&select=on_hand,product_name,category,unit_price,shelf_life_days,last_delivered_at`,
      { headers: { 'x-tenant-id': tenantId } }
    );
    const row = (existing.ok && Array.isArray(existing.data)) ? existing.data[0] : null;
    if (delta < 0 && !row) continue; // nothing on hand to restore

    const priorOnHand = row ? Number(row.on_hand || 0) : 0;
    const product = products.find(p => String(p.id) === productId);

    const res = await _sbFetch('consignment_stock?on_conflict=tenant_id,client_id,product_id', {
      method: 'POST',
      headers: { 'x-tenant-id': tenantId, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        tenant_id:    tenantId,
        client_id:    clientId,
        product_id:   productId,
        product_name: item.productName || row?.product_name || product?.name || '',
        category:     row?.category || product?.category || '',
        on_hand:      Math.max(0, priorOnHand + delta * qty),
        unit_price:   delta > 0 ? Number(item.unitPrice || 0) : Number(row?.unit_price || item.unitPrice || 0),
        shelf_life_days:   delta > 0 ? Number(product?.shelfLifeDays || 0) : Number(row?.shelf_life_days || 0),
        last_delivered_at: delta > 0 ? new Date().toISOString() : (row?.last_delivered_at || null),
        updated_at:   new Date().toISOString()
      })
    });
    if (!res.ok) {
      console.error('Consignment stock sync failed', res.status, res.data);
      showNotification('Consignment balance sync failed for ' +
        (item.productName || productId) + ' — check your connection', 'error');
    }
  }
}

function _logInventoryMovements(order, type, qty, reason) {
  const movements = Array.isArray(APP_STATE.inventoryMovements)
    ? APP_STATE.inventoryMovements : [];

  const products = APP_STATE.products || [];

  (order.items || []).forEach(item => {
    const product  = products.find(p => String(p.id) === String(item.productId));
    const itemQty  = Number(item.qty || 0);
    const isFG     = typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(product);
    const curStock = (product && !isFG) ? Number(product.stock || 0) : null;

    let previousStock = null, newStock = null;
    if (curStock !== null) {
      if (type === 'supply-delivery-deduction') {
        // Stock already deducted; curStock is the "after"
        newStock = curStock; previousStock = curStock + itemQty;
      } else if (type === 'supply-stock-restored') {
        // Stock already restored; curStock is the "after"
        newStock = curStock; previousStock = curStock - itemQty;
      } else {
        // Reservations don't change physical stock
        previousStock = curStock; newStock = curStock;
      }
    }

    movements.push({
      id:             generateId(),
      orderId:        order.id,
      invoiceNumber:  order.invoiceNumber,
      productId:      item.productId,
      productName:    item.productName || item.description || '',
      type,
      quantityAdded:  0,
      quantityUsed:   itemQty,
      reason,
      previousStock,
      newStock,
      createdAt:      new Date().toISOString(),
      createdBy:      APP_STATE.currentUserRole || 'STAFF'
    });
  });

  updateState('inventoryMovements', () => movements);
}

/* ── Overselling guard for supply orders ── */
function _checkSupplyStockAvailability(order) {
  const errors = [];
  const reservations = Array.isArray(APP_STATE.stockReservations)
    ? APP_STATE.stockReservations : [];

  (order.items || []).forEach(item => {
    const product = (APP_STATE.products || []).find(p => String(p.id) === String(item.productId));
    if (!product) return;

    let available;
    if (typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(product)) {
      // FG products — check finished goods available stock
      available = typeof getFGAvailable === 'function'
        ? getFGAvailable(product.id)
        : Number(product.stock || 0);
    } else {
      // Direct products — check ingredient-backed product stock minus reservations
      const alreadyReserved = reservations
        .filter(r => String(r.productId) === String(item.productId) &&
                     String(r.orderId) !== String(order.id))
        .reduce((s, r) => s + Number(r.qty || 0), 0);
      available = Number(product.stock || 0) - alreadyReserved;
    }

    const requested = Number(item.qty || 0);
    if (requested > available) {
      errors.push(`${product.name}: need ${requested}, only ${available} available`);
    }
  });
  return errors;
}

/* ═══════════════════════════════════════════════════════
   STATUS ADVANCEMENT with inventory hooks
═══════════════════════════════════════════════════════ */

async function setSupplyStatus(orderId, newStatus, paymentInfo) {
  if (!newStatus) return;
  const orders = getSupplyOrders();
  const order  = orders.find(o => String(o.id) === String(orderId));
  if (!order) return;

  const prevStatus = order.status;
  if (prevStatus === newStatus) return;
  const newLabel = SUPPLY_STATUS_LABELS[newStatus] || newStatus;

  // Moving to PAID needs a captured payment method first — open the checkout
  // screen; its confirm handler re-calls setSupplyStatus with paymentInfo set.
  if (newStatus === 'PAID' && !order.salesRecordId && !paymentInfo) {
    closeModal('statusPickerModal');
    openSupplyCheckoutModal(orderId);
    return;
  }

  // ── Stock logic on status change ──
  // ORDERED   → soft-reserve (holds stock without touching real inventory)
  // DELIVERED → hard-deduct (uses same engine as POS sales)

  // Moving TO ORDERED — soft-reserve stock
  if (newStatus === 'ORDERED' && !order.reservedStock && !order.stockDeducted) {
    const errors = _checkSupplyStockAvailability(order);
    if (errors.length) {
      const ok = await customConfirm({
        title: 'Stock Warning', message: 'Some items don’t have enough stock available:',
        lines: errors, okLabel: 'Reserve anyway', danger: true
      });
      if (!ok) return;
    }
    _reserveSupplyStock(order);
    order.reservedStock = true;
    _auditSupplyEvent('SUPPLY_STOCK_RESERVED', order);
  }

  // Moving TO DELIVERED — hard-deduct stock (releases any ORDERED reservation)
  if (newStatus === 'DELIVERED' && !order.stockDeducted) {
    const errors = _checkSupplyStockAvailability(order);
    if (errors.length) {
      const ok = await customConfirm({
        title: 'Stock Warning', message: 'Some items don’t have enough stock available:',
        lines: errors, okLabel: 'Deliver anyway', danger: true
      });
      if (!ok) return;
    }
    _deductSupplyStock(order);
    order.stockDeducted = true;
    order.reservedStock = false;
    _auditSupplyEvent('SUPPLY_STOCK_DEDUCTED', order);
    // Consignment: the stock also becomes what the client is holding on
    // the cafe's behalf, tracked separately from the cafe's own inventory.
    if (order.terms === 'consignment') await _adjustConsignmentStock(order, 1);
  }

  // Moving AWAY from ORDERED back to DRAFTED — release the reservation (no real stock was touched)
  if (prevStatus === 'ORDERED' && newStatus === 'DRAFTED' && order.reservedStock) {
    const ok = await customConfirm({
      title: 'Release Reservation?', message: 'Moving back to Draft will release the stock reservation.',
      okLabel: 'Release reservation'
    });
    if (!ok) return;
    _releaseSupplyReservation(order);
    order.reservedStock = false;
    _auditSupplyEvent('SUPPLY_RESERVATION_RELEASED', order);
  }

  // Moving AWAY from DELIVERED-or-later back to an earlier state — restore real stock
  if (['DRAFTED','ORDERED'].includes(newStatus) && order.stockDeducted &&
      ['DELIVERED','INVOICED','PAID'].includes(prevStatus)) {
    const ok = await customConfirm({
      title: 'Restore Stock?', message: 'Moving back will restore previously delivered stock.',
      okLabel: 'Restore stock'
    });
    if (!ok) return;
    _restoreSupplyStock(order);
    order.stockDeducted = false;
    _auditSupplyEvent('SUPPLY_STOCK_RESTORED', order);
    if (order.terms === 'consignment') await _adjustConsignmentStock(order, -1);
  }

  // Moving to CANCELLED or VOIDED — release reservation and/or restore hard-deducted stock
  if (['CANCELLED','VOIDED'].includes(newStatus)) {
    if (order.stockDeducted) {
      const ok = await customConfirm({
        title: 'Cancel Order?', message: 'Cancelling will restore stock for all line items.',
        okLabel: 'Cancel order', danger: true
      });
      if (!ok) return;
      _restoreSupplyStock(order);
      order.stockDeducted = false;
      _auditSupplyEvent('SUPPLY_STOCK_RESTORED', order);
      if (order.terms === 'consignment') await _adjustConsignmentStock(order, -1);
    } else if (order.reservedStock) {
      _releaseSupplyReservation(order);
      order.reservedStock = false;
      _auditSupplyEvent('SUPPLY_RESERVATION_RELEASED', order);
    }
  }

  // Moving to PAID — create sales record if not already done
  if (newStatus === 'PAID' && !order.salesRecordId) {
    await _createSupplySalesRecord(order, paymentInfo);
    _auditSupplyEvent('SUPPLY_ORDER_PAID', order);
  }

  // If un-paying (moving away from PAID) — warn, no automatic reversal
  if (prevStatus === 'PAID' && newStatus !== 'PAID') {
    const ok = await customConfirm({
      title: 'Move Away From Paid?', message: 'This will not automatically reverse the sales record.',
      okLabel: 'Continue'
    });
    if (!ok) return;
  }

  const note = await customPrompt({
    title: `Note for status change to "${newLabel}"`,
    message: 'Optional — visible in this order’s status history.'
  });
  const timestamp = new Date().toISOString();

  order.status    = newStatus;
  order.updatedAt = timestamp;
  order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  order.statusHistory.push({ status: newStatus, changedAt: timestamp, note,
    changedFrom: prevStatus, changedBy: APP_STATE.currentUserRole || 'STAFF' });
  _auditSupplyEvent(`SUPPLY_STATUS_${newStatus}`, order,
    `Changed from ${prevStatus} → ${newStatus}${note ? ' · ' + note : ''}`);

  updateState('supplyOrders', () => orders);
  renderSupplyTable();
  renderSupplyKPIs();
  if (typeof refreshDashboard === 'function') refreshDashboard();
  showNotification(`Order status set to ${newLabel}`, 'success');

  // Keep the pipeline stepper live if it's still open — the node advances
  // and the new stage picks up its just-recorded timestamp. (The PAID path
  // closes the picker before opening checkout, so this won't re-pop it.)
  const picker = document.getElementById('statusPickerModal');
  if (picker && picker.classList.contains('active')) openStatusPickerModal(order.id);
}

// Keep advanceSupplyStatus as alias for backward compat
async function advanceSupplyStatus(orderId) {
  const order = getSupplyOrders().find(o => String(o.id) === String(orderId));
  if (!order) return;
  openStatusPickerModal(orderId);
}

/* Plain-language description of what setting a given status will DO to this
   order — mirrors the real stock side effects in setSupplyStatus() so the
   picker surfaces them up front instead of only in the confirm dialog.
   Direction-aware: forward transitions describe the action, reversions
   describe the restore. */
function _supplyTransitionEffect(order, target) {
  const curIdx = SUPPLY_STATUSES.indexOf(order.status);
  const tgtIdx = SUPPLY_STATUSES.indexOf(target);
  if (target === 'CANCELLED' || target === 'VOIDED') {
    return order.stockDeducted ? 'Restores all delivered stock, then closes the order'
         : order.reservedStock ? 'Releases the stock reservation, then closes the order'
         : 'Closes the order';
  }
  if (tgtIdx > curIdx || curIdx === -1) {
    switch (target) {
      case 'ORDERED':   return 'Reserves stock for this order';
      case 'DELIVERED': return order.terms === 'consignment'
        ? 'Deducts stock and hands it to the client'
        : 'Deducts stock from inventory';
      case 'INVOICED':  return 'Marks the order as invoiced';
      case 'PAID':      return 'Records the sale and captures payment';
    }
  }
  if (tgtIdx < curIdx) {
    if (order.stockDeducted && curIdx >= SUPPLY_STATUSES.indexOf('DELIVERED'))
      return 'Restores previously delivered stock';
    if (order.reservedStock) return 'Releases the stock reservation';
    return 'Moves the order back to ' + (SUPPLY_STATUS_LABELS[target] || target);
  }
  return '';
}

/* Set Order Status — a vertical pipeline stepper (Draft → Ordered →
   Delivered → Invoiced → Paid) that doubles as a status timeline. Past
   stages show when they happened + the note; the current stage is
   highlighted; the natural next stage is the primary call to action with
   its effect spelled out; later stages are quiet jump-aheads and past
   stages are quiet reverts. Cancel/Void live in a separated danger zone.
   Every actionable element keeps data-action="set-supply-status" +
   data-status, so the existing uiActions dispatch → setSupplyStatus
   (with its customConfirm/customPrompt guards) is unchanged. */
function openStatusPickerModal(orderId) {
  const order = getSupplyOrders().find(o => String(o.id) === String(orderId));
  if (!order) return;
  const body = document.getElementById('statusPickerBody');
  const idInput = document.getElementById('statusPickerOrderId');
  if (idInput) idInput.value = orderId;
  if (!body) { openModal('statusPickerModal'); return; }

  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  // Last matching entry — reflects the most recent time a stage was set
  // (an order can be reverted and re-advanced through the same stage).
  const lastOf = s => { let e = null; history.forEach(h => { if (h.status === s) e = h; }); return e; };
  const fmt = iso => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ' · ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const curIdx   = SUPPLY_STATUSES.indexOf(order.status);
  const terminal = curIdx === -1; // CANCELLED / VOIDED

  let html = `
    <div class="sp-context">
      <div class="sp-ctx-line">
        <span><span class="sp-inv">${escapeHtml(order.invoiceNumber || '')}</span>
          · ${escapeHtml(order.clientName || '')}</span>
        ${supplyStatusBadge(order.status)}
      </div>
    </div>`;

  if (terminal) {
    html += `<div class="sp-halted">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
      This order was ${escapeHtml(SUPPLY_STATUS_LABELS[order.status] || order.status)} — reopen it by picking a stage below.
    </div>`;
  }

  html += `<div class="sp-pipeline">`;
  SUPPLY_STATUSES.forEach((s, i) => {
    const entry = lastOf(s);
    const label = SUPPLY_STATUS_LABELS[s] || s;

    let isDone, isCurrent;
    if (terminal) { isDone = !!entry; isCurrent = false; }
    else { isDone = i < curIdx; isCurrent = i === curIdx; }
    const stepClass = isDone ? 'done' : isCurrent ? 'current' : 'future';

    let inner;
    if (isCurrent) {
      inner = `<div class="sp-row">
        <div class="sp-label">${escapeHtml(label)}</div>
        ${entry ? `<div class="sp-meta">${escapeHtml(fmt(entry.changedAt))}</div>` : ''}
        <span class="sp-tag">Current</span>
        ${order.reservedStock && !order.stockDeducted ? `<div class="sp-reserved">Stock reserved</div>` : ''}
        ${entry && entry.note ? `<div class="sp-note">“${escapeHtml(entry.note)}”</div>` : ''}
      </div>`;
    } else if (isDone) {
      inner = `<button type="button" class="sp-row sp-revert"
        data-action="set-supply-status" data-order-id="${orderId}" data-status="${s}">
        <div class="sp-label" style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
          <span>${escapeHtml(label)}</span><span class="sp-revert-hint">${terminal ? 'Reopen' : 'Revert'}</span></div>
        ${entry ? `<div class="sp-meta">${escapeHtml(fmt(entry.changedAt))}</div>` : ''}
        ${entry && entry.note ? `<div class="sp-note">“${escapeHtml(entry.note)}”</div>` : ''}
      </button>`;
    } else {
      const isNext = !terminal && i === curIdx + 1;
      const effect = _supplyTransitionEffect(order, s);
      inner = `<button type="button" class="sp-row ${isNext ? 'sp-next' : 'sp-jump'}"
        data-action="set-supply-status" data-order-id="${orderId}" data-status="${s}">
        <div class="sp-label">${isNext
          ? `<span>Mark as ${escapeHtml(label)}</span><span class="sp-arrow">→</span>`
          : escapeHtml(label)}</div>
        ${effect ? `<div class="sp-meta">${escapeHtml(effect)}</div>` : ''}
      </button>`;
    }

    html += `<div class="sp-step ${stepClass}">
      <div class="sp-step-rail"><div class="sp-node">${isDone ? '✓' : ''}</div></div>
      <div class="sp-step-body">${inner}</div>
    </div>`;
  });
  html += `</div>`;

  html += `<div class="sp-danger">
    <button type="button" class="sp-danger-btn" data-action="set-supply-status"
      data-order-id="${orderId}" data-status="CANCELLED" ${order.status === 'CANCELLED' ? 'disabled' : ''}>Cancel order</button>
    <button type="button" class="sp-danger-btn" data-action="set-supply-status"
      data-order-id="${orderId}" data-status="VOIDED" ${order.status === 'VOIDED' ? 'disabled' : ''}>Void order</button>
  </div>`;

  body.innerHTML = html;
  openModal('statusPickerModal');
}

/* ── Supply checkout / payment screen — captures a real payment method before
   marking an order PAID, instead of silently stamping 'invoice' with no input ── */
function openSupplyCheckoutModal(orderId) {
  const order = getSupplyOrders().find(o => String(o.id) === String(orderId));
  if (!order) return;

  let m = document.getElementById('supplyCheckoutModal');
  if (!m) { m = document.createElement('div'); m.id = 'supplyCheckoutModal'; m.className = 'modal-overlay'; document.body.appendChild(m); }

  const methods = APP_STATE.settings?.paymentMethods || [];
  const methodOptions = methods.map(mth => {
    const value = mth.name.toLowerCase().replace(/\s+/g, '_');
    return `<option value="${value}">${escapeHtml(mth.name)}</option>`;
  }).join('');

  m.innerHTML = `
    <div class="modal" style="max-width:420px;">
      <h3>Confirm Payment</h3>
      <div class="form-group">
        <label>Order</label>
        <input type="text" readonly value="${escapeHtml(order.invoiceNumber||'')} · ${escapeHtml(order.clientName||'')}" />
      </div>
      <div class="form-group">
        <label>Total Due</label>
        <input id="supplyCheckoutTotal" readonly type="text" class="text-xl" value="${formatCurrency(order.grandTotal||0)}" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Payment Method</label>
          <select id="supplyCheckoutMethod" onchange="_toggleSupplyCheckoutQR()">
            <option value="cash">Cash</option>
            <option value="invoice">Invoice / On Account</option>
            ${methodOptions}
          </select>
        </div>
        <div class="form-group">
          <label>Reference Number <span style="font-size:10px;color:var(--gray-400);font-weight:600;">(optional)</span></label>
          <input id="supplyCheckoutReference" type="text" placeholder="Check #, wire ref…" />
        </div>
      </div>

      <!-- Split payment toggle -->
      <div style="margin-bottom:16px;">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;width:fit-content;">
          <div id="supplySplitToggleTrack"
            onclick="toggleSupplySplitPayment()"
            style="width:36px;height:20px;border-radius:999px;background:var(--gray-200);
              position:relative;cursor:pointer;transition:background var(--transition);flex-shrink:0;">
            <div id="supplySplitToggleThumb"
              style="width:16px;height:16px;border-radius:50%;background:#fff;
                position:absolute;top:2px;left:2px;
                box-shadow:0 1px 3px rgba(0,0,0,.2);
                transition:transform var(--transition);"></div>
          </div>
          <span style="font-size:11px;font-weight:800;color:var(--gray-600);letter-spacing:.3px;">
            Split Payment
          </span>
        </label>
      </div>

      <!-- Split payment second method (hidden by default) -->
      <div id="supplySplitPaymentSection" style="display:none;background:var(--gray-50);
        border:1.5px solid var(--border);border-radius:var(--radius-lg);
        padding:14px 16px;margin-bottom:16px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:1.5px;
          text-transform:uppercase;color:var(--gray-500);margin-bottom:10px;">
          Second Payment
        </div>
        <div class="form-row">
          <div class="form-group" style="margin-bottom:0;">
            <label>Method</label>
            <select id="supplySplitPaymentMethod" onchange="renderSupplySplitPaymentFields()">
              <option value="cash">Cash</option>
              <option value="invoice">Invoice / On Account</option>
              ${methodOptions}
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label>Amount (<span data-curr-sym>₱</span>)</label>
            <input id="supplySplitPaymentAmount" type="number" min="0" step="0.01"
              placeholder="0.00" oninput="updateSupplySplitAmounts()" />
          </div>
        </div>
        <div class="form-group" id="supplySplitReferenceWrap" style="display:none;margin-top:12px;margin-bottom:0;">
          <label>Reference Number</label>
          <input id="supplySplitPaymentReference" type="text" placeholder="Reference ID" />
        </div>
        <div style="margin-top:10px;font-size:11px;color:var(--gray-500);font-weight:700;">
          Remaining on first method:
          <span id="supplySplitFirstAmount" style="color:var(--black);font-weight:900;">₱0.00</span>
        </div>
      </div>

      <div id="supplyCheckoutQrSection" style="display:none;text-align:center;margin-bottom:16px;">
        <div class="payment-badge" id="supplyCheckoutQrBadge">QR PAYMENT</div>
        <div style="display:flex;justify-content:center;">
          <img id="supplyCheckoutQrImage" src=""
            style="width:180px;border:1px solid var(--border);padding:10px;
              background:#fff;border-radius:12px;object-fit:contain;
              display:none;margin:0 auto;" />
          <div id="supplyCheckoutQrFallback"
            style="width:180px;height:180px;border:1px solid var(--border);
              border-radius:12px;background:var(--gray-50);display:flex;align-items:center;
              justify-content:center;font-size:12px;color:var(--gray-400);
              text-align:center;padding:16px;">
            No QR uploaded.<br>Add one in Settings.
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" type="button" onclick="closeModal('supplyCheckoutModal')">Cancel</button>
        <button class="btn" type="button" data-action="confirm-supply-checkout"
          data-id="${orderId}">Confirm Payment</button>
      </div>
    </div>`;

  openModal('supplyCheckoutModal');
  _toggleSupplyCheckoutQR();
  _resetSupplySplitPayment();

  // If the client picked a payment method on their order form, prefill it
  if (order.clientPaymentMethod) {
    const sel = document.getElementById('supplyCheckoutMethod');
    if (sel) {
      const wanted = order.clientPaymentMethod === 'Invoice / On Account'
        ? 'invoice'
        : order.clientPaymentMethod.toLowerCase().replace(/\s+/g, '_');
      if ([...sel.options].some(o => o.value === wanted)) {
        sel.value = wanted;
        _toggleSupplyCheckoutQR();
      }
    }
    const refEl = document.getElementById('supplyCheckoutReference');
    if (refEl && order.clientPaymentReference) refEl.value = order.clientPaymentReference;
  }
}

/* Shows the selected payment method's QR code, mirroring togglePaymentFields()
   in sales.js for the POS checkout — same APP_STATE.settings.paymentMethods
   lookup, same qrImage/fallback pattern. */
function _toggleSupplyCheckoutQR() {
  const method  = document.getElementById('supplyCheckoutMethod')?.value || 'cash';
  const section = document.getElementById('supplyCheckoutQrSection');
  if (!section) return;

  const methods = APP_STATE.settings?.paymentMethods || [];
  const matched = methods.find(m => m.name.toLowerCase().replace(/\s+/g, '_') === method);
  const showQR  = matched?.type === 'qr' && matched?.qrImage;

  section.style.display = showQR ? 'block' : 'none';
  if (!showQR) return;

  const badge = document.getElementById('supplyCheckoutQrBadge');
  if (badge) badge.textContent = (matched?.name || 'QR').toUpperCase() + ' PAYMENT';

  const img      = document.getElementById('supplyCheckoutQrImage');
  const fallback = document.getElementById('supplyCheckoutQrFallback');
  if (img)      { img.src = matched.qrImage; img.style.display = 'block'; }
  if (fallback) fallback.style.display = 'none';
}

/* ═══════════════════════════════════════════════════════
   SUPPLY CHECKOUT — SPLIT PAYMENT
   Mirrors the POS checkout's split-payment mechanism in sales.js
   (_splitActive/toggleSplitPayment/getSplitPaymentData), namespaced
   to the Supply checkout modal so the two don't share state.
═══════════════════════════════════════════════════════ */
let _supplySplitActive = false;

function _resetSupplySplitPayment() {
  _supplySplitActive = false;
  const track   = document.getElementById('supplySplitToggleTrack');
  const thumb   = document.getElementById('supplySplitToggleThumb');
  const section = document.getElementById('supplySplitPaymentSection');
  if (track)   { track.style.background = 'var(--gray-200)'; }
  if (thumb)   { thumb.style.transform = 'translateX(0)'; }
  if (section) { section.style.display = 'none'; }
  const amtEl = document.getElementById('supplySplitPaymentAmount');
  const refEl = document.getElementById('supplySplitPaymentReference');
  if (amtEl) amtEl.value = '';
  if (refEl) refEl.value = '';
}

function toggleSupplySplitPayment() {
  _supplySplitActive = !_supplySplitActive;
  const track   = document.getElementById('supplySplitToggleTrack');
  const thumb   = document.getElementById('supplySplitToggleThumb');
  const section = document.getElementById('supplySplitPaymentSection');

  if (_supplySplitActive) {
    if (track)   { track.style.background = 'var(--black)'; }
    if (thumb)   { thumb.style.transform = 'translateX(16px)'; }
    if (section) { section.style.display = 'block'; }
    renderSupplySplitPaymentFields();
    updateSupplySplitAmounts();
  } else {
    _resetSupplySplitPayment();
  }
}

function renderSupplySplitPaymentFields() {
  const method    = document.getElementById('supplySplitPaymentMethod')?.value || '';
  const refWrap   = document.getElementById('supplySplitReferenceWrap');
  const isCashLike = method === 'cash' || method === 'invoice' || method === '';
  if (refWrap) refWrap.style.display = isCashLike ? 'none' : 'block';
}

function updateSupplySplitAmounts() {
  if (!_supplySplitActive) return;
  const total    = Number(document.getElementById('supplyCheckoutTotal')?.value?.replace(/[^0-9.]/g, '') || 0);
  const splitEl  = document.getElementById('supplySplitPaymentAmount');
  const firstEl  = document.getElementById('supplySplitFirstAmount');
  const splitAmt = parseMoney(splitEl?.value || '0');
  const firstAmt = Math.max(0, total - splitAmt);
  if (firstEl) firstEl.textContent = formatCurrency(firstAmt);
}

function isSupplySplitActive() { return _supplySplitActive; }

function getSupplySplitPaymentData() {
  if (!_supplySplitActive) return null;
  const method    = document.getElementById('supplySplitPaymentMethod')?.value || 'cash';
  const amount    = parseMoney(document.getElementById('supplySplitPaymentAmount')?.value || '0');
  const reference = document.getElementById('supplySplitPaymentReference')?.value?.trim() || '';
  return { method, amount, reference };
}

function confirmSupplyCheckout(orderId) {
  const method    = document.getElementById('supplyCheckoutMethod')?.value || 'invoice';
  const reference = document.getElementById('supplyCheckoutReference')?.value?.trim() || '';

  const paymentInfo = { method, reference };

  if (isSupplySplitActive()) {
    const order = getSupplyOrders().find(o => String(o.id) === String(orderId));
    const total = Number(order?.grandTotal || 0);
    const split = getSupplySplitPaymentData();
    if (!split || split.amount <= 0) {
      showNotification('Enter the split payment amount', 'error'); return;
    }
    if (split.amount >= total) {
      showNotification('Split amount must be less than the total', 'error'); return;
    }
    paymentInfo.splitMethod    = split.method;
    paymentInfo.splitAmount    = split.amount;
    paymentInfo.splitReference = split.reference || '';
  }

  closeModal('supplyCheckoutModal');
  setSupplyStatus(orderId, 'PAID', paymentInfo);
}

/* Push a supply order's line items into a new (pre-filled) production job for
   review. Opens the standard production job modal; the job is only created when
   the user hits Save. Gated behind Production Mode. */
function pushSupplyOrderToProduction(orderId) {
  if (!APP_STATE.settings?.productionModeEnabled) return;
  const order = getSupplyOrders().find(o => String(o.id) === String(orderId));
  if (!order) return;
  if (!Array.isArray(order.items) || !order.items.length) {
    showNotification('This order has no items to produce', 'error');
    return;
  }
  if (typeof openProductionJobFromSupplyOrder !== 'function') {
    showNotification('Production module unavailable', 'error');
    return;
  }
  openProductionJobFromSupplyOrder(order);
}

/* Jump to the production job an order was already pushed to. */
function viewSupplyOrderProductionJob(orderId) {
  const order = getSupplyOrders().find(o => String(o.id) === String(orderId));
  if (!order || !order.productionJobId) return;
  const job = typeof getProductionJobById === 'function'
    ? getProductionJobById(order.productionJobId) : null;
  if (!job) {
    showNotification('That production job was deleted', 'warning');
    return;
  }
  if (typeof switchPage === 'function') switchPage('production');
  if (typeof openProductionJobModal === 'function') openProductionJobModal(order.productionJobId);
}

function cancelSupplyOrder(orderId) {
  if (!confirm('Cancel this supply order?')) return;
  const orders = getSupplyOrders();
  const order  = orders.find(o => String(o.id) === String(orderId));
  if (!order) return;

  // Restore hard-deducted stock, or just release a soft reservation
  if (order.stockDeducted) {
    _restoreSupplyStock(order);
    order.stockDeducted = false;
    order.reservedStock = false;
  } else if (order.reservedStock) {
    _releaseSupplyReservation(order);
    order.reservedStock = false;
  }

  const timestamp = new Date().toISOString();
  order.status    = 'CANCELLED';
  order.updatedAt = timestamp;
  order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  order.statusHistory.push({ status: 'CANCELLED', changedAt: timestamp, note: 'Manually cancelled' });
  _auditSupplyEvent('SUPPLY_ORDER_CANCELLED', order);
  _auditSupplyEvent('SUPPLY_STOCK_RESTORED', order);

  updateState('supplyOrders', () => orders);
  renderSupplyTable();
  showNotification('Order cancelled — reservation released', 'success');
}

/* ═══════════════════════════════════════════════════════
   STATUS BADGE
═══════════════════════════════════════════════════════ */

function supplyStatusBadge(status) {
  const styles = {
    DRAFTED:   'background:#f4f4f4;color:#555;border:1px solid #e0e0e0;',
    ORDERED:   'background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;',
    DELIVERED: 'background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;',
    INVOICED:  'background:#fdf4ff;color:#7e22ce;border:1px solid #e9d5ff;',
    PAID:      'background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;',
    CANCELLED: 'background:#f9fafb;color:#9ca3af;border:1px solid #e5e7eb;',
    VOIDED:    'background:#f9fafb;color:#9ca3af;border:1px solid #e5e7eb;'
  };
  const style = styles[status] || styles.DRAFTED;
  return `<span style="display:inline-flex;align-items:center;padding:3px 10px;
    border-radius:999px;font-size:9px;font-weight:800;letter-spacing:1px;
    text-transform:uppercase;${style}">${escapeHtml(SUPPLY_STATUS_LABELS[status] || status)}</span>`;
}

/* ═══════════════════════════════════════════════════════
   SUPPLY TABLE RENDER
═══════════════════════════════════════════════════════ */

function renderSupplyTable() {
  const tbody = document.querySelector('#supplyTable tbody');
  if (!tbody) return;

  // Any open row-menu dropdown lives in <body>, detached from this table —
  // clean it up before the rows underneath it get replaced.
  document.querySelectorAll('.row-menu-dropdown').forEach(el => el.remove());

  const statusFilter = document.getElementById('supplyStatusFilter')?.value || '';
  const clientFilter = document.getElementById('supplyClientFilter')?.value || '';
  const fromDate = document.getElementById('supplyFromDate')?.value
    ? new Date(`${document.getElementById('supplyFromDate').value}T00:00:00`) : null;
  const toDate = document.getElementById('supplyToDate')?.value
    ? new Date(`${document.getElementById('supplyToDate').value}T23:59:59`) : null;

  const orders = getSupplyOrders().filter(o => {
    const d = new Date(o.orderDate || o.createdAt);
    if (fromDate && d < fromDate) return false;
    if (toDate   && d > toDate)   return false;
    if (statusFilter && o.status !== statusFilter) return false;
    if (clientFilter && o.clientId !== clientFilter) return false;
    return true;
  });

  tbody.innerHTML = '';

  if (!orders.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No supply orders found</td></tr>`;
    return;
  }


  let ctl=document.getElementById('supplyTableControls');
  if(!ctl){
    ctl=document.createElement('div');
    ctl.id='supplyTableControls';
    tbody.parentElement.appendChild(ctl);
  }
  const allOrders = orders.slice().reverse();
  const limit     = window.supplyTableLimit || 5;

  allOrders.slice(0, limit).forEach(order => {
    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    const getTs   = status => {
      const e = history.find(h => h.status === status);
      return e ? new Date(e.changedAt).toLocaleDateString('en-PH',
        { month:'short', day:'numeric', year:'2-digit' }) : '—';
    };

    const isPaid      = order.status === 'PAID';
    const isCancelled = ['CANCELLED','VOIDED'].includes(order.status);
    const canAdvance  = !isPaid && !isCancelled;

    // Item summary — product names
    const itemSummary = (order.items||[])
      .map(i => `${escapeHtml(i.productName||i.description||'')} ×${i.qty}`)
      .join(', ');

    // Push to Production — only when Production Mode is enabled. Once pushed and
    // the job saved, the order remembers its job (order.productionJobId) and the
    // item flips to "View Production Job". Job existence is checked here so a
    // deleted job cleanly falls back to "Push".
    let prodMenuItem = '';
    if (APP_STATE.settings?.productionModeEnabled) {
      const prodJob = order.productionJobId && typeof getProductionJobById === 'function'
        ? getProductionJobById(order.productionJobId) : null;
      prodMenuItem = prodJob
        ? `<button type="button" data-action="view-production-job" data-id="${order.id}">View Production Job</button>`
        : `<button type="button" data-action="push-to-production" data-id="${order.id}">Push to Production</button>`;
    }

    tbody.innerHTML += `
      <tr>
        <td style="font-family:var(--font-mono);font-size:12px;font-weight:700;white-space:nowrap;">
          ${escapeHtml(order.invoiceNumber||'—')}</td>
        <td style="font-weight:700;font-size:13px;">${escapeHtml(order.clientName||'—')}</td>
        <td style="font-size:12px;color:var(--gray-500);max-width:160px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${itemSummary}">
          ${itemSummary||'—'}</td>
        <td style="font-weight:800;font-size:14px;font-variant-numeric:tabular-nums;white-space:nowrap;">
          ${formatCurrency(order.grandTotal||0)}</td>
        <td>
          <div>${supplyStatusBadge(order.status)}</div>
          ${order.reservedStock && !order.stockDeducted
            ? `<div style="font-size:9px;color:#c2410c;font-weight:700;letter-spacing:.5px;margin-top:4px;">STOCK RESERVED</div>` : ''}
        </td>
        <td>
          <div class="table-actions">
            <button class="btn btn-sm btn-secondary" data-action="view-supply-order"
              data-id="${order.id}">View</button>
            <button class="btn btn-sm" data-action="open-status-picker"
              data-id="${order.id}">Set Status</button>
            ${canAdvance && !order.salesRecordId
              ? `<button class="btn btn-sm btn-secondary" data-action="open-supply-checkout"
                  data-id="${order.id}">Checkout</button>`
              : `<span aria-hidden="true"></span>`}
            <div class="row-menu">
              <button type="button" class="row-menu-btn" data-action="toggle-supply-row-menu"
                data-menu-scope="order" data-id="${order.id}" aria-label="More actions">⋯</button>
              <template class="row-menu-template">
                <div class="row-menu-dropdown">
                  <button type="button" data-action="edit-supply-order"
                    data-id="${order.id}">Edit</button>
                  ${prodMenuItem}
                  ${canAdvance
                    ? `<button type="button" data-action="cancel-supply-order"
                        data-id="${order.id}">Cancel</button>` : ''}
                  <button type="button" class="danger" data-action="delete-supply-order"
                    data-id="${order.id}">Delete</button>
                </div>
              </template>
            </div>
          </div>
        </td>
      </tr>`;
  });

  // See more
  if (typeof _renderSeeMore === 'function') {
    _renderSeeMore(
      'supplySeeMore', allOrders.length, limit,
      () => { window.supplyTableLimit = (window.supplyTableLimit||5)+5; renderSupplyTable(); },
      () => { window.supplyTableLimit = 5; renderSupplyTable(); }
    );
  }
}

/* ── Row overflow menu (Edit / Cancel / Delete) ──
   Appended to <body> and positioned with position:fixed via getBoundingClientRect —
   the table's overflow-x:auto scroll container clips overflow-y too (a CSS quirk),
   so a dropdown nested inside the row would be invisibly clipped. */
function toggleSupplyRowMenu(rowId, scope = 'order') {
  // Scoped by list — the orders table and the clients list both render
  // .row-menu-btn, so a bare [data-id] lookup could match the wrong row.
  const sel = `.row-menu-btn[data-menu-scope="${scope}"][data-id="${rowId}"]`;
  const wasOpen = document.querySelector(sel)?.dataset.menuOpen === 'true';
  document.querySelectorAll('.row-menu-dropdown').forEach(el => el.remove());
  document.querySelectorAll('.row-menu-btn').forEach(b => b.dataset.menuOpen = 'false');
  if (wasOpen) return;

  const btn = document.querySelector(sel);
  const template = btn?.parentElement.querySelector('.row-menu-template');
  if (!btn || !template) return;

  const dropdown = template.content.firstElementChild.cloneNode(true);
  document.body.appendChild(dropdown);
  dropdown.classList.add('open');

  const rect = btn.getBoundingClientRect();
  dropdown.style.top  = `${rect.bottom + 4}px`;
  dropdown.style.left = `${Math.max(8, rect.right - dropdown.offsetWidth)}px`;

  btn.dataset.menuOpen = 'true';
}
if (!window._supplyRowMenuOutsideClickBound) {
  window._supplyRowMenuOutsideClickBound = true;
  document.addEventListener('click', event => {
    if (event.target.closest('.row-menu')) return;
    document.querySelectorAll('.row-menu-dropdown').forEach(el => el.remove());
    document.querySelectorAll('.row-menu-btn').forEach(b => b.dataset.menuOpen = 'false');
  });
}

/* ═══════════════════════════════════════════════════════
   KPI CARDS
═══════════════════════════════════════════════════════ */

function renderSupplyKPIs() {
  const orders  = getSupplyOrders();
  const total   = orders.reduce((s,o) => s + Number(o.grandTotal||0), 0);
  const paid    = orders.filter(o => o.status==='PAID')
                        .reduce((s,o) => s + Number(o.grandTotal||0), 0);
  const pending = orders.filter(o => !['PAID','CANCELLED','VOIDED'].includes(o.status)).length;
  const awaitingPayment = orders.filter(o =>
    ['DELIVERED','INVOICED'].includes(o.status)).length;

  const set = (id,v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  set('supplyTotalRevenue',  formatCurrency(total));
  set('supplyTotalPaid',     formatCurrency(paid));
  set('supplyPendingCount',  pending);
  set('supplyOverdueCount',  awaitingPayment);
}

/* ═══════════════════════════════════════════════════════
   CSV EXPORT
═══════════════════════════════════════════════════════ */

function exportSupplyCSV() {
  const orders = getSupplyOrders();
  if (!orders.length) { showNotification('No orders to export', 'error'); return; }

  const getTs = (order, status) => {
    const e = (order.statusHistory||[]).find(h => h.status === status);
    return e ? new Date(e.changedAt).toLocaleString('en-PH') : '';
  };

  const headers = ['Invoice #','Client','Order Date','Products','Grand Total',
    'Status','Stock Reserved','Stock Deducted',
    'Drafted At','Ordered At','Delivered At','Invoiced At','Paid At',
    'Cancelled At','Notes'];

  const rows = orders.map(o => {
    const productSummary = (o.items||[])
      .map(i => `${i.productName||i.description||''} x${round2(i.qty)} @${round2(i.unitPrice)}`)
      .join('; ');
    return [
      `"${o.invoiceNumber||''}"`,
      `"${o.clientName||''}"`,
      `"${o.orderDate||''}"`,
      `"${productSummary}"`,
      Number(o.grandTotal||0).toFixed(2),
      `"${o.status||''}"`,
      o.reservedStock ? 'YES' : 'NO',
      o.stockDeducted ? 'YES' : 'NO',
      `"${getTs(o,'DRAFTED')}"`,
      `"${getTs(o,'ORDERED')}"`,
      `"${getTs(o,'DELIVERED')}"`,
      `"${getTs(o,'INVOICED')}"`,
      `"${getTs(o,'PAID')}"`,
      `"${getTs(o,'CANCELLED')}"`,
      `"${(o.notes||'').replace(/"/g,'""')}"`
    ].join(',');
  });

  downloadTextFile(
    `supply-orders-${new Date().toISOString().slice(0,10)}.csv`,
    [headers.join(','), ...rows].join('\n')
  );
  showNotification('Supply orders exported', 'success');
}

/* ═══════════════════════════════════════════════════════
   CART → SUPPLY ORDER CONVERSION
═══════════════════════════════════════════════════════ */

function openSupplierOrderPrompt() {
  const cart    = typeof getCart === 'function' ? getCart() : [];
  const clients = getSupplierClients();

  if (!cart.length)    { showNotification('Cart is empty', 'error'); return; }
  if (!clients.length) { showNotification('Add a client in the Supply tab first', 'error'); return; }

  renderClientDropdowns();
  setElementValue('supplierOrderInvoiceNum',    generateInvoiceNumber());
  setElementValue('supplierOrderDeliveryDate',
    new Date(Date.now() + 86400000).toISOString().slice(0,10));
  setElementValue('supplierOrderNotes', '');

  renderSupplierOrderCartSummary(cart);
  openModal('supplierOrderPromptModal');
}

function renderSupplierOrderCartSummary(cart) {
  const container = document.getElementById('supplierOrderCartSummary');
  const totalEl   = document.getElementById('supplierOrderCartTotal');
  if (!container) return;

  let grandTotal = 0;
  container.innerHTML = cart.map(item => {
    const lineTotal = Number(item.price||0) * Number(item.quantity||0);
    grandTotal += lineTotal;
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;
        padding:5px 0;border-bottom:1px solid var(--border);font-size:12px;">
        <div>
          <span style="font-weight:700;">${escapeHtml(item.name)}</span>
          <span style="color:var(--gray-400);margin-left:6px;">
            ×${item.quantity} @ ${formatCurrency(item.price)}
          </span>
        </div>
        <span style="font-weight:800;">${formatCurrency(lineTotal)}</span>
      </div>`;
  }).join('');

  if (totalEl) totalEl.textContent = formatCurrency(grandTotal);
}

function confirmSupplierOrder() {
  const cart         = typeof getCart === 'function' ? getCart() : [];
  const clientId     = document.getElementById('supplierOrderClientSelect')?.value || '';
  const notes        = sanitizeText(getElementValue('supplierOrderNotes'));
  const deliveryDate = getElementValue('supplierOrderDeliveryDate');
  const invoiceNumber= getElementValue('supplierOrderInvoiceNum');

  if (!cart.length) { showNotification('Cart is empty', 'error'); return; }
  if (!clientId)    { showNotification('Please select a client', 'error'); return; }

  const client    = getSupplierClients().find(c => String(c.id) === String(clientId));
  const timestamp = new Date().toISOString();

  // Cart items are already product-linked — convert directly
  const items = cart.map(item => ({
    productId:   item.productId,
    productName: item.name,
    description: item.name,
    qty:         Number(item.quantity||0) * Number(item.multiplier||1),
    unitPrice:   Number(item.price||0),
    total:       Number(item.price||0) * Number(item.quantity||0),
    multiplier:  1
  }));

  const subtotal   = items.reduce((s,i) => s + i.total, 0);
  const discount   = typeof calculateCartDiscount === 'function' ? calculateCartDiscount() : 0;
  const tax        = typeof calculateCartTax      === 'function' ? calculateCartTax()      : 0;
  const grandTotal = Math.max(0, subtotal - discount + tax);

  const newOrder = {
    id: generateId(), invoiceNumber, clientId,
    clientName:   client?.name || '',
    orderDate:    new Date().toISOString().slice(0,10),
    deliveryDate: deliveryDate || '',
    notes, items, subtotal, discount, tax, grandTotal,
    status:        'ORDERED',
    reservedStock: false,
    stockDeducted: false,
    statusHistory: [
      { status:'DRAFTED',  changedAt: timestamp, note:'Auto-created from POS cart' },
      { status:'ORDERED',  changedAt: timestamp,
        note:`Converted from POS cart by ${APP_STATE.currentUserRole||'STAFF'}` }
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
    source:    'pos-cart'
  };

  // Deduct stock immediately since status starts at ORDERED
  _auditSupplyEvent('SUPPLY_ORDER_CREATED', newOrder);
  _deductSupplyStock(newOrder);
  newOrder.stockDeducted = true;
  newOrder.reservedStock = false;
  _auditSupplyEvent('SUPPLY_ORDER_ORDERED', newOrder);
  _auditSupplyEvent('SUPPLY_STOCK_DEDUCTED', newOrder);

  const orders = getSupplyOrders();
  orders.push(newOrder);
  updateState('supplyOrders', () => orders);

  if (typeof clearCart === 'function') clearCart(true);
  closeModal('supplierOrderPromptModal');
  renderSupplyTable();
  renderSupplyKPIs();
  showNotification(
    `Supply order ${invoiceNumber} created for ${client?.name||'client'} — stock reserved`,
    'success'
  );
}

/* ═══════════════════════════════════════════════════════
   NAV / CART BUTTON TOGGLE
═══════════════════════════════════════════════════════ */

function applySupplierModeToggle() {
  const enabled = APP_STATE.settings?.supplierModeEnabled === true;
  const navBtn  = document.getElementById('navSupply');
  if (navBtn) navBtn.style.display = enabled ? '' : 'none';
  if (typeof updateOpsNavGroup === 'function') updateOpsNavGroup();
  if (typeof applySupplierCartButton === 'function') applySupplierCartButton();
  // Start the portal/report polling here too, not just on visiting Supply —
  // otherwise the nav badge and "new order/report" toast stay dormant for
  // the whole session until the owner happens to click into Supply first.
  if (enabled) {
    initPortalInboxPolling();
    initReportInboxPolling();
  }
}

function applySupplierCartButton() {
  const btn     = document.getElementById('supplierOrderBtn');
  const enabled = APP_STATE.settings?.supplierModeEnabled === true;
  if (btn) btn.style.display = enabled ? 'block' : 'none';
}

function renderSupplyView() {
  renderSupplyKPIs();
  renderSupplyTable();
  renderClientDropdowns();
  renderClientsList();
  initPortalInboxPolling();
  initReportInboxPolling();
  updatePortalInboxBadge();

  const filterClients = document.getElementById('supplyClientFilter');
  if (filterClients) {
    const clients = getSupplierClients();
    filterClients.innerHTML = `<option value="">All Clients</option>` +
      clients.map(c =>
        `<option value="${c.id}">${escapeHtml(c.name)}</option>`
      ).join('');
  }
}

/* ── Exports ── */
window.getSupplyOrders          = getSupplyOrders;
window.getSupplierClients       = getSupplierClients;
window.saveSupplierClient       = saveSupplierClient;
window.deleteSupplierClient     = deleteSupplierClient;
window.openClientModal          = openClientModal;
window.renderClientsList        = renderClientsList;
window.renderClientDropdowns    = renderClientDropdowns;
window.openSupplyOrderModal     = openSupplyOrderModal;
window.saveSupplyOrder          = saveSupplyOrder;
window.deleteSupplyOrder        = deleteSupplyOrder;
window.advanceSupplyStatus      = advanceSupplyStatus;
window.setSupplyStatus          = setSupplyStatus;
window.openStatusPickerModal    = openStatusPickerModal;
window.cancelSupplyOrder        = cancelSupplyOrder;
window.addSupplyLineItemRow     = addSupplyLineItemRow;
window.renderSupplyTable        = renderSupplyTable;
window.renderSupplyKPIs         = renderSupplyKPIs;
window.renderSupplyView         = renderSupplyView;
window.exportSupplyCSV          = exportSupplyCSV;
window.applySupplierModeToggle  = applySupplierModeToggle;
window.applySupplierCartButton  = applySupplierCartButton;
window.initReportInboxPolling   = initReportInboxPolling;
window.acceptPortalReport       = acceptPortalReport;
window.openConsignmentLedger    = openConsignmentLedger;
window.openSupplierOrderPrompt  = openSupplierOrderPrompt;
window.confirmSupplierOrder     = confirmSupplierOrder;
window.openClientPortalModal          = openClientPortalModal;
window.checkPortalInbox               = checkPortalInbox;
window.initPortalInboxPolling         = initPortalInboxPolling;
window.updatePortalInboxBadge         = updatePortalInboxBadge;
window.updatePortalPricePreviews      = updatePortalPricePreviews;
window.togglePortalIncludeAll         = togglePortalIncludeAll;
window.setPortalPricingMode           = setPortalPricingMode;
window.saveClientPortalConfig         = saveClientPortalConfig;
window.shareClientPortal              = shareClientPortal;
window.revokeClientPortal             = revokeClientPortal;
window.copyPortalLink                 = copyPortalLink;
window.toggleSupplySplitPayment       = toggleSupplySplitPayment;
window.renderSupplySplitPaymentFields = renderSupplySplitPaymentFields;
window.updateSupplySplitAmounts       = updateSupplySplitAmounts;
window.isSupplySplitActive            = isSupplySplitActive;
window.getSupplySplitPaymentData      = getSupplySplitPaymentData;
window.confirmSupplyCheckout          = confirmSupplyCheckout;
window.openSupplyCheckoutModal        = openSupplyCheckoutModal;

window.openSupplyOrderView = openSupplyOrderView;

function openSupplyOrderView(orderId) {
  const order = getSupplyOrderById(orderId);
  if (!order) return;

  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const items   = Array.isArray(order.items) ? order.items : [];

  const statusRows = SUPPLY_STATUSES.map(s => {
    const entry = history.find(h => h.status === s);
    if (!entry) return `
      <div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:11px;font-weight:700;color:var(--gray-300);min-width:110px;">${SUPPLY_STATUS_LABELS[s]}</span>
        <span style="font-size:11px;color:var(--gray-300);">—</span>
      </div>`;
    const d = new Date(entry.changedAt);
    return `
      <div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);">
        <span style="font-size:11px;font-weight:800;color:var(--black);min-width:110px;">${SUPPLY_STATUS_LABELS[s]}</span>
        <div>
          <div style="font-size:11px;font-weight:700;">
            ${d.toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'})}
            ${d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}
          </div>
          ${entry.note ? `<div style="font-size:11px;color:var(--gray-400);margin-top:2px;">${escapeHtml(entry.note)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  const itemRows = items.map(item => `
    <tr>
      <td style="padding:8px 10px;font-size:13px;font-weight:700;border-bottom:1px solid var(--border);
        max-width:180px;word-break:break-word;">
        ${escapeHtml(item.productName||item.description||'—')}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:right;border-bottom:1px solid var(--border);
        font-variant-numeric:tabular-nums;white-space:nowrap;">${item.qty}</td>
      <td style="padding:8px 10px;font-size:13px;text-align:right;border-bottom:1px solid var(--border);
        font-variant-numeric:tabular-nums;white-space:nowrap;">${formatCurrency(item.unitPrice||0)}</td>
      <td style="padding:8px 10px;font-size:13px;font-weight:800;text-align:right;
        border-bottom:1px solid var(--border);font-variant-numeric:tabular-nums;white-space:nowrap;">
        ${formatCurrency(item.total||0)}</td>
    </tr>`).join('');

  const container = document.getElementById('supplyOrderViewContent');
  if (!container) return;

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
      <div>
        <div style="font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--gray-400);margin-bottom:3px;">Invoice #</div>
        <div style="font-size:15px;font-weight:900;font-family:var(--font-mono);">${escapeHtml(order.invoiceNumber||'—')}</div>
      </div>
      <div>
        <div style="font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--gray-400);margin-bottom:3px;">Client</div>
        <div style="font-size:15px;font-weight:900;">${escapeHtml(order.clientName||'—')}</div>
      </div>
      <div>
        <div style="font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--gray-400);margin-bottom:3px;">Order Date</div>
        <div style="font-size:13px;font-weight:700;">${order.orderDate ? new Date(order.orderDate).toLocaleDateString('en-PH',{month:'long',day:'numeric',year:'numeric'}) : '—'}</div>
      </div>
      <div>
        <div style="font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--gray-400);margin-bottom:3px;">Status</div>
        <div>${supplyStatusBadge(order.status)}</div>
      </div>
    </div>

    <div style="font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--gray-400);margin-bottom:8px;">Order Items</div>
    <div style="border:1px solid var(--border);border-radius:var(--radius-lg);overflow-x:auto;overflow-y:hidden;margin-bottom:20px;">
      <table style="width:100%;border-collapse:collapse;min-width:420px;">
        <thead>
          <tr style="background:var(--gray-50);">
            <th style="padding:8px 10px;text-align:left;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--gray-400);font-weight:800;">Product</th>
            <th style="padding:8px 10px;text-align:right;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--gray-400);font-weight:800;white-space:nowrap;">Qty</th>
            <th style="padding:8px 10px;text-align:right;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--gray-400);font-weight:800;white-space:nowrap;">Price</th>
            <th style="padding:8px 10px;text-align:right;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--gray-400);font-weight:800;white-space:nowrap;">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
    </div>

    <div style="background:var(--gray-50);border-radius:var(--radius-lg);padding:14px 16px;margin-bottom:20px;">
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:var(--gray-500);font-weight:600;">
        <span>Subtotal</span><span style="font-weight:700;color:var(--black);">${formatCurrency(order.subtotal||0)}</span>
      </div>
      ${(order.discount||0) > 0 ? `
      <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:var(--gray-500);font-weight:600;">
        <span>Discount</span><span style="font-weight:700;color:#dc2626;">-${formatCurrency(order.discount||0)}</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;padding:8px 0 4px;font-size:17px;font-weight:900;border-top:1.5px solid var(--border);margin-top:6px;">
        <span>Grand Total</span>
        <span style="font-variant-numeric:tabular-nums;">${formatCurrency(order.grandTotal||0)}</span>
      </div>
    </div>

    <div style="font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--gray-400);margin-bottom:8px;">Status Timeline</div>
    <div style="margin-bottom:20px;">${statusRows}</div>

    ${order.clientPaymentMethod ? `
    <div style="font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--gray-400);margin-bottom:8px;">Client Payment</div>
    <div style="background:var(--gray-50);border:1.5px solid var(--border);border-radius:var(--radius-lg);
      padding:12px 14px;margin-bottom:20px;">
      <div style="font-size:13px;font-weight:800;">
        ${escapeHtml(order.clientPaymentMethod)}
        ${order.clientPaymentReference ? `<span style="font-weight:600;color:var(--gray-400);"> · ref ${escapeHtml(order.clientPaymentReference)}</span>` : ''}
      </div>
      ${order.clientPaymentSplit === 'half' ? `
      <div style="font-size:12px;font-weight:700;margin-top:4px;">
        <span style="color:#15803d;">50% downpayment: ${formatCurrency(round2((order.grandTotal||0)/2))}</span>
        <span style="color:var(--gray-400);"> · balance ${formatCurrency((order.grandTotal||0) - round2((order.grandTotal||0)/2))} on delivery</span>
      </div>` : order.clientPaymentSplit === 'full' ? `
      <div style="font-size:12px;font-weight:700;color:#15803d;margin-top:4px;">Paid in full</div>` : ''}
      ${order.clientPaymentMethod2 ? `
      <div style="font-size:12px;font-weight:700;margin-top:4px;">
        <span style="color:var(--gray-400);">Split payment: </span>
        <span style="color:#15803d;">${formatCurrency(Math.max(0, (order.grandTotal||0) - order.clientPaymentAmount2))} via ${escapeHtml(order.clientPaymentMethod)}</span>
        <span style="color:var(--gray-400);"> + </span>
        <span style="color:#15803d;">${formatCurrency(order.clientPaymentAmount2)} via ${escapeHtml(order.clientPaymentMethod2)}</span>
        ${order.clientPaymentReference2 ? `<span style="color:var(--gray-400);"> (ref ${escapeHtml(order.clientPaymentReference2)})</span>` : ''}
      </div>` : ''}
      ${order.clientPaymentProof ? `
      <div style="margin-top:10px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--gray-400);margin-bottom:6px;">Payment Screenshot</div>
        <img src="${escapeHtml(order.clientPaymentProof)}" alt="Payment proof"
          style="max-width:min(320px,100%);max-height:380px;border:1.5px solid var(--border);
            border-radius:10px;display:block;" />
      </div>` : ''}
    </div>` : ''}

    ${order.notes ? `
    <div style="font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--gray-400);margin-bottom:8px;">Notes</div>
    <div style="background:#fffbeb;border:1.5px solid #fcd34d;border-radius:var(--radius-md);
      padding:12px 14px;font-size:13px;font-weight:500;line-height:1.6;white-space:pre-wrap;">
      ${escapeHtml(order.notes)}</div>` : ''}
  `;

  openModal('supplyOrderViewModal');
}
