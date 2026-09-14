(() => {
  const V=window.__V3;
  if(!V) return;

  const investmentAc=()=>activeAccounts().filter(a=>a.account_type==='investment');
  const transferLike=t=>['transfer','goal_save','goal_withdraw'].includes(t.transaction_type);
  const account=id=>(state.accounts||[]).find(a=>a.id===id);
  const cashSide=a=>a&&['cash','bank','savings'].includes(a.account_type);

  function investmentFlows(a,txs=state.fullTransactions||[]){
    let contributed=Math.max(0,n(a.opening_balance)),withdrawn=0,reallocatedIn=0,reallocatedOut=0;
    (txs||[]).forEach(t=>{
      if(!transferLike(t))return;const amt=n(t.amount),from=account(t.account_id),to=account(t.transfer_account_id);
      if(t.transfer_account_id===a.id){if(cashSide(from))contributed+=amt;else if(from?.account_type==='investment')reallocatedIn+=amt}
      if(t.account_id===a.id){if(cashSide(to))withdrawn+=amt;else if(to?.account_type==='investment')reallocatedOut+=amt}
    });
    const netCapital=contributed-withdrawn;
    return {contributed,withdrawn,netCapital,reallocatedIn,reallocatedOut};
  }
  function accountPerformance(a){
    const f=investmentFlows(a),current=accountBalance(a),totalReturn=current+f.withdrawn-f.contributed-f.reallocatedIn+f.reallocatedOut,returnPct=f.contributed>0?totalReturn/f.contributed*100:null;
    return {a,current,...f,totalReturn,returnPct};
  }
  function periodExternalFlows(a,txs){
    let contributed=0,withdrawn=0;
    (txs||[]).forEach(t=>{if(!transferLike(t))return;const amt=n(t.amount),from=account(t.account_id),to=account(t.transfer_account_id);if(t.transfer_account_id===a.id&&cashSide(from))contributed+=amt;if(t.account_id===a.id&&cashSide(to))withdrawn+=amt});
    return {contributed,withdrawn,net:contributed-withdrawn};
  }
  V.investmentFlows=investmentFlows;V.investmentPerformance=accountPerformance;

  function signedMoney(v,c=state.base){return `${v>0?'+':v<0?'−':''}${money(Math.abs(v),c)}`}
  function pct(v){return v===null||!Number.isFinite(v)?'—':`${v>=0?'+':''}${v.toFixed(1)}%`}

  function investmentsAdvanced(){
    const rows=investmentAc().map(accountPerformance),baseRows=rows.filter(x=>(x.a.currency||state.base)===state.base),foreign=rows.filter(x=>(x.a.currency||state.base)!==state.base),period=V.periodTransactions(),periodFlows=baseRows.map(x=>periodExternalFlows(x.a,period));
    const current=baseRows.reduce((s,x)=>s+Math.max(0,n(x.current)),0),contributed=baseRows.reduce((s,x)=>s+n(x.contributed),0),withdrawn=baseRows.reduce((s,x)=>s+n(x.withdrawn),0),netCapital=contributed-withdrawn,totalReturn=current+withdrawn-contributed,returnPct=contributed>0?totalReturn/contributed*100:null,periodIn=periodFlows.reduce((s,x)=>s+x.contributed,0),periodOut=periodFlows.reduce((s,x)=>s+x.withdrawn,0),pie=baseRows.map(x=>({label:x.a.name,value:Math.max(0,x.current)}));
    return `<div class="v3-view-head"><div><h2>Đầu tư</h2><p>Nạp/rút vốn là dòng tiền tài sản; lợi nhuận đã rút ra vẫn được giữ trong hiệu suất tích lũy.</p></div><div><button class="primary" onclick="openInvestmentAccount()">＋ Tài khoản đầu tư</button></div></div>
      <div class="invx-kpis"><section><span>Giá trị hiện tại (${state.base})</span><strong>${money(current)}</strong><small>Giá trị đang còn trong đầu tư</small></section><section><span>Tổng đã nạp</span><strong>${money(contributed)}</strong><small>Gồm vốn đầu + tiền nạp từ tiền dùng</small></section><section><span>Tổng đã rút</span><strong>${money(withdrawn)}</strong><small>Tiền đã quay về tiền mặt/ngân hàng</small></section><section><span>Vốn ròng</span><strong class="${netCapital<0?'green':''}">${signedMoney(netCapital)}</strong><small>Đã nạp − đã rút</small></section><section><span>Tổng lãi / lỗ</span><strong class="${totalReturn>=0?'green':'red'}">${signedMoney(totalReturn)}</strong><small>${pct(returnPct)} trên tổng vốn đã nạp</small></section></div>
      ${foreign.length?`<div class="v3-note">Có ${foreign.length} tài khoản đầu tư ngoại tệ. Hiệu suất tổng ${state.base} không cộng ngoại tệ 1:1.</div>`:''}
      <div class="v3-two"><section class="v3-card"><div class="v3-card-head"><div><h2>Phân bổ đầu tư</h2><p>Theo giá trị hiện tại · ${state.base}</p></div></div><div class="donut-layout"><div class="donut-wrap">${donutSvg(pie)}<div class="donut-center"><span>Đầu tư</span><strong>${money(current)}</strong></div></div>${legendHtml(pie)}</div></section><section class="v3-card"><div class="v3-card-head"><div><h2>Dòng vốn kỳ đang xem</h2><p>Chỉ tính tiền đi giữa đầu tư và tiền dùng</p></div></div><div class="invx-flow"><div><span>Nạp</span><strong>${money(periodIn)}</strong></div><div><span>Rút</span><strong>${money(periodOut)}</strong></div><div><span>Ròng</span><strong class="${periodIn-periodOut>=0?'':'green'}">${signedMoney(periodIn-periodOut)}</strong></div></div><div class="invx-note">Không gọi phần chênh lệch là “đã thực hiện / chưa thực hiện” vì app chưa lưu giá vốn từng lệnh mua bán. Như vậy tránh báo cáo chính xác giả.</div></section></div>
      <section class="v3-account-group"><div class="v3-account-group-head"><h3>Danh mục đầu tư</h3><span>${rows.length} tài khoản</span></div><div class="v3-account-grid">${rows.length?rows.map(x=>`<article class="v3-account"><div class="v3-account-top"><span>Đầu tư · ${esc(x.a.currency||state.base)}</span><button onclick="openAccount('${x.a.id}')">•••</button></div><h3>${esc(x.a.name)}</h3><strong class="${x.current<0?'red':''}">${money(x.current,x.a.currency)}</strong><div class="invx-account-metrics"><div><span>Đã nạp</span><b>${money(x.contributed,x.a.currency)}</b></div><div><span>Đã rút</span><b>${money(x.withdrawn,x.a.currency)}</b></div><div><span>Vốn ròng</span><b>${signedMoney(x.netCapital,x.a.currency)}</b></div><div><span>Tổng lãi/lỗ</span><b class="${x.totalReturn>=0?'green':'red'}">${signedMoney(x.totalReturn,x.a.currency)} · ${pct(x.returnPct)}</b></div></div>${(x.reallocatedIn||x.reallocatedOut)?`<small class="invx-realloc">Có chuyển nội bộ giữa tài khoản đầu tư; hiệu suất từng tài khoản là ước tính, tổng danh mục vẫn đúng.</small>`:''}<div class="v3-account-actions"><button onclick="openInvestmentTransfer('${x.a.id}','in')">＋ Nạp</button><button onclick="openInvestmentTransfer('${x.a.id}','out')">Rút</button><button onclick="openInvestmentValue('${x.a.id}')">Định giá</button></div></article>`).join(''):'<div class="v3-money-empty">Chưa có tài khoản đầu tư.</div>'}</div></section>`;
  }
  V.investmentsV3=investmentsAdvanced;
})();
