(() => {
  const V=window.__V3;
  if(!V) return;

  const ALLOC_RPC_URL=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_allocation_api`;
  state.allocationPlan=state.allocationPlan||null;
  state.allocationYear=state.allocationYear||[];
  state.allocationYearLoaded=state.allocationYearLoaded||null;

  const DEFS=[
    {key:'fixed',pct:'fixed_pct',label:'Chi cố định',mode:'max'},
    {key:'variable',pct:'variable_pct',label:'Chi biến động',mode:'max'},
    {key:'loanInterest',pct:'interest_pct',label:'Lãi / phí vay',mode:'max'},
    {key:'saving',pct:'saving_pct',label:'Tiết kiệm',mode:'min'},
    {key:'investment',pct:'investment_pct',label:'Đầu tư',mode:'min'},
    {key:'debtPay',pct:'debt_pct',label:'Trả nợ gốc',mode:'min'}
  ];

  async function allocationApi(action,payload={}){
    if(!state.key) throw new Error('Thiếu khóa gia đình');
    const res=await fetch(ALLOC_RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({p_key:state.key,p_action:action,p_payload:payload})});
    const text=await res.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok){
      const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
      const friendly=/target_total_exceeds_100/i.test(raw)?'Tổng chỉ tiêu không được vượt 100% thu nhập.'
        :/invalid_target_percentage/i.test(raw)?'Mỗi tỷ lệ phải nằm trong khoảng 0–100%.'
        :/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.':raw;
      throw new Error(friendly);
    }
    return data;
  }

  async function loadAllocationMonth(month=state.month,rerender=false){
    if(!state.key)return null;
    const d=await allocationApi('get_month',{month:`${month}-01`});
    state.allocationPlan=d;
    if(rerender&&state.household)render();
    return d;
  }
  async function loadAllocationYear(year=state.analyticsYear,rerender=false){
    if(!state.key)return [];
    const d=await allocationApi('get_year',{year});
    state.allocationYear=d?.months||[];
    state.allocationYearLoaded=Number(year);
    if(rerender&&state.household)render();
    return state.allocationYear;
  }

  V.allocationApi=allocationApi;
  V.loadAllocationMonth=loadAllocationMonth;
  V.loadAllocationYear=loadAllocationYear;

  const originalLoadMonth=window.loadMonth;
  if(typeof originalLoadMonth==='function'){
    window.loadMonth=async function(m,rerender=true){
      await originalLoadMonth(m,false);
      await loadAllocationMonth(m,false);
      if(rerender)render();
    };
  }

  window.setAnalyticsPeriod=async function(v){
    state.analyticsPeriod=v;
    if(v==='year'){
      state.analyticsYear=Number(state.month.slice(0,4));
      await loadAllocationYear(state.analyticsYear,false);
    }
    render();
  };
  window.shiftAnalyticsYear=async function(delta){
    state.analyticsYear+=Number(delta||0);
    await loadAllocationYear(state.analyticsYear,false);
    render();
  };

  let tries=0;
  const timer=setInterval(async()=>{
    tries++;
    if(state.key&&state.household){
      try{await loadAllocationMonth(state.month,false);if(state.analyticsPeriod==='year')await loadAllocationYear(state.analyticsYear,false);render();clearInterval(timer)}catch(e){console.error('Allocation load failed',e)}
    }
    if(tries>40)clearInterval(timer);
  },250);

  function plan(){
    const p=state.allocationPlan;
    if(p&&String(p.month||'').slice(0,7)===state.month)return p;
    return {month:`${state.month}-01`,source_month:null,inherited:false,fixed_pct:0,variable_pct:0,interest_pct:0,saving_pct:0,investment_pct:0,debt_pct:0,reserve_pct:100};
  }
  function actualPct(value,income){return income>0?n(value)/income*100:null}
  function fmtPct(v){return v===null||!Number.isFinite(v)?'—':`${v.toFixed(1)}%`}
  function monthStats(){return V.statsFor(V.periodTransactions('month',state.month))}
  function targetRowsForMonth(){
    const p=plan(),s=monthStats(),income=n(s.income);
    const rows=DEFS.map(d=>({...d,targetPct:n(p[d.pct]),targetAmount:income*n(p[d.pct])/100,actual:n(s[d.key]),actualPct:actualPct(s[d.key],income)}));
    const reservePct=n(p.reserve_pct),actualReserve=n(s.remaining);
    rows.push({key:'reserve',pct:'reserve_pct',label:'Dự phòng / còn lại',mode:'min',targetPct:reservePct,targetAmount:income*reservePct/100,actual:actualReserve,actualPct:actualPct(actualReserve,income)});
    return {p,s,income,rows};
  }
  function statusFor(row,income){
    if(income<=0)return {cls:'neutral',text:'Chưa có thu nhập'};
    const diff=n(row.actualPct)-n(row.targetPct),eps=.05;
    if(row.mode==='max')return diff>eps?{cls:'bad',text:`Vượt ${Math.abs(diff).toFixed(1)}%`}:{cls:'good',text:`Còn biên ${Math.max(0,-diff).toFixed(1)}%`};
    return diff+eps>=0?{cls:'good',text:diff>eps?`Vượt mục tiêu +${diff.toFixed(1)}%`:'Đạt mục tiêu'}:{cls:'warn',text:`Thiếu ${Math.abs(diff).toFixed(1)}%`};
  }

  function monthlyTargetData(){
    const {p,s,income,rows}=targetRowsForMonth();
    const usedPct=income>0?n(s.allocated)/income*100:0;
    const overPct=Math.max(0,usedPct-100);
    return {p,s,income,rows,usedPct,overPct};
  }

  function statusStrip(){
    const {p,income,rows,usedPct,overPct}=monthlyTargetData();
    const issues=rows.filter(r=>{const st=statusFor(r,income);return st.cls==='bad'||st.cls==='warn'}).length;
    const inherited=p.inherited&&p.source_month?` · kế thừa từ ${String(p.source_month).slice(0,7).replace('-','/')}`:'';
    return `<section class="v6-plan-strip ${overPct>0?'over':''}"><div><span>KẾ HOẠCH PHÂN BỔ THÁNG ${state.month.replace('-','/')}</span><strong>${income?`${usedPct.toFixed(1)}% thu nhập đã được sử dụng/phân bổ`:'Chưa có thu nhập để tính tỷ lệ'}</strong><small>${overPct>0?`Vượt tổng thu nhập ${overPct.toFixed(1)}%`:issues?`${issues} mục chưa đạt/đang vượt ngưỡng`:'Đang trong mục tiêu'}${inherited}</small></div><button onclick="openAllocationPlan()">Điều chỉnh %</button></section>`;
  }

  function pieLegend(rows){
    return `<div class="v6-mini-legend">${rows.map(r=>`<div><span>${esc(r.label)}</span><strong>${fmtPct(r.actualPct)} <small>${money(r.actual)}</small></strong></div>`).join('')}</div>`;
  }

  function comparisonPanel(){
    const {p,s,income,rows,usedPct,overPct}=monthlyTargetData();
    const targetPie=DEFS.map(d=>({label:d.label,value:n(p[d.pct])}));
    targetPie.push({label:'Dự phòng / còn lại',value:n(p.reserve_pct)});
    const actualPie=rows.filter(r=>r.key!=='reserve').map(r=>({label:r.label,value:income>0?Math.max(0,n(r.actualPct)):0}));
    if(income>0&&n(s.remaining)>0)actualPie.push({label:'Còn lại',value:actualPct(s.remaining,income)});
    const direct=p.source_month&&String(p.source_month).slice(0,7)===state.month;
    return `<section class="v6-plan-card"><div class="v6-plan-head"><div><h2>Kế hoạch phân bổ tháng</h2><p>Mục tiêu và thực tế đều lấy tổng thu nhập tháng làm mốc 100%.</p></div><div class="v6-plan-actions"><span>${p.inherited&&p.source_month?`Đang kế thừa ${String(p.source_month).slice(0,7).replace('-','/')}`:'Mục tiêu riêng tháng này'}</span><button class="primary" onclick="openAllocationPlan()">Sửa chỉ tiêu</button>${direct?'<button onclick="deleteAllocationPlan()">Dùng lại tháng trước</button>':''}</div></div>
      <div class="v6-plan-summary"><div><span>Tổng thu nhập</span><strong>${money(income)}</strong></div><div><span>Đã dùng / phân bổ</span><strong class="${overPct>0?'red':''}">${income?usedPct.toFixed(1):'0.0'}%</strong></div><div><span>${overPct>0?'Vượt thu nhập':'Còn lại'}</span><strong class="${overPct>0?'red':'green'}">${overPct>0?`${overPct.toFixed(1)}%`:fmtPct(actualPct(s.remaining,income))}</strong></div></div>
      <div class="v6-pies"><div class="v6-pie-box"><h3>Mục tiêu</h3><div class="v6-pie-wrap">${donutSvg(targetPie,180,22)}<div class="v6-pie-center"><strong>100%</strong><span>Thu nhập</span></div></div><div class="v6-target-legend">${targetPie.map(x=>`<div><span>${esc(x.label)}</span><b>${n(x.value).toFixed(1)}%</b></div>`).join('')}</div></div>
      <div class="v6-pie-box"><h3>Thực tế</h3><div class="v6-pie-wrap">${income?donutSvg(actualPie,180,22):'<div class="viz-empty">Chưa có thu nhập</div>'}<div class="v6-pie-center"><strong class="${overPct>0?'red':''}">${income?`${usedPct.toFixed(0)}%`:'—'}</strong><span>${overPct>0?'Đã vượt':'Đã phân bổ'}</span></div></div>${pieLegend(rows)}</div></div>
      <div class="v6-compare"><div class="v6-compare-head"><span>Nhóm</span><span>Mục tiêu</span><span>Thực tế</span><span>Chênh lệch</span></div>${rows.map(r=>{const st=statusFor(r,income),diff=r.actualPct===null?null:r.actualPct-r.targetPct;return `<div class="v6-compare-row"><div><b>${esc(r.label)}</b><small>${r.mode==='max'?'Ngưỡng tối đa':'Mục tiêu tối thiểu'}</small></div><div><b>${r.targetPct.toFixed(1)}%</b><small>${money(r.targetAmount)}</small></div><div><b>${fmtPct(r.actualPct)}</b><small>${money(r.actual)}</small></div><div><span class="v6-status ${st.cls}">${esc(st.text)}</span>${diff!==null?`<small>${diff>=0?'+':''}${diff.toFixed(1)} điểm %</small>`:''}</div></div>`}).join('')}</div>
    </section>`;
  }

  function annualComparisonPanel(){
    const year=Number(state.analyticsYear),months=(state.allocationYearLoaded===year?state.allocationYear:[]),actual=V.statsFor(V.periodTransactions('year',state.month,year));
    if(!months.length)return '<section class="v6-plan-card"><div class="viz-empty">Đang tải mục tiêu năm…</div></section>';
    const targetAmounts={fixed:0,variable:0,loanInterest:0,saving:0,investment:0,debtPay:0,reserve:0};let totalIncome=0;
    months.forEach(pm=>{const key=String(pm.month).slice(0,7),ms=V.statsFor(V.periodTransactions('month',key));const inc=n(ms.income);totalIncome+=inc;DEFS.forEach(d=>targetAmounts[d.key]+=inc*n(pm[d.pct])/100);targetAmounts.reserve+=inc*n(pm.reserve_pct)/100});
    const rows=DEFS.map(d=>{const t=targetAmounts[d.key],a=n(actual[d.key]);return {...d,targetAmount:t,targetPct:totalIncome?t/totalIncome*100:0,actual:a,actualPct:actualPct(a,totalIncome)}});
    rows.push({key:'reserve',label:'Dự phòng / còn lại',mode:'min',targetAmount:targetAmounts.reserve,targetPct:totalIncome?targetAmounts.reserve/totalIncome*100:0,actual:n(actual.remaining),actualPct:actualPct(actual.remaining,totalIncome)});
    return `<section class="v6-plan-card annual"><div class="v6-plan-head"><div><h2>Mục tiêu năm ${year} vs thực tế</h2><p>Mục tiêu năm được cộng từ mục tiêu từng tháng theo đúng thu nhập của từng tháng.</p></div></div><div class="v6-compare"><div class="v6-compare-head"><span>Nhóm</span><span>Mục tiêu</span><span>Thực tế</span><span>Đánh giá</span></div>${rows.map(r=>{const st=statusFor(r,totalIncome);return `<div class="v6-compare-row"><div><b>${esc(r.label)}</b></div><div><b>${r.targetPct.toFixed(1)}%</b><small>${money(r.targetAmount)}</small></div><div><b>${fmtPct(r.actualPct)}</b><small>${money(r.actual)}</small></div><div><span class="v6-status ${st.cls}">${esc(st.text)}</span></div></div>`}).join('')}</div></section>`;
  }

  function openAllocationPlan(){
    const p=plan();
    modal(`Chỉ tiêu tháng ${state.month.replace('-','/')}`,`<div class="v6-plan-form-note">Tổng 6 mục tối đa 100%. Phần còn lại tự động là <b>Dự phòng / còn lại</b>. Tháng sau sẽ tự kế thừa cho tới khi bạn thay đổi.</div><div class="form-grid v6-plan-form">${DEFS.map(d=>`<div class="field"><label>${esc(d.label)}</label><div class="v6-pct-input"><input name="${d.pct}" type="number" min="0" max="100" step="0.1" value="${n(p[d.pct])}" required><span>%</span></div><small>${d.mode==='max'?'Cảnh báo khi thực tế vượt':'Đạt khi thực tế bằng hoặc cao hơn'}</small></div>`).join('')}<div class="field full"><div class="v6-plan-total"><span>Đã phân bổ mục tiêu</span><strong id="v6PlanTotal">0%</strong><span>Dự phòng</span><strong id="v6PlanReserve">100%</strong></div></div></div>`,async fd=>{await allocationApi('save_month',{month:`${state.month}-01`,...fd});await loadAllocationMonth(state.month,false);if(state.analyticsPeriod==='year')await loadAllocationYear(state.analyticsYear,false)},'Lưu chỉ tiêu');
    const inputs=[...document.querySelectorAll('#modalForm .v6-plan-form input[type="number"]')],total=$('#v6PlanTotal'),reserve=$('#v6PlanReserve'),submit=$('#modalForm [type="submit"]');
    const sync=()=>{const sum=inputs.reduce((s,x)=>s+n(x.value),0),left=100-sum;if(total){total.textContent=`${sum.toFixed(1)}%`;total.classList.toggle('red',sum>100)}if(reserve){reserve.textContent=`${Math.max(0,left).toFixed(1)}%`;reserve.classList.toggle('red',left<0)}if(submit)submit.disabled=sum>100};
    inputs.forEach(x=>x.addEventListener('input',sync));sync();
  }

  async function deleteAllocationPlan(){
    const p=plan(),direct=p.source_month&&String(p.source_month).slice(0,7)===state.month;
    if(!direct)return toast('Tháng này đang kế thừa mục tiêu trước đó.');
    if(!confirm('Bỏ chỉ tiêu riêng tháng này và quay lại dùng mục tiêu tháng trước?'))return;
    try{await allocationApi('delete_month',{month:`${state.month}-01`});await loadAllocationMonth(state.month,false);if(state.analyticsPeriod==='year')await loadAllocationYear(state.analyticsYear,false);render();toast('Đã dùng lại mục tiêu tháng trước')}catch(e){toast(e.message,true)}
  }

  const dashboardBefore=V.dashboardV3,budgetBefore=V.budgetV3,analyticsBefore=V.analyticsV3;
  if(typeof dashboardBefore==='function')V.dashboardV3=()=>statusStrip()+dashboardBefore();
  if(typeof budgetBefore==='function')V.budgetV3=()=>comparisonPanel()+budgetBefore();
  if(typeof analyticsBefore==='function')V.analyticsV3=()=>{
    if(state.analyticsPeriod==='year'&&state.allocationYearLoaded!==Number(state.analyticsYear))loadAllocationYear(state.analyticsYear,true).catch(console.error);
    return (state.analyticsPeriod==='year'?annualComparisonPanel():comparisonPanel())+analyticsBefore();
  };

  window.openAllocationPlan=openAllocationPlan;
  window.deleteAllocationPlan=deleteAllocationPlan;
  V.formulaVersion='6.0';
})();