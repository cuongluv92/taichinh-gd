(() => {
  const V=window.__V3;
  if(!V) return;

  const BANK_RPC_URL=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_bank_loan_api`;
  async function bankLoanApi(action,payload={}){
    if(!state.key) throw new Error('Thiếu khóa gia đình');
    const res=await fetch(BANK_RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({p_key:state.key,p_action:action,p_payload:payload})});
    const text=await res.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok){
      const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
      const friendly=/term_months_required/i.test(raw)?'Cần nhập thời hạn vay khi dùng cách tính 元利均等 / 元金均等.'
        :/invalid_account/i.test(raw)?'Tài khoản nhận tiền phải cùng tiền tệ với khoản vay.'
        :/principal_must_be_positive/i.test(raw)?'Tiền gốc phải lớn hơn 0.'
        :/loan_not_found/i.test(raw)?'Không tìm thấy khoản vay.'
        :raw;
      throw new Error(friendly);
    }
    return data;
  }
  V.bankLoanApi=bankLoanApi;

  // V4 initially kept loan interest inside "fixed" only for chart compatibility.
  // V5 separates it again so every subtotal has one accounting meaning.
  const statsBeforeV5=V.statsFor;
  V.statsFor=function(txs){
    const s=statsBeforeV5(txs);
    const interest=n(s.loanInterest);
    s.fixed=Math.max(0,n(s.fixed)-interest);
    s.loanInterest=interest;
    s.expense=n(s.fixed)+n(s.variable)+interest;
    s.allocated=s.expense+n(s.saving)+n(s.investment)+n(s.debtPay);
    s.remaining=Math.max(0,n(s.income)-s.allocated);
    s.overspend=Math.max(0,s.allocated-n(s.income));
    s.cashFlow=n(s.income)-s.expense;
    return s;
  };

  V.expenseByCategory=function(txs){
    const map=new Map();
    (txs||[]).filter(V.baseTx).forEach(t=>{
      if(t.transaction_type==='expense'){
        const c=V.categoryVersionAt(t.category_id,t.transaction_date),name=c.name||t.category_name||'Khác';
        map.set(name,(map.get(name)||0)+V.baseAmount(t));
      }else if(t.transaction_type==='loan_interest'){
        map.set('Lãi / phí vay',(map.get('Lãi / phí vay')||0)+V.baseAmount(t));
      }
    });
    return [...map.entries()].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value);
  };

  function expenseBarsV5(txs){
    const rows=V.expenseByCategory(txs).slice(0,8),max=Math.max(1,...rows.map(x=>x.value));
    if(!rows.length)return '<div class="viz-empty">Chưa có chi tiêu trong kỳ này</div>';
    const W=720,rowH=42,H=rows.length*rowH+10;
    return `<svg class="hbar-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="So sánh chi tiêu">${rows.map((x,i)=>{const w=420*x.value/max,y=i*rowH+8;return `<text x="4" y="${y+16}" class="hbar-label">${esc(x.label.slice(0,18))}</text><rect x="170" y="${y}" width="${Math.max(3,w)}" height="20" rx="7" fill="${CHART_COLORS[i%CHART_COLORS.length]}"/><text x="${Math.min(700,180+w)}" y="${y+16}" class="hbar-value">${esc(money(x.value))}</text>`}).join('')}</svg>`;
  }
  window.expenseBars=expenseBarsV5;

  function yearlyBarsV5(year){
    const data=[];
    for(let m=1;m<=12;m++){
      const key=`${year}-${String(m).padStart(2,'0')}`,s=V.statsFor(V.periodTransactions('month',key));
      data.push({m,inc:s.income,exp:s.expense});
    }
    const max=Math.max(1,...data.flatMap(x=>[x.inc,x.exp])),W=760,H=300,pad=34,group=(W-pad*2)/12,bw=13;
    return `<svg class="yearbar-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Thu chi theo tháng">${[0,1,2,3].map(i=>{const y=pad+(H-pad*2)*i/3;return `<line x1="${pad}" y1="${y}" x2="${W-pad}" y2="${y}" stroke="#e8eef5"/>`}).join('')}${data.map((x,i)=>{const cx=pad+group*i+group/2,ih=(H-pad*2)*x.inc/max,eh=(H-pad*2)*x.exp/max;return `<rect x="${cx-bw-2}" y="${H-pad-ih}" width="${bw}" height="${ih}" rx="4" fill="#16a34a"/><rect x="${cx+2}" y="${H-pad-eh}" width="${bw}" height="${eh}" rx="4" fill="#ef4444"/><text x="${cx}" y="${H-10}" text-anchor="middle" class="year-label">T${x.m}</text>`}).join('')}</svg><div class="simple-legend"><span><i class="dot-income"></i>Thu nhập</span><span><i class="dot-expense"></i>Chi tiêu + lãi vay</span></div>`;
  }

  function fxStrip(endDate='9999-12-31',txs=V.periodTransactions('month',state.month)){
    if(!state.reporting?.show_vnd_conversion)return '';
    const r=V.fxRate?.();
    if(!r)return '<div class="v4-fx-warning">Đã bật quy đổi VND nhưng chưa có tỷ giá. Vào Cài đặt để nhập 1 JPY bằng bao nhiêu VND.</div>';
    const pos=V.positionVND(endDate),flow=V.periodVND(txs);
    return `<section class="v4-fx-strip"><div class="v4-fx-title"><span>Quy đổi VND</span><b>1 JPY = ${new Intl.NumberFormat('vi-VN',{maximumFractionDigits:6}).format(r)} VND</b></div><div><span>Tài sản ròng</span><strong>${money(pos.netWorth,'VND')}</strong></div><div><span>Tổng tài sản</span><strong>${money(pos.totalAssets,'VND')}</strong></div><div><span>Tổng nợ</span><strong>${money(pos.totalLiabilities,'VND')}</strong></div><div><span>Thu / Chi kỳ</span><strong>${money(flow.income,'VND')} / ${money(flow.expense,'VND')}</strong></div></section>`;
  }

  function insightsV5(){
    const now=V.statsFor(V.periodTransactions('month',state.month)),d=new Date(`${state.month}-01T00:00:00`);d.setMonth(d.getMonth()-1);
    const prevKey=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,prev=V.statsFor(V.periodTransactions('month',prevKey));
    const chg=V.pctChange(now.expense,prev.expense),top=V.expenseByCategory(V.periodTransactions('month',state.month))[0],avg=V.avgExpenseMonths(3),months=avg?V.financialPosition().liquid/avg:0,acc=now.income?(now.saving+now.investment)/now.income*100:0;
    return [{icon:chg===null?'•':chg<=0?'↘':'↗',title:'Chi so tháng trước',value:V.signedPct(chg),detail:chg===null?'Kỳ trước bằng 0 nên không tính %':chg<=0?'Đang thấp hơn kỳ trước':'Đang cao hơn kỳ trước',tone:chg===null?'neutral':chg<=0?'good':'warn'},{icon:'◎',title:'Mục chi lớn nhất',value:top?top.label:'Chưa có',detail:top?money(top.value):'Chưa đủ dữ liệu',tone:'neutral'},{icon:'▣',title:'Khả năng chi trả',value:avg?`${months.toFixed(1)} tháng`:'—',detail:'Tiền khả dụng / chi TB gần đây',tone:months>=3?'good':'neutral'},{icon:'↗',title:'Tỷ lệ tích lũy',value:`${acc.toFixed(1)}%`,detail:'Tiết kiệm + đầu tư từ dòng tiền',tone:acc>0?'good':'neutral'}];
  }

  function allocationItems(s){
    return [{label:'Chi cố định',value:s.fixed},{label:'Chi biến động',value:s.variable},{label:'Lãi / phí vay',value:s.loanInterest},{label:'Tiết kiệm',value:s.saving},{label:'Đầu tư',value:s.investment},{label:'Trả nợ gốc',value:s.debtPay},{label:s.overspend?'Bội chi':'Còn lại',value:s.overspend||s.remaining}];
  }

  function dashboardV5(){
    const end=V.endOfMonthDate(state.month),pos=V.financialPosition(end),txs=V.periodTransactions('month',state.month),s=V.statsFor(txs),assets=V.assetComposition(end),nw=V.netWorthSeries(12),prevNw=nw.length>1?nw.at(-2).value:nw.at(-1)?.value||0,delta=pos.netWorth-prevNw,allocation=allocationItems(s),pending=V.pendingFixed(),due=V.dueLoans(),foreign=V.foreignSummary(),tasks=[...pending.slice(0,4).map(c=>({label:c.name,detail:`Dự kiến ${money(c.planned_amount)}`,action:`openCategoryTransaction('${c.id}','expense')`})),...due.slice(0,3).map(l=>({label:`Nợ ${l.counterparty}`,detail:dateStatus(l.due_date),action:`openLoanPayment('${l.id}')`}))],insights=insightsV5();
    return `${fxStrip(end,txs)}<div class="v3-hero"><div><span class="v3-eyebrow">TÀI SẢN RÒNG · ${state.base}</span><strong>${money(pos.netWorth)}</strong><small class="${delta>=0?'green':'red'}">${delta>=0?'▲':'▼'} ${money(Math.abs(delta))} so với cuối tháng trước</small></div><div class="v3-hero-actions"><button onclick="openQuick('income')">＋ Thu</button><button onclick="openQuick('expense')">− Chi</button><button onclick="openQuick('transfer')">⇄ Chuyển</button></div></div><div class="v3-kpis"><section><span>Tiền khả dụng</span><strong>${money(pos.liquid)}</strong><small>Tiền mặt · ngân hàng · tiết kiệm</small></section><section><span>Tổng nợ</span><strong class="${pos.totalLiabilities?'red':''}">${money(pos.totalLiabilities)}</strong><small>Dư âm tài khoản + khoản vay</small></section><section><span>Thu nhập tháng</span><strong class="green">${money(s.income)}</strong><small>${state.month.replace('-','/')}</small></section><section><span>Chi phí tháng</span><strong>${money(s.expense)}</strong><small>Cố định ${money(s.fixed)} · Biến động ${money(s.variable)}${s.loanInterest?` · Lãi vay ${money(s.loanInterest)}`:''}</small></section></div>${foreign.foreignAc.length||foreign.foreignTx.length?`<div class="v3-note">Có dữ liệu ngoại tệ. Tổng chính chỉ tính <b>${state.base}</b>; quy đổi VND chỉ xuất hiện khi bạn bật tỷ giá nhập tay.</div>`:''}<div class="v3-two"><section class="v3-card"><div class="v3-card-head"><div><h2>Phân bổ thu nhập</h2><p>Mỗi dòng tiền chỉ được tính một lần</p></div><button class="v3-link" onclick="navigate('analytics')">Phân tích →</button></div><div class="donut-layout"><div class="donut-wrap">${donutSvg(allocation,180,22)}<div class="donut-center"><span>Thu nhập</span><strong>${money(s.income)}</strong></div></div>${legendHtml(allocation,'income',s.income)}</div></section><section class="v3-card"><div class="v3-card-head"><div><h2>Tài sản ròng 12 tháng</h2><p>Tài sản + phải thu − nghĩa vụ</p></div></div><div class="v3-chart">${V.netWorthLine(nw)}</div></section></div><div class="v3-two"><section class="v3-card"><div class="v3-card-head"><div><h2>Tiền đang nằm ở đâu</h2><p>Cơ cấu tài sản</p></div><button class="v3-link" onclick="navigate('accounts')">Tài sản →</button></div><div class="donut-layout"><div class="donut-wrap">${donutSvg(assets,170,20)}<div class="donut-center"><span>Tài sản</span><strong>${money(pos.totalAssets)}</strong></div></div>${legendHtml(assets)}</div></section><section class="v3-card"><div class="v3-card-head"><div><h2>Việc cần chú ý</h2><p>Tự động từ dữ liệu hiện tại</p></div></div><div class="v3-task-list">${tasks.length?tasks.map(x=>`<button onclick="${x.action}"><span><b>${esc(x.label)}</b><small>${esc(x.detail)}</small></span><i>›</i></button>`).join(''):'<div class="v3-empty-good">✓ Không có khoản cố định/nợ gần hạn cần nhắc</div>'}</div></section></div><section class="v3-card"><div class="v3-card-head"><div><h2>Góc nhìn nhanh</h2><p>Chỉ số hỗ trợ quan sát, không phải điểm tín dụng</p></div></div><div class="v3-insights">${insights.map(x=>`<div class="${x.tone}"><i>${x.icon}</i><span>${x.title}</span><strong>${esc(x.value)}</strong><small>${esc(x.detail)}</small></div>`).join('')}</div></section>`;
  }

  function analyticsV5(){
    const txs=V.periodTransactions(),s=V.statsFor(txs),prev=V.previousPeriod(),p=V.statsFor(prev.txs),assets=V.assetComposition(),nw=V.netWorthSeries(12),allocation=allocationItems(s),acc=s.income?(s.saving+s.investment)/s.income*100:0,fixedRate=s.income?s.fixed/s.income*100:0,debtRate=s.income?s.debtPay/s.income*100:0,interestRate=s.income?s.loanInterest/s.income*100:0,avg=V.avgExpenseMonths(3),coverage=avg?V.financialPosition().liquid/avg:0;
    return `${fxStrip('9999-12-31',txs)}<div class="analysis-head v3-analysis-head"><div><h2>${state.analyticsPeriod==='year'?`Năm ${state.analyticsYear}`:`Tháng ${state.month.replace('-','/')}`}</h2><p>Thu, chi, lãi vay và chuyển tài sản được tách riêng.</p></div><div class="period-switch"><button class="${state.analyticsPeriod==='month'?'active':''}" onclick="setAnalyticsPeriod('month')">Tháng</button><button class="${state.analyticsPeriod==='year'?'active':''}" onclick="setAnalyticsPeriod('year')">Năm</button></div></div>${state.analyticsPeriod==='year'?`<div class="year-switch"><button onclick="shiftAnalyticsYear(-1)">‹</button><strong>${state.analyticsYear}</strong><button onclick="shiftAnalyticsYear(1)">›</button></div>`:''}<div class="v3-kpis"><section><span>Thu nhập</span><strong>${money(s.income)}</strong><small>${V.signedPct(V.pctChange(s.income,p.income))} so ${prev.label}</small></section><section><span>Chi phí</span><strong>${money(s.expense)}</strong><small>${V.signedPct(V.pctChange(s.expense,p.expense))} so ${prev.label}</small></section><section><span>Dòng tiền hoạt động</span><strong class="${s.cashFlow>=0?'green':'red'}">${money(s.cashFlow)}</strong><small>Thu nhập − chi phí</small></section><section><span>Tích lũy chuyển vào</span><strong>${acc.toFixed(1)}%</strong><small>Tiết kiệm + đầu tư / thu nhập</small></section></div><div class="v3-health"><div><span>Gánh nặng cố định</span><strong>${fixedRate.toFixed(1)}%</strong><small>Không gồm lãi vay</small></div><div><span>Lãi / phí vay</span><strong>${interestRate.toFixed(1)}%</strong><small>${money(s.loanInterest)} / thu nhập</small></div><div><span>Trả nợ gốc</span><strong>${debtRate.toFixed(1)}%</strong><small>Giảm nghĩa vụ, không phải chi phí</small></div><div><span>Khả năng chi trả</span><strong>${avg?`${coverage.toFixed(1)} tháng`:'—'}</strong><small>Tiền khả dụng / chi phí TB</small></div><button onclick="showFormulaInfo()">Công thức</button></div><div class="v3-two"><section class="v3-card"><div class="v3-card-head"><div><h2>Phân bổ thu nhập</h2><p>${state.analyticsPeriod==='year'?'Cả năm':'Kỳ đang xem'}</p></div></div><div class="donut-layout"><div class="donut-wrap">${donutSvg(allocation)}<div class="donut-center"><span>Thu nhập</span><strong>${money(s.income)}</strong></div></div>${legendHtml(allocation,'income',s.income)}</div></section><section class="v3-card"><div class="v3-card-head"><div><h2>Cơ cấu tài sản hiện tại</h2><p>${state.base}</p></div></div><div class="donut-layout"><div class="donut-wrap">${donutSvg(assets)}<div class="donut-center"><span>Tài sản</span><strong>${money(V.financialPosition().totalAssets)}</strong></div></div>${legendHtml(assets)}</div></section></div><section class="v3-card"><div class="v3-card-head"><div><h2>${state.analyticsPeriod==='year'?'Thu nhập & chi phí 12 tháng':'Chi phí theo danh mục'}</h2><p>Biểu đồ này phải khớp KPI chi phí phía trên</p></div></div><div class="v3-chart">${state.analyticsPeriod==='year'?yearlyBarsV5(state.analyticsYear):expenseBarsV5(txs.filter(V.baseTx))}</div></section><section class="v3-card"><div class="v3-card-head"><div><h2>Tài sản ròng</h2><p>Tài sản + phải thu − nợ</p></div></div><div class="v3-chart">${V.netWorthLine(nw)}</div></section>`;
  }

  V.dashboardV3=dashboardV5;
  V.analyticsV3=analyticsV5;

  const legacyOpenLoan=window.openLoan;
  function bankLoanForm(id=''){
    const l=(state.loans||[]).find(x=>x.id===id)||{},t=V.loanTerms?.(id)||{},isNew=!id,currency=l.currency||state.base,linked=!!id&&(state.fullTransactions||[]).some(x=>x.loan_id===id);
    modal(id?'Sửa vay ngân hàng':'Thêm vay ngân hàng',`<div class="form-grid"><div class="field"><label>Ngân hàng / tổ chức</label><input name="institution_name" value="${esc(t.institution_name||'')}" placeholder="VD: MUFG, SMBC" required autofocus></div><div class="field"><label>Tên sản phẩm</label><input name="product_name" value="${esc(t.product_name||'')}" placeholder="VD: 住宅ローン"></div><div class="field full"><label>Tên khoản vay</label><input name="counterparty" value="${esc(l.counterparty||'')}" placeholder="VD: Vay mua nhà" required></div><div class="field"><label>Tiền tệ</label><select name="currency" ${!isNew?'disabled':''}><option value="JPY" ${currency==='JPY'?'selected':''}>JPY</option><option value="VND" ${currency==='VND'?'selected':''}>VND</option></select>${!isNew?`<input type="hidden" name="currency" value="${esc(currency)}">`:''}</div><div class="field"><label>Tiền gốc</label><input name="principal" type="number" min="1" step="1" value="${esc(l.principal||'')}" ${linked?'readonly':''} required></div>${isNew?`<div class="field"><label>Giải ngân vào</label><select name="funding_account_id" id="v5BankFunding"><option value="">— Chỉ ghi dư nợ —</option></select><small>Nếu tiền thực sự vào tài khoản, chọn tài khoản để tài sản và nợ tăng đồng thời.</small></div>`:''}<div class="field"><label>Lãi suất năm (%)</label><input name="annual_rate" type="number" min="0" step="0.001" value="${esc(t.annual_rate??0)}"></div><div class="field"><label>Cách trả</label><select name="repayment_method" id="v5RepayMethod"><option value="manual" ${(t.repayment_method||'manual')==='manual'?'selected':''}>Theo sao kê ngân hàng</option><option value="equal_payment" ${t.repayment_method==='equal_payment'?'selected':''}>元利均等返済 · tổng đều</option><option value="equal_principal" ${t.repayment_method==='equal_principal'?'selected':''}>元金均等返済 · gốc đều</option></select></div><div class="field"><label>Thời hạn (tháng)</label><input name="term_months" type="number" min="1" step="1" value="${esc(t.term_months||'')}"></div><div class="field"><label>Ngày trả hàng tháng</label><input name="payment_day" type="number" min="1" max="31" value="${esc(t.payment_day||'')}"></div><div class="field"><label>Ngày bắt đầu</label><input name="start_date" type="date" value="${esc(l.start_date||today())}"></div><div class="field"><label>Hạn cuối</label><input name="due_date" type="date" value="${esc(l.due_date||'')}"></div><div class="field full"><label>Ghi chú</label><input name="note" value="${esc(l.note||'')}"></div></div><div class="v4-info-note">元利均等 / 元金均等 chỉ dùng để ước tính. Khi trả thật, nhập đúng gốc và lãi/phí trên sao kê.</div>`,fd=>bankLoanApi('save',{loan_id:id||null,...fd}));
    const funding=$('#v5BankFunding'),currencyEl=$('#modalForm [name="currency"]');
    const syncFunding=()=>{if(!funding)return;const cur=currencyEl?.value||currency;funding.innerHTML='<option value="">— Chỉ ghi dư nợ —</option>'+options(activeAccounts().filter(a=>(a.currency||state.base)===cur&&['cash','bank','savings'].includes(a.account_type)),defaultMoneyAccountId(),a=>`${a.name} · ${a.currency}`)};
    if(currencyEl)currencyEl.onchange=syncFunding;syncFunding();
  }
  window.openBankLoan=()=>bankLoanForm('');
  window.openLoan=function(id='',defaults={}){
    const l=(state.loans||[]).find(x=>x.id===id);
    if((defaults?.loan_kind==='bank')||(l&&V.isBankLoan?.(l)))return bankLoanForm(id);
    return legacyOpenLoan(id,defaults);
  };

  function formulaSelfTestV5(){
    const tests=[],add=(name,actual,expected,tol=1e-6)=>tests.push({name,actual,expected,ok:Number.isFinite(actual)&&Math.abs(actual-expected)<=tol});
    const nw=(balances,receivable=0,borrowed=0)=>balances.reduce((s,x)=>s+(x>0?x:0),0)+receivable-balances.reduce((s,x)=>s+(x<0?-x:0),0)-borrowed;
    add('Thu nhập +100.000 làm tài sản ròng +100.000',nw([100000]),100000);
    add('Chi phí 30.000 từ 100.000 làm tài sản ròng còn 70.000',nw([70000]),70000);
    add('Chuyển 40.000 giữa hai tài khoản không đổi tài sản ròng',nw([60000,40000]),100000);
    add('Vay 100.000: tiền +100.000 và nợ +100.000 → ròng 0',nw([100000],0,100000),0);
    add('Trả 20.000 gốc: tiền và nợ cùng giảm → ròng vẫn 0',nw([80000],0,80000),0);
    add('Trả 20.000 gốc + 1.000 lãi → ròng giảm đúng 1.000',nw([79000],0,80000),-1000);
    add('Cho vay 50.000: tiền 50.000 + phải thu 50.000 = 100.000',nw([50000],50000),100000);
    add('Thu hồi 20.000: tiền 70.000 + phải thu 30.000 = 100.000',nw([70000],30000),100000);
    add('Mua thẻ 10.000: tài sản ròng giảm một lần 10.000',nw([100000,-10000]),90000);
    add('Thanh toán thẻ 10.000: ngân hàng 90.000, thẻ 0 → không giảm lần hai',nw([90000,0]),90000);
    add('Chuyển 30.000 sang đầu tư không đổi tổng tài sản',nw([70000,30000]),100000);
    add('Đầu tư lãi 5.000 làm tài sản ròng tăng 5.000',nw([70000,35000]),105000);
    add('Khoản trả đều 0% = gốc / số tháng',V.annuityPayment(120000,0,12),10000,1e-9);
    add('元利均等: 30 triệu JPY · 1% · 35 năm',V.annuityPayment(30000000,1,420),84685.70968101347,1e-6);
    const firstEqualPrincipal=30000000/420+30000000*(.01/12);add('元金均等: kỳ đầu = gốc đều + lãi dư nợ',firstEqualPrincipal,96428.57142857143,1e-6);
    const r=V.fxRate?.();if(r)add('Quy đổi 1.000 JPY dùng đúng tỷ giá nhập tay',V.toVND(1000,'JPY'),1000*r,1e-6);
    return tests;
  }
  window.runFormulaSelfTest=function(){
    const rows=formulaSelfTestV5(),pass=rows.filter(x=>x.ok).length;
    const dlg=$('#modal'),mb=$('#modalBody'),form=$('#modalForm');mb.innerHTML=`<div class="modal-head"><h3>Kiểm định công thức độc lập</h3><button class="mini-btn" type="button" onclick="document.getElementById('modal').close()">✕</button></div><div class="modal-content"><div class="v4-audit-head ${pass===rows.length?'ok':'bad'}"><strong>${pass}/${rows.length} phép thử PASS</strong><span>Các tình huống đối chứng không dùng số liệu tài chính thật của bạn.</span></div><div class="v4-audit-list">${rows.map(x=>`<div class="${x.ok?'ok':'bad'}"><b>${x.ok?'✓':'×'}</b><span>${esc(x.name)}</span></div>`).join('')}</div></div><div class="modal-actions"><button class="btn primary" type="button" onclick="document.getElementById('modal').close()">Đóng</button></div>`;form.onsubmit=e=>e.preventDefault();dlg.showModal();
  };

  V.formulaVersion='5.0';
})();