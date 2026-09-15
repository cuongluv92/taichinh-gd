// ==========================================================================
// Giao dịch — every transaction in one place, filterable, with visible
// (labeled, not just "×") Sửa/Xóa actions. Edit/delete used to be reachable
// only per-category or per-account (and hidden behind a 📋 icon for cards);
// this is the one list that always works, whatever the transaction.
// ==========================================================================
'use strict';

const TX_TYPE_LABEL = { income: 'Thu', expense: 'Chi', transfer: 'Chuyển khoản' };
let txFilters = { type: '', category_id: '', account_id: '', from: '', to: '' };
let showDeleted = false;
let deletedTxCache = null; // null = not loaded yet; loaded lazily on toggle

function txFilterRows() {
  const month = state.month;
  let rows = (txFilters.from || txFilters.to)
    ? (state.fullTransactions || []).filter(t => ['income', 'expense', 'transfer'].includes(t.transaction_type))
    : (state.transactions || []).filter(t => ['income', 'expense', 'transfer'].includes(t.transaction_type));
  if (!txFilters.from && !txFilters.to) rows = rows.filter(t => monthKey(t.transaction_date) === month);
  if (txFilters.from) rows = rows.filter(t => String(t.transaction_date) >= txFilters.from);
  if (txFilters.to) rows = rows.filter(t => String(t.transaction_date) <= txFilters.to);
  if (txFilters.type) rows = rows.filter(t => t.transaction_type === txFilters.type);
  if (txFilters.category_id) rows = rows.filter(t => t.category_id === txFilters.category_id);
  if (txFilters.account_id) rows = rows.filter(t => t.account_id === txFilters.account_id || t.transfer_account_id === txFilters.account_id);
  return rows.sort((a, b) => String(b.transaction_date).localeCompare(String(a.transaction_date)) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function txRowHtml(t) {
  const tone = txTone(t), sign = tone === 'positive' ? '+' : tone === 'negative' ? '−' : '';
  const cls = tone === 'positive' ? 'green' : tone === 'negative' ? 'red' : '';
  const acc = F.accountById(t.account_id);
  const desc = t.transaction_type === 'transfer'
    ? `${t.account_name || ''} → ${t.transfer_account_name || ''}`
    : `${t.category_name || 'Chưa phân loại'}${acc?.account_type === 'credit' ? ` · ${acc.name}` : ''}`;
  return `<div class="tx">
    <button class="tx-row-btn" ${act('openTransactionEdit', t.id)}>
      <div class="tx-icon">${TX_TYPE_LABEL[t.transaction_type][0]}</div>
      <div class="tx-main"><strong>${esc(String(t.transaction_date).slice(0, 10))} · ${esc(TX_TYPE_LABEL[t.transaction_type])}</strong>
        <span>${esc(desc)}${t.account_name && t.transaction_type !== 'transfer' ? ` · ${esc(t.account_name)}` : ''}${t.note ? ` · ${esc(t.note)}` : ''}${F.isExceptional(t) ? ' <span class="status-chip warn">Bất thường</span>' : ''}</span>
      </div>
    </button>
    <div class="tx-actions">
      <strong class="amount ${cls}">${sign}${money(t.amount, t.currency)}</strong>
      <button class="btn sm" ${act('openTransactionEdit', t.id)}>Sửa</button>
      <button class="btn sm" ${act('deleteTransaction', t.id)}>Xóa</button>
    </div>
  </div>`;
}

function deletedTxRowHtml(t) {
  const acc = F.accountById(t.account_id);
  const desc = t.transaction_type === 'transfer'
    ? `${t.account_name || ''} → ${t.transfer_account_name || ''}`
    : `${t.category_name || 'Chưa phân loại'}${acc?.account_type === 'credit' ? ` · ${acc.name}` : ''}`;
  return `<div class="tx">
    <div class="tx-main"><strong>${esc(String(t.transaction_date).slice(0, 10))} · ${esc(TX_TYPE_LABEL[t.transaction_type] || t.transaction_type)}</strong>
      <span>${esc(desc)}${t.note ? ` · ${esc(t.note)}` : ''} · Đã xóa ${esc(String(t.deleted_at || '').slice(0, 16).replace('T', ' '))}</span>
    </div>
    <div class="tx-actions"><strong class="amount muted">${money(t.amount, t.currency)}</strong><button class="btn sm" ${act('restoreTransaction', t.id)}>Khôi phục</button></div>
  </div>`;
}

function renderTransactions() {
  const rows = txFilterRows();
  const cats = [...F.orderedCategories('income'), ...F.orderedCategories('expense')];
  const accounts = F.activeAccounts();
  const totalIn = rows.filter(t => t.transaction_type === 'income').reduce((s, t) => s + n(t.amount), 0);
  const totalOut = rows.filter(t => t.transaction_type === 'expense').reduce((s, t) => s + n(t.amount), 0);
  return `<div class="view-head"><div><h2>Giao dịch</h2><p>Toàn bộ thu, chi, chuyển khoản — lọc, sửa, xóa tại đây.</p></div>
    <button class="btn primary" ${act('openQuickEntry')}>＋ Nhập nhanh</button></div>
  <section class="card section">
    <div class="form-grid">
      <div class="field"><label>Loại</label><select id="txfType">
        <option value="">Tất cả</option>
        <option value="income" ${txFilters.type === 'income' ? 'selected' : ''}>Thu</option>
        <option value="expense" ${txFilters.type === 'expense' ? 'selected' : ''}>Chi</option>
        <option value="transfer" ${txFilters.type === 'transfer' ? 'selected' : ''}>Chuyển khoản</option>
      </select></div>
      <div class="field"><label>Danh mục</label><select id="txfCategory"><option value="">Tất cả</option>${options(cats, txFilters.category_id)}</select></div>
      <div class="field"><label>Tài khoản / Thẻ</label><select id="txfAccount"><option value="">Tất cả</option>${options(accounts, txFilters.account_id, a => `${a.name} · ${a.currency}`)}</select></div>
      <div class="field"><label>Từ ngày</label><input id="txfFrom" type="date" value="${esc(txFilters.from)}"></div>
      <div class="field"><label>Đến ngày</label><input id="txfTo" type="date" value="${esc(txFilters.to)}"></div>
      <div class="field"><label>&nbsp;</label><button class="btn" id="txfReset" type="button">Xóa bộ lọc</button></div>
    </div>
    <p class="note mt-10">${txFilters.from || txFilters.to ? 'Đang lọc theo khoảng ngày (bỏ qua tháng đang chọn ở trên).' : `Đang xem tháng ${fmtMonthKey(state.month)}.`} ${rows.length} giao dịch · Thu ${money(totalIn)} · Chi ${money(totalOut)}</p>
  </section>
  <section class="card section mt-16">
    ${rows.length ? `<div class="list">${rows.map(txRowHtml).join('')}</div>` : '<div class="empty">Chưa có giao dịch thực tế phù hợp bộ lọc.</div>'}
  </section>
  <section class="card section mt-16">
    <div class="section-head"><div><h2>Giao dịch đã xóa</h2><p>Xóa là xóa mềm — luôn khôi phục lại được.</p></div>
      <button class="btn sm" id="txfToggleDeleted">${showDeleted ? 'Ẩn bớt' : 'Xem giao dịch đã xóa'}</button></div>
    ${showDeleted ? (deletedTxCache === null ? '<div class="empty compact">Đang tải...</div>' : (deletedTxCache.length ? `<div class="list">${deletedTxCache.map(deletedTxRowHtml).join('')}</div>` : '<div class="empty compact">Chưa xóa giao dịch nào gần đây.</div>')) : ''}
  </section>`;
}

function wireTransactionsView() {
  const bind = (id, key) => { const el = $(id); if (el) el.onchange = () => { txFilters[key] = el.value; window.render(); }; };
  bind('#txfType', 'type'); bind('#txfCategory', 'category_id'); bind('#txfAccount', 'account_id');
  bind('#txfFrom', 'from'); bind('#txfTo', 'to');
  const reset = $('#txfReset');
  if (reset) reset.onclick = () => { txFilters = { type: '', category_id: '', account_id: '', from: '', to: '' }; window.render(); };
  const toggle = $('#txfToggleDeleted');
  if (toggle) toggle.onclick = async () => {
    showDeleted = !showDeleted;
    if (showDeleted && deletedTxCache === null) {
      window.render();
      try { deletedTxCache = (await api.core('deleted_transactions')).items || []; }
      catch (e) { deletedTxCache = []; toast(e.message, true); }
    }
    window.render();
  };
}
// A restore drops the cache so the next open of this list reflects it,
// instead of showing a row that's already back.
function invalidateDeletedTxCache() { deletedTxCache = null; }

Object.assign(window, { renderTransactions, wireTransactionsView });
