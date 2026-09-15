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
  // Dim styling is reserved for a genuinely empty row (nothing planned, nothing
  // spent) — a planned-only amount is still real information the household
  // set up on purpose, so it reads at full brightness like actual spend does.
  const cls = shown > 0 ? '' : 'muted';
  // Always show both figures explicitly (Kế hoạch vs Thực tế), never just
  // one or the other — that ambiguity is exactly what made a plan look like
  // it had already been spent.
  const actualLabel = kind === 'income' ? 'Đã thu' : 'Đã chi';
  const sub = planned > 0
    ? `<small>Kế hoạch ${money(planned)} · ${actualLabel} ${money(actual)}</small>`
    : `<small>Chưa đặt kế hoạch · ${actualLabel} ${money(actual)}</small>`;
  return { shown, cls, sub, pct: pctText(shown, basis) };
}

// Clicking a category that already has money in it must let you fix/delete
// what's already there, not just blindly add another entry on top — so the
// row only jumps straight to Nhập nhanh while it's still empty (actual=0);
// once it has transactions, it opens the list below instead.
function categoryRowAction(type, actual, categoryId, categoryName) {
  return actual > 0 ? act('openCategoryTransactions', type, categoryId, categoryName) : act('openQuickEntry', { transaction_type: type, category_id: categoryId });
}
// Deletes then re-renders THIS list in place (infoModal only re-opens the
// dialog if it's closed, so this just refreshes its content) — plain
// deleteTransaction() would leave the modal showing the now-deleted row
// until the user closed and reopened it themselves.
async function deleteTransactionFromCategory(id, type, categoryId, categoryName) {
  if (!confirm('Xóa giao dịch này?')) return;
  try {
    await api.core('delete_transaction', { id });
    await window.refresh();
    toast('Đã xóa giao dịch');
    openCategoryTransactions(type, categoryId, categoryName);
  } catch (e) { toast(e.message, true); }
}
function openCategoryTransactions(type, categoryId, categoryName) {
  const rows = (state.transactions || []).filter(t => t.transaction_type === type && t.category_id === categoryId)
    .sort((a, b) => String(b.transaction_date).localeCompare(String(a.transaction_date)));
  const list = rows.map(t => `<div class="tx"><button class="tx-row-btn" ${act('openTransactionEdit', t.id)}>
      <div class="tx-main"><strong>${money(t.amount, t.currency)}${F.isExceptional(t) ? ' <span class="status-chip warn">Bất thường</span>' : ''}</strong><span>${esc(String(t.transaction_date).slice(0, 10))}${t.account_name ? ` · ${esc(t.account_name)}` : ''}${t.note ? ` · ${esc(t.note)}` : ''}</span></div>
      </button>
      <div class="tx-actions"><button class="mini-btn" aria-label="Xóa" ${act('deleteTransactionFromCategory', t.id, type, categoryId, categoryName)}>×</button></div>
    </div>`).join('');
  infoModal(`${esc(categoryName)} · Tháng ${fmtMonthKey(state.month)}`, `
    <div class="list">${list || '<div class="empty compact">Chưa có giao dịch nào.</div>'}</div>
    <button class="btn primary mt-14" ${act('reopenAfterModal', 'openQuickEntry', { transaction_type: type, category_id: categoryId })}>＋ Thêm giao dịch</button>`);
}
function incomeColumn() {
  const cats = F.orderedCategories('income');
  const total = cats.reduce((s, c) => { const actual = F.categoryActualBase(c.id, 'income'); return s + (actual > 0 ? actual : n(c.planned_amount)); }, 0);
  const items = cats.map(c => {
    const actual = F.categoryActualBase(c.id, 'income');
    const line = amountLine('income', n(c.planned_amount), actual, null);
    return `<div class="money-line-wrap">
      <button class="money-line" ${categoryRowAction('income', actual, c.id, c.name)}><span class="line-label">${esc(c.name)}${line.sub}</span><strong class="${line.cls}">${money(line.shown)}</strong></button>
      <button class="mini-btn" type="button" aria-label="Ghi thu thực tế cho ${esc(c.name)}" title="Ghi thu thực tế" ${act('openQuickEntry', { transaction_type: 'income', category_id: c.id })}>＋</button>
    </div>`;
  });
  return moneyColumn({ title: 'Thu nhập', tone: 'income', items, total: money(total), settingsAction: act('openColumnSettings', 'income'), settingsLabel: '⚙ Lập kế hoạch', emptyText: 'Chưa có mục thu nhập' });
}
function expenseColumn(kind, title) {
  const cats = F.orderedCategories('expense').filter(c => (kind === 'fixed' ? c.cost_type === 'fixed' : c.cost_type !== 'fixed'));
  const basis = incomePlanTotal();
  let total = 0;
  const items = cats.map(c => {
    const actual = F.categoryActualBase(c.id, 'expense');
    const line = amountLine(kind, n(c.planned_amount), actual, basis);
    total += line.shown;
    return `<div class="money-line-wrap">
      <button class="money-line" ${categoryRowAction('expense', actual, c.id, c.name)}><span class="line-label">${esc(c.name)}${line.sub}</span><span class="line-amount"><strong class="${line.cls}">${money(line.shown)}</strong><span class="pct">${line.pct}</span></span></button>
      <button class="mini-btn" type="button" aria-label="Ghi chi thực tế cho ${esc(c.name)}" title="Ghi chi thực tế" ${act('openQuickEntry', { transaction_type: 'expense', category_id: c.id })}>＋</button>
    </div>`;
  });
  return moneyColumn({ title, tone: kind, items, total: `${money(total)} <span class="pct">${pctText(total, basis)}</span>`, settingsAction: act('openColumnSettings', kind), settingsLabel: '⚙ Lập kế hoạch', emptyText: kind === 'fixed' ? 'Chưa có chi cố định' : 'Chưa có chi biến động' });
}
function creditColumn() {
  const cards = F.cardAccounts(), basis = incomePlanTotal();
  let total = 0;
  const items = cards.map(card => {
    const cm = F.cardMonthFor(card.id), s = F.settingFor(card.id);
    const due = n(cm?.expected_amount || 0);
    // Two distinct numbers per spec: what was actually spent on the card
    // THIS month (accrual, feeds Chi cố định/Chi biến động by category) vs
    // what statement amount is due this month (can be ¥0 even with real
    // spend, if the statement hasn't closed yet).
    const spend = F.periodTransactions(state.month)
      .filter(t => t.transaction_type === 'expense' && t.account_id === card.id && F.baseTx(t))
      .reduce((sum, t) => sum + F.baseAmount(t), 0);
    if ((card.currency || state.base) === state.base) total += due;
    // Row's headline number always equals `due` — the same figure the
    // column TỔNG sums — so row and total never disagree (this bit us
    // before on the Nợ column). `spend` — real money out this month,
    // regardless of statement cycle — shows only in the subtitle.
    const dueNote = !s ? 'Chưa thiết lập chu kỳ' : due > 0 ? `${cm.paid ? 'Đã trả' : 'Cần trả'} · ${String(cm.payment_date || '').slice(0, 10)}` : 'Chưa đến kỳ phải trả';
    const note = `Phát sinh tháng này ${money(spend, card.currency)} · ${dueNote}`;
    // Main button opens cycle setup / statement payment; the separate ＋
    // button is a shortcut into Nhập nhanh with this card pre-selected, so
    // logging a purchase doesn't require hunting for the card in a dropdown.
    return `<div class="money-line-wrap">
      <button class="money-line" ${!s ? act('openCardSettings', card.id) : act('openStatementPayment', card.id)}><span class="line-label">${esc(card.name)}<small>${esc(note)}</small></span><span class="line-amount"><strong class="${due > 0 ? '' : 'muted'}">${money(due, card.currency)}</strong>${(card.currency || state.base) === state.base ? `<span class="pct">${pctText(due, basis)}</span>` : '<span class="pct">ngoại tệ</span>'}</span></button>
      <button class="mini-btn" type="button" aria-label="Ghi chi tiêu bằng ${esc(card.name)}" title="Ghi chi tiêu bằng ${esc(card.name)}" ${act('openCardExpense', card.id)}>＋</button>
      <button class="mini-btn" type="button" aria-label="Xem chi tiêu ${esc(card.name)}" title="Xem/sửa chi tiêu tháng này" ${act('openCardTransactions', card.id)}>📋</button>
    </div>`;
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
    // The big number here must always equal due.amount — the exact same
    // figure the column's TỔNG sums below — so the row and the total never
    // disagree. The full remaining balance (when nothing is due this month)
    // is still visible via due.note ("Dư nợ ¥X"), just not as the headline
    // number, which would otherwise look like ¥X is payable right now.
    return `<button class="money-line" ${act('openLoanPayment', l.id)}><span class="line-label">${esc(l.counterparty)}<small>${esc(due.note)}</small></span><span class="line-amount"><strong class="${due.amount > 0 ? '' : 'muted'}">${money(due.amount, l.currency)}</strong>${(l.currency || state.base) === state.base ? `<span class="pct">${pctText(due.amount, basis)}</span>` : '<span class="pct">ngoại tệ</span>'}</span></button>`;
  });
  return moneyColumn({ title: 'Nợ phải trả', tone: 'debt', items, total: loans.length ? `${money(total)} <span class="pct">${pctText(total, basis)}</span>` : money(0), settingsAction: act('openDebtColumnManager'), emptyText: 'Chưa có khoản nợ' });
}
function moneyColumn({ title, tone, items, total, settingsAction, settingsLabel = '⚙ Cài đặt', emptyText }) {
  return `<section class="card money-column ${tone}">
    <div class="money-column-head"><h3>${esc(title)}</h3><button class="column-settings" type="button" ${settingsAction} aria-label="${esc(settingsLabel)} ${esc(title)}">${esc(settingsLabel)}</button></div>
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
  infoModal('Cài đặt · Thẻ & trả góp', `<p class="note">Mua bằng thẻ tính chi tiêu ngay theo danh mục thật (như Ăn uống, Mua sắm...) tại ngày mua, và tăng dư nợ thẻ. Thanh toán sao kê chỉ là chuyển tiền ngân hàng sang thẻ để trả nợ — không tính thêm một lần chi tiêu nữa.</p>
    <div class="list">${rows || '<div class="empty compact">Chưa có thẻ tín dụng.</div>'}</div>
    <div class="row mt-14"><button class="btn primary" ${act('reopenAfterModal', 'openCreditCard')}>＋ Thẻ tín dụng</button><button class="btn" ${cards.length ? '' : 'disabled'} ${act('reopenAfterModal', 'openInstallment')}>＋ Khoản trả góp</button></div>`);
}
async function deleteLoanFromManager(id) {
  if (await deleteLoan(id)) closeModal();
}
function openDebtColumnManager() {
  const loans = (state.loans || []).filter(l => l.loan_type === 'borrowed');
  const rows = loans.map(l => `<div class="tx"><div class="tx-main"><strong>${esc(l.counterparty)}</strong><span>Dư nợ ${esc(money(l.remaining_amount, l.currency))}</span></div><div class="tx-actions"><button class="btn sm" ${act('reopenAfterModal', 'openLoan', l.id)}>Sửa</button><button class="mini-btn" aria-label="Xóa khoản nợ" title="Xóa (chỉ khi chưa có giao dịch)" ${act('deleteLoanFromManager', l.id)}>×</button></div></div>`).join('');
  infoModal('Cài đặt · Nợ phải trả', `<p class="note">Cột này chỉ hiện số phải trả trong tháng; tổng dư nợ vẫn được dùng để tính tài sản ròng.</p>
    <div class="list">${rows || '<div class="empty compact">Chưa có khoản nợ.</div>'}</div>
    <button class="btn primary mt-14" ${act('reopenAfterModal', 'openLoan')}>＋ Thêm khoản nợ</button>`);
}

function renderBudget() {
  return `<div class="view-head"><div><h2>Tháng ${fmtMonthKey(state.month)}</h2><p>Nhấn một mục để nhập tiền; tài khoản, chi tiêu và nợ tự đồng bộ. Mỗi cột có một ⚙ Cài đặt dùng chung.</p></div></div>
  <div class="money-board">${incomeColumn()}${expenseColumn('fixed', 'Chi cố định')}${expenseColumn('variable', 'Chi biến động')}${creditColumn()}${debtColumn()}</div>`;
}

Object.assign(window, { renderBudget, openCreditColumnManager, openDebtColumnManager });
