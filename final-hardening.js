(() => {
  const V=window.__V3=window.__V3||{};
  const BACKUP_RPC=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_backup_api`;
  const CATEGORY_ORDER_RPC=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_category_order_api`;
  let categoryOrderDraft=null;

  function goalHasLinkedHistory(id){
    return !!id&&(state.fullTransactions||[]).some(t=>t.goal_id===id&&['goal_save','goal_withdraw'].includes(t.transaction_type));
  }

  const openGoalBefore=window.openGoal;
  if(typeof openGoalBefore==='function'){
    window.openGoal=function(id='',...rest){
      const out=openGoalBefore.call(this,id,...rest);
      if(id&&goalHasLinkedHistory(id)){
        const input=document.querySelector('#modalBody input[name="current_amount"]');
        if(input){
          input.readOnly=true;
          input.setAttribute('aria-readonly','true');
          const field=input.closest('.field');
          const label=field?.querySelector('label');
          if(label)label.textContent='Đã có · tự tính từ giao dịch';
          if(field&&!field.querySelector('[data-final-goal-lock]')){
            const note=document.createElement('small');
            note.dataset.finalGoalLock='1';
            note.textContent='Mục tiêu đã có lịch sử góp/rút nên số này được tính tự động. Muốn thay đổi, hãy ghi góp hoặc rút tiền.';
            field.appendChild(note);
          }
        }
      }
      return out;
    };
  }

  async function fullBackup(){
    if(!state.key)throw new Error('Thiếu khóa gia đình');
    const res=await fetch(BACKUP_RPC,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},
      body:JSON.stringify({p_key:state.key})
    });
    const text=await res.text();let data;
    try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok){
      const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
      throw new Error(/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.':raw);
    }
    return data;
  }

  window.exportData=async function(){
    try{
      const data=await fullBackup();
      const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      const d=typeof V.localToday==='function'?V.localToday():(typeof today==='function'?today():new Date().toISOString().slice(0,10));
      a.download=`taichinh-gd-full-${d}.json`;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),1000);
      toast('Đã tạo bản sao đầy đủ');
    }catch(e){
      console.error('Full backup failed',e);
      toast(e.message||'Không tạo được bản sao',true);
    }
  };

  function selectedMonthDefaultDate(){
    const local=typeof V.localToday==='function'?V.localToday():(typeof today==='function'?today():new Date().toISOString().slice(0,10));
    return String(local).slice(0,7)===state.month?local:`${state.month}-01`;
  }

  function categoryTransactions(categoryId,direction){
    return (state.transactions||[])
      .filter(t=>t.category_id===categoryId&&t.transaction_type===direction)
      .slice()
      .sort((a,b)=>String(b.transaction_date||'').localeCompare(String(a.transaction_date||''))||String(b.created_at||'').localeCompare(String(a.created_at||'')));
  }

  function transactionAccountName(t){
    return t.account_name||(state.accounts||[]).find(a=>a.id===t.account_id)?.name||'Chưa chọn tài khoản';
  }

  function categoryTotals(rows){
    const sums={};
    rows.forEach(t=>{const cur=t.currency||state.base;sums[cur]=(sums[cur]||0)+n(t.amount)});
    const entries=Object.entries(sums);
    return entries.length?entries.map(([cur,val])=>money(val,cur)).join(' · '):money(0);
  }

  function openCategoryTransactions(categoryId,direction){
    const c=(state.categories||[]).find(x=>x.id===categoryId);
    if(!c)return toast('Không tìm thấy danh mục.',true);
    const rows=categoryTransactions(categoryId,direction);
    const dlg=$('#modal'),mb=$('#modalBody'),form=$('#modalForm');
    const rowHtml=rows.length?`<div class="list">${rows.map(t=>{
      const locked=typeof V.isProtectedSystemTransaction==='function'&&V.isProtectedSystemTransaction(t.id);
      const meta=[String(t.transaction_date||'').slice(0,10),transactionAccountName(t),t.note||''].filter(Boolean).map(esc).join(' · ');
      return `<div class="tx"><div class="tx-icon">${direction==='income'?'↙':'↗'}</div><div class="tx-main"><strong>${money(t.amount,t.currency||state.base)}</strong><span>${meta}</span></div><div class="tx-actions">${locked?'<small>Hệ thống</small>':`<button class="btn sm" type="button" data-final-edit-tx="${esc(t.id)}">Sửa</button>`}</div></div>`;
    }).join('')}</div>`:'<div class="empty">Tháng này chưa có khoản nào trong danh mục này.</div>';
    mb.innerHTML=`<div class="modal-head"><div><span class="v7-modal-kicker">${direction==='income'?'THU NHẬP':'CHI TIÊU'} · ${esc(state.month.replace('-','/'))}</span><h3>${esc(c.name)}</h3></div><button class="mini-btn" type="button" data-final-close>✕</button></div><div class="modal-content"><div class="v3-budget-summary"><div><span>Hiện có</span><strong>${categoryTotals(rows)}</strong></div><div><span>Số khoản</span><strong>${rows.length}</strong></div></div>${rowHtml}<p class="muted">Sửa sẽ thay đổi khoản đã có. Chỉ “＋ Thêm khoản mới” mới cộng thêm vào tổng tháng.</p></div><div class="modal-actions"><button class="btn" type="button" data-final-close>Đóng</button><button class="btn primary" type="button" data-final-add-category-tx="${esc(categoryId)}" data-final-direction="${esc(direction)}">＋ Thêm khoản mới</button></div>`;
    form.onsubmit=e=>e.preventDefault();
    dlg.showModal();
  }

  window.openCategoryTransaction=openCategoryTransactions;

  function orderedActive(direction){
    return (state.categories||[]).filter(c=>c.is_active!==false&&c.direction===direction).slice().sort((a,b)=>n(a.sort_order)-n(b.sort_order)||String(a.name||'').localeCompare(String(b.name||'')));
  }

  function categoryById(id){
    return (state.categories||[]).find(c=>c.id===id);
  }

  function renderOrderGroup(direction,label){
    const ids=categoryOrderDraft?.[direction]||[];
    if(!ids.length)return `<section class="v3-card"><div class="v3-card-head"><div><h3>${esc(label)}</h3><p>Chưa có danh mục.</p></div></div></section>`;
    return `<section class="v3-card"><div class="v3-card-head"><div><h3>${esc(label)}</h3><p>↑ ↓ để thay đổi vị trí hiển thị</p></div></div><div class="list">${ids.map((id,i)=>{
      const c=categoryById(id)||{};
      return `<div class="tx"><div class="tx-main"><strong>${i+1}. ${esc(c.name||'Danh mục')}</strong></div><div class="tx-actions"><button class="mini-btn" type="button" data-final-order-move="up" data-final-order-dir="${direction}" data-final-order-index="${i}" ${i===0?'disabled':''}>↑</button><button class="mini-btn" type="button" data-final-order-move="down" data-final-order-dir="${direction}" data-final-order-index="${i}" ${i===ids.length-1?'disabled':''}>↓</button></div></div>`;
    }).join('')}</div></section>`;
  }

  function renderCategoryOrderModal(){
    const mb=$('#modalBody');
    if(!mb||!categoryOrderDraft)return;
    mb.innerHTML=`<div class="modal-head"><div><span class="v7-modal-kicker">CÀI ĐẶT</span><h3>Sắp xếp danh mục</h3></div><button class="mini-btn" type="button" data-final-close>✕</button></div><div class="modal-content"><div class="grid two-cols">${renderOrderGroup('income','Thu nhập')}${renderOrderGroup('expense','Chi tiêu')}</div><p class="muted">Thứ tự này được dùng ở Cài đặt, Ngân sách và các danh sách chọn danh mục.</p></div><div class="modal-actions"><button class="btn" type="button" data-final-close>Hủy</button><button class="btn primary" type="button" data-final-save-category-order>Lưu thứ tự</button></div>`;
  }

  function openCategoryOrder(){
    categoryOrderDraft={
      income:orderedActive('income').map(c=>c.id),
      expense:orderedActive('expense').map(c=>c.id)
    };
    const dlg=$('#modal'),form=$('#modalForm');
    form.onsubmit=e=>e.preventDefault();
    renderCategoryOrderModal();
    dlg.showModal();
  }

  async function saveCategoryOrder(){
    if(!categoryOrderDraft)return;
    try{
      setLoading(true);
      const res=await fetch(CATEGORY_ORDER_RPC,{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},
        body:JSON.stringify({p_key:state.key,p_payload:categoryOrderDraft})
      });
      const text=await res.text();let data;
      try{data=text?JSON.parse(text):null}catch{data=text}
      if(!res.ok){
        const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
        const msg=/category_order_stale_refresh/i.test(raw)?'Danh mục vừa thay đổi. Hãy mở lại Sắp xếp rồi thử lại.'
          :/invalid_category_order/i.test(raw)?'Thứ tự danh mục không hợp lệ.'
          :/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.'
          :raw;
        throw new Error(msg);
      }
      document.getElementById('modal')?.close();
      categoryOrderDraft=null;
      await refresh();
      toast('Đã lưu thứ tự danh mục');
    }catch(e){
      toast(e.message||'Không lưu được thứ tự',true);
    }finally{
      setLoading(false);
    }
  }

  function patchCategoryOrderButton(){
    if(state.view!=='settings')return;
    const head=document.querySelector('.categories-panel .panel-title');
    if(!head||head.querySelector('[data-final-open-category-order]'))return;
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='btn sm';
    btn.dataset.finalOpenCategoryOrder='1';
    btn.textContent='↕ Sắp xếp';
    const add=[...head.querySelectorAll('button')].find(b=>/Danh mục|Thêm/.test(b.textContent||''));
    if(add)head.insertBefore(btn,add);else head.appendChild(btn);
  }

  const renderBeforeFinal=window.render;
  if(typeof renderBeforeFinal==='function'){
    window.render=function(...args){
      const out=renderBeforeFinal.apply(this,args);
      patchCategoryOrderButton();
      queueMicrotask(patchCategoryOrderButton);
      return out;
    };
  }

  document.addEventListener('click',e=>{
    const close=e.target.closest?.('[data-final-close]');
    if(close){e.preventDefault();document.getElementById('modal')?.close();return}

    const edit=e.target.closest?.('[data-final-edit-tx]');
    if(edit){
      e.preventDefault();
      const id=edit.dataset.finalEditTx;
      document.getElementById('modal')?.close();
      window.openTransaction?.(id);
      return;
    }

    const add=e.target.closest?.('[data-final-add-category-tx]');
    if(add){
      e.preventDefault();
      const categoryId=add.dataset.finalAddCategoryTx,direction=add.dataset.finalDirection;
      document.getElementById('modal')?.close();
      window.openTransaction?.('',{transaction_type:direction,category_id:categoryId,transaction_date:selectedMonthDefaultDate()});
      return;
    }

    const openOrder=e.target.closest?.('[data-final-open-category-order]');
    if(openOrder){e.preventDefault();openCategoryOrder();return}

    const move=e.target.closest?.('[data-final-order-move]');
    if(move&&categoryOrderDraft){
      e.preventDefault();
      const dir=move.dataset.finalOrderDir,idx=Number(move.dataset.finalOrderIndex),delta=move.dataset.finalOrderMove==='up'?-1:1,next=idx+delta,arr=categoryOrderDraft[dir];
      if(Array.isArray(arr)&&idx>=0&&next>=0&&next<arr.length){
        [arr[idx],arr[next]]=[arr[next],arr[idx]];
        renderCategoryOrderModal();
      }
      return;
    }

    const saveOrder=e.target.closest?.('[data-final-save-category-order]');
    if(saveOrder){e.preventDefault();saveCategoryOrder()}
  });

  V.fullBackup=fullBackup;
  V.openCategoryOrder=openCategoryOrder;
  V.openCategoryTransactions=openCategoryTransactions;
})();