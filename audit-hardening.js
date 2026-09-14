(() => {
  const V=window.__V3=window.__V3||{};
  const EPS=.5;

  const textDate=v=>String(v||'').slice(0,10);
  const touchesAccount=(t,id)=>t?.account_id===id||t?.transfer_account_id===id;
  const txs=()=>state.fullTransactions||[];
  const accountById=id=>(state.accounts||[]).find(a=>a.id===id);
  const categoryById=id=>(state.categories||[]).find(c=>c.id===id);
  const loanById=id=>(state.loans||[]).find(l=>l.id===id);
  const goalById=id=>(state.goals||[]).find(g=>g.id===id);

  function accountAnchored(id){
    if(!id)return false;
    return txs().some(t=>touchesAccount(t,id))
      ||(state.reconciliations||[]).some(r=>r.account_id===id)
      ||(state.cardSettings||[]).some(s=>s.account_id===id||s.payment_account_id===id)
      ||(state.recurringAll||[]).some(r=>r.account_id===id)
      ||(state.statementImportBatches||[]).some(b=>b.account_id===id);
  }
  function categoryAnchored(id){
    if(!id)return false;
    return txs().some(t=>t.category_id===id)
      ||(state.recurringAll||[]).some(r=>r.category_id===id)
      ||(state.cardInstallments||[]).some(i=>i.category_id===id);
  }
  const loanAnchored=id=>!!id&&txs().some(t=>t.loan_id===id);
  const goalAnchored=id=>!!id&&(txs().some(t=>t.goal_id===id)||n(goalById(id)?.current_amount)!==0);
  const cardAnchored=id=>!!id&&(txs().some(t=>touchesAccount(t,id))||(state.cardInstallments||[]).some(i=>i.card_account_id===id));

  function addLockNote(el,msg){
    const field=el?.closest?.('.field');if(!field||field.querySelector('[data-audit-lock-note]'))return;
    const note=document.createElement('small');note.dataset.auditLockNote='1';note.className='audit-lock-note';note.textContent=msg;field.appendChild(note);
  }
  function hiddenFallback(el,value){
    if(!el?.name)return;
    const field=el.closest?.('.field')||el.parentElement;
    if(field?.querySelector(`input[type="hidden"][data-audit-lock="${el.name}"]`))return;
    const h=document.createElement('input');h.type='hidden';h.name=el.name;h.value=value??el.value??'';h.dataset.auditLock=el.name;el.after(h);
  }
  function lockSelect(el,value,msg){
    if(!el)return;hiddenFallback(el,value);el.disabled=true;el.setAttribute('aria-disabled','true');addLockNote(el,msg);
  }
  function lockInput(el,msg){
    if(!el)return;el.readOnly=true;el.setAttribute('aria-readonly','true');addLockNote(el,msg);
  }

  function wrapOpener(name,after){
    const before=window[name];if(typeof before!=='function'||before.__auditWrapped)return;
    const wrapped=function(...args){const out=before.apply(this,args);try{after(...args)}catch(e){console.error(`Audit hardening ${name}`,e)}return out};
    wrapped.__auditWrapped=true;wrapped.__auditBefore=before;window[name]=wrapped;
  }

  wrapOpener('openAccount',(id='')=>{
    if(!id||!accountAnchored(id))return;const a=accountById(id);if(!a)return;
    lockSelect(document.querySelector('#modalBody select[name="account_type"]'),a.account_type,'Đã có lịch sử nên loại tài khoản được khóa.');
    lockSelect(document.querySelector('#modalBody select[name="currency"]'),a.currency||state.base,'Đã có lịch sử nên tiền tệ được khóa.');
    lockInput(document.querySelector('#modalBody input[name="opening_balance"]'),'Đã có lịch sử nên số dư ban đầu được khóa; hãy dùng giao dịch điều chỉnh nếu cần.');
  });

  wrapOpener('openCategory',(id='')=>{
    if(!id||!categoryAnchored(id))return;const c=categoryById(id);if(!c)return;
    lockSelect(document.querySelector('#modalBody select[name="direction"]'),c.direction,'Danh mục đã được sử dụng nên không thể đổi Thu ↔ Chi.');
  });

  wrapOpener('openLoan',(id='')=>{
    if(!id||!loanAnchored(id))return;const l=loanById(id);if(!l)return;
    lockInput(document.querySelector('#modalBody input[name="start_date"]'),'Khoản vay đã có dòng tiền nên ngày bắt đầu được khóa để bảo vệ lịch sử.');
  });

  wrapOpener('openGoal',(id='')=>{
    if(!id||!goalAnchored(id))return;const g=goalById(id);if(!g)return;
    lockSelect(document.querySelector('#modalBody select[name="currency"]'),g.currency||state.base,'Mục tiêu đã có lịch sử nên tiền tệ được khóa.');
  });

  wrapOpener('openCardSettings',(id='')=>{
    if(!id||!cardAnchored(id))return;const s=(state.cardSettings||[]).find(x=>x.account_id===id);if(!s)return;
    lockInput(document.querySelector('#modalBody input[name="closing_day"]'),'Thẻ đã có lịch sử nên ngày chốt được khóa để không chuyển giao dịch cũ sang kỳ khác.');
    const offset=document.querySelector('#modalBody select[name="payment_month_offset"]');
    lockSelect(offset,s.payment_month_offset,'Thẻ đã có lịch sử nên khoảng tháng thanh toán được khóa.');
    document.querySelectorAll('#modalBody [data-cc-day-target="ccClose"]').forEach(b=>{b.disabled=true;b.setAttribute('aria-disabled','true')});
  });

  function currentBalanceAt(a,date){
    if(typeof V.accountBalanceAt==='function')return n(V.accountBalanceAt(a,date));
    let bal=n(a?.opening_balance);txs().forEach(t=>{if(textDate(t.transaction_date)<=date&&typeof V.txDeltaForAccount==='function')bal+=n(V.txDeltaForAccount(t,a.id))});return bal;
  }
  function auditRecState(a){
    const r=(state.reconciliations||[]).find(x=>x.account_id===a.id);if(!r)return {kind:'none'};
    const historicalNow=currentBalanceAt(a,textDate(r.reconciled_on));
    const historicalChanged=Math.abs(historicalNow-n(r.calculated_balance))>=EPS;
    const newerTx=txs().some(t=>touchesAccount(t,a.id)&&textDate(t.transaction_date)>textDate(r.reconciled_on));
    const checkedAt=new Date(r.updated_at||r.created_at||0).getTime();
    const changedAfter=checkedAt>0&&txs().some(t=>{
      if(!touchesAccount(t,a.id))return false;const ts=new Date(t.updated_at||t.created_at||0).getTime();return ts>checkedAt+1000;
    });
    return {kind:historicalChanged||newerTx||changedAfter?'stale':Math.abs(n(r.difference))>=EPS?'bad':'good',r,historicalChanged,newerTx,changedAfter,historicalNow};
  }
  function staleReconciliations(){return (typeof activeAccounts==='function'?activeAccounts():state.accounts||[]).map(a=>({a,...auditRecState(a)})).filter(x=>x.kind==='stale')}
  V.auditReconciliationState=auditRecState;

  const diagBefore=V.diagnostics;
  if(typeof diagBefore==='function')V.diagnostics=function(){
    const d=diagBefore()||{issues:[],notes:[]};d.issues=d.issues||[];d.notes=d.notes||[];
    staleReconciliations().filter(x=>x.historicalChanged).forEach(x=>{
      const msg=`${x.a.name}: dữ liệu trước ngày đối soát đã thay đổi; cần đối soát lại.`;
      if(!d.issues.includes(msg))d.issues.push(msg);
    });
    return d;
  };

  function patchReconciliationUI(){
    const accounts=typeof activeAccounts==='function'?activeAccounts():[];
    document.querySelectorAll('.recon-row').forEach((row,i)=>{
      const a=accounts[i];if(!a)return;const st=auditRecState(a);if(st.kind!=='stale')return;
      row.classList.remove('good');row.classList.add('stale');
      const badge=row.querySelector('.recon-status');if(badge){badge.classList.remove('good');badge.classList.add('stale');badge.textContent=st.historicalChanged?'Cần đối soát lại':'Có giao dịch mới'}
      if(st.historicalChanged){const small=row.querySelector('.recon-last small');if(small&&!small.textContent.includes('lịch sử đã đổi'))small.textContent+=' · lịch sử đã đổi'}
    });
    const stale=staleReconciliations();if(state.view==='dashboard'&&stale.length&&!document.querySelector('.recon-alert')){
      const focus=document.querySelector('.v7-focus');if(focus){const sec=document.createElement('section');sec.className='recon-alert audit-recon-alert';const div=document.createElement('div'),sp=document.createElement('span'),strong=document.createElement('strong'),small=document.createElement('small'),btn=document.createElement('button');sp.textContent='ĐỐI SOÁT';strong.textContent=`${stale.length} tài khoản cần kiểm tra lại`;small.textContent='Có dữ liệu được thêm/sửa sau lần đối soát hoặc lịch sử trước ngày đối soát đã thay đổi.';btn.dataset.view='accounts';btn.textContent='Kiểm tra →';div.append(sp,strong,small);sec.append(div,btn);focus.insertAdjacentElement('afterend',sec)}}
  }

  function parseWidth(style){const m=String(style||'').match(/width\s*:\s*([0-9.]+)%/i);return m?Math.max(0,Math.min(100,Number(m[1]))):null}
  function parseBackground(style){const m=String(style||'').match(/background(?:-color)?\s*:\s*([^;]+)/i);return m?m[1].trim():null}
  function makeProgress(value,extra=''){
    const p=document.createElement('progress');p.className=`audit-progress ${extra}`.trim();p.max=100;p.value=Number.isFinite(value)?value:0;return p;
  }
  function makeSwatch(color){
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),c=document.createElementNS(ns,'circle');svg.setAttribute('viewBox','0 0 12 12');svg.setAttribute('aria-hidden','true');svg.classList.add('audit-color-swatch');c.setAttribute('cx','6');c.setAttribute('cy','6');c.setAttribute('r','5');c.setAttribute('fill',/^#[0-9a-f]{3,8}$/i.test(color||'')?color:'#64748b');svg.appendChild(c);return svg;
  }
  function fixInlineStyleVisuals(){
    document.querySelectorAll('.progress > i[style],.mini-progress > i[style],.cc-progress > i[style]').forEach(i=>{
      const v=parseWidth(i.getAttribute('style'));if(v===null)return;const parent=i.parentElement;if(!parent)return;parent.replaceChildren(makeProgress(v,parent.classList.contains('cc-progress')?'audit-credit-progress':''));
    });
    document.querySelectorAll('.bar-track > .bar-fill[style]').forEach(i=>{
      const v=parseWidth(i.getAttribute('style'));if(v===null)return;const parent=i.parentElement;if(!parent)return;parent.replaceChildren(makeProgress(v,'audit-bar-progress'));
    });
    document.querySelectorAll('.settings-cat-row i[style],.legend i[style]').forEach(i=>{
      const color=parseBackground(i.getAttribute('style'));i.replaceWith(makeSwatch(color));
    });
  }

  function patchImportHistory(){
    const cards=[...document.querySelectorAll('.stm-batch')];
    (state.statementImportBatches||[]).forEach((b,i)=>{
      const small=cards[i]?.querySelector('small');if(!small)return;
      const imported=n(b.imported_count),dup=n(b.skipped_duplicate_count),undone=!!b.undone_at||n(b.active_count)===0;
      if(imported===0)small.textContent=dup?`Không có dòng mới · bỏ trùng ${dup}${undone?' · lịch sử batch':''}`:`Không có dòng được nhập${undone?' · lịch sử batch':''}`;
    });
  }

  function patchExpenseWording(){
    const exceptional=(state.fullTransactions||[]).filter(t=>t.transaction_type==='expense'&&String(t.transaction_date||'').slice(0,7)===state.month&&(state.exceptionalExpenseIds||[]).includes(t.id));
    if(!exceptional.length)return;
    document.querySelectorAll('.v3-kpis section > span').forEach(s=>{
      if(s.textContent.trim()==='Chi phí tháng')s.textContent='Tổng chi thực tế';
      else if(state.view==='analytics'&&s.textContent.trim()==='Chi phí')s.textContent='Tổng chi thực tế';
    });
  }

  function afterRender(){
    try{fixInlineStyleVisuals();patchReconciliationUI();patchImportHistory();patchExpenseWording()}catch(e){console.error('Audit post-render failed',e)}
  }

  const renderBefore=window.render;
  if(typeof renderBefore==='function')window.render=function(...args){const out=renderBefore.apply(this,args);afterRender();queueMicrotask(afterRender);return out};

  document.addEventListener('click',e=>{
    const b=e.target.closest?.('[data-view]');if(!b||b.closest('#nav,#mobileNav'))return;
    const v=b.dataset.view;if(!v||typeof window.navigate!=='function')return;e.preventDefault();window.navigate(v);
  });

  queueMicrotask(afterRender);
})();