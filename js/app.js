// ==========================================================================
// Boot, data orchestration, router.
// ==========================================================================
'use strict';

function applyBootstrap(d) {
  state.household = d.household || {};
  state.base = state.household.base_currency || 'JPY';
  state.accounts = d.accounts || [];
  state.categories = d.categories || [];
  state.categoryVersions = d.category_versions || [];
  state.transactions = d.transactions || [];
  $('#familyNameSide').textContent = state.household.name || 'Gia đình';
}

async function loadExtras(month = state.month) {
  const [ext, exceptional, adjustments, cardExpenses, installments, investments, debts, recurring] = await Promise.all([
    api.extension('get'),
    api.exceptional('list'),
    api.accountAdjustment('list'),
    api.cardLedger('list_expenses'),
    api.cardLedger('list_installments'),
    api.investment('list'),
    api.debtLedger('list'),
    api.recurringAccount('list', { month: monthDate(month) })
  ]);
  state.reporting = { show_vnd_conversion: false, jpy_vnd_rate: null, ...(ext?.reporting || {}) };
  // Cài đặt → "Thiết bị đăng nhập" reads straight off this — extension.get
  // already runs on every boot/refresh/month-change, so the list (and this
  // device's own revocation check, handled in callRpc) stays current
  // without a dedicated action.
  state.deviceSessions = ext?.device_sessions || [];
  state.exceptionalIds = exceptional?.ids || [];
  state.accountAdjustments = adjustments?.items || [];
  state.cardExpenses = cardExpenses?.items || [];
  state.installments = installments?.items || [];
  state.investments = investments?.items || [];
  state.debts = debts?.items || [];
  // Status (pending/confirmed/skipped) is computed server-side for
  // `month`, matching whichever month is currently selected.
  state.recurringAccountItems = recurring?.items || [];
  // Per-investment event history — small dataset for a personal app, needed
  // (not just today's totals) so the Tài sản history chart can show an
  // accurate point-in-time invested value for past months.
  const eventLists = await Promise.all(state.investments.map(inv => api.investment('list_events', { investment_id: inv.id })));
  state.investmentEvents = {};
  state.investments.forEach((inv, i) => { state.investmentEvents[inv.id] = eventLists[i]?.items || []; });
  // Same idea for debt adjustment history (needed for "Xem lịch sử" +
  // point-in-time balances in the history chart).
  const debtAdjLists = await Promise.all(state.debts.map(d => api.debtLedger('list_adjustments', { debt_id: d.id })));
  state.debtAdjustments = debtAdjLists.flatMap(r => r?.items || []);
}

async function boot() {
  // A device forced out mid-session (forceDeviceLogout) reloads the page —
  // the toast itself can't survive that, so it's stashed here and replayed
  // once, on the very next boot.
  try {
    const notice = sessionStorage.getItem(DEVICE_NOTICE_STORE);
    if (notice) { sessionStorage.removeItem(DEVICE_NOTICE_STORE); setTimeout(() => toast(notice, true), 30); }
  } catch {}
  state.key = extractKey();
  if (!state.key) { setLoading(false); $('#unlock').classList.remove('hidden'); return; }
  try {
    setLoading(true);
    const [d, all] = await Promise.all([api.core('bootstrap'), api.core('export')]);
    applyBootstrap(d);
    state.fullTransactions = all.transactions || d.transactions || [];
    await ensureDeviceToken();
    await loadExtras(state.month);
    $('#app').classList.remove('hidden'); $('#unlock').classList.add('hidden');
    $('#monthPicker').value = state.month;
    let savedView = '';
    try { savedView = localStorage.getItem(VIEW_STORE) || ''; } catch {}
    navigate(VIEW_META[savedView] ? savedView : 'budget');
  } catch (e) {
    console.error(e);
    localStorage.removeItem(KEY_STORE); localStorage.removeItem(DEVICE_TOKEN_STORE); state.key = '';
    setLoading(false); $('#unlock').classList.remove('hidden'); toast(e.message, true);
    return;
  }
  setLoading(false);
}

async function refresh() {
  const view = state.view;
  const [d, all] = await Promise.all([api.core('bootstrap'), api.core('export')]);
  applyBootstrap(d);
  state.fullTransactions = all.transactions || [];
  if (state.month !== localMonth()) {
    const md = await api.core('month', { month: monthDate(state.month) });
    state.categories = md.categories || state.categories;
    state.transactions = md.transactions || state.transactions;
  }
  await loadExtras(state.month);
  state.view = view;
  render();
}

async function loadMonth(m) {
  try {
    setLoading(true);
    const d = await api.core('month', { month: monthDate(m) });
    state.month = m;
    state.categories = d.categories || [];
    state.transactions = d.transactions || [];
    await loadExtras(m);
    render();
  } catch (e) { toast(e.message, true); }
  finally { setLoading(false); }
}
async function changeMonth(delta) {
  const m = shiftMonth(state.month, delta);
  $('#monthPicker').value = m;
  await loadMonth(m);
  toast(`Đã chuyển sang ${fmtMonthKey(m)}`);
}

const VIEW_META = {
  dashboard: ['Tổng quan', 'Thu chi tháng đang chọn — không gồm tài sản, đầu tư'],
  budget: ['Chi tiêu', 'Thu nhập, chi cố định, chi biến động, thẻ & trả góp, nợ trong tháng'],
  investments: ['Đầu tư', 'Vốn, giá trị hiện tại và lãi/lỗ từng khoản đầu tư'],
  accounts: ['Tài sản', 'Số dư thủ công của tiền mặt, ngân hàng, tiết kiệm — độc lập với Chi tiêu'],
  settings: ['Cài đặt', 'Gia đình, tiền tệ và sao lưu dữ liệu']
};
function navigate(v) {
  state.view = v;
  try { localStorage.setItem(VIEW_STORE, v); } catch {}
  $$('#nav button,#mobileNav button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  const [t, s] = VIEW_META[v] || VIEW_META.dashboard;
  $('#pageTitle').textContent = t; $('#pageSubtitle').textContent = s;
  render();
}
function render() {
  if (!state.household) return;
  const views = { dashboard: window.renderDashboard, budget: window.renderBudget, investments: window.renderInvestments, accounts: window.renderAccounts, settings: window.renderSettings };
  const fn = views[state.view] || views.dashboard;
  const content = $('#content');
  content.innerHTML = fn();
  // Retrigger the fade-in on every render (not just once) by removing then
  // re-adding the class after a forced reflow — purely a CSS animation
  // hook, no effect on what's actually rendered.
  content.classList.remove('view-fade');
  void content.offsetWidth;
  content.classList.add('view-fade');
  if (state.view === 'settings') window.wireSettingsView?.();
}

$('#unlockForm').addEventListener('submit', e => {
  e.preventDefault();
  const k = $('#unlockKey').value.trim();
  if (k.length < 9) { toast('Khóa không hợp lệ', true); return; }
  localStorage.setItem(KEY_STORE, k);
  location.reload();
});
$('#nav').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) navigate(b.dataset.view); });
$('#mobileNav').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) navigate(b.dataset.view); });
$('#quickAdd').addEventListener('click', () => openQuickEntry());
$('#monthPicker').addEventListener('change', e => loadMonth(e.target.value));
// A device revoked from Cài đặt is caught the next time it hits any
// extension.* action — nearly every user action already does (save →
// refresh(), month change → loadMonth()), but an idle-and-just-sitting-there
// tab wouldn't call anything on its own, so this heartbeat is what makes
// "khóa máy ngay lập tức" true even then. Response is unused — the
// revocation check + forced logout both happen inside callRpc.
setInterval(() => { if (state.key && state.deviceToken) api.extension('get').catch(() => {}); }, 30000);

async function exportData() {
  try {
    const d = await api.backup();
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `taichinh-gd-${localToday()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Đã tạo bản sao đầy đủ');
  } catch (e) { toast(e.message, true); }
}

const CSV_TYPE_LABEL = {
  income: 'Thu nhập', expense: 'Chi tiêu',
  loan_borrow: 'Vay', loan_lend: 'Cho vay', loan_pay: 'Trả nợ', loan_collect: 'Thu hồi nợ', loan_interest: 'Lãi vay'
};
// Loans (unchanged, still trigger-driven) are the only non income/expense
// types `transactions` can still contain going forward — income/expense
// entries never carry an account_id anymore, so there's nothing left to sum
// into a cash-flow total the way transfers/goals used to need signing for.
const CSV_POSITIVE_TYPES = new Set(['income', 'loan_borrow', 'loan_collect']);
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvSignedAmount(t) {
  return CSV_POSITIVE_TYPES.has(t.transaction_type) ? n(t.amount) : -n(t.amount);
}
function exportCsv() {
  const rows = [...(state.fullTransactions || [])].sort((a, b) => String(a.transaction_date).localeCompare(String(b.transaction_date)));
  const header = ['Ngày', 'Loại', 'Danh mục', 'Số tiền', 'Dòng tiền (dấu +/-)', 'Tiền tệ', 'Ghi chú'];
  const lines = rows.map(t => [
    String(t.transaction_date).slice(0, 10), CSV_TYPE_LABEL[t.transaction_type] || t.transaction_type,
    t.category_name || '', t.amount, csvSignedAmount(t), t.currency, t.note || ''
  ].map(csvCell).join(','));
  const csv = '﻿' + [header.join(','), ...lines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `taichinh-gd-giao-dich-${localToday()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Đã xuất CSV giao dịch');
}

Object.assign(window, { boot, refresh, loadMonth, changeMonth, navigate, render, exportData, exportCsv });
boot();
