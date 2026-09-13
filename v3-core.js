(() => {
  const V = window.__V3 = window.__V3 || {};
  V.localToday = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const localMonth=V.localToday().slice(0,7), utcMonth=new Date().toISOString().slice(0,7);
  if(state.month===utcMonth && localMonth!==utcMonth) state.month=localMonth;
  try{ window.today=V.localToday; }catch{}
  V.TRANSFER_TYPES = new Set(['transfer','goal_save','goal_withdraw']);
  V.POSITIVE_TYPES = new Set(['income','loan_borrow','loan_collect','loan_repayment','investment_gain']);
  V.NEGATIVE_TYPES = new Set(['expense','transfer','loan_lend','loan_out','loan_pay','goal_save','goal_withdraw','investment_loss']);
  V.monthKey = d => String(d || '').slice(0,7);
  V.yearKey = d => String(d || '').slice(0,4);
  V.baseTx = t => (t.currency || state.base) === state.base;
  V.baseAmount = t => V.baseTx(t) ? n(t.amount) : 0;
  V.accountById = id => (state.accounts||[]).find(a => a.id === id);
  V.accountStartDate = a => {
    const dates=(state.fullTransactions||[]).filter(t=>t.account_id===a.id||t.transfer_account_id===a.id).map(t=>String(t.transaction_date||'')).filter(Boolean).sort();
    return dates[0] || V.localToday();
  };

  V.txDeltaForAccount = (t, accountId) => {
    let delta = 0;
    if(t.account_id === accountId){
      if(V.POSITIVE_TYPES.has(t.transaction_type)) delta += n(t.amount);
      if(V.NEGATIVE_TYPES.has(t.transaction_type)) delta -= n(t.amount);
    }
    if(V.TRANSFER_TYPES.has(t.transaction_type) && t.transfer_account_id === accountId) delta += n(t.amount);
    return delta;
  };

  V.accountBalanceAt = (a, endDate='9999-12-31') => {
    if(endDate < V.accountStartDate(a)) return 0;
    let bal = n(a.opening_balance);
    (state.fullTransactions || []).forEach(t => {
      if(String(t.transaction_date || '') <= endDate) bal += V.txDeltaForAccount(t, a.id);
    });
    return bal;
  };

  V.historicalLoanRemaining = (l, endDate) => {
    if(l.start_date && String(l.start_date).slice(0,10) > endDate) return 0;
    const paymentType = l.loan_type === 'borrowed' ? 'loan_pay' : 'loan_collect';
    const paidAfter = (state.fullTransactions || [])
      .filter(t => t.loan_id === l.id && t.transaction_type === paymentType && String(t.transaction_date || '') > endDate)
      .reduce((s,t)=>s+n(t.amount),0);
    return Math.min(n(l.principal), n(l.remaining_amount) + paidAfter);
  };

  V.financialPosition = (endDate='9999-12-31') => {
    const ac = (state.accounts||[]).filter(a => (a.currency || state.base) === state.base);
    let accountAssets=0, accountLiabilities=0, liquid=0, invested=0;
    ac.forEach(a => {
      const bal = V.accountBalanceAt(a,endDate);
      if(bal >= 0) accountAssets += bal; else accountLiabilities += -bal;
      if(['cash','bank','savings'].includes(a.account_type)) liquid += Math.max(0,bal);
      if(a.account_type === 'investment') invested += Math.max(0,bal);
    });
    const receivables = (state.loans||[]).filter(l=>l.loan_type==='lent'&&(l.currency||state.base)===state.base).reduce((s,l)=>s+V.historicalLoanRemaining(l,endDate),0);
    const borrowed = (state.loans||[]).filter(l=>l.loan_type==='borrowed'&&(l.currency||state.base)===state.base).reduce((s,l)=>s+V.historicalLoanRemaining(l,endDate),0);
    const totalAssets = accountAssets + receivables;
    const totalLiabilities = accountLiabilities + borrowed;
    return {accountAssets,accountLiabilities,receivables,borrowed,totalAssets,totalLiabilities,netWorth:totalAssets-totalLiabilities,liquid,invested};
  };

  V.categoryVersionAt = (categoryId,date) => {
    const m = `${V.monthKey(date)}-01`;
    const versions=(state.categoryVersions||[]).filter(v=>v.category_id===categoryId&&String(v.effective_month).slice(0,10)<=m).sort((a,b)=>String(b.effective_month).localeCompare(String(a.effective_month)));
    return versions[0] || (state.categories||[]).find(c=>c.id===categoryId) || {};
  };
  V.expenseKind = t => V.categoryVersionAt(t.category_id,t.transaction_date)?.cost_type || 'variable';

  V.operatingFlowTo = (type, txs) => {
    let total=0;
    txs.forEach(t=>{
      if(!V.TRANSFER_TYPES.has(t.transaction_type) || !V.baseTx(t)) return;
      const from=V.accountById(t.account_id), to=V.accountById(t.transfer_account_id);
      if(!from || !to) return;
      const amt=V.baseAmount(t);
      if(to.account_type===type && ['cash','bank'].includes(from.account_type)) total += amt;
      if(from.account_type===type && ['cash','bank'].includes(to.account_type)) total -= amt;
    });
    return total;
  };

  V.statsFor = txs => {
    const rows=(txs||[]).filter(V.baseTx); let income=0,fixed=0,variable=0,debtPay=0;
    rows.forEach(t=>{
      if(t.transaction_type==='income') income += V.baseAmount(t);
      else if(t.transaction_type==='expense') (V.expenseKind(t)==='fixed'?fixed+=V.baseAmount(t):variable+=V.baseAmount(t));
      else if(t.transaction_type==='loan_pay') debtPay += V.baseAmount(t);
    });
    const saving=Math.max(0,V.operatingFlowTo('savings',rows)),investment=Math.max(0,V.operatingFlowTo('investment',rows)),expense=fixed+variable,allocated=expense+saving+investment+debtPay;
    return {income,fixed,variable,expense,saving,investment,debtPay,allocated,remaining:Math.max(0,income-allocated),overspend:Math.max(0,allocated-income),cashFlow:income-expense};
  };

  V.periodTransactions = (period=state.analyticsPeriod, month=state.month, year=state.analyticsYear) => {
    const all=state.fullTransactions||[];
    return period==='year' ? all.filter(t=>V.yearKey(t.transaction_date)===String(year)) : all.filter(t=>V.monthKey(t.transaction_date)===month);
  };

  V.previousPeriod = () => {
    if(state.analyticsPeriod==='year') return {label:`Năm ${state.analyticsYear-1}`,txs:V.periodTransactions('year',state.month,state.analyticsYear-1)};
    const d=new Date(`${state.month}-01T00:00:00`);d.setMonth(d.getMonth()-1);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    return {label:`Tháng ${key.replace('-','/')}`,txs:V.periodTransactions('month',key,state.analyticsYear)};
  };
  V.pctChange = (now,prev) => !prev ? (now?100:0) : (now-prev)/Math.abs(prev)*100;
  V.signedPct = v => `${v>0?'+':''}${v.toFixed(1)}%`;

  V.expenseByCategory = txs => {
    const map=new Map();
    txs.filter(t=>t.transaction_type==='expense'&&V.baseTx(t)).forEach(t=>{const c=V.categoryVersionAt(t.category_id,t.transaction_date),name=c.name||t.category_name||'Khác';map.set(name,(map.get(name)||0)+V.baseAmount(t))});
    return [...map.entries()].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value);
  };

  V.avgExpenseMonths = (count=3) => {
    const end=new Date(`${state.month}-01T00:00:00`);let total=0,used=0;
    for(let i=0;i<count;i++){const d=new Date(end);d.setMonth(d.getMonth()-i);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,s=V.statsFor(V.periodTransactions('month',key));if(s.expense>0){total+=s.expense;used++}}
    return used?total/used:0;
  };
  V.endOfMonthDate = key => {const [y,m]=key.split('-').map(Number);return new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};
  V.dataStartMonth = () => { const dates=(state.fullTransactions||[]).map(t=>V.monthKey(t.transaction_date)).filter(Boolean).sort(); return dates[0] || localMonth; };
  V.netWorthSeries = (count=12) => {const end=new Date(`${state.month}-01T00:00:00`),rows=[],start=V.dataStartMonth();for(let i=count-1;i>=0;i--){const d=new Date(end);d.setMonth(d.getMonth()-i);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;if(key<start)continue;rows.push({month:key,value:V.financialPosition(V.endOfMonthDate(key)).netWorth})}return rows};

  V.assetComposition = (endDate='9999-12-31') => {
    const groups=[['Tiền mặt','cash'],['Ngân hàng','bank'],['Tiết kiệm','savings'],['Đầu tư','investment']].map(([label,type])=>({label,value:(state.accounts||[]).filter(a=>(a.currency||state.base)===state.base&&a.account_type===type).reduce((s,a)=>s+Math.max(0,V.accountBalanceAt(a,endDate)),0)}));
    const rec=V.financialPosition(endDate).receivables;if(rec>0)groups.push({label:'Phải thu',value:rec});return groups;
  };
  V.foreignSummary = () => ({foreignTx:(state.fullTransactions||[]).filter(t=>!V.baseTx(t)),foreignAc:(state.accounts||[]).filter(a=>(a.currency||state.base)!==state.base)});
  V.categoryActualBase = (id,dir='expense') => state.transactions.filter(t=>t.transaction_type===dir&&t.category_id===id&&V.baseTx(t)).reduce((s,t)=>s+V.baseAmount(t),0);
  V.pendingFixed = () => activeCategories('expense').filter(c=>c.cost_type==='fixed'&&n(c.planned_amount)>0&&V.categoryActualBase(c.id,'expense')===0);
  V.dueLoans = () => (state.loans||[]).filter(l=>l.loan_type==='borrowed'&&n(l.remaining_amount)>0&&l.due_date&&daysUntil(l.due_date)!==null&&daysUntil(l.due_date)<=14);

  V.diagnostics = () => {
    const issues=[],notes=[],ac=new Map((state.accounts||[]).map(a=>[a.id,a])),cats=new Map(state.categories.map(c=>[c.id,c]));
    (state.fullTransactions||[]).forEach(t=>{const a=ac.get(t.account_id);if(!a)issues.push(`Giao dịch ${t.id}: thiếu tài khoản nguồn`);else if((a.currency||state.base)!==(t.currency||state.base))issues.push(`Giao dịch ${t.id}: tiền tệ không khớp tài khoản`);if(V.TRANSFER_TYPES.has(t.transaction_type)){const b=ac.get(t.transfer_account_id);if(!b)issues.push(`Giao dịch ${t.id}: thiếu tài khoản nhận`);else if((b.currency||state.base)!==(t.currency||state.base))issues.push(`Giao dịch ${t.id}: tài khoản nhận khác tiền tệ`)}if(['income','expense'].includes(t.transaction_type)){const c=cats.get(t.category_id);if(!c)issues.push(`Giao dịch ${t.id}: thiếu danh mục`);else if(c.direction!==t.transaction_type)issues.push(`Giao dịch ${t.id}: danh mục sai nhóm`)}});
    const legacy=activeAccounts().filter(a=>['loan_receivable','loan_payable'].includes(a.account_type));if(legacy.length)notes.push(`Có ${legacy.length} tài khoản Phải thu/Phải trả kiểu cũ. Nên dùng mục Nợ để tránh đếm trùng.`);
    const foreign=V.foreignSummary();if(foreign.foreignAc.length)notes.push(`Có ${foreign.foreignAc.length} tài khoản ngoại tệ; tổng chính đang loại chúng khỏi ${state.base}.`);
    (state.loans||[]).forEach(l=>{const pays=(state.fullTransactions||[]).filter(t=>t.loan_id===l.id&&['loan_pay','loan_collect'].includes(t.transaction_type));if(pays.length){const expected=Math.max(0,n(l.principal)-pays.reduce((s,t)=>s+n(t.amount),0));if(Math.abs(expected-n(l.remaining_amount))>0.01)issues.push(`Khoản ${l.counterparty}: dư nợ không khớp lịch sử thanh toán.`)}});
    return {issues,notes};
  };

  Object.assign(window,{baseNetWorth:()=>V.financialPosition().netWorth,baseBorrowedDebt:()=>V.financialPosition().totalLiabilities,baseReceivables:()=>V.financialPosition().receivables,baseLiquid:()=>V.financialPosition().liquid});
})();
