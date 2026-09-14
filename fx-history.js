(() => {
  const V=window.__V3;
  if(!V) return;
  const RPC_URL=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_fx_history_api`;
  state.fxHistory=state.fxHistory||[];

  async function fxHistoryApi(action,payload={}){
    if(!state.key) throw new Error('Thiếu khóa gia đình');
    const res=await fetch(RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({p_key:state.key,p_action:action,p_payload:payload})});
    const text=await res.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok){
      const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
      const friendly=/invalid_exchange_rate/i.test(raw)?'Tỷ giá phải lớn hơn 0.'
        :/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.':raw;
      throw new Error(friendly);
    }
    return data;
  }
  async function loadFxHistory(rerender=false){
    if(!state.key)return [];
    const d=await fxHistoryApi('list');state.fxHistory=d?.items||[];
    if(rerender&&state.household)render();
    return state.fxHistory;
  }
  V.fxHistoryApi=fxHistoryApi;V.loadFxHistory=loadFxHistory;

  const monthKey=d=>{const s=String(d||'');if(s.startsWith('9999-'))return (V.localToday?.()||today()).slice(0,7);return s.slice(0,7)||state.month};
  function explicitRate(month){const key=monthKey(month);return (state.fxHistory||[]).find(x=>String(x.month).slice(0,7)===key)||null}
  function rateRecord(month){
    const key=monthKey(month),rows=[...(state.fxHistory||[])].filter(x=>String(x.month).slice(0,7)<=key).sort((a,b)=>String(b.month).localeCompare(String(a.month)));
    const r=rows[0];if(r)return {rate:n(r.jpy_vnd_rate),sourceMonth:String(r.month).slice(0,7),inherited:String(r.month).slice(0,7)!==key};
    return {rate:null,sourceMonth:null,inherited:false};
  }
  function fxRateAt(date){const r=rateRecord(date);return r.rate>0?r.rate:null}
  function convert(amount,currency,date){
    if(currency==='VND')return n(amount);
    if(currency==='JPY'){const r=fxRateAt(date);return r?n(amount)*r:null}
    return null;
  }
  V.fxRateAt=fxRateAt;V.fxRate=()=>fxRateAt(state.month);
  V.toVND=(amount,currency,date=state.month)=>convert(amount,currency,date);
  V.positionVND=function(endDate='9999-12-31'){
    const valuationDate=endDate==='9999-12-31'?(V.localToday?.()||today()):endDate;
    let assets=0,liabilities=0,liquid=0,invested=0,unconverted=0;
    (state.accounts||[]).forEach(a=>{const raw=V.accountBalanceAt(a,endDate),v=convert(raw,a.currency||state.base,valuationDate);if(v===null){unconverted++;return}if(v>=0)assets+=v;else liabilities+=-v;if(['cash','bank','savings'].includes(a.account_type))liquid+=Math.max(0,v);if(a.account_type==='investment')invested+=Math.max(0,v)});
    let receivables=0,borrowed=0;
    (state.loans||[]).forEach(l=>{const raw=V.historicalLoanRemaining(l,endDate),v=convert(raw,l.currency||state.base,valuationDate);if(v===null){unconverted++;return}if(l.loan_type==='lent')receivables+=v;else borrowed+=v});
    const totalAssets=assets+receivables,totalLiabilities=liabilities+borrowed;
    return {assets,liabilities,receivables,borrowed,totalAssets,totalLiabilities,netWorth:totalAssets-totalLiabilities,liquid,invested,unconverted,rateMonth:monthKey(valuationDate)};
  };
  V.periodVND=function(txs){
    let income=0,expense=0,debtPrincipal=0,unconverted=0;
    (txs||[]).forEach(t=>{const v=convert(t.amount,t.currency||state.base,t.transaction_date);if(v===null){unconverted++;return}if(t.transaction_type==='income')income+=v;else if(t.transaction_type==='expense'||t.transaction_type==='loan_interest')expense+=v;else if(t.transaction_type==='loan_pay')debtPrincipal+=v});
    return {income,expense,debtPrincipal,unconverted};
  };

  function fmtRate(v){return new Intl.NumberFormat('vi-VN',{maximumFractionDigits:6}).format(n(v))}
  function patchFxTitle(html,context){
    if(!state.reporting?.show_vnd_conversion||!html.includes('v4-fx-title'))return html;
    let label='';
    if(context==='year')label='Tỷ giá lịch sử theo từng tháng';
    else if(context==='accounts'){
      const key=(V.localToday?.()||today()).slice(0,7),r=rateRecord(key);label=r.rate?`Tài sản: 1 JPY = ${fmtRate(r.rate)} VND · Thu/chi theo tháng giao dịch`:'Chưa có tỷ giá tháng hiện tại';
    }else{
      const r=rateRecord(state.month);label=r.rate?`1 JPY = ${fmtRate(r.rate)} VND${r.inherited?` · kế thừa ${r.sourceMonth.replace('-','/')}`:` · ${state.month.replace('-','/')}`}`:'Chưa có tỷ giá cho kỳ này';
    }
    return html.replace(/(<div class="v4-fx-title"><span>Quy đổi VND<\/span><b>)[\s\S]*?(<\/b><\/div>)/,`$1${esc(label)}$2`);
  }
  const dashBefore=V.dashboardV3,analyticsBefore=V.analyticsV3,accountsBefore=V.accountsV3;
  if(typeof dashBefore==='function')V.dashboardV3=()=>patchFxTitle(dashBefore(),'month');
  if(typeof analyticsBefore==='function')V.analyticsV3=()=>patchFxTitle(analyticsBefore(),state.analyticsPeriod==='year'?'year':'month');
  if(typeof accountsBefore==='function')V.accountsV3=()=>patchFxTitle(accountsBefore(),'accounts');

  function historyPanel(){
    const current=state.month||((V.localToday?.()||today()).slice(0,7)),rec=rateRecord(current),direct=explicitRate(current),recent=[...(state.fxHistory||[])].slice(0,8);
    return `<section class="fxh-card" id="fxhCard"><div class="fxh-head"><div><span>TỶ GIÁ LỊCH SỬ</span><h2>JPY → VND theo tháng</h2><p>Báo cáo quá khứ dùng tỷ giá của đúng tháng; tháng trống kế thừa tháng gần nhất trước đó.</p></div></div><form id="fxhForm" class="fxh-form"><label><span>Tháng</span><input id="fxhMonth" name="month" type="month" value="${esc(current)}" required></label><label><span>1 JPY =</span><div><input id="fxhRate" name="jpy_vnd_rate" type="number" min="0.000001" step="0.000001" value="${esc(direct?.jpy_vnd_rate??rec.rate??'')}" required><b>VND</b></div></label><label class="wide"><span>Ghi chú</span><input id="fxhNote" name="note" value="${esc(direct?.note||'')}" placeholder="VD: tỷ giá dùng cho báo cáo tháng"></label><div class="fxh-status"><span>Đang dùng</span><strong id="fxhStatus">${rec.rate?`${fmtRate(rec.rate)} VND${rec.inherited?` · kế thừa ${rec.sourceMonth.replace('-','/')}`:' · nhập riêng tháng này'}`:'Chưa có tỷ giá'}</strong></div><div class="fxh-actions"><button class="primary" type="submit">Lưu tháng này</button><button type="button" data-fxh-action="inherit" ${direct?'':'disabled'}>Dùng tỷ giá tháng trước</button></div></form><div class="fxh-history"><div class="fxh-history-head"><span>Các tháng đã nhập</span><small>Chỉ lưu tháng có thay đổi; tháng khác tự kế thừa.</small></div>${recent.length?recent.map(x=>`<button type="button" data-fxh-action="edit" data-fxh-month="${String(x.month).slice(0,7)}"><span>${String(x.month).slice(0,7).replace('-','/')}</span><strong>1 JPY = ${fmtRate(x.jpy_vnd_rate)} VND</strong><small>${esc(x.note||'')}</small></button>`).join(''):'<div class="fxh-empty">Chưa có lịch sử tỷ giá.</div>'}</div></section>`;
  }

  function syncHistoryForm(month){
    const key=month||$('#fxhMonth')?.value;if(!key)return;const direct=explicitRate(key),rec=rateRecord(key),rate=$('#fxhRate'),note=$('#fxhNote'),status=$('#fxhStatus'),inherit=document.querySelector('[data-fxh-action="inherit"]');
    if(rate)rate.value=direct?.jpy_vnd_rate??rec.rate??'';if(note)note.value=direct?.note||'';if(status)status.textContent=rec.rate?`${fmtRate(rec.rate)} VND${rec.inherited?` · kế thừa ${rec.sourceMonth.replace('-','/')}`:' · nhập riêng tháng này'}`:'Chưa có tỷ giá';if(inherit)inherit.disabled=!direct;
  }
  function wireLegacyFxForm(){
    const form=$('#v4FxForm');if(!form||form.dataset.fxhWired)return;const clone=form.cloneNode(true);form.replaceWith(clone);clone.dataset.fxhWired='1';const now=(V.localToday?.()||today()).slice(0,7),r=rateRecord(now),input=clone.querySelector('[name="jpy_vnd_rate"]');if(input&&r.rate)input.value=r.rate;
    clone.addEventListener('submit',async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(clone).entries()),show=!!clone.querySelector('[name="show_vnd_conversion"]')?.checked,rate=fd.jpy_vnd_rate||null;try{await V.extensionApi('save_reporting',{show_vnd_conversion:show,jpy_vnd_rate:rate});if(rate)await fxHistoryApi('save',{month:`${now}-01`,jpy_vnd_rate:rate,note:'Tỷ giá hiện tại'});await Promise.all([V.loadFinanceExtensions(false),loadFxHistory(false)]);render();toast('Đã lưu tỷ giá hiện tại')}catch(err){toast(err.message,true)}});
  }
  function decorateSettings(){
    if(state.view!=='settings')return;const content=$('#content');if(!content)return;wireLegacyFxForm();if(!$('#fxhCard'))content.insertAdjacentHTML('beforeend',historyPanel());const form=$('#fxhForm');if(form&&!form.dataset.wired){form.dataset.wired='1';form.addEventListener('submit',async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(form).entries());try{await fxHistoryApi('save',{month:`${fd.month}-01`,jpy_vnd_rate:fd.jpy_vnd_rate,note:fd.note||''});await loadFxHistory(false);render();toast('Đã lưu tỷ giá tháng')}catch(err){toast(err.message,true)}});$('#fxhMonth')?.addEventListener('change',e=>syncHistoryForm(e.target.value))}}

  const renderBefore=window.render;
  if(typeof renderBefore==='function')window.render=function(...args){const out=renderBefore(...args);queueMicrotask(decorateSettings);return out};
  const refreshBefore=window.refresh;
  if(typeof refreshBefore==='function')window.refresh=async function(...args){await refreshBefore(...args);await loadFxHistory(false);if(state.household)render()};
  let tries=0;const timer=setInterval(async()=>{tries++;if(state.key&&state.household){try{await loadFxHistory(false);render();clearInterval(timer)}catch(e){console.error('FX history load failed',e)}}if(tries>40)clearInterval(timer)},250);

  document.addEventListener('click',async e=>{const b=e.target.closest?.('[data-fxh-action]');if(!b)return;const a=b.dataset.fxhAction;if(a==='edit'){const key=b.dataset.fxhMonth;if($('#fxhMonth'))$('#fxhMonth').value=key;return syncHistoryForm(key)}if(a==='inherit'){const key=$('#fxhMonth')?.value;if(!key)return;try{await fxHistoryApi('delete',{month:`${key}-01`});await loadFxHistory(false);render();toast('Tháng này sẽ dùng tỷ giá gần nhất trước đó')}catch(err){toast(err.message,true)}}});
  Object.assign(window,{fxHistoryApi,loadFxHistory});
})();
