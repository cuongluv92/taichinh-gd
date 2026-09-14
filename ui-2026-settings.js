(() => {
  if(!document.querySelector('link[href="/ui-2026-compact.css"]')){
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='/ui-2026-compact.css';
    document.head.appendChild(link);
  }

  const ORDER_RPC=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_category_order_api`;
  let saving=false;

  function sortValue(c){
    const raw=c?.sort_order;
    if(raw===null||raw===undefined||raw==='')return Number.MAX_SAFE_INTEGER;
    const v=Number(raw);
    return Number.isFinite(v)?v:Number.MAX_SAFE_INTEGER;
  }

  function ordered(direction){
    return (window.state?.categories||[])
      .filter(c=>c&&c.is_active!==false&&c.direction===direction)
      .map((c,i)=>({c,i}))
      .sort((a,b)=>sortValue(a.c)-sortValue(b.c)||a.i-b.i)
      .map(x=>x.c);
  }

  function currentPayload(){
    return {
      income:ordered('income').map(c=>c.id),
      expense:ordered('expense').map(c=>c.id)
    };
  }

  function groupDirection(group){
    const label=(group.querySelector('.settings-cat-title strong')?.textContent||'').trim().toLowerCase();
    if(label.includes('thu'))return 'income';
    if(label.includes('chi'))return 'expense';
    return null;
  }

  function makeArrow(direction,index,id,move,total){
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='mini-btn ui-order-arrow';
    btn.dataset.uiInlineOrder='1';
    btn.dataset.uiOrderDir=direction;
    btn.dataset.uiOrderIndex=String(index);
    btn.dataset.uiOrderId=String(id||'');
    btn.dataset.uiOrderMove=move;
    btn.textContent=move==='up'?'↑':'↓';
    btn.title=move==='up'?'Đưa lên':'Đưa xuống';
    btn.setAttribute('aria-label',btn.title);
    btn.disabled=saving||(move==='up'?index===0:index===total-1);
    return btn;
  }

  function patchVisibleCategoryRows(){
    if(!window.state||state.view!=='settings')return;
    document.querySelector('[data-ui-category-order-card]')?.remove();
    const panel=document.querySelector('.categories-panel');
    if(!panel)return;

    const subtitle=panel.querySelector('.panel-title p');
    if(subtitle)subtitle.textContent='Sửa tên, cố định/biến động, ẩn hoặc dùng ↑ ↓ để đổi thứ tự';

    panel.querySelectorAll('.settings-cat-group').forEach(group=>{
      const direction=groupDirection(group);
      if(!direction)return;
      const cats=ordered(direction);
      const rows=[...group.querySelectorAll('.settings-cat-row')];
      rows.forEach((row,index)=>{
        const actions=row.lastElementChild;
        const cat=cats[index];
        if(!actions||!cat)return;
        actions.querySelectorAll('[data-ui-inline-order]').forEach(x=>x.remove());
        const up=makeArrow(direction,index,cat.id,'up',rows.length);
        const down=makeArrow(direction,index,cat.id,'down',rows.length);
        actions.prepend(down);
        actions.prepend(up);
      });
    });
  }

  async function moveAndSave(direction,id,delta){
    if(saving)return;
    const payload=currentPayload();
    const arr=payload[direction];
    if(!Array.isArray(arr))return;
    const index=arr.indexOf(id);
    const next=index+delta;
    if(index<0||next<0||next>=arr.length)return;
    [arr[index],arr[next]]=[arr[next],arr[index]];

    saving=true;
    patchVisibleCategoryRows();
    try{
      if(typeof window.setLoading==='function')window.setLoading(true);
      const res=await fetch(ORDER_RPC,{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},
        body:JSON.stringify({p_key:state.key,p_payload:payload})
      });
      const text=await res.text();let data;
      try{data=text?JSON.parse(text):null}catch{data=text}
      if(!res.ok){
        const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
        throw new Error(/category_order_stale_refresh/i.test(raw)?'Danh mục vừa thay đổi. Hãy tải lại rồi thử lại.'
          :/invalid_category_order/i.test(raw)?'Thứ tự danh mục không hợp lệ.'
          :/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.'
          :raw);
      }
      if(typeof window.refresh==='function')await window.refresh();
      if(typeof window.toast==='function')window.toast('Đã đổi thứ tự danh mục');
    }catch(e){
      if(typeof window.toast==='function')window.toast(e.message||'Không đổi được thứ tự',true);
    }finally{
      saving=false;
      if(typeof window.setLoading==='function')window.setLoading(false);
      queueMicrotask(patchVisibleCategoryRows);
    }
  }

  document.addEventListener('click',e=>{
    const btn=e.target.closest?.('[data-ui-inline-order]');
    if(!btn)return;
    e.preventDefault();
    e.stopPropagation();
    const direction=btn.dataset.uiOrderDir;
    const id=btn.dataset.uiOrderId;
    const delta=btn.dataset.uiOrderMove==='up'?-1:1;
    moveAndSave(direction,id,delta);
  });

  const previousRender=window.render;
  if(typeof previousRender==='function'){
    window.render=function(...args){
      const out=previousRender.apply(this,args);
      queueMicrotask(patchVisibleCategoryRows);
      return out;
    };
  }

  const start=()=>{
    const content=document.getElementById('content');
    if(content){
      const observer=new MutationObserver(()=>{
        if(window.state?.view==='settings')queueMicrotask(patchVisibleCategoryRows);
      });
      observer.observe(content,{childList:true,subtree:true});
    }
    patchVisibleCategoryRows();
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
