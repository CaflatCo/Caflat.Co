/* ═══════════════════════════════════════════════════════
   COFFEECART.JS — Coffee Cart Mode
   Phase 1 + Phase 2: Complete implementation
   Feature-toggled via settings.coffeeCartModeEnabled.

   Phase 1: Order Channel System + Active Event Session
   Phase 2: Event Profitability + Package Builder + Lead Tracker

   Architecture:
   - Channels extend orderType with business context
   - Active Event Session tags all transactions during event
   - All analytics flow through analytics.js
   - No inline events, no duplicate state
═══════════════════════════════════════════════════════ */

/* ── Channel definitions ── */
const CART_CHANNELS = {
  'Dine In':  { label: 'Dine In',  group: 'pos' },
  'Take Out': { label: 'Take Out', group: 'pos' },
  'Delivery': { label: 'Delivery', group: 'pos' },
};

/* ── Active Event Session ── */
function getActiveEvent() {
  return APP_STATE.activeEvent || null;
}

function startEventSession(event) {
  updateState('activeEvent', () => ({
    id:        event.id,
    name:      event.name,
    startedAt: new Date().toISOString(),
    location:  event.location || '',
    type:      event.type || 'Event'
  }));
  applyEventSessionBanner();
  refreshEventBreakEven();
  if (typeof pushAuditEntry === 'function') {
    pushAuditEntry({
      action:  'EVENT_SESSION_STARTED',
      outcome: 'SUCCESS',
      note:    `Event session started: ${event.name}`
    });
  }
  showNotification(`Event session started: ${event.name}`, 'success');
}

function endEventSession() {
  const event = getActiveEvent();
  if (!event) return;
  // Anything stocked but unsold comes home. Ask before clearing the session,
  // while the operator is still standing at the table.
  const stocked = _eventStockedLines(event.id);
  if (stocked.length) { openEventLeftoverModal(event.id); return; }
  _endWithSnapshot(event.id);
}

function _finalizeEventSession(event) {
  updateState('activeEvent', () => null);
  applyEventSessionBanner();
  refreshEventBreakEven();
  if (typeof pushAuditEntry === 'function') {
    pushAuditEntry({
      action:  'EVENT_SESSION_ENDED',
      outcome: 'SUCCESS',
      note:    `Event session ended: ${event.name}`
    });
  }
  showNotification(`Event session ended: ${event.name}`, 'success');
}

/* ── Leftovers: units stocked for the event that came back ── */

/* Per-product totals stocked for this event, from production jobs and the
   manual lineup, collapsed so one product appears once. */
function _eventStockedLines(eventId) {
  const event = getEvents().find(e => String(e.id) === String(eventId));
  const cost  = getEventProducedCost(event);
  const byProduct = new Map();
  cost.lines.forEach(l => {
    const key = String(l.productId);
    byProduct.set(key, (byProduct.get(key) || 0) + l.qty);
  });
  return Array.from(byProduct.entries()).map(([productId, qty]) => {
    const p = (APP_STATE.products || []).find(x => String(x.id) === String(productId));
    return { productId, qty, name: p?.name || 'Unknown product' };
  });
}

function openEventLeftoverModal(eventId) {
  const lines = _eventStockedLines(eventId);
  let m = document.getElementById('eventLeftoverModal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'eventLeftoverModal';
    m.className = 'modal-overlay';
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div class="modal" style="max-width:min(460px, 94vw);">
      <h3>Anything left over?</h3>
      <div style="font-size:12px;color:var(--gray-400);margin-bottom:16px;">
        Units you carried back go into stock and come off this event's cost.
        Leave at zero if you sold out.
      </div>
      <div id="eventLeftoverRows">
        ${lines.map(l => `
          <div class="portal-fields" style="align-items:end;margin-bottom:10px;"
            data-leftover-product="${l.productId}">
            <label class="portal-field" style="max-width:none;">
              <span>${escapeHtml(l.name)}</span>
              <input type="number" class="leftover-qty" min="0" max="${l.qty}"
                value="0" placeholder="0" />
            </label>
            <span style="font-size:11px;color:var(--gray-400);padding-bottom:11px;">
              of ${l.qty}</span>
          </div>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" type="button"
          data-action="event-leftover-skip" data-id="${eventId}">Sold out</button>
        <button class="btn" type="button"
          data-action="event-leftover-save" data-id="${eventId}">Save and end</button>
      </div>
    </div>`;
  openModal('eventLeftoverModal');
}

function saveEventLeftovers(eventId) {
  // Clamp to what was actually stocked. The input's max attribute is only a
  // browser hint; without this, typing 400 against 40 stocked would credit
  // 400 units of inventory that never existed.
  const stocked = new Map(_eventStockedLines(eventId).map(l => [String(l.productId), l.qty]));
  const alreadyBack = new Map(
    ((getEvents().find(e => String(e.id) === String(eventId)) || {}).returnedItems || [])
      .map(r => [String(r.productId), Number(r.qty || 0)]));

  const returned = Array.from(
    document.querySelectorAll('#eventLeftoverRows [data-leftover-product]'))
    .map(row => {
      const productId = row.dataset.leftoverProduct;
      const asked     = Math.max(0, Number(row.querySelector('.leftover-qty')?.value || 0));
      const room      = Math.max(0,
        (stocked.get(String(productId)) || 0) - (alreadyBack.get(String(productId)) || 0));
      return { productId, qty: Math.min(asked, room) };
    })
    .filter(r => r.qty > 0);

  if (returned.length) {
    // Put the units back. Finished-goods products keep their stock in the FG
    // ledger, so never touch product.stock for those — same rule void.js follows.
    const products = (APP_STATE.products || []).map(p => {
      const hit = returned.find(r => String(r.productId) === String(p.id));
      if (!hit) return p;
      if (typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(p)) return p;
      return { ...p, stock: Number(p.stock || 0) + hit.qty };
    });
    updateState('products', () => products);

    returned.forEach(r => {
      const p = (APP_STATE.products || []).find(x => String(x.id) === String(r.productId));
      if (p && typeof isFinishedGoodsProduct === 'function' && isFinishedGoodsProduct(p)
          && typeof creditFinishedGoods === 'function') {
        creditFinishedGoods(p.id, p.name, r.qty, 'Event leftovers');
      }
    });

    const events = getEvents();
    const event  = events.find(e => String(e.id) === String(eventId));
    if (event) {
      // Accumulate. A session can be run, ended, restarted and ended again;
      // assigning would drop the earlier reconciliation and its cost credit.
      const merged = new Map(
        (event.returnedItems || []).map(r => [String(r.productId), Number(r.qty || 0)]));
      returned.forEach(r => merged.set(String(r.productId),
        (merged.get(String(r.productId)) || 0) + r.qty));
      event.returnedItems = Array.from(merged, ([productId, qty]) => ({ productId, qty }));
      updateState('events', () => events);
    }
  }

  closeModal('eventLeftoverModal');
  _endWithSnapshot(eventId);
  renderEventsTable();
}

function skipEventLeftovers(eventId) {
  closeModal('eventLeftoverModal');
  _endWithSnapshot(eventId);
}

/* Freeze what the goods cost today, then close the session. From here the
   event reports the same numbers no matter how ingredient prices move. */
function _endWithSnapshot(eventId) {
  const active = getActiveEvent();
  const id     = eventId || active?.id;
  const events = getEvents();
  const event  = events.find(e => String(e.id) === String(id));
  if (event && !event.costSnapshot) {
    event.costSnapshot = _buildEventCostSnapshot(event);
    updateState('events', () => events);
  }
  if (active) _finalizeEventSession(active);
}

function applyEventSessionBanner() {
  const banner  = document.getElementById('eventSessionBanner');
  const event   = getActiveEvent();
  if (!banner) return;
  if (event) {
    banner.style.display = 'flex';
    const nameEl = document.getElementById('eventSessionName');
    const timeEl = document.getElementById('eventSessionTime');
    if (nameEl) nameEl.textContent = event.name;
    if (timeEl) {
      const started = new Date(event.startedAt);
      timeEl.textContent = `Since ${started.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;
    }
  } else {
    banner.style.display = 'none';
  }
}

/* ── Events CRUD ── */
function getEvents() {
  return Array.isArray(APP_STATE.events) ? APP_STATE.events : [];
}

function saveEvent() {
  const id       = getElementValue('eventId') || generateId();
  const name     = sanitizeText(getElementValue('eventName'));
  const location = sanitizeText(getElementValue('eventLocation'));
  const type     = getElementValue('eventType') || 'Event';
  const date     = getElementValue('eventDate');
  const notes    = sanitizeText(getElementValue('eventNotes'));

  if (!name) { showNotification('Event name is required', 'error'); return; }

  const events   = getEvents();
  const existing = events.find(e => String(e.id) === String(id));

  const plannedItems = collectPlannedItems();

  if (existing) {
    Object.assign(existing, { name, location, type, date, notes, plannedItems,
      updatedAt: new Date().toISOString() });
  } else {
    events.push({ id, name, location, type, date, notes, plannedItems,
      createdAt: new Date().toISOString(), status: 'UPCOMING' });
  }

  updateState('events', () => events);
  closeModal('eventModal');
  clearEventForm();
  renderEventsTable();
  refreshEventBreakEven();
  showNotification('Event saved', 'success');
}

function deleteEvent(eventId) {
  if (!confirm('Delete this event?')) return;
  updateState('events', () => getEvents().filter(e => String(e.id) !== String(eventId)));
  renderEventsTable();
  showNotification('Event deleted', 'success');
}

function openEventModal(eventId = null) {
  clearEventForm();
  let plannedItems = [];
  if (eventId) {
    const event = getEvents().find(e => String(e.id) === String(eventId));
    if (event) {
      setElementValue('eventId',       event.id);
      setElementValue('eventName',     event.name);
      setElementValue('eventLocation', event.location || '');
      setElementValue('eventType',     event.type     || 'Event');
      setElementValue('eventDate',     event.date     || '');
      setElementValue('eventNotes',    event.notes    || '');
      plannedItems = Array.isArray(event.plannedItems) ? event.plannedItems : [];
    }
  }
  renderPlannedItemsList(plannedItems);
  openModal('eventModal');
}

function clearEventForm() {
  ['eventId','eventName','eventLocation','eventDate','eventNotes']
    .forEach(id => setElementValue(id, ''));
  renderPlannedItemsList([]);
}

function activateEvent(eventId) {
  const event = getEvents().find(e => String(e.id) === String(eventId));
  if (!event) return;
  if (getActiveEvent()) {
    if (!confirm(`End current session "${getActiveEvent().name}" and start "${event.name}"?`)) return;
  }
  startEventSession(event);
  renderEventsTable();
}

/* ── Events table ── */
function renderEventsTable() {
  const tbody = document.querySelector('#eventsTable tbody');
  if (!tbody) return;

  const events    = getEvents();
  const activeId  = getActiveEvent()?.id;

  tbody.innerHTML = '';

  if (!events.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No events yet — create your first event</td></tr>`;
    return;
  }

  events.slice().reverse().forEach(event => {
    const isActive = String(event.id) === String(activeId);
    const row      = document.createElement('tr');
    if (isActive) row.style.background = '#f0fdf4';

    row.innerHTML = `
      <td style="font-weight:700;">${escapeHtml(event.name)}
        ${isActive ? `<span style="display:inline-flex;align-items:center;gap:4px;
          margin-left:8px;padding:2px 8px;border-radius:999px;background:#dcfce7;
          color:#16a34a;font-size:9px;font-weight:800;letter-spacing:1px;">● ACTIVE</span>` : ''}
      </td>
      <td>${escapeHtml(event.type || 'Event')}</td>
      <td>${event.date ? new Date(event.date + 'T00:00:00').toLocaleDateString('en-PH',
        {month:'short',day:'numeric',year:'numeric'}) : '—'}</td>
      <td>${escapeHtml(event.location || '—')}</td>
      <td>${_getEventRevenue(event.id) > 0
        ? `<span style="font-weight:700;">${formatCurrency(_getEventRevenue(event.id))}</span>`
        : '<span style="color:var(--gray-300);">—</span>'}</td>
      <td>
        <div class="table-actions">
          ${!isActive
            ? `<button class="btn btn-sm" data-action="activate-event" data-id="${event.id}">
                Start Session</button>`
            : `<button class="btn btn-sm btn-secondary" data-action="end-event-session">
                End Session</button>`}
          <button class="btn btn-sm btn-secondary" data-action="open-event-profitability" data-id="${event.id}">Profitability</button>
          <button class="btn btn-sm btn-secondary" data-action="edit-event" data-id="${event.id}">Edit</button>
          <button class="btn btn-sm btn-secondary" data-action="delete-event" data-id="${event.id}">Delete</button>
        </div>
      </td>`;
    tbody.appendChild(row);
  });
}

/* ── Event revenue from sales ── */
function _eventSales(eventId) {
  if (!eventId) return [];
  return (APP_STATE.sales || []).filter(s =>
    String(s.eventId) === String(eventId) &&
    (s.status || '').toUpperCase() === 'COMPLETED');
}

function _getEventRevenue(eventId) {
  return _eventSales(eventId)
    .reduce((sum, s) => sum + Number(s.totals?.total ?? s.total ?? 0), 0);
}

/* ═══════════════════════════════════════════════════════
   BREAK-EVEN
   Goods for an event are made before the doors open, so their cost is
   committed whether or not they sell. Break-even is therefore a fixed
   target set at production time, and revenue is the progress toward it:

     target   = logged expenses + cost of everything produced
     progress = event-tagged revenue

   Because the target does not move as you sell, each sale advances the
   bar by a predictable amount.
═══════════════════════════════════════════════════════ */

/* Per-unit cost via analytics.js's documented single source of truth,
   which also folds in packaging.

   `frozen` is an event's costSnapshot: once a session has ended, the event
   reports what the goods cost on the day. Without it, raising an ingredient
   price later would silently rewrite the profit of every past event.

   The live-cost path memoises per call so ten lines of the same product
   don't each re-walk its recipe. */
function _eventUnitCost(productId, frozen, memo) {
  const key = String(productId);
  if (frozen && Object.prototype.hasOwnProperty.call(frozen, key)) {
    return Number(frozen[key]) || 0;
  }
  if (memo && memo.has(key)) return memo.get(key);

  const p = (APP_STATE.products || []).find(x => String(x.id) === key);
  const cost = (!p || typeof calculateProductCost !== 'function')
    ? 0
    : calculateProductCost(p.recipe, p.recipeMode, p.batchYield, p.packagingItems);
  if (memo) memo.set(key, cost);
  return cost;
}

/* Snapshot every product this event stocked, at today's costs. Called when
   a session ends so the event's numbers stop moving afterwards. */
function _buildEventCostSnapshot(event) {
  const memo = new Map();
  const snap = {};
  getEventProducedCost(event).lines.forEach(l => {
    const key = String(l.productId);
    if (!(key in snap)) snap[key] = _eventUnitCost(key, null, memo);
  });
  return snap;
}

/* Units a production line actually yielded. Same rule production.js uses
   for its own totals: real yield when recorded, else the target once the
   line is finished, else nothing (it hasn't been made yet). */
function _producedUnits(line) {
  return Number(
    line.actualYield ?? (['DONE', 'QC', 'PACKED'].includes(line.status) ? line.targetQty : 0)
  ) || 0;
}

/* Cost of everything stocked for this event, from production jobs tagged
   to it plus any manually planned lines (for goods bought in, or when
   Production mode is off). Returns both sources so the UI can show its work. */
function getEventProducedCost(event) {
  if (!event) return { fromJobs: 0, fromManual: 0, total: 0, units: 0, lines: [] };

  const lines = [];
  const jobs = typeof getProductionJobs === 'function' ? (getProductionJobs() || []) : [];
  jobs.filter(j => String(j.eventId) === String(event.id))
      .forEach(j => (j.products || []).forEach(l => {
        const qty = _producedUnits(l);
        if (qty > 0) lines.push({ productId: l.productId, qty, source: 'job' });
      }));

  (event.plannedItems || []).forEach(l => {
    const qty = Number(l.qty || 0);
    if (qty > 0) lines.push({ productId: l.productId, qty, source: 'manual' });
  });

  const frozen = event.costSnapshot || null;
  const memo   = new Map();

  let fromJobs = 0, fromManual = 0, units = 0;
  lines.forEach(l => {
    const cost = l.qty * _eventUnitCost(l.productId, frozen, memo); // deleted product -> 0
    if (l.source === 'job') fromJobs += cost; else fromManual += cost;
    units += l.qty;
  });

  // Units carried back at the end of the session were never consumed, so
  // their cost comes back off the event.
  const returnedCost = (event.returnedItems || []).reduce(
    (s, r) => s + Number(r.qty || 0) * _eventUnitCost(r.productId, frozen, memo), 0);

  return {
    fromJobs, fromManual, units, lines,
    returnedCost,
    total: Math.max(0, fromJobs + fromManual - returnedCost),
  };
}

function getEventBreakEven(eventId) {
  const event    = getEvents().find(e => String(e.id) === String(eventId)) || null;
  const revenue  = _getEventRevenue(eventId);
  const expenses = getEventExpenses(eventId).reduce((s, ex) => s + Number(ex.amount || 0), 0);
  const produced = getEventProducedCost(event);
  const target   = expenses + produced.total;

  const sales    = _eventSales(eventId);
  const unitsSold = sales.reduce((s, sale) =>
    s + (sale.items || []).reduce((n, i) => n + Number(i.quantity || 0), 0), 0);

  // pct is the fill up to break-even; overflowPct carries the profit beyond
  // it, so the bar keeps saying something once the target is passed.
  const pct = target > 0
    ? Math.min(100, (revenue / target) * 100)
    : (revenue > 0 ? 100 : 0);
  const overflowPct = target > 0 && revenue > target
    ? Math.min(100, ((revenue - target) / target) * 100)
    : 0;

  return {
    event, target, revenue, expenses,
    producedCost: produced.total,
    fromJobs:     produced.fromJobs,
    fromManual:   produced.fromManual,
    returnedCost: produced.returnedCost,
    unitsProduced: produced.units,
    unitsSold,
    remaining: Math.max(0, target - revenue),
    profit:    revenue - target,
    pct, overflowPct,
    reached:   target > 0 ? revenue >= target : revenue > 0,
    // Nothing stocked and nothing spent: there is no target to track yet.
    unset:     target <= 0,
    orders:    sales.length,
  };
}

/* ── Coffee Cart view render ── */
function renderChannelBreakdown() {
  const container = document.getElementById('channelBreakdownContainer');
  if (!container) return;

  const revenue  = getRevenueByChannel();
  const orders   = getOrdersByChannel();
  const channels = Object.keys({ ...revenue, ...orders });

  if (!channels.length) {
    container.innerHTML = `<div class="empty-state">No sales data yet</div>`;
    return;
  }

  const totalRev = Object.values(revenue).reduce((s, v) => s + v, 0);

  container.innerHTML = channels.map(ch => {
    const chRev = revenue[ch] || 0;
    const chOrd = orders[ch]  || 0;
    const pct   = totalRev > 0 ? ((chRev / totalRev) * 100).toFixed(1) : '0.0';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:10px 14px;border:1.5px solid var(--border);border-radius:var(--radius-lg);
        margin-bottom:8px;background:var(--white);">
        <div>
          <div style="font-weight:800;font-size:13px;">${escapeHtml(ch)}</div>
            <div style="font-size:11px;color:var(--gray-400);">${chOrd} orders</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:900;font-size:15px;font-variant-numeric:tabular-nums;">
            ${formatCurrency(chRev)}</div>
          <div style="font-size:11px;color:var(--gray-400);">${pct}% of total</div>
        </div>
      </div>`;
  }).join('');
}

/* ── POS channel selector (shown when Coffee Cart Mode is on) ── */
function renderChannelSelector() {
  // This function is kept for compatibility but renderOrderTypeTabs now handles channels.
  // Just hide the old separate container.
  const container = document.getElementById('channelSelectorContainer');
  if (container) container.style.display = 'none';
  return;
  // Dead code below kept for reference:
  const current = APP_STATE.ui?.activeChannel || APP_STATE.ui?.orderType || 'Dine In';
  // Available channels
  const available = Object.keys(CART_CHANNELS);

  container.innerHTML = available.map(ch => `
    <button type="button"
      class="channel-btn${current === ch ? ' active' : ''}"
      data-action="set-channel" data-channel="${ch}">
      ${CART_CHANNELS[ch].label}
    </button>`).join('');
}

function setActiveChannel(channel) {
  updateState('ui', current => ({ ...current, activeChannel: channel, orderType: channel }));
  // Re-render tabs so active pill updates
  if (typeof renderOrderTypeTabs === 'function') renderOrderTypeTabs();
}

/* ── Nav + feature toggle ── */
function applyCoffeeCartModeToggle() {
  const enabled = APP_STATE.settings?.coffeeCartModeEnabled === true;
  const navBtn  = document.getElementById('navCoffeeCart');
  if (navBtn) navBtn.style.display = enabled ? '' : 'none';
  if (typeof updateOpsNavGroup === 'function') updateOpsNavGroup();

  // Always hide the old separate channel container — tabs are merged now
  const channelSel = document.getElementById('channelSelectorContainer');
  if (channelSel) channelSel.style.display = 'none';

  // Re-render order type tabs (shows channels or order types depending on mode)
  if (typeof renderOrderTypeTabs === 'function') renderOrderTypeTabs();

  // Apply event picker button visibility
  applyEventPickerButton();

  if (!enabled && APP_STATE.ui?.currentView === 'coffeecart') {
    if (typeof switchPage === 'function') switchPage('pos');
  }
}

/* ── Exports ── */
window.getActiveEvent           = getActiveEvent;
window.startEventSession        = startEventSession;
window.endEventSession          = endEventSession;
window.getEventBreakEven        = getEventBreakEven;
window.getEventProducedCost     = getEventProducedCost;
window.refreshEventBreakEven    = refreshEventBreakEven;
window.renderEventBreakEvenPanel= renderEventBreakEvenPanel;
window.renderPosBreakEvenBar    = renderPosBreakEvenBar;
window.addPlannedItemRow        = addPlannedItemRow;
window.renderPlannedItemsList   = renderPlannedItemsList;
window.collectPlannedItems      = collectPlannedItems;
window.updatePlannedItemsTotal  = updatePlannedItemsTotal;
window.saveEventLeftovers       = saveEventLeftovers;
window.skipEventLeftovers       = skipEventLeftovers;
window.applyEventSessionBanner  = applyEventSessionBanner;
window.getEvents                = getEvents;
window.saveEvent                = saveEvent;
window.deleteEvent              = deleteEvent;
window.openEventModal           = openEventModal;
window.activateEvent            = activateEvent;
window.renderEventsTable        = renderEventsTable;
window.renderChannelBreakdown   = renderChannelBreakdown;
window.renderChannelSelector    = renderChannelSelector;
window.setActiveChannel         = setActiveChannel;
window.applyCoffeeCartModeToggle= applyCoffeeCartModeToggle;
window.CART_CHANNELS            = CART_CHANNELS;

/* ═══════════════════════════════════════════════════════
   PHASE 2A — EVENT PROFITABILITY
   Revenue pulled from tagged sales.
   Expenses manually logged per event.
   Profit = Revenue - Expenses - Ingredient Cost
═══════════════════════════════════════════════════════ */

function getEventExpenses(eventId) {
  const event = getEvents().find(e => String(e.id) === String(eventId));
  return Array.isArray(event?.expenses) ? event.expenses : [];
}

function addEventExpense(eventId, expense) {
  const events = getEvents();
  const event  = events.find(e => String(e.id) === String(eventId));
  if (!event) return;
  event.expenses = Array.isArray(event.expenses) ? event.expenses : [];
  event.expenses.push({
    id:        generateId(),
    label:     sanitizeText(expense.label),
    amount:    Number(expense.amount || 0),
    createdAt: new Date().toISOString()
  });
  updateState('events', () => events);
}

function deleteEventExpense(eventId, expenseId) {
  const events = getEvents();
  const event  = events.find(e => String(e.id) === String(eventId));
  if (!event) return;
  event.expenses = (event.expenses || []).filter(ex => String(ex.id) !== String(expenseId));
  updateState('events', () => events);
}

/* Derived from getEventBreakEven so the modal and the progress bar can
   never disagree. Cost is what was stocked for the event, not just what
   sold: goods made and not sold were still paid for. `ingredientCost` is
   kept as a key so existing callers keep working, but it now means the
   cost of everything produced. */
function getEventProfitability(eventId) {
  const be = getEventBreakEven(eventId);
  return {
    revenue:        be.revenue,
    expenses:       be.expenses,
    ingredientCost: be.producedCost,
    totalCost:      be.target,
    profit:         be.profit,
    margin:         be.revenue > 0 ? (be.profit / be.revenue) * 100 : 0,
    orders:         be.orders,
  };
}

function openEventProfitabilityModal(eventId) {
  const event = getEvents().find(e => String(e.id) === String(eventId));
  if (!event) return;

  const p = getEventProfitability(eventId);

  const el = id => document.getElementById(id);
  if (el('profitEventName'))     el('profitEventName').textContent     = event.name;
  if (el('profitEventId'))       el('profitEventId').value             = eventId;
  if (el('profitRevenue'))       el('profitRevenue').textContent       = formatCurrency(p.revenue);
  if (el('profitIngredientCost'))el('profitIngredientCost').textContent= formatCurrency(p.ingredientCost);
  if (el('profitExpenses'))      el('profitExpenses').textContent      = formatCurrency(p.expenses);
  if (el('profitTotalCost'))     el('profitTotalCost').textContent     = formatCurrency(p.totalCost);
  if (el('profitNetProfit'))     el('profitNetProfit').textContent     = formatCurrency(p.profit);
  if (el('profitMargin'))        el('profitMargin').textContent        = p.margin.toFixed(1) + '%';
  if (el('profitOrders'))        el('profitOrders').textContent        = p.orders;

  // Colour profit
  if (el('profitNetProfit')) {
    el('profitNetProfit').style.color = p.profit >= 0 ? '#16a34a' : '#dc2626';
  }

  // Render expense list
  renderEventExpensesList(eventId);

  // Wire expense add button with current eventId
  const addExpBtn = document.querySelector('[data-action="add-event-expense"]');
  if (addExpBtn) addExpBtn.dataset.eventId = eventId;

  // Clear add-expense form
  setElementValue('expenseLabel',  '');
  setElementValue('expenseAmount', '');

  openModal('eventProfitabilityModal');
}

function renderEventExpensesList(eventId) {
  const container = document.getElementById('eventExpensesList');
  if (!container) return;
  const expenses = getEventExpenses(eventId);

  if (!expenses.length) {
    container.innerHTML = `<div class="cost-preview-empty">No expenses logged yet</div>`;
    return;
  }

  container.innerHTML = expenses.map(ex => `
    <div style="display:flex;justify-content:space-between;align-items:center;
      padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;">
      <span style="font-weight:700;">${escapeHtml(ex.label)}</span>
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-weight:800;">${formatCurrency(ex.amount)}</span>
        <button class="btn btn-sm btn-secondary"
          data-action="delete-event-expense"
          data-event-id="${eventId}"
          data-expense-id="${ex.id}">✕</button>
      </div>
    </div>`).join('');
}

function addExpenseFromForm(eventId) {
  const label  = sanitizeText(getElementValue('expenseLabel'));
  const amount = Number(getElementValue('expenseAmount') || 0);
  if (!label)    { showNotification('Expense label required', 'error'); return; }
  if (!amount)   { showNotification('Amount required', 'error'); return; }
  addEventExpense(eventId, { label, amount });
  openEventProfitabilityModal(eventId); // Refresh modal
  showNotification('Expense added', 'success');
}

/* ═══════════════════════════════════════════════════════
   PHASE 2B — EVENT PACKAGE BUILDER
   Predefined packages for fast quotations.
   Each package has a name, price, and list of items.
═══════════════════════════════════════════════════════ */

function getEventPackages() {
  return Array.isArray(APP_STATE.eventPackages) ? APP_STATE.eventPackages : [];
}

function openPackageModal(packageId = null) {
  clearPackageForm();
  renderPackageItemsList([]);

  if (packageId) {
    const pkg = getEventPackages().find(p => String(p.id) === String(packageId));
    if (pkg) {
      setElementValue('packageId',          pkg.id);
      setElementValue('packageName',        pkg.name);
      setElementValue('packagePrice',       pkg.price);
      setElementValue('packageDescription', pkg.description || '');
      setElementValue('packageMinPax',      pkg.minPax     || '');
      setElementValue('packageMaxPax',      pkg.maxPax     || '');
      renderPackageItemsList(pkg.items || []);
    }
  }
  openModal('packageModal');
}

function clearPackageForm() {
  ['packageId','packageName','packagePrice','packageDescription','packageMinPax','packageMaxPax']
    .forEach(id => setElementValue(id, ''));
}

function renderPackageItemsList(items = []) {
  const container = document.getElementById('packageItemsBuilder');
  if (!container) return;
  container.innerHTML = '';
  items.forEach(item => addPackageItemRow(item));
}

function addPackageItemRow(item = null) {
  const container = document.getElementById('packageItemsBuilder');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'packaging-row';
  row.innerHTML = `
    <input type="text" class="pkg-item-name" placeholder="e.g. Espresso, Cappuccino, Signature Drink"
      value="${escapeHtml(item?.name || '')}"
      style="flex:2;padding:7px 10px;border:1px solid var(--border);
        border-radius:var(--radius-md);font-family:var(--font-main);font-size:12px;" />
    <input type="number" class="pkg-item-qty" placeholder="Qty" min="1"
      value="${item?.qty || 1}"
      style="width:70px;padding:7px 10px;border:1px solid var(--border);
        border-radius:var(--radius-md);font-family:var(--font-main);font-size:12px;" />
    <button type="button" class="btn btn-sm btn-secondary pkg-remove">✕</button>`;
  row.querySelector('.pkg-remove').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function collectPackageItems() {
  return Array.from(document.querySelectorAll('#packageItemsBuilder .packaging-row'))
    .map(row => ({
      name: sanitizeText(row.querySelector('.pkg-item-name')?.value || ''),
      qty:  Number(row.querySelector('.pkg-item-qty')?.value || 1)
    }))
    .filter(item => item.name);
}

function savePackage() {
  const id          = getElementValue('packageId') || generateId();
  const name        = sanitizeText(getElementValue('packageName'));
  const price       = Number(getElementValue('packagePrice') || 0);
  const description = sanitizeText(getElementValue('packageDescription'));
  const minPax      = Number(getElementValue('packageMinPax') || 0);
  const maxPax      = Number(getElementValue('packageMaxPax') || 0);
  const items       = collectPackageItems();

  if (!name)  { showNotification('Package name required', 'error'); return; }
  if (!price) { showNotification('Package price required', 'error'); return; }

  const packages = getEventPackages();
  const existing = packages.find(p => String(p.id) === String(id));

  if (existing) {
    Object.assign(existing, { name, price, description, minPax, maxPax, items,
      updatedAt: new Date().toISOString() });
  } else {
    packages.push({ id, name, price, description, minPax, maxPax, items,
      createdAt: new Date().toISOString() });
  }

  updateState('eventPackages', () => packages);
  closeModal('packageModal');
  renderPackagesTable();
  showNotification('Package saved', 'success');
}

function deletePackage(packageId) {
  if (!confirm('Delete this package?')) return;
  updateState('eventPackages', () =>
    getEventPackages().filter(p => String(p.id) !== String(packageId)));
  renderPackagesTable();
  showNotification('Package deleted', 'success');
}

function renderPackagesTable() {
  const grid = document.getElementById('packagesGrid');
  if (!grid) return;
  const packages = getEventPackages();

  if (!packages.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;padding:20px 0 8px;display:flex;align-items:center;gap:10px;
        color:var(--gray-400);">
        <span style="font-size:12px;">No packages yet.</span>
        <button class="btn btn-sm btn-secondary" type="button" onclick="openPackageModal(null);">
          + Create your first package
        </button>
      </div>`;
    return;
  }

  grid.innerHTML = '';
  packages.forEach(pkg => {
    const paxLabel = (pkg.minPax || pkg.maxPax)
      ? `${pkg.minPax || '?'} – ${pkg.maxPax || '?'} pax`
      : null;

    const itemsHtml = (pkg.items || []).length
      ? (pkg.items || []).map(i => `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 0;
            border-bottom:1px solid var(--gray-200);">
            <span style="width:20px;height:20px;border-radius:50%;background:var(--black);
              color:var(--white);font-size:9px;font-weight:900;display:flex;
              align-items:center;justify-content:center;flex-shrink:0;">${i.qty}</span>
            <span style="font-size:12px;font-weight:700;">${escapeHtml(i.name)}</span>
          </div>`).join('')
      : `<div style="font-size:12px;color:var(--gray-400);padding:4px 0;">No items listed</div>`;

    const card = document.createElement('div');
    card.style.cssText = `
      border:1.5px solid var(--border);border-radius:var(--radius-lg);
      background:var(--white);display:flex;flex-direction:column;
      overflow:hidden;box-shadow:var(--shadow-xs);`;

    card.innerHTML = `
      <!-- Header band -->
      <div style="background:var(--black);padding:18px 20px 16px;">
        <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;
          color:rgba(255,255,255,.5);margin-bottom:6px;font-weight:800;">Package</div>
        <div style="font-size:16px;font-weight:900;color:var(--white);
          line-height:1.2;margin-bottom:10px;">${escapeHtml(pkg.name)}</div>
        <div style="display:flex;align-items:baseline;gap:4px;">
          <span style="font-size:26px;font-weight:900;color:var(--white);
            font-variant-numeric:tabular-nums;letter-spacing:-0.5px;">${formatCurrency(pkg.price)}</span>
        </div>
        ${paxLabel ? `
        <div style="margin-top:10px;">
          <span style="display:inline-flex;align-items:center;gap:5px;
            padding:3px 10px;border-radius:var(--radius-full);
            background:rgba(255,255,255,.12);
            color:rgba(255,255,255,.85);font-size:10px;font-weight:800;
            letter-spacing:.5px;">
            👥 ${escapeHtml(paxLabel)}
          </span>
        </div>` : ''}
      </div>

      <!-- Description -->
      ${pkg.description ? `
      <div style="padding:12px 20px 0;font-size:12px;color:var(--gray-600);
        line-height:1.5;font-style:italic;">
        "${escapeHtml(pkg.description)}"
      </div>` : ''}

      <!-- Items list -->
      <div style="padding:14px 20px;flex:1;">
        <div style="font-size:9px;letter-spacing:1.5px;text-transform:uppercase;
          color:var(--gray-400);font-weight:800;margin-bottom:8px;">Inclusions</div>
        ${itemsHtml}
      </div>

      <!-- Actions — hidden in presentation mode -->
      ${_packagePresentationMode ? '' : `
      <div style="padding:12px 20px;border-top:1px solid var(--gray-200);
        display:flex;gap:8px;justify-content:flex-end;background:var(--gray-50);">
        <button class="btn btn-sm" data-action="edit-package"
          data-id="${pkg.id}">Edit</button>
        <button class="btn btn-sm btn-secondary" data-action="delete-package"
          data-id="${pkg.id}">Delete</button>
      </div>`}
    `;

    grid.appendChild(card);
  });
}

/* ═══════════════════════════════════════════════════════
   PHASE 2C — LEAD TRACKER
   Inquiries → Quoted → Booked → Completed / Lost
   Lightweight CRM for event-based operators.
═══════════════════════════════════════════════════════ */

const LEAD_STATUSES = ['INQUIRY', 'QUOTED', 'BOOKED', 'COMPLETED', 'LOST'];
const LEAD_STATUS_LABELS = {
  INQUIRY:   'Inquiry',
  QUOTED:    'Quoted',
  BOOKED:    'Booked',
  COMPLETED: 'Completed',
  LOST:      'Lost'
};
const LEAD_STATUS_STYLES = {
  INQUIRY:   'background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;',
  QUOTED:    'background:#fff7ed;color:#c2410c;border:1px solid #fed7aa;',
  BOOKED:    'background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;',
  COMPLETED: 'background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;',
  LOST:      'background:#f9fafb;color:#9ca3af;border:1px solid #e5e7eb;'
};

function getLeads() {
  return Array.isArray(APP_STATE.leads) ? APP_STATE.leads : [];
}

function openLeadModal(leadId = null) {
  clearLeadForm();
  if (leadId) {
    const lead = getLeads().find(l => String(l.id) === String(leadId));
    if (lead) {
      setElementValue('leadId',          lead.id);
      setElementValue('leadClientName',  lead.clientName);
      setElementValue('leadContact',     lead.contact     || '');
      setElementValue('leadEmail',       lead.email       || '');
      setElementValue('leadEventType',   lead.eventType   || 'Event');
      setElementValue('leadEventDate',   lead.eventDate   || '');
      setElementValue('leadPax',         lead.pax         || '');
      setElementValue('leadBudget',      lead.budget      || '');
      setElementValue('leadPackageRef',  lead.packageRef  || '');
      setElementValue('leadStatus',      lead.status      || 'INQUIRY');
      setElementValue('leadNotes',       lead.notes       || '');
    }
  } else {
    setElementValue('leadStatus', 'INQUIRY');
    setElementValue('leadEventDate', new Date().toISOString().slice(0,10));
  }
  // Populate package reference dropdown
  _populatePackageRefSelect();
  openModal('leadModal');
}

function _populatePackageRefSelect() {
  const select = document.getElementById('leadPackageRef');
  if (!select) return;
  const packages = getEventPackages();
  select.innerHTML = `<option value="">No package / TBD</option>` +
    packages.map(p => `<option value="${p.id}">${escapeHtml(p.name)} — ${formatCurrency(p.price)}</option>`).join('');
}

function clearLeadForm() {
  ['leadId','leadClientName','leadContact','leadEmail','leadEventType',
   'leadEventDate','leadPax','leadBudget','leadPackageRef','leadStatus','leadNotes']
    .forEach(id => setElementValue(id, ''));
}

function saveLead() {
  const id          = getElementValue('leadId') || generateId();
  const clientName  = sanitizeText(getElementValue('leadClientName'));
  const contact     = sanitizeText(getElementValue('leadContact'));
  const email       = sanitizeText(getElementValue('leadEmail'));
  const eventType   = getElementValue('leadEventType') || 'Event';
  const eventDate   = getElementValue('leadEventDate');
  const pax         = Number(getElementValue('leadPax') || 0);
  const budget      = Number(getElementValue('leadBudget') || 0);
  const packageRef  = getElementValue('leadPackageRef') || '';
  const status      = getElementValue('leadStatus') || 'INQUIRY';
  const notes       = sanitizeText(getElementValue('leadNotes'));

  if (!clientName) { showNotification('Client name is required', 'error'); return; }

  const leads    = getLeads();
  const existing = leads.find(l => String(l.id) === String(id));
  const timestamp= new Date().toISOString();

  if (existing) {
    const prevStatus = existing.status;
    Object.assign(existing, { clientName, contact, email, eventType, eventDate,
      pax, budget, packageRef, status, notes, updatedAt: timestamp });
    if (prevStatus !== status) {
      existing.statusHistory = Array.isArray(existing.statusHistory)
        ? existing.statusHistory : [];
      existing.statusHistory.push({ status, changedAt: timestamp,
        changedFrom: prevStatus });
    }
  } else {
    leads.push({ id, clientName, contact, email, eventType, eventDate,
      pax, budget, packageRef, status, notes,
      statusHistory: [{ status, changedAt: timestamp }],
      createdAt: timestamp, updatedAt: timestamp
    });
  }

  updateState('leads', () => leads);
  closeModal('leadModal');
  renderLeadsTable();
  showNotification('Lead saved', 'success');
}

function deleteLead(leadId) {
  if (!confirm('Delete this lead?')) return;
  updateState('leads', () => getLeads().filter(l => String(l.id) !== String(leadId)));
  renderLeadsTable();
  showNotification('Lead deleted', 'success');
}

function renderLeadsTable() {
  const tbody = document.querySelector('#leadsTable tbody');
  if (!tbody) return;

  const statusFilter = document.getElementById('leadStatusFilter')?.value || '';
  let leads = getLeads();
  if (statusFilter) leads = leads.filter(l => l.status === statusFilter);
  leads = leads.slice().sort((a, b) =>
    new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  tbody.innerHTML = '';
  if (!leads.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No leads yet</td></tr>`;
    return;
  }

  leads.forEach(lead => {
    const style   = LEAD_STATUS_STYLES[lead.status] || LEAD_STATUS_STYLES.INQUIRY;
    const label   = LEAD_STATUS_LABELS[lead.status] || lead.status;
    const pkg     = lead.packageRef
      ? getEventPackages().find(p => String(p.id) === String(lead.packageRef))
      : null;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="font-weight:700;">${escapeHtml(lead.clientName)}</td>
      <td style="font-size:11px;">
        ${lead.contact ? escapeHtml(lead.contact) : ''}
        ${lead.email   ? `<br><span style="color:var(--gray-400);">${escapeHtml(lead.email)}</span>` : ''}
      </td>
      <td>${escapeHtml(lead.eventType || '—')}</td>
      <td>${lead.eventDate
        ? new Date(lead.eventDate + 'T00:00:00').toLocaleDateString('en-PH',
            {month:'short',day:'numeric',year:'numeric'})
        : '—'}</td>
      <td style="font-size:11px;">
        ${lead.pax ? `${lead.pax} pax` : '—'}
        ${lead.budget ? `<br>${formatCurrency(lead.budget)}` : ''}
      </td>
      <td style="font-size:11px;color:var(--gray-500);">
        ${pkg ? escapeHtml(pkg.name) : '—'}
      </td>
      <td>
        <span style="display:inline-flex;align-items:center;padding:3px 9px;
          border-radius:999px;font-size:9px;font-weight:800;
          letter-spacing:1px;text-transform:uppercase;${style}">
          ${escapeHtml(label)}
        </span>
      </td>
      <td>
        <div class="table-actions">
          <button class="btn btn-sm" data-action="edit-lead" data-id="${lead.id}">Edit</button>
          <button class="btn btn-sm btn-secondary" data-action="delete-lead" data-id="${lead.id}">Delete</button>
        </div>
      </td>`;
    tbody.appendChild(row);
  });
}

/* ── Lead KPIs ── */
function getLeadKPIs() {
  const leads     = getLeads();
  const total     = leads.length;
  const booked    = leads.filter(l => l.status === 'BOOKED').length;
  const completed = leads.filter(l => l.status === 'COMPLETED').length;
  const lost      = leads.filter(l => l.status === 'LOST').length;
  const convRate  = total > 0 ? Math.round(((booked + completed) / total) * 100) : 0;
  const pipeline  = leads
    .filter(l => ['INQUIRY','QUOTED','BOOKED'].includes(l.status))
    .reduce((s, l) => s + Number(l.budget || 0), 0);
  return { total, booked, completed, lost, convRate, pipeline };
}

/* ── Full view render (Phase 2) ── */
/* ═══════════════════════════════════════════════════════
   BREAK-EVEN UI — full panel in Events, slim bar in POS
═══════════════════════════════════════════════════════ */

/* Which event the panel and POS bar describe: the running session, else
   the most recent event by date so the panel is useful between sessions. */
function _breakEvenFocusEvent() {
  const active = getActiveEvent();
  if (active) return getEvents().find(e => String(e.id) === String(active.id)) || null;
  const dated = getEvents().slice().sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || '')));
  return dated[0] || null;
}

/* Always emits both segments at zero width. The widths are applied by
   _paintBreakEvenBars after the node is in the document, because a CSS
   transition needs an existing element to move from: writing the final
   width straight into the markup makes the bar jump rather than glide. */
function _breakEvenBarHtml() {
  return `
    <div class="be-track">
      <div class="be-fill" style="width:0%;"></div>
      <div class="be-overflow" style="width:0%;"></div>
    </div>`;
}

/* Paint one track. Re-uses the existing nodes when they are already on
   screen, so repeated refreshes animate instead of snapping. */
function _paintBreakEvenBar(host, be) {
  const track = host?.querySelector('.be-track');
  if (!track) return;

  // Stash the target on the node rather than closing over it. The first
  // paint is deferred a frame, and a closure would replay whatever values
  // it captured, undoing any newer update that landed in the meantime.
  track.dataset.pct      = be.pct.toFixed(1);
  track.dataset.overflow = be.overflowPct.toFixed(1);
  track.dataset.reached  = String(be.reached);

  const apply = () => {
    track.classList.toggle('is-profit', track.dataset.reached === 'true');
    const fill = track.querySelector('.be-fill');
    const over = track.querySelector('.be-overflow');
    if (fill) fill.style.width = `${track.dataset.pct}%`;
    if (over) over.style.width = `${track.dataset.overflow}%`;
  };

  if (track.dataset.painted === 'true') { apply(); return; }
  // First paint: let the zero-width state land so there is something to
  // transition from, then move to the real width.
  track.dataset.painted = 'true';
  requestAnimationFrame(() => requestAnimationFrame(apply));
}

function renderEventBreakEvenPanel() {
  const host = document.getElementById('eventBreakEvenPanel');
  if (!host) return;

  const event = _breakEvenFocusEvent();
  if (!event) { host.innerHTML = ''; host.dataset.shape = ''; host.style.display = 'none'; return; }
  host.style.display = 'block';

  const be     = getEventBreakEven(event.id);
  const active = getActiveEvent();
  const isActive = active && String(active.id) === String(event.id);

  // An event dated today with no session running means sales are going
  // untagged. Say so before the whole day is lost rather than after.
  const today = new Date().toISOString().slice(0, 10);
  const needsSession = !isActive && String(event.date || '') === today;

  if (be.unset) {
    host.dataset.shape = `unset:${event.id}`;
    host.innerHTML = `
      <div class="be-panel">
        <div class="be-head">
          <div>
            <div class="be-eyebrow">Break-even</div>
            <div class="be-event">${escapeHtml(event.name)}</div>
          </div>
        </div>
        <div class="be-empty">
          Nothing stocked for this event yet. Add its lineup, or tag a
          production job to it, and the break-even target appears here.
          <button class="btn btn-sm btn-secondary" type="button"
            data-action="edit-event" data-id="${event.id}"
            style="margin-top:10px;">Plan lineup</button>
        </div>
      </div>`;
    return;
  }

  const stat = (k, v) => `<div class="be-stat"><span>${k}</span><b>${v}</b></div>`;
  // Rebuild only when the shape changes. Re-emitting the track on every
  // sale would replace the node and kill its width transition.
  const shape = `panel:${event.id}:${needsSession}:${isActive}`;

  if (host.dataset.shape !== shape) {
    host.dataset.shape = shape;
    host.innerHTML = `
      <div class="be-panel">
        <div class="be-head">
          <div>
            <div class="be-eyebrow">Break-even${isActive ? ' · live' : ''}</div>
            <div class="be-event">${escapeHtml(event.name)}</div>
          </div>
          <div class="be-headline"></div>
        </div>
        ${_breakEvenBarHtml()}
        <div class="be-stats"></div>
        ${needsSession ? `
          <div class="be-nudge">
            This event is today and no session is running, so sales are not
            being counted toward it.
            <button class="btn btn-sm" type="button"
              data-action="activate-event" data-id="${event.id}">Start session</button>
          </div>` : ''}
      </div>`;
  }

  const headline = host.querySelector('.be-headline');
  if (headline) {
    headline.classList.toggle('is-profit', be.reached);
    headline.innerHTML = be.reached
      ? `In profit <b>+${formatCurrency(be.profit)}</b>`
      : `<b>${formatCurrency(be.remaining)}</b> to break even`;
  }
  const stats = host.querySelector('.be-stats');
  if (stats) {
    stats.innerHTML =
      stat('Target',   formatCurrency(be.target)) +
      stat('Revenue',  formatCurrency(be.revenue)) +
      stat('Expenses', formatCurrency(be.expenses)) +
      stat('Stocked',  formatCurrency(be.producedCost)) +
      stat('Sold',     `${be.unitsSold} of ${be.unitsProduced}`);
  }
  _paintBreakEvenBar(host, be);
}

function renderPosBreakEvenBar() {
  const host = document.getElementById('posBreakEvenBar');
  if (!host) return;

  const active = getActiveEvent();
  if (!active) { host.innerHTML = ''; host.dataset.shape = ''; host.style.display = 'none'; return; }

  const be = getEventBreakEven(active.id);
  host.style.display = 'block';

  if (be.unset) {
    host.dataset.shape = `slim-unset:${active.id}`;
    host.innerHTML = `
      <div class="be-slim">
        <div class="be-slim-top">
          <span class="be-slim-name">${escapeHtml(active.name)}</span>
          <span class="be-slim-num">No target set</span>
        </div>
      </div>`;
    return;
  }

  // Same rule as the panel: keep the track node alive across refreshes so
  // the width transition has something to animate from.
  const shape = `slim:${active.id}`;
  if (host.dataset.shape !== shape) {
    host.dataset.shape = shape;
    host.innerHTML = `
      <div class="be-slim">
        <div class="be-slim-top">
          <span class="be-slim-name">${escapeHtml(active.name)}</span>
          <span class="be-slim-num"></span>
        </div>
        ${_breakEvenBarHtml()}
      </div>`;
  }

  const num = host.querySelector('.be-slim-num');
  if (num) {
    num.classList.toggle('is-profit', be.reached);
    num.textContent = be.reached
      ? `+${formatCurrency(be.profit)}`
      : `${formatCurrency(be.remaining)} to go`;
  }
  _paintBreakEvenBar(host, be);
}

/* Single entry point called from every path that moves the numbers. */
function refreshEventBreakEven() {
  renderEventBreakEvenPanel();
  renderPosBreakEvenBar();
}

/* ── Manual lineup builder (event modal) ── */
function _productOptionsHtml(selectedId) {
  return `<option value="">Select product…</option>` +
    (APP_STATE.products || []).map(p =>
      `<option value="${p.id}"${String(p.id) === String(selectedId) ? ' selected' : ''}>
        ${escapeHtml(p.name)}</option>`).join('');
}

function renderPlannedItemsList(items = []) {
  const container = document.getElementById('eventPlannedBuilder');
  if (!container) return;
  container.innerHTML = '';
  items.forEach(item => addPlannedItemRow(item));
  updatePlannedItemsTotal();
}

function addPlannedItemRow(item = null) {
  const container = document.getElementById('eventPlannedBuilder');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'packaging-row planned-row';
  row.innerHTML = `
    <select class="planned-product" style="flex:2;padding:7px 10px;border:1px solid var(--border);
      border-radius:var(--radius-md);font-family:var(--font-main);font-size:12px;">
      ${_productOptionsHtml(item?.productId)}
    </select>
    <input type="number" class="planned-qty" placeholder="Qty" min="1"
      value="${item?.qty || ''}"
      style="width:70px;padding:7px 10px;border:1px solid var(--border);
        border-radius:var(--radius-md);font-family:var(--font-main);font-size:12px;" />
    <span class="planned-cost" style="min-width:74px;text-align:right;font-size:11.5px;
      font-weight:800;color:var(--gray-500);"></span>
    <button type="button" class="btn btn-sm btn-secondary planned-remove">✕</button>`;
  row.querySelector('.planned-remove').addEventListener('click', () => {
    row.remove(); updatePlannedItemsTotal();
  });
  row.querySelector('.planned-product').addEventListener('change', updatePlannedItemsTotal);
  row.querySelector('.planned-qty').addEventListener('input', updatePlannedItemsTotal);
  container.appendChild(row);
  updatePlannedItemsTotal();
}

function collectPlannedItems() {
  return Array.from(document.querySelectorAll('#eventPlannedBuilder .planned-row'))
    .map(row => ({
      productId: row.querySelector('.planned-product')?.value || '',
      qty:       Number(row.querySelector('.planned-qty')?.value || 0),
    }))
    .filter(l => l.productId && l.qty > 0);
}

/* Live cost per row and a running total, so the target is visible while
   planning rather than only after saving. */
function updatePlannedItemsTotal() {
  let total = 0;
  document.querySelectorAll('#eventPlannedBuilder .planned-row').forEach(row => {
    const id  = row.querySelector('.planned-product')?.value || '';
    const qty = Number(row.querySelector('.planned-qty')?.value || 0);
    const cost = id && qty > 0 ? qty * _eventUnitCost(id) : 0;
    total += cost;
    const cell = row.querySelector('.planned-cost');
    if (cell) cell.textContent = cost > 0 ? formatCurrency(cost) : '';
  });
  const out = document.getElementById('eventPlannedTotal');
  if (out) out.textContent = formatCurrency(total);
}

function renderCoffeeCartView() {
  renderEventsTable();
  renderPackagesTable();
  renderLeadsTable();
  renderEventBreakEvenPanel();

  // Lead KPIs
  const kpi = getLeadKPIs();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('leadKpiTotal',    kpi.total);
  set('leadKpiBooked',   kpi.booked);
  set('leadKpiConv',     kpi.convRate + '%');
  set('leadKpiPipeline', formatCurrency(kpi.pipeline));
}

/* ── Phase 2 exports ── */
window.getEventProfitability        = getEventProfitability;
window.openEventProfitabilityModal  = openEventProfitabilityModal;
window.addExpenseFromForm           = addExpenseFromForm;
window.deleteEventExpense           = deleteEventExpense;
window.renderEventExpensesList      = renderEventExpensesList;
window.getEventPackages             = getEventPackages;
window.openPackageModal             = openPackageModal;
window.savePackage                  = savePackage;
window.deletePackage                = deletePackage;
window.addPackageItemRow            = addPackageItemRow;
window.renderPackagesTable          = renderPackagesTable;
window.getLeads                     = getLeads;
window.openLeadModal                = openLeadModal;
window.saveLead                     = saveLead;
window.deleteLead                   = deleteLead;
window.renderLeadsTable             = renderLeadsTable;
window.getLeadKPIs                  = getLeadKPIs;
window.renderCoffeeCartView         = renderCoffeeCartView;
window.LEAD_STATUSES                = LEAD_STATUSES;
window.LEAD_STATUS_LABELS           = LEAD_STATUS_LABELS;

/* ═══════════════════════════════════════════════════════
   EVENT PICKER — POS Cart Button
   Replaces the old Active Event Session banner.
   Cashier explicitly picks an event per cart session.
   All sales while an event is selected are tagged to it.
   Selecting "No Event" clears the tag.
═══════════════════════════════════════════════════════ */

function getSelectedPOSEvent() {
  return APP_STATE.ui?.selectedPOSEvent || null;
}

function applyEventPickerButton() {
  const btn     = document.getElementById('eventPickerBtn');
  const enabled = APP_STATE.settings?.coffeeCartModeEnabled === true;
  if (!btn) return;
  btn.style.display = enabled ? 'block' : 'none';
  _updateEventPickerLabel();
}

function _updateEventPickerLabel() {
  const btn   = document.getElementById('eventPickerBtn');
  if (!btn) return;
  const event = getSelectedPOSEvent();
  if (event) {
    btn.textContent = `Event: ${event.name}`;
    btn.style.borderColor    = '#000';
    btn.style.background     = '#000';
    btn.style.color          = '#fff';
  } else {
    btn.textContent          = 'Tag Event';
    btn.style.borderColor    = '';
    btn.style.background     = '';
    btn.style.color          = '';
  }
}

function openEventPickerModal() {
  const events = getEvents();
  const container = document.getElementById('eventPickerList');
  if (!container) return;

  const current = getSelectedPOSEvent();

  container.innerHTML = '';

  // "No Event" option first
  const noneBtn = document.createElement('button');
  noneBtn.type      = 'button';
  noneBtn.className = `event-picker-option${!current ? ' active' : ''}`;
  noneBtn.textContent = 'No Event — Normal Sale';
  noneBtn.addEventListener('click', () => {
    updateState('ui', s => ({ ...s, selectedPOSEvent: null }));
    _updateEventPickerLabel();
    closeModal('eventPickerModal');
    if (typeof pushAuditEntry === 'function') {
      pushAuditEntry({ action: 'POS_EVENT_CLEARED', outcome: 'SUCCESS', note: 'Event tag cleared' });
    }
  });
  container.appendChild(noneBtn);

  if (!events.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:12px;color:var(--gray-400);padding:12px 0;text-align:center;';
    empty.textContent   = 'No events yet — create one in the Events tab';
    container.appendChild(empty);
  } else {
    events.forEach(event => {
      const isActive = current?.id === event.id;
      const btn      = document.createElement('button');
      btn.type        = 'button';
      btn.className   = `event-picker-option${isActive ? ' active' : ''}`;

      const rev = _getEventRevenue(event.id);
      btn.innerHTML = `
        <div style="font-weight:800;">${escapeHtml(event.name)}</div>
        <div style="font-size:10px;color:${isActive ? 'rgba(255,255,255,.7)' : 'var(--gray-400)'};
          margin-top:2px;">
          ${event.type || 'Event'}
          ${event.date ? ' · ' + new Date(event.date + 'T00:00:00')
              .toLocaleDateString('en-PH',{month:'short',day:'numeric'}) : ''}
          ${rev > 0 ? ' · ' + formatCurrency(rev) + ' tagged' : ''}
        </div>`;

      btn.addEventListener('click', () => {
        updateState('ui', s => ({ ...s, selectedPOSEvent: { id: event.id, name: event.name } }));
        _updateEventPickerLabel();
        closeModal('eventPickerModal');
        showNotification(`Sales will be tagged to "${event.name}"`, 'success');
        if (typeof pushAuditEntry === 'function') {
          pushAuditEntry({
            action: 'POS_EVENT_SELECTED', outcome: 'SUCCESS',
            note: `Event selected: ${event.name}`
          });
        }
      });
      container.appendChild(btn);
    });
  }

  openModal('eventPickerModal');
}

window.getSelectedPOSEvent    = getSelectedPOSEvent;
window.applyEventPickerButton = applyEventPickerButton;
window.openEventPickerModal   = openEventPickerModal;
window._updateEventPickerLabel= _updateEventPickerLabel;

/* ── Package Presentation Mode ── */
let _packagePresentationMode = false;

function togglePackagePresentationMode() {
  _packagePresentationMode = !_packagePresentationMode;
  const btn     = document.getElementById('packagePresentationBtn');
  const addBtn  = document.getElementById('addPackageBtn');

  if (_packagePresentationMode) {
    if (btn) {
      btn.textContent = 'Exit Presentation';
      btn.style.background    = '#000';
      btn.style.color         = '#fff';
      btn.style.borderColor   = '#000';
    }
    if (addBtn) addBtn.style.display = 'none';
  } else {
    if (btn) {
      btn.textContent = 'Present';
      btn.style.background  = '';
      btn.style.color       = '';
      btn.style.borderColor = '';
    }
    if (addBtn) addBtn.style.display = '';
  }

  // Re-render cards with/without edit controls
  renderPackagesTable();
}

window.togglePackagePresentationMode = togglePackagePresentationMode;
