(() => {
  'use strict';
  const V=window.__V3||{};
  const moneyFmt=(v,c=state.base)=>typeof window.money==='function'?window.money(v,c):`${Math.round(Number(v||0)).toLocaleString()} ${c}`;

  function removeTransactionNavigation(){
    document.querySelectorAll('[data-view="transactions"]').forEach(x=>x.remove());
    document.querySelectorAll('[onclick*="navigate(\'transactions\')"]').forEach(x=>x.remove());
  }

  function plannedIncomeBasis(){
    const planned=(typeof activeCategories==='function'?activeCategories('income'):[]).reduce((s,c)=>s+Number(c.planned_amount||0),0);
    if(planned>0)return {value:planned,kind:'planned'};
    const actual=typeof V.statsFor==='function'&&typeof V.periodTransactions==='function'?Number(V.statsFor(V.periodTransactions('month',state.month))?.income||0):Number(monthTotals?.().inc||0);
    return {value:actual,kind:actual>0?'actual':'none'};
  }
  const pctText=(amount,base)=>base>0?`${(Number(amount||0)/base*100).toFixed(1)}%`:'—%';
  function setRatio(strong,amount,base,label='So với thu nhập kế hoạch tháng'){
    if(!strong)return;
    let small=strong.querySelector('.ux-income-pct');
    if(!small){small=document.createElement('small');small.className='ux-income-pct';strong.append(small)}
    small.textContent=pctText(amount,base);small.title=base>0?label:'Chưa có thu nhập kế hoạch/thực tế';
  }
  function categoryActual(id){
    if(typeof V.categoryActualBase==='function')return Number(V.categoryActualBase(id,'expense')||0);
    return (state.transactions||[]).filter(t=>t.transaction_type==='expense'&&t.category_id===id&&(t.currency||state.base)===state.base).reduce((s,t)=>s+Number(t.amount||0)*Number(t.fx_rate||1),0);
  }
  function patchRatios(){
    if(state.view!=='budget')return;
    const board=document.querySelector('#content .v3-budget-board');if(!board)return;
    const basis=plannedIncomeBasis().value,expenses=typeof activeCategories==='function'?activeCategories('expense'):[];
    [['fixed',expenses.filter(c=>c.cost_type==='fixed')],['variable',expenses.filter(c=>c.cost_type!=='fixed')]].forEach(([kind,cats])=>{
      const col=board.querySelector(`.v3-money-col.${kind}`);if(!col)return;let total=0;
      [...col.querySelectorAll('.v3-money-list>button')].forEach((b,i)=>{
        const c=cats[i];if(!c)return;const actual=categoryActual(c.id),shown=actual>0?actual:(kind==='fixed'?Number(c.planned_amount||0):0);total+=shown;setRatio(b.querySelector(':scope>strong')||b.querySelector('strong'),shown,basis);
      });
      setRatio(col.querySelector('.v3-money-total>strong'),total,basis);
    });

    const credit=board.querySelector('.v3-money-col.credit,.ux-credit-col');if(!credit)return;
    const cards=typeof activeAccounts==='function'?activeAccounts().filter(a=>a.account_type==='credit'):[],map=new Map((state.cardMonthOverview||[]).map(x=>[x.account_id,x])),sums=new Map();let baseTotal=0;
    [...credit.querySelectorAll('.v3-money-list>button')].forEach((b,i)=>{
      const card=cards[i],o=map.get(card?.id),amount=Number(o?.expected_amount||0),cur=o?.currency||card?.currency||state.base;sums.set(cur,(sums.get(cur)||0)+amount);if(cur===state.base)baseTotal+=amount;
      const strong=b.querySelector(':scope>strong')||b.querySelector('strong');
      let small=strong?.querySelector('.ux-income-pct');if(strong&&!small){small=document.createElement('small');small.className='ux-income-pct';strong.append(small)}
      if(small){small.textContent=cur===state.base?pctText(amount,basis):'ngoại tệ';small.title=cur===state.base?'So với thu nhập kế hoạch tháng':'Khác tiền tệ chính nên không cộng trực tiếp vào tỷ lệ';}
    });
    const foot=credit.querySelector('.v3-money-total>strong');
    if(foot){
      const oldPct=foot.querySelector('.ux-income-pct');if(oldPct)oldPct.remove();
      const text=[...sums.entries()].filter(([,v])=>Math.abs(v)>.001).map(([c,v])=>moneyFmt(v,c)).join(' · ')||moneyFmt(0,state.base);foot.textContent=text;
      setRatio(foot,baseTotal,basis,'Chỉ tính phần cùng tiền tệ chính so với thu nhập kế hoạch');
    }
  }

  function totalCurrencies(rows){
    const m=new Map();rows.forEach(l=>{const c=l.currency||state.base;m.set(c,(m.get(c)||0)+Number(l.remaining_amount||0))});return [...m.entries()].map(([c,v])=>moneyFmt(v,c)).join(' · ')||moneyFmt(0);
  }
  function buildDebtSection(){
    const rows=(state.loans||[]).filter(l=>Number(l.remaining_amount||0)>0),borrowed=rows.filter(l=>l.loan_type==='borrowed'),lent=rows.filter(l=>l.loan_type==='lent');
    const sec=document.createElement('section');sec.className='ux-debt-assets flow-debt-assets';sec.innerHTML=`<div class="ux-section-head"><div><h2>Nợ & phải thu</h2><small>Quản lý cùng Tài sản, không tách thành trang riêng</small></div><button type="button" class="btn sm primary" data-flow-loan-add>＋ Thêm khoản</button></div><div class="ux-debt-summary"><div><span>Tổng phải trả</span><strong class="${borrowed.length?'red':''}">${totalCurrencies(borrowed)}</strong></div><div><span>Tổng phải thu</span><strong>${totalCurrencies(lent)}</strong></div></div><div class="ux-debt-grid">${rows.length?rows.map(l=>`<article class="ux-debt-card"><div class="ux-debt-card-top"><div><small>${l.loan_type==='borrowed'?'PHẢI TRẢ':'PHẢI THU'}</small><h3>${esc(l.counterparty||'Khoản vay/nợ')}</h3></div></div><strong>${moneyFmt(l.remaining_amount,l.currency||state.base)}</strong><div class="ux-debt-actions"><button type="button" class="btn sm primary" data-flow-loan-pay="${esc(l.id)}">${l.loan_type==='borrowed'?'Trả nợ':'Thu tiền'}</button><button type="button" class="btn sm" data-flow-loan-edit="${esc(l.id)}">Sửa</button></div></article>`).join(''):'<div class="ux-empty">Chưa có khoản nợ/phải thu. Nhấn “＋ Thêm khoản” để tạo.</div>'}</div>`;return sec;
  }
  function ensureDebtVisible(){
    if(state.view!=='accounts')return;const content=document.querySelector('#content');if(!content)return;
    let sec=content.querySelector('.ux-debt-assets');if(!sec){sec=buildDebtSection();const head=content.querySelector('.v3-view-head');head?.insertAdjacentElement('afterend',sec)||content.prepend(sec)}
    else{const head=content.querySelector('.v3-view-head');if(head&&head.nextElementSibling!==sec)head.insertAdjacentElement('afterend',sec)}
    const title=content.querySelector('.v3-view-head h2');if(title)title.textContent='Tài sản · đầu tư · nợ';
  }

  function afterRender(){removeTransactionNavigation();patchRatios();ensureDebtVisible()}
  const navBefore=window.navigate;
  if(typeof navBefore==='function'&&!navBefore.__flowFinal){const wrapped=function(v,...rest){return navBefore.call(this,v==='transactions'?'dashboard':v,...rest)};Object.defineProperty(wrapped,'__flowFinal',{value:true});window.navigate=wrapped}
  const moreBefore=window.openMoreMenu;
  if(typeof moreBefore==='function'&&!moreBefore.__flowFinal){const wrapped=function(...args){const out=moreBefore.apply(this,args);queueMicrotask(removeTransactionNavigation);return out};Object.defineProperty(wrapped,'__flowFinal',{value:true});window.openMoreMenu=wrapped}
  const renderBefore=window.render;
  if(typeof renderBefore==='function'&&!renderBefore.__flowFinal){const wrapped=function(...args){const out=renderBefore.apply(this,args);queueMicrotask(afterRender);return out};Object.defineProperty(wrapped,'__flowFinal',{value:true});window.render=wrapped}

  document.addEventListener('click',e=>{
    if(e.target.closest?.('[data-flow-loan-add]')){e.preventDefault();return window.openLoan?.()}
    const edit=e.target.closest?.('[data-flow-loan-edit]');if(edit){e.preventDefault();return window.openLoan?.(edit.dataset.flowLoanEdit)}
    const pay=e.target.closest?.('[data-flow-loan-pay]');if(pay){e.preventDefault();const id=pay.dataset.flowLoanPay,l=(state.loans||[]).find(x=>x.id===id);if(!l)return;const isBank=typeof V.isBankLoan==='function'&&V.isBankLoan(l);if(isBank&&typeof window.openBankPayment==='function')return window.openBankPayment(id);return l.loan_type==='borrowed'?window.openLoanPayment?.(id):window.openLoanCollect?.(id)}
  },true);

  queueMicrotask(afterRender);
})();