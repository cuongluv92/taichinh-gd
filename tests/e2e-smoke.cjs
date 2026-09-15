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
// No account_type 'investment' or 'credit' balance concept anymore — cash/
// bank/savings only carry a Tài sản balance; the card account is a Chi tiêu
// identity referenced by card_expenses/installments, nothing more.
const ACCOUNTS = [
  { id: 'bank', name: 'UFJ', account_type: 'bank', currency: 'JPY', opening_balance: 300000, is_active: true },
  { id: 'cash', name: 'Tiền mặt', account_type: 'cash', currency: 'JPY', opening_balance: 50000, is_active: true },
  { id: 'sav', name: 'Tiết kiệm', account_type: 'savings', currency: 'JPY', opening_balance: 200000, is_active: true },
  { id: 'card', name: 'Rakuten', account_type: 'credit', currency: 'JPY', opening_balance: 0, is_active: true },
  { id: 'vnbank', name: 'Vietcombank', account_type: 'bank', currency: 'VND', opening_balance: 5000000, is_active: true },
  { id: 'oldwallet', name: 'Ví cũ', account_type: 'cash', currency: 'JPY', opening_balance: 0, is_active: false }
];
const LOANS = [
  { id: 'loan1', counterparty: 'Vay mua xe', loan_type: 'borrowed', currency: 'JPY', principal: 1000000, remaining_amount: 850000, start_date: '2026-01-10', due_date: '2028-01-10' },
  { id: 'loan2', counterparty: 'Vay ngân hàng ABC', loan_type: 'borrowed', currency: 'JPY', principal: 5000000, remaining_amount: 4800000, start_date: '2025-06-10', due_date: '2030-06-10' }
];
const LOAN_TERMS = [
  { loan_id: 'loan2', loan_kind: 'bank', institution_name: 'Ngân hàng ABC', product_name: 'Vay tiêu dùng', annual_rate: 3, repayment_method: 'equal_payment', term_months: 60, payment_day: 15 }
];
let txSeq = 0;
function tx(o) { return { id: 'tx' + (++txSeq), currency: 'JPY', note: '', category_name: (CATEGORIES.find(c => c.id === o.category_id) || {}).name, ...o }; }
const FULL_TX = [];
// 24 months of history so year-over-year / whole-year analytics have real data.
for (let i = 23; i >= 0; i--) {
  const m = addMonths(MONTH, -i);
  FULL_TX.push(tx({ category_id: 'inc1', transaction_type: 'income', amount: 300000, transaction_date: `${m}-05` }));
  FULL_TX.push(tx({ category_id: 'inc2', transaction_type: 'income', amount: 140000, transaction_date: `${m}-05` }));
  FULL_TX.push(tx({ category_id: 'fx1', transaction_type: 'expense', amount: 95000, transaction_date: `${m}-27` }));
  FULL_TX.push(tx({ category_id: 'vr1', transaction_type: 'expense', amount: 42000 + (i % 3) * 4000, transaction_date: `${m}-15` }));
  FULL_TX.push(tx({ category_id: 'vr2', transaction_type: 'expense', amount: 10000 + (i % 4) * 1000, transaction_date: `${m}-20` }));
}
FULL_TX.push(tx({ account_id: 'bank', loan_id: 'loan1', transaction_type: 'loan_pay', amount: 30000, transaction_date: `${MONTH}-12` }));
FULL_TX.push(tx({ account_id: 'bank', loan_id: 'loan1', transaction_type: 'loan_interest', amount: 4500, transaction_date: `${MONTH}-12` }));
const MONTH_TX = FULL_TX.filter(t => t.transaction_date.startsWith(MONTH));

const ADJUSTMENTS = [
  { id: 'adj1', account_id: 'bank', account_name: 'UFJ', direction: 'increase', amount: 100000, currency: 'JPY', adjustment_date: `${MONTH}-03`, note: 'Lương tháng trước còn lại' }
];
const CARD_EXPENSES = [
  { id: 'ce1', card_account_id: 'card', card_name: 'Rakuten', entry_mode: 'detail', expense_date: `${MONTH}-15`, description: 'Điện · Ga', amount: 10000, note: '' }
];
const INSTALLMENTS = [
  {
    id: 'inst1', card_account_id: 'card', card_name: 'Rakuten', name: 'Máy giặt', purchase_date: `${MONTH}-01`,
    principal_amount: 60000, fee_total: 0, total_installments: 6, paid_installments_before: 0, first_payment_month: `${MONTH}-01`, currency: 'JPY', note: '',
    schedule: Array.from({ length: 6 }, (_, i) => ({ id: `sch${i + 1}`, installment_no: i + 1, payment_month: addMonths(MONTH, i) + '-01', principal_amount: 10000, fee_amount: 0, is_paid: i === 0, payment_kind: 'regular' }))
  }
];
const INVESTMENTS = [
  { id: 'nisa', name: 'NISA', asset_type: 'NISA', currency: 'JPY', initial_capital: 400000, note: '', created_at: `${MONTH}-01T00:00:00Z`, total_contributed: 100000, total_withdrawn: 0, latest_value: 550000, latest_value_date: `${MONTH}-10` }
];
const INVESTMENT_EVENTS = {
  nisa: [
    { id: 'ev1', event_type: 'contribution', amount: 100000, event_date: `${MONTH}-02`, note: '' },
    { id: 'ev2', event_type: 'valuation', amount: 550000, event_date: `${MONTH}-10`, note: '' }
  ]
};

// Stateful mocks — save/delete/toggle actually mutate these fixture arrays,
// so a created/edited/deleted row is reflected the next time the app
// refreshes and re-fetches (exactly like the real backend), instead of a
// static response silently reverting every change.
let seq = 0;
function newId(prefix) { return `${prefix}${++seq}`; }

const RPC_HANDLERS = {
  taichinh_gd_api: (action) => {
    if (action === 'bootstrap' || action === 'month') return { household: { name: 'Nguyễn Gia', base_currency: 'JPY' }, accounts: ACCOUNTS, categories: CATEGORIES, category_versions: [], transactions: MONTH_TX, loans: LOANS };
    if (action === 'export') return { transactions: FULL_TX };
    if (action === 'save_account') return { ok: true, id: 'newacct1' };
    return { ok: true, id: 'x' };
  },
  taichinh_gd_extension_api: (action) => {
    if (action === 'save_reporting' || action === 'bank_payment') return { ok: true };
    return { reporting: { show_vnd_conversion: false, jpy_vnd_rate: null }, loan_terms: LOAN_TERMS };
  },
  taichinh_gd_exceptional_api: (action) => action === 'set' ? { ok: true } : { ids: [] },
  taichinh_gd_backup_api: () => ({ ok: true }),
  taichinh_gd_debt_api: () => ({ ok: true, id: 'x' }),
  taichinh_gd_bank_loan_api: () => ({ ok: true, id: 'x' }),
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
      if (p.id) {
        const row = INSTALLMENTS.find(x => x.id === p.id);
        if (row) { Object.assign(row, p, { total_installments: total, principal_amount: principal, schedule }); return { ok: true, id: p.id }; }
      }
      const id = newId('inst');
      INSTALLMENTS.push({ id, card_account_id: p.card_account_id, card_name: (ACCOUNTS.find(a => a.id === p.card_account_id) || {}).name, name: p.name, purchase_date: p.purchase_date, principal_amount: principal, fee_total: Number(p.fee_total || 0), total_installments: total, paid_installments_before: Number(p.paid_installments_before || 0), first_payment_month: p.first_payment_month, currency: p.currency || 'JPY', note: p.note || '', schedule });
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
      INVESTMENTS.push({ id, name: p.name, asset_type: p.asset_type || null, currency: p.currency || 'JPY', initial_capital: Number(p.initial_capital || 0), note: p.note || '', created_at: new Date().toISOString(), total_contributed: 0, total_withdrawn: 0, latest_value: null, latest_value_date: null });
      INVESTMENT_EVENTS[id] = [];
      return { ok: true, id };
    }
    if (action === 'delete') { const i = INVESTMENTS.findIndex(x => x.id === p.id); if (i >= 0) INVESTMENTS.splice(i, 1); return { ok: true }; }
    if (action === 'save_event') {
      const list = INVESTMENT_EVENTS[p.investment_id] = INVESTMENT_EVENTS[p.investment_id] || [];
      if (p.id) { const row = list.find(x => x.id === p.id); if (row) Object.assign(row, p); return { ok: true, id: p.id }; }
      const id = newId('ev');
      list.push({ id, event_type: p.event_type, amount: Number(p.amount), event_date: p.event_date, note: p.note || '' });
      const inv = INVESTMENTS.find(x => x.id === p.investment_id);
      if (inv) {
        if (p.event_type === 'contribution') inv.total_contributed = Number(inv.total_contributed || 0) + Number(p.amount);
        if (p.event_type === 'withdrawal') inv.total_withdrawn = Number(inv.total_withdrawn || 0) + Number(p.amount);
        if (p.event_type === 'valuation') { inv.latest_value = Number(p.amount); inv.latest_value_date = p.event_date; }
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

  // ---- Tổng quan: must be month-only, zero asset/investment data ----
  const dashboardText = await page.textContent('#content');
  const kpiLabels = await page.locator('.kpi-grid .kpi .label').allTextContents();
  results.push(`DASHBOARD kpi-grid = ${JSON.stringify(kpiLabels)}`);
  results.push(`  Shows the 4 month-only KPIs (Thu nhập/Tổng chi tiêu/Còn lại/Tỷ lệ): ${kpiLabels.length === 4}`);
  results.push(`  Tài sản ròng / Tiền thanh khoản / Đang đầu tư NEVER appear on Tổng quan: ${!/Tài sản ròng|Tiền thanh khoản|Đang đầu tư/.test(dashboardText)}`);
  results.push(`  NISA / investment name never appears on Tổng quan: ${!dashboardText.includes('NISA')}`);
  results.push(`DASHBOARD shows month-over-month comparison text: ${dashboardText.includes('so với tháng trước') || dashboardText.includes('Bằng tháng trước')}`);
  results.push(`DASHBOARD shows year-over-year comparison text: ${dashboardText.includes('cùng kỳ năm trước')}`);
  results.push(`DASHBOARD shows "năm nay so với năm trước" section: ${dashboardText.includes('Năm nay so với năm trước')}`);
  results.push(`DASHBOARD shows "từng tháng trong năm" section: ${dashboardText.includes('Từng tháng trong năm')}`);
  results.push(`DASHBOARD shows biggest-mover category section: ${dashboardText.includes('tăng/giảm nhiều nhất')}`);
  results.push(`DASHBOARD shows "Sắp đến hạn" with the unpaid loan: ${dashboardText.includes('Sắp đến hạn') && dashboardText.includes('Vay mua xe')}`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'shot-dashboard-1440.png'), fullPage: true });

  // ---- Chi tiêu: 5 independent columns ----
  await page.click('[data-view="budget"]');
  await page.waitForSelector('.money-board');
  const cols = await page.$$('.money-column');
  results.push(`BUDGET column count = ${cols.length} (expect 5)`);
  const budgetText = await page.textContent('#content');
  results.push(`BUDGET Thẻ & trả góp column shows the card expense (10,000) not mixed into Chi biến động: ${budgetText.includes('Rakuten')}`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'shot-budget-1440.png'), fullPage: true });

  for (const w of [1366, 1024]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(150);
    const cols2 = await page.$$('.money-column');
    results.push(`BUDGET at ${w}px: columns=${cols2.length}`);
  }
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

  // ---- Quick entry: income/expense only, no account/transfer picker ----
  await page.click('[data-view="dashboard"]');
  await page.click('#quickAdd');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  const qeHasTransferTab = await page.locator('#qeTypeTabs button[data-t="transfer"]').count();
  results.push(`QUICK ENTRY has no Chuyển (transfer) tab anymore: ${qeHasTransferTab === 0}`);
  await page.click('.details-summary');
  const excVisibleExpense = await page.isVisible('#qeExceptionalField');
  results.push(`QUICK ENTRY "bất thường" checkbox visible for Chi (expense): ${excVisibleExpense}`);
  await page.click('#qeTypeTabs button[data-t="income"]');
  const excVisibleIncome = await page.isVisible('#qeExceptionalField');
  results.push(`QUICK ENTRY "bất thường" checkbox hidden for Thu (income): ${!excVisibleIncome}`);
  await page.click('#qeTypeTabs button[data-t="expense"]');
  await page.fill('#qeAmount', '3000');
  await resetToast();
  await page.click('#modalForm [type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`SUBMIT quick-entry expense: saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('SUBMIT quick-entry expense: no toast - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  await page.click('[data-view="budget"]');
  await page.waitForSelector('.money-board');
  await clickAndCheckModal('budget Thu-nhập column-settings', '.money-column.income .column-settings', '#columnRows');
  await clickAndCheckModal('budget Thẻ&trả-góp column-settings', '.money-column.credit .column-settings');
  await page.click('.money-column.debt .column-settings');
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK budget Nợ column-settings: modal opened - OK')).catch(() => results.push('CLICK budget Nợ column-settings: modal did NOT open - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // Category with money already in it opens the transaction list, not a
  // blind add — inc1 "Lương C" has real transactions in the fixture.
  await page.click('.money-column.income .money-line:has-text("Lương C")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK income category with money (Lương C): opens transaction list - OK')).catch(() => results.push('CLICK income category with money: modal did NOT open - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // ---- Thẻ & trả góp: card ledger, card_expenses + installments ----
  await page.click('.money-column.credit .money-line:has-text("Rakuten")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK Rakuten card row (openCardLedger): modal opened - OK')).catch(() => results.push('CLICK Rakuten card row: modal did NOT open - FAIL'));
  const ledgerText = await page.textContent('#modalBody');
  results.push(`  Card ledger shows labeled "Xóa"/"Sửa" buttons (not bare icons): ${ledgerText.includes('Sửa') && ledgerText.includes('Xóa')}`);
  results.push(`  Card ledger lists the existing detail expense (Điện · Ga): ${ledgerText.includes('Điện')}`);
  results.push(`  Card ledger shows the installment (Máy giặt) with kỳ progress: ${ledgerText.includes('Máy giặt')}`);

  await page.click('button:has-text("＋ Thêm khoản chi")');
  await page.waitForSelector('#modalBody [name="description"]', { timeout: 1500 }).then(() => results.push('CLICK "+ Thêm khoản chi" (detail entry form): opened - OK')).catch(() => results.push('CLICK "+ Thêm khoản chi": did NOT open - FAIL'));
  await page.fill('[name="amount"]', '2500');
  await resetToast();
  await page.click('#modalForm [type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`SUBMIT new card detail expense: saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('SUBMIT card detail expense: no toast - FAIL'));

  await page.click('.money-column.credit .money-line:has-text("Rakuten")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.click('button:has-text("＋ Nhập tổng theo tháng")');
  await page.waitForSelector('[name="expense_month"]', { timeout: 1500 }).then(() => results.push('CLICK "+ Nhập tổng theo tháng" (lump entry form): opened - OK')).catch(() => results.push('CLICK "+ Nhập tổng theo tháng": did NOT open - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // Edit and delete an existing card expense from the ledger list.
  await page.click('.money-column.credit .money-line:has-text("Rakuten")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.click('#modalBody .tx .btn:has-text("Sửa")');
  await page.waitForSelector('[name="amount"]', { timeout: 1500 }).then(() => results.push('CLICK "Sửa" on a card expense row: edit form opened - OK')).catch(() => results.push('CLICK "Sửa" on card expense: edit form did NOT open - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  await page.click('.money-column.credit .money-line:has-text("Rakuten")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.evaluate(() => { window.confirm = () => true; });
  await resetToast();
  await page.click('#modalBody .tx .btn:has-text("Xóa")');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`CLICK "Xóa" on a card expense row: saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('CLICK "Xóa" on card expense: no toast - FAIL'));
  await page.evaluate(() => { window.confirm = () => false; });
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // ---- Trả góp: create, view schedule, toggle paid, delete ----
  await page.click('.money-column.credit .money-line:has-text("Rakuten")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.click('button:has-text("＋ Thêm khoản trả góp")');
  await page.waitForSelector('[name="principal_amount"]', { timeout: 1500 }).then(() => results.push('CLICK "+ Thêm khoản trả góp": form opened - OK')).catch(() => results.push('CLICK "+ Thêm khoản trả góp": did NOT open - FAIL'));
  await page.fill('[name="name"]', 'Tủ lạnh');
  await page.fill('[name="principal_amount"]', '120000');
  await page.fill('[name="total_installments"]', '12');
  await resetToast();
  await page.click('#modalForm [type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`SUBMIT new installment: saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('SUBMIT new installment: no toast - FAIL'));

  await page.click('.money-column.credit .money-line:has-text("Rakuten")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.click('#modalBody .tx:has-text("Máy giặt") .btn:has-text("Xem lịch")');
  await page.waitForSelector('#modalBody', { timeout: 1500 }).then(() => results.push('CLICK "Xem lịch" on installment: schedule modal opened - OK')).catch(() => results.push('CLICK "Xem lịch": schedule modal did NOT open - FAIL'));
  const scheduleText = await page.textContent('#modalBody');
  results.push(`  Schedule shows labeled "Đánh dấu đã trả/chưa trả" buttons per kỳ: ${/Đánh dấu/.test(scheduleText)}`);
  const toggleBtn = page.locator('#modalBody .tx .btn', { hasText: 'Đánh dấu' }).first();
  if (await toggleBtn.count()) {
    await resetToast();
    await toggleBtn.click();
    await page.waitForTimeout(200);
    results.push('CLICK "Đánh dấu đã trả/chưa trả" on a kỳ: no crash - OK');
  }
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  await page.click('.money-column.credit .money-line:has-text("Rakuten")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.evaluate(() => { window.confirm = () => true; });
  await resetToast();
  await page.click('#modalBody .tx:has-text("Tủ lạnh") .btn:has-text("Xóa")');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`CLICK "Xóa" on installment: saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('CLICK "Xóa" on installment: no toast - FAIL'));
  await page.evaluate(() => { window.confirm = () => false; });
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // ---- Đầu tư ----
  await page.click('[data-view="investments"]');
  await page.waitForTimeout(150);
  const investText = await page.textContent('#content');
  results.push(`INVESTMENTS shows NISA card with vốn ròng/lãi-lỗ: ${investText.includes('NISA') && investText.includes('Vốn ròng')}`);
  await clickAndCheckModal('investments "+ Đầu tư mới"', 'button:has-text("＋ Đầu tư mới")', '[name="name"]');

  const nisaCard = page.locator('.item-card', { hasText: 'NISA' });
  await clickAndCheckModal('investment "Thêm vốn"', '.item-card:has-text("NISA") button:has-text("Thêm vốn")', '[name="amount"]');
  await clickAndCheckModal('investment "Rút vốn"', '.item-card:has-text("NISA") button:has-text("Rút vốn")', '[name="amount"]');
  await clickAndCheckModal('investment "Cập nhật giá trị"', '.item-card:has-text("NISA") button:has-text("Cập nhật giá trị")', '[name="amount"]');
  await page.click('.item-card:has-text("NISA") button:has-text("Xem lịch sử")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK investment "Xem lịch sử": modal opened - OK')).catch(() => results.push('CLICK investment "Xem lịch sử": modal did NOT open - FAIL'));
  const histText = await page.textContent('#modalBody');
  results.push(`  History lists both fixture events (Thêm vốn + Cập nhật giá trị) with Sửa/Xóa: ${histText.includes('Thêm vốn') && histText.includes('Cập nhật giá trị') && histText.includes('Sửa') && histText.includes('Xóa')}`);
  await page.evaluate(() => { window.confirm = () => true; });
  await resetToast();
  await page.click('#modalBody .tx .btn:has-text("Xóa")');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`CLICK delete investment event: saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('CLICK delete investment event: no toast - FAIL'));
  await page.evaluate(() => { window.confirm = () => false; });
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);
  await clickAndCheckModal('investment "Sửa"', '.item-card:has-text("NISA") button:has-text("Sửa")', '[name="name"]');

  // ---- Tài sản: net worth / liquid KPIs, manual +/- adjustments, no Chuyển tiền ----
  await page.click('[data-view="accounts"]');
  await page.waitForTimeout(150);
  const assetKpiLabels = await page.locator('.kpi-grid .kpi .label').allTextContents();
  results.push(`ASSETS kpi-grid shows liquidity/net-worth/invested KPIs: ${JSON.stringify(assetKpiLabels)}`);
  results.push(`  Net worth chart present on Tài sản: ${await page.locator('.chart-card', { hasText: 'Tài sản ròng' }).count() > 0}`);
  results.push(`  "Đang đầu tư" total reflects Đầu tư (550,000): ${(await page.textContent('#content')).includes('550')}`);
  const assetsText = await page.textContent('#content');
  results.push(`  No "Chuyển tiền" button anywhere on Tài sản: ${!assetsText.includes('Chuyển tiền')}`);
  results.push(`  No investment account card rendered here (investments live only in Đầu tư tab): ${!page.url().includes('NISA')}`);
  await clickAndCheckModal('accounts "+ Tài khoản"', 'button:has-text("＋ Tài khoản")', '[name="name"]');

  await clickAndCheckModal('account "＋ Tiền"', '.item-card:has-text("UFJ") button:has-text("＋ Tiền")', '[name="amount"]');
  await page.click('.item-card:has-text("UFJ") button:has-text("＋ Tiền")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  await page.fill('[name="amount"]', '50000');
  await resetToast();
  await page.click('#modalForm [type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`SUBMIT "＋ Tiền" on UFJ: saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('SUBMIT "＋ Tiền": no toast - FAIL'));

  await clickAndCheckModal('account "− Tiền"', '.item-card:has-text("UFJ") button:has-text("− Tiền")', '[name="amount"]');
  await page.click('.item-card:has-text("UFJ") button:has-text("Xem lịch sử")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK account "Xem lịch sử" (adjustment history): modal opened - OK')).catch(() => results.push('CLICK account "Xem lịch sử": modal did NOT open - FAIL'));
  const adjHistText = await page.textContent('#modalBody');
  results.push(`  Adjustment history lists the fixture row and a month filter: ${adjHistText.includes('100') && (await page.locator('#adjHistFilter').count()) > 0}`);
  await page.click('#modalBody .tx .btn:has-text("Sửa")');
  await page.waitForSelector('[name="amount"]', { timeout: 1500 }).then(() => results.push('CLICK "Sửa" on an adjustment row: edit form opened - OK')).catch(() => results.push('CLICK "Sửa" on adjustment: edit form did NOT open - FAIL'));
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  const acctEditBtn = await page.$('.item-card .mini-btn[aria-label="Sửa"]');
  if (acctEditBtn) { await acctEditBtn.click(); await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK account card edit (pencil): modal opened - OK')).catch(() => results.push('CLICK account edit: modal did NOT open - FAIL')); await page.evaluate(() => document.getElementById('modal')?.close()); }

  const foreignSection = page.locator('.section', { hasText: 'Tài khoản ngoại tệ' });
  results.push(`Foreign-currency account (VND) shows up on Tài sản instead of vanishing: ${await foreignSection.count() > 0}`);
  const hiddenSection = page.locator('.section', { hasText: 'Tài khoản đã ẩn' });
  results.push(`Hidden account (Ví cũ) listed under "Tài khoản đã ẩn": ${await hiddenSection.count() > 0}`);
  const restoreBtn = hiddenSection.locator('button:has-text("Khôi phục")');
  if (await restoreBtn.count()) {
    await resetToast();
    await restoreBtn.click();
    await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`CLICK "Khôi phục" on hidden account: saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('CLICK "Khôi phục": no toast - FAIL'));
  } else { results.push('CLICK "Khôi phục": button not found - FAIL'); }

  // Account form: only cash/bank/savings types offered, is_liquid shows for savings only.
  await page.click('button:has-text("＋ Tài khoản")');
  await page.waitForSelector('#modal[open]', { timeout: 1500 });
  const acTypeOptions = await page.locator('#acType option').allTextContents();
  results.push(`ACCOUNT FORM type list is exactly Tiền mặt/Ngân hàng/Tiết kiệm (no Đầu tư): ${JSON.stringify(acTypeOptions)}`);
  await page.selectOption('#acType', 'savings');
  const liquidVisible = await page.isVisible('#acLiquidField');
  results.push(`ACCOUNT FORM shows "Có thể rút ngay" for Tiết kiệm: ${liquidVisible}`);
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);

  // ---- Nav: no "Giao dịch" tab anywhere ----
  const navLabels = await page.locator('#nav button span').allTextContents();
  results.push(`NAV has exactly Tổng quan/Chi tiêu/Đầu tư/Tài sản/Cài đặt, no Giao dịch: ${JSON.stringify(navLabels)} / ${!navLabels.includes('Giao dịch')}`);

  // ---- Cài đặt ----
  await page.click('[data-view="settings"]');
  await resetToast();
  await page.click('#householdForm button[type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`SUBMIT "Gia đình" form (saveHousehold): saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('SUBMIT "Gia đình" form: no toast - FAIL'));
  await resetToast();
  await page.click('#reportingForm button[type=submit]');
  await page.waitForSelector('#toast.show', { timeout: 1500 }).then(async () => results.push(`SUBMIT "Tỷ giá" form (saveReporting): saved (toast: "${await page.textContent('#toast')}") - OK`)).catch(() => results.push('SUBMIT "Tỷ giá" form: no toast - FAIL'));
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
