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
  const dlg = $('#modal'), mb = $('#modalBody'), form = $('#modalForm');
  mb.innerHTML = `<div class="modal-head"><h3>Nhập nhanh</h3><button class="mini-btn" type="button" aria-label="Đóng" ${act('closeModal')}>✕</button></div>
  <div class="modal-content quick-entry">
    <div class="type-tabs" id="qeTypeTabs"><button type="button" data-t="expense">Chi</button><button type="button" data-t="income">Thu</button></div>
    <div class="field"><label>Số tiền</label><div class="amount-row"><span id="qeCurrency">${esc(state.base)}</span><input id="qeAmount" name="amount" type="number" min="1" step="1" required autofocus placeholder="0" value="${esc(defaults.amount || '')}"></div><div class="chip-row" id="qeAmountChips"></div></div>
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
  function sync() {
    $('#qeType').value = type; currencyField.value = state.base; currencyLabel.textContent = state.base;
    $$('#qeTypeTabs button').forEach(b => b.classList.toggle('active', b.dataset.t === type));
    $('#qeExceptionalField').classList.toggle('hidden', type !== 'expense');
    const cats = F.orderedCategories(type);
    if (!cats.some(c => c.id === categoryId)) categoryId = cats[0]?.id || '';
    catSel.innerHTML = options(cats, categoryId);
    $('#qeCategoryChips').innerHTML = cats.slice(0, 8).map(c => `<button type="button" class="chip ${c.id === categoryId ? 'active' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('');
    $('#qeAmountChips').innerHTML = amountSuggestions().map(v => `<button type="button" class="chip" data-amt="${v}">${money(v, state.base)}</button>`).join('');
  }
  $('#qeTypeTabs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; type = b.dataset.t; categoryId = readQuickPrefs()[type]?.category_id || ''; sync(); amount.focus(); });
  $('#qeCategoryChips').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (!b) return; categoryId = b.dataset.cat; catSel.value = categoryId; sync(); });
  $('#qeAmountChips').addEventListener('click', e => { const b = e.target.closest('[data-amt]'); if (!b) return; amount.value = b.dataset.amt; amount.focus(); });
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
async function archiveAccount(id) {
  if (!confirm('Ẩn tài khoản này?')) return;
  try { await api.core('archive_account', { id }); await window.refresh(); toast('Đã ẩn tài khoản'); } catch (e) { toast(e.message, true); }
}
async function unarchiveAccount(id) {
  try { await api.core('unarchive_account', { id }); await window.refresh(); toast('Đã khôi phục tài khoản'); } catch (e) { toast(e.message, true); }
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
    <div class="row mt-14"><button class="btn primary" ${act('reopenAfterModal', 'openAccountAdjustment', accountId, 'increase')}>＋ Tiền</button><button class="btn" ${act('reopenAfterModal', 'openAccountAdjustment', accountId, 'decrease')}>− Tiền</button></div>`);
  $('#adjHistFilter').addEventListener('change', e => {
    const m = e.target.value;
    const filtered = m ? rows.filter(x => monthKey(x.adjustment_date) === m) : rows;
    $('#adjHistList').innerHTML = filtered.map(accountAdjustmentRow).join('') || '<div class="empty compact">Không có lần điều chỉnh nào trong tháng này.</div>';
  });
}

// ---------------- Đầu tư ----------------
const INVESTMENT_TYPE_PRESETS = ['NISA', 'S&P500', 'Cổ phiếu', 'Quỹ', 'Vàng', 'Crypto', 'Bất động sản'];
function openInvestmentNew(id = '') {
  const inv = id ? F.investments().find(x => x.id === id) : null;
  const isPreset = inv && INVESTMENT_TYPE_PRESETS.includes(inv.asset_type);
  modal(id ? 'Sửa khoản đầu tư' : 'Đầu tư mới', `<div class="form-grid">
    <div class="field full"><label>Tên</label><input name="name" value="${esc(inv?.name || '')}" placeholder="VD: NISA tăng trưởng" required autofocus></div>
    <div class="field"><label>Loại</label><select name="asset_type_preset" id="invTypePreset">${INVESTMENT_TYPE_PRESETS.map(t => `<option value="${esc(t)}" ${inv?.asset_type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}<option value="__custom" ${!isPreset && inv?.asset_type ? 'selected' : ''}>Loại khác…</option></select></div>
    <div class="field hidden" id="invTypeCustomField"><label>Tên loại tự đặt</label><input name="asset_type_custom" id="invTypeCustom" value="${esc(!isPreset ? (inv?.asset_type || '') : '')}"></div>
    <div class="field"><label>Tiền tệ</label><select name="currency"><option value="JPY" ${(inv?.currency || state.base) === 'JPY' ? 'selected' : ''}>JPY</option><option value="VND" ${(inv?.currency || state.base) === 'VND' ? 'selected' : ''}>VND</option></select></div>
    <div class="field"><label>Vốn ban đầu</label><input name="initial_capital" type="number" min="0" step="1" value="${esc(inv?.initial_capital ?? 0)}"></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(inv?.note || '')}" placeholder="Tùy chọn"></div>
  </div>`, fd => api.investment('save', {
    id: id || null, name: fd.name, currency: fd.currency, initial_capital: fd.initial_capital, note: fd.note || '',
    asset_type: fd.asset_type_preset === '__custom' ? (fd.asset_type_custom || '') : fd.asset_type_preset
  }), id ? 'Lưu' : 'Tạo');
  const presetEl = $('#invTypePreset');
  const sync = () => $('#invTypeCustomField').classList.toggle('hidden', presetEl.value !== '__custom');
  presetEl.onchange = sync; sync();
}
async function deleteInvestment(id) {
  if (!confirm('Xóa khoản đầu tư này? Lịch sử vẫn được giữ lại nhưng khoản này sẽ không còn hiển thị.')) return;
  try { await api.investment('delete', { id }); await window.refresh(); toast('Đã xóa khoản đầu tư'); } catch (e) { toast(e.message, true); }
}
const INVESTMENT_EVENT_LABEL = { contribution: 'Thêm vốn', withdrawal: 'Rút vốn', valuation: 'Cập nhật giá trị' };
function openInvestmentEvent(investmentId, eventType, id = '') {
  const inv = F.investments().find(x => x.id === investmentId); if (!inv) return toast('Không tìm thấy khoản đầu tư.', true);
  const events = (state.investmentEvents || {})[investmentId] || [];
  const existing = id ? events.find(x => x.id === id) : null;
  const type = existing?.event_type || eventType;
  const currentValue = F.investmentCurrentValue(inv);
  const defaultAmount = existing ? existing.amount : (type === 'valuation' ? currentValue : '');
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
function investmentEventRow(x, investmentId) {
  const sign = x.event_type === 'withdrawal' ? '−' : '+';
  const cls = x.event_type === 'withdrawal' ? 'red' : x.event_type === 'valuation' ? '' : 'green';
  return `<div class="tx"><div class="tx-main"><strong class="${cls}">${esc(INVESTMENT_EVENT_LABEL[x.event_type])}${x.event_type === 'valuation' ? '' : ` ${sign}`}${money(x.amount)}</strong><span>${esc(String(x.event_date).slice(0, 10))}${x.note ? ` · ${esc(x.note)}` : ''}</span></div>
    <div class="tx-actions"><button class="btn sm" ${act('reopenAfterModal', 'openInvestmentEvent', investmentId, x.event_type, x.id)}>Sửa</button><button class="btn sm" ${act('deleteInvestmentEvent', x.id, investmentId)}>Xóa</button></div></div>`;
}
function openInvestmentEventHistory(investmentId) {
  const inv = F.investments().find(x => x.id === investmentId); if (!inv) return toast('Không tìm thấy khoản đầu tư.', true);
  const rows = ((state.investmentEvents || {})[investmentId] || []).slice().sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)));
  infoModal(`Lịch sử · ${esc(inv.name)}`, `
    <div class="list">${rows.map(x => investmentEventRow(x, investmentId)).join('') || '<div class="empty compact">Chưa có lịch sử nào.</div>'}</div>
    <div class="row mt-14">
      <button class="btn primary" ${act('reopenAfterModal', 'openInvestmentEvent', investmentId, 'contribution')}>Thêm vốn</button>
      <button class="btn" ${act('reopenAfterModal', 'openInvestmentEvent', investmentId, 'withdrawal')}>Rút vốn</button>
      <button class="btn" ${act('reopenAfterModal', 'openInvestmentEvent', investmentId, 'valuation')}>Cập nhật giá trị</button>
    </div>`);
}

// ---------------- Loans (personal + bank, unified — unchanged, out of scope for this rewrite) ----------------
function openLoan(id = '', defaults = {}) {
  const l = (state.loans || []).find(x => x.id === id) || {};
  const t = F.loanTerms(id) || {};
  const isNew = !id, linked = !!id && (state.fullTransactions || []).some(x => x.loan_id === id);
  const initialKind = defaults.loan_kind || t.loan_kind || 'personal';
  const currency = l.currency || defaults.currency || state.base;
  modal(id ? 'Sửa khoản nợ' : 'Thêm khoản nợ', `<div class="form-grid">
    <div class="field"><label>Nhóm</label><select name="loan_kind" id="loanKind" ${linked ? 'disabled' : ''}><option value="personal" ${initialKind === 'personal' ? 'selected' : ''}>Cá nhân / khoản khác</option><option value="bank" ${initialKind === 'bank' ? 'selected' : ''}>Vay ngân hàng</option></select>${linked ? `<input type="hidden" name="loan_kind" value="${esc(initialKind)}">` : ''}</div>
    <div class="field"><label>Loại</label><select name="loan_type" id="loanType" ${!isNew ? 'disabled' : ''}><option value="borrowed" ${(l.loan_type || 'borrowed') === 'borrowed' ? 'selected' : ''}>Đi vay · mình phải trả</option><option value="lent" ${l.loan_type === 'lent' ? 'selected' : ''}>Cho vay · mình phải thu</option></select>${!isNew ? `<input type="hidden" name="loan_type" value="${esc(l.loan_type)}">` : ''}</div>
    <div class="field full"><label>Tên khoản / người liên quan</label><input name="counterparty" value="${esc(l.counterparty || '')}" required autofocus></div>
    <div class="field"><label>Tiền tệ</label><select name="currency" id="loanCurrency" ${!isNew ? 'disabled' : ''}><option value="JPY" ${currency === 'JPY' ? 'selected' : ''}>JPY</option><option value="VND" ${currency === 'VND' ? 'selected' : ''}>VND</option></select>${!isNew ? `<input type="hidden" name="currency" value="${esc(currency)}">` : ''}</div>
    <div class="field"><label>Số tiền gốc</label><input name="principal" type="number" min="1" step="1" value="${esc(l.principal || '')}" ${!isNew ? 'readonly' : ''} required></div>
    ${!isNew ? `<div class="field"><label>Dư còn lại</label><input value="${esc(money(l.remaining_amount || 0, currency))}" disabled><input type="hidden" name="remaining_amount" value="${esc(l.remaining_amount || 0)}"></div>` : ''}
    <div class="field"><label>Ngày bắt đầu</label><input name="start_date" type="date" value="${esc(l.start_date || localToday())}" ${linked ? 'readonly' : ''}></div>
    <div class="field"><label>Hạn cuối</label><input name="due_date" type="date" value="${esc(l.due_date || '')}"></div>
  </div>
  <div id="bankFields" class="hidden mt-12">
    <div class="form-grid">
      <div class="field"><label>Ngân hàng / tổ chức</label><input name="institution_name" value="${esc(t.institution_name || '')}" placeholder="VD: MUFG, SMBC"></div>
      <div class="field"><label>Tên sản phẩm</label><input name="product_name" value="${esc(t.product_name || '')}" placeholder="VD: 住宅ローン"></div>
      <div class="field"><label>Lãi suất năm (%)</label><input name="annual_rate" type="number" min="0" step="0.001" value="${esc(t.annual_rate ?? 0)}"></div>
      <div class="field"><label>Cách trả</label><select name="repayment_method"><option value="manual" ${(t.repayment_method || 'manual') === 'manual' ? 'selected' : ''}>Nhập theo sao kê</option><option value="equal_payment" ${t.repayment_method === 'equal_payment' ? 'selected' : ''}>元利均等 · tổng đều</option><option value="equal_principal" ${t.repayment_method === 'equal_principal' ? 'selected' : ''}>元金均等 · gốc đều</option></select></div>
      <div class="field"><label>Thời hạn (tháng)</label><input name="term_months" type="number" min="1" step="1" value="${esc(t.term_months || '')}"></div>
      <div class="field"><label>Ngày trả hàng tháng</label><input name="payment_day" type="number" min="1" max="31" value="${esc(t.payment_day || '')}"></div>
    </div>
    <small class="muted">Số kỳ tới chỉ là ước tính. Khi trả thật, luôn nhập đúng gốc/lãi theo sao kê ngân hàng.</small>
  </div>
  <div class="field full mt-12"><label>Ghi chú</label><input name="note" value="${esc(l.note || '')}"></div>`,
  async fd => {
    const kind = fd.loan_kind || initialKind;
    if (kind === 'bank') {
      await api.bankLoan('save', {
        loan_id: id || null, counterparty: fd.counterparty, principal: fd.principal, currency: fd.currency,
        annual_rate: fd.annual_rate, repayment_method: fd.repayment_method, term_months: fd.term_months, payment_day: fd.payment_day,
        start_date: fd.start_date, due_date: fd.due_date, note: fd.note || '', funding_account_id: null
      });
      return;
    }
    fd.loan_type = fd.loan_type || 'borrowed';
    await api.core('save_loan', { id: id || null, counterparty: fd.counterparty, loan_type: fd.loan_type, principal: fd.principal, remaining_amount: isNew ? fd.principal : l.remaining_amount, currency: fd.currency, start_date: fd.start_date, due_date: fd.due_date, note: fd.note || '' });
  });
  const kindEl = $('#loanKind'), bankBox = $('#bankFields');
  const sync = () => bankBox.classList.toggle('hidden', (kindEl?.value || initialKind) !== 'bank');
  if (kindEl) kindEl.onchange = sync; sync();
}
async function deleteLoan(id) {
  const linked = (state.fullTransactions || []).some(t => t.loan_id === id);
  if (linked) { toast('Khoản này đã có lịch sử nên không xóa trực tiếp. Hãy tất toán để giữ đúng lịch sử.', true); return false; }
  if (!confirm('Xóa khoản nợ chưa có giao dịch này?')) return false;
  try { await api.core('delete_loan', { id }); await window.refresh(); toast('Đã xóa khoản nợ'); return true; }
  catch (e) { toast(e.message, true); return false; }
}
function openLoanPayment(id) {
  const l = (state.loans || []).find(x => x.id === id); if (!l) return toast('Không tìm thấy khoản nợ.', true);
  if (F.isBankLoan(l)) return openBankPayment(id);
  if (n(l.remaining_amount) <= 0) return toast('Khoản này đã tất toán.');
  const borrowed = l.loan_type === 'borrowed';
  const ac = F.activeAccounts().filter(a => (a.currency || state.base) === (l.currency || state.base) && ['cash', 'bank', 'savings'].includes(a.account_type));
  if (!ac.length) return toast(`Cần tài khoản ${l.currency} để ${borrowed ? 'trả' : 'nhận'} tiền.`, true);
  modal(borrowed ? 'Trả nợ' : 'Thu hồi khoản cho vay', `<div class="form-grid">
    <div class="field full"><label>${borrowed ? 'Khoản phải trả' : 'Khoản phải thu'}</label><input value="${esc(l.counterparty)} · ${esc(money(l.remaining_amount, l.currency))}" disabled></div>
    <div class="field"><label>Số tiền</label><input name="amount" type="number" min="1" max="${esc(l.remaining_amount)}" value="${esc(l.remaining_amount)}" required autofocus></div>
    <div class="field"><label>Tài khoản</label><select name="account_id" required>${options(ac, ac[0].id, a => `${a.name} · ${a.currency}`)}</select></div>
    <div class="field"><label>Ngày</label><input name="transaction_date" type="date" value="${localToday()}" required></div>
    <div class="field full"><label>Ghi chú</label><input name="note"></div>
  </div>`, fd => api.debt('payment', { loan_id: id, ...fd }), borrowed ? 'Ghi trả nợ' : 'Ghi thu tiền');
}
function openBankPayment(id) {
  const l = (state.loans || []).find(x => x.id === id); if (!l) return toast('Không tìm thấy khoản vay.', true);
  if (n(l.remaining_amount) <= 0) return toast('Khoản vay đã tất toán.');
  const t = F.loanTerms(id) || {}, est = F.bankEstimate(l);
  const ac = F.activeAccounts().filter(a => (a.currency || state.base) === (l.currency || state.base) && ['cash', 'bank', 'savings'].includes(a.account_type));
  if (!ac.length) return toast(`Cần tài khoản ${l.currency} để trả khoản vay.`, true);
  const p0 = t.repayment_method === 'manual' ? 0 : Math.round(est.principal), i0 = Math.round(est.interest);
  modal('Trả khoản vay ngân hàng', `<div class="balance-card"><span>${esc(t.institution_name || 'Ngân hàng')} · ${esc(l.counterparty)}</span><strong>Dư nợ ${esc(money(l.remaining_amount, l.currency))}</strong></div>
  <div class="form-grid">
    <div class="field"><label>Trả gốc</label><input id="bpPrincipal" name="principal_amount" type="number" min="0" max="${esc(l.remaining_amount)}" step="1" value="${p0}" required></div>
    <div class="field"><label>Lãi / phí kỳ này</label><input id="bpInterest" name="interest_amount" type="number" min="0" step="1" value="${i0}" required></div>
    <div class="field"><label>Tài khoản trả</label><select name="account_id" required>${options(ac, ac[0].id, a => `${a.name} · ${a.currency}`)}</select></div>
    <div class="field"><label>Ngày trả</label><input name="transaction_date" type="date" value="${localToday()}" required></div>
    <div class="field full"><label>Tổng tiền ra</label><div id="bpTotal" class="balance-card m-0"><strong>${esc(money(p0 + i0, l.currency))}</strong></div></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(t.institution_name || '')} ${esc(l.counterparty)}"></div>
  </div>
  <small class="muted">Gốc làm giảm dư nợ. Lãi/phí là chi phí và làm giảm tài sản ròng, nhưng không giảm gốc.</small>`,
  fd => api.extension('bank_payment', { loan_id: id, account_id: fd.account_id, principal_amount: fd.principal_amount, interest_amount: fd.interest_amount, transaction_date: fd.transaction_date, note: fd.note || '' }), 'Ghi thanh toán');
  const p = $('#bpPrincipal'), i = $('#bpInterest'), tot = $('#bpTotal');
  const sync = () => tot.innerHTML = `<strong>${esc(money(n(p.value) + n(i.value), l.currency))}</strong>`;
  p.oninput = sync; i.oninput = sync;
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
  return `<div class="tx"><div class="tx-main"><strong>${esc(inst.name)}</strong><span>${money(inst.principal_amount, inst.currency)} · ${p.paid}/${p.total} kỳ đã trả · ${money(n(inst.principal_amount) / inst.total_installments, inst.currency)}/kỳ</span></div>
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
  modal(inst ? 'Sửa khoản trả góp' : 'Thêm khoản trả góp', `<div class="form-grid">
    <div class="field full"><label>Tên khoản mua</label><input name="name" value="${esc(inst?.name || '')}" placeholder="VD: iPhone / Máy giặt" required autofocus></div>
    <div class="field"><label>Thẻ</label><select name="card_account_id">${options(cards, inst?.card_account_id || cardId || cards[0].id, a => `${a.name} · ${a.currency}`)}</select></div>
    <div class="field"><label>Tổng giá trị</label><input name="principal_amount" type="number" min="1" step="1" value="${esc(inst?.principal_amount || '')}" required></div>
    <div class="field"><label>Tổng số kỳ</label><input name="total_installments" type="number" min="2" max="60" value="${esc(inst?.total_installments || 12)}" required></div>
    <div class="field"><label>Ngày bắt đầu</label><input name="purchase_date" type="date" value="${esc(inst?.purchase_date || localToday())}" required></div>
    <div class="field"><label>Số kỳ đã trả</label><input name="paid_installments_before" type="number" min="0" value="${esc(inst?.paid_installments_before ?? 0)}"></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(inst?.note || '')}" placeholder="Tùy chọn"></div>
  </div>
  <small class="muted">Số tiền mỗi kỳ = Tổng giá trị ÷ Tổng số kỳ, chia đều. Mỗi tháng chỉ kỳ đến hạn mới tính vào Tổng chi tiêu tháng — không xuất hiện ở Chi biến động.</small>`,
  fd => api.cardLedger('save_installment', { ...fd, id: id || null, first_payment_month: `${monthKey(fd.purchase_date)}-01` }), inst ? 'Lưu' : 'Lưu khoản trả góp');
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
  return `<div class="tx"><div class="tx-main"><strong>${esc(fmtMonthKey(monthKey(row.payment_month)))}</strong><span>Kỳ ${row.installment_no} · ${money(n(row.principal_amount) + n(row.fee_amount))}${row.is_paid ? ' · Đã trả' : ''}</span></div>
    <div class="tx-actions"><button class="btn sm" ${act('toggleInstallmentPaid', row.id, cardId)}>${row.is_paid ? 'Đánh dấu chưa trả' : 'Đánh dấu đã trả'}</button></div></div>`;
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
  openQuickEntry, openTransactionEdit, deleteTransaction, openColumnSettings, openAccount, archiveAccount, unarchiveAccount,
  openAccountAdjustment, deleteAccountAdjustment, openAccountAdjustmentHistory,
  openInvestmentNew, deleteInvestment, openInvestmentEvent, deleteInvestmentEvent, openInvestmentEventHistory,
  openLoan, deleteLoan, openLoanPayment, openBankPayment,
  openCreditCard, openCardLedger, openCardExpenseForm, deleteCardExpense,
  openInstallment, deleteInstallment, openInstallmentSchedule, toggleInstallmentPaid
});
