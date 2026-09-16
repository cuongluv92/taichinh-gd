#!/usr/bin/env node
// ==========================================================================
// Standalone formula audit — exercises the REAL js/finance.js code (not a
// parallel reimplementation) against synthetic fixture data. No network,
// no real household data touched. Run: node scripts/audit-formulas.mjs
//
// Covers both architecture passes: Chi tiêu (month report, no debt) / Tài
// sản (manual account + debt balances, four KPIs, no "Thanh khoản ròng") /
// Đầu tư (NISA + Chứng khoán + Tiết kiệm sinh lời + Khác, one-way link into
// Tài sản, growth simulation kept separate from real values).
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

const BASE_STATE = {
  base: 'JPY', month: '2026-09', accounts: [], categories: [], categoryVersions: [], transactions: [], fullTransactions: [],
  exceptionalIds: [], reporting: { show_vnd_conversion: false, jpy_vnd_rate: null },
  accountAdjustments: [], cardExpenses: [], installments: [], debts: [], debtAdjustments: [], investments: [], investmentEvents: {}
};
const sandbox = {
  console,
  n: v => Number(v || 0),
  clamp0: v => Math.max(0, Number(v || 0)),
  money: (v, c) => `${Math.round(Number(v || 0))} ${c || ''}`,
  esc: v => String(v),
  act: (name, ...args) => `data-action="${name}"${args.length ? ` data-a="${JSON.stringify(args)}"` : ''}`,
  pctText: (v, base) => (base > 0 ? `${(Number(v) / base * 100).toFixed(1)}%` : '—'),
  monthKey: d => String(d || '').slice(0, 7),
  yearKey: d => String(d || '').slice(0, 4),
  endOfMonthDate: key => { const [y, m] = key.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); },
  localToday: () => '2026-09-15',
  localMonth: () => '2026-09',
  addMonths: (ym, delta) => { const [y, m] = String(ym).slice(0, 7).split('-').map(Number); const idx = y * 12 + (m - 1) + delta; return `${Math.floor(idx / 12)}-${String(idx % 12 + 1).padStart(2, '0')}`; },
  state: { ...BASE_STATE }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(financeSrc, sandbox, { filename: 'finance.js' });
const F = sandbox.F;
const legendHtml = sandbox.legendHtml;
const donutSvg = sandbox.donutSvg;
const trendSvg = sandbox.trendSvg;
const compactMoney = sandbox.compactMoney;

function resetState(patch) { Object.assign(sandbox.state, BASE_STATE, patch); }
function acc(id, type, currency, opening = 0, extra = {}) { return { id, account_type: type, currency, opening_balance: opening, is_active: true, ...extra }; }
function tx(overrides) { return { id: overrides.id || Math.random().toString(36).slice(2), currency: 'JPY', ...overrides }; }
function adj(id, accountId, direction, amount, date, currency = 'JPY') { return { id, account_id: accountId, direction, amount, currency, adjustment_date: date }; }
function debt(id, direction, opening, extra = {}) { return { id, name: id, direction, currency: 'JPY', opening_amount: opening, ...extra }; }
function debtAdj(id, debtId, direction, amount, date) { return { id, debt_id: debtId, direction, amount, adjustment_date: date }; }

// ---------------------------------------------------------------------
// A. Chi biến động: Ăn uống ¥3,000 only increases Chi biến động + Tổng chi
//    tiêu tháng; never touches accounts or any other column.
// ---------------------------------------------------------------------
{
  resetState({
    accounts: [acc('ufj', 'bank', 'JPY', 500000)],
    categories: [{ id: 'eat', direction: 'expense', cost_type: 'variable', name: 'Ăn uống', is_active: true }],
    fullTransactions: [tx({ category_id: 'eat', transaction_type: 'expense', amount: 3000, transaction_date: '2026-09-10' })]
  });
  sandbox.state.transactions = sandbox.state.fullTransactions;
  const s = F.statsFor('2026-09');
  eq('A. Chi biến động increases by exactly 3,000', s.variable, 3000);
  eq('A. Tổng chi tiêu tháng increases by exactly 3,000 (fixed/card untouched)', s.expense, 3000);
  eq('A. statsFor has no "debt" field at all — Nợ left Chi tiêu entirely', s.debt, undefined);
  eq('A. Bank account balance is completely unaffected by an expense transaction', F.accountBalance(sandbox.state.accounts[0]), 500000);
}

// ---------------------------------------------------------------------
// B. Rakuten card expense ¥10,000: only Thẻ (not Trả góp) increases.
// ---------------------------------------------------------------------
{
  resetState({
    accounts: [acc('rakuten', 'credit', 'JPY', 0)],
    cardExpenses: [{ id: 'ce1', card_account_id: 'rakuten', entry_mode: 'detail', expense_date: '2026-09-15', amount: 10000 }]
  });
  let s = F.statsFor('2026-09');
  eq('B. Thẻ increases by exactly 10,000', s.card, 10000);
  eq('B. Trả góp stays 0 — a card expense never bleeds into it', s.installment, 0);
  eq('B. Tổng chi tiêu tháng = the card amount only', s.expense, 10000);
  sandbox.state.cardExpenses[0].amount = 12000;
  s = F.statsFor('2026-09');
  eq('B. After editing to 12,000, Tổng chi tiêu tháng = 12,000', s.expense, 12000);
}

// ---------------------------------------------------------------------
// C. Thẻ and Trả góp are independent columns/figures — a card with BOTH a
//    direct card expense AND an installment kỳ due the same month must
//    report them as two separate numbers that still add up to the same
//    Tổng chi tiêu tháng total as before the split.
// ---------------------------------------------------------------------
{
  resetState({
    accounts: [acc('rakuten', 'credit', 'JPY', 0)],
    cardExpenses: [{ id: 'ce1', card_account_id: 'rakuten', entry_mode: 'detail', expense_date: '2026-09-05', amount: 10000 }],
    installments: [{
      id: 'inst1', card_account_id: 'rakuten', name: 'iPhone', principal_amount: 120000, total_installments: 12,
      schedule: [{ id: 'sch1', installment_no: 9, payment_month: '2026-09-01', principal_amount: 10000, fee_amount: 0, is_paid: false }]
    }]
  });
  const s = F.statsFor('2026-09');
  eq('C. Thẻ = the card expense only (10,000)', s.card, 10000);
  eq('C. Trả góp = the installment kỳ due only (10,000)', s.installment, 10000);
  eq('C. Tổng chi tiêu tháng sums both (20,000), unchanged by the split', s.expense, 20000);
  const trend = F.categoryTrendData(5, 1, '2026-09');
  eq('C. categoryTrendData reports Thẻ and Trả góp as two separate rows', trend.filter(r => r.name === 'Thẻ' || r.name === 'Trả góp').length, 2);
}

// ---------------------------------------------------------------------
// NỢ #1: the debt ledger is entirely manual and entirely separate from Chi
// tiêu — moving debt out of Chi tiêu per the newest spec.
// ---------------------------------------------------------------------
{
  resetState({
    categories: [{ id: 'eat', direction: 'expense', cost_type: 'variable', is_active: true }],
    fullTransactions: [tx({ category_id: 'eat', transaction_type: 'expense', amount: 5000, transaction_date: '2026-09-10' })],
    debts: [debt('vay1', 'payable', 1250000, { due_date: '2026-12-01' })]
  });
  sandbox.state.transactions = sandbox.state.fullTransactions;
  const s = F.statsFor('2026-09');
  eq('NỢ. Cột Nợ phải trả biến mất khỏi Chi tiêu: statsFor never includes a debt field', s.debt, undefined);
  eq('NỢ. Nợ không được cộng vào Tổng chi tiêu tháng (chỉ có Chi biến động 5,000)', s.expense, 5000);
  eq('NỢ. Khoản vay cũ ¥1,250,000 vẫn còn nguyên tại Tài sản (dư nợ = opening_amount, chưa điều chỉnh)', F.debtBalance(sandbox.state.debts[0]), 1250000);
}
{
  // Manual increase/decrease on a debt, like an account adjustment.
  resetState({ debts: [debt('d1', 'payable', 500000)], debtAdjustments: [debtAdj('da1', 'd1', 'decrease', 50000, '2026-09-01')] });
  eq('NỢ. Trả bớt 50,000 giảm đúng dư nợ (500,000 - 50,000)', F.debtBalance(sandbox.state.debts[0]), 450000);
  sandbox.state.debtAdjustments.push(debtAdj('da2', 'd1', 'increase', 20000, '2026-09-10'));
  eq('NỢ. Vay thêm 20,000 tăng đúng dư nợ (450,000 + 20,000)', F.debtBalance(sandbox.state.debts[0]), 470000);
}
{
  // Tổng nợ trừ đúng một lần trong Tài sản ròng.
  resetState({
    accounts: [acc('bank', 'bank', 'JPY', 300000)],
    debts: [debt('payable1', 'payable', 100000), debt('recv1', 'receivable', 40000)]
  });
  const pos = F.financialPosition();
  eq('NỢ. Tổng nợ được trừ đúng MỘT lần trong Tài sản ròng (300,000 + 40,000 - 100,000)', pos.netWorth, 240000);
  eq('NỢ. payables = 100,000', pos.payables, 100000);
  eq('NỢ. receivables = 40,000', pos.receivables, 40000);
}

// ---------------------------------------------------------------------
// TÀI SẢN: Tiền thanh khoản = tiền mặt + ngân hàng only, no "Thanh khoản
// ròng" field exists anywhere, netWorth formula matches the new spec.
// ---------------------------------------------------------------------
{
  resetState({
    accounts: [
      acc('cash', 'cash', 'JPY', 50000), acc('bank', 'bank', 'JPY', 200000), acc('sav', 'savings', 'JPY', 100000),
      acc('card', 'credit', 'JPY', 0)
    ],
    debts: [debt('d1', 'payable', 30000)],
    investments: [{ id: 'inv1', kind: 'other', currency: 'JPY', initial_capital: 500000, total_contributed: 0, total_withdrawn: 0, latest_value: 500000, latest_value_date: '2026-09-15' }]
  });
  const pos = F.financialPosition();
  eq('TÀI SẢN. Tiền thanh khoản = tiền mặt + ngân hàng + tiết kiệm (mọi account còn lại đều liquid)', pos.liquid, 350000);
  eq('TÀI SẢN. Không trừ nợ khỏi Tiền thanh khoản', pos.liquid, 350000);
  eq('TÀI SẢN. "liquidNet" không còn tồn tại trong financialPosition', pos.liquidNet, undefined);
  eq('TÀI SẢN. Tổng đầu tư = 500,000', pos.invested, 500000);
  eq('TÀI SẢN. Thẻ tín dụng (credit) không góp phần vào bất kỳ số nào ở Tài sản', pos.liquid, 350000);
  eq('TÀI SẢN. Tài sản ròng = Tiền thanh khoản + Tổng đầu tư + Khoản phải thu + 0 − Tổng nợ', pos.netWorth, 350000 + 500000 + 0 - 30000);
}

// ---------------------------------------------------------------------
// NISA: kế hoạch góp hàng tháng phải tách biệt "kế hoạch" khỏi "đã góp
// thực tế", và growth simulation không được lẫn vào giá trị/lãi-lỗ thực tế.
// ---------------------------------------------------------------------
{
  const nisa = { id: 'nisa1', kind: 'nisa', currency: 'JPY', initial_capital: 0, monthly_amount: 30000, monthly_day: 5, plan_start_month: '2026-09-01', plan_paused: false };
  resetState({ investments: [nisa], investmentEvents: { nisa1: [] } });
  let st = F.investmentPlanStatus(nisa, [], '2026-09');
  eq('NISA. Tháng mới (chưa xác nhận) hiển thị trạng thái "pending" với số tiền dự kiến 30,000', st.status === 'pending' && st.amount === 30000, true);

  const events = [{ id: 'ev1', event_type: 'contribution', amount: 30000, event_date: '2026-09-05' }];
  nisa.total_contributed = 30000;
  st = F.investmentPlanStatus(nisa, events, '2026-09');
  eq('NISA. Sau khi xác nhận đã góp, trạng thái là "confirmed"', st.status, 'confirmed');
  eq('NISA. Sau khi xác nhận, tổng vốn thực tế tăng đúng 30,000', F.investmentNetCapital(nisa), 30000);

  const paused = { ...nisa, plan_paused: true };
  eq('NISA. Kế hoạch tạm dừng không còn "pending"', F.investmentPlanStatus(paused, [], '2026-10').status, 'paused');

  const skipped = [{ event_type: 'plan_skip', event_date: '2026-10-01' }];
  eq('NISA. Tháng bị bỏ qua hiển thị "skipped", không phải "pending"', F.investmentPlanStatus(nisa, skipped, '2026-10').status, 'skipped');
}
{
  // Growth simulation stays entirely separate from real value.
  const inv = { initial_capital: 100000, total_contributed: 0, total_withdrawn: 0, latest_value: null, start_date: '2025-09-15', created_at: '2025-09-15', expected_return_rate: 12, expected_return_period: 'annual', reinvest_mode: 'none' };
  const simAt15 = F.investmentSimulatedValue(inv, [], '2026-09-15'); // exactly 12 months later
  eq('NISA §8. Mô phỏng 12%/năm sau đúng 12 tháng = vốn × 1.12 (annual->monthly compound rate round-trips exactly)', simAt15, 100000 * 1.12, 1e-6);
  eq('NISA §8. Giá trị hiện tại thực tế KHÔNG bị ảnh hưởng bởi expected_return_rate', F.investmentCurrentValue(inv), 100000);
  const noRate = { ...inv, expected_return_rate: null };
  eq('NISA §8. Không đặt tỷ lệ kỳ vọng thì không có giá trị mô phỏng (null)', F.investmentSimulatedValue(noRate, []), null);
}

// ---------------------------------------------------------------------
// NISA holdings: một tài khoản NISA có thể chứa nhiều quỹ/ETF con
// (kind='securities' + parent_investment_id) — vốn ròng/giá trị/lãi-lỗ của
// NISA phải cộng dồn đúng từ các quỹ con, giống cách một sàn chứng khoán
// thật hiển thị (tổng tài khoản + từng mã giá mua -> giá hiện tại -> %).
// ---------------------------------------------------------------------
{
  const nisaParent = { id: 'nisaP', kind: 'nisa', currency: 'JPY', initial_capital: 0, total_contributed: 0, total_withdrawn: 0, latest_value: null };
  const fund1 = { id: 'fund1', kind: 'securities', currency: 'JPY', parent_investment_id: 'nisaP', quantity: 10, avg_cost: 15000, current_price: 16500, realized_pl: 0 };
  const fund2 = { id: 'fund2', kind: 'securities', currency: 'JPY', parent_investment_id: 'nisaP', quantity: 5, avg_cost: 20000, current_price: 19000, realized_pl: 0 };
  resetState({ investments: [nisaParent, fund1, fund2] });

  eq('NISA holdings. Vốn ròng NISA = tổng vốn 2 quỹ con (150,000 + 100,000)', F.investmentNetCapital(nisaParent), 250000);
  eq('NISA holdings. Giá trị hiện tại NISA = tổng giá trị 2 quỹ con (165,000 + 95,000)', F.investmentCurrentValue(nisaParent), 260000);
  eq('NISA holdings. Lãi/lỗ NISA = tổng lãi/lỗ 2 quỹ con (+15,000 và −5,000)', F.investmentPL(nisaParent), 10000);
  eq('NISA holdings. % lãi/lỗ NISA tính trên tổng vốn ròng khi có quỹ con (không còn là null)', F.investmentPLPercent(nisaParent), 10000 / 250000 * 100, 1e-9);

  eq('NISA holdings. F.investmentsByKind("nisa") vẫn trả về tài khoản NISA cha', F.investmentsByKind('nisa').length, 1);
  eq('NISA holdings. F.investmentsByKind("securities") KHÔNG trả về quỹ con (đã tính trong NISA cha, tránh trùng ở mục Chứng khoán độc lập)', F.investmentsByKind('securities').length, 0);
  eq('NISA holdings. F.investmentTotalValue() không đếm quỹ con lần thứ hai', F.investmentTotalValue(), 260000);

  const simpleNisa = { id: 'nisaSimple', kind: 'nisa', currency: 'JPY', initial_capital: 0, total_contributed: 30000, total_withdrawn: 0, latest_value: null };
  resetState({ investments: [simpleNisa] });
  eq('NISA holdings. NISA không có quỹ con nào vẫn dùng vốn ròng tài khoản như cũ (chế độ đơn giản)', F.investmentNetCapital(simpleNisa), 30000);
}

// ---------------------------------------------------------------------
// NISA %: vốn ròng = 0 (chưa góp gì) thì % là null vì không có gì để chia,
// không phải một lỗi hiển thị — NISA vẫn dùng đúng công thức % như Khác.
// ---------------------------------------------------------------------
{
  const freshNisa = { id: 'nisaFresh', kind: 'nisa', currency: 'JPY', initial_capital: 0, total_contributed: 0, total_withdrawn: 0, latest_value: null };
  resetState({ investments: [freshNisa], investmentEvents: { nisaFresh: [] } });
  eq('NISA %. Vốn ròng = 0 thì % là null (chưa có gì để tính %, không phải lỗi)', F.investmentPLPercent(freshNisa), null);

  const fundedNisa = { id: 'nisaFunded', kind: 'nisa', currency: 'JPY', initial_capital: 0, total_contributed: 100000, total_withdrawn: 0, latest_value: 110000 };
  const fundedEvents = [
    { id: 'f1', event_type: 'contribution', amount: 100000, event_date: '2026-08-01', created_at: '2026-08-01T00:00:00Z' },
    { id: 'f2', event_type: 'valuation', amount: 110000, event_date: '2026-09-01', created_at: '2026-09-01T00:00:00Z' }
  ];
  resetState({ investments: [fundedNisa], investmentEvents: { nisaFunded: fundedEvents } });
  eq('NISA %. Có vốn ròng > 0 thì % hiển thị đúng như Khác/Chứng khoán', F.investmentPLPercent(fundedNisa), 10, 1e-9);
}

// ---------------------------------------------------------------------
// BUG FIX: "Cập nhật giá trị" is a snapshot at its own date, not a
// permanent override — a Thêm vốn/Rút vốn/Nhận lãi recorded AFTER it must
// still move "giá trị hiện tại", or the value silently freezes the moment
// a valuation has ever been entered once (user-reported: "nhấn thêm vốn
// sao mà vốn mới không cập nhật").
// ---------------------------------------------------------------------
{
  const nisa = { id: 'nisaFreeze', kind: 'nisa', currency: 'JPY', initial_capital: 0, total_contributed: 130000, total_withdrawn: 0, latest_value: 550000, latest_value_date: '2026-09-10' };
  const eventsAfter = [
    { id: 'e1', event_type: 'contribution', amount: 100000, event_date: '2026-09-02', created_at: '2026-09-02T00:00:00Z' },
    { id: 'e2', event_type: 'valuation', amount: 550000, event_date: '2026-09-10', created_at: '2026-09-10T00:00:00Z' },
    { id: 'e3', event_type: 'contribution', amount: 30000, event_date: '2026-09-20', created_at: '2026-09-20T00:00:00Z' }
  ];
  resetState({ investments: [nisa], investmentEvents: { nisaFreeze: eventsAfter } });
  eq('BUGFIX. Giá trị hiện tại cộng thêm khoản Thêm vốn SAU lần Cập nhật giá trị gần nhất (550,000 + 30,000)', F.investmentCurrentValue(nisa), 580000);
  eq('BUGFIX. Vốn ròng vẫn tính đúng theo tổng đã góp (130,000)', F.investmentNetCapital(nisa), 130000);
  eq('BUGFIX. Lãi/lỗ = giá trị hiện tại mới − vốn ròng mới (580,000 − 130,000)', F.investmentPL(nisa), 450000);

  const nisaNoFollowUp = { ...nisa, total_contributed: 100000 };
  const eventsBefore = eventsAfter.slice(0, 2);
  resetState({ investments: [nisaNoFollowUp], investmentEvents: { nisaFreeze: eventsBefore } });
  eq('BUGFIX. Không có khoản góp nào sau lần Cập nhật giá trị thì giá trị hiện tại giữ đúng số đã cập nhật (550,000)', F.investmentCurrentValue(nisaNoFollowUp), 550000);

  // Same class of bug for Tiết kiệm sinh lời's "Nhận lãi" after a valuation.
  const sav = { id: 'savFreeze', kind: 'savings_interest', currency: 'JPY', initial_capital: 500000, total_contributed: 0, total_withdrawn: 0, total_interest: 0, latest_value: 500000, latest_value_date: '2026-08-01' };
  const savEvents = [
    { id: 's1', event_type: 'valuation', amount: 500000, event_date: '2026-08-01', created_at: '2026-08-01T00:00:00Z' },
    { id: 's2', event_type: 'interest', amount: 4000, event_date: '2026-09-01', created_at: '2026-09-01T00:00:00Z' }
  ];
  resetState({ investments: [sav], investmentEvents: { savFreeze: savEvents } });
  eq('BUGFIX. Tiết kiệm: Nhận lãi SAU lần Cập nhật giá trị vẫn cộng vào giá trị hiện tại (500,000 + 4,000)', F.investmentCurrentValue(sav), 504000);
}

// ---------------------------------------------------------------------
// CHỨNG KHOÁN: mua/bán theo giá vốn trung bình, lãi/lỗ chưa/đã thực hiện.
// ---------------------------------------------------------------------
{
  // Mirrors the RPC's own recompute loop client-side via investmentValueAt,
  // and checks the display formulas read straight off the row (which the
  // backend keeps in sync — verified separately against production).
  const sec = { kind: 'securities', currency: 'JPY', quantity: 100, avg_cost: 1000, current_price: 1100, realized_pl: 0 };
  eq('CK. Tổng giá vốn = số lượng × giá vốn TB', F.investmentNetCapital(sec), 100000);
  eq('CK. Giá trị hiện tại = số lượng × giá hiện tại', F.investmentCurrentValue(sec), 110000);
  eq('CK. Lãi/lỗ chưa thực hiện = giá trị hiện tại − tổng giá vốn = 10,000', F.investmentCurrentValue(sec) - F.investmentNetCapital(sec), 10000);
  eq('CK. Tỷ suất lãi/lỗ = 10,000 / 100,000 × 100 = 10%', F.investmentPLPercent(sec), 10, 1e-9);

  const secWithRealized = { ...sec, realized_pl: 5000 };
  eq('CK. Lãi/lỗ tổng (PL) cộng cả phần đã thực hiện: 5,000 (đã) + 10,000 (chưa) = 15,000', F.investmentPL(secWithRealized), 15000);

  // BUGFIX (Đầu tư page "Tổng lãi/lỗ thực tế" KPI): the portfolio total
  // used to be totalValue-totalCap directly, which drops realized_pl for
  // any chứng khoán that's ever been sold at a gain/loss (netCapital only
  // reflects shares still held). The KPI must sum F.investmentPL per
  // khoản instead — same formula every individual card already uses.
  const portfolio = [sec, secWithRealized];
  const wrongPortfolioPL = portfolio.reduce((s, i) => s + F.investmentCurrentValue(i), 0) - portfolio.reduce((s, i) => s + F.investmentNetCapital(i), 0);
  const correctPortfolioPL = portfolio.reduce((s, i) => s + F.investmentPL(i), 0);
  eq('Portfolio Tổng lãi/lỗ = tổng F.investmentPL từng khoản (10,000 + 15,000), không phải (totalValue-totalCap)', correctPortfolioPL, 25000);
  eq('(totalValue-totalCap) một mình sẽ làm mất 5,000 realized_pl — đúng lỗi đã sửa (cho thấy 20,000 thay vì 25,000)', wrongPortfolioPL, 20000);
}

// ---------------------------------------------------------------------
// TIẾT KIỆM SINH LỜI: lãi thực nhận tăng giá trị thực tế; lãi dự kiến chỉ
// là mô phỏng riêng, không tự coi là tài sản thực.
// ---------------------------------------------------------------------
{
  const sav = { id: 'savPlain', kind: 'savings_interest', currency: 'JPY', initial_capital: 500000, total_contributed: 0, total_withdrawn: 0, total_interest: 0, latest_value: null };
  resetState({ investments: [sav], investmentEvents: { savPlain: [] } });
  eq('TK. Chưa nhận lãi: giá trị hiện tại = tiền gốc (500,000)', F.investmentCurrentValue(sav), 500000);
  eq('TK. Chưa nhận lãi: lãi/lỗ thực tế = 0', F.investmentPL(sav), 0);

  const savWithInterest = { id: 'savInterest', kind: 'savings_interest', currency: 'JPY', initial_capital: 500000, total_contributed: 0, total_withdrawn: 0, total_interest: 5000, latest_value: null };
  resetState({ investments: [savWithInterest], investmentEvents: { savInterest: [{ id: 'i1', event_type: 'interest', amount: 5000, event_date: '2026-09-05', created_at: '2026-09-05T00:00:00Z' }] } });
  eq('TK. Sau khi ghi nhận lãi thực nhận 5,000: giá trị hiện tại = 505,000', F.investmentCurrentValue(savWithInterest), 505000);
  eq('TK. Lãi thực nhận thể hiện đúng bằng total_interest (5,000), không lẫn với lãi dự kiến', F.investmentPL(savWithInterest), 5000);

  // Chỉ tăng khi ghi nhận lãi thực nhận hoặc cập nhật số dư — một khoản gửi
  // thêm (contribution) không được tự động cộng thêm "lãi".
  const savWithDeposit = { id: 'savDeposit', kind: 'savings_interest', currency: 'JPY', initial_capital: 500000, total_contributed: 20000, total_withdrawn: 0, total_interest: 0, latest_value: null };
  resetState({ investments: [savWithDeposit], investmentEvents: { savDeposit: [{ id: 'd1', event_type: 'contribution', amount: 20000, event_date: '2026-09-05', created_at: '2026-09-05T00:00:00Z' }] } });
  eq('TK. Gửi thêm 20,000 chỉ tăng vốn ròng, không tạo ra lãi', F.investmentPL(savWithDeposit), 0);
}

// ---------------------------------------------------------------------
// Category plan history + trend (unaffected by either architecture pass).
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
  eq('Row label uses the current name', trend[0]?.name, 'Ăn uống ngoài');
}

// ---------------------------------------------------------------------
// "Xu hướng theo danh mục" (Tổng quan) must exclude chi cố định — a fixed
// category is the same amount every month by definition, so a trend chart
// for it is just a flat line. Thẻ isn't a category transaction at all (own
// ledger), but moves month to month just like chi biến động, so it's
// folded in as its own synthetic row instead (Trả góp likewise, when a kỳ
// is actually due that month — see case C above).
// ---------------------------------------------------------------------
{
  resetState({
    accounts: [acc('card1', 'credit', 'JPY')],
    categories: [
      { id: 'rent1', direction: 'expense', cost_type: 'fixed', name: 'Nhà ở', is_active: true },
      { id: 'eat2', direction: 'expense', cost_type: 'variable', name: 'Ăn uống', is_active: true }
    ],
    categoryVersions: [
      { category_id: 'rent1', effective_month: '2026-01-01', name: 'Nhà ở', cost_type: 'fixed' },
      { category_id: 'eat2', effective_month: '2026-01-01', name: 'Ăn uống', cost_type: 'variable' }
    ],
    fullTransactions: [
      tx({ category_id: 'rent1', transaction_type: 'expense', amount: 95000, transaction_date: '2026-09-27' }),
      tx({ category_id: 'eat2', transaction_type: 'expense', amount: 40000, transaction_date: '2026-09-15' })
    ],
    cardExpenses: [{ id: 'ce1', card_account_id: 'card1', expense_date: '2026-09-10', amount: 8000 }],
    installments: []
  });
  const fixedTrend = F.categoryTrendData(5, 1, '2026-09');
  const names = fixedTrend.map(r => r.name);
  eq('Chi cố định ("Nhà ở") never appears in Xu hướng theo danh mục', names.includes('Nhà ở'), false);
  eq('Chi biến động ("Ăn uống") still appears', names.includes('Ăn uống'), true);
  eq('Thẻ appears as its own row even though it is not a category transaction', names.includes('Thẻ'), true);
  eq('Thẻ row total matches the card expense (8,000)', fixedTrend.find(r => r.name === 'Thẻ')?.total, 8000);
  eq('Trả góp does NOT appear this month — no installment kỳ was due', names.includes('Trả góp'), false);
}

// ---------------------------------------------------------------------
// Foreign currency: JPY and VND must never be summed 1:1.
// ---------------------------------------------------------------------
{
  resetState({ base: 'JPY', accounts: [acc('bank', 'bank', 'JPY', 100000), acc('vnbank', 'bank', 'VND', 5000000)] });
  eq('A JPY-base household excludes a VND account from Tiền thanh khoản entirely', F.financialPosition().liquid, 100000);
  eq('toVND(JPY) is null with no fx rate on file (never assumes 1:1)', F.toVND(1000, 'JPY'), null);
  resetState({ base: 'JPY', reporting: { show_vnd_conversion: true, jpy_vnd_rate: 168 } });
  eq('toVND(JPY) uses the explicit entered rate once one exists', F.toVND(1000, 'JPY'), 168000);
  const vndPos = F.positionInVND({ liquid: 60, invested: 40, receivables: 10, payables: 20, netWorth: 90 });
  eq('positionInVND multiplies netWorth by the current rate', vndPos.netWorth, 90 * 168);
  eq('positionInVND multiplies liquid by the current rate too', vndPos.liquid, 60 * 168);
  resetState({ base: 'JPY', reporting: { show_vnd_conversion: false, jpy_vnd_rate: null } });
  eq('positionInVND is null with no fx rate on file', F.positionInVND({ liquid: 60, invested: 40, receivables: 10, payables: 20, netWorth: 90 }), null);
}

// ---------------------------------------------------------------------
// A foreign-currency khoản phải trả/thu is excluded from Tổng nợ/Khoản
// phải thu while no quy đổi rate is on file, but folds into the SAME
// total (converted) once a rate exists — it isn't just a cosmetic "≈" on
// the row that never counts, per the household's explicit correction.
// ---------------------------------------------------------------------
{
  resetState({ base: 'JPY', debts: [debt('vnd1', 'payable', 5000000, { currency: 'VND' })], reporting: { show_vnd_conversion: false, jpy_vnd_rate: null } });
  eq('No fx rate on file: a VND payable is excluded from Tổng nợ entirely (not silently wrong, just not convertible yet)', F.totalPayablesAt('9999-12-31'), 0);
  resetState({ base: 'JPY', debts: [debt('vnd1', 'payable', 5000000, { currency: 'VND' })], reporting: { show_vnd_conversion: true, jpy_vnd_rate: 168 } });
  eq('Once a rate is set, the VND payable converts into Tổng nợ (5,000,000 / 168)', F.totalPayablesAt('9999-12-31'), 5000000 / 168);
  resetState({
    base: 'JPY',
    debts: [debt('jpy1', 'payable', 100000), debt('vnd1', 'payable', 5000000, { currency: 'VND' })],
    reporting: { show_vnd_conversion: true, jpy_vnd_rate: 168 }
  });
  eq('A base-currency payable and a converted foreign one sum together in Tổng nợ', F.totalPayablesAt('9999-12-31'), 100000 + 5000000 / 168);
}

// ---------------------------------------------------------------------
// Cơ cấu chi tiêu's legend % must be each slice's share of the composition
// itself (so all slices sum to 100%) — it used to be computed against thu
// nhập instead, which never summed to 100% and made small categories look
// smaller than their real share of spending.
// ---------------------------------------------------------------------
{
  const html = legendHtml([{ label: 'Nhà ở', value: 30 }, { label: 'Ăn uống', value: 70 }]);
  eq('legendHtml % is share of the composition total (30/100=30.0%), not of an outside thu nhập figure', /30\.0%/.test(html), true);
  eq('legendHtml % for the other slice is 70.0% — both slices together sum to exactly 100%', /70\.0%/.test(html), true);
}

// ---------------------------------------------------------------------
// donutSvg labels any slice that's a real share of the pie (>5% of total),
// not a fixed top-N count — so a 4th/5th category can still get a label
// when it clears 5%, and a tiny sliver just under 5% never does. A label
// too long for one line wraps into a second <tspan> line instead of being
// silently truncated.
// ---------------------------------------------------------------------
{
  const svg = donutSvg([
    { label: 'Nhà ở', value: 40 }, { label: 'Ăn uống', value: 25 }, { label: 'Đi lại', value: 20 },
    { label: 'Giải trí', value: 10 }, { label: 'Vặt', value: 4.9 }, { label: 'Khác', value: 0.1 }
  ]);
  eq('donutSvg labels a 4th slice that clears 5% (Giải trí=10%)', svg.includes('Giải trí'), true);
  eq('donutSvg does NOT label a slice just under 5% (Vặt=4.9%)', svg.includes('Vặt'), false);
  const svgLong = donutSvg([{ label: 'Bảo hiểm sức khỏe', value: 100 }]);
  eq('donutSvg wraps a long label into 2 <tspan> lines instead of one overflowing line', (svgLong.match(/<tspan/g) || []).length >= 2, true);
  const fontSizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map(m => Number(m[1]));
  eq('donutSvg gives the single biggest slice (Nhà ở=40%) a bigger font-size than the rest', Math.max(...fontSizes) > Math.min(...fontSizes), true);
  eq('donutSvg biggest-slice font-size is exactly 11, others are 9.5', fontSizes.includes(11) && fontSizes.filter(f => f === 9.5).length === fontSizes.length - 1, true);
}

// ---------------------------------------------------------------------
// trendSvg (Thu nhập vs Chi tiêu) writes just the compact amount (no
// "Thu"/"Chi" prefix — the legend below the chart already says which
// color is which) as two lines under each month's own label, centered on
// that month's own x so it can never bleed into a neighboring month.
// Each month's bars are also clickable — showMonthBarAmounts (act()) pops
// a toast with the exact, non-abbreviated amounts.
// ---------------------------------------------------------------------
{
  eq('compactMoney (JPY) uses 万 (÷10,000, 1 decimal)', compactMoney(495000, 'JPY'), '49.5万');
  eq('compactMoney (VND) abbreviates millions as "tr"', compactMoney(1200000, 'VND'), '1.2tr');
  eq('compactMoney (VND) abbreviates thousands as "k"', compactMoney(30000, 'VND'), '30k');
  resetState({
    base: 'JPY',
    accounts: [acc('ufj', 'bank', 'JPY', 0)],
    categories: [{ id: 'inc1', direction: 'income', cost_type: null, name: 'Lương', is_active: true }],
    fullTransactions: [tx({ category_id: 'inc1', transaction_type: 'income', amount: 495000, transaction_date: '2026-09-05' })]
  });
  const svg = trendSvg(['2026-09']);
  eq('trendSvg writes exactly 2 value lines per month, not vertical in-bar text', (svg.match(/bar-value-line/g) || []).length, 2);
  eq('trendSvg\'s value line shows the month\'s own 万 amount (49.5万), with no "Thu"/"Chi" prefix', svg.includes('>49.5万<') && !svg.includes('Thu 49.5万'), true);
  eq('trendSvg\'s expense line shows 0.0万 with no "Chi" prefix', svg.includes('>0.0万<'), true);
  eq('trendSvg wires each month\'s bars to showMonthBarAmounts via act() (clickable for the exact amount)', svg.includes('data-action="showMonthBarAmounts"') && svg.includes('2026-09'), true);
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
