// ==========================================================================
// Tổng quan — month-only report. Uses ONLY the selected month's income/
// expense + Thẻ & trả góp data (F.statsFor). Nợ moved entirely to Tài sản —
// it never appears here, not in the KPIs, not in Tổng chi tiêu tháng, not
// in any list. Never reads accounts, never reads investments either.
// ==========================================================================
'use strict';

function kpiCard(label, value, sub, cls = '') {
  return `<section class="card kpi"><div class="label">${esc(label)}</div><div class="value ${cls}">${value}</div><div class="sub">${sub}</div></section>`;
}

function compareText(cur, prev, label) {
  if (!(prev > 0)) return '';
  const diff = (cur - prev) / prev * 100;
  if (Math.abs(diff) < 0.5) return ` · Bằng ${label}`;
  return ` · ${diff > 0 ? '▲' : '▼'}${Math.abs(diff).toFixed(0)}% so với ${label}`;
}
const momText = (cur, prev) => compareText(cur, prev, 'tháng trước');
const yoyText = (cur, prev) => compareText(cur, prev, 'cùng kỳ năm trước');

function categoryTrendHtml() {
  const rows = F.categoryTrendData(5, 6);
  if (!rows.length) return '<div class="empty">Chưa có giao dịch thực tế trong tháng này.</div>';
  const sharedMax = Math.max(1, ...rows.flatMap(r => r.series.map(x => x.value)));
  return `<div class="list">${rows.map(r => {
    const cur = r.series[r.series.length - 1].value, prev = r.series[r.series.length - 2]?.value || 0;
    return `<div class="category-trend-row">
      <div class="tx-main"><strong>${esc(r.name)}</strong><span>${money(cur)}${momText(cur, prev)}</span></div>
      ${sparklineSvg(r.series, 108, 28, sharedMax)}
    </div>`;
  }).join('')}</div>`;
}

// "Thu nhập vs Chi tiêu" toggle — was two separate charts (a rolling
// 12-month bar chart AND a full Jan..Dec calendar-year list) showing the
// same thu/chi-per-month information twice. One chart now: "12 tháng gần
// nhất" (rolling, default) or "Theo năm" (Jan..Dec of the currently
// selected month's year, via the month-picker at the top) — same toggle
// pattern as Tài sản's "Lịch sử theo tháng" chart.
let dashboardChartMode = 12;
function setDashboardChartMode(mode) { dashboardChartMode = mode; render(); }
function dashboardChartMonthKeys() {
  if (dashboardChartMode === 'year') return F.yearMonthKeys(state.month.slice(0, 4));
  return F.trailingMonthKeys(12);
}
// "Năm nay so với năm trước" — year-to-date through the selected month, so
// both years compare the same number of months.
function yearOverYearHtml() {
  const [y, m] = state.month.split('-').map(Number);
  const monthsThisYear = Array.from({ length: m }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
  const monthsLastYear = monthsThisYear.map(k => addMonths(k, -12));
  const sum = keys => keys.reduce((acc, k) => { const s = F.statsFor(k); acc.income += s.income; acc.expense += s.expense; return acc; }, { income: 0, expense: 0 });
  const cur = sum(monthsThisYear), prev = sum(monthsLastYear);
  return `<div class="compare-table">
    <div class="compare-head"><span>Chỉ tiêu (lũy kế ${m} tháng đầu năm)</span><span>${y - 1}</span><span>${y}</span><span>So sánh</span></div>
    <div class="compare-row"><div class="label"><b>Thu nhập</b></div><div>${money(prev.income)}</div><div>${money(cur.income)}</div><div>${yoyText(cur.income, prev.income).replace(/^ · /, '') || '—'}</div></div>
    <div class="compare-row"><div class="label"><b>Chi tiêu</b></div><div>${money(prev.expense)}</div><div>${money(cur.expense)}</div><div>${yoyText(cur.expense, prev.expense).replace(/^ · /, '') || '—'}</div></div>
  </div>`;
}

function renderDashboard() {
  const s = F.statsFor(state.month);
  const incomePlan = incomePlanTotal();
  // F.expenseByCategory only sums category-based Chi cố định/Chi biến động
  // transactions — Thẻ & trả góp is its own independent ledger, never a
  // category transaction, so it needs to be folded in explicitly as its
  // own slice for this donut to actually represent 100% of Tổng chi tiêu
  // tháng (s.expense), matching what the KPI above already breaks down as
  // "Cố định + Biến động + Thẻ&góp".
  const expenseComposition = F.expenseByCategory(F.periodTransactions(state.month));
  if (s.card > 0) expenseComposition.push({ label: 'Thẻ & trả góp', value: s.card });
  expenseComposition.sort((a, b) => b.value - a.value);
  const prevStats = F.statsFor(addMonths(state.month, -1));
  const hasAnyActivity = (state.transactions || []).some(t => ['income', 'expense'].includes(t.transaction_type)) || s.card > 0;
  const ratio = pctText(s.expense, s.income);

  return `
  <div class="grid kpi-grid">
    ${kpiCard('Thu nhập tháng', money(s.income), `Kế hoạch ${money(incomePlan)}${momText(s.income, prevStats.income)}`, 'green')}
    ${kpiCard('Tổng chi tiêu tháng', money(s.expense), `Cố định ${money(s.fixed)} · Biến động ${money(s.variable)} · Thẻ&góp ${money(s.card)}${momText(s.expense, prevStats.expense)}`, '')}
    ${kpiCard('Còn lại trong tháng', signedMoney(s.remaining), 'Thu nhập − Tổng chi tiêu tháng', s.remaining < 0 ? 'red' : 'green')}
    ${kpiCard('Tỷ lệ chi tiêu / thu nhập', ratio, s.exceptional > 0 ? `Chưa tính ${money(s.exceptional)} chi bất thường` : 'Tổng chi tiêu so với thu nhập tháng', s.expense > s.income ? 'red' : '')}
  </div>
  ${!hasAnyActivity ? '<div class="card empty mt-16">Chưa có giao dịch thực tế trong tháng này.</div>' : ''}

  <div class="grid chart-row mt-16">
    <section class="card section chart-card">
      <div class="section-head">
        <div><h2>Thu nhập vs Chi tiêu</h2><p>${dashboardChartMode === 'year' ? `Theo năm ${state.month.slice(0, 4)}` : '12 tháng gần nhất'}</p></div>
        <div class="row">
          <button class="btn sm ${dashboardChartMode === 12 ? 'primary' : ''}" ${act('setDashboardChartMode', 12)}>12 tháng</button>
          <button class="btn sm ${dashboardChartMode === 'year' ? 'primary' : ''}" ${act('setDashboardChartMode', 'year')}>Theo năm</button>
        </div>
      </div>
      ${trendSvg(dashboardChartMonthKeys())}
    </section>
    <section class="card section">
      <div class="section-head"><div><h2>Cơ cấu chi tiêu tháng</h2><p>${fmtMonthKey(state.month)}</p></div></div>
      ${expenseComposition.length ? `<div class="donut-layout">${donutSvg(expenseComposition)}${legendHtml(expenseComposition, s.income)}</div>` : '<div class="empty">Chưa có giao dịch thực tế trong tháng này.</div>'}
    </section>
  </div>

  <div class="grid section-grid mt-16">
    <div class="dash-col">
      <section class="card section">
        <div class="section-head"><div><h2>Năm nay so với năm trước</h2><p>Lũy kế đến tháng ${fmtMonthKey(state.month)}</p></div></div>
        ${yearOverYearHtml()}
      </section>
    </div>
    <div class="dash-col">
      <section class="card section">
        <div class="section-head"><div><h2>Xu hướng theo danh mục</h2><p>Chi biến động & Thẻ&góp — 5 khoản nhiều nhất tháng này · 6 tháng gần nhất</p></div></div>
        ${categoryTrendHtml()}
      </section>
    </div>
  </div>`;
}

Object.assign(window, { renderDashboard, incomePlanTotal, setDashboardChartMode });
