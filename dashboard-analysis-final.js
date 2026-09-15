(() => {
  'use strict';
  const V=window.__V3||{};
  const moneyFmt=(v,c=state.base)=>typeof window.money==='function'?window.money(v,c):`${Math.round(Number(v||0)).toLocaleString()} ${c}`;
  const monthKey=v=>String(v||'').slice(0,7);
  const currentMonth=()=>String(V.localToday?.()||(typeof today==='function'?today():new Date().toISOString().slice(0,10))).slice(0,7);

  function plannedIncome(){return (typeof activeCategories==='function'?activeCategories('income'):[]).reduce((s,c)=>s+Number(c.planned_amount||0),0)}
  function expensePlans(){
    const rows=typeof activeCategories==='function'?activeCategories('expense'):[];
    return {
      fixed:rows.filter(c=>c.cost_type==='fixed').reduce((s,c)=>s+Number(c.planned_amount||0),0),
      variable:rows.filter(c=>c.cost_type!=='fixed').reduce((s,c)=>s+Number(c.planned_amount||0),0)
    };
  }
  function monthStats(){return typeof V.statsFor==='function'&&typeof V.periodTransactions==='function'?V.statsFor(V.periodTransactions('month',state.month)):{income:0,fixed:0,variable:0,expense:0,saving:0,investment:0,debtPay:0,loanInterest:0,cashFlow:0}}
  function plan(){const p=state.allocationPlan;return p&&monthKey(p.month)===state.month?p:{fixed_pct:0,variable_pct:0,saving_pct:0,investment_pct:0,debt_pct:0,interest_pct:0}}
  function pct(v,b){return b>0?Number(v||0)/b*100:0}
  function pctText(v,b){return b>0?`${pct(v,b).toFixed(1)}%`:'—'}

  function cardDueBase(){
    return (state.cardMonthOverview||[]).filter(x=>(x.currency||state.base)===state.base).reduce((s,x)=>s+Number(x.expected_amount||0),0);
  }
  function cardPaidBase(){
    return (state.cardMonthOverview||[]).filter(x=>(x.currency||state.base)===state.base&&x.paid).reduce((s,x)=>s+Number(x.expected_amount||0),0);
  }

  function selectedLoanTransactions(l){
    const rows=typeof V.periodTransactions==='function'?V.periodTransactions('month',state.month):(state.transactions||[]);
    return rows.filter(t=>t.loan_id===l.id);
  }
  function loanMonthInfo(l){
    const rows=selectedLoanTransactions(l),principal=rows.filter(t=>t.transaction_type==='loan_pay').reduce((s,t)=>s+Number(t.amount||0),0),interest=rows.filter(t=>t.transaction_type==='loan_interest').reduce((s,t)=>s+Number(t.amount||0),0),actual=principal+interest;
    if(actual>0)return {amount:actual,kind:'actual',note:`Đã trả tháng này · dư nợ ${moneyFmt(l.remaining_amount,l.currency||state.base)}`};
    if(monthKey(l.due_date)===state.month)return {amount:Number(l.remaining_amount||0),kind:'due',note:'Đến hạn trong tháng này'};
    if(state.month>=currentMonth()&&typeof V.isBankLoan==='function'&&V.isBankLoan(l)&&typeof V.bankEstimate==='function'){
      const at=typeof V.endOfMonthDate==='function'?V.endOfMonthDate(state.month):`${state.month}-28`,est=V.bankEstimate(l,at),amount=Number(est?.total||0);
      if(amount>0)return {amount,kind:'estimate',note:`Dự kiến kỳ này · dư nợ ${moneyFmt(l.remaining_amount,l.currency||state.base)}`};
    }
    return {amount:0,kind:'balance',note:`Dư nợ ${moneyFmt(l.remaining_amount,l.currency||state.base)}`};
  }
  function debtMonthBase(){
    return (state.loans||[]).filter(l=>l.loan_type==='borrowed'&&Number(l.remaining_amount||0)>0&&(l.currency||state.base)===state.base).reduce((s,l)=>s+Number(loanMonthInfo(l).amount||0),0);
  }

  function openDebtSettings(){
    const rows=(state.loans||[]).filter(l=>l.loan_type==='borrowed'&&Number(l.remaining_amount||0)>0);
    modal('Cài đặt · Nợ',`<div class="analysis-debt-settings"><div class="budget-version-note"><b>Quản lý các khoản nợ</b><span>Cột Nợ ở Chi tiêu chỉ tính số phải trả trong tháng vào tỷ lệ thu nhập. Dư nợ còn lại không bị cộng nhầm thành chi tiêu tháng.</span></div><div class="analysis-debt-settings-list">${rows.length?rows.map(l=>`<div class="analysis-debt-setting-row"><div><strong>${esc(l.counterparty||'Khoản nợ')}</strong><small>Dư nợ ${moneyFmt(l.remaining_amount,l.currency||state.base)}</small></div><button type="button" class="btn sm" data-analysis-debt-edit="${esc(l.id)}">Sửa</button></div>`).join(''):'<div class="budget-settings-empty">Chưa có khoản nợ.</div>'}</div><button type="button" class="btn primary" data-analysis-debt-add>＋ Thêm khoản nợ</button></div>`,async()=>{},'Đóng');
  }

  function ensureDebtColumn(){
    if(state.view!=='budget')return;
    const board=document.querySelector('#content .v3-budget-board');if(!board)return;
    let col=board.querySelector('.v3-money-col.debt');
    if(!col){col=document.createElement('section');col.className='v3-money-col debt analysis-debt-col'}
    const loans=(state.loans||[]).filter(l=>l.loan_type==='borrowed'&&Number(l.remaining_amount||0)>0),basis=plannedIncome()||Number(monthStats().income||0),sums=new Map();
    const items=loans.map(l=>{
      const cur=l.currency||state.base,info=loanMonthInfo(l);sums.set(cur,(sums.get(cur)||0)+Number(info.amount||0));
      const ratio=cur===state.base&&info.amount>0?`<small class="ux-income-pct">${pctText(info.amount,basis)}</small>`:cur!==state.base?'<small class="ux-income-pct">ngoại tệ</small>':'';
      return `<button type="button" data-analysis-debt-pay="${esc(l.id)}"><span class="ux-money-label">${esc(l.counterparty||'Khoản nợ')}<small>${esc(info.note)}</small></span><strong>${info.amount>0?moneyFmt(info.amount,cur):'—'}${ratio}</strong></button>`;
    }).join('');
    const totalText=[...sums.entries()].filter(([,v])=>Math.abs(v)>.001).map(([c,v])=>moneyFmt(v,c)).join(' · ')||moneyFmt(0,state.base),baseDue=sums.get(state.base)||0;
    col.innerHTML=`<div class="v3-money-head"><h3>Nợ</h3><small class="budget-col-hint">Khoản phải trả trong tháng</small><button type="button" data-analysis-debt-settings aria-label="Cài đặt chung cột Nợ">⚙ Cài đặt</button></div><div class="v3-money-list">${items||'<div class="v3-money-empty">Chưa có khoản nợ</div>'}</div><div class="v3-money-total"><span>Tháng này</span><strong>${totalText}<small class="ux-income-pct">${pctText(baseDue,basis)}</small></strong></div>`;
    const credit=board.querySelector('.v3-money-col.credit,.ux-credit-col');
    if(credit)credit.insertAdjacentElement('afterend',col);else board.append(col);
  }

  function removeDebtFromAssets(){
    if(state.view!=='accounts')return;
    document.querySelectorAll('#content .ux-debt-assets').forEach(x=>x.remove());
    const title=document.querySelector('#content .v3-view-head h2');if(title)title.textContent='Tài sản & đầu tư';
  }

  function removeNonAnalysisCards(){
    if(state.view!=='dashboard')return;
    document.querySelectorAll('#content .v3-card,#content .pro-card').forEach(card=>{
      const title=(card.querySelector('h2')?.textContent||'').trim();
      if(['Việc cần chú ý','Góc nhìn nhanh','Phân bổ thu nhập'].includes(title))card.remove();
    });
    document.querySelectorAll('#content .v3-two').forEach(grid=>{if(!grid.children.length)grid.remove();else if(grid.children.length===1)grid.classList.add('analysis-one')});
  }

  function planRows(){
    const s=monthStats(),incomePlan=plannedIncome(),basis=incomePlan||Number(s.income||0),ep=expensePlans(),p=plan(),cardDue=cardDueBase(),cardPaid=cardPaidBase(),debtDue=debtMonthBase();
    const savingTarget=basis*Number(p.saving_pct||0)/100,investmentTarget=basis*Number(p.investment_pct||0)/100;
    const rows=[
      {label:'Chi cố định',target:ep.fixed,actual:Number(s.fixed||0),note:'Ngân sách từ cột Chi cố định'},
      {label:'Chi biến động',target:ep.variable,actual:Number(s.variable||0),note:'Ngân sách từ cột Chi biến động'},
      {label:'Thẻ & trả góp',target:cardDue,actual:cardPaid,note:'Nghĩa vụ thanh toán · không cộng lại vào chi tiêu'},
      {label:'Nợ',target:debtDue,actual:Number(s.debtPay||0)+Number(s.loanInterest||0),note:'Gốc + lãi phải trả trong tháng'},
      {label:'Tiết kiệm',target:savingTarget,actual:Number(s.saving||0),note:Number(p.saving_pct||0)>0?`Mục tiêu ${Number(p.saving_pct).toFixed(1)}% thu nhập`:'Chưa đặt mục tiêu %'},
      {label:'Đầu tư',target:investmentTarget,actual:Number(s.investment||0),note:Number(p.investment_pct||0)>0?`Mục tiêu ${Number(p.investment_pct).toFixed(1)}% thu nhập`:'Chưa đặt mục tiêu %'}
    ];
    return {rows,basis,incomePlan,s};
  }

  function patchMonthlyPlan(){
    if(state.view!=='dashboard')return;
    const sec=document.querySelector('#content .ux-plan');if(!sec)return;
    const {rows,basis,incomePlan,s}=planRows(),head=sec.querySelector('.ux-section-head');
    [...sec.children].forEach(x=>{if(x!==head)x.remove()});
    const summary=document.createElement('div');summary.className='analysis-plan-summary';summary.innerHTML=`<div><span>Thu nhập kế hoạch</span><strong>${moneyFmt(incomePlan)}</strong><small>Thực tế ${moneyFmt(s.income||0)}</small></div><div><span>Ngân sách chi</span><strong>${moneyFmt(expensePlans().fixed+expensePlans().variable)}</strong><small>${pctText(expensePlans().fixed+expensePlans().variable,basis)} thu nhập kế hoạch</small></div><div><span>Chi thực tế</span><strong>${moneyFmt(s.expense||0)}</strong><small>${pctText(s.expense||0,basis)} thu nhập kế hoạch</small></div><div><span>Còn sau ngân sách chi</span><strong>${moneyFmt(Math.max(0,incomePlan-expensePlans().fixed-expensePlans().variable))}</strong><small>Không tính lại thanh toán thẻ</small></div>`;
    const list=document.createElement('div');list.className='analysis-plan-list';
    list.innerHTML=rows.map(r=>{const target=Number(r.target||0),actual=Number(r.actual||0),progress=target>0?Math.min(100,actual/target*100):(actual>0?100:0);return `<div class="analysis-plan-row"><div class="analysis-plan-label"><strong>${esc(r.label)}</strong><small>${esc(r.note)}</small></div><div class="analysis-plan-values"><span>Kế hoạch <b>${moneyFmt(target)}</b> · ${pctText(target,basis)}</span><span>Thực tế <b>${moneyFmt(actual)}</b> · ${pctText(actual,basis)}</span></div><progress max="100" value="${progress}"></progress></div>`}).join('');
    sec.append(summary,list);
  }

  function patchDashboardKpis(){
    if(state.view!=='dashboard')return;
    const s=monthStats(),incomePlan=plannedIncome(),ep=expensePlans(),planExpense=ep.fixed+ep.variable,kpis=[...document.querySelectorAll('#content .v3-kpis>section')];
    if(kpis[2]){kpis[2].querySelector('span')&&(kpis[2].querySelector('span').textContent='Thu nhập thực tế');kpis[2].querySelector('strong')&&(kpis[2].querySelector('strong').textContent=moneyFmt(s.income||0));kpis[2].querySelector('small')&&(kpis[2].querySelector('small').textContent=`Kế hoạch ${moneyFmt(incomePlan)}`)}
    if(kpis[3]){kpis[3].querySelector('span')&&(kpis[3].querySelector('span').textContent='Chi tiêu thực tế');kpis[3].querySelector('strong')&&(kpis[3].querySelector('strong').textContent=moneyFmt(s.expense||0));kpis[3].querySelector('small')&&(kpis[3].querySelector('small').textContent=`Kế hoạch ${moneyFmt(planExpense)} · ${pctText(s.expense||0,incomePlan||s.income)} đã dùng`)}
    const hero=document.querySelector('#content .v3-hero small');if(hero)hero.textContent='Theo số dư tài khoản và dư nợ đã ghi nhận';
  }

  function patchFocus(){
    if(state.view!=='dashboard')return;
    const focus=document.querySelector('#content .v7-focus');if(!focus)return;
    const s=monthStats(),incomePlan=plannedIncome(),ep=expensePlans(),configured=!!state.allocationPlan&&['fixed_pct','variable_pct','saving_pct','investment_pct','debt_pct','interest_pct'].some(k=>Number(state.allocationPlan?.[k]||0)>0);
    if(Number(s.income||0)>0&&configured)return;
    const kicker=focus.querySelector('.v7-kicker'),value=focus.querySelector('.v7-focus-main>strong'),desc=focus.querySelector('.v7-focus-main>p'),side=focus.querySelector('.v7-focus-side');
    if(Number(s.income||0)>0){
      if(kicker)kicker.textContent='CÒN SAU CHI TIÊU THỰC TẾ';if(value)value.textContent=moneyFmt(Math.max(0,Number(s.income||0)-Number(s.expense||0)));if(desc)desc.textContent=`Thu ${moneyFmt(s.income||0)} − chi ${moneyFmt(s.expense||0)}. Thanh toán thẻ và gốc nợ được theo dõi riêng để tránh tính chi hai lần.`;
    }else{
      const remain=Math.max(0,incomePlan-ep.fixed-ep.variable);if(kicker)kicker.textContent='DỰ KIẾN CÒN SAU NGÂN SÁCH CHI';if(value)value.textContent=moneyFmt(remain);if(desc)desc.textContent=`Thu nhập kế hoạch ${moneyFmt(incomePlan)} − ngân sách chi ${moneyFmt(ep.fixed+ep.variable)}. Đây là kế hoạch, chưa phải tiền thực tế đã nhận.`;
    }
    if(side)side.innerHTML=`<div class="analysis-focus-side"><div><span>Chi cố định kế hoạch</span><strong>${moneyFmt(ep.fixed)}</strong><small>${pctText(ep.fixed,incomePlan||s.income)}</small></div><div><span>Chi biến động kế hoạch</span><strong>${moneyFmt(ep.variable)}</strong><small>${pctText(ep.variable,incomePlan||s.income)}</small></div><div><span>Thẻ phải trả</span><strong>${moneyFmt(cardDueBase())}</strong><small>Nghĩa vụ tiền mặt</small></div><div><span>Nợ phải trả tháng</span><strong>${moneyFmt(debtMonthBase())}</strong><small>Không phải toàn bộ dư nợ</small></div></div>`;
  }

  function ensureTwelveMonthFlow(){
    if(state.view!=='dashboard'||typeof trendSvg!=='function')return;
    if(document.querySelector('#content .analysis-flow-card'))return;
    const target=[...document.querySelectorAll('#content .v3-card')].find(x=>(x.querySelector('h2')?.textContent||'').trim()==='Tài sản ròng 12 tháng');
    if(!target)return;
    const card=document.createElement('section');card.className='v3-card analysis-flow-card';card.innerHTML=`<div class="v3-card-head"><div><h2>Thu nhập & chi tiêu 12 tháng</h2><p>Chỉ dùng giao dịch thực tế đã ghi nhận</p></div></div><div class="v3-chart">${trendSvg()}</div>`;
    const grid=target.parentElement;if(grid?.classList.contains('v3-two'))grid.insertBefore(card,target);else target.insertAdjacentElement('beforebegin',card);
  }

  function afterRender(){
    removeNonAnalysisCards();
    patchMonthlyPlan();
    patchDashboardKpis();
    patchFocus();
    ensureTwelveMonthFlow();
    ensureDebtColumn();
    removeDebtFromAssets();
  }

  const renderBefore=window.render;
  if(typeof renderBefore==='function'&&!renderBefore.__dashboardAnalysisFinal){
    const wrapped=function(...args){const out=renderBefore.apply(this,args);queueMicrotask(afterRender);return out};
    Object.defineProperty(wrapped,'__dashboardAnalysisFinal',{value:true});window.render=wrapped;
  }

  document.addEventListener('click',e=>{
    if(e.target.closest?.('[data-analysis-debt-settings]')){e.preventDefault();return openDebtSettings()}
    if(e.target.closest?.('[data-analysis-debt-add]')){e.preventDefault();document.getElementById('modal')?.close();return window.openLoan?.()}
    const edit=e.target.closest?.('[data-analysis-debt-edit]');if(edit){e.preventDefault();document.getElementById('modal')?.close();return window.openLoan?.(edit.dataset.analysisDebtEdit)}
    const pay=e.target.closest?.('[data-analysis-debt-pay]');if(pay){e.preventDefault();const id=pay.dataset.analysisDebtPay,l=(state.loans||[]).find(x=>x.id===id);if(!l)return;const bank=typeof V.isBankLoan==='function'&&V.isBankLoan(l);if(bank&&typeof window.openBankPayment==='function')return window.openBankPayment(id);return window.openLoanPayment?.(id)}
  },true);

  queueMicrotask(afterRender);
})();