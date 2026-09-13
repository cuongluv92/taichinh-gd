const DEBT_RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_debt_api`;
const DEBT_TYPES = new Set(['loan_borrow','loan_lend','loan_pay','loan_collect','loan_out','loan_repayment']);

async function debtApi(action, payload={}){
  if(!state.key) throw new Error('Thiếu khóa gia đình');
  const res = await fetch(DEBT_RPC_URL, {
    method:'POST',
    headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},
    body:JSON.stringify({p_key:state.key,p_action:action,p_payload:payload})
  });
  const text=await res.text();
  let data; try{data=text?JSON.parse(text):null}catch{data=text}
  if(!res.ok){
    const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
    const friendly = /payment_exceeds_remaining/i.test(raw) ? 'Số tiền lớn hơn dư nợ còn lại.'
      : /loan_opening_already_recorded/i.test(raw) ? 'Khoản vay này đã được ghi nhận vào tài khoản rồi.'
      : /invalid_account/i.test(raw) ? 'Hãy chọn tài khoản hợp lệ.'
      : /loan_not_found/i.test(raw) ? 'Không tìm thấy khoản nợ.'
      : raw;
    throw new Error(friendly);
  }
  return data;
}

function linkedFullTransaction(t){
  return (state.fullTransactions||[]).find(x=>x.id===t.id)||t;
}
function linkedLoanForTransaction(t){
  const full=linkedFullTransaction(t); return (state.loans||[]).find(l=>l.id===(t.loan_id||full.loan_id));
}
function isDebtTransaction(t){return DEBT_TYPES.has(t.transaction_type)}
function defaultMoneyAccountId(){
  const ac=activeAccounts();
  return (ac.find(a=>a.account_type==='bank')||ac.find(a=>a.account_type==='cash')||ac.find(a=>a.account_type==='savings')||ac[0]||{}).id||'';
}
function accountBalance(a){
  let bal=n(a.opening_balance);
  (state.fullTransactions||[]).forEach(t=>{
    if(t.account_id===a.id){
      if(['income','loan_borrow','loan_collect','loan_repayment'].includes(t.transaction_type)) bal+=n(t.amount);
      else if(['expense','transfer','loan_lend','loan_out','loan_pay'].includes(t.transaction_type)) bal-=n(t.amount);
    }
    if(t.transaction_type==='transfer'&&t.transfer_account_id===a.id) bal+=n(t.amount);
  });
  return bal;
}

function openTransaction(id='', defaults={}){
  const found=state.transactions.find(x=>x.id===id);
  if(found && isDebtTransaction(found)){
    const loan=linkedLoanForTransaction(found);
    if(loan && ['loan_pay','loan_collect'].includes(found.transaction_type)) return openLoanPayment(loan.id);
    return toast('Giao dịch vay/nợ được quản lý trong cột Nợ.',true);
  }
  const t=found||defaults||{};
  const type=['income','expense','transfer'].includes(t.transaction_type)?t.transaction_type:'expense';
  const selectedAccount=t.account_id||defaultMoneyAccountId();
  modal(id?'Sửa giao dịch':'Ghi giao dịch',`<div class="form-grid">
    <div class="field"><label>Loại</label><select name="transaction_type" id="txType"><option value="expense" ${type==='expense'?'selected':''}>Chi tiêu</option><option value="income" ${type==='income'?'selected':''}>Thu nhập</option><option value="transfer" ${type==='transfer'?'selected':''}>Chuyển khoản</option></select></div>
    <div class="field"><label>Số tiền</label><input name="amount" type="number" min="1" step="1" value="${esc(t.amount||'')}" required autofocus></div>
    <div class="field"><label>Ngày</label><input name="transaction_date" type="date" value="${esc(t.transaction_date||today())}" required></div>
    <div class="field"><label>Tiền tệ</label><select name="currency"><option value="JPY" ${(t.currency||state.base)==='JPY'?'selected':''}>JPY</option><option value="VND" ${(t.currency||state.base)==='VND'?'selected':''}>VND</option></select></div>
    <div class="field" id="categoryField"><label>Danh mục</label><select name="category_id" id="txCategory"></select></div>
    <div class="field"><label>Tài khoản</label><select name="account_id"><option value="">— Chọn tài khoản —</option>${options(activeAccounts(),selectedAccount)}</select></div>
    <div class="field hidden" id="transferField"><label>Chuyển đến</label><select name="transfer_account_id"><option value="">— Chọn tài khoản —</option>${options(activeAccounts(),t.transfer_account_id)}</select></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(t.note||'')}" placeholder="Tùy chọn"></div>
  </div>`,async fd=>{
    if(!fd.account_id) throw new Error('Hãy chọn tài khoản để số dư được tự động cập nhật.');
    if(fd.transaction_type==='transfer'&&!fd.transfer_account_id) throw new Error('Hãy chọn tài khoản nhận.');
    if(fd.transaction_type==='transfer'&&fd.transfer_account_id===fd.account_id) throw new Error('Hai tài khoản chuyển tiền phải khác nhau.');
    await api('save_transaction',{...fd,id:id||null,fx_rate:1,category_id:fd.category_id||null,account_id:fd.account_id||null,transfer_account_id:fd.transfer_account_id||null});
  });
  const typeEl=$('#txType'), cat=$('#txCategory');
  const sync=()=>{
    const tr=typeEl.value==='transfer';
    $('#categoryField').classList.toggle('hidden',tr); $('#transferField').classList.toggle('hidden',!tr);
    if(!tr){
      const cats=activeCategories(typeEl.value); const keep=cat.value||t.category_id||'';
      cat.innerHTML='<option value="">— Chọn danh mục —</option>'+options(cats,keep);
    }
  };
  typeEl.onchange=sync; sync();
}

function openCategoryTransaction(categoryId, direction){
  openTransaction('',{transaction_type:direction,category_id:categoryId,account_id:defaultMoneyAccountId(),transaction_date:today()});
}

function openLoan(id=''){
  const l=state.loans.find(x=>x.id===id)||{}; const isNew=!id;
  modal(id?'Sửa khoản vay/nợ':'Thêm khoản vay/nợ',`<div class="form-grid">
    <div class="field full"><label>Người / đơn vị</label><input name="counterparty" value="${esc(l.counterparty||'')}" required></div>
    <div class="field"><label>Loại</label><select name="loan_type"><option value="borrowed" ${(l.loan_type||'borrowed')==='borrowed'?'selected':''}>Đi vay · mình phải trả</option><option value="lent" ${l.loan_type==='lent'?'selected':''}>Cho vay · mình phải thu</option></select></div>
    <div class="field"><label>Tiền tệ</label><select name="currency"><option value="JPY" ${(l.currency||state.base)==='JPY'?'selected':''}>JPY</option><option value="VND" ${(l.currency||state.base)==='VND'?'selected':''}>VND</option></select></div>
    <div class="field"><label>Số tiền gốc</label><input name="principal" type="number" min="1" value="${esc(l.principal||'')}" required></div>
    ${isNew?`<div class="field"><label>Tài khoản nhận / chi tiền</label><select name="funding_account_id"><option value="">— Chỉ ghi dư nợ —</option>${options(activeAccounts(),defaultMoneyAccountId())}</select><small>Chọn tài khoản để số dư được cộng/trừ tự động.</small></div>`:`<div class="field"><label>Dư nợ hiện tại</label><input name="remaining_amount" type="number" min="0" value="${esc(l.remaining_amount??0)}"></div>`}
    <div class="field"><label>Ngày bắt đầu</label><input name="start_date" type="date" value="${esc(l.start_date||today())}"></div>
    <div class="field"><label>Hạn trả</label><input name="due_date" type="date" value="${esc(l.due_date||'')}"></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(l.note||'')}"></div>
  </div>`,async fd=>{
    const saved=await api('save_loan',{...fd,id:id||null,remaining_amount:isNew?fd.principal:fd.remaining_amount});
    if(isNew&&fd.funding_account_id){
      await debtApi('open',{loan_id:saved.id,account_id:fd.funding_account_id,amount:fd.principal,transaction_date:fd.start_date||today(),note:fd.note||''});
    }
  });
}

function openLoanPayment(id){
  const l=state.loans.find(x=>x.id===id); if(!l) return toast('Không tìm thấy khoản nợ.',true);
  if(n(l.remaining_amount)<=0) return toast('Khoản này đã tất toán.');
  const borrowed=l.loan_type==='borrowed';
  modal(borrowed?'Trả nợ':'Thu hồi khoản cho vay',`<div class="form-grid">
    <div class="field full"><label>${borrowed?'Khoản phải trả':'Khoản phải thu'}</label><input value="${esc(l.counterparty)} · ${money(l.remaining_amount,l.currency)}" disabled></div>
    <div class="field"><label>Số tiền</label><input name="amount" type="number" min="1" max="${esc(l.remaining_amount)}" value="${esc(l.remaining_amount)}" required autofocus></div>
    <div class="field"><label>${borrowed?'Trả từ tài khoản':'Nhận vào tài khoản'}</label><select name="account_id" required><option value="">— Chọn tài khoản —</option>${options(activeAccounts(),defaultMoneyAccountId())}</select></div>
    <div class="field"><label>Ngày</label><input name="transaction_date" type="date" value="${today()}" required></div>
    <div class="field full"><label>Ghi chú</label><input name="note" placeholder="Tùy chọn"></div>
  </div>`,fd=>debtApi('payment',{loan_id:id,account_id:fd.account_id,amount:fd.amount,transaction_date:fd.transaction_date,note:fd.note||''}),borrowed?'Ghi trả nợ':'Ghi thu tiền');
}

function openCreditPayment(targetId){
  const target=activeAccounts().find(a=>a.id===targetId); if(!target) return toast('Không tìm thấy tài khoản nợ.',true);
  const debt=Math.max(0,-accountBalance(target)); if(!debt) return toast('Tài khoản này hiện không có dư nợ.');
  const sources=activeAccounts().filter(a=>a.id!==targetId&&['bank','cash','savings'].includes(a.account_type));
  modal('Thanh toán '+esc(target.name),`<div class="form-grid">
    <div class="field"><label>Số tiền</label><input name="amount" type="number" min="1" max="${debt}" value="${debt}" required autofocus></div>
    <div class="field"><label>Trả từ</label><select name="account_id" required><option value="">— Chọn tài khoản —</option>${options(sources,sources[0]?.id||'')}</select></div>
    <div class="field"><label>Ngày</label><input name="transaction_date" type="date" value="${today()}" required></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="Thanh toán ${esc(target.name)}"></div>
  </div>`,fd=>api('save_transaction',{transaction_type:'transfer',amount:fd.amount,currency:target.currency||state.base,fx_rate:1,transaction_date:fd.transaction_date,account_id:fd.account_id,transfer_account_id:targetId,category_id:null,note:fd.note||''}),'Thanh toán');
}

function multiCurrencyTotal(rows){
  if(!rows.length) return money(0);
  const sums={}; rows.forEach(x=>{const cur=x.currency||state.base;sums[cur]=(sums[cur]||0)+n(x.amount)});
  return Object.entries(sums).map(([cur,val])=>money(val,cur)).join(' · ');
}
function categoryMonthAmount(categoryId,direction){
  return state.transactions.filter(t=>t.transaction_type===direction&&t.category_id===categoryId).reduce((sum,t)=>sum+n(t.amount)*n(t.fx_rate||1),0);
}
function moneyBoardColumn({title,tone,items,total,addAction,emptyText}){
  return `<section class="card money-column ${tone}"><div class="money-column-head"><h3>${esc(title)}</h3><button class="column-add" type="button" onclick="${addAction}" aria-label="Thêm">＋</button></div><div class="money-items">${items.length?items.join(''):`<div class="money-empty">${esc(emptyText)}</div>`}</div><div class="money-total"><span>Tổng</span><strong>${total}</strong></div></section>`;
}
function budget(){
  const incomeCats=activeCategories('income'); const expenseCats=activeCategories('expense');
  const fixedCats=expenseCats.filter(c=>c.cost_type==='fixed'), variableCats=expenseCats.filter(c=>c.cost_type==='variable');
  const totals=monthTotals();
  const incomeItems=incomeCats.map(c=>`<button class="money-line" type="button" onclick="openCategoryTransaction('${c.id}','income')" title="Nhấn để ghi thu"><span>${esc(c.name)}</span><strong>${money(categoryMonthAmount(c.id,'income'))}</strong></button>`);
  const fixedItems=fixedCats.map(c=>`<button class="money-line" type="button" onclick="openCategoryTransaction('${c.id}','expense')" title="Nhấn để ghi chi"><span>${esc(c.name)}</span><strong>${money(categoryMonthAmount(c.id,'expense'))}</strong></button>`);
  const variableItems=variableCats.map(c=>`<button class="money-line" type="button" onclick="openCategoryTransaction('${c.id}','expense')" title="Nhấn để ghi chi"><span>${esc(c.name)}</span><strong>${money(categoryMonthAmount(c.id,'expense'))}</strong></button>`);
  const borrowed=(state.loans||[]).filter(l=>l.loan_type==='borrowed'&&n(l.remaining_amount)>0);
  const creditDebts=activeAccounts().filter(a=>['credit','loan_payable'].includes(a.account_type)&&accountBalance(a)<0);
  const debtItems=[
    ...borrowed.map(l=>`<button class="money-line" type="button" onclick="openLoanPayment('${l.id}')" title="Nhấn để trả nợ"><span>${esc(l.counterparty)}</span><strong>${money(l.remaining_amount,l.currency||state.base)}</strong></button>`),
    ...creditDebts.map(a=>`<button class="money-line" type="button" onclick="openCreditPayment('${a.id}')" title="Nhấn để thanh toán"><span>${esc(a.name)}</span><strong>${money(Math.abs(accountBalance(a)),a.currency)}</strong></button>`)
  ];
  const debtRows=[...borrowed.map(l=>({amount:l.remaining_amount,currency:l.currency})),...creditDebts.map(a=>({amount:Math.abs(accountBalance(a)),currency:a.currency}))];
  const fixedTotal=fixedCats.reduce((s,c)=>s+categoryMonthAmount(c.id,'expense'),0), variableTotal=variableCats.reduce((s,c)=>s+categoryMonthAmount(c.id,'expense'),0);
  return `<div class="finance-view-head"><div><h2>Tháng ${state.month.replace('-','/')}</h2><p>Nhấn một mục để nhập tiền; tài khoản, chi tiêu và nợ sẽ tự đồng bộ.</p></div><div class="finance-actions"><button class="btn" onclick="openCategory()">＋ Danh mục</button><button class="btn primary" onclick="openTransaction()">＋ Giao dịch</button></div></div>
  <section class="balance-card ${totals.net<0?'negative':''}"><div><span>Cân đối tháng</span><strong>${money(totals.net)}</strong></div><small>Thu nhập trừ chi tiêu sinh hoạt; vay và trả gốc không bị tính hai lần.</small></section>
  <div class="money-board">
    ${moneyBoardColumn({title:'Thu nhập',tone:'income',items:incomeItems,total:money(totals.inc),addAction:"openCategory()",emptyText:'Chưa có mục thu nhập'})}
    ${moneyBoardColumn({title:'Chi cố định',tone:'fixed',items:fixedItems,total:money(fixedTotal),addAction:"openCategory()",emptyText:'Chưa có chi cố định'})}
    ${moneyBoardColumn({title:'Chi biến động',tone:'variable',items:variableItems,total:money(variableTotal),addAction:"openCategory()",emptyText:'Chưa có chi biến động'})}
    ${moneyBoardColumn({title:'Nợ',tone:'debt',items:debtItems,total:multiCurrencyTotal(debtRows),addAction:"openLoan()",emptyText:'Chưa có khoản nợ'})}
  </div>`;
}

function txList(rows, actions=false){
  if(!rows.length) return '<div class="empty">Chưa có giao dịch.</div>';
  return `<div class="list">${rows.map(t=>{
    const type=t.transaction_type, loan=linkedLoanForTransaction(t), transfer=type==='transfer';
    const positive=['income','loan_borrow','loan_collect','loan_repayment'].includes(type);
    const negative=['expense','loan_lend','loan_out','loan_pay'].includes(type);
    let label=t.category_name||'Chưa phân loại', icon=positive?'↙':transfer?'⇄':'↗';
    if(transfer) label=`${t.account_name||'Tài khoản'} → ${t.transfer_account_name||'Tài khoản'}`;
    else if(type==='loan_borrow') label=`Vay · ${loan?.counterparty||'Khoản nợ'}`;
    else if(type==='loan_lend'||type==='loan_out') label=`Cho vay · ${loan?.counterparty||'Khoản phải thu'}`;
    else if(type==='loan_pay') label=`Trả nợ · ${loan?.counterparty||'Khoản nợ'}`;
    else if(type==='loan_collect'||type==='loan_repayment') label=`Thu hồi nợ · ${loan?.counterparty||'Khoản phải thu'}`;
    const sign=positive?'+':negative?'−':''; const cls=positive?'green':negative?'red':'';
    const editOk=['income','expense','transfer'].includes(type);
    return `<div class="tx"><div class="tx-icon">${icon}</div><div class="tx-main"><strong>${esc(label)}</strong><span>${esc(t.transaction_date)}${t.note?` · ${esc(t.note)}`:''}${t.account_name&&!transfer?` · ${esc(t.account_name)}`:''}</span></div><div class="tx-actions"><strong class="amount ${cls}">${sign}${money(t.amount,t.currency)}</strong>${actions?`${editOk?`<button class="mini-btn" onclick="openTransaction('${t.id}')">✎</button>`:''}<button class="mini-btn" onclick="deleteTransaction('${t.id}')">×</button>`:''}</div></div>`;
  }).join('')}</div>`;
}

function setTxFilter(v){state.txFilter=v;render()}
function transactions(){
  state.txFilter=state.txFilter||'all'; const q=state.search.trim().toLowerCase();
  const matchType=t=>state.txFilter==='all'||(state.txFilter==='debt'?isDebtTransaction(t):t.transaction_type===state.txFilter);
  const rows=state.transactions.filter(t=>matchType(t)&&(!q||`${t.category_name||''} ${t.note||''} ${t.account_name||''} ${linkedLoanForTransaction(t)?.counterparty||''}`.toLowerCase().includes(q)));
  const counts={all:state.transactions.length,expense:state.transactions.filter(t=>t.transaction_type==='expense').length,income:state.transactions.filter(t=>t.transaction_type==='income').length,transfer:state.transactions.filter(t=>t.transaction_type==='transfer').length,debt:state.transactions.filter(isDebtTransaction).length};
  return `<div class="toolbar"><div class="left" style="flex:1"><input id="txSearch" class="search" placeholder="Tìm theo danh mục, ghi chú hoặc tài khoản…" value="${esc(state.search)}" oninput="state.search=this.value;render()"></div><div class="right"><button class="btn primary" onclick="openTransaction()">＋ Giao dịch</button></div></div>
  <div class="filter-tabs" style="margin-bottom:14px"><button class="filter-tab ${state.txFilter==='all'?'active':''}" onclick="setTxFilter('all')">Tất cả ${counts.all}</button><button class="filter-tab ${state.txFilter==='expense'?'active':''}" onclick="setTxFilter('expense')">Chi ${counts.expense}</button><button class="filter-tab ${state.txFilter==='income'?'active':''}" onclick="setTxFilter('income')">Thu ${counts.income}</button><button class="filter-tab ${state.txFilter==='transfer'?'active':''}" onclick="setTxFilter('transfer')">Chuyển ${counts.transfer}</button><button class="filter-tab ${state.txFilter==='debt'?'active':''}" onclick="setTxFilter('debt')">Nợ ${counts.debt}</button></div>
  <section class="card section"><div class="section-head"><div><h2>${rows.length} giao dịch đang hiển thị</h2><p>Tháng ${state.month.replace('-','/')}</p></div></div>${txList(rows,true)}</section>`;
}

Object.assign(window,{debtApi,openTransaction,openCategoryTransaction,openLoan,openLoanPayment,openCreditPayment,accountBalance,txList,setTxFilter,transactions,budget});
