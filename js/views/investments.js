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
    <div class="invest-body">
      <div class="invest-info">
        <div class="big">${money(value, inv.currency)}</div>
        <strong>${esc(inv.name)}</strong>
        <div class="invest-summary"><span>Vốn ròng ${money(netCap, inv.currency)}</span><span class="${pl >= 0 ? 'green' : 'red'}">${pl >= 0 ? '+' : ''}${money(pl, inv.currency)}${pct !== null ? ` (${pct.toFixed(1)}%)` : ''}</span></div>
        ${inv.latest_value_date ? `<small class="muted">Cập nhật ${esc(String(inv.latest_value_date).slice(0, 10))}</small>` : '<small class="muted">Chưa cập nhật giá trị — đang hiện theo vốn ròng</small>'}
        ${simulationWidget(inv)}
      </div>
      <div class="invest-actions-col">
        <button class="btn sm primary" ${act('openInvestmentEvent', inv.id, 'contribution')}>Thêm vốn</button>
        <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'withdrawal')}>Rút vốn</button>
        <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'valuation')}>Cập nhật giá trị</button>
        <button class="btn sm" ${act('openInvestmentEventHistory', inv.id)}>Xem lịch sử</button>
        <button class="btn sm" ${act('openInvestmentNew', inv.id)}>Sửa</button>
        <button class="btn sm" ${act('deleteInvestment', inv.id)}>Xóa</button>
      </div>
    </div>`;
}
// A quỹ/ETF held inside a NISA account — an ordinary kind='securities' row
// (same buy/sell/avg-cost engine as standalone Chứng khoán), just rendered
// nested under its parent NISA card instead of as its own top-level card.
function nisaHoldingRow(h) {
  const val = F.investmentCurrentValue(h), pl = F.investmentPL(h), pct = F.investmentPLPercent(h);
  return `<div class="tx tx-wrap">
    <div class="tx-main"><strong>${esc(h.name)}</strong><span>${h.ticker ? `${esc(h.ticker)} · ` : ''}${n(h.quantity)} × ${money(h.current_price ?? h.avg_cost, h.currency)} (mua TB ${money(h.avg_cost, h.currency)})</span></div>
    <div class="tx-actions wrap">
      <span class="${pl >= 0 ? 'green' : 'red'}">${money(val, h.currency)}${pct !== null ? ` (${pl >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}</span>
      <button class="btn sm" ${act('openSecurityTrade', h.id, 'buy')}>Mua</button>
      <button class="btn sm" ${act('openSecurityTrade', h.id, 'sell')}>Bán</button>
      <button class="btn sm" ${act('openInvestmentEventHistory', h.id)}>Lịch sử</button>
      <button class="btn sm" ${act('deleteInvestment', h.id)}>Xóa</button>
    </div>
  </div>`;
}
function investmentCardNisa(inv) {
  const holdings = F.nisaHoldings(inv.id);
  const netCap = F.investmentNetCapital(inv), value = F.investmentCurrentValue(inv), pl = F.investmentPL(inv), pct = F.investmentPLPercent(inv);
  // Once a NISA has ≥1 quỹ/ETF (chế độ chi tiết), its value/vốn ròng roll up
  // purely from those holdings (see F.investmentCurrentValue/NetCapital) —
  // Thêm vốn/Rút vốn/Cập nhật giá trị are hidden so they can't silently
  // double-count against the holdings below, but the account's own event
  // history (contribution-plan confirmations etc.) stays viewable either way.
  const accountActions = holdings.length ? '' : `
      <button class="btn sm primary" ${act('openInvestmentEvent', inv.id, 'contribution')}>Thêm vốn</button>
      <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'withdrawal')}>Rút vốn</button>
      <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'valuation')}>Cập nhật giá trị</button>`;
  return `
    <div class="invest-body">
      <div class="invest-info">
        <div class="big">${money(value, inv.currency)}</div>
        <strong>${esc(inv.name)}</strong>
        <div class="invest-summary"><span>Vốn ròng ${money(netCap, inv.currency)}</span><span class="${pl >= 0 ? 'green' : 'red'}">${pl >= 0 ? '+' : ''}${money(pl, inv.currency)}${pct !== null ? ` (${pct.toFixed(1)}%)` : ''}</span></div>
        ${inv.nisa_annual_limit ? `<small class="muted">Hạn mức năm (tham khảo): ${money(inv.nisa_annual_limit, inv.currency)}</small>` : ''}
        ${holdings.length ? `<div class="list mt-6">${holdings.map(nisaHoldingRow).join('')}</div><small class="muted">Giá trị và vốn ròng NISA tính theo tổng các quỹ/ETF bên trên.</small>` : ''}
        ${planStatusWidget(inv)}
        ${simulationWidget(inv)}
      </div>
      <div class="invest-actions-col">
        ${accountActions}
        <button class="btn sm primary" ${act('openNisaHolding', inv.id)}>＋ Thêm quỹ/ETF</button>
        <button class="btn sm" ${act('openInvestmentEventHistory', inv.id)}>Xem lịch sử</button>
        <button class="btn sm" ${act('openInvestmentNew', inv.id)}>Sửa</button>
        <button class="btn sm" ${act('deleteInvestment', inv.id)}>Xóa</button>
      </div>
    </div>`;
}
function investmentCardSecurities(inv) {
  const value = F.investmentCurrentValue(inv), netCap = F.investmentNetCapital(inv), unrealized = value - netCap, realized = n(inv.realized_pl);
  return `
    <div class="invest-body">
      <div class="invest-info">
        <div class="big">${money(value, inv.currency)}</div>
        <strong>${esc(inv.name)}</strong>
        <div class="invest-summary"><span>${n(inv.quantity)} × ${money(inv.current_price ?? inv.avg_cost, inv.currency)}</span><span>Giá vốn TB ${money(inv.avg_cost, inv.currency)}</span></div>
        <div class="invest-summary"><span class="${unrealized >= 0 ? 'green' : 'red'}">Chưa thực hiện ${unrealized >= 0 ? '+' : ''}${money(unrealized, inv.currency)}</span><span class="${realized >= 0 ? 'green' : 'red'}">Đã thực hiện ${realized >= 0 ? '+' : ''}${money(realized, inv.currency)}</span></div>
        ${n(inv.total_dividends) > 0 ? `<small class="muted">Cổ tức đã nhận: ${money(inv.total_dividends, inv.currency)}</small>` : ''}
        ${simulationWidget(inv)}
      </div>
      <div class="invest-actions-col">
        <button class="btn sm primary" ${act('openSecurityTrade', inv.id, 'buy')}>Mua</button>
        <button class="btn sm" ${act('openSecurityTrade', inv.id, 'sell')}>Bán</button>
        <button class="btn sm" ${act('openSecurityTrade', inv.id, 'dividend')}>Nhận cổ tức</button>
        <button class="btn sm" ${act('openSecurityTrade', inv.id, 'valuation')}>Cập nhật giá</button>
        <button class="btn sm" ${act('openInvestmentEventHistory', inv.id)}>Xem lịch sử</button>
        <button class="btn sm" ${act('openInvestmentNew', inv.id)}>Sửa</button>
        <button class="btn sm" ${act('deleteInvestment', inv.id)}>Xóa</button>
      </div>
    </div>`;
}
function investmentCardSavings(inv) {
  const netCap = F.investmentNetCapital(inv), value = F.investmentCurrentValue(inv), interestReceived = n(inv.total_interest);
  return `
    <div class="invest-body">
      <div class="invest-info">
        <div class="big">${money(value, inv.currency)}</div>
        <strong>${esc(inv.name)}</strong>
        <div class="invest-summary"><span>Gốc + góp thêm ${money(netCap, inv.currency)}</span><span class="green">Lãi thực nhận +${money(interestReceived, inv.currency)}</span></div>
        <small class="muted">${esc(inv.bank_name || '')}${inv.interest_rate_annual ? ` · ${inv.interest_rate_annual}%/năm` : ''}${inv.interest_payment_method ? ` · ${esc(INTEREST_METHOD_LABEL[inv.interest_payment_method] || inv.interest_payment_method)}` : ''}${inv.term_end_date ? ` · Đáo hạn ${esc(String(inv.term_end_date).slice(0, 10))}` : ''}</small>
        ${planStatusWidget(inv)}
        ${simulationWidget(inv)}
      </div>
      <div class="invest-actions-col">
        <button class="btn sm primary" ${act('openInvestmentEvent', inv.id, 'contribution')}>Gửi thêm</button>
        <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'withdrawal')}>Rút tiền</button>
        <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'interest')}>Nhận lãi</button>
        <button class="btn sm" ${act('openInvestmentEvent', inv.id, 'valuation')}>Cập nhật số dư</button>
        <button class="btn sm" ${act('openInvestmentEventHistory', inv.id)}>Xem lịch sử</button>
        <button class="btn sm" ${act('openInvestmentNew', inv.id)}>Sửa</button>
        <button class="btn sm" ${act('deleteInvestment', inv.id)}>Xóa</button>
      </div>
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
// A column per kind, laid out side-by-side in a 4-column board — same
// pattern as Chi tiêu/Tài sản (moneyColumn: title + "＋ Thêm" header,
// stacked items, a total footer) — just hosting full investment cards
// instead of slim money-lines. Always renders all 4 (even empty) so the
// board stays evenly 4-wide instead of leaving a phantom empty track.
function investmentKindColumn(title, kind, list, emptyText) {
  const total = list.filter(inv => (inv.currency || state.base) === state.base).reduce((s, inv) => s + F.investmentCurrentValue(inv), 0);
  return moneyColumn({ title, tone: kind, items: list.map(investmentCard), total: money(total), settingsAction: act('openInvestmentNew'), settingsLabel: '＋ Thêm', emptyText });
}

function renderInvestments() {
  // Root investments only — a NISA's child quỹ/ETF value is already folded
  // into its parent via F.investmentCurrentValue()'s rollup, so counting
  // both here would double it.
  const list = F.investments().filter(inv => !inv.parent_investment_id);
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
  <div class="money-board mt-16">
    ${investmentKindColumn('NISA', 'nisa', F.investmentsByKind('nisa'), 'Chưa có NISA')}
    ${investmentKindColumn('Chứng khoán', 'securities', F.investmentsByKind('securities'), 'Chưa có chứng khoán')}
    ${investmentKindColumn('Tiết kiệm sinh lời', 'savings_interest', F.investmentsByKind('savings_interest'), 'Chưa có tiết kiệm sinh lời')}
    ${investmentKindColumn('Khác', 'other', F.investmentsByKind('other'), 'Chưa có khoản khác')}
  </div>`;
}

Object.assign(window, { renderInvestments });
