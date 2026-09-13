function openGoal(id=''){
  const g=(state.goals||[]).find(x=>x.id===id)||{}; const current=n(g.current_amount);
  const currencyLocked=id&&current>0;
  modal(id?'Sửa mục tiêu':'Thêm mục tiêu',`<div class="form-grid">
    <div class="field full"><label>Tên mục tiêu</label><input name="name" value="${esc(g.name||'')}" required></div>
    <div class="field"><label>Số tiền mục tiêu</label><input name="target_amount" type="number" min="1" value="${esc(g.target_amount||'')}" required></div>
    <div class="field"><label>Tiền tệ</label><select name="currency" ${currencyLocked?'disabled':''}><option value="JPY" ${(g.currency||state.base)==='JPY'?'selected':''}>JPY · Yên Nhật</option><option value="VND" ${(g.currency||state.base)==='VND'?'selected':''}>VND · Đồng Việt Nam</option></select>${currencyLocked?'<small>Đã có tiền trong mục tiêu nên không đổi tiền tệ.</small>':''}</div>
    <div class="field"><label>Ngày mục tiêu</label><input name="target_date" type="date" value="${esc(g.target_date||'')}"></div>
    ${id?`<div class="field"><label>Đã tích lũy</label><input value="${money(current,g.currency||state.base)}" disabled><small>Thay đổi bằng nút Góp tiền / Rút tiền để tài khoản luôn khớp.</small></div>`:''}
    <input type="hidden" name="current_amount" value="${current}">
  </div>`,fd=>api('save_goal',{...fd,id:id||null,currency:currencyLocked?(g.currency||state.base):(fd.currency||state.base),current_amount:current,is_completed:current>=n(fd.target_amount)}));
}

function openLoan(id=''){
  const l=(state.loans||[]).find(x=>x.id===id)||{}; const isNew=!id; const remaining=n(l.remaining_amount);
  modal(id?'Sửa khoản vay/nợ':'Thêm khoản vay/nợ',`<div class="form-grid">
    <div class="field full"><label>Người / đơn vị</label><input name="counterparty" value="${esc(l.counterparty||'')}" required></div>
    <div class="field"><label>Loại</label><select name="loan_type" ${!isNew?'disabled':''}><option value="borrowed" ${(l.loan_type||'borrowed')==='borrowed'?'selected':''}>Đi vay · mình phải trả</option><option value="lent" ${l.loan_type==='lent'?'selected':''}>Cho vay · mình phải thu</option></select></div>
    <div class="field"><label>Tiền tệ</label><select name="currency" ${!isNew?'disabled':''}><option value="JPY" ${(l.currency||state.base)==='JPY'?'selected':''}>JPY</option><option value="VND" ${(l.currency||state.base)==='VND'?'selected':''}>VND</option></select></div>
    <div class="field"><label>Số tiền gốc</label><input name="principal" type="number" min="1" value="${esc(l.principal||'')}" ${!isNew?'readonly':''} required></div>
    ${isNew?`<div class="field"><label>Tài khoản nhận / chi tiền</label><select name="funding_account_id"><option value="">— Chỉ ghi dư nợ —</option>${options(activeAccounts(),defaultMoneyAccountId())}</select><small>Chọn tài khoản để số dư được cộng/trừ tự động.</small></div>`:`<div class="field"><label>Dư còn lại</label><input value="${money(remaining,l.currency||state.base)}" disabled><small>Dùng nút Trả nợ / Thu tiền để cập nhật tự động.</small></div>`}
    <div class="field"><label>Ngày bắt đầu</label><input name="start_date" type="date" value="${esc(l.start_date||today())}"></div>
    <div class="field"><label>Hạn trả</label><input name="due_date" type="date" value="${esc(l.due_date||'')}"></div>
    <div class="field full"><label>Ghi chú</label><input name="note" value="${esc(l.note||'')}"></div>
    ${!isNew?`<input type="hidden" name="loan_type" value="${esc(l.loan_type)}"><input type="hidden" name="currency" value="${esc(l.currency)}"><input type="hidden" name="remaining_amount" value="${remaining}">`:''}
  </div>`,async fd=>{
    const saved=await api('save_loan',{...fd,id:id||null,remaining_amount:isNew?fd.principal:remaining});
    if(isNew&&fd.funding_account_id) await debtApi('open',{loan_id:saved.id,account_id:fd.funding_account_id,amount:fd.principal,transaction_date:fd.start_date||today(),note:fd.note||''});
  });
}

Object.assign(window,{openGoal,openLoan});
