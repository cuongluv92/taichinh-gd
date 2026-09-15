// ==========================================================================
// Đầu tư — its own ledger (NISA, S&P500, cổ phiếu, quỹ, vàng, crypto, bất
// động sản, hoặc loại tự đặt tên). Never appears in Tổng quan/Chi tiêu.
// Only its total current value flows into Tài sản's "Đang đầu tư" — the one
// deliberate automatic link in the whole app.
// ==========================================================================
'use strict';

function investmentCard(inv) {
  const netCap = F.investmentNetCapital(inv), value = F.investmentCurrentValue(inv), pl = F.investmentPL(inv), pct = F.investmentPLPercent(inv);
  const eyebrow = [inv.asset_type || 'Đầu tư', inv.currency || state.base].filter(Boolean).join(' · ');
  return `<article class="card item-card">
    <div class="eyebrow">${esc(eyebrow)}</div>
    <div class="big">${money(value, inv.currency)}</div>
    <strong>${esc(inv.name)}</strong>
    <div class="invest-summary"><span>Vốn ròng ${money(netCap, inv.currency)}</span><span class="${pl >= 0 ? 'green' : 'red'}">${pl >= 0 ? '+' : ''}${money(pl, inv.currency)}${pct !== null ? ` (${pct.toFixed(1)}%)` : ''}</span></div>
    ${inv.latest_value_date ? `<small class="muted">Cập nhật ${esc(String(inv.latest_value_date).slice(0, 10))}</small>` : '<small class="muted">Chưa cập nhật giá trị — đang hiện theo vốn ròng</small>'}
    ${inv.note ? `<small class="muted">${esc(inv.note)}</small>` : ''}
    <div class="card-actions wrap">
      <button class="btn sm primary" ${act('openInvestmentEvent', inv.id, 'contribution')}>Thêm vốn</button>
      <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'withdrawal')}>Rút vốn</button>
      <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'valuation')}>Cập nhật giá trị</button>
      <button class="btn sm" ${act('openInvestmentEventHistory', inv.id)}>Xem lịch sử</button>
      <button class="btn sm" ${act('openInvestmentNew', inv.id)}>Sửa</button>
      <button class="btn sm" ${act('deleteInvestment', inv.id)}>Xóa</button>
    </div>
  </article>`;
}

function renderInvestments() {
  const list = F.investments();
  const totalValue = list.reduce((s, inv) => s + F.investmentCurrentValue(inv), 0);
  const totalCap = list.reduce((s, inv) => s + F.investmentNetCapital(inv), 0);
  const totalPL = totalValue - totalCap;
  return `<div class="view-head"><div><h2>Đầu tư</h2><p>Độc lập với Chi tiêu và Tổng quan. Tổng giá trị hiện tại tự động chuyển sang Tài sản → "Đang đầu tư".</p></div>
    <button class="btn primary" ${act('openInvestmentNew')}>＋ Đầu tư mới</button></div>
  <div class="grid kpi-grid">
    ${kpiCard('Tổng giá trị hiện tại', money(totalValue), `${list.length} khoản đầu tư`)}
    ${kpiCard('Tổng vốn ròng', money(totalCap), 'Vốn ban đầu + đã thêm − đã rút')}
    ${kpiCard('Tổng lãi/lỗ', signedMoney(totalPL), totalCap > 0 ? pctText(totalPL, totalCap) : '—', totalPL >= 0 ? 'green' : 'red')}
  </div>
  <div class="grid account-grid mt-16">${list.map(investmentCard).join('') || '<div class="card empty">Chưa có khoản đầu tư nào. Nhấn "＋ Đầu tư mới" để bắt đầu.</div>'}</div>`;
}

Object.assign(window, { renderInvestments });
