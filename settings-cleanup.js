(() => {
  'use strict';

  function cleanupSettings(){
    if(!window.state||state.view!=='settings')return;

    document.querySelectorAll('#content .categories-panel,#content .ux-salary-settings').forEach(el=>el.remove());

    const duplicateTitles=new Set(['Quản lý danh mục','Lương cố định']);
    document.querySelectorAll('#content .settings-panel,#content .settings-card,#content .pro-card').forEach(panel=>{
      const title=(panel.querySelector('h2')?.textContent||'').trim();
      if(duplicateTitles.has(title))panel.remove();
    });

    document.querySelectorAll('#content .settings-grid').forEach(grid=>{
      if(!grid.children.length)grid.remove();
    });

    const subtitle=document.getElementById('pageSubtitle');
    if(subtitle)subtitle.textContent='Gia đình, tiền tệ, sao lưu và thiết bị';
  }

  const renderBefore=window.render;
  if(typeof renderBefore==='function'&&!renderBefore.__settingsCleanup){
    const wrapped=function(...args){
      const out=renderBefore.apply(this,args);
      queueMicrotask(cleanupSettings);
      return out;
    };
    Object.defineProperty(wrapped,'__settingsCleanup',{value:true});
    window.render=wrapped;
  }

  queueMicrotask(cleanupSettings);
})();