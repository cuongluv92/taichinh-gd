// ==========================================================================
// Chi tiêu — the monthly cash-flow board. Five equal columns: Thu nhập /
// Chi cố định / Chi biến động / Thẻ & trả góp / Nợ phải trả. Each column has
// one unified header/settings gear (no per-row settings clutter), and the
// Nợ column is always rendered even when empty.
// ==========================================================================
'use strict';

function incomePlanTotal() { return F.orderedCategories('income').reduce((s, c) => s + n(c.planned_amount), 0); }

function amountLine(kind, planned, actual, basis) {
  const shown = actual > 0 ? actual : planned;
  const cls = actual > 0 ? '' : 'muted';
  const sub = actual > 0 && planned > 0 ? `<small>Kế hoạch ${money(planned)}</small>` : (planned <= 0 ? '<small>Chưa đặt kế hoạch</small>' : '');
  return { shown, cls, sub, pct: pctText(shown, basis) };
}

function incomeColumn() {
  const cats = F.orderedCategories('income');
  const total = cats.reduce((s, c) => { const actual = F.categoryActualBase(c.id, 'income'); return s + (actual > 0 ? actual : n(c.planned_amount)); }, 0);
  const items = cats.map(c => {
    const actual = F.categoryActualBase(c.id, 'income');
    const line = amountLine('income', n(c.planned_amount), actual, null);
    return `<button class="money-line" ${act('openQuickEntry', { transaction_type: 'income', category_id: c.id })}><span class="line-label">${esc(c.name)}${line.sub}</span><strong class="${line.cls}">${money(line.shown)}</strong></button>`;
  });
  return moneyColumn({ title: 'Thu nhập', tone: 'income', items, total: money(total), settingsAction: act('openColumnSettings', 'income'), emptyText: 'Chưa có mục thu nhập' });
}
function expenseColumn(kind, title) {
  const cats = F.orderedCategories('expense').filter(c => (kind === 'fixed' ? c.cost_type === 'fixed' : c.cost_type !== 'fixed'));
  const basis = incomePlanTotal();
  let total = 0;
  const items = cats.map(c => {
    const actual = F.categoryActualBase(c.id, 'expense');
    const line = amountLine(kind, n(c.planned_amount), actual, basis);
    total += line.shown;
    return `<button class="money-line" ${act('openQuickEntry', { transaction_type: 'expense', category_id: c.id })}><span class="line-label">${esc(c.name)}${line.sub}</span><span class="line-amount"><strong class="${line.cls}">${money(line.shown)}</strong><span class="pct">${line.pct}</span></span></button>`;
  });
  return moneyColumn({ title, tone: kind, items, total: `${money(total)} <span class="pct">${pctText(total, basis)}</span>`, settingsAction: act('openColumnSettings', kind), emptyText: kind === 'fixed' ? 'Chưa có chi cố định' : 'Chưa có chi biến động' });
}
function creditColumn() {
  const cards = F.cardAccounts(), basis = incomePlanTotal();
  let total = 0;
  const items = cards.map(card => {
    const cm = F.cardMonthFor(card.id), s = F.settingFor(card.id);
    const amount = n(cm?.expected_amount || 0);
    if ((card.currency || state.base) === state.base) total += amount;
    const note = !s ? 'Chưa thiết lập chu kỳ' : amount > 0 ? `${cm.paid ? 'Đã trả' : 'Cần trả'} · ${String(cm.payment_date || '').slice(0, 10)}` : 'Không có kỳ phải trả tháng này';
    return `<button class="money-line" ${!s ? act('openCardSettings', card.id) : act('openStatementPayment', card.id)}><span class="line-label">${esc(card.name)}<small>${esc(note)}</small></span><span class="line-amount"><strong class="${amount > 0 ? '' : 'muted'}">${money(amount, card.currency)}</strong>${(card.currency || state.base) === state.base ? `<span class="pct">${pctText(amount, basis)}</span>` : '<span class="pct">ngoại tệ</span>'}</span></button>`;
  });
  return moneyColumn({ title: 'Thẻ & trả góp', tone: 'credit', items, total: `${money(total)} <span class="pct">${pctText(total, basis)}</span>`, settingsAction: act('openCreditColumnManager'), emptyText: 'Chưa có thẻ tín dụng' });
}
function debtColumn() {
  const loans = (state.loans || []).filter(l => l.loan_type === 'borrowed' && n(l.remaining_amount) > 0);
  const basis = incomePlanTotal();
  let total = 0;
  const items = loans.map(l => {
    const due = F.loanMonthDue(l);
    if ((l.currency || state.base) === state.base) total += n(due.amount);
    return `<button class="money-line" ${act('openLoanPayment', l.id)}><span class="line-label">${esc(l.counterparty)}<small>${esc(due.note)}</small></span><span class="line-amount"><strong class="${due.amount > 0 ? '' : 'muted'}">${money(due.amount || l.remaining_amount, l.currency)}</strong>${(l.currency || state.base) === state.base ? `<span class="pct">${pctText(due.amount, basis)}</span>` : '<span class="pct">ngoại tệ</span>'}</span></button>`;
  });
  return moneyColumn({ title: 'Nợ phải trả', tone: 'debt', items, total: loans.length ? `${money(total)} <span class="pct">${pctText(total, basis)}</span>` : money(0), settingsAction: act('openDebtColumnManager'), emptyText: 'Chưa có khoản nợ' });
}
function moneyColumn({ title, tone, items, total, settingsAction, emptyText }) {
  return `<section class="card money-column ${tone}">
    <div class="money-column-head"><h3>${esc(title)}</h3><button class="column-settings" type="button" ${settingsAction} aria-label="Cài đặt ${esc(title)}">⚙ Cài đặt</button></div>
    <div class="money-items">${items.length ? items.join('') : `<div class="money-empty">${esc(emptyText)}</div>`}</div>
    <div class="money-total"><span>Tổng</span><strong>${total}</strong></div>
  </section>`;
}

function openCreditColumnManager() {
  const cards = F.cardAccounts();
  const rows = cards.map(card => {
    const s = F.settingFor(card.id);
    const inst = (state.cardInstallments || []).filter(x => x.card_account_id === card.id);
    return `<div class="tx"><div class="tx-main"><strong>${esc(card.name)}</strong><span>${s ? `Chốt ngày ${esc(s.closing_day)} · trả ngày ${esc(s.payment_day)} · ${n(s.payment_month_offset || 1) === 1 ? 'tháng sau' : 'sau 2 tháng'}` : 'Chưa cài chu kỳ'}${inst.length ? ` · ${inst.length} khoản trả góp` : ''}</span></div><div class="tx-actions"><button class="btn sm" ${act('reopenAfterModal', 'openCardSettings', card.id)}>Sửa chu kỳ</button></div></div>`;
  }).join('');
  infoModal('Cài đặt · Thẻ & trả góp', `<p class="note">Thanh toán thẻ không tính thành chi tiêu lần hai — chỉ chuyển tiền ngân hàng sang thẻ.</p>
    <div class="list">${rows || '<div class="empty compact">Chưa có thẻ tín dụng.</div>'}</div>
    <div class="row mt-14"><button class="btn primary" ${act('reopenAfterModal', 'openCreditCard')}>＋ Thẻ tín dụng</button><button class="btn" ${cards.length ? '' : 'disabled'} ${act('reopenAfterModal', 'openInstallment')}>＋ Khoản trả góp</button></div>`);
}
function openDebtColumnManager() {
  const loans = (state.loans || []).filter(l => l.loan_type === 'borrowed');
  const rows = loans.map(l => `<div class="tx"><div class="tx-main"><strong>${esc(l.counterparty)}</strong><span>Dư nợ ${esc(money(l.remaining_amount, l.currency))}</span></div><div class="tx-actions"><button class="btn sm" ${act('reopenAfterModal', 'openLoan', l.id)}>Sửa</button></div></div>`).join('');
  infoModal('Cài đặt · Nợ phải trả', `<p class="note">Cột này chỉ hiện số phải trả trong tháng; tổng dư nợ vẫn được dùng để tính tài sản ròng.</p>
    <div class="list">${rows || '<div class="empty compact">Chưa có khoản nợ.</div>'}</div>
    <button class="btn primary mt-14" ${act('reopenAfterModal', 'openLoan')}>＋ Thêm khoản nợ</button>`);
}

function renderBudget() {
  return `<div class="view-head"><div><h2>Tháng ${fmtMonthKey(state.month)}</h2><p>Nhấn một mục để nhập tiền; tài khoản, chi tiêu và nợ tự đồng bộ. Mỗi cột có một ⚙ Cài đặt dùng chung.</p></div></div>
  <div class="money-board">${incomeColumn()}${expenseColumn('fixed', 'Chi cố định')}${expenseColumn('variable', 'Chi biến động')}${creditColumn()}${debtColumn()}</div>`;
}

Object.assign(window, { renderBudget, openCreditColumnManager, openDebtColumnManager });
