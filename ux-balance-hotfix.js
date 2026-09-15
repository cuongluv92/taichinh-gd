(() => {
  'use strict';
  window.addEventListener('click',e=>{
    const b=e.target.closest?.('[data-balance-quick]');
    if(!b)return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    if(typeof window.openQuick==='function')return window.openQuick('expense');
    return window.openTransaction?.();
  },true);
})();