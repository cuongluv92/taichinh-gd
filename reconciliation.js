(() => {
  const V=window.__V3;
  if(!V) return;
  const RPC_URL=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_reconciliation_api`;
  state.reconciliations=state.reconciliations||[];

  async function reconciliationApi(action,payload={}){
    if(!state.key) throw new Error('Thiếu khóa gia đình');
    const res=await fetch(RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({p_key:state.key,p_action:action,p_payload:payload})});
    const text=await res.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok){
      const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
      const friendly=/account_not_found/i.test(raw)?'Không tìm thấy tài khoản.'
        :/actual_balance_required/i.test(raw)?'Hãy nhập số dư thực tế.'
        :/future_reconciliation_date/i.test(raw)?'Ngày đối soát không được ở tương lai.'
        :/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.':raw;
      throw new Error(friendly);
    }
    return data;
  }

  async function loadReconciliations(rerender=false){
    if(!state.key)return [];
    const d=await reconciliationApi('list');
    state.reconciliations=d?.items||[];
    if(rerender&&state.household)render();
    return state.reconciliations;
  }
  V.reconciliationApi=reconciliationApi;V.loadReconciliations=loadReconciliations;

  const prevRefresh=window.refresh;
  if(typeof prevRefresh==='function')window.refresh=async function(...args){await prevRefresh(...args);await loadReconciliations(false);if(state.household)render()};
  let tries=0;const timer=setInterval(async()=>{tries++;if(state.key&&state.household){try{await loadReconciliations(false);render();clearInterval(timer)}catch(e){console.error('Reconciliation load failed',e)}}if(tries>40)clearInterval(timer)},250);

  const latestFor=id=>(state.reconciliations||[]).find(x=>x.account_id===id);
  const hasTxAfter=(id,date)=>(state.fullTransactions||[]).some(t=>(t.account_id===id||t.transfer_account_id===id)&&String(t.transaction_date||'')>String(date||''));
  function calculatedAt(a,date){
    const created=String(a.created_at||'').slice(0,10);if(created&&date<created)return 0;
    let bal=n(a.opening_balance);
    (state.fullTransactions||[]).forEach(t=>{if(String(t.transaction_date||'')<=date)bal+=V.txDeltaForAccount(t,a.id)});
    return bal;
  }
  function recState(a){
    const r=latestFor(a.id);if(!r)return {kind:'none',label:'Chưa đối soát'};
    const diff=n(r.difference),stale=hasTxAfter(a.id,r.reconciled_on);
    if(Math.abs(diff)>=0.5)return {kind:'bad',label:`Lệch ${money(Math.abs(diff),a.currency)}`,diff,r};
    if(stale)return {kind:'stale',label:'Có giao dịch mới',r};
    return {kind:'good',label:'Khớp',r};
  }
  function summary(){
    const rows=activeAccounts().map(a=>recState(a));
    return {total:rows.length,good:rows.filter(x=>x.kind==='good').length,bad:rows.filter(x=>x.kind==='bad').length,stale:rows.filter(x=>x.kind==='stale').length,none:rows.filter(x=>x.kind==='none').length};
  }

  function reconcilePanel(){
    const ac=activeAccounts(),s=summary();
    const row=a=>{const st=recState(a),r=st.r,calc=accountBalance(a);return `<div class="recon-row ${st.kind}"><div class="recon-main"><div><b>${esc(a.name)}</b><span>${esc(a.currency||state.base)} · ${a.account_type==='credit'?'Thẻ tín dụng':'Tài khoản'}</span></div><strong class="${calc<0?'red':''}">${a.account_type==='credit'?`Dư nợ ${money(Math.max(0,-calc),a.currency)}`:money(calc,a.currency)}</strong></div><div class="recon-last">${r?`<span>Lần gần nhất ${esc(String(r.reconciled_on).slice(0,10))}</span><small>App ${money(r.calculated_balance,a.currency)} · Thực tế ${a.account_type==='credit'?money(Math.abs(n(r.actual_balance)),a.currency):money(r.actual_balance,a.currency)}</small>`:'<span>Chưa có lần kiểm tra nào</span><small>Nhập số dư đang thấy ở ngân hàng/thẻ</small>'}</div><div class="recon-status ${st.kind}">${esc(st.label)}</div><div class="recon-actions"><button data-recon-action="open" data-recon-id="${a.id}">Đối soát</button>${r?`<button data-recon-action="history" data-recon-id="${a.id}">Lịch sử</button>`:''}</div></div>`};
    return `<section class="recon-section"><div class="recon-head"><div><span>KIỂM TRA SỐ DƯ</span><h2>Đối soát tài khoản</h2><p>So số app tính với số thực tế. Không tự tạo giao dịch bù.</p></div><button class="primary" data-recon-action="open">＋ Đối soát</button></div><div class="recon-summary"><div><span>Khớp</span><strong>${s.good}</strong></div><div><span>Cần kiểm tra</span><strong class="${s.bad||s.stale?'red':''}">${s.bad+s.stale}</strong></div><div><span>Chưa đối soát</span><strong>${s.none}</strong></div></div><div class="recon-list">${ac.length?ac.map(row).join(''):'<div class="recon-empty">Chưa có tài khoản để đối soát.</div>'}</div></section>`;
  }

  const accountsBefore=V.accountsV3;
  if(typeof accountsBefore==='function')V.accountsV3=()=>accountsBefore()+reconcilePanel();
  const dashboardBefore=V.dashboardV3;
  if(typeof dashboardBefore==='function')V.dashboardV3=()=>{let html=dashboardBefore(),s=summary();if(!(s.bad||s.stale))return html;const alert=`<section class="recon-alert"><div><span>ĐỐI SOÁT</span><strong>${s.bad?`${s.bad} tài khoản đang lệch`:''}${s.bad&&s.stale?' · ':''}${s.stale?`${s.stale} tài khoản có giao dịch mới`:''}</strong><small>“Có thể tiêu an toàn” vẫn dùng sổ giao dịch; hãy xử lý chênh lệch để số liệu đáng tin cậy.</small></div><button data-view="accounts">Kiểm tra →</button></section>`;return html.replace(/(<section class="v7-focus[\s\S]*?<\/section>)/,`$1${alert}`)};

  const diagBefore=V.diagnostics;
  if(typeof diagBefore==='function')V.diagnostics=()=>{const d=diagBefore();activeAccounts().forEach(a=>{const st=recState(a);if(st.kind==='bad')d.issues.push(`${a.name}: đối soát lệch ${money(Math.abs(st.diff),a.currency)}.`);else if(st.kind==='stale')d.notes.push(`${a.name}: đã có giao dịch mới sau lần đối soát gần nhất.`)});return d};

  function openReconcile(id=''){
    const accounts=activeAccounts();if(!accounts.length)return toast('Chưa có tài khoản.',true);
    const selected=accounts.find(a=>a.id===id)||accounts[0],today=V.localToday?.()||window.today(),r=latestFor(selected.id);
    modal('Đối soát số dư',`<div class="recon-form-note">Nhập đúng con số bạn đang thấy ngoài đời. <b>App chỉ so sánh, không tự sửa sổ giao dịch.</b></div><div class="form-grid"><div class="field full"><label>Tài khoản</label><select id="reconAccount" name="account_id" required>${options(accounts,selected.id,a=>`${a.name} · ${a.currency}`)}</select></div><div class="field"><label>Ngày đối soát</label><input id="reconDate" name="reconciled_on" type="date" max="${today}" value="${today}" required></div><div class="field"><label id="reconActualLabel">${selected.account_type==='credit'?'Dư nợ thực tế':'Số dư thực tế'}</label><input id="reconActual" name="actual_input" type="number" step="1" ${selected.account_type==='credit'?'min="0"':''} placeholder="0" required autofocus></div><div class="field full"><div class="recon-preview"><div><span>App tính</span><strong id="reconCalc">—</strong></div><div><span>Chênh lệch</span><strong id="reconDiff">—</strong></div></div></div><div class="field full"><label>Ghi chú</label><input name="note" value="${esc(r?.note||'')}" placeholder="VD: đối chiếu app ngân hàng"></div></div>`,async fd=>{const a=accounts.find(x=>x.id===fd.account_id);if(!a)throw new Error('Hãy chọn tài khoản.');const raw=Number(fd.actual_input);if(!Number.isFinite(raw))throw new Error('Hãy nhập số dư thực tế.');const signed=a.account_type==='credit'?-Math.abs(raw):raw;const out=await reconciliationApi('save',{account_id:a.id,reconciled_on:fd.reconciled_on,actual_balance:signed,note:fd.note||''});await refresh();const diff=n(out?.difference);toast(Math.abs(diff)<0.5?'Đối soát khớp ✓':`Đang lệch ${money(Math.abs(diff),a.currency)}`,Math.abs(diff)>=0.5)},'Lưu đối soát');
    const acc=$('#reconAccount'),date=$('#reconDate'),actual=$('#reconActual'),lab=$('#reconActualLabel'),calc=$('#reconCalc'),diff=$('#reconDiff');
    const sync=()=>{const a=accounts.find(x=>x.id===acc.value)||accounts[0],d=date.value||today,c=calculatedAt(a,d),raw=Number(actual.value),signed=a.account_type==='credit'?-Math.abs(raw||0):(raw||0);lab.textContent=a.account_type==='credit'?'Dư nợ thực tế':'Số dư thực tế';actual.min=a.account_type==='credit'?'0':'';calc.textContent=a.account_type==='credit'?`Dư nợ ${money(Math.max(0,-c),a.currency)}`:money(c,a.currency);if(actual.value===''){diff.textContent='—';diff.className='';return}const delta=signed-c;diff.textContent=Math.abs(delta)<.5?'Khớp':`${delta>0?'+':'−'}${money(Math.abs(delta),a.currency)}`;diff.className=Math.abs(delta)<.5?'green':'red'};
    acc.onchange=sync;date.onchange=sync;actual.oninput=sync;sync();
  }

  async function showReconcileHistory(id){
    const a=activeAccounts().find(x=>x.id===id);if(!a)return toast('Không tìm thấy tài khoản.',true);
    try{const d=await reconciliationApi('history',{account_id:id}),rows=d?.items||[],dlg=$('#modal'),mb=$('#modalBody'),form=$('#modalForm');mb.innerHTML=`<div class="modal-head"><div><span class="v7-modal-kicker">LỊCH SỬ ĐỐI SOÁT</span><h3>${esc(a.name)}</h3></div><button class="mini-btn" type="button" data-recon-action="close">✕</button></div><div class="modal-content"><div class="recon-history">${rows.length?rows.map(r=>`<div class="recon-history-row"><div><b>${esc(String(r.reconciled_on).slice(0,10))}</b><span>App ${money(r.calculated_balance,a.currency)} · Thực tế ${a.account_type==='credit'?money(Math.abs(n(r.actual_balance)),a.currency):money(r.actual_balance,a.currency)}</span></div><strong class="${Math.abs(n(r.difference))<.5?'green':'red'}">${Math.abs(n(r.difference))<.5?'Khớp':`${n(r.difference)>0?'+':'−'}${money(Math.abs(n(r.difference)),a.currency)}`}</strong></div>`).join(''):'<div class="recon-empty">Chưa có lịch sử.</div>'}</div></div><div class="modal-actions"><button class="btn primary" type="button" data-recon-action="close">Đóng</button></div>`;form.onsubmit=e=>e.preventDefault();if(!dlg.open)dlg.showModal()}catch(e){toast(e.message,true)}
  }

  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-recon-action]');if(!b)return;const a=b.dataset.reconAction,id=b.dataset.reconId||'';if(a==='open')return openReconcile(id);if(a==='history')return showReconcileHistory(id);if(a==='close')return $('#modal')?.close()});
  Object.assign(window,{openReconcile,showReconcileHistory});
})();
