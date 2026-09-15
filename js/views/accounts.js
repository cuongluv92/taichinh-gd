// ==========================================================================
// Tài sản — cash / bank / savings, each balance changed ONLY by manual
// +Tiền/−Tiền adjustments. Fully independent of Chi tiêu; the one number
// that flows in automatically is Đầu tư's total current value ("Đang đầu tư").
// ==========================================================================
'use strict';

const ACCOUNT_TYPE_LABEL = { cash: 'Tiền mặt', bank: 'Ngân hàng', savings: 'Tiết kiệm' };

function accountCard(a) {
  const bal = F.accountBalance(a);
  const isLockedSavings = a.account_type === 'savings' && a.is_liquid === false;
  const eyebrowBits = [ACCOUNT_TYPE_LABEL[a.account_type] || a.account_type, a.currency || state.base];
  if (isLockedSavings) eyebrowBits.push('dài hạn');
  return `<article class="card item-card">
    <div class="item-menu"><button class="mini-btn" aria-label="Sửa" ${act('openAccount', a.id)}>✎</button><button class="mini-btn" aria-label="Ẩn tài khoản" title="Ẩn tài khoản" ${act('archiveAccount', a.id)}>🗑</button></div>
    <div class="eyebrow">${eyebrowBits.map(esc).join(' · ')}</div>
    <div class="big ${bal < 0 ? 'red' : ''}">${money(bal, a.currency)}</div>
    <strong>${esc(a.name)}</strong>
    ${isLockedSavings ? '<small class="muted">Không tính vào Tiền thanh khoản</small>' : ''}
    <div class="card-actions wrap">
      <button class="btn sm primary" ${act('openAccountAdjustment', a.id, 'increase')}>＋ Tiền</button>
      <button class="btn sm" ${act('openAccountAdjustment', a.id, 'decrease')}>− Tiền</button>
      <button class="btn sm" ${act('openAccountAdjustmentHistory', a.id)}>Xem lịch sử</button>
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
function debtRow(l) {
  const remaining = F.historicalLoanRemaining(l, '9999-12-31');
  return `<button class="money-line" ${act('openLoanPayment', l.id)}><span class="line-label">${esc(l.counterparty)}<small>Nợ phải trả · quản lý ở Chi tiêu → cột Nợ</small></span><strong class="red">${money(remaining, l.currency)}</strong></button>`;
}

function renderAccounts() {
  const ac = F.baseAccounts();
  const pos = F.financialPosition();
  const cash = ac.filter(a => a.account_type === 'cash');
  const bank = ac.filter(a => a.account_type === 'bank');
  const savings = ac.filter(a => a.account_type === 'savings');
  const receivables = (state.loans || []).filter(l => l.loan_type === 'lent' && n(l.remaining_amount) > 0);
  const borrowedLoans = (state.loans || []).filter(l => l.loan_type === 'borrowed' && n(l.remaining_amount) > 0);
  const hidden = (state.accounts || []).filter(a => a.is_active === false && ['cash', 'bank', 'savings'].includes(a.account_type));
  // Foreign-currency asset accounts are never summed 1:1 into the base
  // total — shown separately, always, even when conversion display is off.
  const foreign = F.activeAccounts().filter(a => ['cash', 'bank', 'savings'].includes(a.account_type) && (a.currency || state.base) !== state.base);
  const vnd = state.reporting?.show_vnd_conversion ? F.positionInVND(pos) : null;
  const foreignGroups = [...new Set(foreign.map(a => a.currency))].map(cur => {
    const rate = state.reporting?.jpy_vnd_rate;
    const note = state.reporting?.show_vnd_conversion && rate
      ? `Ước tính quy đổi theo tỷ giá đã đặt (1 JPY ≈ ${rate} ${cur}). Số tiền gốc vẫn giữ nguyên bằng ${cur}, chưa tính vào tổng ${esc(state.base)} ở trên.`
      : `Chưa tính vào tổng ${esc(state.base)} ở trên. Bật quy đổi ở Cài đặt để xem ước tính.`;
    return accountGroup(`Tài khoản ngoại tệ · ${cur}`, foreign.filter(a => a.currency === cur), note);
  }).join('');
  const nw = F.netWorthSeries(12);
  return `<div class="view-head"><div><h2>Tài sản gia đình</h2><p>Số dư hiện tại của mọi tài khoản, thay đổi CHỈ qua nút ＋ Tiền / − Tiền. Chi tiêu tháng không tự động làm giảm tài khoản.</p></div>
    <button class="btn primary" ${act('openAccount')}>＋ Tài khoản</button></div>
  <div class="grid kpi-grid">
    ${kpiCard('Tiền thanh khoản', money(pos.liquid), 'Tiền mặt + ngân hàng + tiết kiệm có thể rút')}
    ${kpiCard('Thanh khoản ròng', money(pos.liquidNet), 'Tiền thanh khoản − tổng nợ', pos.liquidNet < 0 ? 'red' : '')}
    ${kpiCard('Tài sản ròng', money(pos.netWorth), vnd ? `Tổng nợ ${money(pos.totalLiabilities)} · ≈ ${money(vnd.netWorth, 'VND')}` : `Tổng nợ ${money(pos.totalLiabilities)}`, pos.netWorth >= 0 ? 'green' : 'red')}
    ${kpiCard('Đang đầu tư', money(pos.invested), 'Tự động lấy từ tổng giá trị hiện tại ở Đầu tư · tính vào tài sản ròng, không tính vào thanh khoản')}
  </div>
  <section class="card section chart-card mt-16"><div class="section-head"><div><h2>Tài sản ròng</h2><p>12 tháng gần nhất</p></div></div>${netWorthLine(nw)}</section>
  ${accountGroup('Tiền mặt', cash)}
  ${accountGroup('Tài khoản ngân hàng', bank)}
  ${accountGroup('Tiết kiệm', savings)}
  ${receivables.length ? `<section class="card section mt-16"><div class="section-head"><h2>Khoản phải thu</h2><span class="count-tag">${receivables.length} khoản</span></div><div class="money-items">${receivables.map(receivableRow).join('')}</div></section>` : ''}
  ${borrowedLoans.length ? `<section class="card section mt-16"><div class="section-head"><h2>Nợ</h2><span class="count-tag">${borrowedLoans.length} khoản</span></div><div class="money-items">${borrowedLoans.map(debtRow).join('')}</div></section>` : ''}
  <section class="card section mt-16"><div class="section-head"><div><h2>Tổng đầu tư</h2><p>Quản lý chi tiết ở tab Đầu tư</p></div><button class="btn sm" ${act('navigate', 'investments')}>Mở tab Đầu tư</button></div>
    <div class="big">${money(pos.invested)}</div></section>
  ${foreign.length ? foreignGroups : ''}
  ${hidden.length ? `<section class="card section mt-16"><div class="section-head"><h2>Tài khoản đã ẩn</h2><span class="count-tag">${hidden.length} tài khoản</span></div><div class="list">${hidden.map(hiddenAccountRow).join('')}</div></section>` : ''}
  ${!cash.length && !bank.length && !savings.length && !foreign.length ? '<div class="card empty mt-16">Chưa có tài khoản. Nhấn "＋ Tài khoản" để bắt đầu.</div>' : ''}`;
}

Object.assign(window, { renderAccounts });
