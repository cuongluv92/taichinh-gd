// ==========================================================================
// Chi tiêu — the monthly report board. Columns stay fully independent: a
// transaction logged in one column never auto-transfers to another. Tổng
// quan sums all of these columns for its "Tổng chi tiêu tháng" total, but
// nothing here ever reads or writes an account balance.
// ==========================================================================
'use strict';

function incomePlanTotal() { return F.orderedCategories('income').reduce((s, c) => s + n(c.planned_amount), 0); }

function amountLine(kind, planned, actual, basis) {
  const shown = actual > 0 ? actual : planned;
  const cls = actual > 0 ? '' : 'muted';
  const actualLabel = kind === 'income' ? 'Đã thu' : 'Đã chi';
  const sub = planned > 0
    ? `<small>Kế hoạch ${money(planned)} · ${actualLabel} ${money(actual)}</small>`
    : `<small>Chưa đặt kế hoạch · ${actualLabel} ${money(actual)}</small>`;
  return { shown, cls, sub, pct: pctText(shown, basis) };
}

function categoryRowAction(type, actual, categoryId, categoryName) {
  return actual > 0 ? act('openCategoryTransactions', type, categoryId, categoryName) : act('openQuickEntry', { transaction_type: type, category_id: categoryId });
}
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
      <div class="tx-main"><strong>${money(t.amount, t.currency)}${F.isExceptional(t) ? ' <span class="status-chip warn">Bất thường</span>' : ''}</strong><span>${esc(String(t.transaction_date).slice(0, 10))}${t.note ? ` · ${esc(t.note)}` : ''}</span></div>
      </button>
      <div class="tx-actions"><button class="btn sm" aria-label="Xóa" ${act('deleteTransactionFromCategory', t.id, type, categoryId, categoryName)}>Xóa</button></div>
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
    return `<button class="money-line" ${categoryRowAction('income', actual, c.id, c.name)}><span class="line-label">${esc(c.name)}${line.sub}</span><strong class="${line.cls}">${money(line.shown)}</strong></button>`;
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
    return `<button class="money-line" ${categoryRowAction('expense', actual, c.id, c.name)}><span class="line-label">${esc(c.name)}${line.sub}</span><span class="line-amount"><strong class="${line.cls}">${money(line.shown)}</strong><span class="pct">${line.pct}</span></span></button>`;
  });
  return moneyColumn({ title, tone: kind, items, total: `${money(total)} <span class="pct">${pctText(total, basis)}</span>`, settingsAction: act('openColumnSettings', kind), settingsLabel: '⚙ Lập kế hoạch', emptyText: kind === 'fixed' ? 'Chưa có chi cố định' : 'Chưa có chi biến động' });
}
// Thẻ & trả góp: card_expenses (detail/lump) + this month's installment
// schedule due — never category-based, never touches an account balance.
function creditColumn() {
  const cards = F.cardAccounts(), basis = incomePlanTotal();
  let total = 0;
  const items = cards.map(card => {
    const due = F.cardColumnMonthTotal(card.id, state.month);
    if ((card.currency || state.base) === state.base) total += due;
    const instCount = F.installmentsFor(card.id).length;
    const note = instCount ? `${instCount} khoản trả góp đang theo dõi` : 'Chưa có khoản trả góp';
    return `<div class="money-line-wrap">
      <button class="money-line" ${act('openCardLedger', card.id)}><span class="line-label">${esc(card.name)}<small>${esc(note)}</small></span><span class="line-amount"><strong class="${due > 0 ? '' : 'muted'}">${money(due, card.currency)}</strong>${(card.currency || state.base) === state.base ? `<span class="pct">${pctText(due, basis)}</span>` : '<span class="pct">ngoại tệ</span>'}</span></button>
      <button class="btn sm" type="button" aria-label="Xem danh sách ${esc(card.name)}" ${act('openCardLedger', card.id)}>Xem danh sách</button>
    </div>`;
  });
  return moneyColumn({ title: 'Thẻ & trả góp', tone: 'credit', items, total: `${money(total)} <span class="pct">${pctText(total, basis)}</span>`, settingsAction: act('openCreditColumnManager'), emptyText: 'Chưa có thẻ tín dụng' });
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
    const inst = F.installmentsFor(card.id);
    return `<div class="tx"><div class="tx-main"><strong>${esc(card.name)}</strong><span>${esc(card.currency || state.base)}${inst.length ? ` · ${inst.length} khoản trả góp` : ''}</span></div><div class="tx-actions"><button class="btn sm" ${act('reopenAfterModal', 'openCardLedger', card.id)}>Xem danh sách</button></div></div>`;
  }).join('');
  infoModal('Cài đặt · Thẻ & trả góp', `<p class="note">Chi tiêu bằng thẻ và trả góp chỉ nằm trong cột này — không tự động đưa sang Chi biến động, không tự động trừ tài khoản ngân hàng.</p>
    <div class="list">${rows || '<div class="empty compact">Chưa có thẻ tín dụng.</div>'}</div>
    <button class="btn primary mt-14" ${act('reopenAfterModal', 'openCreditCard')}>＋ Thẻ tín dụng mới</button>`);
}
function renderBudget() {
  return `<div class="view-head"><div><h2>Tháng ${fmtMonthKey(state.month)}</h2><p>Mỗi cột độc lập — một giao dịch chỉ nằm trong đúng một cột. Nợ được quản lý riêng ở Tài sản. Nhấn một mục để nhập tiền.</p></div></div>
  <div class="money-board">${incomeColumn()}${expenseColumn('fixed', 'Chi cố định')}${expenseColumn('variable', 'Chi biến động')}${creditColumn()}</div>`;
}

Object.assign(window, { renderBudget, openCreditColumnManager });
