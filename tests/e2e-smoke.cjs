// Playwright smoke test for the taichinh-gd frontend, using synthetic
// fixture data (no live Supabase / real family key involved). Serves the
// app locally with the exact production CSP headers from vercel.json, then
// drives every interactive element with real page.click() calls — the only
// way to catch a CSP-blocked handler, which page.evaluate() would hide.
// Run: node tests/e2e-smoke.cjs  (needs `npx playwright install chromium` once)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const SHOT_DIR = process.env.E2E_SHOT_DIR || os.tmpdir();
const PORT = 8935;

function contentType(p) {
  if (p.endsWith('.html')) return 'text/html';
  if (p.endsWith('.css')) return 'text/css';
  if (p.endsWith('.js') || p.endsWith('.mjs')) return 'application/javascript';
  if (p.endsWith('.svg')) return 'image/svg+xml';
  if (p.endsWith('.webmanifest') || p.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}
const PROD_CSP = "default-src 'self'; connect-src 'self' https://frqujwlswqmtsxnqnwwc.supabase.co; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const full = path.join(ROOT, p);
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + p); return; }
    res.writeHead(200, {
      'Content-Type': contentType(full),
      'Content-Security-Policy': PROD_CSP,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY'
    });
    res.end(data);
  });
});

function addMonths(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String(idx % 12 + 1).padStart(2, '0')}`;
}
const MONTH = '2026-09';
const cat = (id, direction, cost_type, name, planned) => ({ id, direction, cost_type, name, planned_amount: planned, color: '#f5a623', is_active: true, sort_order: 0 });
const CATEGORIES = [
  cat('inc1', 'income', null, 'Lương C', 300000),
  cat('inc2', 'income', null, 'Lương T', 140000),
  cat('fx1', 'expense', 'fixed', 'Nhà ở', 95000),
  cat('fx2', 'expense', 'fixed', 'Wifi', 6000),
  cat('vr1', 'expense', 'variable', 'Ăn uống', 60000),
  cat('vr2', 'expense', 'variable', 'Đi lại', 15000)
];
const ACCOUNTS = [
  { id: 'bank', name: 'UFJ', account_type: 'bank', currency: 'JPY', opening_balance: 300000, is_active: true },
  { id: 'cash', name: 'Tiền mặt', account_type: 'cash', currency: 'JPY', opening_balance: 50000, is_active: true },
  { id: 'card', name: 'Rakuten', account_type: 'credit', currency: 'JPY', opening_balance: 0, is_active: true },
  { id: 'vnbank', name: 'Vietcombank', account_type: 'bank', currency: 'VND', opening_balance: 5000000, is_active: true },
  { id: 'oldwallet', name: 'Ví cũ', account_type: 'cash', currency: 'JPY', opening_balance: 0, is_active: false }
];
let txSeq = 0;
function tx(o) { return { id: 'tx' + (++txSeq), currency: 'JPY', note: '', category_name: (CATEGORIES.find(c => c.id === o.category_id) || {}).name, ...o }; }
const FULL_TX = [];
for (let i = 23; i >= 0; i--) {
  const m = addMonths(MONTH, -i);
  FULL_TX.push(tx({ category_id: 'inc1', transaction_type: 'income', amount: 300000, transaction_date: `${m}-05` }));
  FULL_TX.push(tx({ category_id: 'inc2', transaction_type: 'income', amount: 140000, transaction_date: `${m}-05` }));
  FULL_TX.push(tx({ category_id: 'fx1', transaction_type: 'expense', amount: 95000, transaction_date: `${m}-27` }));
  FULL_TX.push(tx({ category_id: 'vr1', transaction_type: 'expense', amount: 42000 + (i % 3) * 4000, transaction_date: `${m}-15` }));
  FULL_TX.push(tx({ category_id: 'vr2', transaction_type: 'expense', amount: 10000 + (i % 4) * 1000, transaction_date: `${m}-20` }));
}
const MONTH_TX = FULL_TX.filter(t => t.transaction_date.startsWith(MONTH));

const ADJUSTMENTS = [
  { id: 'adj1', account_id: 'bank', account_name: 'UFJ', direction: 'increase', amount: 100000, currency: 'JPY', adjustment_date: `${MONTH}-03`, note: 'Lương tháng trước còn lại' }
];
const CARD_EXPENSES = [
  { id: 'ce1', card_account_id: 'card', card_name: 'Rakuten', entry_mode: 'detail', expense_date: `${MONTH}-15`, description: 'Điện · Ga', amount: 10000, note: '' }
];
const INSTALLMENTS = [];
const REPORTING = { show_vnd_conversion: false, jpy_vnd_rate: null };
const DEBTS = [
  { id: 'd1', name: 'Vay mua xe', counterparty: 'Ngân hàng ABC', direction: 'payable', currency: 'JPY', opening_amount: 1250000, start_date: `${MONTH}-15`, due_date: '2026-12-01', interest_rate: 0, is_active: true },
  { id: 'd2', name: 'Vay chị Hoa', counterparty: 'Chị Hoa', direction: 'payable', currency: 'VND', opening_amount: 5000000, start_date: `${MONTH}-01`, due_date: null, interest_rate: 0, is_active: true }
];
const DEBT_ADJUSTMENTS = [];
const RECURRING_ITEMS = [
  { id: 'rec1', target_type: 'account', target_id: 'bank', name: 'Wifi', direction: 'decrease', amount: 6000, currency: 'JPY', day_of_month: 10, is_active: true, note: '' }
];
const RECURRING_SKIPS = [];
const INVESTMENTS = [
  { id: 'nisa1', name: 'NISA Rakuten', kind: 'nisa', currency: 'JPY', initial_capital: 400000, note: '', created_at: `${MONTH}-01T00:00:00Z`, start_date: '2026-01-01', broker_name: 'Rakuten Securities', nisa_frame: 'both', nisa_annual_limit: 3600000, monthly_amount: 30000, monthly_day: 5, plan_start_month: `${MONTH}-01`, plan_paused: false, expected_return_rate: 5, expected_return_period: 'annual', reinvest_mode: 'none', total_contributed: 100000, total_withdrawn: 0, latest_value: 550000, latest_value_date: `${MONTH}-10`, parent_investment_id: null },
  { id: 'fund1', name: 'eMAXIS Slim toàn cầu', kind: 'securities', currency: 'JPY', initial_capital: 0, note: '', created_at: `${MONTH}-03T00:00:00Z`, ticker: '2559', market: 'TSE', quantity: 10, avg_cost: 15000, current_price: 16500, realized_pl: 0, total_contributed: 150000, total_withdrawn: 0, total_dividends: 0, parent_investment_id: 'nisa1' },
  { id: 'sec1', name: 'Toyota', kind: 'securities', currency: 'JPY', initial_capital: 0, note: '', created_at: `${MONTH}-01T00:00:00Z`, broker_name: 'SBI', ticker: '7203', market: 'TSE', quantity: 100, avg_cost: 2000, current_price: 2200, realized_pl: 0, total_contributed: 200000, total_withdrawn: 0, total_dividends: 0, parent_investment_id: null },
  { id: 'sav1', name: 'Tiết kiệm kỳ hạn SBI', kind: 'savings_interest', currency: 'JPY', initial_capital: 500000, note: '', created_at: `${MONTH}-01T00:00:00Z`, bank_name: 'SBI Sumishin', interest_rate_annual: 1, interest_payment_method: 'maturity', term_end_date: '2027-09-15', total_contributed: 0, total_withdrawn: 0, total_interest: 5000, parent_investment_id: null },
  // Simple-mode NISA (no quỹ/ETF holdings) with a prior "Cập nhật giá trị"
  // — the exact user-reported scenario: giá trị hiện tại must NOT freeze at
  // this snapshot once a later "Thêm vốn" is recorded.
  { id: 'nisa2', name: 'NISA SBI', kind: 'nisa', currency: 'JPY', initial_capital: 0, note: '', created_at: `${MONTH}-01T00:00:00Z`, start_date: '2026-01-01', broker_name: 'SBI Securities', nisa_frame: 'tsumitate', nisa_annual_limit: null, monthly_amount: null, monthly_day: null, plan_start_month: null, plan_paused: false, expected_return_rate: null, expected_return_period: null, reinvest_mode: 'none', total_contributed: 200000, total_withdrawn: 0, latest_value: 220000, latest_value_date: `${MONTH}-10`, parent_investment_id: null }
];
const INVESTMENT_EVENTS = {
  nisa1: [
    { id: 'ev1', event_type: 'contribution', amount: 100000, event_date: `${MONTH}-02`, note: '' },
    { id: 'ev2', event_type: 'valuation', amount: 550000, event_date: `${MONTH}-10`, note: '' }
  ],
  nisa2: [
    { id: 'ev7', event_type: 'contribution', amount: 200000, event_date: `${MONTH}-01`, note: '' },
    { id: 'ev8', event_type: 'valuation', amount: 220000, event_date: `${MONTH}-10`, note: '' }
  ],
  fund1: [
    { id: 'ev6', event_type: 'buy', quantity: 10, price: 15000, amount: 150000, event_date: `${MONTH}-03`, note: '' }
  ],
  sec1: [
    { id: 'ev3', event_type: 'buy', quantity: 100, price: 2000, amount: 200000, event_date: `${MONTH}-01`, note: '' },
    { id: 'ev4', event_type: 'valuation', price: 2200, amount: 0, event_date: `${MONTH}-10`, note: '' }
  ],
  sav1: [
    { id: 'ev5', event_type: 'interest', amount: 5000, event_date: `${MONTH}-15`, note: '' }
  ]
};

let seq = 0;
function newId(prefix) { return `${prefix}${++seq}`; }

const RPC_HANDLERS = {
  taichinh_gd_api: (action, body) => {
    const p = body?.p_payload || {};
    if (action === 'bootstrap' || action === 'month') return { household: { name: 'Nguyễn Gia', base_currency: 'JPY' }, accounts: ACCOUNTS, categories: CATEGORIES, category_versions: [], transactions: MONTH_TX };
    if (action === 'export') return { transactions: FULL_TX };
    if (action === 'save_account') {
      if (p.id) { const row = ACCOUNTS.find(x => x.id === p.id); if (row) Object.assign(row, p); return { ok: true, id: p.id }; }
      const id = newId('acct');
      ACCOUNTS.push({ id, name: p.name, account_type: p.account_type || 'cash', currency: p.currency || 'JPY', opening_balance: Number(p.opening_balance || 0), is_active: true });
      return { ok: true, id };
    }
    if (action === 'delete_account') {
      if (ADJUSTMENTS.some(a => a.account_id === p.id)) return { error: true, __status: 400, message: 'account_has_history' };
      const i = ACCOUNTS.findIndex(x => x.id === p.id); if (i >= 0) ACCOUNTS.splice(i, 1);
      return { ok: true };
    }
    return { ok: true, id: 'x' };
  },
  taichinh_gd_extension_api: (action, body) => {
    const p = body?.p_payload || {};
    if (action === 'save_reporting') { Object.assign(REPORTING, { show_vnd_conversion: !!p.show_vnd_conversion, jpy_vnd_rate: p.jpy_vnd_rate ? Number(p.jpy_vnd_rate) : null }); return { ok: true }; }
    return { reporting: REPORTING, loan_terms: [] };
  },
  taichinh_gd_exceptional_api: (action) => action === 'set' ? { ok: true } : { ids: [] },
  taichinh_gd_backup_api: () => ({ ok: true }),
  taichinh_gd_budget_column_api: () => ({ ok: true }),
  taichinh_gd_account_adjustment_api: (action, body) => {
    const p = body?.p_payload || {};
    if (action === 'list') return { items: ADJUSTMENTS };
    if (action === 'save') {
      if (p.id) { const row = ADJUSTMENTS.find(x => x.id === p.id); if (row) Object.assign(row, p); return { ok: true, id: p.id }; }
      const id = newId('adj');
      ADJUSTMENTS.push({ id, account_id: p.account_id, account_name: (ACCOUNTS.find(a => a.id === p.account_id) || {}).name, direction: p.direction, amount: Number(p.amount), currency: p.currency || 'JPY', adjustment_date: p.adjustment_date, note: p.note || '' });
      return { ok: true, id };
    }
    if (action === 'delete') { const i = ADJUSTMENTS.findIndex(x => x.id === p.id); if (i >= 0) ADJUSTMENTS.splice(i, 1); return { ok: true }; }
    return { ok: true };
  },
  taichinh_gd_debt_ledger_api: (action, body) => {
    const p = body?.p_payload || {};
    if (action === 'list') return { items: DEBTS.filter(d => d.is_active !== false) };
    if (action === 'save') {
      if (p.id) { const row = DEBTS.find(x => x.id === p.id); if (row) Object.assign(row, p); return { ok: true, id: p.id }; }
      const id = newId('debt');
      DEBTS.push({ id, name: p.name, counterparty: p.counterparty || '', direction: p.direction, currency: p.currency || 'JPY', opening_amount: Number(p.opening_amount || 0), start_date: p.start_date || null, due_date: p.due_date || null, interest_rate: p.interest_rate || null, note: p.note || '', is_active: true });
      return { ok: true, id };
    }
    if (action === 'archive') { const row = DEBTS.find(x => x.id === p.id); if (row) row.is_active = false; return { ok: true }; }
    if (action === 'delete') { const i = DEBTS.findIndex(x => x.id === p.id); if (i >= 0) DEBTS.splice(i, 1); return { ok: true }; }
    if (action === 'list_adjustments') return { items: DEBT_ADJUSTMENTS.filter(x => x.debt_id === p.debt_id) };
    if (action === 'save_adjustment') {
      if (p.id) { const row = DEBT_ADJUSTMENTS.find(x => x.id === p.id); if (row) Object.assign(row, p); return { ok: true, id: p.id }; }
      const id = newId('dadj');
      DEBT_ADJUSTMENTS.push({ id, debt_id: p.debt_id, direction: p.direction, amount: Number(p.amount), adjustment_date: p.adjustment_date, note: p.note || '' });
      return { ok: true, id };
    }
    if (action === 'delete_adjustment') { const i = DEBT_ADJUSTMENTS.findIndex(x => x.id === p.id); if (i >= 0) DEBT_ADJUSTMENTS.splice(i, 1); return { ok: true }; }
    return { ok: true };
  },
  taichinh_gd_recurring_account_api: (action, body) => {
    const p = body?.p_payload || {};
    const monthOf = d => String(d || '').slice(0, 7);
    const month = (p.month || `${MONTH}-01`).slice(0, 7);
    if (action === 'list') {
      const items = RECURRING_ITEMS.map(r => {
        let status = 'pending';
        if (RECURRING_SKIPS.some(s => s.recurring_item_id === r.id && monthOf(s.month) === month)) status = 'skipped';
        else if (r.target_type === 'account' && ADJUSTMENTS.some(a => a.recurring_item_id === r.id && monthOf(a.adjustment_date) === month)) status = 'confirmed';
        else if (r.target_type === 'debt' && DEBT_ADJUSTMENTS.some(a => a.recurring_item_id === r.id && monthOf(a.adjustment_date) === month)) status = 'confirmed';
        return { ...r, status };
      });
      return { month: `${month}-01`, items };
    }
    if (action === 'save') {
      if (p.id) { const row = RECURRING_ITEMS.find(x => x.id === p.id); if (row) Object.assign(row, p, { amount: Number(p.amount), day_of_month: Number(p.day_of_month || 1) }); return { ok: true, id: p.id }; }
      const id = newId('rec');
      RECURRING_ITEMS.push({ id, target_type: p.target_type, target_id: p.target_id, name: p.name, direction: p.direction, amount: Number(p.amount), currency: 'JPY', day_of_month: Number(p.day_of_month || 1), is_active: true, note: p.note || '' });
      return { ok: true, id };
    }
    if (action === 'delete') { const i = RECURRING_ITEMS.findIndex(x => x.id === p.id); if (i >= 0) RECURRING_ITEMS.splice(i, 1); return { ok: true }; }
    if (action === 'confirm') {
      const item = RECURRING_ITEMS.find(x => x.id === p.id);
      const date = `${month}-${String(item.day_of_month).padStart(2, '0')}`;
      if (item.target_type === 'account') {
        const id = newId('adj');
        ADJUSTMENTS.push({ id, account_id: item.target_id, account_name: (ACCOUNTS.find(a => a.id === item.target_id) || {}).name, direction: item.direction, amount: item.amount, currency: item.currency, adjustment_date: date, note: item.name, recurring_item_id: item.id });
        return { ok: true, id };
      }
      const id = newId('dadj');
      DEBT_ADJUSTMENTS.push({ id, debt_id: item.target_id, direction: item.direction, amount: item.amount, adjustment_date: date, note: item.name, recurring_item_id: item.id });
      return { ok: true, id };
    }
    if (action === 'skip') { RECURRING_SKIPS.push({ recurring_item_id: p.id, month: `${month}-01` }); return { ok: true }; }
    if (action === 'unskip') {
      const i = RECURRING_SKIPS.findIndex(s => s.recurring_item_id === p.id && monthOf(s.month) === month);
      if (i >= 0) RECURRING_SKIPS.splice(i, 1);
      return { ok: true };
    }
    return { ok: true };
  },
  taichinh_gd_card_ledger_api: (action, body) => {
    const p = body?.p_payload || {};
    if (action === 'list_expenses') return { items: CARD_EXPENSES };
    if (action === 'list_installments') return { items: INSTALLMENTS };
    if (action === 'save_expense') {
      if (p.id) { const row = CARD_EXPENSES.find(x => x.id === p.id); if (row) Object.assign(row, p); return { ok: true, id: p.id }; }
      const id = newId('ce');
      CARD_EXPENSES.push({ id, card_account_id: p.card_account_id, card_name: (ACCOUNTS.find(a => a.id === p.card_account_id) || {}).name, entry_mode: p.entry_mode, expense_date: p.expense_date, description: p.description || '', amount: Number(p.amount), note: p.note || '' });
      return { ok: true, id };
    }
    if (action === 'delete_expense') { const i = CARD_EXPENSES.findIndex(x => x.id === p.id); if (i >= 0) CARD_EXPENSES.splice(i, 1); return { ok: true }; }
    if (action === 'save_installment') {
      const total = Number(p.total_installments), principal = Number(p.principal_amount);
      const bonusAmounts = p.bonus_amounts && typeof p.bonus_amounts === 'object' ? p.bonus_amounts : {};
      const months = Array.from({ length: total }, (_, i) => addMonths(p.first_payment_month?.slice(0, 7) || MONTH, i) + '-01');
      const bonusFor = m => bonusAmounts[String(Number(m.slice(5, 7)))];
      const totalBonus = months.reduce((s, m) => s + (Number(bonusFor(m)) || 0), 0);
      const baseTotal = principal - totalBonus;
      const regular = Math.floor(baseTotal / total);
      const schedule = months.map((m, i) => {
        const bonus = Number(bonusFor(m)) || 0;
        const isBonus = bonus > 0;
        const base = i === 0 ? baseTotal - regular * (total - 1) : regular;
        return { id: newId('sch'), installment_no: i + 1, payment_month: m, principal_amount: base + bonus, fee_amount: 0, is_paid: false, payment_kind: isBonus ? 'bonus' : 'regular' };
      });
      const id = newId('inst');
      INSTALLMENTS.push({ id, card_account_id: p.card_account_id, card_name: (ACCOUNTS.find(a => a.id === p.card_account_id) || {}).name, name: p.name, purchase_date: p.purchase_date, principal_amount: principal, fee_total: 0, total_installments: total, paid_installments_before: 0, first_payment_month: p.first_payment_month, currency: 'JPY', note: p.note || '', bonus_amounts: bonusAmounts, schedule });
      return { ok: true, id };
    }
    if (action === 'delete_installment') { const i = INSTALLMENTS.findIndex(x => x.id === p.id); if (i >= 0) INSTALLMENTS.splice(i, 1); return { ok: true }; }
    if (action === 'toggle_paid') { for (const inst of INSTALLMENTS) { const row = (inst.schedule || []).find(s => s.id === p.id); if (row) { row.is_paid = !row.is_paid; break; } } return { ok: true }; }
    if (action === 'edit_schedule_row') { for (const inst of INSTALLMENTS) { const row = (inst.schedule || []).find(s => s.id === p.id); if (row) { row.principal_amount = Number(p.principal_amount); break; } } return { ok: true }; }
    return { ok: true };
  },
  taichinh_gd_investment_api: (action, body) => {
    const p = body?.p_payload || {};
    if (action === 'list') return { items: INVESTMENTS };
    if (action === 'list_events') return { items: INVESTMENT_EVENTS[p.investment_id] || [] };
    if (action === 'save') {
      if (p.id) { const row = INVESTMENTS.find(x => x.id === p.id); if (row) Object.assign(row, p); return { ok: true, id: p.id }; }
      const id = newId('inv');
      INVESTMENTS.push({ id, kind: p.kind || 'other', name: p.name, asset_type: p.asset_type || null, currency: p.currency || 'JPY', initial_capital: Number(p.initial_capital || 0), note: p.note || '', created_at: new Date().toISOString(), ticker: p.ticker || null, market: p.market || null, parent_investment_id: p.parent_investment_id || null, quantity: 0, avg_cost: 0, realized_pl: 0, total_contributed: 0, total_withdrawn: 0, total_dividends: 0, total_interest: 0, latest_value: null, latest_value_date: null });
      INVESTMENT_EVENTS[id] = [];
      return { ok: true, id };
    }
    if (action === 'delete') {
      for (const child of INVESTMENTS.filter(x => x.parent_investment_id === p.id)) {
        const ci = INVESTMENTS.findIndex(x => x.id === child.id); if (ci >= 0) INVESTMENTS.splice(ci, 1);
      }
      const i = INVESTMENTS.findIndex(x => x.id === p.id); if (i >= 0) INVESTMENTS.splice(i, 1);
      return { ok: true };
    }
    if (action === 'save_event') {
      const list = INVESTMENT_EVENTS[p.investment_id] = INVESTMENT_EVENTS[p.investment_id] || [];
      const inv = INVESTMENTS.find(x => x.id === p.investment_id);
      let id = p.id;
      if (id) { const row = list.find(x => x.id === id); if (row) Object.assign(row, p); }
      else { id = newId('ev'); list.push({ id, event_type: p.event_type, amount: p.amount != null ? Number(p.amount) : null, quantity: p.quantity != null ? Number(p.quantity) : null, price: p.price != null ? Number(p.price) : null, event_date: p.event_date, note: p.note || '' }); }
      if (inv) {
        if (p.event_type === 'contribution' || p.event_type === 'buy') inv.total_contributed = Number(inv.total_contributed || 0) + Number(p.amount || (p.quantity * p.price) || 0);
        if (p.event_type === 'withdrawal' || p.event_type === 'sell') inv.total_withdrawn = Number(inv.total_withdrawn || 0) + Number(p.amount || (p.quantity * p.price) || 0);
        if (p.event_type === 'dividend') inv.total_dividends = Number(inv.total_dividends || 0) + Number(p.amount || 0);
        if (p.event_type === 'interest') inv.total_interest = Number(inv.total_interest || 0) + Number(p.amount || 0);
        if (p.event_type === 'valuation') {
          if (inv.kind === 'securities') inv.current_price = Number(p.price);
          else { inv.latest_value = Number(p.amount); inv.latest_value_date = p.event_date; }
        }
        if (inv.kind === 'securities' && (p.event_type === 'buy' || p.event_type === 'sell')) {
          let qty = 0, avg = 0, realized = 0;
          list.filter(e => e.event_type === 'buy' || e.event_type === 'sell').sort((a, b) => String(a.event_date).localeCompare(String(b.event_date))).forEach(e => {
            if (e.event_type === 'buy') { avg = qty + e.quantity > 0 ? (qty * avg + e.quantity * e.price) / (qty + e.quantity) : avg; qty += e.quantity; }
            else { realized += e.quantity * (e.price - avg); qty -= e.quantity; }
          });
          inv.quantity = qty; inv.avg_cost = avg; inv.realized_pl = realized;
        }
      }
      return { ok: true, id };
    }
    if (action === 'delete_event') {
      for (const key of Object.keys(INVESTMENT_EVENTS)) { const i = INVESTMENT_EVENTS[key].findIndex(x => x.id === p.id); if (i >= 0) { INVESTMENT_EVENTS[key].splice(i, 1); break; } }
      return { ok: true };
    }
    return { ok: true };
  }
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch();
  const consoleErrors = [];
  const results = [];

  async function newPage() {
    const page = await browser.newPage();
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push('pageerror: ' + err.message));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.route('**/rest/v1/rpc/**', async route => {
      const url = route.request().url();
      const fn = url.split('/rpc/')[1].split('?')[0];
      let body = {};
      try { body = JSON.parse(route.request().postData() || '{}'); } catch {}
      const handler = RPC_HANDLERS[fn];
      const json = handler ? handler(body.p_action, body) : {};
      const { __status, ...jsonBody } = json || {};
      await route.fulfill({ status: __status || 200, contentType: 'application/json', body: JSON.stringify(jsonBody) });
    });
    await page.addInitScript(() => { localStorage.setItem('taichinh_gd_key_v1', 'x'.repeat(40)); });
    return page;
  }

  const page = await newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#app:not(.hidden)', { timeout: 8000 });
  results.push('BOOT: app shell visible after fixture bootstrap - OK');

  // Every card in a given row of a grid (money-board columns, dashboard's
  // two report columns) must render the same height — align-items:stretch
  // should guarantee this regardless of how much content each one has.
  async function rowHeightsEqual(selector) {
    const heights = await page.$$eval(selector, els => els.map(el => Math.round(el.getBoundingClientRect().height)));
    if (heights.length < 2) return { ok: true, heights };
    return { ok: heights.every(h => Math.abs(h - heights[0]) <= 1), heights };
  }

  // ---- Tổng quan: month-only, Nợ never appears anywhere ----
  // App now opens on Chi tiêu by default, so #content isn't Tổng quan yet
  // at boot — navigate there explicitly before reading its content.
  await page.click('[data-view="dashboard"]');
  await page.waitForTimeout(150);
  const dashboardText = await page.textContent('#content');
  const kpiLabels = await page.locator('.kpi-grid .kpi .label').allTextContents();
  results.push(`DASHBOARD kpi-grid = ${JSON.stringify(kpiLabels)}`);
  results.push(`  Shows exactly the 4 month-only KPIs: ${kpiLabels.length === 4}`);
  results.push(`  Tài sản ròng / Tiền thanh khoản / Tổng đầu tư NEVER appear on Tổng quan: ${!/Tài sản ròng|Tiền thanh khoản|Tổng đầu tư/.test(dashboardText)}`);
  results.push(`  Nợ / khoản vay NEVER appears anywhere on Tổng quan (no "Sắp đến hạn", no "Vay mua xe"): ${!dashboardText.includes('Sắp đến hạn') && !dashboardText.includes('Vay mua xe') && !/\bNợ\b/.test(dashboardText)}`);
  results.push(`  NISA / investment name never appears on Tổng quan: ${!dashboardText.includes('NISA')}`);
  results.push(`DASHBOARD shows month-over-month comparison text: ${dashboardText.includes('so với tháng trước') || dashboardText.includes('Bằng tháng trước')}`);
  results.push(`DASHBOARD shows "năm nay so với năm trước" section: ${dashboardText.includes('Năm nay so với năm trước')}`);
  const dashColHeights = await rowHeightsEqual('#content .dash-col');
  results.push(`DASHBOARD laid out as 2 equal-height columns (not one long stack): ${dashColHeights.ok} ${JSON.stringify(dashColHeights.heights)}`);
  results.push(`  "Từng tháng trong năm" (redundant second chart showing the same thu/chi-per-month info) is gone: ${!dashboardText.includes('Từng tháng trong năm')}`);
  results.push(`  "Thu nhập vs Chi tiêu" defaults to 12 tháng gần nhất: ${await page.locator('.chart-card', { hasText: 'Thu nhập vs Chi tiêu' }).locator('button:has-text("12 tháng")').getAttribute('class').then(c => c.includes('primary'))}`);
  await page.click('.chart-card button:has-text("Theo năm")');
  await page.waitForTimeout(100);
  results.push(`CLICK "Theo năm" on Thu nhập vs Chi tiêu: switches mode, chart still renders: ${await page.locator('.chart-card', { hasText: 'Thu nhập vs Chi tiêu' }).locator('p').textContent().then(t => t.includes('Theo năm')) && await page.locator('.chart-card svg').count() > 0}`);
  await page.click('.chart-card button:has-text("12 tháng")');
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(SHOT_DIR, 'shot-dashboard-1440.png'), fullPage: true });

  // ---- Chi tiêu: 4 columns now (Nợ removed) ----
  await page.click('[data-view="budget"]');
  await page.waitForSelector('.money-board');
  const cols = await page.$$('.money-column');
  results.push(`BUDGET column count = ${cols.length} (expect 4 — Nợ moved to Tài sản)`);
  results.push(`  No ".money-column.debt" exists in Chi tiêu anymore: ${await page.locator('.money-column.debt').count() === 0}`);
  const budgetText = await page.textContent('#content');
  results.push(`  Thẻ & trả góp column shows the card expense (Rakuten), Chi biến động untouched: ${budgetText.includes('Rakuten')}`);
  results.push(`  Per-row "Ghi thu/chi thực tế" ("+") buttons removed from Thu nhập/Chi tiêu rows (redundant now that quick-entry prefills): ${await page.locator('.money-column.income .mini-btn, .money-column.fixed .mini-btn, .money-column.variable .mini-btn').count() === 0}`);
  const budgetColHeights = await rowHeightsEqual('.money-board .money-column');
  results.push(`  All 4 Chi tiêu columns render the same height: ${budgetColHeights.ok} ${JSON.stringify(budgetColHeights.heights)}`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'shot-budget-1440.png'), fullPage: true });

  results.push(`  Mini KPI row (Thu nhập/Tổng chi/Còn lại/Tỷ lệ) shows on Chi tiêu, same labels as Tổng quan: ${await page.locator('.kpi-grid.sm .kpi .label', { hasText: 'Thu nhập tháng' }).count() > 0 && await page.locator('.kpi-grid.sm .kpi .label', { hasText: 'Tổng chi tiêu tháng' }).count() > 0}`);
  results.push(`APP OPENS ON Chi tiêu BY DEFAULT (nav "Chi tiêu" active, not Tổng quan): ${await page.locator('#nav button[data-view=budget].active').count() > 0}`);

  // ---- Bonus (ボーナス併用払い): pick tháng 7 (80,000) + tháng 12 (150,000)
  // — EACH month gets its OWN amount, not one shared number. Kỳ đầu absorbs
  // the rounding remainder, bonus is netted OUT of principal_amount first
  // so the whole schedule still sums to exactly principal_amount, and any
  // kỳ can be hand-corrected afterward via "Sửa".
  await page.click('.money-column.credit .money-line:has-text("Rakuten")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.click('#modalBody button:has-text("＋ Thêm khoản trả góp")');
  await page.waitForSelector('[name=name]', { timeout: 1500 });
  await page.fill('[name=name]', 'Máy giặt');
  await page.fill('[name=principal_amount]', '1200000');
  await page.fill('[name=total_installments]', '12');
  await page.fill('[name=purchase_date]', `${MONTH}-01`);
  results.push(`  Bonus month picker stays collapsed until the toggle is checked: ${!(await page.isVisible('#instBonusFields'))}`);
  await page.check('#instBonusToggle');
  results.push(`  Checking the bonus toggle reveals the month picker: ${await page.isVisible('#instBonusFields')}`);
  results.push(`  Tháng 7's own amount input stays hidden until Tháng 7 itself is checked: ${!(await page.isVisible('#instBonusAmt7'))}`);
  await page.check('#instBonusM7');
  results.push(`  Checking Tháng 7 reveals ONLY its own amount input, not Tháng 12's: ${await page.isVisible('#instBonusAmt7') && !(await page.isVisible('#instBonusAmt12'))}`);
  await page.fill('#instBonusAmt7', '80000');
  await page.check('#instBonusM12');
  await page.fill('#instBonusAmt12', '150000');
  await page.click('#modalForm [type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(() => results.push('SUBMIT installment with per-month bonus (tháng 7=80,000, tháng 12=150,000): saved - OK')).catch(() => results.push('SUBMIT installment with bonus: no toast - FAIL'));
  await page.waitForTimeout(150);

  await page.click('.money-column.credit .money-line:has-text("Rakuten")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  const ledgerText = await page.textContent('#modalBody');
  results.push(`  Installment row shows each month's OWN bonus amount (Tháng 7 +¥80,000, Tháng 12 +¥150,000, not the same number twice): ${ledgerText.includes('Tháng 7') && ledgerText.includes('80,000') && ledgerText.includes('Tháng 12') && ledgerText.includes('150,000')}`);
  await page.click('#modalBody button:has-text("Xem lịch")');
  await page.waitForTimeout(100);
  const scheduleText = await page.textContent('#modalBody');
  results.push(`  Schedule shows "Bonus" tag on exactly 2 kỳ (tháng 7 và 12): ${(scheduleText.match(/Bonus/g) || []).length === 2}`);
  results.push(`  Tháng 12 kỳ shows its own combined amount (¥230,833 = 80,833 đều + 150,000 bonus): ${scheduleText.includes('230,833')}`);
  results.push(`  Tháng 7 kỳ shows ITS OWN combined amount (¥160,833 = 80,833 đều + 80,000 bonus, different from tháng 12's): ${scheduleText.includes('160,833')}`);
  results.push(`  Kỳ đầu tiên absorbs the rounding remainder (¥80,837, not ¥80,833): ${scheduleText.includes('80,837')}`);

  // "Sửa" a kỳ by hand — the escape hatch for when the auto-split still
  // isn't what the household's real contract says.
  await page.click('#modalBody .tx:has-text("Kỳ 2") button:has-text("Sửa")');
  await page.waitForSelector('[name=principal_amount]', { timeout: 1500 });
  await page.fill('[name=principal_amount]', '90000');
  await page.click('#modalForm [type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(() => results.push('SUBMIT sửa tay kỳ 2 (90,000): saved - OK')).catch(() => results.push('SUBMIT sửa tay kỳ: no toast - FAIL'));
  await page.waitForTimeout(150);
  await page.click('.money-column.credit .money-line:has-text("Rakuten")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.click('#modalBody button:has-text("Xem lịch")');
  await page.waitForTimeout(100);
  const scheduleText2 = await page.textContent('#modalBody');
  results.push(`  Sửa tay kỳ 2 stuck (¥90,000) without touching other kỳ (tháng 12 vẫn ¥230,833): ${scheduleText2.includes('90,000') && scheduleText2.includes('230,833')}`);
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // Wifi (fx2, kế hoạch 6,000) has no actual transaction this month, so its
  // row opens quick-entry directly — the amount field should prefill from
  // the plan instead of forcing a re-type of the same number every month.
  await page.click('.money-line:has-text("Wifi")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  const qePrefill = await page.inputValue('#qeAmount');
  results.push(`  Quick-entry amount prefills from kế hoạch when opened from a category row (Wifi 6,000): ${qePrefill === '6000'}`);
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  for (const w of [430, 390]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    results.push(`MOBILE ${w}px: horizontal overflow px = ${overflow} (expect 0)`);
    await page.click('#mobileNav [data-view="dashboard"]');
    await page.waitForTimeout(150);
    const dashOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    results.push(`MOBILE ${w}px (Tổng quan, 2-column grid collapses to 1): horizontal overflow px = ${dashOverflow} (expect 0)`);
    await page.click('#mobileNav [data-view="budget"]');
    await page.waitForTimeout(150);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const view of ['dashboard', 'budget', 'investments', 'accounts', 'settings']) {
    await page.click(`[data-view="${view}"]`);
    await page.waitForTimeout(150);
    const whiteEls = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('#content *').forEach(el => {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg === 'rgb(255, 255, 255)' || bg === 'rgba(255, 255, 255, 1)') bad.push(el.className || el.tagName);
      });
      return bad;
    });
    results.push(`VIEW ${view}: renders without error, pure-white elements = ${whiteEls.length}`);
  }

  // ---- REAL CLICKS ONLY from here — a CSP-blocked handler must show up. ----
  await page.addInitScript(() => { window.confirm = () => false; });
  await page.reload();
  await page.waitForSelector('#app:not(.hidden)', { timeout: 8000 });
  // The view loop above ended on "settings" — a reload must land back there,
  // not reset to Tổng quan.
  results.push(`RELOAD: stays on last-viewed tab (Cài đặt) instead of resetting to Tổng quan: ${await page.locator('[data-view="settings"].active').count() > 0 && (await page.textContent('#pageTitle')) === 'Cài đặt'}`);
  async function resetToast() { await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.className = 'toast'; }); }
  async function clickAndCheckModal(label, selector, checkSelector) {
    await page.click(selector);
    try {
      await page.waitForSelector('#modal[open]', { timeout: 1500 });
      const ok = checkSelector ? await page.isVisible(checkSelector) : true;
      results.push(`CLICK ${label}: modal opened${checkSelector ? ', field visible=' + ok : ''} - OK`);
    } catch { results.push(`CLICK ${label}: modal did NOT open - FAIL`); }
    await page.evaluate(() => document.getElementById('modal')?.close());
    await page.waitForTimeout(50);
  }

  // ---- Quick entry: opened generically (no preset category), the amount
  // must auto-fill from whichever category's kế hoạch is picked INSIDE the
  // modal (chip click), not just when opened already pointed at one. ----
  await page.click('[data-view="dashboard"]');
  await page.click('#quickAdd');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.click('#qeTypeTabs button:has-text("Thu")');
  await page.click('#qeCategoryChips .chip:has-text("Lương C")');
  results.push(`  Quick-entry (opened generically): picking "Lương C" chip fills its kế hoạch (300,000): ${(await page.inputValue('#qeAmount')) === '300000'}`);
  await page.click('#qeTypeTabs button:has-text("Chi")');
  await page.click('#qeCategoryChips .chip:has-text("Ăn uống")');
  results.push(`  Switching to "Ăn uống" chip re-fills its own kế hoạch (60,000): ${(await page.inputValue('#qeAmount')) === '60000'}`);
  await page.fill('#qeAmount', '3000');
  await page.click('#qeCategoryChips .chip:has-text("Đi lại")');
  results.push(`  Typing over the prefilled amount is never overwritten again by a later category click: ${(await page.inputValue('#qeAmount')) === '3000'}`);
  await resetToast();
  await page.click('#modalForm [type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`SUBMIT quick-entry expense: saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('SUBMIT quick-entry expense: no toast - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // ---- Tài sản: 4-column board, new KPIs (no Thanh khoản ròng), charts ----
  await page.click('[data-view="accounts"]');
  await page.waitForTimeout(150);
  const assetKpiLabels = await page.locator('.kpi-grid .kpi .label').allTextContents();
  results.push(`ASSETS kpi-grid = ${JSON.stringify(assetKpiLabels)}`);
  results.push(`  Shows exactly 4 KPIs, no "Thanh khoản ròng" anywhere: ${assetKpiLabels.length === 4 && !assetKpiLabels.includes('Thanh khoản ròng')}`);
  const assetsCols = await page.$$('#content .money-column');
  results.push(`  4-column board present (Tiền mặt & ngân hàng / Đầu tư / Khoản phải thu / Nợ phải trả): ${assetsCols.length === 4}`);
  const assetColHeights = await rowHeightsEqual('.money-board .money-column');
  results.push(`  All 4 Tài sản columns render the same height: ${assetColHeights.ok} ${JSON.stringify(assetColHeights.heights)}`);
  const assetsText = await page.textContent('#content');
  results.push(`  Khoản vay cũ ¥1,250,000 (Vay mua xe) is visible in Nợ phải trả column: ${assetsText.includes('Vay mua xe') && assetsText.includes('1,250,000')}`);
  results.push(`  No "Chuyển tiền" button anywhere on Tài sản: ${!assetsText.includes('Chuyển tiền')}`);
  // A VND nợ phải trả ("Vay chị Hoa") stays INLINE in the main Nợ phải trả
  // column (one list, no second table) with its own currency shown as-is,
  // plus a small conversion-estimate line; Tổng nợ itself stays JPY-only
  // (an exact base-currency sum), never silently mixing the VND figure in.
  const debtColumnText = await page.locator('.money-column.debt').textContent();
  results.push(`  Nợ ngoại tệ (VND, "Vay chị Hoa") shows inline inside the main Nợ phải trả column: ${debtColumnText.includes('Vay chị Hoa') && debtColumnText.includes('5.000.000')}`);
  const tongNoValue = await page.locator('.kpi').filter({ has: page.locator('.label', { hasText: 'Tổng nợ' }) }).locator('.value').textContent();
  results.push(`  Tổng nợ KPI stays JPY-only (¥1,250,000), VND debt not silently mixed in: ${tongNoValue.includes('1,250,000')}`);
  results.push(`  VND debt row prompts to set a conversion rate when none is configured: ${debtColumnText.includes('Chưa đặt tỷ giá quy đổi ở Cài đặt')}`);
  results.push(`  Cơ cấu tài sản (composition) chart present: ${await page.locator('.chart-card', { hasText: 'Cơ cấu tài sản' }).count() > 0}`);
  results.push(`  Lịch sử theo tháng (history) chart present with period toggle: ${await page.locator('.chart-card', { hasText: 'Lịch sử theo tháng' }).count() > 0 && await page.locator('button:has-text("6 tháng")').count() > 0}`);
  const assetChartHeights = await rowHeightsEqual('#content .section-grid .chart-card');
  results.push(`  Tài sản's two charts sit side-by-side (2 equal-height columns), not stacked full-width: ${assetChartHeights.heights.length === 2 && assetChartHeights.ok} ${JSON.stringify(assetChartHeights.heights)}`);
  await page.click('button:has-text("6 tháng")');
  await page.waitForTimeout(150);
  results.push('CLICK "6 tháng" period toggle: no crash - OK');
  await page.screenshot({ path: path.join(SHOT_DIR, 'shot-accounts-1440.png'), fullPage: true });

  // Account row → history modal: Tăng/Giảm/Sửa only. Thêm/Xóa a whole
  // account now live only behind the column's "⚙ Cài đặt" (matches Chi
  // tiêu's "row shows, cài đặt manages the list" pattern).
  await page.click('.money-line:has-text("UFJ")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK account row (UFJ, adjustment history): modal opened - OK')).catch(() => results.push('CLICK account row: modal did NOT open - FAIL'));
  const adjHistText = await page.textContent('#modalBody');
  results.push(`  Adjustment history lists the fixture row and a month/year filter: ${adjHistText.includes('100') && (await page.locator('#adjHistFilter').count()) > 0}`);
  results.push(`  Account history modal has Sửa but NOT Xóa (Xóa moved to column "⚙ Cài đặt"): ${await page.locator('#modalBody .row.wrap button:has-text("Sửa")').count() > 0 && await page.locator('#modalBody .row.wrap button:has-text("Xóa")').count() === 0}`);
  await page.click('#modalBody .row.wrap button:has-text("Sửa")');
  await page.waitForSelector('[name="name"]', { timeout: 1500 }).then(() => results.push('CLICK account "Sửa" (from UFJ history modal): edit form opened - OK')).catch(() => results.push('CLICK account "Sửa": edit form did NOT open - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // Khoản định kỳ: a recurring "Wifi" template on UFJ (fixture) starts
  // pending, gets confirmed, and a brand-new one can be added — the whole
  // "pick once, stop re-typing every month" flow the account owner asked for.
  await page.click('.money-line:has-text("UFJ")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.click('#modalBody .row.wrap button:has-text("🔁 Định kỳ")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK "🔁 Định kỳ" (from UFJ history modal): manager opened - OK')).catch(() => results.push('CLICK "🔁 Định kỳ": manager did NOT open - FAIL'));
  const recurringText = await page.textContent('#modalBody');
  results.push(`  Recurring manager lists the fixture "Wifi" item as pending: ${recurringText.includes('Wifi') && recurringText.includes('Chưa xác nhận tháng này')}`);
  await resetToast();
  await page.click('#modalBody .tx:has-text("Wifi") button:has-text("Xác nhận")');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`CLICK "Xác nhận" (Wifi): saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('CLICK "Xác nhận": no toast - FAIL'));
  results.push(`  After confirming, "Wifi" shows as confirmed for this month: ${(await page.textContent('#modalBody')).includes('Đã xác nhận tháng này')}`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'shot-recurring-manager.png') });
  await page.click('#modalBody button:has-text("＋ Thêm khoản định kỳ")');
  await page.waitForSelector('[name="name"]', { timeout: 1500 }).then(() => results.push('CLICK "＋ Thêm khoản định kỳ": add form opened - OK')).catch(() => results.push('CLICK "＋ Thêm khoản định kỳ": did NOT open - FAIL'));
  await page.fill('[name="name"]', 'Lương');
  await page.selectOption('[name="direction"]', 'increase');
  await page.fill('[name="amount"]', '300000');
  await page.fill('[name="day_of_month"]', '25');
  await resetToast();
  await page.click('#modalForm [type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`SUBMIT new recurring item (Lương): saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('SUBMIT new recurring item: no toast - FAIL'));

  await page.click('.money-column.income .column-settings');
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK account column "⚙ Cài đặt": manager opened - OK')).catch(() => results.push('CLICK account column "⚙ Cài đặt": did NOT open - FAIL'));
  results.push(`  Account manager lists both accounts, each with its own Xóa: ${await page.locator('#modalBody .tx:has-text("UFJ") button:has-text("Xóa")').count() > 0 && await page.locator('#modalBody .tx:has-text("Tiền mặt") button:has-text("Xóa")').count() > 0}`);
  await page.click('#modalBody .row.wrap button:has-text("＋ Thêm tài khoản")');
  await page.waitForSelector('[name="name"]', { timeout: 1500 }).then(() => results.push('CLICK account manager "＋ Thêm tài khoản": add form opened - OK')).catch(() => results.push('CLICK account manager "＋ Thêm tài khoản": did NOT open - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // Nợ phải trả: row is Tăng/Giảm/Sửa only, same as accounts.
  await page.click('.money-column.debt .money-line:has-text("Vay mua xe")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK Nợ row (Vay mua xe): history modal opened - OK')).catch(() => results.push('CLICK Nợ row: modal did NOT open - FAIL'));
  results.push(`  Nợ history modal has Tăng/Giảm/Sửa but NOT Xóa: ${await page.locator('#modalBody .row.wrap button:has-text("Tăng dư nợ")').count() > 0 && await page.locator('#modalBody .row.wrap button:has-text("Giảm dư nợ")').count() > 0 && await page.locator('#modalBody .row.wrap button:has-text("Sửa")').count() > 0 && await page.locator('#modalBody .row.wrap button:has-text("Xóa")').count() === 0}`);
  await page.click('#modalBody .row.wrap button:has-text("Tăng dư nợ")');
  await page.waitForSelector('[name="amount"]', { timeout: 1500 }).then(() => results.push('CLICK Nợ "Tăng dư nợ" (from history modal): form opened - OK')).catch(() => results.push('CLICK Nợ "Tăng dư nợ": form did NOT open - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);
  await page.click('.money-column.debt .money-line:has-text("Vay mua xe")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.click('#modalBody .row.wrap button:has-text("Sửa")');
  await page.waitForSelector('[name="name"]', { timeout: 1500 }).then(() => results.push('CLICK Nợ "Sửa" (from history modal): edit form opened - OK')).catch(() => results.push('CLICK Nợ "Sửa": edit form did NOT open - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  await page.click('.money-column.credit .money-line');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  results.push(`  Đầu tư row (Tài sản page) history modal has Sửa but NOT Xóa: ${await page.locator('#modalBody .row.wrap button:has-text("Sửa")').count() > 0 && await page.locator('#modalBody .row.wrap button:has-text("Xóa")').count() === 0}`);
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // Nợ column "⚙ Cài đặt": manager lists debts with their own Xóa, plus "＋ Thêm".
  await page.click('.money-column.debt .column-settings');
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK Nợ column "⚙ Cài đặt": manager opened - OK')).catch(() => results.push('CLICK Nợ column "⚙ Cài đặt": did NOT open - FAIL'));
  results.push(`  Nợ manager lists "Vay mua xe" with its own Xóa: ${await page.locator('#modalBody .tx:has-text("Vay mua xe") button:has-text("Xóa")').count() > 0}`);
  await page.click('#modalBody .row.wrap button:has-text("＋ Thêm")');
  await page.waitForSelector('[name="name"]', { timeout: 1500 });
  await page.fill('[name="name"]', 'Vay tiêu dùng');
  await resetToast();
  await page.click('#modalForm [type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`SUBMIT new debt (Vay tiêu dùng): saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('SUBMIT new debt: no toast - FAIL'));

  // Khoản phải thu: add one via its column manager, verify it shows.
  await page.click('.money-column:has-text("Khoản phải thu") .column-settings');
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK Khoản phải thu "⚙ Cài đặt": manager opened - OK')).catch(() => results.push('CLICK Khoản phải thu "⚙ Cài đặt": did NOT open - FAIL'));
  await page.click('#modalBody .row.wrap button:has-text("＋ Thêm")');
  await page.waitForSelector('[name="name"]', { timeout: 1500 });
  await page.fill('[name="name"]', 'Bạn A nợ');
  await page.fill('[name="opening_amount"]', '50000');
  await resetToast();
  await page.click('#modalForm [type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`SUBMIT new receivable: saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('SUBMIT new receivable: no toast - FAIL'));

  const foreignSection = page.locator('.section', { hasText: 'Tài khoản ngoại tệ' });
  results.push(`Foreign-currency account (VND) shows up on Tài sản instead of vanishing: ${await foreignSection.count() > 0}`);
  results.push(`"Tài khoản đã ẩn" section no longer exists anywhere (🗑 is a real delete now, not archive): ${await page.locator('.section', { hasText: 'Tài khoản đã ẩn' }).count() === 0}`);

  // Xóa: an account with no adjustment history deletes for real and
  // disappears; one WITH history is refused with a clear message instead
  // of silently archiving. Xóa now lives only inside the column's "⚙ Cài
  // đặt" manager, so open that first each time.
  // window.confirm() is stubbed false for this whole "real clicks" phase,
  // so flip it true just for these two confirm()-gated deletes and put it
  // back after.
  await page.evaluate(() => { window.confirm = () => true; });
  await resetToast();
  await page.click('.money-column.income .column-settings');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.click('#modalBody .tx:has-text("Tiền mặt") button:has-text("Xóa")'); // no adjustment history
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`CLICK Xóa "Tiền mặt" (from column manager): saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('CLICK Xóa "Tiền mặt": no toast - FAIL'));
  const incomeRowCount = await page.locator('.money-column.income .money-line').count();
  results.push(`  Xóa "Tiền mặt" (no history): row actually removed (1 row left — UFJ only, not 2): ${incomeRowCount === 1}`);
  await resetToast();
  await page.click('.money-column.income .column-settings');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.click('#modalBody .tx:has-text("UFJ") button:has-text("Xóa")'); // has adjustment history in the fixture
  await page.waitForSelector('#toast.show', { timeout: 1500 });
  const blockedToast = await page.textContent('#toast');
  results.push(`  Xóa "UFJ" (has history): blocked with a clear message, not silently archived: ${blockedToast.includes('đã có lịch sử')} (toast: "${blockedToast}")`);
  results.push(`  UFJ is still there after the blocked delete: ${(await page.textContent('.money-column.income')).includes('UFJ')}`);
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);
  await page.evaluate(() => { window.confirm = () => false; });

  // ---- Đầu tư: NISA plan, securities trade, savings interest ----
  await page.click('[data-view="investments"]');
  await page.waitForTimeout(150);
  const investText = await page.textContent('#content');
  results.push(`INVESTMENTS groups by kind (NISA / Chứng khoán / Tiết kiệm sinh lời sections): ${investText.includes('NISA') && investText.includes('Chứng khoán') && investText.includes('Tiết kiệm sinh lời')}`);
  results.push(`  NISA card shows contribution-plan widget: ${investText.includes('Kế hoạch góp tháng')}`);
  results.push(`  NISA card shows simulated growth separate from real value: ${investText.includes('mô phỏng')}`);
  results.push(`  Securities card shows quantity × price and vốn/giá vốn TB: ${investText.includes('Giá vốn TB')}`);
  results.push(`  Savings card shows "Lãi thực nhận" distinct from principal: ${investText.includes('Lãi thực nhận')}`);
  const investCols = await page.$$('#content .money-column');
  results.push(`  Đầu tư laid out as a 4-column board (NISA / Chứng khoán / Tiết kiệm sinh lời / Khác), like Chi tiêu/Tài sản: ${investCols.length === 4}`);
  const investColHeights = await rowHeightsEqual('.money-board .money-column');
  results.push(`  All 4 Đầu tư columns render the same height: ${investColHeights.ok} ${JSON.stringify(investColHeights.heights)}`);
  const investBoardTracks = await page.evaluate(() => { const el = document.querySelector('#content .money-board'); return el ? getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length : null; });
  results.push(`  Đầu tư board has exactly 4 grid tracks (no phantom empty column): ${investBoardTracks === 4}`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'shot-investments-1440.png'), fullPage: true });

  await clickAndCheckModal('investments "+ Đầu tư mới"', 'button:has-text("＋ Đầu tư mới")', '[name="name"]');
  await page.click('button:has-text("＋ Đầu tư mới")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.selectOption('#invKind', 'nisa');
  const nisaGroupVisible = await page.isVisible('[data-kind-group="nisa"]');
  const otherGroupHidden = await page.isHidden('[data-kind-group="other"]');
  results.push(`  New-investment form shows NISA fields and hides Khác fields when kind=nisa: ${nisaGroupVisible && otherGroupHidden}`);
  await page.selectOption('#invKind', 'securities');
  const securitiesGroupVisible = await page.isVisible('[data-kind-group="securities"]');
  results.push(`  Switching to kind=securities shows the Chứng khoán field group: ${securitiesGroupVisible}`);
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // NISA holdings ("chế độ chi tiết"): a quỹ/ETF nested inside the NISA
  // account, with its own buy price -> current price -> % (per user's
  // "NISA doesn't show % like chứng khoán does" feedback), rolling the
  // account's own headline value/vốn ròng up from its holdings.
  const nisaCard = page.locator('.item-card', { hasText: 'NISA Rakuten' });
  const nisaCardText = await nisaCard.textContent();
  results.push(`  NISA card shows nested quỹ/ETF with buy price, current price and %: ${nisaCardText.includes('eMAXIS Slim') && nisaCardText.includes('15,000') && nisaCardText.includes('%')}`);
  results.push(`  NISA headline value rolls up from its holding (¥165,000 = 10 × 16,500), not the stale account-level ¥550,000: ${nisaCardText.includes('165,000') && !nisaCardText.includes('550,000')}`);
  results.push(`  Account-level "Cập nhật giá trị" is hidden once NISA has a quỹ/ETF (can't silently double-count): ${await nisaCard.locator('button:has-text("Cập nhật giá trị")').count() === 0}`);
  await nisaCard.locator('button:has-text("＋ Thêm quỹ/ETF")').click();
  await page.waitForSelector('[name="ticker"]', { timeout: 1500 }).then(() => results.push('CLICK NISA "+ Thêm quỹ/ETF": form opened with mã chứng khoán field - OK')).catch(() => results.push('CLICK "+ Thêm quỹ/ETF": form did NOT open - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);
  await nisaCard.locator('button:has-text("Mua")').click();
  await page.waitForSelector('[name="quantity"]', { timeout: 1500 }).then(() => results.push('CLICK nested quỹ "Mua": trade form opened - OK')).catch(() => results.push('CLICK nested quỹ "Mua": form did NOT open - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // NISA plan: confirm this month's contribution.
  const pendingBtn = nisaCard.locator('button:has-text("Xác nhận đã góp")');
  if (await pendingBtn.count()) {
    await pendingBtn.click();
    await page.waitForSelector('[name="amount"]', { timeout: 1500 }).then(() => results.push('CLICK NISA "Xác nhận đã góp": confirm form opened (prefilled, editable) - OK')).catch(() => results.push('CLICK "Xác nhận đã góp": form did NOT open - FAIL'));
    await resetToast();
    await page.click('#modalForm [type=submit]');
    await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`SUBMIT NISA contribution confirm: saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('SUBMIT NISA contribution confirm: no toast - FAIL'));
  } else {
    results.push('NISA plan already confirmed for this month in fixture — "Xác nhận đã góp" button not shown (expected once confirmed) - OK');
  }

  // BUG FIX regression check: a simple-mode NISA (no quỹ/ETF) with a prior
  // "Cập nhật giá trị" (220,000) must actually move when "Thêm vốn" is
  // used — it must NOT freeze at the old snapshot (user-reported bug).
  const nisa2Card = page.locator('.item-card', { hasText: 'NISA SBI' });
  results.push(`  NISA SBI shows its valuation snapshot before any new "Thêm vốn" (220,000): ${(await nisa2Card.textContent()).includes('220,000')}`);
  await nisa2Card.locator('button:has-text("Thêm vốn")').click();
  await page.waitForSelector('[name="amount"]', { timeout: 1500 });
  await page.fill('[name="amount"]', '50000');
  await resetToast();
  await page.click('#modalForm [type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 });
  const nisa2AfterText = await page.locator('.item-card', { hasText: 'NISA SBI' }).textContent();
  results.push(`  BUGFIX regression: after "Thêm vốn" +50,000, giá trị hiện tại updates to 270,000 (not stuck at 220,000): ${nisa2AfterText.includes('270,000') && !nisa2AfterText.includes('220,000')}`);

  // Securities: Mua/Bán.
  const secCard = page.locator('.item-card', { hasText: 'Toyota' });
  await secCard.locator('button:has-text("Mua")').click();
  await page.waitForSelector('[name="quantity"]', { timeout: 1500 }).then(() => results.push('CLICK securities "Mua": trade form opened with quantity+price - OK')).catch(() => results.push('CLICK "Mua": form did NOT open - FAIL'));
  await page.fill('[name="quantity"]', '10');
  await page.fill('[name="price"]', '2100');
  await resetToast();
  await page.click('#modalForm [type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`SUBMIT securities buy: saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('SUBMIT securities buy: no toast - FAIL'));

  const secCard2 = page.locator('.item-card', { hasText: 'Toyota' });
  await secCard2.locator('button:has-text("Bán")').click();
  await page.waitForSelector('[name="quantity"]', { timeout: 1500 }).then(() => results.push('CLICK securities "Bán": trade form opened - OK')).catch(() => results.push('CLICK "Bán": form did NOT open - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // Savings: Nhận lãi.
  const savCard = page.locator('.item-card', { hasText: 'Tiết kiệm kỳ hạn SBI' });
  await savCard.locator('button:has-text("Nhận lãi")').click();
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK savings "Nhận lãi": form opened - OK')).catch(() => results.push('CLICK "Nhận lãi": form did NOT open - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // Đầu tư "Xem lịch sử" and delete an event.
  await nisaCard.locator('button:has-text("Xem lịch sử")').click();
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK investment "Xem lịch sử": modal opened - OK')).catch(() => results.push('CLICK "Xem lịch sử": modal did NOT open - FAIL'));
  const histText = await page.textContent('#modalBody');
  results.push(`  History shows labeled Sửa/Xóa buttons: ${histText.includes('Sửa') && histText.includes('Xóa')}`);
  await page.evaluate(() => { window.confirm = () => true; });
  await resetToast();
  await page.click('#modalBody .tx .btn:has-text("Xóa")');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`CLICK delete investment event: saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('CLICK delete investment event: no toast - FAIL'));
  await page.evaluate(() => { window.confirm = () => false; });
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // ---- Nav: no "Giao dịch" tab anywhere ----
  const navLabels = await page.locator('#nav button span').allTextContents();
  results.push(`NAV has exactly Tổng quan/Chi tiêu/Đầu tư/Tài sản/Cài đặt, no Giao dịch: ${JSON.stringify(navLabels)} / ${!navLabels.includes('Giao dịch')}`);

  // ---- Cài đặt ----
  await page.click('[data-view="settings"]');
  await resetToast();
  await page.click('#householdForm button[type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`SUBMIT "Gia đình" form: saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('SUBMIT "Gia đình" form: no toast - FAIL'));

  // Setting a JPY↔VND rate must fold the VND payable ("Vay chị Hoa") INTO
  // Tổng nợ (converted), not just show a cosmetic "≈" that never counts.
  await page.fill('#reportingForm [name=jpy_vnd_rate]', '168');
  await page.check('#reportingForm [name=show_vnd_conversion]');
  await resetToast();
  await page.click('#reportingForm button[type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(() => results.push('SUBMIT tỷ giá quy đổi (1 JPY = 168 VND): saved - OK')).catch(() => results.push('SUBMIT tỷ giá quy đổi: no toast - FAIL'));
  await page.click('[data-view="accounts"]');
  await page.waitForTimeout(150);
  const tongNoAfterRate = await page.locator('.kpi').filter({ has: page.locator('.label', { hasText: 'Tổng nợ' }) }).locator('.value').textContent();
  results.push(`  Sau khi đặt tỷ giá, Tổng nợ cộng thêm phần quy đổi VND (¥1,279,762 = 1,250,000 + 5,000,000/168), không còn dừng ở ¥1,250,000: ${tongNoAfterRate.includes('1,279,762')}`);
  const debtColumnTextAfterRate = await page.textContent('.money-column.debt');
  results.push(`  Dòng "Vay chị Hoa" giờ hiện số quy đổi (≈), không còn nhắc "chưa đặt tỷ giá": ${debtColumnTextAfterRate.includes('29,762') && !debtColumnTextAfterRate.includes('Chưa đặt tỷ giá')}`);

  const csvBtn = await page.$('button:has-text("Xuất CSV")');
  if (csvBtn) {
    try {
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 1500 }), csvBtn.click()]);
      const csvPath = path.join(SHOT_DIR, await download.suggestedFilename());
      await download.saveAs(csvPath);
      const csvContent = fs.readFileSync(csvPath, 'utf8');
      results.push(`CLICK "Xuất CSV giao dịch": download triggered - OK`);
      results.push(`CSV content has header row: ${csvContent.startsWith('﻿Ngày,Loại,Danh mục')}`);
    } catch { results.push('CLICK "Xuất CSV giao dịch": download did NOT trigger - FAIL'); }
  }

  // Explicit CSP-violation scan.
  const cspHits = consoleErrors.filter(e => /content security policy|refused to execute inline event handler/i.test(e));
  results.push(`CSP VIOLATIONS DETECTED: ${cspHits.length} (must be 0)`);
  cspHits.forEach(e => results.push('  CSP: ' + e));

  results.push(`CONSOLE ERRORS (total): ${consoleErrors.length}`);
  consoleErrors.slice(0, 15).forEach(e => results.push('  ERR: ' + e));

  await browser.close();
  server.close();

  console.log(results.join('\n'));
  const failed = results.some(r => r.includes('FAIL')) || cspHits.length > 0;
  process.exit(failed ? 1 : 0);
})();
