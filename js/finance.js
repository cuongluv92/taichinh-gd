// ==========================================================================
// Finance calculation engine — the single source of truth for every number
// shown in the app. Consolidates what used to be spread across and patched
// by core.js / v3-core.js / finance-v4..v7.js / exceptional.js / fx-history.js.
//
// Accounting rules encoded here (see AUDIT.md for the verification cases):
//  - Credit card purchases post as `expense` at purchase date; paying the
//    statement is a `transfer` (bank -> card), never counted as spend again.
//  - Loan/debt principal repayment is `loan_pay` (reduces liabilities, is
//    NOT consumption expense); interest/fees are `loan_interest` (IS expense).
//  - Savings/investment contributions are `transfer`/`goal_save`/`goal_withdraw`
//    between real accounts — asset reallocation, never household expense.
//  - Net worth = (assets in accounts, base currency) + (receivables)
//                - (liabilities in accounts, incl. negative/credit balances)
//                - (loans payable).
//  - Foreign currency is never summed 1:1; a VND total only appears when the
//    user turns it on in Settings and enters a JPY->VND rate, and even then
//    only as a display-only conversion of today's numbers.
// ==========================================================================
'use strict';

const F = window.F = {};

F.TRANSFER_TYPES = new Set(['transfer', 'goal_save', 'goal_withdraw']);
F.POSITIVE_TYPES = new Set(['income', 'loan_borrow', 'loan_collect', 'loan_repayment', 'investment_gain']);
F.NEGATIVE_TYPES = new Set(['expense', 'transfer', 'loan_lend', 'loan_out', 'loan_pay', 'goal_save', 'goal_withdraw', 'investment_loss', 'loan_interest']);
F.DEBT_TYPES = new Set(['loan_borrow', 'loan_lend', 'loan_pay', 'loan_collect', 'loan_out', 'loan_repayment', 'loan_interest']);

F.isDebtTransaction = t => F.DEBT_TYPES.has(t?.transaction_type);
F.isGoalTransaction = t => ['goal_save', 'goal_withdraw'].includes(t?.transaction_type);
F.isInvestmentAdjustment = t => ['investment_gain', 'investment_loss'].includes(t?.transaction_type);
F.isExceptional = t => t?.transaction_type === 'expense' && (state.exceptionalIds || []).includes(t.id);
F.baseTx = t => (t.currency || state.base) === state.base;
F.baseAmount = t => F.baseTx(t) ? n(t.amount) : 0;

F.accountById = id => (state.accounts || []).find(a => a.id === id);
F.activeAccounts = () => (state.accounts || []).filter(a => a.is_active !== false);
F.activeCategories = dir => (state.categories || []).filter(c => c && c.is_active !== false && (!dir || c.direction === dir));

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

F.defaultMoneyAccountId = () => {
  const ac = F.activeAccounts();
  return (ac.find(a => a.account_type === 'bank') || ac.find(a => a.account_type === 'cash') || ac.find(a => a.account_type === 'savings') || ac[0] || {}).id || '';
};

// ---------------- Account balances ----------------
F.accountStartDate = a => {
  const dates = (state.fullTransactions || [])
    .filter(t => t.account_id === a.id || t.transfer_account_id === a.id)
    .map(t => String(t.transaction_date || '')).filter(Boolean).sort();
  return dates[0] || localToday();
};
F.txDeltaForAccount = (t, accountId) => {
  let delta = 0;
  if (t.account_id === accountId) {
    if (F.POSITIVE_TYPES.has(t.transaction_type)) delta += n(t.amount);
    if (F.NEGATIVE_TYPES.has(t.transaction_type)) delta -= n(t.amount);
  }
  if (F.TRANSFER_TYPES.has(t.transaction_type) && t.transfer_account_id === accountId) delta += n(t.amount);
  return delta;
};
F.accountBalanceAt = (a, endDate = '9999-12-31') => {
  if (endDate < F.accountStartDate(a)) return 0;
  let bal = n(a.opening_balance);
  (state.fullTransactions || []).forEach(t => {
    if (String(t.transaction_date || '') <= endDate) bal += F.txDeltaForAccount(t, a.id);
  });
  return bal;
};
F.accountBalance = a => F.accountBalanceAt(a);

// ---------------- Loans ----------------
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

// ---------------- Net worth / financial position ----------------
F.baseAccounts = () => F.activeAccounts().filter(a => (a.currency || state.base) === state.base);
F.financialPosition = (endDate = '9999-12-31') => {
  const ac = F.baseAccounts();
  let accountAssets = 0, accountLiabilities = 0, liquid = 0, invested = 0;
  ac.forEach(a => {
    const bal = F.accountBalanceAt(a, endDate);
    if (bal >= 0) accountAssets += bal; else accountLiabilities += -bal;
    if (['cash', 'bank', 'savings'].includes(a.account_type)) liquid += Math.max(0, bal);
    if (a.account_type === 'investment') invested += Math.max(0, bal);
  });
  const receivables = (state.loans || []).filter(l => l.loan_type === 'lent' && (l.currency || state.base) === state.base).reduce((s, l) => s + F.historicalLoanRemaining(l, endDate), 0);
  const borrowed = (state.loans || []).filter(l => l.loan_type === 'borrowed' && (l.currency || state.base) === state.base).reduce((s, l) => s + F.historicalLoanRemaining(l, endDate), 0);
  const totalAssets = accountAssets + receivables;
  const totalLiabilities = accountLiabilities + borrowed;
  return { accountAssets, accountLiabilities, receivables, borrowed, totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities, liquid, invested };
};
F.assetComposition = (endDate = '9999-12-31') => {
  const groups = [['Tiền mặt', 'cash'], ['Ngân hàng', 'bank'], ['Tiết kiệm', 'savings'], ['Đầu tư', 'investment']]
    .map(([label, type]) => ({ label, value: F.baseAccounts().filter(a => a.account_type === type).reduce((s, a) => s + Math.max(0, F.accountBalanceAt(a, endDate)), 0) }));
  const rec = F.financialPosition(endDate).receivables;
  if (rec > 0) groups.push({ label: 'Phải thu', value: rec });
  return groups;
};
F.dataStartMonth = () => {
  const dates = (state.fullTransactions || []).map(t => monthKey(t.transaction_date)).filter(Boolean).sort();
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

// ---------------- Category history ----------------
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
// ---------------- Period transactions & stats ----------------
F.periodTransactions = (month = state.month) => (state.fullTransactions || []).filter(t => monthKey(t.transaction_date) === month);
F.operatingFlowTo = (type, txs) => {
  let total = 0;
  txs.forEach(t => {
    if (!F.TRANSFER_TYPES.has(t.transaction_type) || !F.baseTx(t)) return;
    const from = F.accountById(t.account_id), to = F.accountById(t.transfer_account_id);
    if (!from || !to) return;
    const amt = F.baseAmount(t);
    if (to.account_type === type && ['cash', 'bank'].includes(from.account_type)) total += amt;
    if (from.account_type === type && ['cash', 'bank'].includes(to.account_type)) total -= amt;
  });
  return total;
};
F.statsFor = txs => {
  const rows = (txs || []).filter(F.baseTx);
  let income = 0, fixed = 0, variable = 0, exceptional = 0, debtPay = 0, loanInterest = 0;
  rows.forEach(t => {
    const amt = F.baseAmount(t);
    if (t.transaction_type === 'income') income += amt;
    else if (t.transaction_type === 'expense') {
      if (F.isExceptional(t)) exceptional += amt;
      else (F.expenseKind(t) === 'fixed' ? fixed += amt : variable += amt);
    } else if (t.transaction_type === 'loan_pay') debtPay += amt;
    else if (t.transaction_type === 'loan_interest') loanInterest += amt;
  });
  const saving = Math.max(0, F.operatingFlowTo('savings', rows));
  const investment = Math.max(0, F.operatingFlowTo('investment', rows));
  const expense = fixed + variable + loanInterest;
  const allocated = expense + saving + investment + debtPay;
  return {
    income, fixed, variable, exceptional, loanInterest, debtPay, saving, investment,
    expense, allocated, remaining: Math.max(0, income - allocated), overspend: Math.max(0, allocated - income),
    cashFlow: income - expense
  };
};
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
// Names of the top-N expense categories for the month being viewed, most
// spent first — used to pick which categories get a trend sparkline.
F.topExpenseCategories = (count = 5, month = state.month) => F.expenseByCategory(F.periodTransactions(month)).slice(0, count).map(x => x.label);
// One category's spend per month for the last `months` months (oldest
// first), by the same category-name grouping as F.expenseByCategory.
F.categoryTrendSeries = (categoryName, months = 6, month = state.month) => {
  const keys = Array.from({ length: months }, (_, i) => addMonths(month, i - (months - 1)));
  return keys.map(k => {
    const value = F.expenseByCategory(F.periodTransactions(k)).find(x => x.label === categoryName)?.value || 0;
    return { month: k, value };
  });
};
// ---------------- FX (JPY -> VND, manual current rate only) ----------------
// Settings only lets the user set a single "current" rate (reporting_settings),
// not a month-by-month history, so conversion is always today's rate — the
// display is explicitly a snapshot, never a claim about past-month accuracy.
F.fxRate = () => { const r = n(state.reporting?.jpy_vnd_rate); return r > 0 ? r : null; };
F.toVND = (amount, currency) => {
  if (currency === 'VND') return n(amount);
  if (currency === 'JPY') { const r = F.fxRate(); return r ? n(amount) * r : null; }
  return null;
};
// Converts an already-computed base-currency financialPosition() snapshot to
// VND display figures. Returns null if base currency has no rate to convert
// from (only ever called when the user opted in via Settings anyway).
F.positionInVND = pos => {
  if (state.base === 'VND') return pos;
  const r = F.fxRate();
  if (!r) return null;
  return {
    totalAssets: pos.totalAssets * r, totalLiabilities: pos.totalLiabilities * r,
    netWorth: pos.netWorth * r, liquid: pos.liquid * r, invested: pos.invested * r
  };
};

// ---------------- Monthly obligations (Budget board "Nợ" / card columns) ----------------
// A loan's *monthly due* is deliberately NOT its full remaining balance —
// showing the whole principal in the Chi tiêu page would misrepresent this
// month's cash need (spec: "cột Chi tiêu phải hiện SỐ PHẢI TRẢ TRONG THÁNG").
F.loanMonthDue = (l, month = state.month) => {
  const rows = F.periodTransactions(month).filter(t => t.loan_id === l.id);
  const principal = rows.filter(t => t.transaction_type === 'loan_pay').reduce((s, t) => s + n(t.amount), 0);
  const interest = rows.filter(t => t.transaction_type === 'loan_interest').reduce((s, t) => s + n(t.amount), 0);
  const paid = principal + interest;
  if (paid > 0) return { amount: paid, note: 'Đã trả tháng này' };
  if (monthKey(l.due_date) === month) return { amount: n(l.remaining_amount), note: 'Đến hạn trong tháng này' };
  if (F.isBankLoan(l)) {
    const est = F.bankEstimate(l, endOfMonthDate(month));
    if (n(est.total) > 0) return { amount: n(est.total), note: 'Dự kiến kỳ này' };
  }
  return { amount: 0, note: `Dư nợ ${money(l.remaining_amount, l.currency || state.base)}` };
};
F.debtMonthTotalBase = (month = state.month) => (state.loans || [])
  .filter(l => l.loan_type === 'borrowed' && n(l.remaining_amount) > 0 && (l.currency || state.base) === state.base)
  .reduce((s, l) => s + n(F.loanMonthDue(l, month).amount), 0);
F.cardMonthTotalBase = () => (state.cardMonth || []).filter(x => (x.currency || state.base) === state.base).reduce((s, x) => s + n(x.expected_amount), 0);
// Loans still owing this month (not yet paid) + unpaid card statements, for a
// "sắp đến hạn" reminder list — sorted soonest first, undated items last.
F.upcomingDue = (month = state.month) => {
  const items = [];
  (state.loans || []).filter(l => l.loan_type === 'borrowed' && n(l.remaining_amount) > 0).forEach(l => {
    const due = F.loanMonthDue(l, month);
    if (n(due.amount) > 0 && due.note !== 'Đã trả tháng này') {
      items.push({ kind: 'loan', id: l.id, label: l.counterparty, amount: due.amount, currency: l.currency || state.base, note: due.note, date: monthKey(l.due_date) === month ? l.due_date : null });
    }
  });
  (state.cardMonth || []).filter(x => !x.paid && n(x.expected_amount) > 0).forEach(x => {
    items.push({ kind: 'card', id: x.account_id, label: x.card_name || 'Thẻ tín dụng', amount: x.expected_amount, currency: x.currency || state.base, note: 'Cần thanh toán', date: x.payment_date });
  });
  return items.sort((a, b) => String(a.date || '9999-99-99').localeCompare(String(b.date || '9999-99-99')));
};

// ---------------- Credit cards ----------------
F.cardAccounts = () => F.activeAccounts().filter(a => a.account_type === 'credit');
F.settingFor = id => (state.cardSettings || []).find(x => x.account_id === id);
F.cardMonthFor = id => (state.cardMonth || []).find(x => x.account_id === id);
F.configuredCards = () => F.cardAccounts().filter(a => F.settingFor(a.id));

// ---------------- Investments ----------------
F.investmentAccounts = () => F.activeAccounts().filter(a => a.account_type === 'investment');
F.investmentCapital = a => {
  let cap = clamp0(a.opening_balance);
  (state.fullTransactions || []).forEach(t => {
    if (!F.TRANSFER_TYPES.has(t.transaction_type)) return;
    const amt = n(t.amount);
    if (t.transfer_account_id === a.id) cap += amt;
    if (t.account_id === a.id) cap -= amt;
  });
  return Math.max(0, cap);
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
// Small per-category trend widget — bars via SVG attributes (never inline
// style="...", which the production CSP silently drops).
function sparklineSvg(data, w = 108, h = 28) {
  const max = Math.max(1, ...data.map(x => n(x.value)));
  const slot = w / data.length, bw = Math.max(1, slot - 2);
  const bars = data.map((x, i) => {
    const bh = Math.max(1, (h - 2) * n(x.value) / max);
    return `<rect x="${(i * slot).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5"><title>${esc(x.month)}: ${money(x.value)}</title></rect>`;
  }).join('');
  return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Xu hướng">${bars}</svg>`;
}
function trendSvg() {
  const keys = Array.from({ length: 12 }, (_, i) => addMonths(state.month, i - 11));
  const data = keys.map(k => { const s = F.statsFor(F.periodTransactions(k)); return { k, inc: s.income, exp: s.expense }; });
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
