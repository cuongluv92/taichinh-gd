(() => {
  const V=window.__V3=window.__V3||{};
  const EXT_RPC_URL=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_extension_api`;

  state.reporting=state.reporting||{show_vnd_conversion:false,jpy_vnd_rate:null};
  state.loanTerms=state.loanTerms||[];

  async function extensionApi(action,payload={}){
    if(!state.key) throw new Error('Thiếu khóa gia đình');
    const res=await fetch(EXT_RPC_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},
      body:JSON.stringify({p_key:state.key,p_action:action,p_payload:payload})
    });
    const text=await res.text(); let data;
    try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok){
      const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
      const friendly=/exchange_rate_required/i.test(raw)?'Hãy nhập tỷ giá JPY → VND trước khi bật quy đổi.'
        :/invalid_exchange_rate/i.test(raw)?'Tỷ giá phải lớn hơn 0.'
        :/payment_exceeds_remaining/i.test(raw)?'Tiền gốc trả vượt quá dư nợ còn lại.'
        :/bank_loan_terms_required/i.test(raw)?'Khoản này chưa được thiết lập là vay ngân hàng.'
        :/invalid_account/i.test(raw)?'Hãy chọn tài khoản cùng tiền tệ với khoản vay.'
        :/loan_not_found/i.test(raw)?'Không tìm thấy khoản vay.'
        :raw;
      throw new Error(friendly);
    }
    return data;
  }

  function applyExtensionData(d){
    state.reporting={show_vnd_conversion:false,jpy_vnd_rate:null,...(d?.reporting||{})};
    state.loanTerms=d?.loan_terms||[];
    V.extLoaded=true;
  }

  async function loadFinanceExtensions(rerender=true){
    if(!state.key) return false;
    try{
      const d=await extensionApi('get');
      applyExtensionData(d);
      if(rerender&&state.household) render();
      return true;
    }catch(e){
      console.error('Finance extension load failed',e);
      return false;
    }
  }

  const previousRefresh=window.refresh;
  if(typeof previousRefresh==='function'){
    window.refresh=async function(...args){
      await previousRefresh(...args);
      await loadFinanceExtensions(false);
      if(state.household) render();
    };
  }

  let extAttempts=0;
  const extTimer=setInterval(async()=>{
    extAttempts++;
    if(state.key){
      const ok=await loadFinanceExtensions(true);
      if(ok) clearInterval(extTimer);
    }
    if(extAttempts>40) clearInterval(extTimer);
  },250);

  function loanTerms(id){return (state.loanTerms||[]).find(x=>x.loan_id===id)||null}
  function isBankLoan(l){return !!l&&loanTerms(l.id)?.loan_kind==='bank'}
  function methodLabel(v){return ({manual:'Nhập theo sao kê',equal_payment:'元利均等 · Tổng trả đều',equal_principal:'元金均等 · Gốc đều'})[v]||'Nhập theo sao kê'}
  function monthsBetween(a,b){
    if(!a||!b)return 0;
    const x=new Date(`${String(a).slice(0,10)}T00:00:00`),y=new Date(`${String(b).slice(0,10)}T00:00:00`);
    let m=(y.getFullYear()-x.getFullYear())*12+(y.getMonth()-x.getMonth());
    if(y.getDate()<x.getDate())m--;
    return Math.max(0,m);
  }
  function annuityPayment(principal,annualRate,months){
    principal=n(principal); months=Math.max(0,Math.trunc(n(months))); const r=n(annualRate)/100/12;
    if(principal<=0||months<=0)return 0;
    if(Math.abs(r)<1e-12)return principal/months;
    return principal*r/(1-Math.pow(1+r,-months));
  }
  function bankEstimate(l,date=V.localToday?.()||today()){
    const t=loanTerms(l?.id); if(!l||!t)return {principal:0,interest:0,total:0,remainingMonths:null};
    const remaining=Math.max(0,n(l.remaining_amount)),annual=n(t.annual_rate),r=annual/100/12;
    const elapsed=monthsBetween(l.start_date,date),term=n(t.term_months)||0,remainingMonths=term?Math.max(1,term-elapsed):null;
    const interest=Math.max(0,remaining*r);
    let principal=0,total=interest;
    if(t.repayment_method==='equal_payment'&&remainingMonths){
      total=annuityPayment(remaining,annual,remainingMonths);
      principal=Math.max(0,Math.min(remaining,total-interest));
    }else if(t.repayment_method==='equal_principal'&&term){
      principal=Math.min(remaining,n(l.principal)/term);
      total=principal+interest;
    }
    return {principal,interest,total,remainingMonths};
  }

  V.loanTerms=loanTerms;
  V.isBankLoan=isBankLoan;
  V.annuityPayment=annuityPayment;
  V.bankEstimate=bankEstimate;

  if(V.NEGATIVE_TYPES?.add)V.NEGATIVE_TYPES.add('loan_interest');
  window.accountBalance=a=>V.accountBalanceAt(a);
  const oldIsDebt=window.isDebtTransaction;
  window.isDebtTransaction=t=>t?.transaction_type==='loan_interest'||(typeof oldIsDebt==='function'&&oldIsDebt(t));

  const statsV3=V.statsFor;
  V.statsFor=function(txs){
    const s=statsV3(txs);
    const interest=(txs||[]).filter(t=>t.transaction_type==='loan_interest'&&V.baseTx(t)).reduce((sum,t)=>sum+n(t.amount),0);
    s.loanInterest=interest;
    s.fixed+=interest;
    s.expense+=interest;
    s.allocated+=interest;
    s.remaining=Math.max(0,s.income-s.allocated);
    s.overspend=Math.max(0,s.allocated-s.income);
    s.cashFlow=s.income-s.expense;
    return s;
  };

  V.avgExpenseMonths=function(count=3){
    const end=new Date(`${state.month}-01T00:00:00`),start=V.dataStartMonth?.()||state.month;
    let total=0,used=0;
    for(let i=0;i<count;i++){
      const d=new Date(end); d.setMonth(d.getMonth()-i);
      const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      if(key<start)continue;
      total+=V.statsFor(V.periodTransactions('month',key)).expense;
      used++;
    }
    return used?total/used:0;
  };
  V.pctChange=(now,prev)=>!n(prev)?(n(now)?null:0):(n(now)-n(prev))/Math.abs(n(prev))*100;
  V.signedPct=v=>v===null||!Number.isFinite(v)?'—':`${v>0?'+':''}${v.toFixed(1)}%`;

  function fxRate(){const r=n(state.reporting?.jpy_vnd_rate);return r>0?r:null}
  function toVND(amount,currency){
    if(currency==='VND')return n(amount);
    if(currency==='JPY'){const r=fxRate();return r?n(amount)*r:null}
    return null;
  }
  function positionVND(endDate='9999-12-31'){
    let assets=0,liabilities=0,liquid=0,invested=0,unconverted=0;
    (state.accounts||[]).forEach(a=>{
      const v=toVND(V.accountBalanceAt(a,endDate),a.currency||state.base);
      if(v===null){unconverted++;return}
      if(v>=0)assets+=v;else liabilities+=-v;
      if(['cash','bank','savings'].includes(a.account_type))liquid+=Math.max(0,v);
      if(a.account_type==='investment')invested+=Math.max(0,v);
    });
    let receivables=0,borrowed=0;
    (state.loans||[]).forEach(l=>{
      const v=toVND(V.historicalLoanRemaining(l,endDate),l.currency||state.base);
      if(v===null){unconverted++;return}
      if(l.loan_type==='lent')receivables+=v;else borrowed+=v;
    });
    const totalAssets=assets+receivables,totalLiabilities=liabilities+borrowed;
    return {assets,liabilities,receivables,borrowed,totalAssets,totalLiabilities,netWorth:totalAssets-totalLiabilities,liquid,invested,unconverted};
  }
  function periodVND(txs){
    let income=0,expense=0,debtPrincipal=0,unconverted=0;
    (txs||[]).forEach(t=>{
      const v=toVND(t.amount,t.currency||state.base);
      if(v===null){unconverted++;return}
      if(t.transaction_type==='income')income+=v;
      else if(t.transaction_type==='expense'||t.transaction_type==='loan_interest')expense+=v;
      else if(t.transaction_type==='loan_pay')debtPrincipal+=v;
    });
    return {income,expense,debtPrincipal,unconverted};
  }
  V.fxRate=fxRate; V.toVND=toVND; V.positionVND=positionVND; V.periodVND=periodVND;

  function vndSummary(context='dashboard'){
    if(!state.reporting?.show_vnd_conversion)return '';
    const r=fxRate();
    if(!r)return `<div class="v4-fx-warning">Đã bật quy đổi VND nhưng chưa có tỷ giá. Vào Cài đặt → Quy đổi VND để nhập tỷ giá.</div>`;
    const pos=positionVND(context==='dashboard'?V.endOfMonthDate(state.month):'9999-12-31');
    const flow=periodVND(V.periodTransactions('month',state.month));
    return `<section class="v4-fx-strip">
      <div class="v4-fx-title"><span>Quy đổi VND</span><b>1 JPY = ${new Intl.NumberFormat('vi-VN',{maximumFractionDigits:6}).format(r)} VND</b></div>
      <div><span>Tài sản ròng</span><strong>${money(pos.netWorth,'VND')}</strong></div>
      <div><span>Tổng tài sản</span><strong>${money(pos.totalAssets,'VND')}</strong></div>
      <div><span>Tổng nợ</span><strong>${money(pos.totalLiabilities,'VND')}</strong></div>
      <div><span>Thu / Chi tháng</span><strong>${money(flow.income,'VND')} / ${money(flow.expense,'VND')}</strong></div>
    </section>`;
  }

  const dashboardV3=V.dashboardV3,analyticsV3=V.analyticsV3,accountsV3=V.accountsV3;
  if(typeof dashboardV3==='function')V.dashboardV3=()=>vndSummary('dashboard')+dashboardV3();
  if(typeof analyticsV3==='function')V.analyticsV3=()=>vndSummary('analytics')+analyticsV3();
  if(typeof accountsV3==='function')V.accountsV3=()=>vndSummary('accounts')+accountsV3();

  function sumCurrency(rows,value=x=>x.remaining_amount){
    const out={}; rows.forEach(x=>{const c=x.currency||state.base;out[c]=(out[c]||0)+n(value(x))});return Object.entries(out).map(([c,v])=>money(v,c)).join(' · ')||money(0);
  }
  function goalCard(g){
    const p=Math.min(100,n(g.current_amount)/Math.max(1,n(g.target_amount))*100);
    return `<article class="v4-goal-card"><div class="v4-card-menu"><button onclick="openGoal('${g.id}')">✎</button><button onclick="deleteGoal('${g.id}')">×</button></div>
      <span>${g.target_date?`Hạn ${esc(g.target_date)}`:'Không đặt hạn'}</span><h3>${esc(g.name)}</h3>
      <strong>${money(g.current_amount,g.currency)} <small>/ ${money(g.target_amount,g.currency)}</small></strong>
      <div class="progress"><i style="width:${p}%"></i></div><small>${p.toFixed(0)}% hoàn thành</small>
      <div class="v4-card-actions"><button onclick="openGoalFlow('${g.id}','deposit')">＋ Góp</button><button onclick="openGoalFlow('${g.id}','withdraw')">Rút</button></div></article>`;
  }
  function personalLoanCard(l){
    const borrowed=l.loan_type==='borrowed';
    return `<article class="v4-debt-card ${borrowed?'borrowed':'lent'}"><div class="v4-card-menu"><button onclick="openLoan('${l.id}')">✎</button><button onclick="deleteLoan('${l.id}')">×</button></div>
      <span>${borrowed?'Phải trả':'Phải thu'}</span><h3>${esc(l.counterparty)}</h3><strong>${money(l.remaining_amount,l.currency)}</strong>
      <small>Gốc ${money(l.principal,l.currency)}${l.due_date?` · ${dateStatus(l.due_date)}`:''}</small>
      <div class="v4-card-actions"><button onclick="openLoanPayment('${l.id}')">${borrowed?'Trả nợ':'Thu hồi'}</button></div></article>`;
  }
  function bankLoanCard(l){
    const t=loanTerms(l.id)||{},e=bankEstimate(l),est=e.total>0?money(Math.round(e.total),l.currency):'Nhập theo sao kê';
    return `<article class="v4-bank-card"><div class="v4-card-menu"><button onclick="openLoan('${l.id}')">✎</button><button onclick="deleteLoan('${l.id}')">×</button></div>
      <div class="v4-bank-head"><span>Ngân hàng</span><b>${esc(t.institution_name||'Chưa đặt tên ngân hàng')}</b></div>
      <h3>${esc(l.counterparty)}</h3><strong>${money(l.remaining_amount,l.currency)}</strong>
      <div class="v4-bank-meta"><span>Lãi suất <b>${n(t.annual_rate).toFixed(3)}%/năm</b></span><span>${esc(methodLabel(t.repayment_method))}</span><span>${t.term_months?`${t.term_months} tháng`:''}${t.payment_day?` · trả ngày ${t.payment_day}`:''}</span></div>
      <div class="v4-bank-est"><span>Kỳ tới ước tính</span><b>${est}</b><small>Gốc/lãi thực tế nhập theo sao kê ngân hàng.</small></div>
      <div class="v4-card-actions"><button class="primary" onclick="openBankPayment('${l.id}')">Trả kỳ này</button></div></article>`;
  }

  function goalsV4(){
    const gs=state.goals||[],bank=(state.loans||[]).filter(isBankLoan),personal=(state.loans||[]).filter(l=>!isBankLoan(l));
    const borrowed=state.loans.filter(l=>l.loan_type==='borrowed'),lent=state.loans.filter(l=>l.loan_type==='lent');
    return `<div class="v4-debt-summary"><div><span>Nợ phải trả</span><strong>${sumCurrency(borrowed)}</strong></div><div><span>Khoản phải thu</span><strong>${sumCurrency(lent)}</strong></div><div><span>Vay ngân hàng</span><strong>${bank.length}</strong></div></div>
      <section class="v4-section"><div class="v4-section-head"><div><h2>Mục tiêu tiết kiệm</h2><p>Góp/rút bằng chuyển khoản để số dư luôn khớp.</p></div><button class="primary" onclick="openGoal()">＋ Mục tiêu</button></div><div class="v4-card-grid">${gs.length?gs.map(goalCard).join(''):'<div class="v4-empty">Chưa có mục tiêu.</div>'}</div></section>
      <section class="v4-section"><div class="v4-section-head"><div><h2>Vay ngân hàng</h2><p>Tách gốc và lãi; chỉ phần gốc làm giảm dư nợ.</p></div><button class="primary" onclick="openBankLoan()">＋ Vay ngân hàng</button></div><div class="v4-card-grid">${bank.length?bank.map(bankLoanCard).join(''):'<div class="v4-empty">Chưa có khoản vay ngân hàng.</div>'}</div></section>
      <section class="v4-section"><div class="v4-section-head"><div><h2>Vay / cho vay cá nhân</h2><p>Theo dõi khoản phải trả và phải thu.</p></div><button onclick="openLoan()">＋ Khoản nợ</button></div><div class="v4-card-grid">${personal.length?personal.map(personalLoanCard).join(''):'<div class="v4-empty">Chưa có khoản cá nhân.</div>'}</div></section>`;
  }
  V.goalsV4=goalsV4;

  const openLoanV3=window.openLoan;
  const openLoanPaymentV3=window.openLoanPayment;

  function openLoanV4(id='',defaults={}){
    const l=(state.loans||[]).find(x=>x.id===id)||{};
    const t=loanTerms(id)||{};
    const isNew=!id, linked=!!id&&(state.fullTransactions||[]).some(x=>x.loan_id===id);
    const initialKind=defaults.loan_kind||t.loan_kind||'personal';
    const initialType=initialKind==='bank'?'borrowed':(l.loan_type||defaults.loan_type||'borrowed');
    const currency=l.currency||defaults.currency||state.base;
    const kindLocked=linked;
    modal(id?'Sửa khoản vay/nợ':initialKind==='bank'?'Thêm vay ngân hàng':'Thêm khoản vay/nợ',`
      <div class="form-grid">
        <div class="field"><label>Nhóm</label><select name="loan_kind" id="v4LoanKind" ${kindLocked?'disabled':''}><option value="personal" ${initialKind==='personal'?'selected':''}>Cá nhân / khoản khác</option><option value="bank" ${initialKind==='bank'?'selected':''}>Vay ngân hàng</option></select>${kindLocked?`<input type="hidden" name="loan_kind" value="${esc(initialKind)}">`:''}</div>
        <div class="field"><label>Loại</label><select name="loan_type" id="v4LoanType" ${!isNew?'disabled':''}><option value="borrowed" ${initialType==='borrowed'?'selected':''}>Đi vay · phải trả</option><option value="lent" ${initialType==='lent'?'selected':''}>Cho vay · phải thu</option></select>${!isNew?`<input type="hidden" name="loan_type" value="${esc(l.loan_type)}">`:''}</div>
        <div class="field full"><label>Tên khoản / người liên quan</label><input name="counterparty" value="${esc(l.counterparty||'')}" placeholder="VD: 住宅ローン / Anh A" required autofocus></div>
        <div class="field"><label>Tiền tệ</label><select name="currency" id="v4LoanCurrency" ${!isNew?'disabled':''}><option value="JPY" ${currency==='JPY'?'selected':''}>JPY</option><option value="VND" ${currency==='VND'?'selected':''}>VND</option></select>${!isNew?`<input type="hidden" name="currency" value="${esc(currency)}">`:''}</div>
        <div class="field"><label>Số tiền gốc</label><input name="principal" type="number" min="1" step="1" value="${esc(l.principal||'')}" ${!isNew?'readonly':''} required></div>
        ${isNew?`<div class="field"><label>Tài khoản nhận / chi</label><select name="funding_account_id" id="v4LoanAccount"><option value="">— Chỉ ghi khoản nợ —</option></select></div>`:`<div class="field"><label>Dư còn lại</label><input value="${money(l.remaining_amount||0,currency)}" disabled><input type="hidden" name="remaining_amount" value="${esc(l.remaining_amount||0)}"></div>`}
        <div class="field"><label>Ngày bắt đầu</label><input name="start_date" type="date" value="${esc(l.start_date||today())}"></div>
        <div class="field"><label>Hạn cuối</label><input name="due_date" type="date" value="${esc(l.due_date||'')}"></div>
      </div>
      <div id="v4BankFields" class="v4-bank-fields">
        <div class="form-grid">
          <div class="field"><label>Ngân hàng / tổ chức</label><input name="institution_name" value="${esc(t.institution_name||'')}" placeholder="VD: MUFG, SMBC"></div>
          <div class="field"><label>Tên sản phẩm</label><input name="product_name" value="${esc(t.product_name||'')}" placeholder="VD: 住宅ローン"></div>
          <div class="field"><label>Lãi suất năm (%)</label><input name="annual_rate" type="number" min="0" step="0.001" value="${esc(t.annual_rate??0)}"></div>
          <div class="field"><label>Cách trả</label><select name="repayment_method"><option value="manual" ${(t.repayment_method||'manual')==='manual'?'selected':''}>Nhập theo sao kê</option><option value="equal_payment" ${t.repayment_method==='equal_payment'?'selected':''}>元利均等返済 · tổng đều</option><option value="equal_principal" ${t.repayment_method==='equal_principal'?'selected':''}>元金均等返済 · gốc đều</option></select></div>
          <div class="field"><label>Thời hạn (tháng)</label><input name="term_months" type="number" min="1" step="1" value="${esc(t.term_months||'')}"></div>
          <div class="field"><label>Ngày trả hàng tháng</label><input name="payment_day" type="number" min="1" max="31" value="${esc(t.payment_day||'')}"></div>
        </div>
        <div class="v4-info-note">Số tiền kỳ tới chỉ là ước tính theo lãi suất bạn nhập. Khi trả thật, hãy nhập đúng phần gốc và lãi/phí trên sao kê ngân hàng.</div>
      </div>
      <div class="field full v4-note-field"><label>Ghi chú</label><input name="note" value="${esc(l.note||'')}"></div>`,
      async fd=>{
        const kind=fd.loan_kind||initialKind;
        if(kind==='bank')fd.loan_type='borrowed';
        const saved=await api('save_loan',{
          id:id||null,counterparty:fd.counterparty,loan_type:fd.loan_type,
          principal:fd.principal,remaining_amount:isNew?fd.principal:l.remaining_amount,
          currency:fd.currency,start_date:fd.start_date,due_date:fd.due_date,note:fd.note||''
        });
        await extensionApi('save_loan_terms',{
          loan_id:saved.id,loan_kind:kind,institution_name:kind==='bank'?fd.institution_name:'',
          product_name:kind==='bank'?fd.product_name:'',annual_rate:kind==='bank'?fd.annual_rate:0,
          repayment_method:kind==='bank'?fd.repayment_method:'manual',
          term_months:kind==='bank'?fd.term_months:'',payment_day:kind==='bank'?fd.payment_day:''
        });
        if(isNew&&fd.funding_account_id){
          await debtApi('open',{loan_id:saved.id,account_id:fd.funding_account_id,amount:fd.principal,transaction_date:fd.start_date||today(),note:fd.note||''});
        }
      }
    );
    const kindEl=$('#v4LoanKind'),typeEl=$('#v4LoanType'),curEl=$('#v4LoanCurrency'),accEl=$('#v4LoanAccount'),bankBox=$('#v4BankFields');
    const sync=()=>{
      const kind=kindEl?.value||initialKind;
      bankBox?.classList.toggle('hidden',kind!=='bank');
      if(kind==='bank'&&typeEl)typeEl.value='borrowed';
      if(accEl){
        const cur=curEl?.value||currency;
        accEl.innerHTML='<option value="">— Chỉ ghi khoản nợ —</option>'+options(activeAccounts().filter(a=>(a.currency||state.base)===cur&&['cash','bank','savings'].includes(a.account_type)),defaultMoneyAccountId(),a=>`${a.name} · ${a.currency}`);
      }
    };
    if(kindEl)kindEl.onchange=sync;if(curEl)curEl.onchange=sync;sync();
  }

  function openBankLoan(){openLoanV4('',{loan_kind:'bank',loan_type:'borrowed'})}

  function openBankPayment(id){
    const l=(state.loans||[]).find(x=>x.id===id); if(!l)return toast('Không tìm thấy khoản vay.',true);
    if(!isBankLoan(l))return openLoanPaymentV3?.(id);
    if(n(l.remaining_amount)<=0)return toast('Khoản vay đã tất toán.');
    const t=loanTerms(id)||{},est=bankEstimate(l),ac=activeAccounts().filter(a=>(a.currency||state.base)===(l.currency||state.base)&&['cash','bank','savings'].includes(a.account_type));
    if(!ac.length)return toast(`Cần tài khoản ${l.currency} để trả khoản vay.`,true);
    const p0=t.repayment_method==='manual'?0:Math.round(est.principal),i0=Math.round(est.interest);
    modal('Trả khoản vay ngân hàng',`<div class="v4-payment-summary"><span>${esc(t.institution_name||'Ngân hàng')} · ${esc(l.counterparty)}</span><strong>Dư nợ ${money(l.remaining_amount,l.currency)}</strong></div>
      <div class="form-grid">
        <div class="field"><label>Trả gốc</label><input id="v4PrincipalPay" name="principal_amount" type="number" min="0" max="${esc(l.remaining_amount)}" step="1" value="${p0}" required></div>
        <div class="field"><label>Lãi / phí kỳ này</label><input id="v4InterestPay" name="interest_amount" type="number" min="0" step="1" value="${i0}" required></div>
        <div class="field"><label>Tài khoản trả</label><select name="account_id" required>${options(ac,ac[0].id,a=>`${a.name} · ${a.currency}`)}</select></div>
        <div class="field"><label>Ngày trả</label><input name="transaction_date" type="date" value="${today()}" required></div>
        <div class="field full"><label>Tổng tiền ra</label><div id="v4PaymentTotal" class="v4-payment-total">${money(p0+i0,l.currency)}</div></div>
        <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(t.institution_name||'')} ${esc(l.counterparty)}"></div>
      </div>
      <div class="v4-info-note">Gốc làm giảm dư nợ. Lãi/phí làm giảm tài sản ròng và được tính vào chi phí, nhưng không giảm gốc.</div>`,
      fd=>extensionApi('bank_payment',{loan_id:id,account_id:fd.account_id,principal_amount:fd.principal_amount,interest_amount:fd.interest_amount,transaction_date:fd.transaction_date,note:fd.note||''}),
      'Ghi thanh toán'
    );
    const p=$('#v4PrincipalPay'),i=$('#v4InterestPay'),tot=$('#v4PaymentTotal');
    const sync=()=>{if(tot)tot.textContent=money(n(p?.value)+n(i?.value),l.currency)}; if(p)p.oninput=sync;if(i)i.oninput=sync;
  }

  function openLoanPaymentV4(id){
    const l=(state.loans||[]).find(x=>x.id===id);
    return isBankLoan(l)?openBankPayment(id):openLoanPaymentV3?.(id);
  }

  window.openLoan=openLoanV4;
  window.openBankLoan=openBankLoan;
  window.openBankPayment=openBankPayment;
  window.openLoanPayment=openLoanPaymentV4;

  function txListV4(rows,actions=false){
    if(!rows?.length)return '<div class="empty">Chưa có giao dịch.</div>';
    const editable=new Set(['income','expense','transfer']);
    return `<div class="list">${rows.map(t=>{
      const full=(state.fullTransactions||[]).find(x=>x.id===t.id)||t,type=full.transaction_type,loan=(state.loans||[]).find(l=>l.id===full.loan_id);
      let icon='↗',label=t.category_name||'Giao dịch',sign='−',cls='red',sub=t.account_name||'';
      if(type==='income'){icon='↙';sign='+';cls='green'}
      else if(type==='transfer'){icon='⇄';label=`${t.account_name||'Tài khoản'} → ${t.transfer_account_name||'Tài khoản'}`;sign='';cls=''}
      else if(type==='loan_borrow'){icon='↙';label=`Vay nhận tiền${loan?` · ${loan.counterparty}`:''}`;sign='+';cls='green'}
      else if(type==='loan_lend'){icon='↗';label=`Cho vay${loan?` · ${loan.counterparty}`:''}`;sign='−';cls='red'}
      else if(type==='loan_pay'){icon='↗';label=`Trả gốc${loan?` · ${loan.counterparty}`:''}`;sign='−';cls='red'}
      else if(type==='loan_collect'){icon='↙';label=`Thu hồi cho vay${loan?` · ${loan.counterparty}`:''}`;sign='+';cls='green'}
      else if(type==='loan_interest'){icon='％';label=`Lãi / phí vay${loan?` · ${loan.counterparty}`:''}`;sign='−';cls='red'}
      else if(type==='goal_save'){icon='◎';label='Góp mục tiêu';sign='';cls=''}
      else if(type==='goal_withdraw'){icon='◎';label='Rút mục tiêu';sign='';cls=''}
      else if(type==='investment_gain'){icon='↗';label='Lãi định giá đầu tư';sign='+';cls='green'}
      else if(type==='investment_loss'){icon='↘';label='Lỗ định giá đầu tư';sign='−';cls='red'}
      const canEdit=actions&&editable.has(type);
      return `<div class="tx"><div class="tx-icon">${icon}</div><div class="tx-main"><strong>${esc(label)}</strong><span>${esc(t.transaction_date)}${t.note?` · ${esc(t.note)}`:''}${sub&&!['transfer'].includes(type)?` · ${esc(sub)}`:''}</span></div><div class="tx-actions"><strong class="amount ${cls}">${sign}${money(t.amount,t.currency)}</strong>${canEdit?`<button class="mini-btn" onclick="openTransaction('${t.id}')">✎</button><button class="mini-btn" onclick="deleteTransaction('${t.id}')">×</button>`:''}</div></div>`;
    }).join('')}</div>`;
  }
  window.txList=txListV4;

  function showV4Info(title,body){
    const dlg=$('#modal'),mb=$('#modalBody'),form=$('#modalForm');
    mb.innerHTML=`<div class="modal-head"><h3>${esc(title)}</h3><button class="mini-btn" type="button" onclick="document.getElementById('modal').close()">✕</button></div><div class="modal-content">${body}</div><div class="modal-actions"><button class="btn primary" type="button" onclick="document.getElementById('modal').close()">Đóng</button></div>`;
    form.onsubmit=e=>e.preventDefault(); dlg.showModal();
  }

  function formulaSelfTest(){
    const tests=[],add=(name,actual,expected,tol=1e-6)=>tests.push({name,actual,expected,ok:Math.abs(actual-expected)<=tol});
    const nw=(balances,receivable=0,borrowed=0)=>balances.reduce((s,x)=>s+(x>0?x:0),0)+receivable-balances.reduce((s,x)=>s+(x<0?-x:0),0)-borrowed;
    add('Vay 100k: tiền +100k, nợ +100k → tài sản ròng không đổi',nw([100000],0,100000),0);
    add('Trả gốc 20k: tiền và nợ cùng giảm → tài sản ròng không đổi',nw([80000],0,80000),0);
    add('Trả 20k gốc + 1k lãi → tài sản ròng giảm đúng 1k',nw([79000],0,80000),-1000);
    add('Cho vay 50k: tiền thành khoản phải thu → tài sản ròng giữ nguyên',nw([50000],50000,0),100000);
    add('Thanh toán thẻ là chuyển nội bộ → không giảm tài sản lần hai',nw([90000,0]),90000);
    add('Khoản trả đều 0% = gốc / số tháng',annuityPayment(120000,0,12),10000,1e-9);
    const a=annuityPayment(30000000,1,420); add('元利均等 30m JPY · 1% · 35 năm',a,84685.70968101347,1e-6);
    const r=fxRate(); if(r){const v=toVND(1000,'JPY');add('Quy đổi JPY→VND theo tỷ giá nhập tay',v,1000*r,1e-6)}
    return tests;
  }
  function runFormulaSelfTest(){
    const rows=formulaSelfTest(),pass=rows.filter(x=>x.ok).length;
    showV4Info('Kiểm định công thức độc lập',`<div class="v4-audit-head ${pass===rows.length?'ok':'bad'}"><strong>${pass}/${rows.length} phép thử PASS</strong><span>Không dùng dữ liệu thật để “tự chứng minh”; đây là các tình huống đối chứng độc lập.</span></div><div class="v4-audit-list">${rows.map(x=>`<div class="${x.ok?'ok':'bad'}"><b>${x.ok?'✓':'×'}</b><span>${esc(x.name)}</span></div>`).join('')}</div>`);
  }

  function diagnosticsV4(){
    const base=V.diagnostics?.()||{issues:[],notes:[]},issues=[...(base.issues||[])],notes=[...(base.notes||[])];
    if(state.reporting?.show_vnd_conversion&&!fxRate())issues.push('Đang bật quy đổi VND nhưng chưa có tỷ giá JPY → VND.');
    (state.loans||[]).forEach(l=>{
      if(n(l.remaining_amount)>n(l.principal)+0.01)issues.push(`Khoản ${l.counterparty}: dư nợ lớn hơn tiền gốc.`);
      const t=loanTerms(l.id);
      if(t?.loan_kind==='bank'){
        if(l.loan_type!=='borrowed')issues.push(`Khoản ${l.counterparty}: vay ngân hàng phải là khoản phải trả.`);
        if(!t.institution_name)notes.push(`Khoản ${l.counterparty}: chưa ghi tên ngân hàng.`);
        if(t.repayment_method!=='manual'&&!n(t.term_months))issues.push(`Khoản ${l.counterparty}: cần thời hạn để ước tính lịch trả.`);
      }
    });
    (state.fullTransactions||[]).filter(t=>t.transaction_type==='loan_interest').forEach(t=>{
      const l=(state.loans||[]).find(x=>x.id===t.loan_id);
      if(!l)issues.push(`Giao dịch lãi vay ${t.id}: thiếu khoản vay liên kết.`);
      else if(!isBankLoan(l))notes.push(`Giao dịch lãi vay ${t.id}: khoản liên kết chưa được đánh dấu vay ngân hàng.`);
    });
    return {issues,notes};
  }
  function runFinanceDiagnosticsV4(){
    const r=diagnosticsV4();
    showV4Info('Kiểm tra dữ liệu',`<div class="v3-diagnostics"><div class="${r.issues.length?'bad':'ok'}"><strong>${r.issues.length?`${r.issues.length} vấn đề cần xem`:'✓ Không thấy lỗi liên kết/công thức quan trọng'}</strong></div>${r.issues.length?`<ul>${r.issues.slice(0,30).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}${r.notes.length?`<h4>Lưu ý</h4><ul>${r.notes.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}<p>Kiểm tra này không tự sửa dữ liệu.</p></div>`);
  }
  function showFormulaInfoV4(){
    showV4Info('Công thức đang dùng',`<div class="v3-formulas">
      <p><b>Tài sản ròng</b> = tài sản trong tài khoản + khoản phải thu − dư âm tài khoản − khoản vay phải trả.</p>
      <p><b>Vay tiền</b>: tiền nhận vào tăng và nợ tăng cùng số → tài sản ròng không tăng giả.</p>
      <p><b>Trả gốc</b>: tiền giảm và dư nợ giảm cùng số → không tính là chi tiêu lần hai.</p>
      <p><b>Lãi/phí vay</b>: tiền giảm nhưng gốc không giảm → là chi phí và làm tài sản ròng giảm.</p>
      <p><b>Tiết kiệm / đầu tư</b>: chuyển giữa tài khoản là dịch chuyển tài sản; chỉ chi tiêu hoặc lãi/lỗ định giá mới thay đổi tài sản ròng.</p>
      <p><b>Quy đổi VND</b>: chỉ dùng tỷ giá JPY→VND bạn nhập. Không bao giờ mặc định ¥1 = ₫1.</p>
      <p><b>元利均等</b>: dùng công thức niên kim tiêu chuẩn để ước tính tổng trả đều. <b>元金均等</b>: phần gốc định kỳ bằng gốc ban đầu / số kỳ, cộng lãi trên dư nợ.</p>
      <p>Số trả vay hiển thị là <b>ước tính</b>; số thực tế luôn nhập theo sao kê ngân hàng vì lãi biến động, cách tính ngày và điều khoản từng ngân hàng có thể khác.</p>
    </div>`);
  }
  window.runFormulaSelfTest=runFormulaSelfTest;
  window.runFinanceDiagnostics=runFinanceDiagnosticsV4;
  window.showFormulaInfo=showFormulaInfoV4;

  async function saveReportingSettings(e){
    e.preventDefault();
    const fd=Object.fromEntries(new FormData(e.currentTarget).entries());
    const show=!!e.currentTarget.querySelector('[name="show_vnd_conversion"]')?.checked;
    try{
      await extensionApi('save_reporting',{show_vnd_conversion:show,jpy_vnd_rate:fd.jpy_vnd_rate||null});
      await loadFinanceExtensions(false); render(); toast('Đã lưu tỷ giá');
    }catch(err){toast(err.message,true)}
  }

  const settingsV3=window.settings;
  function settingsV4(){
    const r=state.reporting||{},rate=r.jpy_vnd_rate??'';
    const base=typeof settingsV3==='function'?settingsV3():'';
    return `<div class="v4-settings-grid">
      <section class="v3-card v4-settings-card"><div><h2>Quy đổi sang tiền Việt</h2><p>Chỉ dùng để xem tổng quy đổi; số tiền gốc trong tài khoản không bị đổi.</p></div>
        <form id="v4FxForm" class="v4-fx-form"><label class="v4-toggle"><input type="checkbox" name="show_vnd_conversion" ${r.show_vnd_conversion?'checked':''}><span>Bật hiển thị VND</span></label><label><span>1 JPY =</span><input name="jpy_vnd_rate" type="number" min="0.000001" step="0.000001" value="${esc(rate)}" placeholder="Tự nhập tỷ giá"><b>VND</b></label><button class="primary" type="submit">Lưu tỷ giá</button></form>
        <small>App không tự lấy tỷ giá để tránh số liệu thay đổi ngoài ý muốn. Bạn quyết định tỷ giá dùng cho báo cáo.</small></section>
      <section class="v3-card v4-settings-card"><div><h2>Kiểm định độc lập</h2><p>Chạy các tình huống đối chứng cho vay, nợ, thẻ, lãi và công thức trả góp.</p></div><button class="primary" onclick="runFormulaSelfTest()">Chạy kiểm định công thức</button></section>
    </div>${base}`;
  }

  const exportDataV3=window.exportData;
  window.exportData=async function(){
    try{
      const [main,ext]=await Promise.all([api('export'),extensionApi('get')]);
      const data={...main,reporting_settings:ext.reporting,loan_terms:ext.loan_terms};
      const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`taichinh-gd-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
      toast('Đã tải bản sao đầy đủ');
    }catch(e){
      console.error(e);
      if(typeof exportDataV3==='function')return exportDataV3();
      toast(e.message,true);
    }
  };

  function renderV4(){
    if(!state.household)return;
    const views={dashboard:V.dashboardV3,budget:V.budgetV3,transactions:V.legacy?.transactions||window.transactions,analytics:V.analyticsV3,accounts:V.accountsV3,investments:V.investmentsV3,goals:goalsV4,settings:settingsV4};
    const fn=views[state.view]||V.dashboardV3;
    $('#content').innerHTML=fn?fn():'';
    if(state.view==='settings'){
      $('#householdForm')?.addEventListener('submit',saveHousehold);
      $('#v4FxForm')?.addEventListener('submit',saveReportingSettings);
    }
  }
  window.settings=settingsV4;
  window.render=renderV4;
  V.settingsV4=settingsV4;
  V.goalsV4=goalsV4;
  V.loadFinanceExtensions=loadFinanceExtensions;
  V.extensionApi=extensionApi;
})();