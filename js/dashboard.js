/* ═══════════════════════════════════════════════════════
   DASHBOARD.JS — Dashboard view rendering
   Pure renderer. All data from analytics.js.
   No calculations here.
═══════════════════════════════════════════════════════ */

let dashboardChartInstance = null;

function getDashboardChartTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  return {
    bar:     dark ? '#f0eeeb'               : '#000',
    barPrev: dark ? 'rgba(240,238,235,.28)' : '#c0c0c0',
    grid:    dark ? 'rgba(255,255,255,.07)' : '#f0f0f0',
    tick:    dark ? 'rgba(240,238,235,.45)' : '#999',
    fill:    dark ? 'rgba(240,238,235,.06)' : 'rgba(0,0,0,.04)',
    empty:   dark ? 'rgba(240,238,235,.35)' : '#aaa',
  };
}

/* ── Entry point ── */
function refreshDashboard() {
  updateNavBadges();
  const kpi = getKPISummary();

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('dashboardTotalSales',  formatCurrency(kpi.totalRevenue || kpi.revenue));
  set('dashboardTotalOrders', kpi.totalOrders || kpi.orders);
  set('dashboardItemsSold',   kpi.itemsSold);
  set('dashboardAverageOrder',formatCurrency(kpi.avgTicket));

  // Revenue + orders breakdown sub-labels
  const rb = document.getElementById('dashboardRevenueBreakdown');
  if (rb) rb.textContent = `POS: ${formatCurrency(kpi.posRevenue)} (${kpi.posRevenuePercent}%) · Supply: ${formatCurrency(kpi.supplyRevenue)} (${kpi.supplyRevenuePercent}%)`;
  const ob = document.getElementById('dashboardOrdersBreakdown');
  if (ob) ob.textContent = `POS: ${kpi.posOrders} (${kpi.posOrderPercent}%) · Supply: ${kpi.supplyOrders} (${kpi.supplyOrderPercent}%)`;

  renderDashboardKPIAlerts(kpi);
  if (typeof renderForesightTeaser === 'function') renderForesightTeaser();
  if (typeof _renderDailyCloseChip === 'function') _renderDailyCloseChip();
  renderTopProducts();
  renderLowStockDashboard();
  renderDashboardChart();
  renderChannelBreakdownDashboard();
  renderDashboardInventoryValue();
  renderAnalyticsPanel();
}

/* ── KPI alert badges ── */
function renderDashboardKPIAlerts(kpi) {
  const pendingEl = document.getElementById('dashboardPendingOrders');
  if (pendingEl) pendingEl.textContent = kpi.pendingOrders;

  const lowStockEl = document.getElementById('dashboardLowStockCount');
  if (lowStockEl) lowStockEl.textContent = kpi.lowStockCount;

  // Highlight alert cards
  const pendingCard = document.getElementById('dashboardPendingCard');
  if (pendingCard) {
    pendingCard.classList.toggle('dashboard-alert', kpi.pendingOrders > 0);
  }
  const stockCard = document.getElementById('dashboardStockCard');
  if (stockCard) {
    stockCard.classList.toggle('dashboard-alert', kpi.lowStockCount > 0);
  }
}

/* ── Sales trend chart ── */
function renderDashboardChart() {
  const canvas = document.getElementById('dashboardChart');
  if (chartUnavailable(canvas)) return;

  const trend = getDailySalesTrend();

  if (dashboardChartInstance) {
    dashboardChartInstance.destroy();
    dashboardChartInstance = null;
  }

  const ct = getDashboardChartTheme();

  if (!trend.labels.length) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '12px Nunito, sans-serif';
    ctx.fillStyle = ct.empty;
    ctx.textAlign = 'center';
    ctx.fillText('No sales data yet', canvas.width / 2, canvas.height / 2);
    return;
  }

  const labels = trend.labels.slice(-14);
  const values = trend.values.slice(-14);
  const shortLabels = labels.map(l =>
    new Date(l).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
  );

  dashboardChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: shortLabels,
      datasets: [{
        label: 'Revenue',
        data: values,
        backgroundColor: ct.bar,
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 48,
        barPercentage: 0.6,
        categoryPercentage: 0.7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => formatCurrency(ctx.parsed.y) } }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 }, color: ct.tick }
        },
        y: {
          grid: { color: ct.grid },
          ticks: {
            font: { size: 11 }, color: ct.tick,
            callback: v => getCurrencySymbol() + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v)
          }
        }
      }
    }
  });
}

/* ── Top products widget ── */
function renderTopProducts() {
  const container = document.getElementById('topProductsContainer');
  if (!container) return;

  const top = getTopProducts(5);

  if (!top.length) {
    container.innerHTML = `<div class="empty-state">No sales yet — complete a sale to see rankings</div>`;
    return;
  }

  container.innerHTML = top.map((item, i) => `
    <div class="top-product-row">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:10px;font-weight:900;color:var(--gray-300);width:16px;text-align:right;">${i + 1}</span>
        <div class="top-product-name">${escapeHtml(item.name)}</div>
      </div>
      <div class="top-product-qty">${item.qty} sold &middot; ${formatCurrency(item.revenue)}</div>
    </div>`).join('');
}

/* ── Low stock widget ── */
function renderLowStockDashboard() {
  const container = document.getElementById('lowStockContainer');
  if (!container) return;

  const ingredientAlerts = getLowStockItems();
  const productAlerts    = getLowStockProducts();

  const all = [
    ...ingredientAlerts.map(i => ({
      name: i.name, stock: Number(i.stock || 0), unit: i.unit || '',
      type: 'Ingredient', soldOut: Number(i.stock || 0) <= 0
    })),
    ...productAlerts.map(p => ({
      name: p.name, stock: Number(p.stock || 0), unit: 'units',
      type: 'Product', soldOut: Number(p.stock || 0) <= 0
    }))
  ];

  if (!all.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:20px 0;">
        All stock levels OK ✓
      </div>`;
    return;
  }

  // Sort: sold out first, then low stock
  all.sort((a, b) => Number(b.soldOut) - Number(a.soldOut));

  container.innerHTML = all.map(item => `
    <div class="low-stock-card${item.soldOut ? ' sold-out' : ''}">
      <div>
        <div class="low-stock-name">${escapeHtml(item.name)}</div>
        <div class="low-stock-meta" style="font-size:9px;letter-spacing:1px;text-transform:uppercase;">
          ${escapeHtml(item.type)} · ${item.soldOut ? 'OUT OF STOCK' : 'LOW STOCK'}
        </div>
      </div>
      <div class="low-stock-meta">
        ${item.soldOut ? '0' : round2(item.stock)} ${escapeHtml(item.unit)} left
      </div>
    </div>`).join('');
}


/* ── Channel breakdown (dashboard) ── */
function renderChannelBreakdownDashboard() {
  const container = document.getElementById('dashboardChannelBreakdown');
  if (!container) return;

  const revenue  = typeof getRevenueByChannel === 'function' ? getRevenueByChannel() : {};
  const orders   = typeof getOrdersByChannel  === 'function' ? getOrdersByChannel()  : {};
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
    const barW  = totalRev > 0 ? Math.round((chRev / totalRev) * 100) : 0;

    return `
      <div style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;
          align-items:baseline;margin-bottom:4px;">
          <span style="font-size:12px;font-weight:700;">${escapeHtml(ch)}</span>
          <span style="font-size:12px;font-variant-numeric:tabular-nums;">
            ${formatCurrency(chRev)}
            <span style="color:var(--gray-400);font-size:10px;margin-left:4px;">
              ${chOrd} order${chOrd !== 1 ? 's' : ''} · ${pct}%
            </span>
          </span>
        </div>
        <div style="height:6px;background:var(--gray-100);border-radius:999px;overflow:hidden;">
          <div style="height:100%;width:${barW}%;background:var(--black);
            border-radius:999px;transition:width .3s ease;"></div>
        </div>
      </div>`;
  }).join('');
}


/* ── Inventory Value cards (dashboard) ── */
function renderDashboardInventoryValue() {
  if (typeof getInventoryValueSnapshot !== 'function') return;

  const snap = getInventoryValueSnapshot();

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  set('dashboardInventoryTotal', formatCurrency(snap.total));
  set('dashboardRawValue',       formatCurrency(snap.rawMaterials));
  set('dashboardFGValue',        formatCurrency(snap.finishedGoods));

  const rawSub = document.getElementById('dashboardRawSub');
  if (rawSub) {
    rawSub.innerHTML = snap.rawMissing > 0
      ? `${snap.rawLines.filter(l => !l.noCost).length} costed · <span style="color:#e44;">${snap.rawMissing} missing cost</span>`
      : `${snap.rawLines.length} ingredients costed`;
  }

  const fgSub = document.getElementById('dashboardFGSub');
  if (fgSub) {
    fgSub.innerHTML = snap.fgMissing > 0
      ? `${snap.fgLines.filter(l => !l.noCost).length} costed · <span style="color:#e44;">${snap.fgMissing} no recipe</span>`
      : `${snap.fgLines.length} products costed`;
  }
}


/* ═══════════════════════════════════════════════════════
   PERIOD ANALYTICS — Daily / Weekly / Monthly / Yearly
═══════════════════════════════════════════════════════ */

let _analyticsPeriod = 'weekly';
let _analyticsChartInstance = null;

function renderAnalyticsPanel() {
  const container = document.getElementById('analyticsPanel');
  if (!container) return;

  const kpis  = getPeriodKPIs(_analyticsPeriod);
  const trend = getPeriodTrend(_analyticsPeriod);
  const top   = getPeriodTopProducts(_analyticsPeriod, 5);
  const pay   = getPeriodPaymentBreakdown(_analyticsPeriod);
  const cats  = getPeriodCategoryBreakdown(_analyticsPeriod);

  const periodLabel = {
    daily: 'Today', weekly: 'This Week',
    monthly: 'This Month', yearly: 'This Year'
  }[_analyticsPeriod];

  const prevLabel = {
    daily: 'vs yesterday', weekly: 'vs last week',
    monthly: 'vs last month', yearly: 'vs last year'
  }[_analyticsPeriod];

  container.innerHTML = `
    <!-- Period Switcher -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
      <div>
        <div style="font-size:11px;color:var(--gray-400);letter-spacing:0.08em;
          text-transform:uppercase;margin-bottom:4px;">Analytics</div>
        <div style="font-size:18px;font-weight:900;letter-spacing:-0.01em;">${periodLabel}</div>
      </div>
      <div style="display:flex;gap:4px;background:var(--gray-100);
        border-radius:10px;padding:4px;">
        ${['daily','weekly','monthly','yearly'].map(p => `
          <button onclick="setAnalyticsPeriod('${p}')"
            style="padding:6px 14px;border:none;border-radius:7px;font-size:11px;
              font-weight:${_analyticsPeriod === p ? '800' : '500'};cursor:pointer;
              background:${_analyticsPeriod === p ? 'var(--gray-900)' : 'transparent'};
              color:${_analyticsPeriod === p ? 'var(--gray-50)' : 'var(--gray-500)'};
              font-family:inherit;transition:all 0.15s;letter-spacing:0.02em;">
            ${p.charAt(0).toUpperCase() + p.slice(1)}
          </button>`).join('')}
      </div>
    </div>

    <!-- KPI Cards -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">
      ${[
        { label:'Revenue',   value: formatCurrency(kpis.revenue),           delta: kpis.revDelta,   up: kpis.revUp   },
        { label:'Orders',    value: kpis.orders,                             delta: kpis.ordDelta,   up: kpis.ordUp   },
        { label:'Items Sold',value: kpis.items,                              delta: kpis.itemsDelta, up: kpis.itemsUp },
        { label:'Avg Order', value: formatCurrency(kpis.avgTicket),          delta: kpis.avgDelta,   up: kpis.avgUp   },
      ].map(k => `
        <div style="border:1.5px solid var(--border);border-radius:12px;padding:16px 18px;">
          <div style="font-size:10px;color:var(--gray-400);letter-spacing:0.08em;
            text-transform:uppercase;margin-bottom:8px;">${k.label}</div>
          <div style="font-size:22px;font-weight:900;letter-spacing:-0.02em;
            margin-bottom:6px;">${k.value}</div>
          <div style="font-size:11px;font-weight:600;
            color:${k.up ? '#16a34a' : '#dc2626'};">
            ${k.delta} <span style="color:var(--gray-400);font-weight:400;">${prevLabel}</span>
          </div>
        </div>`).join('')}
    </div>

    <!-- Trend Chart -->
    <div style="border:1.5px solid var(--border);border-radius:12px;
      padding:20px;margin-bottom:20px;">
      <div style="font-size:10px;font-weight:700;color:var(--gray-400);
        letter-spacing:0.08em;text-transform:uppercase;margin-bottom:16px;">
        Revenue — ${periodLabel}
      </div>
      <div style="height:160px;">
        <canvas id="analyticsChart"></canvas>
      </div>
    </div>

    <!-- Bottom Row: Top Products + Payment + Category -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">

      <!-- Top Products -->
      <div style="border:1.5px solid var(--border);border-radius:12px;padding:18px;">
        <div style="font-size:10px;font-weight:700;color:var(--gray-400);
          letter-spacing:0.08em;text-transform:uppercase;margin-bottom:14px;">
          Top Products
        </div>
        ${top.length === 0
          ? `<div style="font-size:12px;color:var(--gray-300);text-align:center;padding:16px 0;">No sales this period</div>`
          : top.map((p, i) => `
            <div style="display:flex;justify-content:space-between;align-items:center;
              padding:8px 0;border-bottom:1px solid var(--border);">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:9px;font-weight:900;color:var(--gray-300);
                  width:12px;">${i+1}</span>
                <div>
                  <div style="font-size:12px;font-weight:600;">${escapeHtml(p.name)}</div>
                  <div style="font-size:10px;color:var(--gray-400);">${p.qty} sold</div>
                </div>
              </div>
              <div style="font-size:12px;font-weight:800;">${formatCurrency(p.revenue)}</div>
            </div>`).join('')}
      </div>

      <!-- Payment Methods -->
      <div style="border:1.5px solid var(--border);border-radius:12px;padding:18px;">
        <div style="font-size:10px;font-weight:700;color:var(--gray-400);
          letter-spacing:0.08em;text-transform:uppercase;margin-bottom:14px;">
          Payment Methods
        </div>
        ${Object.keys(pay).length === 0
          ? `<div style="font-size:12px;color:var(--gray-300);text-align:center;padding:16px 0;">No sales this period</div>`
          : (() => {
              const total = Object.values(pay).reduce((s,v) => s+v, 0);
              return Object.entries(pay)
                .sort((a,b) => b[1]-a[1])
                .map(([method, val]) => {
                  const pct = total > 0 ? (val/total*100).toFixed(0) : 0;
                  return `
                    <div style="margin-bottom:12px;">
                      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                        <span style="font-size:12px;font-weight:600;text-transform:capitalize;">${escapeHtml(method)}</span>
                        <span style="font-size:11px;color:var(--gray-400);">${pct}%</span>
                      </div>
                      <div style="height:4px;background:var(--gray-100);border-radius:2px;">
                        <div style="width:${pct}%;height:100%;background:var(--gray-900);border-radius:2px;"></div>
                      </div>
                      <div style="font-size:11px;color:var(--gray-400);margin-top:2px;">${formatCurrency(val)}</div>
                    </div>`;
                }).join('');
            })()}
      </div>

      <!-- Category Performance -->
      <div style="border:1.5px solid var(--border);border-radius:12px;padding:18px;">
        <div style="font-size:10px;font-weight:700;color:var(--gray-400);
          letter-spacing:0.08em;text-transform:uppercase;margin-bottom:14px;">
          By Category
        </div>
        ${(!cats || cats.length === 0)
          ? `<div style="font-size:12px;color:var(--gray-300);text-align:center;padding:16px 0;">No sales this period</div>`
          : (() => {
              const total = cats.reduce((s, c) => s + (c.revenue || 0), 0);
              return cats
                .sort((a,b) => (b.revenue||0) - (a.revenue||0))
                .slice(0, 5)
                .map(c => {
                  const pct = total > 0 ? ((c.revenue||0)/total*100).toFixed(0) : 0;
                  return `
                    <div style="margin-bottom:12px;">
                      <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                        <span style="font-size:12px;font-weight:600;">${escapeHtml(c.category || c.name || '—')}</span>
                        <span style="font-size:11px;color:var(--gray-400);">${pct}%</span>
                      </div>
                      <div style="height:4px;background:var(--gray-100);border-radius:2px;">
                        <div style="width:${pct}%;height:100%;background:var(--gray-900);border-radius:2px;"></div>
                      </div>
                      <div style="font-size:11px;color:var(--gray-400);margin-top:2px;">${formatCurrency(c.revenue||0)}</div>
                    </div>`;
                }).join('');
            })()}
      </div>

    </div>
  `;

  // Render chart after DOM is ready
  requestAnimationFrame(() => _renderAnalyticsChart(trend));
}

function _renderAnalyticsChart(trend) {
  const canvas = document.getElementById('analyticsChart');
  if (chartUnavailable(canvas)) return;

  if (_analyticsChartInstance) {
    _analyticsChartInstance.destroy();
    _analyticsChartInstance = null;
  }

  const ct = getDashboardChartTheme();

  if (!trend.values.some(v => v > 0)) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = '11px Nunito, sans-serif';
    ctx.fillStyle = ct.empty;
    ctx.textAlign = 'center';
    ctx.fillText('No sales data this period', canvas.width/2, canvas.height/2);
    return;
  }

  _analyticsChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: trend.labels,
      datasets: [{
        data: trend.values,
        backgroundColor: trend.values.map((v, i) =>
          i === trend.values.length - 1 ? ct.bar : ct.barPrev),
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => formatCurrency(ctx.parsed.y),
            afterLabel: ctx => `${trend.orders[ctx.dataIndex]} order${trend.orders[ctx.dataIndex] !== 1 ? 's' : ''}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 10 }, color: ct.tick,
            maxRotation: 0,
            maxTicksLimit: _analyticsPeriod === 'monthly' ? 15 : 24,
          }
        },
        y: {
          grid: { color: ct.grid },
          ticks: {
            font: { size: 10 }, color: ct.tick,
            callback: v => v >= 1000 ? getCurrencySymbol() + (v/1000).toFixed(1) + 'k' : getCurrencySymbol() + v
          }
        }
      }
    }
  });
}

function setAnalyticsPeriod(period) {
  _analyticsPeriod = period;
  renderAnalyticsPanel();
}

/* ── Nav badges ── */
function updateNavBadges() {
  const navBtn = document.getElementById('navDashboard');
  if (!navBtn) return;

  const lowCount = typeof getLowStockItems === 'function'
    ? getLowStockItems().length : 0;

  let badge = document.getElementById('dashboardNavBadge');

  if (lowCount > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'dashboardNavBadge';
      badge.style.cssText = `
        display:inline-flex;align-items:center;justify-content:center;
        min-width:16px;height:16px;padding:0 4px;
        background:var(--danger);color:#fff;
        font-size:9px;font-weight:900;border-radius:999px;
        margin-left:5px;line-height:1;vertical-align:middle;
        font-family:var(--font-main);letter-spacing:0;
      `;
      navBtn.appendChild(badge);
    }
    badge.textContent = lowCount > 99 ? '99+' : lowCount;
    badge.style.display = 'inline-flex';
  } else if (badge) {
    badge.style.display = 'none';
  }
}

/* ── Re-render charts when theme changes ── */
new MutationObserver(() => {
  renderDashboardChart();
  if (_analyticsChartInstance) renderAnalyticsPanel();
}).observe(document.documentElement, { attributeFilter: ['data-theme'] });

/* ── Exports ── */
window.refreshDashboard       = refreshDashboard;
window.updateNavBadges        = updateNavBadges;
window.renderChannelBreakdownDashboard = renderChannelBreakdownDashboard;
window.renderDashboardChart   = renderDashboardChart;
window.renderTopProducts      = renderTopProducts;
window.renderLowStockDashboard= renderLowStockDashboard;
window.renderDashboardInventoryValue = renderDashboardInventoryValue;
window.renderAnalyticsPanel = renderAnalyticsPanel;
window.setAnalyticsPeriod   = setAnalyticsPeriod;
