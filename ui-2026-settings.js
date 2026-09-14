(() => {
  const V=window.__V3=window.__V3||{};
  if(!document.querySelector('link[href="/ui-2026-compact.css"]')){
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='/ui-2026-compact.css';
    document.head.appendChild(link);
  }

  const ORDER_RPC=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_category_order_api`;
  let draft=null;
  let dirty=false;

  function sortValue(c){
    const v=Number(c?.sort_order);
    return Number.isFinite(v)?v:Number.MAX_SAFE_INTEGER;
  }

  function ordered(direction){
    return (window.state?.categories||[])
      .filter(c=>c&&c.is_active!==false&&c.direction===direction)
      .slice()
      .sort((a,b)=>sortValue(a)-sortValue(b)||String(a.name||'').localeCompare(String(b.name||''),'vi'));
  }

  function resetDraft(){
    draft={
      income:ordered('income').map(c=>c.id),
      expense:ordered('expense').map(c=>c.id)
    };
    dirty=false;
  }

  function categoryById(id){
    return (window.state?.categories||[]).find(c=>c?.id===id)||{};
  }

  function orderRows(direction){
    const ids=draft?.[direction]||[];
    if(!ids.length)return '<div class="empty">Chưa có danh mục.</div>';
    return `<div class="list ui-order-list">${ids.map((id,i)=>{
      const c=categoryById(id);
      return `<div class="tx ui-order-row">
        <div class="tx-main"><strong>${i+1}. ${esc(c.name||'Danh mục')}</strong></div>
        <div class="tx-actions">
          <button class="mini-btn" type="button" data-ui-order-move="up" data-ui-order-dir="${direction}" data-ui-order-index="${i}" ${i===0?'disabled':''} aria-label="Đưa lên">↑</button>
          <button class="mini-btn" type="button" data-ui-order-move="down" data-ui-order-dir="${direction}" data-ui-order-index="${i}" ${i===ids.length-1?'disabled':''} aria-label="Đưa xuống">↓</button>
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  function cardHtml(){
    if(!draft)resetDraft();
    return `<section class="card settings-card ui-category-order-card" data-ui-category-order-card>
      <div class="ui-category-order-head">
        <div>
          <h2>Thứ tự danh mục</h2>
          <p>Bấm ↑ ↓ ngay tại đây để đổi vị trí. Sau đó bấm Lưu thứ tự.</p>
        </div>
        <button class="btn primary" type="button" data-ui-save-category-order ${dirty?'':'disabled'}>${dirty?'Lưu thứ tự':'Đã lưu'}</button>
      </div>
      <div class="ui-category-order-preview">
        <div class="ui-order-group"><span>Thu nhập</span>${orderRows('income')}</div>
        <div class="ui-order-group"><span>Chi tiêu</span>${orderRows('expense')}</div>
      </div>
    </section>`;
  }

  function renderCard(){
    const current=document.querySelector('[data-ui-category-order-card]');
    if(current)current.outerHTML=cardHtml();
  }

  function patch(){
    if(!window.state||state.view!=='settings')return;
    const content=document.getElementById('content');
    if(!content||content.querySelector('[data-ui-category-order-card]'))return;
    resetDraft();
    content.insertAdjacentHTML('beforeend',cardHtml());
  }

  async function saveOrder(){
    if(!draft||!dirty)return;
    try{
      if(typeof window.setLoading==='function')window.setLoading(true);
      const res=await fetch(ORDER_RPC,{
        method:'POST',
        headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},
        body:JSON.stringify({p_key:state.key,p_payload:draft})
      });
      const text=await res.text();let data;
      try{data=text?JSON.parse(text):null}catch{data=text}
      if(!res.ok){
        const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
        throw new Error(/category_order_stale_refresh/i.test(raw)?'Danh mục vừa thay đổi. Hãy tải lại rồi sắp xếp lại.'
          :/invalid_category_order/i.test(raw)?'Thứ tự danh mục không hợp lệ.'
          :/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.'
          :raw);
      }
      dirty=false;
      if(typeof window.refresh==='function')await window.refresh();
      if(typeof window.toast==='function')window.toast('Đã lưu thứ tự danh mục');
    }catch(e){
      if(typeof window.toast==='function')window.toast(e.message||'Không lưu được thứ tự',true);
    }finally{
      if(typeof window.setLoading==='function')window.setLoading(false);
    }
  }

  document.addEventListener('click',e=>{
    const move=e.target.closest?.('[data-ui-order-move]');
    if(move&&draft){
      e.preventDefault();
      const dir=move.dataset.uiOrderDir;
      const idx=Number(move.dataset.uiOrderIndex);
      const delta=move.dataset.uiOrderMove==='up'?-1:1;
      const arr=draft[dir];
      const next=idx+delta;
      if(Array.isArray(arr)&&idx>=0&&next>=0&&next<arr.length){
        [arr[idx],arr[next]]=[arr[next],arr[idx]];
        dirty=true;
        renderCard();
      }
      return;
    }

    const save=e.target.closest?.('[data-ui-save-category-order]');
    if(save){e.preventDefault();saveOrder();}
  });

  const previousRender=window.render;
  if(typeof previousRender==='function'){
    window.render=function(...args){
      const out=previousRender.apply(this,args);
      queueMicrotask(patch);
      return out;
    };
  }

  const observer=new MutationObserver(()=>{
    if(window.state?.view==='settings')queueMicrotask(patch);
  });

  const start=()=>{
    const content=document.getElementById('content');
    if(content)observer.observe(content,{childList:true,subtree:false});
    patch();
  };

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
