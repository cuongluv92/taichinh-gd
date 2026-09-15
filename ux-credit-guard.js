(() => {
  'use strict';

  const before=window.openAccount;
  if(typeof before!=='function'||before.__creditWorkflowGuard)return;

  function patchAccountModal(id=''){
    const account=(state.accounts||[]).find(a=>a.id===id);
    const type=document.querySelector('#modalBody select[name="account_type"]');
    if(!id&&type){
      type.querySelector('option[value="credit"]')?.remove();
      if(type.value==='credit')type.value='bank';
      const field=type.closest('.field');
      if(field&&!field.querySelector('[data-credit-workflow-note]')){
        const note=document.createElement('small');
        note.dataset.creditWorkflowNote='1';
        note.textContent='Thẻ tín dụng tạo ở Chi tiêu → Thẻ & trả góp.';
        field.appendChild(note);
      }
    }

    if(id&&account?.account_type==='credit'){
      const opening=document.querySelector('#modalBody input[name="opening_balance"]');
      const field=opening?.closest('.field');
      if(field)field.hidden=true;
      document.querySelectorAll('#modalBody small').forEach(s=>{
        if((s.textContent||'').includes('Mục tiêu & nợ'))s.textContent='Khoản vay/nợ mới tạo tại Tài sản → Nợ & phải thu.';
      });
    }
  }

  const guarded=function(id='',...rest){
    const out=before.call(this,id,...rest);
    patchAccountModal(id);
    queueMicrotask(()=>patchAccountModal(id));
    return out;
  };
  Object.defineProperty(guarded,'__creditWorkflowGuard',{value:true});
  guarded.__before=before;
  window.openAccount=guarded;
})();