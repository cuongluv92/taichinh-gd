(() => {
  'use strict';

  const monthKey=v=>String(v||'').slice(0,7);
  const monthLabel=()=>String(state.month||'').replace('-','/');

  function firstEffectiveMonth(categoryId){
    const rows=(state.categoryVersions||[]).filter(v=>v.category_id===categoryId&&v.effective_month);
    if(!rows.length)return '';
    return rows.map(v=>monthKey(v.effective_month)).sort()[0]||'';
  }

  function hideCategoriesBeforeStart(){
    if(!state?.month||!Array.isArray(state.categories))return;
    state.categories=state.categories.filter(c=>{
      const first=firstEffectiveMonth(c.id);
      return !first||first<=state.month;
    });
  }

  function categoriesFor(kind){
    const rows=(state.categories||[]).filter(c=>c.is_active!==false);
    if(kind==='income')return rows.filter(c=>c.direction==='income');
    if(kind==='fixed')return rows.filter(c=>c.direction==='expense'&&c.cost_type==='fixed');
    return rows.filter(c=>c.direction==='expense'&&c.cost_type!=='fixed');
  }

  function plannedText(c){
    const amount=Number(c?.planned_amount||0);
    if(amount<=0)return '';
    return `${c.direction==='income'?'Dự kiến':'Kế hoạch'} ${money(amount,state.base)}`;
  }

  function openColumnCategory(kind,id=''){
    if(typeof window.openCategory!=='function')return toast('Chức năng danh mục chưa sẵn sàng.',true);
    window.openCategory(id);
    queueMicrotask(()=>{
      const modalBody=document.getElementById('modalBody');
      if(!modalBody)return;
      const direction=modalBody.querySelector('[name="direction"]');
      const cost=modalBody.querySelector('[name="cost_type"]');
      const effective=modalBody.querySelector('[name="effective_month"]');
      const title=modalBody.querySelector('.modal-head h3');
      const content=modalBody.querySelector('.modal-content');
      const category=(state.categories||[]).find(c=>c.id===id);

      if(!id){
        if(direction)direction.value=kind==='income'?'income':'expense';
        if(cost&&kind!=='income')cost.value=kind==='fixed'?'fixed':'variable';
        direction?.dispatchEvent(new Event('change',{bubbles:true}));
      }
      if(effective)effective.value=state.month;
      if(title)title.textContent=id?`Sửa · ${category?.name||'mục'}`:`Thêm mục · ${kind==='income'?'Thu nhập':kind==='fixed'?'Chi cố định':'Chi biến động'}`;

      if(content&&!content.querySelector('[data-budget-version-note]')){
        const note=document.createElement('div');
        note.className='budget-version-note';
        note.dataset.budgetVersionNote='1';
        note.innerHTML=`<b>Áp dụng từ ${monthLabel()}</b><span>Giá trị mới tự tiếp tục sang các tháng sau. Các tháng trước giữ nguyên.</span>`;
        content.prepend(note);
      }
    });
  }

  function decorateColumn(kind,selector){
    const col=document.querySelector(selector);if(!col)return;
    const head=col.querySelector('.v3-money-head');
    const add=head?.querySelector(':scope > button');
    if(add){
      add.removeAttribute('onclick');
      add.dataset.budgetAdd=kind;
      add.textContent='＋ Mới';
      add.setAttribute('aria-label',`Thêm mục ${kind==='income'?'thu nhập':kind==='fixed'?'chi cố định':'chi biến động'}`);
    }
    const h3=head?.querySelector('h3');
    if(h3&&!head.querySelector('.budget-col-hint')){
      const hint=document.createElement('small');hint.className='budget-col-hint';hint.textContent='Tự kế thừa sang tháng sau';h3.insertAdjacentElement('afterend',hint);
    }

    const cats=categoriesFor(kind),buttons=[...col.querySelectorAll('.v3-money-list>button')];
    buttons.forEach((button,i)=>{
      const c=cats[i];if(!c)return;
      button.classList.add('budget-configurable-row');
      if(!button.querySelector('[data-budget-edit]')){
        const edit=document.createElement('span');
        edit.className='budget-inline-edit';edit.dataset.budgetEdit=c.id;edit.dataset.kind=kind;edit.setAttribute('role','button');edit.setAttribute('tabindex','0');edit.setAttribute('aria-label',`Cài đặt ${c.name}`);edit.title=`Cài đặt ${c.name}`;edit.textContent='⚙';button.append(edit);
      }
      const label=button.querySelector(':scope > span:not(.budget-inline-edit)');
      const text=plannedText(c);
      if(label&&text){
        let plan=label.querySelector('.budget-plan-note');
        if(!plan){plan=document.createElement('small');plan.className='budget-plan-note';label.append(plan)}
        plan.textContent=text;
      }
    });
  }

  function decorateBudget(){
    if(state.view!=='budget')return;
    const board=document.querySelector('#content .v3-budget-board');if(!board)return;
    decorateColumn('income','.v3-money-col.income');
    decorateColumn('fixed','.v3-money-col.fixed');
    decorateColumn('variable','.v3-money-col.variable');
    if(!board.querySelector('.budget-month-rule')){
      const rule=document.createElement('div');
      rule.className='budget-month-rule';
      rule.innerHTML=`<b>Thiết lập theo tháng</b><span>Sửa hoặc thêm ở ${monthLabel()} → áp dụng từ tháng này về sau; dữ liệu các tháng trước không đổi.</span>`;
      board.insertAdjacentElement('beforebegin',rule);
    }
  }

  const renderBefore=window.render;
  if(typeof renderBefore==='function'&&!renderBefore.__budgetInlineSettings){
    const wrapped=function(...args){
      hideCategoriesBeforeStart();
      const out=renderBefore.apply(this,args);
      queueMicrotask(decorateBudget);
      return out;
    };
    Object.defineProperty(wrapped,'__budgetInlineSettings',{value:true});
    window.render=wrapped;
  }

  document.addEventListener('click',e=>{
    const edit=e.target.closest?.('[data-budget-edit]');
    if(edit){
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      return openColumnCategory(edit.dataset.kind,edit.dataset.budgetEdit);
    }
    const add=e.target.closest?.('[data-budget-add]');
    if(add){
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      return openColumnCategory(add.dataset.budgetAdd,'');
    }
  },true);

  document.addEventListener('keydown',e=>{
    const edit=e.target.closest?.('[data-budget-edit]');
    if(!edit||!['Enter',' '].includes(e.key))return;
    e.preventDefault();e.stopPropagation();openColumnCategory(edit.dataset.kind,edit.dataset.budgetEdit);
  },true);

  hideCategoriesBeforeStart();
  queueMicrotask(decorateBudget);
})();