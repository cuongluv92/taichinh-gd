state.assetTab = state.assetTab || 'all';
state.budgetTxExpanded = state.budgetTxExpanded || false;

function txAmountBaseV3(t){
  const cur=t.currency||state.base, amount=n(t.amount), fx=n(t.fx_rate||1);
  if(cur===state.base) return amount;
  if(fx>0 && Math.abs(fx-1)>1e-12) return amount*fx;
  return null;
}
function monthKeyV3(date=new Date()){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
}
function shiftMonthKeyV3(key,delta){
  const [y,m]=key.split('-').map(Number); const d=new Date(y,m-1+delta,1);
  return monthKeyV3(d);
}
function monthTxV3(key=state.month){
  return (state.fullTransactions||[]).filter(t=>String(t.transaction_date||'').slice(0,7)===key);
}
function categoryAtV3(categoryId,date){
  const versions=(state.categoryVersions||[]).filter(v=>v.category_id===categoryId && String(v.effective_month).slice(0,10)<=String(date).slice(0,10))
    .sort((a,b)=>String(b.effective_month).localeCompare(String(a.effective_month)));
  return versions[0] || (state.categories||[]).find(c=>c.id===categoryId) || {};
}
function expenseTypeV3(t){ return categoryAtV3(t.category_id,t.transaction_date).cost_type || 'variable'; }
function flowToTypeV3(type,txs){
  const ids=new Set(activeAccounts().filter(a=>a.account_type===type).map(a=>a.id)); let total=0;
  txs.forEach(t=>{
    if(!['transfer','goal_save','goal_withdraw'].includes(t.transaction_type)) return;
    const amount=txAmountBaseV3(t); if(amount===null) return;
    if(ids.has(t.transfer_account_id)) total+=amount;
    if(ids.has(t.account_id)) total-=amount;
  });
  return total;
}
function periodStatsV3(txs){
  let income=0,fixed=0,variable=0,debtPay=0;
  txs.forEach(t=>{
    const amount=txAmountBaseV3(t); if(amount===null) return;
    if(t.transaction_type==='income') income+=amount;
    else if(t.transaction_type==='expense') (expenseTypeV3(t)==='fixed'?fixed+=amount:variable+=amount);
    else if(t.transaction_type==='loan_pay') debtPay+=amount;
  });
  const saving=flowToTypeV3('savings',txs), investment=flowToTypeV3('investment',txs);
  const expense=fixed+variable, positiveSaving=Math.max(0,saving), positiveInvestment=Math.max(0,investment);
  const allocated=expense+positiveSaving+positiveInvestment+debtPay;
  return {income,fixed,variable,expense,saving,investment,debtPay,allocated,
    remaining:income-allocated, overspend:Math.max(0,allocated-income)};
}
function monthTotals(){
  const s=periodStatsV3(monthTxV3()); return {inc:s.income,exp:s.expense,net:s.income-s.expense};
}
function actualByCategory(id){
  return monthTxV3().filter(t=>t.transaction_type==='expense'&&t.category_id===id)
    .reduce((sum,t)=>sum+(txAmountBaseV3(t)??0),0);
}
function categoryMonthAmount(id,direction){
  return monthTxV3().filter(t=>t.transaction_type===direction&&t.category_id===id)
    .reduce((sum,t)=>sum+(txAmountBaseV3(t)??0),0);
}
function accountBalance(a){
  let bal=n(a.opening_balance);
  (state.fullTransactions||[]).forEach(t=>{
    if((t.currency||state.base)!==(a.currency||state.base)) return;
    if(t.account_id===a.id){
      if(['income','loan_borrow','loan_collect','loan_repayment','investment_gain'].includes(t.transaction_type)) bal+=n(t.amount);
      else if(['expense','transfer','loan_lend','loan_out','loan_pay','goal_save','goal_withdraw','investment_loss'].includes(t.transaction_type)) bal-=n(t.amount);
    }
    if(['transfer','goal_save','goal_withdraw'].includes(t.transaction_type)&&t.transfer_account_id===a.id) bal+=n(t.amount);
  });
  return bal;
}
function baseMoneyAccountsV3(){return activeAccounts().filter(a=>(a.currency||state.base)===state.base)}
function baseReceivableV3(){return (state.loans||[]).filter(l=>l.loan_type==='lent'&&(l.currency||state.base)===state.base).reduce((s,l)=>s+n(l.remaining_amount),0)}
function baseBorrowedV3(){return (state.loans||[]).filter(l=>l.loan_type==='borrowed'&&(l.currency||state.base)===state.base).reduce((s,l)=>s+n(l.remaining_amount),0)}
function assetSnapshotV3(){
  const ac=baseMoneyAccountsV3();
  const liquid=ac.filter(a=>['cash','bank','savings'].includes(a.account_type)).reduce((s,a)=>s+Math.max(0,accountBalance(a)),0);
  const investment=ac.filter(a=>a.account_type==='investment').reduce((s,a)=>s+Math.max(0,accountBalance(a)),0);
  const cardDebt=ac.filter(a=>['credit','loan_payable'].includes(a.account_type)).reduce((s,a)=>s+Math.max(0,-accountBalance(a)),0);
  const receivable=baseReceivableV3(), borrowed=baseBorrowedV3(), debt=cardDebt+borrowed;
  const assets=liquid+investment+receivable;
  return {liquid,investment,receivable,assets,debt,netWorth:assets-debt,cardDebt,borrowed};
}
function baseNetWorth(){return assetSnapshotV3().netWorth}
function baseBorrowedDebt(){return assetSnapshotV3().debt}
function baseReceivables(){return assetSnapshotV3().receivable}
function baseLiquid(){return assetSnapshotV3().liquid}

function foreignNoticeV3(txs){
  const count=txs.filter(t=>(t.currency||state.base)!==state.base && !(n(t.fx_rate)>0 && Math.abs(n(t.fx_rate)-1)>1e-12)).length;
  return count?`<div class="v3-note">Có ${count} giao dịch ngoại tệ chưa có tỷ giá quy đổi nên không được cộng vào tổng ${state.base}.</div>`:'';
}
function pctV3(value,total){return total>0?value/total*100:0}
function avgExpenseV3(){
  const keys=[-2,-1,0].map(i=>shiftMonthKeyV3(state.month,i));
  const vals=keys.map(k=>periodStatsV3(monthTxV3(k)).expense).filter(v=>v>0);
  return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
}
function topExpenseV3(txs){
  const map=new Map();
  txs.filter(t=>t.transaction_type==='expense').forEach(t=>{
    const amount=txAmountBaseV3(t); if(amount===null)return;
    const c=categoryAtV3(t.category_id,t.transaction_date); const name=c.name||t.category_name||'Khác';
    map.set(name,(map.get(name)||0)+amount);
  });
  return [...map.entries()].sort((a,b)=>b[1]-a[1])[0]||null;
}
function healthV3(){
  const s=periodStatsV3(monthTxV3()), snap=assetSnapshotV3(), avg=avgExpenseV3(), top=topExpenseV3(monthTxV3());
  const saveInvest=Math.max(0,s.saving)+Math.max(0,s.investment);
  const coverage=avg>0?snap.liquid/avg:null;
  const cards=[
    ['Tỷ lệ chi / thu',s.income>0?`${pctV3(s.expense,s.income).toFixed(0)}%`:'—',s.income>0?(s.expense/s.income<=0.7?'Ổn định':s.expense/s.income<=0.9?'Cần theo dõi':'Đang cao'):'Cần ghi thu nhập'],
    ['Để dành + đầu tư',s.income>0?`${pctV3(saveInvest,s.income).toFixed(0)}%`:'—',money(saveInvest)],
    ['Đệm tiền mặt',coverage===null?'—':`${coverage.toFixed(1)} tháng`,avg>0?`Theo chi tiêu TB ${money(avg)}/tháng`:'Chưa đủ dữ liệu'],
    ['Nợ / tài sản',snap.assets>0?`${pctV3(snap.debt,snap.assets).toFixed(0)}%`:snap.debt>0?'∞':'0%',snap.debt?money(snap.debt):'Không có dư nợ']
  ];
  const insights=[];
  if(!monthTxV3().length) insights.push('Bắt đầu bằng ghi thu nhập và vài khoản chi; các biểu đồ sẽ tự hoàn thiện.');
  if(s.income>0 && s.expense>s.income) insights.push(`Chi tiêu đang vượt thu nhập ${money(s.expense-s.income)}.`);
  if(s.income>0 && s.fixed/s.income>0.5) insights.push(`Chi cố định chiếm ${pctV3(s.fixed,s.income).toFixed(0)}% thu nhập — khá cao.`);
  if(top) insights.push(`Mục chi lớn nhất tháng này là ${top[0]}: ${money(top[1])}.`);
  if(coverage!==null && coverage<3) insights.push(`Tiền khả dụng hiện chỉ tương đương khoảng ${coverage.toFixed(1)} tháng chi tiêu.`);
  if(!insights.length) insights.push('Dòng tiền tháng này đang cân đối. Tiếp tục nhập đều để theo dõi xu hướng.');
  return {cards,insights,s};
}
function trendSvg(){
  const keys=Array.from({length:12},(_,i)=>shiftMonthKeyV3(state.month,i-11));
  const data=keys.map(k=>{const s=periodStatsV3(monthTxV3(k));return {k,inc:s.income,exp:s.expense}});
  const W=760,H=260,pad=32,max=Math.max(1,...data.flatMap(x=>[x.inc,x.exp])),group=(W-pad*2)/12,bw=13;
  const grid=[0,1,2,3].map(i=>{const y=pad+(H-pad*2)*i/3;return `<line x1="${pad}" y1="${y}" x2="${W-pad}" y2="${y}" class="v3-gridline"/>`}).join('');
  const bars=data.map((x,i)=>{const cx=pad+group*i+group/2,ih=(H-pad*2)*x.inc/max,eh=(H-pad*2)*x.exp/max;
    return `<g><title>${x.k}: Thu ${money(x.inc)} · Chi ${money(x.exp)}</title><rect x="${cx-bw-2}" y="${H-pad-ih}" width="${bw}" height="${ih}" rx="4" class="v3-bar-income"/><rect x="${cx+2}" y="${H-pad-eh}" width="${bw}" height="${eh}" rx="4" class="v3-bar-expense"/><text x="${cx}" y="${H-9}" text-anchor="middle" class="v3-axis">${Number(x.k.slice(5))}</text></g>`}).join('');
  return `<svg class="v3-trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Thu chi 12 tháng">${grid}${bars}</svg><div class="v3-chart-key"><span><i class="income"></i>Thu</span><span><i class="expense"></i>Chi</span></div>`;
}
function expenseBarsV3(txs){
  const map=new Map();
  txs.filter(t=>t.transaction_type==='expense').forEach(t=>{
    const amount=txAmountBaseV3(t); if(amount===null)return;
    const name=categoryAtV3(t.category_id,t.transaction_date).name||t.category_name||'Khác'; map.set(name,(map.get(name)||0)+amount);
  });
  const rows=[...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8),max=Math.max(1,...rows.map(x=>x[1]));
  if(!rows.length)return '<div class="viz-empty">Chưa có chi tiêu trong kỳ này</div>';
  return `<div class="v3-rank-bars">${rows.map(([name,val],i)=>`<div class="v3-rank-row"><span>${i+1}. ${esc(name)}</span><div><i style="width:${Math.max(5,val/max*100)}%"></i></div><strong>${money(val)}</strong></div>`).join('')}</div>`;
}
function assetItemsV3(){
  const s=assetSnapshotV3();
  return [{label:'Tiền khả dụng',value:s.liquid},{label:'Đầu tư',value:s.investment},{label:'Phải thu',value:s.receivable}];
}

function titleFor(v){
  const map={
    dashboard:['Tổng quan','Bức tranh tài chính của gia đình'],
    budget:['Ngân sách','Ghi tiền nhanh và xem giao dịch theo tháng'],
    assets:['Tài sản','Tài khoản, tiết kiệm, đầu tư và dư nợ'],
    analytics:['Phân tích','So sánh tháng, năm và xu hướng tài chính'],
    goals:['Mục tiêu & nợ','Mục tiêu tiết kiệm, khoản phải trả và phải thu'],
    settings:['Cài đặt','Danh mục, dữ liệu và thiết bị']
  };
  return map[v]||map.dashboard;
}
function navigate(v){
  if(v==='transactions'){state.budgetTxExpanded=true;v='budget'}
  if(v==='accounts'||v==='investments')v='assets';
  state.view=v;
  $$('#nav button,#mobileNav button').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
  const [t,s]=titleFor(v); $('#pageTitle').textContent=t; $('#pageSubtitle').textContent=s; render();
}
function setAssetTabV3(tab){state.assetTab=tab;render()}
function toggleBudgetHistoryV3(){state.budgetTxExpanded=!state.budgetTxExpanded;render()}

function openTransaction(id='',defaults={}){
  const found=(state.fullTransactions||[]).find(x=>x.id===id);
  if(found && isDebtTransaction(found)){
    const loan=linkedLoanForTransaction(found); if(loan&&['loan_pay','loan_collect'].includes(found.transaction_type))return openLoanPayment(loan.id);
    return toast('Giao dịch vay/nợ được quản lý trong Mục tiêu & nợ.',true);
  }
  if(found && ['goal_save','goal_withdraw','investment_gain','investment_loss'].includes(found.transaction_type))
    return toast('Giao dịch này được quản lý tại Mục tiêu hoặc Tài sản.',true);
  const t=found||defaults||{}, type=['income','expense','transfer'].includes(t.transaction_type)?t.transaction_type:'expense';
  const normalAccounts=activeAccounts().filter(a=>['cash','bank','credit','savings'].includes(a.account_type));
  const allAccounts=activeAccounts(), selected=t.account_id||defaultMoneyAccountId();
  modal(id?'Sửa giao dịch':'Ghi giao dịch',`<div class="form-grid v3-form">
    <div class="field"><label>Loại</label><select name="transaction_type" id="txType"><option value="expense" ${type==='expense'?'selected':''}>Chi tiêu</option><option value="income" ${type==='income'?'selected':''}>Thu nhập</option><option value="transfer" ${type==='transfer'?'selected':''}>Chuyển tiền</option></select></div>
    <div class="field"><label>Số tiền</label><input name="amount" type="number" min="1" step="1" value="${esc(t.amount||'')}" required autofocus></div>
    <div class="field"><label>Ngày</label><input name="transaction_date" type="date" value="${esc(t.transaction_date||today())}" required></div>
    <div class="field"><label>Tài khoản</label><select name="account_id" id="txAccount" required><option value="">— Chọn —</option>${options(type==='transfer'?allAccounts:normalAccounts,selected)}</select><small id="txCurrencyHint"></small></div>
    <div class="field" id="categoryField"><label>Danh mục</label><select name="category_id" id="txCategory"></select></div>
    <div class="field hidden" id="transferField"><label>Chuyển đến</label><select name="transfer_account_id" id="txTransfer"><option value="">— Chọn —</option></select></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(t.note||'')}" placeholder="Tùy chọn"></div>
  </div>`,async fd=>{
    const from=activeAccounts().find(a=>a.id===fd.account_id); if(!from)throw new Error('Hãy chọn tài khoản.');
    const currency=from.currency||state.base;
    if(fd.transaction_type!=='transfer'&&!fd.category_id)throw new Error('Hãy chọn danh mục.');
    if(fd.transaction_type==='transfer'){
      const to=activeAccounts().find(a=>a.id===fd.transfer_account_id); if(!to)throw new Error('Hãy chọn tài khoản nhận.');
      if(to.id===from.id)throw new Error('Hai tài khoản phải khác nhau.');
      if((to.currency||state.base)!==currency)throw new Error('Hiện tại chỉ chuyển tự động giữa hai tài khoản cùng tiền tệ.');
    }
    await api('save_transaction',{...fd,id:id||null,currency,fx_rate:1,category_id:fd.transaction_type==='transfer'?null:fd.category_id,transfer_account_id:fd.transaction_type==='transfer'?fd.transfer_account_id:null});
  },'Lưu giao dịch');
  const typeEl=$('#txType'),accountEl=$('#txAccount'),cat=$('#txCategory'),transfer=$('#txTransfer');
  const sync=()=>{
    const tr=typeEl.value==='transfer';
    const keepAccount=accountEl.value||selected, pool=tr?allAccounts:normalAccounts;
    if(!pool.some(a=>a.id===accountEl.value)) accountEl.innerHTML='<option value="">— Chọn —</option>'+options(pool,keepAccount);
    const from=activeAccounts().find(a=>a.id===accountEl.value),cur=from?.currency||state.base;
    $('#categoryField').classList.toggle('hidden',tr);$('#transferField').classList.toggle('hidden',!tr);
    $('#txCurrencyHint').textContent=from?`Tiền tệ: ${cur}`:'';
    if(!tr){
      const keep=cat.value||t.category_id||'';cat.innerHTML='<option value="">— Chọn —</option>'+options(activeCategories(typeEl.value),keep);
    }else{
      const dest=activeAccounts().filter(a=>a.id!==accountEl.value&&(a.currency||state.base)===cur);
      transfer.innerHTML='<option value="">— Chọn —</option>'+options(dest,t.transfer_account_id);
    }
  };
  typeEl.onchange=sync; accountEl.onchange=sync; sync();
}
function openAccount(id=''){
  const a=state.accounts.find(x=>x.id===id)||{}, hasTx=id&&(state.fullTransactions||[]).some(t=>t.account_id===id||t.transfer_account_id===id);
  const type=a.account_type||'bank',currency=a.currency||state.base;
  modal(id?'Sửa tài khoản':'Thêm tài khoản',`<div class="form-grid v3-form">
    <div class="field full"><label>Tên tài khoản</label><input name="name" value="${esc(a.name||'')}" placeholder="Ví dụ: MUFG, Tiền mặt, NISA" required></div>
    <div class="field"><label>Loại</label><select name="account_type" ${hasTx?'disabled':''}>${[['cash','Tiền mặt'],['bank','Ngân hàng'],['savings','Tiết kiệm'],['credit','Thẻ tín dụng'],['investment','Đầu tư']].map(([v,l])=>`<option value="${v}" ${type===v?'selected':''}>${l}</option>`).join('')}</select>${hasTx?'<small>Đã có giao dịch nên loại tài khoản được khóa.</small>':''}</div>
    <div class="field"><label>Tiền tệ</label><select name="currency" ${hasTx?'disabled':''}><option value="JPY" ${currency==='JPY'?'selected':''}>JPY</option><option value="VND" ${currency==='VND'?'selected':''}>VND</option></select></div>
    <div class="field full"><label>Số dư ban đầu</label><input name="opening_balance" type="number" step="1" value="${esc(a.opening_balance||0)}" ${hasTx?'readonly':''}>${hasTx?'<small>Đã có giao dịch; không đổi số dư gốc để tránh lệch lịch sử.</small>':''}</div>
    ${hasTx?`<input type="hidden" name="account_type" value="${esc(type)}"><input type="hidden" name="currency" value="${esc(currency)}">`:''}
  </div>`,fd=>api('save_account',{...fd,id:id||null,account_type:fd.account_type||type,currency:fd.currency||currency,opening_balance:hasTx?a.opening_balance:fd.opening_balance}));
}
function openLoanPayment(id){
  const l=state.loans.find(x=>x.id===id);if(!l)return toast('Không tìm thấy khoản nợ.',true);
  if(n(l.remaining_amount)<=0)return toast('Khoản này đã tất toán.');
  const borrowed=l.loan_type==='borrowed', ac=activeAccounts().filter(a=>(a.currency||state.base)===(l.currency||state.base)&&['cash','bank','savings'].includes(a.account_type));
  if(!ac.length)return toast(`Cần tài khoản ${l.currency||state.base} để ${borrowed?'trả':'nhận'} tiền.`,true);
  modal(borrowed?'Trả nợ':'Thu hồi khoản cho vay',`<div class="form-grid v3-form">
    <div class="field full"><label>${borrowed?'Phải trả':'Phải thu'}</label><input value="${esc(l.counterparty)} · ${money(l.remaining_amount,l.currency)}" disabled></div>
    <div class="field"><label>Số tiền</label><input name="amount" type="number" min="1" max="${esc(l.remaining_amount)}" value="${esc(l.remaining_amount)}" required autofocus></div>
    <div class="field"><label>Tài khoản</label><select name="account_id" required>${options(ac,ac[0].id)}</select></div>
    <div class="field"><label>Ngày</label><input name="transaction_date" type="date" value="${today()}" required></div>
    <div class="field full"><label>Ghi chú</label><input name="note"></div>
  </div>`,fd=>debtApi('payment',{loan_id:id,...fd}),borrowed?'Ghi trả nợ':'Ghi thu tiền');
}
function openCreditPayment(targetId){
  const target=activeAccounts().find(a=>a.id===targetId);if(!target)return toast('Không tìm thấy tài khoản.',true);
  const debt=Math.max(0,-accountBalance(target));if(!debt)return toast('Tài khoản này không có dư nợ.');
  const sources=activeAccounts().filter(a=>a.id!==targetId&&['bank','cash','savings'].includes(a.account_type)&&(a.currency||state.base)===(target.currency||state.base));
  if(!sources.length)return toast(`Cần tài khoản ${target.currency||state.base} để thanh toán.`,true);
  modal(`Thanh toán ${esc(target.name)}`,`<div class="form-grid v3-form">
    <div class="field"><label>Số tiền</label><input name="amount" type="number" min="1" max="${debt}" value="${debt}" required autofocus></div>
    <div class="field"><label>Trả từ</label><select name="account_id" required>${options(sources,sources[0].id)}</select></div>
    <div class="field"><label>Ngày</label><input name="transaction_date" type="date" value="${today()}" required></div>
  </div>`,fd=>api('save_transaction',{transaction_type:'transfer',amount:fd.amount,currency:target.currency||state.base,fx_rate:1,transaction_date:fd.transaction_date,account_id:fd.account_id,transfer_account_id:targetId,category_id:null,note:`Thanh toán ${target.name}`}),'Thanh toán');
}

function dashboard(){
  const h=healthV3(),s=h.s,snap=assetSnapshotV3(),txs=monthTxV3(),alloc=[
    {label:'Chi cố định',value:s.fixed},{label:'Chi biến động',value:s.variable},{label:'Tiết kiệm',value:Math.max(0,s.saving)},
    {label:'Đầu tư',value:Math.max(0,s.investment)},{label:'Trả nợ',value:s.debtPay},{label:'Còn lại',value:Math.max(0,s.remaining)}
  ], assets=assetItemsV3();
  const recent=txs.slice().sort((a,b)=>String(b.transaction_date).localeCompare(String(a.transaction_date))).slice(0,6);
  return `<section class="v3-hero">
    <div><span>TÀI SẢN RÒNG</span><strong class="${snap.netWorth<0?'red':''}">${money(snap.netWorth)}</strong><small>${state.base} · Tài sản ${money(snap.assets)} − Nợ ${money(snap.debt)}</small></div>
    <div class="v3-hero-stats"><div><span>Thu tháng</span><b>${money(s.income)}</b></div><div><span>Chi tháng</span><b>${money(s.expense)}</b></div><div><span>Còn sau phân bổ</span><b class="${s.remaining>=0?'green':'red'}">${money(s.remaining)}</b></div></div>
  </section>
  <div class="v3-quick"><button onclick="openQuick('income')"><b>＋</b><span>Thu</span></button><button onclick="openQuick('expense')"><b>−</b><span>Chi</span></button><button onclick="openQuick('transfer')"><b>⇄</b><span>Chuyển</span></button><button onclick="openInvestmentAccount()"><b>↗</b><span>Đầu tư</span></button></div>
  ${foreignNoticeV3(txs)}
  <div class="v3-grid-2">
    <section class="v3-card"><div class="v3-section-head"><div><h2>Phân bổ thu nhập</h2><p>${state.month.replace('-','/')}</p></div><button onclick="navigate('analytics')">Chi tiết</button></div><div class="donut-layout"><div class="donut-wrap">${donutSvg(alloc,170,22)}<div class="donut-center"><span>Thu</span><strong>${money(s.income)}</strong></div></div>${legendHtml(alloc,'income',s.income)}</div></section>
    <section class="v3-card"><div class="v3-section-head"><div><h2>Chi tiêu ít / nhiều</h2><p>Xếp hạng trong tháng</p></div><button onclick="navigate('budget')">Nhập chi</button></div>${expenseBarsV3(txs)}</section>
  </div>
  <section class="v3-card"><div class="v3-section-head"><div><h2>12 tháng gần nhất</h2><p>So sánh thu nhập và chi tiêu</p></div><button onclick="navigate('analytics')">Xem năm</button></div>${trendSvg()}</section>
  <div class="v3-health-grid">${h.cards.map(c=>`<section><span>${c[0]}</span><strong>${c[1]}</strong><small>${c[2]}</small></section>`).join('')}</div>
  <section class="v3-insights"><div><b>Gợi ý tháng này</b>${h.insights.map(x=>`<p>• ${esc(x)}</p>`).join('')}</div></section>
  <section class="v3-card"><div class="v3-section-head"><div><h2>Giao dịch gần đây</h2><p>${state.month.replace('-','/')}</p></div><button onclick="navigate('budget')">Tất cả</button></div>${txList(recent,false)}</section>`;
}
function budget(){
  const txs=monthTxV3(),s=periodStatsV3(txs),incomeCats=activeCategories('income'),expenseCats=activeCategories('expense'),
    fixed=expenseCats.filter(c=>c.cost_type==='fixed'),variable=expenseCats.filter(c=>c.cost_type!=='fixed');
  const line=(c,d)=>`<button class="v3-money-line" onclick="openCategoryTransaction('${c.id}','${d}')"><span>${esc(c.name)}</span><strong>${money(categoryMonthAmount(c.id,d))}</strong></button>`;
  const borrowed=(state.loans||[]).filter(l=>l.loan_type==='borrowed'&&n(l.remaining_amount)>0);
  const cards=activeAccounts().filter(a=>['credit','loan_payable'].includes(a.account_type)&&accountBalance(a)<0);
  const debtItems=[...borrowed.map(l=>`<button class="v3-money-line" onclick="openLoanPayment('${l.id}')"><span>${esc(l.counterparty)}</span><strong>${money(l.remaining_amount,l.currency)}</strong></button>`),
    ...cards.map(a=>`<button class="v3-money-line" onclick="openCreditPayment('${a.id}')"><span>${esc(a.name)}</span><strong>${money(Math.abs(accountBalance(a)),a.currency)}</strong></button>`)];
  const column=(title,tone,items,total,action)=>`<section class="v3-money-col ${tone}"><div class="v3-money-head"><h3>${title}</h3><button onclick="${action}">＋</button></div><div class="v3-money-body">${items.length?items.join(''):'<div class="v3-empty">Chưa có dữ liệu</div>'}</div><div class="v3-money-total"><span>Tổng</span><strong>${total}</strong></div></section>`;
  const sorted=txs.slice().sort((a,b)=>String(b.transaction_date).localeCompare(String(a.transaction_date))), shown=state.budgetTxExpanded?sorted:sorted.slice(0,8);
  return `<div class="v3-summary-strip"><div><span>Thu nhập</span><strong>${money(s.income)}</strong></div><div><span>Chi tiêu</span><strong>${money(s.expense)}</strong></div><div><span>Tiết kiệm + đầu tư</span><strong>${money(Math.max(0,s.saving)+Math.max(0,s.investment))}</strong></div><div><span>Còn lại</span><strong class="${s.remaining>=0?'green':'red'}">${money(s.remaining)}</strong></div></div>
  ${foreignNoticeV3(txs)}
  <div class="v3-money-grid">
    ${column('Thu nhập','income',incomeCats.map(c=>line(c,'income')),money(s.income),"openTransaction('',{transaction_type:'income'})")}
    ${column('Chi cố định','fixed',fixed.map(c=>line(c,'expense')),money(s.fixed),"openCategory()")}
    ${column('Chi biến động','variable',variable.map(c=>line(c,'expense')),money(s.variable),"openCategory()")}
    ${column('Nợ','debt',debtItems,money(assetSnapshotV3().debt),"openLoan()")}
  </div>
  <section class="v3-card"><div class="v3-section-head"><div><h2>Giao dịch tháng</h2><p>${sorted.length} giao dịch</p></div><div><button onclick="openTransaction()">＋ Giao dịch</button><button data-v3-action="toggle-history">${state.budgetTxExpanded?'Thu gọn':'Xem tất cả'}</button></div></div>${txList(shown,true)}</section>`;
}
function assetTypeLabelV3(type){return ({cash:'Tiền mặt',bank:'Ngân hàng',savings:'Tiết kiệm',credit:'Thẻ tín dụng',investment:'Đầu tư',loan_receivable:'Phải thu',loan_payable:'Phải trả'})[type]||type}
function assets(){
  const snap=assetSnapshotV3(),all=activeAccounts(),tab=state.assetTab;
  const visible=all.filter(a=>{
    if(tab==='all')return true;if(tab==='cash')return ['cash','bank'].includes(a.account_type);if(tab==='savings')return a.account_type==='savings';
    if(tab==='investment')return a.account_type==='investment';if(tab==='debt')return ['credit','loan_payable'].includes(a.account_type);return true;
  });
  const invest=all.filter(a=>a.account_type==='investment'),pie=assetItemsV3();
  return `<div class="v3-summary-strip assets"><div><span>Tổng tài sản</span><strong>${money(snap.assets)}</strong></div><div><span>Tiền khả dụng</span><strong>${money(snap.liquid)}</strong></div><div><span>Đầu tư</span><strong>${money(snap.investment)}</strong></div><div><span>Tổng nợ</span><strong class="${snap.debt?'red':''}">${money(snap.debt)}</strong></div></div>
  <div class="v3-assets-toolbar"><div class="v3-tabs">${[['all','Tất cả'],['cash','Tiền'],['savings','Tiết kiệm'],['investment','Đầu tư'],['debt','Nợ']].map(([v,l])=>`<button data-v3-action="asset-tab" data-tab="${v}" class="${tab===v?'active':''}">${l}</button>`).join('')}</div><div><button onclick="openTransfer()">⇄ Chuyển</button><button onclick="openAccount()">＋ Tài khoản</button></div></div>
  <div class="v3-grid-2 assets-top"><section class="v3-card"><div class="v3-section-head"><div><h2>Cơ cấu tài sản</h2><p>Không cộng nợ vào biểu đồ tài sản</p></div></div><div class="donut-layout"><div class="donut-wrap">${donutSvg(pie,170,22)}<div class="donut-center"><span>Tổng</span><strong>${money(snap.assets)}</strong></div></div>${legendHtml(pie)}</div></section>
  <section class="v3-card"><div class="v3-section-head"><div><h2>Tài sản ròng</h2><p>Tài sản − nợ</p></div></div><div class="v3-networth"><strong class="${snap.netWorth<0?'red':''}">${money(snap.netWorth)}</strong><span>${money(snap.assets)} − ${money(snap.debt)}</span></div></section></div>
  <div class="v3-account-grid">${visible.length?visible.map(a=>{const bal=accountBalance(a),debt=['credit','loan_payable'].includes(a.account_type)&&bal<0,inv=a.account_type==='investment';
    return `<article class="v3-account-card ${debt?'is-debt':''}"><div><span>${assetTypeLabelV3(a.account_type)} · ${a.currency}</span><button onclick="openAccount('${a.id}')">•••</button></div><h3>${esc(a.name)}</h3><strong class="${bal<0?'red':''}">${money(bal,a.currency)}</strong><footer>${inv?`<button onclick="openInvestmentTransfer('${a.id}','in')">Nạp</button><button onclick="openInvestmentTransfer('${a.id}','out')">Rút</button><button onclick="openInvestmentValue('${a.id}')">Định giá</button>`:debt?`<button onclick="openCreditPayment('${a.id}')">Thanh toán</button>`:`<button onclick="openTransfer('${a.id}')">Chuyển tiền</button><button onclick="openTransaction('',{account_id:'${a.id}',transaction_type:'expense'})">Ghi chi</button>`}</footer></article>`}).join(''):'<div class="v3-empty-card">Chưa có tài khoản trong nhóm này.</div>'}</div>
  ${tab==='investment'||tab==='all'?`<section class="v3-card"><div class="v3-section-head"><div><h2>Đầu tư</h2><p>${invest.length} tài khoản đầu tư</p></div><button onclick="openInvestmentAccount()">＋ Tạo đầu tư</button></div>${invest.length?`<div class="v3-invest-list">${invest.map(a=>{const cur=accountBalance(a),cap=investmentCapital(a),pl=cur-cap;return `<div><span>${esc(a.name)}</span><strong>${money(cur,a.currency)}</strong><small class="${pl>=0?'green':'red'}">${pl>=0?'+':''}${money(pl,a.currency)}</small></div>`}).join('')}</div>`:'<div class="v3-empty">Chưa có tài khoản đầu tư.</div>'}</section>`:''}`;
}
function analytics(){
  const txs=state.analyticsPeriod==='year'?(state.fullTransactions||[]).filter(t=>String(t.transaction_date||'').slice(0,4)===String(state.analyticsYear)):monthTxV3();
  const s=periodStatsV3(txs),snap=assetSnapshotV3(),alloc=[{label:'Cố định',value:s.fixed},{label:'Biến động',value:s.variable},{label:'Tiết kiệm',value:Math.max(0,s.saving)},{label:'Đầu tư',value:Math.max(0,s.investment)},{label:'Trả nợ',value:s.debtPay},{label:'Còn lại',value:Math.max(0,s.remaining)}];
  const ratios=[['Chi / thu',s.income?pctV3(s.expense,s.income):0],['Cố định / thu',s.income?pctV3(s.fixed,s.income):0],['Để dành / thu',s.income?pctV3(Math.max(0,s.saving)+Math.max(0,s.investment),s.income):0],['Nợ / tài sản',snap.assets?pctV3(snap.debt,snap.assets):0]];
  return `<div class="analysis-head"><div><h2>${state.analyticsPeriod==='year'?`Năm ${state.analyticsYear}`:`Tháng ${state.month.replace('-','/')}`}</h2><p>Phân tích dòng tiền và cấu trúc tài sản</p></div><div class="period-switch"><button class="${state.analyticsPeriod==='month'?'active':''}" onclick="setAnalyticsPeriod('month')">Tháng</button><button class="${state.analyticsPeriod==='year'?'active':''}" onclick="setAnalyticsPeriod('year')">Năm</button></div></div>
  ${state.analyticsPeriod==='year'?`<div class="year-switch"><button onclick="shiftAnalyticsYear(-1)">‹</button><strong>${state.analyticsYear}</strong><button onclick="shiftAnalyticsYear(1)">›</button></div>`:''}
  <div class="v3-health-grid">${ratios.map(x=>`<section><span>${x[0]}</span><strong>${x[1].toFixed(0)}%</strong><small>${state.analyticsPeriod==='year'?'Cả năm':'Tháng đang xem'}</small></section>`).join('')}</div>
  ${foreignNoticeV3(txs)}
  <div class="v3-grid-2"><section class="v3-card"><div class="v3-section-head"><div><h2>Phân bổ thu nhập</h2><p>${state.analyticsPeriod==='year'?'Cả năm':'Theo tháng'}</p></div></div><div class="donut-layout"><div class="donut-wrap">${donutSvg(alloc,175,23)}<div class="donut-center"><span>Thu</span><strong>${money(s.income)}</strong></div></div>${legendHtml(alloc,'income',s.income)}</div></section>
  <section class="v3-card"><div class="v3-section-head"><div><h2>Cơ cấu tài sản</h2><p>${state.base}</p></div></div><div class="donut-layout"><div class="donut-wrap">${donutSvg(assetItemsV3(),175,23)}<div class="donut-center"><span>Tài sản</span><strong>${money(snap.assets)}</strong></div></div>${legendHtml(assetItemsV3())}</div></section></div>
  <section class="v3-card"><div class="v3-section-head"><div><h2>${state.analyticsPeriod==='year'?'Thu & chi theo 12 tháng':'Xếp hạng chi tiêu'}</h2><p>${state.analyticsPeriod==='year'?String(state.analyticsYear):state.month.replace('-','/')}</p></div></div>${state.analyticsPeriod==='year'?yearBarsV3(state.analyticsYear):expenseBarsV3(txs)}</section>`;
}
function yearBarsV3(year){
  const keys=Array.from({length:12},(_,i)=>`${year}-${String(i+1).padStart(2,'0')}`),data=keys.map(k=>{const s=periodStatsV3(monthTxV3(k));return {k,inc:s.income,exp:s.expense}});
  const W=760,H=300,pad=34,max=Math.max(1,...data.flatMap(x=>[x.inc,x.exp])),group=(W-pad*2)/12,bw=13;
  return `<svg class="v3-trend-svg" viewBox="0 0 ${W} ${H}">${data.map((x,i)=>{const cx=pad+group*i+group/2,ih=(H-pad*2)*x.inc/max,eh=(H-pad*2)*x.exp/max;return `<g><title>${x.k}: ${money(x.inc)} / ${money(x.exp)}</title><rect x="${cx-bw-2}" y="${H-pad-ih}" width="${bw}" height="${ih}" rx="4" class="v3-bar-income"/><rect x="${cx+2}" y="${H-pad-eh}" width="${bw}" height="${eh}" rx="4" class="v3-bar-expense"/><text x="${cx}" y="${H-9}" text-anchor="middle" class="v3-axis">${i+1}</text></g>`}).join('')}</svg><div class="v3-chart-key"><span><i class="income"></i>Thu</span><span><i class="expense"></i>Chi</span></div>`;
}
function render(){
  if(!state.household)return;
  const views={dashboard,budget,assets,analytics,goals,settings};
  $('#content').innerHTML=(views[state.view]||dashboard)();
  if(state.view==='settings')$('#householdForm')?.addEventListener('submit',saveHousehold);
}
document.addEventListener('click',e=>{
  const el=e.target.closest?.('[data-v3-action]');if(!el)return;
  const action=el.dataset.v3Action;
  if(action==='asset-tab'){e.preventDefault();setAssetTabV3(el.dataset.tab)}
  else if(action==='toggle-history'){e.preventDefault();toggleBudgetHistoryV3()}
  else if(action==='settings'){e.preventDefault();navigate('settings')}
});
Object.assign(window,{navigate,render,dashboard,budget,assets,analytics,openTransaction,openAccount,openLoanPayment,openCreditPayment,setAssetTabV3,toggleBudgetHistoryV3,accountBalance,monthTotals,actualByCategory,categoryMonthAmount,trendSvg});