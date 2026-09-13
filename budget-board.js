function boardIncomeAmount(categoryId){
  return monthTransactions('income').filter(t=>t.category_id===categoryId).reduce((sum,t)=>sum+n(t.amount)*n(t.fx_rate||1),0);
}

function moneyBoardColumn({title, tone, items, total, addAction, emptyText}){
  return `<section class="card money-column ${tone}">
    <div class="money-column-head">
      <h3>${esc(title)}</h3>
      <button class="column-add" type="button" onclick="${addAction}" aria-label="Thêm">＋</button>
    </div>
    <div class="money-items">
      ${items.length?items.join(''):`<div class="money-empty">${esc(emptyText)}</div>`}
    </div>
    <div class="money-total"><span>Tổng</span><strong>${total}</strong></div>
  </section>`;
}

function budget(){
  const incomeCats=activeCategories('income');
  const expenseCats=activeCategories('expense');
  const fixedCats=expenseCats.filter(c=>c.cost_type==='fixed');
  const variableCats=expenseCats.filter(c=>c.cost_type==='variable');
  const borrowed=(state.loans||[]).filter(l=>l.loan_type==='borrowed'&&n(l.remaining_amount)>0);
  const totals=monthTotals();

  const incomeItems=incomeCats.map(c=>`<button class="money-line" type="button" onclick="openCategory('${c.id}')"><span>${esc(c.name)}</span><strong>${money(boardIncomeAmount(c.id))}</strong></button>`);
  const fixedItems=fixedCats.map(c=>`<button class="money-line" type="button" onclick="openCategory('${c.id}')"><span>${esc(c.name)}</span><strong>${money(c.planned_amount)}</strong></button>`);
  const variableItems=variableCats.map(c=>`<button class="money-line" type="button" onclick="openCategory('${c.id}')"><span>${esc(c.name)}</span><strong>${money(c.planned_amount)}</strong></button>`);
  const debtItems=borrowed.map(l=>`<button class="money-line" type="button" onclick="openLoan('${l.id}')"><span>${esc(l.counterparty)}</span><strong>${money(l.remaining_amount,l.currency||state.base)}</strong></button>`);

  const fixedTotal=fixedCats.reduce((sum,c)=>sum+n(c.planned_amount),0);
  const variableTotal=variableCats.reduce((sum,c)=>sum+n(c.planned_amount),0);
  const debtTotal=borrowed.reduce((sum,l)=>sum+n(l.remaining_amount),0);

  return `<div class="finance-view-head">
    <div><h2>Tháng ${state.month.replace('-','/')}</h2><p>Nhấn trực tiếp vào từng mục để chỉnh tên hoặc số tiền.</p></div>
    <div class="finance-actions"><button class="btn" onclick="openCategory()">＋ Danh mục</button><button class="btn primary" onclick="openTransaction()">＋ Giao dịch</button></div>
  </div>

  <section class="balance-card ${totals.net<0?'negative':''}">
    <div><span>Cân đối tháng</span><strong>${money(totals.net)}</strong></div>
    <small>Thu nhập trừ chi tiêu đã ghi nhận trong tháng</small>
  </section>

  <div class="money-board">
    ${moneyBoardColumn({title:'Thu nhập',tone:'income',items:incomeItems,total:money(totals.inc),addAction:"openCategory()",emptyText:'Chưa có mục thu nhập'})}
    ${moneyBoardColumn({title:'Chi cố định',tone:'fixed',items:fixedItems,total:money(fixedTotal),addAction:"openCategory()",emptyText:'Chưa có chi cố định'})}
    ${moneyBoardColumn({title:'Chi biến động',tone:'variable',items:variableItems,total:money(variableTotal),addAction:"openCategory()",emptyText:'Chưa có chi biến động'})}
    ${moneyBoardColumn({title:'Nợ',tone:'debt',items:debtItems,total:money(debtTotal),addAction:"openLoan()",emptyText:'Chưa có khoản nợ'})}
  </div>`;
}
