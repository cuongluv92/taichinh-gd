// ==========================================================================
// All modal forms, consolidated. One implementation per concern (the old
// app had 3-4 competing versions of most of these across the patch chain).
// ==========================================================================
'use strict';

function seedStatementDate(dueMonth, offset, closingDay) {
  const purchaseMonth = addMonths(dueMonth, -Math.max(1, n(offset || 1)));
  const [y, m] = purchaseMonth.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const day = Math.min(Math.max(1, n(closingDay || 10)), last);
  return `${purchaseMonth}-${String(day).padStart(2, '0')}`;
}

// ---------------- Quick entry (income / expense / transfer) ----------------
function readQuickPrefs() { try { return JSON.parse(localStorage.getItem(QUICK_PREF_KEY) || '{}') || {}; } catch { return {}; } }
function writeQuickPref(type, patch) {
  const all = readQuickPrefs(); all[type] = { ...(all[type] || {}), ...patch };
  try { localStorage.setItem(QUICK_PREF_KEY, JSON.stringify(all)); } catch {}
}
function txAccountsFor(type, keepId = '') {
  return F.activeAccounts().filter(a => {
    if (a.id === keepId) return true;
    if (type === 'income') return ['cash', 'bank', 'savings'].includes(a.account_type);
    if (type === 'expense') return ['cash', 'bank', 'credit'].includes(a.account_type);
    return true;
  });
}
function selectedMonthDate() {
  const local = localToday();
  return monthKey(local) === state.month ? local : `${state.month}-01`;
}
function openQuickEntry(defaults = {}) {
  let type = ['income', 'expense', 'transfer'].includes(defaults.transaction_type) ? defaults.transaction_type : 'expense';
  const prefs = readQuickPrefs();
  let accountId = defaults.account_id || prefs[type]?.account_id || F.defaultMoneyAccountId();
  let categoryId = defaults.category_id || prefs[type]?.category_id || '';
  let targetId = defaults.transfer_account_id || '';
  const dlg = $('#modal'), mb = $('#modalBody'), form = $('#modalForm');
  mb.innerHTML = `<div class="modal-head"><h3>Nhập nhanh</h3><button class="mini-btn" type="button" aria-label="Đóng" ${act('closeModal')}>✕</button></div>
  <div class="modal-content quick-entry">
    <div class="type-tabs" id="qeTypeTabs"><button type="button" data-t="expense">Chi</button><button type="button" data-t="income">Thu</button><button type="button" data-t="transfer">Chuyển</button></div>
    <div class="field"><label>Số tiền</label><div class="amount-row"><span id="qeCurrency">${esc(state.base)}</span><input id="qeAmount" name="amount" type="number" min="1" step="1" required autofocus placeholder="0" value="${esc(defaults.amount || '')}"></div><div class="chip-row" id="qeAmountChips"></div></div>
    <div id="qeCategoryBlock"><label class="mini-label">Danh mục</label><div class="chip-row" id="qeCategoryChips"></div></div>
    <div><label class="mini-label">Tài khoản</label><div class="chip-row" id="qeAccountChips"></div></div>
    <div id="qeTargetBlock" class="hidden"><label class="mini-label">Chuyển đến</label><div class="chip-row" id="qeTargetChips"></div></div>
    <details class="mt-12"><summary class="details-summary">Thêm chi tiết</summary>
      <div class="form-grid mt-10">
        <div class="field"><label>Ngày</label><input name="transaction_date" type="date" value="${esc(defaults.transaction_date || selectedMonthDate())}" required></div>
        <div class="field"><label>Danh mục</label><select id="qeCategorySelect" name="category_id"></select></div>
        <div class="field"><label>Tài khoản</label><select id="qeAccountSelect" name="account_id"></select></div>
        <div class="field" id="qeTargetSelectField"><label>Chuyển đến</label><select id="qeTargetSelect" name="transfer_account_id"></select></div>
        <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(defaults.note || '')}" placeholder="Tùy chọn"></div>
        <div class="field full hidden" id="qeExceptionalField"><label class="checkbox-label"><input type="checkbox" id="qeExceptional"> Chi tiêu bất thường (không tính vào ngân sách Chi cố định/Chi biến động tháng này)</label></div>
      </div>
    </details>
    <input type="hidden" id="qeType" name="transaction_type" value="${esc(type)}"><input type="hidden" id="qeCurrencyField" name="currency" value="${esc(state.base)}">
  </div>
  <div class="modal-actions"><button class="btn" type="button" ${act('closeModal')}>Hủy</button><button class="btn primary" type="submit">Lưu</button></div>`;

  const amount = $('#qeAmount'), currencyLabel = $('#qeCurrency'), currencyField = $('#qeCurrencyField');
  const catSel = $('#qeCategorySelect'), accSel = $('#qeAccountSelect'), tgtSel = $('#qeTargetSelect');
  function amountSuggestions(currency) {
    const rows = [...(state.fullTransactions || [])].filter(t => t.transaction_type === type && n(t.amount) > 0 && (t.currency || state.base) === currency && (!categoryId || t.category_id === categoryId))
      .sort((a, b) => String(b.transaction_date || '').localeCompare(String(a.transaction_date || '')));
    const uniq = []; rows.forEach(t => { const v = n(t.amount); if (v && !uniq.includes(v)) uniq.push(v); });
    const fallback = currency === 'VND' ? [50000, 100000, 200000, 500000] : [500, 1000, 3000, 5000, 10000];
    return [...uniq, ...fallback].filter((v, i, a) => a.indexOf(v) === i).slice(0, 5);
  }
  function sync() {
    const accounts = txAccountsFor(type, accountId);
    if (!accounts.some(a => a.id === accountId)) accountId = accounts[0]?.id || '';
    const acc = F.accountById(accountId), currency = acc?.currency || state.base;
    $('#qeType').value = type; currencyField.value = currency; currencyLabel.textContent = currency;
    $$('#qeTypeTabs button').forEach(b => b.classList.toggle('active', b.dataset.t === type));
    $('#qeCategoryBlock').classList.toggle('hidden', type === 'transfer');
    catSel.closest('.field').classList.toggle('hidden', type === 'transfer');
    $('#qeExceptionalField').classList.toggle('hidden', type !== 'expense');
    const cats = type === 'transfer' ? [] : F.orderedCategories(type);
    if (type !== 'transfer' && !cats.some(c => c.id === categoryId)) categoryId = cats[0]?.id || '';
    catSel.innerHTML = type === 'transfer' ? '' : options(cats, categoryId);
    $('#qeCategoryChips').innerHTML = cats.slice(0, 6).map(c => `<button type="button" class="chip ${c.id === categoryId ? 'active' : ''}" data-cat="${esc(c.id)}">${esc(c.name)}</button>`).join('');
    accSel.innerHTML = options(accounts, accountId, a => `${a.name} · ${a.currency || state.base}`);
    $('#qeAccountChips').innerHTML = accounts.slice(0, 6).map(a => `<button type="button" class="chip ${a.id === accountId ? 'active' : ''}" data-acc="${esc(a.id)}">${esc(a.name)}</button>`).join('');
    const targets = type === 'transfer' ? F.activeAccounts().filter(a => a.id !== accountId && (a.currency || state.base) === currency) : [];
    if (type === 'transfer' && !targets.some(a => a.id === targetId)) targetId = targets[0]?.id || '';
    $('#qeTargetBlock').classList.toggle('hidden', type !== 'transfer');
    $('#qeTargetSelectField').classList.toggle('hidden', type !== 'transfer');
    tgtSel.innerHTML = options(targets, targetId, a => `${a.name} · ${a.currency}`);
    $('#qeTargetChips').innerHTML = targets.slice(0, 6).map(a => `<button type="button" class="chip ${a.id === targetId ? 'active' : ''}" data-tgt="${esc(a.id)}">${esc(a.name)}</button>`).join('');
    $('#qeAmountChips').innerHTML = amountSuggestions(currency).map(v => `<button type="button" class="chip" data-amt="${v}">${money(v, currency)}</button>`).join('');
  }
  $('#qeTypeTabs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; type = b.dataset.t; accountId = readQuickPrefs()[type]?.account_id || F.defaultMoneyAccountId(); categoryId = readQuickPrefs()[type]?.category_id || ''; targetId = ''; sync(); amount.focus(); });
  $('#qeCategoryChips').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (!b) return; categoryId = b.dataset.cat; catSel.value = categoryId; sync(); });
  $('#qeAccountChips').addEventListener('click', e => { const b = e.target.closest('[data-acc]'); if (!b) return; accountId = b.dataset.acc; accSel.value = accountId; sync(); });
  $('#qeTargetChips').addEventListener('click', e => { const b = e.target.closest('[data-tgt]'); if (!b) return; targetId = b.dataset.tgt; tgtSel.value = targetId; sync(); });
  $('#qeAmountChips').addEventListener('click', e => { const b = e.target.closest('[data-amt]'); if (!b) return; amount.value = b.dataset.amt; amount.focus(); });
  catSel.addEventListener('change', () => { categoryId = catSel.value; sync(); });
  accSel.addEventListener('change', () => { accountId = accSel.value; sync(); });
  tgtSel.addEventListener('change', () => { targetId = tgtSel.value; sync(); });
  sync();
  form.onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form).entries());
    const submitBtn = form.querySelector('[type=submit]');
    try {
      submitBtn.disabled = true;
      if (!n(fd.amount)) throw new Error('Hãy nhập số tiền.');
      if (!fd.account_id) throw new Error('Hãy chọn tài khoản.');
      if (fd.transaction_type !== 'transfer' && !fd.category_id) throw new Error('Hãy chọn danh mục.');
      if (fd.transaction_type === 'transfer' && !fd.transfer_account_id) throw new Error('Hãy chọn tài khoản nhận.');
      const saved = await api.core('save_transaction', { ...fd, id: null, fx_rate: 1, category_id: fd.transaction_type === 'transfer' ? null : fd.category_id, transfer_account_id: fd.transaction_type === 'transfer' ? fd.transfer_account_id : null });
      if (fd.transaction_type === 'expense' && $('#qeExceptional').checked) await api.exceptional('set', { id: saved.id, is_exceptional: true });
      writeQuickPref(fd.transaction_type, { account_id: fd.account_id, category_id: fd.category_id || null });
      dlg.close(); await window.refresh(); toast('Đã lưu');
    } catch (err) { toast(err.message, true); } finally { submitBtn.disabled = false; }
  };
  if (!dlg.open) dlg.showModal();
  setTimeout(() => amount.focus(), 30);
}

function openTransactionEdit(id) {
  const t = (state.fullTransactions || []).find(x => x.id === id);
  if (!t) return toast('Không tìm thấy giao dịch.', true);
  if (F.isDebtTransaction(t)) { const l = (state.loans || []).find(x => x.id === t.loan_id); return l ? openLoanPayment(l.id) : toast('Giao dịch nợ được quản lý ở cột Nợ.', true); }
  if (F.isGoalTransaction(t) || F.isInvestmentAdjustment(t)) return toast('Giao dịch này được quản lý tại Tài sản.', true);
  const type = t.transaction_type;
  modal('Sửa giao dịch', `<div class="form-grid">
    <div class="field"><label>Loại</label><select name="transaction_type" id="etType"><option value="expense" ${type === 'expense' ? 'selected' : ''}>Chi tiêu</option><option value="income" ${type === 'income' ? 'selected' : ''}>Thu nhập</option><option value="transfer" ${type === 'transfer' ? 'selected' : ''}>Chuyển khoản</option></select></div>
    <div class="field"><label>Số tiền</label><input name="amount" type="number" min="1" step="1" value="${esc(t.amount)}" required></div>
    <div class="field"><label>Ngày</label><input name="transaction_date" type="date" value="${esc(t.transaction_date)}" required></div>
    <div class="field"><label>Tài khoản</label><select name="account_id" id="etAccount">${options(F.activeAccounts(), t.account_id, a => `${a.name} · ${a.currency}`)}</select></div>
    <div class="field" id="etCatField"><label>Danh mục</label><select name="category_id" id="etCat"></select></div>
    <div class="field hidden" id="etTgtField"><label>Chuyển đến</label><select name="transfer_account_id" id="etTgt"></select></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(t.note || '')}"></div>
    <div class="field full${type === 'expense' ? '' : ' hidden'}" id="etExceptionalField"><label class="checkbox-label"><input type="checkbox" id="etExceptional" ${F.isExceptional(t) ? 'checked' : ''}> Chi tiêu bất thường (không tính vào ngân sách Chi cố định/Chi biến động tháng này)</label></div>
  </div>`, async fd => {
    await api.core('save_transaction', {
      ...fd, id, fx_rate: 1, currency: F.accountById(fd.account_id)?.currency || state.base,
      category_id: fd.transaction_type === 'transfer' ? null : fd.category_id,
      transfer_account_id: fd.transaction_type === 'transfer' ? fd.transfer_account_id : null
    });
    if (fd.transaction_type === 'expense') await api.exceptional('set', { id, is_exceptional: $('#etExceptional').checked });
  });
  const typeEl = $('#etType'), catEl = $('#etCat'), tgtEl = $('#etTgt'), accEl = $('#etAccount');
  const sync = () => {
    const tr = typeEl.value === 'transfer';
    $('#etCatField').classList.toggle('hidden', tr);
    $('#etTgtField').classList.toggle('hidden', !tr);
    $('#etExceptionalField').classList.toggle('hidden', typeEl.value !== 'expense');
    if (tr) tgtEl.innerHTML = options(F.activeAccounts().filter(a => a.id !== t.account_id), t.transfer_account_id);
    else catEl.innerHTML = options(F.activeCategories(typeEl.value), t.category_id);
  };
  typeEl.onchange = sync; accEl.onchange = sync; sync();
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

// ---------------- Accounts (cash / bank / savings / investment) ----------------
function accountHasHistory(id) { return !!id && (state.fullTransactions || []).some(t => t.account_id === id || t.transfer_account_id === id); }
function openAccount(id = '') {
  const a = (state.accounts || []).find(x => x.id === id) || {};
  const locked = accountHasHistory(id);
  const types = [['cash', 'Tiền mặt'], ['bank', 'Ngân hàng'], ['savings', 'Tiết kiệm'], ['investment', 'Đầu tư']];
  modal(id ? 'Sửa tài khoản' : 'Thêm tài khoản', `<div class="form-grid">
    <div class="field full"><label>Tên tài khoản</label><input name="name" value="${esc(a.name || '')}" required autofocus></div>
    <div class="field"><label>Loại</label><select name="account_type" ${locked ? 'disabled' : ''}>${types.map(([v, l]) => `<option value="${v}" ${(a.account_type || 'bank') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${locked ? `<input type="hidden" name="account_type" value="${esc(a.account_type)}">` : ''}</div>
    <div class="field"><label>Tiền tệ</label><select name="currency" ${locked ? 'disabled' : ''}><option value="JPY" ${(a.currency || state.base) === 'JPY' ? 'selected' : ''}>JPY</option><option value="VND" ${(a.currency || state.base) === 'VND' ? 'selected' : ''}>VND</option></select>${locked ? `<input type="hidden" name="currency" value="${esc(a.currency || state.base)}">` : ''}</div>
    <div class="field full"><label>Số dư ban đầu</label><input name="opening_balance" type="number" step="1" value="${esc(a.opening_balance || 0)}" ${locked ? 'readonly' : ''}>${locked ? '<small>Đã có giao dịch nên không đổi số dư gốc để tránh lệch lịch sử.</small>' : ''}</div>
  </div>`, fd => api.core('save_account', { ...fd, id: id || null, opening_balance: locked ? a.opening_balance : fd.opening_balance }));
}
async function archiveAccount(id) {
  if (!confirm('Ẩn tài khoản này? Giao dịch cũ vẫn được giữ.')) return;
  try { await api.core('archive_account', { id }); await window.refresh(); toast('Đã ẩn tài khoản'); } catch (e) { toast(e.message, true); }
}
async function unarchiveAccount(id) {
  try { await api.core('unarchive_account', { id }); await window.refresh(); toast('Đã khôi phục tài khoản'); } catch (e) { toast(e.message, true); }
}
function openTransfer(fromId = '', toId = '') { openQuickEntry({ transaction_type: 'transfer', account_id: fromId, transfer_account_id: toId }); }

// ---------------- Investments ----------------
function openInvestmentAccount() {
  modal('Thêm tài khoản đầu tư', `<div class="form-grid">
    <div class="field full"><label>Tên tài khoản / tài sản</label><input name="name" placeholder="Ví dụ: NISA · S&P 500" required autofocus></div>
    <div class="field"><label>Tiền tệ</label><select name="currency"><option value="JPY" ${state.base === 'JPY' ? 'selected' : ''}>JPY</option><option value="VND" ${state.base === 'VND' ? 'selected' : ''}>VND</option></select></div>
    <div class="field"><label>Giá trị ban đầu</label><input name="opening_balance" type="number" min="0" step="1" value="0"></div>
  </div>`, fd => api.core('save_account', { ...fd, account_type: 'investment' }), 'Tạo tài khoản');
}
function openInvestmentTransfer(id, mode = 'in') {
  const target = F.accountById(id); if (!target) return toast('Không tìm thấy tài khoản đầu tư.', true);
  const cash = F.activeAccounts().find(a => a.id !== id && ['bank', 'cash', 'savings'].includes(a.account_type) && (a.currency || state.base) === (target.currency || state.base));
  if (!cash) return toast('Cần một tài khoản tiền mặt/ngân hàng cùng tiền tệ.', true);
  return mode === 'in'
    ? openQuickEntry({ transaction_type: 'transfer', account_id: cash.id, transfer_account_id: id, note: `Nạp vốn ${target.name}` })
    : openQuickEntry({ transaction_type: 'transfer', account_id: id, transfer_account_id: cash.id, note: `Rút vốn ${target.name}` });
}
function openInvestmentValue(id) {
  const a = F.investmentAccounts().find(x => x.id === id); if (!a) return toast('Không tìm thấy tài khoản đầu tư.', true);
  const current = F.accountBalance(a);
  modal('Cập nhật giá trị đầu tư', `<div class="form-grid">
    <div class="field full"><label>${esc(a.name)}</label><input value="${esc(money(current, a.currency))}" disabled><small>Chênh lệch được ghi là lãi/lỗ đầu tư, không tính vào lương hay chi tiêu.</small></div>
    <div class="field"><label>Giá trị hiện tại mới</label><input name="new_value" type="number" min="0" step="1" value="${Math.max(0, current)}" required autofocus></div>
    <div class="field"><label>Ngày định giá</label><input name="transaction_date" type="date" value="${localToday()}" required></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="Cập nhật giá trị ${esc(a.name)}"></div>
  </div>`, async fd => {
    const delta = n(fd.new_value) - current; if (Math.abs(delta) < 1) return;
    await api.investment('adjust', { account_id: id, direction: delta >= 0 ? 'gain' : 'loss', amount: Math.abs(delta), transaction_date: fd.transaction_date, note: fd.note || '' });
  }, 'Cập nhật');
}
// A valuation entered wrong had no way to be removed — openTransactionEdit
// deliberately refuses investment_gain/investment_loss rows and points here
// instead, but nothing here ever existed to catch that redirect. Mirrors
// openCardTransactions: full history (not just this month, valuations are
// sporadic), each row deletable in place.
async function deleteTransactionFromInvestmentList(id, accountId) {
  if (!confirm('Xóa lần định giá này?')) return;
  try {
    await api.core('delete_transaction', { id });
    await window.refresh();
    toast('Đã xóa');
    openInvestmentHistory(accountId);
  } catch (e) { toast(e.message, true); }
}
function openInvestmentHistory(id) {
  const a = F.investmentAccounts().find(x => x.id === id); if (!a) return toast('Không tìm thấy tài khoản đầu tư.', true);
  const rows = (state.fullTransactions || []).filter(t => t.account_id === id && F.isInvestmentAdjustment(t))
    .sort((x, y) => String(y.transaction_date).localeCompare(String(x.transaction_date)));
  const list = rows.map(t => `<div class="tx"><div class="tx-main">
      <strong class="${t.transaction_type === 'investment_gain' ? 'green' : 'red'}">${t.transaction_type === 'investment_gain' ? '+' : '−'}${money(t.amount, t.currency)}</strong>
      <span>${esc(String(t.transaction_date).slice(0, 10))}${t.note ? ` · ${esc(t.note)}` : ''}</span></div>
      <div class="tx-actions"><button class="mini-btn" aria-label="Xóa" ${act('deleteTransactionFromInvestmentList', t.id, id)}>×</button></div>
    </div>`).join('');
  infoModal(`Lịch sử định giá · ${esc(a.name)}`, `
    <div class="list">${list || '<div class="empty compact">Chưa có lần định giá nào.</div>'}</div>
    <button class="btn primary mt-14" ${act('reopenAfterModal', 'openInvestmentValue', id)}>＋ Định giá mới</button>`);
}

// ---------------- Loans (personal + bank, unified) ----------------
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
    ${isNew ? `<div class="field"><label>Tài khoản nhận/chi tiền</label><select name="funding_account_id" id="loanFunding"><option value="">— Chỉ ghi dư nợ —</option></select></div>` : `<div class="field"><label>Dư còn lại</label><input value="${esc(money(l.remaining_amount || 0, currency))}" disabled><input type="hidden" name="remaining_amount" value="${esc(l.remaining_amount || 0)}"></div>`}
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
      // Single atomic call: creates/updates the loan row + loan_terms + optional
      // opening disbursement, with its own locking rules once linked to history.
      await api.bankLoan('save', {
        loan_id: id || null, counterparty: fd.counterparty, principal: fd.principal, currency: fd.currency,
        annual_rate: fd.annual_rate, repayment_method: fd.repayment_method, term_months: fd.term_months, payment_day: fd.payment_day,
        start_date: fd.start_date, due_date: fd.due_date, note: fd.note || '', funding_account_id: isNew ? (fd.funding_account_id || null) : null
      });
      return;
    }
    fd.loan_type = fd.loan_type || 'borrowed';
    const saved = await api.core('save_loan', { id: id || null, counterparty: fd.counterparty, loan_type: fd.loan_type, principal: fd.principal, remaining_amount: isNew ? fd.principal : l.remaining_amount, currency: fd.currency, start_date: fd.start_date, due_date: fd.due_date, note: fd.note || '' });
    if (isNew && fd.funding_account_id) await api.debt('open', { loan_id: saved.id, account_id: fd.funding_account_id, amount: fd.principal, transaction_date: fd.start_date || localToday(), note: fd.note || '' });
  });
  const kindEl = $('#loanKind'), curEl = $('#loanCurrency'), fundEl = $('#loanFunding'), bankBox = $('#bankFields');
  const sync = () => {
    const kind = kindEl?.value || initialKind;
    bankBox.classList.toggle('hidden', kind !== 'bank');
    if (fundEl) fundEl.innerHTML = '<option value="">— Chỉ ghi dư nợ —</option>' + options(F.activeAccounts().filter(a => (a.currency || state.base) === (curEl?.value || currency) && ['cash', 'bank', 'savings'].includes(a.account_type)), F.defaultMoneyAccountId(), a => `${a.name} · ${a.currency}`);
  };
  if (kindEl) kindEl.onchange = sync; if (curEl) curEl.onchange = sync; sync();
}
// Returns true only once the loan is actually gone — callers that have a
// modal open on top (e.g. the debt column manager list) use this to decide
// whether to close/refresh it, instead of doing so unconditionally.
async function deleteLoan(id) {
  const linked = (state.fullTransactions || []).some(t => t.loan_id === id);
  if (linked) { toast('Khoản này đã có lịch sử nên không xóa trực tiếp. Hãy tất toán để giữ đúng lịch sử tài sản.', true); return false; }
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

// ---------------- Credit cards ----------------
function paymentAccountOptions(currency, selected = '') {
  const rows = F.activeAccounts().filter(a => ['cash', 'bank', 'savings'].includes(a.account_type) && (a.currency || state.base) === currency);
  return '<option value="">— Chọn sau cũng được —</option>' + options(rows, selected, a => `${a.name} · ${a.currency}`);
}
function openCreditCard() {
  const cats = F.activeCategories('expense');
  modal('Thêm thẻ tín dụng', `<div class="note"><b>Thẻ tín dụng là chi trước, trả sau.</b> Nếu đang có khoản đã tiêu ở kỳ trước phải trả trong tháng đang xem, nhập ở dưới; app xếp đúng vào kỳ thanh toán.</div>
  <div class="form-grid">
    <div class="field full"><label>Tên thẻ</label><input name="name" placeholder="VD: Rakuten" required autofocus></div>
    <div class="field"><label>Tiền tệ</label><select id="ccCurrency" name="currency"><option value="JPY" ${state.base === 'JPY' ? 'selected' : ''}>JPY</option><option value="VND" ${state.base === 'VND' ? 'selected' : ''}>VND</option></select></div>
    <div class="field"><label>Ngày chốt</label><input name="closing_day" type="number" min="1" max="31" value="10" required></div>
    <div class="field"><label>Ngày thanh toán</label><input name="payment_day" type="number" min="1" max="31" value="27" required></div>
    <div class="field"><label>Thanh toán vào</label><select name="payment_month_offset"><option value="1">Tháng sau</option><option value="2">Sau 2 tháng</option></select></div>
    <div class="field full"><label>Trừ từ tài khoản</label><select id="ccPayAccount" name="payment_account_id"></select></div>
    <div class="field full"><label>Đã chi ở kỳ trước · cần trả trong ${esc(fmtMonthKey(state.month))}</label><input name="current_due_amount" type="number" min="0" step="1" value="0"><small>VD tháng trước đã dùng ¥80.000 và tháng này bị trừ ¥80.000 thì nhập 80000.</small></div>
    <div class="field full"><label>Danh mục của khoản đã chi kỳ trước</label><select name="current_due_category_id" ${cats.length ? '' : 'disabled'}>${options(cats, cats[0]?.id)}</select></div>
  </div>`, async fd => {
    const due = n(fd.current_due_amount || 0);
    if (due > 0 && !fd.current_due_category_id) throw new Error('Hãy chọn danh mục cho khoản đã chi kỳ trước.');
    const saved = await api.core('save_account', { name: fd.name, account_type: 'credit', currency: fd.currency, opening_balance: 0 });
    await api.card('save', { account_id: saved.id, closing_day: fd.closing_day, payment_day: fd.payment_day, payment_month_offset: fd.payment_month_offset, payment_account_id: fd.payment_account_id || null });
    if (due > 0) {
      const transaction_date = seedStatementDate(state.month, fd.payment_month_offset, fd.closing_day);
      await api.core('save_transaction', { transaction_type: 'expense', amount: due, currency: fd.currency, fx_rate: 1, transaction_date, account_id: saved.id, transfer_account_id: null, category_id: fd.current_due_category_id, note: `Kỳ thẻ trước · trả ${state.month}` });
    }
  }, 'Tạo thẻ');
  const cur = $('#ccCurrency'), pay = $('#ccPayAccount');
  const sync = () => pay.innerHTML = paymentAccountOptions(cur.value || state.base);
  cur.onchange = sync; sync();
}
function openCardSettings(id) {
  const card = F.cardAccounts().find(x => x.id === id); if (!card) return toast('Không tìm thấy thẻ.', true);
  const s = F.settingFor(id) || {}, sources = F.activeAccounts().filter(a => a.id !== id && ['cash', 'bank', 'savings'].includes(a.account_type) && (a.currency || state.base) === (card.currency || state.base));
  const selected = s.payment_account_id && sources.some(x => x.id === s.payment_account_id) ? s.payment_account_id : (sources[0]?.id || '');
  modal(`Chu kỳ · ${esc(card.name)}`, `<div class="form-grid">
    <div class="field"><label>Ngày chốt</label><input name="closing_day" type="number" min="1" max="31" value="${esc(s.closing_day || 10)}" required></div>
    <div class="field"><label>Ngày trừ tiền</label><input name="payment_day" type="number" min="1" max="31" value="${esc(s.payment_day || 27)}" required></div>
    <div class="field"><label>Thanh toán</label><select name="payment_month_offset"><option value="1" ${n(s.payment_month_offset || 1) === 1 ? 'selected' : ''}>Tháng sau</option><option value="2" ${n(s.payment_month_offset) === 2 ? 'selected' : ''}>Sau 2 tháng</option></select></div>
    <div class="field"><label>Trừ từ tài khoản</label><select name="payment_account_id">${paymentAccountOptions(card.currency || state.base, selected)}</select></div>
  </div>`, fd => api.card('save', { ...fd, account_id: id }), 'Lưu chu kỳ');
}

// ---------------- Card spending (a card is a payment account, not a category) ----------------
// A card purchase is a normal expense against a real category (Ăn uống,
// Mua sắm...), exactly like cash or bank — it counts in Chi cố định/Chi
// biến động like any other spending. openQuickEntry already supports any
// account type (including credit — see txAccountsFor), so this is just that
// form pre-scoped to one card instead of a separate parallel system.
function openCardExpense(cardId) {
  const card = F.cardAccounts().find(a => a.id === cardId); if (!card) return toast('Không tìm thấy thẻ.', true);
  return openQuickEntry({ transaction_type: 'expense', account_id: cardId });
}
async function deleteTransactionFromCardList(id, cardId) {
  if (!confirm('Xóa giao dịch này?')) return;
  try {
    await api.core('delete_transaction', { id });
    await window.refresh();
    toast('Đã xóa giao dịch');
    openCardTransactions(cardId);
  } catch (e) { toast(e.message, true); }
}
// This month's card purchases, listed for edit/delete — same list pattern
// as a category's transaction list, just filtered to one account.
function openCardTransactions(cardId) {
  const card = F.cardAccounts().find(a => a.id === cardId); if (!card) return toast('Không tìm thấy thẻ.', true);
  const rows = (state.transactions || []).filter(t => t.transaction_type === 'expense' && t.account_id === cardId)
    .sort((a, b) => String(b.transaction_date).localeCompare(String(a.transaction_date)));
  const list = rows.map(t => `<div class="tx"><button class="tx-row-btn" ${act('openTransactionEdit', t.id)}>
      <div class="tx-main"><strong>${money(t.amount, t.currency)}</strong><span>${esc(t.category_name || 'Chưa phân loại')} · ${esc(String(t.transaction_date).slice(0, 10))}${t.note ? ` · ${esc(t.note)}` : ''}</span></div>
      </button>
      <div class="tx-actions"><button class="mini-btn" aria-label="Xóa" ${act('deleteTransactionFromCardList', t.id, cardId)}>×</button></div>
    </div>`).join('');
  infoModal(`Chi tiêu · ${esc(card.name)} · Tháng ${fmtMonthKey(state.month)}`, `
    <div class="list">${list || '<div class="empty compact">Chưa có giao dịch nào.</div>'}</div>
    <button class="btn primary mt-14" ${act('reopenAfterModal', 'openCardExpense', cardId)}>＋ Thêm giao dịch</button>`);
}

function openInstallment() {
  const cards = F.configuredCards();
  // No card set up yet? Don't dead-end — open the "add card" form directly
  // instead of just refusing (that form also covers PayPay/AuPay/"ngân
  // hàng ABC" style entries, since it's just a name + a payment cycle).
  if (!cards.length) { toast('Chưa có thẻ nào — hãy thêm một thẻ trước.', true); return reopenAfterModal('openCreditCard'); }
  const cats = F.activeCategories('expense'); if (!cats.length) return toast('Hãy tạo danh mục chi trước.', true);
  modal('Thêm khoản trả góp', `<div class="note"><b>Nguyên tắc:</b> toàn bộ giá mua ghi chi tại ngày mua. Mỗi tháng chỉ trả nghĩa vụ; phí trả góp mới là chi phí phát sinh thêm.</div>
  <div class="form-grid">
    <div class="field full"><label>Tên khoản</label><input name="name" placeholder="VD: iPhone / Máy giặt" required autofocus></div>
    <div class="field"><label>Loại khoản</label><select name="entry_mode"><option value="purchase">Mua mới</option><option value="existing">Đang trả dở</option></select></div>
    <div class="field"><label>Lịch thanh toán</label><select name="schedule_mode"><option value="equal">Đều hàng tháng</option><option value="custom">Từng tháng / Bonus</option></select></div>
    <div class="field"><label>Thẻ</label><div class="row-6"><select name="card_account_id" required>${options(cards, cards[0].id, a => `${a.name} · ${a.currency}`)}</select><button type="button" class="mini-btn" aria-label="Thêm thẻ mới" title="Thêm thẻ khác (Rakuten, PayPay, AuPay, ngân hàng...)" ${act('reopenAfterModal', 'openCreditCard')}>＋</button></div></div>
    <div class="field"><label>Giá mua / gốc</label><input name="principal_amount" type="number" min="1" step="1" required></div>
    <div class="field"><label>Tổng số kỳ</label><input id="instTotal" name="total_installments" type="number" min="2" max="60" value="12" required></div>
    <div class="field"><label>Phí/lãi tổng</label><input name="fee_total" type="number" min="0" step="1" value="0"></div>
    <div class="field"><label>Ngày mua</label><input name="purchase_date" type="date" value="${localToday()}" required></div>
    <div class="field"><label>Danh mục</label><select name="category_id" required>${options(cats, cats[0].id)}</select></div>
    <div id="instExisting" class="field full hidden"><div class="form-grid"><div class="field"><label>Đã trả bao nhiêu kỳ</label><input name="paid_installments_before" type="number" min="0" max="59" value="0"></div><div class="field"><label>Bắt đầu trả tiếp từ tháng</label><input name="next_payment_month" type="month" value="${esc(state.month)}"></div></div></div>
    <div id="instCustom" class="field full hidden"><div class="stack" id="instRows"></div><button type="button" class="btn sm mt-8" id="instGenerate">Tạo / làm lại lịch</button><div id="instSummary" class="muted mt-6 text-sm"></div></div>
    <div class="field full"><label>Ghi chú</label><input name="note" placeholder="Tùy chọn"></div>
  </div>`, async fd => {
    const payload = { ...fd, paid_installments_before: fd.entry_mode === 'existing' ? n(fd.paid_installments_before || 0) : 0, next_payment_month: fd.entry_mode === 'existing' && fd.schedule_mode === 'equal' && fd.next_payment_month ? `${fd.next_payment_month}-01` : null };
    if (fd.schedule_mode === 'custom') {
      if (!$$('#instRows [data-row]').length) generateInstallmentRows();
      payload.schedule = $$('#instRows [data-row]').map(r => ({ payment_month: `${r.querySelector('[data-month]').value}-01`, principal_amount: n(r.querySelector('[data-principal]').value), fee_amount: n(r.querySelector('[data-fee]').value), payment_kind: r.querySelector('[data-kind]').value }));
    }
    await api.cardPlan('create', payload);
  }, 'Lưu lịch trả góp');
  const entryEl = $('[name="entry_mode"]', $('#modalBody')), scheduleEl = $('[name="schedule_mode"]', $('#modalBody'));
  function form() {
    return {
      entry: entryEl.value, schedule: scheduleEl.value,
      total: n($('[name="total_installments"]', $('#modalBody')).value),
      paid: n($('[name="paid_installments_before"]', $('#modalBody'))?.value || 0),
      principal: n($('[name="principal_amount"]', $('#modalBody')).value),
      fee: n($('[name="fee_total"]', $('#modalBody')).value),
      purchaseDate: $('[name="purchase_date"]', $('#modalBody')).value,
      nextMonth: $('[name="next_payment_month"]', $('#modalBody'))?.value || state.month,
      card: $('[name="card_account_id"]', $('#modalBody')).value
    };
  }
  function firstPaymentMonth(cardId, purchaseDate) {
    const s = F.settingFor(cardId); if (!s) return state.month;
    const [y, m, d] = String(purchaseDate).slice(0, 10).split('-').map(Number);
    const last = new Date(y, m, 0).getDate(), close = Math.min(n(s.closing_day || 31), last);
    const extra = d > close ? 1 : 0;
    return addMonths(`${y}-${String(m).padStart(2, '0')}`, extra + n(s.payment_month_offset || 1));
  }
  window.generateInstallmentRows = function generateInstallmentRows() {
    const s = form(), box = $('#instRows');
    if (!s.total || s.total < 2) return toast('Nhập tổng số kỳ trước.', true);
    if (s.principal <= 0) return toast('Nhập giá mua trước.', true);
    const remain = s.total - (s.entry === 'existing' ? s.paid : 0);
    const start = s.entry === 'purchase' ? firstPaymentMonth(s.card, s.purchaseDate) : s.nextMonth;
    const baseP = Math.trunc(s.principal / s.total), baseF = Math.trunc(s.fee / s.total);
    let html = '';
    for (let j = 0; j < remain; j++) {
      const no = (s.entry === 'existing' ? s.paid : 0) + j + 1;
      const p = no < s.total ? baseP : s.principal - baseP * (s.total - 1);
      const f = no < s.total ? baseF : s.fee - baseF * (s.total - 1);
      const month = addMonths(start, j);
      html += `<div data-row class="installment-row"><span class="muted">#${no}</span><input data-month type="month" value="${month}" required><input data-principal type="number" min="0" step="1" value="${p}" required><input data-fee type="number" min="0" step="1" value="${f}" required><select data-kind><option value="regular">Thường</option><option value="bonus">Bonus</option></select></div>`;
    }
    box.innerHTML = html;
    box.addEventListener('input', updateInstallmentSummary);
    updateInstallmentSummary();
  };
  // Mua mới: backend requires the rows' gốc/phí to sum to EXACTLY
  // principal_amount/fee_total (custom_principal_total_mismatch /
  // custom_fee_total_mismatch) — so when you hand-edit a bonus month up,
  // the fix isn't obvious from a plain running total. Show the gap live.
  // Đang trả dở only requires the total to not exceed the original price
  // (remaining_principal_exceeds_original), which is a looser check.
  function updateInstallmentSummary() {
    const rows = $$('#instRows [data-row]');
    const p = rows.reduce((s, r) => s + n(r.querySelector('[data-principal]').value), 0);
    const f = rows.reduce((s, r) => s + n(r.querySelector('[data-fee]').value), 0);
    const s = form(), isNew = s.entry === 'purchase';
    const diffP = s.principal - p;
    const okP = isNew ? Math.abs(diffP) < 1 : diffP >= -0.5;
    const pLine = okP
      ? `<span class="green">Gốc ${money(p)} ✓ khớp giá mua</span>`
      : `<span class="red">Gốc ${money(p)} — ${isNew ? `${diffP > 0 ? 'còn thiếu' : 'đang thừa'} ${money(Math.abs(diffP))} so với giá mua ${money(s.principal)}` : `vượt giá mua ban đầu ${money(s.principal)}`}</span>`;
    let feeLine = '';
    if (isNew) {
      const diffF = s.fee - f, okF = Math.abs(diffF) < 1;
      feeLine = ` · ${okF ? `<span class="green">phí ${money(f)} ✓</span>` : `<span class="red">phí ${money(f)} — ${diffF > 0 ? 'còn thiếu' : 'đang thừa'} ${money(Math.abs(diffF))}</span>`}`;
    } else if (f > 0) {
      feeLine = ` · phí ${money(f)}`;
    }
    $('#instSummary').innerHTML = `${pLine}${feeLine} · ${rows.length} kỳ`;
  }
  const sync = () => {
    $('#instExisting').classList.toggle('hidden', entryEl.value !== 'existing');
    $('#instCustom').classList.toggle('hidden', scheduleEl.value !== 'custom');
  };
  entryEl.onchange = sync; scheduleEl.onchange = sync; sync();
  $('#instGenerate').onclick = window.generateInstallmentRows;
}
function openStatementPayment(id) {
  const card = F.cardAccounts().find(x => x.id === id); if (!card) return toast('Không tìm thấy thẻ.', true);
  const s = F.settingFor(id); if (!s) return openCardSettings(id);
  const overview = F.cardMonthFor(id);
  if (!overview || n(overview.expected_amount) <= 0) return openCreditPayment(id);
  const sources = F.activeAccounts().filter(a => a.id !== id && ['cash', 'bank', 'savings'].includes(a.account_type) && (a.currency || state.base) === (card.currency || state.base));
  if (!sources.length) return toast(`Cần tài khoản ${card.currency} để thanh toán thẻ.`, true);
  const selected = s.payment_account_id && sources.some(x => x.id === s.payment_account_id) ? s.payment_account_id : sources[0].id;
  const cats = F.activeCategories('expense');
  const feeCat = cats.find(c => /phí|lãi|fee/i.test(c.name))?.id || cats[0]?.id || '';
  modal(`Thanh toán · ${esc(card.name)}`, `<div class="balance-card"><span>Kỳ thanh toán</span><strong>${esc(money(overview.expected_amount, card.currency))}</strong></div>
  <div class="stat-row-3">
    <div>Chi thường<br><b>${esc(money(overview.regular_amount, card.currency))}</b></div>
    <div>Gốc trả góp<br><b>${esc(money(overview.installment_principal, card.currency))}</b></div>
    <div>Phí trả góp<br><b>${esc(money(overview.installment_fee, card.currency))}</b></div>
  </div>
  <div class="field"><label>Số tiền thực tế bị trừ</label><input name="amount" type="number" min="1" step="1" value="${esc(overview.expected_amount)}" required autofocus></div>
  <div class="form-grid mt-10">
    <div class="field"><label>Trừ từ</label><select name="payment_account_id" required>${options(sources, selected, a => `${a.name} · ${a.currency}`)}</select></div>
    <div class="field"><label>Ngày thực trả</label><input name="transaction_date" type="date" value="${localToday()}" required></div>
    ${n(overview.installment_fee) ? `<div class="field full"><label>Danh mục cho phí trả góp ${esc(money(overview.installment_fee, card.currency))}</label><select name="fee_category_id" required>${options(cats, feeCat)}</select></div>` : '<input type="hidden" name="fee_category_id" value="">'}
    <div class="field full"><label>Ghi chú</label><input name="note" value="Thanh toán ${esc(card.name)}"></div>
  </div>
  <small class="muted">Khoản chuyển trả gốc/chi thẻ không tính chi lần hai. Chỉ phí trả góp được ghi thêm vào chi phí.</small>`,
  fd => api.card('pay_statement', { ...fd, account_id: id, payment_month: `${state.month}-01` }), 'Xác nhận thanh toán');
}
function openCreditPayment(id) {
  const target = F.accountById(id); if (!target) return toast('Không tìm thấy tài khoản nợ.', true);
  const debt = Math.max(0, -F.accountBalance(target)); if (!debt) return toast('Tài khoản này hiện không có dư nợ.');
  const sources = F.activeAccounts().filter(a => a.id !== id && ['bank', 'cash', 'savings'].includes(a.account_type) && (a.currency || state.base) === (target.currency || state.base));
  if (!sources.length) return toast(`Cần tài khoản ${target.currency} để thanh toán.`, true);
  modal(`Thanh toán ${esc(target.name)}`, `<div class="form-grid">
    <div class="field"><label>Số tiền</label><input name="amount" type="number" min="1" max="${debt}" value="${debt}" required autofocus></div>
    <div class="field"><label>Trả từ</label><select name="account_id" required>${options(sources, sources[0].id, a => `${a.name} · ${a.currency}`)}</select></div>
    <div class="field"><label>Ngày</label><input name="transaction_date" type="date" value="${localToday()}" required></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="Thanh toán ${esc(target.name)}"></div>
  </div>`, fd => api.core('save_transaction', { transaction_type: 'transfer', amount: fd.amount, currency: target.currency || state.base, fx_rate: 1, transaction_date: fd.transaction_date, account_id: fd.account_id, transfer_account_id: id, category_id: null, note: fd.note || '' }), 'Thanh toán');
}

// ---------------- Allocation plan (monthly % targets) ----------------
const ALLOC_DEFS = [
  { key: 'fixed', pct: 'fixed_pct', label: 'Chi cố định' },
  { key: 'variable', pct: 'variable_pct', label: 'Chi biến động' },
  { key: 'loanInterest', pct: 'interest_pct', label: 'Lãi / phí vay' },
  { key: 'saving', pct: 'saving_pct', label: 'Tiết kiệm' },
  { key: 'investment', pct: 'investment_pct', label: 'Đầu tư' },
  { key: 'debtPay', pct: 'debt_pct', label: 'Trả nợ gốc' }
];
function openAllocationPlan() {
  const p = state.allocationPlan && monthKey(state.allocationPlan.month) === state.month ? state.allocationPlan : { fixed_pct: 0, variable_pct: 0, interest_pct: 0, saving_pct: 0, investment_pct: 0, debt_pct: 0 };
  modal(`Chỉ tiêu tháng ${fmtMonthKey(state.month)}`, `<p class="note">Tổng 6 mục tối đa 100% thu nhập. Phần còn lại tự động là dự phòng. Tháng sau tự kế thừa cho tới khi bạn đổi.</p>
  <div class="form-grid" id="allocForm">${ALLOC_DEFS.map(d => `<div class="field"><label>${esc(d.label)}</label><div class="row-6"><input name="${d.pct}" type="number" min="0" max="100" step="0.1" value="${n(p[d.pct])}" required><span class="muted">%</span></div></div>`).join('')}
    <div class="field full"><div class="balance-card"><span>Đã phân bổ</span><strong id="allocTotal">0%</strong><span>Dự phòng</span><strong id="allocReserve">100%</strong></div></div>
  </div>`, fd => api.allocation('save_month', { month: `${state.month}-01`, ...fd }), 'Lưu chỉ tiêu');
  const inputs = $$('#allocForm input[type=number]'), total = $('#allocTotal'), reserve = $('#allocReserve'), submit = $('#modalForm [type=submit]');
  const sync = () => { const sum = inputs.reduce((s, x) => s + n(x.value), 0); total.textContent = `${sum.toFixed(1)}%`; total.classList.toggle('red', sum > 100); reserve.textContent = `${Math.max(0, 100 - sum).toFixed(1)}%`; submit.disabled = sum > 100; };
  inputs.forEach(x => x.addEventListener('input', sync)); sync();
}

Object.assign(window, {
  openQuickEntry, openTransactionEdit, deleteTransaction, openColumnSettings, openAccount, archiveAccount, openTransfer,
  openInvestmentAccount, openInvestmentTransfer, openInvestmentValue, openLoan, deleteLoan, openLoanPayment, openBankPayment,
  openCreditCard, openCardSettings, openInstallment, openStatementPayment, openCreditPayment, openAllocationPlan,
  forgetDevice, copyPrivateLink
});
