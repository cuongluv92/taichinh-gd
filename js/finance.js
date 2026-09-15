// ==========================================================================
// Finance calculation engine — the single source of truth for every number
// shown in the app.
//
// Architecture (see the handoff notes for the full rationale): three fully
// independent systems, with exactly one automatic link between them.
//  - Chi tiêu (Thu nhập / Chi cố định / Chi biến động / Thẻ & trả góp / Nợ)
//    is a monthly cash-flow REPORT built from `transactions` (income/expense
//    only now — no transfers) plus the card_expenses/installment-schedule
//    ledger plus loans. None of it ever touches an account balance.
//  - Tài sản (accounts) holds a balance that is ONLY ever
//    opening_balance ± manual account_adjustments rows. Nothing in Chi tiêu
//    can change it.
//  - Đầu tư (investments/investment_events) is its own ledger. Its current
//    total value is the ONLY number that flows automatically into Tài sản
//    (the "Đang đầu tư" line) — the one deliberate exception.
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

// ---------------- Account balances (Tài sản) ----------------
// Balance = opening_balance + manual increases − manual decreases. Nothing
// else — no transaction of any kind (income/expense/loan/...) ever counts
// here. `endDate` support exists only for the Tài sản net-worth history
// chart, which needs a point-in-time balance.
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

// ---------------- Investments (Đầu tư) ----------------
// state.investments items already carry the server-computed
// total_contributed / total_withdrawn / latest_value / latest_value_date
// (see taichinh_gd_investment_api 'list'). state.investmentEvents[id] holds
// each investment's raw event history, fetched separately, used only for
// the historical net-worth chart below (a point-in-time value needs the
// event list, not just today's totals).
F.investments = () => (state.investments || []);
F.investmentNetCapital = inv => n(inv.initial_capital) + n(inv.total_contributed) - n(inv.total_withdrawn);
F.investmentCurrentValue = inv => inv.latest_value !== null && inv.latest_value !== undefined ? n(inv.latest_value) : Math.max(0, F.investmentNetCapital(inv));
F.investmentPL = inv => F.investmentCurrentValue(inv) - F.investmentNetCapital(inv);
F.investmentPLPercent = inv => { const cap = F.investmentNetCapital(inv); return cap > 0 ? F.investmentPL(inv) / cap * 100 : null; };
F.investmentTotalValue = () => F.investments().filter(inv => (inv.currency || state.base) === state.base).reduce((s, inv) => s + F.investmentCurrentValue(inv), 0);
F.investmentValueAt = (inv, events, endDate) => {
  const rows = (events || []).filter(e => String(e.event_date || '') <= endDate);
  const val = rows.filter(e => e.event_type === 'valuation').sort((a, b) => String(b.event_date).localeCompare(String(a.event_date)) || String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
  if (val) return n(val.amount);
  const netCap = n(inv.initial_capital)
    + rows.filter(e => e.event_type === 'contribution').reduce((s, e) => s + n(e.amount), 0)
    - rows.filter(e => e.event_type === 'withdrawal').reduce((s, e) => s + n(e.amount), 0);
  return Math.max(0, netCap);
};
F.investmentTotalValueAt = endDate => F.investments().filter(inv => (inv.currency || state.base) === state.base)
  .reduce((s, inv) => s + F.investmentValueAt(inv, (state.investmentEvents || {})[inv.id], endDate), 0);

// ---------------- Net worth / financial position (Tài sản) ----------------
// Only cash/bank/savings carry a manual balance here — credit accounts are
// just a card identity (Thẻ & trả góp), never a Tài sản balance, and
// investment accounts don't exist anymore (investments live in F.investments()).
F.assetAccounts = () => F.baseAccounts().filter(a => ['cash', 'bank', 'savings'].includes(a.account_type));
F.financialPosition = (endDate = '9999-12-31') => {
  let accountAssets = 0, accountLiabilities = 0, liquid = 0;
  F.assetAccounts().forEach(a => {
    const bal = F.accountBalanceAt(a, endDate);
    if (bal >= 0) accountAssets += bal; else accountLiabilities += -bal;
    const countsAsLiquid = a.account_type === 'cash' || a.account_type === 'bank' || (a.account_type === 'savings' && a.is_liquid !== false);
    if (countsAsLiquid) liquid += Math.max(0, bal);
  });
  const receivables = (state.loans || []).filter(l => l.loan_type === 'lent' && (l.currency || state.base) === state.base).reduce((s, l) => s + F.historicalLoanRemaining(l, endDate), 0);
  const borrowed = (state.loans || []).filter(l => l.loan_type === 'borrowed' && (l.currency || state.base) === state.base).reduce((s, l) => s + F.historicalLoanRemaining(l, endDate), 0);
  // "Today" uses the same precomputed total the Đầu tư tab shows (the one
  // deliberate automatic link — spec requires them to always agree);
  // a past endDate reconstructs the value from raw events instead, since
  // there is no "latest_value as of that date" field to read.
  const invested = endDate === '9999-12-31' ? F.investmentTotalValue() : F.investmentTotalValueAt(endDate);
  const totalAssets = accountAssets + receivables + invested;
  const totalLiabilities = accountLiabilities + borrowed;
  // liquidNet excludes invested on purpose — Đầu tư counts in Tài sản ròng
  // but never in Tiền thanh khoản (spec section 7).
  const liquidNet = liquid - borrowed;
  return { accountAssets, accountLiabilities, receivables, borrowed, totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities, liquid, liquidNet, invested };
};
F.dataStartMonth = () => {
  const dates = [
    ...(state.accountAdjustments || []).map(x => monthKey(x.adjustment_date)),
    ...(state.transactions || []).map(t => monthKey(t.transaction_date))
  ].filter(Boolean).sort();
  return dates[0] || localMonth();
};
F.netWorthSeries = (count = 12) => {
  const end = new Date(`${state.month}-01T00:00:00`), rows = [], start = F.dataStartMonth();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end); d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (key < start) continue;
    rows.push({ month: key, value: F.financialPosition(endOfMonthDate(key)).netWorth });
  }
  return rows;
};

// ---------------- Loans (unchanged — informational only, no account link) ----------------
F.historicalLoanRemaining = (l, endDate) => {
  if (l.start_date && String(l.start_date).slice(0, 10) > endDate) return 0;
  const paymentType = l.loan_type === 'borrowed' ? 'loan_pay' : 'loan_collect';
  const paidAfter = (state.fullTransactions || [])
    .filter(t => t.loan_id === l.id && t.transaction_type === paymentType && String(t.transaction_date || '') > endDate)
    .reduce((s, t) => s + n(t.amount), 0);
  return Math.min(n(l.principal), n(l.remaining_amount) + paidAfter);
};
F.loanTerms = id => (state.loanTerms || []).find(x => x.loan_id === id) || null;
F.isBankLoan = l => !!l && F.loanTerms(l.id)?.loan_kind === 'bank';
F.monthsBetween = (a, b) => {
  if (!a || !b) return 0;
  const x = new Date(`${String(a).slice(0, 10)}T00:00:00`), y = new Date(`${String(b).slice(0, 10)}T00:00:00`);
  let m = (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth());
  if (y.getDate() < x.getDate()) m--;
  return Math.max(0, m);
};
F.annuityPayment = (principal, annualRate, months) => {
  principal = n(principal); months = Math.max(0, Math.trunc(n(months)));
  const r = n(annualRate) / 100 / 12;
  if (principal <= 0 || months <= 0) return 0;
  if (Math.abs(r) < 1e-12) return principal / months;
  return principal * r / (1 - Math.pow(1 + r, -months));
};
F.bankEstimate = (l, date = localToday()) => {
  const t = F.loanTerms(l?.id);
  if (!l || !t) return { principal: 0, interest: 0, total: 0, remainingMonths: null };
  const remaining = clamp0(l.remaining_amount), annual = n(t.annual_rate), r = annual / 100 / 12;
  const elapsed = F.monthsBetween(l.start_date, date), term = n(t.term_months) || 0;
  const remainingMonths = term ? Math.max(1, term - elapsed) : null;
  const interest = Math.max(0, remaining * r);
  let principal = 0, total = interest;
  if (t.repayment_method === 'equal_payment' && remainingMonths) {
    total = F.annuityPayment(remaining, annual, remainingMonths);
    principal = clamp0(Math.min(remaining, total - interest));
  } else if (t.repayment_method === 'equal_principal' && term) {
    principal = Math.min(remaining, n(l.principal) / term);
    total = principal + interest;
  }
  return { principal, interest, total, remainingMonths };
};
F.loanMonthDue = (l, month = state.month) => {
  const rows = (state.fullTransactions || []).filter(t => t.loan_id === l.id && monthKey(t.transaction_date) === month);
  const principal = rows.filter(t => t.transaction_type === 'loan_pay').reduce((s, t) => s + n(t.amount), 0);
  const interest = rows.filter(t => t.transaction_type === 'loan_interest').reduce((s, t) => s + n(t.amount), 0);
  const paidAmount = principal + interest;
  if (paidAmount > 0) return { amount: paidAmount, note: 'Đã trả tháng này', paid: true };
  if (monthKey(l.due_date) === month) return { amount: n(l.remaining_amount), note: 'Đến hạn trong tháng này', paid: false };
  if (F.isBankLoan(l)) {
    const est = F.bankEstimate(l, endOfMonthDate(month));
    if (n(est.total) > 0) return { amount: n(est.total), note: 'Dự kiến kỳ này', paid: false };
  }
  return { amount: 0, note: `Dư nợ ${money(l.remaining_amount, l.currency || state.base)}`, paid: false };
};
F.debtMonthTotalBase = (month = state.month) => (state.loans || [])
  .filter(l => l.loan_type === 'borrowed' && n(l.remaining_amount) > 0 && (l.currency || state.base) === state.base)
  .reduce((s, l) => s + n(F.loanMonthDue(l, month).amount), 0);
F.upcomingDue = (month = state.month) => {
  const items = [];
  (state.loans || []).filter(l => l.loan_type === 'borrowed' && n(l.remaining_amount) > 0).forEach(l => {
    const due = F.loanMonthDue(l, month);
    if (n(due.amount) > 0 && !due.paid) {
      items.push({ kind: 'loan', id: l.id, label: l.counterparty, amount: due.amount, currency: l.currency || state.base, note: due.note, date: monthKey(l.due_date) === month ? l.due_date : null });
    }
  });
  return items.sort((a, b) => String(a.date || '9999-99-99').localeCompare(String(b.date || '9999-99-99')));
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
    } else if (t.transaction_type === 'loan_interest') {
      map.set('Lãi / phí vay', (map.get('Lãi / phí vay') || 0) + F.baseAmount(t));
    }
  });
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
};
F.categoryTrendData = (count = 5, months = 6, month = state.month) => {
  const keys = Array.from({ length: months }, (_, i) => addMonths(month, i - (months - 1)));
  const byId = new Map();
  keys.forEach((k, idx) => {
    F.periodTransactions(k).filter(t => F.baseTx(t) && t.transaction_type === 'expense' && !F.isExceptional(t)).forEach(t => {
      const c = F.categoryVersionAt(t.category_id, t.transaction_date);
      const id = t.category_id || `_${c.name || t.category_name || 'Khác'}`;
      if (!byId.has(id)) byId.set(id, { name: c.name || t.category_name || 'Khác', values: Array(months).fill(0) });
      const entry = byId.get(id);
      entry.values[idx] += F.baseAmount(t);
      entry.name = c.name || t.category_name || entry.name;
    });
  });
  return [...byId.entries()]
    .map(([id, v]) => ({ id, name: v.name, total: v.values.reduce((s, x) => s + x, 0), series: keys.map((k, i) => ({ month: k, value: v.values[i] })) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, count);
};
// Which category moved the most between two months, up or down (for the
// "nhóm/danh mục nào tăng/giảm nhiều nhất" analytic).
F.biggestCategoryMover = (month = state.month, prevMonth = addMonths(month, -1)) => {
  const cur = new Map(F.expenseByCategory(F.periodTransactions(month)).map(x => [x.label, x.value]));
  const prev = new Map(F.expenseByCategory(F.periodTransactions(prevMonth)).map(x => [x.label, x.value]));
  const names = new Set([...cur.keys(), ...prev.keys()]);
  let best = null;
  names.forEach(name => {
    const diff = (cur.get(name) || 0) - (prev.get(name) || 0);
    if (!best || Math.abs(diff) > Math.abs(best.diff)) best = { name, diff, current: cur.get(name) || 0, previous: prev.get(name) || 0 };
  });
  return best;
};

// ---------------- FX (JPY -> VND, manual current rate only) ----------------
F.fxRate = () => { const r = n(state.reporting?.jpy_vnd_rate); return r > 0 ? r : null; };
F.toVND = (amount, currency) => {
  if (currency === 'VND') return n(amount);
  if (currency === 'JPY') { const r = F.fxRate(); return r ? n(amount) * r : null; }
  return null;
};
F.positionInVND = pos => {
  if (state.base === 'VND') return pos;
  const r = F.fxRate();
  if (!r) return null;
  return {
    totalAssets: pos.totalAssets * r, totalLiabilities: pos.totalLiabilities * r,
    netWorth: pos.netWorth * r, liquid: pos.liquid * r, liquidNet: pos.liquidNet * r, invested: pos.invested * r
  };
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
// reads investments — "Không lấy bất kỳ số nào từ trang Tài sản" (spec §2).
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
  const debt = F.debtMonthTotalBase(month);
  const expense = fixed + variable + card + debt;
  return { income, fixed, variable, exceptional, card, debt, expense, remaining: income - expense };
};

// ---------------- Charts ----------------
const CHART_COLORS = ['#f5a623', '#30d17f', '#5aa9e6', '#c67af0', '#f25c66', '#3fd2c7', '#8b93a1', '#e6a5c1', '#e2c94f', '#8fd15e'];
function donutSvg(items, size = 168, thickness = 22) {
  const clean = items.filter(x => n(x.value) > 0);
  const total = clean.reduce((s, x) => s + n(x.value), 0);
  const r = 58, c = 2 * Math.PI * r;
  if (!total) return `<div class="empty compact">Chưa có dữ liệu</div>`;
  let offset = 0;
  const circles = clean.map((x, i) => {
    const len = c * n(x.value) / total;
    const el = `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${CHART_COLORS[i % CHART_COLORS.length]}" stroke-width="${thickness}" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)"/>`;
    offset += len; return el;
  }).join('');
  return `<div class="donut-wrap"><svg viewBox="0 0 160 160" width="${size}" height="${size}" role="img" aria-label="Biểu đồ tròn"><circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--panel-3)" stroke-width="${thickness}"/>${circles}</svg></div>`;
}
function legendHtml(items, mode = 'value', income = 0) {
  return `<div class="chart-legend">${items.filter(x => n(x.value) > 0).map((x, i) => `<div><span><i class="legend-dot legend-c${i % 10}"></i>${esc(x.label)}</span><strong>${money(x.value)}${mode === 'income' && income > 0 ? `<small>${pctText(x.value, income)}</small>` : ''}</strong></div>`).join('')}</div>`;
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
function trendSvg() {
  const keys = Array.from({ length: 12 }, (_, i) => addMonths(state.month, i - 11));
  const data = keys.map(k => { const s = F.statsFor(k); return { k, inc: s.income, exp: s.expense }; });
  const W = 720, H = 230, pad = 30, max = Math.max(1, ...data.flatMap(x => [x.inc, x.exp])), group = (W - pad * 2) / 12, bw = 12;
  const grid = [0, 1, 2, 3].map(i => { const y = pad + (H - pad * 2) * i / 3; return `<line class="v-gridline" x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}"/>`; }).join('');
  const bars = data.map((x, i) => {
    const cx = pad + group * i + group / 2, ih = (H - pad * 2) * x.inc / max, eh = (H - pad * 2) * x.exp / max;
    return `<g><title>${x.k}: Thu ${money(x.inc)} · Chi ${money(x.exp)}</title><rect class="bar-income" x="${cx - bw - 2}" y="${H - pad - ih}" width="${bw}" height="${ih}" rx="3"/><rect class="bar-expense" x="${cx + 2}" y="${H - pad - eh}" width="${bw}" height="${eh}" rx="3"/><text class="axis-label" x="${cx}" y="${H - 8}" text-anchor="middle">${x.k.slice(5)}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Thu chi 12 tháng">${grid}${bars}</svg><div class="legend"><span><i class="swatch-positive"></i>Thu nhập</span><span><i class="swatch-negative"></i>Chi tiêu</span></div>`;
}
function netWorthLine(rows) {
  const W = 720, H = 220, p = 30;
  if (!rows.length) return '<div class="empty compact">Chưa có dữ liệu</div>';
  const vals = rows.map(x => x.value), min = Math.min(...vals, 0), max = Math.max(...vals, 0), span = Math.max(1, max - min);
  const pts = rows.map((x, i) => { const px = p + (W - p * 2) * (rows.length === 1 ? 0 : i / (rows.length - 1)); const py = H - p - (H - p * 2) * (x.value - min) / span; return { x: px, y: py, ...x }; });
  const path = pts.map((q, i) => `${i ? 'L' : 'M'} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tài sản ròng 12 tháng">${[0, 1, 2, 3].map(i => { const y = p + (H - p * 2) * i / 3; return `<line class="v-gridline" x1="${p}" y1="${y}" x2="${W - p}" y2="${y}"/>`; }).join('')}<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>${pts.map((q, i) => `<circle cx="${q.x}" cy="${q.y}" r="3.5" fill="var(--accent)"><title>${q.month}: ${money(q.value)}</title></circle>${i % 2 === 0 ? `<text class="axis-label" x="${q.x}" y="${H - 8}" text-anchor="middle">${q.month.slice(5)}</text>` : ''}`).join('')}</svg>`;
}
Object.assign(window, { CHART_COLORS, donutSvg, legendHtml, sparklineSvg, trendSvg, netWorthLine });
