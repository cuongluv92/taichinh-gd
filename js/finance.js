// ==========================================================================
// Finance calculation engine — the single source of truth for every number
// shown in the app.
//
// Architecture: three fully independent systems, with exactly one automatic
// link between them.
//  - Chi tiêu (Thu nhập / Chi cố định / Chi biến động / Thẻ & trả góp) is a
//    monthly cash-flow REPORT built from `transactions` (income/expense
//    only) plus the card_expenses/installment-schedule ledger. Nợ never
//    appears here — it lives entirely on Tài sản now.
//  - Tài sản holds account balances that are ONLY ever opening_balance ±
//    manual account_adjustments, and debt balances that are ONLY ever
//    opening_amount ± manual debt_adjustments. Nothing in Chi tiêu can
//    change either.
//  - Đầu tư (investments/investment_events) is its own ledger, covering
//    NISA, Chứng khoán, Tiết kiệm sinh lời, and simple/other investments.
//    Its current total value is the ONLY number that flows automatically
//    into Tài sản (the "Tổng đầu tư" line) — the one deliberate exception.
// ==========================================================================
'use strict';

const F = window.F = {};

F.baseTx = t => (t.currency || state.base) === state.base;
F.baseAmount = t => F.baseTx(t) ? n(t.amount) : 0;

F.accountById = id => (state.accounts || []).find(a => a.id === id);
F.activeAccounts = () => (state.accounts || []).filter(a => a.is_active !== false);
F.baseAccounts = () => F.activeAccounts().filter(a => (a.currency || state.base) === state.base);
F.activeCategories = dir => (state.categories || []).filter(c => c && c.is_active !== false && (!dir || c.direction === dir));
F.isExceptional = t => t?.transaction_type === 'expense' && (state.exceptionalIds || []).includes(t.id);

F.categoryOrderValue = c => {
  const raw = c?.sort_order;
  if (raw === null || raw === undefined || raw === '') return Number.MAX_SAFE_INTEGER;
  const v = Number(raw);
  return Number.isFinite(v) ? v : Number.MAX_SAFE_INTEGER;
};
F.orderedCategories = direction => (state.categories || [])
  .filter(c => c && c.is_active !== false && c.direction === direction)
  .map((c, i) => ({ c, i }))
  .sort((a, b) => F.categoryOrderValue(a.c) - F.categoryOrderValue(b.c) || a.i - b.i)
  .map(x => x.c);

// ---------------- Account balances (Tài sản — Tiền mặt & ngân hàng) ----------------
// Balance = opening_balance + manual increases − manual decreases. Every
// account still in `accounts` (cash/bank/savings) is, by construction, a
// non-interest-bearing account now — anything that earns interest lives in
// Đầu tư (kind='savings_interest') instead (spec §3).
F.adjustmentsFor = a => (state.accountAdjustments || []).filter(x => x.account_id === a.id);
F.accountBalanceAt = (a, endDate = '9999-12-31') => {
  let bal = n(a.opening_balance);
  F.adjustmentsFor(a).forEach(x => {
    if (String(x.adjustment_date || '') > endDate) return;
    bal += x.direction === 'increase' ? n(x.amount) : -n(x.amount);
  });
  return bal;
};
F.accountBalance = a => F.accountBalanceAt(a);
F.assetAccounts = () => F.baseAccounts().filter(a => ['cash', 'bank', 'savings'].includes(a.account_type));

// ---------------- Debt ledger (Tài sản — Nợ phải trả / Khoản phải thu) ----------------
// Balance = opening_amount + manual increases − manual decreases, exactly
// like an account. Debt never appears in Chi tiêu or Tổng quan anymore.
F.debts = () => (state.debts || []);
F.debtAdjustmentsFor = d => (state.debtAdjustments || []).filter(x => x.debt_id === d.id);
F.debtBalanceAt = (d, endDate = '9999-12-31') => {
  let bal = n(d.opening_amount);
  F.debtAdjustmentsFor(d).forEach(x => {
    if (String(x.adjustment_date || '') > endDate) return;
    bal += x.direction === 'increase' ? n(x.amount) : -n(x.amount);
  });
  return bal;
};
F.debtBalance = d => F.debtBalanceAt(d);
F.payables = () => F.debts().filter(d => d.direction === 'payable');
F.receivables = () => F.debts().filter(d => d.direction === 'receivable');
// A foreign-currency khoản counts toward the total once a quy đổi rate is
// on file (converted via F.convertToBase) — without a rate it's excluded,
// same as before, since there's nothing to convert it with yet.
F.debtBalanceInBaseAt = (d, endDate) => {
  const bal = F.debtBalanceAt(d, endDate);
  if ((d.currency || state.base) === state.base) return bal;
  return F.convertToBase(bal, d.currency);
};
F.totalPayablesAt = endDate => F.payables().reduce((s, d) => s + (F.debtBalanceInBaseAt(d, endDate) || 0), 0);
F.totalReceivablesAt = endDate => F.receivables().reduce((s, d) => s + (F.debtBalanceInBaseAt(d, endDate) || 0), 0);

// ---------------- Recurring items (Tiền mặt & ngân hàng / Nợ phải trả) ----------------
// Templates for amounts that repeat every month (lương, tiền nhà, wifi...)
// so they don't have to be re-typed each month. `status` (pending/confirmed/
// skipped) for the currently loaded month is computed server-side and comes
// back on each item already — see taichinh_gd_recurring_account_api.
F.recurringItemsFor = (targetType, targetId) => (state.recurringAccountItems || []).filter(x => x.target_type === targetType && x.target_id === targetId);

// ---------------- Investments (Đầu tư) ----------------
// state.investments items carry the server-computed total_contributed /
// total_withdrawn / total_dividends / total_fees / total_interest /
// latest_value / latest_value_date (see taichinh_gd_investment_api 'list'),
// plus the row's own quantity/avg_cost/current_price/realized_pl for
// kind='securities'. state.investmentEvents[id] holds each investment's raw
// event history, fetched separately.
F.investments = () => (state.investments || []);
// A NISA account can hold child quỹ/ETF positions (kind='securities' rows
// with parent_investment_id set to the NISA's id) — the "chế độ chi tiết"
// per-fund tracking, reusing the same buy/sell/avg-cost engine as a
// standalone Chứng khoán. F.investmentsByKind() (used to build the top-level
// Đầu tư sections and the composition chart) always excludes children so
// their value isn't double-counted — it's already folded into the parent
// NISA's rollup below.
F.nisaHoldings = nisaId => F.investments().filter(inv => inv.parent_investment_id === nisaId);
F.investmentsByKind = kind => F.investments().filter(inv => inv.kind === kind && !inv.parent_investment_id);
F.investmentNetCapital = inv => {
  if (inv.kind === 'securities') return n(inv.quantity) * n(inv.avg_cost);
  if (inv.kind === 'nisa') {
    const holdings = F.nisaHoldings(inv.id);
    if (holdings.length) return holdings.reduce((s, h) => s + F.investmentNetCapital(h), 0);
  }
  return n(inv.initial_capital) + n(inv.total_contributed) - n(inv.total_withdrawn);
};
F.investmentCurrentValue = inv => {
  if (inv.kind === 'securities') return n(inv.quantity) * n(inv.current_price ?? inv.avg_cost);
  if (inv.kind === 'nisa') {
    const holdings = F.nisaHoldings(inv.id);
    if (holdings.length) return holdings.reduce((s, h) => s + F.investmentCurrentValue(h), 0);
  }
  // Delegate to the same event-replay formula used for the history chart
  // (F.investmentValueAt with no end-date cutoff) instead of trusting the
  // server's pre-aggregated latest_value directly — a "Cập nhật giá trị" is
  // a snapshot at its own date, not a permanent override, so any
  // contribution/withdrawal/lãi recorded AFTER it must still move the
  // value (otherwise "Thêm vốn"/"Nhận lãi" silently stop doing anything
  // the moment a valuation has ever been entered once).
  return F.investmentValueAt(inv, (state.investmentEvents || {})[inv.id], '9999-12-31');
};
F.investmentPL = inv => {
  if (inv.kind === 'securities') return n(inv.realized_pl) + (F.investmentCurrentValue(inv) - F.investmentNetCapital(inv));
  if (inv.kind === 'nisa') {
    const holdings = F.nisaHoldings(inv.id);
    if (holdings.length) return holdings.reduce((s, h) => s + F.investmentPL(h), 0);
  }
  return F.investmentCurrentValue(inv) - F.investmentNetCapital(inv);
};
F.investmentPLPercent = inv => { const cap = F.investmentNetCapital(inv); return cap > 0 ? F.investmentPL(inv) / cap * 100 : null; };
F.investmentTotalValue = () => F.investments().filter(inv => (inv.currency || state.base) === state.base && !inv.parent_investment_id).reduce((s, inv) => s + F.investmentCurrentValue(inv), 0);
F.investmentValueAt = (inv, events, endDate) => {
  if (inv.kind === 'nisa') {
    const holdings = F.nisaHoldings(inv.id);
    if (holdings.length) return holdings.reduce((s, h) => s + F.investmentValueAt(h, (state.investmentEvents || {})[h.id], endDate), 0);
  }
  const rows = (events || []).filter(e => String(e.event_date || '') <= endDate);
  if (inv.kind === 'securities') {
    let qty = 0, avg = 0;
    rows.filter(e => e.event_type === 'buy' || e.event_type === 'sell').sort((a, b) => String(a.event_date).localeCompare(String(b.event_date))).forEach(e => {
      if (e.event_type === 'buy') { avg = qty + n(e.quantity) > 0 ? (qty * avg + n(e.quantity) * n(e.price)) / (qty + n(e.quantity)) : avg; qty += n(e.quantity); }
      else qty -= n(e.quantity);
    });
    const priceRow = rows.filter(e => e.event_type === 'valuation' && e.price !== null && e.price !== undefined).sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)))[0];
    return Math.max(0, qty) * n(priceRow ? priceRow.price : avg);
  }
  // A "Cập nhật giá trị" is a snapshot at its own date, not a permanent
  // override — any contribution/withdrawal/interest recorded AFTER it must
  // still move the value, or "Thêm vốn" would silently stop doing anything
  // the moment a valuation had ever been entered once.
  const val = rows.filter(e => e.event_type === 'valuation').sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)) || String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
  const after = e => !val || String(e.event_date) > String(val.event_date)
    || (String(e.event_date) === String(val.event_date) && String(e.created_at || '') > String(val.created_at || ''));
  const baseline = val ? n(val.amount) : n(inv.initial_capital);
  const netSinceValuation = rows.filter(e => after(e) && (e.event_type === 'contribution' || e.event_type === 'buy' || e.event_type === 'interest')).reduce((s, e) => s + n(e.amount), 0)
    - rows.filter(e => after(e) && (e.event_type === 'withdrawal' || e.event_type === 'sell')).reduce((s, e) => s + n(e.amount), 0);
  return Math.max(0, baseline + netSinceValuation);
};
F.investmentTotalValueAt = endDate => F.investments().filter(inv => (inv.currency || state.base) === state.base && !inv.parent_investment_id)
  .reduce((s, inv) => s + F.investmentValueAt(inv, (state.investmentEvents || {})[inv.id], endDate), 0);
// Capital ("vốn") reconstructed as of a past date, for the Tài sản history
// chart — same rollup rule as the live formulas above: a NISA with child
// quỹ/ETF sums their capital-at-date instead of its own raw events.
F.investmentCapitalAt = (inv, endDate) => {
  if (inv.kind === 'nisa') {
    const holdings = F.nisaHoldings(inv.id);
    if (holdings.length) return holdings.reduce((s, h) => s + F.investmentCapitalAt(h, endDate), 0);
  }
  const events = (state.investmentEvents || {})[inv.id] || [];
  const upTo = events.filter(e => String(e.event_date || '') <= endDate);
  if (inv.kind === 'securities') {
    let qty = 0, avg = 0;
    upTo.filter(e => e.event_type === 'buy' || e.event_type === 'sell').sort((a, b) => String(a.event_date).localeCompare(String(b.event_date))).forEach(e => {
      if (e.event_type === 'buy') { avg = qty + n(e.quantity) > 0 ? (qty * avg + n(e.quantity) * n(e.price)) / (qty + n(e.quantity)) : avg; qty += n(e.quantity); }
      else qty -= n(e.quantity);
    });
    return Math.max(0, qty) * avg;
  }
  const cap = n(inv.initial_capital)
    + upTo.filter(e => e.event_type === 'contribution' || e.event_type === 'buy').reduce((s2, e) => s2 + n(e.amount), 0)
    - upTo.filter(e => e.event_type === 'withdrawal' || e.event_type === 'sell').reduce((s2, e) => s2 + n(e.amount), 0);
  return Math.max(0, cap);
};

// ---- Growth simulation (Đầu tư §8) — entirely separate from real values.
// "Giá trị dự kiến" is a mô phỏng (simulation) built from the expected
// return rate the user entered; it is never written back into
// giá trị hiện tại/lãi-lỗ thực tế, and only exists when the user opted in
// by setting expected_return_rate.
F.investmentMonthlyRate = inv => {
  if (inv.expected_return_rate === null || inv.expected_return_rate === undefined || inv.expected_return_rate === '') return null;
  const rate = n(inv.expected_return_rate) / 100;
  return inv.expected_return_period === 'monthly' ? rate : Math.pow(1 + rate, 1 / 12) - 1;
};
F.monthsSpan = (from, to) => {
  if (!from || !to) return 0;
  const x = new Date(`${String(from).slice(0, 10)}T00:00:00`), y = new Date(`${String(to).slice(0, 10)}T00:00:00`);
  let m = (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth());
  if (y.getDate() < x.getDate()) m--;
  return Math.max(0, m);
};
F.investmentSimulatedValue = (inv, events, asOf = localToday()) => {
  const mrate = F.investmentMonthlyRate(inv);
  if (mrate === null) return null;
  const anchor = inv.start_date || String(inv.created_at || '').slice(0, 10) || asOf;
  let total = n(inv.initial_capital) * Math.pow(1 + mrate, F.monthsSpan(anchor, asOf));
  (events || []).forEach(e => {
    if (e.event_type === 'contribution' || e.event_type === 'buy') total += n(e.amount) * Math.pow(1 + mrate, F.monthsSpan(e.event_date, asOf));
    else if (e.event_type === 'withdrawal' || e.event_type === 'sell') total -= n(e.amount) * Math.pow(1 + mrate, F.monthsSpan(e.event_date, asOf));
  });
  if (inv.reinvest_mode === 'dividend') total += n(inv.total_dividends);
  return Math.max(0, total);
};

// ---- Monthly contribution plan (NISA + Tiết kiệm sinh lời — §5, §9).
// Distinguishes "kế hoạch góp" from "tiền đã góp thực tế": a pending month
// is never counted as money actually invested until confirmed.
F.investmentPlanStatus = (inv, events, month = state.month) => {
  if (!n(inv.monthly_amount)) return null;
  if (inv.plan_paused) return { status: 'paused' };
  if (inv.plan_start_month && month < monthKey(inv.plan_start_month)) return { status: 'not_started' };
  if (inv.plan_end_month && month > monthKey(inv.plan_end_month)) return { status: 'ended' };
  const confirmed = (events || []).find(e => (e.event_type === 'contribution') && monthKey(e.event_date) === month);
  if (confirmed) return { status: 'confirmed', amount: n(confirmed.amount), eventId: confirmed.id };
  const skipped = (events || []).find(e => e.event_type === 'plan_skip' && monthKey(e.event_date) === month);
  if (skipped) return { status: 'skipped' };
  return { status: 'pending', amount: n(inv.monthly_amount) };
};

// ---------------- Net worth / financial position (Tài sản) ----------------
// Tiền thanh khoản = tiền mặt + tài khoản ngân hàng (no deduction of nợ).
// Tổng đầu tư = tổng giá trị hiện tại của mọi khoản đầu tư (NISA + Chứng
// khoán + Tiết kiệm sinh lời + khác). Tài sản ròng = Tiền thanh khoản +
// Tổng đầu tư + Khoản phải thu + Tài sản khác − Tổng nợ. "Thanh khoản ròng"
// no longer exists. "Tài sản khác" has no data source yet — always 0,
// kept in the formula for forward compatibility.
F.financialPosition = (endDate = '9999-12-31') => {
  const liquid = F.assetAccounts().reduce((s, a) => s + F.accountBalanceAt(a, endDate), 0);
  const invested = endDate === '9999-12-31' ? F.investmentTotalValue() : F.investmentTotalValueAt(endDate);
  const receivables = F.totalReceivablesAt(endDate);
  const payables = F.totalPayablesAt(endDate);
  const otherAssets = 0;
  const netWorth = liquid + invested + receivables + otherAssets - payables;
  return { liquid, invested, receivables, payables, otherAssets, netWorth };
};
F.dataStartMonth = () => {
  const dates = [
    ...(state.accountAdjustments || []).map(x => monthKey(x.adjustment_date)),
    ...(state.debtAdjustments || []).map(x => monthKey(x.adjustment_date)),
    ...(state.transactions || []).map(t => monthKey(t.transaction_date))
  ].filter(Boolean).sort();
  return dates[0] || localMonth();
};
F.trailingMonthKeys = (count = 12) => {
  const end = new Date(`${state.month}-01T00:00:00`), keys = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end); d.setMonth(d.getMonth() - i);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
};
F.yearMonthKeys = year => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
F.assetHistorySeries = monthKeys => {
  const start = F.dataStartMonth();
  return monthKeys.filter(key => key >= start && key <= state.month).map(key => {
    const pos = F.financialPosition(endOfMonthDate(key));
    // Investment capital "as of" a past month — same rollup rule as the live
    // formulas (a NISA with child quỹ/ETF sums their capital, not its own
    // raw events).
    const investedCapital = F.investments().filter(inv => (inv.currency || state.base) === state.base && !inv.parent_investment_id)
      .reduce((s, inv) => s + F.investmentCapitalAt(inv, endOfMonthDate(key)), 0);
    return { month: key, totalAssets: pos.liquid + pos.invested + pos.receivables, totalDebt: pos.payables, netWorth: pos.netWorth, investedCapital, investedValue: pos.invested };
  });
};

// ---------------- Category history (Chi cố định / Chi biến động) ----------------
F.categoryVersionAt = (categoryId, date) => {
  const m = `${monthKey(date)}-01`;
  const versions = (state.categoryVersions || []).filter(v => v.category_id === categoryId && String(v.effective_month).slice(0, 10) <= m)
    .sort((a, b) => String(b.effective_month).localeCompare(String(a.effective_month)));
  return versions[0] || (state.categories || []).find(c => c.id === categoryId) || {};
};
F.expenseKind = t => F.categoryVersionAt(t.category_id, t.transaction_date)?.cost_type || 'variable';
F.categoryActualBase = (id, dir = 'expense') => {
  const rows = (state.transactions || []).filter(t => t.transaction_type === dir && t.category_id === id && F.baseTx(t));
  if (dir !== 'expense') return rows.reduce((s, t) => s + F.baseAmount(t), 0);
  return rows.filter(t => !F.isExceptional(t)).reduce((s, t) => s + F.baseAmount(t), 0);
};
F.periodTransactions = (month = state.month) => (state.fullTransactions || []).filter(t => monthKey(t.transaction_date) === month);
F.expenseByCategory = txs => {
  const map = new Map();
  (txs || []).filter(F.baseTx).forEach(t => {
    if (t.transaction_type === 'expense' && !F.isExceptional(t)) {
      const c = F.categoryVersionAt(t.category_id, t.transaction_date);
      const name = c.name || t.category_name || 'Khác';
      map.set(name, (map.get(name) || 0) + F.baseAmount(t));
    }
  });
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
};
// Chi cố định (Nhà ở, bảo hiểm...) is the same amount every month by
// definition — a "trend" chart for it is just a flat line, not useful.
// Only chi biến động categories move month to month, and Thẻ & trả góp
// (its own ledger, not a category transaction) is just as "biến động" —
// so it gets folded in here as its own synthetic series instead.
F.categoryTrendData = (count = 5, months = 6, month = state.month) => {
  const keys = Array.from({ length: months }, (_, i) => addMonths(month, i - (months - 1)));
  const byId = new Map();
  keys.forEach((k, idx) => {
    F.periodTransactions(k).filter(t => F.baseTx(t) && t.transaction_type === 'expense' && !F.isExceptional(t) && F.expenseKind(t) !== 'fixed').forEach(t => {
      const c = F.categoryVersionAt(t.category_id, t.transaction_date);
      const id = t.category_id || `_${c.name || t.category_name || 'Khác'}`;
      if (!byId.has(id)) byId.set(id, { name: c.name || t.category_name || 'Khác', values: Array(months).fill(0) });
      const entry = byId.get(id);
      entry.values[idx] += F.baseAmount(t);
      entry.name = c.name || t.category_name || entry.name;
    });
  });
  const cardSeries = keys.map(k => F.cardColumnTotalBase(k));
  if (cardSeries.some(v => v > 0)) byId.set('_card', { name: 'Thẻ & trả góp', values: cardSeries });
  return [...byId.entries()]
    .map(([id, v]) => ({ id, name: v.name, total: v.values.reduce((s, x) => s + x, 0), series: keys.map((k, i) => ({ month: k, value: v.values[i] })) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, count);
};
// ---------------- FX (JPY -> VND, manual current rate only) ----------------
F.fxRate = () => { const r = n(state.reporting?.jpy_vnd_rate); return r > 0 ? r : null; };
F.toVND = (amount, currency) => {
  if (currency === 'VND') return n(amount);
  if (currency === 'JPY') { const r = F.fxRate(); return r ? n(amount) * r : null; }
  return null;
};
// Generic other-currency -> household's base currency, using the same
// "1 JPY ≈ rate VND" rate on file. null when no rate is set yet (never
// assumes 1:1) or the pair isn't JPY/VND.
F.convertToBase = (amount, currency) => {
  if ((currency || state.base) === state.base) return n(amount);
  const r = F.fxRate();
  if (!r) return null;
  if (state.base === 'JPY' && currency === 'VND') return n(amount) / r;
  if (state.base === 'VND' && currency === 'JPY') return n(amount) * r;
  return null;
};
F.positionInVND = pos => {
  if (state.base === 'VND') return pos;
  const r = F.fxRate();
  if (!r) return null;
  return { liquid: pos.liquid * r, invested: pos.invested * r, receivables: pos.receivables * r, payables: pos.payables * r, netWorth: pos.netWorth * r };
};

// ---------------- Credit cards / Thẻ & trả góp (own ledger, no accounts link) ----------------
F.cardAccounts = () => F.activeAccounts().filter(a => a.account_type === 'credit');
F.cardExpensesFor = cardId => (state.cardExpenses || []).filter(x => x.card_account_id === cardId);
F.installmentsFor = cardId => (state.installments || []).filter(x => x.card_account_id === cardId);
F.cardExpenseMonthTotal = (cardId, month = state.month) => F.cardExpensesFor(cardId)
  .filter(x => monthKey(x.expense_date) === month).reduce((s, x) => s + n(x.amount), 0);
F.installmentMonthDue = (cardId, month = state.month) => F.installmentsFor(cardId)
  .reduce((s, inst) => s + (inst.schedule || []).filter(row => monthKey(row.payment_month) === month).reduce((s2, row) => s2 + n(row.principal_amount) + n(row.fee_amount), 0), 0);
F.cardColumnMonthTotal = (cardId, month = state.month) => F.cardExpenseMonthTotal(cardId, month) + F.installmentMonthDue(cardId, month);
F.cardColumnTotalBase = (month = state.month) => F.cardAccounts()
  .filter(c => (c.currency || state.base) === state.base)
  .reduce((s, c) => s + F.cardColumnMonthTotal(c.id, month), 0);

// ---------------- Monthly stats (Tổng quan / Chi tiêu) ----------------
// Month-only, cash-basis-of-record report. Never reads accounts, never
// reads investments, never reads debt — "Không lấy bất kỳ số nào từ trang
// Tài sản" and "Nợ không được tính vào Tổng chi tiêu tháng".
F.statsFor = (month = state.month) => {
  const rows = F.periodTransactions(month).filter(F.baseTx);
  let income = 0, fixed = 0, variable = 0, exceptional = 0;
  rows.forEach(t => {
    const amt = F.baseAmount(t);
    if (t.transaction_type === 'income') income += amt;
    else if (t.transaction_type === 'expense') {
      if (F.isExceptional(t)) exceptional += amt;
      else (F.expenseKind(t) === 'fixed' ? fixed += amt : variable += amt);
    }
  });
  const card = F.cardColumnTotalBase(month);
  const expense = fixed + variable + card;
  return { income, fixed, variable, exceptional, card, expense, remaining: income - expense };
};

// ---------------- Charts ----------------
const CHART_COLORS = ['#f5a623', '#30d17f', '#5aa9e6', '#c67af0', '#f25c66', '#3fd2c7', '#8b93a1', '#e6a5c1', '#e2c94f', '#8fd15e'];
// Solid pie (not a ring) with CAD-style leader lines pointing out from each
// lát cắt to its own name, instead of making someone match a color dot in
// a separate legend back to a slice by eye. Labels for slices on the right
// half stack top-to-bottom on the right, left-half slices stack on the
// left — same "external label" convention most pie-chart tools use.
function donutSvg(items) {
  const clean = items.filter(x => n(x.value) > 0);
  const total = clean.reduce((s, x) => s + n(x.value), 0);
  if (!total) return `<div class="empty compact">Chưa có dữ liệu</div>`;
  const trim = label => label.length > 15 ? label.slice(0, 14) + '…' : label;
  const cx = 170, cy = 95, r = 52;
  const pointAt = (theta, radius) => [cx + radius * Math.sin(theta), cy - radius * Math.cos(theta)];
  let cum = 0;
  const slices = clean.map((x, i) => {
    const frac = n(x.value) / total;
    const startA = cum * 2 * Math.PI, endA = (cum + frac) * 2 * Math.PI, midA = (cum + frac / 2) * 2 * Math.PI;
    cum += frac;
    const [sx, sy] = pointAt(startA, r), [ex, ey] = pointAt(endA, r);
    const large = frac > 0.5 ? 1 : 0;
    const path = `M${cx},${cy} L${sx.toFixed(2)},${sy.toFixed(2)} A${r},${r} 0 ${large} 1 ${ex.toFixed(2)},${ey.toFixed(2)} Z`;
    return { path, color: CHART_COLORS[i % CHART_COLORS.length], midA, label: x.label };
  });
  const right = slices.filter(s => Math.sin(s.midA) >= 0).sort((a, b) => a.midA - b.midA);
  const left = slices.filter(s => Math.sin(s.midA) < 0).sort((a, b) => a.midA - b.midA);
  const top = 14, bottom = 176;
  const slotY = (arr, idx) => arr.length <= 1 ? (top + bottom) / 2 : top + (bottom - top) * idx / (arr.length - 1);
  const leaders = [];
  right.forEach((s, idx) => {
    const [ex, ey] = pointAt(s.midA, r + 3);
    const ly = slotY(right, idx), lx = 258;
    leaders.push(`<polyline points="${ex.toFixed(1)},${ey.toFixed(1)} ${(lx - 16).toFixed(1)},${ly.toFixed(1)} ${lx.toFixed(1)},${ly.toFixed(1)}" fill="none" stroke="${s.color}" stroke-width="1.2"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="2" fill="${s.color}"/><text x="${(lx + 4).toFixed(1)}" y="${(ly + 3).toFixed(1)}" font-size="9.5" fill="var(--text-dim)">${esc(trim(s.label))}</text>`);
  });
  left.forEach((s, idx) => {
    const [ex, ey] = pointAt(s.midA, r + 3);
    const ly = slotY(left, idx), lx = 82;
    leaders.push(`<polyline points="${ex.toFixed(1)},${ey.toFixed(1)} ${(lx + 16).toFixed(1)},${ly.toFixed(1)} ${lx.toFixed(1)},${ly.toFixed(1)}" fill="none" stroke="${s.color}" stroke-width="1.2"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="2" fill="${s.color}"/><text x="${(lx - 4).toFixed(1)}" y="${(ly + 3).toFixed(1)}" font-size="9.5" text-anchor="end" fill="var(--text-dim)">${esc(trim(s.label))}</text>`);
  });
  const wedgePaths = slices.map(s => `<path d="${s.path}" fill="${s.color}" stroke="var(--panel)" stroke-width="1.5"/>`).join('');
  return `<div class="donut-wrap"><svg viewBox="0 0 340 190" width="340" height="190" role="img" aria-label="Biểu đồ tròn">${wedgePaths}${leaders.join('')}</svg></div>`;
}
// First % is always share-of-the-donut (items sum to 100%), matching what
// the donut itself visually draws — it used to be computed against thu
// nhập instead, which never added up to 100% across slices. Passing
// incomeBasis adds a SECOND, separate % column (share of thu nhập tháng)
// alongside it — two different questions ("how much of my spending is
// this" vs "how much of my income is this"), not one blended number.
function legendHtml(items, incomeBasis = null) {
  const total = items.reduce((s, x) => s + n(x.value), 0);
  const head = incomeBasis != null ? `<div class="chart-legend-head"><span class="legend-label"></span><span class="legend-pct">% Chi</span><span class="legend-pct">% Thu</span></div>` : '';
  const rows = items.filter(x => n(x.value) > 0).map((x, i) => {
    const pctExpense = total > 0 ? pctText(x.value, total) : '';
    const pctIncome = incomeBasis == null ? '' : `<small class="legend-pct">${incomeBasis > 0 ? pctText(x.value, incomeBasis) : '—'}</small>`;
    return `<div><span class="legend-label"><i class="legend-dot legend-c${i % 10}"></i>${esc(x.label)}</span><strong>${money(x.value)}</strong><small class="legend-pct">${pctExpense}</small>${pctIncome}</div>`;
  }).join('');
  return `<div class="chart-legend">${head}${rows}</div>`;
}
function sparklineSvg(data, w = 108, h = 28, sharedMax = 0) {
  const max = Math.max(1, sharedMax, ...data.map(x => n(x.value)));
  const slot = w / data.length, bw = Math.max(1, slot - 2);
  const bars = data.map((x, i) => {
    const bh = Math.max(1, (h - 2) * n(x.value) / max);
    return `<rect x="${(i * slot).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5"><title>${esc(x.month)}: ${money(x.value)}</title></rect>`;
  }).join('');
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Xu hướng">${bars}</svg>`;
}
function trendSvg(keys = Array.from({ length: 12 }, (_, i) => addMonths(state.month, i - 11))) {
  const data = keys.map(k => { const s = F.statsFor(k); return { k, inc: s.income, exp: s.expense }; });
  const W = 720, H = 150, pad = 26, max = Math.max(1, ...data.flatMap(x => [x.inc, x.exp])), group = (W - pad * 2) / keys.length, bw = 12;
  const grid = [0, 1, 2, 3].map(i => { const y = pad + (H - pad * 2) * i / 3; return `<line class="v-gridline" x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}"/>`; }).join('');
  const bars = data.map((x, i) => {
    const cx = pad + group * i + group / 2, ih = (H - pad * 2) * x.inc / max, eh = (H - pad * 2) * x.exp / max;
    return `<g><title>${x.k}: Thu ${money(x.inc)} · Chi ${money(x.exp)}</title><rect class="bar-income" x="${cx - bw - 2}" y="${H - pad - ih}" width="${bw}" height="${ih}" rx="3"/><rect class="bar-expense" x="${cx + 2}" y="${H - pad - eh}" width="${bw}" height="${eh}" rx="3"/><text class="axis-label" x="${cx}" y="${H - 8}" text-anchor="middle">${x.k.slice(5)}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Thu chi 12 tháng">${grid}${bars}</svg><div class="legend"><span><i class="swatch-positive"></i>Thu nhập</span><span><i class="swatch-negative"></i>Chi tiêu</span></div>`;
}
// Splits a label into at most 2 horizontal lines at a word boundary near
// maxChars, instead of shrinking/rotating it — greedily fills line 1, the
// rest (if any) goes on line 2.
function wrapLabel(label, maxChars = 10) {
  const words = String(label).split(' ');
  let line1 = '', line2 = '';
  for (const w of words) {
    if (!line1 || (line1 + ' ' + w).trim().length <= maxChars) line1 = (line1 + ' ' + w).trim();
    else line2 = (line2 + ' ' + w).trim();
  }
  return line2 ? [line1, line2] : [line1];
}
// Vertical bar chart — used for Tài sản's composition chart (§11). Negative
// values (Tổng nợ) render downward from the zero baseline in red.
function barChartSvg(items, w = 720, h = 190) {
  const clean = items.filter(x => n(x.value) !== 0);
  if (!clean.length) return '<div class="empty compact">Chưa có dữ liệu</div>';
  // Bottom padding leaves room for a 2-line wrapped label (e.g. "Tiết kiệm" /
  // "sinh lời") instead of crowding a long name into one line or rotating it.
  const padTop = 20, padBottom = 40, max = Math.max(1, ...items.map(x => n(x.value))), min = Math.min(0, ...items.map(x => n(x.value)));
  const span = Math.max(1, max - min);
  const zeroY = padTop + (h - padTop - padBottom) * max / span;
  const slot = (w - 40) / items.length, bw = Math.max(6, slot * 0.55);
  const bars = items.map((x, i) => {
    const val = n(x.value), barH = Math.abs(val) / span * (h - padTop - padBottom);
    const cx = 20 + slot * i + slot / 2;
    const y = val >= 0 ? zeroY - barH : zeroY;
    const lines = wrapLabel(x.label, Math.max(8, Math.floor(slot / 5.5)));
    const label = lines.length > 1
      ? `<text class="axis-label" x="${cx}" y="${h - padBottom + 14}" text-anchor="middle"><tspan x="${cx}">${esc(lines[0])}</tspan><tspan x="${cx}" dy="13">${esc(lines[1])}</tspan></text>`
      : `<text class="axis-label" x="${cx}" y="${h - padBottom + 20}" text-anchor="middle">${esc(lines[0])}</text>`;
    return `<g><rect x="${(cx - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, barH).toFixed(1)}" rx="3" fill="${val >= 0 ? CHART_COLORS[i % CHART_COLORS.length] : 'var(--negative, #f25c66)'}"><title>${esc(x.label)}: ${money(val)}</title></rect>${label}</g>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Cơ cấu tài sản"><line class="v-gridline" x1="20" y1="${zeroY}" x2="${w - 20}" y2="${zeroY}"/>${bars}</svg>`;
}
// Multi-line chart — Tài sản's monthly history (§11): Tổng tài sản, Tổng nợ,
// Tài sản ròng, Tổng vốn đầu tư, Tổng giá trị đầu tư hiện tại.
function multiLineSvg(rows, series) {
  const W = 720, H = 190, p = 30;
  if (!rows.length) return '<div class="empty compact">Chưa có dữ liệu</div>';
  const allVals = rows.flatMap(r => series.map(s => n(r[s.key])));
  const min = Math.min(0, ...allVals), max = Math.max(0, ...allVals), span = Math.max(1, max - min);
  const xAt = i => p + (W - p * 2) * (rows.length === 1 ? 0 : i / (rows.length - 1));
  const yAt = v => H - p - (H - p * 2) * (v - min) / span;
  const grid = [0, 1, 2, 3].map(i => { const y = p + (H - p * 2) * i / 3; return `<line class="v-gridline" x1="${p}" y1="${y}" x2="${W - p}" y2="${y}"/>`; }).join('');
  // A lone data point (a household's first month of data) would otherwise
  // render nothing at all — a path with just one "M" and no line segment
  // draws invisibly — so every point also gets a small filled dot.
  const lines = series.map(s => {
    const pts = rows.map((r, i) => ({ x: xAt(i), y: yAt(n(r[s.key])) }));
    const path = pts.map((q, i) => `${i ? 'L' : 'M'} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ');
    const dots = pts.map(q => `<circle cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="3" fill="${s.color}"/>`).join('');
    return `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.5"><title>${esc(s.label)}</title></path>${dots}`;
  }).join('');
  const labels = rows.map((r, i) => i % 2 === 0 ? `<text class="axis-label" x="${xAt(i)}" y="${H - 8}" text-anchor="middle">${r.month.slice(5)}</text>` : '').join('');
  const legend = `<div class="chart-legend">${series.map((s, i) => { const ci = CHART_COLORS.indexOf(s.color); return `<div><span><i class="legend-dot legend-c${ci >= 0 ? ci : i % 10}"></i>${esc(s.label)}</span></div>`; }).join('')}</div>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Lịch sử tài sản theo tháng">${grid}${lines}${labels}</svg>${legend}`;
}
Object.assign(window, { CHART_COLORS, donutSvg, legendHtml, sparklineSvg, trendSvg, barChartSvg, multiLineSvg });
