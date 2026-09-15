// ==========================================================================
// Tài sản — four balanced columns like Chi tiêu: Tiền mặt & ngân hàng /
// Đầu tư / Khoản phải thu / Nợ phải trả. Every balance here changes ONLY
// through a manual action (+Tiền/-Tiền, Tăng/Giảm dư nợ, or an Đầu tư
// event) — nothing in Chi tiêu ever touches this page.
// ==========================================================================
'use strict';

const ACCOUNT_TYPE_LABEL = { cash: 'Tiền mặt', bank: 'Ngân hàng', savings: 'Tiết kiệm' };

function assetAccountRow(a) {
  const bal = F.accountBalance(a);
  return `<div class="money-line-wrap">
    <button class="money-line" ${act('openAccountAdjustmentHistory', a.id)}><span class="line-label">${esc(a.name)}<small>${esc(ACCOUNT_TYPE_LABEL[a.account_type] || a.account_type)}</small></span><strong class="${bal < 0 ? 'red' : ''}">${money(bal, a.currency)}</strong></button>
    <button class="mini-btn" type="button" aria-label="Tăng tiền ${esc(a.name)}" title="＋ Tiền" ${act('openAccountAdjustment', a.id, 'increase')}>＋</button>
    <button class="mini-btn" type="button" aria-label="Giảm tiền ${esc(a.name)}" title="− Tiền" ${act('openAccountAdjustment', a.id, 'decrease')}>−</button>
    <button class="mini-btn" type="button" aria-label="Sửa ${esc(a.name)}" title="Sửa" ${act('openAccount', a.id)}>✎</button>
    <button class="mini-btn" type="button" aria-label="Xóa ${esc(a.name)}" title="Xóa" ${act('deleteAccount', a.id)}>🗑</button>
  </div>`;
}
function investmentRow(inv) {
  const val = F.investmentCurrentValue(inv);
  return `<div class="money-line-wrap">
    <button class="money-line" ${act('openInvestmentEventHistory', inv.id)}><span class="line-label">${esc(inv.name)}<small>${esc(INVESTMENT_KIND_LABEL[inv.kind] || '')}</small></span><strong>${money(val, inv.currency)}</strong></button>
    <button class="mini-btn" type="button" aria-label="Sửa ${esc(inv.name)}" title="Sửa" ${act('openInvestmentNew', inv.id)}>✎</button>
    <button class="mini-btn" type="button" aria-label="Xóa ${esc(inv.name)}" title="Xóa" ${act('deleteInvestment', inv.id)}>🗑</button>
  </div>`;
}
function receivableRow(d) {
  const bal = F.debtBalance(d);
  return `<div class="money-line-wrap">
    <button class="money-line" ${act('openDebtAdjustmentHistory', d.id)}><span class="line-label">${esc(d.name)}${d.counterparty ? `<small>${esc(d.counterparty)}</small>` : ''}</span><strong class="green">${money(bal, d.currency)}</strong></button>
    <button class="mini-btn" type="button" aria-label="Tăng ${esc(d.name)}" title="Tăng" ${act('openDebtAdjustment', d.id, 'increase')}>＋</button>
    <button class="mini-btn" type="button" aria-label="Giảm ${esc(d.name)}" title="Giảm" ${act('openDebtAdjustment', d.id, 'decrease')}>−</button>
    <button class="mini-btn" type="button" aria-label="Sửa ${esc(d.name)}" title="Sửa" ${act('openDebt', d.id, d.direction)}>✎</button>
    <button class="mini-btn" type="button" aria-label="Xóa ${esc(d.name)}" title="Xóa" ${act('deleteDebt', d.id)}>🗑</button>
  </div>`;
}
function payableRow(d) {
  const bal = F.debtBalance(d);
  return `<div class="money-line-wrap">
    <button class="money-line" ${act('openDebtAdjustmentHistory', d.id)}><span class="line-label">${esc(d.name)}${d.counterparty ? `<small>${esc(d.counterparty)}</small>` : ''}</span><strong class="red">${money(bal, d.currency)}</strong></button>
    <button class="mini-btn" type="button" aria-label="Tăng ${esc(d.name)}" title="Tăng" ${act('openDebtAdjustment', d.id, 'increase')}>＋</button>
    <button class="mini-btn" type="button" aria-label="Giảm ${esc(d.name)}" title="Giảm" ${act('openDebtAdjustment', d.id, 'decrease')}>−</button>
    <button class="mini-btn" type="button" aria-label="Sửa ${esc(d.name)}" title="Sửa" ${act('openDebt', d.id, d.direction)}>✎</button>
    <button class="mini-btn" type="button" aria-label="Xóa ${esc(d.name)}" title="Xóa" ${act('deleteDebt', d.id)}>🗑</button>
  </div>`;
}

function assetColumn() {
  const items = F.assetAccounts().map(assetAccountRow);
  const total = F.assetAccounts().reduce((s, a) => s + F.accountBalance(a), 0);
  return moneyColumn({ title: 'Tiền mặt & ngân hàng', tone: 'income', items, total: money(total), settingsAction: act('openAccount'), settingsLabel: '＋ Thêm', emptyText: 'Chưa có tài khoản' });
}
function investmentColumn() {
  const list = F.investments().filter(inv => (inv.currency || state.base) === state.base && !inv.parent_investment_id);
  const items = list.map(investmentRow);
  const total = F.investmentTotalValue();
  return moneyColumn({ title: 'Đầu tư', tone: 'credit', items, total: money(total), settingsAction: act('openInvestmentNew'), settingsLabel: '＋ Thêm', emptyText: 'Chưa có khoản đầu tư' });
}
function receivablesColumn() {
  const items = F.receivables().map(receivableRow);
  const total = F.totalReceivablesAt('9999-12-31');
  return moneyColumn({ title: 'Khoản phải thu', tone: 'receivable', items, total: money(total), settingsAction: act('openDebt', '', 'receivable'), settingsLabel: '＋ Thêm', emptyText: 'Chưa có khoản phải thu' });
}
function payablesColumn() {
  const items = F.payables().map(payableRow);
  const total = F.totalPayablesAt('9999-12-31');
  return moneyColumn({ title: 'Nợ phải trả', tone: 'debt', items, total: money(total), settingsAction: act('openDebt', '', 'payable'), settingsLabel: '＋ Thêm', emptyText: 'Chưa có khoản nợ' });
}

// "Theo năm" / 6 / 12 tháng toggle for the history chart — module-level so
// it survives the render() re-render the toggle itself triggers.
let assetChartMode = 12;
function setAssetChartMode(mode) { assetChartMode = mode; render(); }
function assetHistoryMonthKeys() {
  if (assetChartMode === 'year') return F.yearMonthKeys(state.month.slice(0, 4));
  return F.trailingMonthKeys(assetChartMode);
}

function renderAccounts() {
  const pos = F.financialPosition();
  const vnd = state.reporting?.show_vnd_conversion ? F.positionInVND(pos) : null;
  const foreign = F.activeAccounts().filter(a => ['cash', 'bank', 'savings'].includes(a.account_type) && (a.currency || state.base) !== state.base);
  const foreignGroups = [...new Set(foreign.map(a => a.currency))].map(cur => {
    const rate = state.reporting?.jpy_vnd_rate;
    const note = state.reporting?.show_vnd_conversion && rate
      ? `Ước tính quy đổi theo tỷ giá đã đặt (1 JPY ≈ ${rate} ${cur}). Số tiền gốc vẫn giữ nguyên bằng ${cur}, chưa tính vào tổng ${esc(state.base)} ở trên.`
      : `Chưa tính vào tổng ${esc(state.base)} ở trên. Bật quy đổi ở Cài đặt để xem ước tính.`;
    const list = foreign.filter(a => a.currency === cur);
    return `<section class="card section mt-16"><div class="section-head"><h2>Tài khoản ngoại tệ · ${esc(cur)}</h2><span class="count-tag">${list.length} tài khoản</span></div><p class="note">${esc(note)}</p><div class="money-items">${list.map(assetAccountRow).join('')}</div></section>`;
  }).join('');
  const investByKind = kind => F.investmentsByKind(kind).filter(inv => (inv.currency || state.base) === state.base).reduce((s, inv) => s + F.investmentCurrentValue(inv), 0);
  const composition = [
    { label: 'Tiền mặt & NH', value: pos.liquid },
    { label: 'NISA', value: investByKind('nisa') },
    { label: 'Chứng khoán', value: investByKind('securities') },
    { label: 'Tiết kiệm sinh lời', value: investByKind('savings_interest') },
    { label: 'Đầu tư khác', value: investByKind('other') },
    { label: 'Khoản phải thu', value: pos.receivables },
    { label: 'Tổng nợ', value: -pos.payables }
  ];
  const historyRows = F.assetHistorySeries(assetHistoryMonthKeys());
  const historySeries = [
    { key: 'totalAssets', label: 'Tổng tài sản', color: '#30d17f' },
    { key: 'totalDebt', label: 'Tổng nợ', color: '#f25c66' },
    { key: 'netWorth', label: 'Tài sản ròng', color: '#5aa9e6' },
    { key: 'investedCapital', label: 'Tổng vốn đầu tư', color: '#c67af0' },
    { key: 'investedValue', label: 'Giá trị đầu tư hiện tại', color: '#f5a623' }
  ];

  return `<div class="view-head"><div><h2>Tài sản gia đình</h2><p>Số dư/dư nợ thay đổi CHỈ qua các nút thủ công trong từng cột. Không dữ liệu nào từ Chi tiêu tự động thay đổi trang này.</p></div></div>
  <div class="grid kpi-grid">
    ${kpiCard('Tiền thanh khoản', money(pos.liquid), 'Tiền mặt + tài khoản ngân hàng')}
    ${kpiCard('Tổng đầu tư', money(pos.invested), 'NISA + Chứng khoán + Tiết kiệm sinh lời + khác')}
    ${kpiCard('Tổng nợ', money(pos.payables), 'Nợ phải trả', pos.payables > 0 ? 'red' : '')}
    ${kpiCard('Tài sản ròng', money(pos.netWorth), vnd ? `≈ ${money(vnd.netWorth, 'VND')}` : 'Thanh khoản + Đầu tư + Phải thu − Tổng nợ', pos.netWorth >= 0 ? 'green' : 'red')}
  </div>

  <div class="money-board mt-16">${assetColumn()}${investmentColumn()}${receivablesColumn()}${payablesColumn()}</div>

  ${foreign.length ? foreignGroups : ''}

  <div class="grid section-grid mt-16">
    <section class="card section chart-card"><div class="section-head"><div><h2>Cơ cấu tài sản</h2><p>Số dư hiện tại theo nhóm</p></div></div>${barChartSvg(composition)}</section>

    <section class="card section chart-card">
      <div class="section-head"><div><h2>Lịch sử theo tháng</h2><p>Tổng tài sản, tổng nợ, tài sản ròng và đầu tư</p></div>
        <div class="row">
          <button class="btn sm ${assetChartMode === 6 ? 'primary' : ''}" ${act('setAssetChartMode', 6)}>6 tháng</button>
          <button class="btn sm ${assetChartMode === 12 ? 'primary' : ''}" ${act('setAssetChartMode', 12)}>12 tháng</button>
          <button class="btn sm ${assetChartMode === 'year' ? 'primary' : ''}" ${act('setAssetChartMode', 'year')}>Theo năm</button>
        </div>
      </div>
      ${multiLineSvg(historyRows, historySeries)}
    </section>
  </div>`;
}

Object.assign(window, { renderAccounts, setAssetChartMode });
