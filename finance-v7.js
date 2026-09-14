(() => {
  const V=window.__V3;
  if(!V) return;

  const PREF_KEY='taichinh_gd_quick_entry_v1';
  const currentMonth=()=>String(V.localToday?.()||today()).slice(0,7);
  const isCurrentMonth=()=>state.month===currentMonth();

  function readPrefs(){
    try{return JSON.parse(localStorage.getItem(PREF_KEY)||'{}')||{}}catch{return {}}
  }
  function writePref(type,patch){
    const all=readPrefs(); all[type]={...(all[type]||{}),...patch};
    try{localStorage.setItem(PREF_KEY,JSON.stringify(all))}catch{}
  }

  function allocationPlan(){
    const p=state.allocationPlan;
    if(p&&String(p.month||'').slice(0,7)===state.month)return p;
    return {fixed_pct:0,variable_pct:0,interest_pct:0,saving_pct:0,investment_pct:0,debt_pct:0,reserve_pct:100,inherited:false,source_month:null};
  }
  function planConfigured(p=allocationPlan()){
    return ['fixed_pct','variable_pct','interest_pct','saving_pct','investment_pct','debt_pct'].some(k=>n(p[k])>0);
  }
  function positiveCashBank(endDate='9999-12-31'){
    return (state.accounts||[])
      .filter(a=>a.is_active!==false&&(a.currency||state.base)===state.base&&['cash','bank'].includes(a.account_type))
      .reduce((sum,a)=>sum+Math.max(0,V.accountBalanceAt(a,endDate)),0);
  }
  function pendingFixedAmount(s){
    const targetFromCategories=activeCategories('expense').filter(c=>c.cost_type==='fixed').reduce((sum,c)=>{
      const planned=n(c.planned_amount),actual=V.categoryActualBase(c.id,'expense');
      return sum+Math.max(0,planned-actual);
    },0);
    const p=allocationPlan(),targetFromPlan=Math.max(0,n(s.income)*n(p.fixed_pct)/100-n(s.fixed));
    return Math.max(targetFromCategories,targetFromPlan);
  }
  function bankLoanReserve(txs){
    if(typeof V.isBankLoan!=='function'||typeof V.bankEstimate!=='function')return 0;
    return (state.loans||[]).filter(l=>l.loan_type==='borrowed'&&n(l.remaining_amount)>0&&V.isBankLoan(l)&&(l.currency||state.base)===state.base).reduce((sum,l)=>{
      const est=V.bankEstimate(l),paid=(txs||[]).filter(t=>t.loan_id===l.id&&['loan_pay','loan_interest'].includes(t.transaction_type)&&V.baseTx(t)).reduce((x,t)=>x+n(t.amount),0);
      return sum+Math.max(0,n(est.total)-paid);
    },0);
  }
  function safeSpendData(){
    const p=allocationPlan(),txs=V.periodTransactions('month',state.month),s=V.statsFor(txs),configured=planConfigured(p),todayDate=V.localToday?.()||today();
    if(!isCurrentMonth())return {available:null,configured,reason:'Chỉ tính “Có thể tiêu” cho tháng hiện tại.',s,p};
    if(!configured)return {available:null,configured:false,reason:'Đặt chỉ tiêu tháng để app giữ tiền cho các nghĩa vụ trước khi tính.',s,p};
    const spendableBalance=positiveCashBank(todayDate);
    const fixedNeed=pendingFixedAmount(s);
    const savingNeed=Math.max(0,n(s.income)*n(p.saving_pct)/100-n(s.saving));
    const investmentNeed=Math.max(0,n(s.income)*n(p.investment_pct)/100-n(s.investment));
    const targetLoanNeed=Math.max(0,n(s.income)*(n(p.debt_pct)+n(p.interest_pct))/100-(n(s.debtPay)+n(s.loanInterest)));
    const scheduledLoanNeed=bankLoanReserve(txs);
    const loanNeed=Math.max(targetLoanNeed,scheduledLoanNeed);
    const reserveNeed=Math.max(0,n(s.income)*n(p.reserve_pct)/100);
    const variableRemaining=Math.max(0,n(s.income)*n(p.variable_pct)/100-n(s.variable));
    const protectedTotal=fixedNeed+savingNeed+investmentNeed+loanNeed+reserveNeed;
    const afterProtection=Math.max(0,spendableBalance-protectedTotal);
    const available=Math.max(0,Math.min(afterProtection,variableRemaining));
    return {available,spendableBalance,fixedNeed,savingNeed,investmentNeed,loanNeed,reserveNeed,variableRemaining,protectedTotal,s,p,configured:true};
  }

  function paceData(){
    const p=allocationPlan(),s=V.statsFor(V.periodTransactions('month',state.month));
    if(!isCurrentMonth())return {status:'neutral',label:'Chỉ theo dõi nhịp chi trong tháng hiện tại.',ratio:null};
    const target=n(s.income)*n(p.variable_pct)/100;
    if(!planConfigured(p)||target<=0)return {status:'neutral',label:'Chưa đặt ngân sách chi biến động.',ratio:null};
    const now=new Date(`${V.localToday?.()||today()}T00:00:00`),days=new Date(now.getFullYear(),now.getMonth()+1,0).getDate(),elapsed=Math.min(1,Math.max(1,now.getDate())/days),used=n(s.variable),usedRatio=used/target,pace=elapsed>0?usedRatio/elapsed:0;
    let status='good',label='Đang chậm hơn kế hoạch';
    if(usedRatio>1){status='bad';label=`Đã vượt ngân sách biến động ${(usedRatio*100-100).toFixed(1)}%`}
    else if(pace>1.15){status='warn';label='Đang tiêu nhanh hơn tiến độ tháng'}
    else if(pace>=.8){status='neutral';label='Nhịp chi đang gần đúng kế hoạch'}
    return {status,label,target,used,usedRatio,elapsed,pace,day:now.getDate(),days};
  }

  V.safeSpendData=safeSpendData;
  V.paceData=paceData;

  function monthlyFocus(){
    const x=safeSpendData(),pace=paceData(),p=allocationPlan();
    const source=p.inherited&&p.source_month?`Kế thừa ${String(p.source_month).slice(0,7).replace('-','/')}`:'Chỉ tiêu tháng này';
    return `<section class="v7-focus ${pace.status}">
      <div class="v7-focus-main">
        <span class="v7-kicker">CÓ THỂ TIÊU AN TOÀN</span>
        <strong>${x.available===null?'—':money(x.available)}</strong>
        <p>${x.available===null?esc(x.reason):`Sau khi giữ lại ${money(x.protectedTotal)} cho nghĩa vụ, mục tiêu và dự phòng.`}</p>
        <div class="v7-focus-actions"><button class="primary" onclick="openQuick('expense')">＋ Chi nhanh</button><button onclick="openAllocationPlan()">Chỉnh chỉ tiêu</button></div>
      </div>
      <div class="v7-focus-side">
        <div class="v7-pace-head"><span>Tốc độ chi biến động</span><b class="${pace.status}">${pace.ratio===null?'—':`${(pace.usedRatio*100).toFixed(1)}%`}</b></div>
        ${pace.ratio===null?`<div class="v7-empty-line">${esc(pace.label)}</div>`:`<progress class="v7-progress ${pace.status}" max="100" value="${Math.min(100,pace.usedRatio*100)}"></progress><div class="v7-pace-meta"><span>${money(pace.used)} / ${money(pace.target)}</span><span>Ngày ${pace.day}/${pace.days} · ${(pace.elapsed*100).toFixed(0)}% tháng</span></div><strong class="v7-pace-message ${pace.status}">${esc(pace.label)}</strong>`}
        <small>${esc(source)}</small>
      </div>
    </section>`;
  }

  const dashboardBeforeV7=V.dashboardV3;
  if(typeof dashboardBeforeV7==='function'){
    V.dashboardV3=()=>{
      let html=dashboardBeforeV7();
      html=html.replace(/^<section class="v6-plan-strip[\s\S]*?<\/section>/,'');
      return `<div class="v7-dashboard">${monthlyFocus()}${html}</div>`;
    };
  }

  function activeTxAccounts(type,current=''){
    return activeAccounts().filter(a=>{
      if(['loan_receivable','loan_payable'].includes(a.account_type)&&a.id!==current)return false;
      if(type==='income')return ['cash','bank','savings'].includes(a.account_type)||a.id===current;
      if(type==='expense')return ['cash','bank','credit'].includes(a.account_type)||a.id===current;
      return true;
    });
  }
  function recentCategoryIds(type){
    const counts=new Map(),last=new Map(); let idx=0;
    [...(state.fullTransactions||[])].sort((a,b)=>String(b.transaction_date||'').localeCompare(String(a.transaction_date||''))).forEach(t=>{
      if(t.transaction_type!==type||!t.category_id)return;
      counts.set(t.category_id,(counts.get(t.category_id)||0)+1);
      if(!last.has(t.category_id))last.set(t.category_id,idx++);
    });
    return activeCategories(type).slice().sort((a,b)=>(counts.get(b.id)||0)-(counts.get(a.id)||0)||(last.get(a.id)??999)-(last.get(b.id)??999)||String(a.name).localeCompare(String(b.name))).map(c=>c.id);
  }
  function defaultAccount(type,defaults={}){
    const prefs=readPrefs()[type]||{},accounts=activeTxAccounts(type,defaults.account_id||'');
    const wanted=defaults.account_id||prefs.account_id;
    if(wanted&&accounts.some(a=>a.id===wanted))return wanted;
    const recent=[...(state.fullTransactions||[])].sort((a,b)=>String(b.transaction_date||'').localeCompare(String(a.transaction_date||''))).find(t=>t.transaction_type===type&&accounts.some(a=>a.id===t.account_id));
    if(recent)return recent.account_id;
    const fallback=typeof defaultMoneyAccountId==='function'?defaultMoneyAccountId():'';
    return accounts.some(a=>a.id===fallback)?fallback:(accounts[0]?.id||'');
  }
  function defaultCategory(type,defaults={}){
    if(type==='transfer')return '';
    const prefs=readPrefs()[type]||{},cats=activeCategories(type),ids=recentCategoryIds(type),wanted=defaults.category_id||prefs.category_id;
    if(wanted&&cats.some(c=>c.id===wanted))return wanted;
    return ids[0]||cats[0]?.id||'';
  }
  function amountSuggestions(type,categoryId,currency){
    const rows=[...(state.fullTransactions||[])].filter(t=>t.transaction_type===type&&n(t.amount)>0&&(t.currency||state.base)===currency&&(!categoryId||t.category_id===categoryId)).sort((a,b)=>String(b.transaction_date||'').localeCompare(String(a.transaction_date||'')));
    const uniq=[]; rows.forEach(t=>{const v=n(t.amount);if(v&&!uniq.includes(v))uniq.push(v)});
    const fallback=currency==='VND'?[50000,100000,200000,500000,1000000]:[500,1000,3000,5000,10000];
    return [...uniq,...fallback].filter((v,i,a)=>a.indexOf(v)===i).slice(0,5);
  }
  function categoryName(id){return (state.categories||[]).find(c=>c.id===id)?.name||'Chọn danh mục'}
  function accountName(id){return (state.accounts||[]).find(a=>a.id===id)?.name||'Chọn tài khoản'}

  const openTransactionBeforeV7=window.openTransaction;
  function openQuickTransaction(defaults={}){
    let type=['income','expense','transfer'].includes(defaults.transaction_type)?defaults.transaction_type:'expense';
    let accountId=defaultAccount(type,defaults),categoryId=defaultCategory(type,defaults),targetId=defaults.transfer_account_id||'',currency=(state.accounts||[]).find(a=>a.id===accountId)?.currency||state.base;
    const dlg=$('#modal'),mb=$('#modalBody'),form=$('#modalForm');
    mb.innerHTML=`<div class="modal-head"><div><span class="v7-modal-kicker">NHẬP NHANH</span><h3>Giao dịch</h3></div><button class="mini-btn" type="button" data-v7-close>✕</button></div>
      <div class="modal-content v7-quick-entry">
        <div class="v7-type-tabs"><button type="button" data-v7-type="expense">Chi</button><button type="button" data-v7-type="income">Thu</button><button type="button" data-v7-type="transfer">Chuyển</button></div>
        <div class="v7-amount"><label>Số tiền</label><div class="v7-amount-input"><span id="v7Currency">${esc(currency)}</span><input id="v7Amount" name="amount" type="number" min="1" step="1" inputmode="decimal" required autofocus placeholder="0"></div><div id="v7AmountChips" class="v7-chip-row"></div></div>
        <div id="v7CategoryBlock" class="v7-quick-block"><div class="v7-block-head"><span>Danh mục</span><b id="v7CategoryLabel"></b></div><div id="v7CategoryChips" class="v7-chip-row"></div></div>
        <div class="v7-quick-block"><div class="v7-block-head"><span>Tài khoản</span><b id="v7AccountLabel"></b></div><div id="v7AccountChips" class="v7-chip-row"></div></div>
        <div id="v7TargetBlock" class="v7-quick-block hidden"><div class="v7-block-head"><span>Chuyển đến</span><b id="v7TargetLabel">Chọn tài khoản</b></div><div id="v7TargetChips" class="v7-chip-row"></div></div>
        <details class="v7-details"><summary>Thêm chi tiết</summary><div class="form-grid"><div class="field"><label>Ngày</label><input name="transaction_date" type="date" value="${esc(defaults.transaction_date||today())}" required></div><div class="field"><label>Danh mục</label><select id="v7CategorySelect" name="category_id"></select></div><div class="field"><label>Tài khoản</label><select id="v7AccountSelect" name="account_id"></select></div><div class="field" id="v7TargetSelectField"><label>Chuyển đến</label><select id="v7TargetSelect" name="transfer_account_id"></select></div><div class="field full"><label>Ghi chú</label><input name="note" value="${esc(defaults.note||'')}" placeholder="Tùy chọn"></div></div></details>
        <input type="hidden" id="v7TxType" name="transaction_type" value="${esc(type)}"><input type="hidden" id="v7TxCurrency" name="currency" value="${esc(currency)}">
      </div><div class="modal-actions v7-modal-actions"><button class="btn" type="button" data-v7-close>Hủy</button><button class="btn primary" type="submit">Lưu</button></div>`;

    const amount=$('#v7Amount'),typeInput=$('#v7TxType'),currencyInput=$('#v7TxCurrency'),currencyLabel=$('#v7Currency'),catSelect=$('#v7CategorySelect'),accSelect=$('#v7AccountSelect'),targetSelect=$('#v7TargetSelect');
    const chips=(root,items,selected,kind,labelFn)=>{root.innerHTML=items.map(x=>`<button type="button" data-v7-${kind}="${esc(x.id)}" class="${x.id===selected?'active':''}">${esc(labelFn(x))}</button>`).join('')};
    const sync=()=>{
      const accounts=activeTxAccounts(type,accountId);
      if(!accounts.some(a=>a.id===accountId))accountId=defaultAccount(type,{});
      const acc=(state.accounts||[]).find(a=>a.id===accountId); currency=acc?.currency||state.base;
      typeInput.value=type;currencyInput.value=currency;currencyLabel.textContent=currency;
      $$('.v7-type-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.v7Type===type));
      const cats=type==='transfer'?[]:activeCategories(type),catIds=recentCategoryIds(type),catOrder=[categoryId,...catIds].filter((x,i,a)=>x&&a.indexOf(x)===i),quickCats=catOrder.map(id=>cats.find(c=>c.id===id)).filter(Boolean).slice(0,6);
      if(type!=='transfer'&&!cats.some(c=>c.id===categoryId))categoryId=defaultCategory(type,{});
      $('#v7CategoryBlock').classList.toggle('hidden',type==='transfer');
      catSelect.closest('.field').classList.toggle('hidden',type==='transfer');
      catSelect.innerHTML=type==='transfer'?'<option value=""></option>':options(cats,categoryId);
      $('#v7CategoryLabel').textContent=type==='transfer'?'':categoryName(categoryId);
      chips($('#v7CategoryChips'),quickCats,categoryId,'category',c=>c.name);
      accSelect.innerHTML=options(accounts,accountId,a=>`${a.name} · ${a.currency}`);
      $('#v7AccountLabel').textContent=accountName(accountId);
      chips($('#v7AccountChips'),accounts.slice(0,6),accountId,'account',a=>a.name);
      const targets=type==='transfer'?activeAccounts().filter(a=>a.id!==accountId&&(a.currency||state.base)===currency):[];
      if(type==='transfer'&&!targets.some(a=>a.id===targetId))targetId=targets[0]?.id||'';
      $('#v7TargetBlock').classList.toggle('hidden',type!=='transfer');
      $('#v7TargetSelectField').classList.toggle('hidden',type!=='transfer');
      targetSelect.innerHTML='<option value="">— Chọn —</option>'+options(targets,targetId,a=>`${a.name} · ${a.currency}`);
      $('#v7TargetLabel').textContent=accountName(targetId);
      chips($('#v7TargetChips'),targets.slice(0,6),targetId,'target',a=>a.name);
      const suggestions=amountSuggestions(type,categoryId,currency);
      $('#v7AmountChips').innerHTML=suggestions.map(v=>`<button type="button" data-v7-amount="${v}">${currency==='VND'?new Intl.NumberFormat('vi-VN',{notation:'compact',maximumFractionDigits:1}).format(v):new Intl.NumberFormat('ja-JP',{notation:'compact',maximumFractionDigits:1}).format(v)}</button>`).join('');
    };

    mb.querySelectorAll('[data-v7-close]').forEach(b=>b.addEventListener('click',()=>dlg.close()));
    mb.querySelector('.v7-type-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-v7-type]');if(!b)return;type=b.dataset.v7Type;accountId=defaultAccount(type,{});categoryId=defaultCategory(type,{});targetId='';sync();amount.focus()});
    $('#v7CategoryChips').addEventListener('click',e=>{const b=e.target.closest('[data-v7-category]');if(!b)return;categoryId=b.dataset.v7Category;catSelect.value=categoryId;sync()});
    $('#v7AccountChips').addEventListener('click',e=>{const b=e.target.closest('[data-v7-account]');if(!b)return;accountId=b.dataset.v7Account;accSelect.value=accountId;sync()});
    $('#v7TargetChips').addEventListener('click',e=>{const b=e.target.closest('[data-v7-target]');if(!b)return;targetId=b.dataset.v7Target;targetSelect.value=targetId;sync()});
    $('#v7AmountChips').addEventListener('click',e=>{const b=e.target.closest('[data-v7-amount]');if(!b)return;amount.value=b.dataset.v7Amount;amount.focus()});
    catSelect.addEventListener('change',()=>{categoryId=catSelect.value;sync()});
    accSelect.addEventListener('change',()=>{accountId=accSelect.value;sync()});
    targetSelect.addEventListener('change',()=>{targetId=targetSelect.value;sync()});

    form.onsubmit=async e=>{
      e.preventDefault(); const fd=Object.fromEntries(new FormData(form).entries());
      try{
        const submit=form.querySelector('[type=submit]');submit.disabled=true;
        if(!n(fd.amount))throw new Error('Hãy nhập số tiền.');
        if(!fd.account_id)throw new Error('Hãy chọn tài khoản.');
        if(fd.transaction_type!=='transfer'&&!fd.category_id)throw new Error('Hãy chọn danh mục.');
        if(fd.transaction_type==='transfer'&&!fd.transfer_account_id)throw new Error('Hãy chọn tài khoản nhận.');
        const a=(state.accounts||[]).find(x=>x.id===fd.account_id);fd.currency=a?.currency||state.base;
        await api('save_transaction',{...fd,fx_rate:1,category_id:fd.transaction_type==='transfer'?null:fd.category_id,transfer_account_id:fd.transaction_type==='transfer'?fd.transfer_account_id:null});
        writePref(fd.transaction_type,{account_id:fd.account_id,category_id:fd.category_id||null,transfer_account_id:fd.transfer_account_id||null});
        dlg.close();await refresh();toast('Đã lưu');
      }catch(err){toast(err.message,true)}finally{form.querySelector('[type=submit]')&&(form.querySelector('[type=submit]').disabled=false)}
    };
    sync();dlg.showModal();setTimeout(()=>amount.focus(),30);
  }

  window.openTransaction=function(id='',defaults={}){
    if(id&&typeof openTransactionBeforeV7==='function')return openTransactionBeforeV7(id,defaults);
    return openQuickTransaction(defaults||{});
  };
  window.openQuick=function(type){
    if(type==='loan')return window.openLoan?.();
    return openQuickTransaction({transaction_type:['income','expense','transfer'].includes(type)?type:'expense',transaction_date:today()});
  };
  V.openQuickTransaction=openQuickTransaction;
  V.formulaVersion='7.0';
})();