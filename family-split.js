(() => {
  const V=window.__V3;
  if(!V) return;
  const RPC_URL=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_family_split_api`;
  state.familySplit=state.familySplit||{settings:{enabled:false,person_a_name:'Tôi',person_b_name:'Người kia'},items:[]};

  async function familySplitApi(action,payload={}){
    if(!state.key) throw new Error('Thiếu khóa gia đình');
    const res=await fetch(RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({p_key:state.key,p_action:action,p_payload:payload})});
    const text=await res.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok){const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`),friendly=/member_names_must_differ/i.test(raw)?'Tên hai người phải khác nhau.':/invalid_split_pct/i.test(raw)?'Tỷ lệ phải từ 0 đến 100%.':/expense_transaction_not_found/i.test(raw)?'Không tìm thấy giao dịch chi.':/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.':raw;throw new Error(friendly)}
    return data;
  }
  async function loadFamilySplit(rerender=false){if(!state.key)return;const d=await familySplitApi('get');state.familySplit={settings:{enabled:false,person_a_name:'Tôi',person_b_name:'Người kia',...(d?.settings||{})},items:d?.items||[]};if(rerender&&state.household)render()}
  V.familySplitApi=familySplitApi;V.loadFamilySplit=loadFamilySplit;

  const metaMap=()=>new Map((state.familySplit?.items||[]).map(x=>[x.id,x]));
  const metaFor=id=>metaMap().get(id)||{id,expense_scope:'family',paid_by:'joint',split_a_pct:50};
  const names=()=>({a:state.familySplit?.settings?.person_a_name||'Tôi',b:state.familySplit?.settings?.person_b_name||'Người kia'});
  function settlement(month=state.month){
    const map=new Map(),metas=metaMap();
    (state.fullTransactions||[]).filter(t=>t.transaction_type==='expense'&&V.monthKey(t.transaction_date)===month).forEach(t=>{const m=metas.get(t.id)||{expense_scope:'family',paid_by:'joint',split_a_pct:50};if(m.paid_by==='joint')return;const amt=n(t.amount),cur=t.currency||state.base,split=Math.min(100,Math.max(0,n(m.split_a_pct))),respA=m.expense_scope==='person_a'?amt:m.expense_scope==='person_b'?0:amt*split/100,paidA=m.paid_by==='person_a'?amt:0,credit=paidA-respA;map.set(cur,(map.get(cur)||0)+credit)});
    return map;
  }
  function settlementText(){
    const {a,b}=names(),parts=[];settlement().forEach((credit,cur)=>{if(Math.abs(credit)<0.5)return;parts.push(credit>0?`${b} → ${a} ${money(Math.abs(credit),cur)}`:`${a} → ${b} ${money(Math.abs(credit),cur)}`)});return parts.join(' · ')||'Không có khoản cần hoàn lại';
  }
  function scopeLabel(m){const {a,b}=names();return m.expense_scope==='person_a'?`Cá nhân · ${a}`:m.expense_scope==='person_b'?`Cá nhân · ${b}`:`Gia đình · ${n(m.split_a_pct).toFixed(0)}/${(100-n(m.split_a_pct)).toFixed(0)}`}
  function payerLabel(m){const {a,b}=names();return m.paid_by==='person_a'?`${a} đã trả`:m.paid_by==='person_b'?`${b} đã trả`:'Tiền chung'}

  function settingsCard(){
    const s=state.familySplit?.settings||{},a=esc(s.person_a_name||'Tôi'),b=esc(s.person_b_name||'Người kia');
    return `<section class="fsp-settings" id="fspSettings"><div class="fsp-head"><div><span>GIA ĐÌNH / CÁ NHÂN</span><h2>Phân chia ai đã trả</h2><p>Tùy chọn. Tắt đi thì app vẫn hoạt động như sổ tài chính gia đình bình thường.</p></div></div><form id="fspSettingsForm"><label class="fsp-toggle"><input type="checkbox" name="enabled" ${s.enabled?'checked':''}><span>Bật phân chia cá nhân</span></label><label><span>Người A</span><input name="person_a_name" value="${a}" required></label><label><span>Người B</span><input name="person_b_name" value="${b}" required></label><button class="primary" type="submit">Lưu</button></form><small>Giao dịch cũ mặc định là Gia đình + tiền chung nên không phát sinh khoản hoàn lại giả.</small></section>`;
  }
  function txStrip(){if(!state.familySplit?.settings?.enabled)return '';const {a,b}=names();return `<section class="fsp-strip"><div><span>GIA ĐÌNH & CÁ NHÂN · ${state.month.replace('-','/')}</span><strong>${esc(settlementText())}</strong><small>Chỉ giao dịch do ${esc(a)} hoặc ${esc(b)} ứng tiền mới tạo chênh lệch. Tiền chung không cần hoàn lại.</small></div><button data-fsp-action="manage">Phân loại</button></section>`}

  function decorate(){
    const content=$('#content');if(!content)return;
    if(state.view==='settings'&&!$('#fspSettings')){content.insertAdjacentHTML('beforeend',settingsCard());const form=$('#fspSettingsForm');form?.addEventListener('submit',async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(form).entries()),enabled=!!form.querySelector('[name="enabled"]')?.checked;try{await familySplitApi('save_settings',{enabled,person_a_name:fd.person_a_name,person_b_name:fd.person_b_name});await loadFamilySplit(false);render();toast('Đã lưu phân chia gia đình')}catch(err){toast(err.message,true)}})}
    if(state.view==='transactions'&&state.familySplit?.settings?.enabled&&!$('#fspStrip')){content.insertAdjacentHTML('afterbegin',txStrip().replace('class="fsp-strip"','class="fsp-strip" id="fspStrip"'))}
  }

  function openManager(){
    const metas=metaMap(),rows=(state.fullTransactions||[]).filter(t=>t.transaction_type==='expense'&&V.monthKey(t.transaction_date)===state.month).sort((a,b)=>String(b.transaction_date||'').localeCompare(String(a.transaction_date||''))),dlg=$('#modal'),mb=$('#modalBody'),form=$('#modalForm');
    mb.innerHTML=`<div class="modal-head"><div><span class="v7-modal-kicker">PHÂN CHIA CHI TIÊU</span><h3>${state.month.replace('-','/')}</h3></div><button class="mini-btn" type="button" data-fsp-action="close">✕</button></div><div class="modal-content"><div class="fsp-settlement"><span>Đối chiếu hiện tại</span><strong>${esc(settlementText())}</strong></div><div class="fsp-list">${rows.length?rows.map(t=>{const m=metas.get(t.id)||{expense_scope:'family',paid_by:'joint',split_a_pct:50};return `<button type="button" data-fsp-action="edit" data-fsp-id="${t.id}"><div><b>${esc(t.category_name||'Chi tiêu')}</b><span>${esc(String(t.transaction_date||''))} · ${esc(t.note||'')}</span><small>${esc(scopeLabel(m))} · ${esc(payerLabel(m))}</small></div><strong>${money(t.amount,t.currency)}</strong><i>›</i></button>`}).join(''):'<div class="fsp-empty">Chưa có giao dịch chi trong tháng.</div>'}</div></div><div class="modal-actions"><button class="btn primary" type="button" data-fsp-action="close">Đóng</button></div>`;form.onsubmit=e=>e.preventDefault();if(!dlg.open)dlg.showModal();
  }
  function openEdit(id){
    const t=(state.fullTransactions||[]).find(x=>x.id===id);if(!t)return toast('Không tìm thấy giao dịch.',true);const m=metaFor(id),nm=names();
    modal('Phân loại giao dịch',`<div class="fsp-edit-summary"><span>${esc(t.category_name||'Chi tiêu')} · ${esc(String(t.transaction_date||''))}</span><strong>${money(t.amount,t.currency)}</strong></div><div class="form-grid"><div class="field"><label>Thuộc về</label><select id="fspScope" name="expense_scope"><option value="family" ${m.expense_scope==='family'?'selected':''}>Gia đình</option><option value="person_a" ${m.expense_scope==='person_a'?'selected':''}>Cá nhân · ${esc(nm.a)}</option><option value="person_b" ${m.expense_scope==='person_b'?'selected':''}>Cá nhân · ${esc(nm.b)}</option></select></div><div class="field"><label>Ai đã trả</label><select name="paid_by"><option value="joint" ${m.paid_by==='joint'?'selected':''}>Tiền chung</option><option value="person_a" ${m.paid_by==='person_a'?'selected':''}>${esc(nm.a)}</option><option value="person_b" ${m.paid_by==='person_b'?'selected':''}>${esc(nm.b)}</option></select></div><div class="field full" id="fspSplitField"><label>Tỷ lệ gia đình · ${esc(nm.a)} %</label><input id="fspSplit" name="split_a_pct" type="number" min="0" max="100" step="1" value="${esc(m.split_a_pct??50)}"><div class="fsp-chips">${[[50,'50 / 50'],[60,'60 / 40'],[70,'70 / 30'],[100,`${esc(nm.a)} 100%`],[0,`${esc(nm.b)} 100%`]].map(([v,l])=>`<button type="button" data-fsp-split="${v}">${l}</button>`).join('')}</div></div></div>`,async fd=>{await familySplitApi('set_transaction',{id,expense_scope:fd.expense_scope,paid_by:fd.paid_by,split_a_pct:fd.expense_scope==='family'?fd.split_a_pct:fd.expense_scope==='person_a'?100:0});await loadFamilySplit(false);render();toast('Đã cập nhật phân chia')},'Lưu');
    const scope=$('#fspScope'),field=$('#fspSplitField');const sync=()=>field?.classList.toggle('hidden',scope?.value!=='family');scope?.addEventListener('change',sync);document.querySelectorAll('#modalBody [data-fsp-split]').forEach(b=>b.addEventListener('click',()=>{const x=$('#fspSplit');if(x)x.value=b.dataset.fspSplit}));sync();
  }

  const renderBefore=window.render;if(typeof renderBefore==='function')window.render=function(...args){const out=renderBefore(...args);queueMicrotask(decorate);return out};
  const refreshBefore=window.refresh;if(typeof refreshBefore==='function')window.refresh=async function(...args){await refreshBefore(...args);await loadFamilySplit(false);if(state.household)render()};
  let tries=0;const timer=setInterval(async()=>{tries++;if(state.key&&state.household){try{await loadFamilySplit(false);render();clearInterval(timer)}catch(e){console.error('Family split load failed',e)}}if(tries>40)clearInterval(timer)},250);

  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-fsp-action]');if(!b)return;const a=b.dataset.fspAction;if(a==='manage')return openManager();if(a==='edit'){const id=b.dataset.fspId;$('#modal')?.close();return setTimeout(()=>openEdit(id),0)}if(a==='close')return $('#modal')?.close()});
  Object.assign(window,{familySplitApi,loadFamilySplit,openFamilySplitManager:openManager});
})();
