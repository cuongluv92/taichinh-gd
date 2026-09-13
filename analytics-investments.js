const INVEST_RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_investment_api`;
state.analyticsPeriod = state.analyticsPeriod || 'month';
state.analyticsYear = state.analyticsYear || Number(state.month.slice(0,4));

async function investmentApi(action,payload={}){
  const res=await fetch(INVEST_RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({p_key:state.key,p_action:action,p_payload:payload})});
  const text=await res.text(); let data; try{data=text?JSON.parse(text):null}catch{data=text}
  if(!res.ok){
    const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
    throw new Error(/invalid_investment_account/i.test(raw)?'Hãy chọn tài khoản đầu tư hợp lệ.':raw);
  }
  return data;
}

function titleFor(v){
  return ({
    dashboard:['Tổng quan','Bức tranh tài chính của gia đình'],
    analytics:['Phân tích','So sánh dòng tiền theo tháng và năm'],
    budget:['Ngân sách','Nhập thu chi theo nhóm và theo dõi nợ'],
    transactions:['Thu chi','Toàn bộ dòng tiền đã ghi nhận'],
    accounts:['Tài khoản','Tiền mặt, ngân hàng, tiết kiệm và tín dụng'],
    investments:['Đầu tư','Theo dõi vốn đầu tư và giá trị hiện tại'],
    goals:['Mục tiêu & nợ','Tiết kiệm, vay và cho vay'],
    settings:['Cài đặt','Danh mục, dữ liệu và thiết bị']
  })[v]||['Tài chính gia đình',''];
}

function accountBalance(a){
  let bal=n(a.opening_balance);
  (state.fullTransactions||[]).forEach(t=>{
    if(t.account_id===a.id){
      if(['income','loan_borrow','loan_collect','loan_repayment','investment_gain'].includes(t.transaction_type)) bal+=n(t.amount);
      else if(['expense','transfer','loan_lend','loan_out','loan_pay','goal_save','goal_withdraw','investment_loss'].includes(t.transaction_type)) bal-=n(t.amount);
    }
    if(['transfer','goal_save','goal_withdraw'].includes(t.transaction_type)&&t.transfer_account_id===a.id) bal+=n(t.amount);
  });
  return bal;
}

function txBase(t){return n(t.amount)*n(t.fx_rate||1)}
function txMonth(t){return String(t.transaction_date||'').slice(0,7)}
function txYear(t){return String(t.transaction_date||'').slice(0,4)}
function selectedPeriodTransactions(){
  const all=state.fullTransactions||[];
  return state.analyticsPeriod==='year' ? all.filter(t=>txYear(t)===String(state.analyticsYear)) : all.filter(t=>txMonth(t)===state.month);
}
function categoryAt(categoryId,date){
  const versions=(state.categoryVersions||[]).filter(v=>v.category_id===categoryId&&String(v.effective_month).slice(0,10)<=String(date).slice(0,10)).sort((a,b)=>String(b.effective_month).localeCompare(String(a.effective_month)));
  const base=(state.categories||[]).find(c=>c.id===categoryId)||{};
  return versions[0]||base;
}
function expenseType(t){return categoryAt(t.category_id,t.transaction_date)?.cost_type||'variable'}
function flowToAccountType(type,txs){
  const ids=new Set(activeAccounts().filter(a=>a.account_type===type).map(a=>a.id)); let total=0;
  txs.forEach(t=>{
    if(!['transfer','goal_save','goal_withdraw'].includes(t.transaction_type)) return;
    const amt=txBase(t);
    if(ids.has(t.transfer_account_id)) total+=amt;
    if(ids.has(t.account_id)) total-=amt;
  });
  return total;
}
function periodStats(txs=selectedPeriodTransactions()){
  let income=0,fixed=0,variable=0,debtPay=0;
  txs.forEach(t=>{
    if(t.transaction_type==='income') income+=txBase(t);
    else if(t.transaction_type==='expense') (expenseType(t)==='fixed'?fixed+=txBase(t):variable+=txBase(t));
    else if(t.transaction_type==='loan_pay') debtPay+=txBase(t);
  });
  const saving=Math.max(0,flowToAccountType('savings',txs));
  const investment=Math.max(0,flowToAccountType('investment',txs));
  const allocated=fixed+variable+saving+investment+debtPay;
  return {income,fixed,variable,saving,investment,debtPay,remaining:Math.max(0,income-allocated),overspend:Math.max(0,allocated-income),allocated};
}
function pctOfIncome(v,income){return income>0?v/income*100:0}

const CHART_COLORS=['#2563eb','#7c3aed','#0891b2','#16a34a','#f59e0b','#dc2626','#64748b','#0f766e','#c026d3','#ea580c'];
function donutSvg(items,size=180,thickness=24){
  const clean=items.filter(x=>n(x.value)>0); const total=clean.reduce((s,x)=>s+n(x.value),0); const r=58,c=2*Math.PI*r;
  if(!total) return `<div class="viz-empty">Chưa có dữ liệu</div>`;
  let offset=0;
  const circles=clean.map((x,i)=>{const len=c*n(x.value)/total;const el=`<circle cx="80" cy="80" r="${r}" fill="none" stroke="${CHART_COLORS[i%CHART_COLORS.length]}" stroke-width="${thickness}" stroke-dasharray="${len} ${c-len}" stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)"/>`;offset+=len;return el}).join('');
  return `<svg class="donut-svg" viewBox="0 0 160 160" width="${size}" height="${size}" aria-label="Biểu đồ tròn"><circle cx="80" cy="80" r="${r}" fill="none" stroke="#e8eef5" stroke-width="${thickness}"/>${circles}<circle cx="80" cy="80" r="38" fill="white"/></svg>`;
}
function legendHtml(items,totalMode='value',income=0){
  return `<div class="chart-legend">${items.filter(x=>n(x.value)>0).map((x,i)=>`<div><span><i class="legend-dot legend-c${i%10}"></i>${esc(x.label)}</span><strong>${money(x.value)}${totalMode==='income'&&income>0?` <small>${pctOfIncome(x.value,income).toFixed(1)}%</small>`:''}</strong></div>`).join('')}</div>`;
}
function expenseBars(txs){
  const map=new Map();txs.filter(t=>t.transaction_type==='expense').forEach(t=>{const c=categoryAt(t.category_id,t.transaction_date),name=c?.name||'Khác';map.set(name,(map.get(name)||0)+txBase(t))});
  const rows=[...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8),max=Math.max(1,...rows.map(x=>x[1]));
  if(!rows.length)return '<div class="viz-empty">Chưa có chi tiêu trong kỳ này</div>';
  const W=720,rowH=42,H=rows.length*rowH+10;
  return `<svg class="hbar-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="So sánh chi tiêu">${rows.map(([label,val],i)=>{const w=420*val/max,y=i*rowH+8;return `<text x="4" y="${y+16}" class="hbar-label">${esc(label.slice(0,18))}</text><rect x="170" y="${y}" width="${Math.max(3,w)}" height="20" rx="7" fill="${CHART_COLORS[i%CHART_COLORS.length]}"/><text x="${Math.min(700,180+w)}" y="${y+16}" class="hbar-value">${esc(money(val))}</text>`}).join('')}</svg>`;
}
function yearlyBars(year){
  const all=state.fullTransactions||[],data=[];
  for(let m=1;m<=12;m++){const key=`${year}-${String(m).padStart(2,'0')}`;const txs=all.filter(t=>txMonth(t)===key);data.push({m,inc:txs.filter(t=>t.transaction_type==='income').reduce((s,t)=>s+txBase(t),0),exp:txs.filter(t=>t.transaction_type==='expense').reduce((s,t)=>s+txBase(t),0)})}
  const max=Math.max(1,...data.flatMap(x=>[x.inc,x.exp])),W=760,H=300,pad=34,group=(W-pad*2)/12,bw=13;
  return `<svg class="yearbar-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Thu chi theo tháng">${[0,1,2,3].map(i=>{const y=pad+(H-pad*2)*i/3;return `<line x1="${pad}" y1="${y}" x2="${W-pad}" y2="${y}" stroke="#e8eef5"/>`}).join('')}${data.map((x,i)=>{const cx=pad+group*i+group/2,ih=(H-pad*2)*x.inc/max,eh=(H-pad*2)*x.exp/max;return `<rect x="${cx-bw-2}" y="${H-pad-ih}" width="${bw}" height="${ih}" rx="4" fill="#16a34a"/><rect x="${cx+2}" y="${H-pad-eh}" width="${bw}" height="${eh}" rx="4" fill="#ef4444"/><text x="${cx}" y="${H-10}" text-anchor="middle" class="year-label">T${x.m}</text>`}).join('')}</svg><div class="simple-legend"><span><i class="dot-income"></i>Thu nhập</span><span><i class="dot-expense"></i>Chi tiêu</span></div>`;
}
function assetComposition(){
  const groups=[['Tiền mặt','cash'],['Ngân hàng','bank'],['Tiết kiệm','savings'],['Đầu tư','investment']].map(([label,type])=>({label,value:activeAccounts().filter(a=>a.account_type===type&&(a.currency||state.base)===state.base).reduce((s,a)=>s+Math.max(0,accountBalance(a)),0)}));
  const rec=baseReceivables();if(rec>0)groups.push({label:'Phải thu',value:rec});return groups;
}
function periodLabel(){return state.analyticsPeriod==='year'?`Năm ${state.analyticsYear}`:`Tháng ${state.month.replace('-','/')}`}
function setAnalyticsPeriod(v){state.analyticsPeriod=v;if(v==='year')state.analyticsYear=Number(state.month.slice(0,4));render()}
function shiftAnalyticsYear(delta){state.analyticsYear+=delta;render()}

function analytics(){
  const txs=selectedPeriodTransactions(),s=periodStats(txs),allocation=[{label:'Chi cố định',value:s.fixed},{label:'Chi biến động',value:s.variable},{label:'Tiết kiệm',value:s.saving},{label:'Đầu tư',value:s.investment},{label:'Trả nợ gốc',value:s.debtPay},{label:'Còn lại',value:s.remaining}],assets=assetComposition();
  const ratios=[['Cố định',s.fixed],['Biến động',s.variable],['Tiết kiệm',s.saving],['Đầu tư',s.investment],['Trả nợ',s.debtPay]];
  return `<div class="analysis-head"><div><h2>Phân tích ${periodLabel()}</h2><p>Nhìn nhanh tiền vào, tiền ra, phần để dành và tài sản đang nằm ở đâu.</p></div><div class="period-switch"><button class="${state.analyticsPeriod==='month'?'active':''}" onclick="setAnalyticsPeriod('month')">Tháng</button><button class="${state.analyticsPeriod==='year'?'active':''}" onclick="setAnalyticsPeriod('year')">Năm</button></div></div>
  ${state.analyticsPeriod==='year'?`<div class="year-switch"><button onclick="shiftAnalyticsYear(-1)">‹</button><strong>${state.analyticsYear}</strong><button onclick="shiftAnalyticsYear(1)">›</button></div>`:''}
  <div class="ratio-grid">${ratios.map(([label,val])=>`<section><span>${label}</span><strong>${pctOfIncome(val,s.income).toFixed(1)}%</strong><small>${money(val)} / ${money(s.income)} thu nhập</small></section>`).join('')}<section class="ratio-highlight"><span>${s.overspend>0?'Bội chi':'Còn lại'}</span><strong>${s.overspend>0?'-':''}${pctOfIncome(s.overspend||s.remaining,s.income).toFixed(1)}%</strong><small>${money(s.overspend||s.remaining)}</small></section></div>
  <div class="analysis-grid">
    <section class="pro-card analysis-card"><div class="pro-section-head"><div><h2>Phân bổ thu nhập</h2><p>% được tính trên tổng thu nhập của kỳ</p></div></div><div class="donut-layout"><div class="donut-wrap">${donutSvg(allocation)}<div class="donut-center"><span>Thu nhập</span><strong>${money(s.income)}</strong></div></div>${legendHtml(allocation,'income',s.income)}</div>${s.overspend>0?`<div class="analysis-warning">Chi + tiết kiệm + đầu tư + trả nợ đang vượt thu nhập ${money(s.overspend)}.</div>`:''}</section>
    <section class="pro-card analysis-card"><div class="pro-section-head"><div><h2>Cơ cấu tài sản hiện tại</h2><p>Chỉ tính tài khoản cùng tiền tệ chính ${state.base}</p></div></div><div class="donut-layout"><div class="donut-wrap">${donutSvg(assets)}<div class="donut-center"><span>Tổng</span><strong>${money(assets.reduce((z,x)=>z+x.value,0))}</strong></div></div>${legendHtml(assets)}</div></section>
    <section class="pro-card analysis-card wide-analysis"><div class="pro-section-head"><div><h2>${state.analyticsPeriod==='year'?'Thu nhập và chi tiêu 12 tháng':'So sánh chi tiêu theo mục'}</h2><p>${periodLabel()}</p></div></div><div class="chart-stage">${state.analyticsPeriod==='year'?yearlyBars(state.analyticsYear):expenseBars(txs)}</div></section>
  </div>`;
}

function investmentAccounts(){return activeAccounts().filter(a=>a.account_type==='investment')}
function investmentCapital(a){
  let cap=n(a.opening_balance);(state.fullTransactions||[]).forEach(t=>{if(!['transfer','goal_save','goal_withdraw'].includes(t.transaction_type))return;const amt=n(t.amount);if(t.transfer_account_id===a.id)cap+=amt;if(t.account_id===a.id)cap-=amt});return Math.max(0,cap)
}
function investmentNetFlow(txs){return flowToAccountType('investment',txs)}
function openInvestmentAccount(){
  modal('Thêm tài khoản đầu tư',`<div class="form-grid"><div class="field full"><label>Tên tài khoản / tài sản</label><input name="name" placeholder="Ví dụ: NISA · S&P 500" required autofocus></div><div class="field"><label>Tiền tệ</label><select name="currency"><option value="JPY" ${state.base==='JPY'?'selected':''}>JPY</option><option value="VND" ${state.base==='VND'?'selected':''}>VND</option></select></div><div class="field"><label>Giá trị ban đầu</label><input name="opening_balance" type="number" min="0" step="1" value="0"></div></div>`,fd=>api('save_account',{...fd,account_type:'investment'}),'Tạo tài khoản');
}
function openInvestmentTransfer(id,mode='in'){
  const target=activeAccounts().find(a=>a.id===id);if(!target)return toast('Không tìm thấy tài khoản đầu tư.',true);
  const cash=activeAccounts().find(a=>a.id!==id&&['bank','cash','savings'].includes(a.account_type)&&(a.currency||state.base)===(target.currency||state.base));
  if(!cash)return toast('Cần một tài khoản tiền mặt/ngân hàng cùng tiền tệ.',true);
  return mode==='in'?openTransaction('',{transaction_type:'transfer',account_id:cash.id,transfer_account_id:id,transaction_date:today(),note:`Nạp vốn ${target.name}`}):openTransaction('',{transaction_type:'transfer',account_id:id,transfer_account_id:cash.id,transaction_date:today(),note:`Rút vốn ${target.name}`});
}
function openInvestmentValue(id){
  const a=investmentAccounts().find(x=>x.id===id);if(!a)return toast('Không tìm thấy tài khoản đầu tư.',true);const current=accountBalance(a);
  modal('Cập nhật giá trị đầu tư',`<div class="form-grid"><div class="field full"><label>${esc(a.name)}</label><input value="${money(current,a.currency)}" disabled><small>Nhập giá trị hiện tại. Chênh lệch được ghi là lãi/lỗ đầu tư, không tính vào lương hay chi tiêu.</small></div><div class="field"><label>Giá trị hiện tại mới</label><input name="new_value" type="number" min="0" step="1" value="${Math.max(0,current)}" required autofocus></div><div class="field"><label>Ngày định giá</label><input name="transaction_date" type="date" value="${today()}" required></div><div class="field full"><label>Ghi chú</label><input name="note" value="Cập nhật giá trị ${esc(a.name)}"></div></div>`,async fd=>{const delta=n(fd.new_value)-current;if(Math.abs(delta)<1)return;await investmentApi('adjust',{account_id:id,direction:delta>=0?'gain':'loss',amount:Math.abs(delta),transaction_date:fd.transaction_date,note:fd.note||''})},'Cập nhật');
}
function investments(){
  const ac=investmentAccounts(),rows=ac.map(a=>({a,current:accountBalance(a),capital:investmentCapital(a)}));const total=rows.reduce((s,x)=>s+Math.max(0,x.current),0),capital=rows.reduce((s,x)=>s+x.capital,0),pl=total-capital,periodTx=selectedPeriodTransactions(),netFlow=investmentNetFlow(periodTx);const pie=rows.map(x=>({label:x.a.name,value:Math.max(0,x.current)}));
  return `<div class="pro-view-head"><div><h2>Đầu tư</h2><p>Nạp/rút vốn là chuyển tài sản; cập nhật giá trị chỉ ghi lãi/lỗ thị trường.</p></div><button class="btn primary" onclick="openInvestmentAccount()">＋ Tài khoản đầu tư</button></div>
  <div class="investment-kpis"><section><span>Giá trị hiện tại</span><strong>${money(total)}</strong></section><section><span>Vốn ròng</span><strong>${money(capital)}</strong></section><section><span>Lãi / lỗ ước tính</span><strong class="${pl>=0?'green':'red'}">${pl>=0?'+':''}${money(pl)}</strong></section><section><span>Dòng vốn ${state.analyticsPeriod==='year'?'năm':'tháng'}</span><strong class="${netFlow>=0?'green':'red'}">${netFlow>=0?'+':''}${money(netFlow)}</strong></section></div>
  <div class="investment-layout"><section class="pro-card analysis-card"><div class="pro-section-head"><div><h2>Phân bổ đầu tư</h2><p>Theo giá trị hiện tại</p></div></div><div class="donut-layout"><div class="donut-wrap">${donutSvg(pie)}<div class="donut-center"><span>Đầu tư</span><strong>${money(total)}</strong></div></div>${legendHtml(pie)}</div></section><section class="investment-list">${rows.length?rows.map(x=>{const p=x.current-x.capital,ret=x.capital>0?p/x.capital*100:0;return `<article class="investment-card"><div class="investment-card-head"><div><span>Tài khoản đầu tư</span><h3>${esc(x.a.name)}</h3></div><button class="kebab" onclick="openAccount('${x.a.id}')">•••</button></div><strong class="investment-value">${money(x.current,x.a.currency)}</strong><div class="investment-metrics"><span>Vốn <b>${money(x.capital,x.a.currency)}</b></span><span>Lãi/lỗ <b class="${p>=0?'green':'red'}">${p>=0?'+':''}${money(p,x.a.currency)} (${ret.toFixed(1)}%)</b></span></div><div class="investment-actions"><button class="btn sm primary" onclick="openInvestmentTransfer('${x.a.id}','in')">＋ Nạp vốn</button><button class="btn sm" onclick="openInvestmentTransfer('${x.a.id}','out')">Rút vốn</button><button class="btn sm" onclick="openInvestmentValue('${x.a.id}')">Cập nhật giá trị</button></div></article>`}).join(''):'<div class="pro-card empty">Chưa có tài khoản đầu tư. Tạo một tài khoản như NISA, quỹ, cổ phiếu hoặc crypto để bắt đầu.</div>'}</section></div>`;
}

function dashboard(){
  const cur=periodStats((state.fullTransactions||[]).filter(t=>txMonth(t)===state.month));const assets=assetComposition(),assetTotal=assets.reduce((s,x)=>s+x.value,0),debt=baseBorrowedDebt(),netWorth=baseNetWorth();const monthTx=(state.fullTransactions||[]).filter(t=>txMonth(t)===state.month),alloc=[{label:'Cố định',value:cur.fixed},{label:'Biến động',value:cur.variable},{label:'Tiết kiệm',value:cur.saving},{label:'Đầu tư',value:cur.investment},{label:'Trả nợ',value:cur.debtPay},{label:'Còn lại',value:cur.remaining}];const recent=state.transactions.slice(0,6);
  return `<div class="pro-kpi-grid"><section class="pro-kpi hero-kpi"><span>Tài sản ròng</span><strong class="${netWorth<0?'red':''}">${money(netWorth)}</strong><small>Tài khoản trừ nợ vay</small></section><section class="pro-kpi"><span>Tài sản đang có</span><strong>${money(assetTotal)}</strong><small>Tiền + tiết kiệm + đầu tư + phải thu</small></section><section class="pro-kpi"><span>Tổng nợ</span><strong class="${debt>0?'red':''}">${money(debt)}</strong><small>Khoản vay và dư nợ</small></section><section class="pro-kpi"><span>Dòng tiền tháng</span><strong class="${(cur.income-cur.fixed-cur.variable)>=0?'green':'red'}">${money(cur.income-cur.fixed-cur.variable)}</strong><small>Thu nhập trừ chi tiêu</small></section></div>
  <div class="quick-actions pro-card"><button onclick="openQuick('income')"><b>＋</b><span>Ghi thu</span></button><button onclick="openQuick('expense')"><b>−</b><span>Ghi chi</span></button><button onclick="openQuick('transfer')"><b>⇄</b><span>Chuyển tiền</span></button><button onclick="navigate('investments')"><b>↗</b><span>Đầu tư</span></button></div>
  <div class="overview-chart-grid"><section class="pro-card analysis-card"><div class="pro-section-head"><div><h2>Phân bổ tháng</h2><p>Tỷ lệ so với thu nhập ${state.month.replace('-','/')}</p></div><button class="text-btn" onclick="navigate('analytics')">Phân tích</button></div><div class="donut-layout"><div class="donut-wrap">${donutSvg(alloc,165,22)}<div class="donut-center"><span>Thu</span><strong>${money(cur.income)}</strong></div></div>${legendHtml(alloc,'income',cur.income)}</div></section><section class="pro-card analysis-card"><div class="pro-section-head"><div><h2>Chi tiêu ít / nhiều</h2><p>So sánh các mục trong tháng</p></div><button class="text-btn" onclick="navigate('budget')">Nhập chi</button></div><div class="chart-stage compact-chart">${expenseBars(monthTx)}</div></section></div>
  <div class="overview-chart-grid"><section class="pro-card analysis-card"><div class="pro-section-head"><div><h2>Cơ cấu tài sản</h2><p>Tiền đang nằm ở đâu</p></div><button class="text-btn" onclick="navigate('accounts')">Tài khoản</button></div><div class="donut-layout"><div class="donut-wrap">${donutSvg(assets,165,22)}<div class="donut-center"><span>Tổng</span><strong>${money(assetTotal)}</strong></div></div>${legendHtml(assets)}</div></section><section class="pro-card pro-section"><div class="pro-section-head"><div><h2>Giao dịch gần đây</h2><p>Tháng đang xem</p></div><button class="btn sm primary" onclick="openTransaction()">＋ Giao dịch</button></div>${txList(recent)}</section></div>`;
}

function isInvestmentTransaction(t){return ['investment_gain','investment_loss'].includes(t.transaction_type)}
function transactions(){
  state.txFilter=state.txFilter||'all';const q=state.search.trim().toLowerCase();const matchType=t=>state.txFilter==='all'||(state.txFilter==='debt'?isDebtTransaction(t):state.txFilter==='goal'?isGoalTransaction(t):state.txFilter==='investment'?isInvestmentTransaction(t):t.transaction_type===state.txFilter);const rows=state.transactions.filter(t=>{const loan=linkedLoanForTransaction(t),goal=linkedGoalForTransaction(t);return matchType(t)&&(!q||`${t.category_name||''} ${t.note||''} ${t.account_name||''} ${t.transfer_account_name||''} ${loan?.counterparty||''} ${goal?.name||''}`.toLowerCase().includes(q))});const counts={all:state.transactions.length,expense:state.transactions.filter(t=>t.transaction_type==='expense').length,income:state.transactions.filter(t=>t.transaction_type==='income').length,transfer:state.transactions.filter(t=>t.transaction_type==='transfer').length,debt:state.transactions.filter(isDebtTransaction).length,goal:state.transactions.filter(isGoalTransaction).length,investment:state.transactions.filter(isInvestmentTransaction).length};
  return `<div class="pro-view-head"><div><h2>Thu chi tháng ${state.month.replace('-','/')}</h2><p>Tất cả dòng tiền, chuyển tài sản, mục tiêu và đầu tư.</p></div><button class="btn primary" onclick="openTransaction()">＋ Giao dịch</button></div><div class="transaction-tools"><input class="search" placeholder="Tìm danh mục, ghi chú, tài khoản…" value="${esc(state.search)}" oninput="state.search=this.value;render()"><div class="filter-tabs"><button class="filter-tab ${state.txFilter==='all'?'active':''}" onclick="setTxFilter('all')">Tất cả ${counts.all}</button><button class="filter-tab ${state.txFilter==='expense'?'active':''}" onclick="setTxFilter('expense')">Chi ${counts.expense}</button><button class="filter-tab ${state.txFilter==='income'?'active':''}" onclick="setTxFilter('income')">Thu ${counts.income}</button><button class="filter-tab ${state.txFilter==='transfer'?'active':''}" onclick="setTxFilter('transfer')">Chuyển ${counts.transfer}</button><button class="filter-tab ${state.txFilter==='debt'?'active':''}" onclick="setTxFilter('debt')">Nợ ${counts.debt}</button><button class="filter-tab ${state.txFilter==='goal'?'active':''}" onclick="setTxFilter('goal')">Mục tiêu ${counts.goal}</button><button class="filter-tab ${state.txFilter==='investment'?'active':''}" onclick="setTxFilter('investment')">Đầu tư ${counts.investment}</button></div></div><section class="pro-card pro-section">${txList(rows,true)}</section>`;
}
function txList(rows,actions=false){
  if(!rows.length)return '<div class="empty">Chưa có giao dịch.</div>';
  return `<div class="pro-tx-list">${rows.map(t=>{const type=t.transaction_type,loan=linkedLoanForTransaction(t),goal=linkedGoalForTransaction(t),move=type==='transfer'||isGoalTransaction(t);const positive=['income','loan_borrow','loan_collect','loan_repayment','investment_gain'].includes(type),negative=['expense','loan_lend','loan_out','loan_pay','investment_loss'].includes(type);let label=t.category_name||'Chưa phân loại',icon=positive?'↓':move?'⇄':'↑',kind='';if(type==='transfer'){label=`${t.account_name||'Tài khoản'} → ${t.transfer_account_name||'Tài khoản'}`;kind='Chuyển khoản'}else if(type==='loan_borrow'){label=`Vay · ${loan?.counterparty||'Khoản nợ'}`;kind='Vay tiền'}else if(type==='loan_lend'||type==='loan_out'){label=`Cho vay · ${loan?.counterparty||'Khoản phải thu'}`;kind='Cho vay'}else if(type==='loan_pay'){label=`Trả nợ · ${loan?.counterparty||'Khoản nợ'}`;kind='Trả gốc'}else if(type==='loan_collect'||type==='loan_repayment'){label=`Thu hồi · ${loan?.counterparty||'Khoản phải thu'}`;kind='Thu hồi nợ'}else if(type==='goal_save'){label=`Góp mục tiêu · ${goal?.name||'Tiết kiệm'}`;kind=`${t.account_name||''} → ${t.transfer_account_name||''}`}else if(type==='goal_withdraw'){label=`Rút mục tiêu · ${goal?.name||'Tiết kiệm'}`;kind=`${t.account_name||''} → ${t.transfer_account_name||''}`}else if(type==='investment_gain'){label=`Tăng giá trị · ${t.account_name||'Đầu tư'}`;kind='Lãi/định giá'}else if(type==='investment_loss'){label=`Giảm giá trị · ${t.account_name||'Đầu tư'}`;kind='Lỗ/định giá'}else kind=t.account_name||'';const sign=positive?'+':negative?'−':'',cls=positive?'green':negative?'red':'',editOk=['income','expense','transfer'].includes(type);return `<div class="pro-tx"><div class="pro-tx-icon ${positive?'in':negative?'out':'move'}">${icon}</div><div class="pro-tx-main"><strong>${esc(label)}</strong><span>${esc(t.transaction_date)}${kind?` · ${esc(kind)}`:''}${t.note?` · ${esc(t.note)}`:''}</span></div><div class="pro-tx-amount"><strong class="${cls}">${sign}${money(t.amount,t.currency)}</strong>${actions?`<div>${editOk?`<button class="mini-btn" onclick="openTransaction('${t.id}')">✎</button>`:''}<button class="mini-btn" onclick="deleteTransaction('${t.id}')">×</button></div>`:''}</div></div>`}).join('')}</div>`;
}

function render(){
  if(!state.household)return;
  const views={dashboard,analytics,budget,transactions,accounts,investments,goals,settings};
  const fn=views[state.view]||dashboard;$('#content').innerHTML=fn();
  if(state.view==='settings')$('#householdForm')?.addEventListener('submit',saveHousehold);
}

Object.assign(window,{investmentApi,setAnalyticsPeriod,shiftAnalyticsYear,analytics,investments,openInvestmentAccount,openInvestmentTransfer,openInvestmentValue,dashboard,transactions,txList,accountBalance,render});
