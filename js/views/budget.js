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
  // TỔNG must be thực tế only (matches "Thu nhập tháng" KPI = F.statsFor().income)
  // — a row still shows its kế hoạch as a muted placeholder when nothing's
  // logged yet (amountLine's `shown`), but that placeholder must not leak
  // into the column footer, or the footer stops matching the KPI above it.
  const total = cats.reduce((s, c) => s + F.categoryActualBase(c.id, 'income'), 0);
  const items = cats.map(c => {
    const actual = F.categoryActualBase(c.id, 'income');
    const line = amountLine('income', n(c.planned_amount), actual, null);
    return `<button class="money-line" ${categoryRowAction('income', actual, c.id, c.name)}><span class="line-label">${esc(c.name)}${line.sub}</span><strong class="${line.cls}">${money(line.shown)}</strong></button>`;
  });
  return moneyColumn({ title: 'Thu nhập', tone: 'income', items, total: money(total), settingsAction: act('openColumnSettings', 'income'), settingsLabel: '⚙ Lập kế hoạch', emptyText: 'Chưa có mục thu nhập' });
}
function expenseColumn(kind, title) {
  const cats = F.orderedCategories('expense').filter(c => (kind === 'fixed' ? c.cost_type === 'fixed' : c.cost_type !== 'fixed'));
  // % basis is thu nhập THỰC TẾ đã nhận tháng này (F.statsFor().income) —
  // same figure the "Thu nhập tháng" KPI and "Tỷ lệ chi tiêu/thu nhập" KPI
  // already use, so every % on this page reads against the same number
  // instead of silently switching to kế hoạch (planned) income here.
  const basis = F.statsFor(state.month).income;
  // TỔNG must be thực tế only (matches "Tổng chi tiêu tháng" KPI's Cố định/
  // Biến động breakdown = F.statsFor().fixed/variable) — same reasoning as
  // incomeColumn: a row's own muted kế hoạch placeholder must not leak into
  // the footer total.
  let total = 0;
  const items = cats.map(c => {
    const actual = F.categoryActualBase(c.id, 'expense');
    const line = amountLine(kind, n(c.planned_amount), actual, basis);
    total += actual;
    return `<button class="money-line" ${categoryRowAction('expense', actual, c.id, c.name)}><span class="line-label">${esc(c.name)}${line.sub}</span><span class="line-amount"><strong class="${line.cls}">${money(line.shown)}</strong><span class="pct">${line.pct}</span></span></button>`;
  });
  return moneyColumn({ title, tone: kind, items, total: `${money(total)} <span class="pct">${pctText(total, basis)}</span>`, settingsAction: act('openColumnSettings', kind), settingsLabel: '⚙ Lập kế hoạch', emptyText: kind === 'fixed' ? 'Chưa có chi cố định' : 'Chưa có chi biến động' });
}
// Thẻ & trả góp: card_expenses (detail/lump) + this month's installment
// schedule due — never category-based, never touches an account balance.
function creditColumn() {
  const cards = F.cardAccounts(), basis = F.statsFor(state.month).income;
  let total = 0;
  const items = cards.map(card => {
    const due = F.cardColumnMonthTotal(card.id, state.month);
    if ((card.currency || state.base) === state.base) total += due;
    const instCount = F.installmentsFor(card.id).length;
    const note = instCount ? `${instCount} khoản trả góp đang theo dõi` : 'Chưa có khoản trả góp';
    return `<button class="money-line" ${act('openCardLedger', card.id)} aria-label="Xem danh sách ${esc(card.name)}"><span class="line-label">${esc(card.name)}<small>${esc(note)}</small></span><span class="line-amount"><strong class="${due > 0 ? '' : 'muted'}">${money(due, card.currency)}</strong>${(card.currency || state.base) === state.base ? `<span class="pct">${pctText(due, basis)}</span>` : '<span class="pct">ngoại tệ</span>'}</span><span class="line-icon" aria-hidden="true">☰</span></button>`;
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
// ---------------------------------------------------------------------
// Bảng nháp — a free-form 4-column scratchpad, entirely separate from the
// real budget above: column names and every item's label start blank and
// are plain free text (no categories), items reset per month, and none of
// it ever feeds F.statsFor or any KPI/report. Just a private calculator
// (user's words: "tính toán các khoản để chuyển khoản", not for phân tích).
// Collapsed by default — one single toggle hides/shows all 4 columns
// together, there's no per-column hide.
// ---------------------------------------------------------------------
function scratchItemsFor(no) {
  const real = (state.scratchItems || []).filter(x => x.column_no === no);
  if (real.length) return real;
  // A column with no real items yet shows last month's mẫu live (server
  // already only sends it for the ONE eligible month) — nothing is saved
  // just from viewing it, and re-saving the mẫu (edit + "Lưu" again)
  // shows up here immediately since it's never frozen into the database.
  return (state.scratchTemplates || []).filter(t => t.column_no === no).map(t => ({ ...t, id: '' }));
}
function scratchColumnName(no) { return (state.scratchColumns || []).find(x => x.column_no === no)?.name || ''; }
// A plain type="number" input can't show grouping separators while typing —
// this renders/reads `.scratch-amount` as free text with live ","-grouping
// instead, so a big số tiền is as readable while editing as it is in "Tổng".
function groupThousands(digits) { return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function scratchAmountInputValue(v) { return v ? groupThousands(String(Math.trunc(n(v)))) : ''; }
function scratchAmountValue(el) { return n(el.value.replace(/[^\d]/g, '')); }
function scratchRowTotal(row) { return Number(row.dataset.sign || 1) * scratchAmountValue(row.querySelector('.scratch-amount')); }
function scratchColumn(no) {
  const items = scratchItemsFor(no);
  const total = items.reduce((s, x, i) => s + (i === 0 ? 1 : (x.sign === -1 ? -1 : 1)) * n(x.amount), 0);
  const rows = items.map((x, i) => {
    // First row in the column is the baseline — always +, no toggle. Every
    // other row gets a +/− toggle; the column total nets them against it.
    const sign = i === 0 ? 1 : (x.sign === -1 ? -1 : 1);
    const signBtn = i === 0
      ? `<span class="scratch-sign-spacer" aria-hidden="true"></span>`
      : `<button type="button" class="mini-btn scratch-sign" aria-label="Đổi dấu cộng/trừ">${sign === -1 ? '−' : '+'}</button>`;
    return `<div class="scratch-row" data-id="${esc(x.id)}" data-col="${no}" data-sign="${sign}">
      <input class="scratch-label" type="text" placeholder="Tên khoản" value="${esc(x.label || '')}">
      ${signBtn}
      <input class="scratch-amount" type="text" inputmode="numeric" placeholder="0" value="${esc(scratchAmountInputValue(x.amount))}">
      <button class="mini-btn" type="button" aria-label="Xóa dòng" ${act('deleteScratchItem', x.id)}>✕</button>
    </div>`;
  }).join('');
  return `<section class="card money-column scratch">
    <div class="money-column-head"><input class="scratch-title" type="text" placeholder="Cột ${no}" value="${esc(scratchColumnName(no))}" data-col="${no}"></div>
    <div class="scratch-items">${rows || '<div class="money-empty">Chưa có dòng nào</div>'}</div>
    <button class="btn sm mt-8" type="button" ${act('addScratchItem', no)}>＋ Thêm dòng</button>
    <div class="money-total"><span>Tổng</span><strong>${money(total)}</strong></div>
  </section>`;
}
function renderScratchBoard() {
  let open = false;
  try { open = localStorage.getItem(SCRATCH_OPEN_STORE) === '1'; } catch {}
  return `<div class="mt-16">
    <div class="row wrap">
      <button class="btn" type="button" ${act('toggleScratchBoard')}>${open ? '▾ Ẩn bảng nháp' : '▸ Hiện bảng nháp (tính nhanh, không tính vào phân tích)'}</button>
      ${open ? `<button class="btn sm" type="button" ${act('saveScratchTemplate')}>💾 Lưu</button>` : ''}
    </div>
    ${open ? `<p class="note mt-6">Kỳ đầu mỗi cột là mốc (luôn +), các dòng sau có nút +/− để cộng hoặc trừ vào mốc đó. "Lưu" giữ lại tên VÀ số tiền hiện tại làm mẫu — tháng nào chưa nhập gì sẽ tự có y hệt.</p>
    <div class="money-board mt-10">${[1, 2, 3, 4].map(scratchColumn).join('')}</div>` : ''}
  </div>`;
}
async function saveScratchTemplate() {
  try { await api.scratch('save_template', { month: monthDate(state.month) }); toast('Đã lưu — tháng chưa mở bảng nháp sẽ tự điền y hệt'); }
  catch (e) { toast(e.message, true); }
}
function toggleScratchBoard() {
  let open = false;
  try { open = localStorage.getItem(SCRATCH_OPEN_STORE) === '1'; } catch {}
  try { localStorage.setItem(SCRATCH_OPEN_STORE, open ? '0' : '1'); } catch {}
  render();
}
async function addScratchItem(columnNo) {
  try {
    // If this column is still just showing the live mẫu preview (no real
    // rows yet), commit ALL of its mẫu rows for real first — otherwise
    // adding one blank row would make the column non-empty with just that
    // one row, and the mẫu's OTHER rows would silently vanish (scratchItemsFor
    // only shows the preview when a column has ZERO real items). Sequential
    // awaits so each insert's auto sort_order lands correctly.
    const hasReal = (state.scratchItems || []).some(x => x.column_no === columnNo);
    if (!hasReal) {
      for (const t of (state.scratchTemplates || []).filter(x => x.column_no === columnNo)) {
        await api.scratch('save_item', { column_no: columnNo, month: monthDate(state.month), label: t.label, amount: t.amount, sign: t.sign });
      }
    }
    await api.scratch('save_item', { column_no: columnNo, month: monthDate(state.month), label: '', amount: 0, sign: 1 });
    await window.refresh();
  } catch (e) { toast(e.message, true); }
}
async function deleteScratchItem(id) {
  try { await api.scratch('delete_item', { id }); await window.refresh(); }
  catch (e) { toast(e.message, true); }
}
function wireBudgetView() {
  const recomputeTotal = section => {
    const total = [...section.querySelectorAll('.scratch-row')].reduce((s, row) => s + scratchRowTotal(row), 0);
    section.querySelector('.money-total strong').textContent = money(total);
  };
  // Saves ONE row using whatever's currently in its own label/amount/sign —
  // month is required (not just id/col): a row with no id yet (the live mẫu
  // preview, first ever save) inserts, and without an explicit month the
  // server falls back to the current real-world month instead of whichever
  // month is actually being viewed.
  const saveRow = row => {
    const col = Number(row.dataset.col);
    const labelEl = row.querySelector('.scratch-label'), amountEl = row.querySelector('.scratch-amount');
    return api.scratch('save_item', { id: row.dataset.id, column_no: col, month: monthDate(state.month), label: labelEl.value, amount: scratchAmountValue(amountEl), sign: Number(row.dataset.sign) })
      .then(r => { if (r?.id) row.dataset.id = r.id; });
  };
  $$('.scratch-row').forEach(row => {
    const col = Number(row.dataset.col);
    const labelEl = row.querySelector('.scratch-label'), amountEl = row.querySelector('.scratch-amount');
    // Touching ANY row of a still-preview column (mẫu shown, nothing saved
    // yet) must commit the WHOLE column at once, not just this row —
    // otherwise the column stops being "empty" after just this one insert,
    // and the mẫu's OTHER rows vanish instead of ever getting saved. One at
    // a time (not parallel), so each insert's auto sort_order is correct.
    const save = () => {
      const isPreview = row.dataset.id === '' && !(state.scratchItems || []).some(x => x.column_no === col);
      const rows = isPreview ? [...row.closest('.money-column').querySelectorAll('.scratch-row')] : [row];
      return rows.reduce((chain, r) => chain.then(() => saveRow(r)), Promise.resolve()).catch(e => toast(e.message, true));
    };
    labelEl.addEventListener('blur', save);
    amountEl.addEventListener('blur', save);
    // Live total feedback while typing, before the blur-save round trip —
    // also re-groups the digits with "," on every keystroke so a big số
    // tiền stays readable while editing, not just once saved.
    amountEl.addEventListener('input', () => {
      const cursorFromEnd = amountEl.value.length - amountEl.selectionStart;
      amountEl.value = groupThousands(amountEl.value.replace(/[^\d]/g, ''));
      const pos = Math.max(0, amountEl.value.length - cursorFromEnd);
      amountEl.setSelectionRange(pos, pos);
      recomputeTotal(row.closest('.money-column'));
    });
    row.querySelector('.scratch-sign')?.addEventListener('click', () => {
      const btn = row.querySelector('.scratch-sign');
      const newSign = Number(row.dataset.sign) === 1 ? -1 : 1;
      row.dataset.sign = String(newSign);
      btn.textContent = newSign === -1 ? '−' : '+';
      recomputeTotal(row.closest('.money-column'));
      save();
    });
  });
  $$('.scratch-title').forEach(input => {
    input.addEventListener('blur', () => api.scratch('save_column_name', { column_no: Number(input.dataset.col), name: input.value }).catch(e => toast(e.message, true)));
  });
}
function renderBudget() {
  const s = F.statsFor(state.month);
  const ratio = pctText(s.expense, s.income);
  return `<div class="view-head"><div><h2>Tháng ${fmtMonthKey(state.month)}</h2><p>Mỗi cột độc lập — một giao dịch chỉ nằm trong đúng một cột. Nợ được quản lý riêng ở Tài sản. Nhấn một mục để nhập tiền.</p></div></div>
  <div class="grid kpi-grid sm">
    ${kpiCard('Thu nhập tháng', money(s.income), `Kế hoạch ${money(incomePlanTotal())}`, 'green')}
    ${kpiCard('Tổng chi tiêu tháng', money(s.expense), `Cố định ${money(s.fixed)} · Biến động ${money(s.variable)} · Thẻ&góp ${money(s.card + s.installment)}`, '')}
    ${kpiCard('Còn lại trong tháng', signedMoney(s.remaining), 'Thu nhập − Tổng chi tiêu tháng', s.remaining < 0 ? 'red' : 'green')}
    ${kpiCard('Tỷ lệ chi tiêu / thu nhập', ratio, s.exceptional > 0 ? `Chưa tính ${money(s.exceptional)} chi bất thường` : 'Tổng chi tiêu so với thu nhập tháng', s.expense > s.income ? 'red' : '')}
  </div>
  <div class="money-board mt-16">${incomeColumn()}${expenseColumn('fixed', 'Chi cố định')}${expenseColumn('variable', 'Chi biến động')}${creditColumn()}</div>
  ${renderScratchBoard()}`;
}

Object.assign(window, { renderBudget, openCreditColumnManager, toggleScratchBoard, addScratchItem, deleteScratchItem, saveScratchTemplate, wireBudgetView });
