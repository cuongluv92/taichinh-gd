(() => {
  const SAFE_ACTIONS = new Set([
    'navigate','changeMonth','jumpCurrentMonth','setTxFilter','setAnalyticsPeriod','shiftAnalyticsYear',
    'openQuick','openTransaction','deleteTransaction','openCategory','archiveCategory','openCategoryTransaction',
    'openAccount','archiveAccount','openTransfer','openCreditPayment',
    'openGoal','deleteGoal','openGoalFlow','openLoan','deleteLoan','openLoanPayment',
    'openInvestmentAccount','openInvestmentTransfer','openInvestmentValue',
    'exportData','copyPrivateLink','forgetDevice',
    'openMoreMenu','navigateFromMore','runFinanceDiagnostics','showFormulaInfo',
    'openBankLoan','openBankPayment','runFormulaSelfTest',
    'openAllocationPlan','deleteAllocationPlan'
  ]);

  function splitTopLevel(src, separator=',') {
    const out=[]; let start=0, quote='', escape=false, depth=0;
    for(let i=0;i<src.length;i++){
      const ch=src[i];
      if(quote){
        if(escape){escape=false; continue;}
        if(ch==='\\'){escape=true; continue;}
        if(ch===quote) quote='';
        continue;
      }
      if(ch==='\'' || ch==='"' || ch==='`'){quote=ch; continue;}
      if(ch==='{' || ch==='[' || ch==='('){depth++; continue;}
      if(ch==='}' || ch===']' || ch===')'){depth--; continue;}
      if(ch===separator && depth===0){out.push(src.slice(start,i)); start=i+1;}
    }
    out.push(src.slice(start));
    return out;
  }

  function unquote(token){
    let out='', escape=false;
    for(let i=1;i<token.length-1;i++){
      const ch=token[i];
      if(escape){out += ({n:'\n',r:'\r',t:'\t'}[ch] ?? ch); escape=false;}
      else if(ch==='\\') escape=true;
      else out+=ch;
    }
    return out;
  }

  function findColon(src){
    let quote='', escape=false, depth=0;
    for(let i=0;i<src.length;i++){
      const ch=src[i];
      if(quote){
        if(escape){escape=false; continue;}
        if(ch==='\\'){escape=true; continue;}
        if(ch===quote) quote='';
        continue;
      }
      if(ch==='\'' || ch==='"' || ch==='`'){quote=ch; continue;}
      if(ch==='{' || ch==='[' || ch==='('){depth++; continue;}
      if(ch==='}' || ch===']' || ch===')'){depth--; continue;}
      if(ch===':' && depth===0) return i;
    }
    return -1;
  }

  function parseValue(raw){
    const token=raw.trim();
    if(!token) return undefined;
    if((token[0]==='\'' && token.at(-1)==='\'') || (token[0]==='"' && token.at(-1)==='"')) return unquote(token);
    if(/^-?\d+(?:\.\d+)?$/.test(token)) return Number(token);
    if(token==='true') return true;
    if(token==='false') return false;
    if(token==='null') return null;
    if(token==='undefined') return undefined;
    if(token[0]==='{' && token.at(-1)==='}'){
      const body=token.slice(1,-1).trim(); const obj={};
      if(!body) return obj;
      for(const part of splitTopLevel(body)){
        const idx=findColon(part); if(idx<0) throw new Error('Đối số nút không hợp lệ');
        let key=part.slice(0,idx).trim();
        if((key[0]==='\'' && key.at(-1)==='\'') || (key[0]==='"' && key.at(-1)==='"')) key=unquote(key);
        else if(!/^[A-Za-z_$][\w$]*$/.test(key)) throw new Error('Tên thuộc tính không hợp lệ');
        obj[key]=parseValue(part.slice(idx+1));
      }
      return obj;
    }
    throw new Error('Đối số nút không được hỗ trợ');
  }

  function dispatchInlineAction(spec){
    const code=(spec||'').trim().replace(/;$/,'').trim();
    if(code === "document.getElementById('modal').close()" || code === 'document.getElementById("modal").close()'){
      document.getElementById('modal')?.close(); return;
    }
    const match=code.match(/^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/);
    if(!match) throw new Error('Nút chưa được nối hành động');
    const name=match[1];
    if(!SAFE_ACTIONS.has(name)) throw new Error(`Hành động ${name} chưa được cho phép`);
    const fn=window[name];
    if(typeof fn!=='function') throw new Error(`Hành động ${name} chưa sẵn sàng`);
    const body=match[2].trim();
    const args=body ? splitTopLevel(body).map(parseValue) : [];
    return fn(...args);
  }

  document.addEventListener('click', event => {
    const el=event.target.closest?.('[onclick]');
    if(!el) return;
    const spec=el.getAttribute('onclick');
    if(!spec) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try{
      const result=dispatchInlineAction(spec);
      if(result && typeof result.then==='function') result.catch(err=>{console.error(err); window.toast?.(err.message||'Không thực hiện được',true)});
    }catch(err){
      console.error('Button action failed:', spec, err);
      window.toast?.(err.message||'Nút chưa hoạt động',true);
    }
  }, true);

  window.__dispatchInlineAction = dispatchInlineAction;
})();