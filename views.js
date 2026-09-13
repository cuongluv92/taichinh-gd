function dashboard(){
  const {inc,exp,net}=monthTotals(); const expCats=activeCategories('expense'); const planned=expCats.reduce((a,c)=>a+n(c.planned_amount),0); const fixedPlan=expCats.filter(c=>c.cost_type==='fixed').reduce((a,c)=>a+n(c.planned_amount),0); const varPlan=planned-fixedPlan;
  const breakdown=expCats.map(c=>({...c,actual:actualByCategory(c.id)})).filter(c=>c.actual>0).sort((a,b)=>b.actual-a.actual); const max=Math.max(1,...breakdown.map(x=>x.actual));
  const recent=state.transactions.slice(0,7);
  return `<div class="grid kpi-grid">
    ${kpi('Thu nhập tháng',money(inc),'Tổng tiền đã ghi nhận','green')}${kpi('Chi tiêu tháng',money(exp),planned?`${Math.round(exp/planned*100)}% ngân sách`:'Chưa đặt ngân sách','red')}${kpi('Dòng tiền ròng',money(net),net>=0?'Đang dương':'Đang âm',net>=0?'green':'red')}${kpi('Ngân sách chi',money(planned),`Cố định ${money(fixedPlan)} · Biến động ${money(varPlan)}`,'')}
  </div>
  <div class="grid section-grid">
    <section class="card section"><div class="section-head"><div><h2>Biến động 12 tháng</h2><p>Thu nhập và chi tiêu thực tế</p></div></div><div class="trend">${trendSvg()}</div></section>
    <section class="card section"><div class="section-head"><div><h2>Chi tiêu theo nhóm</h2><p>${state.month.replace('-','/')}</p></div><button class="btn sm" onclick="navigate('budget')">Ngân sách</button></div>
      <div class="breakdown">${breakdown.length?breakdown.slice(0,8).map(x=>`<div class="breakdown-row"><span>${esc(x.name)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4,x.actual/max*100)}%;background:${esc(x.color)}"></div></div><strong>${money(x.actual)}</strong></div>`).join(''):'<div class="empty">Chưa có chi tiêu trong tháng</div>'}</div>
    </section>
  </div>
  <section class="card section" style="margin-top:18px"><div class="section-head"><div><h2>Giao dịch gần đây</h2><p>Trong tháng đang xem</p></div><button class="btn sm primary" onclick="openTransaction()">＋ Thêm</button></div>${txList(recent)}</section>`;
}
function kpi(label,value,sub,cls=''){ return `<section class="card kpi"><div class="label">${label}</div><div class="value ${cls}">${value}</div><div class="sub">${sub}</div></section>`; }

function budget(){
  const cats=activeCategories('expense'); const totalPlan=cats.reduce((a,c)=>a+n(c.planned_amount),0); const totalActual=cats.reduce((a,c)=>a+actualByCategory(c.id),0);
  return `<div class="view-head"><div><h2>Ngân sách tháng ${state.month.replace('-','/')}</h2><p>Mỗi thay đổi chỉ áp dụng từ tháng bạn chọn, lịch sử tháng cũ được giữ nguyên.</p></div><button class="btn primary" onclick="openCategory()">＋ Danh mục</button></div>
  <section class="card section"><div class="section-head"><div class="budget-total"><span>Kế hoạch <strong>${money(totalPlan)}</strong></span><span>Thực tế <strong class="${totalActual>totalPlan&&totalPlan?'red':''}">${money(totalActual)}</strong></span></div><div class="metric-split"><span>Cố định: ${money(cats.filter(c=>c.cost_type==='fixed').reduce((a,c)=>a+n(c.planned_amount),0))}</span><span>Biến động: ${money(cats.filter(c=>c.cost_type==='variable').reduce((a,c)=>a+n(c.planned_amount),0))}</span></div></div>
  <div class="table-wrap"><table class="data-table"><thead><tr><th>Danh mục</th><th>Loại</th><th>Kế hoạch</th><th>Thực tế</th><th>Còn lại</th><th>Áp dụng từ</th><th></th></tr></thead><tbody>${cats.map(c=>{const a=actualByCategory(c.id), left=n(c.planned_amount)-a;return `<tr><td><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${esc(c.color)};margin-right:8px"></span><strong>${esc(c.name)}</strong></td><td><span class="pill ${c.cost_type}">${c.cost_type==='fixed'?'Cố định':'Biến động'}</span></td><td class="amount">${money(c.planned_amount)}</td><td class="amount">${money(a)}</td><td class="amount ${left<0?'red':'green'}">${money(left)}</td><td>${esc(c.effective_month||'—')}</td><td><button class="mini-btn" onclick="openCategory('${c.id}')">✎</button><button class="mini-btn" onclick="archiveCategory('${c.id}')">×</button></td></tr>`}).join('')}</tbody></table></div></section>
  <section class="card section" style="margin-top:18px"><div class="section-head"><div><h2>Danh mục thu nhập</h2><p>Có thể sửa tên theo tháng giống danh mục chi</p></div></div><div class="list">${activeCategories('income').map(c=>`<div class="tx"><div class="tx-icon">＋</div><div class="tx-main"><strong>${esc(c.name)}</strong><span>Thu nhập</span></div><div class="tx-actions"><button class="btn sm" onclick="openCategory('${c.id}')">Sửa</button></div></div>`).join('')}</div></section>`;
}

function transactions(){
  const q=state.search.trim().toLowerCase(); const rows=state.transactions.filter(t=>!q||`${t.category_name||''} ${t.note||''} ${t.account_name||''}`.toLowerCase().includes(q));
  return `<div class="toolbar"><div class="left"><input id="txSearch" class="search" placeholder="Tìm danh mục, ghi chú, tài khoản…" value="${esc(state.search)}" oninput="state.search=this.value;render()"></div><div class="right"><button class="btn primary" onclick="openTransaction()">＋ Giao dịch</button></div></div>
  <section class="card section"><div class="section-head"><div><h2>${rows.length} giao dịch</h2><p>${state.month.replace('-','/')}</p></div></div>${txList(rows,true)}</section>`;
}

function txList(rows, actions=false){
  if(!rows.length) return '<div class="empty">Chưa có giao dịch.</div>';
  return `<div class="list">${rows.map(t=>{const inc=t.transaction_type==='income', transfer=t.transaction_type==='transfer'; const label=transfer?`${t.account_name||'Tài khoản'} → ${t.transfer_account_name||'Tài khoản'}`:(t.category_name||'Chưa phân loại'); return `<div class="tx"><div class="tx-icon">${inc?'↙':transfer?'⇄':'↗'}</div><div class="tx-main"><strong>${esc(label)}</strong><span>${esc(t.transaction_date)}${t.note?` · ${esc(t.note)}`:''}${t.account_name&&!transfer?` · ${esc(t.account_name)}`:''}</span></div><div class="tx-actions"><strong class="amount ${inc?'green':transfer?'':'red'}">${inc?'+':transfer?'':'−'}${money(t.amount,t.currency)}</strong>${actions?`<button class="mini-btn" onclick="openTransaction('${t.id}')">✎</button><button class="mini-btn" onclick="deleteTransaction('${t.id}')">×</button>`:''}</div></div>`}).join('')}</div>`;
}

function accountBalance(a){
  let bal=n(a.opening_balance); (state.fullTransactions||[]).forEach(t=>{ if(t.account_id===a.id){ if(t.transaction_type==='income')bal+=n(t.amount); else if(t.transaction_type==='expense'||t.transaction_type==='transfer')bal-=n(t.amount); } if(t.transaction_type==='transfer'&&t.transfer_account_id===a.id)bal+=n(t.amount); }); return bal;
}
function accounts(){
  const ac=activeAccounts(); return `<div class="view-head"><div><h2>${ac.length} tài khoản</h2><p>Số dư = số dư đầu kỳ + giao dịch đã ghi.</p></div><button class="btn primary" onclick="openAccount()">＋ Tài khoản</button></div><div class="grid account-grid">${ac.map(a=>`<section class="card item-card"><div class="item-menu"><button class="mini-btn" onclick="openAccount('${a.id}')">✎</button><button class="mini-btn" onclick="archiveAccount('${a.id}')">×</button></div><div class="muted">${accountType(a.account_type)}</div><div class="big">${money(accountBalance(a),a.currency)}</div><strong>${esc(a.name)}</strong><div class="muted" style="margin-top:5px">Số dư đầu: ${money(a.opening_balance,a.currency)}</div></section>`).join('')}</div>`;
}
function accountType(t){return ({cash:'Tiền mặt',bank:'Ngân hàng',credit:'Thẻ tín dụng',savings:'Tiết kiệm',investment:'Đầu tư',loan_receivable:'Khoản phải thu',loan_payable:'Khoản phải trả'})[t]||t;}

function goals(){
  return `<div class="grid two-cols"><section><div class="view-head"><div><h2>Mục tiêu tiết kiệm</h2><p>Theo dõi tiến độ từng mục tiêu.</p></div><button class="btn primary" onclick="openGoal()">＋ Mục tiêu</button></div><div class="grid goal-grid" style="grid-template-columns:1fr">${state.goals.length?state.goals.map(g=>{const p=Math.min(100,n(g.current_amount)/Math.max(1,n(g.target_amount))*100);return `<section class="card item-card"><div class="item-menu"><button class="mini-btn" onclick="openGoal('${g.id}')">✎</button><button class="mini-btn" onclick="deleteGoal('${g.id}')">×</button></div><div class="muted">${g.target_date?`Hạn ${esc(g.target_date)}`:'Không đặt hạn'}</div><div class="big">${money(g.current_amount,g.currency)} <small class="muted">/ ${money(g.target_amount,g.currency)}</small></div><strong>${esc(g.name)}</strong><div class="progress"><i style="width:${p}%"></i></div><div class="muted" style="margin-top:6px">${pct(p)} hoàn thành</div></section>`}).join(''):'<div class="card empty">Chưa có mục tiêu.</div>'}</div></section>
  <section><div class="view-head"><div><h2>Vay / cho vay</h2><p>Khoản còn phải thu hoặc phải trả.</p></div><button class="btn primary" onclick="openLoan()">＋ Khoản nợ</button></div><div class="grid goal-grid" style="grid-template-columns:1fr">${state.loans.length?state.loans.map(l=>`<section class="card item-card"><div class="item-menu"><button class="mini-btn" onclick="openLoan('${l.id}')">✎</button><button class="mini-btn" onclick="deleteLoan('${l.id}')">×</button></div><span class="pill ${l.loan_type==='lent'?'income':'expense'}">${l.loan_type==='lent'?'Cho vay':'Đi vay'}</span><div class="big">${money(l.remaining_amount,l.currency)}</div><strong>${esc(l.counterparty)}</strong><div class="muted" style="margin-top:6px">Gốc ${money(l.principal,l.currency)}${l.due_date?` · Hạn ${esc(l.due_date)}`:''}</div></section>`).join(''):'<div class="card empty">Chưa có khoản vay/nợ.</div>'}</div></section></div>`;
}

function settings(){
  return `<div class="grid two-cols"><section class="card settings-card"><h2>Thông tin gia đình</h2><form id="householdForm" class="form-grid"><div class="field"><label>Tên hiển thị</label><input name="name" value="${esc(state.household?.name||'Gia đình')}" required></div><div class="field"><label>Tiền tệ chính</label><select name="base_currency"><option value="JPY" ${state.base==='JPY'?'selected':''}>JPY · Yên Nhật</option><option value="VND" ${state.base==='VND'?'selected':''}>VND · Đồng Việt Nam</option></select></div><div class="field full"><button class="btn primary" type="submit">Lưu cài đặt</button></div></form></section>
  <section class="card settings-card"><h2>Sao lưu & thiết bị</h2><div class="stack"><button class="btn" onclick="exportData()">⇩ Tải bản sao JSON</button><button class="btn" onclick="copyPrivateLink()">⧉ Sao chép link riêng cho thiết bị khác</button><small style="color:var(--muted)">Link riêng chứa khóa trong phần # của URL và không được gửi lên máy chủ Vercel. Chỉ chia sẻ với người trong gia đình.</small></div></section></div>
  <section class="card settings-card danger-zone" style="margin-top:18px"><h2>Khóa trên thiết bị này</h2><p style="color:var(--muted);font-size:13px">Xóa khóa chỉ làm thiết bị hiện tại mất quyền mở app; dữ liệu trong Supabase không bị xóa.</p><button class="btn danger" onclick="forgetDevice()">Xóa khóa khỏi thiết bị</button></section>`;
}

function render(){
  if(!state.household) return; const c=$('#content'); c.innerHTML=({dashboard,budget,transactions,accounts,goals,settings})[state.view]();
  if(state.view==='settings'){ $('#householdForm')?.addEventListener('submit',saveHousehold); }
}