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

function txLabel(t) {
  return t.transaction_type === 'income' ? (t.category_name || 'Thu nhập') : (t.category_name || 'Chi tiêu');
}
function txTone(t) { return t.transaction_type === 'income' ? 'positive' : 'negative'; }
function txListHtml(rows) {
  if (!rows.length) return '<div class="empty">Chưa có giao dịch thực tế trong tháng này.</div>';
  const editable = new Set(['income', 'expense']);
  return `<div class="list">${rows.map(t => {
    const tone = txTone(t), sign = tone === 'positive' ? '+' : '−';
    const cls = tone === 'positive' ? 'green' : 'red';
    const icon = tone === 'positive' ? '↓' : '↑';
    const canEdit = editable.has(t.transaction_type);
    return `<div class="tx"><button class="tx-row-btn${canEdit ? '' : ' no-cursor'}" ${canEdit ? act('openTransactionEdit', t.id) : 'disabled'}>
      <div class="tx-icon">${icon}</div>
      <div class="tx-main"><strong>${esc(txLabel(t))}${F.isExceptional(t) ? ' <span class="status-chip warn">Bất thường</span>' : ''}</strong><span>${esc(String(t.transaction_date).slice(0, 10))}${t.note ? ` · ${esc(t.note)}` : ''}</span></div>
      </button>
      <div class="tx-actions"><strong class="amount ${cls}">${sign}${money(t.amount, t.currency)}</strong>${canEdit ? `<button class="mini-btn" aria-label="Xóa" ${act('deleteTransaction', t.id)}>×</button>` : ''}</div>
    </div>`;
  }).join('')}</div>`;
}

function planStatus(target, actual, mode) {
  if (target <= 0 && actual <= 0) return { cls: 'neutral', text: 'Chưa có dữ liệu' };
  const diff = actual - target;
  if (mode === 'max') return diff > target * 0.02 && diff > 0 ? { cls: 'bad', text: `Vượt ${money(diff)}` } : { cls: 'good', text: 'Trong kế hoạch' };
  return diff >= -target * 0.02 ? { cls: 'good', text: diff >= 0 ? 'Đạt / vượt mục tiêu' : 'Gần đạt mục tiêu' } : { cls: 'warn', text: `Thiếu ${money(Math.abs(diff))}` };
}
function compareRow(label, sub, target, actual, basis, mode) {
  const st = planStatus(target, actual, mode);
  return `<div class="compare-row">
    <div class="label"><b>${esc(label)}</b><small>${esc(sub)}</small></div>
    <div>${money(target)}<br><small class="muted">${pctText(target, basis)}</small></div>
    <div>${money(actual)}<br><small class="muted">${pctText(actual, basis)}</small></div>
    <div><span class="status-chip ${st.cls}">${esc(st.text)}</span></div>
  </div>`;
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
function biggestMoverHtml() {
  const m = F.biggestCategoryMover(state.month);
  if (!m || (!m.current && !m.previous)) return '<div class="empty compact">Chưa đủ dữ liệu để so sánh.</div>';
  const up = m.diff >= 0;
  return `<div class="compare-row"><div class="label"><b>${esc(m.name)}</b><small>${up ? 'Tăng nhiều nhất' : 'Giảm nhiều nhất'} so với tháng trước</small></div>
    <div>${money(m.previous)}<br><small class="muted">Tháng trước</small></div>
    <div>${money(m.current)}<br><small class="muted">Tháng này</small></div>
    <div><span class="status-chip ${up ? 'bad' : 'good'}">${up ? '▲' : '▼'} ${money(Math.abs(m.diff))}</span></div>
  </div>`;
}

function renderDashboard() {
  const s = F.statsFor(state.month);
  const incomePlan = incomePlanTotal();
  const fixedPlan = F.orderedCategories('expense').filter(c => c.cost_type === 'fixed').reduce((a, c) => a + n(c.planned_amount), 0);
  const variablePlan = F.orderedCategories('expense').filter(c => c.cost_type !== 'fixed').reduce((a, c) => a + n(c.planned_amount), 0);
  const recent = [...state.transactions].sort((a, b) => String(b.transaction_date).localeCompare(String(a.transaction_date))).slice(0, 8);
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
  const prevYearStats = F.statsFor(addMonths(state.month, -12));
  const yoy = (cur, prev) => { const t = yoyText(cur, prev); return t ? `<small class="muted">${t.replace(/^ · /, '')}</small>` : ''; };
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

  <div class="grid section-grid mt-16">
    <div class="dash-col">
      <section class="card">
        <div class="section-head"><div><h2>Kế hoạch vs Thực tế · Tháng ${fmtMonthKey(state.month)}</h2></div></div>
        <div class="compare-table">
          <div class="compare-head"><span>Nhóm</span><span>Kế hoạch</span><span>Thực tế</span><span>Cùng kỳ năm trước</span></div>
          <div class="compare-row"><div class="label"><b>Thu nhập</b></div><div>${money(incomePlan)}</div><div>${money(s.income)}</div><div>${yoy(s.income, prevYearStats.income)}</div></div>
          <div class="compare-row"><div class="label"><b>Chi cố định</b></div><div>${money(fixedPlan)}</div><div>${money(s.fixed)}</div><div>${yoy(s.fixed, prevYearStats.fixed)}</div></div>
          <div class="compare-row"><div class="label"><b>Chi biến động</b></div><div>${money(variablePlan)}</div><div>${money(s.variable)}</div><div>${yoy(s.variable, prevYearStats.variable)}</div></div>
          <div class="compare-row"><div class="label"><b>Thẻ & trả góp</b></div><div>—</div><div>${money(s.card)}</div><div>${yoy(s.card, prevYearStats.card)}</div></div>
        </div>
      </section>
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
    </div>
    <div class="dash-col">
      <section class="card section">
        <div class="section-head"><div><h2>Cơ cấu chi tiêu tháng</h2><p>${fmtMonthKey(state.month)}</p></div></div>
        ${expenseComposition.length ? `<div class="donut-layout">${donutSvg(expenseComposition)}${legendHtml(expenseComposition)}</div>` : '<div class="empty">Chưa có giao dịch thực tế trong tháng này.</div>'}
      </section>
      <section class="card section">
        <div class="section-head"><div><h2>Năm nay so với năm trước</h2><p>Lũy kế đến tháng ${fmtMonthKey(state.month)}</p></div></div>
        ${yearOverYearHtml()}
      </section>
      <section class="card section">
        <div class="section-head"><div><h2>Danh mục tăng/giảm nhiều nhất</h2><p>So với tháng trước</p></div></div>
        <div class="compare-table">${biggestMoverHtml()}</div>
      </section>
      <section class="card section">
        <div class="section-head"><div><h2>Xu hướng theo danh mục</h2><p>5 danh mục chi nhiều nhất tháng này · 6 tháng gần nhất</p></div></div>
        ${categoryTrendHtml()}
      </section>
      <section class="card section">
        <div class="section-head"><div><h2>Giao dịch gần đây</h2><p>Tháng ${fmtMonthKey(state.month)}</p></div><button class="btn sm primary" ${act('openQuickEntry')}>＋ Nhập nhanh</button></div>
        ${txListHtml(recent)}
      </section>
    </div>
  </div>`;
}

Object.assign(window, { renderDashboard, incomePlanTotal, txListHtml, setDashboardChartMode });
