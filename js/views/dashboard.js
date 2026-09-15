// ==========================================================================
// Tổng quan — full analytics dashboard. KPIs, plan vs actual, recent
// transactions, charts, and a plan/actual comparison table. No leftover
// "Việc cần chú ý" / "Góc nhìn nhanh" / duplicate allocation cards.
// ==========================================================================
'use strict';

function kpiCard(label, value, sub, cls = '') {
  return `<section class="card kpi"><div class="label">${esc(label)}</div><div class="value ${cls}">${value}</div><div class="sub">${sub}</div></section>`;
}

function txLabel(t) {
  const type = t.transaction_type;
  const loan = (state.loans || []).find(l => l.id === t.loan_id);
  const map = {
    income: t.category_name || 'Thu nhập', expense: t.category_name || 'Chi tiêu',
    transfer: `${t.account_name || 'Tài khoản'} → ${t.transfer_account_name || 'Tài khoản'}`,
    loan_borrow: `Vay · ${loan?.counterparty || 'Khoản nợ'}`, loan_lend: `Cho vay · ${loan?.counterparty || ''}`,
    loan_pay: `Trả nợ · ${loan?.counterparty || ''}`, loan_collect: `Thu hồi nợ · ${loan?.counterparty || ''}`,
    loan_interest: `Lãi vay · ${loan?.counterparty || ''}`, investment_gain: `Tăng giá trị · ${t.account_name || 'Đầu tư'}`,
    investment_loss: `Giảm giá trị · ${t.account_name || 'Đầu tư'}`, goal_save: 'Góp mục tiêu', goal_withdraw: 'Rút mục tiêu'
  };
  return map[type] || 'Giao dịch';
}
function txTone(t) { return F.POSITIVE_TYPES.has(t.transaction_type) ? 'positive' : (F.TRANSFER_TYPES.has(t.transaction_type) ? 'transfer' : 'negative'); }
function txListHtml(rows) {
  if (!rows.length) return '<div class="empty">Chưa có giao dịch thực tế trong tháng này.</div>';
  const editable = new Set(['income', 'expense', 'transfer']);
  return `<div class="list">${rows.map(t => {
    const tone = txTone(t), sign = tone === 'positive' ? '+' : tone === 'negative' ? '−' : '';
    const cls = tone === 'positive' ? 'green' : tone === 'negative' ? 'red' : '';
    const icon = tone === 'positive' ? '↓' : tone === 'transfer' ? '⇄' : '↑';
    const canEdit = editable.has(t.transaction_type);
    return `<div class="tx"><button class="tx-row-btn${canEdit ? '' : ' no-cursor'}" ${canEdit ? act('openTransactionEdit', t.id) : 'disabled'}>
      <div class="tx-icon">${icon}</div>
      <div class="tx-main"><strong>${esc(txLabel(t))}${F.isExceptional(t) ? ' <span class="status-chip warn">Bất thường</span>' : ''}</strong><span>${esc(String(t.transaction_date).slice(0, 10))}${t.account_name ? ` · ${esc(t.account_name)}` : ''}${t.note ? ` · ${esc(t.note)}` : ''}</span></div>
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

// "" when there's no data for the comparison period (avoids /0).
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

function upcomingDueHtml(items) {
  if (!items.length) return '<div class="empty">Không có khoản nợ hay thẻ nào sắp đến hạn.</div>';
  return `<div class="list">${items.map(x => {
    const openAct = x.kind === 'loan' ? act('openLoanPayment', x.id) : act('openStatementPayment', x.id);
    const overdue = x.date && daysUntil(x.date) < 0;
    const dateNote = x.date ? ` · ${overdue ? 'Quá hạn' : 'Hạn'} ${esc(String(x.date).slice(0, 10))}` : '';
    return `<div class="tx"><button class="tx-row-btn" ${openAct}>
      <div class="tx-icon">${x.kind === 'loan' ? '↑' : '⇄'}</div>
      <div class="tx-main"><strong>${esc(x.label)}</strong><span>${esc(x.note)}${dateNote}</span></div>
      </button>
      <div class="tx-actions"><strong class="amount ${overdue ? 'red' : ''}">${money(x.amount, x.currency)}</strong></div>
    </div>`;
  }).join('')}</div>`;
}

function renderDashboard() {
  const s = F.statsFor(F.periodTransactions(state.month));
  const incomePlan = incomePlanTotal();
  const fixedPlan = F.orderedCategories('expense').filter(c => c.cost_type === 'fixed').reduce((a, c) => a + n(c.planned_amount), 0);
  const variablePlan = F.orderedCategories('expense').filter(c => c.cost_type !== 'fixed').reduce((a, c) => a + n(c.planned_amount), 0);
  const p = state.allocationPlan && monthKey(state.allocationPlan.month) === state.month ? state.allocationPlan : { saving_pct: 0, investment_pct: 0, debt_pct: 0, interest_pct: 0 };
  const savingTarget = incomePlan * n(p.saving_pct) / 100, investmentTarget = incomePlan * n(p.investment_pct) / 100;
  const cardTarget = F.cardMonthTotalBase(), cardActual = (state.cardMonth || []).filter(x => (x.currency || state.base) === state.base && x.paid).reduce((sum, x) => sum + n(x.expected_amount), 0);
  const debtTarget = F.debtMonthTotalBase(), debtActual = s.debtPay + s.loanInterest;
  const recent = [...state.transactions].sort((a, b) => String(b.transaction_date).localeCompare(String(a.transaction_date))).slice(0, 8);
  const expenseComposition = F.expenseByCategory(F.periodTransactions(state.month));
  const prevStats = F.statsFor(F.periodTransactions(addMonths(state.month, -1)));
  const prevYearStats = F.statsFor(F.periodTransactions(addMonths(state.month, -12)));
  const upcoming = F.upcomingDue(state.month);
  const yoy = (cur, prev) => { const t = yoyText(cur, prev); return t ? `<small class="muted">${t.replace(/^ · /, '')}</small>` : ''; };

  // Spending-pace note: only meaningful while the month is still in progress.
  const isCurrentMonth = state.month === localMonth();
  let paceNote = 'Kế hoạch luôn hiển thị đầy đủ dù thực tế đang là 0.', paceCls = '';
  if (isCurrentMonth && variablePlan > 0) {
    const daysInMonth = new Date(Number(state.month.slice(0, 4)), Number(state.month.slice(5, 7)), 0).getDate();
    const dayPct = new Date(localToday()).getDate() / daysInMonth * 100;
    const spendPct = s.variable / variablePlan * 100;
    const ahead = spendPct - dayPct;
    paceCls = ahead > 15 ? 'bad' : ahead > 5 ? 'warn' : 'good';
    paceNote = `${ahead > 5 ? '⚠ ' : ''}Đã dùng ${spendPct.toFixed(0)}% ngân sách chi biến động · đã qua ${dayPct.toFixed(0)}% số ngày trong tháng.`;
  }

  // Tổng quan reports the month's cash-flow result, not the household's
  // asset position — net worth/liquid-cash/asset-mix now live on Tài sản,
  // where "as of right now" actually makes sense (they're not month-scoped).
  const budgetPlan = fixedPlan + variablePlan, budgetActual = s.fixed + s.variable;
  const budgetRemaining = budgetPlan - budgetActual;
  const hasAnyActivity = (state.transactions || []).some(t => ['income', 'expense'].includes(t.transaction_type));
  return `
  <div class="grid kpi-grid">
    ${kpiCard('Thu nhập tháng', money(s.income), `Kế hoạch ${money(incomePlan)}${momText(s.income, prevStats.income)}`, 'green')}
    ${kpiCard('Chi tiêu tháng', money(s.expense), `Ngân sách ${money(budgetPlan)} · ${pctText(s.expense, incomePlan)} thu nhập${momText(s.expense, prevStats.expense)}`, '')}
    ${kpiCard('Ngân sách còn lại', money(budgetRemaining), `${money(budgetActual)} đã chi / ${money(budgetPlan)} ngân sách`, budgetRemaining < 0 ? 'red' : 'green')}
    ${kpiCard('Dòng tiền tháng', money(s.cashFlow), 'Tiền thực thu − tiền thực chi ra khỏi tài khoản', s.cashFlow < 0 ? 'red' : 'green')}
  </div>
  ${!hasAnyActivity ? '<div class="card empty mt-16">Chưa có giao dịch thực tế trong tháng này.</div>' : ''}

  <section class="card mt-16">
    <div class="section-head"><div><h2>Kế hoạch tháng ${fmtMonthKey(state.month)}</h2><p class="${paceCls === 'bad' ? 'red' : paceCls === 'warn' ? 'amber' : ''}">${esc(paceNote)}</p></div></div>
    <div class="compare-table">
      <div class="compare-head"><span>Nhóm</span><span>Kế hoạch</span><span>Thực tế</span><span>Cùng kỳ năm trước</span></div>
      <div class="compare-row"><div class="label"><b>Thu nhập</b></div><div>${money(incomePlan)}</div><div>${money(s.income)}</div><div>${yoy(s.income, prevYearStats.income)}</div></div>
      <div class="compare-row"><div class="label"><b>Chi cố định</b></div><div>${money(fixedPlan)}<br><small class="muted">${pctText(fixedPlan, incomePlan)}</small></div><div>${money(s.fixed)}<br><small class="muted">${pctText(s.fixed, incomePlan)}</small></div><div>${yoy(s.fixed, prevYearStats.fixed)}</div></div>
      <div class="compare-row"><div class="label"><b>Chi biến động</b></div><div>${money(variablePlan)}<br><small class="muted">${pctText(variablePlan, incomePlan)}</small></div><div>${money(s.variable)}<br><small class="muted">${pctText(s.variable, incomePlan)}</small></div><div>${yoy(s.variable, prevYearStats.variable)}</div></div>
    </div>
  </section>

  <section class="card section chart-card mt-16"><div class="section-head"><div><h2>Thu nhập vs Chi tiêu</h2><p>12 tháng gần nhất · theo ngày phát sinh giao dịch</p></div></div>${trendSvg()}</section>

  <section class="card section mt-16"><div class="section-head"><div><h2>Cơ cấu chi tiêu tháng</h2><p>${fmtMonthKey(state.month)}</p></div></div>
    ${expenseComposition.length ? `<div class="donut-layout">${donutSvg(expenseComposition)}${legendHtml(expenseComposition, 'income', s.income)}</div>` : '<div class="empty">Chưa có giao dịch thực tế trong tháng này.</div>'}</section>

  <section class="card section mt-16">
    <div class="section-head"><div><h2>Xu hướng theo danh mục</h2><p>5 danh mục chi nhiều nhất tháng này · 6 tháng gần nhất</p></div></div>
    ${categoryTrendHtml()}
  </section>

  <section class="card section mt-16">
    <div class="section-head"><div><h2>Kế hoạch vs Thực tế</h2><p>Toàn bộ dòng tiền được phân bổ trong tháng</p></div><button class="btn sm" ${act('openAllocationPlan')}>Sửa chỉ tiêu %</button></div>
    <div class="compare-table">
      <div class="compare-head"><span>Nhóm</span><span>Kế hoạch</span><span>Thực tế</span><span>Trạng thái</span></div>
      ${compareRow('Chi cố định', 'Theo danh mục', fixedPlan, s.fixed, incomePlan, 'max')}
      ${compareRow('Chi biến động', 'Theo danh mục', variablePlan, s.variable, incomePlan, 'max')}
      ${compareRow('Thẻ & trả góp', 'Kỳ thanh toán tháng này', cardTarget, cardActual, incomePlan, 'max')}
      ${compareRow('Nợ', 'Phải trả trong tháng', debtTarget, debtActual, incomePlan, 'max')}
      ${compareRow('Tiết kiệm', `Chỉ tiêu ${n(p.saving_pct).toFixed(1)}%`, savingTarget, s.saving, incomePlan, 'min')}
      ${compareRow('Đầu tư', `Chỉ tiêu ${n(p.investment_pct).toFixed(1)}%`, investmentTarget, s.investment, incomePlan, 'min')}
    </div>
  </section>

  <div class="grid section-grid mt-16">
    <section class="card section">
      <div class="section-head"><div><h2>Giao dịch gần đây</h2><p>Tháng ${fmtMonthKey(state.month)}</p></div><button class="btn sm primary" ${act('openQuickEntry')}>＋ Nhập nhanh</button></div>
      ${txListHtml(recent)}
    </section>
    <section class="card section">
      <div class="section-head"><div><h2>Sắp đến hạn</h2><p>Khoản nợ chưa trả · thẻ chưa thanh toán</p></div></div>
      ${upcomingDueHtml(upcoming)}
    </section>
  </div>`;
}

Object.assign(window, { renderDashboard, incomePlanTotal, txListHtml });
