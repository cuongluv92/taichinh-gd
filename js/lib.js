// ==========================================================================
// Core utilities: DOM helpers, formatting, state, toast/modal, generic RPC.
// This replaces core.js's scattered helpers with one clean module.
// ==========================================================================
'use strict';

const SUPABASE_URL = 'https://frqujwlswqmtsxnqnwwc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TCG4KliEaKshVW9BKQJiCQ_1UrLbjdC';
const KEY_STORE = 'taichinh_gd_key_v1';
const QUICK_PREF_KEY = 'taichinh_gd_quick_entry_v1';
const VIEW_STORE = 'taichinh_gd_last_view_v1';

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const localMonth = () => localToday().slice(0, 7);

const state = {
  key: '',
  view: 'dashboard',
  base: 'JPY',
  month: localMonth(),
  household: null,
  accounts: [],
  categories: [],
  categoryVersions: [],
  transactions: [],
  fullTransactions: [],
  loans: [],
  loanTerms: [],
  reporting: { show_vnd_conversion: false, jpy_vnd_rate: null },
  exceptionalIds: [],
  // Tài sản (manual-only balances), Nợ/Khoản phải thu (manual-only debt
  // ledger), and Đầu tư (its own ledger) — see finance.js for the formulas
  // these feed. None of these is derived from `transactions`/
  // `fullTransactions` anymore.
  accountAdjustments: [],
  cardExpenses: [],
  installments: [],
  debts: [],
  investments: [],
  investmentEvents: {}
};

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (v = '') => String(v).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const n = v => Number(v || 0);
const clamp0 = v => Math.max(0, n(v));
const monthDate = m => `${m}-01`;
const monthKey = d => String(d || '').slice(0, 7);
const yearKey = d => String(d || '').slice(0, 4);
const fmtMonth = d => { const x = new Date(`${String(d).slice(0, 10)}T00:00:00`); return `${x.getMonth() + 1}/${String(x.getFullYear()).slice(-2)}`; };
const fmtMonthKey = key => String(key || '').replace('-', '/');

function money(v, cur = state.base) {
  return new Intl.NumberFormat(cur === 'JPY' ? 'ja-JP' : 'vi-VN', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n(v));
}
function signedMoney(v, cur = state.base) {
  const v2 = n(v);
  return `${v2 > 0 ? '+' : v2 < 0 ? '−' : ''}${money(Math.abs(v2), cur)}`;
}
function pctText(v, base) {
  return base > 0 ? `${(n(v) / base * 100).toFixed(1)}%` : '—';
}
function pctOf(v, base) { return base > 0 ? n(v) / base * 100 : 0; }

function shiftMonth(month, delta) {
  const [y, m] = String(month).split('-').map(Number);
  const d = new Date(y, m - 1 + Number(delta || 0), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function addMonths(ym, delta) {
  const [y, m] = String(ym).slice(0, 7).split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String(idx % 12 + 1).padStart(2, '0')}`;
}
function endOfMonthDate(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function daysUntil(date) {
  if (!date) return null;
  const now = new Date(localToday() + 'T00:00:00');
  const d = new Date(String(date).slice(0, 10) + 'T00:00:00');
  return Math.ceil((d - now) / 86400000);
}
function dateStatus(date) {
  const d = daysUntil(date);
  if (d === null) return '';
  if (d < 0) return `Quá hạn ${Math.abs(d)} ngày`;
  if (d === 0) return 'Đến hạn hôm nay';
  if (d <= 7) return `Còn ${d} ngày`;
  return `Hạn ${String(date).slice(0, 10)}`;
}

function toast(msg, error = false) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 2400);
}
function setLoading(on) { $('#loading')?.classList.toggle('hidden', !on); }

function options(items, value, label = x => x.name) {
  return items.map(x => `<option value="${esc(x.id)}" ${x.id === value ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
}

// ---------- CSP-safe action dispatch ----------
// The production CSP is `script-src 'self'` (no 'unsafe-inline'), so plain
// onclick="..." HTML attributes are silently dropped by the browser. Every
// interactive element built from a template string must use act(...) below
// instead, which emits data-action/data-a attributes read by one delegated
// listener (wired in app.js) rather than an inline event handler.
function act(name, ...args) {
  return `data-action="${esc(name)}"${args.length ? ` data-a="${esc(JSON.stringify(args))}"` : ''}`;
}

// ---------- Modal ----------
function modal(title, bodyHtml, onSubmit, submitText = 'Lưu') {
  const dlg = $('#modal'), mb = $('#modalBody');
  mb.innerHTML = `<div class="modal-head"><h3>${esc(title)}</h3><button class="mini-btn" type="button" aria-label="Đóng" ${act('closeModal')}>✕</button></div>` +
    `<div class="modal-content">${bodyHtml}</div>` +
    `<div class="modal-actions"><button class="btn" type="button" ${act('closeModal')}>Hủy</button><button class="btn primary" type="submit">${esc(submitText)}</button></div>`;
  const form = $('#modalForm');
  form.onsubmit = async e => {
    e.preventDefault();
    if (!onSubmit) { dlg.close(); return; }
    const fd = Object.fromEntries(new FormData(form).entries());
    const submitBtn = form.querySelector('[type=submit]');
    try {
      if (submitBtn) submitBtn.disabled = true;
      await onSubmit(fd);
      dlg.close();
      await window.refresh?.();
      toast('Đã lưu');
    } catch (err) {
      toast(err.message || 'Không lưu được', true);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  };
  if (!dlg.open) dlg.showModal();
}
// info-only modal (no form submit action)
function infoModal(title, bodyHtml) {
  const dlg = $('#modal'), mb = $('#modalBody'), form = $('#modalForm');
  mb.innerHTML = `<div class="modal-head"><h3>${esc(title)}</h3><button class="mini-btn" type="button" aria-label="Đóng" ${act('closeModal')}>✕</button></div>` +
    `<div class="modal-content">${bodyHtml}</div>` +
    `<div class="modal-actions"><button class="btn primary" type="button" ${act('closeModal')}>Đóng</button></div>`;
  form.onsubmit = e => e.preventDefault();
  if (!dlg.open) dlg.showModal();
}
function closeModal() { $('#modal')?.close(); }
// Close the current modal, then open a different one (same <dialog> element
// is reused for both, so give it a tick to finish closing first).
function reopenAfterModal(fnName, ...args) {
  closeModal();
  const fn = window[fnName];
  if (typeof fn === 'function') setTimeout(() => fn(...args), 0);
}

// ---------- Generic RPC caller ----------
async function callRpc(fnName, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const raw = data?.message || data?.hint || String(data || `HTTP ${res.status}`);
    throw new Error(translateApiError(raw));
  }
  return data;
}

const ERROR_MAP = [
  [/invalid_access_key/i, 'Khóa gia đình không đúng.'],
  [/payment_exceeds_remaining/i, 'Số tiền lớn hơn dư nợ còn lại.'],
  [/loan_opening_already_recorded/i, 'Khoản vay này đã được ghi nhận vào tài khoản rồi.'],
  [/invalid_account/i, 'Hãy chọn tài khoản hợp lệ.'],
  [/loan_not_found/i, 'Không tìm thấy khoản nợ.'],
  [/withdraw_exceeds_goal/i, 'Số tiền rút lớn hơn số đã tích lũy.'],
  [/accounts_must_differ/i, 'Tài khoản nguồn và tài khoản nhận phải khác nhau.'],
  [/goal_not_found/i, 'Không tìm thấy mục tiêu tiết kiệm.'],
  [/exchange_rate_required/i, 'Hãy nhập tỷ giá JPY → VND trước khi bật quy đổi.'],
  [/invalid_exchange_rate/i, 'Tỷ giá phải lớn hơn 0.'],
  [/bank_loan_terms_required/i, 'Khoản này chưa được thiết lập là vay ngân hàng.'],
  [/term_months_required/i, 'Cần nhập thời hạn vay khi dùng cách tính 元利均等 / 元金均等.'],
  [/principal_must_be_positive/i, 'Tiền gốc phải lớn hơn 0.'],
  [/invalid_closing_day/i, 'Ngày chốt phải từ 1 đến 31.'],
  [/invalid_payment_day/i, 'Ngày thanh toán phải từ 1 đến 31.'],
  [/card_cycle_required/i, 'Hãy thiết lập chu kỳ cho thẻ trước.'],
  [/invalid_installment_count/i, 'Số kỳ trả góp phải từ 2 đến 60.'],
  [/installment_name_required/i, 'Hãy nhập tên khoản trả góp.'],
  [/invalid_category|fee_category_required/i, 'Hãy chọn danh mục chi phí hợp lệ.'],
  [/statement_already_paid/i, 'Kỳ thẻ này đã được xác nhận thanh toán.'],
  [/payment_below_fee/i, 'Tổng thanh toán phải lớn hơn phần phí trả góp.'],
  [/amount_must_be_positive/i, 'Số tiền phải lớn hơn 0.'],
  [/invalid_paid_installments_before/i, 'Số kỳ đã trả phải nhỏ hơn tổng số kỳ.'],
  [/invalid_bonus_month/i, 'Bonus chỉ chọn được tháng 1, 7 hoặc 12.'],
  [/bonus_amount_required/i, 'Đã chọn tháng bonus thì phải nhập số tiền bonus mỗi lần.'],
  [/bonus_months_required/i, 'Đã nhập số tiền bonus thì phải chọn ít nhất một tháng.'],
  [/bonus_amount_too_large/i, 'Tổng tiền bonus không được vượt quá (hoặc bằng) tổng giá trị khoản trả góp.'],
  [/bonus_amount_must_be_nonnegative/i, 'Số tiền bonus không được âm.'],
  [/custom_schedule_required/i, 'Hãy tạo lịch thanh toán tùy chỉnh.'],
  [/custom_schedule_count_mismatch/i, 'Số dòng lịch tương lai phải bằng số kỳ còn lại.'],
  [/duplicate_custom_payment_month/i, 'Không thể có hai kỳ của cùng khoản trong một tháng. Hãy gộp tiền thường + Bonus vào một dòng.'],
  [/custom_principal_total_mismatch/i, 'Với mua mới, tổng phần gốc các kỳ phải đúng bằng giá mua.'],
  [/custom_fee_total_mismatch/i, 'Với mua mới, tổng phí các kỳ phải đúng bằng tổng phí đã nhập.'],
  [/remaining_principal_exceeds_original/i, 'Tổng gốc còn phải trả không được lớn hơn giá mua ban đầu.'],
  [/already_paid/i, 'Khoản này đã được xác nhận trong tháng.'],
  [/invalid_day_of_month/i, 'Ngày thanh toán phải từ 1 đến 31.'],
  [/month_outside_schedule/i, 'Tháng này không nằm trong lịch của khoản định kỳ.'],
  [/recurring_not_found/i, 'Không tìm thấy khoản định kỳ.'],
  [/target_total_exceeds_100/i, 'Tổng chỉ tiêu không được vượt 100% thu nhập.'],
  [/invalid_target_percentage/i, 'Mỗi tỷ lệ phải nằm trong khoảng 0–100%.'],
  [/account_not_found/i, 'Không tìm thấy tài khoản.'],
  [/actual_balance_required/i, 'Hãy nhập số dư thực tế.'],
  [/future_reconciliation_date/i, 'Ngày đối soát không được ở tương lai.'],
  [/expense_transaction_not_found/i, 'Không tìm thấy giao dịch chi tiêu.'],
  [/member_names_must_differ/i, 'Tên hai người phải khác nhau.'],
  [/invalid_split_pct/i, 'Tỷ lệ phải từ 0 đến 100%.'],
  [/too_many_rows/i, 'Mỗi lần chỉ nhập tối đa 1.000 dòng.'],
  [/no_rows_selected/i, 'Chưa chọn dòng nào để nhập.'],
  [/invalid_import_row/i, 'Có dòng sai ngày, loại hoặc số tiền.'],
  [/batch_not_found/i, 'Không tìm thấy lần import này.'],
  [/category_order_stale_refresh/i, 'Danh mục vừa thay đổi. Hãy tải lại rồi thử lại.'],
  [/invalid_category_order/i, 'Thứ tự danh mục không hợp lệ.'],
  [/category_name_required/i, 'Tên mục không được để trống.'],
  [/planned_amount_negative/i, 'Số tiền không được âm.'],
  [/account_has_history/i, 'Không xóa được — tài khoản này đã có lịch sử +/− tiền.'],
  [/debt_has_history/i, 'Không xóa được — khoản này đã có lịch sử điều chỉnh.'],
  [/account_not_found/i, 'Không tìm thấy tài khoản.']
];
function translateApiError(raw) {
  for (const [re, msg] of ERROR_MAP) if (re.test(raw)) return msg;
  return raw;
}

// ---------- Access key handling ----------
function extractKey() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const fromHash = hash.get('k') || hash.get('key');
  if (fromHash && fromHash.length >= 32) {
    localStorage.setItem(KEY_STORE, fromHash);
    history.replaceState(null, '', location.pathname + location.search);
    return fromHash;
  }
  try { return localStorage.getItem(KEY_STORE) || ''; } catch { return ''; }
}
function forgetDevice() {
  if (!confirm('Xóa khóa khỏi thiết bị này? Bạn cần link riêng để mở lại.')) return;
  localStorage.removeItem(KEY_STORE);
  location.reload();
}
async function copyPrivateLink() {
  const url = `${location.origin}${location.pathname}#k=${encodeURIComponent(state.key)}`;
  try { await navigator.clipboard.writeText(url); toast('Đã sao chép link riêng'); }
  catch { prompt('Sao chép link này:', url); }
}

Object.assign(window, {
  SUPABASE_URL, SUPABASE_KEY, state, $, $$, esc, n, clamp0, money, signedMoney, pctText, pctOf,
  monthDate, monthKey, yearKey, fmtMonth, fmtMonthKey, shiftMonth, addMonths, endOfMonthDate,
  daysUntil, dateStatus, toast, setLoading, options, modal, infoModal, closeModal, reopenAfterModal, callRpc, act,
  extractKey, forgetDevice, copyPrivateLink, localToday, localMonth, QUICK_PREF_KEY
});

// One delegated handler for every data-action element in the document,
// including inside the <dialog id="modal">. This is the CSP-safe
// replacement for onclick="..." attributes (see act() above).
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const fn = window[el.dataset.action];
  if (typeof fn !== 'function') { console.error(`Hành động "${el.dataset.action}" chưa được định nghĩa.`); return; }
  e.preventDefault();
  let args = [];
  if (el.dataset.a) { try { args = JSON.parse(el.dataset.a); } catch (err) { console.error('data-a không hợp lệ', err); } }
  const result = fn(...args);
  if (result && typeof result.then === 'function') result.catch(err => toast(err?.message || 'Không thực hiện được', true));
});
