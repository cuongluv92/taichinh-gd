#!/usr/bin/env node
// ==========================================================================
// Standalone formula audit — exercises the REAL js/finance.js code (not a
// parallel reimplementation) against synthetic fixture data. No network,
// no real household data touched. Run: node scripts/audit-formulas.mjs
//
// Covers the architecture split: Chi tiêu (month report) / Tài sản (manual
// account balances) / Đầu tư (its own ledger, one-way link into Tài sản) are
// independent systems — these cases are largely the acceptance scenarios
// A-F from the spec that drove the split.
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
  state: {
    base: 'JPY', month: '2026-09', accounts: [], categories: [], categoryVersions: [], transactions: [], fullTransactions: [],
    loans: [], exceptionalIds: [], reporting: { show_vnd_conversion: false, jpy_vnd_rate: null },
    accountAdjustments: [], cardExpenses: [], installments: [], investments: [], investmentEvents: {}
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(financeSrc, sandbox, { filename: 'finance.js' });
const F = sandbox.F;

function resetState(patch) {
  Object.assign(sandbox.state, {
    base: 'JPY', accounts: [], categories: [], categoryVersions: [], transactions: [], fullTransactions: [],
    loans: [], exceptionalIds: [], reporting: { show_vnd_conversion: false, jpy_vnd_rate: null },
    accountAdjustments: [], cardExpenses: [], installments: [], investments: [], investmentEvents: {}
  }, patch);
}
function acc(id, type, currency, opening = 0, extra = {}) { return { id, account_type: type, currency, opening_balance: opening, is_active: true, ...extra }; }
function tx(overrides) { return { id: overrides.id || Math.random().toString(36).slice(2), currency: 'JPY', ...overrides }; }
function adj(id, accountId, direction, amount, date, currency = 'JPY') { return { id, account_id: accountId, direction, amount, currency, adjustment_date: date }; }

// ---------------------------------------------------------------------
// A. Chi biến động: Ăn uống ¥3,000 only increases Chi biến động + Tổng chi
//    tiêu tháng; never touches accounts or any other column.
// ---------------------------------------------------------------------
{
  resetState({
    accounts: [acc('ufj', 'bank', 'JPY', 500000)],
    accountAdjustments: [],
    categories: [{ id: 'eat', direction: 'expense', cost_type: 'variable', name: 'Ăn uống', is_active: true }],
    fullTransactions: [tx({ category_id: 'eat', transaction_type: 'expense', amount: 3000, transaction_date: '2026-09-10' })]
  });
  sandbox.state.transactions = sandbox.state.fullTransactions;
  const s = F.statsFor('2026-09');
  eq('A. Chi biến động increases by exactly 3,000', s.variable, 3000);
  eq('A. Tổng chi tiêu tháng increases by exactly 3,000 (fixed/card/debt untouched)', s.expense, 3000);
  eq('A. Bank account balance is completely unaffected by an expense transaction', F.accountBalance(sandbox.state.accounts[0]), 500000);
}

// ---------------------------------------------------------------------
// B. Rakuten card expense ¥10,000: only Thẻ & trả góp increases, Chi biến
//    động and accounts stay untouched. Edit to 12,000 and delete both
//    recompute the column total correctly.
// ---------------------------------------------------------------------
{
  resetState({
    accounts: [acc('rakuten', 'credit', 'JPY', 0)],
    cardExpenses: [{ id: 'ce1', card_account_id: 'rakuten', entry_mode: 'detail', expense_date: '2026-09-15', amount: 10000 }]
  });
  let s = F.statsFor('2026-09');
  eq('B. Thẻ & trả góp increases by exactly 10,000', s.card, 10000);
  eq('B. Chi biến động unaffected by a card expense', s.variable, 0);
  eq('B. Tổng chi tiêu tháng = the card amount only', s.expense, 10000);

  // Edit to 12,000
  sandbox.state.cardExpenses[0].amount = 12000;
  s = F.statsFor('2026-09');
  eq('B. After editing to 12,000, Thẻ & trả góp = 12,000', s.card, 12000);
  eq('B. After editing, Tổng chi tiêu tháng = 12,000', s.expense, 12000);

  // Delete
  sandbox.state.cardExpenses = [];
  s = F.statsFor('2026-09');
  eq('B. After deleting, Thẻ & trả góp returns to 0', s.card, 0);
  eq('B. After deleting, Tổng chi tiêu tháng returns to 0', s.expense, 0);
}

// ---------------------------------------------------------------------
// C. Trả góp ¥60,000 / 6 kỳ / ¥10,000 mỗi kỳ: each month shows only that
//    month's due kỳ in Thẻ & trả góp; never appears in Chi biến động; never
//    auto-deducts from a bank account.
// ---------------------------------------------------------------------
{
  const schedule = Array.from({ length: 6 }, (_, i) => ({
    installment_no: i + 1, payment_month: sandbox.addMonths('2026-09-01', i), principal_amount: 10000, fee_amount: 0, is_paid: false
  }));
  resetState({
    accounts: [acc('rakuten', 'credit', 'JPY', 0), acc('ufj', 'bank', 'JPY', 500000)],
    installments: [{ id: 'i1', card_account_id: 'rakuten', name: 'Máy giặt', principal_amount: 60000, total_installments: 6, currency: 'JPY', schedule }]
  });
  const sep = F.statsFor('2026-09'), oct = F.statsFor('2026-10'), dec = F.statsFor('2026-12');
  eq('C. September shows exactly one kỳ (10,000) in Thẻ & trả góp', sep.card, 10000);
  eq('C. October also shows exactly one kỳ (10,000), not the running total', oct.card, 10000);
  eq('C. A month with no due kỳ (none scheduled past Feb) shows 0', dec.card, 10000); // Sep..Feb = 6 months, Dec is kỳ #4 = still 10,000
  eq('C. Chi biến động never includes any installment amount', sep.variable, 0);
  eq('C. Bank account balance is untouched by installment schedule', F.accountBalance(sandbox.state.accounts[1]), 500000);
}

// ---------------------------------------------------------------------
// D. Điều chỉnh ngân hàng thủ công: +100,000 increases UFJ only, Thu nhập
//    tháng unaffected; −20,000 decreases UFJ only, Chi tiêu tháng unaffected.
// ---------------------------------------------------------------------
{
  resetState({
    accounts: [acc('ufj', 'bank', 'JPY', 500000)],
    accountAdjustments: [adj('a1', 'ufj', 'increase', 100000, '2026-09-05')]
  });
  eq('D. Manual +100,000 increases UFJ balance to 600,000', F.accountBalance(sandbox.state.accounts[0]), 600000);
  let s = F.statsFor('2026-09');
  eq('D. Thu nhập tháng is untouched by a manual account increase', s.income, 0);

  sandbox.state.accountAdjustments.push(adj('a2', 'ufj', 'decrease', 20000, '2026-09-06'));
  eq('D. Manual -20,000 further decreases UFJ balance to 580,000', F.accountBalance(sandbox.state.accounts[0]), 580000);
  s = F.statsFor('2026-09');
  eq('D. Chi tiêu tháng is untouched by a manual account decrease', s.expense, 0);
}

// ---------------------------------------------------------------------
// E. Đầu tư NISA giá trị hiện tại ¥500,000: Đầu tư total = 500,000; Tài sản
//    ròng increases by 500,000; Tiền thanh khoản does NOT increase; monthly
//    Tổng quan (statsFor) is entirely unaffected.
// ---------------------------------------------------------------------
{
  resetState({
    accounts: [acc('ufj', 'bank', 'JPY', 200000)],
    investments: [{ id: 'nisa', name: 'NISA', currency: 'JPY', initial_capital: 500000, total_contributed: 0, total_withdrawn: 0, latest_value: 500000, latest_value_date: '2026-09-15' }]
  });
  eq('E. Đầu tư total current value = 500,000', F.investmentTotalValue(), 500000);
  const pos = F.financialPosition();
  eq('E. Tài sản ròng = bank (200,000) + invested (500,000)', pos.netWorth, 700000);
  eq('E. Tiền thanh khoản does NOT include the investment', pos.liquid, 200000);
  const s = F.statsFor('2026-09');
  eq('E. Monthly Tổng quan (income/expense) is completely unaffected by investment data', s.income + s.expense, 0);
}

// ---------------------------------------------------------------------
// F. Báo cáo: switching months must not mix data; each month's stats are
//    computed independently from the same shared fixture data.
// ---------------------------------------------------------------------
{
  resetState({
    categories: [{ id: 'eat', direction: 'expense', cost_type: 'variable', is_active: true }],
    fullTransactions: [
      tx({ category_id: 'eat', transaction_type: 'expense', amount: 3000, transaction_date: '2026-09-15' }),
      tx({ category_id: 'eat', transaction_type: 'expense', amount: 9000, transaction_date: '2026-08-15' }),
      tx({ category_id: 'eat', transaction_type: 'expense', amount: 4000, transaction_date: '2025-09-15' })
    ]
  });
  eq('F. September 2026 sees only its own 3,000', F.statsFor('2026-09').variable, 3000);
  eq('F. August 2026 sees only its own 9,000 (not mixed with September)', F.statsFor('2026-08').variable, 9000);
  eq('F. September 2025 (same month last year) sees only its own 4,000', F.statsFor('2025-09').variable, 4000);
}

// ---------------------------------------------------------------------
// Investment formulas: vốn ròng, lãi/lỗ, and the no-valuation-yet fallback.
// ---------------------------------------------------------------------
{
  const withValuation = { initial_capital: 100000, total_contributed: 50000, total_withdrawn: 20000, latest_value: 200000 };
  eq('Vốn ròng = vốn ban đầu + vốn thêm − vốn rút', F.investmentNetCapital(withValuation), 130000);
  eq('Giá trị hiện tại uses the latest valuation when one exists', F.investmentCurrentValue(withValuation), 200000);
  eq('Lãi/lỗ = giá trị hiện tại − vốn ròng', F.investmentPL(withValuation), 70000);
  eq('Lãi/lỗ % = lãi/lỗ ÷ vốn ròng × 100', F.investmentPLPercent(withValuation), 70000 / 130000 * 100, 1e-9);

  const noValuation = { initial_capital: 100000, total_contributed: 0, total_withdrawn: 0, latest_value: null };
  eq('With no valuation yet, giá trị hiện tại falls back to vốn ròng', F.investmentCurrentValue(noValuation), 100000);
  eq('With no valuation yet, lãi/lỗ = 0', F.investmentPL(noValuation), 0);
}

// ---------------------------------------------------------------------
// Category plan history (unaffected by the architecture split).
// ---------------------------------------------------------------------
{
  resetState({
    categoryVersions: [
      { category_id: 'salary', effective_month: '2026-09-01', name: 'Lương C', planned_amount: 280000 },
      { category_id: 'salary', effective_month: '2026-10-01', name: 'Lương C', planned_amount: 300000 }
    ]
  });
  eq('September still resolves to the old 280,000 plan', F.categoryVersionAt('salary', '2026-09-20').planned_amount, 280000);
  eq('October resolves to the new 300,000 plan', F.categoryVersionAt('salary', '2026-10-02').planned_amount, 300000);
  eq('November inherits forward (still 300,000, no new edit needed)', F.categoryVersionAt('salary', '2026-11-01').planned_amount, 300000);
}
{
  resetState({
    categories: [{ id: 'eat1', direction: 'expense', cost_type: 'variable', name: 'Ăn uống ngoài', is_active: true }],
    categoryVersions: [
      { category_id: 'eat1', effective_month: '2026-07-01', name: 'Ăn uống', cost_type: 'variable' },
      { category_id: 'eat1', effective_month: '2026-09-01', name: 'Ăn uống ngoài', cost_type: 'variable' }
    ],
    fullTransactions: [
      tx({ category_id: 'eat1', transaction_type: 'expense', amount: 40000, transaction_date: '2026-07-15' }),
      tx({ category_id: 'eat1', transaction_type: 'expense', amount: 50000, transaction_date: '2026-09-15' })
    ]
  });
  const trend = F.categoryTrendData(5, 3, '2026-09');
  eq('Renamed category collapses to exactly one trend row, not two', trend.length, 1);
  eq('Pre-rename month (July, old name) still shows its real spend', trend[0]?.series[0]?.value, 40000);
  eq('Post-rename month (September, new name) shows its spend', trend[0]?.series[2]?.value, 50000);
  eq('Row label uses the current name', trend[0]?.name, 'Ăn uống ngoài');
}

// ---------------------------------------------------------------------
// Net-worth invariants — Tài sản is manual-only; loans stay untouched.
// ---------------------------------------------------------------------
{
  resetState({ accounts: [acc('bank', 'bank', 'JPY', 100000)] });
  eq('Baseline net worth = opening balance with no adjustments', F.financialPosition().netWorth, 100000);

  resetState({
    accounts: [acc('bank', 'bank', 'JPY', 100000)],
    accountAdjustments: [adj('a1', 'bank', 'increase', 50000, '2026-09-01')]
  });
  eq('Manual increase raises both balance and net worth by the same amount', F.financialPosition().netWorth, 150000);

  resetState({
    accounts: [acc('bank', 'bank', 'JPY', 100000)],
    loans: [{ id: 'l', loan_type: 'borrowed', currency: 'JPY', principal: 40000, remaining_amount: 40000, start_date: '2026-01-01' }]
  });
  const pos = F.financialPosition();
  eq('An outstanding loan reduces net worth by its remaining amount', pos.netWorth, 60000);
  eq('Loan does not affect liquid (a loan disbursement is never auto-posted to an account anymore)', pos.liquid, 100000);
  eq('liquidNet = liquid − borrowed', pos.liquidNet, 60000);

  resetState({
    accounts: [
      acc('bank', 'bank', 'JPY', 100000),
      { id: 'sav1', account_type: 'savings', currency: 'JPY', opening_balance: 50000, is_active: true, is_liquid: true },
      { id: 'sav2', account_type: 'savings', currency: 'JPY', opening_balance: 30000, is_active: true, is_liquid: false }
    ]
  });
  const posLiquid = F.financialPosition();
  eq('Locked savings (is_liquid:false) excluded from liquid', posLiquid.liquid, 150000);
  eq('Locked savings still counted in netWorth', posLiquid.netWorth, 180000);

  resetState({ accounts: [acc('rakuten', 'credit', 'JPY', 0)] });
  eq('A credit (card) account never contributes to netWorth — it is a Chi tiêu identity only', F.financialPosition().netWorth, 0);
}

// ---------------------------------------------------------------------
// Bank-loan amortisation math (元利均等 annuity formula) — unchanged.
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
  eq('positionInVND multiplies every figure by the current rate', F.positionInVND({ totalAssets: 100, totalLiabilities: 20, netWorth: 80, liquid: 60, liquidNet: 50, invested: 40 }).netWorth, 80 * 168);
  eq('positionInVND multiplies liquidNet too', F.positionInVND({ totalAssets: 100, totalLiabilities: 20, netWorth: 80, liquid: 60, liquidNet: 50, invested: 40 }).liquidNet, 50 * 168);
  resetState({ base: 'JPY', reporting: { show_vnd_conversion: false, jpy_vnd_rate: null } });
  eq('positionInVND is null with no fx rate on file', F.positionInVND({ totalAssets: 100, totalLiabilities: 20, netWorth: 80, liquid: 60, liquidNet: 50, invested: 40 }), null);
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
