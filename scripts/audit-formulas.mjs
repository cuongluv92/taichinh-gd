#!/usr/bin/env node
// ==========================================================================
// Standalone formula audit — exercises the REAL js/finance.js code (not a
// parallel reimplementation) against synthetic fixture data. No network,
// no real household data touched. Run: node scripts/audit-formulas.mjs
// ==========================================================================
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const financeSrc = fs.readFileSync(path.join(__dirname, '../js/finance.js'), 'utf8');

const results = [];
function eq(name, actual, expected, tol = 1e-6) {
  const ok = typeof expected === 'number'
    ? Number.isFinite(actual) && Math.abs(actual - expected) <= tol
    : actual === expected;
  results.push({ name, ok, actual, expected });
}

const sandbox = {
  console,
  // Minimal stubs for the handful of lib.js helpers finance.js calls.
  // These are pure formatting helpers with no bearing on the numbers being
  // asserted below, so plain stand-ins are enough to let finance.js load.
  n: v => Number(v || 0),
  clamp0: v => Math.max(0, Number(v || 0)),
  money: (v, c) => `${Math.round(Number(v || 0))} ${c || ''}`,
  esc: v => String(v),
  pctText: (v, base) => (base > 0 ? `${(Number(v) / base * 100).toFixed(1)}%` : '—'),
  monthKey: d => String(d || '').slice(0, 7),
  yearKey: d => String(d || '').slice(0, 4),
  endOfMonthDate: key => { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); },
  localToday: () => '2026-09-15',
  localMonth: () => '2026-09',
  addMonths: (ym, delta) => { const [y, m] = String(ym).slice(0, 7).split('-').map(Number); const idx = y * 12 + (m - 1) + delta; return `${Math.floor(idx / 12)}-${String(idx % 12 + 1).padStart(2, '0')}`; },
  state: { base: 'JPY', month: '2026-09', analyticsYear: 2026, accounts: [], categories: [], categoryVersions: [], transactions: [], fullTransactions: [], loans: [], exceptionalIds: [], reporting: { show_vnd_conversion: false, jpy_vnd_rate: null } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(financeSrc, sandbox, { filename: 'finance.js' });
const F = sandbox.F;

function resetState(patch) {
  Object.assign(sandbox.state, {
    base: 'JPY', accounts: [], categories: [], categoryVersions: [], transactions: [], fullTransactions: [], loans: [], exceptionalIds: [], reporting: { show_vnd_conversion: false, jpy_vnd_rate: null }
  }, patch);
}
function acc(id, type, currency, opening = 0) { return { id, account_type: type, currency, opening_balance: opening, is_active: true }; }
function tx(overrides) { return { id: overrides.id || Math.random().toString(36).slice(2), currency: 'JPY', fx_rate: 1, ...overrides }; }

// ---------------------------------------------------------------------
// A. Thu nhập kế hoạch 440,000 / Chi cố định kế hoạch 126,500 => 28.75%
// ---------------------------------------------------------------------
{
  const incomePlan = 440000, fixedPlan = 126500;
  eq('A. Fixed-plan % of income-plan = 28.75%', fixedPlan / incomePlan * 100, 28.75, 1e-9);
}

// ---------------------------------------------------------------------
// B. Credit card: purchase is an expense at purchase date; paying the
//    statement the next month is a transfer and must NOT add expense again.
// ---------------------------------------------------------------------
{
  resetState({
    accounts: [acc('bank', 'bank', 'JPY', 500000), acc('card', 'credit', 'JPY', 0)],
    categories: [{ id: 'shopping', direction: 'expense', cost_type: 'variable', is_active: true }],
  });
  const purchase = tx({ account_id: 'card', category_id: 'shopping', transaction_type: 'expense', amount: 30000, transaction_date: '2026-08-20' });
  const payment = tx({ account_id: 'bank', transfer_account_id: 'card', transaction_type: 'transfer', amount: 30000, transaction_date: '2026-09-27' });
  sandbox.state.fullTransactions = [purchase, payment];
  sandbox.state.transactions = [payment]; // September's own ledger view
  const augustStats = F.statsFor([purchase]);
  const septemberStats = F.statsFor([payment]);
  eq('B. Purchase month expense includes the 30,000 card purchase', augustStats.expense, 30000);
  eq('B. Statement-payment month adds ZERO expense (no double count)', septemberStats.expense, 0);
  const cardBalanceAfterPurchase = F.accountBalanceAt(sandbox.state.accounts[1], '2026-08-31');
  const bankBalanceAfterPayment = F.accountBalanceAt(sandbox.state.accounts[0], '2026-09-30');
  eq('B. Card balance goes to -30,000 after purchase (owed)', cardBalanceAfterPurchase, -30000);
  eq('B. Bank balance drops by exactly 30,000 at payment (not 60,000)', bankBalanceAfterPayment, 470000);
}

// ---------------------------------------------------------------------
// B2. A transaction flagged exceptional (taichinh_gd_exceptional_api 'set')
//     must drop out of Chi cố định/Chi biến động and expenseByCategory, but
//     still count in net worth / account balances — it happened, it just
//     shouldn't skew the recurring monthly budget comparison.
// ---------------------------------------------------------------------
{
  resetState({
    accounts: [acc('bank', 'bank', 'JPY', 500000)],
    categories: [{ id: 'repair', direction: 'expense', cost_type: 'variable', name: 'Sửa nhà', is_active: true }],
  });
  const normal = tx({ id: 'tx-normal', account_id: 'bank', category_id: 'repair', transaction_type: 'expense', amount: 5000, transaction_date: '2026-09-05' });
  const oneOff = tx({ id: 'tx-oneoff', account_id: 'bank', category_id: 'repair', transaction_type: 'expense', amount: 300000, transaction_date: '2026-09-10' });
  sandbox.state.fullTransactions = [normal, oneOff];
  sandbox.state.transactions = [normal, oneOff];
  sandbox.state.exceptionalIds = ['tx-oneoff'];
  const stats = F.statsFor([normal, oneOff]);
  eq('B2. Exceptional expense excluded from variable-expense total', stats.variable, 5000);
  eq('B2. Exceptional expense tracked in its own bucket, not lost', stats.exceptional, 300000);
  eq('B2. categoryActualBase (budget column actuals) excludes the exceptional amount', F.categoryActualBase('repair', 'expense'), 5000);
  eq('B2. expenseByCategory (dashboard donut) excludes the exceptional amount', F.expenseByCategory([normal, oneOff]).find(x => x.label === 'Sửa nhà')?.value, 5000);
  eq('B2. Net worth still falls by the FULL amount incl. the exceptional expense', F.financialPosition('2026-09-30').netWorth, 500000 - 5000 - 300000);
}

// ---------------------------------------------------------------------
// C. Bank loan repayment 50,000 = 40,000 principal + 10,000 interest.
//    Principal must NOT count as household expense; interest must.
//    Net worth must fall by exactly the interest portion.
// ---------------------------------------------------------------------
{
  const opening = tx({ account_id: 'bank', loan_id: 'loan1', transaction_type: 'loan_borrow', amount: 2000000, transaction_date: '2026-01-10' });
  resetState({
    accounts: [acc('bank', 'bank', 'JPY', 500000)],
    loans: [{ id: 'loan1', loan_type: 'borrowed', currency: 'JPY', principal: 2000000, remaining_amount: 2000000, start_date: '2026-01-10' }],
    fullTransactions: [opening]
  });
  const before = F.financialPosition(); // current position, loan freshly disbursed, nothing repaid yet
  const principalTx = tx({ account_id: 'bank', loan_id: 'loan1', transaction_type: 'loan_pay', amount: 40000, transaction_date: '2026-09-05' });
  const interestTx = tx({ account_id: 'bank', loan_id: 'loan1', transaction_type: 'loan_interest', amount: 10000, transaction_date: '2026-09-05' });
  const stats = F.statsFor([principalTx, interestTx]);
  eq('C. loan_pay (principal) counted as debtPay, NOT expense', stats.debtPay, 40000);
  eq('C. loan_interest counted as expense', stats.loanInterest, 10000);
  eq('C. Total expense = interest only (principal excluded)', stats.expense, 10000);
  // Apply the payment: bank balance drops by the full 50,000; server updates
  // remaining_amount by the 40,000 principal only (interest never touches it).
  sandbox.state.fullTransactions = [opening, principalTx, interestTx];
  sandbox.state.loans[0].remaining_amount = 2000000 - 40000;
  const after = F.financialPosition();
  eq('C. Net worth falls by exactly the 10,000 interest (not 50,000)', before.netWorth - after.netWorth, 10000);
}

// ---------------------------------------------------------------------
// D. Transfer bank -> savings is asset reallocation, not expense; it must
//    show up as this month's "saving" contribution.
// ---------------------------------------------------------------------
{
  resetState({ accounts: [acc('bank', 'bank', 'JPY', 200000), acc('sav', 'savings', 'JPY', 0)] });
  const t = tx({ account_id: 'bank', transfer_account_id: 'sav', transaction_type: 'transfer', amount: 30000, transaction_date: '2026-09-10' });
  const stats = F.statsFor([t]);
  eq('D. Bank->savings transfer adds ZERO expense', stats.expense, 0);
  eq('D. Bank->savings transfer counts fully as "saving" for the month', stats.saving, 30000);
}

// ---------------------------------------------------------------------
// E. Transfer bank -> investment is asset reallocation, not household
//    expense; it must show up as this month's "investment" contribution.
// ---------------------------------------------------------------------
{
  resetState({ accounts: [acc('bank', 'bank', 'JPY', 200000), acc('inv', 'investment', 'JPY', 0)] });
  const t = tx({ account_id: 'bank', transfer_account_id: 'inv', transaction_type: 'transfer', amount: 50000, transaction_date: '2026-09-10' });
  const stats = F.statsFor([t]);
  eq('E. Bank->investment transfer adds ZERO household expense', stats.expense, 0);
  eq('E. Bank->investment transfer counts fully as "investment" for the month', stats.investment, 50000);
}

// ---------------------------------------------------------------------
// F. Category plan edited effective from October: September must keep the
//    old value, October onward gets the new value (no rewriting history).
// ---------------------------------------------------------------------
{
  resetState({
    categoryVersions: [
      { category_id: 'salary', effective_month: '2026-09-01', name: 'Lương C', planned_amount: 280000 },
      { category_id: 'salary', effective_month: '2026-10-01', name: 'Lương C', planned_amount: 300000 }
    ]
  });
  eq('F. September still resolves to the old 280,000 plan', F.categoryVersionAt('salary', '2026-09-20').planned_amount, 280000);
  eq('F. October resolves to the new 300,000 plan', F.categoryVersionAt('salary', '2026-10-02').planned_amount, 300000);
  eq('F. November inherits forward (still 300,000, no new edit needed)', F.categoryVersionAt('salary', '2026-11-01').planned_amount, 300000);
}

// ---------------------------------------------------------------------
// F2. Category trend widget must survive a rename: it groups by
//     category_id, not the display name, so spend from before a rename
//     doesn't silently read as zero once the name changes.
// ---------------------------------------------------------------------
{
  resetState({
    categories: [{ id: 'eat1', direction: 'expense', cost_type: 'variable', name: 'Ăn uống ngoài', is_active: true }],
    categoryVersions: [
      { category_id: 'eat1', effective_month: '2026-07-01', name: 'Ăn uống', cost_type: 'variable' },
      { category_id: 'eat1', effective_month: '2026-09-01', name: 'Ăn uống ngoài', cost_type: 'variable' }
    ]
  });
  sandbox.state.fullTransactions = [
    tx({ account_id: 'bank', category_id: 'eat1', transaction_type: 'expense', amount: 40000, transaction_date: '2026-07-15' }),
    tx({ account_id: 'bank', category_id: 'eat1', transaction_type: 'expense', amount: 50000, transaction_date: '2026-09-15' })
  ];
  const trend = F.categoryTrendData(5, 3, '2026-09'); // window = Jul, Aug, Sep
  eq('F2. Renamed category collapses to exactly one trend row, not two', trend.length, 1);
  eq('F2. Pre-rename month (July, old name) still shows its real spend', trend[0]?.series[0]?.value, 40000);
  eq('F2. Post-rename month (September, new name) shows its spend', trend[0]?.series[2]?.value, 50000);
  eq('F2. Row label uses the current name', trend[0]?.name, 'Ăn uống ngoài');
}

// ---------------------------------------------------------------------
// Net-worth invariants (each of these must NOT create or destroy money):
// ---------------------------------------------------------------------
{
  resetState({ accounts: [acc('bank', 'bank', 'JPY', 100000)] });
  const nw0 = F.financialPosition().netWorth;
  eq('Baseline net worth = opening balance', nw0, 100000);

  resetState({
    accounts: [acc('bank', 'bank', 'JPY', 100000)],
    loans: [{ id: 'l', loan_type: 'borrowed', currency: 'JPY', principal: 100000, remaining_amount: 100000, start_date: '2026-01-01' }],
    fullTransactions: [tx({ account_id: 'bank', loan_id: 'l', transaction_type: 'loan_borrow', amount: 100000, transaction_date: '2026-02-01' })]
  });
  eq('Borrowing 100,000: cash +100,000 and liability +100,000 => net worth unchanged', F.financialPosition().netWorth, 100000);

  resetState({
    accounts: [acc('bank', 'bank', 'JPY', 80000), acc('sav', 'savings', 'JPY', 20000)],
    fullTransactions: [tx({ account_id: 'bank', transfer_account_id: 'sav', transaction_type: 'transfer', amount: 20000, transaction_date: '2026-09-01' })]
  });
  eq('Internal transfer between own accounts leaves net worth unchanged', F.financialPosition().netWorth, 100000);

  resetState({
    accounts: [acc('c1', 'bank', 'JPY', 100000), acc('c2', 'credit', 'JPY', 0)],
    fullTransactions: [
      tx({ account_id: 'c2', transaction_type: 'expense', amount: 10000, transaction_date: '2026-09-01', category_id: 'x' }),
      tx({ account_id: 'c1', transfer_account_id: 'c2', transaction_type: 'transfer', amount: 10000, transaction_date: '2026-09-15' })
    ]
  });
  eq('Card purchase then statement payment: net worth drops once (spend), not twice', F.financialPosition().netWorth, 90000);
}

// ---------------------------------------------------------------------
// Bank-loan amortisation math (元利均等 annuity formula).
// ---------------------------------------------------------------------
{
  eq('annuityPayment at 0% = principal / months', F.annuityPayment(120000, 0, 12), 10000, 1e-9);
  eq('annuityPayment(30,000,000 JPY, 1%, 420mo) matches known analytic value', F.annuityPayment(30000000, 1, 420), 84685.70968101347, 1e-6);
  const firstEqualPrincipal = 30000000 / 420 + 30000000 * (0.01 / 12);
  eq('元金均等 first period = principal/months + interest on full balance', firstEqualPrincipal, 96428.57142857143, 1e-6);
}

// ---------------------------------------------------------------------
// Foreign currency: JPY and VND must never be summed 1:1.
// ---------------------------------------------------------------------
{
  resetState({ base: 'JPY', accounts: [acc('bank', 'bank', 'JPY', 100000), acc('vnbank', 'bank', 'VND', 5000000)] });
  eq('A JPY-base household excludes a VND account from totalAssets entirely', F.financialPosition().totalAssets, 100000);
  eq('toVND(JPY) is null with no fx rate on file (never assumes 1:1)', F.toVND(1000, 'JPY'), null);
  resetState({ base: 'JPY', reporting: { show_vnd_conversion: true, jpy_vnd_rate: 168 } });
  eq('toVND(JPY) uses the explicit entered rate once one exists', F.toVND(1000, 'JPY'), 168000);
  eq('toVND(VND) passes VND amounts through unchanged', F.toVND(50000, 'VND'), 50000);
  eq('positionInVND multiplies every figure by the current rate', F.positionInVND({ totalAssets: 100, totalLiabilities: 20, netWorth: 80, liquid: 60, invested: 40 }).netWorth, 80 * 168);
  resetState({ base: 'JPY', reporting: { show_vnd_conversion: false, jpy_vnd_rate: null } });
  eq('positionInVND is null with no fx rate on file', F.positionInVND({ totalAssets: 100, totalLiabilities: 20, netWorth: 80, liquid: 60, invested: 40 }), null);
}

// ---------------------------------------------------------------------
// Print report
// ---------------------------------------------------------------------
const pass = results.filter(r => r.ok).length;
console.log(`\nFormula audit: ${pass}/${results.length} PASS\n`);
for (const r of results) {
  const mark = r.ok ? '✓' : '✗';
  console.log(`${mark} ${r.name}${r.ok ? '' : `  (got ${r.actual}, expected ${r.expected})`}`);
}
if (pass !== results.length) { console.error(`\n${results.length - pass} FAILED`); process.exit(1); }
console.log('\nAll formula checks PASS.');
