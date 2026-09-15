// ==========================================================================
// Tài sản — cash / bank / savings / investment consolidated, with totals
// and investment management (capital, current value, gain/loss).
// ==========================================================================
'use strict';

const ACCOUNT_TYPE_LABEL = { cash: 'Tiền mặt', bank: 'Ngân hàng', savings: 'Tiết kiệm', investment: 'Đầu tư' };

function accountCard(a) {
  const bal = F.accountBalance(a), isInvest = a.account_type === 'investment';
  const capital = isInvest ? F.investmentCapital(a) : 0, pl = isInvest ? bal - capital : 0, ret = capital > 0 ? pl / capital * 100 : null;
  return `<article class="card item-card">
    <div class="item-menu"><button class="mini-btn" aria-label="Sửa" onclick="openAccount('${esc(a.id)}')">✎</button></div>
    <div class="muted" style="font-size:11.5px;text-transform:uppercase;letter-spacing:.02em">${esc(ACCOUNT_TYPE_LABEL[a.account_type] || a.account_type)} · ${esc(a.currency || state.base)}</div>
    <div class="big ${bal < 0 ? 'red' : ''}">${money(bal, a.currency)}</div>
    <strong>${esc(a.name)}</strong>
    ${isInvest ? `<div class="muted" style="font-size:12px;margin-top:6px;display:flex;gap:14px"><span>Vốn ${money(capital, a.currency)}</span><span class="${pl >= 0 ? 'green' : 'red'}">${pl >= 0 ? '+' : ''}${money(pl, a.currency)}${ret !== null ? ` (${ret.toFixed(1)}%)` : ''}</span></div>` : ''}
    <div style="display:flex;gap:8px;margin-top:12px">
      ${isInvest
        ? `<button class="btn sm primary" onclick="openInvestmentTransfer('${esc(a.id)}','in')">＋ Nạp</button><button class="btn sm" onclick="openInvestmentTransfer('${esc(a.id)}','out')">Rút</button><button class="btn sm" onclick="openInvestmentValue('${esc(a.id)}')">Định giá</button>`
        : `<button class="btn sm" onclick="openTransfer('${esc(a.id)}')">Chuyển tiền</button><button class="btn sm" onclick="openQuickEntry({transaction_type:'expense',account_id:'${esc(a.id)}'})">Giao dịch</button>`}
    </div>
  </article>`;
}
function accountGroup(title, list) {
  if (!list.length) return '';
  return `<section class="card section" style="margin-top:16px"><div class="section-head"><h2>${esc(title)}</h2><span class="muted" style="font-size:12px">${list.length} tài khoản</span></div><div class="grid account-grid">${list.map(accountCard).join('')}</div></section>`;
}

function renderAccounts() {
  const ac = F.baseAccounts();
  const pos = F.financialPosition();
  const cash = ac.filter(a => ['cash', 'bank'].includes(a.account_type));
  const savings = ac.filter(a => a.account_type === 'savings');
  const invest = ac.filter(a => a.account_type === 'investment');
  return `<div class="view-head"><div><h2>Tài sản gia đình</h2><p>Mọi thu, chi, chuyển khoản và thanh toán nợ đều cập nhật số dư tự động.</p></div>
    <div class="finance-actions" style="display:flex;gap:8px"><button class="btn" onclick="openTransfer()">⇄ Chuyển tiền</button><button class="btn primary" onclick="openAccount()">＋ Tài khoản</button></div></div>
  <div class="grid kpi-grid">
    ${kpiCard('Tổng tài sản', money(pos.totalAssets), 'Gồm cả khoản phải thu')}
    ${kpiCard('Tổng nợ', money(pos.totalLiabilities), 'Dư âm tài khoản + khoản vay', pos.totalLiabilities ? 'red' : '')}
    ${kpiCard('Tài sản ròng', money(pos.netWorth), 'Tài sản − nợ', pos.netWorth >= 0 ? 'green' : 'red')}
    ${kpiCard('Đang đầu tư', money(pos.invested), 'Giá trị hiện tại')}
  </div>
  ${accountGroup('Tiền đang dùng', cash)}
  ${accountGroup('Tiết kiệm', savings)}
  ${accountGroup('Đầu tư', invest)}
  ${!cash.length && !savings.length && !invest.length ? '<div class="card empty" style="margin-top:16px">Chưa có tài khoản. Nhấn "＋ Tài khoản" để bắt đầu.</div>' : ''}`;
}

Object.assign(window, { renderAccounts });
