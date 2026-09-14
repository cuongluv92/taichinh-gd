(() => {
  const V=window.__V3=window.__V3||{};
  const IMPORT_RPC_URL=`${SUPABASE_URL}/rest/v1/rpc/taichinh_gd_statement_import_api`;
  state.statementImportBatches=state.statementImportBatches||[];
  let session=null;

  async function importApi(action,payload={}){
    if(!state.key) throw new Error('Thiếu khóa gia đình');
    const res=await fetch(IMPORT_RPC_URL,{method:'POST',headers:{'Content-Type':'application/json','apikey':SUPABASE_KEY},body:JSON.stringify({p_key:state.key,p_action:action,p_payload:payload})});
    const text=await res.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
    if(!res.ok){
      const raw=data?.message||data?.hint||String(data||`HTTP ${res.status}`);
      const friendly=/too_many_rows/i.test(raw)?'Mỗi lần chỉ nhập tối đa 1.000 dòng.'
        :/no_rows_selected/i.test(raw)?'Chưa chọn dòng nào để nhập.'
        :/invalid_account/i.test(raw)?'Hãy chọn tài khoản hợp lệ.'
        :/invalid_category/i.test(raw)?'Có dòng chưa chọn đúng danh mục thu/chi.'
        :/invalid_import_row/i.test(raw)?'Có dòng sai ngày, loại hoặc số tiền.'
        :/batch_not_found/i.test(raw)?'Không tìm thấy lần import này.'
        :/credit_card_installments_purchase_transaction_id_fkey/i.test(raw)?'Có giao dịch trong batch đã gắn trả góp. Hãy bỏ liên kết trả góp trước khi hoàn tác.'
        :/invalid_access_key/i.test(raw)?'Khóa gia đình không đúng.':raw;
      throw new Error(friendly);
    }
    return data;
  }

  async function loadImportBatches(rerender=false){
    if(!state.key)return [];
    const d=await importApi('recent');state.statementImportBatches=d?.batches||[];
    if(rerender&&state.household)render();
    return state.statementImportBatches;
  }
  V.statementImportApi=importApi;V.loadImportBatches=loadImportBatches;

  const normHeader=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[\s_\-・／/()（）\[\]【】]/g,'');
  const normDesc=v=>String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ');
  const HEADER_PATTERNS={
    date:['日付','利用日','取引日','処理日','年月日','支払日','date','transactiondate','postingdate','valuedate'],
    desc:['摘要','内容','取引内容','お取引内容','利用先','加盟店','店名','merchant','description','details','memo','備考'],
    amount:['金額','利用金額','取引金額','支払金額','amount','transactionamount'],
    debit:['出金','支出','引出','引落','支払','ご利用金額','debit','withdrawal','payment'],
    credit:['入金','収入','預入','お預り金額','credit','deposit','receipt']
  };
  const findHeader=(headers,patterns,exclude=new Set())=>{
    const ps=patterns.map(normHeader);
    let best=-1,score=0;
    headers.forEach((h,i)=>{if(exclude.has(i))return;const x=normHeader(h);let s=0;ps.forEach(p=>{if(x===p)s=Math.max(s,4);else if(x.includes(p)||p.includes(x))s=Math.max(s,2)});if(s>score){score=s;best=i}});
    return best;
  };
  function headerScore(row){
    const vals=(row||[]).map(normHeader);let score=0;
    Object.values(HEADER_PATTERNS).flat().map(normHeader).forEach(p=>{if(vals.some(v=>v===p||v.includes(p)))score++});
    return score;
  }
  function guessMapping(headers){
    const used=new Set(),date=findHeader(headers,HEADER_PATTERNS.date,used);if(date>=0)used.add(date);
    const debit=findHeader(headers,HEADER_PATTERNS.debit,used);if(debit>=0)used.add(debit);
    const credit=findHeader(headers,HEADER_PATTERNS.credit,used);if(credit>=0)used.add(credit);
    let amount=-1;if(!(debit>=0&&credit>=0)){amount=findHeader(headers,HEADER_PATTERNS.amount,used);if(amount>=0)used.add(amount)}
    let desc=findHeader(headers,HEADER_PATTERNS.desc,used);
    if(desc<0)desc=headers.findIndex((_,i)=>!used.has(i));
    return {date,desc,amount,debit,credit};
  }

  function parseCSV(text){
    const rows=[];let row=[],cell='',quoted=false;
    const sample=String(text).split(/\r?\n/).slice(0,8);
    const count=(d)=>sample.reduce((sum,line)=>{let q=false,c=0;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"')q=!q;else if(ch===d&&!q)c++}return sum+c},0);
    const delimiter=[',','\t',';'].sort((a,b)=>count(b)-count(a))[0];
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quoted){
        if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}
        else if(ch==='"')quoted=false;else cell+=ch;
      }else if(ch==='"')quoted=true;
      else if(ch===delimiter){row.push(cell);cell=''}
      else if(ch==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell=''}
      else cell+=ch;
    }
    if(cell.length||row.length){row.push(cell.replace(/\r$/,''));rows.push(row)}
    return rows.filter(r=>r.some(x=>String(x).trim()!==''));
  }
  function decodeCSV(buffer){
    const bytes=new Uint8Array(buffer);if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)return new TextDecoder('utf-8').decode(bytes);
    try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{}
    try{return new TextDecoder('shift_jis').decode(bytes)}catch{return new TextDecoder('utf-8').decode(bytes)}
  }

  const u16=(d,o)=>d[o]|(d[o+1]<<8);
  const u32=(d,o)=>(d[o]|(d[o+1]<<8)|(d[o+2]<<16)|(d[o+3]<<24))>>>0;
  async function unzipEntries(buffer){
    const d=new Uint8Array(buffer);let eocd=-1;
    for(let i=d.length-22;i>=Math.max(0,d.length-66000);i--){if(u32(d,i)===0x06054b50){eocd=i;break}}
    if(eocd<0)throw new Error('File XLSX không hợp lệ.');
    const count=u16(d,eocd+10),offset=u32(d,eocd+16),entries=new Map();let p=offset;
    for(let k=0;k<count;k++){
      if(u32(d,p)!==0x02014b50)break;
      const method=u16(d,p+10),size=u32(d,p+20),nameLen=u16(d,p+28),extraLen=u16(d,p+30),commentLen=u16(d,p+32),local=u32(d,p+42);
      const name=new TextDecoder('utf-8').decode(d.slice(p+46,p+46+nameLen));
      const ln=u16(d,local+26),le=u16(d,local+28),start=local+30+ln+le,compressed=d.slice(start,start+size);
      let raw;
      if(method===0)raw=compressed;
      else if(method===8){
        try{const ds=new DecompressionStream('deflate-raw');raw=new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(ds)).arrayBuffer())}
        catch{throw new Error('Trình duyệt này chưa đọc được XLSX nén. Hãy lưu file thành CSV rồi thử lại.')}
      }else throw new Error(`XLSX dùng kiểu nén chưa hỗ trợ (${method}).`);
      entries.set(name,raw);p+=46+nameLen+extraLen+commentLen;
    }
    return entries;
  }
  const xmlText=(entries,name)=>{const b=entries.get(name);return b?new TextDecoder('utf-8').decode(b):''};
  const xmlDoc=s=>new DOMParser().parseFromString(s,'application/xml');
  function colIndex(ref){const m=String(ref||'').match(/^[A-Z]+/i);if(!m)return 0;let n=0;for(const ch of m[0].toUpperCase())n=n*26+(ch.charCodeAt(0)-64);return n-1}
  function cellValue(c,shared){
    const type=c.getAttribute('t')||'',v=c.getElementsByTagNameNS('*','v')[0]?.textContent??'';
    if(type==='s')return shared[Number(v)]??'';
    if(type==='inlineStr')return [...c.getElementsByTagNameNS('*','t')].map(x=>x.textContent||'').join('');
    if(type==='b')return v==='1'?'TRUE':'FALSE';return v;
  }
  async function parseXLSX(buffer){
    const entries=await unzipEntries(buffer),shared=[];
    const ss=xmlText(entries,'xl/sharedStrings.xml');
    if(ss){const doc=xmlDoc(ss);[...doc.getElementsByTagNameNS('*','si')].forEach(si=>shared.push([...si.getElementsByTagNameNS('*','t')].map(t=>t.textContent||'').join('')))}
    const sheets=[...entries.keys()].filter(x=>/^xl\/worksheets\/sheet\d+\.xml$/i.test(x)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    if(!sheets.length)throw new Error('Không tìm thấy sheet dữ liệu trong XLSX.');
    const doc=xmlDoc(xmlText(entries,sheets[0])),out=[];
    [...doc.getElementsByTagNameNS('*','row')].slice(0,2500).forEach(r=>{
      const arr=[];[...r.getElementsByTagNameNS('*','c')].forEach(c=>{arr[colIndex(c.getAttribute('r'))]=cellValue(c,shared)});out.push(arr.map(x=>x??''));
    });
    return out.filter(r=>r.some(x=>String(x).trim()!==''));
  }

  function excelDate(v){const n=Number(v);if(!Number.isFinite(n)||n<20000||n>100000)return null;return new Date(Date.UTC(1899,11,30)+Math.floor(n)*86400000).toISOString().slice(0,10)}
  function normalizeDate(v){
    if(typeof v==='number')return excelDate(v);
    const raw=String(v??'').normalize('NFKC').trim();if(!raw)return null;
    if(/^\d+(\.\d+)?$/.test(raw)){const ex=excelDate(raw);if(ex)return ex}
    let m=raw.match(/^(\d{4})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})日?$/);if(m)return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    m=raw.match(/^(\d{4})(\d{2})(\d{2})$/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;
    m=raw.match(/^(\d{1,2})[\/.\-](\d{1,2})$/);if(m)return `${state.month.slice(0,4)}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
    m=raw.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);if(m)return `${m[3]}-${String(m[1]).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
    const d=new Date(raw);return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);
  }
  function parseNumber(v){
    let s=String(v??'').normalize('NFKC').trim();if(!s)return 0;let neg=false;
    if(/^\(.*\)$/.test(s)){neg=true;s=s.slice(1,-1)}
    if(/^[▲△−-]/.test(s)){neg=true;s=s.replace(/^[▲△−-]/,'')}
    s=s.replace(/[¥￥₫₩$€£,，\s]/g,'').replace(/[^0-9.+-]/g,'');const x=Number(s);return Number.isFinite(x)?(neg?-Math.abs(x):x):0;
  }
  function defaultCategory(type){
    const cats=activeCategories(type),preferred=cats.find(c=>/^(khác|その他|other)$/i.test(String(c.name||'').trim()));return preferred?.id||cats[0]?.id||'';
  }
  function suggestedCategory(type,desc){
    const key=normDesc(desc).toLowerCase();if(!key)return defaultCategory(type);
    const hist=[...(state.fullTransactions||[])].sort((a,b)=>String(b.transaction_date||'').localeCompare(String(a.transaction_date||''))).find(t=>t.transaction_type===type&&t.category_id&&normDesc(t.note||'').toLowerCase()===key&&activeCategories(type).some(c=>c.id===t.category_id));
    return hist?.category_id||defaultCategory(type);
  }
  function normalizeRows(raw,mapping,mode){
    const headers=raw[0]||[],rows=[];const seen=new Map();
    for(let i=1;i<raw.length&&rows.length<1000;i++){
      const r=raw[i]||[],date=normalizeDate(r[mapping.date]),desc=normDesc(r[mapping.desc]||'');let amount=0,type='expense';
      const debit=mapping.debit>=0?Math.abs(parseNumber(r[mapping.debit])):0,credit=mapping.credit>=0?Math.abs(parseNumber(r[mapping.credit])):0;
      if(debit||credit){if(debit){amount=debit;type='expense'}else{amount=credit;type='income'}}
      else{const x=parseNumber(r[mapping.amount]);if(!x||!date)continue;amount=Math.abs(x);if(x<0)type='expense';else if(mode==='positive_income')type='income';else if(mode==='positive_expense')type='expense';else{const h=normHeader(headers[mapping.amount]||'');type=HEADER_PATTERNS.credit.some(p=>h.includes(normHeader(p)))?'income':'expense'}}
      if(!date||amount<=0)continue;
      const base=`${date}|${type}|${amount}|${desc.toLowerCase()}`,occ=(seen.get(base)||0)+1;seen.set(base,occ);
      rows.push({source_row:i+1,transaction_date:date,transaction_type:type,amount,description:desc,occurrence:occ,category_id:suggestedCategory(type,desc),selected:true,duplicate:false,valid:true});
    }
    return rows;
  }

  function optionColumns(headers,selected,blank='— Không dùng —'){return `<option value="-1">${blank}</option>${headers.map((h,i)=>`<option value="${i}" ${i===selected?'selected':''}>${i+1}. ${esc(h||`Cột ${i+1}`)}</option>`).join('')}`}
  function accountOptions(){return activeAccounts().filter(a=>['bank','credit','cash','savings'].includes(a.account_type)).map(a=>`<option value="${a.id}">${esc(a.name)} · ${esc(a.currency||state.base)}</option>`).join('')}
  function categoryOptions(type,selected=''){return `<option value="">— Chọn danh mục —</option>${activeCategories(type).map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${esc(c.name)}</option>`).join('')}`}

  function openImport(){
    session={file:null,sourceType:null,raw:null,headers:[],mapping:null,rows:[],accountId:activeAccounts().find(a=>['bank','credit'].includes(a.account_type))?.id||activeAccounts()[0]?.id||'',mode:'auto'};
    const dlg=$('#modal'),mb=$('#modalBody'),form=$('#modalForm');
    mb.innerHTML=`<div class="modal-head"><div><span class="v7-modal-kicker">IMPORT SAO KÊ</span><h3>CSV / XLSX</h3></div><button class="mini-btn" type="button" data-stm-action="close">✕</button></div><div class="modal-content stm-modal"><div class="stm-note">File chỉ được đọc trên trình duyệt. Chưa có gì được ghi vào dữ liệu cho tới khi bạn xem trước và bấm <b>Nhập các dòng đã chọn</b>.</div><div class="stm-setup"><label><span>Tài khoản nhận sao kê</span><select id="stmAccount">${accountOptions()}</select></label><label><span>File sao kê</span><input id="stmFile" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label></div><div id="stmWorkspace"><div class="stm-empty">Chọn file CSV hoặc XLSX để bắt đầu.</div></div></div><div class="modal-actions"><button class="btn" type="button" data-stm-action="close">Đóng</button></div>`;
    $('#stmAccount').value=session.accountId;form.onsubmit=e=>e.preventDefault();if(!dlg.open)dlg.showModal();
  }

  async function readStatementFile(file){
    if(!file)return;if(file.size>15*1024*1024)throw new Error('File quá lớn. Hãy giữ dưới 15 MB hoặc tách sao kê theo tháng.');
    const ext=(file.name.split('.').pop()||'').toLowerCase(),buf=await file.arrayBuffer();let raw,sourceType;
    if(ext==='xlsx'){raw=await parseXLSX(buf);sourceType='xlsx'}else{raw=parseCSV(decodeCSV(buf));sourceType='csv'}
    if(raw.length<2)throw new Error('Không tìm thấy đủ dữ liệu trong file.');
    let headerIndex=0,best=-1;raw.slice(0,15).forEach((r,i)=>{const score=headerScore(r);if(score>best){best=score;headerIndex=i}});
    if(headerIndex>0)raw=raw.slice(headerIndex);
    const width=Math.max(...raw.slice(0,20).map(r=>r.length));raw=raw.map(r=>Array.from({length:width},(_,i)=>r[i]??''));
    session.file=file;session.sourceType=sourceType;session.raw=raw;session.headers=raw[0].map((x,i)=>String(x||`Cột ${i+1}`).trim());session.mapping=guessMapping(session.headers);renderMapping();
  }

  function renderMapping(){
    const h=session.headers,m=session.mapping,w=$('#stmWorkspace');if(!w)return;
    const hasSeparate=m.debit>=0&&m.credit>=0;
    w.innerHTML=`<section class="stm-map"><div><h4>1. Kiểm tra cột</h4><p>App đã tự đoán. Bạn có thể đổi trước khi xem trước.</p></div><div class="stm-map-grid"><label><span>Ngày</span><select data-stm-map="date">${optionColumns(h,m.date)}</select></label><label><span>Nội dung</span><select data-stm-map="desc">${optionColumns(h,m.desc)}</select></label><label><span>Số tiền chung</span><select data-stm-map="amount">${optionColumns(h,m.amount)}</select></label><label><span>Chi / ra</span><select data-stm-map="debit">${optionColumns(h,m.debit)}</select></label><label><span>Thu / vào</span><select data-stm-map="credit">${optionColumns(h,m.credit)}</select></label><label><span>Nếu cột tiền không có dấu</span><select id="stmDirection"><option value="auto">Tự nhận theo tiêu đề</option><option value="positive_expense">Số dương = Chi</option><option value="positive_income">Số dương = Thu</option></select></label></div><div class="stm-map-tip">${hasSeparate?'Đã nhận ra cột Thu và Chi riêng.':'Nếu sao kê chỉ có một cột “金額/Amount”, hãy kiểm tra quy ước dấu ở ô cuối.'}</div><button class="btn primary" type="button" data-stm-action="preview">2. Tạo xem trước</button></section>`;
  }

  async function buildPreview(){
    const m={};$$('[data-stm-map]').forEach(s=>m[s.dataset.stmMap]=Number(s.value));session.mapping=m;session.mode=$('#stmDirection')?.value||'auto';session.accountId=$('#stmAccount')?.value||'';
    if(!session.accountId)throw new Error('Hãy chọn tài khoản.');if(m.date<0||m.desc<0||(!(m.debit>=0||m.credit>=0)&&m.amount<0))throw new Error('Cần chọn cột ngày, nội dung và số tiền.');
    session.rows=normalizeRows(session.raw,m,session.mode);if(!session.rows.length)throw new Error('Không tạo được dòng hợp lệ từ cách ghép cột hiện tại.');
    const result=await importApi('preview',{account_id:session.accountId,rows:session.rows.map(r=>({transaction_date:r.transaction_date,transaction_type:r.transaction_type,amount:r.amount,description:r.description,occurrence:r.occurrence}))});
    (result?.rows||[]).forEach(x=>{const r=session.rows[x.index];if(r){r.duplicate=!!x.duplicate;r.valid=x.valid!==false;if(r.duplicate||!r.valid)r.selected=false}});renderPreview();
  }

  function renderPreview(){
    const w=$('#stmWorkspace'),rows=session.rows,dup=rows.filter(r=>r.duplicate).length,selected=rows.filter(r=>r.selected&&!r.duplicate&&r.valid).length;
    w.innerHTML=`<section class="stm-preview"><div class="stm-preview-head"><div><h4>2. Xem trước</h4><p>${rows.length} dòng đọc được · ${dup} dòng đã có · <b id="stmSelectedCount">${selected}</b> dòng đang chọn</p></div><div><button class="btn" type="button" data-stm-action="mapping">← Cột</button><button class="btn primary" type="button" data-stm-action="import">Nhập các dòng đã chọn</button></div></div><div class="stm-table-wrap"><table class="stm-table"><thead><tr><th><input id="stmAll" type="checkbox" ${selected===rows.filter(r=>!r.duplicate&&r.valid).length?'checked':''}></th><th>Ngày</th><th>Loại</th><th>Nội dung</th><th>Số tiền</th><th>Danh mục</th><th>Trạng thái</th></tr></thead><tbody>${rows.map((r,i)=>`<tr class="${r.duplicate?'duplicate':''}"><td><input type="checkbox" data-stm-select="${i}" ${r.selected?'checked':''} ${r.duplicate||!r.valid?'disabled':''}></td><td><input data-stm-date="${i}" type="date" value="${esc(r.transaction_date)}"></td><td><select data-stm-type="${i}"><option value="expense" ${r.transaction_type==='expense'?'selected':''}>Chi</option><option value="income" ${r.transaction_type==='income'?'selected':''}>Thu</option></select></td><td><input data-stm-desc="${i}" value="${esc(r.description)}" title="${esc(r.description)}"></td><td class="num">${money(r.amount,(state.accounts||[]).find(a=>a.id===session.accountId)?.currency||state.base)}</td><td><select data-stm-cat="${i}">${categoryOptions(r.transaction_type,r.category_id)}</select></td><td>${r.duplicate?'<span class="stm-badge dup">Đã có</span>':r.valid?'<span class="stm-badge ok">Mới</span>':'<span class="stm-badge bad">Lỗi</span>'}</td></tr>`).join('')}</tbody></table></div><div class="stm-foot"><span>Không tự đoán chuyển khoản nội bộ. Dòng nào chưa chắc, bỏ dấu chọn rồi nhập tay sau.</span><button class="btn primary" type="button" data-stm-action="import">Nhập ${selected} dòng</button></div></section>`;
  }
  function updateSelectedCount(){const count=session?.rows?.filter(r=>r.selected&&!r.duplicate&&r.valid).length||0;const el=$('#stmSelectedCount');if(el)el.textContent=count;$$('[data-stm-action="import"]').forEach(b=>{if(b.closest('.stm-foot'))b.textContent=`Nhập ${count} dòng`})}
  function syncRowFromUI(i){
    const r=session.rows[i];if(!r)return;r.selected=$(`[data-stm-select="${i}"]`)?.checked||false;r.transaction_date=$(`[data-stm-date="${i}"]`)?.value||r.transaction_date;r.description=normDesc($(`[data-stm-desc="${i}"]`)?.value||'');const type=$(`[data-stm-type="${i}"]`)?.value||r.transaction_type;
    if(type!==r.transaction_type){r.transaction_type=type;r.category_id=suggestedCategory(type,r.description);const sel=$(`[data-stm-cat="${i}"]`);if(sel)sel.innerHTML=categoryOptions(type,r.category_id)}
    r.category_id=$(`[data-stm-cat="${i}"]`)?.value||r.category_id;
  }

  async function performImport(){
    session.rows.forEach((_,i)=>syncRowFromUI(i));const chosen=session.rows.filter(r=>r.selected&&!r.duplicate&&r.valid);
    if(!chosen.length)throw new Error('Chưa chọn dòng nào để nhập.');const missing=chosen.find(r=>!r.category_id||!r.transaction_date||r.amount<=0);if(missing)throw new Error('Có dòng chưa chọn danh mục hoặc thiếu ngày.');
    const result=await importApi('import',{account_id:session.accountId,file_name:session.file?.name||'statement',source_type:session.sourceType||'csv',rows:chosen.map(r=>({source_row:r.source_row,transaction_date:r.transaction_date,transaction_type:r.transaction_type,amount:r.amount,description:r.description,occurrence:r.occurrence,category_id:r.category_id}))});
    $('#modal')?.close();await Promise.all([refresh(),loadImportBatches(false)]);toast(`Đã nhập ${result.imported||0} dòng${result.skipped_duplicates?` · bỏ ${result.skipped_duplicates} dòng trùng`:''}`);render();
  }

  function batchCard(b){
    const dt=new Date(b.created_at),when=Number.isNaN(dt.getTime())?String(b.created_at||''):dt.toLocaleString('vi-VN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}),undone=!!b.undone_at||n(b.active_count)===0;
    return `<div class="stm-batch ${undone?'undone':''}"><div><b>${esc(b.file_name)}</b><span>${esc(b.account_name||'')} · ${esc(String(b.source_type||'').toUpperCase())} · ${esc(when)}</span><small>Đã nhập ${n(b.imported_count)}${n(b.skipped_duplicate_count)?` · bỏ trùng ${n(b.skipped_duplicate_count)}`:''}${undone?' · đã hoàn tác':''}</small></div>${!undone?`<button type="button" data-stm-action="undo" data-stm-batch="${b.id}">Hoàn tác</button>`:'<span class="stm-badge">Lịch sử</span>'}</div>`;
  }
  function settingsCard(){
    const batches=state.statementImportBatches||[];
    return `<section class="stm-card" id="stmSettingsCard"><div class="stm-card-head"><div><span>SAO KÊ NGÂN HÀNG / THẺ</span><h2>Import CSV / XLSX</h2><p>Luôn xem trước, phát hiện trùng và chọn dòng trước khi ghi dữ liệu.</p></div><button class="primary" type="button" data-stm-action="open">＋ Import sao kê</button></div><div class="stm-safety"><b>Không import mù:</b> app không tự biến chuyển khoản nội bộ thành chi phí và mỗi lần nhập có thể hoàn tác nguyên batch.</div><div class="stm-batches"><div class="stm-batches-title"><span>Lần nhập gần đây</span><small>${batches.length?'Có thể hoàn tác các batch còn hoạt động.':'Chưa có lịch sử import.'}</small></div>${batches.length?batches.map(batchCard).join(''):'<div class="stm-empty">Chưa import sao kê nào.</div>'}</div></section>`;
  }
  function decorateSettings(){if(state.view!=='settings')return;const content=$('#content');if(content&&!$('#stmSettingsCard'))content.insertAdjacentHTML('beforeend',settingsCard())}

  async function undoBatch(id){
    const b=(state.statementImportBatches||[]).find(x=>x.id===id);if(!b)return;
    if(!confirm(`Hoàn tác lần import “${b.file_name}”?\n${b.active_count||b.imported_count} giao dịch còn liên kết sẽ bị xóa.`))return;
    try{const r=await importApi('undo',{batch_id:id});await Promise.all([refresh(),loadImportBatches(false)]);toast(`Đã hoàn tác ${r.deleted||0} giao dịch`);render()}catch(e){toast(e.message,true)}
  }

  const renderBefore=window.render;
  if(typeof renderBefore==='function')window.render=function(...args){const out=renderBefore(...args);queueMicrotask(decorateSettings);return out};
  const refreshBefore=window.refresh;
  if(typeof refreshBefore==='function')window.refresh=async function(...args){await refreshBefore(...args);await loadImportBatches(false);if(state.household)render()};
  let attempts=0;const timer=setInterval(async()=>{attempts++;if(state.key&&state.household){try{await loadImportBatches(false);if(state.view==='settings')render();clearInterval(timer)}catch(e){console.error('Statement import history load failed',e)}}if(attempts>40)clearInterval(timer)},250);

  document.addEventListener('change',async e=>{
    if(e.target?.id==='stmFile'){try{setLoading(true);await readStatementFile(e.target.files?.[0])}catch(err){toast(err.message,true)}finally{setLoading(false)}return}
    if(e.target?.id==='stmAccount'&&session){session.accountId=e.target.value;return}
    if(e.target?.id==='stmAll'&&session){session.rows.forEach((r,i)=>{if(r.duplicate||!r.valid)return;r.selected=e.target.checked;const box=$(`[data-stm-select="${i}"]`);if(box)box.checked=r.selected});updateSelectedCount();return}
    const sel=e.target?.dataset?.stmSelect;if(sel!==undefined&&session){session.rows[Number(sel)].selected=e.target.checked;updateSelectedCount();return}
    const typ=e.target?.dataset?.stmType;if(typ!==undefined&&session){syncRowFromUI(Number(typ));return}
    const cat=e.target?.dataset?.stmCat;if(cat!==undefined&&session){session.rows[Number(cat)].category_id=e.target.value;return}
  });
  document.addEventListener('click',async e=>{
    const b=e.target.closest?.('[data-stm-action]');if(!b)return;const a=b.dataset.stmAction;
    try{
      if(a==='open')return openImport();if(a==='close')return $('#modal')?.close();if(a==='mapping')return renderMapping();
      if(a==='preview'){setLoading(true);await buildPreview();return}
      if(a==='import'){setLoading(true);await performImport();return}
      if(a==='undo')return await undoBatch(b.dataset.stmBatch);
    }catch(err){toast(err.message,true)}finally{if(['preview','import'].includes(a))setLoading(false)}
  });

  Object.assign(window,{openStatementImport:openImport,loadImportBatches});
})();
