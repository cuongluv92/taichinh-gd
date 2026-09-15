// ==========================================================================
// Đầu tư — NISA (つみたて/成長 khung), Chứng khoán, Tiết kiệm sinh lời, và
// Khác (Vàng/Quỹ/Crypto/tự đặt tên). Never appears in Tổng quan/Chi tiêu.
// Only its total current value flows into Tài sản's "Tổng đầu tư" — the one
// deliberate automatic link in the whole app. "Giá trị dự kiến" (growth
// simulation) is always shown separately from "Giá trị hiện tại"/"Lãi-lỗ
// thực tế" — it is a mô phỏng, never mixed into real numbers.
// ==========================================================================
'use strict';

const PLAN_STATUS_LABEL = { paused: 'Tạm dừng', not_started: 'Chưa bắt đầu', ended: 'Đã kết thúc', confirmed: 'Đã góp', skipped: 'Đã bỏ qua tháng này', pending: 'Dự kiến góp' };

function planStatusWidget(inv) {
  const events = (state.investmentEvents || {})[inv.id] || [];
  const st = F.investmentPlanStatus(inv, events, state.month);
  if (!st) return '';
  let actions = '';
  if (st.status === 'pending') actions = `<button class="btn sm primary" ${act('openInvestmentPlanConfirm', inv.id, state.month)}>Xác nhận đã góp</button><button class="btn sm" ${act('skipInvestmentPlan', inv.id, state.month)}>Bỏ qua tháng này</button>`;
  else if (st.status === 'confirmed') actions = `<button class="btn sm" ${act('openInvestmentEvent', inv.id, 'contribution', st.eventId)}>Sửa số tiền</button>`;
  return `<div class="plan-status"><small>Kế hoạch góp tháng ${fmtMonthKey(state.month)} (${money(inv.monthly_amount, inv.currency)}/tháng): <b>${esc(PLAN_STATUS_LABEL[st.status])}</b>${st.status === 'pending' ? ` · Dự kiến ${money(st.amount, inv.currency)}` : ''}</small>${actions ? `<div class="row mt-6">${actions}</div>` : ''}</div>`;
}
function simulationWidget(inv) {
  const events = (state.investmentEvents || {})[inv.id] || [];
  const sim = F.investmentSimulatedValue(inv, events);
  if (sim === null) return '';
  const periodLabel = inv.expected_return_period === 'monthly' ? 'tháng' : 'năm';
  return `<div class="invest-summary"><span class="muted">Giá trị dự kiến (mô phỏng): ${money(sim, inv.currency)}</span></div>
    <small class="muted">Tăng trưởng kỳ vọng ${esc(String(inv.expected_return_rate))}%/${periodLabel} — mô phỏng, không phải lợi nhuận đảm bảo, không cộng vào giá trị/lãi-lỗ thực tế.</small>`;
}

function investmentCardOther(inv) {
  const netCap = F.investmentNetCapital(inv), value = F.investmentCurrentValue(inv), pl = F.investmentPL(inv), pct = F.investmentPLPercent(inv);
  return `
    <div class="big">${money(value, inv.currency)}</div>
    <strong>${esc(inv.name)}</strong>
    <div class="invest-summary"><span>Vốn ròng ${money(netCap, inv.currency)}</span><span class="${pl >= 0 ? 'green' : 'red'}">${pl >= 0 ? '+' : ''}${money(pl, inv.currency)}${pct !== null ? ` (${pct.toFixed(1)}%)` : ''}</span></div>
    ${inv.latest_value_date ? `<small class="muted">Cập nhật ${esc(String(inv.latest_value_date).slice(0, 10))}</small>` : '<small class="muted">Chưa cập nhật giá trị — đang hiện theo vốn ròng</small>'}
    ${simulationWidget(inv)}
    <div class="card-actions wrap">
      <button class="btn sm primary" ${act('openInvestmentEvent', inv.id, 'contribution')}>Thêm vốn</button>
      <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'withdrawal')}>Rút vốn</button>
      <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'valuation')}>Cập nhật giá trị</button>
      <button class="btn sm" ${act('openInvestmentEventHistory', inv.id)}>Xem lịch sử</button>
      <button class="btn sm" ${act('openInvestmentNew', inv.id)}>Sửa</button>
      <button class="btn sm" ${act('deleteInvestment', inv.id)}>Xóa</button>
    </div>`;
}
function investmentCardNisa(inv) {
  const netCap = F.investmentNetCapital(inv), value = F.investmentCurrentValue(inv), pl = F.investmentPL(inv), pct = F.investmentPLPercent(inv);
  return `
    <div class="big">${money(value, inv.currency)}</div>
    <strong>${esc(inv.name)}</strong>
    <div class="invest-summary"><span>Vốn ròng ${money(netCap, inv.currency)}</span><span class="${pl >= 0 ? 'green' : 'red'}">${pl >= 0 ? '+' : ''}${money(pl, inv.currency)}${pct !== null ? ` (${pct.toFixed(1)}%)` : ''}</span></div>
    ${inv.nisa_annual_limit ? `<small class="muted">Hạn mức năm (tham khảo): ${money(inv.nisa_annual_limit, inv.currency)}</small>` : ''}
    ${planStatusWidget(inv)}
    ${simulationWidget(inv)}
    <div class="card-actions wrap">
      <button class="btn sm primary" ${act('openInvestmentEvent', inv.id, 'contribution')}>Thêm vốn</button>
      <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'withdrawal')}>Rút vốn</button>
      <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'valuation')}>Cập nhật giá trị</button>
      <button class="btn sm" ${act('openInvestmentEventHistory', inv.id)}>Xem lịch sử</button>
      <button class="btn sm" ${act('openInvestmentNew', inv.id)}>Sửa</button>
      <button class="btn sm" ${act('deleteInvestment', inv.id)}>Xóa</button>
    </div>`;
}
function investmentCardSecurities(inv) {
  const value = F.investmentCurrentValue(inv), netCap = F.investmentNetCapital(inv), unrealized = value - netCap, realized = n(inv.realized_pl);
  return `
    <div class="big">${money(value, inv.currency)}</div>
    <strong>${esc(inv.name)}</strong>
    <div class="invest-summary"><span>${n(inv.quantity)} × ${money(inv.current_price ?? inv.avg_cost, inv.currency)}</span><span>Giá vốn TB ${money(inv.avg_cost, inv.currency)}</span></div>
    <div class="invest-summary"><span class="${unrealized >= 0 ? 'green' : 'red'}">Chưa thực hiện ${unrealized >= 0 ? '+' : ''}${money(unrealized, inv.currency)}</span><span class="${realized >= 0 ? 'green' : 'red'}">Đã thực hiện ${realized >= 0 ? '+' : ''}${money(realized, inv.currency)}</span></div>
    ${n(inv.total_dividends) > 0 ? `<small class="muted">Cổ tức đã nhận: ${money(inv.total_dividends, inv.currency)}</small>` : ''}
    ${simulationWidget(inv)}
    <div class="card-actions wrap">
      <button class="btn sm primary" ${act('openSecurityTrade', inv.id, 'buy')}>Mua</button>
      <button class="btn sm" ${act('openSecurityTrade', inv.id, 'sell')}>Bán</button>
      <button class="btn sm" ${act('openSecurityTrade', inv.id, 'dividend')}>Nhận cổ tức</button>
      <button class="btn sm" ${act('openSecurityTrade', inv.id, 'valuation')}>Cập nhật giá</button>
      <button class="btn sm" ${act('openInvestmentEventHistory', inv.id)}>Xem lịch sử</button>
      <button class="btn sm" ${act('openInvestmentNew', inv.id)}>Sửa</button>
      <button class="btn sm" ${act('deleteInvestment', inv.id)}>Xóa</button>
    </div>`;
}
function investmentCardSavings(inv) {
  const netCap = F.investmentNetCapital(inv), value = F.investmentCurrentValue(inv), interestReceived = n(inv.total_interest);
  return `
    <div class="big">${money(value, inv.currency)}</div>
    <strong>${esc(inv.name)}</strong>
    <div class="invest-summary"><span>Gốc + góp thêm ${money(netCap, inv.currency)}</span><span class="green">Lãi thực nhận +${money(interestReceived, inv.currency)}</span></div>
    <small class="muted">${esc(inv.bank_name || '')}${inv.interest_rate_annual ? ` · ${inv.interest_rate_annual}%/năm` : ''}${inv.interest_payment_method ? ` · ${esc(INTEREST_METHOD_LABEL[inv.interest_payment_method] || inv.interest_payment_method)}` : ''}${inv.term_end_date ? ` · Đáo hạn ${esc(String(inv.term_end_date).slice(0, 10))}` : ''}</small>
    ${planStatusWidget(inv)}
    ${simulationWidget(inv)}
    <div class="card-actions wrap">
      <button class="btn sm primary" ${act('openInvestmentEvent', inv.id, 'contribution')}>Gửi thêm</button>
      <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'withdrawal')}>Rút tiền</button>
      <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'interest')}>Nhận lãi</button>
      <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'valuation')}>Cập nhật số dư</button>
      <button class="btn sm" ${act('openInvestmentEventHistory', inv.id)}>Xem lịch sử</button>
      <button class="btn sm" ${act('openInvestmentNew', inv.id)}>Sửa</button>
      <button class="btn sm" ${act('deleteInvestment', inv.id)}>Xóa</button>
    </div>`;
}
const INVESTMENT_CARD_RENDERERS = { nisa: investmentCardNisa, securities: investmentCardSecurities, savings_interest: investmentCardSavings, other: investmentCardOther };
function investmentCard(inv) {
  const eyebrow = [INVESTMENT_KIND_LABEL[inv.kind], inv.asset_type, inv.broker_name || inv.bank_name, inv.currency || state.base].filter(Boolean).join(' · ');
  return `<article class="card item-card">
    <div class="eyebrow">${esc(eyebrow)}</div>
    ${(INVESTMENT_CARD_RENDERERS[inv.kind] || investmentCardOther)(inv)}
    ${inv.note ? `<small class="muted">${esc(inv.note)}</small>` : ''}
  </article>`;
}
function investmentSection(title, kind, list) {
  if (!list.length) return '';
  return `<section class="card section mt-16"><div class="section-head"><h2>${esc(title)}</h2><span class="count-tag">${list.length} khoản</span></div><div class="grid account-grid">${list.map(investmentCard).join('')}</div></section>`;
}

function renderInvestments() {
  const list = F.investments();
  const totalValue = list.filter(inv => (inv.currency || state.base) === state.base).reduce((s, inv) => s + F.investmentCurrentValue(inv), 0);
  const totalCap = list.filter(inv => (inv.currency || state.base) === state.base).reduce((s, inv) => s + F.investmentNetCapital(inv), 0);
  const totalPL = totalValue - totalCap;
  return `<div class="view-head"><div><h2>Đầu tư</h2><p>Độc lập với Chi tiêu và Tổng quan. Tổng giá trị hiện tại tự động chuyển sang Tài sản → "Tổng đầu tư".</p></div>
    <button class="btn primary" ${act('openInvestmentNew')}>＋ Đầu tư mới</button></div>
  <div class="grid kpi-grid">
    ${kpiCard('Tổng giá trị hiện tại', money(totalValue), `${list.length} khoản đầu tư`)}
    ${kpiCard('Tổng vốn ròng', money(totalCap), 'Vốn ban đầu + đã thêm − đã rút')}
    ${kpiCard('Tổng lãi/lỗ thực tế', signedMoney(totalPL), totalCap > 0 ? pctText(totalPL, totalCap) : '—', totalPL >= 0 ? 'green' : 'red')}
  </div>
  ${investmentSection('NISA', 'nisa', F.investmentsByKind('nisa'))}
  ${investmentSection('Chứng khoán', 'securities', F.investmentsByKind('securities'))}
  ${investmentSection('Tiết kiệm sinh lời', 'savings_interest', F.investmentsByKind('savings_interest'))}
  ${investmentSection('Khác', 'other', F.investmentsByKind('other'))}
  ${!list.length ? '<div class="card empty mt-16">Chưa có khoản đầu tư nào. Nhấn "＋ Đầu tư mới" để bắt đầu.</div>' : ''}`;
}

Object.assign(window, { renderInvestments });
