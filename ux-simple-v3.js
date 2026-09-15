(() => {
  'use strict';
  const V=window.__V3||{};
  const el=(tag,cls,text)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(text!==undefined)x.textContent=text;return x};
  const moneyFmt=(v,c=state.base)=>typeof window.money==='function'?window.money(v,c):`${Math.round(Number(v||0)).toLocaleString()} ${c}`;
  const activeIncome=()=>typeof activeCategories==='function'?activeCategories('income'):[];
  const activeExpense=()=>typeof activeCategories==='function'?activeCategories('expense'):[];
  const pad=n=>String(n).padStart(2,'0');

  function salaryCategory(){
    const rows=activeIncome();
    return rows.find(c=>Number(c.planned_amount||0)>0&&/lương|salary|給与|給料|月給/i.test(c.name||''))
      ||rows.find(c=>/lương|salary|給与|給料|月給/i.test(c.name||''))
      ||rows.find(c=>Number(c.planned_amount||0)>0)||null;
  }
  function incomeBasis(){
    const stats=typeof V.statsFor==='function'&&typeof V.periodTransactions==='function'?V.statsFor(V.periodTransactions('month',state.month)):null;
    const actual=Number(stats?.income||0);if(actual>0)return {value:actual,kind:'actual'};
    const salary=salaryCategory(),planned=Number(salary?.planned_amount||0);if(planned>0)return {value:planned,kind:'salary'};
    const all=activeIncome().reduce((s,c)=>s+Number(c.planned_amount||0),0);return {value:all,kind:all>0?'planned':'none'};
  }
  function categoryActualBase(id){
    if(typeof V.categoryActualBase==='function')return Number(V.categoryActualBase(id,'expense')||0);
    return (state.transactions||[]).filter(t=>t.transaction_type==='expense'&&t.category_id===id&&(t.currency||state.base)===state.base).reduce((s,t)=>s+Number(t.amount||0)*Number(t.fx_rate||1),0);
  }
  const pct=(amount,base)=>base>0?amount/base*100:0;
  const pctText=(amount,base)=>base>0?`${pct(amount,base).toFixed(1)}%`:'—%';
  function addMonthsKey(ym,delta){const [y,m]=String(ym).slice(0,7).split('-').map(Number),idx=y*12+(m-1)+delta;return `${Math.floor(idx/12)}-${pad(idx%12+1)}`}
  function seedStatementDate(dueMonth,offset,closingDay){
    const purchaseMonth=addMonthsKey(dueMonth,-Math.max(1,Number(offset||1))),[y,m]=purchaseMonth.split('-').map(Number),last=new Date(y,m,0).getDate(),day=Math.min(Math.max(1,Number(closingDay||10)),last);
    return `${purchaseMonth}-${pad(day)}`;
  }

  function removeGoalNavigation(){
    document.querySelectorAll('[data-view="goals"]').forEach(x=>x.remove());
    document.querySelectorAll('[onclick*="navigate(\'goals\')"]').forEach(x=>{x.removeAttribute('onclick');x.dataset.view='accounts'});
  }

  function appendRatio(strong,amount,base){
    if(!strong||strong.querySelector('.ux-income-pct'))return;
    const s=el('small','ux-income-pct',pctText(amount,base));s.title=base>0?'Tỷ lệ so với thu nhập tháng':'Chưa có thu nhập/lương dự kiến';strong.append(s);
  }
  function patchSpendingRatios(){
    const board=document.querySelector('#content .v3-budget-board');if(!board)return;
    board.querySelector('.v3-money-col.debt')?.remove();
    const basis=incomeBasis().value,expense=activeExpense(),fixed=expense.filter(c=>c.cost_type==='fixed'),variable=expense.filter(c=>c.cost_type!=='fixed');
    [['fixed',fixed],['variable',variable]].forEach(([cls,cats])=>{
      const col=board.querySelector(`.v3-money-col.${cls}`);if(!col)return;
      let total=0;
      col.querySelectorAll('.v3-money-list>button').forEach((b,i)=>{
        const c=cats[i];if(!c)return;const actual=categoryActualBase(c.id),shown=actual>0?actual:(cls==='fixed'?Number(c.planned_amount||0):0);total+=shown;
        const strong=b.querySelector(':scope > strong')||b.querySelector('strong');appendRatio(strong,shown,basis);
        if(cls==='fixed'&&shown>0)strong?.classList.remove('ux-planned');
      });
      appendRatio(col.querySelector('.v3-money-total>strong'),total,basis);
    });
    const credit=board.querySelector('.ux-credit-col');
    if(credit){
      const cards=typeof activeAccounts==='function'?activeAccounts().filter(a=>a.account_type==='credit'):[],due=new Map((state.cardOverview||[]).filter(x=>String(x.next_payment_month||'').slice(0,7)===state.month).map(x=>[x.account_id,Number(x.expected_amount||0)]));let total=0;
      credit.querySelectorAll('.v3-money-list>button').forEach((b,i)=>{const amount=due.get(cards[i]?.id)||0;total+=amount;appendRatio(b.querySelector(':scope > strong')||b.querySelector('strong'),amount,basis)});
      appendRatio(credit.querySelector('.v3-money-total>strong'),total,basis);
    }
  }

  function loanAction(l){return typeof V.isBankLoan==='function'&&V.isBankLoan(l)&&typeof window.openBankPayment==='function'?'bank-pay-v3':'loan-pay-v3'}
  function debtCard(l){
    const borrowed=l.loan_type==='borrowed',card=el('article','ux-debt-card'),top=el('div','ux-debt-card-top'),left=el('div');
    left.append(el('small','',borrowed?'PHẢI TRẢ':'PHẢI THU'),el('h3','',l.counterparty||'Khoản vay/nợ'));top.append(left);card.append(top,el('strong','',moneyFmt(l.remaining_amount,l.currency||state.base)));
    const actions=el('div','ux-debt-actions');
    const pay=el('button','btn sm primary',borrowed?'Trả nợ':'Thu tiền');pay.type='button';pay.dataset.ux3Action=loanAction(l);pay.dataset.id=l.id;actions.append(pay);
    const edit=el('button','btn sm','Sửa');edit.type='button';edit.dataset.ux3Action='loan-edit';edit.dataset.id=l.id;actions.append(edit);card.append(actions);return card;
  }
  function buildDebtSection(){
    const rows=(state.loans||[]).filter(l=>Number(l.remaining_amount||0)>0),borrowed=rows.filter(l=>l.loan_type==='borrowed'),lent=rows.filter(l=>l.loan_type==='lent');
    const sec=el('section','ux-debt-assets'),head=el('div','ux-section-head'),title=el('div');title.append(el('h2','','Nợ & phải thu'));
    const add=el('button','btn sm primary','＋ Thêm khoản');add.type='button';add.dataset.ux3Action='loan-add';head.append(title,add);sec.append(head);
    const summary=el('div','ux-debt-summary'),b=el('div'),r=el('div');b.append(el('span','','Tổng phải trả'),el('strong',borrowed.length?'red':'',totalCurrency(borrowed)));r.append(el('span','','Tổng phải thu'),el('strong','',totalCurrency(lent)));summary.append(b,r);sec.append(summary);
    const grid=el('div','ux-debt-grid');rows.forEach(x=>grid.append(debtCard(x)));if(!rows.length)grid.append(el('div','ux-empty','Chưa có khoản vay hoặc khoản phải thu.'));sec.append(grid);return sec;
  }
  function totalCurrency(rows){
    const m=new Map();rows.forEach(x=>{const c=x.currency||state.base;m.set(c,(m.get(c)||0)+Number(x.remaining_amount||0))});
    return [...m.entries()].map(([c,v])=>moneyFmt(v,c)).join(' · ')||moneyFmt(0);
  }
  function patchAssets(){
    const content=document.querySelector('#content');if(!content)return;
    const title=document.querySelector('#content .v3-view-head h2');if(title)title.textContent='Tài sản · đầu tư · nợ';
    if(!content.querySelector('.ux-debt-assets'))content.append(buildDebtSection());
  }

  function paymentAccountOptions(currency,selected=''){
    const rows=typeof activeAccounts==='function'?activeAccounts().filter(a=>['cash','bank','savings'].includes(a.account_type)&&(a.currency||state.base)===currency):[];
    return '<option value="">— Chọn sau cũng được —</option>'+rows.map(a=>`<option value="${esc(a.id)}" ${a.id===selected?'selected':''}>${esc(a.name)} · ${esc(a.currency||state.base)}</option>`).join('');
  }
  function expenseCategoryOptions(selected=''){
    const rows=activeExpense(),preferred=rows.find(c=>/chi khác|khác|other/i.test(c.name||''))?.id||rows[0]?.id||'';selected=selected||preferred;
    return rows.map(c=>`<option value="${esc(c.id)}" ${c.id===selected?'selected':''}>${esc(c.name)}</option>`).join('');
  }
  function openNewCreditCard(){
    const cats=activeExpense();
    modal('Thêm thẻ tín dụng',`<div class="ux-card-intro"><b>Thẻ tín dụng là khoản chi trước, trả sau.</b> Không nhập “số dư ban đầu”. Nếu đang có tiền đã tiêu ở kỳ trước và phải trả trong tháng đang xem, nhập ngay bên dưới; app sẽ xếp đúng vào kỳ thanh toán.</div><div class="form-grid"><div class="field full"><label>Tên thẻ</label><input name="name" placeholder="VD: Rakuten" required autofocus></div><div class="field"><label>Tiền tệ</label><select id="uxCardCurrency" name="currency"><option value="JPY" ${state.base==='JPY'?'selected':''}>JPY</option><option value="VND" ${state.base==='VND'?'selected':''}>VND</option></select></div><div class="field"><label>Ngày chốt</label><input name="closing_day" type="number" min="1" max="31" value="10" required></div><div class="field"><label>Ngày thanh toán</label><input name="payment_day" type="number" min="1" max="31" value="27" required></div><div class="field"><label>Thanh toán vào</label><select name="payment_month_offset"><option value="1">Tháng sau</option><option value="2">Sau 2 tháng</option></select></div><div class="field full"><label>Trừ từ tài khoản</label><select id="uxCardPayAccount" name="payment_account_id"></select></div><div class="field full ux-card-current-due"><label>Đã chi ở kỳ trước · cần trả trong ${esc(state.month.replace('-','/'))}</label><input name="current_due_amount" type="number" min="0" step="1" value="0"><small>Ví dụ tháng trước đã dùng Rakuten ¥80,000 và tháng này ngân hàng sẽ trừ ¥80,000 thì nhập 80000. Khoản này được ghi là chi của kỳ trước, không phải chi lại tháng này.</small></div><div class="field full"><label>Danh mục của khoản đã chi kỳ trước</label><select name="current_due_category_id" ${cats.length?'':'disabled'}>${expenseCategoryOptions()}</select>${cats.length?'':'<small>Chưa có danh mục chi; để 0 ở khoản kỳ trước hoặc tạo danh mục chi trước.</small>'}</div></div>`,async fd=>{
      if(typeof V.cardApi!=='function')throw new Error('Chức năng thẻ chưa sẵn sàng.');
      const due=Number(fd.current_due_amount||0);if(due>0&&!fd.current_due_category_id)throw new Error('Hãy chọn danh mục cho khoản đã chi kỳ trước.');
      const saved=await api('save_account',{name:fd.name,account_type:'credit',currency:fd.currency,opening_balance:0});
      await V.cardApi('save',{account_id:saved.id,closing_day:fd.closing_day,payment_day:fd.payment_day,payment_month_offset:fd.payment_month_offset,payment_account_id:fd.payment_account_id||null});
      if(due>0){
        const transaction_date=seedStatementDate(state.month,fd.payment_month_offset,fd.closing_day);
        await api('save_transaction',{transaction_type:'expense',amount:due,currency:fd.currency,fx_rate:1,transaction_date,account_id:saved.id,transfer_account_id:null,category_id:fd.current_due_category_id,note:`Kỳ thẻ trước · trả ${state.month}`});
      }
    },'Tạo thẻ');
    const currency=document.getElementById('uxCardCurrency'),pay=document.getElementById('uxCardPayAccount');
    const sync=()=>{if(pay)pay.innerHTML=paymentAccountOptions(currency?.value||state.base)};currency?.addEventListener('change',sync);sync();
  }
  function openCreditChooser(){
    const hasCard=typeof activeAccounts==='function'&&activeAccounts().some(a=>a.account_type==='credit');
    modal('Thẻ & trả góp',`<div class="ux-credit-choice"><button type="button" data-ux3-action="credit-new-card"><b>＋ Thẻ tín dụng</b><span>Tên thẻ · ngày chốt · ngày trả · khoản kỳ trước cần trả tháng này</span></button><button type="button" data-ux3-action="credit-new-installment" ${hasCard?'':'disabled'}><b>＋ Khoản trả góp</b><span>Lịch đều hoặc từng tháng; hỗ trợ tháng Bonus và khoản đang trả dở</span></button>${hasCard?'':'<small>Hãy tạo thẻ trước rồi mới thêm trả góp.</small>'}</div>`,async()=>{},'Đóng');
  }

  function afterRender(){
    removeGoalNavigation();
    if(state.view==='budget')patchSpendingRatios();
    if(state.view==='accounts')patchAssets();
  }

  const navBefore=window.navigate;
  if(typeof navBefore==='function'&&!navBefore.__ux3Wrapped){const w=function(v,...rest){return navBefore.call(this,v==='goals'?'accounts':v,...rest)};Object.defineProperty(w,'__ux3Wrapped',{value:true});window.navigate=w}
  const moreBefore=window.openMoreMenu;
  if(typeof moreBefore==='function'&&!moreBefore.__ux3Wrapped){const w=function(...args){const out=moreBefore.apply(this,args);queueMicrotask(removeGoalNavigation);return out};Object.defineProperty(w,'__ux3Wrapped',{value:true});window.openMoreMenu=w}
  const renderBefore=window.render;
  if(typeof renderBefore==='function'&&!renderBefore.__ux3Wrapped){const w=function(...args){const out=renderBefore.apply(this,args);afterRender();return out};Object.defineProperty(w,'__ux3Wrapped',{value:true});window.render=w}

  document.addEventListener('click',e=>{
    const old=e.target.closest?.('[data-ux-action="credit-add"]');if(old){e.preventDefault();e.stopImmediatePropagation();return openCreditChooser()}
    const b=e.target.closest?.('[data-ux3-action]');if(!b)return;e.preventDefault();const id=b.dataset.id||'',a=b.dataset.ux3Action;
    if(a==='credit-new-card'){document.getElementById('modal')?.close();return openNewCreditCard()}
    if(a==='credit-new-installment'){document.getElementById('modal')?.close();return (window.openAdvancedInstallment||window.openInstallment)?.()}
    if(a==='loan-add')return window.openLoan?.();if(a==='loan-edit')return window.openLoan?.(id);if(a==='loan-pay-v3')return window.openLoanPayment?.(id);if(a==='bank-pay-v3')return window.openBankPayment?.(id);
  },true);

  window.openNewCreditCard=openNewCreditCard;
  afterRender();
})();