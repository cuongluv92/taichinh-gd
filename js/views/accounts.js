// ==========================================================================
// Tài sản — cash / bank / savings / investment consolidated, with totals
// and investment management (capital, current value, gain/loss).
// ==========================================================================
'use strict';

const ACCOUNT_TYPE_LABEL = { cash: 'Tiền mặt', bank: 'Ngân hàng', savings: 'Tiết kiệm', investment: 'Đầu tư', credit: 'Thẻ tín dụng' };

function accountCard(a) {
  const bal = F.accountBalance(a), isInvest = a.account_type === 'investment';
  const capital = isInvest ? F.investmentCapital(a) : 0, pl = isInvest ? bal - capital : 0, ret = capital > 0 ? pl / capital * 100 : null;
  return `<article class="card item-card">
    <div class="item-menu"><button class="mini-btn" aria-label="Sửa" ${act('openAccount', a.id)}>✎</button><button class="mini-btn" aria-label="Ẩn tài khoản" title="Ẩn tài khoản" ${act('archiveAccount', a.id)}>🗑</button></div>
    <div class="eyebrow">${esc(ACCOUNT_TYPE_LABEL[a.account_type] || a.account_type)} · ${esc(a.currency || state.base)}</div>
    <div class="big ${bal < 0 ? 'red' : ''}">${money(bal, a.currency)}</div>
    <strong>${esc(a.name)}</strong>
    ${isInvest ? `<div class="invest-summary"><span>Vốn ${money(capital, a.currency)}</span><span class="${pl >= 0 ? 'green' : 'red'}">${pl >= 0 ? '+' : ''}${money(pl, a.currency)}${ret !== null ? ` (${ret.toFixed(1)}%)` : ''}</span></div>` : ''}
    <div class="card-actions">
      ${isInvest
        ? `<button class="btn sm primary" ${act('openInvestmentTransfer', a.id, 'in')}>＋ Nạp</button><button class="btn sm" ${act('openInvestmentTransfer', a.id, 'out')}>Rút</button><button class="btn sm" ${act('openInvestmentValue', a.id)}>Định giá</button><button class="btn sm" aria-label="Lịch sử định giá" title="Xem/sửa/xóa các lần định giá trước" ${act('openInvestmentHistory', a.id)}>📋</button>`
        : `<button class="btn sm" ${act('openTransfer', a.id)}>Chuyển tiền</button><button class="btn sm" ${act('openQuickEntry', { transaction_type: 'expense', account_id: a.id })}>Giao dịch</button>`}
    </div>
  </article>`;
}
function accountGroup(title, list, note = '') {
  if (!list.length) return '';
  return `<section class="card section mt-16"><div class="section-head"><h2>${esc(title)}</h2><span class="count-tag">${list.length} tài khoản</span></div>${note ? `<p class="note">${esc(note)}</p>` : ''}<div class="grid account-grid">${list.map(accountCard).join('')}</div></section>`;
}
function hiddenAccountRow(a) {
  return `<div class="tx"><div class="tx-main"><strong>${esc(a.name)}</strong><span>${esc(ACCOUNT_TYPE_LABEL[a.account_type] || a.account_type)} · ${esc(a.currency || state.base)}</span></div>
    <div class="tx-actions"><button class="btn sm" ${act('unarchiveAccount', a.id)}>Khôi phục</button></div></div>`;
}
function receivableRow(l) {
  const remaining = F.historicalLoanRemaining(l, '9999-12-31');
  return `<button class="money-line" ${act('openLoanPayment', l.id)}><span class="line-label">${esc(l.counterparty)}<small>Khoản phải thu</small></span><strong>${money(remaining, l.currency)}</strong></button>`;
}

function renderAccounts() {
  const ac = F.baseAccounts();
  const pos = F.financialPosition();
  const cash = ac.filter(a => ['cash', 'bank'].includes(a.account_type));
  const savings = ac.filter(a => a.account_type === 'savings');
  const invest = ac.filter(a => a.account_type === 'investment');
  const credit = ac.filter(a => a.account_type === 'credit');
  const receivables = (state.loans || []).filter(l => l.loan_type === 'lent' && n(l.remaining_amount) > 0);
  const borrowedLoans = (state.loans || []).filter(l => l.loan_type === 'borrowed' && n(l.remaining_amount) > 0);
  const hidden = (state.accounts || []).filter(a => a.is_active === false);
  // Accounts in a different currency than the household base (e.g. a VND
  // bank account in a JPY household) were entirely invisible here before —
  // F.baseAccounts() filters them out, correctly, so they never get summed
  // 1:1 into the JPY totals above, but that filtering was silently dropping
  // them from the page too instead of just excluding them from the sums.
  const foreign = F.activeAccounts().filter(a => (a.currency || state.base) !== state.base);
  const vnd = state.reporting?.show_vnd_conversion ? F.positionInVND(pos) : null;
  const foreignGroups = [...new Set(foreign.map(a => a.currency))].map(cur => {
    const rate = state.reporting?.jpy_vnd_rate;
    const note = state.reporting?.show_vnd_conversion && rate
      ? `Ước tính quy đổi theo tỷ giá đã đặt (1 JPY ≈ ${rate} ${cur}). Số tiền gốc vẫn giữ nguyên bằng ${cur}.`
      : `Chưa tính vào tổng ${esc(state.base)} ở trên. Bật quy đổi ở Cài đặt để xem ước tính.`;
    return accountGroup(`Tài khoản ${cur}`, foreign.filter(a => a.currency === cur), note);
  }).join('');
  const nw = F.netWorthSeries(12);
  return `<div class="view-head"><div><h2>Tài sản gia đình</h2><p>Số dư hiện tại của mọi tài khoản — không theo tháng đang chọn ở trên.</p></div>
    <div class="row"><button class="btn" ${act('openTransfer')}>⇄ Chuyển tiền</button><button class="btn primary" ${act('openAccount')}>＋ Tài khoản</button></div></div>
  <div class="grid kpi-grid">
    ${kpiCard('Tiền thanh khoản', money(pos.liquid), 'Tiền mặt + ngân hàng + tiết kiệm có thể rút')}
    ${kpiCard('Thanh khoản ròng', money(pos.liquidNet), 'Tiền thanh khoản − tổng dư nợ', pos.liquidNet < 0 ? 'red' : '')}
    ${kpiCard('Tài sản ròng', money(pos.netWorth), vnd ? `Tổng nợ ${money(pos.totalLiabilities)} · ≈ ${money(vnd.netWorth, 'VND')}` : `Tổng nợ ${money(pos.totalLiabilities)}`, pos.netWorth >= 0 ? 'green' : 'red')}
    ${kpiCard('Đang đầu tư', money(pos.invested), 'Giá trị hiện tại · tính vào tài sản ròng, không tính vào thanh khoản')}
  </div>
  <section class="card section chart-card mt-16"><div class="section-head"><div><h2>Tài sản ròng</h2><p>12 tháng gần nhất</p></div></div>${netWorthLine(nw)}</section>
  ${accountGroup('Tiền đang dùng', cash)}
  ${accountGroup('Tiết kiệm', savings)}
  ${accountGroup('Đầu tư', invest)}
  ${accountGroup('Nợ và thẻ tín dụng', credit)}
  ${receivables.length ? `<section class="card section mt-16"><div class="section-head"><h2>Khoản phải thu</h2><span class="count-tag">${receivables.length} khoản</span></div><div class="money-items">${receivables.map(receivableRow).join('')}</div></section>` : ''}
  ${borrowedLoans.length ? `<p class="note mt-16">Khoản vay (Nợ phải trả) được quản lý ở Chi tiêu → cột Nợ phải trả — dư nợ vẫn được tính vào Tổng nợ/Tài sản ròng ở trên.</p>` : ''}
  ${foreign.length ? foreignGroups : ''}
  ${hidden.length ? `<section class="card section mt-16"><div class="section-head"><h2>Tài khoản đã ẩn</h2><span class="count-tag">${hidden.length} tài khoản</span></div><div class="list">${hidden.map(hiddenAccountRow).join('')}</div></section>` : ''}
  ${!cash.length && !savings.length && !invest.length && !credit.length && !foreign.length ? '<div class="card empty mt-16">Chưa có tài khoản. Nhấn "＋ Tài khoản" để bắt đầu.</div>' : ''}`;
}

Object.assign(window, { renderAccounts });
