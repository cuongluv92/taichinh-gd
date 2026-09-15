(() => {
  'use strict';

  const BODY_CLASS='ui-2026';
  const palette=['slate','blue','emerald','amber','rose','violet','cyan','orange'];

  function hashColor(value=''){
    let h=0;
    for(let i=0;i<value.length;i++) h=((h<<5)-h+value.charCodeAt(i))|0;
    return palette[Math.abs(h)%palette.length];
  }

  function categoryOrderValue(category){
    const raw=category?.sort_order;
    if(raw===null||raw===undefined||raw==='') return Number.POSITIVE_INFINITY;
    const value=Number(raw);
    return Number.isFinite(value)?value:Number.POSITIVE_INFINITY;
  }

  function normalizeCategoryOrder(){
    if(!Array.isArray(window.state?.categories)||state.categories.length<2) return;
    state.categories=state.categories
      .map((category,index)=>({category,index,order:categoryOrderValue(category)}))
      .sort((a,b)=>a.order-b.order||a.index-b.index)
      .map(x=>x.category);
  }

  function selectedMonthDate(){
    const fallback=new Date();
    const local=window.__V3?.localToday?.()
      ||(typeof window.today==='function'?window.today():`${fallback.getFullYear()}-${String(fallback.getMonth()+1).padStart(2,'0')}-${String(fallback.getDate()).padStart(2,'0')}`);
    const currentMonth=String(local).slice(0,7);
    const selected=String(window.state?.month||currentMonth).slice(0,7);
    return selected===currentMonth?String(local).slice(0,10):`${selected}-01`;
  }

  function styleToSafeAttrs(styleText=''){
    const css=String(styleText).trim();
    if(!css) return '';
    const decl={};
    css.split(';').forEach(part=>{
      const i=part.indexOf(':');
      if(i<0) return;
      const k=part.slice(0,i).trim().toLowerCase();
      const v=part.slice(i+1).trim();
      if(k) decl[k]=v;
    });
    const attrs=[];
    const width=decl.width?.match(/^([0-9]+(?:\.[0-9]+)?)%$/);
    if(width){
      const bucket=Math.max(0,Math.min(100,Math.round(Number(width[1])/5)*5));
      attrs.push(`data-ui-width="${bucket}"`);
    }
    const bg=decl.background||decl['background-color'];
    if(bg) attrs.push(`data-ui-color="${hashColor(bg)}"`);
    if(decl.display==='inline-block' && /^9px$/.test(decl.width||'') && /^9px$/.test(decl.height||'')) attrs.push('data-ui-swatch="1"');
    const mt=decl['margin-top']?.match(/^(4|5|6|8|12|14|16|18|20)px$/);
    if(mt) attrs.push(`data-ui-mt="${mt[1]}"`);
    if((decl.color||'').includes('var(--muted)')) attrs.push('data-ui-muted="1"');
    const fs=decl['font-size']?.match(/^(11|12|13|14)px$/);
    if(fs) attrs.push(`data-ui-fs="${fs[1]}"`);
    if((decl['grid-template-columns']||'').replace(/\s+/g,'')==='1fr') attrs.push('data-ui-onecol="1"');
    return attrs.join(' ');
  }

  function sanitizeMarkup(html){
    if(typeof html!=='string' || !html.includes('style=')) return html;
    return html.replace(/\sstyle=("([^"]*)"|'([^']*)')/gi,(_all,_quoted,dq,sq)=>{
      const attrs=styleToSafeAttrs(dq??sq??'');
      return attrs?` ${attrs}`:'';
    });
  }

  function applySafeAttrs(el,styleText){
    const attrs=styleToSafeAttrs(styleText);
    if(attrs){
      const holder=document.createElement('span');
      holder.innerHTML=`<span ${attrs}></span>`;
      const source=holder.firstElementChild;
      [...source.attributes].forEach(a=>el.setAttribute(a.name,a.value));
    }
    el.removeAttribute('style');
  }

  function sanitizeDom(root=document){
    root.querySelectorAll?.('[style]').forEach(el=>applySafeAttrs(el,el.getAttribute('style')||''));
  }

  function wrapMarkupFunction(holder,name){
    const fn=holder?.[name];
    if(typeof fn!=='function' || fn.__ui2026Wrapped) return;
    const wrapped=function(...args){
      const out=fn.apply(this,args);
      return typeof out==='string'?sanitizeMarkup(out):out;
    };
    Object.defineProperty(wrapped,'__ui2026Wrapped',{value:true});
    holder[name]=wrapped;
  }

  function wrapModal(){
    const fn=window.modal;
    if(typeof fn!=='function' || fn.__ui2026Wrapped) return;
    const wrapped=function(title,body,...rest){
      return fn.call(this,title,sanitizeMarkup(body),...rest);
    };
    Object.defineProperty(wrapped,'__ui2026Wrapped',{value:true});
    window.modal=wrapped;
  }

  function wrapTransactionDefaults(){
    const openTransactionBefore=window.openTransaction;
    if(typeof openTransactionBefore==='function' && !openTransactionBefore.__ui2026DateWrapped){
      const wrapped=function(id='',defaults={}){
        if(id) return openTransactionBefore.call(this,id,defaults);
        const next=defaults&&typeof defaults==='object'?{...defaults}:{};
        if(!next.transaction_date) next.transaction_date=selectedMonthDate();
        return openTransactionBefore.call(this,'',next);
      };
      Object.defineProperty(wrapped,'__ui2026DateWrapped',{value:true});
      window.openTransaction=wrapped;
    }

    const openQuickBefore=window.openQuick;
    if(typeof openQuickBefore==='function' && !openQuickBefore.__ui2026DateWrapped){
      const wrapped=function(type){
        if(['income','expense','transfer'].includes(type)){
          return window.openTransaction?.('',{transaction_type:type,transaction_date:selectedMonthDate()});
        }
        return openQuickBefore.call(this,type);
      };
      Object.defineProperty(wrapped,'__ui2026DateWrapped',{value:true});
      window.openQuick=wrapped;
    }
  }

  function enhanceA11y(){
    const view=window.state?.view;
    document.querySelectorAll('#nav button[data-view],#mobileNav button[data-view]').forEach(btn=>{
      if(btn.dataset.view===view) btn.setAttribute('aria-current','page');
      else btn.removeAttribute('aria-current');
    });
    document.querySelectorAll('button').forEach(btn=>{
      if(btn.hasAttribute('aria-label')) return;
      const txt=(btn.textContent||'').trim();
      if(txt==='•••') btn.setAttribute('aria-label','Tùy chọn');
      else if(txt==='✕') btn.setAttribute('aria-label','Đóng');
      else if(txt==='×'){
        const action=btn.getAttribute('onclick')||'';
        btn.setAttribute('aria-label',/delete|archive/i.test(action)?'Xóa':'Đóng');
      } else if(txt==='✎') btn.setAttribute('aria-label','Sửa');
    });
  }

  function markView(){
    const app=document.getElementById('app');
    if(app && window.state?.view) app.dataset.view=window.state.view;
  }

  function cleanupUi(){
    document.querySelectorAll('.nav-label,.side-note').forEach(el=>el.remove());

    document.querySelectorAll('.v7-dashboard .v3-card').forEach(card=>{
      const title=card.querySelector('h2')?.textContent?.trim().toLowerCase()||'';
      if(title==='góc nhìn nhanh') card.remove();
    });

    document.querySelectorAll('#content .v3-two').forEach(grid=>{
      if(!grid.children.length) grid.remove();
    });

    document.querySelectorAll('#content :is(.v3-card,.card,.pro-card,.settings-panel)').forEach(card=>{
      const text=(card.textContent||'').replace(/\s+/g,'').trim();
      if(!text && !card.querySelector('input,select,textarea,button,svg,canvas')) card.remove();
    });
  }

  function afterRender(){
    document.body.classList.add(BODY_CLASS);
    sanitizeDom(document);
    cleanupUi();
    markView();
    enhanceA11y();
  }

  function install(){
    document.body.classList.add(BODY_CLASS);
    normalizeCategoryOrder();

    ['dashboard','budget','transactions','accounts','goals','settings','trendSvg'].forEach(name=>wrapMarkupFunction(window,name));
    const V=window.__V3;
    if(V) ['dashboardV3','analyticsV3','budgetV3','accountsV3','investmentsV3'].forEach(name=>wrapMarkupFunction(V,name));
    wrapModal();
    wrapTransactionDefaults();

    const renderBefore=window.render;
    if(typeof renderBefore==='function' && !renderBefore.__ui2026Wrapped){
      const wrapped=function(...args){
        normalizeCategoryOrder();
        const out=renderBefore.apply(this,args);
        afterRender();
        return out;
      };
      Object.defineProperty(wrapped,'__ui2026Wrapped',{value:true});
      window.render=wrapped;
    }

    const observer=new MutationObserver(records=>{
      let dirty=false;
      for(const r of records){
        if(r.type==='attributes' && r.attributeName==='style' && r.target?.hasAttribute?.('style')){
          applySafeAttrs(r.target,r.target.getAttribute('style')||'');
          continue;
        }
        if(r.addedNodes?.length) dirty=true;
      }
      if(dirty) queueMicrotask(afterRender);
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['style']});
    afterRender();
  }

  install();
})();
