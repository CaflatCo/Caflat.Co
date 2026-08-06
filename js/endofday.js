/* ═══════════════════════════════════════════════════════
   ENDOFDAY.JS — End of Day Summary
   Shows today's revenue, top sellers, production,
   FG remaining, low stock, and suggestions.
   Accessible from Dashboard.
═══════════════════════════════════════════════════════ */

function openEndOfDaySummary() {
  _eodEditingDay = null; // always open on the closed/summary view, not mid-edit
  _renderEndOfDayContent();
  openModal('endOfDayModal');
}

function _renderEndOfDayContent() {
  const container = document.getElementById('endOfDayContent');
  if (!container) return;

  const now      = new Date();
  const todayStr = now.toLocaleDateString('en-PH', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  // Today's date boundaries
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

  // Get today's completed sales
  const allSales    = Array.isArray(APP_STATE.sales) ? APP_STATE.sales : [];
  const todaySales  = allSales.filter(s => {
    const d = s.audit?.completedAt || s.completedAt || s.createdAt || '';
    return d >= todayStart && d <= todayEnd &&
      ['COMPLETED','PAID'].includes(s.status || s.paymentStatus || '');
  });

  // Revenue
  const totalRevenue = todaySales.reduce((s, sale) =>
    s + Number(sale.totals?.total ?? sale.total ?? 0), 0);
  const orderCount   = todaySales.length;
  const avgOrder     = orderCount > 0 ? totalRevenue / orderCount : 0;

  // Units sold map
  const soldMap = {};
  todaySales.forEach(sale => {
    (sale.items || []).forEach(item => {
      const qty = Number(item.quantity || 0) * Number(item.multiplier || 1);
      soldMap[item.productId] = (soldMap[item.productId] || 0) + qty;
    });
  });

  // Top sellers
  const topSellers = Object.entries(soldMap)
    .map(([productId, qty]) => {
      const product = (APP_STATE.products || []).find(p => String(p.id) === String(productId));
      const revenue = todaySales.reduce((s, sale) =>
        s + (sale.items || []).filter(i => String(i.productId) === String(productId))
          .reduce((ss, i) => ss + Number(i.lineTotal || i.total || 0), 0), 0);
      return { name: product?.name || 'Unknown', qty, revenue };
    })
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 5);

  // Payment breakdown
  const paymentBreakdown = {};
  todaySales.forEach(s => {
    const method = s.payment?.method || s.paymentMethod || 'cash';
    paymentBreakdown[method] = (paymentBreakdown[method] || 0) +
      Number(s.totals?.total ?? s.total ?? 0);
  });

  // Production today
  const todayJobs = (APP_STATE.productionJobs || []).filter(job => {
    const d = job.updatedAt || job.createdAt || '';
    return d >= todayStart && d <= todayEnd &&
      ['DONE','PACKED'].includes(job.status);
  });
  const totalProduced = todayJobs.reduce((s, job) =>
    s + (job.products || []).reduce((ss, l) => ss + Number(l.actualYield ?? l.targetQty ?? 0), 0), 0);
  const efficiencies  = todayJobs.flatMap(j => (j.products || [])
    .filter(l => l.efficiency != null).map(l => l.efficiency));
  const avgEfficiency = efficiencies.length
    ? Math.round(efficiencies.reduce((s, e) => s + e, 0) / efficiencies.length) : null;

  // Finished goods remaining (FG-mode products)
  const fgProducts = (APP_STATE.products || []).filter(p =>
    typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(p));
  const fgRemaining = fgProducts.map(p => ({
    name:      p.name,
    available: typeof getFGAvailable === 'function' ? getFGAvailable(p.id) : Number(p.stock || 0)
  })).filter(p => p.available > 0);

  // Low stock ingredients
  const lowIngredients = (APP_STATE.ingredients || []).filter(ing =>
    Number(ing.stock || 0) <= Number(ing.reorderLevel || 0));

  // Suggestions
  const suggestions = [];
  if (lowIngredients.length > 0)
    suggestions.push(`Restock ${lowIngredients.slice(0, 3).map(i => i.name).join(', ')}${lowIngredients.length > 3 ? ` +${lowIngredients.length - 3} more` : ''}`);
  const lowFG = fgProducts.filter(p => {
    const avail = typeof getFGAvailable === 'function' ? getFGAvailable(p.id) : Number(p.stock || 0);
    return avail <= Number(p.reorderLevel || 0);
  });
  if (lowFG.length > 0)
    suggestions.push(`Consider production run for: ${lowFG.slice(0, 2).map(p => p.name).join(', ')}`);
  if (totalRevenue > 0 && avgOrder > 0)
    suggestions.push(`Strong day — ${orderCount} orders averaging ${formatCurrency(avgOrder)}`);

  const pmLabels = { cash: 'Cash', gcash: 'GCash', maya: 'Maya', bank: 'Bank Transfer', qrph: 'QR Ph' };

  container.innerHTML = `
    <div style="font-size:11px;color:var(--gray-400);margin-bottom:16px;">${todayStr}</div>

    <!-- Revenue -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px;">
      ${[
        ['Revenue', formatCurrency(totalRevenue), '#16a34a'],
        ['Orders',  orderCount,                   ''],
        ['Avg Order', formatCurrency(avgOrder),   ''],
      ].map(([label, val, color]) => `
        <div style="border:1.5px solid var(--border);border-radius:12px;padding:12px 14px;">
          <div style="font-size:9px;font-weight:800;letter-spacing:1.5px;
            text-transform:uppercase;color:var(--gray-400);margin-bottom:4px;">${label}</div>
          <div style="font-size:20px;font-weight:900;${color?'color:'+color+';':''}">
            ${val || '—'}
          </div>
        </div>`).join('')}
    </div>

    ${todaySales.length === 0 ? `
    <div class="empty-state" style="padding:16px 0;margin-bottom:16px;">
      No completed sales today yet
    </div>` : ''}

    ${topSellers.length > 0 ? `
    <div style="margin-bottom:20px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
        color:var(--gray-400);margin-bottom:8px;">Top Sellers</div>
      ${topSellers.map((p, i) => `
        <div style="display:flex;align-items:center;justify-content:space-between;
          padding:7px 0;border-bottom:1px solid var(--border);">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:10px;font-weight:900;color:var(--gray-300);
              width:14px;">${i + 1}</span>
            <span style="font-size:12px;font-weight:700;">${escapeHtml(p.name)}</span>
          </div>
          <div style="text-align:right;">
            <span style="font-size:12px;font-weight:800;">×${p.qty}</span>
            <span style="font-size:11px;color:var(--gray-400);margin-left:6px;">
              ${formatCurrency(p.revenue)}</span>
          </div>
        </div>`).join('')}
    </div>` : ''}

    ${Object.keys(paymentBreakdown).length > 0 ? `
    <div style="margin-bottom:20px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
        color:var(--gray-400);margin-bottom:8px;">Payment Methods</div>
      ${Object.entries(paymentBreakdown).map(([method, amt]) => `
        <div style="display:flex;justify-content:space-between;padding:5px 0;
          border-bottom:1px solid var(--border);font-size:12px;">
          <span>${pmLabels[method] || method}</span>
          <span style="font-weight:700;">${formatCurrency(amt)}</span>
        </div>`).join('')}
    </div>` : ''}

    ${APP_STATE.settings?.productionModeEnabled && todayJobs.length > 0 ? `
    <div style="margin-bottom:20px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
        color:var(--gray-400);margin-bottom:8px;">Production Today</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div style="border:1.5px solid var(--border);border-radius:10px;padding:10px 12px;">
          <div style="font-size:9px;color:var(--gray-400);margin-bottom:2px;">Jobs Completed</div>
          <div style="font-size:18px;font-weight:900;">${todayJobs.length}</div>
        </div>
        <div style="border:1.5px solid var(--border);border-radius:10px;padding:10px 12px;">
          <div style="font-size:9px;color:var(--gray-400);margin-bottom:2px;">Units Produced</div>
          <div style="font-size:18px;font-weight:900;">${totalProduced}</div>
        </div>
        ${avgEfficiency !== null ? `
        <div style="border:1.5px solid var(--border);border-radius:10px;padding:10px 12px;">
          <div style="font-size:9px;color:var(--gray-400);margin-bottom:2px;">Avg Efficiency</div>
          <div style="font-size:18px;font-weight:900;
            color:${avgEfficiency>=90?'#16a34a':avgEfficiency>=70?'#ea580c':'#dc2626'};">
            ${avgEfficiency}%</div>
        </div>` : ''}
      </div>
    </div>` : ''}

    ${fgRemaining.length > 0 ? `
    <div style="margin-bottom:20px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
        color:var(--gray-400);margin-bottom:8px;">Finished Goods Remaining</div>
      ${fgRemaining.map(p => `
        <div style="display:flex;justify-content:space-between;padding:5px 0;
          border-bottom:1px solid var(--border);font-size:12px;">
          <span>${escapeHtml(p.name)}</span>
          <span style="font-weight:800;">${round2(p.available)} units</span>
        </div>`).join('')}
    </div>` : ''}

    ${lowIngredients.length > 0 ? `
    <div style="margin-bottom:20px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
        color:#dc2626;margin-bottom:8px;">⚠ Low Ingredients</div>
      ${lowIngredients.map(ing => `
        <div style="display:flex;justify-content:space-between;padding:5px 0;
          border-bottom:1px solid #fee2e2;font-size:12px;">
          <span style="font-weight:700;">${escapeHtml(ing.name)}</span>
          <span style="color:#dc2626;">${round2(ing.stock)} ${ing.unit} remaining</span>
        </div>`).join('')}
    </div>` : ''}

    ${suggestions.length > 0 ? `
    <div style="background:var(--gray-50);border-radius:12px;padding:14px 16px;">
      <div style="font-size:9px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;
        color:var(--gray-400);margin-bottom:8px;">Suggestions for Tomorrow</div>
      ${suggestions.map(s => `
        <div style="font-size:12px;color:var(--gray-700);padding:3px 0;">
          → ${escapeHtml(s)}
        </div>`).join('')}
    </div>` : ''}
    ${_buildCloseTheDaySection(totalRevenue, paymentBreakdown)}`;

  _updateEODLivePreview();
}

/* ═══════════════════════════════════════════════════════
   CLOSE THE DAY — opt-in ritual (Settings → Features → Daily Close).
   Adds nothing to the modal above when the toggle is off, so the
   read-only summary stays byte-identical to what shipped before this.
═══════════════════════════════════════════════════════ */

function _localDayKey(d) {
  return localDayKey(d);
}

function _dayCloses() {
  if (!Array.isArray(APP_STATE.dayCloses)) APP_STATE.dayCloses = [];
  return APP_STATE.dayCloses;
}

function _getDayClose(dayKey) {
  return _dayCloses().find(c => c.day === dayKey) || null;
}

// Most recent close strictly before `dayKey` — its cash count becomes
// today's opening float, so the drawer reconciles day over day.
function _getPriorClose(dayKey) {
  return _dayCloses()
    .filter(c => c.day < dayKey)
    .sort((a, b) => b.day.localeCompare(a.day))[0] || null;
}

// Quick expenses need somewhere to post — auto-provision a single "Cash
// Drawer" account rather than forcing setup of Treasury (a separate,
// independently-toggled feature) before Daily Close can be used at all.
function _cashDrawerAccountId() {
  if (!APP_STATE.treasuryAccounts) APP_STATE.treasuryAccounts = [];
  let acct = APP_STATE.treasuryAccounts.find(a => a.type === 'cash');
  if (!acct) {
    acct = { id: generateId(), name: 'Cash Drawer', type: 'cash', openingBalance: 0,
      createdAt: new Date().toISOString() };
    APP_STATE.treasuryAccounts.push(acct);
  }
  return acct.id;
}

function _eodExpenseRowsFromDOM() {
  return Array.from(document.querySelectorAll('#eodExpenseBuilder .eod-expense-row')).map(row => ({
    reason:   sanitizeText(row.querySelector('.eod-exp-reason')?.value || ''),
    amount:   safeNumber(row.querySelector('.eod-exp-amount')?.value),
    category: row.querySelector('.eod-exp-category')?.value || 'other',
  })).filter(e => e.reason && e.amount > 0);
}

const EOD_EXPENSE_CATEGORIES = [
  ['supplies',  'Supplies'],
  ['utilities', 'Utilities'],
  ['wages',     'Wages'],
  ['other',     'Other'],
];

function addEODExpenseRow(expense) {
  const container = document.getElementById('eodExpenseBuilder');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'eod-expense-row';
  row.innerHTML = `
    <input type="text" class="eod-exp-reason" placeholder="What was it for?"
      value="${escapeHtml(expense?.reason || '')}">
    <input type="number" class="eod-exp-amount" placeholder="Amount" min="0" step="0.01"
      value="${expense?.amount || ''}">
    <select class="eod-exp-category">
      ${EOD_EXPENSE_CATEGORIES.map(([v, l]) =>
        `<option value="${v}" ${expense?.category === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <button type="button" class="btn btn-sm btn-secondary eod-exp-remove">✕</button>`;
  row.querySelector('.eod-exp-remove').addEventListener('click', () => { row.remove(); _updateEODLivePreview(); });
  row.querySelectorAll('input,select').forEach(el => el.addEventListener('input', _updateEODLivePreview));
  container.appendChild(row);
}

// Recomputes expected cash / variance / P&L from the live DOM state —
// same "read the form, don't wait for save" pattern as the product
// editor's cost preview (js/products.js renderProductCostPreview).
function _updateEODLivePreview() {
  const box = document.getElementById('eodPreview');
  if (!box) return;

  const revenue = safeNumber(box.dataset.revenue);
  const cashRevenue = safeNumber(box.dataset.cashRevenue);
  const cogs = safeNumber(box.dataset.cogs);
  const openingFloat = safeNumber(box.dataset.openingFloat);

  const expenses = _eodExpenseRowsFromDOM();
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const expectedCash = openingFloat + cashRevenue - totalExpenses;

  const countedInput = document.getElementById('eodCashCounted');
  const counted = countedInput && countedInput.value !== '' ? safeNumber(countedInput.value) : null;
  const variance = counted !== null ? counted - expectedCash : null;

  const expectedEl = document.getElementById('eodExpectedCash');
  if (expectedEl) expectedEl.textContent = formatCurrency(expectedCash);

  const varianceEl = document.getElementById('eodVariance');
  if (varianceEl) {
    if (counted === null) {
      varianceEl.textContent = 'Count the drawer to see variance';
      varianceEl.style.color = 'var(--gray-400)';
    } else {
      const abs = Math.abs(variance);
      const label = abs < 1 ? 'Matches exactly' :
        `${variance > 0 ? 'Over' : 'Short'} by ${formatCurrency(abs)}`;
      varianceEl.textContent = label;
      varianceEl.style.color = abs < 1 ? '#16a34a' : abs <= 100 ? '#ea580c' : '#dc2626';
    }
  }

  const profit = revenue - cogs - totalExpenses;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const profitEl = document.getElementById('eodProfit');
  if (profitEl) {
    profitEl.textContent = formatCurrency(profit);
    profitEl.style.color = profit >= 0 ? '#16a34a' : '#dc2626';
  }
  const cogsEl = document.getElementById('eodCogsValue');
  if (cogsEl) cogsEl.textContent = formatCurrency(cogs);
  const expensesEl = document.getElementById('eodExpensesValue');
  if (expensesEl) expensesEl.textContent = formatCurrency(totalExpenses);
  const marginEl = document.getElementById('eodMargin');
  if (marginEl) marginEl.textContent = revenue > 0 ? `${margin.toFixed(1)}%` : '—';
}

function _buildCloseTheDaySection(totalRevenue, paymentBreakdown) {
  if (!(APP_STATE.settings?.dailyCloseEnabled === true)) return '';

  const now = new Date();
  const dayKey = _localDayKey(now);
  const todayStartD = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEndD   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  const cogs = typeof getPeriodCOGS === 'function' ? getPeriodCOGS(todayStartD, todayEndD) : 0;
  const cashRevenue = Number(paymentBreakdown?.cash || 0);
  const existing = _getDayClose(dayKey);

  const pro = typeof isProTier === 'function' ? isProTier() : false;
  if (!pro) {
    return `
      <div class="section-title" style="margin-top:24px;">Close the Day</div>
      <div style="border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:16px 18px;
        background:var(--gray-50);display:flex;align-items:center;gap:14px;cursor:pointer;"
        onclick="if(typeof requireTier==='function')requireTier('pro','Daily Close')">
        <div style="flex:1;">
          <div style="font-size:12px;font-weight:800;">Count the drawer, log expenses, see true profit
            <span style="font-size:9px;font-weight:900;padding:2px 7px;border-radius:999px;background:#0f0f0f;color:#fff;letter-spacing:1px;margin-left:6px;">PRO</span>
          </div>
          <div style="font-size:11px;color:var(--gray-500);margin-top:3px;filter:blur(3px);user-select:none;">
            Revenue ${formatCurrency(totalRevenue)} · Cost of goods ${formatCurrency(cogs)} · Profit today</div>
        </div>
        <span style="font-size:18px;">🔒</span>
      </div>`;
  }

  if (existing && dayKey !== _eodEditingDay) {
    const closedTime = new Date(existing.closedAt).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
    const varAbs = Math.abs(existing.variance);
    const varLabel = varAbs < 1 ? 'Matched exactly' : `${existing.variance > 0 ? 'Over' : 'Short'} by ${formatCurrency(varAbs)}`;
    const varColor = varAbs < 1 ? '#16a34a' : varAbs <= 100 ? '#ea580c' : '#dc2626';
    return `
      <div class="section-title" style="margin-top:24px;">Close the Day</div>
      <div style="border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:14px 16px;background:var(--gray-50);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="font-size:12px;font-weight:800;color:#16a34a;">✓ Closed at ${closedTime}</div>
          <button type="button" class="btn btn-secondary btn-sm" onclick="_reopenDayClose()">Edit</button>
        </div>
        <div class="cost-preview-grid" style="margin-top:12px;">
          <div class="cost-preview-item"><div class="cost-preview-label">Profit</div>
            <div class="cost-preview-value" style="color:${existing.profit >= 0 ? '#16a34a' : '#dc2626'};">${formatCurrency(existing.profit)}</div></div>
          <div class="cost-preview-item"><div class="cost-preview-label">Margin</div>
            <div class="cost-preview-value">${existing.revenue > 0 ? existing.margin.toFixed(1) + '%' : '—'}</div></div>
          <div class="cost-preview-item"><div class="cost-preview-label">Expenses</div>
            <div class="cost-preview-value">${formatCurrency(existing.expenses)}</div></div>
          <div class="cost-preview-item"><div class="cost-preview-label">Variance</div>
            <div class="cost-preview-value" style="color:${varColor};font-size:13px;">${varLabel}</div></div>
        </div>
      </div>`;
  }

  const priorClose = _getPriorClose(dayKey);
  const openingFloat = priorClose ? Number(priorClose.cashCounted || 0) : 0;

  return `
    <div class="section-title" style="margin-top:24px;">Close the Day</div>
    <div id="eodPreview" data-revenue="${totalRevenue}" data-cash-revenue="${cashRevenue}"
      data-cogs="${cogs}" data-opening-float="${openingFloat}">

      <div class="form-group">
        <label>Cash Counted in Drawer</label>
        <input type="number" id="eodCashCounted" min="0" step="0.01" placeholder="Count the drawer…"
          oninput="_updateEODLivePreview()">
      </div>
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--gray-500);margin:-8px 0 14px;">
        <span>Expected: <strong id="eodExpectedCash" style="color:var(--black);">${formatCurrency(openingFloat + cashRevenue)}</strong>
          ${openingFloat > 0 ? `<span style="opacity:.7;"> (float ${formatCurrency(openingFloat)} + cash sales ${formatCurrency(cashRevenue)})</span>` : ''}</span>
        <span id="eodVariance">Count the drawer to see variance</span>
      </div>

      <div class="pm-subhead">Today's Expenses <span class="pm-hint">optional</span></div>
      <div id="eodExpenseBuilder"></div>
      <button class="btn btn-secondary" type="button" onclick="addEODExpenseRow()" style="margin-bottom:14px;">+ Add Expense</button>

      <div class="cost-preview-card">
        <div class="cost-preview-grid">
          <div class="cost-preview-item"><div class="cost-preview-label">Revenue</div>
            <div class="cost-preview-value">${formatCurrency(totalRevenue)}</div></div>
          <div class="cost-preview-item"><div class="cost-preview-label">Cost of Goods</div>
            <div class="cost-preview-value" id="eodCogsValue">${formatCurrency(cogs)}</div></div>
          <div class="cost-preview-item"><div class="cost-preview-label">Expenses</div>
            <div class="cost-preview-value" id="eodExpensesValue">${formatCurrency(0)}</div></div>
          <div class="cost-preview-item"><div class="cost-preview-label">True Profit</div>
            <div class="cost-preview-value" id="eodProfit">${formatCurrency(totalRevenue - cogs)}</div></div>
        </div>
        <div style="text-align:right;font-size:11px;color:var(--gray-500);margin-top:8px;">
          Margin <strong id="eodMargin" style="color:var(--black);">${totalRevenue > 0 ? (((totalRevenue - cogs) / totalRevenue) * 100).toFixed(1) + '%' : '—'}</strong>
        </div>
      </div>

      <button class="btn" type="button" onclick="closeTheDay()" style="width:100%;margin-top:14px;">Close the Day</button>
    </div>`;
}

// Set while "Edit" is open on an already-closed day. The record itself
// stays in APP_STATE.dayCloses (closeTheDay() needs its expenseTxnIds to
// clean up the old transactions before posting the edited ones) — only
// this flag decides whether _buildCloseTheDaySection renders the closed
// summary or the editable form for the same day.
let _eodEditingDay = null;

function _reopenDayClose() {
  const dayKey = _localDayKey();
  const existing = _getDayClose(dayKey);
  if (!existing) return;
  _eodEditingDay = dayKey;
  _renderEndOfDayContent();
  const countedInput = document.getElementById('eodCashCounted');
  if (countedInput) countedInput.value = existing.cashCounted;
  (existing.expenseRows || []).forEach(e => addEODExpenseRow(e));
  _updateEODLivePreview();
}

function closeTheDay() {
  if (typeof requireTier === 'function' && !requireTier('pro', 'Daily Close')) return;

  const now = new Date();
  const dayKey = _localDayKey(now);
  const todayStartD = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEndD   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const revenue = typeof getRevenue === 'function' ? getRevenue(todayStartD, todayEndD) : 0;
  const orders  = typeof getOrderCount === 'function' ? getOrderCount(todayStartD, todayEndD) : 0;
  const cogs    = typeof getPeriodCOGS === 'function' ? getPeriodCOGS(todayStartD, todayEndD) : 0;

  const countedInput = document.getElementById('eodCashCounted');
  const cashCounted = safeNumber(countedInput?.value);
  const box = document.getElementById('eodPreview');
  const cashRevenue = safeNumber(box?.dataset.cashRevenue);
  const openingFloat = safeNumber(box?.dataset.openingFloat);

  const expenses = _eodExpenseRowsFromDOM();
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const cashExpected = openingFloat + cashRevenue - totalExpenses;
  const variance = cashCounted - cashExpected;
  const profit = revenue - cogs - totalExpenses;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  // Re-closing the same day: remove the expense transactions this close
  // posted before, so re-saving never double-counts them.
  const existing = _getDayClose(dayKey);
  if (existing && Array.isArray(existing.expenseTxnIds) && existing.expenseTxnIds.length) {
    APP_STATE.treasuryTransactions = (APP_STATE.treasuryTransactions || [])
      .filter(t => !existing.expenseTxnIds.includes(t.id));
  }

  const expenseTxnIds = [];
  if (totalExpenses > 0) {
    const accountId = _cashDrawerAccountId();
    if (!APP_STATE.treasuryTransactions) APP_STATE.treasuryTransactions = [];
    expenses.forEach(e => {
      const txn = {
        id: generateId(), accountId, kind: 'deduct', amount: e.amount,
        reason: e.reason, category: e.category, date: dayKey,
        createdAt: new Date().toISOString(),
      };
      APP_STATE.treasuryTransactions.push(txn);
      expenseTxnIds.push(txn.id);
    });
  }

  const record = {
    day: dayKey, revenue, orders, cogs, expenses: totalExpenses,
    expenseRows: expenses, profit, margin,
    cashExpected, cashCounted, variance, expenseTxnIds,
    closedAt: new Date().toISOString(),
  };
  APP_STATE.dayCloses = [..._dayCloses().filter(c => c.day !== dayKey), record];
  _eodEditingDay = null;

  persistState();
  showNotification('Day closed', 'success');
  _renderEndOfDayContent();
  if (typeof _renderDailyCloseChip === 'function') _renderDailyCloseChip();
  if (typeof renderDayClosesTable === 'function') renderDayClosesTable();
}

/* ── Dashboard chip ── */
function _renderDailyCloseChip() {
  const chip = document.getElementById('dailyCloseChip');
  if (!chip) return;
  if (!(APP_STATE.settings?.dailyCloseEnabled === true)) { chip.innerHTML = ''; return; }

  const todayKey = _localDayKey();
  // Build "yesterday" from a real Date object, not by re-parsing yestKey —
  // `new Date('YYYY-MM-DD')` parses as UTC midnight, which is exactly the
  // local/UTC day-boundary bug fixed elsewhere in this app (see foresight.js
  // and analytics.js getDailySalesTrend).
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const yestKey   = _localDayKey(yest);
  const yestStart = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate());
  const yestEnd   = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 23, 59, 59, 999);

  if (_getDayClose(todayKey)) {
    chip.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;
      font-weight:800;padding:4px 10px;border-radius:999px;background:rgba(22,163,74,.12);color:#16a34a;">
      ✓ Day closed</span>`;
    return;
  }

  const yestRevenue = typeof getRevenue === 'function' ? getRevenue(yestStart, yestEnd) : 0;
  if (yestRevenue > 0 && !_getDayClose(yestKey)) {
    chip.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;font-size:10px;
      font-weight:800;padding:4px 10px;border-radius:999px;background:rgba(234,88,12,.12);color:#ea580c;">
      Yesterday not closed</span>`;
    return;
  }
  chip.innerHTML = '';
}

function applyDailyCloseToggle() {
  if (typeof _renderDailyCloseChip === 'function') _renderDailyCloseChip();
  if (document.getElementById('endOfDayModal')?.classList.contains('active') &&
      typeof _renderEndOfDayContent === 'function') _renderEndOfDayContent();
  if (APP_STATE.ui?.currentView === 'reports' && typeof renderDayClosesTable === 'function') renderDayClosesTable();
}

/* ── Reports history table ── */
function renderDayClosesTable() {
  const section = document.getElementById('dayClosesSection');
  const tbody = document.querySelector('#dayClosesTable tbody');
  if (!section || !tbody) return;

  const enabled = APP_STATE.settings?.dailyCloseEnabled === true;
  section.style.display = enabled ? '' : 'none';
  if (!enabled) return;

  const rows = _dayCloses().slice().sort((a, b) => b.day.localeCompare(a.day));
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No days closed yet</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(c => {
    const varAbs = Math.abs(c.variance);
    const varColor = varAbs < 1 ? '#16a34a' : varAbs <= 100 ? '#ea580c' : '#dc2626';
    const varLabel = varAbs < 1 ? 'Matched' : `${c.variance > 0 ? '+' : '-'}${formatCurrency(varAbs)}`;
    const dateLabel = new Date(`${c.day}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
    return `<tr>
      <td>${dateLabel}</td>
      <td>${formatCurrency(c.revenue)}</td>
      <td>${formatCurrency(c.cogs)}</td>
      <td>${formatCurrency(c.expenses)}</td>
      <td style="font-weight:700;color:${c.profit >= 0 ? '#16a34a' : '#dc2626'};">${formatCurrency(c.profit)}</td>
      <td style="color:${varColor};">${varLabel}</td>
    </tr>`;
  }).join('');
}

function shareEndOfDay() {
  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-PH', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
  const el      = document.getElementById('endOfDayContent');
  if (!el) return;

  // Build plain text from rendered data
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
  const todaySales = (APP_STATE.sales || []).filter(s => {
    const d = s.audit?.completedAt || s.completedAt || s.createdAt || '';
    return d >= todayStart && d <= todayEnd &&
      ['COMPLETED','PAID'].includes(s.status || s.paymentStatus || '');
  });
  const revenue = todaySales.reduce((s, sale) => s + Number(sale.totals?.total ?? sale.total ?? 0), 0);

  let text = `END OF DAY — ${dateStr}\n`;
  text += `─────────────────────────\n`;
  text += `Revenue: ${formatCurrency(revenue)}\n`;
  text += `Orders: ${todaySales.length}\n`;
  text += `\nGenerated by Caflat.CORE`;

  if (navigator.share) {
    navigator.share({ title: 'End of Day Summary', text }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(text).then(() =>
      showNotification('Copied to clipboard', 'success'));
  }
}

window.openEndOfDaySummary = openEndOfDaySummary;
window.shareEndOfDay       = shareEndOfDay;
window.addEODExpenseRow    = addEODExpenseRow;
window._updateEODLivePreview = _updateEODLivePreview;
window.closeTheDay         = closeTheDay;
window._reopenDayClose     = _reopenDayClose;
window.applyDailyCloseToggle = applyDailyCloseToggle;
window.renderDayClosesTable  = renderDayClosesTable;
window._renderDailyCloseChip = _renderDailyCloseChip;
