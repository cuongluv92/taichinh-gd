(() => {
  const V=window.__V3;
  if(!V||typeof V.recurringApi!=='function')return;

  const localMonth=()=>String(V.localToday?.()||today()).slice(0,7);
  const selectedMonth=()=>String(state.month||localMonth()).slice(0,7);
  const isPast=()=>selectedMonth()<localMonth();
  const monthLabel=m=>String(m||'').slice(0,7).replace('-','/');

  async function loadSelectedList(){
    const m=selectedMonth();
    const d=await V.recurringApi('list_all',{month:`${m}-01`});
    state.recurringAll=d?.items||[];
    return state.recurringAll;
  }

  function injectEffectiveMonth(id){
    if(!id)return;
    const form=document.getElementById('modalForm');
    if(!form||form.querySelector('[name="effective_month"]'))return;
    const h=document.createElement('input');
    h.type='hidden';h.name='effective_month';h.value=`${selectedMonth()}-01`;form.appendChild(h);
    const intro=document.querySelector('#modalBody .rec-form-intro');
    if(intro){
      const note=document.createElement('div');
      note.className='audit-lock-note';
      note.textContent=`Thay đổi này có hiệu lực từ ${monthLabel(selectedMonth())}; các tháng trước giữ nguyên.`;
      intro.appendChild(note);
    }
  }

  function decorateCards(){
    const past=isPast();
    document.querySelectorAll('.rec-card [data-rec-action="edit"]').forEach(b=>{
      if(past){b.disabled=true;b.textContent='Lịch sử đã khóa';b.title='Tháng quá khứ chỉ đọc; thay đổi mới không áp ngược về lịch sử.'}
    });
    (state.recurringMonth||[]).forEach((x,i)=>{
      const card=document.querySelectorAll('.rec-card')[i];
      if(!card||card.querySelector('[data-rec-version-note]')||!x.version_effective_month)return;
      const small=document.createElement('small');small.dataset.recVersionNote='1';
      small.textContent=`Lịch áp dụng từ ${monthLabel(x.version_effective_month)}`;
      card.querySelector('.rec-card-top > div')?.appendChild(small);
    });
  }

  function decorateManager(){
    const rows=state.recurringAll||[],past=isPast(),future=selectedMonth()>localMonth();
    const head=document.querySelector('.rec-manager-head p');
    if(head)head.textContent=past
      ?`Đang xem lịch hiệu lực tại ${monthLabel(selectedMonth())}. Tháng quá khứ chỉ đọc.`
      :future?`Đang xem ${monthLabel(selectedMonth())}. Mọi thay đổi sẽ bắt đầu từ tháng này; lịch trước đó giữ nguyên.`
      :`Đang xem cấu hình hiện tại ${monthLabel(selectedMonth())}. Mọi thay đổi được lưu thành phiên bản mới.`;
    const add=document.querySelector('.rec-manager-head [data-rec-action="new"]');
    if(add&&past){add.disabled=true;add.title='Không tạo/sửa lịch ngược về quá khứ.'}
    document.querySelectorAll('.rec-manager-row').forEach((row,i)=>{
      const x=rows[i];if(!x)return;
      const divs=row.querySelectorAll(':scope > div'),actions=divs[divs.length-1];if(!actions)return;
      if(!actions.querySelector('[data-rec-version-history]')){
        const h=document.createElement('button');h.type='button';h.dataset.recVersionHistory=x.id;h.textContent=x.version_count>1?`Lịch sử (${x.version_count})`:'Lịch sử';actions.prepend(h);
      }
      if(past)actions.querySelectorAll('[data-rec-action="edit"],[data-rec-action="archive"],[data-rec-action="restore"]').forEach(b=>{b.disabled=true;b.title='Tháng quá khứ chỉ đọc.'});
    });
  }

  async function showHistory(id){
    const d=await V.recurringApi('history_versions',{id}),rows=d?.items||[];
    const dlg=document.getElementById('modal'),mb=document.getElementById('modalBody'),form=document.getElementById('modalForm');
    if(!dlg||!mb||!form)return;
    const body=rows.length?rows.map((x,idx)=>`<div class="rec-manager-row ${x.is_active?'':'inactive'}"><div><b>${esc(x.name)}</b><span>Từ ${esc(monthLabel(x.effective_month))} · ${money(x.amount,x.currency)} · ngày ${Number(x.day_of_month)===31?'cuối tháng':x.day_of_month}</span><small>${esc(x.category_name||'')} · ${esc(x.account_name||'')} · ${x.is_active?'Đang áp dụng':'Tạm dừng'}${idx===0?' · phiên bản mới nhất':''}</small></div></div>`).join(''):'<div class="rec-empty">Chưa có lịch sử phiên bản.</div>';
    mb.innerHTML=`<div class="modal-head"><div><span class="v7-modal-kicker">LỊCH SỬ</span><h3>Thay đổi khoản định kỳ</h3></div><button class="mini-btn" type="button" data-rec-version-close>✕</button></div><div class="modal-content"><p>Các phiên bản cũ được giữ nguyên để báo cáo tháng quá khứ không bị viết lại.</p><div class="rec-manager-list">${body}</div></div><div class="modal-actions"><button class="btn primary" type="button" data-rec-version-close>Đóng</button></div>`;
    form.onsubmit=e=>e.preventDefault();if(!dlg.open)dlg.showModal();
  }

  async function changeActive(action,id){
    if(isPast())return toast('Tháng quá khứ chỉ đọc. Hãy chuyển về tháng hiện tại hoặc tương lai để thay đổi lịch.',true);
    if(action==='archive'&&!confirm(`Tạm dừng khoản này từ ${monthLabel(selectedMonth())}? Lịch trước đó vẫn được giữ.`))return;
    await V.recurringApi(action,{id,effective_month:`${selectedMonth()}-01`});
    await Promise.all([V.loadRecurringMonth?.(selectedMonth(),false),loadSelectedList()]);
    render();toast('Đã lưu phiên bản lịch mới');
    setTimeout(()=>{window.showRecurringManager?.();decorateManager()},0);
  }

  document.addEventListener('click',async e=>{
    const hist=e.target.closest?.('[data-rec-version-history]');
    if(hist){e.preventDefault();e.stopImmediatePropagation();try{await showHistory(hist.dataset.recVersionHistory)}catch(err){toast(err.message,true)}return}
    if(e.target.closest?.('[data-rec-version-close]')){e.preventDefault();document.getElementById('modal')?.close();return}

    const b=e.target.closest?.('[data-rec-action]');if(!b)return;
    const action=b.dataset.recAction,id=b.dataset.recId||'';
    if(!['manage','manage-month','edit','new','archive','restore'].includes(action))return;
    e.preventDefault();e.stopImmediatePropagation();
    try{
      if(action==='manage'||action==='manage-month'){
        await loadSelectedList();window.showRecurringManager?.();setTimeout(decorateManager,0);return;
      }
      if(action==='archive'||action==='restore')return await changeActive(action,id);
      if(isPast())return toast('Tháng quá khứ chỉ đọc. Chuyển về tháng hiện tại hoặc tương lai để thêm/sửa lịch.',true);
      await loadSelectedList();document.getElementById('modal')?.close();
      setTimeout(()=>{
        window.openRecurring?.(action==='edit'?id:'');
        if(action==='edit')setTimeout(()=>injectEffectiveMonth(id),0);
      },0);
    }catch(err){toast(err.message,true)}
  },true);

  const renderBefore=window.render;
  if(typeof renderBefore==='function')window.render=function(...args){const out=renderBefore.apply(this,args);queueMicrotask(decorateCards);return out};
  queueMicrotask(decorateCards);
})();