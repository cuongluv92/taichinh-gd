(() => {
  const V=window.__V3;
  if(!V) return;
  const RPC_URL=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_exceptional_api`;
  state.exceptionalExpenseIds=state.exceptionalExpenseIds||[];

  async function exceptionalApi(action,payload={}){
    if(!state.key) throw new Error('Thiếu khóa gia đình');
    const res=await fetch(RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({p_key:state.key,p_action:action,p_payload:payload})});
    const text=await res.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok){
      const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
      const friendly=/expense_transaction_not_found/i.test(raw)?'Không tìm thấy giao dịch chi tiêu.'
        :/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.':raw;
      throw new Error(friendly);
    }
    return data;
  }
  async function loadExceptional(rerender=false){
    if(!state.key)return [];
    const d=await exceptionalApi('list');
    state.exceptionalExpenseIds=d?.ids||[];
    if(rerender&&state.household)render();
    return state.exceptionalExpenseIds;
  }
  V.exceptionalApi=exceptionalApi;V.loadExceptional=loadExceptional;

  const prevRefresh=window.refresh;
  if(typeof prevRefresh==='function')window.refresh=async function(...args){await prevRefresh(...args);await loadExceptional(false);if(state.household)render()};
  let tries=0;const timer=setInterval(async()=>{tries++;if(state.key&&state.household){try{await loadExceptional(false);render();clearInterval(timer)}catch(e){console.error('Exceptional load failed',e)}}if(tries>40)clearInterval(timer)},250);

  const idSet=()=>new Set(state.exceptionalExpenseIds||[]);
  const isExceptional=t=>!!t&&t.transaction_type==='expense'&&idSet().has(t.id);
  V.isExceptional=isExceptional;

  const statsBefore=V.statsFor;
  function exceptionalBreakdown(txs){
    let fixed=0,variable=0,total=0;
    (txs||[]).filter(t=>isExceptional(t)&&V.baseTx(t)).forEach(t=>{const amt=V.baseAmount(t);total+=amt;(V.expenseKind(t)==='fixed'?fixed+=amt:variable+=amt)});
    return {fixed,variable,total};
  }
  function statsWithExceptional(txs){
    const s=statsBefore(txs),x=exceptionalBreakdown(txs);
    return {...s,exceptional:x.total,normalFixed:Math.max(0,n(s.fixed)-x.fixed),normalVariable:Math.max(0,n(s.variable)-x.variable),normalExpense:Math.max(0,n(s.expense)-x.total)};
  }
  function normalStats(txs){
    const s=statsWithExceptional(txs),allocated=Math.max(0,n(s.allocated)-n(s.exceptional)),expense=n(s.normalExpense);
    return {...s,fixed:n(s.normalFixed),variable:n(s.normalVariable),expense,allocated,remaining:Math.max(0,n(s.income)-allocated),overspend:Math.max(0,allocated-n(s.income)),cashFlow:n(s.income)-expense};
  }
  V.statsFor=statsWithExceptional;
  V.normalStatsFor=normalStats;
  const withNormalStats=fn=>{const current=V.statsFor;V.statsFor=normalStats;try{return fn()}finally{V.statsFor=current}};

  const categoryActualBefore=V.categoryActualBase;
  if(typeof categoryActualBefore==='function')V.categoryActualBase=function(id,dir='expense'){
    const total=categoryActualBefore(id,dir);if(dir!=='expense')return total;
    const exceptional=(state.transactions||[]).filter(t=>t.transaction_type==='expense'&&t.category_id===id&&isExceptional(t)&&V.baseTx(t)).reduce((s,t)=>s+V.baseAmount(t),0);
    return Math.max(0,n(total)-exceptional);
  };

  V.avgExpenseMonths=function(count=3){
    const end=new Date(`${state.month}-01T00:00:00`),start=V.dataStartMonth?.()||state.month;let total=0,used=0;
    for(let i=0;i<count;i++){const d=new Date(end);d.setMonth(d.getMonth()-i);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;if(key<start)continue;total+=normalStats(V.periodTransactions('month',key)).expense;used++}
    return used?total/used:0;
  };
  V.expenseByCategory=function(txs){
    const map=new Map();
    (txs||[]).filter(V.baseTx).forEach(t=>{
      if(t.transaction_type==='expense'&&!isExceptional(t)){
        const c=V.categoryVersionAt(t.category_id,t.transaction_date),name=c.name||t.category_name||'Khác';map.set(name,(map.get(name)||0)+V.baseAmount(t));
      }else if(t.transaction_type==='loan_interest')map.set('Lãi / phí vay',(map.get('Lãi / phí vay')||0)+V.baseAmount(t));
    });
    return [...map.entries()].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value);
  };

  function currencyTotals(rows){
    const m=new Map();rows.forEach(t=>{const c=t.currency||state.base;m.set(c,(m.get(c)||0)+n(t.amount))});
    return [...m.entries()].map(([c,v])=>money(v,c)).join(' · ')||money(0,state.base);
  }
  function monthExceptional(){return (state.fullTransactions||[]).filter(t=>V.monthKey(t.transaction_date)===state.month&&isExceptional(t))}
  function exceptionalStrip(context='transactions'){
    const rows=monthExceptional();if(!rows.length)return `<section class="ex-strip empty"><div><span>CHI BẤT THƯỜNG</span><strong>Chưa có khoản nào trong ${state.month.replace('-','/')}</strong><small>Đánh dấu khoản mua lớn/hiếm để không làm méo ngân sách sinh hoạt.</small></div><button data-ex-action="manage">Quản lý</button></section>`;
    const baseTotal=rows.filter(V.baseTx).reduce((s,t)=>s+V.baseAmount(t),0),s=statsWithExceptional(V.periodTransactions('month',state.month));
    return `<section class="ex-strip"><div><span>CHI BẤT THƯỜNG · ${state.month.replace('-','/')}</span><strong>${currencyTotals(rows)}</strong><small>${context==='budget'?`Không tính vào ngân sách sinh hoạt. Tổng chi thực tế vẫn là ${money(s.expense)}.`:`Sinh hoạt bình thường ${money(s.normalExpense)} · tổng chi thực tế ${money(s.expense)}${baseTotal?'':''}`}</small></div><button data-ex-action="manage">Xem / chỉnh</button></section>`;
  }

  function normalFocus(){
    const x=withNormalStats(()=>typeof V.safeSpendWithCards==='function'?V.safeSpendWithCards():typeof V.safeSpendWithRecurring==='function'?V.safeSpendWithRecurring():V.safeSpendData?.()),pace=withNormalStats(()=>V.paceData?.()),p=state.allocationPlan||{};
    if(!x||!pace)return '';
    const source=p.inherited&&p.source_month?`Kế thừa ${String(p.source_month).slice(0,7).replace('-','/')}`:'Chỉ tiêu tháng này';
    return `<section class="v7-focus ${pace.status}"><div class="v7-focus-main"><span class="v7-kicker">CÓ THỂ TIÊU AN TOÀN</span><strong>${x.available===null?'—':money(x.available)}</strong><p>${x.available===null?esc(x.reason||''):`Sau khi giữ lại ${money(x.protectedTotal)} cho nghĩa vụ, mục tiêu và dự phòng.`}</p><div class="v7-focus-actions"><button class="primary" onclick="openQuick('expense')">＋ Chi nhanh</button><button onclick="openAllocationPlan()">Chỉnh chỉ tiêu</button></div></div><div class="v7-focus-side"><div class="v7-pace-head"><span>Tốc độ chi sinh hoạt</span><b class="${pace.status}">${pace.ratio===null?'—':`${(pace.usedRatio*100).toFixed(1)}%`}</b></div>${pace.ratio===null?`<div class="v7-empty-line">${esc(pace.label)}</div>`:`<progress class="v7-progress ${pace.status}" max="100" value="${Math.min(100,pace.usedRatio*100)}"></progress><div class="v7-pace-meta"><span>${money(pace.used)} / ${money(pace.target)}</span><span>Ngày ${pace.day}/${pace.days} · ${(pace.elapsed*100).toFixed(0)}% tháng</span></div><strong class="v7-pace-message ${pace.status}">${esc(pace.label)}</strong>`}<small>${esc(source)} · không tính chi bất thường</small></div></section>`;
  }

  const dashboardBefore=V.dashboardV3;
  if(typeof dashboardBefore==='function')V.dashboardV3=()=>{let html=dashboardBefore(),focus=normalFocus();if(focus)html=html.replace(/<section class="v7-focus[\s\S]*?<\/section>/,focus);const rows=monthExceptional();if(rows.length)html=html.replace(/(<section class="v7-focus[\s\S]*?<\/section>)/,`$1${exceptionalStrip('dashboard')}`);return html};

  const budgetBefore=V.budgetV3;
  if(typeof budgetBefore==='function')V.budgetV3=()=>withNormalStats(()=>budgetBefore())+exceptionalStrip('budget');

  const analyticsBefore=V.analyticsV3;
  if(typeof analyticsBefore==='function')V.analyticsV3=()=>{const html=analyticsBefore(),txs=V.periodTransactions(),s=statsWithExceptional(txs);if(!s.exceptional)return html;return `<section class="ex-analytics"><div><span>Chi sinh hoạt bình thường</span><strong>${money(s.normalExpense)}</strong></div><div><span>Chi bất thường</span><strong>${money(s.exceptional)}</strong></div><div><span>Tổng chi thực tế</span><strong>${money(s.expense)}</strong></div></section>${html}`};

  const txBefore=V.transactionsV3;
  if(typeof txBefore==='function')V.transactionsV3=()=>exceptionalStrip('transactions')+txBefore();
  else if(typeof window.transactions==='function'){const old=window.transactions;window.transactions=()=>exceptionalStrip('transactions')+old()}

  function openExceptionalManager(){
    const rows=(state.fullTransactions||[]).filter(t=>t.transaction_type==='expense'&&V.monthKey(t.transaction_date)===state.month).sort((a,b)=>String(b.transaction_date||'').localeCompare(String(a.transaction_date||''))),dlg=$('#modal'),mb=$('#modalBody'),form=$('#modalForm');
    mb.innerHTML=`<div class="modal-head"><div><span class="v7-modal-kicker">CHI BẤT THƯỜNG</span><h3>Tháng ${state.month.replace('-','/')}</h3></div><button class="mini-btn" type="button" data-ex-action="close">✕</button></div><div class="modal-content"><div class="ex-manager-note">Chỉ đánh dấu khoản mua lớn/hiếm. Tiền vẫn được tính vào tổng chi và tài sản; chỉ loại khỏi ngân sách sinh hoạt, nhịp chi và mức chi trung bình.</div><div class="ex-list">${rows.length?rows.map(t=>`<div class="ex-row ${isExceptional(t)?'active':''}"><div><b>${esc(t.category_name||'Chi tiêu')}</b><span>${esc(String(t.transaction_date||''))} · ${esc(t.account_name||'')}</span><small>${esc(t.note||'')}</small></div><strong>${money(t.amount,t.currency)}</strong><button data-ex-action="toggle" data-ex-id="${t.id}" data-ex-value="${isExceptional(t)?'false':'true'}">${isExceptional(t)?'Bỏ bất thường':'Đánh dấu'}</button></div>`).join(''):'<div class="ex-empty">Chưa có giao dịch chi trong tháng.</div>'}</div></div><div class="modal-actions"><button class="btn primary" type="button" data-ex-action="close">Đóng</button></div>`;form.onsubmit=e=>e.preventDefault();if(!dlg.open)dlg.showModal();
  }
  async function toggleExceptional(id,value){
    try{await exceptionalApi('set',{id,is_exceptional:value});await loadExceptional(false);render();openExceptionalManager();toast(value?'Đã đánh dấu chi bất thường':'Đã chuyển về chi bình thường')}catch(e){toast(e.message,true)}
  }
  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-ex-action]');if(!b)return;const a=b.dataset.exAction;if(a==='manage')return openExceptionalManager();if(a==='toggle')return toggleExceptional(b.dataset.exId,b.dataset.exValue==='true');if(a==='close')return $('#modal')?.close()});
  Object.assign(window,{openExceptionalManager,toggleExceptional});
})();
