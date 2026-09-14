(() => {
  const V=window.__V3=window.__V3||{};

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

  function chips(items){
    if(!items.length)return '<span class="ui-order-chip">Chưa có danh mục</span>';
    const shown=items.slice(0,8);
    const rest=Math.max(0,items.length-shown.length);
    return shown.map((c,i)=>`<span class="ui-order-chip">${i+1}. ${esc(c.name||'Danh mục')}</span>`).join('')+(rest?`<span class="ui-order-chip">+${rest} mục</span>`:'');
  }

  function cardHtml(){
    return `<section class="card settings-card ui-category-order-card" data-ui-category-order-card>
      <div class="ui-category-order-head">
        <div>
          <h2>Thứ tự danh mục</h2>
          <p>Sắp xếp thứ tự hiển thị ở Ngân sách, Cài đặt và danh sách chọn khi nhập giao dịch.</p>
        </div>
        <button class="btn" type="button" data-ui-open-category-order>↕ Sắp xếp</button>
      </div>
      <div class="ui-category-order-preview">
        <div class="ui-order-group"><span>Thu nhập</span><div>${chips(ordered('income'))}</div></div>
        <div class="ui-order-group"><span>Chi tiêu</span><div>${chips(ordered('expense'))}</div></div>
      </div>
    </section>`;
  }

  function patch(){
    if(!window.state||state.view!=='settings')return;
    const content=document.getElementById('content');
    if(!content||content.querySelector('[data-ui-category-order-card]'))return;
    content.insertAdjacentHTML('beforeend',cardHtml());
  }

  document.addEventListener('click',e=>{
    const button=e.target.closest?.('[data-ui-open-category-order]');
    if(!button)return;
    e.preventDefault();
    if(typeof V.openCategoryOrder==='function'){
      V.openCategoryOrder();
    }else if(typeof window.toast==='function'){
      window.toast('Chức năng sắp xếp chưa sẵn sàng.',true);
    }
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
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
