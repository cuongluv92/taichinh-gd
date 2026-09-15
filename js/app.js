// ==========================================================================
// Boot, data orchestration, router. One clear place instead of the previous
// 250ms-polling "wait until state.key exists" hacks scattered across files.
// ==========================================================================
'use strict';

// `d.goals` and `d.monthly_summary` also come back in this response but
// aren't kept on `state` — nothing in this simplified UI reads them (see
// the handoff notes on dropped goals/analytics screens).
function applyBootstrap(d) {
  state.household = d.household || {};
  state.base = state.household.base_currency || 'JPY';
  state.accounts = d.accounts || [];
  state.categories = d.categories || [];
  state.categoryVersions = d.category_versions || [];
  state.transactions = d.transactions || [];
  state.loans = d.loans || [];
  $('#familyNameSide').textContent = state.household.name || 'Gia đình';
}

async function loadExtras(month = state.month) {
  // Only the endpoints this UI actually renders. (The backend also has
  // recurring-expense reminders, a second card "overview" summary, and a
  // monthly FX-history table — all still intact in Supabase, just not part
  // of this pass's simplified screens, so they're not fetched here.)
  const [ext, allocation, cardGet, cardInstallments, cardMonthRes, exceptional] = await Promise.all([
    api.extension('get'),
    api.allocation('get_month', { month: monthDate(month) }),
    api.card('get'),
    api.card('list_installments'),
    api.cardMonth(month),
    api.exceptional('list')
  ]);
  state.reporting = { show_vnd_conversion: false, jpy_vnd_rate: null, ...(ext?.reporting || {}) };
  state.loanTerms = ext?.loan_terms || [];
  state.allocationPlan = allocation || null;
  state.cardSettings = cardGet?.items || [];
  state.cardInstallments = cardInstallments?.items || [];
  state.cardMonth = cardMonthRes?.items || [];
  state.exceptionalIds = exceptional?.ids || [];
}

async function boot() {
  state.key = extractKey();
  if (!state.key) { setLoading(false); $('#unlock').classList.remove('hidden'); return; }
  try {
    setLoading(true);
    const [d, all] = await Promise.all([api.core('bootstrap'), api.core('export')]);
    applyBootstrap(d);
    state.fullTransactions = all.transactions || d.transactions || [];
    await loadExtras(state.month);
    $('#app').classList.remove('hidden'); $('#unlock').classList.add('hidden');
    $('#monthPicker').value = state.month;
    navigate('dashboard');
  } catch (e) {
    console.error(e);
    localStorage.removeItem(KEY_STORE); state.key = '';
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
  dashboard: ['Tổng quan', 'Kế hoạch tháng và phân tích tài chính'],
  budget: ['Chi tiêu', 'Thu nhập, chi cố định, chi biến động, thẻ và nợ trong tháng'],
  accounts: ['Tài sản', 'Tiền mặt, ngân hàng, tiết kiệm và đầu tư'],
  settings: ['Cài đặt', 'Gia đình, tiền tệ và sao lưu dữ liệu']
};
function navigate(v) {
  state.view = v;
  $$('#nav button,#mobileNav button').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  const [t, s] = VIEW_META[v] || VIEW_META.dashboard;
  $('#pageTitle').textContent = t; $('#pageSubtitle').textContent = s;
  render();
}
function render() {
  if (!state.household) return;
  const views = { dashboard: window.renderDashboard, budget: window.renderBudget, accounts: window.renderAccounts, settings: window.renderSettings };
  const fn = views[state.view] || views.dashboard;
  $('#content').innerHTML = fn();
  if (state.view === 'settings') window.wireSettingsView?.();
}

$('#unlockForm').addEventListener('submit', e => {
  e.preventDefault();
  const k = $('#unlockKey').value.trim();
  if (k.length < 32) { toast('Khóa không hợp lệ', true); return; }
  localStorage.setItem(KEY_STORE, k);
  location.reload();
});
$('#nav').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) navigate(b.dataset.view); });
$('#mobileNav').addEventListener('click', e => { const b = e.target.closest('button[data-view]'); if (b) navigate(b.dataset.view); });
$('#quickAdd').addEventListener('click', () => openQuickEntry());
$('#monthPicker').addEventListener('change', e => loadMonth(e.target.value));

async function exportData() {
  try {
    const d = await api.backup();
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `taichinh-gd-${localToday()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Đã tạo bản sao đầy đủ');
  } catch (e) { toast(e.message, true); }
}

Object.assign(window, { boot, refresh, loadMonth, changeMonth, navigate, render, exportData });
boot();
