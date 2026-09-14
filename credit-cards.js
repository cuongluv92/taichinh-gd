(() => {
  const V=window.__V3;
  if(!V) return;
  const RPC_URL=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_credit_card_api`;
  state.cardSettings=state.cardSettings||[];
  state.cardOverview=state.cardOverview||[];
  state.cardInstallments=state.cardInstallments||[];

  const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const cardAccounts=()=>activeAccounts().filter(a=>a.account_type==='credit');
  const settingFor=id=>(state.cardSettings||[]).find(x=>x.account_id===id);
  const overviewFor=id=>(state.cardOverview||[]).find(x=>x.account_id===id);
  const configuredCards=()=>cardAccounts().filter(a=>settingFor(a.id));

  async function cardApi(action,payload={}){
    if(!state.key) throw new Error('Thiếu khóa gia đình');
    const res=await fetch(RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({p_key:state.key,p_action:action,p_payload:payload})});
    const text=await res.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok){
      const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
      const friendly=/invalid_credit_account/i.test(raw)?'Thẻ tín dụng không hợp lệ.'
        :/invalid_payment_account/i.test(raw)?'Tài khoản trừ tiền không hợp lệ hoặc khác tiền tệ.'
        :/invalid_closing_day/i.test(raw)?'Ngày chốt phải từ 1 đến 31.'
        :/invalid_payment_day/i.test(raw)?'Ngày thanh toán phải từ 1 đến 31.'
        :/card_cycle_required/i.test(raw)?'Hãy thiết lập chu kỳ cho thẻ trước.'
        :/invalid_installment_count/i.test(raw)?'Số kỳ trả góp phải từ 2 đến 60.'
        :/installment_name_required/i.test(raw)?'Hãy nhập tên khoản trả góp.'
        :/invalid_category|fee_category_required/i.test(raw)?'Hãy chọn danh mục chi phí hợp lệ.'
        :/statement_already_paid/i.test(raw)?'Kỳ thẻ này đã được xác nhận thanh toán.'
        :/payment_below_fee/i.test(raw)?'Tổng thanh toán phải lớn hơn phần phí trả góp.'
        :/amount_must_be_positive/i.test(raw)?'Số tiền phải lớn hơn 0.'
        :/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.':raw;
      throw new Error(friendly);
    }
    return data;
  }

  async function loadCardData(rerender=false){
    if(!state.key)return;
    const [s,o,i]=await Promise.all([cardApi('get'),cardApi('overview'),cardApi('list_installments')]);
    state.cardSettings=s?.items||[];state.cardOverview=o?.items||[];state.cardInstallments=i?.items||[];
    if(rerender&&state.household)render();
  }
  V.cardApi=cardApi;V.loadCardData=loadCardData;

  const prevRefresh=window.refresh;
  if(typeof prevRefresh==='function')window.refresh=async function(...args){await prevRefresh(...args);await loadCardData(false);if(state.household)render()};
  let bootTry=0;const boot=setInterval(async()=>{bootTry++;if(state.key&&state.household){try{await loadCardData(false);render();clearInterval(boot)}catch(e){console.error('Credit card load failed',e)}}if(bootTry>40)clearInterval(boot)},250);

  function dayLabel(d){return Number(d)===31?'cuối tháng':`ngày ${Number(d)}`}
  function offsetLabel(n){return Number(n)===2?'sau 2 tháng':'tháng sau'}
  function dateTone(d){if(!d)return '';const today=localToday();return String(d).slice(0,10)<today?'overdue':''}
  function paymentSources(card){return activeAccounts().filter(a=>a.id!==card.id&&(a.currency||state.base)===(card.currency||state.base)&&['bank','cash','savings'].includes(a.account_type))}
  function feeCategoryId(){const cats=activeCategories('expense');return cats.find(c=>/phí|lãi|fee|interest/i.test(c.name))?.id||cats.find(c=>c.cost_type==='variable')?.id||cats[0]?.id||''}

  function safeSpendWithCards(){
    const base=typeof V.safeSpendWithRecurring==='function'?V.safeSpendWithRecurring():typeof V.safeSpendData==='function'?V.safeSpendData():null;
    if(!base||base.available===null||!base.configured)return base;
    let cardReserve=0;
    cardAccounts().filter(a=>(a.currency||state.base)===state.base).forEach(a=>{
      const o=overviewFor(a.id),out=Math.max(0,-accountBalance(a));
      cardReserve+=o?.next_payment_month?Math.max(0,n(o.expected_amount)):out;
    });
    const protectedTotal=n(base.protectedTotal)+cardReserve;
    const afterProtection=Math.max(0,n(base.spendableBalance)-protectedTotal);
    return {...base,cardReserve,protectedTotal,available:Math.max(0,Math.min(afterProtection,n(base.variableRemaining)))};
  }
  V.safeSpendWithCards=safeSpendWithCards;
  function patchSafeSpend(html){
    const x=safeSpendWithCards();if(!x||x.available===null)return html;
    const cardText=x.cardReserve?` Đã giữ ${money(x.cardReserve,state.base)} cho kỳ thẻ sắp tới.`:'';
    return html.replace(/(<span class="v7-kicker">CÓ THỂ TIÊU AN TOÀN<\/span>\s*<strong>)[\s\S]*?(<\/strong>\s*<p>)[\s\S]*?(<\/p>)/,`$1${money(x.available,state.base)}$2Sau khi giữ lại ${money(x.protectedTotal,state.base)} cho nghĩa vụ, mục tiêu và dự phòng.${cardText}$3`);
  }

  function dueCards(){return (state.cardOverview||[]).filter(x=>x.next_payment_month&&n(x.expected_amount)>0)}
  function cardDueStrip(){
    const rows=dueCards();if(!rows.length)return '';
    const overdue=rows.filter(x=>dateTone(x.next_payment_date)==='overdue');
    return `<section class="cc-strip ${overdue.length?'overdue':''}"><div><span>THẺ TÍN DỤNG</span><strong>${rows.length} thẻ có kỳ thanh toán</strong><small>${overdue.length?`${overdue.length} kỳ đã quá hạn`:'Chi trước · trả sau · không tính chi hai lần'}</small></div><div>${rows.slice(0,3).map(x=>`<button data-cc-action="pay" data-cc-id="${x.account_id}">${esc(x.card_name)} · ${money(x.expected_amount,x.currency)}</button>`).join('')}</div></section>`;
  }

  function cardCycleCard(card){
    const s=settingFor(card.id),o=overviewFor(card.id),debt=Math.max(0,-accountBalance(card));
    if(!s)return `<article class="cc-card unconfigured"><div class="cc-card-top"><span>THẺ TÍN DỤNG · ${esc(card.currency||state.base)}</span><button data-cc-action="settings" data-cc-id="${card.id}">Thiết lập</button></div><h3>${esc(card.name)}</h3><strong>${money(debt,card.currency)}</strong><p>Chưa có ngày chốt/ngày trừ tiền. Thiết lập để app tự xếp giao dịch vào đúng kỳ.</p></article>`;
    const expected=n(o?.expected_amount),tone=dateTone(o?.next_payment_date);
    return `<article class="cc-card ${tone}"><div class="cc-card-top"><span>${esc(dayLabel(s.closing_day))} chốt · ${esc(dayLabel(s.payment_day))} trả ${esc(offsetLabel(s.payment_month_offset))}</span><button data-cc-action="settings" data-cc-id="${card.id}">•••</button></div><h3>${esc(card.name)}</h3><div class="cc-debt"><span>Dư nợ hiện có</span><strong>${money(debt,card.currency)}</strong></div>${o?.next_payment_month?`<div class="cc-next"><div><span>Kỳ gần nhất</span><b>${money(expected,card.currency)}</b><small>${esc(String(o.next_payment_date||'').slice(0,10))} · ${esc(s.payment_account_name||'chưa chọn tài khoản trừ')}</small></div><div class="cc-break"><span>Chi thường <b>${money(o.regular_amount,card.currency)}</b></span><span>Gốc trả góp <b>${money(o.installment_principal,card.currency)}</b></span><span>Phí trả góp <b>${money(o.installment_fee,card.currency)}</b></span></div></div><button class="cc-pay" data-cc-action="pay" data-cc-id="${card.id}">Thanh toán kỳ này</button>`:`<div class="cc-empty-next">Chưa có kỳ thanh toán đang chờ.</div>${debt?`<button class="cc-pay secondary" data-cc-action="simple-pay" data-cc-id="${card.id}">Thanh toán sớm</button>`:''}`}</article>`;
  }

  function installmentCard(x){
    const paid=Number(x.paid_installments||0),total=Number(x.total_installments||0),done=paid>=total,pct=total?Math.min(100,paid/total*100):0,nextNo=Math.min(total,paid+1);
    return `<article class="cc-install ${done?'done':''}"><div class="cc-install-top"><div><span>${esc(x.card_name)} · ${esc(x.currency)}</span><h3>${esc(x.name)}</h3></div><b>${done?'Hoàn tất':`Kỳ ${nextNo}/${total}`}</b></div><div class="cc-progress"><i style="width:${pct}%"></i></div><div class="cc-install-stats"><div><span>Giá mua</span><b>${money(x.principal_amount,x.currency)}</b></div><div><span>Phí tổng</span><b>${money(x.fee_total,x.currency)}</b></div><div><span>Còn theo lịch</span><b>${money(x.remaining_scheduled,x.currency)}</b></div></div>${!done&&x.next_payment_month?`<div class="cc-install-next"><span>Kỳ tới ${String(x.next_payment_month).slice(0,7)}</span><strong>${money(n(x.next_principal)+n(x.next_fee),x.currency)}</strong><small>Gốc ${money(x.next_principal,x.currency)}${n(x.next_fee)?` · phí ${money(x.next_fee,x.currency)}`:''}</small></div>`:''}</article>`;
  }

  function creditSections(){
    const cards=cardAccounts(),inst=state.cardInstallments||[];
    if(!cards.length)return `<section class="cc-section"><div class="cc-head"><div><span>THẺ & TRẢ GÓP</span><h2>Chưa có thẻ tín dụng</h2><p>Tạo tài khoản loại “Thẻ tín dụng” để quản lý chu kỳ chốt và trả sau.</p></div><button data-cc-action="new-card">＋ Thêm thẻ</button></div></section>`;
    return `<section class="cc-section"><div class="cc-head"><div><span>CHI TRƯỚC · TRẢ SAU</span><h2>Chu kỳ thẻ tín dụng</h2><p>Mỗi thẻ có ngày chốt, ngày trừ và tài khoản thanh toán riêng.</p></div><button data-cc-action="new-installment">＋ Trả góp</button></div><div class="cc-grid">${cards.map(cardCycleCard).join('')}</div></section><section class="cc-section"><div class="cc-head"><div><span>TRẢ GÓP RIÊNG</span><h2>Các khoản đang trả góp</h2><p>Giá mua được ghi chi một lần ở ngày mua; các kỳ sau chỉ trả nghĩa vụ. Phí mới là chi phí phát sinh thêm.</p></div><button data-cc-action="new-installment">＋ Khoản trả góp</button></div><div class="cc-install-grid">${inst.length?inst.map(installmentCard).join(''):'<div class="cc-empty">Chưa có khoản trả góp nào.</div>'}</div></section>`;
  }

  const accountsBefore=V.accountsV3;
  if(typeof accountsBefore==='function')V.accountsV3=()=>accountsBefore()+creditSections();
  const dashboardBefore=V.dashboardV3;
  if(typeof dashboardBefore==='function')V.dashboardV3=()=>{let html=patchSafeSpend(dashboardBefore()),strip=cardDueStrip();if(strip)html=html.replace(/(<section class="v7-focus[\s\S]*?<\/section>)/,`$1${strip}`);return html};

  function openCardSettings(id){
    const card=cardAccounts().find(x=>x.id===id);if(!card)return toast('Không tìm thấy thẻ.',true);const s=settingFor(id)||{},sources=paymentSources(card),selected=s.payment_account_id&&sources.some(x=>x.id===s.payment_account_id)?s.payment_account_id:(sources[0]?.id||'');
    modal(`Chu kỳ · ${esc(card.name)}`,`<div class="cc-form-note">Mỗi thẻ thiết lập riêng. Ngày 31 được hiểu là <b>ngày cuối tháng</b>.</div><div class="cc-cycle-form"><div class="field"><label>Ngày chốt</label><input id="ccClose" name="closing_day" type="number" min="1" max="31" value="${esc(s.closing_day||10)}" required><div class="cc-chips">${[5,10,15,20,25,31].map(d=>`<button type="button" data-cc-day-target="ccClose" data-cc-day="${d}">${d===31?'Cuối tháng':d}</button>`).join('')}</div></div><div class="field"><label>Ngày trừ tiền</label><input id="ccPay" name="payment_day" type="number" min="1" max="31" value="${esc(s.payment_day||27)}" required><div class="cc-chips">${[5,10,15,20,25,27,31].map(d=>`<button type="button" data-cc-day-target="ccPay" data-cc-day="${d}">${d===31?'Cuối tháng':d}</button>`).join('')}</div></div><div class="field"><label>Thanh toán</label><select name="payment_month_offset"><option value="1" ${Number(s.payment_month_offset||1)===1?'selected':''}>Tháng sau</option><option value="2" ${Number(s.payment_month_offset||1)===2?'selected':''}>Sau 2 tháng</option></select></div><div class="field"><label>Trừ từ tài khoản</label><select name="payment_account_id"><option value="">— Chọn khi thanh toán —</option>${options(sources,selected,a=>`${a.name} · ${a.currency}`)}</select></div></div>`,async fd=>{await cardApi('save',{...fd,account_id:id});await refresh()},'Lưu chu kỳ');
    document.querySelectorAll('#modalBody [data-cc-day]').forEach(b=>b.addEventListener('click',()=>{const x=document.getElementById(b.dataset.ccDayTarget);if(x)x.value=b.dataset.ccDay}));
  }

  function openInstallment(){
    const cards=configuredCards();if(!cards.length)return toast('Hãy thiết lập chu kỳ cho ít nhất một thẻ trước.',true);const cats=activeCategories('expense');if(!cats.length)return toast('Hãy tạo danh mục chi trước.',true);
    modal('Thêm khoản trả góp',`<div class="cc-form-note"><b>Nguyên tắc:</b> toàn bộ giá mua được ghi chi tại ngày mua. Mỗi tháng chỉ thanh toán nghĩa vụ; phí trả góp mới được ghi thêm là chi phí.</div><div class="cc-install-form"><div class="field full"><label>Tên khoản</label><input name="name" placeholder="VD: iPhone / Máy giặt / Vé máy bay" required autofocus></div><div class="field"><label>Thẻ</label><select name="card_account_id" required>${options(cards,cards[0].id,a=>`${a.name} · ${a.currency}`)}</select></div><div class="field"><label>Giá mua</label><input name="principal_amount" type="number" min="1" step="1" required></div><div class="field"><label>Số kỳ</label><input id="ccTerms" name="total_installments" type="number" min="2" max="60" value="12" required><div class="cc-chips">${[3,6,10,12,24,36].map(k=>`<button type="button" data-cc-terms="${k}">${k} kỳ</button>`).join('')}</div></div><div class="field"><label>Phí/lãi tổng</label><input name="fee_total" type="number" min="0" step="1" value="0"><small>0 nếu trả góp 0%.</small></div><div class="field"><label>Ngày mua</label><input name="purchase_date" type="date" value="${localToday()}" required></div><div class="field"><label>Danh mục chi</label><select name="category_id" required>${options(cats,cats[0].id,c=>c.name)}</select></div><div class="field full"><label>Ghi chú</label><input name="note" placeholder="Tùy chọn"></div></div>`,async fd=>{await cardApi('create_installment',fd);await refresh()},'Tạo trả góp');
    document.querySelectorAll('#modalBody [data-cc-terms]').forEach(b=>b.addEventListener('click',()=>{const x=$('#ccTerms');if(x)x.value=b.dataset.ccTerms}));
  }

  function openStatementPayment(id){
    const card=cardAccounts().find(x=>x.id===id),o=overviewFor(id),s=settingFor(id);if(!card)return toast('Không tìm thấy thẻ.',true);if(!s)return openCardSettings(id);if(!o?.next_payment_month||n(o.expected_amount)<=0)return legacyCreditPayment(id);
    const sources=paymentSources(card);if(!sources.length)return toast(`Cần tài khoản ${card.currency} để thanh toán thẻ.`,true);const selected=s.payment_account_id&&sources.some(x=>x.id===s.payment_account_id)?s.payment_account_id:sources[0].id,cats=activeCategories('expense'),feeCat=feeCategoryId();
    modal(`Thanh toán · ${esc(card.name)}`,`<div class="cc-statement"><div><span>Kỳ thanh toán</span><strong>${money(o.expected_amount,card.currency)}</strong><small>Hạn dự kiến ${esc(String(o.next_payment_date||'').slice(0,10))}</small></div><div class="cc-statement-break"><span>Chi thường <b>${money(o.regular_amount,card.currency)}</b></span><span>Gốc trả góp <b>${money(o.installment_principal,card.currency)}</b></span><span>Phí trả góp <b>${money(o.installment_fee,card.currency)}</b></span></div></div><div class="field"><label>Số tiền thực tế ngân hàng bị trừ</label><input name="amount" type="number" min="1" step="1" value="${esc(o.expected_amount)}" required autofocus></div><details class="cc-details" ${n(o.installment_fee)?'open':''}><summary>Chi tiết thanh toán</summary><div class="form-grid"><div class="field"><label>Trừ từ</label><select name="payment_account_id" required>${options(sources,selected,a=>`${a.name} · ${a.currency}`)}</select></div><div class="field"><label>Ngày thực trả</label><input name="transaction_date" type="date" value="${localToday()}" required></div>${n(o.installment_fee)?`<div class="field full"><label>Danh mục cho phí trả góp ${money(o.installment_fee,card.currency)}</label><select name="fee_category_id" required>${options(cats,feeCat,c=>c.name)}</select></div>`:'<input type="hidden" name="fee_category_id" value="">'}<div class="field full"><label>Ghi chú</label><input name="note" value="Thanh toán ${esc(card.name)}"></div></div></details><div class="cc-accounting-note">Khoản chuyển trả gốc/chi thẻ <b>không tính chi lần hai</b>. Chỉ phí trả góp được ghi thêm vào chi phí.</div>`,async fd=>{await cardApi('pay_statement',{...fd,account_id:id,payment_month:String(o.next_payment_month).slice(0,10)});await refresh()},'Xác nhận thanh toán');
  }

  const legacyCreditPayment=window.openCreditPayment;
  function creditPaymentSmart(id){const s=settingFor(id),o=overviewFor(id);if(s&&o?.next_payment_month&&n(o.expected_amount)>0)return openStatementPayment(id);return typeof legacyCreditPayment==='function'?legacyCreditPayment(id):toast('Không thể mở thanh toán.',true)}
  window.openCreditPayment=creditPaymentSmart;

  document.addEventListener('click',e=>{
    const b=e.target.closest?.('[data-cc-action]');if(!b)return;const a=b.dataset.ccAction,id=b.dataset.ccId||'';
    if(a==='settings')return openCardSettings(id);
    if(a==='pay')return openStatementPayment(id);
    if(a==='simple-pay')return typeof legacyCreditPayment==='function'?legacyCreditPayment(id):null;
    if(a==='new-installment')return openInstallment();
    if(a==='new-card')return openAccount();
  });

  Object.assign(window,{openCardSettings,openInstallment,openStatementPayment});
})();