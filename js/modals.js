// ==========================================================================
// All modal forms, consolidated.
// ==========================================================================
'use strict';

// ---------------- Quick entry (income / expense only — no accounts, no transfer) ----------------
// Income/expense entries never carry an account_id anymore (Chi tiêu is
// fully decoupled from Tài sản — spec: "Không tự động lấy giao dịch chi
// tiêu để cộng/trừ tài khoản ngân hàng hoặc tài sản"), so there is nothing
// here to pick an account for.
function readQuickPrefs() { try { return JSON.parse(localStorage.getItem(QUICK_PREF_KEY) || '{}') || {}; } catch { return {}; } }
function writeQuickPref(type, patch) {
  const all = readQuickPrefs(); all[type] = { ...(all[type] || {}), ...patch };
  try { localStorage.setItem(QUICK_PREF_KEY, JSON.stringify(all)); } catch {}
}
function selectedMonthDate() {
  const local = localToday();
  return monthKey(local) === state.month ? local : `${state.month}-01`;
}
function openQuickEntry(defaults = {}) {
  let type = ['income', 'expense'].includes(defaults.transaction_type) ? defaults.transaction_type : 'expense';
  const prefs = readQuickPrefs();
  let categoryId = defaults.category_id || prefs[type]?.category_id || '';
  // Auto-fill "Số tiền" from the selected category's kế hoạch (planned
  // amount) — on open AND every time the category changes inside the modal
  // (tab switch, chip, or dropdown), not just when it was opened for one
  // specific category — so a month with no surprises never needs re-typing
  // the same number. Stops once the user types or taps an amount
  // suggestion themselves, so it never overwrites a deliberate entry.
  let amountTouched = defaults.amount != null && defaults.amount !== '';
  const initialAmount = amountTouched ? defaults.amount : '';
  const dlg = $('#modal'), mb = $('#modalBody'), form = $('#modalForm');
  mb.innerHTML = `<div class="modal-head"><h3>Nhập nhanh</h3><button class="mini-btn" type="button" aria-label="Đóng" ${act('closeModal')}>✕</button></div>
  <div class="modal-content quick-entry">
    <div class="type-tabs" id="qeTypeTabs"><button type="button" data-t="expense">Chi</button><button type="button" data-t="income">Thu</button></div>
    <div class="field"><label>Số tiền</label><div class="amount-row"><span id="qeCurrency">${esc(state.base)}</span><input id="qeAmount" name="amount" type="number" min="1" step="1" required autofocus placeholder="0" value="${esc(initialAmount)}"></div><div class="chip-row" id="qeAmountChips"></div></div>
    <label class="mini-label">Danh mục</label><div class="chip-row" id="qeCategoryChips"></div>
    <details class="mt-12"><summary class="details-summary">Thêm chi tiết</summary>
      <div class="form-grid mt-10">
        <div class="field"><label>Ngày</label><input name="transaction_date" type="date" value="${esc(defaults.transaction_date || selectedMonthDate())}" required></div>
        <div class="field"><label>Danh mục</label><select id="qeCategorySelect" name="category_id"></select></div>
        <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(defaults.note || '')}" placeholder="Tùy chọn"></div>
        <div class="field full hidden" id="qeExceptionalField"><label class="checkbox-label"><input type="checkbox" id="qeExceptional"> Chi tiêu bất thường (không tính vào ngân sách Chi cố định/Chi biến động tháng này)</label></div>
      </div>
    </details>
    <input type="hidden" id="qeType" name="transaction_type" value="${esc(type)}"><input type="hidden" id="qeCurrencyField" name="currency" value="${esc(state.base)}">
  </div>
  <div class="modal-actions"><button class="btn" type="button" ${act('closeModal')}>Hủy</button><button class="btn primary" type="submit">Lưu</button></div>`;

  const amount = $('#qeAmount'), currencyLabel = $('#qeCurrency'), currencyField = $('#qeCurrencyField');
  const catSel = $('#qeCategorySelect');
  function amountSuggestions() {
    const rows = [...(state.fullTransactions || [])].filter(t => t.transaction_type === type && n(t.amount) > 0 && (t.currency || state.base) === state.base && (!categoryId || t.category_id === categoryId))
      .sort((a, b) => String(b.transaction_date || '').localeCompare(String(a.transaction_date || '')));
    const uniq = []; rows.forEach(t => { const v = n(t.amount); if (v && !uniq.includes(v)) uniq.push(v); });
    const fallback = state.base === 'VND' ? [50000, 100000, 200000, 500000] : [500, 1000, 3000, 5000, 10000];
    return [...uniq, ...fallback].filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
  }
  function applyPlannedAmount() {
    if (amountTouched) return;
    const plan = categoryId ? n(F.categoryVersionAt(categoryId, selectedMonthDate())?.planned_amount) : 0;
    amount.value = plan > 0 ? plan : '';
  }
  function sync() {
    $('#qeType').value = type; currencyField.value = state.base; currencyLabel.textContent = state.base;
    $$('#qeTypeTabs button').forEach(b => b.classList.toggle('active', b.dataset.t === type));
    $('#qeExceptionalField').classList.toggle('hidden', type !== 'expense');
    const cats = F.orderedCategories(type);
    if (!cats.some(c => c.id === categoryId)) categoryId = cats[0]?.id || '';
    catSel.innerHTML = options(cats, categoryId);
    $('#qeCategoryChips').innerHTML = cats.slice(0, 8).map(c => `<button type="button" class="chip ${c.id === categoryId ? 'active' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('');
    $('#qeAmountChips').innerHTML = amountSuggestions().map(v => `<button type="button" class="chip" data-amt="${v}">${money(v, state.base)}</button>`).join('');
    applyPlannedAmount();
  }
  amount.addEventListener('input', () => { amountTouched = true; });
  $('#qeTypeTabs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; type = b.dataset.t; categoryId = readQuickPrefs()[type]?.category_id || ''; sync(); amount.focus(); });
  $('#qeCategoryChips').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (!b) return; categoryId = b.dataset.cat; catSel.value = categoryId; sync(); });
  $('#qeAmountChips').addEventListener('click', e => { const b = e.target.closest('[data-amt]'); if (!b) return; amount.value = b.dataset.amt; amountTouched = true; amount.focus(); });
  catSel.addEventListener('change', () => { categoryId = catSel.value; sync(); });
  sync();
  form.onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form).entries());
    const submitBtn = form.querySelector('[type=submit]');
    try {
      submitBtn.disabled = true;
      if (!n(fd.amount)) throw new Error('Hãy nhập số tiền.');
      if (!fd.category_id) throw new Error('Hãy chọn danh mục.');
      const saved = await api.core('save_transaction', { ...fd, id: null, fx_rate: 1, account_id: null, transfer_account_id: null });
      if (fd.transaction_type === 'expense' && $('#qeExceptional').checked) await api.exceptional('set', { id: saved.id, is_exceptional: true });
      writeQuickPref(fd.transaction_type, { category_id: fd.category_id || null });
      dlg.close(); await window.refresh(); toast('Đã lưu');
    } catch (err) { toast(err.message, true); } finally { submitBtn.disabled = false; }
  };
  if (!dlg.open) dlg.showModal();
  setTimeout(() => amount.focus(), 30);
}

function openTransactionEdit(id) {
  const t = (state.fullTransactions || []).find(x => x.id === id);
  if (!t) return toast('Không tìm thấy giao dịch.', true);
  if (!['income', 'expense'].includes(t.transaction_type)) return toast('Giao dịch này được quản lý ở cột Nợ.', true);
  const type = t.transaction_type;
  modal('Sửa giao dịch', `<div class="form-grid">
    <div class="field"><label>Loại</label><select name="transaction_type" id="etType"><option value="expense" ${type === 'expense' ? 'selected' : ''}>Chi tiêu</option><option value="income" ${type === 'income' ? 'selected' : ''}>Thu nhập</option></select></div>
    <div class="field"><label>Số tiền</label><input name="amount" type="number" min="1" step="1" value="${esc(t.amount)}" required></div>
    <div class="field"><label>Ngày</label><input name="transaction_date" type="date" value="${esc(t.transaction_date)}" required></div>
    <div class="field"><label>Danh mục</label><select name="category_id" id="etCat"></select></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(t.note || '')}"></div>
    <div class="field full${type === 'expense' ? '' : ' hidden'}" id="etExceptionalField"><label class="checkbox-label"><input type="checkbox" id="etExceptional" ${F.isExceptional(t) ? 'checked' : ''}> Chi tiêu bất thường (không tính vào ngân sách Chi cố định/Chi biến động tháng này)</label></div>
  </div>`, async fd => {
    await api.core('save_transaction', { ...fd, id, fx_rate: 1, currency: state.base, account_id: null, transfer_account_id: null });
    if (fd.transaction_type === 'expense') await api.exceptional('set', { id, is_exceptional: $('#etExceptional').checked });
  });
  const typeEl = $('#etType'), catEl = $('#etCat');
  const sync = () => { $('#etExceptionalField').classList.toggle('hidden', typeEl.value !== 'expense'); catEl.innerHTML = options(F.activeCategories(typeEl.value), t.category_id); };
  typeEl.onchange = sync; sync();
}
async function deleteTransaction(id) {
  if (!confirm('Xóa giao dịch này?')) return;
  try { await api.core('delete_transaction', { id }); await window.refresh(); toast('Đã xóa giao dịch'); }
  catch (e) { toast(e.message, true); }
}

// ---------------- Budget column settings (income / fixed / variable) ----------------
const COLUMN_META = {
  income: { title: 'Thu nhập', label: 'Thu nhập dự kiến / tháng', color: '#30d17f' },
  fixed: { title: 'Chi cố định', label: 'Kế hoạch / tháng', color: '#f5a623' },
  variable: { title: 'Chi biến động', label: 'Ngân sách / tháng', color: '#f25c66' }
};
function columnCategories(kind) {
  if (kind === 'income') return F.orderedCategories('income');
  const exp = F.orderedCategories('expense');
  return kind === 'fixed' ? exp.filter(c => c.cost_type === 'fixed') : exp.filter(c => c.cost_type !== 'fixed');
}
function columnRowHtml(kind, c = {}) {
  const m = COLUMN_META[kind];
  return `<div class="settings-row" data-col-row data-id="${esc(c.id || '')}" data-color="${esc(c.color || m.color)}">
    <div class="settings-row-inputs">
      <input data-col-name placeholder="Tên mục" value="${esc(c.name || '')}" required>
      <input data-col-amount type="number" min="0" step="1" placeholder="${esc(m.label)}" value="${esc(c.planned_amount ?? 0)}" required>
    </div>
    <div class="tx-actions">
      <button type="button" class="mini-btn" data-col-move="-1" title="Lên">↑</button>
      <button type="button" class="mini-btn" data-col-move="1" title="Xuống">↓</button>
      <button type="button" class="mini-btn" data-col-remove title="Ẩn từ tháng áp dụng">×</button>
    </div>
  </div>`;
}
function refreshColumnMoveButtons() {
  const rows = $$('#columnRows [data-col-row]');
  rows.forEach((row, i) => { row.querySelector('[data-col-move="-1"]').disabled = i === 0; row.querySelector('[data-col-move="1"]').disabled = i === rows.length - 1; });
}
function openColumnSettings(kind) {
  const m = COLUMN_META[kind], cats = columnCategories(kind);
  const dlg = $('#modal'), mb = $('#modalBody'), form = $('#modalForm');
  mb.innerHTML = `<div class="modal-head"><h3>Lập kế hoạch · ${esc(m.title)}</h3><button class="mini-btn" type="button" aria-label="Đóng" data-close>✕</button></div>
  <div class="modal-content">
    <p class="note">Đây là số tiền KẾ HOẠCH (ngân sách dự kiến), chưa phải giao dịch thực tế. Áp dụng từ tháng bạn chọn; các tháng trước giữ nguyên.</p>
    <div class="field"><label>Áp dụng từ tháng</label><input id="columnEffective" type="month" value="${esc(state.month)}" required></div>
    <div id="columnRows" class="stack mt-10">${cats.map(c => columnRowHtml(kind, c)).join('') || '<div class="empty compact">Chưa có mục nào.</div>'}</div>
    <button type="button" class="btn mt-10" id="columnAddRow">＋ Thêm mục mới</button>
  </div>
  <div class="modal-actions"><button class="btn" type="button" data-close>Hủy</button><button class="btn primary" type="submit">Lưu cả cột</button></div>`;
  refreshColumnMoveButtons();
  mb.querySelectorAll('[data-close]').forEach(b => b.onclick = () => dlg.close());
  $('#columnAddRow').onclick = () => {
    const box = $('#columnRows'); box.querySelector('.empty')?.remove();
    box.insertAdjacentHTML('beforeend', columnRowHtml(kind, {}));
    refreshColumnMoveButtons(); box.lastElementChild.querySelector('[data-col-name]').focus();
  };
  $('#columnRows').addEventListener('click', e => {
    const move = e.target.closest('[data-col-move]');
    if (move) { const row = move.closest('[data-col-row]'), delta = Number(move.dataset.colMove);
      if (delta < 0 && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
      else if (delta > 0 && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
      refreshColumnMoveButtons(); return; }
    const rm = e.target.closest('[data-col-remove]');
    if (rm) { const row = rm.closest('[data-col-row]'); const name = row.querySelector('[data-col-name]').value || 'mục này';
      if (row.dataset.id && !confirm(`Ẩn "${name}" từ ${fmtMonthKey($('#columnEffective').value)}? Các tháng trước vẫn giữ nguyên.`)) return;
      row.remove(); refreshColumnMoveButtons(); }
  });
  form.onsubmit = async e => {
    e.preventDefault();
    const submitBtn = form.querySelector('[type=submit]');
    try {
      submitBtn.disabled = true;
      const effective = $('#columnEffective').value || state.month;
      const rows = $$('#columnRows [data-col-row]').map(row => {
        const name = row.querySelector('[data-col-name]').value.trim();
        const planned_amount = Number(row.querySelector('[data-col-amount]').value || 0);
        if (!name) throw new Error('Tên mục không được để trống.');
        if (!Number.isFinite(planned_amount) || planned_amount < 0) throw new Error(`Số tiền của ${name} không hợp lệ.`);
        return { id: row.dataset.id || null, name, planned_amount, color: row.dataset.color || '#8b93a1' };
      });
      await api.budgetColumn(kind, effective, rows);
      dlg.close(); await window.refresh(); toast('Đã lưu kế hoạch; đây chưa phải giao dịch thực tế.');
    } catch (err) { toast(err.message, true); } finally { submitBtn.disabled = false; }
  };
  if (!dlg.open) dlg.showModal();
}

// ---------------- Tài sản: accounts (cash / bank / savings) ----------------
function openAccount(id = '') {
  const a = (state.accounts || []).find(x => x.id === id) || {};
  const types = [['cash', 'Tiền mặt'], ['bank', 'Ngân hàng'], ['savings', 'Tiết kiệm']];
  modal(id ? 'Sửa tài khoản' : 'Thêm tài khoản', `<div class="form-grid">
    <div class="field full"><label>Tên tài khoản</label><input name="name" value="${esc(a.name || '')}" required autofocus></div>
    <div class="field"><label>Loại</label><select name="account_type" id="acType">${types.map(([v, l]) => `<option value="${v}" ${(a.account_type || 'bank') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label>Tiền tệ</label><select name="currency"><option value="JPY" ${(a.currency || state.base) === 'JPY' ? 'selected' : ''}>JPY</option><option value="VND" ${(a.currency || state.base) === 'VND' ? 'selected' : ''}>VND</option></select></div>
    <div class="field full"><label>Số dư ban đầu</label><input name="opening_balance" type="number" step="1" value="${esc(a.opening_balance || 0)}"></div>
    <div class="field full hidden" id="acLiquidField"><label class="checkbox-label"><input type="checkbox" id="acLiquid" ${a.is_liquid === false ? '' : 'checked'}> Có thể rút ngay (tính vào Tiền thanh khoản)</label><small>Bỏ chọn cho tiết kiệm dài hạn/kỳ hạn — vẫn tính vào Tài sản ròng, không tính vào Tiền thanh khoản.</small></div>
  </div>`, fd => api.core('save_account', { ...fd, id: id || null, is_liquid: fd.account_type === 'savings' ? $('#acLiquid').checked : true, asset_type: null }));
  const typeEl = $('#acType');
  const sync = () => $('#acLiquidField').classList.toggle('hidden', typeEl.value !== 'savings');
  typeEl.onchange = sync; sync();
}
async function deleteAccount(id) {
  if (!confirm('Xóa tài khoản này? Chỉ xóa được khi chưa có lịch sử +/− tiền.')) return;
  try { await api.core('delete_account', { id }); closeModal(); await window.refresh(); toast('Đã xóa tài khoản'); } catch (e) { toast(e.message, true); }
}
// "⚙ Cài đặt" on the Tiền mặt & ngân hàng column header — the only place
// Thêm/Xóa a whole account live now; each row's own history modal only
// handles Tăng/Giảm/Sửa for that one account.
function openAccountColumnManager() {
  // All currencies here (not just base) — a foreign-currency account only
  // sits out of the main board/JPY totals, it still needs a Sửa/Xóa path.
  const items = F.activeAccounts().filter(a => ['cash', 'bank', 'savings'].includes(a.account_type));
  infoModal('Quản lý · Tiền mặt & ngân hàng', `
    <div class="list">${items.map(a => `<div class="tx"><div class="tx-main"><strong>${esc(a.name)}</strong><span>${esc(ACCOUNT_TYPE_LABEL[a.account_type] || a.account_type)} · ${money(F.accountBalance(a), a.currency)}</span></div>
      <div class="tx-actions"><button class="btn sm" ${act('reopenAfterModal', 'openAccount', a.id)}>Sửa</button><button class="btn sm" ${act('deleteAccount', a.id)}>Xóa</button></div></div>`).join('') || '<div class="empty compact">Chưa có tài khoản</div>'}</div>
    <div class="row mt-14 wrap"><button class="btn primary" ${act('reopenAfterModal', 'openAccount')}>＋ Thêm tài khoản</button></div>`);
}

// ---------------- Tài sản: manual +Tiền / −Tiền adjustments ----------------
function openAccountAdjustment(accountId, direction = 'increase', id = '') {
  const a = F.accountById(accountId); if (!a) return toast('Không tìm thấy tài khoản.', true);
  const existing = id ? (state.accountAdjustments || []).find(x => x.id === id) : null;
  const dir = existing?.direction || direction;
  modal(existing ? 'Sửa lần điều chỉnh' : (dir === 'increase' ? `＋ Tiền · ${a.name}` : `− Tiền · ${a.name}`), `<div class="form-grid">
    <div class="field full"><label>${esc(a.name)}</label><input value="${esc(money(F.accountBalance(a), a.currency))}" disabled><small>Số dư hiện tại</small></div>
    <div class="field"><label>Loại</label><select name="direction" id="adjDirection"><option value="increase" ${dir === 'increase' ? 'selected' : ''}>Tăng (＋)</option><option value="decrease" ${dir === 'decrease' ? 'selected' : ''}>Giảm (−)</option></select></div>
    <div class="field"><label>Số tiền</label><input name="amount" type="number" min="1" step="1" value="${esc(existing?.amount || '')}" required autofocus></div>
    <div class="field"><label>Ngày</label><input name="adjustment_date" type="date" value="${esc(existing?.adjustment_date || localToday())}" required></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(existing?.note || '')}" placeholder="Tùy chọn"></div>
  </div>`, fd => api.accountAdjustment('save', { ...fd, id: id || null, account_id: accountId, currency: a.currency || state.base }), existing ? 'Lưu' : 'Xác nhận');
}
async function deleteAccountAdjustment(id, accountId) {
  if (!confirm('Xóa lần điều chỉnh này? Số dư sẽ được tính lại.')) return;
  try {
    await api.accountAdjustment('delete', { id });
    await window.refresh();
    toast('Đã xóa');
    openAccountAdjustmentHistory(accountId);
  } catch (e) { toast(e.message, true); }
}
function accountAdjustmentRow(x) {
  return `<div class="tx"><div class="tx-main"><strong class="${x.direction === 'increase' ? 'green' : 'red'}">${x.direction === 'increase' ? '+' : '−'}${money(x.amount, x.currency)}</strong><span>${esc(String(x.adjustment_date).slice(0, 10))}${x.note ? ` · ${esc(x.note)}` : ''}</span></div>
    <div class="tx-actions"><button class="btn sm" ${act('reopenAfterModal', 'openAccountAdjustment', x.account_id, x.direction, x.id)}>Sửa</button><button class="btn sm" ${act('deleteAccountAdjustment', x.id, x.account_id)}>Xóa</button></div></div>`;
}
function openAccountAdjustmentHistory(accountId) {
  const a = F.accountById(accountId); if (!a) return toast('Không tìm thấy tài khoản.', true);
  const rows = (state.accountAdjustments || []).filter(x => x.account_id === accountId).sort((x, y) => String(y.adjustment_date).localeCompare(String(x.adjustment_date)));
  const months = [...new Set(rows.map(x => monthKey(x.adjustment_date)))].sort().reverse();
  infoModal(`Lịch sử điều chỉnh · ${esc(a.name)}`, `
    <div class="field"><label>Lọc theo tháng</label><select id="adjHistFilter"><option value="">Tất cả</option>${months.map(m => `<option value="${m}">${fmtMonthKey(m)}</option>`).join('')}</select></div>
    <div class="list mt-10" id="adjHistList">${rows.map(accountAdjustmentRow).join('') || '<div class="empty compact">Chưa có lần điều chỉnh nào.</div>'}</div>
    <div class="row mt-14 wrap">
      <button class="btn primary" ${act('reopenAfterModal', 'openAccountAdjustment', accountId, 'increase')}>＋ Tiền</button>
      <button class="btn" ${act('reopenAfterModal', 'openAccountAdjustment', accountId, 'decrease')}>− Tiền</button>
      <button class="btn" ${act('reopenAfterModal', 'openAccount', accountId)}>Sửa</button>
      <button class="btn" ${act('reopenAfterModal', 'openRecurringManager', 'account', accountId)}>🔁 Định kỳ</button>
    </div>`);
  $('#adjHistFilter').addEventListener('change', e => {
    const m = e.target.value;
    const filtered = m ? rows.filter(x => monthKey(x.adjustment_date) === m) : rows;
    $('#adjHistList').innerHTML = filtered.map(accountAdjustmentRow).join('') || '<div class="empty compact">Không có lần điều chỉnh nào trong tháng này.</div>';
  });
}

// ---------------- Khoản định kỳ (Tiền mặt & ngân hàng / Nợ phải trả) ----------------
// Named templates that repeat every month (lương, tiền nhà, wifi...), so
// they don't have to be typed in by hand each month. Confirming one writes
// a real account/debt adjustment (linked back via recurring_item_id) —
// nothing posts automatically; a pending item just waits until confirmed or
// explicitly skipped for that month. Mirrors NISA's "Kế hoạch góp tháng"
// pattern in Đầu tư, generalized to multiple named items per account/debt.
const RECURRING_STATUS_LABEL = { pending: 'Chưa xác nhận tháng này', confirmed: 'Đã xác nhận tháng này', skipped: 'Đã bỏ qua tháng này' };
function recurringTargetName(targetType, targetId) {
  return targetType === 'account' ? (F.accountById(targetId)?.name || '') : (F.debts().find(x => x.id === targetId)?.name || '');
}
function recurringItemRow(item) {
  const statusActions = item.status === 'pending'
    ? `<button class="btn sm primary" ${act('confirmRecurringItem', item.id)}>Xác nhận</button><button class="btn sm" ${act('skipRecurringItem', item.id)}>Bỏ qua tháng này</button>`
    : item.status === 'skipped' ? `<button class="btn sm" ${act('unskipRecurringItem', item.id)}>Hoàn tác bỏ qua</button>` : '';
  return `<div class="tx"><div class="tx-main">
      <strong class="${item.direction === 'increase' ? 'green' : 'red'}">${item.direction === 'increase' ? '+' : '−'}${money(item.amount, item.currency)}</strong>
      <span>${esc(item.name)} · Ngày ${item.day_of_month} hàng tháng · <b>${esc(RECURRING_STATUS_LABEL[item.status] || '')}</b>${item.note ? ` · ${esc(item.note)}` : ''}</span>
    </div>
    <div class="tx-actions wrap">
      ${statusActions}
      <button class="btn sm" ${act('reopenAfterModal', 'openRecurringItemForm', item.target_type, item.target_id, item.id)}>Sửa</button>
      <button class="btn sm" ${act('deleteRecurringItem', item.id, item.target_type, item.target_id)}>Xóa</button>
    </div></div>`;
}
function openRecurringManager(targetType, targetId) {
  const items = F.recurringItemsFor(targetType, targetId);
  infoModal(`Khoản định kỳ · ${esc(recurringTargetName(targetType, targetId))}`, `
    <p class="note">Xác nhận mỗi tháng để ghi nhận thật vào số dư — chưa xác nhận thì chưa tính. Bỏ qua nếu tháng này không có khoản đó.</p>
    <div class="list">${items.map(recurringItemRow).join('') || '<div class="empty compact">Chưa có khoản định kỳ nào.</div>'}</div>
    <button class="btn primary mt-14" ${act('reopenAfterModal', 'openRecurringItemForm', targetType, targetId)}>＋ Thêm khoản định kỳ</button>`);
}
function openRecurringItemForm(targetType, targetId, id = '') {
  const item = id ? (state.recurringAccountItems || []).find(x => x.id === id) : null;
  modal(item ? 'Sửa khoản định kỳ' : 'Thêm khoản định kỳ', `<div class="form-grid">
    <div class="field full"><label>Tên khoản</label><input name="name" value="${esc(item?.name || '')}" placeholder="VD: Lương, Tiền nhà, Wifi" required autofocus></div>
    <div class="field"><label>Loại</label><select name="direction"><option value="increase" ${(item?.direction || 'increase') === 'increase' ? 'selected' : ''}>Thu (＋)</option><option value="decrease" ${item?.direction === 'decrease' ? 'selected' : ''}>Chi (−)</option></select></div>
    <div class="field"><label>Số tiền / tháng</label><input name="amount" type="number" min="1" step="1" value="${esc(item?.amount || '')}" required></div>
    <div class="field"><label>Ngày trong tháng</label><input name="day_of_month" type="number" min="1" max="31" value="${esc(item?.day_of_month ?? 1)}" required></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(item?.note || '')}" placeholder="Tùy chọn"></div>
  </div>`, fd => api.recurringAccount('save', { ...fd, id: id || null, target_type: targetType, target_id: targetId }), item ? 'Lưu' : 'Tạo');
}
async function deleteRecurringItem(id, targetType, targetId) {
  if (!confirm('Xóa khoản định kỳ này? Các lần đã xác nhận trước đó vẫn giữ nguyên trong lịch sử.')) return;
  try { await api.recurringAccount('delete', { id }); await window.refresh(); toast('Đã xóa khoản định kỳ'); openRecurringManager(targetType, targetId); } catch (e) { toast(e.message, true); }
}
async function confirmRecurringItem(id) {
  const item = (state.recurringAccountItems || []).find(x => x.id === id);
  try { await api.recurringAccount('confirm', { id, month: monthDate(state.month) }); await window.refresh(); toast('Đã xác nhận'); if (item) openRecurringManager(item.target_type, item.target_id); }
  catch (e) { toast(e.message, true); }
}
async function skipRecurringItem(id) {
  const item = (state.recurringAccountItems || []).find(x => x.id === id);
  try { await api.recurringAccount('skip', { id, month: monthDate(state.month) }); await window.refresh(); toast('Đã bỏ qua tháng này'); if (item) openRecurringManager(item.target_type, item.target_id); }
  catch (e) { toast(e.message, true); }
}
async function unskipRecurringItem(id) {
  const item = (state.recurringAccountItems || []).find(x => x.id === id);
  try { await api.recurringAccount('unskip', { id, month: monthDate(state.month) }); await window.refresh(); toast('Đã hoàn tác'); if (item) openRecurringManager(item.target_type, item.target_id); }
  catch (e) { toast(e.message, true); }
}

// ---------------- Đầu tư: NISA / Chứng khoán / Tiết kiệm sinh lời / Khác ----------------
const INVESTMENT_KIND_LABEL = { nisa: 'NISA', securities: 'Chứng khoán', savings_interest: 'Tiết kiệm sinh lời', other: 'Khác (Vàng, Quỹ, tự đặt tên...)' };
const OTHER_ASSET_TYPE_PRESETS = ['Vàng', 'Quỹ', 'Crypto', 'Bất động sản'];
const NISA_FRAME_LABEL = { tsumitate: 'つみたて投資枠 · Khung tích lũy', growth: '成長投資枠 · Khung tăng trưởng', both: 'Cả hai khung' };
const INTEREST_METHOD_LABEL = { monthly: 'Hàng tháng', quarterly: 'Hàng quý', maturity: 'Cuối kỳ', compound: 'Lãi nhập gốc', simple: 'Lãi không nhập gốc' };

function investmentFormFieldGroups(inv) {
  return `
    <div class="field-group" data-kind-group="other">
      <div class="field"><label>Loại tài sản</label><select name="asset_type_preset" id="invAssetPreset">${OTHER_ASSET_TYPE_PRESETS.map(t => `<option value="${esc(t)}" ${inv?.asset_type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}<option value="__custom" ${inv && !OTHER_ASSET_TYPE_PRESETS.includes(inv.asset_type) ? 'selected' : ''}>Loại khác…</option></select></div>
      <div class="field hidden" id="invAssetCustomField"><label>Tên loại tự đặt</label><input name="asset_type_custom" value="${esc(inv && !OTHER_ASSET_TYPE_PRESETS.includes(inv.asset_type) ? (inv?.asset_type || '') : '')}"></div>
      <div class="field"><label>Vốn ban đầu</label><input name="initial_capital" type="number" min="0" step="1" value="${esc(inv?.initial_capital ?? 0)}"></div>
    </div>
    <div class="field-group hidden" data-kind-group="nisa">
      <div class="field"><label>Công ty chứng khoán</label><input name="broker_name" value="${esc(inv?.broker_name || '')}"></div>
      <div class="field"><label>Loại khung NISA</label><select name="nisa_frame">${Object.entries(NISA_FRAME_LABEL).map(([v, l]) => `<option value="${v}" ${inv?.nisa_frame === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label>Hạn mức hàng năm (tham khảo)</label><input name="nisa_annual_limit" type="number" min="0" step="1" value="${esc(inv?.nisa_annual_limit ?? '')}" placeholder="VD: 3,600,000"></div>
      <div class="field"><label>Vốn ban đầu</label><input name="initial_capital" type="number" min="0" step="1" value="${esc(inv?.initial_capital ?? 0)}"></div>
    </div>
    <div class="field-group hidden" data-kind-group="securities">
      <div class="field"><label>Công ty chứng khoán</label><input name="broker_name" value="${esc(inv?.broker_name || '')}"></div>
      <div class="field"><label>Mã chứng khoán</label><input name="ticker" value="${esc(inv?.ticker || '')}"></div>
      <div class="field"><label>Thị trường</label><input name="market" value="${esc(inv?.market || '')}" placeholder="VD: TSE, NASDAQ"></div>
      <small class="muted full">Số lượng / giá vốn được tính tự động từ lịch sử Mua/Bán — không nhập tay ở đây.</small>
    </div>
    <div class="field-group hidden" data-kind-group="savings_interest">
      <div class="field"><label>Tên ngân hàng</label><input name="bank_name" value="${esc(inv?.bank_name || '')}"></div>
      <div class="field"><label>Lãi suất năm (%)</label><input name="interest_rate_annual" type="number" min="0" step="0.01" value="${esc(inv?.interest_rate_annual ?? '')}"></div>
      <div class="field"><label>Cách trả lãi</label><select name="interest_payment_method">${Object.entries(INTEREST_METHOD_LABEL).map(([v, l]) => `<option value="${v}" ${inv?.interest_payment_method === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label>Ngày đáo hạn</label><input name="term_end_date" type="date" value="${esc(inv?.term_end_date || '')}"></div>
      <div class="field"><label>Tiền gốc ban đầu</label><input name="initial_capital" type="number" min="0" step="1" value="${esc(inv?.initial_capital ?? 0)}"></div>
    </div>
    <div class="field-group hidden" data-kind-group="plan">
      <p class="note full">Kế hoạch góp cố định hàng tháng (tùy chọn) — chỉ là kế hoạch, không tự trừ tài khoản; mỗi tháng cần bấm "Xác nhận đã góp" mới tính vào vốn thực tế.</p>
      <div class="field"><label>Số tiền mỗi tháng</label><input name="monthly_amount" type="number" min="0" step="1" value="${esc(inv?.monthly_amount ?? '')}"></div>
      <div class="field"><label>Ngày góp hàng tháng</label><input name="monthly_day" type="number" min="1" max="31" value="${esc(inv?.monthly_day ?? '')}"></div>
      <div class="field"><label>Tháng bắt đầu</label><input name="plan_start_month" type="month" value="${esc(monthKey(inv?.plan_start_month) || '')}"></div>
      <div class="field"><label>Tháng kết thúc (bỏ trống = không giới hạn)</label><input name="plan_end_month" type="month" value="${esc(monthKey(inv?.plan_end_month) || '')}"></div>
      <div class="field full"><label class="checkbox-label"><input type="checkbox" id="invPlanPaused" ${inv?.plan_paused ? 'checked' : ''}> Tạm dừng kế hoạch góp</label></div>
    </div>
    <div class="field-group" data-kind-group="always">
      <p class="note full">Tăng trưởng kỳ vọng chỉ là MÔ PHỎNG — hiển thị riêng, không cộng vào giá trị/lãi-lỗ thực tế.</p>
      <div class="field"><label>Tỷ lệ tăng trưởng kỳ vọng (%)</label><input name="expected_return_rate" type="number" step="0.01" value="${esc(inv?.expected_return_rate ?? '')}"></div>
      <div class="field"><label>Theo</label><select name="expected_return_period"><option value="annual" ${(inv?.expected_return_period || 'annual') === 'annual' ? 'selected' : ''}>Năm</option><option value="monthly" ${inv?.expected_return_period === 'monthly' ? 'selected' : ''}>Tháng</option></select></div>
      <div class="field"><label>Chế độ tái đầu tư</label><select name="reinvest_mode"><option value="none" ${(inv?.reinvest_mode || 'none') === 'none' ? 'selected' : ''}>Không tái đầu tư</option><option value="compound" ${inv?.reinvest_mode === 'compound' ? 'selected' : ''}>Tăng trưởng kép hàng tháng</option><option value="dividend" ${inv?.reinvest_mode === 'dividend' ? 'selected' : ''}>Tái đầu tư cổ tức</option></select></div>
    </div>`;
}
function openInvestmentNew(id = '') {
  const inv = id ? F.investments().find(x => x.id === id) : null;
  const kind = inv?.kind || 'other';
  modal(id ? 'Sửa khoản đầu tư' : 'Đầu tư mới', `<div class="form-grid">
    <div class="field full"><label>Tên</label><input name="name" value="${esc(inv?.name || '')}" placeholder="VD: NISA Rakuten" required autofocus></div>
    <div class="field"><label>Loại đầu tư</label><select name="kind" id="invKind">${Object.entries(INVESTMENT_KIND_LABEL).map(([v, l]) => `<option value="${v}" ${kind === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
    <div class="field"><label>Tiền tệ</label><select name="currency"><option value="JPY" ${(inv?.currency || state.base) === 'JPY' ? 'selected' : ''}>JPY</option><option value="VND" ${(inv?.currency || state.base) === 'VND' ? 'selected' : ''}>VND</option></select></div>
    <div class="field"><label>Ngày bắt đầu</label><input name="start_date" type="date" value="${esc(inv?.start_date || '')}"></div>
  </div>
  <div class="form-grid mt-10">${investmentFormFieldGroups(inv)}</div>
  <div class="field full mt-10"><label>Ghi chú</label><input name="note" value="${esc(inv?.note || '')}" placeholder="Tùy chọn"></div>`,
  fd => api.investment('save', {
    id: id || null, name: fd.name, kind: fd.kind, currency: fd.currency, start_date: fd.start_date || null,
    initial_capital: fd.initial_capital || 0, note: fd.note || '', parent_investment_id: inv?.parent_investment_id || null,
    asset_type: fd.kind === 'other' ? (fd.asset_type_preset === '__custom' ? (fd.asset_type_custom || '') : fd.asset_type_preset) : null,
    broker_name: fd.broker_name || '', nisa_frame: fd.nisa_frame || null, nisa_annual_limit: fd.nisa_annual_limit || null,
    ticker: fd.ticker || '', market: fd.market || '',
    bank_name: fd.bank_name || '', interest_rate_annual: fd.interest_rate_annual || null, interest_payment_method: fd.interest_payment_method || null, term_end_date: fd.term_end_date || null,
    monthly_amount: fd.monthly_amount || null, monthly_day: fd.monthly_day || null,
    plan_start_month: fd.plan_start_month ? `${fd.plan_start_month}-01` : null, plan_end_month: fd.plan_end_month ? `${fd.plan_end_month}-01` : null,
    plan_paused: $('#invPlanPaused').checked,
    expected_return_rate: fd.expected_return_rate || null, expected_return_period: fd.expected_return_period, reinvest_mode: fd.reinvest_mode
  }), id ? 'Lưu' : 'Tạo');
  const kindEl = $('#invKind'), presetEl = $('#invAssetPreset');
  const sync = () => {
    const k = kindEl.value;
    $$('[data-kind-group]').forEach(g => g.classList.toggle('hidden', !['always', k, (k === 'nisa' || k === 'savings_interest') ? 'plan' : null].includes(g.dataset.kindGroup)));
  };
  const syncPreset = () => $('#invAssetCustomField').classList.toggle('hidden', presetEl.value !== '__custom');
  kindEl.onchange = sync; presetEl.onchange = syncPreset; sync(); syncPreset();
}
async function deleteInvestment(id) {
  if (!confirm('Xóa khoản đầu tư này? Lịch sử vẫn được giữ lại nhưng khoản này sẽ không còn hiển thị.')) return;
  try { await api.investment('delete', { id }); closeModal(); await window.refresh(); toast('Đã xóa khoản đầu tư'); } catch (e) { toast(e.message, true); }
}
// "⚙ Cài đặt" on the Đầu tư column header (Tài sản page) — top-level
// investments only (NISA quỹ/ETF con vẫn quản lý trong card NISA riêng).
function openInvestmentColumnManager() {
  const items = F.investments().filter(inv => (inv.currency || state.base) === state.base && !inv.parent_investment_id);
  infoModal('Quản lý · Đầu tư', `
    <div class="list">${items.map(inv => `<div class="tx"><div class="tx-main"><strong>${esc(inv.name)}</strong><span>${esc(INVESTMENT_KIND_LABEL[inv.kind] || '')} · ${money(F.investmentCurrentValue(inv), inv.currency)}</span></div>
      <div class="tx-actions"><button class="btn sm" ${act('reopenAfterModal', 'openInvestmentNew', inv.id)}>Sửa</button><button class="btn sm" ${act('deleteInvestment', inv.id)}>Xóa</button></div></div>`).join('') || '<div class="empty compact">Chưa có khoản đầu tư</div>'}</div>
    <div class="row mt-14 wrap"><button class="btn primary" ${act('reopenAfterModal', 'openInvestmentNew')}>＋ Thêm khoản đầu tư</button></div>`);
}

// ---- Quỹ/ETF bên trong một tài khoản NISA — một khoản đầu tư kind='securities'
// bình thường, chỉ khác là có parent_investment_id trỏ về NISA cha, nên dùng
// lại nguyên cơ chế Mua/Bán/giá vốn TB của Chứng khoán độc lập. Số lượng/giá
// vốn không nhập tay — chỉ tạo "vỏ" quỹ ở đây, sau đó bấm "Mua" để ghi nhận.
function openNisaHolding(nisaId, id = '') {
  const nisa = F.investments().find(x => x.id === nisaId); if (!nisa) return toast('Không tìm thấy tài khoản NISA.', true);
  const h = id ? F.nisaHoldings(nisaId).find(x => x.id === id) : null;
  modal(id ? 'Sửa quỹ/ETF' : `＋ Quỹ/ETF · ${esc(nisa.name)}`, `<div class="form-grid">
    <div class="field full"><label>Tên quỹ/ETF/cổ phiếu</label><input name="name" value="${esc(h?.name || '')}" placeholder="VD: eMAXIS Slim toàn cầu" required autofocus></div>
    <div class="field"><label>Mã chứng khoán</label><input name="ticker" value="${esc(h?.ticker || '')}"></div>
    <div class="field"><label>Thị trường</label><input name="market" value="${esc(h?.market || '')}" placeholder="VD: TSE, NASDAQ"></div>
    <div class="field"><label>Tiền tệ</label><select name="currency"><option value="JPY" ${(h?.currency || nisa.currency || state.base) === 'JPY' ? 'selected' : ''}>JPY</option><option value="VND" ${(h?.currency || nisa.currency || state.base) === 'VND' ? 'selected' : ''}>VND</option></select></div>
    <small class="muted full">Số lượng / giá vốn tính tự động từ lịch sử Mua/Bán sau khi tạo — không nhập tay ở đây.</small>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(h?.note || '')}" placeholder="Tùy chọn"></div>
  </div>`, fd => api.investment('save', {
    id: id || null, name: fd.name, kind: 'securities', currency: fd.currency, note: fd.note || '',
    ticker: fd.ticker || '', market: fd.market || '', parent_investment_id: nisaId
  }), id ? 'Lưu' : 'Tạo');
}

// ---- Generic events (contribution / withdrawal / valuation / interest) — NISA, Tiết kiệm sinh lời, Khác ----
const INVESTMENT_EVENT_LABEL = {
  contribution: 'Thêm vốn', withdrawal: 'Rút vốn', valuation: 'Cập nhật giá trị', interest: 'Nhận lãi',
  buy: 'Mua', sell: 'Bán', dividend: 'Nhận cổ tức', fee: 'Cộng phí', plan_skip: 'Bỏ qua tháng', plan_confirm: 'Xác nhận đã góp'
};
function openInvestmentEvent(investmentId, eventType, id = '') {
  const inv = F.investments().find(x => x.id === investmentId); if (!inv) return toast('Không tìm thấy khoản đầu tư.', true);
  const events = (state.investmentEvents || {})[investmentId] || [];
  const existing = id ? events.find(x => x.id === id) : null;
  const type = existing?.event_type || eventType;
  const currentValue = F.investmentCurrentValue(inv);
  const defaultAmount = existing ? existing.amount : (type === 'valuation' ? currentValue : (type === 'contribution' && inv.monthly_amount ? inv.monthly_amount : ''));
  modal(existing ? 'Sửa lần ghi nhận' : `${esc(INVESTMENT_EVENT_LABEL[type])} · ${esc(inv.name)}`, `<div class="form-grid">
    <div class="field full"><label>${esc(inv.name)}</label><input value="${esc(money(currentValue, inv.currency))}" disabled><small>Giá trị hiện tại</small></div>
    <div class="field"><label>${type === 'valuation' ? 'Giá trị hiện tại mới' : 'Số tiền'}</label><input name="amount" type="number" min="0" step="1" value="${esc(defaultAmount)}" required autofocus></div>
    <div class="field"><label>Ngày</label><input name="event_date" type="date" value="${esc(existing?.event_date || localToday())}" required></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(existing?.note || '')}" placeholder="Tùy chọn"></div>
    <input type="hidden" name="event_type" value="${esc(type)}">
  </div>`, fd => api.investment('save_event', { ...fd, id: id || null, investment_id: investmentId }), existing ? 'Lưu' : 'Xác nhận');
}
async function deleteInvestmentEvent(id, investmentId) {
  if (!confirm('Xóa lần ghi nhận này?')) return;
  try {
    await api.investment('delete_event', { id });
    await window.refresh();
    toast('Đã xóa');
    openInvestmentEventHistory(investmentId);
  } catch (e) { toast(e.message, true); }
}

// ---- Chứng khoán: Mua/Bán (số lượng + giá), Nhận cổ tức, Cộng phí, Cập nhật giá ----
function openSecurityTrade(investmentId, eventType, id = '') {
  const inv = F.investments().find(x => x.id === investmentId); if (!inv) return toast('Không tìm thấy khoản đầu tư.', true);
  const events = (state.investmentEvents || {})[investmentId] || [];
  const existing = id ? events.find(x => x.id === id) : null;
  const type = existing?.event_type || eventType;
  if (type === 'buy' || type === 'sell') {
    modal(existing ? `Sửa lệnh ${type === 'buy' ? 'mua' : 'bán'}` : `${type === 'buy' ? 'Mua' : 'Bán'} · ${esc(inv.name)}`, `<div class="form-grid">
      <div class="field full"><label>${esc(inv.name)}</label><input value="Đang giữ ${esc(String(inv.quantity))} · Giá vốn TB ${esc(money(inv.avg_cost, inv.currency))}" disabled></div>
      <div class="field"><label>Số lượng</label><input name="quantity" type="number" min="0.0001" step="any" value="${esc(existing?.quantity || '')}" required autofocus></div>
      <div class="field"><label>Giá / đơn vị</label><input name="price" type="number" min="0" step="any" value="${esc(existing?.price || inv.current_price || '')}" required></div>
      <div class="field"><label>Ngày</label><input name="event_date" type="date" value="${esc(existing?.event_date || localToday())}" required></div>
      <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(existing?.note || '')}" placeholder="Tùy chọn"></div>
      <input type="hidden" name="event_type" value="${esc(type)}">
    </div>`, fd => api.investment('save_event', { ...fd, id: id || null, investment_id: investmentId }), existing ? 'Lưu' : (type === 'buy' ? 'Xác nhận mua' : 'Xác nhận bán'));
  } else if (type === 'valuation') {
    modal(existing ? 'Sửa giá cập nhật' : `Cập nhật giá · ${esc(inv.name)}`, `<div class="form-grid">
      <div class="field full"><label>${esc(inv.name)}</label><input value="Đang giữ ${esc(String(inv.quantity))}" disabled></div>
      <div class="field"><label>Giá hiện tại / đơn vị</label><input name="price" type="number" min="0" step="any" value="${esc(existing?.price ?? inv.current_price ?? '')}" required autofocus></div>
      <div class="field"><label>Ngày</label><input name="event_date" type="date" value="${esc(existing?.event_date || localToday())}" required></div>
      <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(existing?.note || '')}" placeholder="Tùy chọn"></div>
      <input type="hidden" name="event_type" value="valuation">
    </div>`, fd => api.investment('save_event', { ...fd, id: id || null, investment_id: investmentId }), existing ? 'Lưu' : 'Cập nhật');
  } else {
    modal(existing ? 'Sửa lần ghi nhận' : `${esc(INVESTMENT_EVENT_LABEL[type])} · ${esc(inv.name)}`, `<div class="form-grid">
      <div class="field"><label>Số tiền</label><input name="amount" type="number" min="0" step="1" value="${esc(existing?.amount || '')}" required autofocus></div>
      <div class="field"><label>Ngày</label><input name="event_date" type="date" value="${esc(existing?.event_date || localToday())}" required></div>
      <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(existing?.note || '')}" placeholder="Tùy chọn"></div>
      <input type="hidden" name="event_type" value="${esc(type)}">
    </div>`, fd => api.investment('save_event', { ...fd, id: id || null, investment_id: investmentId }), existing ? 'Lưu' : 'Xác nhận');
  }
}

function investmentEventRow(x, investmentId, isSecurities) {
  const openFn = isSecurities ? 'openSecurityTrade' : 'openInvestmentEvent';
  let label, amountText, cls;
  if (x.event_type === 'buy' || x.event_type === 'sell') {
    label = `${INVESTMENT_EVENT_LABEL[x.event_type]} ${x.quantity} @ ${money(x.price)}`; amountText = money(n(x.quantity) * n(x.price)); cls = x.event_type === 'buy' ? 'green' : 'red';
  } else if (x.event_type === 'valuation') {
    label = INVESTMENT_EVENT_LABEL[x.event_type]; amountText = isSecurities ? money(x.price) + '/đv' : money(x.amount); cls = '';
  } else {
    const sign = x.event_type === 'withdrawal' || x.event_type === 'sell' || x.event_type === 'fee' ? '−' : '+';
    label = INVESTMENT_EVENT_LABEL[x.event_type] || x.event_type; amountText = `${sign}${money(x.amount)}`;
    cls = x.event_type === 'withdrawal' || x.event_type === 'fee' ? 'red' : 'green';
  }
  return `<div class="tx"><div class="tx-main"><strong class="${cls}">${esc(label)}</strong><span>${esc(String(x.event_date).slice(0, 10))} · ${amountText}${x.note ? ` · ${esc(x.note)}` : ''}</span></div>
    <div class="tx-actions"><button class="btn sm" ${act(openFn, investmentId, x.event_type, x.id)}>Sửa</button><button class="btn sm" ${act('deleteInvestmentEvent', x.id, investmentId)}>Xóa</button></div></div>`;
}
function openInvestmentEventHistory(investmentId) {
  const inv = F.investments().find(x => x.id === investmentId); if (!inv) return toast('Không tìm thấy khoản đầu tư.', true);
  const isSecurities = inv.kind === 'securities';
  const rows = ((state.investmentEvents || {})[investmentId] || []).slice().sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)));
  const actions = isSecurities
    ? `<button class="btn primary" ${act('reopenAfterModal', 'openSecurityTrade', investmentId, 'buy')}>Mua</button>
       <button class="btn" ${act('reopenAfterModal', 'openSecurityTrade', investmentId, 'sell')}>Bán</button>
       <button class="btn" ${act('reopenAfterModal', 'openSecurityTrade', investmentId, 'dividend')}>Nhận cổ tức</button>
       <button class="btn" ${act('reopenAfterModal', 'openSecurityTrade', investmentId, 'fee')}>Cộng phí</button>
       <button class="btn" ${act('reopenAfterModal', 'openSecurityTrade', investmentId, 'valuation')}>Cập nhật giá</button>`
    : `<button class="btn primary" ${act('reopenAfterModal', 'openInvestmentEvent', investmentId, 'contribution')}>Thêm vốn</button>
       <button class="btn" ${act('reopenAfterModal', 'openInvestmentEvent', investmentId, 'withdrawal')}>Rút vốn</button>
       ${inv.kind === 'savings_interest' ? `<button class="btn" ${act('reopenAfterModal', 'openInvestmentEvent', investmentId, 'interest')}>Nhận lãi</button>` : ''}
       <button class="btn" ${act('reopenAfterModal', 'openInvestmentEvent', investmentId, 'valuation')}>Cập nhật giá trị</button>`;
  infoModal(`Lịch sử · ${esc(inv.name)}`, `
    <div class="list">${rows.map(x => investmentEventRow(x, investmentId, isSecurities)).join('') || '<div class="empty compact">Chưa có lịch sử nào.</div>'}</div>
    <div class="row mt-14 wrap">${actions}
      <button class="btn" ${act('reopenAfterModal', 'openInvestmentNew', investmentId)}>Sửa</button>
    </div>`);
}

// ---- Kế hoạch góp hàng tháng (NISA + Tiết kiệm sinh lời) ----
function openInvestmentPlanConfirm(investmentId, month) {
  const inv = F.investments().find(x => x.id === investmentId); if (!inv) return toast('Không tìm thấy khoản đầu tư.', true);
  const day = String(inv.monthly_day || 1).padStart(2, '0');
  modal(`Xác nhận đã góp · ${esc(fmtMonthKey(month))}`, `<div class="form-grid">
    <div class="field"><label>Số tiền</label><input name="amount" type="number" min="0" step="1" value="${esc(inv.monthly_amount || 0)}" required autofocus></div>
    <div class="field"><label>Ngày góp</label><input name="event_date" type="date" value="${esc(month)}-${day}" required></div>
    <div class="field full"><label>Ghi chú</label><input name="note" placeholder="Tùy chọn"></div>
  </div>`, fd => api.investment('save_event', { investment_id: investmentId, event_type: 'contribution', amount: fd.amount, event_date: fd.event_date, note: fd.note || '' }), 'Xác nhận đã góp');
}
async function skipInvestmentPlan(investmentId, month) {
  if (!confirm(`Bỏ qua kế hoạch góp tháng ${fmtMonthKey(month)}?`)) return;
  try {
    await api.investment('save_event', { investment_id: investmentId, event_type: 'plan_skip', amount: 0, event_date: `${month}-01` });
    await window.refresh();
    toast('Đã bỏ qua tháng này');
  } catch (e) { toast(e.message, true); }
}

// ---------------- Nợ phải trả / Khoản phải thu (manual ledger, lives on Tài sản only) ----------------
// "Nợ phải trả" (payable, direction='payable') and "Khoản phải thu"
// (receivable, direction='receivable') share the same table/adjustment
// mechanics, but the wording must not be the same: a payable is money the
// household OWES, a receivable is money owed TO the household (someone
// else's loan, a refund still coming, etc.) — calling both "dư nợ" (debt
// balance) on a receivable reads backwards. Every label below picks its
// wording from the debt's own direction instead of one generic string.
const DEBT_DIR_LABEL = {
  payable: { increase: 'Tăng dư nợ', decrease: 'Giảm dư nợ', balance: 'Dư nợ hiện tại', opening: 'Dư nợ ban đầu', counterparty: 'Chủ nợ / người liên quan' },
  receivable: { increase: 'Cho vay/ghi nhận thêm', decrease: 'Thu hồi nợ', balance: 'Số tiền còn phải thu hiện tại', opening: 'Số tiền cho vay/phải thu ban đầu', counterparty: 'Người vay / liên quan' }
};
function openDebt(id = '', direction = 'payable') {
  const d = id ? F.debts().find(x => x.id === id) : null;
  const dir = d?.direction || direction;
  modal(id ? 'Sửa khoản nợ' : (dir === 'payable' ? 'Thêm khoản nợ phải trả' : 'Thêm khoản phải thu'), `<div class="form-grid">
    <div class="field full"><label>Tên khoản nợ</label><input name="name" value="${esc(d?.name || '')}" placeholder="VD: Vay mua xe" required autofocus></div>
    <div class="field"><label>Loại</label><select name="direction" id="debtDirection"><option value="payable" ${dir === 'payable' ? 'selected' : ''}>Nợ phải trả</option><option value="receivable" ${dir === 'receivable' ? 'selected' : ''}>Khoản phải thu</option></select></div>
    <div class="field"><label id="debtCounterpartyLabel">${esc(DEBT_DIR_LABEL[dir].counterparty)}</label><input name="counterparty" value="${esc(d?.counterparty || '')}"></div>
    <div class="field"><label>Tiền tệ</label><select name="currency"><option value="JPY" ${(d?.currency || state.base) === 'JPY' ? 'selected' : ''}>JPY</option><option value="VND" ${(d?.currency || state.base) === 'VND' ? 'selected' : ''}>VND</option></select></div>
    <div class="field"><label id="debtOpeningLabel">${esc(DEBT_DIR_LABEL[dir].opening)}</label><input name="opening_amount" type="number" min="0" step="1" value="${esc(d?.opening_amount ?? 0)}"></div>
    <div class="field"><label>Ngày bắt đầu</label><input name="start_date" type="date" value="${esc(d?.start_date || '')}"></div>
    <div class="field"><label>Ngày đáo hạn</label><input name="due_date" type="date" value="${esc(d?.due_date || '')}"></div>
    <div class="field"><label>Lãi suất (%/năm, nếu có)</label><input name="interest_rate" type="number" min="0" step="0.01" value="${esc(d?.interest_rate ?? '')}"></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(d?.note || '')}" placeholder="Tùy chọn"></div>
  </div>`, fd => api.debtLedger('save', { ...fd, id: id || null }), id ? 'Lưu' : 'Tạo');
  const dirEl = $('#debtDirection');
  dirEl.onchange = () => {
    const lbl = DEBT_DIR_LABEL[dirEl.value];
    $('#debtCounterpartyLabel').textContent = lbl.counterparty;
    $('#debtOpeningLabel').textContent = lbl.opening;
  };
}
async function deleteDebt(id) {
  if (!confirm('Xóa khoản nợ này? Chỉ xóa được khi chưa có lịch sử điều chỉnh.')) return;
  try { await api.debtLedger('delete', { id }); closeModal(); await window.refresh(); toast('Đã xóa khoản nợ'); } catch (e) { toast(e.message, true); }
}
// "⚙ Cài đặt" on the Khoản phải thu / Nợ phải trả column headers — shared by
// both directions, same as their row source (F.receivables()/F.payables()).
function openDebtColumnManager(direction) {
  const title = direction === 'receivable' ? 'Khoản phải thu' : 'Nợ phải trả';
  const items = direction === 'receivable' ? F.receivables() : F.payables();
  infoModal(`Quản lý · ${esc(title)}`, `
    <div class="list">${items.map(d => {
      const meta = [d.counterparty ? esc(d.counterparty) : '', d.due_date ? `<span class="due-date-tag">Đáo hạn ${esc(String(d.due_date).slice(0, 10))}</span>` : ''].filter(Boolean).join(' · ');
      return `<div class="tx"><div class="tx-main"><strong>${esc(d.name)}</strong><span>${meta}${meta ? ' · ' : ''}${money(F.debtBalance(d), d.currency)}</span></div>
      <div class="tx-actions"><button class="btn sm" ${act('reopenAfterModal', 'openDebt', d.id, d.direction)}>Sửa</button><button class="btn sm" ${act('deleteDebt', d.id)}>Xóa</button></div></div>`;
    }).join('') || `<div class="empty compact">Chưa có ${esc(direction === 'receivable' ? 'khoản phải thu' : 'khoản nợ')}</div>`}</div>
    <div class="row mt-14 wrap"><button class="btn primary" ${act('reopenAfterModal', 'openDebt', '', direction)}>＋ Thêm</button></div>`);
}
function openDebtAdjustment(debtId, direction = 'increase', id = '') {
  const d = F.debts().find(x => x.id === debtId); if (!d) return toast('Không tìm thấy khoản nợ.', true);
  const existing = id ? F.debtAdjustmentsFor(d).find(x => x.id === id) : null;
  const dir = existing?.direction || direction;
  const lbl = DEBT_DIR_LABEL[d.direction];
  modal(existing ? 'Sửa lần điều chỉnh' : `${dir === 'increase' ? lbl.increase : lbl.decrease} · ${d.name}`, `<div class="form-grid">
    <div class="field full"><label>${esc(d.name)}</label><input value="${esc(money(F.debtBalance(d), d.currency))}" disabled><small>${esc(lbl.balance)}</small></div>
    <div class="field"><label>Loại</label><select name="direction" id="debtAdjDirection"><option value="increase" ${dir === 'increase' ? 'selected' : ''}>${esc(lbl.increase)}</option><option value="decrease" ${dir === 'decrease' ? 'selected' : ''}>${esc(lbl.decrease)}</option></select></div>
    <div class="field"><label>Số tiền</label><input name="amount" type="number" min="1" step="1" value="${esc(existing?.amount || '')}" required autofocus></div>
    <div class="field"><label>Ngày</label><input name="adjustment_date" type="date" value="${esc(existing?.adjustment_date || localToday())}" required></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(existing?.note || '')}" placeholder="Tùy chọn"></div>
  </div>`, fd => api.debtLedger('save_adjustment', { ...fd, id: id || null, debt_id: debtId }), existing ? 'Lưu' : 'Xác nhận');
}
async function deleteDebtAdjustment(id, debtId) {
  if (!confirm('Xóa lần điều chỉnh này? Dư nợ sẽ được tính lại.')) return;
  try {
    await api.debtLedger('delete_adjustment', { id });
    await window.refresh();
    toast('Đã xóa');
    openDebtAdjustmentHistory(debtId);
  } catch (e) { toast(e.message, true); }
}
function debtAdjustmentRow(x) {
  // Red/green only makes sense for a payable (owing more is bad, paying it
  // off is good) — a receivable growing or being collected is never a loss
  // to the household either way, so it stays neutral instead of flipping
  // the same red/green to mean the opposite thing.
  const debt = F.debts().find(d => d.id === x.debt_id);
  const cls = debt?.direction === 'receivable' ? '' : (x.direction === 'increase' ? 'red' : 'green');
  return `<div class="tx"><div class="tx-main"><strong class="${cls}">${x.direction === 'increase' ? '+' : '−'}${money(x.amount)}</strong><span>${esc(String(x.adjustment_date).slice(0, 10))}${x.note ? ` · ${esc(x.note)}` : ''}</span></div>
    <div class="tx-actions"><button class="btn sm" ${act('reopenAfterModal', 'openDebtAdjustment', x.debt_id, x.direction, x.id)}>Sửa</button><button class="btn sm" ${act('deleteDebtAdjustment', x.id, x.debt_id)}>Xóa</button></div></div>`;
}
function openDebtAdjustmentHistory(debtId) {
  const d = F.debts().find(x => x.id === debtId); if (!d) return toast('Không tìm thấy khoản nợ.', true);
  const rows = F.debtAdjustmentsFor(d).slice().sort((x, y) => String(y.adjustment_date).localeCompare(String(x.adjustment_date)));
  const months = [...new Set(rows.map(x => monthKey(x.adjustment_date)))].sort().reverse();
  const years = [...new Set(rows.map(x => yearKey(x.adjustment_date)))].sort().reverse();
  const lbl = DEBT_DIR_LABEL[d.direction];
  infoModal(`Lịch sử · ${esc(d.name)}`, `
    ${(d.counterparty || d.due_date) ? `<p class="note">${[d.counterparty ? `${esc(lbl.counterparty)}: ${esc(d.counterparty)}` : '', d.due_date ? `<span class="due-date-tag">Đáo hạn: ${esc(String(d.due_date).slice(0, 10))}</span>` : ''].filter(Boolean).join(' · ')}</p>` : ''}
    <div class="form-grid">
      <div class="field"><label>Lọc theo tháng</label><select id="debtAdjFilterMonth"><option value="">Tất cả</option>${months.map(m => `<option value="${m}">${fmtMonthKey(m)}</option>`).join('')}</select></div>
      <div class="field"><label>Lọc theo năm</label><select id="debtAdjFilterYear"><option value="">Tất cả</option>${years.map(y => `<option value="${y}">${y}</option>`).join('')}</select></div>
    </div>
    <div class="list mt-10" id="debtAdjHistList">${rows.map(debtAdjustmentRow).join('') || '<div class="empty compact">Chưa có lần điều chỉnh nào.</div>'}</div>
    <div class="row mt-14 wrap">
      <button class="btn primary" ${act('reopenAfterModal', 'openDebtAdjustment', debtId, 'increase')}>${esc(lbl.increase)}</button>
      <button class="btn" ${act('reopenAfterModal', 'openDebtAdjustment', debtId, 'decrease')}>${esc(lbl.decrease)}</button>
      <button class="btn" ${act('reopenAfterModal', 'openDebt', debtId, d.direction)}>Sửa</button>
      <button class="btn" ${act('reopenAfterModal', 'openRecurringManager', 'debt', debtId)}>🔁 Định kỳ</button>
    </div>`);
  const applyFilter = () => {
    const m = $('#debtAdjFilterMonth').value, y = $('#debtAdjFilterYear').value;
    const filtered = rows.filter(x => (!m || monthKey(x.adjustment_date) === m) && (!y || yearKey(x.adjustment_date) === y));
    $('#debtAdjHistList').innerHTML = filtered.map(debtAdjustmentRow).join('') || '<div class="empty compact">Không có lần điều chỉnh nào phù hợp.</div>';
  };
  $('#debtAdjFilterMonth').addEventListener('change', applyFilter);
  $('#debtAdjFilterYear').addEventListener('change', applyFilter);
}

// ---------------- Thẻ & trả góp (own ledger — no cycle, no statement, no account link) ----------------
function openCreditCard() {
  modal('Thêm thẻ tín dụng', `<div class="note">Thẻ chỉ dùng để nhóm chi tiêu/trả góp trong cột Thẻ & trả góp — không có số dư, không tự trừ tài khoản nào.</div>
  <div class="form-grid">
    <div class="field full"><label>Tên thẻ</label><input name="name" placeholder="VD: Rakuten" required autofocus></div>
    <div class="field"><label>Tiền tệ</label><select name="currency"><option value="JPY" ${state.base === 'JPY' ? 'selected' : ''}>JPY</option><option value="VND" ${state.base === 'VND' ? 'selected' : ''}>VND</option></select></div>
  </div>`, fd => api.core('save_account', { name: fd.name, account_type: 'credit', currency: fd.currency, opening_balance: 0 }), 'Tạo thẻ');
}

function cardExpenseRow(x) {
  const label = x.entry_mode === 'lump' ? `Tổng tháng ${fmtMonthKey(monthKey(x.expense_date))}` : (x.description || 'Khoản chi');
  return `<div class="tx"><div class="tx-main"><strong>${money(x.amount, state.base)}</strong><span>${esc(label)}${x.entry_mode === 'detail' ? ` · ${esc(String(x.expense_date).slice(0, 10))}` : ''}${x.note ? ` · ${esc(x.note)}` : ''}</span></div>
    <div class="tx-actions"><button class="btn sm" ${act('openCardExpenseForm', x.card_account_id, x.entry_mode, x.id)}>Sửa</button><button class="btn sm" ${act('deleteCardExpense', x.id, x.card_account_id)}>Xóa</button></div></div>`;
}
function openCardExpenseForm(cardId, mode = 'detail', id = '') {
  const card = F.accountById(cardId); if (!card) return toast('Không tìm thấy thẻ.', true);
  const existing = id ? F.cardExpensesFor(cardId).find(x => x.id === id) : null;
  if (mode === 'lump') {
    modal(existing ? 'Sửa tổng chi tháng' : `Nhập tổng theo tháng · ${esc(card.name)}`, `<div class="form-grid">
      <div class="field"><label>Tháng</label><input name="expense_month" type="month" value="${esc(monthKey(existing?.expense_date) || state.month)}" required></div>
      <div class="field"><label>Tổng số tiền đã tiêu</label><input name="amount" type="number" min="1" step="1" value="${esc(existing?.amount || '')}" required autofocus></div>
      <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(existing?.note || '')}" placeholder="Tùy chọn"></div>
    </div>`, fd => api.cardLedger('save_expense', { id: id || null, card_account_id: cardId, entry_mode: 'lump', expense_date: `${fd.expense_month}-01`, description: `Tổng chi tháng ${fd.expense_month}`, amount: fd.amount, note: fd.note || '' }), existing ? 'Lưu' : 'Thêm');
  } else {
    modal(existing ? 'Sửa khoản chi' : `Thêm khoản chi · ${esc(card.name)}`, `<div class="form-grid">
      <div class="field"><label>Ngày</label><input name="expense_date" type="date" value="${esc(existing?.expense_date || localToday())}" required></div>
      <div class="field"><label>Số tiền</label><input name="amount" type="number" min="1" step="1" value="${esc(existing?.amount || '')}" required autofocus></div>
      <div class="field full"><label>Nội dung đã mua</label><input name="description" value="${esc(existing?.description || '')}" placeholder="VD: Ăn uống"></div>
      <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(existing?.note || '')}" placeholder="Tùy chọn"></div>
    </div>`, fd => api.cardLedger('save_expense', { id: id || null, card_account_id: cardId, entry_mode: 'detail', expense_date: fd.expense_date, description: fd.description || '', amount: fd.amount, note: fd.note || '' }), existing ? 'Lưu' : 'Thêm khoản chi');
  }
}
async function deleteCardExpense(id, cardId) {
  if (!confirm('Xóa khoản chi này?')) return;
  try {
    await api.cardLedger('delete_expense', { id });
    await window.refresh();
    toast('Đã xóa');
    openCardLedger(cardId);
  } catch (e) { toast(e.message, true); }
}

function installmentProgress(inst) {
  const schedule = inst.schedule || [];
  const paid = schedule.filter(s => s.is_paid).length;
  return { paid, total: schedule.length };
}
function installmentRow(inst) {
  const p = installmentProgress(inst);
  const bonusMonths = (inst.bonus_months || []).slice().sort((a, b) => a - b);
  const bonusNote = bonusMonths.length ? ` · Bonus ${bonusMonths.map(m => `Tháng ${m}`).join(', ')} +${money(inst.bonus_amount, inst.currency)}/lần` : '';
  return `<div class="tx"><div class="tx-main"><strong>${esc(inst.name)}</strong><span>${money(inst.principal_amount, inst.currency)} · ${p.paid}/${p.total} kỳ đã trả · ${money(n(inst.principal_amount) / inst.total_installments, inst.currency)}/kỳ${esc(bonusNote)}</span></div>
    <div class="tx-actions"><button class="btn sm" ${act('openInstallmentSchedule', inst.id, inst.card_account_id)}>Xem lịch</button><button class="btn sm" ${act('openInstallment', inst.card_account_id, inst.id)}>Sửa</button><button class="btn sm" ${act('deleteInstallment', inst.id, inst.card_account_id)}>Xóa</button></div></div>`;
}
function openCardLedger(cardId) {
  const card = F.accountById(cardId); if (!card) return toast('Không tìm thấy thẻ.', true);
  const expenses = F.cardExpensesFor(cardId).slice().sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)));
  const installments = F.installmentsFor(cardId);
  const monthTotal = F.cardColumnMonthTotal(cardId, state.month);
  infoModal(`Xem danh sách · ${esc(card.name)}`, `
    <div class="balance-card"><span>Tổng tháng ${fmtMonthKey(state.month)}</span><strong>${esc(money(monthTotal, card.currency))}</strong></div>
    <h4 class="mt-14">Chi tiêu thẻ</h4>
    <div class="list">${expenses.map(cardExpenseRow).join('') || '<div class="empty compact">Chưa có khoản chi nào.</div>'}</div>
    <div class="row mt-10"><button class="btn primary" ${act('reopenAfterModal', 'openCardExpenseForm', cardId, 'detail')}>＋ Thêm khoản chi</button><button class="btn" ${act('reopenAfterModal', 'openCardExpenseForm', cardId, 'lump')}>＋ Nhập tổng theo tháng</button></div>
    <h4 class="mt-16">Trả góp</h4>
    <div class="list">${installments.map(installmentRow).join('') || '<div class="empty compact">Chưa có khoản trả góp nào.</div>'}</div>
    <button class="btn primary mt-10" ${act('reopenAfterModal', 'openInstallment', cardId)}>＋ Thêm khoản trả góp</button>`);
}

function openInstallment(cardId = '', id = '') {
  const cards = F.cardAccounts();
  if (!cards.length) { toast('Chưa có thẻ nào — hãy thêm một thẻ trước.', true); return reopenAfterModal('openCreditCard'); }
  const inst = id ? F.installmentsFor(cardId).find(x => x.id === id) : null;
  const hasBonus = !!(inst?.bonus_months || []).length;
  modal(inst ? 'Sửa khoản trả góp' : 'Thêm khoản trả góp', `<div class="form-grid">
    <div class="field full"><label>Tên khoản mua</label><input name="name" value="${esc(inst?.name || '')}" placeholder="VD: iPhone / Máy giặt" required autofocus></div>
    <div class="field"><label>Thẻ</label><select name="card_account_id">${options(cards, inst?.card_account_id || cardId || cards[0].id, a => `${a.name} · ${a.currency}`)}</select></div>
    <div class="field"><label>Tổng giá trị</label><input name="principal_amount" type="number" min="1" step="1" value="${esc(inst?.principal_amount || '')}" required></div>
    <div class="field"><label>Tổng số kỳ</label><input name="total_installments" type="number" min="2" max="60" value="${esc(inst?.total_installments || 12)}" required></div>
    <div class="field"><label>Ngày bắt đầu</label><input name="purchase_date" type="date" value="${esc(inst?.purchase_date || localToday())}" required></div>
    <div class="field"><label>Số kỳ đã trả</label><input name="paid_installments_before" type="number" min="0" value="${esc(inst?.paid_installments_before ?? 0)}"></div>
    <div class="field full"><label class="checkbox-label"><input type="checkbox" id="instBonusToggle" ${hasBonus ? 'checked' : ''}> 🎁 Có trả thêm bonus (Tết/giữa năm)?</label></div>
    <div class="field full${hasBonus ? '' : ' hidden'}" id="instBonusFields">
      <label>Chọn (những) tháng kỳ rơi vào sẽ trả thêm</label>
      <div class="row wrap">${Array.from({ length: 12 }, (_, i) => i + 1).map(m => `<label class="checkbox-label"><input type="checkbox" id="instBonus${m}" ${(inst?.bonus_months || []).includes(m) ? 'checked' : ''}> Tháng ${m}</label>`).join('')}</div>
    </div>
    <div class="field${hasBonus ? '' : ' hidden'}" id="instBonusAmountField"><label>Số tiền bonus mỗi lần</label><input id="instBonusAmount" type="number" min="0" step="1" value="${esc(inst?.bonus_amount || '')}" placeholder="VD: 100000"></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(inst?.note || '')}" placeholder="Tùy chọn"></div>
  </div>
  <small class="muted">Số tiền mỗi kỳ = Tổng giá trị ÷ Tổng số kỳ, chia đều. Chọn bonus thì các kỳ khác giảm xuống tương ứng — tổng vẫn đúng bằng Tổng giá trị, không cộng thêm ra ngoài. Mỗi tháng chỉ kỳ đến hạn mới tính vào Tổng chi tiêu tháng — không xuất hiện ở Chi biến động.</small>`,
  fd => api.cardLedger('save_installment', {
    ...fd, id: id || null, first_payment_month: `${monthKey(fd.purchase_date)}-01`,
    bonus_months: $('#instBonusToggle').checked ? Array.from({ length: 12 }, (_, i) => i + 1).filter(m => $(`#instBonus${m}`).checked) : [],
    bonus_amount: $('#instBonusToggle').checked ? ($('#instBonusAmount').value || 0) : 0
  }), inst ? 'Lưu' : 'Lưu khoản trả góp');
  const bonusToggle = $('#instBonusToggle');
  bonusToggle.addEventListener('change', () => {
    $('#instBonusFields').classList.toggle('hidden', !bonusToggle.checked);
    $('#instBonusAmountField').classList.toggle('hidden', !bonusToggle.checked);
  });
}
async function deleteInstallment(id, cardId) {
  if (!confirm('Xóa khoản trả góp này? Toàn bộ lịch trả sẽ bị xóa.')) return;
  try {
    await api.cardLedger('delete_installment', { id });
    await window.refresh();
    toast('Đã xóa khoản trả góp');
    openCardLedger(cardId);
  } catch (e) { toast(e.message, true); }
}
function scheduleRow(row, cardId) {
  const bonusTag = row.payment_kind === 'bonus' ? ' <span class="due-date-tag">Bonus</span>' : '';
  return `<div class="tx"><div class="tx-main"><strong>${esc(fmtMonthKey(monthKey(row.payment_month)))}${bonusTag}</strong><span>Kỳ ${row.installment_no} · ${money(n(row.principal_amount) + n(row.fee_amount))}${row.is_paid ? ' · Đã trả' : ''}</span></div>
    <div class="tx-actions"><button class="btn sm" ${act('reopenAfterModal', 'openScheduleRowEdit', row, cardId)}>Sửa</button><button class="btn sm" ${act('toggleInstallmentPaid', row.id, cardId)}>${row.is_paid ? 'Đánh dấu chưa trả' : 'Đánh dấu đã trả'}</button></div></div>`;
}
// Thoát hiểm khi cách chia tự động (kỳ đầu gánh phần dư, còn lại chia đều +
// bonus cộng thêm) không đúng ý — sửa thẳng đúng một kỳ, không tính lại cả
// lịch, không đụng các kỳ khác.
function openScheduleRowEdit(row, cardId) {
  modal(`Sửa kỳ ${row.installment_no} · ${esc(fmtMonthKey(monthKey(row.payment_month)))}`, `<div class="form-grid">
    <div class="field full"><label>Số tiền gốc kỳ này</label><input name="principal_amount" type="number" min="1" step="1" value="${esc(row.principal_amount)}" required autofocus></div>
  </div>
  <small class="muted">Chỉ sửa đúng kỳ này, không tính lại các kỳ khác.</small>`,
  fd => api.cardLedger('edit_schedule_row', { id: row.id, principal_amount: fd.principal_amount }), 'Lưu');
}
function openInstallmentSchedule(installmentId, cardId) {
  const inst = F.installmentsFor(cardId).find(x => x.id === installmentId); if (!inst) return toast('Không tìm thấy khoản trả góp.', true);
  const rows = (inst.schedule || []).slice().sort((a, b) => String(a.payment_month).localeCompare(String(b.payment_month)));
  infoModal(`Lịch trả · ${esc(inst.name)}`, `<div class="list">${rows.map(r => scheduleRow(r, cardId)).join('') || '<div class="empty compact">Chưa có lịch.</div>'}</div>`);
}
async function toggleInstallmentPaid(scheduleRowId, cardId) {
  try {
    await api.cardLedger('toggle_paid', { id: scheduleRowId });
    await window.refresh();
    const inst = (state.installments || []).find(i => (i.schedule || []).some(s => s.id === scheduleRowId) && i.card_account_id === cardId);
    if (inst) openInstallmentSchedule(inst.id, cardId);
  } catch (e) { toast(e.message, true); }
}

Object.assign(window, {
  openQuickEntry, openTransactionEdit, deleteTransaction, openColumnSettings, openAccount, deleteAccount, openAccountColumnManager,
  openAccountAdjustment, deleteAccountAdjustment, openAccountAdjustmentHistory,
  openDebt, deleteDebt, openDebtColumnManager, openDebtAdjustment, deleteDebtAdjustment, openDebtAdjustmentHistory,
  openRecurringManager, openRecurringItemForm, deleteRecurringItem, confirmRecurringItem, skipRecurringItem, unskipRecurringItem,
  openInvestmentNew, deleteInvestment, openInvestmentColumnManager, openNisaHolding, openInvestmentEvent, deleteInvestmentEvent, openInvestmentEventHistory,
  openSecurityTrade, openInvestmentPlanConfirm, skipInvestmentPlan,
  openCreditCard, openCardLedger, openCardExpenseForm, deleteCardExpense,
  openInstallment, deleteInstallment, openInstallmentSchedule, toggleInstallmentPaid
});
