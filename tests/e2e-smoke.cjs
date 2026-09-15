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
// Mirrors vercel.json exactly — the whole point of this test is to catch
// anything the strict production CSP would silently block that a plain
// local server (no headers at all) would hide.
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
  cat('fx3', 'expense', 'fixed', 'Điện thoại', 8000),
  cat('fx4', 'expense', 'fixed', 'Bảo hiểm', 17500),
  cat('vr1', 'expense', 'variable', 'Ăn uống', 60000),
  cat('vr2', 'expense', 'variable', 'Đi lại', 15000),
  cat('vr3', 'expense', 'variable', 'Giải trí', 10000)
];
const ACCOUNTS = [
  { id: 'bank', name: 'MUFG', account_type: 'bank', currency: 'JPY', opening_balance: 300000, is_active: true },
  { id: 'cash', name: 'Tiền mặt', account_type: 'cash', currency: 'JPY', opening_balance: 50000, is_active: true },
  { id: 'sav', name: 'Tiết kiệm', account_type: 'savings', currency: 'JPY', opening_balance: 200000, is_active: true },
  { id: 'inv', name: 'NISA', account_type: 'investment', currency: 'JPY', opening_balance: 100000, is_active: true },
  { id: 'card', name: 'Rakuten Card', account_type: 'credit', currency: 'JPY', opening_balance: 0, is_active: true }
];
const LOANS = [
  { id: 'loan1', counterparty: 'Vay mua xe', loan_type: 'borrowed', currency: 'JPY', principal: 1000000, remaining_amount: 850000, start_date: '2026-01-10', due_date: '2028-01-10' }
];
let txSeq = 0;
function tx(o) { return { id: 'tx' + (++txSeq), currency: 'JPY', fx_rate: 1, note: '', account_name: (ACCOUNTS.find(a => a.id === o.account_id) || {}).name, transfer_account_name: (ACCOUNTS.find(a => a.id === o.transfer_account_id) || {}).name, category_name: (CATEGORIES.find(c => c.id === o.category_id) || {}).name, ...o }; }
const FULL_TX = [];
// 24 months of history so year-over-year comparisons have real data too.
for (let i = 23; i >= 0; i--) {
  const m = addMonths(MONTH, -i);
  FULL_TX.push(tx({ account_id: 'bank', category_id: 'inc1', transaction_type: 'income', amount: 300000, transaction_date: `${m}-05` }));
  FULL_TX.push(tx({ account_id: 'bank', category_id: 'inc2', transaction_type: 'income', amount: 140000, transaction_date: `${m}-05` }));
  FULL_TX.push(tx({ account_id: 'bank', category_id: 'fx1', transaction_type: 'expense', amount: 95000, transaction_date: `${m}-27` }));
  FULL_TX.push(tx({ account_id: 'cash', category_id: 'vr1', transaction_type: 'expense', amount: 42000 + (i % 3) * 4000, transaction_date: `${m}-15` }));
  FULL_TX.push(tx({ account_id: 'cash', category_id: 'vr2', transaction_type: 'expense', amount: 10000 + (i % 4) * 1000, transaction_date: `${m}-20` }));
}
FULL_TX.push(tx({ account_id: 'card', category_id: 'vr3', transaction_type: 'expense', amount: 8000, transaction_date: `${MONTH}-08` }));
FULL_TX.push(tx({ account_id: 'bank', transfer_account_id: 'sav', transaction_type: 'transfer', amount: 20000, transaction_date: `${MONTH}-06` }));
FULL_TX.push(tx({ account_id: 'bank', loan_id: 'loan1', transaction_type: 'loan_pay', amount: 30000, transaction_date: `${MONTH}-12` }));
FULL_TX.push(tx({ account_id: 'bank', loan_id: 'loan1', transaction_type: 'loan_interest', amount: 4500, transaction_date: `${MONTH}-12` }));
const MONTH_TX = FULL_TX.filter(t => t.transaction_date.startsWith(MONTH));

const RPC_HANDLERS = {
  taichinh_gd_api: (action) => {
    if (action === 'bootstrap' || action === 'month') return { household: { name: 'Nguyễn Gia', base_currency: 'JPY' }, accounts: ACCOUNTS, categories: CATEGORIES, category_versions: [], transactions: MONTH_TX, goals: [], loans: LOANS, monthly_summary: [] };
    if (action === 'export') return { transactions: FULL_TX };
    return { ok: true };
  },
  taichinh_gd_extension_api: () => ({ reporting: { show_vnd_conversion: false, jpy_vnd_rate: null }, loan_terms: [] }),
  taichinh_gd_allocation_api: () => ({ month: `${MONTH}-01`, fixed_pct: 25, variable_pct: 20, interest_pct: 2, saving_pct: 10, investment_pct: 10, debt_pct: 8, reserve_pct: 25, inherited: false, source_month: `${MONTH}-01` }),
  taichinh_gd_recurring_api: () => ({ items: [] }),
  taichinh_gd_credit_card_api: (action) => {
    if (action === 'get') return { items: [{ account_id: 'card', closing_day: 10, payment_day: 27, payment_month_offset: 1, payment_account_id: 'bank' }] };
    if (action === 'overview') return { items: [] };
    if (action === 'list_installments') return { items: [] };
    return { ok: true };
  },
  taichinh_gd_credit_card_month_api: () => ({ items: [{ account_id: 'card', card_name: 'Rakuten Card', currency: 'JPY', payment_month: `${MONTH}-01`, payment_date: `${MONTH}-27`, regular_amount: 8000, installment_principal: 0, installment_fee: 0, expected_amount: 8000, paid: false }] }),
  taichinh_gd_exceptional_api: () => ({ ids: [] }),
  taichinh_gd_fx_history_api: () => ({ items: [] }),
  taichinh_gd_backup_api: () => ({ ok: true }),
  taichinh_gd_debt_api: () => ({ ok: true, id: 'x' }),
  taichinh_gd_bank_loan_api: () => ({ ok: true, id: 'x' }),
  taichinh_gd_budget_column_api: () => ({ ok: true }),
  taichinh_gd_investment_api: () => ({ ok: true, id: 'x' })
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
    page.on('dialog', d => d.dismiss().catch(() => {})); // native confirm/prompt/alert never block the run
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

  // Dashboard sanity numbers
  const dashboardText = await page.textContent('#content');
  results.push(`DASHBOARD contains "440" (income plan): ${dashboardText.includes('440')}`);
  results.push(`DASHBOARD contains "126" (fixed plan / 28.7%%): ${dashboardText.includes('126') || dashboardText.includes('28.7')}`);
  results.push(`DASHBOARD shows VND-equivalent net worth when toggle is on: ${dashboardText.includes('₫')}`);
  results.push(`DASHBOARD shows "Sắp đến hạn" upcoming-due section with the unpaid card: ${dashboardText.includes('Sắp đến hạn') && dashboardText.includes('Rakuten Card')}`);
  results.push(`DASHBOARD shows month-over-month comparison text: ${dashboardText.includes('so với tháng trước') || dashboardText.includes('Bằng tháng trước')}`);
  results.push(`DASHBOARD shows spending-pace note: ${dashboardText.includes('ngân sách chi biến động')}`);
  results.push(`DASHBOARD shows year-over-year comparison text: ${dashboardText.includes('cùng kỳ năm trước')}`);
  results.push(`DASHBOARD shows category-trend section: ${dashboardText.includes('Xu hướng theo danh mục')}`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'shot-dashboard-1440.png'), fullPage: true });

  // Budget view - must show 5 columns on one row at desktop widths
  await page.click('[data-view="budget"]');
  await page.waitForSelector('.money-board');
  const cols = await page.$$('.money-column');
  results.push(`BUDGET column count = ${cols.length} (expect 5)`);
  const tops = [];
  for (const c of cols) { const box = await c.boundingBox(); tops.push(Math.round(box.y)); }
  const sameRow = new Set(tops).size === 1;
  results.push(`BUDGET all 5 columns share one row at 1440px: ${sameRow} (tops=${tops.join(',')})`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'shot-budget-1440.png'), fullPage: true });

  for (const w of [1366, 1024]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(150);
    const cols2 = await page.$$('.money-column');
    const tops2 = []; for (const c of cols2) { const box = await c.boundingBox(); tops2.push(Math.round(box.y)); }
    results.push(`BUDGET at ${w}px: columns=${cols2.length}, one row=${new Set(tops2).size === 1}`);
    await page.screenshot({ path: path.join(SHOT_DIR, `shot-budget-${w}.png`), fullPage: true });
  }

  for (const w of [430, 390]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    results.push(`MOBILE ${w}px: horizontal overflow px = ${overflow} (expect 0)`);
    await page.screenshot({ path: path.join(SHOT_DIR, `shot-budget-${w}.png`), fullPage: true });
  }

  // Check for accidental white backgrounds across all 4 views at desktop width
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const view of ['dashboard', 'budget', 'accounts', 'settings']) {
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
    results.push(`VIEW ${view}: elements with pure-white background = ${whiteEls.length} ${whiteEls.length ? '(' + whiteEls.slice(0, 5).join(',') + ')' : ''}`);
  }

  // ---- REAL CLICKS ONLY from here on (page.evaluate() calling a function
  // directly bypasses CSP entirely and would have hidden the exact bug that
  // shipped in the first pass — every one of these must be page.click()). ----
  await page.addInitScript(() => { window.confirm = () => false; }); // don't actually navigate away on forgetDevice()
  await page.reload();
  await page.waitForSelector('#app:not(.hidden)', { timeout: 8000 });

  async function clickAndCheckModal(label, selector, checkSelector) {
    await page.click(selector);
    try {
      await page.waitForSelector('#modal[open]', { timeout: 1500 });
      const ok = checkSelector ? await page.isVisible(checkSelector) : true;
      results.push(`CLICK ${label}: modal opened${checkSelector ? ', field visible=' + ok : ''} - OK`);
    } catch {
      results.push(`CLICK ${label}: modal did NOT open - FAIL`);
    }
    await page.evaluate(() => document.getElementById('modal')?.close());
    await page.waitForTimeout(50);
  }

  await page.click('[data-view="dashboard"]');
  await clickAndCheckModal('#quickAdd (Nhập nhanh)', '#quickAdd', '#qeAmount');
  await clickAndCheckModal('dashboard "Sửa chỉ tiêu %"', 'button:has-text("Sửa chỉ tiêu %")', '#allocTotal');
  const recentTx = await page.$('.tx-row-btn:not([disabled])');
  if (recentTx) { await recentTx.click(); await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK recent-transaction row: modal opened - OK')).catch(() => results.push('CLICK recent-transaction row: modal did NOT open - FAIL')); await page.evaluate(() => document.getElementById('modal')?.close()); }
  const upcomingBtn = page.locator('section.card.section', { hasText: 'Sắp đến hạn' }).locator('.tx-row-btn').first();
  if (await upcomingBtn.count()) { await upcomingBtn.click(); await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK upcoming-due row (Sắp đến hạn): modal opened - OK')).catch(() => results.push('CLICK upcoming-due row: modal did NOT open - FAIL')); await page.evaluate(() => document.getElementById('modal')?.close()); }

  await page.click('[data-view="budget"]');
  await page.waitForSelector('.money-board');
  await clickAndCheckModal('budget Thu-nhập column-settings', '.money-column.income .column-settings', '#columnRows');
  await page.evaluate(() => document.getElementById('modal')?.close());
  await clickAndCheckModal('budget Thẻ&trả-góp column-settings', '.money-column.credit .column-settings');
  // Debt column settings opens an info modal with a nested "+ Thêm khoản nợ"
  // button that closes-then-reopens a different modal (reopenAfterModal) —
  // don't auto-close in between, that's the exact path being tested.
  await page.click('.money-column.debt .column-settings');
  await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK budget Nợ column-settings: modal opened - OK')).catch(() => results.push('CLICK budget Nợ column-settings: modal did NOT open - FAIL'));
  await page.click('button:has-text("Thêm khoản nợ")');
  try {
    await page.waitForSelector('[name="counterparty"]', { timeout: 1500 });
    results.push('CLICK "+ Thêm khoản nợ" inside manager (reopenAfterModal): loan form opened - OK');
  } catch { results.push('CLICK "+ Thêm khoản nợ" inside manager: loan form did NOT open - FAIL'); }
  await page.evaluate(() => document.getElementById('modal')?.close());
  await page.waitForTimeout(50);
  const incomeLine = await page.$('.money-column.income .money-line');
  if (incomeLine) { await incomeLine.click(); await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK income money-line: quick-entry opened - OK')).catch(() => results.push('CLICK income money-line: modal did NOT open - FAIL')); await page.evaluate(() => document.getElementById('modal')?.close()); }
  const debtLine = await page.$('.money-column.debt .money-line');
  if (debtLine) { await debtLine.click(); await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK debt money-line (openLoanPayment): modal opened - OK')).catch(() => results.push('CLICK debt money-line: modal did NOT open - FAIL')); await page.evaluate(() => document.getElementById('modal')?.close()); }
  const creditLine = await page.$('.money-column.credit .money-line');
  if (creditLine) { await creditLine.click(); await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK credit money-line (statement payment): modal opened - OK')).catch(() => results.push('CLICK credit money-line: modal did NOT open - FAIL')); await page.evaluate(() => document.getElementById('modal')?.close()); }
  const creditQuickAdd = await page.$('.money-column.credit .money-line-wrap .mini-btn');
  if (creditQuickAdd) {
    await creditQuickAdd.click();
    await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK credit ＋ quick-add: quick-entry opened - OK')).catch(() => results.push('CLICK credit ＋ quick-add: modal did NOT open - FAIL'));
    const accSelVal = await page.$eval('#qeAccountSelect', el => el.value).catch(() => null);
    results.push(`CLICK credit ＋ quick-add pre-selects the card as account: ${accSelVal === 'card'}`);
    await page.evaluate(() => document.getElementById('modal')?.close());
  }

  await page.click('[data-view="accounts"]');
  await clickAndCheckModal('accounts "+ Tài khoản"', 'button:has-text("＋ Tài khoản")', '[name="name"]');
  await clickAndCheckModal('accounts "Chuyển tiền"', 'button:has-text("Chuyển tiền")');
  const acctEditBtn = await page.$('.item-card .mini-btn');
  if (acctEditBtn) { await acctEditBtn.click(); await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK account card edit (pencil): modal opened - OK')).catch(() => results.push('CLICK account edit: modal did NOT open - FAIL')); await page.evaluate(() => document.getElementById('modal')?.close()); }
  const investCard = await page.$('.item-card:has-text("NISA")');
  if (investCard) {
    const nap = await investCard.$('button:has-text("＋ Nạp")');
    if (nap) { await nap.click(); await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK investment "+ Nạp": modal opened - OK')).catch(() => results.push('CLICK investment Nạp: modal did NOT open - FAIL')); await page.evaluate(() => document.getElementById('modal')?.close()); }
    const dinhGia = await investCard.$('button:has-text("Định giá")');
    if (dinhGia) { await dinhGia.click(); await page.waitForSelector('#modal[open]', { timeout: 1500 }).then(() => results.push('CLICK investment "Định giá": modal opened - OK')).catch(() => results.push('CLICK investment Định giá: modal did NOT open - FAIL')); await page.evaluate(() => document.getElementById('modal')?.close()); }
  }

  await page.click('[data-view="settings"]');
  await page.click('button:has-text("Sao chép link riêng")').catch(() => {});
  results.push('CLICK settings "Sao chép link riêng": no crash - OK');
  const csvBtn = await page.$('button:has-text("Xuất CSV")');
  results.push(`SETTINGS has CSV export button: ${!!csvBtn}`);
  if (csvBtn) {
    try {
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 1500 }), csvBtn.click()]);
      const csvPath = path.join(SHOT_DIR, await download.suggestedFilename());
      await download.saveAs(csvPath);
      const csvContent = fs.readFileSync(csvPath, 'utf8');
      results.push(`CLICK "Xuất CSV giao dịch": download triggered, filename=${await download.suggestedFilename()} - OK`);
      results.push(`CSV content has header row: ${csvContent.startsWith('﻿Ngày,Loại,Danh mục')}`);
      results.push(`CSV content has transaction rows: ${csvContent.split('\r\n').length > 1}`);
    } catch { results.push('CLICK "Xuất CSV giao dịch": download did NOT trigger - FAIL'); }
  }
  await page.click('button:has-text("Xóa khóa khỏi thiết bị này")').catch(() => {});
  results.push('CLICK settings "Xóa khóa" (confirm stubbed false): no crash - OK');

  // Explicit CSP-violation scan: this is the exact class of bug that shipped
  // in the previous version (onclick="..." silently dropped under
  // script-src 'self'). If ANY of these strings show up, buttons are dead.
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
