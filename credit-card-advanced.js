(() => {
  const V=window.__V3;
  if(!V||typeof V.cardApi!=='function')return;
  const RPC_URL=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_credit_card_plan_api`;

  async function planApi(action,payload={}){
    if(!state.key)throw new Error('Thiếu khóa gia đình');
    const res=await fetch(RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({p_key:state.key,p_action:action,p_payload:payload})});
    const text=await res.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok){
      const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
      const friendly=/invalid_paid_installments_before/i.test(raw)?'Số kỳ đã trả phải nhỏ hơn tổng số kỳ.'
        :/custom_schedule_required/i.test(raw)?'Hãy tạo lịch thanh toán tùy chỉnh.'
        :/custom_schedule_count_mismatch/i.test(raw)?'Số dòng lịch tương lai phải bằng số kỳ còn lại.'
        :/duplicate_custom_payment_month/i.test(raw)?'Không thể có hai kỳ của cùng khoản trong một tháng. Hãy gộp tiền thường + Bonus vào một dòng.'
        :/custom_principal_total_mismatch/i.test(raw)?'Với mua mới, tổng phần gốc các kỳ phải đúng bằng giá mua.'
        :/custom_fee_total_mismatch/i.test(raw)?'Với mua mới, tổng phí các kỳ phải đúng bằng tổng phí đã nhập.'
        :/remaining_principal_exceeds_original/i.test(raw)?'Tổng gốc còn phải trả không được lớn hơn giá mua ban đầu.'
        :/card_cycle_required/i.test(raw)?'Hãy thiết lập chu kỳ thẻ trước.'
        :/invalid_installment_count/i.test(raw)?'Số kỳ phải từ 2 đến 60.'
        :/invalid_category/i.test(raw)?'Hãy chọn danh mục chi hợp lệ.'
        :/amount_must_be_positive/i.test(raw)?'Số tiền phải lớn hơn 0.'
        :/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.':raw;
      throw new Error(friendly);
    }
    return data;
  }
  V.cardPlanApi=planApi;

  function normalizeInstallments(){
    state.cardInstallments=(state.cardInstallments||[]).map(x=>{
      const raw=x.__rawPaidInstallments??Number(x.paid_installments||0);
      return {...x,__rawPaidInstallments:raw,paid_installments:raw+Number(x.paid_installments_before||0)};
    });
  }

  const refreshBefore=window.refresh;
  if(typeof refreshBefore==='function')window.refresh=async function(...args){
    const out=await refreshBefore.apply(this,args);normalizeInstallments();if(state.household)render();return out;
  };

  let boot=0;const bootTimer=setInterval(()=>{
    boot++;
    if(state.household&&(state.cardInstallments||[]).length){normalizeInstallments();render();clearInterval(bootTimer)}
    if(boot>40)clearInterval(bootTimer);
  },250);

  const configuredCards=()=>activeAccounts().filter(a=>a.account_type==='credit'&&(state.cardSettings||[]).some(s=>s.account_id===a.id));
  const settingFor=id=>(state.cardSettings||[]).find(s=>s.account_id===id);
  const localMonth=()=>state.month||String(V.localToday?.()||new Date().toISOString().slice(0,10)).slice(0,7);
  const pad=n=>String(n).padStart(2,'0');
  function addMonths(ym,delta){
    const [y,m]=String(ym).slice(0,7).split('-').map(Number),idx=y*12+(m-1)+delta;
    return `${Math.floor(idx/12)}-${pad(idx%12+1)}`;
  }
  function firstPaymentMonth(cardId,purchaseDate){
    const s=settingFor(cardId);if(!s)return localMonth();
    const [y,m,d]=String(purchaseDate||V.localToday?.()||'').slice(0,10).split('-').map(Number);
    const last=new Date(y,m,0).getDate(),close=Math.min(Number(s.closing_day||31),last);
    const extra=d>close?1:0,idx=y*12+(m-1)+extra+Number(s.payment_month_offset||1);
    return `${Math.floor(idx/12)}-${pad(idx%12+1)}`;
  }

  function rowHtml(i,no,month,principal,fee,kind='regular'){
    return `<div class="cc-adv-row" data-cc-adv-row><span class="cc-adv-no">#${no}</span><input data-cc-adv-month type="month" value="${esc(month)}" required><div class="cc-adv-money"><span>Tiền trả (gốc)</span><input data-cc-adv-principal type="number" min="0" step="1" value="${esc(principal)}" required></div><div class="cc-adv-money"><span>Phí</span><input data-cc-adv-fee type="number" min="0" step="1" value="${esc(fee)}" required></div><select data-cc-adv-kind><option value="regular" ${kind==='regular'?'selected':''}>Thường</option><option value="bonus" ${kind==='bonus'?'selected':''}>Bonus</option><option value="manual" ${kind==='manual'?'selected':''}>Thủ công</option></select></div>`;
  }

  function formState(){
    const q=s=>document.querySelector(`#modalBody ${s}`);
    return {
      entry:q('[name="entry_mode"]')?.value||'purchase',
      schedule:q('[name="schedule_mode"]')?.value||'equal',
      card:q('[name="card_account_id"]')?.value||'',
      principal:Number(q('[name="principal_amount"]')?.value||0),
      fee:Number(q('[name="fee_total"]')?.value||0),
      total:Number(q('[name="total_installments"]')?.value||0),
      paid:Number(q('[name="paid_installments_before"]')?.value||0),
      purchaseDate:q('[name="purchase_date"]')?.value||'',
      nextMonth:q('[name="next_payment_month"]')?.value||localMonth(),
      currentAmount:Number(q('[name="current_payment_amount"]')?.value||0)
    };
  }

  function updateCustomSummary(){
    const rows=[...document.querySelectorAll('#modalBody [data-cc-adv-row]')];
    const p=rows.reduce((s,r)=>s+Number(r.querySelector('[data-cc-adv-principal]')?.value||0),0);
    const f=rows.reduce((s,r)=>s+Number(r.querySelector('[data-cc-adv-fee]')?.value||0),0);
    const el=document.querySelector('#ccAdvScheduleSummary');if(el)el.textContent=`Lịch còn lại: tổng phải trả ${money(p+f,state.base)} · gốc ${money(p,state.base)} · phí ${money(f,state.base)} · ${rows.length} kỳ`;
  }

  function applyCurrentAmountToFirstRow(){
    const s=formState();if(s.entry!=='existing'||s.currentAmount<=0)return;
    const row=document.querySelector('#modalBody [data-cc-adv-row]');if(!row)return;
    const fee=Number(row.querySelector('[data-cc-adv-fee]')?.value||0),principal=row.querySelector('[data-cc-adv-principal]'),kind=row.querySelector('[data-cc-adv-kind]');
    if(principal)principal.value=Math.max(0,Math.round(s.currentAmount-fee));
    if(kind)kind.value='manual';
    updateCustomSummary();
  }

  function generateCustomRows(){
    const s=formState(),box=document.querySelector('#ccAdvRows');if(!box)return false;
    if(!s.total||s.total<2){toast('Nhập tổng số kỳ trước.',true);return false}
    if(s.paid<0||s.paid>=s.total){toast('Số kỳ đã trả không hợp lệ.',true);return false}
    if(s.principal<=0){toast('Nhập giá mua / gốc ban đầu trước.',true);return false}
    const remain=s.total-(s.entry==='existing'?s.paid:0),start=s.entry==='purchase'?firstPaymentMonth(s.card,s.purchaseDate):s.nextMonth;
    const baseP=Math.trunc(s.principal/s.total),baseF=Math.trunc(s.fee/s.total);
    let html='';
    for(let j=0;j<remain;j++){
      const no=(s.entry==='existing'?s.paid:0)+j+1;
      const p=no<s.total?baseP:s.principal-baseP*(s.total-1);
      const f=no<s.total?baseF:s.fee-baseF*(s.total-1);
      html+=rowHtml(j,no,addMonths(start,j),p,f,'regular');
    }
    box.innerHTML=html;applyCurrentAmountToFirstRow();updateCustomSummary();return true;
  }

  function syncAdvancedForm(){
    const s=formState();
    const existing=document.querySelector('#ccAdvExisting'),custom=document.querySelector('#ccAdvCustom'),equalExisting=document.querySelector('#ccAdvEqualExisting'),note=document.querySelector('#ccAdvModeNote');
    if(existing)existing.hidden=s.entry!=='existing';
    if(custom)custom.hidden=s.schedule!=='custom';
    if(equalExisting)equalExisting.hidden=!(s.entry==='existing'&&s.schedule==='equal');
    if(note)note.innerHTML=s.entry==='existing'
      ?'<b>Đang trả dở:</b> nhập số kỳ đã trả, tháng bắt đầu trả tiếp và số tiền phải trả của tháng đang xem. Muốn tháng nào trả khác hoặc có Bonus thì chọn “Từng tháng / Bonus” rồi sửa trực tiếp từng dòng.'
      :'<b>Mua mới:</b> toàn bộ giá mua được ghi chi một lần ở ngày mua; các tháng thanh toán chỉ trả nghĩa vụ thẻ, không tính chi lần hai.';
  }

  function collectCustomSchedule(){
    return [...document.querySelectorAll('#modalBody [data-cc-adv-row]')].map(r=>({
      payment_month:`${r.querySelector('[data-cc-adv-month]').value}-01`,
      principal_amount:Number(r.querySelector('[data-cc-adv-principal]').value||0),
      fee_amount:Number(r.querySelector('[data-cc-adv-fee]').value||0),
      payment_kind:r.querySelector('[data-cc-adv-kind]').value||'manual'
    }));
  }

  function openAdvancedInstallment(){
    const cards=configuredCards(),cats=activeCategories('expense');
    if(!cards.length)return toast('Hãy tạo thẻ và thiết lập ngày chốt/ngày trả trước.',true);
    if(!cats.length)return toast('Hãy tạo danh mục chi trước.',true);
    const today=V.localToday?.()||new Date().toISOString().slice(0,10);
    modal('Thêm khoản trả góp',`<div id="ccAdvModeNote" class="cc-form-note"></div><div class="cc-adv-top"><div class="field"><label>Loại khoản</label><select name="entry_mode"><option value="purchase">Mua mới</option><option value="existing">Đang trả dở · nhập lịch còn lại</option></select></div><div class="field"><label>Lịch thanh toán</label><select name="schedule_mode"><option value="equal">Số tiền đều hàng tháng</option><option value="custom">Từng tháng / Bonus</option></select></div></div><div class="cc-install-form"><div class="field full"><label>Tên khoản</label><input name="name" placeholder="VD: iPhone / Máy giặt / khoản đang trả" required autofocus></div><div class="field"><label>Thẻ</label><select name="card_account_id" required>${options(cards,cards[0].id,a=>`${a.name} · ${a.currency}`)}</select></div><div class="field"><label>Giá mua / gốc ban đầu</label><input name="principal_amount" type="number" min="1" step="1" required></div><div class="field"><label>Tổng số kỳ</label><input name="total_installments" type="number" min="2" max="60" value="12" required><div class="cc-chips">${[3,6,10,12,24,36].map(k=>`<button type="button" data-cc-adv-terms="${k}">${k} kỳ</button>`).join('')}</div></div><div class="field"><label>Phí/lãi tổng</label><input name="fee_total" type="number" min="0" step="1" value="0"></div><div class="field"><label>Ngày mua</label><input name="purchase_date" type="date" value="${today}" required></div><div class="field"><label>Danh mục</label><select name="category_id" required>${options(cats,cats[0].id,c=>c.name)}</select></div><div id="ccAdvExisting" class="field full" hidden><div class="cc-adv-existing-grid"><div><label>Đã trả bao nhiêu kỳ</label><input name="paid_installments_before" type="number" min="0" max="59" value="0"></div><div><label>Tháng bắt đầu trả tiếp</label><input name="next_payment_month" type="month" value="${localMonth()}"></div><div class="cc-adv-current-pay"><label>Số phải trả ${localMonth().replace('-','/')}</label><input name="current_payment_amount" type="number" min="0" step="1" value="0"><small>Nếu tháng này trả khác số đều, nhập tổng gốc + phí. App sẽ đưa số này vào kỳ đầu của lịch tùy chỉnh.</small></div></div></div><div id="ccAdvEqualExisting" class="field full" hidden><small>Nếu số tháng này khác số đều, chỉ cần nhập “Số phải trả” phía trên; app sẽ chuyển sang lịch từng tháng để bạn chỉnh tiếp.</small></div><div id="ccAdvCustom" class="field full cc-adv-custom" hidden><div class="cc-adv-custom-head"><div><b>Lịch từng tháng</b><small>Mỗi dòng là một tháng phải trả. Sửa trực tiếp số gốc/phí. Tháng thưởng chọn “Bonus” và nhập đúng số phải trả của tháng đó.</small></div><button type="button" class="btn" data-cc-adv-generate>Tạo / làm lại lịch</button></div><div id="ccAdvRows" class="cc-adv-rows"></div><div id="ccAdvScheduleSummary" class="cc-adv-summary"></div></div><div class="field full"><label>Ghi chú</label><input name="note" placeholder="Tùy chọn"></div></div>`,async fd=>{
      if(fd.entry_mode==='existing'&&Number(fd.current_payment_amount||0)>0&&fd.schedule_mode!=='custom')fd.schedule_mode='custom';
      const payload={...fd,paid_installments_before:fd.entry_mode==='existing'?Number(fd.paid_installments_before||0):0,next_payment_month:fd.entry_mode==='existing'&&fd.schedule_mode==='equal'&&fd.next_payment_month?`${fd.next_payment_month}-01`:null};
      delete payload.current_payment_amount;
      if(fd.schedule_mode==='custom'){
        if(!document.querySelector('#modalBody [data-cc-adv-row]')&&!generateCustomRows())throw new Error('Chưa tạo được lịch trả góp.');
        applyCurrentAmountToFirstRow();payload.schedule=collectCustomSchedule();
      }
      await planApi('create',payload);await refresh();
    },'Lưu lịch trả góp');

    const entry=document.querySelector('#modalBody [name="entry_mode"]'),schedule=document.querySelector('#modalBody [name="schedule_mode"]'),current=document.querySelector('#modalBody [name="current_payment_amount"]');
    entry?.addEventListener('change',()=>{if(entry.value==='existing'&&schedule)schedule.value='custom';syncAdvancedForm();queueMicrotask(()=>{if(formState().principal>0)generateCustomRows()})});
    schedule?.addEventListener('change',()=>{syncAdvancedForm();if(schedule.value==='custom'&&!document.querySelector('#modalBody [data-cc-adv-row]')&&formState().principal>0)generateCustomRows()});
    current?.addEventListener('input',()=>{if(Number(current.value||0)>0&&schedule&&schedule.value!=='custom'){schedule.value='custom';syncAdvancedForm()}if(!document.querySelector('#modalBody [data-cc-adv-row]')&&formState().principal>0)generateCustomRows();else applyCurrentAmountToFirstRow()});
    document.querySelectorAll('#modalBody [data-cc-adv-terms]').forEach(b=>b.addEventListener('click',()=>{const x=document.querySelector('#modalBody [name="total_installments"]');if(x)x.value=b.dataset.ccAdvTerms}));
    document.querySelector('#modalBody [data-cc-adv-generate]')?.addEventListener('click',generateCustomRows);
    document.querySelector('#ccAdvRows')?.addEventListener('input',updateCustomSummary);
    syncAdvancedForm();
  }

  async function showInstallmentSchedule(id){
    const x=(state.cardInstallments||[]).find(i=>i.id===id),d=await planApi('get_schedule',{id}),rows=d?.items||[];
    const body=rows.length?rows.map(r=>`<div class="cc-adv-history-row ${r.is_paid?'paid':''}"><div><b>Kỳ ${r.installment_no}</b><span>${esc(String(r.payment_month).slice(0,7))}</span></div><div><strong>${money(Number(r.principal_amount)+Number(r.fee_amount),x?.currency||state.base)}</strong><small>Gốc ${money(r.principal_amount,x?.currency||state.base)}${Number(r.fee_amount)?` · phí ${money(r.fee_amount,x?.currency||state.base)}`:''} · ${r.payment_kind==='bonus'?'Bonus':r.payment_kind==='manual'?'Thủ công':'Thường'}${r.is_paid?' · đã trả':''}</small></div></div>`).join(''):'<div class="cc-empty">Chưa có lịch.</div>';
    modal(`Lịch trả · ${esc(x?.name||'Trả góp')}`,`<div class="cc-form-note">${x?.entry_mode==='existing'?'<b>Khoản đang trả dở:</b> app theo dõi phần lịch còn lại theo từng tháng.':'Chi phí mua đã được ghi một lần ở ngày mua.'}</div><div class="cc-adv-history">${body}</div>`,async()=>{},'Đóng');
  }

  function decorateInstallments(){
    normalizeInstallments();
    const cards=[...document.querySelectorAll('.cc-install')];
    (state.cardInstallments||[]).forEach((x,i)=>{
      const card=cards[i];if(!card)return;
      const top=card.querySelector('.cc-install-top>div');
      if(top&&!top.querySelector('[data-cc-adv-badge]')){
        const badge=document.createElement('small');badge.dataset.ccAdvBadge='1';badge.className='cc-adv-badge';
        badge.textContent=[x.entry_mode==='existing'?'Đang trả dở':'Mua mới',x.schedule_mode==='custom'?'Lịch từng tháng / Bonus':'Lịch đều'].join(' · ');top.appendChild(badge);
      }
      if(!card.querySelector('[data-cc-adv-schedule]')){
        const b=document.createElement('button');b.type='button';b.dataset.ccAdvSchedule=x.id;b.className='cc-adv-schedule-btn';b.textContent='Xem lịch từng tháng';card.appendChild(b);
      }
    });
    document.querySelectorAll('.cc-card:not(.unconfigured)').forEach(card=>{
      if(card.querySelector('[data-cc-cycle-explain]'))return;
      const p=document.createElement('small');p.dataset.ccCycleExplain='1';p.className='cc-cycle-explain';p.textContent='Chi ghi ở ngày mua · tiền ngân hàng chỉ giảm ở ngày thanh toán của kỳ sau.';card.appendChild(p);
    });
  }

  document.addEventListener('click',e=>{
    const b=e.target.closest?.('[data-cc-action="new-installment"]');if(!b)return;
    e.preventDefault();e.stopImmediatePropagation();openAdvancedInstallment();
  },true);
  document.addEventListener('click',async e=>{
    const b=e.target.closest?.('[data-cc-adv-schedule]');if(!b)return;
    e.preventDefault();e.stopImmediatePropagation();try{await showInstallmentSchedule(b.dataset.ccAdvSchedule)}catch(err){toast(err.message,true)}
  },true);

  window.openInstallment=openAdvancedInstallment;
  window.openAdvancedInstallment=openAdvancedInstallment;
  const renderBefore=window.render;
  if(typeof renderBefore==='function')window.render=function(...args){const out=renderBefore.apply(this,args);queueMicrotask(decorateInstallments);return out};
  queueMicrotask(decorateInstallments);
})();