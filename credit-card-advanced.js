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
  const localMonth=()=>String(V.localToday?.()||new Date().toISOString().slice(0,10)).slice(0,7);
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
    return `<div class="cc-adv-row" data-cc-adv-row><span class="cc-adv-no">#${no}</span><input data-cc-adv-month type="month" value="${esc(month)}" required><div class="cc-adv-money"><span>Gốc</span><input data-cc-adv-principal type="number" min="0" step="1" value="${esc(principal)}" required></div><div class="cc-adv-money"><span>Phí</span><input data-cc-adv-fee type="number" min="0" step="1" value="${esc(fee)}" required></div><select data-cc-adv-kind><option value="regular" ${kind==='regular'?'selected':''}>Thường</option><option value="bonus" ${kind==='bonus'?'selected':''}>Bonus</option><option value="manual" ${kind==='manual'?'selected':''}>Thủ công</option></select></div>`;
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
      nextMonth:q('[name="next_payment_month"]')?.value||localMonth()
    };
  }

  function updateCustomSummary(){
    const rows=[...document.querySelectorAll('#modalBody [data-cc-adv-row]')];
    const p=rows.reduce((s,r)=>s+Number(r.querySelector('[data-cc-adv-principal]')?.value||0),0);
    const f=rows.reduce((s,r)=>s+Number(r.querySelector('[data-cc-adv-fee]')?.value||0),0);
    const el=document.querySelector('#ccAdvScheduleSummary');if(el)el.textContent=`Lịch tương lai: gốc ${money(p,state.base)} · phí ${money(f,state.base)} · ${rows.length} kỳ`;
  }

  function generateCustomRows(){
    const s=formState(),box=document.querySelector('#ccAdvRows');if(!box)return;
    if(!s.total||s.total<2)return toast('Nhập tổng số kỳ trước.',true);
    if(s.paid<0||s.paid>=s.total)return toast('Số kỳ đã trả không hợp lệ.',true);
    const remain=s.total-(s.entry==='existing'?s.paid:0),start=s.entry==='purchase'?firstPaymentMonth(s.card,s.purchaseDate):s.nextMonth;
    const baseP=Math.trunc(s.principal/s.total),baseF=Math.trunc(s.fee/s.total);
    let html='';
    for(let j=0;j<remain;j++){
      const no=(s.entry==='existing'?s.paid:0)+j+1;
      const p=no<s.total?baseP:s.principal-baseP*(s.total-1);
      const f=no<s.total?baseF:s.fee-baseF*(s.total-1);
      html+=rowHtml(j,no,addMonths(start,j),p,f,'regular');
    }
    box.innerHTML=html;updateCustomSummary();
  }

  function syncAdvancedForm(){
    const s=formState();
    const existing=document.querySelector('#ccAdvExisting'),custom=document.querySelector('#ccAdvCustom'),equalExisting=document.querySelector('#ccAdvEqualExisting'),note=document.querySelector('#ccAdvModeNote');
    if(existing)existing.hidden=s.entry!=='existing';
    if(custom)custom.hidden=s.schedule!=='custom';
    if(equalExisting)equalExisting.hidden=!(s.entry==='existing'&&s.schedule==='equal');
    if(note)note.innerHTML=s.entry==='existing'
      ?'<b>Đang trả dở:</b> app chỉ tạo lịch các kỳ còn lại, không ghi lại chi phí mua cũ. Dư nợ hiện tại của thẻ nên được phản ánh bằng số dư đầu/đối soát để thanh toán không làm thẻ thành số dương giả.'
      :'<b>Mua mới:</b> toàn bộ giá mua được ghi chi một lần ở ngày mua; tháng trả thẻ chỉ là chuyển tiền, không tính chi lần hai.';
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
    if(!cards.length)return toast('Hãy thiết lập chu kỳ cho ít nhất một thẻ trước.',true);
    if(!cats.length)return toast('Hãy tạo danh mục chi trước.',true);
    const today=V.localToday?.()||new Date().toISOString().slice(0,10);
    modal('Thêm khoản trả góp',`<div id="ccAdvModeNote" class="cc-form-note"></div><div class="cc-adv-top"><div class="field"><label>Loại nhập</label><select name="entry_mode"><option value="purchase">Mua mới</option><option value="existing">Đang trả dở · nhập tay</option></select></div><div class="field"><label>Kiểu lịch</label><select name="schedule_mode"><option value="equal">Đều hàng tháng</option><option value="custom">Tùy chỉnh / Bonus</option></select></div></div><div class="cc-install-form"><div class="field full"><label>Tên khoản</label><input name="name" placeholder="VD: iPhone / Máy giặt / trả góp đang dở" required autofocus></div><div class="field"><label>Thẻ</label><select name="card_account_id" required>${options(cards,cards[0].id,a=>`${a.name} · ${a.currency}`)}</select></div><div class="field"><label>Giá mua ban đầu</label><input name="principal_amount" type="number" min="1" step="1" required></div><div class="field"><label>Tổng số kỳ</label><input name="total_installments" type="number" min="2" max="60" value="12" required><div class="cc-chips">${[3,6,10,12,24,36].map(k=>`<button type="button" data-cc-adv-terms="${k}">${k} kỳ</button>`).join('')}</div></div><div class="field"><label>Phí/lãi tổng</label><input name="fee_total" type="number" min="0" step="1" value="0"></div><div class="field"><label>Ngày mua</label><input name="purchase_date" type="date" value="${today}" required></div><div class="field"><label>Danh mục</label><select name="category_id" required>${options(cats,cats[0].id,c=>c.name)}</select></div><div id="ccAdvExisting" class="field full" hidden><div class="cc-adv-existing-grid"><div><label>Đã trả bao nhiêu kỳ</label><input name="paid_installments_before" type="number" min="0" max="59" value="0"></div><div><label>Kỳ tiếp theo</label><input name="next_payment_month" type="month" value="${localMonth()}"></div></div></div><div id="ccAdvEqualExisting" class="field full" hidden><small>Với lịch đều, app sẽ tạo đúng số kỳ còn lại từ “Kỳ tiếp theo”.</small></div><div id="ccAdvCustom" class="field full cc-adv-custom" hidden><div class="cc-adv-custom-head"><div><b>Lịch từng tháng</b><small>Nhấn tạo lịch đều rồi sửa riêng tháng Bonus/số tiền khác. Một khoản chỉ có một dòng mỗi tháng; nếu có Bonus cùng tháng hãy gộp vào số gốc của tháng đó.</small></div><button type="button" class="btn" data-cc-adv-generate>Tạo lịch dự kiến</button></div><div id="ccAdvRows" class="cc-adv-rows"></div><div id="ccAdvScheduleSummary" class="cc-adv-summary"></div></div><div class="field full"><label>Ghi chú</label><input name="note" placeholder="Tùy chọn"></div></div>`,async fd=>{
      const payload={...fd,paid_installments_before:fd.entry_mode==='existing'?Number(fd.paid_installments_before||0):0,next_payment_month:fd.entry_mode==='existing'&&fd.schedule_mode==='equal'&&fd.next_payment_month?`${fd.next_payment_month}-01`:null};
      if(fd.schedule_mode==='custom')payload.schedule=collectCustomSchedule();
      await planApi('create',payload);await refresh();
    },'Lưu trả góp');

    document.querySelectorAll('#modalBody [name="entry_mode"],#modalBody [name="schedule_mode"]').forEach(x=>x.addEventListener('change',syncAdvancedForm));
    document.querySelectorAll('#modalBody [data-cc-adv-terms]').forEach(b=>b.addEventListener('click',()=>{const x=document.querySelector('#modalBody [name="total_installments"]');if(x)x.value=b.dataset.ccAdvTerms}));
    document.querySelector('#modalBody [data-cc-adv-generate]')?.addEventListener('click',generateCustomRows);
    document.querySelector('#ccAdvRows')?.addEventListener('input',updateCustomSummary);
    syncAdvancedForm();
  }

  async function showInstallmentSchedule(id){
    const x=(state.cardInstallments||[]).find(i=>i.id===id),d=await planApi('get_schedule',{id}),rows=d?.items||[];
    const body=rows.length?rows.map(r=>`<div class="cc-adv-history-row ${r.is_paid?'paid':''}"><div><b>Kỳ ${r.installment_no}</b><span>${esc(String(r.payment_month).slice(0,7))}</span></div><div><strong>${money(Number(r.principal_amount)+Number(r.fee_amount),x?.currency||state.base)}</strong><small>Gốc ${money(r.principal_amount,x?.currency||state.base)}${Number(r.fee_amount)?` · phí ${money(r.fee_amount,x?.currency||state.base)}`:''} · ${r.payment_kind==='bonus'?'Bonus':r.payment_kind==='manual'?'Thủ công':'Thường'}${r.is_paid?' · đã trả':''}</small></div></div>`).join(''):'<div class="cc-empty">Chưa có lịch.</div>';
    modal(`Lịch trả · ${esc(x?.name||'Trả góp')}`,`<div class="cc-form-note">${x?.entry_mode==='existing'?'<b>Khoản nhập tay:</b> chỉ theo dõi phần lịch còn lại; không tạo lại chi phí mua cũ.':'Chi phí mua đã được ghi một lần ở ngày mua.'}</div><div class="cc-adv-history">${body}</div>`,async()=>{},'Đóng');
  }

  function decorateInstallments(){
    normalizeInstallments();
    const cards=[...document.querySelectorAll('.cc-install')];
    (state.cardInstallments||[]).forEach((x,i)=>{
      const card=cards[i];if(!card)return;
      const top=card.querySelector('.cc-install-top>div');
      if(top&&!top.querySelector('[data-cc-adv-badge]')){
        const badge=document.createElement('small');badge.dataset.ccAdvBadge='1';badge.className='cc-adv-badge';
        badge.textContent=[x.entry_mode==='existing'?'Nhập tay · đang trả dở':'Mua mới',x.schedule_mode==='custom'?'Lịch tùy chỉnh / Bonus':'Lịch đều'].join(' · ');top.appendChild(badge);
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

  const renderBefore=window.render;
  if(typeof renderBefore==='function')window.render=function(...args){const out=renderBefore.apply(this,args);queueMicrotask(decorateInstallments);return out};
  queueMicrotask(decorateInstallments);
})();