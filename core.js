const SUPABASE_URL = 'https://frqujwlswqmtsxnqnwwc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TCG4KliEaKshVW9BKQJiCQ_1UrLbjdC';
const RPC_URL = `${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_api`;
const KEY_STORE = 'taichinh_gd_key_v1';

const state = {
  key: '', view: 'dashboard', base: 'JPY', household: null,
  accounts: [], categories: [], categoryVersions: [], transactions: [],
  fullTransactions: [], goals: [], loans: [], monthlySummary: [],
  month: new Date().toISOString().slice(0,7), search: ''
};

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = (v='') => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const n = v => Number(v || 0);
const monthDate = m => `${m}-01`;
const fmtMonth = d => { const x=new Date(`${String(d).slice(0,10)}T00:00:00`); return `${x.getMonth()+1}/${String(x.getFullYear()).slice(-2)}` };
const money = (v, cur=state.base) => new Intl.NumberFormat(cur==='JPY'?'ja-JP':'vi-VN',{style:'currency',currency:cur,maximumFractionDigits:cur==='JPY'?0:0}).format(n(v));
const pct = v => `${Math.round(n(v))}%`;
const today = () => new Date().toISOString().slice(0,10);

function toast(msg, error=false){ const el=$('#toast'); el.textContent=msg; el.className=`toast show${error?' error':''}`; clearTimeout(toast.t); toast.t=setTimeout(()=>el.className='toast',2300); }
function setLoading(on){ $('#loading').classList.toggle('hidden',!on); }

function extractKey(){
  const hash = new URLSearchParams(location.hash.replace(/^#/,''));
  const fromHash = hash.get('k') || hash.get('key');
  if(fromHash && fromHash.length>=32){ localStorage.setItem(KEY_STORE, fromHash); history.replaceState(null,'',location.pathname+location.search); return fromHash; }
  return localStorage.getItem(KEY_STORE) || '';
}

async function api(action, payload={}){
  if(!state.key) throw new Error('Thiếu khóa gia đình');
  const res = await fetch(RPC_URL, {
    method:'POST',
    headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},
    body:JSON.stringify({p_key:state.key,p_action:action,p_payload:payload})
  });
  const text = await res.text();
  let data; try{ data=text?JSON.parse(text):null }catch{ data=text }
  if(!res.ok){
    const raw = data?.message || data?.hint || String(data || `HTTP ${res.status}`);
    if(/invalid_access_key/i.test(raw)) throw new Error('Khóa gia đình không đúng.');
    throw new Error(raw);
  }
  return data;
}

async function boot(){
  state.key=extractKey();
  if(!state.key){ setLoading(false); $('#unlock').classList.remove('hidden'); return; }
  try{
    setLoading(true);
    const [d, all] = await Promise.all([api('bootstrap'), api('export')]);
    applyBootstrap(d); state.fullTransactions=all.transactions||d.transactions||[];
    $('#app').classList.remove('hidden'); $('#unlock').classList.add('hidden');
    $('#monthPicker').value=state.month; render();
  }catch(e){
    console.error(e); localStorage.removeItem(KEY_STORE); state.key=''; setLoading(false); $('#unlock').classList.remove('hidden'); toast(e.message,true); return;
  }
  setLoading(false);
}

function applyBootstrap(d){
  state.household=d.household||{}; state.base=state.household.base_currency||'JPY';
  state.accounts=d.accounts||[]; state.categories=d.categories||[]; state.categoryVersions=d.category_versions||[];
  state.transactions=d.transactions||[]; state.goals=d.goals||[]; state.loans=d.loans||[]; state.monthlySummary=d.monthly_summary||[];
  $('#familyNameSide').textContent=state.household.name||'Gia đình';
}

async function refresh(preserveView=true){
  const view=state.view;
  const [d, all]=await Promise.all([api('bootstrap'),api('export')]);
  applyBootstrap(d); state.fullTransactions=all.transactions||[];
  if(state.month!==new Date().toISOString().slice(0,7)) await loadMonth(state.month, false);
  if(preserveView) state.view=view; render();
}

async function loadMonth(m, rerender=true){
  state.month=m; const d=await api('month',{month:monthDate(m)}); state.categories=d.categories||[]; state.transactions=d.transactions||[];
  if(rerender) render();
}

function titleFor(v){ return ({dashboard:['Tổng quan','Theo dõi dòng tiền và biến động hàng tháng'],budget:['Ngân sách','Điều chỉnh cố định / biến động theo từng tháng'],transactions:['Thu chi','Ghi nhận và tra cứu giao dịch'],accounts:['Tài khoản','Tiền mặt, ngân hàng và tiết kiệm'],goals:['Mục tiêu & vay nợ','Theo dõi kế hoạch tài chính dài hạn'],settings:['Cài đặt','Gia đình, tiền tệ và sao lưu dữ liệu']})[v]; }
function navigate(v){ state.view=v; $$('#nav button,#mobileNav button').forEach(b=>b.classList.toggle('active',b.dataset.view===v)); const [t,s]=titleFor(v); $('#pageTitle').textContent=t; $('#pageSubtitle').textContent=s; render(); }

function monthTransactions(type){ return state.transactions.filter(t=>!type||t.transaction_type===type); }
function actualByCategory(id){ return monthTransactions('expense').filter(t=>t.category_id===id).reduce((a,t)=>a+n(t.amount)*n(t.fx_rate||1),0); }
function monthTotals(){ const inc=monthTransactions('income').reduce((a,t)=>a+n(t.amount)*n(t.fx_rate||1),0); const exp=monthTransactions('expense').reduce((a,t)=>a+n(t.amount)*n(t.fx_rate||1),0); return {inc,exp,net:inc-exp}; }
function activeCategories(dir){ return state.categories.filter(c=>c.is_active!==false && (!dir||c.direction===dir)); }
function activeAccounts(){ return state.accounts.filter(a=>a.is_active!==false); }

function trendSvg(){
  const data=state.monthlySummary||[]; const W=720,H=220,pad=28; if(!data.length) return '<div class="empty">Chưa có dữ liệu</div>';
  const mx=Math.max(1,...data.flatMap(x=>[n(x.income),n(x.expense)])); const group=(W-pad*2)/data.length; const bw=Math.max(5,Math.min(13,group*.27));
  const parts=[];
  for(let i=0;i<4;i++){ const y=pad+(H-pad*2)*i/3; parts.push(`<line class="chart-grid" x1="${pad}" y1="${y}" x2="${W-pad}" y2="${y}"/>`); }
  data.forEach((x,i)=>{ const cx=pad+group*i+group/2; const ih=(H-pad*2)*n(x.income)/mx, eh=(H-pad*2)*n(x.expense)/mx; parts.push(`<rect class="bar-income" x="${cx-bw-2}" y="${H-pad-ih}" width="${bw}" height="${ih}" rx="3"/><rect class="bar-expense" x="${cx+2}" y="${H-pad-eh}" width="${bw}" height="${eh}" rx="3"/><text class="axis-label" x="${cx}" y="${H-7}" text-anchor="middle">${fmtMonth(x.month)}</text>`); });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Biến động thu chi 12 tháng">${parts.join('')}</svg><div class="legend"><span><i style="background:#22c55e"></i>Thu nhập</span><span><i style="background:#3b82f6"></i>Chi tiêu</span></div>`;
}