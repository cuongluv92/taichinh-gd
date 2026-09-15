(() => {
  'use strict';

  const COLUMN_RPC=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_budget_column_api`;
  const meta={
    income:{title:'Thu nhập',color:'#30d17f',amountLabel:'Thu nhập dự kiến / tháng'},
    fixed:{title:'Chi cố định',color:'#f5a623',amountLabel:'Kế hoạch / tháng'},
    variable:{title:'Chi biến động',color:'#f25c66',amountLabel:'Ngân sách / tháng'}
  };

  const monthLabel=v=>String(v||state.month||'').slice(0,7).replace('-','/');
  function categoriesFor(kind){
    const rows=(state.categories||[]).filter(c=>c.is_active!==false);
    if(kind==='income')return rows.filter(c=>c.direction==='income').sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0));
    if(kind==='fixed')return rows.filter(c=>c.direction==='expense'&&c.cost_type==='fixed').sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0));
    return rows.filter(c=>c.direction==='expense'&&c.cost_type!=='fixed').sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0));
  }

  async function saveColumn(kind,effective,rows){
    if(!state.key)throw new Error('Thiếu khóa gia đình');
    const res=await fetch(COLUMN_RPC,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({p_key:state.key,p_kind:kind,p_effective_month:`${effective}-01`,p_rows:rows})});
    const text=await res.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok){
      const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
      const msg=/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.'
        :/category_name_required/i.test(raw)?'Tên mục không được để trống.'
        :/planned_amount_negative/i.test(raw)?'Số tiền không được âm.'
        :raw;
      throw new Error(msg);
    }
    return data;
  }

  function rowHtml(kind,c={}){
    const m=meta[kind],id=c.id||'';
    return `<div class="budget-settings-row" data-column-row data-id="${esc(id)}" data-color="${esc(c.color||m.color)}">
      <div class="budget-settings-name"><label>Tên mục</label><input data-column-name type="text" value="${esc(c.name||'')}" placeholder="${kind==='income'?'VD: Lương / Thưởng':kind==='fixed'?'VD: Wifi / Điện thoại':'VD: Ăn uống / Đi lại'}" required></div>
      <div class="budget-settings-amount"><label>${m.amountLabel}</label><input data-column-amount type="number" min="0" step="1" value="${esc(c.planned_amount??0)}" required></div>
      <div class="budget-row-actions"><button type="button" class="mini-btn" data-column-move="-1" title="Đưa lên">↑</button><button type="button" class="mini-btn" data-column-move="1" title="Đưa xuống">↓</button><button type="button" class="mini-btn danger" data-column-remove title="Ẩn từ tháng áp dụng">×</button></div>
    </div>`;
  }

  function refreshMoveButtons(){
    const rows=[...document.querySelectorAll('#budgetColumnRows [data-column-row]')];
    rows.forEach((row,i)=>{
      const up=row.querySelector('[data-column-move="-1"]'),down=row.querySelector('[data-column-move="1"]');
      if(up)up.disabled=i===0;if(down)down.disabled=i===rows.length-1;
    });
  }

  function openColumnSettings(kind){
    const m=meta[kind];if(!m)return;
    const cats=categoriesFor(kind);
    modal(`Cài đặt · ${m.title}`,`<div class="budget-column-settings">
      <div class="budget-version-note"><b>Cài chung cho cả cột ${m.title}</b><span>Sửa, thêm, xóa hoặc đổi thứ tự tại đây. Dữ liệu lịch sử các tháng trước không bị sửa.</span></div>
      <div class="budget-settings-effective"><label>Áp dụng từ tháng</label><input id="budgetColumnEffective" type="month" value="${esc(state.month)}" required><small>Ví dụ áp dụng từ 2026/10: tháng 9 giữ nguyên; tháng 10 thay đổi; tháng 11 trở đi tự kế thừa.</small></div>
      <div id="budgetColumnRows" class="budget-settings-rows">${cats.map(c=>rowHtml(kind,c)).join('')||'<div class="budget-settings-empty" data-column-empty>Chưa có mục nào.</div>'}</div>
      <button type="button" class="btn budget-add-row" data-column-add-row="${kind}">＋ Thêm mục mới</button>
    </div>`,async()=>{
      const effective=document.getElementById('budgetColumnEffective')?.value||state.month;
      const rows=[...document.querySelectorAll('#budgetColumnRows [data-column-row]')].map(row=>{
        const name=row.querySelector('[data-column-name]')?.value.trim();
        const planned_amount=Number(row.querySelector('[data-column-amount]')?.value||0);
        if(!name)throw new Error('Tên mục không được để trống.');
        if(!Number.isFinite(planned_amount)||planned_amount<0)throw new Error(`Số tiền của ${name} không hợp lệ.`);
        return {id:row.dataset.id||null,name,planned_amount,color:row.dataset.color||m.color};
      });
      await saveColumn(kind,effective,rows);
    },'Lưu cả cột');
    refreshMoveButtons();
  }

  function openCreditColumnSettings(){
    const cards=typeof activeAccounts==='function'?activeAccounts().filter(a=>a.account_type==='credit'):[];
    const settings=state.cardSettings||[];
    const rows=cards.map(card=>{
      const s=settings.find(x=>x.account_id===card.id),inst=(state.cardInstallments||[]).filter(x=>x.card_account_id===card.id);
      return `<div class="budget-card-manager-row"><div><strong>${esc(card.name)}</strong><small>${s?`Chốt ngày ${esc(s.closing_day)} · trả ngày ${esc(s.payment_day)} · ${Number(s.payment_month_offset||1)===1?'tháng sau':`sau ${esc(s.payment_month_offset)} tháng`}`:'Chưa cài chu kỳ'}${inst.length?` · ${inst.length} khoản trả góp`:''}</small></div><button type="button" class="btn sm" data-column-card-settings="${esc(card.id)}">Cài thẻ</button></div>`;
    }).join('');
    modal('Cài đặt · Thẻ & trả góp',`<div class="budget-column-settings"><div class="budget-version-note"><b>Quản lý chung cột Thẻ & trả góp</b><span>Thẻ, ngày chốt/ngày trả và lịch trả góp nằm ở đây. Thanh toán thẻ không tính thành chi tiêu lần hai.</span></div><div class="budget-card-manager">${rows||'<div class="budget-settings-empty">Chưa có thẻ tín dụng.</div>'}</div><div class="budget-card-manager-actions"><button type="button" class="btn primary" data-column-credit-new-card>＋ Thẻ tín dụng</button><button type="button" class="btn" data-column-credit-new-installment ${cards.length?'':'disabled'}>＋ Khoản trả góp</button></div></div>`,async()=>{},'Đóng');
  }

  function plannedText(c){
    const amount=Number(c?.planned_amount||0);if(amount<=0)return '';
    return `${c.direction==='income'?'Dự kiến':'Kế hoạch'} ${money(amount,state.base)}`;
  }
  function decorateColumn(kind,selector){
    const col=document.querySelector(selector);if(!col)return;
    const head=col.querySelector('.v3-money-head'),control=head?.querySelector(':scope > button');
    if(control){control.removeAttribute('onclick');control.removeAttribute('data-budget-add');control.dataset.budgetColumnSettings=kind;control.textContent='⚙ Cài đặt';control.setAttribute('aria-label',`Cài đặt chung cột ${meta[kind].title}`)}
    const h3=head?.querySelector('h3');if(h3&&!head.querySelector('.budget-col-hint')){const hint=document.createElement('small');hint.className='budget-col-hint';hint.textContent='Một cài đặt cho cả cột';h3.insertAdjacentElement('afterend',hint)}
    const cats=categoriesFor(kind),buttons=[...col.querySelectorAll('.v3-money-list>button')];
    buttons.forEach((button,i)=>{const c=cats[i];if(!c)return;button.querySelectorAll('[data-budget-edit],.budget-inline-edit').forEach(x=>x.remove());const label=button.querySelector(':scope > span');const text=plannedText(c);if(label&&text){let plan=label.querySelector('.budget-plan-note');if(!plan){plan=document.createElement('small');plan.className='budget-plan-note';label.append(plan)}plan.textContent=text}});
  }
  function decorateCreditColumn(){
    const col=document.querySelector('.v3-money-col.credit,.ux-credit-col');if(!col)return;
    const head=col.querySelector('.v3-money-head'),control=head?.querySelector(':scope > button');
    if(control){control.removeAttribute('onclick');control.removeAttribute('data-ux-action');control.dataset.budgetCreditSettings='1';control.textContent='⚙ Cài đặt';control.setAttribute('aria-label','Cài đặt chung cột Thẻ & trả góp')}
    const h3=head?.querySelector('h3');if(h3&&!head.querySelector('.budget-col-hint')){const hint=document.createElement('small');hint.className='budget-col-hint';hint.textContent='Thẻ · chu kỳ · trả góp';h3.insertAdjacentElement('afterend',hint)}
  }
  function decorateBudget(){
    if(state.view!=='budget')return;const board=document.querySelector('#content .v3-budget-board');if(!board)return;
    decorateColumn('income','.v3-money-col.income');decorateColumn('fixed','.v3-money-col.fixed');decorateColumn('variable','.v3-money-col.variable');decorateCreditColumn();
    if(!document.querySelector('#content .budget-month-rule')){const rule=document.createElement('div');rule.className='budget-month-rule';rule.innerHTML='<b>Cài theo từng cột</b><span>Sửa một lần → lưu theo tháng → tháng sau tự kế thừa. % so với thu nhập vẫn giữ nguyên.</span>';board.insertAdjacentElement('beforebegin',rule)}
  }

  const renderBefore=window.render;
  if(typeof renderBefore==='function'&&!renderBefore.__budgetColumnSettings){const wrapped=function(...args){const out=renderBefore.apply(this,args);queueMicrotask(decorateBudget);return out};Object.defineProperty(wrapped,'__budgetColumnSettings',{value:true});window.render=wrapped}

  document.addEventListener('click',e=>{
    const settings=e.target.closest?.('[data-budget-column-settings]');if(settings){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();return openColumnSettings(settings.dataset.budgetColumnSettings)}
    const credit=e.target.closest?.('[data-budget-credit-settings]');if(credit){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();return openCreditColumnSettings()}
    const add=e.target.closest?.('[data-column-add-row]');if(add){e.preventDefault();const box=document.getElementById('budgetColumnRows');if(!box)return;box.querySelector('[data-column-empty]')?.remove();box.insertAdjacentHTML('beforeend',rowHtml(add.dataset.columnAddRow,{}));refreshMoveButtons();box.lastElementChild?.querySelector('[data-column-name]')?.focus();return}
    const move=e.target.closest?.('[data-column-move]');if(move){e.preventDefault();const row=move.closest('[data-column-row]'),delta=Number(move.dataset.columnMove);if(!row)return;if(delta<0&&row.previousElementSibling)row.parentNode.insertBefore(row,row.previousElementSibling);else if(delta>0&&row.nextElementSibling)row.parentNode.insertBefore(row.nextElementSibling,row);refreshMoveButtons();return}
    const remove=e.target.closest?.('[data-column-remove]');if(remove){e.preventDefault();const row=remove.closest('[data-column-row]');if(!row)return;const effective=document.getElementById('budgetColumnEffective')?.value||state.month;const name=row.querySelector('[data-column-name]')?.value||'mục này';if(row.dataset.id&&!confirm(`Ẩn “${name}” từ ${monthLabel(effective)}? Các tháng trước vẫn giữ nguyên.`))return;row.remove();refreshMoveButtons();return}
    const card=e.target.closest?.('[data-column-card-settings]');if(card){e.preventDefault();document.getElementById('modal')?.close();return window.openCardSettings?.(card.dataset.columnCardSettings)}
    if(e.target.closest?.('[data-column-credit-new-card]')){e.preventDefault();document.getElementById('modal')?.close();return window.openNewCreditCard?.()}
    if(e.target.closest?.('[data-column-credit-new-installment]')){e.preventDefault();document.getElementById('modal')?.close();return (window.openAdvancedInstallment||window.openInstallment)?.()}
  },true);

  queueMicrotask(decorateBudget);
})();