(() => {
  const V=window.__V3;
  if(!V) return;

  const RPC_URL=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_recurring_api`;
  state.recurringMonth=state.recurringMonth||[];
  state.recurringAll=state.recurringAll||[];
  state.recurringLoadedMonth=state.recurringLoadedMonth||null;

  async function recurringApi(action,payload={}){
    if(!state.key) throw new Error('Thiếu khóa gia đình');
    const res=await fetch(RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({p_key:state.key,p_action:action,p_payload:payload})});
    const text=await res.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok){
      const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
      const friendly=/already_paid/i.test(raw)?'Khoản này đã được xác nhận trong tháng.'
        :/invalid_account/i.test(raw)?'Tài khoản không hợp lệ hoặc khác tiền tệ.'
        :/invalid_category/i.test(raw)?'Hãy chọn danh mục chi tiêu hợp lệ.'
        :/amount_must_be_positive/i.test(raw)?'Số tiền phải lớn hơn 0.'
        :/invalid_day_of_month/i.test(raw)?'Ngày thanh toán phải từ 1 đến 31.'
        :/month_outside_schedule/i.test(raw)?'Tháng này không nằm trong lịch của khoản định kỳ.'
        :/recurring_not_found/i.test(raw)?'Không tìm thấy khoản định kỳ.'
        :/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.':raw;
      throw new Error(friendly);
    }
    return data;
  }

  async function loadRecurringMonth(month=state.month,rerender=false){
    if(!state.key)return [];
    const d=await recurringApi('get_month',{month:`${month}-01`});
    state.recurringMonth=d?.items||[];
    state.recurringLoadedMonth=month;
    if(rerender&&state.household)render();
    return state.recurringMonth;
  }
  async function loadRecurringAll(rerender=false){
    if(!state.key)return [];
    const d=await recurringApi('list_all',{});
    state.recurringAll=d?.items||[];
    if(rerender&&state.household)render();
    return state.recurringAll;
  }

  V.recurringApi=recurringApi;
  V.loadRecurringMonth=loadRecurringMonth;
  V.loadRecurringAll=loadRecurringAll;

  const previousLoadMonth=window.loadMonth;
  if(typeof previousLoadMonth==='function'){
    window.loadMonth=async function(m,rerender=true){
      await previousLoadMonth(m,false);
      await loadRecurringMonth(m,false);
      if(rerender)render();
    };
  }
  const previousRefresh=window.refresh;
  if(typeof previousRefresh==='function'){
    window.refresh=async function(...args){
      await previousRefresh(...args);
      await Promise.all([loadRecurringMonth(state.month,false),loadRecurringAll(false)]);
      if(state.household)render();
    };
  }

  let tries=0;
  const timer=setInterval(async()=>{
    tries++;
    if(state.key&&state.household){
      try{await Promise.all([loadRecurringMonth(state.month,false),loadRecurringAll(false)]);render();clearInterval(timer)}catch(e){console.error('Recurring load failed',e)}
    }
    if(tries>40)clearInterval(timer);
  },250);

  function pendingItems(){return (state.recurringMonth||[]).filter(x=>x.status==='pending'||x.status==='overdue')}
  function dueLabel(x){
    if(!x?.due_date)return '';
    const d=String(x.due_date).slice(0,10),day=Number(d.slice(8,10));
    return x.day_of_month===31?`Cuối tháng · ${d}`:`Ngày ${day} · ${d}`;
  }
  function intervalLabel(x){const n0=Number(x.interval_months||1);return n0===1?'Hàng tháng':`Mỗi ${n0} tháng`}
  function statusInfo(x){
    if(x.status==='paid')return {label:'Đã xác nhận',cls:'paid'};
    if(x.status==='skipped')return {label:'Đã bỏ qua',cls:'skipped'};
    if(x.status==='overdue')return {label:'Quá hạn',cls:'overdue'};
    return {label:'Chờ xác nhận',cls:'pending'};
  }

  function correctedSafeSpend(){
    const base=typeof V.safeSpendData==='function'?V.safeSpendData():null;
    if(!base||base.available===null||!base.configured)return base;
    let fixedPending=0,variablePending=0;
    pendingItems().forEach(x=>{if(x.cost_type==='fixed')fixedPending+=n(x.amount);else variablePending+=n(x.amount)});
    const extraFixed=Math.max(0,fixedPending-n(base.fixedNeed));
    const protectedTotal=n(base.protectedTotal)+extraFixed+variablePending;
    const variableRemaining=Math.max(0,n(base.variableRemaining)-variablePending);
    const afterProtection=Math.max(0,n(base.spendableBalance)-protectedTotal);
    return {...base,recurringNeed:fixedPending+variablePending,extraFixed,variableRecurringNeed:variablePending,protectedTotal,variableRemaining,available:Math.max(0,Math.min(afterProtection,variableRemaining))};
  }
  V.safeSpendWithRecurring=correctedSafeSpend;

  function patchSafeSpend(html){
    const x=correctedSafeSpend();
    if(!x||x.available===null)return html;
    const extra=x.recurringNeed?` Trong đó ${money(x.recurringNeed)} là khoản định kỳ chưa xác nhận.`:'';
    return html.replace(/(<span class="v7-kicker">CÓ THỂ TIÊU AN TOÀN<\/span>\s*<strong>)[\s\S]*?(<\/strong>\s*<p>)[\s\S]*?(<\/p>)/,`$1${money(x.available)}$2Sau khi giữ lại ${money(x.protectedTotal)} cho nghĩa vụ, mục tiêu và dự phòng.${extra}$3`);
  }

  function recurringStrip(){
    const items=pendingItems();
    if(!items.length)return '';
    const overdue=items.filter(x=>x.status==='overdue'),total=items.reduce((s,x)=>s+n(x.amount),0);
    return `<section class="rec-strip ${overdue.length?'overdue':''}"><div><span>CHI ĐỊNH KỲ · ${state.month.replace('-','/')}</span><strong>${items.length} khoản chờ · ${money(total)}</strong><small>${overdue.length?`${overdue.length} khoản đã quá hạn`:'Chưa trừ tiền cho đến khi bạn xác nhận'}</small></div><div class="rec-strip-actions">${items.slice(0,2).map(x=>`<button data-rec-action="confirm" data-rec-id="${x.id}">${esc(x.name)} · ${money(x.amount,x.currency)}</button>`).join('')}<button class="primary" data-rec-action="manage-month">Xem tất cả</button></div></section>`;
  }

  function recurringCard(x){
    const st=statusInfo(x),amount=x.status==='paid'?n(x.actual_amount):n(x.amount);
    return `<article class="rec-card ${st.cls}"><div class="rec-card-top"><div><span>${esc(intervalLabel(x))}</span><h3>${esc(x.name)}</h3></div><span class="rec-status ${st.cls}">${st.label}</span></div><strong>${money(amount,x.currency)}</strong><small>${esc(dueLabel(x))} · ${esc(x.category_name||'Danh mục')} · ${esc(x.account_name||'Tài khoản')}</small><div class="rec-card-actions">${x.status==='pending'||x.status==='overdue'?`<button class="primary" data-rec-action="confirm" data-rec-id="${x.id}">Xác nhận</button><button data-rec-action="skip" data-rec-id="${x.id}">Bỏ qua tháng</button>`:x.status==='skipped'?`<button data-rec-action="unskip" data-rec-id="${x.id}">Khôi phục tháng</button>`:`<span>Đã ghi ${esc(String(x.actual_date||''))}</span>`}<button data-rec-action="edit" data-rec-id="${x.id}">Sửa lịch</button></div></article>`;
  }

  function recurringPanel(){
    const rows=state.recurringMonth||[],pending=pendingItems(),expected=rows.filter(x=>x.status!=='skipped').reduce((s,x)=>s+n(x.amount),0),paid=rows.filter(x=>x.status==='paid').reduce((s,x)=>s+n(x.actual_amount),0);
    return `<section class="rec-section"><div class="rec-head"><div><span class="rec-eyebrow">DÒNG TIỀN ĐỊNH KỲ</span><h2>Khoản chờ xác nhận</h2><p>Dự kiến không làm giảm số dư. Chỉ khi xác nhận mới tạo giao dịch thật.</p></div><div class="rec-head-actions"><button data-rec-action="manage">Quản lý</button><button class="primary" data-rec-action="new">＋ Thêm định kỳ</button></div></div><div class="rec-summary"><div><span>Dự kiến tháng</span><strong>${money(expected)}</strong></div><div><span>Đã xác nhận</span><strong>${money(paid)}</strong></div><div><span>Còn chờ</span><strong class="${pending.some(x=>x.status==='overdue')?'red':''}">${money(pending.reduce((s,x)=>s+n(x.amount),0))}</strong></div></div><div class="rec-grid">${rows.length?rows.map(recurringCard).join(''):'<div class="rec-empty">Chưa có khoản định kỳ trong tháng này. Thêm tiền nhà, Wi‑Fi, điện thoại, bảo hiểm… để app nhắc nhưng không tự trừ.</div>'}</div></section>`;
  }

  const dashboardBefore=V.dashboardV3,budgetBefore=V.budgetV3;
  if(typeof dashboardBefore==='function')V.dashboardV3=()=>{
    let html=patchSafeSpend(dashboardBefore());
    const strip=recurringStrip();
    if(strip)html=html.replace(/(<section class="v7-focus[\s\S]*?<\/section>)/,`$1${strip}`);
    return html;
  };
  if(typeof budgetBefore==='function')V.budgetV3=()=>budgetBefore()+recurringPanel();

  function defaultRecurringAccount(id=''){
    const list=activeAccounts().filter(a=>['cash','bank','credit'].includes(a.account_type));
    if(id&&list.some(a=>a.id===id))return id;
    const d=typeof defaultMoneyAccountId==='function'?defaultMoneyAccountId():'';
    return list.some(a=>a.id===d)?d:(list[0]?.id||'');
  }
  function defaultRecurringCategory(id=''){
    const list=activeCategories('expense');
    if(id&&list.some(c=>c.id===id))return id;
    return list.find(c=>c.cost_type==='fixed')?.id||list[0]?.id||'';
  }

  function openRecurring(id=''){
    const item=(state.recurringAll||[]).find(x=>x.id===id)||{},isNew=!id;
    const accounts=activeAccounts().filter(a=>['cash','bank','credit'].includes(a.account_type)||a.id===item.account_id),cats=activeCategories('expense');
    if(!accounts.length)return toast('Hãy tạo tài khoản tiền/ngân hàng/thẻ trước.',true);
    if(!cats.length)return toast('Hãy tạo ít nhất một danh mục chi tiêu trước.',true);
    const accountId=defaultRecurringAccount(item.account_id),categoryId=defaultRecurringCategory(item.category_id),start=String(item.start_month||`${state.month}-01`).slice(0,7),end=item.end_month?String(item.end_month).slice(0,7):'';
    modal(isNew?'Thêm khoản định kỳ':'Sửa khoản định kỳ',`<div class="rec-form-intro">Chỉ cần <b>tên + số tiền dự kiến + ngày</b>. Các mục còn lại app đã chọn sẵn; mở “Thêm chi tiết” khi cần đổi.</div><div class="rec-simple-form"><div class="field"><label>Tên khoản</label><input name="name" value="${esc(item.name||'')}" placeholder="VD: Wi‑Fi / Điện thoại / Tiền nhà" required autofocus></div><div class="field"><label>Số tiền dự kiến</label><input name="amount" type="number" min="1" step="1" value="${esc(item.amount||'')}" placeholder="0" required></div><div class="field"><label>Ngày trong tháng</label><input id="recDay" name="day_of_month" type="number" min="1" max="31" value="${esc(item.day_of_month||1)}" required><div class="rec-day-chips">${[1,5,10,15,20,25,31].map(d=>`<button type="button" data-rec-day="${d}">${d===31?'Cuối tháng':d}</button>`).join('')}</div></div></div><details class="rec-details"><summary>Thêm chi tiết</summary><div class="form-grid"><div class="field"><label>Tài khoản mặc định</label><select name="account_id" id="recAccount" required>${options(accounts,accountId,a=>`${a.name} · ${a.currency}`)}</select></div><div class="field"><label>Danh mục</label><select name="category_id" required>${options(cats,categoryId,c=>`${c.name}${c.cost_type==='fixed'?' · cố định':' · biến động'}`)}</select></div><div class="field"><label>Lặp lại</label><select name="interval_months">${[[1,'Hàng tháng'],[2,'Mỗi 2 tháng'],[3,'Mỗi 3 tháng'],[6,'Mỗi 6 tháng'],[12,'Hàng năm']].map(([v,l])=>`<option value="${v}" ${Number(item.interval_months||1)===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="field"><label>Bắt đầu</label><input name="start_month" type="month" value="${esc(start)}" required></div><div class="field"><label>Kết thúc</label><input name="end_month" type="month" value="${esc(end)}"><small>Để trống nếu tiếp tục vô thời hạn.</small></div><div class="field full"><label>Ghi chú</label><input name="note" value="${esc(item.note||'')}" placeholder="Tùy chọn"></div></div></details>`,async fd=>{const a=(state.accounts||[]).find(x=>x.id===fd.account_id);if(!a)throw new Error('Hãy chọn tài khoản.');await recurringApi('save',{...fd,id:id||null,currency:a.currency||state.base,start_month:`${fd.start_month}-01`,end_month:fd.end_month?`${fd.end_month}-01`:null})},'Lưu');
    document.querySelectorAll('#modalBody [data-rec-day]').forEach(b=>b.addEventListener('click',()=>{const x=$('#recDay');if(x)x.value=b.dataset.recDay}));
  }

  function openRecurringConfirm(id){
    const x=(state.recurringMonth||[]).find(r=>r.id===id);if(!x)return toast('Không tìm thấy khoản định kỳ tháng này.',true);
    if(x.status==='paid')return toast('Khoản này đã được xác nhận.');
    const accounts=activeAccounts().filter(a=>['cash','bank','credit'].includes(a.account_type)&&(a.currency||state.base)===(x.currency||state.base));
    if(!accounts.length)return toast(`Không có tài khoản ${x.currency} phù hợp.`,true);
    const local=V.localToday?.()||today(),date=state.month===local.slice(0,7)?local:String(x.due_date||local).slice(0,10),selected=accounts.some(a=>a.id===x.account_id)?x.account_id:accounts[0].id;
    modal(`Xác nhận · ${esc(x.name)}`,`<div class="rec-confirm-summary"><span>Dự kiến ${money(x.amount,x.currency)}</span><small>${esc(dueLabel(x))} · ${esc(x.category_name||'')}</small></div><div class="rec-confirm-amount"><label>Số tiền thực tế</label><div><span>${esc(x.currency)}</span><input name="amount" type="number" min="1" step="1" value="${esc(x.amount)}" required autofocus></div></div><details class="rec-details"><summary>Thêm chi tiết</summary><div class="form-grid"><div class="field"><label>Ngày thanh toán</label><input name="transaction_date" type="date" value="${esc(date)}" required></div><div class="field"><label>Trừ từ</label><select name="account_id" required>${options(accounts,selected,a=>`${a.name} · ${a.currency}`)}</select></div><div class="field full"><label>Ghi chú</label><input name="note" value="${esc(x.name)}"></div></div></details>`,fd=>recurringApi('confirm',{id,month:`${state.month}-01`,amount:fd.amount,account_id:fd.account_id,category_id:x.category_id,transaction_date:fd.transaction_date||date,note:fd.note||x.name}),'Xác nhận chi');
  }

  function showRecurringManager(){
    const dlg=$('#modal'),mb=$('#modalBody'),form=$('#modalForm'),rows=state.recurringAll||[];
    mb.innerHTML=`<div class="modal-head"><div><span class="v7-modal-kicker">QUẢN LÝ</span><h3>Khoản định kỳ</h3></div><button class="mini-btn" type="button" data-rec-action="close">✕</button></div><div class="modal-content"><div class="rec-manager-head"><p>Sửa lịch không làm thay đổi các giao dịch đã xác nhận trước đây.</p><button class="btn primary" type="button" data-rec-action="new">＋ Thêm</button></div><div class="rec-manager-list">${rows.length?rows.map(x=>`<div class="rec-manager-row ${x.is_active?'':'inactive'}"><div><b>${esc(x.name)}</b><span>${money(x.amount,x.currency)} · ${esc(intervalLabel(x))} · ngày ${x.day_of_month===31?'cuối tháng':x.day_of_month}</span><small>${esc(x.category_name||'')} · ${esc(x.account_name||'')}</small></div><div><button type="button" data-rec-action="edit" data-rec-id="${x.id}">Sửa</button><button type="button" data-rec-action="${x.is_active?'archive':'restore'}" data-rec-id="${x.id}">${x.is_active?'Tạm dừng':'Bật lại'}</button></div></div>`).join(''):'<div class="rec-empty">Chưa có khoản định kỳ.</div>'}</div></div><div class="modal-actions"><button class="btn primary" type="button" data-rec-action="close">Đóng</button></div>`;
    form.onsubmit=e=>e.preventDefault();dlg.showModal();
  }

  async function mutate(action,id){
    if(action==='skip'&&!confirm('Bỏ qua khoản này riêng tháng đang xem?'))return;
    if(action==='archive'&&!confirm('Tạm dừng khoản định kỳ này? Lịch sử đã xác nhận vẫn được giữ.'))return;
    try{
      if(action==='skip')await recurringApi('skip_month',{id,month:`${state.month}-01`});
      else if(action==='unskip')await recurringApi('unskip_month',{id,month:`${state.month}-01`});
      else if(action==='archive')await recurringApi('archive',{id});
      else if(action==='restore')await recurringApi('restore',{id});
      await Promise.all([loadRecurringMonth(state.month,false),loadRecurringAll(false)]);render();
      if(action==='archive'||action==='restore')showRecurringManager();
      toast('Đã cập nhật');
    }catch(e){toast(e.message,true)}
  }

  document.addEventListener('click',e=>{
    const b=e.target.closest?.('[data-rec-action]');if(!b)return;
    const action=b.dataset.recAction,id=b.dataset.recId||'';
    if(action==='new')return openRecurring();
    if(action==='edit')return openRecurring(id);
    if(action==='confirm')return openRecurringConfirm(id);
    if(action==='manage'||action==='manage-month')return showRecurringManager();
    if(action==='close')return document.getElementById('modal')?.close();
    if(['skip','unskip','archive','restore'].includes(action))return mutate(action,id);
  });

  Object.assign(window,{openRecurring,openRecurringConfirm,showRecurringManager});
})();