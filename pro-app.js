const GOAL_RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_goal_api`;
const CATEGORY_ORDER_RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_category_order_api`;
let categoryOrderSaving=false;

async function goalApi(action, payload={}){
  if(!state.key) throw new Error('Thiếu khóa gia đình');
  const res=await fetch(GOAL_RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({p_key:state.key,p_action:action,p_payload:payload})});
  const text=await res.text(); let data; try{data=text?JSON.parse(text):null}catch{data=text}
  if(!res.ok){
    const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
    const friendly=/withdraw_exceeds_goal/i.test(raw)?'Số tiền rút lớn hơn số đã tích lũy.'
      :/invalid_from_account|invalid_to_account/i.test(raw)?'Hãy chọn tài khoản hợp lệ.'
      :/accounts_must_differ/i.test(raw)?'Tài khoản nguồn và tài khoản nhận phải khác nhau.'
      :/goal_not_found/i.test(raw)?'Không tìm thấy mục tiêu tiết kiệm.'
      :raw;
    throw new Error(friendly);
  }
  return data;
}

function linkedGoalForTransaction(t){
  const full=linkedFullTransaction(t); return (state.goals||[]).find(g=>g.id===(t.goal_id||full.goal_id));
}
function isGoalTransaction(t){return ['goal_save','goal_withdraw','saving'].includes(t.transaction_type)}

function accountBalance(a){
  let bal=n(a.opening_balance);
  (state.fullTransactions||[]).forEach(t=>{
    if(t.account_id===a.id){
      if(['income','loan_borrow','loan_collect','loan_repayment'].includes(t.transaction_type)) bal+=n(t.amount);
      else if(['expense','transfer','loan_lend','loan_out','loan_pay','goal_save','goal_withdraw'].includes(t.transaction_type)) bal-=n(t.amount);
    }
    if(['transfer','goal_save','goal_withdraw'].includes(t.transaction_type)&&t.transfer_account_id===a.id) bal+=n(t.amount);
  });
  return bal;
}

function baseAccounts(){return activeAccounts().filter(a=>(a.currency||state.base)===state.base)}
function baseBorrowedDebt(){
  const loanDebt=(state.loans||[]).filter(l=>l.loan_type==='borrowed'&&(l.currency||state.base)===state.base).reduce((s,l)=>s+n(l.remaining_amount),0);
  const cardDebt=baseAccounts().filter(a=>['credit','loan_payable'].includes(a.account_type)).reduce((s,a)=>s+Math.max(0,-accountBalance(a)),0);
  return loanDebt+cardDebt;
}
function baseReceivables(){return (state.loans||[]).filter(l=>l.loan_type==='lent'&&(l.currency||state.base)===state.base).reduce((s,l)=>s+n(l.remaining_amount),0)}
function baseAccountAssets(){return baseAccounts().reduce((s,a)=>s+accountBalance(a),0)}
function baseLiquid(){return baseAccounts().filter(a=>['cash','bank','savings'].includes(a.account_type)).reduce((s,a)=>s+Math.max(0,accountBalance(a)),0)}
function baseNetWorth(){return baseAccountAssets()-((state.loans||[]).filter(l=>l.loan_type==='borrowed'&&(l.currency||state.base)===state.base).reduce((s,l)=>s+n(l.remaining_amount),0))}
function totalByCurrency(rows, valueFn=x=>x.amount, currencyFn=x=>x.currency||state.base){
  const sums={}; rows.forEach(x=>{const cur=currencyFn(x);sums[cur]=(sums[cur]||0)+n(valueFn(x))});
  return Object.entries(sums).map(([cur,val])=>money(val,cur)).join(' · ')||money(0);
}
function daysUntil(date){if(!date)return null;const now=new Date(today()+'T00:00:00'),d=new Date(String(date).slice(0,10)+'T00:00:00');return Math.ceil((d-now)/86400000)}
function dateStatus(date){const d=daysUntil(date);if(d===null)return '';if(d<0)return `Quá hạn ${Math.abs(d)} ngày`;if(d===0)return 'Đến hạn hôm nay';if(d<=7)return `Còn ${d} ngày`;return `Hạn ${String(date).slice(0,10)}`}

function categoryOrderValue(c){
  const raw=c?.sort_order;
  if(raw===null||raw===undefined||raw==='')return Number.MAX_SAFE_INTEGER;
  const v=Number(raw);
  return Number.isFinite(v)?v:Number.MAX_SAFE_INTEGER;
}
function orderedCategories(direction){
  return (state.categories||[])
    .filter(c=>c&&c.is_active!==false&&c.direction===direction)
    .map((c,i)=>({c,i}))
    .sort((a,b)=>categoryOrderValue(a.c)-categoryOrderValue(b.c)||a.i-b.i)
    .map(x=>x.c);
}
async function moveCategoryOrder(direction,id,delta){
  if(categoryOrderSaving)return;
  const payload={income:orderedCategories('income').map(c=>c.id),expense:orderedCategories('expense').map(c=>c.id)};
  const arr=payload[direction];
  if(!Array.isArray(arr))return;
  const index=arr.indexOf(id),next=index+Number(delta||0);
  if(index<0||next<0||next>=arr.length)return;
  [arr[index],arr[next]]=[arr[next],arr[index]];
  categoryOrderSaving=true;
  try{
    setLoading(true);
    const res=await fetch(CATEGORY_ORDER_RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({p_key:state.key,p_payload:payload})});
    const text=await res.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok){
      const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
      throw new Error(/category_order_stale_refresh/i.test(raw)?'Danh mục vừa thay đổi. Hãy tải lại rồi thử lại.'
        :/invalid_category_order/i.test(raw)?'Thứ tự danh mục không hợp lệ.'
        :/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.'
        :raw);
    }
    await refresh();
    toast('Đã đổi thứ tự danh mục');
  }catch(e){
    toast(e.message||'Không đổi được thứ tự',true);
  }finally{
    categoryOrderSaving=false;
    setLoading(false);
  }
}

document.addEventListener('click',event=>{
  const btn=event.target.closest?.('[data-category-move]');
  if(!btn)return;
  event.preventDefault();
  moveCategoryOrder(btn.dataset.direction,btn.dataset.id,Number(btn.dataset.delta));
});

function openQuick(type){
  if(type==='income') return openTransaction('',{transaction_type:'income',account_id:defaultMoneyAccountId(),transaction_date:today()});
  if(type==='expense') return openTransaction('',{transaction_type:'expense',account_id:defaultMoneyAccountId(),transaction_date:today()});
  if(type==='transfer') return openTransfer();
  if(type==='loan') return openLoan();
}
function openTransfer(fromId='',toId=''){
  openTransaction('',{transaction_type:'transfer',account_id:fromId||defaultMoneyAccountId(),transfer_account_id:toId||'',transaction_date:today()});
}

function openGoalFlow(id,mode='deposit'){
  const g=(state.goals||[]).find(x=>x.id===id); if(!g)return toast('Không tìm thấy mục tiêu.',true);
  const ac=activeAccounts().filter(a=>(a.currency||state.base)===(g.currency||state.base));
  if(ac.length<2) return toast('Cần ít nhất 2 tài khoản cùng tiền tệ để chuyển tiền cho mục tiêu.',true);
  const savings=ac.find(a=>a.account_type==='savings')||ac[1];
  const spending=ac.find(a=>['bank','cash'].includes(a.account_type)&&a.id!==savings.id)||ac.find(a=>a.id!==savings.id);
  const deposit=mode==='deposit';
  const fromDefault=deposit?spending?.id:savings?.id, toDefault=deposit?savings?.id:spending?.id;
  const max=deposit?'':`max="${Math.max(0,n(g.current_amount))}"`;
  modal(deposit?'Góp vào mục tiêu':'Rút từ mục tiêu',`<div class="goal-modal-summary"><strong>${esc(g.name)}</strong><span>${money(g.current_amount,g.currency)} / ${money(g.target_amount,g.currency)}</span></div><div class="form-grid">
    <div class="field"><label>Số tiền</label><input name="amount" type="number" min="1" ${max} value="${deposit?'':esc(g.current_amount)}" required autofocus></div>
    <div class="field"><label>${deposit?'Từ tài khoản':'Lấy từ tài khoản'}</label><select name="from_account_id" required><option value="">— Chọn —</option>${options(ac,fromDefault)}</select></div>
    <div class="field"><label>${deposit?'Chuyển vào':'Chuyển đến'}</label><select name="to_account_id" required><option value="">— Chọn —</option>${options(ac,toDefault)}</select></div>
    <div class="field"><label>Ngày</label><input name="transaction_date" type="date" value="${today()}" required></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${deposit?'Góp mục tiêu ':'Rút mục tiêu '}${esc(g.name)}"></div>
  </div>`,fd=>goalApi(deposit?'deposit':'withdraw',{goal_id:id,...fd}),deposit?'Góp tiền':'Rút tiền');
}

function dashboard(){
  const cur=monthTotals();
  const debt=baseBorrowedDebt(), liquid=baseLiquid(), netWorth=baseNetWorth();
  const expCats=activeCategories('expense');
  const breakdown=expCats.map(c=>({...c,actual:actualByCategory(c.id)})).filter(c=>c.actual>0).sort((a,b)=>b.actual-a.actual);const max=Math.max(1,...breakdown.map(x=>x.actual));
  const recent=state.transactions.slice(0,6);
  const goalsTop=(state.goals||[]).filter(g=>!g.is_completed).slice(0,3);
  const accountsTop=activeAccounts().slice().sort((a,b)=>Math.abs(accountBalance(b))-Math.abs(accountBalance(a))).slice(0,5);
  const savingRate=cur.inc>0?cur.net/cur.inc*100:0;
  return `<div class="pro-kpi-grid">
    <section class="pro-kpi hero-kpi"><span>Tài sản ròng</span><strong class="${netWorth<0?'red':''}">${money(netWorth)}</strong><small>Tài khoản trừ nợ vay (${state.base})</small></section>
    <section class="pro-kpi"><span>Tiền khả dụng</span><strong>${money(liquid)}</strong><small>Tiền mặt · ngân hàng · tiết kiệm</small></section>
    <section class="pro-kpi"><span>Tổng nợ</span><strong class="${debt>0?'red':''}">${money(debt)}</strong><small>Nợ vay + dư nợ thẻ</small></section>
    <section class="pro-kpi"><span>Dòng tiền tháng</span><strong class="${cur.net>=0?'green':'red'}">${money(cur.net)}</strong><small>${savingRate.toFixed(1)}% thu nhập còn lại</small></section>
  </div>
  <div class="quick-actions pro-card"><button onclick="openQuick('income')"><b>＋</b><span>Ghi thu</span></button><button onclick="openQuick('expense')"><b>−</b><span>Ghi chi</span></button><button onclick="openQuick('transfer')"><b>⇄</b><span>Chuyển tiền</span></button><button onclick="openQuick('loan')"><b>↔</b><span>Vay / nợ</span></button></div>
  <div class="pro-main-grid">
    <section class="pro-card pro-section wide"><div class="pro-section-head"><div><h2>Biến động 12 tháng</h2><p>Thu nhập và chi tiêu thực tế</p></div><div class="mini-summary"><span>Thu ${money(cur.inc)}</span><span>Chi ${money(cur.exp)}</span></div></div><div class="trend pro-trend">${trendSvg()}</div></section>
    <section class="pro-card pro-section"><div class="pro-section-head"><div><h2>Tài khoản</h2><p>Số dư hiện tại</p></div><button class="text-btn" onclick="navigate('accounts')">Xem tất cả</button></div><div class="snapshot-list">${accountsTop.length?accountsTop.map(a=>`<button onclick="navigate('accounts')"><span><i class="account-dot ${esc(a.account_type)}"></i>${esc(a.name)}</span><strong class="${accountBalance(a)<0?'red':''}">${money(accountBalance(a),a.currency)}</strong></button>`).join(''):'<div class="empty compact">Chưa có tài khoản</div>'}</div></section>
    <section class="pro-card pro-section"><div class="pro-section-head"><div><h2>Chi tiêu theo nhóm</h2><p>Tháng ${state.month.replace('-','/')}</p></div><button class="text-btn" onclick="navigate('budget')">Nhập chi</button></div><div class="breakdown compact-breakdown">${breakdown.length?breakdown.slice(0,6).map(x=>`<div class="breakdown-row"><span>${esc(x.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4,x.actual/max*100)}%;background:${esc(x.color)}"></div></div><strong>${money(x.actual)}</strong></div>`).join(''):'<div class="empty compact">Chưa có chi tiêu</div>'}</div></section>
    <section class="pro-card pro-section"><div class="pro-section-head"><div><h2>Mục tiêu</h2><p>Tiến độ tiết kiệm</p></div><button class="text-btn" onclick="navigate('goals')">Quản lý</button></div><div class="mini-goals">${goalsTop.length?goalsTop.map(g=>{const p=Math.min(100,n(g.current_amount)/Math.max(1,n(g.target_amount))*100);return `<button onclick="navigate('goals')"><div><strong>${esc(g.name)}</strong><span>${money(g.current_amount,g.currency)} / ${money(g.target_amount,g.currency)}</span></div><div class="mini-progress"><i style="width:${p}%"></i></div></button>`}).join(''):'<div class="empty compact">Chưa có mục tiêu</div>'}</div></section>
  </div>
  <section class="pro-card pro-section recent-section"><div class="pro-section-head"><div><h2>Giao dịch gần đây</h2><p>Tháng đang xem</p></div><button class="btn sm primary" onclick="openTransaction()">＋ Giao dịch</button></div>${txList(recent)}</section>`;
}

function accounts(){
  const ac=activeAccounts(); const base=baseAccounts();
  const total=base.reduce((s,a)=>s+accountBalance(a),0); const positives=base.reduce((s,a)=>s+Math.max(0,accountBalance(a)),0); const negative=Math.abs(base.reduce((s,a)=>s+Math.min(0,accountBalance(a)),0));
  return `<div class="pro-view-head"><div><h2>Tài khoản của gia đình</h2><p>Mọi thu, chi, chuyển khoản và thanh toán nợ đều cập nhật số dư tự động.</p></div><div class="finance-actions"><button class="btn" onclick="openTransfer()">⇄ Chuyển tiền</button><button class="btn primary" onclick="openAccount()">＋ Tài khoản</button></div></div>
  <div class="account-summary"><div><span>Tổng số dư (${state.base})</span><strong class="${total<0?'red':''}">${money(total)}</strong></div><div><span>Tài sản trong tài khoản</span><strong>${money(positives)}</strong></div><div><span>Dư nợ tài khoản</span><strong class="${negative?'red':''}">${money(negative)}</strong></div></div>
  <div class="pro-account-grid">${ac.length?ac.map(a=>{const bal=accountBalance(a),debt=['credit','loan_payable'].includes(a.account_type)&&bal<0;return `<section class="pro-account-card ${debt?'debt-account':''}"><div class="account-card-top"><span class="account-type-badge">${esc(accountType(a.account_type))}</span><button class="kebab" onclick="openAccount('${a.id}')" title="Sửa">•••</button></div><div class="account-name">${esc(a.name)}</div><div class="account-balance ${bal<0?'red':''}">${money(bal,a.currency)}</div><div class="account-meta">Số dư đầu ${money(a.opening_balance,a.currency)}</div><div class="account-card-actions">${debt?`<button class="btn sm primary" onclick="openCreditPayment('${a.id}')">Thanh toán</button>`:`<button class="btn sm" onclick="openTransfer('${a.id}')">Chuyển tiền</button>`}<button class="btn sm" onclick="openTransaction('',{account_id:'${a.id}',transaction_type:'expense'})">Giao dịch</button></div></section>`}).join(''):'<div class="pro-card empty">Chưa có tài khoản.</div>'}</div>`;
}

function goals(){
  const gs=state.goals||[], ls=state.loans||[];
  const activeGs=gs.filter(g=>!g.is_completed), done=gs.filter(g=>g.is_completed);
  const borrowed=ls.filter(l=>l.loan_type==='borrowed'&&n(l.remaining_amount)>0), lent=ls.filter(l=>l.loan_type==='lent'&&n(l.remaining_amount)>0);
  return `<div class="goal-summary-row"><div class="goal-summary-card"><span>Mục tiêu đang theo dõi</span><strong>${activeGs.length}</strong><small>${done.length} đã hoàn thành</small></div><div class="goal-summary-card"><span>Nợ phải trả</span><strong class="red">${totalByCurrency(borrowed,l=>l.remaining_amount,l=>l.currency)}</strong><small>${borrowed.length} khoản</small></div><div class="goal-summary-card"><span>Phải thu</span><strong class="green">${totalByCurrency(lent,l=>l.remaining_amount,l=>l.currency)}</strong><small>${lent.length} khoản</small></div></div>
  <div class="goals-layout"><section><div class="pro-view-head compact-head"><div><h2>Mục tiêu tiết kiệm</h2><p>Góp/rút tiền sẽ tự chuyển giữa các tài khoản và cập nhật tiến độ.</p></div><button class="btn primary" onclick="openGoal()">＋ Mục tiêu</button></div><div class="pro-goal-grid">${gs.length?gs.map(g=>{const p=Math.min(100,n(g.current_amount)/Math.max(1,n(g.target_amount))*100),left=Math.max(0,n(g.target_amount)-n(g.current_amount));return `<section class="pro-goal-card ${g.is_completed?'completed':''}"><div class="goal-top"><div><span>${g.is_completed?'✓ Hoàn thành':dateStatus(g.target_date)||'Đang tiết kiệm'}</span><h3>${esc(g.name)}</h3></div><button class="kebab" onclick="openGoal('${g.id}')">•••</button></div><div class="goal-money"><strong>${money(g.current_amount,g.currency)}</strong><span>/ ${money(g.target_amount,g.currency)}</span></div><div class="progress pro-progress"><i style="width:${p}%"></i></div><div class="goal-foot"><span>${Math.round(p)}%</span><span>Còn ${money(left,g.currency)}</span></div><div class="goal-actions"><button class="btn sm primary" onclick="openGoalFlow('${g.id}','deposit')">＋ Góp tiền</button>${n(g.current_amount)>0?`<button class="btn sm" onclick="openGoalFlow('${g.id}','withdraw')">Rút</button>`:''}<button class="btn sm danger-soft" onclick="deleteGoal('${g.id}')">Xóa</button></div></section>`}).join(''):'<div class="pro-card empty">Chưa có mục tiêu.</div>'}</div></section>
  <section><div class="pro-view-head compact-head"><div><h2>Vay & cho vay</h2><p>Theo dõi dư nợ và các khoản phải thu.</p></div><button class="btn primary" onclick="openLoan()">＋ Khoản nợ</button></div><div class="debt-list">${ls.length?ls.map(l=>{const active=n(l.remaining_amount)>0,borrow=l.loan_type==='borrowed',status=dateStatus(l.due_date);return `<section class="debt-row ${!active?'paid':''}"><div class="debt-row-main"><span class="pill ${borrow?'expense':'income'}">${borrow?'Phải trả':'Phải thu'}</span><div><strong>${esc(l.counterparty)}</strong><small>${status||'Không đặt hạn'}</small></div></div><div class="debt-amount"><strong class="${borrow?'red':'green'}">${money(l.remaining_amount,l.currency)}</strong><small>Gốc ${money(l.principal,l.currency)}</small></div><div class="debt-actions">${active?`<button class="btn sm ${borrow?'primary':''}" onclick="openLoanPayment('${l.id}')">${borrow?'Trả nợ':'Thu tiền'}</button>`:''}<button class="btn sm" onclick="openLoan('${l.id}')">Sửa</button><button class="btn sm danger-soft" onclick="deleteLoan('${l.id}')">Xóa</button></div></section>`}).join(''):'<div class="pro-card empty">Chưa có khoản vay/nợ.</div>'}</div></section></div>`;
}

function transactions(){
  state.txFilter=state.txFilter||'all';const q=state.search.trim().toLowerCase();
  const matchType=t=>state.txFilter==='all'||(state.txFilter==='debt'?isDebtTransaction(t):state.txFilter==='goal'?isGoalTransaction(t):t.transaction_type===state.txFilter);
  const rows=state.transactions.filter(t=>{const loan=linkedLoanForTransaction(t),goal=linkedGoalForTransaction(t);return matchType(t)&&(!q||`${t.category_name||''} ${t.note||''} ${t.account_name||''} ${t.transfer_account_name||''} ${loan?.counterparty||''} ${goal?.name||''}`.toLowerCase().includes(q))});
  const counts={all:state.transactions.length,expense:state.transactions.filter(t=>t.transaction_type==='expense').length,income:state.transactions.filter(t=>t.transaction_type==='income').length,transfer:state.transactions.filter(t=>t.transaction_type==='transfer').length,debt:state.transactions.filter(isDebtTransaction).length,goal:state.transactions.filter(isGoalTransaction).length};
  return `<div class="pro-view-head"><div><h2>Thu chi tháng ${state.month.replace('-','/')}</h2><p>Tất cả dòng tiền được liên kết với tài khoản.</p></div><button class="btn primary" onclick="openTransaction()">＋ Giao dịch</button></div><div class="transaction-tools"><input class="search" placeholder="Tìm danh mục, ghi chú, tài khoản…" value="${esc(state.search)}" oninput="state.search=this.value;render()"><div class="filter-tabs"><button class="filter-tab ${state.txFilter==='all'?'active':''}" onclick="setTxFilter('all')">Tất cả ${counts.all}</button><button class="filter-tab ${state.txFilter==='expense'?'active':''}" onclick="setTxFilter('expense')">Chi ${counts.expense}</button><button class="filter-tab ${state.txFilter==='income'?'active':''}" onclick="setTxFilter('income')">Thu ${counts.income}</button><button class="filter-tab ${state.txFilter==='transfer'?'active':''}" onclick="setTxFilter('transfer')">Chuyển ${counts.transfer}</button><button class="filter-tab ${state.txFilter==='debt'?'active':''}" onclick="setTxFilter('debt')">Nợ ${counts.debt}</button><button class="filter-tab ${state.txFilter==='goal'?'active':''}" onclick="setTxFilter('goal')">Mục tiêu ${counts.goal}</button></div></div><section class="pro-card pro-section">${txList(rows,true)}</section>`;
}

function txList(rows,actions=false){
  if(!rows.length)return '<div class="empty">Chưa có giao dịch.</div>';
  return `<div class="pro-tx-list">${rows.map(t=>{const type=t.transaction_type,loan=linkedLoanForTransaction(t),goal=linkedGoalForTransaction(t),transfer=type==='transfer'||isGoalTransaction(t);const positive=['income','loan_borrow','loan_collect','loan_repayment'].includes(type);const negative=['expense','loan_lend','loan_out','loan_pay'].includes(type);let label=t.category_name||'Chưa phân loại',icon=positive?'↓':transfer?'⇄':'↑',kind='';if(type==='transfer'){label=`${t.account_name||'Tài khoản'} → ${t.transfer_account_name||'Tài khoản'}`;kind='Chuyển khoản'}else if(type==='loan_borrow'){label=`Vay · ${loan?.counterparty||'Khoản nợ'}`;kind='Vay tiền'}else if(type==='loan_lend'||type==='loan_out'){label=`Cho vay · ${loan?.counterparty||'Khoản phải thu'}`;kind='Cho vay'}else if(type==='loan_pay'){label=`Trả nợ · ${loan?.counterparty||'Khoản nợ'}`;kind='Trả gốc'}else if(type==='loan_collect'||type==='loan_repayment'){label=`Thu hồi · ${loan?.counterparty||'Khoản phải thu'}`;kind='Thu hồi nợ'}else if(type==='goal_save'){label=`Góp mục tiêu · ${goal?.name||'Tiết kiệm'}`;kind=`${t.account_name||''} → ${t.transfer_account_name||''}`}else if(type==='goal_withdraw'){label=`Rút mục tiêu · ${goal?.name||'Tiết kiệm'}`;kind=`${t.account_name||''} → ${t.transfer_account_name||''}`}else kind=t.account_name||'';const sign=positive?'+':negative?'−':'';const cls=positive?'green':negative?'red':'';const editOk=['income','expense','transfer'].includes(type);return `<div class="pro-tx"><div class="pro-tx-icon ${positive?'in':negative?'out':'move'}">${icon}</div><div class="pro-tx-main"><strong>${esc(label)}</strong><span>${esc(t.transaction_date)}${kind?` · ${esc(kind)}`:''}${t.note?` · ${esc(t.note)}`:''}</span></div><div class="pro-tx-amount"><strong class="${cls}">${sign}${money(t.amount,t.currency)}</strong>${actions?`<div>${editOk?`<button class="mini-btn" onclick="openTransaction('${t.id}')">✎</button>`:''}<button class="mini-btn" onclick="deleteTransaction('${t.id}')">×</button></div>`:''}</div></div>`}).join('')}</div>`;
}

function settings(){
  const income=orderedCategories('income'),expense=orderedCategories('expense');
  const catGroup=(title,direction,items)=>`<div class="settings-cat-group"><div class="settings-cat-title"><strong>${title}</strong><button class="text-btn" onclick="openCategory()">＋ Thêm</button></div>${items.map((c,i)=>`<div class="settings-cat-row"><span><i style="background:${esc(c.color)}"></i>${esc(c.name)}</span><div><button class="mini-btn" type="button" data-category-move data-direction="${direction}" data-id="${esc(c.id)}" data-delta="-1" ${i===0?'disabled':''} title="Đưa lên" aria-label="Đưa ${esc(c.name)} lên">↑</button><button class="mini-btn" type="button" data-category-move data-direction="${direction}" data-id="${esc(c.id)}" data-delta="1" ${i===items.length-1?'disabled':''} title="Đưa xuống" aria-label="Đưa ${esc(c.name)} xuống">↓</button><button class="mini-btn" onclick="openCategory('${c.id}')">✎</button><button class="mini-btn" onclick="archiveCategory('${c.id}')">×</button></div></div>`).join('')||'<div class="empty compact">Chưa có mục</div>'}</div>`;
  return `<div class="settings-grid"><section class="pro-card settings-panel"><div class="panel-title"><div><h2>Gia đình</h2><p>Tên hiển thị và tiền tệ chính</p></div></div><form id="householdForm" class="form-grid"><div class="field"><label>Tên hiển thị</label><input name="name" value="${esc(state.household?.name||'Gia đình')}" required></div><div class="field"><label>Tiền tệ chính</label><select name="base_currency"><option value="JPY" ${state.base==='JPY'?'selected':''}>JPY · Yên Nhật</option><option value="VND" ${state.base==='VND'?'selected':''}>VND · Đồng Việt Nam</option></select></div><div class="field full"><button class="btn primary" type="submit">Lưu thay đổi</button></div></form></section>
  <section class="pro-card settings-panel"><div class="panel-title"><div><h2>Dữ liệu & thiết bị</h2><p>Sao lưu và mở trên thiết bị khác</p></div></div><div class="settings-actions"><button class="btn" onclick="exportData()">⇩ Tải bản sao JSON</button><button class="btn" onclick="copyPrivateLink()">⧉ Sao chép link riêng</button><button class="btn danger" onclick="forgetDevice()">Xóa khóa trên máy này</button></div></section>
  <section class="pro-card settings-panel categories-panel"><div class="panel-title"><div><h2>Quản lý danh mục</h2><p>Sửa tên, cố định/biến động, ẩn hoặc dùng ↑ ↓ để đổi thứ tự</p></div><button class="btn sm primary" onclick="openCategory()">＋ Danh mục</button></div><div class="settings-category-grid">${catGroup('Thu nhập','income',income)}${catGroup('Chi tiêu','expense',expense)}</div></section>
  <section class="pro-card settings-panel"><div class="panel-title"><div><h2>Tình trạng dữ liệu</h2><p>Tóm tắt dữ liệu hiện có</p></div></div><div class="data-health"><div><strong>${activeAccounts().length}</strong><span>Tài khoản</span></div><div><strong>${state.transactions.length}</strong><span>Giao dịch tháng</span></div><div><strong>${state.goals.length}</strong><span>Mục tiêu</span></div><div><strong>${state.loans.length}</strong><span>Vay/nợ</span></div></div></section></div>`;
}

Object.assign(window,{goalApi,openQuick,openTransfer,openGoalFlow,dashboard,accounts,goals,transactions,txList,settings,accountBalance});