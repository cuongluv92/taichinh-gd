function shiftMonth(month, delta){
  const [y,m]=month.split('-').map(Number); const d=new Date(y,m-1+delta,1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function summaryFor(month){
  const row=(state.monthlySummary||[]).find(x=>String(x.month).slice(0,7)===month);
  if(row) return {inc:n(row.income),exp:n(row.expense),net:n(row.income)-n(row.expense)};
  if(month===state.month) return monthTotals();
  return {inc:0,exp:0,net:0};
}
function compareBadge(current, previous, inverse=false){
  if(!previous && !current) return '<span class="compare neutral">Chưa có dữ liệu tháng trước</span>';
  if(!previous) return '<span class="compare neutral">Tháng đầu có dữ liệu</span>';
  const diff=(current-previous)/Math.abs(previous)*100; const good=inverse?diff<=0:diff>=0; const cls=Math.abs(diff)<.5?'neutral':good?'up':'down';
  return `<span class="compare ${cls}">${diff>=0?'▲':'▼'} ${Math.abs(diff).toFixed(1)}% so với tháng trước</span>`;
}
function dashboard(){
  const cur=monthTotals(), prev=summaryFor(shiftMonth(state.month,-1));
  const expCats=activeCategories('expense'); const planned=expCats.reduce((a,c)=>a+n(c.planned_amount),0); const fixedPlan=expCats.filter(c=>c.cost_type==='fixed').reduce((a,c)=>a+n(c.planned_amount),0); const varPlan=planned-fixedPlan;
  const breakdown=expCats.map(c=>({...c,actual:actualByCategory(c.id)})).filter(c=>c.actual>0).sort((a,b)=>b.actual-a.actual); const max=Math.max(1,...breakdown.map(x=>x.actual));
  const recent=state.transactions.slice(0,7); const savingRate=cur.inc>0?Math.max(-999,cur.net/cur.inc*100):0; const remain=planned-cur.exp;
  return `<div class="grid kpi-grid">
    <section class="card kpi"><div class="label">Thu nhập tháng</div><div class="value green">${money(cur.inc)}</div>${compareBadge(cur.inc,prev.inc)}</section>
    <section class="card kpi"><div class="label">Chi tiêu tháng</div><div class="value red">${money(cur.exp)}</div>${compareBadge(cur.exp,prev.exp,true)}</section>
    <section class="card kpi"><div class="label">Dòng tiền ròng</div><div class="value ${cur.net>=0?'green':'red'}">${money(cur.net)}</div>${compareBadge(cur.net,prev.net)}</section>
    <section class="card kpi"><div class="label">Tỷ lệ tiết kiệm</div><div class="value ${savingRate>=0?'green':'red'}">${savingRate.toFixed(1)}%</div><div class="sub">Phần thu nhập còn lại sau chi tiêu</div></section>
  </div>
  <div class="summary-strip">
    <div class="summary-box"><span>Ngân sách chi</span><strong>${money(planned)}</strong></div>
    <div class="summary-box"><span>Còn lại ngân sách</span><strong class="${remain<0?'red':'green'}">${money(remain)}</strong></div>
    <div class="summary-box"><span>Cố định / Biến động</span><strong>${money(fixedPlan)} / ${money(varPlan)}</strong></div>
  </div>
  <div class="grid section-grid">
    <section class="card section"><div class="section-head"><div><h2>Biến động 12 tháng</h2><p>Thu nhập và chi tiêu thực tế, nhìn nhanh xu hướng từng tháng</p></div></div><div class="trend">${trendSvg()}</div></section>
    <section class="card section"><div class="section-head"><div><h2>Chi tiêu theo nhóm</h2><p>Tháng ${state.month.replace('-','/')}</p></div><button class="btn sm" onclick="navigate('budget')">Xem ngân sách</button></div>
      <div class="breakdown">${breakdown.length?breakdown.slice(0,8).map(x=>`<div class="breakdown-row"><span><b style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${esc(x.color)};margin-right:7px"></b>${esc(x.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4,x.actual/max*100)}%;background:${esc(x.color)}"></div></div><strong>${money(x.actual)}</strong></div>`).join(''):'<div class="empty">Chưa có chi tiêu trong tháng này.</div>'}</div>
    </section>
  </div>
  <section class="card section" style="margin-top:18px"><div class="section-head"><div><h2>Giao dịch gần đây</h2><p>7 giao dịch mới nhất của tháng đang xem</p></div><button class="btn sm primary" onclick="openTransaction()">＋ Thêm giao dịch</button></div>${txList(recent)}</section>`;
}

function budget(){
  const cats=activeCategories('expense'); const totalPlan=cats.reduce((a,c)=>a+n(c.planned_amount),0); const totalActual=cats.reduce((a,c)=>a+actualByCategory(c.id),0); const remain=totalPlan-totalActual;
  const rows=cats.map(c=>{const actual=actualByCategory(c.id), plan=n(c.planned_amount), left=plan-actual, used=plan>0?actual/plan*100:(actual>0?100:0), over=plan>0&&actual>plan;return `<div class="budget-row">
    <div class="budget-name"><strong><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${esc(c.color)};margin-right:8px"></span>${esc(c.name)}</strong><small>Áp dụng từ ${esc(String(c.effective_month||'—').slice(0,7))}</small></div>
    <div class="budget-cell type-cell"><small>Loại</small><span class="pill ${c.cost_type}">${c.cost_type==='fixed'?'Cố định':'Biến động'}</span></div>
    <div class="budget-cell"><small>Kế hoạch</small><strong>${money(plan)}</strong></div>
    <div class="budget-cell"><small>Thực tế</small><strong>${money(actual)}</strong></div>
    <div class="budget-cell"><small>Còn lại</small><strong class="${left<0?'red':'green'}">${money(left)}</strong></div>
    <div class="budget-actions"><button class="mini-btn" title="Sửa" onclick="openCategory('${c.id}')">✎</button><button class="mini-btn" title="Ẩn" onclick="archiveCategory('${c.id}')">×</button></div>
    <div class="budget-progress" title="Đã dùng ${Math.round(used)}%"><i class="${over?'over':''}" style="width:${Math.min(100,Math.max(0,used))}%"></i></div>
  </div>`}).join('');
  return `<div class="view-head"><div><h2>Ngân sách tháng ${state.month.replace('-','/')}</h2><p>Sửa số tiền hoặc đổi Cố định ↔ Biến động từ tháng bạn chọn; các tháng cũ không bị đổi.</p></div><button class="btn primary" onclick="openCategory()">＋ Danh mục</button></div>
  <div class="summary-strip"><div class="summary-box"><span>Kế hoạch</span><strong>${money(totalPlan)}</strong></div><div class="summary-box"><span>Đã chi</span><strong class="${totalActual>totalPlan&&totalPlan?'red':''}">${money(totalActual)}</strong></div><div class="summary-box"><span>Còn lại</span><strong class="${remain<0?'red':'green'}">${money(remain)}</strong></div></div>
  <section class="card section"><div class="section-head"><div><h2>Danh mục chi tiêu</h2><p>${cats.filter(c=>c.cost_type==='fixed').length} cố định · ${cats.filter(c=>c.cost_type==='variable').length} biến động</p></div></div><div class="budget-list">${rows||'<div class="empty">Chưa có danh mục chi tiêu.</div>'}</div></section>
  <section class="card section" style="margin-top:18px"><div class="section-head"><div><h2>Danh mục thu nhập</h2><p>Tên danh mục cũng có thể thay đổi theo tháng.</p></div><button class="btn sm" onclick="openCategory()">＋ Thêm</button></div><div class="list">${activeCategories('income').length?activeCategories('income').map(c=>`<div class="tx"><div class="tx-icon">＋</div><div class="tx-main"><strong>${esc(c.name)}</strong><span>Thu nhập</span></div><div class="tx-actions"><button class="btn sm" onclick="openCategory('${c.id}')">Sửa</button></div></div>`).join(''):'<div class="empty">Chưa có danh mục thu nhập.</div>'}</div></section>`;
}

function setTxFilter(v){state.txFilter=v;render()}
function transactions(){
  state.txFilter=state.txFilter||'all'; const q=state.search.trim().toLowerCase();
  const rows=state.transactions.filter(t=>(state.txFilter==='all'||t.transaction_type===state.txFilter)&&(!q||`${t.category_name||''} ${t.note||''} ${t.account_name||''} ${t.transfer_account_name||''}`.toLowerCase().includes(q)));
  const counts={all:state.transactions.length,expense:state.transactions.filter(t=>t.transaction_type==='expense').length,income:state.transactions.filter(t=>t.transaction_type==='income').length,transfer:state.transactions.filter(t=>t.transaction_type==='transfer').length};
  return `<div class="toolbar"><div class="left" style="flex:1"><input id="txSearch" class="search" placeholder="Tìm theo danh mục, ghi chú hoặc tài khoản…" value="${esc(state.search)}" oninput="state.search=this.value;render()"></div><div class="right"><button class="btn primary" onclick="openTransaction()">＋ Giao dịch</button></div></div>
  <div class="filter-tabs" style="margin-bottom:14px"><button class="filter-tab ${state.txFilter==='all'?'active':''}" onclick="setTxFilter('all')">Tất cả ${counts.all}</button><button class="filter-tab ${state.txFilter==='expense'?'active':''}" onclick="setTxFilter('expense')">Chi ${counts.expense}</button><button class="filter-tab ${state.txFilter==='income'?'active':''}" onclick="setTxFilter('income')">Thu ${counts.income}</button><button class="filter-tab ${state.txFilter==='transfer'?'active':''}" onclick="setTxFilter('transfer')">Chuyển ${counts.transfer}</button></div>
  <section class="card section"><div class="section-head"><div><h2>${rows.length} giao dịch đang hiển thị</h2><p>Tháng ${state.month.replace('-','/')}</p></div></div>${txList(rows,true)}</section>`;
}

async function changeMonth(delta){
  const m=shiftMonth(state.month,delta); try{setLoading(true);$('#monthPicker').value=m;await loadMonth(m);toast(`Đã chuyển sang ${m.replace('-','/')}`)}catch(e){toast(e.message,true)}finally{setLoading(false)}
}
function jumpCurrentMonth(){const m=new Date().toISOString().slice(0,7);$('#monthPicker').value=m;loadMonth(m)}
Object.assign(window,{setTxFilter,changeMonth,jumpCurrentMonth});