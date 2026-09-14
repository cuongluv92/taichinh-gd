(() => {
  const V=window.__V3=window.__V3||{};
  const BACKUP_RPC=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_backup_api`;

  function goalHasLinkedHistory(id){
    return !!id&&(state.fullTransactions||[]).some(t=>t.goal_id===id&&['goal_save','goal_withdraw'].includes(t.transaction_type));
  }

  const openGoalBefore=window.openGoal;
  if(typeof openGoalBefore==='function'){
    window.openGoal=function(id='',...rest){
      const out=openGoalBefore.call(this,id,...rest);
      if(id&&goalHasLinkedHistory(id)){
        const input=document.querySelector('#modalBody input[name="current_amount"]');
        if(input){
          input.readOnly=true;
          input.setAttribute('aria-readonly','true');
          const field=input.closest('.field');
          const label=field?.querySelector('label');
          if(label)label.textContent='Đã có · tự tính từ giao dịch';
          if(field&&!field.querySelector('[data-final-goal-lock]')){
            const note=document.createElement('small');
            note.dataset.finalGoalLock='1';
            note.textContent='Mục tiêu đã có lịch sử góp/rút nên số này được tính tự động. Muốn thay đổi, hãy ghi góp hoặc rút tiền.';
            field.appendChild(note);
          }
        }
      }
      return out;
    };
  }

  async function fullBackup(){
    if(!state.key)throw new Error('Thiếu khóa gia đình');
    const res=await fetch(BACKUP_RPC,{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},
      body:JSON.stringify({p_key:state.key})
    });
    const text=await res.text();let data;
    try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok){
      const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
      throw new Error(/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.':raw);
    }
    return data;
  }

  window.exportData=async function(){
    try{
      const data=await fullBackup();
      const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      const d=typeof V.localToday==='function'?V.localToday():(typeof today==='function'?today():new Date().toISOString().slice(0,10));
      a.download=`taichinh-gd-full-${d}.json`;
      a.click();
      setTimeout(()=>URL.revokeObjectURL(a.href),1000);
      toast('Đã tạo bản sao đầy đủ');
    }catch(e){
      console.error('Full backup failed',e);
      toast(e.message||'Không tạo được bản sao',true);
    }
  };

  V.fullBackup=fullBackup;
})();
