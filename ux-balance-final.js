(() => {
  'use strict';
  const V=window.__V3||{};
  const moneyFmt=(v,c=state.base)=>typeof window.money==='function'?window.money(v,c):`${Math.round(Number(v||0)).toLocaleString()} ${c}`;
  const monthKey=v=>String(v||'').slice(0,7);
  const plannedIncome=()=>typeof activeCategories==='function'?activeCategories('income').reduce((s,c)=>s+Number(c.planned_amount||0),0):0;
  const pctText=(v,b)=>b>0?`${(Number(v||0)/b*100).toFixed(1)}%`:'—';

  function loanMonthInfo(l){
    const txs=typeof V.periodTransactions==='function'?V.periodTransactions('month',state.month):(state.transactions||[]);
    const rows=txs.filter(t=>t.loan_id===l.id);
    const principal=rows.filter(t=>t.transaction_type==='loan_pay').reduce((s,t)=>s+Number(t.amount||0),0);
    const interest=rows.filter(t=>t.transaction_type==='loan_interest').reduce((s,t)=>s+Number(t.amount||0),0);
    const paid=principal+interest;
    if(paid>0)return {amount:paid,note:`Đã trả tháng này · dư ${moneyFmt(l.remaining_amount,l.currency||state.base)}`};
    if(monthKey(l.due_date)===state.month)return {amount:Number(l.remaining_amount||0),note:'Đến hạn trong tháng này'};
    if(typeof V.isBankLoan==='function'&&V.isBankLoan(l)&&typeof V.bankEstimate==='function'){
      const at=typeof V.endOfMonthDate==='function'?V.endOfMonthDate(state.month):`${state.month}-28`;
      const est=V.bankEstimate(l,at),amount=Number(est?.total||0);
      if(amount>0)return {amount,note:`Dự kiến kỳ này · dư ${moneyFmt(l.remaining_amount,l.currency||state.base)}`};
    }
    return {amount:0,note:`Dư nợ ${moneyFmt(l.remaining_amount,l.currency||state.base)}`};
  }

  function openDebtManager(){
    const rows=(state.loans||[]).filter(l=>l.loan_type==='borrowed'&&Number(l.remaining_amount||0)>0);
    modal('Cài đặt · Nợ phải trả',`<div class="balance-debt-manager"><div class="budget-version-note"><b>Nợ phải trả nằm trong Chi tiêu</b><span>Cột này hiển thị số phải thanh toán của tháng đang xem. Dư nợ còn lại chỉ để tham khảo, không bị tính thành chi tiêu tháng.</span></div><div class="balance-debt-manager-list">${rows.length?rows.map(l=>`<div class="balance-debt-manager-row"><div><strong>${esc(l.counterparty||'Khoản nợ')}</strong><small>Dư nợ ${moneyFmt(l.remaining_amount,l.currency||state.base)}</small></div><button type="button" class="btn sm" data-balance-debt-edit="${esc(l.id)}">Sửa</button></div>`).join(''):'<div class="budget-settings-empty">Chưa có khoản nợ phải trả.</div>'}</div><button type="button" class="btn primary" data-balance-debt-add>＋ Thêm khoản nợ</button></div>`,async()=>{},'Đóng');
  }

  function forceDebtColumn(){
    if(state.view!=='budget')return;
    const board=document.querySelector('#content .v3-budget-board');if(!board)return;
    board.querySelectorAll('.v3-money-col.debt').forEach(x=>x.remove());
    const loans=(state.loans||[]).filter(l=>l.loan_type==='borrowed'&&Number(l.remaining_amount||0)>0);
    const basis=plannedIncome()||Number(typeof V.statsFor==='function'&&typeof V.periodTransactions==='function'?V.statsFor(V.periodTransactions('month',state.month)).income:0);
    const sums=new Map();
    const items=loans.map(l=>{
      const cur=l.currency||state.base,info=loanMonthInfo(l);sums.set(cur,(sums.get(cur)||0)+Number(info.amount||0));
      const ratio=cur===state.base&&info.amount>0?`<small class="ux-income-pct">${pctText(info.amount,basis)}</small>`:cur!==state.base?'<small class="ux-income-pct">ngoại tệ</small>':'';
      return `<button type="button" data-balance-debt-pay="${esc(l.id)}"><span class="ux-money-label">${esc(l.counterparty||'Khoản nợ')}<small>${esc(info.note)}</small></span><strong>${info.amount>0?moneyFmt(info.amount,cur):moneyFmt(0,cur)}${ratio}</strong></button>`;
    }).join('');
    const baseDue=Number(sums.get(state.base)||0);
    const total=[...sums.entries()].filter(([,v])=>Math.abs(v)>.001).map(([c,v])=>moneyFmt(v,c)).join(' · ')||moneyFmt(0,state.base);
    const col=document.createElement('section');
    col.className='v3-money-col debt balance-debt-col';
    col.innerHTML=`<div class="v3-money-head"><h3>Nợ phải trả</h3><small class="budget-col-hint">Phải thanh toán trong tháng</small><button type="button" data-balance-debt-settings>⚙ Cài đặt</button></div><div class="v3-money-list">${items||'<div class="v3-money-empty">Chưa có khoản nợ<br><small>Nhấn Cài đặt để thêm</small></div>'}</div><div class="v3-money-total"><span>Tháng này</span><strong>${total}<small class="ux-income-pct">${pctText(baseDue,basis)}</small></strong></div>`;
    const credit=board.querySelector('.v3-money-col.credit,.ux-credit-col');
    credit?credit.insertAdjacentElement('afterend',col):board.append(col);
  }

  function txLabel(t){
    if(t.category_id&&typeof V.categoryVersionAt==='function'){
      const c=V.categoryVersionAt(t.category_id,t.transaction_date);if(c?.name)return c.name;
    }
    const map={income:'Thu nhập',expense:'Chi tiêu',transfer:'Chuyển khoản',loan_pay:'Trả nợ',loan_interest:'Lãi vay',loan_borrow:'Vay tiền',loan_collect:'Thu hồi nợ',loan_lend:'Cho vay',loan_out:'Cho vay',investment_gain:'Lãi đầu tư',investment_loss:'Lỗ đầu tư'};
    return map[t.transaction_type]||'Giao dịch';
  }
  function txTone(t){return t.transaction_type==='income'||['loan_borrow','loan_collect','investment_gain'].includes(t.transaction_type)?'income':t.transaction_type==='transfer'?'transfer':'expense'}
  function txSign(t){return txTone(t)==='income'?'+':txTone(t)==='expense'?'-':'⇄'}
  function accountName(id){return (state.accounts||[]).find(a=>a.id===id)?.name||''}

  function recentTransactionsCard(){
    const txs=(typeof V.periodTransactions==='function'?V.periodTransactions('month',state.month):(state.fullTransactions||[]).filter(t=>monthKey(t.transaction_date)===state.month)).slice().sort((a,b)=>String(b.transaction_date||'').localeCompare(String(a.transaction_date||''))||String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,8);
    const card=document.createElement('section');card.className='v3-card balance-recent-card';
    card.innerHTML=`<div class="v3-card-head"><div><h2>Giao dịch gần đây</h2><p>${state.month.replace('-','/')} · 8 giao dịch mới nhất</p></div><button type="button" class="v3-link" data-balance-quick>＋ Nhập</button></div><div class="balance-recent-list">${txs.length?txs.map(t=>{const tone=txTone(t),cur=t.currency||state.base,acc=accountName(t.account_id),date=String(t.transaction_date||'').slice(5,10).replace('-','/');return `<button type="button" data-balance-tx="${esc(t.id)}"><span class="balance-tx-icon ${tone}">${txSign(t)}</span><span class="balance-tx-main"><b>${esc(txLabel(t))}</b><small>${esc(date)}${acc?` · ${esc(acc)}`:''}${t.note?` · ${esc(t.note)}`:''}</small></span><strong class="${tone}">${txSign(t)==='⇄'?'':txSign(t)}${moneyFmt(t.amount,cur)}</strong></button>`}).join(''):'<div class="balance-empty"><b>Chưa có giao dịch trong tháng này</b><span>Dùng “＋ Nhập nhanh” để ghi thu hoặc chi. Kế hoạch vẫn được giữ riêng, không bị coi là tiền thực tế.</span></div>'}</div>`;
    return card;
  }

  function expenseBreakdownCard(){
    const txs=typeof V.periodTransactions==='function'?V.periodTransactions('month',state.month):[],rows=typeof V.expenseByCategory==='function'?V.expenseByCategory(txs):[],total=rows.reduce((s,x)=>s+Number(x.value||0),0),max=Math.max(1,...rows.map(x=>Number(x.value||0)));
    const card=document.createElement('section');card.className='v3-card balance-expense-card';
    card.innerHTML=`<div class="v3-card-head"><div><h2>Cơ cấu chi tiêu tháng</h2><p>Chi thực tế theo danh mục · không tính chuyển khoản/trả gốc nợ hai lần</p></div></div><div class="balance-expense-list">${rows.length?rows.slice(0,7).map(x=>`<div class="balance-expense-row"><div><span>${esc(x.label)}</span><strong>${moneyFmt(x.value)}</strong></div><div class="balance-bar"><i style="width:${Math.max(2,Number(x.value||0)/max*100).toFixed(1)}%"></i></div><small>${pctText(x.value,total)} chi tiêu</small></div>`).join(''):'<div class="balance-empty"><b>Chưa có chi tiêu thực tế</b><span>Khi bạn ghi chi, cơ cấu theo danh mục sẽ tự xuất hiện ở đây.</span></div>'}</div>`;
    return card;
  }

  function findCard(title){return [...document.querySelectorAll('#content .v3-card')].find(x=>(x.querySelector('h2')?.textContent||'').trim()===title)}
  function dashboardLayout(){
    if(state.view!=='dashboard')return;
    const root=document.querySelector('#content .v7-dashboard')||document.querySelector('#content');if(!root)return;
    document.querySelectorAll('#content .balance-primary-grid,#content .balance-chart-grid,#content .balance-bottom-grid').forEach(grid=>{[...grid.children].forEach(x=>root.append(x));grid.remove()});
    document.querySelectorAll('#content .balance-recent-card,#content .balance-expense-card').forEach(x=>x.remove());
    document.querySelectorAll('#content .v3-card,#content .pro-card').forEach(card=>{const t=(card.querySelector('h2')?.textContent||'').trim();if(['Việc cần chú ý','Góc nhìn nhanh','Phân bổ thu nhập'].includes(t))card.remove()});
    document.querySelectorAll('#content .ux-salary-strip,#content .v3-hero').forEach(x=>x.remove());

    const focus=root.querySelector('.v7-focus'),kpis=root.querySelector('.v3-kpis'),planCard=root.querySelector('.ux-plan');
    if(kpis&&typeof V.financialPosition==='function'){
      const end=typeof V.endOfMonthDate==='function'?V.endOfMonthDate(state.month):'9999-12-31',pos=V.financialPosition(end),cards=[...kpis.children];
      if(cards[0]){cards[0].querySelector('span').textContent='Tài sản ròng';cards[0].querySelector('strong').textContent=moneyFmt(pos.netWorth);cards[0].querySelector('small').textContent=`Tổng nợ ${moneyFmt(pos.totalLiabilities)}`}
      if(cards[1]){cards[1].querySelector('span').textContent='Tiền khả dụng';cards[1].querySelector('strong').textContent=moneyFmt(pos.liquid);cards[1].querySelector('strong').classList.remove('red');cards[1].querySelector('small').textContent='Tiền mặt · ngân hàng · tiết kiệm'}
    }

    const recent=recentTransactionsCard();
    if(planCard){const grid=document.createElement('div');grid.className='balance-primary-grid';grid.append(planCard,recent);kpis?.insertAdjacentElement('afterend',grid)||root.append(grid)}else root.append(recent);

    let flow=findCard('Thu nhập & chi tiêu 12 tháng'),net=findCard('Tài sản ròng 12 tháng');
    if(flow||net){const grid=document.createElement('div');grid.className='balance-chart-grid';if(flow)grid.append(flow);if(net)grid.append(net);(root.querySelector('.balance-primary-grid')||kpis||focus)?.insertAdjacentElement('afterend',grid)||root.append(grid)}

    const asset=findCard('Tiền đang nằm ở đâu'),expense=expenseBreakdownCard();
    const bottom=document.createElement('div');bottom.className='balance-bottom-grid';if(asset)bottom.append(asset);bottom.append(expense);root.append(bottom);
    document.querySelectorAll('#content .v3-two').forEach(g=>{if(!g.children.length)g.remove();else if(g.children.length===1){const child=g.firstElementChild;g.replaceWith(child)}});
  }

  function afterRender(){forceDebtColumn();dashboardLayout()}
  const renderBefore=window.render;
  if(typeof renderBefore==='function'&&!renderBefore.__uxBalanceFinal){const wrapped=function(...args){const out=renderBefore.apply(this,args);queueMicrotask(afterRender);return out};Object.defineProperty(wrapped,'__uxBalanceFinal',{value:true});window.render=wrapped}

  document.addEventListener('click',e=>{
    if(e.target.closest?.('[data-balance-debt-settings]')){e.preventDefault();return openDebtManager()}
    if(e.target.closest?.('[data-balance-debt-add]')){e.preventDefault();document.getElementById('modal')?.close();return window.openLoan?.()}
    const edit=e.target.closest?.('[data-balance-debt-edit]');if(edit){e.preventDefault();document.getElementById('modal')?.close();return window.openLoan?.(edit.dataset.balanceDebtEdit)}
    const pay=e.target.closest?.('[data-balance-debt-pay]');if(pay){e.preventDefault();const id=pay.dataset.balanceDebtPay,l=(state.loans||[]).find(x=>x.id===id);if(!l)return;const bank=typeof V.isBankLoan==='function'&&V.isBankLoan(l);if(bank&&typeof window.openBankPayment==='function')return window.openBankPayment(id);return window.openLoanPayment?.(id)}
    if(e.target.closest?.('[data-balance-quick]')){e.preventDefault();return window.openQuick?.('expense')||window.openTransaction?.()}
    const tx=e.target.closest?.('[data-balance-tx]');if(tx){e.preventDefault();return window.openTransaction?.(tx.dataset.balanceTx)}
  },true);

  queueMicrotask(afterRender);
})();