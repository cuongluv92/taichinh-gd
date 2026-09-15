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
const DEBTS = [
  { id: 'd1', name: 'Vay mua xe', counterparty: 'Ngân hàng ABC', direction: 'payable', currency: 'JPY', opening_amount: 1250000, start_date: `${MONTH}-15`, due_date: '2026-12-01', interest_rate: 0, is_active: true }
];
const DEBT_ADJUSTMENTS = [];
const INVESTMENTS = [
  { id: 'nisa1', name: 'NISA Rakuten', kind: 'nisa', currency: 'JPY', initial_capital: 400000, note: '', created_at: `${MONTH}-01T00:00:00Z`, start_date: '2026-01-01', broker_name: 'Rakuten Securities', nisa_frame: 'both', nisa_annual_limit: 3600000, monthly_amount: 30000, monthly_day: 5, plan_start_month: `${MONTH}-01`, plan_paused: false, expected_return_rate: 5, expected_return_period: 'annual', reinvest_mode: 'none', total_contributed: 100000, total_withdrawn: 0, latest_value: 550000, latest_value_date: `${MONTH}-10`, parent_investment_id: null },
  { id: 'fund1', name: 'eMAXIS Slim toàn cầu', kind: 'securities', currency: 'JPY', initial_capital: 0, note: '', created_at: `${MONTH}-03T00:00:00Z`, ticker: '2559', market: 'TSE', quantity: 10, avg_cost: 15000, current_price: 16500, realized_pl: 0, total_contributed: 150000, total_withdrawn: 0, total_dividends: 0, parent_investment_id: 'nisa1' },
  { id: 'sec1', name: 'Toyota', kind: 'securities', currency: 'JPY', initial_capital: 0, note: '', created_at: `${MONTH}-01T00:00:00Z`, broker_name: 'SBI', ticker: '7203', market: 'TSE', quantity: 100, avg_cost: 2000, current_price: 2200, realized_pl: 0, total_contributed: 200000, total_withdrawn: 0, total_dividends: 0, parent_investment_id: null },
  { id: 'sav1', name: 'Tiết kiệm kỳ hạn SBI', kind: 'savings_interest', currency: 'JPY', initial_capital: 500000, note: '', created_at: `${MONTH}-01T00:00:00Z`, bank_name: 'SBI Sumishin', interest_rate_annual: 1, interest_payment_method: 'maturity', term_end_date: '2027-09-15', total_contributed: 0, total_withdrawn: 0, total_interest: 5000, parent_investment_id: null }
];
const INVESTMENT_EVENTS = {
  nisa1: [
    { id: 'ev1', event_type: 'contribution', amount: 100000, event_date: `${MONTH}-02`, note: '' },
    { id: 'ev2', event_type: 'valuation', amount: 550000, event_date: `${MONTH}-10`, note: '' }
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
  taichinh_gd_api: (action) => {
    if (action === 'bootstrap' || action === 'month') return { household: { name: 'Nguyễn Gia', base_currency: 'JPY' }, accounts: ACCOUNTS, categories: CATEGORIES, category_versions: [], transactions: MONTH_TX };
    if (action === 'export') return { transactions: FULL_TX };
    if (action === 'save_account') return { ok: true, id: 'newacct1' };
    return { ok: true, id: 'x' };
  },
  taichinh_gd_extension_api: (action) => {
    if (action === 'save_reporting') return { ok: true };
    return { reporting: { show_vnd_conversion: false, jpy_vnd_rate: null }, loan_terms: [] };
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
      const schedule = Array.from({ length: total }, (_, i) => ({ id: newId('sch'), installment_no: i + 1, payment_month: addMonths(p.first_payment_month?.slice(0, 7) || MONTH, i) + '-01', principal_amount: Math.round(principal / total), fee_amount: 0, is_paid: false, payment_kind: 'regular' }));
      const id = newId('inst');
      INSTALLMENTS.push({ id, card_account_id: p.card_account_id, card_name: (ACCOUNTS.find(a => a.id === p.card_account_id) || {}).name, name: p.name, purchase_date: p.purchase_date, principal_amount: principal, fee_total: 0, total_installments: total, paid_installments_before: 0, first_payment_month: p.first_payment_month, currency: 'JPY', note: p.note || '', schedule });
      return { ok: true, id };
    }
    if (action === 'delete_installment') { const i = INSTALLMENTS.findIndex(x => x.id === p.id); if (i >= 0) INSTALLMENTS.splice(i, 1); return { ok: true }; }
    if (action === 'toggle_paid') { for (const inst of INSTALLMENTS) { const row = (inst.schedule || []).find(s => s.id === p.id); if (row) { row.is_paid = !row.is_paid; break; } } return { ok: true }; }
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
    });
    await page.addInitScript(() => { localStorage.setItem('taichinh_gd_key_v1', 'x'.repeat(40)); });
    return page;
  }

  const page = await newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#app:not(.hidden)', { timeout: 8000 });
  results.push('BOOT: app shell visible after fixture bootstrap - OK');

  // ---- Tổng quan: month-only, Nợ never appears anywhere ----
  const dashboardText = await page.textContent('#content');
  const kpiLabels = await page.locator('.kpi-grid .kpi .label').allTextContents();
  results.push(`DASHBOARD kpi-grid = ${JSON.stringify(kpiLabels)}`);
  results.push(`  Shows exactly the 4 month-only KPIs: ${kpiLabels.length === 4}`);
  results.push(`  Tài sản ròng / Tiền thanh khoản / Tổng đầu tư NEVER appear on Tổng quan: ${!/Tài sản ròng|Tiền thanh khoản|Tổng đầu tư/.test(dashboardText)}`);
  results.push(`  Nợ / khoản vay NEVER appears anywhere on Tổng quan (no "Sắp đến hạn", no "Vay mua xe"): ${!dashboardText.includes('Sắp đến hạn') && !dashboardText.includes('Vay mua xe') && !/\bNợ\b/.test(dashboardText)}`);
  results.push(`  NISA / investment name never appears on Tổng quan: ${!dashboardText.includes('NISA')}`);
  results.push(`DASHBOARD shows month-over-month comparison text: ${dashboardText.includes('so với tháng trước') || dashboardText.includes('Bằng tháng trước')}`);
  results.push(`DASHBOARD shows "năm nay so với năm trước" section: ${dashboardText.includes('Năm nay so với năm trước')}`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'shot-dashboard-1440.png'), fullPage: true });

  // ---- Chi tiêu: 4 columns now (Nợ removed) ----
  await page.click('[data-view="budget"]');
  await page.waitForSelector('.money-board');
  const cols = await page.$$('.money-column');
  results.push(`BUDGET column count = ${cols.length} (expect 4 — Nợ moved to Tài sản)`);
  results.push(`  No ".money-column.debt" exists in Chi tiêu anymore: ${await page.locator('.money-column.debt').count() === 0}`);
  const budgetText = await page.textContent('#content');
  results.push(`  Thẻ & trả góp column shows the card expense (Rakuten), Chi biến động untouched: ${budgetText.includes('Rakuten')}`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'shot-budget-1440.png'), fullPage: true });

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

  // ---- Quick entry ----
  await page.click('[data-view="dashboard"]');
  await page.click('#quickAdd');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.fill('#qeAmount', '3000');
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
  const assetsText = await page.textContent('#content');
  results.push(`  Khoản vay cũ ¥1,250,000 (Vay mua xe) is visible in Nợ phải trả column: ${assetsText.includes('Vay mua xe') && assetsText.includes('1,250,000')}`);
  results.push(`  No "Chuyển tiền" button anywhere on Tài sản: ${!assetsText.includes('Chuyển tiền')}`);
  results.push(`  Cơ cấu tài sản (composition) chart present: ${await page.locator('.chart-card', { hasText: 'Cơ cấu tài sản' }).count() > 0}`);
  results.push(`  Lịch sử theo tháng (history) chart present with period toggle: ${await page.locator('.chart-card', { hasText: 'Lịch sử theo tháng' }).count() > 0 && await page.locator('button:has-text("6 tháng")').count() > 0}`);
  await page.click('button:has-text("6 tháng")');
  await page.waitForTimeout(150);
  results.push('CLICK "6 tháng" period toggle: no crash - OK');
  await page.screenshot({ path: path.join(SHOT_DIR, 'shot-accounts-1440.png'), fullPage: true });

  // Account +/- adjustment.
  await page.click('.money-line:has-text("UFJ")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK account row (UFJ, adjustment history): modal opened - OK')).catch(() => results.push('CLICK account row: modal did NOT open - FAIL'));
  const adjHistText = await page.textContent('#modalBody');
  results.push(`  Adjustment history lists the fixture row and a month/year filter: ${adjHistText.includes('100') && (await page.locator('#adjHistFilter').count()) > 0}`);
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);
  await clickAndCheckModal('account "＋ Thêm" (Tiền mặt & ngân hàng column)', '.money-column.income .column-settings', '[name="name"]');
  await clickAndCheckModal('account row "Sửa" mini-btn (UFJ)', '.money-column.income .mini-btn[title="Sửa"]', '[name="name"]');
  results.push(`  Account row also has an "Ẩn" mini-btn (was add-only before): ${await page.locator('.money-column.income .mini-btn[title="Ẩn"]').count() > 0}`);

  // Nợ phải trả: view, adjust, add.
  await page.click('.money-column.debt .money-line:has-text("Vay mua xe")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK Nợ row (Vay mua xe): history modal opened - OK')).catch(() => results.push('CLICK Nợ row: modal did NOT open - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);
  await clickAndCheckModal('Nợ inline "Tăng" button', '.money-column.debt .mini-btn[title="Tăng"]', '[name="amount"]');
  await clickAndCheckModal('Nợ row "Sửa" mini-btn', '.money-column.debt .mini-btn[title="Sửa"]', '[name="name"]');
  results.push(`  Nợ row also has an "Ẩn" mini-btn (was add-only before): ${await page.locator('.money-column.debt .mini-btn[title="Ẩn"]').count() > 0}`);
  results.push(`  Đầu tư row (Tài sản page) has a "Xóa" mini-btn (was Sửa-only before): ${await page.locator('.money-column.credit .mini-btn[title^="Xóa"]').count() > 0}`);
  await clickAndCheckModal('Nợ column "＋ Thêm"', '.money-column.debt .column-settings', '[name="name"]');
  await page.click('.money-column.debt .column-settings');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.fill('[name="name"]', 'Vay tiêu dùng');
  await resetToast();
  await page.click('#modalForm [type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`SUBMIT new debt (Vay tiêu dùng): saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('SUBMIT new debt: no toast - FAIL'));

  // Khoản phải thu: add one, verify it shows.
  await page.click('.money-column:has-text("Khoản phải thu") .column-settings');
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK Khoản phải thu "＋ Thêm": form opened - OK')).catch(() => results.push('CLICK Khoản phải thu "＋ Thêm": did NOT open - FAIL'));
  await page.fill('[name="name"]', 'Bạn A nợ');
  await page.fill('[name="opening_amount"]', '50000');
  await resetToast();
  await page.click('#modalForm [type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`SUBMIT new receivable: saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('SUBMIT new receivable: no toast - FAIL'));

  const foreignSection = page.locator('.section', { hasText: 'Tài khoản ngoại tệ' });
  results.push(`Foreign-currency account (VND) shows up on Tài sản instead of vanishing: ${await foreignSection.count() > 0}`);
  const hiddenSection = page.locator('.section', { hasText: 'Tài khoản đã ẩn' });
  results.push(`Hidden account (Ví cũ) listed under "Tài khoản đã ẩn": ${await hiddenSection.count() > 0}`);

  // ---- Đầu tư: NISA plan, securities trade, savings interest ----
  await page.click('[data-view="investments"]');
  await page.waitForTimeout(150);
  const investText = await page.textContent('#content');
  results.push(`INVESTMENTS groups by kind (NISA / Chứng khoán / Tiết kiệm sinh lời sections): ${investText.includes('NISA') && investText.includes('Chứng khoán') && investText.includes('Tiết kiệm sinh lời')}`);
  results.push(`  NISA card shows contribution-plan widget: ${investText.includes('Kế hoạch góp tháng')}`);
  results.push(`  NISA card shows simulated growth separate from real value: ${investText.includes('mô phỏng')}`);
  results.push(`  Securities card shows quantity × price and vốn/giá vốn TB: ${investText.includes('Giá vốn TB')}`);
  results.push(`  Savings card shows "Lãi thực nhận" distinct from principal: ${investText.includes('Lãi thực nhận')}`);
  const gridCols = await page.evaluate(() => { const el = document.querySelector('.account-grid'); return el ? getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length : null; });
  results.push(`  Investment cards stack in a single vertical column (account-grid has exactly 1 track): ${gridCols === 1}`);
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
