(() => {
  'use strict';

  const V=window.__V3||{};
  const moneyFmt=(v,c=state.base)=>typeof window.money==='function'?window.money(v,c):`${Math.round(Number(v||0)).toLocaleString()} ${c}`;
  const selectedMonthDate=()=>{
    const local=V.localToday?.()||(typeof today==='function'?today():new Date().toISOString().slice(0,10));
    return String(local).slice(0,7)===state.month?String(local).slice(0,10):`${state.month}-01`;
  };
  const monthKey=v=>String(v||'').slice(0,7);
  const activeIncome=()=>typeof activeCategories==='function'?activeCategories('income'):[];
  const activeCards=()=>typeof activeAccounts==='function'?activeAccounts().filter(a=>a.account_type==='credit'):[];
  const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x};

  function salaryCategory(){
    const rows=activeIncome();
    return rows.find(c=>Number(c.planned_amount||0)>0&&/lương|salary|給与|給料|月給/i.test(c.name||''))
      ||rows.find(c=>/lương|salary|給与|給料|月給/i.test(c.name||''))
      ||rows.find(c=>Number(c.planned_amount||0)>0)
      ||null;
  }
  function salaryActual(c){
    if(!c)return 0;
    return (state.transactions||[]).filter(t=>t.transaction_type==='income'&&t.category_id===c.id).reduce((s,t)=>s+Number(t.amount||0),0);
  }
  function planConfigured(p){return !!p&&['fixed_pct','variable_pct','interest_pct','saving_pct','investment_pct','debt_pct'].some(k=>Number(p[k]||0)>0)}

  function simplifyNavigation(){
    document.querySelectorAll('[data-view="analytics"],[data-view="investments"]').forEach(x=>x.remove());
    document.querySelectorAll('[onclick*="navigate(\'analytics\')"],[onclick*="navigate(&quot;analytics&quot;)"]').forEach(x=>{x.removeAttribute('onclick');x.dataset.view='dashboard'});
    document.querySelectorAll('[onclick*="navigate(\'investments\')"],[onclick*="navigate(&quot;investments&quot;)"]').forEach(x=>{x.removeAttribute('onclick');x.dataset.view='accounts'});
    document.querySelectorAll('#nav button[data-view="budget"] span,#mobileNav button[data-view="budget"] span').forEach(x=>x.textContent='Chi tiêu');
    document.querySelectorAll('#nav button[data-view="transactions"] span,#mobileNav button[data-view="transactions"] span').forEach(x=>x.textContent='Giao dịch');
    document.querySelectorAll('#nav button[data-view="accounts"] span,#mobileNav button[data-view="accounts"] span').forEach(x=>x.textContent='Tài sản');
  }

  function patchPageTitle(){
    const map={
      dashboard:['Tổng quan','Kế hoạch tháng và phân tích tài chính'],
      budget:['Chi tiêu','Thu nhập, chi tiêu, thẻ trả góp và nợ'],
      transactions:['Giao dịch','Lịch sử dòng tiền theo tháng'],
      accounts:['Tài sản & đầu tư','Tài khoản, tiết kiệm và đầu tư'],
      goals:['Mục tiêu & nợ','Mục tiêu tiết kiệm và các khoản vay'],
      settings:['Cài đặt','Lương, danh mục và dữ liệu']
    };
    const v=map[state.view];if(!v)return;
    const h=document.getElementById('pageTitle'),p=document.getElementById('pageSubtitle');
    if(h)h.textContent=v[0];if(p)p.textContent=v[1];
  }

  function buildMonthlyPlan(){
    const p=state.allocationPlan;
    const sec=el('section','ux-plan v3-card');
    const head=el('div','ux-section-head');
    const titleBox=el('div');titleBox.append(el('h2','',`Kế hoạch tháng ${state.month.replace('-','/')}`));
    const edit=el('button','btn sm','Sửa %');edit.type='button';edit.dataset.uxAction='allocation-edit';
    head.append(titleBox,edit);sec.append(head);
    if(!planConfigured(p)){
      const empty=el('div','ux-empty','Chưa đặt tỷ lệ phân bổ cho tháng này.');sec.append(empty);return sec;
    }
    const s=typeof V.statsFor==='function'&&typeof V.periodTransactions==='function'?V.statsFor(V.periodTransactions('month',state.month)):{};
    const income=Number(s.income||0);
    const defs=[
      ['Chi cố định','fixed_pct','fixed'],['Chi biến động','variable_pct','variable'],['Lãi / phí','interest_pct','loanInterest'],
      ['Tiết kiệm','saving_pct','saving'],['Đầu tư','investment_pct','investment'],['Trả nợ','debt_pct','debtPay']
    ];
    const grid=el('div','ux-plan-grid');
    defs.forEach(([label,pctKey,actualKey])=>{
      const target=Number(p[pctKey]||0),actual=Number(s[actualKey]||0),actualPct=income>0?actual/income*100:0;
      const item=el('div','ux-plan-item');
      const top=el('div','ux-plan-item-top');top.append(el('span','',label),el('strong','',`${actualPct.toFixed(1)}% / ${target.toFixed(1)}%`));
      const progress=document.createElement('progress');progress.max=100;progress.value=target>0?Math.min(100,actualPct/target*100):0;
      const small=el('small','',`${moneyFmt(actual)} thực tế`);
      item.append(top,progress,small);grid.append(item);
    });
    sec.append(grid);return sec;
  }

  function buildSalaryOverview(){
    const c=salaryCategory();if(!c)return null;
    const planned=Number(c.planned_amount||0);if(planned<=0)return null;
    const actual=salaryActual(c);
    const sec=el('section','ux-salary-strip');
    const info=el('div');info.append(el('span','','LƯƠNG CỐ ĐỊNH'),el('strong','',actual>0?`Đã nhận ${moneyFmt(actual)}`:`Dự kiến ${moneyFmt(planned)}`));
    const small=el('small','',c.name||'Lương');info.append(small);sec.append(info);
    if(actual<=0){const b=el('button','btn sm primary','Ghi lương tháng này');b.type='button';b.dataset.uxAction='salary-record';sec.append(b)}
    return sec;
  }

  function patchDashboard(){
    if(document.querySelector('.ux-plan'))return;
    const focus=document.querySelector('.v7-focus');
    const anchor=focus||document.querySelector('#content .v3-hero')||document.querySelector('#content');
    if(!anchor)return;
    const plan=buildMonthlyPlan();
    if(anchor===document.querySelector('#content'))anchor.prepend(plan);else anchor.insertAdjacentElement('afterend',plan);
    const salary=buildSalaryOverview();if(salary)plan.insertAdjacentElement('afterend',salary);
    document.querySelectorAll('#content .v3-link').forEach(b=>{
      const txt=(b.textContent||'').toLowerCase();
      if(txt.includes('phân tích'))b.remove();
    });
  }

  function totalByCurrency(rows,valueFn){
    const map=new Map();(rows||[]).forEach(x=>{const c=x.currency||state.base,v=Number(valueFn(x)||0);map.set(c,(map.get(c)||0)+v)});
    return [...map.entries()].filter(([,v])=>Math.abs(v)>.001).map(([c,v])=>moneyFmt(v,c)).join(' · ')||moneyFmt(0);
  }

  function rebuildDebtColumn(col){
    if(!col)return;
    const list=col.querySelector('.v3-money-list'),total=col.querySelector('.v3-money-total strong');if(!list)return;
    list.replaceChildren();
    const rows=(state.loans||[]).filter(l=>l.loan_type==='borrowed'&&Number(l.remaining_amount||0)>0);
    rows.forEach(l=>{
      const b=el('button');b.type='button';b.dataset.uxAction=(typeof V.isBankLoan==='function'&&V.isBankLoan(l)&&typeof window.openBankPayment==='function')?'bank-pay':'loan-pay';b.dataset.id=l.id;
      b.append(el('span','',l.counterparty||'Khoản nợ'),el('strong','',moneyFmt(l.remaining_amount,l.currency||state.base)));list.append(b);
    });
    if(!rows.length)list.append(el('div','v3-money-empty','Chưa có khoản nợ'));
    if(total)total.textContent=totalByCurrency(rows,x=>x.remaining_amount);
  }

  function buildCreditColumn(){
    const cards=activeCards();
    const due=(state.cardOverview||[]).filter(x=>monthKey(x.next_payment_month)===state.month&&Number(x.expected_amount||0)>0);
    const dueMap=new Map(due.map(x=>[x.account_id,x]));
    const sec=el('section','v3-money-col credit ux-credit-col');
    const head=el('div','v3-money-head');head.append(el('h3','','Thẻ & trả góp'));
    const add=el('button','','＋');add.type='button';add.dataset.uxAction='credit-add';add.setAttribute('aria-label','Thêm thẻ hoặc trả góp');head.append(add);sec.append(head);
    const list=el('div','v3-money-list');
    cards.forEach(card=>{
      const o=dueMap.get(card.id),inst=(state.cardInstallments||[]).filter(i=>i.card_account_id===card.id&&monthKey(i.next_payment_month)===state.month);
      const b=el('button');b.type='button';b.dataset.uxAction=o?'card-pay':'card-settings';b.dataset.id=card.id;
      const name=el('span','ux-money-label',card.name||'Thẻ tín dụng');
      const note=el('small','',o?`${inst.length?`${inst.length} khoản trả góp · `:''}trả ${String(o.next_payment_date||'').slice(0,10)}`:'Không có kỳ trả tháng này');name.append(note);
      b.append(name,el('strong','',o?moneyFmt(o.expected_amount,o.currency||card.currency):'—'));list.append(b);
    });
    if(!cards.length)list.append(el('div','v3-money-empty','Chưa có thẻ tín dụng'));
    sec.append(list);
    const foot=el('div','v3-money-total');foot.append(el('span','','Cần trả'),el('strong','',totalByCurrency(due,x=>x.expected_amount)));sec.append(foot);
    return sec;
  }

  function patchPlannedIncome(){
    const col=document.querySelector('.v3-money-col.income');if(!col)return;
    const rows=activeIncome();
    col.querySelectorAll('.v3-money-list>button').forEach((b,i)=>{
      const c=rows[i];if(!c||Number(c.planned_amount||0)<=0||salaryActual(c)>0)return;
      const strong=b.querySelector('strong');if(strong){strong.textContent=moneyFmt(c.planned_amount);strong.classList.add('ux-planned')}
      const span=b.querySelector('span');if(span&&!span.querySelector('small'))span.append(el('small','','dự kiến'));
    });
  }

  function patchBudget(){
    document.querySelectorAll('#content .v6-plan-card,#content .rec-section').forEach(x=>x.remove());
    const board=document.querySelector('#content .v3-budget-board');if(!board||board.querySelector('.ux-credit-col'))return;
    const debt=board.querySelector('.v3-money-col.debt');
    rebuildDebtColumn(debt);board.insertBefore(buildCreditColumn(),debt||null);patchPlannedIncome();
    const note=document.querySelector('#content .v3-budget-note');if(note)note.remove();
  }

  function buildInvestmentSection(){
    const accounts=typeof window.investmentAccounts==='function'?window.investmentAccounts():activeAccounts().filter(a=>a.account_type==='investment');
    const sec=el('section','ux-investments v3-account-group');
    const head=el('div','ux-section-head');const title=el('div');title.append(el('h2','','Đầu tư'));
    const add=el('button','btn sm primary','＋ Tài khoản đầu tư');add.type='button';add.dataset.uxAction='investment-add';head.append(title,add);sec.append(head);
    if(!accounts.length){sec.append(el('div','ux-empty','Chưa có tài khoản đầu tư.'));return sec}
    const grid=el('div','v3-account-grid ux-investment-grid');
    accounts.forEach(a=>{
      const current=Number(window.accountBalance?.(a)??a.opening_balance??0),capital=Number(window.investmentCapital?.(a)??a.opening_balance??0),pl=current-capital,ret=capital>0?pl/capital*100:0;
      const card=el('article','v3-account ux-investment-card');
      const top=el('div','v3-account-top');top.append(el('span','',`${a.currency||state.base} · Đầu tư`));
      const edit=el('button','','•••');edit.type='button';edit.dataset.uxAction='account-edit';edit.dataset.id=a.id;top.append(edit);card.append(top,el('h3','',a.name||'Đầu tư'));
      const value=el('strong','',moneyFmt(current,a.currency||state.base));card.append(value);
      const metrics=el('div','ux-investment-metrics');metrics.append(el('span','',`Vốn ${moneyFmt(capital,a.currency||state.base)}`),el('span',pl>=0?'green':'red',`${pl>=0?'+':''}${moneyFmt(pl,a.currency||state.base)} · ${ret.toFixed(1)}%`));card.append(metrics);
      const actions=el('div','v3-account-actions');[['investment-in','＋ Nạp'],['investment-out','Rút'],['investment-value','Cập nhật']].forEach(([act,label])=>{const b=el('button','',label);b.type='button';b.dataset.uxAction=act;b.dataset.id=a.id;actions.append(b)});card.append(actions);grid.append(card);
    });
    sec.append(grid);return sec;
  }

  function patchAccounts(){
    document.querySelectorAll('#content .cc-section').forEach(x=>x.remove());
    document.querySelectorAll('#content .v3-account-group').forEach(g=>{
      const t=(g.querySelector('.v3-account-group-head h3')?.textContent||'').trim();
      if(t==='Đầu tư'||t==='Tín dụng & nghĩa vụ')g.remove();
    });
    const h=document.querySelector('#content .v3-view-head h2');if(h)h.textContent='Tài sản & đầu tư';
    const p=document.querySelector('#content .v3-view-head p');if(p)p.remove();
    if(!document.querySelector('#content .ux-investments'))document.querySelector('#content')?.append(buildInvestmentSection());
  }

  function buildSalarySettings(){
    const c=salaryCategory(),planned=Number(c?.planned_amount||0),actual=salaryActual(c);
    const sec=el('section','pro-card settings-panel ux-salary-settings');
    const head=el('div','panel-title');const t=el('div');t.append(el('h2','','Lương cố định'));
    const edit=el('button','btn sm','Thiết lập');edit.type='button';edit.dataset.uxAction='salary-setup';head.append(t,edit);sec.append(head);
    const body=el('div','ux-salary-settings-body');
    body.append(el('span','',c?c.name:'Chưa đặt'),el('strong','',planned>0?moneyFmt(planned):'—'),el('small','',planned>0?(actual>0?`Tháng này đã nhận ${moneyFmt(actual)}`:'Tự dùng mức này cho các tháng sau'):'Đặt mức lương dự kiến mỗi tháng'));
    if(planned>0&&actual<=0){const b=el('button','btn sm primary','Ghi lương tháng này');b.type='button';b.dataset.uxAction='salary-record';body.append(b)}
    sec.append(body);return sec;
  }

  function patchSettings(){
    document.querySelectorAll('#content .settings-panel').forEach(p=>{
      const title=(p.querySelector('h2')?.textContent||'').trim();if(title==='Tình trạng dữ liệu')p.remove();
    });
    if(document.querySelector('.ux-salary-settings'))return;
    const grid=document.querySelector('#content .settings-grid');if(!grid)return;
    const first=grid.querySelector('.settings-panel');if(first)first.insertAdjacentElement('afterend',buildSalarySettings());else grid.prepend(buildSalarySettings());
  }

  function openSalarySetup(){
    const rows=activeIncome(),current=salaryCategory();
    const opts=['<option value="__new">＋ Tạo danh mục Lương</option>',...rows.map(c=>`<option value="${esc(c.id)}" ${current?.id===c.id?'selected':''}>${esc(c.name)}</option>`)].join('');
    modal('Lương cố định',`<div class="form-grid"><div class="field"><label>Danh mục</label><select name="category_id">${opts}</select></div><div class="field"><label>Số tiền mỗi tháng</label><input name="amount" type="number" min="0" step="1" value="${esc(current?.planned_amount||'')}" required autofocus></div><div class="field"><label>Áp dụng từ tháng</label><input name="effective_month" type="month" value="${esc(state.month)}" required></div></div>`,async fd=>{
      const existing=(state.categories||[]).find(c=>c.id===fd.category_id);
      await api('save_category',{id:existing?.id||null,name:existing?.name||'Lương',direction:'income',cost_type:null,color:existing?.color||'#30d17f',planned_amount:fd.amount,effective_month:`${fd.effective_month}-01`});
    },'Lưu lương');
  }

  function recordSalary(){
    const c=salaryCategory();if(!c||Number(c.planned_amount||0)<=0)return openSalarySetup();
    window.openTransaction?.('',{transaction_type:'income',amount:Number(c.planned_amount),category_id:c.id,account_id:typeof defaultMoneyAccountId==='function'?defaultMoneyAccountId():'',transaction_date:selectedMonthDate(),note:`Lương ${state.month.replace('-','/')}`});
  }

  function upgradeCategoryForm(id=''){
    const form=document.getElementById('modalForm'),dir=document.getElementById('catDirection'),cost=document.getElementById('costField'),plan=document.getElementById('planField');
    if(!form||!dir||!plan)return;
    const c=(state.categories||[]).find(x=>x.id===id)||{};
    const sync=()=>{
      const income=dir.value==='income';if(cost)cost.classList.toggle('hidden',income);plan.classList.remove('hidden');
      const label=plan.querySelector('label');if(label)label.textContent=income?'Thu nhập dự kiến / tháng':'Số tiền kế hoạch';
    };
    dir.onchange=sync;sync();
    form.onsubmit=async e=>{
      e.preventDefault();const fd=Object.fromEntries(new FormData(form).entries()),direction=fd.direction||c.direction||'expense',submit=form.querySelector('[type="submit"]');
      try{if(submit)submit.disabled=true;await api('save_category',{id:id||null,name:fd.name,direction,cost_type:direction==='income'?null:fd.cost_type,planned_amount:fd.planned_amount||0,effective_month:`${fd.effective_month}-01`,color:fd.color||c.color||'#64748b'});document.getElementById('modal')?.close();await refresh();toast('Đã lưu')}catch(err){toast(err.message||'Không lưu được',true)}finally{if(submit)submit.disabled=false}
    };
  }

  function patchCategoryEditor(){
    const before=window.openCategory;if(typeof before!=='function'||before.__uxSimpleWrapped)return;
    const wrapped=function(id='',...rest){const out=before.call(this,id,...rest);upgradeCategoryForm(id);return out};
    Object.defineProperty(wrapped,'__uxSimpleWrapped',{value:true});window.openCategory=wrapped;
  }

  function afterRender(){
    simplifyNavigation();patchPageTitle();
    if(state.view==='dashboard')patchDashboard();
    else if(state.view==='budget')patchBudget();
    else if(state.view==='accounts')patchAccounts();
    else if(state.view==='settings')patchSettings();
  }

  const navigateBefore=window.navigate;
  if(typeof navigateBefore==='function'&&!navigateBefore.__uxSimpleWrapped){
    const wrapped=function(v,...rest){const target=v==='analytics'?'dashboard':v==='investments'?'accounts':v;return navigateBefore.call(this,target,...rest)};
    Object.defineProperty(wrapped,'__uxSimpleWrapped',{value:true});window.navigate=wrapped;
  }
  patchCategoryEditor();

  const renderBefore=window.render;
  if(typeof renderBefore==='function'&&!renderBefore.__uxSimpleWrapped){
    const wrapped=function(...args){const out=renderBefore.apply(this,args);afterRender();return out};
    Object.defineProperty(wrapped,'__uxSimpleWrapped',{value:true});window.render=wrapped;
  }

  document.addEventListener('click',e=>{
    const b=e.target.closest?.('[data-ux-action]');if(!b)return;
    const a=b.dataset.uxAction,id=b.dataset.id||'';e.preventDefault();
    if(a==='allocation-edit')return window.openAllocationPlan?.();
    if(a==='salary-setup')return openSalarySetup();
    if(a==='salary-record')return recordSalary();
    if(a==='card-pay')return window.openCreditPayment?.(id);
    if(a==='card-settings')return window.openCardSettings?.(id);
    if(a==='credit-add')return activeCards().length?window.openInstallment?.():window.openAccount?.();
    if(a==='loan-pay')return window.openLoanPayment?.(id);
    if(a==='bank-pay')return window.openBankPayment?.(id);
    if(a==='investment-add')return window.openInvestmentAccount?.();
    if(a==='investment-in')return window.openInvestmentTransfer?.(id,'in');
    if(a==='investment-out')return window.openInvestmentTransfer?.(id,'out');
    if(a==='investment-value')return window.openInvestmentValue?.(id);
    if(a==='account-edit')return window.openAccount?.(id);
  });

  const observer=new MutationObserver(()=>queueMicrotask(afterRender));
  observer.observe(document.getElementById('app')||document.body,{subtree:true,childList:true});
  afterRender();
})();