/* ═══════════════════════════════════════════════════════
   REPORTS.JS — Full rewrite
   Order: KPIs → Revenue → Losses → When/How → Discounts
          → Category → Products → Ingredients → Insights
          → Profitability (toggle) → PDF Export
═══════════════════════════════════════════════════════ */

let reportChartInstance    = null;

function getChartTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  return {
    line:     dark ? '#f0eeeb'               : '#000',
    fill:     dark ? 'rgba(240,238,235,.06)' : 'rgba(0,0,0,.04)',
    point:    dark ? '#f0eeeb'               : '#000',
    ptBorder: dark ? '#1a1a20'               : '#fff',
    grid:     dark ? 'rgba(255,255,255,.07)' : '#f0f0f0',
    tick:     dark ? 'rgba(240,238,235,.50)' : '#999',
    bar:      dark ? '#f0eeeb'               : '#000',
    barMid:   dark ? 'rgba(240,238,235,.40)' : '#9ca3af',
    barLight: dark ? 'rgba(240,238,235,.20)' : '#e5e7eb',
    isDark:   dark,
  };
}
let hourlyChartInstance    = null;
let _categoryChartInstances = {};
let _pureProfitCumChart    = null;
let _pureProfitCatChart    = null;
let _revVsCostChart        = null;

function getReportDateRange() {
  const fromVal = document.getElementById('reportFromDate')?.value;
  const toVal   = document.getElementById('reportToDate')?.value;
  return {
    fromDate: fromVal ? new Date(`${fromVal}T00:00:00`) : null,
    toDate:   toVal   ? new Date(`${toVal}T23:59:59`)   : null
  };
}

function getPreviousPeriod(fromDate, toDate) {
  if (!fromDate || !toDate) return { fromDate: null, toDate: null };
  const ms   = toDate - fromDate;
  const prev = new Date(fromDate - ms - 86400000);
  const prevTo = new Date(fromDate - 86400000);
  prevTo.setHours(23, 59, 59, 999);
  return { fromDate: prev, toDate: prevTo };
}

function deltaBadge(curr, prev) {
  if (!prev || prev === 0) return '';
  const pct = ((curr - prev) / prev) * 100;
  const sign = pct >= 0 ? '+' : '';
  const color = pct >= 0 ? '#16a34a' : '#dc2626';
  return `<span style="font-size:10px;font-weight:800;color:${color};margin-left:6px;">${sign}${pct.toFixed(1)}%</span>`;
}

function renderReports() {
  const { fromDate, toDate } = getReportDateRange();
  const prev = getPreviousPeriod(fromDate, toDate);
  renderReportKPIs(fromDate, toDate, prev);
  renderRevenueChart(fromDate, toDate);
  renderVoidRefundSummary(fromDate, toDate);
  renderHourlyHeatmap(fromDate, toDate);
  renderPaymentBreakdown(fromDate, toDate);
  renderDiscountAnalysis(fromDate, toDate);
  renderCategoryPerformance(fromDate, toDate);
  renderReportProductsTable(fromDate, toDate);
  renderIngredientUsageTable(fromDate, toDate);
  renderReportInsightsTable(fromDate, toDate);
  renderChannelBreakdownReport(fromDate, toDate);
  renderAllProfitability(fromDate, toDate);
  if (typeof renderDayClosesTable === 'function') renderDayClosesTable();
  _animateReportSections();
}

/* ── 1. KPIs + Period Comparison ── */
function renderReportKPIs(fromDate, toDate, prev) {
  const statsGrid = document.getElementById('reportStatsGrid');
  if (!statsGrid) return;
  const posRevenue  = getRevenue(fromDate, toDate);
  const orders      = getOrderCount(fromDate, toDate);
  const items       = getItemsSold(fromDate, toDate);
  const avg         = getAverageTicket(fromDate, toDate);
  const prevRevenue = prev.fromDate ? getRevenue(prev.fromDate, prev.toDate) : 0;
  const prevOrders  = prev.fromDate ? getOrderCount(prev.fromDate, prev.toDate) : 0;
  const prevItems   = prev.fromDate ? getItemsSold(prev.fromDate, prev.toDate) : 0;
  const prevAvg     = prev.fromDate ? getAverageTicket(prev.fromDate, prev.toDate) : 0;
  const supplyRevenue  = typeof getSupplyRevenue_      === 'function' ? getSupplyRevenue_()      : 0;
  const supplyOrders   = typeof getSupplyOrderCount_   === 'function' ? getSupplyOrderCount_()   : 0;
  const outstanding    = typeof getOutstandingReceivables === 'function' ? getOutstandingReceivables() : 0;
  const collectionRate = typeof getCollectionRate      === 'function' ? getCollectionRate()      : 0;
  const totalRevenue   = posRevenue + supplyRevenue;
  const hasPrev = prev.fromDate !== null;
  statsGrid.innerHTML = `
    <div class="stat-card dark">
      <div class="label">Total Revenue</div>
      <div class="value">${formatCurrency(totalRevenue)}${hasPrev ? deltaBadge(posRevenue, prevRevenue) : ''}</div>
      <div class="sub">POS: ${formatCurrency(posRevenue)} · Supply: ${formatCurrency(supplyRevenue)}</div>
    </div>
    <div class="stat-card">
      <div class="label">POS Orders</div>
      <div class="value">${orders}${hasPrev ? deltaBadge(orders, prevOrders) : ''}</div>
      <div class="sub">Avg ${formatCurrency(avg)}${hasPrev ? deltaBadge(avg, prevAvg) : ''}</div>
    </div>
    <div class="stat-card">
      <div class="label">Items Sold</div>
      <div class="value">${items}${hasPrev ? deltaBadge(items, prevItems) : ''}</div>
      <div class="sub">Units moved in period</div>
    </div>
    <div class="stat-card">
      <div class="label">Supply Orders</div>
      <div class="value">${supplyOrders}</div>
      <div class="sub">${formatCurrency(supplyRevenue)} revenue</div>
    </div>
    <div class="stat-card">
      <div class="label">Receivables</div>
      <div class="value" style="font-size:20px;">${formatCurrency(outstanding)}</div>
      <div class="sub">Collection rate: ${collectionRate.toFixed(1)}%</div>
    </div>
    ${hasPrev ? `
    <div class="stat-card" style="border-style:dashed;">
      <div class="label">vs Previous Period</div>
      <div style="font-size:11px;color:var(--gray-500);margin-top:6px;line-height:2;">
        Revenue: ${deltaBadge(posRevenue, prevRevenue)}<br>
        Orders: ${deltaBadge(orders, prevOrders)}<br>
        Avg ticket: ${deltaBadge(avg, prevAvg)}
      </div>
    </div>` : ''}`;
}

/* ── 2. Revenue Trend ── */
function renderRevenueChart(fromDate, toDate) {
  const canvas = document.getElementById('reportRevenueChart');
  if (chartUnavailable(canvas)) return;
  const trend = getDailySalesTrend(fromDate, toDate);
  if (reportChartInstance) { reportChartInstance.destroy(); reportChartInstance = null; }
  if (!trend.labels.length) {
    canvas.style.display = 'none';
    return;
  }
  canvas.style.display = '';
  const ct = getChartTheme();
  const shortLabels = trend.labels.map(l =>
    new Date(l).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }));
  reportChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: shortLabels, datasets: [{ label: 'Revenue', data: trend.values,
      borderColor: ct.line, backgroundColor: ct.fill, fill: true, tension: 0.35,
      pointRadius: trend.labels.length > 20 ? 0 : 4,
      pointBackgroundColor: ct.point, pointBorderColor: ct.ptBorder, pointBorderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatCurrency(ctx.parsed.y) } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 }, color: ct.tick, maxTicksLimit: 10 } },
        y: { grid: { color: ct.grid }, ticks: { font: { size: 11 }, color: ct.tick,
          callback: v => getCurrencySymbol() + (v >= 1000 ? (v/1000).toFixed(1)+'k' : v) } } } }
  });
}

/* ── 3. Void & Refund Summary ── */
function renderVoidRefundSummary(fromDate, toDate) {
  const container = document.getElementById('voidRefundContainer');
  if (!container) return;
  const allSales  = getAnalyticsSales(fromDate, toDate);
  const voided    = allSales.filter(s => (s.status||'').toUpperCase() === 'VOIDED');
  const refunded  = allSales.filter(s => (s.status||'').toUpperCase() === 'REFUNDED');
  const voidedAmt = voided.reduce((s, t) => s + Number(t.totals?.total ?? t.total ?? 0), 0);
  const refundAmt = refunded.reduce((s, t) => s + Number(t.totals?.total ?? t.total ?? 0), 0);
  const totalLost = voidedAmt + refundAmt;
  const productLoss = {};
  [...voided, ...refunded].forEach(sale => {
    (sale.items||[]).forEach(item => {
      const name = item.name || 'Unknown';
      productLoss[name] = (productLoss[name]||0) + Number(item.total||0);
    });
  });
  const topLoss = Object.entries(productLoss).sort((a,b)=>b[1]-a[1]).slice(0,3);
  if (!voided.length && !refunded.length) {
    container.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:14px 18px;
      border:1.5px solid var(--border);border-radius:var(--radius-lg);background:var(--gray-50);">
      <span style="font-size:16px;">✓</span>
      <span style="font-size:12px;font-weight:700;color:var(--gray-500);">
        No voids or refunds in this period</span></div>`;
    return;
  }
  const _vDark = document.documentElement.dataset.theme === 'dark';
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:12px;">
      <div class="stat-card" style="border-color:${_vDark?'rgba(220,38,38,.35)':'#fecaca'};background:${_vDark?'rgba(220,38,38,.10)':'#fef2f2'};">
        <div class="label" style="color:#dc2626;">Voided</div>
        <div class="value" style="color:#dc2626;font-size:20px;">${voided.length}</div>
        <div class="sub" style="color:#dc2626;">${formatCurrency(voidedAmt)} lost</div>
      </div>
      <div class="stat-card" style="border-color:${_vDark?'rgba(234,88,12,.35)':'#fed7aa'};background:${_vDark?'rgba(234,88,12,.10)':'#fff7ed'};">
        <div class="label" style="color:#ea580c;">Refunded</div>
        <div class="value" style="color:#ea580c;font-size:20px;">${refunded.length}</div>
        <div class="sub" style="color:#ea580c;">${formatCurrency(refundAmt)} returned</div>
      </div>
      <div class="stat-card" style="border-color:${_vDark?'rgba(220,38,38,.35)':'#fecaca'};background:${_vDark?'rgba(220,38,38,.10)':'#fef2f2'};">
        <div class="label" style="color:#991b1b;">Total Loss</div>
        <div class="value" style="color:#991b1b;font-size:20px;">${formatCurrency(totalLost)}</div>
        <div class="sub" style="color:#991b1b;">${voided.length+refunded.length} transactions</div>
      </div>
    </div>
    ${topLoss.length ? `
    <div style="border:1.5px solid #fecaca;border-radius:var(--radius-lg);overflow:hidden;">
      <div style="padding:10px 16px;background:#fef2f2;font-size:10px;letter-spacing:1.5px;
        text-transform:uppercase;font-weight:800;color:#dc2626;">Most Affected Products</div>
      ${topLoss.map(([name,amt]) => `
        <div style="display:flex;justify-content:space-between;padding:10px 16px;
          border-top:1px solid #fecaca;font-size:12px;">
          <span style="font-weight:700;">${escapeHtml(name)}</span>
          <span style="color:#dc2626;font-weight:800;">${formatCurrency(amt)}</span>
        </div>`).join('')}
    </div>` : ''}`;
}

/* ── 4. Hourly Heatmap ── */
function renderHourlyHeatmap(fromDate, toDate) {
  const container = document.getElementById('hourlyHeatmapContainer');
  if (!container) return;
  const sales = getCompletedSales(fromDate, toDate);
  const days  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const grid  = Array.from({length:7}, () => Array(24).fill(0));
  sales.forEach(sale => {
    const d = new Date(sale.audit?.completedAt || sale.completedAt || sale.createdAt || Date.now());
    grid[d.getDay()][d.getHours()] += Number(sale.totals?.total ?? sale.total ?? 0);
  });
  const maxVal = Math.max(...grid.flat());
  if (maxVal === 0) {
    container.innerHTML = `<div style="font-size:12px;color:var(--gray-400);
      text-align:center;padding:24px;">No sales data for heatmap</div>`;
    return;
  }
  const activeHours = [];
  for (let h = 0; h < 24; h++) { if (grid.some(row => row[h] > 0)) activeHours.push(h); }
  const hourLabel = h => `${h%12||12}${h<12?'am':'pm'}`;
  const darkMode = document.documentElement.dataset.theme === 'dark';
  const intensity = v => {
    if (!v) return darkMode ? 'background:rgba(255,255,255,.04);' : 'background:#f9f9f9;';
    if (darkMode) {
      const a = Math.max(0.10, Math.min(0.88, 0.10 + (v/maxVal)*0.78));
      return `background:rgba(240,238,235,${a.toFixed(2)});color:${a > 0.50 ? '#0e0e13' : '#f0eeeb'};`;
    }
    const l = Math.round(100 - (v/maxVal)*85);
    return `background:hsl(0,0%,${l}%);color:${l<50?'#fff':'#000'};`;
  };
  container.innerHTML = `<div style="overflow-x:auto;"><table style="border-collapse:collapse;font-size:10px;">
    <thead><tr>
      <th style="padding:4px 8px;text-align:right;color:var(--gray-400);font-weight:700;"></th>
      ${activeHours.map(h => `<th style="padding:4px 3px;text-align:center;color:var(--gray-400);
        font-weight:700;min-width:32px;">${hourLabel(h)}</th>`).join('')}
    </tr></thead>
    <tbody>
      ${days.map((day,di) => `
        <tr>
          <td style="padding:3px 8px;font-weight:800;font-size:10px;color:var(--gray-500);
            text-align:right;white-space:nowrap;">${day}</td>
          ${activeHours.map(h => {
            const v = grid[di][h];
            return `<td style="padding:3px;text-align:center;">
              <div style="${intensity(v)}border-radius:4px;padding:4px 2px;font-size:9px;
                font-weight:${v?'800':'400'};" title="${day} ${hourLabel(h)}: ${formatCurrency(v)}">
                ${v>0?(v>=1000?(v/1000).toFixed(1)+'k':Math.round(v)):''}
              </div></td>`;
          }).join('')}
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

/* ── 5. Payment Breakdown ── */
function renderPaymentBreakdown(fromDate, toDate) {
  const container = document.getElementById('paymentBreakdownContainer');
  if (!container) return;
  const breakdown = getPaymentBreakdown(fromDate, toDate);
  const total = Object.values(breakdown).reduce((s,v) => s+v, 0);
  if (!total) { container.innerHTML = `<div class="empty-state">No payment data</div>`; return; }
  container.innerHTML = Object.entries(breakdown).sort((a,b)=>b[1]-a[1]).map(([method,amount]) => {
    const pct = ((amount/total)*100).toFixed(1);
    return `<div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
        <span style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;">
          ${escapeHtml(method)}</span>
        <span style="font-size:11px;font-weight:700;">${formatCurrency(amount)} &middot; ${pct}%</span>
      </div>
      <div style="height:6px;background:var(--gray-100);border-radius:3px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:var(--black);border-radius:3px;"></div>
      </div></div>`;
  }).join('');
}

/* ── 6. Discount Analysis ── */
function renderDiscountAnalysis(fromDate, toDate) {
  const container = document.getElementById('discountAnalysisContainer');
  if (!container) return;
  const sales = getCompletedSales(fromDate, toDate);
  const discSales = sales.filter(s => Number(s.totals?.discount ?? s.discount ?? 0) > 0);
  const totalDisc = discSales.reduce((s,t) => s+Number(t.totals?.discount??t.discount??0), 0);
  const totalRev  = getRevenue(fromDate, toDate);
  const discRate  = totalRev > 0 ? (totalDisc/(totalRev+totalDisc))*100 : 0;
  const avgDisc   = discSales.length > 0 ? totalDisc/discSales.length : 0;
  const productDiscount = {};
  discSales.forEach(sale => {
    const disc  = Number(sale.totals?.discount??sale.discount??0);
    const items = sale.items||[];
    const lineTotal = items.reduce((s,i) => s+Number(i.total||0), 0);
    items.forEach(item => {
      const share = lineTotal>0 ? (Number(item.total||0)/lineTotal)*disc : disc/Math.max(1,items.length);
      const name = item.name||'Unknown';
      productDiscount[name] = (productDiscount[name]||0) + share;
    });
  });
  const topDisc = Object.entries(productDiscount).sort((a,b)=>b[1]-a[1]).slice(0,5);
  if (!discSales.length) {
    container.innerHTML = `<div style="padding:14px 18px;border:1.5px solid var(--border);
      border-radius:var(--radius-lg);background:var(--gray-50);font-size:12px;
      color:var(--gray-500);font-weight:700;">No discounts applied in this period</div>`;
    return;
  }
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
      <div class="stat-card">
        <div class="label">Total Discounted</div>
        <div class="value" style="font-size:20px;">${formatCurrency(totalDisc)}</div>
        <div class="sub">Given away</div>
      </div>
      <div class="stat-card">
        <div class="label">Discount Rate</div>
        <div class="value" style="font-size:20px;color:${discRate>15?'#dc2626':discRate>8?'#ea580c':'var(--black)'};">
          ${discRate.toFixed(1)}%</div>
        <div class="sub">Of gross revenue</div>
      </div>
      <div class="stat-card">
        <div class="label">Transactions</div>
        <div class="value" style="font-size:20px;">${discSales.length}</div>
        <div class="sub">Had a discount</div>
      </div>
      <div class="stat-card">
        <div class="label">Avg per Discount</div>
        <div class="value" style="font-size:20px;">${formatCurrency(avgDisc)}</div>
        <div class="sub">Per discounted sale</div>
      </div>
    </div>
    ${topDisc.length ? `
    <div style="border:1.5px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;">
      <div style="padding:10px 16px;background:var(--gray-50);font-size:10px;letter-spacing:1.5px;
        text-transform:uppercase;font-weight:800;color:var(--gray-500);">Most Discounted Products</div>
      ${topDisc.map(([name,amt]) => {
        const pct = totalDisc>0?(amt/totalDisc*100).toFixed(0):0;
        return `<div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-top:1px solid var(--border);">
          <div style="flex:1;">
            <div style="font-size:12px;font-weight:800;">${escapeHtml(name)}</div>
            <div style="height:4px;background:var(--gray-100);border-radius:999px;margin-top:5px;overflow:hidden;">
              <div style="height:100%;width:${pct}%;background:var(--black);border-radius:999px;"></div>
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:12px;font-weight:800;">${formatCurrency(amt)}</div>
            <div style="font-size:10px;color:var(--gray-400);">${pct}% of discounts</div>
          </div></div>`;
      }).join('')}
    </div>` : ''}`;
}

/* ── 7. Category Performance ── */
function renderCategoryPerformance(fromDate, toDate) {
  const container = document.getElementById('categoryPerformanceContainer');
  if (!container) return;
  const categories = typeof getCategoryPerformance === 'function' ? getCategoryPerformance(fromDate, toDate) : [];
  if (!categories.length || categories.every(c => c.revenue===0)) {
    container.innerHTML = `<div class="empty-state">No category sales data for selected period</div>`;
    return;
  }
  Object.values(_categoryChartInstances).forEach(c => { try { c.destroy(); } catch(e) {} });
  _categoryChartInstances = {};
  const summaryId  = 'categorySummaryChart';
  const activeCats = categories.filter(c => c.revenue > 0);
  container.innerHTML = `
    <div style="height:180px;margin-bottom:24px;"><canvas id="${summaryId}"></canvas></div>
    <div class="table-wrapper" style="margin-bottom:24px;">
      <table><thead><tr>
        <th>Category</th><th>Revenue</th><th>Units</th><th>Orders</th><th>Top Product</th>
      </tr></thead><tbody>
        ${categories.map(cat => `<tr>
          <td style="font-weight:700;">${escapeHtml(cat.category)}</td>
          <td style="font-variant-numeric:tabular-nums;font-weight:700;">${formatCurrency(cat.revenue)}</td>
          <td>${cat.qty}</td><td>${cat.orders}</td>
          <td style="font-size:11px;color:var(--gray-500);">
            ${cat.topItems[0]?escapeHtml(cat.topItems[0].name):'—'}</td>
        </tr>`).join('')}
      </tbody></table>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;">
      ${activeCats.map(cat => {
        const chartId = `catChart_${cat.category.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'')}`;
        return `<div style="border:1.5px solid var(--border);border-radius:var(--radius-lg);padding:16px;background:var(--white);">
          <div style="font-weight:800;font-size:13px;margin-bottom:2px;">${escapeHtml(cat.category)}</div>
          <div style="font-size:20px;font-weight:900;margin-bottom:12px;">${formatCurrency(cat.revenue)}</div>
          <div style="height:90px;margin-bottom:12px;"><canvas id="${chartId}"></canvas></div>
          ${cat.topItems.map(item => `<div style="display:flex;justify-content:space-between;font-size:11px;
            padding:3px 0;border-bottom:1px solid var(--border);">
            <span style="font-weight:700;">${escapeHtml(item.name)}</span>
            <span style="color:var(--gray-500);">${item.qty} · ${formatCurrency(item.revenue)}</span>
          </div>`).join('')}
        </div>`;
      }).join('')}
    </div>`;
  requestAnimationFrame(() => {
    // This block draws one summary canvas plus a canvas per category, so the
    // notice goes on each of them rather than on a single element.
    if (typeof Chart === 'undefined') {
      chartUnavailable(document.getElementById(summaryId));
      activeCats.forEach(cat => chartUnavailable(document.getElementById(
        `catChart_${cat.category.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'')}`)));
      return;
    }
    const sc = document.getElementById(summaryId);
    const ct = getChartTheme();
    if (sc) {
      _categoryChartInstances[summaryId] = new Chart(sc.getContext('2d'), {
        type: 'bar',
        data: { labels: categories.map(c=>c.category),
          datasets: [{ data: categories.map(c=>c.revenue),
            backgroundColor: categories.map((_,i) => i===0 ? ct.bar :
              (ct.isDark ? `rgba(240,238,235,${Math.max(0.18,0.72-i*0.12).toFixed(2)})`
                         : `hsl(0,0%,${Math.min(75,35+i*12)}%)`)),
            borderRadius: 4, borderSkipped: false }] },
        options: { responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>formatCurrency(ctx.parsed.y)}} },
          scales:{ x:{grid:{display:false},ticks:{font:{size:10},color:ct.tick}},
            y:{grid:{color:ct.grid},ticks:{font:{size:10},color:ct.tick,
              callback:v=>getCurrencySymbol()+(v>=1000?(v/1000).toFixed(0)+'k':v)}} } }
      });
    }
    activeCats.forEach(cat => {
      const chartId = `catChart_${cat.category.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'')}`;
      const canvas = document.getElementById(chartId);
      if (!canvas||!cat.topItems.length) return;
      const colors = ct.isDark
        ? ['#f0eeeb','rgba(240,238,235,.65)','rgba(240,238,235,.40)','rgba(240,238,235,.22)']
        : ['#000','#555','#999','#ccc'];
      _categoryChartInstances[chartId] = new Chart(canvas.getContext('2d'), {
        type:'doughnut',
        data:{ labels:cat.topItems.map(i=>i.name),
          datasets:[{data:cat.topItems.map(i=>i.revenue),
            backgroundColor:cat.topItems.map((_,i)=>colors[i]||(ct.isDark?'rgba(240,238,235,.12)':'#eee')),borderWidth:0}] },
        options:{ responsive:true,maintainAspectRatio:false,cutout:'65%',
          plugins:{legend:{display:false},
            tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${formatCurrency(ctx.parsed)}`}}} }
      });
    });
  });
}

/* ── 8. Product Performance ── */
function renderReportProductsTable(fromDate, toDate) {
  const tbody = document.querySelector('#reportProductsTable tbody');
  if (!tbody) return;
  const ranked = getProductProfitability(fromDate, toDate);
  tbody.innerHTML = '';
  if (!ranked.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">No sales data for selected period</td></tr>`;
    return;
  }
  ranked.forEach(item => {
    const margin = item.revenue > 0 ? ((item.profit/item.revenue)*100).toFixed(1) : null;
    const marginColor = margin >= 60 ? '#16a34a' : margin >= 40 ? '#ea580c' : '#dc2626';
    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="font-weight:700;">${escapeHtml(item.name)}</td>
      <td>${item.qty}</td>
      <td>${formatCurrency(item.revenue)}</td>
      <td>${formatCurrency(item.cost)}</td>
      <td style="font-weight:700;">${formatCurrency(item.profit)}
        ${margin!==null?`<span style="font-size:10px;color:${marginColor};margin-left:4px;font-weight:800;">(${margin}%)</span>`:''}
      </td>`;
    tbody.appendChild(row);
  });
}

/* ── 9. Ingredient Usage ── */
function renderIngredientUsageTable(fromDate, toDate) {
  const tbody = document.querySelector('#ingredientUsageTable tbody');
  if (!tbody) return;
  const sales = getCompletedSales(fromDate, toDate);
  const usage = new Map();
  sales.forEach(sale => {
    if (!Array.isArray(sale.items)) return;
    sale.items.forEach(item => {
      const product = (APP_STATE.products||[]).find(p=>String(p.id)===String(item.productId));
      if (!product||!Array.isArray(product.recipe)) return;
      product.recipe.forEach(ri => {
        const ingredient = (APP_STATE.ingredients||[]).find(i=>String(i.id)===String(ri.ingredientId));
        if (!ingredient) return;
        const key = `${ingredient.name}|${ingredient.unit}|${ingredient.id}`;
        const qty = Number(ri.quantity||0)*Number(item.quantity||0);
        usage.set(key, (usage.get(key)||0)+qty);
      });
    });
  });
  const ranked = Array.from(usage.entries()).sort((a,b)=>b[1]-a[1]);
  tbody.innerHTML = '';
  if (!ranked.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="empty-state">No ingredient usage data</td></tr>`;
    return;
  }
  ranked.forEach(([key,qty]) => {
    const [name,unit,id] = key.split('|');
    const ingredient = (APP_STATE.ingredients||[]).find(i=>String(i.id)===String(id));
    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="font-weight:700;">${escapeHtml(name)}</td>
      <td>${Number(qty).toFixed(2)} ${escapeHtml(unit||'')}</td>
      <td>${ingredient?`${Number(ingredient.stock).toFixed(2)} ${escapeHtml(ingredient.unit||'')}`:'—'}</td>`;
    tbody.appendChild(row);
  });
}

/* ── 10. Operational Insights ── */
function renderReportInsightsTable(fromDate, toDate) {
  const tbody = document.querySelector('#reportInsightsTable tbody');
  if (!tbody) return;
  const sales     = getAnalyticsSales(fromDate, toDate);
  const completed = sales.filter(s=>(s.status||'').toUpperCase()==='COMPLETED');
  const pending   = sales.filter(s=>(s.status||'').toUpperCase()==='PENDING');
  const voided    = sales.filter(s=>(s.status||'').toUpperCase()==='VOIDED');
  const refunded  = sales.filter(s=>(s.status||'').toUpperCase()==='REFUNDED');
  const discount  = getTotalDiscount(fromDate, toDate);
  const uniqueProducts  = new Set(completed.flatMap(s=>(s.items||[]).map(i=>i.name))).size;
  const uniqueCustomers = new Set(completed.map(s=>s.customer?.name||s.customerName||'Walk-in')).size;
  const lostRevenue     = [...voided,...refunded].reduce((s,t)=>s+Number(t.totals?.total??t.total??0),0);
  const rows = [
    ['Completed Sales',       completed.length],
    ['Pending Orders',        pending.length],
    ['Voided Transactions',   voided.length],
    ['Refunded Transactions', refunded.length],
    ['Revenue Lost (V/R)',    formatCurrency(lostRevenue)],
    ['Unique Products Sold',  uniqueProducts],
    ['Unique Customers',      uniqueCustomers],
    ['Total Discount Given',  formatCurrency(discount)],
  ];
  tbody.innerHTML = '';
  rows.forEach(([metric, value]) => {
    const row = document.createElement('tr');
    row.innerHTML = `<td>${escapeHtml(metric)}</td><td style="font-weight:700;">${value}</td>`;
    tbody.appendChild(row);
  });
}

/* ── 11. Channel Breakdown ── */
function renderChannelBreakdownReport(fromDate, toDate) {
  const container = document.getElementById('reportChannelContainer');
  if (!container) return;
  const revenue  = typeof getRevenueByChannel === 'function' ? getRevenueByChannel(fromDate,toDate) : {};
  const orders   = typeof getOrdersByChannel  === 'function' ? getOrdersByChannel(fromDate,toDate)  : {};
  const channels = Object.keys({...revenue,...orders});
  if (!channels.length) {
    container.innerHTML = `<tr><td colspan="4" class="empty-state">No sales data for period</td></tr>`;
    return;
  }
  const totalRev = Object.values(revenue).reduce((s,v)=>s+v,0);
  const totalOrd = Object.values(orders).reduce((s,v)=>s+v,0);
  container.innerHTML = channels.sort((a,b)=>(revenue[b]||0)-(revenue[a]||0)).map(ch => {
    const chRev=revenue[ch]||0, chOrd=orders[ch]||0;
    const revPct=totalRev>0?((chRev/totalRev)*100).toFixed(1):'0.0';
    const ordPct=totalOrd>0?((chOrd/totalOrd)*100).toFixed(1):'0.0';
    return `<tr>
      <td style="font-weight:700;">${escapeHtml(ch)}</td>
      <td>${formatCurrency(chRev)} <span style="color:var(--gray-400);font-size:10px;">${revPct}%</span></td>
      <td>${chOrd} <span style="color:var(--gray-400);font-size:10px;">${ordPct}%</span></td>
      <td>${formatCurrency(chOrd>0?chRev/chOrd:0)}</td>
    </tr>`;
  }).join('');
}

/* ── 12. Profitability Toggle ── */
function renderAllProfitability(fromDate, toDate) {
  renderBreakEvenReport(fromDate, toDate);
  renderCumulativePureProfitChart(fromDate, toDate);
  renderBestMarginProducts(fromDate, toDate);
  renderPureProfitByCategory(fromDate, toDate);
  renderRevenueVsCostChart(fromDate, toDate);
  renderDeadWeightProducts(fromDate, toDate);
}

/* toggleProfitabilitySection — profitability now always visible */
function toggleProfitabilitySection() { /* no-op */ }

function renderBreakEvenReport(fromDate, toDate) {
  const container = document.getElementById('reportBreakEvenContainer');
  if (!container) return;
  const analysis = typeof getBreakEvenAnalysis === 'function' ? getBreakEvenAnalysis(fromDate,toDate) : [];
  if (!analysis.length) {
    container.innerHTML = `<div class="empty-state">No products with pricing and recipe data</div>`;
    return;
  }
  const totalPureProfit = analysis.reduce((s,p)=>s+p.actualPureProfit,0);
  const profitable = analysis.filter(p=>p.status==='PROFITABLE').length;
  const inProgress = analysis.filter(p=>p.status==='IN_PROGRESS').length;
  const withBatch  = analysis.filter(p=>p.hasBatchContext).length;
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;">
      ${[['With Batch Data',withBatch,''],['Above Break-Even',profitable,'#16a34a'],
         ['In Progress',inProgress,'#2563eb'],['Pure Profit Earned',formatCurrency(totalPureProfit),'#16a34a']]
        .map(([l,v,c])=>`<div class="stat-card"><div class="label">${l}</div>
          <div class="value" style="font-size:20px;${c?'color:'+c+';':''}">${v}</div></div>`).join('')}
    </div>
    <div class="table-wrapper"><table>
      <thead><tr><th>Product</th><th>Price</th><th>Cost/Unit</th><th>Margin</th>
        <th>Break-Even</th><th>Sold</th><th>Progress</th>
        <th>Pure Profit Units</th><th>Pure Profit Earned</th></tr></thead>
      <tbody>${analysis.map(p => {
        const sc = p.status==='PROFITABLE'?'#16a34a':p.status==='IN_PROGRESS'?'#2563eb':'#9ca3af';
        const sl = p.status==='PROFITABLE'?'✓ Above break-even':p.status==='IN_PROGRESS'?'In progress':'—';
        return `<tr>
          <td style="font-weight:700;">${escapeHtml(p.name)}
            <div style="font-size:10px;color:var(--gray-400);">${escapeHtml(p.category)}</div></td>
          <td>${formatCurrency(p.price)}</td>
          <td>${formatCurrency(p.costPerUnit)}</td>
          <td style="color:${p.margin>=60?'#16a34a':p.margin>=40?'#ea580c':'#dc2626'};font-weight:700;">
            ${p.margin.toFixed(1)}%</td>
          <td>${p.hasBatchContext
            ?`<span style="font-weight:900;">${p.breakEvenUnits}</span>
              <span style="font-size:10px;color:var(--gray-400);"> of ${p.batchYield}</span>`
            :'<span style="font-size:10px;color:var(--gray-400);">Set batch yield</span>'}</td>
          <td>${p.soldQty} <span style="font-size:10px;color:var(--gray-400);">units</span></td>
          <td>${p.hasBatchContext&&p.progressPct!==null?`
            <div style="display:flex;align-items:center;gap:6px;">
              <div style="flex:1;height:8px;background:var(--gray-100);border-radius:999px;overflow:hidden;min-width:60px;">
                <div style="height:100%;width:${p.progressPct}%;background:${sc};border-radius:999px;"></div>
              </div>
              <span style="font-size:10px;font-weight:800;color:${sc};">${p.progressPct}%</span>
            </div>
            <div style="font-size:10px;color:${sc};font-weight:700;">${sl}</div>`
            :'<span style="font-size:10px;color:var(--gray-400);">—</span>'}</td>
          <td>${p.pureProfitQty>0
            ?`<span style="font-weight:800;color:#16a34a;">${p.pureProfitQty} units</span>
              <div style="font-size:10px;color:var(--gray-400);">+${formatCurrency(p.pureProfit)}/unit</div>`
            :'<span style="color:var(--gray-400);">—</span>'}</td>
          <td>${p.actualPureProfit>0
            ?`<span style="font-weight:900;color:#16a34a;font-size:14px;">${formatCurrency(p.actualPureProfit)}</span>`
            :'<span style="color:var(--gray-400);">—</span>'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
}

function renderCumulativePureProfitChart(fromDate, toDate) {
  const canvas = document.getElementById('pureProfitCumulativeChart');
  if (chartUnavailable(canvas)) return;
  const sales = getCompletedSales(fromDate, toDate);
  const products = APP_STATE.products||[];
  const soldMap={}, dailyMap={};
  sales.forEach(sale => {
    const day=(sale.audit?.completedAt||sale.createdAt||'').slice(0,10);
    if(!day) return;
    (sale.items||[]).forEach(item=>{
      const prod=products.find(p=>String(p.id)===String(item.productId));
      if(!prod) return;
      const be=typeof calculateBreakEven==='function'?calculateBreakEven(prod):null;
      if(!be||!be.effectiveBatch) return;
      soldMap[prod.id]=soldMap[prod.id]||{sold:0,be};
      const qty=Number(item.quantity||0)*Number(item.multiplier||1);
      soldMap[prod.id].sold+=qty;
      const after=Math.max(0,soldMap[prod.id].sold-be.breakEvenUnits);
      const before=Math.max(0,(soldMap[prod.id].sold-qty)-be.breakEvenUnits);
      dailyMap[day]=(dailyMap[day]||0)+Math.max(0,after-before)*be.pureProfit;
    });
  });
  const sortedDays=Object.keys(dailyMap).sort();
  if(!sortedDays.length){
    canvas.parentElement.innerHTML=`<div style="font-size:12px;color:var(--gray-400);text-align:center;padding:40px 0;">No pure profit data in this period</div>`;
    return;
  }
  let running=0;
  const labels=sortedDays.map(d=>new Date(d+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric'}));
  const values=sortedDays.map(d=>{running+=dailyMap[d];return parseFloat(running.toFixed(2));});
  if(_pureProfitCumChart){_pureProfitCumChart.destroy();_pureProfitCumChart=null;}
  const _ppcCt = getChartTheme();
  _pureProfitCumChart=new Chart(canvas.getContext('2d'),{
    type:'line',
    data:{labels,datasets:[{data:values,borderColor:_ppcCt.line,backgroundColor:_ppcCt.fill,
      borderWidth:2,pointRadius:labels.length>14?0:4,fill:true,tension:0.3}]},
    options:{responsive:true,plugins:{legend:{display:false},
      tooltip:{callbacks:{label:ctx=>' '+formatCurrency(ctx.parsed.y)}}},
      scales:{x:{grid:{display:false},ticks:{font:{size:10},maxTicksLimit:8,color:_ppcCt.tick}},
        y:{grid:{color:_ppcCt.grid},ticks:{font:{size:10},color:_ppcCt.tick,
          callback:v=>getCurrencySymbol()+(v>=1000?(v/1000).toFixed(1)+'k':v)}}}}
  });
}

function renderBestMarginProducts(fromDate, toDate) {
  const container=document.getElementById('bestMarginContainer');
  if(!container) return;
  const analysis=typeof getBreakEvenAnalysis==='function'?getBreakEvenAnalysis(fromDate,toDate):[];
  const ranked=analysis.filter(p=>p.margin>0).sort((a,b)=>b.margin-a.margin).slice(0,5);
  if(!ranked.length){
    container.innerHTML=`<div style="font-size:12px;color:var(--gray-400);padding:16px 0;">No margin data — add recipes to products</div>`;
    return;
  }
  const medals=['1','2','3','4','5'],maxM=ranked[0].margin;
  const _bmDark = document.documentElement.dataset.theme === 'dark';
  container.innerHTML=ranked.map((p,i)=>`
    <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;
      border:1.5px solid var(--border);border-radius:var(--radius-lg);margin-bottom:8px;
      background:${i===0?(_bmDark?'#f0eeeb':'#000'):'var(--white)'};
      color:${i===0?(_bmDark?'#0e0e13':'#fff'):'var(--gray-900)'};">
      <div style="font-size:${i<3?'18px':'12px'};min-width:24px;text-align:center;">${medals[i]}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(p.name)}</div>
        <div style="margin-top:5px;height:5px;border-radius:999px;overflow:hidden;background:${i===0?'rgba(0,0,0,.15)':'var(--gray-100)'};">
          <div style="height:100%;width:${Math.round(p.margin/maxM*100)}%;border-radius:999px;background:${i===0?(_bmDark?'rgba(0,0,0,.5)':'rgba(255,255,255,.9)'):'var(--gray-900)'};"></div>
        </div>
      </div>
      <div style="font-size:15px;font-weight:900;flex-shrink:0;">${p.margin.toFixed(1)}%</div>
    </div>`).join('');
}

function renderPureProfitByCategory(fromDate, toDate) {
  const canvas=document.getElementById('pureProfitByCategoryChart');
  if (chartUnavailable(canvas)) return;
  const analysis=typeof getBreakEvenAnalysis==='function'?getBreakEvenAnalysis(fromDate,toDate):[];
  const catMap={};
  analysis.forEach(p=>{const cat=p.category||'Uncategorised';catMap[cat]=(catMap[cat]||0)+p.actualPureProfit;});
  const entries=Object.entries(catMap).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  if(!entries.length){
    canvas.parentElement.innerHTML=`<div style="font-size:12px;color:var(--gray-400);text-align:center;padding:40px 0;">No category profit data yet</div>`;
    return;
  }
  if(_pureProfitCatChart){_pureProfitCatChart.destroy();_pureProfitCatChart=null;}
  const _ppcaCt = getChartTheme();
  _pureProfitCatChart=new Chart(canvas.getContext('2d'),{
    type:'bar',
    data:{labels:entries.map(([k])=>k),datasets:[{data:entries.map(([,v])=>parseFloat(v.toFixed(2))),
      backgroundColor:entries.map((_,i)=>i===0?_ppcaCt.bar:
        (_ppcaCt.isDark?`rgba(240,238,235,${Math.max(0.14,0.42-i*0.08).toFixed(2)})`
                       :`rgba(0,0,0,${0.12+i*0.08})`)),
      borderRadius:6,borderSkipped:false}]},
    options:{indexAxis:'y',responsive:true,plugins:{legend:{display:false},
      tooltip:{callbacks:{label:ctx=>' '+formatCurrency(ctx.parsed.x)}}},
      scales:{x:{grid:{color:_ppcaCt.grid},ticks:{font:{size:10},color:_ppcaCt.tick,callback:v=>getCurrencySymbol()+(v>=1000?(v/1000).toFixed(1)+'k':v)}},
        y:{grid:{display:false},ticks:{font:{size:11,weight:'700'},color:_ppcaCt.tick}}}}
  });
}

function renderRevenueVsCostChart(fromDate, toDate) {
  const canvas=document.getElementById('revenueVsCostChart');
  if (chartUnavailable(canvas)) return;
  const analysis=typeof getBreakEvenAnalysis==='function'?getBreakEvenAnalysis(fromDate,toDate):[];
  const top=analysis.filter(p=>p.soldQty>0).sort((a,b)=>(b.soldQty*b.price)-(a.soldQty*a.price)).slice(0,8);
  if(!top.length){
    canvas.parentElement.innerHTML=`<div style="font-size:12px;color:var(--gray-400);text-align:center;padding:40px 0;">No sales data in this period</div>`;
    return;
  }
  if(_revVsCostChart){_revVsCostChart.destroy();_revVsCostChart=null;}
  const _rvcCt = getChartTheme();
  _revVsCostChart=new Chart(canvas.getContext('2d'),{
    type:'bar',
    data:{labels:top.map(p=>p.name.length>12?p.name.slice(0,12)+'…':p.name),
      datasets:[
        {label:'Cost',data:top.map(p=>parseFloat((p.soldQty*p.costPerUnit).toFixed(2))),backgroundColor:_rvcCt.barLight,borderRadius:0},
        {label:'Break-Even',data:top.map(p=>Math.max(0,Math.min(p.breakEvenUnits,p.soldQty)*p.pureProfit)),backgroundColor:_rvcCt.barMid,borderRadius:0},
        {label:'Pure Profit',data:top.map(p=>parseFloat(p.actualPureProfit.toFixed(2))),backgroundColor:_rvcCt.bar,borderRadius:{topLeft:4,topRight:4}},
      ]},
    options:{responsive:true,
      plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:10,padding:12,color:_rvcCt.tick}},
        tooltip:{callbacks:{label:ctx=>` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`}}},
      scales:{x:{stacked:true,grid:{display:false},ticks:{font:{size:9},color:_rvcCt.tick}},
        y:{stacked:true,grid:{color:_rvcCt.grid},ticks:{font:{size:10},color:_rvcCt.tick,
          callback:v=>getCurrencySymbol()+(v>=1000?(v/1000).toFixed(1)+'k':v)}}}}
  });
}

function renderDeadWeightProducts(fromDate, toDate) {
  const container=document.getElementById('deadWeightContainer');
  if(!container) return;
  const analysis=typeof getBreakEvenAnalysis==='function'?getBreakEvenAnalysis(fromDate,toDate):[];
  const dead=analysis.filter(p=>p.hasBatchContext&&p.soldQty>0&&p.status!=='PROFITABLE');
  if(!dead.length){container.innerHTML='';return;}
  container.innerHTML=`
    <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--gray-400);font-weight:800;margin-bottom:14px;">Needs Attention</div>
    <div style="border:1.5px solid #fecaca;border-radius:var(--radius-lg);overflow:hidden;">
      <div style="padding:14px 18px;border-bottom:1px solid #fecaca;display:flex;align-items:center;gap:10px;">
        <span style="font-size:12px;font-weight:900;">!</span>
        <div>
          <div style="font-size:13px;font-weight:900;color:#991b1b;">${dead.length} product${dead.length>1?'s':''} haven't crossed break-even</div>
          <div style="font-size:11px;color:#b91c1c;margin-top:2px;">Reprice, promote, or cut these to improve profitability</div>
        </div>
      </div>
      ${dead.map(p=>`
        <div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid #fecaca;">
          <div style="flex:1;">
            <div style="font-size:12px;font-weight:800;">${escapeHtml(p.name)}</div>
            <div style="font-size:10px;color:#b91c1c;margin-top:2px;">Sold ${p.soldQty} of ${p.breakEvenUnits} needed — ${p.progressPct}% there</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px;font-weight:800;color:#991b1b;">${formatCurrency(p.price)}</div>
            <div style="font-size:10px;color:#b91c1c;">${p.margin.toFixed(1)}% margin</div>
          </div>
          <div style="width:60px;">
            <div style="height:6px;background:#fecaca;border-radius:999px;overflow:hidden;">
              <div style="height:100%;width:${p.progressPct}%;background:#dc2626;border-radius:999px;"></div>
            </div>
          </div>
        </div>`).join('')}
    </div>`;
}

/* ── 13. PDF Export ── */
function exportReportAsPDF() {
  const panel = document.getElementById('view-reports');
  if (!panel) { window.print(); return; }

  // Flush reveal animations so nothing prints at opacity 0
  panel.querySelectorAll(
    '#reportStatsGrid, .chart-container, #voidRefundContainer, ' +
    '#hourlyHeatmapContainer, #paymentBreakdownContainer, ' +
    '#discountAnalysisContainer, #categoryPerformanceContainer, ' +
    '.table-wrapper, #profitabilitySection, #reportBreakEvenContainer'
  ).forEach(el => {
    el.style.opacity    = '1';
    el.style.transform  = 'none';
    el.style.transition = 'none';
  });

  // Snapshot each chart canvas as <img> — canvas elements don't render in the
  // browser's print pipeline, so we replace them with rasterized copies first.
  const snapshots = [];
  panel.querySelectorAll('canvas').forEach(canvas => {
    try {
      const img  = document.createElement('img');
      img.src    = canvas.toDataURL('image/png');
      img.style.cssText = `width:${canvas.offsetWidth}px;height:${canvas.offsetHeight}px;` +
                          `display:block;max-width:100%;`;
      canvas.parentNode.insertBefore(img, canvas);
      canvas.style.display = 'none';
      snapshots.push({ canvas, img });
    } catch (_) {}
  });

  setTimeout(() => {
    window.print();
    // Restore live canvases once the print dialog closes
    snapshots.forEach(({ canvas, img }) => {
      canvas.style.display = '';
      img.remove();
    });
  }, 300);
}


/* ═══════════════════════════════════════════════════════
   REPORT SECTION ANIMATIONS
═══════════════════════════════════════════════════════ */
function _animateReportSections() {
  const panel = document.getElementById('view-reports');
  if (!panel) return;

  // Target all direct section blocks inside the reports panel
  const sections = panel.querySelectorAll(
    '#reportStatsGrid, .chart-container, #voidRefundContainer, ' +
    '#hourlyHeatmapContainer, #paymentBreakdownContainer, ' +
    '#discountAnalysisContainer, #categoryPerformanceContainer, ' +
    '.table-wrapper, #profitabilitySection, #reportBreakEvenContainer'
  );

  sections.forEach((el, i) => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(14px)';
    el.style.transition = 'none';
    setTimeout(() => {
      el.style.transition = 'opacity .35s ease, transform .35s ease';
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    }, i * 55);
  });
}

/* ── Report date presets ── */
function _applyReportPreset(preset) {
  const fromEl = document.getElementById('reportFromDate');
  const toEl   = document.getElementById('reportToDate');
  if (!fromEl || !toEl) return;

  const fmt = d => { const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dy = String(d.getDate()).padStart(2,'0'); return `${y}-${m}-${dy}`; };
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let from, to = new Date();

  switch (preset) {
    case 'today':
      from = new Date(today);
      to   = new Date(today);
      break;
    case 'yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      from = to = y;
      break;
    }
    case 'week': {
      from = new Date(today);
      from.setDate(today.getDate() - today.getDay()); // Sunday start
      to = new Date(today);
      break;
    }
    case 'month':
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      to   = new Date(today);
      break;
    case 'last30':
      from = new Date(today);
      from.setDate(today.getDate() - 29);
      to = new Date(today);
      break;
    case 'all':
    default:
      fromEl.value = '';
      toEl.value   = '';
      document.querySelectorAll('.date-preset-btn').forEach(b => b.classList.remove('active'));
      const allBtn = document.querySelector('.date-preset-btn[data-preset="all"]');
      if (allBtn) allBtn.classList.add('active');
      if (typeof renderReports === 'function') renderReports();
      return;
  }

  fromEl.value = fmt(from);
  toEl.value   = fmt(to);

  document.querySelectorAll('.date-preset-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.date-preset-btn[data-preset="${preset}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  if (typeof renderReports === 'function') renderReports();
}

/* ── Re-render all charts when theme changes ── */
new MutationObserver(() => {
  const { fromDate, toDate } = getReportDateRange();
  if (!fromDate || !toDate) {
    if (reportChartInstance) { reportChartInstance.destroy(); reportChartInstance = null; }
    if (hourlyChartInstance) { hourlyChartInstance.destroy(); hourlyChartInstance = null; }
    Object.values(_categoryChartInstances).forEach(c => { try { c.destroy(); } catch(e) {} });
    _categoryChartInstances = {};
    if (_pureProfitCumChart) { _pureProfitCumChart.destroy(); _pureProfitCumChart = null; }
    if (_pureProfitCatChart) { _pureProfitCatChart.destroy(); _pureProfitCatChart = null; }
    if (_revVsCostChart)     { _revVsCostChart.destroy();     _revVsCostChart     = null; }
    return;
  }
  if (reportChartInstance) renderRevenueChart(fromDate, toDate);
  renderHourlyHeatmap(fromDate, toDate);
  renderCategoryPerformance(fromDate, toDate);
  const profSection = document.getElementById('profitabilitySection');
  if (profSection && profSection.style.display !== 'none') {
    renderPureProfitCumulative(fromDate, toDate);
    renderPureProfitByCategory(fromDate, toDate);
    renderRevenueVsCostChart(fromDate, toDate);
  }
}).observe(document.documentElement, { attributeFilter: ['data-theme'] });

/* ── Exports ── */
window.renderReports                = renderReports;
window.renderReportKPIs             = renderReportKPIs;
window.renderRevenueChart           = renderRevenueChart;
window.renderVoidRefundSummary      = renderVoidRefundSummary;
window.renderHourlyHeatmap          = renderHourlyHeatmap;
window.renderHourlySalesChart       = renderHourlyHeatmap;
window.renderPaymentBreakdown       = renderPaymentBreakdown;
window.renderDiscountAnalysis       = renderDiscountAnalysis;
window.renderCategoryPerformance    = renderCategoryPerformance;
window.renderReportProductsTable    = renderReportProductsTable;
window.renderIngredientUsageTable   = renderIngredientUsageTable;
window.renderReportInsightsTable    = renderReportInsightsTable;
window.renderChannelBreakdownReport = renderChannelBreakdownReport;
window.toggleProfitabilitySection   = toggleProfitabilitySection;
window.renderBreakEvenReport        = renderBreakEvenReport;
window.exportReportAsPDF            = exportReportAsPDF;
window._animateReportSections       = _animateReportSections;
window._applyReportPreset           = _applyReportPreset;
