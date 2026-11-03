/* SRU SOP Register — page logic (SRU-FRM-SOP-01) · app.js v2.8
   Hosted on GitHub Pages (ictsru/SOP) and loaded by the Apps Script page.
   Contains no data or secrets: every read/save is checked on the server (requireSruUser_). */
/* Logos: ITOC-site images first; embedded ones (Logos file, loaded at the end) replace them when available */
var LOGO_WEB = { sru: 'https://ictsru.github.io/ITOC/assets/sru-logo.png',
                 ictd: 'https://ictsru.github.io/ITOC/assets/ictd-logo.png',
                 itoc: 'https://ictsru.github.io/ITOC/assets/itoc-logo.png' };
window.LOGO_SRC = function (k) { return (window.ITOC_LOGOS && ITOC_LOGOS[k]) || LOGO_WEB[k] || ''; };
function applyLogos() { [].forEach.call(document.querySelectorAll('img[data-logo]'), function (img) { img.src = LOGO_SRC(img.getAttribute('data-logo')); }); }
applyLogos();
/* ================= Configuration ================= */
const TEMPLATE_VERSION = '2.8';
const DRAFT_KEY = 'sru_sop_draft_v1';

const TABLES = {
  approvals:  { cols:[['level','المستوى','Level',70],['role','الجهة / الدور المعتمِد','Approver Role'],['when','متى تُطلب','When Required'],['sla','مدة الموافقة','Approval SLA',120]], min:1 },
  steps:      { cols:[['desc','وصف الخطوة','Step Description',null,true],['role','الدور المسؤول','Responsible Role',170],['duration','المدة','Duration',100],['output','المخرج / السجل','Output / Record',170]], min:1, numbered:true, move:true },
  escalations:{ cols:[['level','المستوى','Level',70],['trigger','شرط التصعيد','Trigger'],['to','يُصعَّد إلى','Escalate To',180],['action','الإجراء المتوقع','Expected Action']], min:1 },
  signers:    { cols:[['role','المرحلة','Stage',130],['name','الاسم / المسمى','Name / Title'],['email','بريد الموقّع','Signer e-mail',220,false,'email']], min:1 },
  revisions:  { cols:[['version','الإصدار','Ver.',70],['date','التاريخ','Date',130,false,'date'],['change','وصف التعديل','Change Description'],['by','بواسطة','By',150]], min:1 }
};
let data = { approvals:[], steps:[], escalations:[], signers:[], revisions:[] };
let records = [];
let dirty = false, loaded = null;   // loaded = {sop_no, version, status} of the record opened from the register

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
/* Server calls — every api* function re-checks the signed-in account (requireSruUser_) */
const server = (fn, ...args) => new Promise((res, rej) =>
  google.script.run.withSuccessHandler(res).withFailureHandler(e => rej(e instanceof Error ? e : new Error(String(e && e.message || e))))[fn](...args));

function toast(msg, ms=2800){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove('show'),ms); }
function icons(){ if(window.lucide) lucide.createIcons(); }

/* ================= Dynamic tables ================= */
const ROW_LABEL = { approvals:'موافقة', steps:'الخطوة', escalations:'مستوى تصعيد', signers:'موقّع', revisions:'تعديل' };
function renderTable(name){
  const cfg=TABLES[name], rows=data[name], el=$('#t_'+name);
  el.innerHTML=rows.map((r,i)=>{
    const signed=name==='signers'&&r.sig;
    const head=`<div class="rh"><span>${ROW_LABEL[name]} ${i+1}</span>${signed?`<span class="sigok">✔ موقّع — ${esc(r.sig.signerName)}</span>`:''}<span class="sp"></span>`+
      (cfg.move?`<button class="btn icon sm" title="أعلى" onclick="moveRow('${name}',${i},-1)"><i data-lucide="arrow-up"></i></button><button class="btn icon sm" title="أسفل" onclick="moveRow('${name}',${i},1)"><i data-lucide="arrow-down"></i></button>`:'')+
      `<button class="btn icon sm" title="حذف" onclick="delRow('${name}',${i})"><i data-lucide="trash-2"></i></button></div>`;
    const fields=cfg.cols.map(c=>{
      const v=esc(r[c[0]]), wide=c[4]||!c[3], dis=signed?' disabled':'', dir=c[5]==='email'?' dir="ltr"':'';
      const input=c[4]?`<textarea data-t="${name}" data-i="${i}" data-k="${c[0]}"${dis}>${v}</textarea>`
                      :`<input ${c[5]?`type="${c[5]}"`:''}${dir} data-t="${name}" data-i="${i}" data-k="${c[0]}" value="${v}"${dis}>`;
      return `<div class="${wide?'wide':''}"><label>${c[1]} <span class="en">${c[2]}</span></label>${input}</div>`;
    }).join('');
    return `<div class="rowcard${signed?' signedrow':''}">${head}<div class="rf">${fields}</div></div>`;
  }).join('');
  icons();
  if(document.body.classList.contains('sig-locked') && typeof lockInputs==='function') lockInputs(true);
}
function renderTables(){ Object.keys(TABLES).forEach(renderTable); }
function addRow(n){ data[n].push({}); renderTable(n); saveDraft(); }
function delRow(n,i){ if(n==='signers'&&data[n][i]&&data[n][i].sig){ toast('لا يمكن حذف خانة موقّعة'); return; } data[n].splice(i,1); if(!data[n].length) data[n].push({}); renderTable(n); saveDraft(); }
function moveRow(n,i,d){ const j=i+d; if(j<0||j>=data[n].length) return; [data[n][i],data[n][j]]=[data[n][j],data[n][i]]; renderTable(n); saveDraft(); }
document.addEventListener('input', e=>{
  const t=e.target;
  if(t.id==='recSel' || t.id==='listFilter' || t.id==='setUrl' || (t.closest && (t.closest('dialog') || t.closest('#sigbar')))) return;   // dialogs (signatures, PIN) are not SOP edits
  dirty=true;
  if(t.dataset.t){ data[t.dataset.t][+t.dataset.i][t.dataset.k]=t.value; }
  saveDraft();
});

/* ================= Collect / fill ================= */
function collect(){
  const o={};
  document.querySelectorAll('[data-f]').forEach(el=>o[el.dataset.f]=el.value.trim());
  o.channels=[...document.querySelectorAll('#channels input:checked')].map(x=>x.value);
  Object.keys(TABLES).forEach(n=> o[n]=data[n].filter(r=>Object.values(r).some(v=>String(v||'').trim())));
  o.template_version=TEMPLATE_VERSION;
  return o;
}
function fill(o){
  if(!Array.isArray(o.signers) || !o.signers.length){
    o.signers=[['إعداد',o.prepared_by],['مراجعة',o.reviewed_by],['اعتماد',o.approved_by]].filter(x=>String(x[1]||'').trim()).map(x=>({role:x[0],name:x[1],email:''}));
  }
  document.querySelectorAll('[data-f]').forEach(el=>{ el.value = o[el.dataset.f] ?? (el.tagName==='SELECT'? el.options[0].value : ''); });
  if(!o.review_cycle) $('[data-f=review_cycle]').value='12';
  document.querySelectorAll('#channels input').forEach(x=>x.checked=(o.channels||[]).includes(x.value));
  Object.keys(TABLES).forEach(n=>{ data[n]=(o[n]&&o[n].length)? o[n].map(r=>({...r})) : [{}]; });
  renderTables(); saveDraft(); updateMode();
}
function saveDraft(){ try{ localStorage.setItem(DRAFT_KEY, JSON.stringify(collect())); $('#status').textContent='مسودة محفوظة محلياً · المعاينة محدّثة'; }catch(e){} schedulePreview(); }
let _pvT=null;
function schedulePreview(){ clearTimeout(_pvT); _pvT=setTimeout(renderPreview,180); }

/* ================= Helpers ================= */
function nextVersion(v){
  const m=/^(\d+)\.(\d)$/.exec(String(v||'').trim());
  if(!m) return '1.0';
  let a=+m[1], b=+m[2]+1; if(b>9){a++;b=0;} return a+'.'+b;
}
function bumpVersion(){
  dirty=true;
  const f=$('[data-f=version]'); const nv=nextVersion(f.value); f.value=nv;
  data.revisions=data.revisions.filter(r=>Object.values(r).some(v=>v)); data.revisions.push({version:nv,date:new Date().toISOString().slice(0,10),change:'',by:(window.DATA&&DATA.user)||''});
  $('[data-f=status]').value='مسودة'; renderTable('revisions'); saveDraft(); toast('تم إنشاء الإصدار '+nv+' — أضف وصف التعديل');
}
function calcReview(){
  const a=$('[data-f=approval_date]').value; if(!a) return;
  const d=new Date(a); d.setMonth(d.getMonth()+ +$('[data-f=review_cycle]').value);
  $('[data-f=review_date]').value=d.toISOString().slice(0,10); saveDraft();
}
function validate(o){
  const miss=[...document.querySelectorAll('[data-f][required]')].filter(el=>!el.value.trim()).map(el=>el.closest('.grid > div').querySelector('label').childNodes[0].textContent.trim());
  if(!o.steps.length) miss.push('خطوة واحدة على الأقل');
  if(!o.signers.some(a=>String(a.name||'').trim())) miss.push('موقّع واحد على الأقل (ضبط الوثيقة والاعتماد)');
  o.signers.forEach((a,i)=>{ if(a.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) miss.push('بريد الموقّع '+(i+1)); });
  if(o.version && !/^\d+\.\d$/.test(o.version)) miss.push('صيغة الإصدار (مثال 1.0 — رقم عشري واحد)');
  return miss;
}

/* ================= Google Sheets ================= */
async function saveToSheet(){
  const o=collect(), miss=validate(o);
  if(miss.length){ toast('حقول مطلوبة: '+miss.join('، '),5000); return; }
  if(document.body.classList.contains('sig-locked')){ toast('الإجراء مقفل لاحتوائه على توقيعات — استخدم «إصدار جديد للتعديل»',6000); return; }
  $('#status').textContent='جارٍ الحفظ...';
  try{
    const j=await server('apiSave', stripSigs(JSON.parse(JSON.stringify(o)))); if(!j || !j.ok) throw new Error((j&&j.error)||'فشل');
    $('[data-f=sop_no]').value=j.sop_no; saveDraft();
    dirty=false; loaded={sop_no:j.sop_no, version:o.version, status:o.status, rev:j.rev||null}; updateMode(); applySignLock();
    loadRecords(j.sop_no);
    $('#status').textContent='حُفظ في Sheets ✓ '+j.sop_no; toast((j.created?'تم إنشاء ':'تم تحديث ')+j.sop_no+' — بواسطة '+j.by);
  }catch(e){ const m=/NetworkError|Failed to fetch|disconnected/i.test(e.message)?'انقطع الاتصال بالخادم — تحقق من الشبكة ثم أعد المحاولة':e.message;
    $('#status').textContent='تعذّر الحفظ: '+m; $('#status').title=m; toast('تعذّر الحفظ — '+m,9000); }
}
async function openList(){
  $('#listModal').classList.add('open'); $('#listBody').textContent='جارٍ التحميل...';
  try{ const j=await server('apiList'); records=j.items||[]; renderList(); }
  catch(e){ $('#listBody').textContent='تعذّر التحميل: '+e.message; }
}
function badge(s){ const m={'مسودة':'b-draft','قيد المراجعة':'b-review','معتمد':'b-approved','ملغى':'b-retired'}; return `<span class="badge ${m[s]||'b-draft'}">${esc(s)}</span>`; }
function renderList(){
  const q=$('#listFilter').value.trim().toLowerCase(), today=new Date().toISOString().slice(0,10);
  const rows=records.filter(r=>!q||(r.sop_no+' '+r.title_ar+' '+r.title_en).toLowerCase().includes(q));
  $('#listBody').innerHTML=rows.length?`<table class="list-table"><tr><th>الرقم</th><th>العنوان</th><th>الإصدار</th><th>الحالة</th><th>المراجعة القادمة</th></tr>`+
    rows.map(r=>`<tr onclick="loadRecord('${esc(r.sop_no)}')"><td dir="ltr">${esc(r.sop_no)}</td><td>${esc(r.title_ar)}</td><td>${esc(r.version)}</td><td>${badge(r.status)}</td><td style="${r.review_date&&r.review_date<today?'color:var(--err);font-weight:700':''}">${esc(r.review_date)}</td></tr>`).join('')+'</table>':'لا توجد سجلات.';
}
async function loadRecord(id){
  try{ const j=await server('apiGet', id); if(!j.ok) throw new Error(j.error);
    SIG.final=j.final||null; SIG.mode=j.data.sig_mode||null; fill(j.data); dirty=false; loaded={sop_no:j.data.sop_no, version:j.data.version, status:j.data.status, rev:j.rev||null}; updateMode(); applySignLock(); renderPreview();
    $('#recSel').value=id; $('#listModal').classList.remove('open'); window.scrollTo(0,0);
    toast('تم تحميل '+id+' — يمكنك المراجعة والتعديل ثم الحفظ'); }catch(e){ toast('خطأ: '+e.message); $('#recSel').value=loaded?loaded.sop_no:''; }
}

/* ================= Record picker (dropdown) ================= */
async function loadRecords(selectId, preloaded){
  const sel=$('#recSel');
  sel.innerHTML='<option value="">جارٍ تحميل السجلات...</option>';
  try{
    const j=preloaded || await server('apiList'); if(!j.ok) throw new Error(j.error||'فشل');
    records=(j.items||[]).slice().sort((a,b)=>String(a.sop_no).localeCompare(String(b.sop_no),'en',{numeric:true}));
    sel.innerHTML=`<option value="">— اختر إجراءً محفوظاً للمراجعة والتعديل (${records.length}) —</option>`+
      records.map(r=>`<option value="${esc(r.sop_no)}">${esc(r.sop_no)} — ${esc(r.title_ar)} — الإصدار ${esc(r.version)} — ${esc(r.status)}${r.sign_status?' — التوقيعات '+esc(r.sign_status):''}</option>`).join('');
    const want=selectId || (loaded&&loaded.sop_no) || $('[data-f=sop_no]').value;
    if(want && records.some(r=>r.sop_no===want)) sel.value=want;
  }catch(e){ sel.innerHTML='<option value="">تعذّر تحميل السجلات — اضغط «تحديث»</option>'; toast('تعذّر تحميل السجلات: '+e.message,6000); }
}
function pickRecord(id){
  if(!id){ return; }
  if(dirty && !confirm('توجد تعديلات غير محفوظة في النموذج الحالي. هل تريد تجاهلها وفتح '+id+'؟')){
    $('#recSel').value=(loaded&&loaded.sop_no)||''; return; }
  loadRecord(id);
}
function updateMode(){
  const no=$('[data-f=sop_no]').value, tag=$('#modeTag');
  if(no){ tag.className='mode edit'; tag.textContent='تعديل سجل محفوظ: '+no+' · الإصدار '+($('[data-f=version]').value||'—'); }
  else { tag.className='mode new'; tag.textContent='إجراء جديد (لم يُحفظ بعد)'; }
}

/* ================= JSON ================= */
function exportJSON(){
  const o=collect(), b=new Blob([JSON.stringify(o,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=(o.sop_no||'SOP-draft')+'_v'+(o.version||'0.0')+'.json'; a.click();
}
function importJSON(e){ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{ try{ fill(stripSigs(JSON.parse(r.result))); SIG.final=null; dirty=true; loaded=null; applySignLock(); $('#recSel').value=''; toast('تم الاستيراد'); }catch(x){ toast('ملف غير صالح'); } }; r.readAsText(f); e.target.value=''; }

/* ================= Print ================= */
function sec(ar,en){ return `<div class="sec">${ar} <span class="en">${en}</span></div>`; }
function txt(v){ return `<div class="txt">${esc(v)||'—'}</div>`; }
function tbl(name,rows){
  const cfg=TABLES[name]; if(!rows.length) return txt('');
  return `<table><thead><tr>${cfg.numbered?'<th style="width:28px">#</th>':''}${cfg.cols.map(c=>`<th${c[3]?` style="width:${Math.round(c[3]/9)}%"`:''}>${c[1]}</th>`).join('')}</tr></thead>`+
    rows.map((r,i)=>`<tr>${cfg.numbered?`<td style="text-align:center;font-weight:700">${i+1}</td>`:''}${cfg.cols.map(c=>`<td style="white-space:pre-wrap">${esc(r[c[0]])}</td>`).join('')}</tr>`).join('')+'</table>';
}
function buildDoc(o){
  const ch=[...o.channels, o.channel_other].filter(Boolean).join('، ');
  const pre=(o.prerequisites||'').split('\n').filter(x=>x.trim());
  const L=n=>window.LOGO_SRC?LOGO_SRC(n):'';
  return `<table class="pgwrap"><thead><tr><td><div class="pghead"><img class="s" src="${L('sru')}" alt="SRU"><div class="ref">${esc(o.sop_no)||'SOP'} · الإصدار ${esc(o.version)}<br>${esc(o.title_ar)}</div><img class="i" src="${L('ictd')}" alt="ICTD"></div></td></tr></thead><tbody><tr><td>
  <h1>${esc(o.title_ar)||'إجراء تشغيلي قياسي'}</h1><div class="sub">${esc(o.title_en)}</div><div class="band"></div>
  <table class="kv"><tr><th>رقم الإجراء</th><td dir="ltr" style="text-align:right">${esc(o.sop_no)||'—'}</td><th>الإصدار</th><td>${esc(o.version)}</td></tr>
  <tr><th>الإدارة / الوحدة</th><td>${esc(o.department)}</td><th>الحالة</th><td>${esc(o.status)}</td></tr>
  <tr><th>فئة الخدمة</th><td>${esc(o.category)}</td><th>التصنيف</th><td>${esc(o.classification)}</td></tr></table>
  ${sec('1. الغرض','Purpose')}${txt(o.purpose)}
  ${sec('2. النطاق','Scope')}<table><tr><th style="width:50%">يشمل</th><th>خارج النطاق</th></tr><tr><td style="white-space:pre-wrap">${esc(o.scope_in)}</td><td style="white-space:pre-wrap">${esc(o.scope_out)}</td></tr></table>
  ${sec('3. مالك الإجراء','Owner')}<table class="kv"><tr><th>الدور</th><td>${esc(o.owner_role)}</td><th>الاسم</th><td>${esc(o.owner_name)}</td></tr><tr><th>البريد</th><td colspan="3" dir="ltr" style="text-align:right">${esc(o.owner_email)}</td></tr></table>
  ${sec('4. قناة الطلب والمتطلبات المسبقة','Request Channel &amp; Prerequisites')}<table class="kv"><tr><th>قناة الطلب</th><td>${esc(ch)||'—'}</td></tr>
  <tr><th>المتطلبات المسبقة</th><td>${pre.length?'<ol style="margin:0;padding-right:18px">'+pre.map(p=>`<li>${esc(p.replace(/^[-•\d.)\s]+/,''))}</li>`).join('')+'</ol>':'—'}</td></tr></table>
  ${sec('5. الموافقات المطلوبة','Required Approvals')}${tbl('approvals',o.approvals)}
  ${sec('6. خطوات التنفيذ','Procedure Steps')}${tbl('steps',o.steps)}
  ${sec('7. زمن الإنجاز والتصعيد','Target Time &amp; Escalation')}<table class="kv"><tr><th>الزمن المستهدف</th><td>${esc(o.target_value)} ${esc(o.target_unit)}</td><th>الأولوية</th><td>${esc(o.priority)}</td></tr><tr><th>بدء احتساب الوقت</th><td colspan="3">${esc(o.sla_start)}</td></tr></table>${tbl('escalations',o.escalations)}
  ${sec('8. التحقق وأدلة الإغلاق','Verification &amp; Closure Evidence')}<table><tr><th style="width:50%">طريقة التحقق</th><th>أدلة الإغلاق</th></tr><tr><td style="white-space:pre-wrap">${esc(o.verification)}</td><td style="white-space:pre-wrap">${esc(o.closure_evidence)}</td></tr></table>
  ${sec('9. الاستثناءات','Exceptions')}${txt(o.exceptions)}
  ${o.references?sec('10. المراجع','References')+txt(o.references):''}
  ${sec('ضبط الوثيقة والاعتماد','Document Control &amp; Approval')}
  <table class="kv"><tr><th>تاريخ السريان</th><td>${esc(o.effective_date)}</td><th>تاريخ المراجعة القادمة</th><td>${esc(o.review_date)}</td></tr></table>
  ${approvalHtml(o)}
  ${sec('سجل التعديلات','Revision History')}${tbl('revisions',o.revisions)}
  <div class="foot"><span>${esc(o.sop_no)} · الإصدار ${esc(o.version)} · ${esc(o.classification)}</span><span>نموذج SRU-FRM-SOP-01 · إصدار النموذج ${TEMPLATE_VERSION}</span><a href="https://ictsru.github.io/ITOC/" target="_blank" rel="noopener" style="display:inline-flex;align-items:center"><img src="${L('itoc')}" alt="ITOC" style="height:26px"></a></div></td></tr></tbody></table>`;
}
function renderPreview(){
  const box=$('#printDoc'); if(!box) return;
  const o=collect(); box.innerHTML=buildDoc(o);
  const n=$('#pvName'); if(n) n.textContent=(o.sop_no?o.sop_no+' — ':'')+(o.title_ar||'إجراء جديد');
  fitPreview();
}
window.renderPreview=renderPreview;
function fitPreview(){
  const sh=$('#sheet'), pane=document.querySelector('.preview'); if(!sh||!pane) return;
  sh.style.zoom=1;
  const avail=pane.clientWidth-32, w=sh.offsetWidth;
  const z=Math.max(.45,Math.min(1,avail/w));
  sh.style.zoom=z;
  const zl=$('#pvZoom'); if(zl) zl.textContent=Math.round(z*100)+'%';
}
window.addEventListener('resize',()=>{ clearTimeout(window._fitT); window._fitT=setTimeout(fitPreview,120); });
function showPane(p){
  document.body.dataset.pane=p;
  document.querySelectorAll('.paneTabs button').forEach(b=>b.classList.toggle('on',b.dataset.pane===p));
  if(p==='view') renderPreview();
  window.scrollTo(0,0);
}
function printDoc(){
  renderPreview();
  const o=collect();
  const old=document.title; document.title=(o.sop_no||'SOP')+'_v'+(o.version||'')+'_'+(o.title_en||o.title_ar||'').replace(/\s+/g,'-');
  window.print(); setTimeout(()=>document.title=old,500);
}

/* ================= New / Example ================= */
function newSop(force){ if(!force && !confirm('بدء إجراء جديد؟ سيتم مسح النموذج الحالي.')) return;
  fill({unit_code:'ICTD',status:'مسودة',classification:'داخلي',version:'1.0',department:'الإدارة التنفيذية للاتصالات وتقنية المعلومات',review_cycle:'12',target_unit:'ساعة عمل',priority:'متوسطة',
        signers:[{role:'إعداد',name:'',email:(window.DATA&&DATA.user)||''},{role:'مراجعة',name:'',email:''},{role:'اعتماد',name:'',email:''}],
        revisions:[{version:'1.0',date:new Date().toISOString().slice(0,10),change:'الإصدار الأول',by:''}]}); SIG.final=null; dirty=false; loaded=null; applySignLock(); $('#recSel').value=''; window.scrollTo(0,0); }

const EXAMPLE = {
  unit_code:'ICTD', sop_no:'', status:'معتمد', classification:'داخلي',
  title_ar:'تهيئة حساب مستخدم جديد لمنسوب الجامعة', title_en:'New Staff User Account Provisioning',
  department:'الإدارة التنفيذية للاتصالات وتقنية المعلومات — العمليات التقنية', category:'إدارة الهوية والصلاحيات',
  purpose:'توحيد خطوات إنشاء وتفعيل حساب المستخدم الموحّد (Active Directory / Microsoft 365) للمنسوب الجديد، بما يضمن جاهزيته من اليوم الأول للعمل ومنح الصلاحيات وفق مبدأ الحد الأدنى من الصلاحيات.',
  scope_in:'- منسوبو الجامعة الجدد (أكاديميون وإداريون) بعقود رسمية.\n- إنشاء الحساب، البريد الجامعي، ترخيص Microsoft 365، مجموعات الأمان، وتفعيل المصادقة متعددة العوامل.',
  scope_out:'- حسابات الطلاب (إجراء مستقل).\n- صلاحيات Oracle Fusion ERP (تُطلب عبر إجراء منح صلاحيات الأنظمة المؤسسية).\n- حسابات المتعاقدين والموردين المؤقتة.',
  owner_role:'مدير العمليات التقنية', owner_name:'Mohamed ElMahdy', owner_email:'m.elmahdy@sr.edu.sa',
  channels:['بوابة الخدمات (ServiceDesk Plus ESM)','تلقائي من نظام آخر'],
  channel_other:'يُنشأ الطلب تلقائياً عند اعتماد قرار التعيين من الموارد البشرية، أو يدوياً عبر البوابة من مدير الوحدة.',
  prerequisites:'قرار تعيين معتمد من الموارد البشرية يتضمن الرقم الوظيفي والمسمى والوحدة.\nرقم الهوية الوطنية / الإقامة ورقم الجوال للتحقق.\nتوقيع المنسوب على سياسة الاستخدام المقبول (AUP).\nتحديد مدير الوحدة للمجموعات والصلاحيات المطلوبة.',
  approvals:[{level:'1',role:'مدير الوحدة الطالبة',when:'دائماً — تأكيد المجموعات والصلاحيات',sla:'4 ساعات عمل'},
             {level:'2',role:'الأمن السيبراني',when:'عند طلب صلاحيات مميزة (Privileged) أو وصول عن بُعد VPN',sla:'8 ساعات عمل'}],
  steps:[
    {desc:'استقبال الطلب في بوابة الخدمات والتحقق من اكتمال المرفقات (قرار التعيين، نموذج AUP).',role:'موظف مكتب الخدمة',duration:'30 دقيقة',output:'تذكرة مصنّفة ومسندة'},
    {desc:'مطابقة بيانات المنسوب مع نظام الموارد البشرية (الرقم الوظيفي، الاسم، الوحدة).',role:'موظف مكتب الخدمة',duration:'30 دقيقة',output:'ملاحظة تحقق في التذكرة'},
    {desc:'إنشاء الحساب في Active Directory وفق معيار التسمية المعتمد وإسناده للوحدة التنظيمية (OU) الصحيحة.',role:'مسؤول الأنظمة',duration:'30 دقيقة',output:'اسم المستخدم (UPN)'},
    {desc:'مزامنة الحساب مع Microsoft Entra ID وإسناد ترخيص Microsoft 365 A1 وإنشاء صندوق البريد.',role:'مسؤول الأنظمة',duration:'1 ساعة',output:'بريد جامعي فعّال'},
    {desc:'إضافة الحساب إلى مجموعات الأمان والتوزيع المعتمدة من مدير الوحدة.',role:'مسؤول الأنظمة',duration:'30 دقيقة',output:'قائمة المجموعات'},
    {desc:'فرض تفعيل المصادقة متعددة العوامل (MFA) عند أول تسجيل دخول.',role:'مختص الأمن السيبراني',duration:'15 دقيقة',output:'سياسة MFA مطبّقة'},
    {desc:'تسليم بيانات الدخول المؤقتة للمنسوب عبر قناة آمنة (رسالة نصية للجوال المسجل) مع إلزام تغيير كلمة المرور.',role:'موظف مكتب الخدمة',duration:'15 دقيقة',output:'إشعار تسليم'},
    {desc:'تأكيد نجاح الدخول مع المنسوب وإغلاق التذكرة مع إرفاق أدلة الإغلاق.',role:'موظف مكتب الخدمة',duration:'30 دقيقة',output:'تذكرة مغلقة'}],
  target_value:'1', target_unit:'يوم عمل', priority:'متوسطة',
  sla_start:'من لحظة اكتمال الموافقات والمتطلبات المسبقة في التذكرة.',
  escalations:[{level:'1',trigger:'تجاوز 6 ساعات عمل دون إنجاز',to:'قائد فريق مكتب الخدمة',action:'إعادة الإسناد ومتابعة العائق'},
               {level:'2',trigger:'تجاوز يوم عمل واحد أو فشل المزامنة/الترخيص',to:'مدير العمليات التقنية',action:'تدخل فني وإبلاغ الوحدة الطالبة بالموعد الجديد'},
               {level:'3',trigger:'تجاوز 3 أيام عمل أو تأثير على بدء عمل منسوب قيادي',to:'المدير التنفيذي للاتصالات وتقنية المعلومات (CIO)',action:'قرار إداري وتوجيه الموارد'}],
  verification:'- تسجيل دخول ناجح للمنسوب إلى البريد و Microsoft 365.\n- ظهور الحساب في المجموعات الصحيحة فقط (مراجعة من مسؤول الأنظمة).\n- حالة MFA = Enforced في Entra ID.',
  closure_evidence:'- لقطة شاشة لخصائص الحساب (OU، المجموعات، الترخيص).\n- تأكيد المنسوب داخل التذكرة أو رسالة البريد الأولى.\n- موافقة مدير الوحدة مرفقة بالتذكرة.',
  exceptions:'- الحالات العاجلة (بدء العمل خلال أقل من 24 ساعة): تُعالج بأولوية عالية بموافقة مدير العمليات التقنية، وتُستكمل المستندات خلال 3 أيام عمل وإلا يُعطَّل الحساب.\n- غياب قرار التعيين: لا يُنشأ الحساب، ويُعاد الطلب للموارد البشرية.\n- أي استثناء يُوثَّق في التذكرة مع اسم المعتمِد وسببه.',
  references:'- سياسة إدارة الهوية والوصول.\n- سياسة الاستخدام المقبول (AUP).\n- ضوابط الهيئة الوطنية للأمن السيبراني (ECC) — إدارة الهويات والصلاحيات.\n- معيار تسمية الحسابات المعتمد.',
  version:'1.0', effective_date:'2026-10-01', review_cycle:'12', review_date:'2027-09-28',
  signers:[{role:'إعداد',name:'Mohamed ElMahdy — مدير العمليات التقنية',email:'m.elmahdy@sr.edu.sa'},{role:'مراجعة',name:'مدير الأمن السيبراني',email:''},{role:'اعتماد',name:'المدير التنفيذي للاتصالات وتقنية المعلومات (CIO)',email:''}], approval_date:'2026-09-28',
  revisions:[{version:'1.0',date:'2026-09-28',change:'الإصدار الأول للإجراء',by:'Mohamed ElMahdy'}]
};
function loadExample(){ if(dirty && !confirm('توجد تعديلات غير محفوظة. هل تريد استبدالها بالمثال؟')) return; fill(JSON.parse(JSON.stringify(EXAMPLE))); SIG.final=null; dirty=false; loaded=null; applySignLock(); $('#recSel').value=''; window.scrollTo(0,0); toast('تم تحميل المثال — عدّل عليه أو اضغط «جديد»'); }

/* Cairo (SIL Open Font License) embedded for the signed PDF — same as the ICTD Policy Platform */
const PDF_CAIRO_CSS = "@font-face{font-family:'PdfCairo';font-weight:400;unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC;src:url(data:font/woff2;base64,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) format('woff2')}@font-face{font-family:'PdfCairo';font-weight:700;unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC;src:url(data:font/woff2;base64,d09GMgABAAAAADaAABAAAAAAoUgAADYdAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGoQSG6NWHJFGBmA/U1RBVEAAiiIRCAqBvXyBoRALhhQAATYCJAOMJAQgBYQkB6VgDAcbsI4X2DaNGnY7gC2f6h0yOa6D84Kg62euo6gdnJR09v//ScnJGDIsUNUsq/+HmG3mrJJRlYuMJvfiqgFlqJeOUqROrEPEs3UFocRxXhmLGNPkttkTRDRaHMNvyOeNOdGpGh5y7O+QPoren9Kv726fcBFtsUQUBYVTMndiY3k6SgkfJUtVaarBB+7g32D1X1cu78CT3rnSB194iTEn845vXEwb9DesLQo9QmOf5ML//+fV73NfKml+QOn1RwJHNEcWR6zhebf1/meKqCigiKSIiKg4QFyIiIioqIiIinOAOPm6KyfZPK/MxtnYNraZjaXWlY1l3e663VhnpTaF4l2Dd2Y3yX2C56EgHKMuy7Kqb4VxrScSCvjC8/3f+7jPzCs/FA9oKMIVONQaaOVQkAMW7RSN/XUnAHyxlr60UNBbFwE+oT0KT1Ignqt9KyJPcjl3cF7Ikw8yAobWWtYaPZHJKypnKnOzoUIp//2PsHkUIm/HXjEvF9W0fKFWDK3zh54Waju94MnZr4+OcjDhlmoEhmxoMMVyPuhQHbuydvTkcq2SgOimAijTnfQ96pdXWcTMkVY/MOdSXT2ijTZTv1oCvvf9teaQS2a+2ltEpLKeoieLkG1e+muAlggPwibMARjP+dbstTOfOL/AZFMC9d89X1AVbncmd5PZDR4m2SPKZ9xZyE2ym/1EoEoMwjApJMn+G1slK3SFMRWyskL21e9b1k5uqH9ptt+hTjiiUXMo5AWhMA6mprs21eV2hByme0bMQnYpCoPQSIziYQ1CG3w+nVk7f0fzMrIVkCcE1qlZOMB+dVD21ozsEVgGrb2ksDdAYIewuqq4omPokjLVdYivv7JIUTQHz+O02SaP1ZSVU5xDyTuwBhJmPrNhV1HktHtU4rAahJ4eo9EgDMpJIEx08rKTtDvzVM6oRihmwuN8i+RJ23uPK4TimiCEEF7XmJCaIT2/p3M/pvU7qVeSLc13l5jYEBBGQCSKNf5WPtAIWFUAkgG0iyfqovseqjeJVQpD+OGhWun5C7gZyoTrHIcANZhpGtRRS0OIj1CyszTQfwzAoJkIB6AkPSmKt96UxMcQSqEgIYIHcp+GBmFSo5OgvcsSmKnKmA28KcdoAE24PFwdMJagsQVBRgZB1QJioXHQKBSmMIUrX89NMRuUyi1fZLDnQ4GAAVQDSADCKXxuqulmmGX549VoldXWWGud9TbYZLOttrnQRS62w0677LYHCIK0pqkz02wrrBSx0RYgAHEk6ISq8kqCFggf1RUUAvaLAqQKUKABEJ1XAAaq9kL1fH9Et4/rqoC/xl5/KMuA9bKiMqEnbTSYILQHIID88SGwKT4nyfG8qN2NNVhIIAhAQNKqBeJfRJxMueWqMWeNOGKfnTZbb7UVzNq1QFQpVyhbGjUlOYkQEK1VAMS5+gUIQ10Aor3DgFjdrUC01+yGfXlLZzgJckCjvaLe2l21MN9V/xScy1f1lNIDUNrH+vDs8t4nZr3KvWsoga78QK8R4OydjRLpvfNQFHACkmfrkYr4ZrLf+IIXeIRrOIUj469hBzZhNZaymZicji3p8B0D0fsedV0dfSUErKBXL3Ll0nxdBSkRIV9cLAz2ILpmfENXadWKNcfV9s6RWVuvX/MsClcs/KMOb657IYAmHlB+XvAGf+NHXMFpDGHg9rqXGfn/egF1AFtNTgFkiC3T4+GfWTaXTfiBAZnfnHJ9l7149DS64mBwDx0oCuu70rJTJI4TKSx3HupzX/TP3utYR3uoqw9oQCmymRRB4IBBiCb8GdN4gitkpBZrZyvogxkNMCIbCZCREGuMfW/CjXOsoa++85mPfegNxzzmkOvttckqc1UpV8RX/0KjEktGzI4/r8sRIPs4SkATVH8kNmc0dpf1QApNsJPtTRvPWMsLKhJem1YkDonPo4BxrsfHoeMGMJR6eFw9RoAh2I3j/DEK5B43tXbudfiCOl9eQ8j98+KNTpZ/vHirFzOjml/Z5iAE3UcTkOdzToGdGYJ9zVxK6aGDUG6srrWQ1Vtj+4sWxUhpdIfykB+qSXEVx5/HkVVpuVjcwiOLU3OxtLpRXf/19WC4nIN2YMuMwxqHX+XZ56PLKhq3ldq4gouM0l3uReeS1OSj1B1H0j9K+TGJbhi5x8W0dyLURsN459Wpsbxjo9TQKh5GqXyZmWOH5Pk/4FEYBTBM9KMNApDungQAQ0LwjeG1m9iDTRE+nIeDAD3jXFY9dDEp0WPpOmHE4W1lmDu2GtXdfACw2O0/6Cxylh0kuoVPj7tykmM7Pe6aL860O20XJg2J2ByeRr0fQxn0bPtVMqsOKaUWZfexaIDvhvb5aDgahoO5756o8/+7RHcfmDA+11sKj/gEduEcLtBTcGLuxGoC17iLps4t3LVTVtbtyimf7y6Uc004P98td6tOHVPl4jOTyaJRR7I5by8m4Wg6yo5Fvzvrrd7nMbMM/itluzrL2EoNAwosV4nVx1dalgcA9OZGVa0Za/GKsXPNtnussgdHn+1zCpN7MzXWX11PKefIOSa3l54Iz2A7+rEeSmAD6dh4wfH2DtKTqe6mPEcy1XE3t25J3ZcQ0Nwl7GFn0wfFtj//oBfU9xPe7r70L2ljebCOiX132FOaaFnr/IaCUdVfvCDshZjphRfvWypCVCK+aWIC962B9VVecyOKbHZvvDpb5lEk20sE6Ht9efBqdX6MvxkiZ4+aZVjFK/ct04nipREJK5cphHSJhHD5CuniCuFiCeli2PaL1CREZtFYEavm1zknppdIvJhz4t8l2vV4+c6fbT41byGuzrGLSM5yEckI0REk0T4kYufczNZjNVYI82xnLUB2Vc3yWYhEZM80oZ7KSI4kkiARIVMgeJMTMZFEdCSCMq1LeAzcQn9GIWYm/OFvxrPx93g0fhz3xo1xZVwEpzGMQ/nQ2I4YHANRH5JoGZKoG0m0CIloGnXMKErHgMgfmUI7VCJ2yGpAjKDcf3gh2MNZ0IadIKKxJYD6varv+ko8Wb7hnxy17OfcEpZT+msf9k4n9cBEz3dUnnusB7q7W7sR/ViF3ryzbV/yhtZEYSDFWvPc6oRp7IQqIIXoCeGyr2+7XA/cnLV8qUa012L0ayepBBRaeb6+BTyXaSDaZtP3Zt6JLXmvLXlVqv7cVjK/sUse/rNTGWx3MYoLa+r+lT9V/5KdB8JOvyPoUh41YM5v0mgspyxCa8v2pjTfyaqiV9X5s02FMrFRDMNSMrrKHVMx+VlIqr8sza31Zk0oPxcn/KHGicYXQgt16BOIzc3InuSHKJGPaE1ytm2u5AxbdYabNK87ySxAYul926V9zKNeqEvYXH5e/VA/A8Y+aWaywW1ploXsuXNroNTVs1t9z5AtCzYrpseHcPicZI8b9khmsxK8oSYJxWSwDDMyqy+orfjMIQkZCtmbkHMqA1H2yj7lXLjjRBfpc6f3TpI7nM5ZTut61OOSMS6PVh9Fk9CHDMk5xzqdayv2Sssnz2/OUja0+G4b3G+FKLlsccLrFhlbev9veI9siwGQ0J7T7OtD4QdNK1rC5gu2i7LBaMuvXIUV3xa/Xup474ZWznNB3EGzTH6NS7iFGMtPL9t08sCjXdF/+MTUAWf0ahNiyaYNu5m+adaA2dhmdnc0MYodFfZfc4L+bz0Aa2wSeLN67oBqAUmuKIcQFAIP+cBEJlC+fjIAFAMgwQDwF8QMwDeAD7X6oiz8jSfOPRD3cAlncDE9AHalWzRdJ1iL5fHC/wYXYxqimzlhry4Hu92DUkv2mtmTd/H4ry91VJspLN11iDFiCrCP5WG0XKRAgFVS4ibJcjNhZmM+zP7MY4EUUMwcL+2EV9Zsuggmyr1Q/B4FMJi3WRKhAISPr8NSiIuhpMMemGCyDXjg5Yr3T+IMAgYAWqjYBAOFrgfkNhcm36eboPYcVezKAKKsKo//Y55IMlHkoinEiGVUA9Hiplse+sGvfvOnvzzx1CuvzZg150NgCAWhIQxE0lY7yTJ1lSNXH33lKwAGDwMDzDHHQAwbBjFiBMyoURBnnQVx0UUQY8ZAwKAxMoKoUQMCgYBo0QICAhBHrtEFHSqllM+XYoCavi5nAgIgOm8t6+QYsHs2ZXgDGnA9DxyJa/dhZQ3QftgiCX+rSg4Ud2wPAemL6iIjEP01IweA8J1RXwZ4FH7nbeDXQMCChpHnlwlA4P+8zi77eX7IBxMStH2+OuQeQe473VxjRcXDt9Kfwvg741mXqdOeKdu1y8WDhYeDiY7CWgJg5AkCZjSBwAyHD4wsAcCsjhCYY9BjzihfQvEnwUf7nU2FK5x48aTH+wKBuOIOGyYs3J7AI553xziTakbqhrXmvj1mcpXI1c0SuGLxTFRhqXFhAQ+Y4jrX+J7LFyDGDjo0SFCq7FWEjBOO2ELF4T5uWaggBU2ONURghS/WB0s1OAEMNliBwgJchSXCjDkNjFb/zM28HvsQ84Q/d96VX2RmjpcjI204QVypBu9ZuDLRceZYNSDURdZQk1NWVcREZKSExIMlOAT42LiDecjoaEgoqH9lw167JydYYbmNIMgwOHDiyl28BEnUUmil01luhTWOOuHU3C/HPvA8GkMUNA2lb8KcltlA/ksSIGINiT06JjYuHn9CIcQkpGTkFGIpqWikyZSrUCmDKnUaNFmkk9kyq6y23kabbbfbPgcccsQxw0adddGYy753zXUPTHnquZde+99b78364JMv5iEhFISBcJAFZAlZQTaQrWSpOuiokwt0ASITBhwWWGKFDVSOXLjx4M1PgGBhwkWIFCVajDiJkqXKkKNACb1Kteo1WqhDj6VW+tZaG2yyzS577XfQYUcdd9IZF1wy4YqrJt1w3xPPvPDKG9PemTHno8++BkAGoSEshIcIEBGyhkjaSdFemnQZOht9d4g7W2t+nicffIFCxUuSIl2WPEXKVKhm0myxLkss9401Bnxnix32WGDvu+fgtdTckdEwsHB48SUQRCSBmpZOtnzFyvvk39+uW68V+vRbZ9BWOw1xNuK08yDcDXu5Ka+0GzfgGYTfQQSlJCNVA4FSnPEmOG2/7LDUz37khtOGDOhWJx8HAwRadcAyer1k0boa7dhsi2223sW2yYW2wXbbbKcYBAuWyLZqmq68ol1VtRpZ3FjDorsIBQsbq2lrrBUElzYtgemFIqISRZe1SKmhWld5NVXnZisQlr8GIZW/9iCN+8mW4TldoJ00Z8EAbGp0AGoH/UvLV0sE4fG8TY6znaYx3G8F72oVYCvm+oxx+P8yEMmRsLvgJjxAv3IWQA5oIFspgDQfIM/16PdpFQJBAAx6XI5AAAgSiQIU0FBRZHIusoMBcLQKCihwoSPW/11e0w6LGlOkrS4FVhqsFZbKiQuRNDp6tZotYkYQGUIpeVUDE0si0/NTMhnoqWQhS6NjE1Pzy1euWr9Jf/2NllhhrY22uuTp51965bX/9wWPhI6NJ8L0104IDIHBkSgMjkBKTkFJRU1Lz8gMxhKpTK5QqtQazdavn+cDZRoSXa6kGctngHOXbt1vOmVU0Orik13Zirem3rjfvp+jLLbMSk02a37q2RcfhPPPFcOKA1eeJAApKBxRY/FEMreuoWNgYoHGk+lsvliu1j+A6cdb/s+u/r8LoJ+CnMhE8H3+5egemr38umututu4ubMXrDm6r49eaj43z6E4WZrVP9/4AKDZTlsf778ZgIrziIHUnOwsyNy9F+4Qb7TL7I6XnQANBli6lLDmTqD/FAPKdMwx3NXwjHLCu1R7WehoKqmX5hBKI02GzJ1QNll7zSMXoPyvvYQiJQCVU6EKoCb0z7eOGnXmWqyBL2wPOvanzhqtEVHMs0anW2Cb7Xbb6wr77He9g251p0MeWKGPa6mWFoLGEhyHWXASBqq9vjrg3Qvinaa/Vsbpdx5PHdvgoI/W9C45dvucS6+wzFBFFmBDfQxYeXVpf5/4rE0OdAxOuLx4qlKjmj8Bvk7dupj1WmKzrbbYbcgeY0lRa7o6s8w2w0ycLXDWeefcD8MAhQbOFjvcdsfdfYdHfvd41qhMZUHPq3z2tYc9N3tpzHgSGCKNJJQv5kcM/3ty0JFZT4OCbAcyevqUPc2ByXJlc9x5vj7CoMAQUaiSoTmBlxRZM3TLsb3Aj5I4K/Kqqbf73fm6+H/F8lVg9/nGav3W2GjQd4aNOGHSdVd876prJlwGAUW5DgBNAYBLBdBOQPrvINtXAon9AcEpAGDAUTMCBCr6jK4rQIMmSNSqQkAHmwywvnBgeGqdCGTNfhk+eWDSSZgVMx4Mil4fvyUsjsSpRaAwCVi8HmRYVD0MI1JMflhRTf72xRWEOdpHG9OJC0aPTXBvmtfGyT2YyYkJJ87icCBBMuaHbqrrIkS/LxAVgENq2xNj4dhiACk5socofCCOq8UNE+lhw2ABp6gQ3HKg2xmHjACemIzCWBEKcYWvYtE7cHiqezHsr3OnmtpvW6WiR3TK+ihMqdJGFm1kw2ypFajTxcnT+OdXeUT33F88u8WL3nn3zGzOZuednniyn6YQELaqaCL5YaBMv/wW5dKXMRHn89fFnWFNgzpvFop5q55poO5QRi8D/XrLSU2JKiFgJdb99VDUuA7o5yKAdzgulkibkDdQMtjE2ZuOMIFPeTtWOqjfUDRehT5D4AfWZWwWz8NU1emDFg3NODI0Ia0D/dcolgC6OWcYKAG1eCXte6l89Vb9o5w1G5X2Rnt84L3/ZdpFYhUlog8hJ0lNDcKrp810xJ8ek/We9t0Q8siBQRKcbVB37CGN7duNh/v7iY8dau6U4PDOl8ybFCaLTEMG1YtX50Xc3oCC13bu5cTeBWLYNGg4PtfO5uPPoMQ1YFUmUFVB1kOVzgngBIoHU6Jb5YumVE8i5Ku073Z3qVY2TgtyYAYFLI1XgUQXGCVixWQfCtMLrHHXgawClDZMMm8tZ+lp/Z3HieVm4kA0fD1j55oxeBoOSSIrWXGSKicAtAI5wo/ZmErXjFDDB9T5TDNV0whLziO3BXwHgypBrbWGVaU17R0YY+Rcsfg1ziLTElI92cvwGDMoJOa3h1GabgOCY+3Uxbk0GzNoDb0aO3L9YIOyWy4krGjA6FF/GZ58fd0nJofa0U2gx6aOvBVfBvj8uEU0Tb59spKSEmWvk5zGVJ404vo55l2URWah65jJFqxkeFQoWTo1m/I8cvWFm0hWF2mWMGifuLU0VjObUR8/u+ug5KP3rN9VAglJPZvp2f7c/NT107NrzO6tHYV/0U4cMRcKKWS+J1oaWbFCNND21PXjTY73zheQNF1fYhLHhHAZ5rv4SHX5bai841a+m3ZZ38dHxmRHSvbucigfpA3i9xNDahPtjdkne5xBxcRiplMLHTwSGmQucpRyNxRSwOklNOnM7hhnavPIbUlCGvC+b07jrkik+6rP+rtS7XwL+3UD2udMKetVaL1DXmfM/K5N5e+zIYgTkp2VqCyOLiXBEszNLj8uZ8BQ1U3R5cIgXXKrGE2BMq7/XWUsR2LKtOq1x57OC6GxXZloa/o4iboIqcNjnXmpauC5xUedkoYxhH9Eavg3pYsajbvySFOrpWW3PnXjd/PhSUr4UYijrduX36SOyIbikvw2Z9fkdOpz0qzR5jKbN3kGs8iQRBZQBg/nymn/mX96iWl23ym9DC+twfiGWOKjs0cBO8zwsNveUmCX7uswGR5pGaWHorC91L+jwZ4lO2Nmnwmr8aiL9FoqxF6RdVTuiu+dJ/oxP+SO9AK913fDYA6+pX3Vh7Q6+lcYqZW+Qcje6m4/QfK/w7DAYoUtGZrrR1zLirMVTpbvENpNJ2gZ8TnSbGrrccLKQXrtxBCzI42pAuKcyTK+6dp5OEzXFvaeXQKpbeaItMezuK0T8QUbr2FQTipvf3prf7wqY7az8p9r6zSZv/Oi64vXl3Q8qE+XNViUdFi5fDV9AiAuqpxZTeeGScTuPAr/k+U7L2AooaQ+1bviVZeGpmg54O6MTvvBt77qnKvKmlbjVs2JBWq4wbLhwBmsGzFltikXzChSNFYk5Zo0h9bzNWs9C2u3ogo1fMxNN/zrx+wbbwFqkx5X6w37VozZcGKCCmHnSzZ5hpKVM7G2Tnc6w0lvyPXTIdlfoqqWBMY7JrMF1aXTGS1vndc38/NIavZtYASaxaA59nB2cRb3hoY1i7Q3dFfmqQPd+6YXtCSXqaFiPjZHG+Z+DmlZoyBT+AYttqGhTGrTLjMclAq/aILdmwhxp+HpiKFUhx4OjWxHhWfRNnTWCtnZKWypaK8H8oYKmpvtYS9V2wjZQzc/nXFBLo1xTwdmC7ii0L7R1XY24k/kGUXffRQ+v7Ad7lKt6yUMMnEgmfpjLUa+RyGh9if0UXbjwds1SE3eFdjkUIHyCDZG2eJpNxVOtEzO9yT+Rt6X6HjQrcuzOecypvBJl3DTlzHCuGNXq2VOglGPYzg/eHh1r+i/9+ta32WE4r59zXfkxz0hVDmBRX/ph3Xp49vXpXlFzu5ttt04fbvcjTPoUnJTe6xPOZsa63e9Z4ZrCd732Fk4Kz63nypiVzbOUMx4g/DHC5XQ8r1PKA1aGevrakitaFwkpcXUebq0Sibj7k6OytHslXq2V2Re6HlmfIF0nDDcWZ1X9sd+oN9Q2talhyqsYHE7XKgI7AqlkY10Au68rNJx7rf41zJunNewNGm+Q9hfoZ4UxKdO02ZDEXY20hMHS22VjkPL43GdxwaXJtUOwjhtM+yYJ97pGI3edKLSKb0JhOg6DC5yUr2H0L9Alm73C0WWpDvz8V+K+txVt/nI3aPXdW6nG2Hcbj50uxFJOLS3mg3fYVLduDhSF3v4tJ2aY4Rpa+fMvvNt87Rq8nzw4m7jy+7WAzQuFH6UCt4XkvvS125LQ+cuJ0R6gb32m7kZAUHcjJjIXHagp4oyHpYvWubgccSC41Iy+F8h8gkBmeM94+B3pA6Z/RO2b7XYsiSKlRVVVQZqK1YHKys1NG17Pa2D5vdtg6NHl3O8ZYBlp3kGWBQ9AiXyeib0ddul6rBlKqqVXcgqHIKcTJSOpzZrjDgLSSNgIwsRgGAsYE/rLinbkxG+rOqZAYAi+Do6D4Atx778CUD2Z+VkDQ4kNwXICuXRsoImocbYL44PVztqcBzL8tM51jxNW4hCH4//P0YaIBRKAxRWcAGuBjYBZCg7J/vckMxjOl/G4mr8JkP0CEB6JKESn5WKCEWRZB3TFveeNBmMfXW1XOu9PG5nuKomcHLnI0ay+R2jMTwxi7wePOe1BnggeuRa3mHfNzvDqbHFgNRcm0MTp8TK8GSHJOy/hf5enZW3ppUyaDhOWiMABBwWPtFcpCJTNRTDSJS5iJKR5Oz2MFmn4SY4j+iR+WjGAT+J7rNWd3+ga99cwr28DMGYMfIgfYEIPEE6EFnssNCsMv8CmTqb3itJrI6hYCIJyURtepctQWZdhUu04zYrmYHBUS7/uW0wb4hVVnSIJmchUzLT7uewy+bLGT7VOQFKyDPJ2TdZ66eyOxsteUTCSS01LZ3kIisdXuVABuOIHgnPn+PNKN8lBjEgRw3ZVbzJU+3sfMtOEb7kM/I9YaVEzbIuF1Fnce4xyOpHYeY+gCQz7SbF1OPxpdXldAJtML5o0+bcYt7sb11vagruhTrLF3O9E1wjAxeOvnXOr5IkLv8hniKQ5fBEifSCwL9BC2JAQh7PMVU7KfaLfJ1jS+9ot1gg/wYsAOFN/lM2ilr2MlOnubPS5EwOAZphUCaNlVCQ0982jXeVXUyXIiNRlsOWRGXzwhIdD933mpJ6ksCfmkgQKZKN1JMldArRIyw67pp84wqYCI9koR8bdwwZ8yMytaX5kmzU+AkqwsO8C+NjijkhzpGWP3Uzpi0h+8g47Cgelxn9HFwes6vwSA9peEBuXvizPdfurBw56CqN0IcZnfz5FU5hEXqpCyOaL4sKSmJ6TSJbVEv4lRpVoWehZ+iefJc8kpdXHkk/0j2hAd65yuScSKrpV+Kna4ikkiWQCeU0BRa6apmupryTmLIgP8aIdingzCuc+P5GJ+923EJ2bpZP8vR6VoIjuEJQoNqnlaTvTDvCMzYKt+luVLTiRZXS85HpieQcFbC4J/4e+L86FWORD0YZFBYL+5SnGf2E5WkaYbUxJO3PGXAd0SMncrFdO/R33xC+33lLGx5VtJ8QO155auUmlSGpRDn7gIjzV+rBibPQdInjDXIqNoqQTExP67KziLSpxCdSuYpoBv8Z/8N013Eij0gOkjNsLhRWv7rTY2JL24LVQIkYEP3DMIstmrmxAVJPGYnSPvP43ngyc4Rq91NfxZnjvcKc66xfNI2CvPb04FPVkoHp1E4PZfglaYZnUJxjluBHbZrOHFTzzsK9E0VdvdSnsj490Hrbn0uxsPK662/JHC6+zONUlcQ8Hb26bbNU5xkcR+vXEsBADAiVkmkn312eAb9onassxyTlRKDuY+HJsM65aMvWTTViQEDf+kHZDnzlcSxZoknqIUHfR5+LBO/oFVYaue2fqasDkUzc9Ny8xh1POzr3bYe4yQ3zjTUINCB6pJc0KXAwQ2dvC+YXWVtjGjeP/x+3Fnntav7aa64W2T80RcT3WJd4qMJqKsPjbXzESt61c0Lj3hCOilCeklhGiMEksNwxyqVei1iJh/FpfD4+20qZtqGEFBaZTbspsUrkzfDyMqJsSDqvNF82MW8VSEEMSBvDYefinW/8JMTQ3K4hbvx2UNuQ0FNF0GkS0wjROBXHDRvP+MDhF/DpfIFFNvH5NJXYSjIb+KLqvFlHdhZQOpw00iGVmiBSFvrm/lUU3tQclJG5CHrLiv4aDP607vmQ2EFxKyT4lr1CDJiplYHCSq1WWOPvXvdJcz5xoaedQRwaa+sdj4Du7xZbxComA1s3BHirCOWaxDQLOS7JnY2N20BfxAonSnGp1dDRWqkoL1X13q/Km7HES0qtSiL/w5O7O056W9TqydFrKA6p29SpyjQNnhe4Wesy0nMmRqRtcD+Kn0cRV0sanvb9yEeylfvTeGX5vonu6eg0rJtVBi2DXGjlF9nCKlCHLimdajQJ/P01qf6BgSn+/sl8gUHgmBZsbx+T5ii4a5osvNeftIHVVUEpf2550YE8uSyRfedLoQd/GrHol8bD50oalq0sY0m0jFXAcOIgMgMXWrUxZFyOhdpue2B06wxy8ExNGEq3LRvOVYW/qXF9M6yazhqNvq0LVUGeNBbnkBvZ8CMDscPT1lOJPQfaBLHTsYCLrCl3/bwDp2IDrDO4OnLRkaSQD4WQDyr2pIixp8aUrnXgb0SPuOcfvt7U3RS6I4BVYx/gRiqCAQstYCD1aZ5qRI8ozXblb2e7qgk/NjZQozG02LfCk7haOH42ku2gr5hkuaywKQDARY805EhiN4vfH3SzkVXsZKmvTkjOIiRWdNlutiygcDYkMIVOkRFSmau2JelYhuv6azxZqLbCS8nKsUgkWFfF4LJwTPdbEkeq0iR5Wq3hdDAU/NiISkSSzE0YCjk9nEyvVTvrqyVnxOd9XPYX9TcE1L0vQ+hb8/LKiqjM+OCAPWX8rp4uoaNOLCtlJ8QMad1iUtydw5H0kmzEGDN82dtKgh9VSjLT5f4+R0R+ax4fMd0Fms+A6JH9V/xG20SATYk6FGAaJe7fpVqYZxapQxiyOp+sqvt9ad9EFWgaSCC28bIXRJTsXH+v3nnGPAOQ+a1158R9vOWIQZMTS5TOEUwFof+cuIS6yiigTQ4SQjW7HZKQzpke7idgTaaEpEoiLgr82erzAWJAMmvmEPAGB6vSkIBXthbkMwHL6T4yIiiA93W4O3W144sWXATDGNK8mcBP+eD2OZnYOxk5OmQJACzgPOfi8Vxx4nf/QSA/8G5NsebXxhSy/myksUdgTL6ZFTMzEIfU3ykgdyhIZlTKNWhfZ09nY4Wpm+b4My3HGFJd1PuY3DKLaqNrTtZv7qKc6LsfYqD4cRn/eKmP54pmpoBv1r0Z83ii9CRycUH9vfr91NoBMkj9ycyasevIFKhUuXA0bqaHNqPIpTlzv36aasUNshhvVGeu2+nIBgtNPLif3Cgsnpc7a7Z1JHegTbnIqw6dJpj9RIL/ZG8a1LomkUZXLQIRK7y20yU9Ja8RA9KDFCKl4z3jroJtJ4+oLRznWCyfq2Q65J7GZ/mwWHPW1H/2j1qrWLqN1qvTbkf3v6dYz7HOv0ry03C3g89ylzWLRV4NR5PjherACyAJ37myE1T19/SvD/56xKhLrAJzPEEG63aB6rX1CXXLDtctPVsieBla35vea8xr3L19UhbszUz59RcqZcvx+LsNUOzkBv/wjPBwcYaBLyMPfy8kGHemUvziPb0y+XCfzMAXZ4rF4d1fdLmJn+XpGe9HSd1BMAqvDNssMClMoBAVUsJSR/uWynmUMl5ZVFq2MEyUHRCVxiujlvPkvqXq6FJWkMlPznaLDeLT871VVXSnPJ6KnscPdIuTs4FjU3l6MdLeD2Z+WNM7lKYL6ksIOajrfbQGvF+z8dGa3oO6hJA+XdBQWi9QFauiFkf/FSD0D6JcLnGu2SXFO6kNYcJCUZS0oDEw+UQ/GHCUGReogr2SBVt7tgYkCzSiKOpvrBJziVxe0BHQ5djf039SPR4XHRqhjYmkpLlZR+UXaXDuJiazlgN+gg768qdto7wjQxoNJmXQwc9RCq9Icoyf5zWyVdD8nNBHs+EQbX7uHeCdH5+Tl5WYnmeRkZqQEZLrUhTkR46Bv9ls64gW72Iy14opgGcdbeCLjQr0Z0ed+E+4oOZhDMU36/D0ErzobE44sCRbB0z8hAivprQyayQGAcVjIl5WYqDA8Q9VYz5DiPgl0pvQEpe1JLuhHxzGAOX6mkWue1wgLgLI0XXmOoDndR11gcuPTQPS4c7uOFH7RrQcpBgB6PNW7SQbi6fWE7aE/T+/KfDjfGj15luBG1gTC5Sb+5f1g9DbFUTHhccTKp/6RfISc1gxzlEWUptSTGFAXIl9sK2Hw/k3T35oCqZRd1r8GJYvBy0tNm55C0zkRdIIcvsCxK0AtD1wLndstGkODrZpdqx3LnkAVrXUYUmpQtgYTT9oA02VxkpzK0J6U+XGvW55wLFOkm9TWMqqy4vzjyyMLojyj8qNZZlUdE5NA6xtgDm14DeHbT+d2M5R1LXWXeowtZiAeMr1DyPTNft/V6n9S5rNb11JWlEYMeyFaFA6eKEkZ/5ZmGY+qMNL+9wwMVEMyDeW+ywH6t84oTRW0GY3cvNPjG7YYv7G1w4+4rjpOBDrDBthJ5mP1ge2lrtoQ9xLcfJNV69+pNOfnWy08PndB5BpPo98QC7taHLSiqOjpIE82nB8N7s1IFbud6NWKteKXn8VHr9AP+z00wE6Y/8vTk6Tgwz64LUD9q+oDq/sHb46UL+CZFqMUJX4cxaFEj+56biM4ko7ywAtdbT//2ZgnfxGLD1wpPd0+nuSBdVx1M8Jy3h3FzS/VrEGagxeYPu7wGh3X6wOdkp2dknOtWOpC1bykjuYUPw7OB8QgEBmviG5ii2hGMeIjQK9WG0X//6p0bjd+zHTGo2r33NB9UFtnBTj/vvHSzJsi6R6ydTGyeTdLPWSYEf89u3BYlDCW16MbeVvhKyzbjrv5yddaUT6M8xq0fElWbzUqrGyHq6qhpRbei5WZmvjGGUUm+xSGjgpPXhjEPXAeci7ytQlDQjYp0E3CisWaG+YeW8Qwojffo0o48Vp2DDULxWL7Wu8HhkZ+uR6maaRbxPHuCW7JK5VgMi6ybyoII4EszmIeJVGfFGBN4EmOyl5hqVXY6QUbRqnJWQZ//ravYA0w8xKGfzGTGVZRFNNIJ8+EqsXSJHXrJDOeYtYMX1s1Baz1VtnmIpivEhaey40/sY6DFORI16E1ot073sbDFORUS9CWx2jlvMf35ZjweIHibanayezP8zUjesFtsSP33rbJJdNWGD3IOY+2NCAbnCMHNCabq7oerZl5txktrLBYEy6Nt0o6BxoezenB9skG5veeEjpUSdd3//AvGPAG3YrcLp+GEfRGde4Z8ZHo6cXxjuttVKBHsWxK2hrXFiB3ZpvXKzMwbEJW++A97K2reusZn055311P17+vS3ydov+9WYvZ+36528crih0D/qmnm5SoXrLxAUK5TRDw53Oo3hY0TQA51C/3L/t0c00Zi/t5+tbPA693CS/D3k6045heHVxg/s6pMte6dbClLdMViV5Qt4zdaJQJg0Nh3RZPEs9H4X5Wfl9XlbJXAkxQ5jiWe73HM3c5/UnN3b9aRmdfnDrb5VbSWNGlOFxm338TjS3KQz6xY/tae6UJZOBffpbo/ksq9odc56zTWE4e1zjMZmrVLzwGfVmSxo1gn/7uhbVCuHEe/7MtWwTXONRS9rw8ZTc2J1CmjCFwSjx4yj+1M6njCyIo5UaQ0LzZJwbtayaBApjc1BYLSZzlRjyyEfv2NpUFfc5xYgGt9QMRKaEPSHOnt+zOUJoRLq4dnJbLFL33wc5ClwRL+nSNmer0V5aKSyOy+5kvgrbjE2hLFchNATwF2GhEmJJ2EbFNJxKqIxGQS6X1gb/HvZS+F21guXlMQf+fuNEn9VJB/r34a4s8H9/vW1T6QZ9thpwrb9mFoF/76WeSqBmYB4yix4E8KIGKNre1IQlCAlBGZsIEvkzXbCl7tEwcKb+fllTj/Rra+azcJh5Adtn6rJt8O+/3K0viX7E5VYA+bL/8mTb/mz8uMdXw1dxUaP09pdxdZd9WWd50/81KTT/xptuREG1geyh+UsIZCDVvjtfcfP+vv/fIRzn8f8dfzm1bjV/bzmL9uzM3/xi374+7/r5lB6rrvW+x774PQaQALAW7d6J2yql7T9DHcasW6FmnJS8YH8BVLydpIOJvcjVUXQYyx3vWkAzxMz3C0tjxuu32drmKVH0zuOeoLTNzA4gagE4MAEvgkxUmu/OBGREgIWysGphNalCNctm6IzoXs/ZshWMxNOtpI4dQdZKEuyIe87FI6cgO2WmZ+NzEuLLlh0dGaFtpUXVVgUnNWA/33iBp4QtdKIq2G/RIxEZTVKjVuiMceVTKqXrTpNW9/KWjEPmFOlEjFhuV0wopReZ4K61Ii6GIp6YpeOcdLJPLNtm6kcYhOUudr0aGJsXWAGrSVaTqpACL4C7ZlDKTNzqaja4EjYejJxfzk8SNlA5Wy8NWQF5G1xZkOV8Da54wIpMWu29WC8yuMKec6IOZiXm7GmCvOpVGaN0jcGyVw6jvPahxb0lQLWswB4R6jQTq2ycMM3KCdE8qRtO++tqUa84bzZQpZeUIzlDzISHyN86MkLetVkMvR2zbpUh4/hPeVbmJCoa+67OXB44I8EMvZGQFSQPR08ENAi1T2rTKn6bXXFuy1MlkgrtkYek/nl2RUKoVQ8ZqamSNA88VL2sTNQik02SIFoFDyWSJqHeHb8GnKFzUHpZY5c1LXqLkRVgAyHIqOQirCYp+usgWxW2gQ741HoHouqU4FFC0CrPyWElFyTdeX+URH1mduFSScV1mU1V+HagXE4rNhGoUOUwrqvWAapWIkV7sehqlZCVUmQtkdRWZMCq6Ktjh9nhGw9HlfZfOV3hE0Qm67UHLSWSQu0VKaH+qvRZ6Y6V1LEAv2U5VQA/qx/TfKccZKORM9f3glAKujls1toIz8u93VpgMx2B4JmRfp7j0FRjj5syW3O918GUvCKymtOwycQCAc/DFailhCI40JQBayfH+XpiAoHRN6wwYLoG+Ow1heHjSz1mLnvEoyyIHfegAycxCe+yzoFojjLqzsPBAALgcr7298qB5l0X/45HoZ4A4NmtA+s1u73/Mb1QgKMMAoDAvkSgDp4l2w4IyF5f+j++j6bwHLWKIX55tgxOQslMsq9wG+fG95cKviX2FYa1Am7XjYhuv3AbQkhlv3V9iNQXe4PF2NYvN6ttQQw8Rbz6eNW8zpFh+oZ4DN53Re3n6pc+Ntbut3rQRAHuzpNhfXS/6MqB8HHR3P5G3SuoDikXSicQsXgFyiEJg1sDpIMjD5KDhhNBm1DatYHX2HBI++D2MNVdW1ChTuGDU1iLwluZa3wkP/Cc4fU7T75pODZcdy6qPXWlgdRWQVrtMgkqyCFetqpRHG3gFrnwevFO7LaSalZHkhjVO++Rhb1br5IvIDQIIw30OpkZ2VdwMo5ZneNw6/5lM3tpP//yjBECdxubIXippM2R6EGMB4hvPtEbCZbOXSbce87He75+5Seo7RpSwI+eAOWBoDMDIwNb6Ci2Y7/afUAjYg3WeE+CcKnM5Ys+Hz+B0BlbhHPEFv/Abhhv8eRcDeVDkWfcwv1/uD6gu4EeH9QpoKrYVNUrynMjNwjRRQTOtfLLBPlQIuH6TZdXgzxPkXKulUJx7kLxM6DtgjQwFsa5p7wuGTOI0By3WAJBruKS7eOVhQIFmVzObzuepUMJkI2jS+MviS4WScdRiM6RR8IO/KZk/TilyV284wsawbwAAmgKNYisRfzrQ3FAWWngV8mbtWixmXe7QRB4sRsMnr93Q+Hl9G5oKHbvhkHESLH4dexqjRBbgvr4aaDWDaxPAOHuRch5o6yBPM3CVbOUm7Bb6mmZF8svQr/T8OcXN8WTHx2WxfVhoo3Saofm0dknYQwclhOX9i7rm0RLp6jAte2AAF9+gH9YWbbsQ699tr98Q30FwpxGjQAmKWo8XsEGvZ5EVDaF+y7DbpovDgj8p3goU1vBlOkoq3daeXIcVCJXpyL305QA3BPyzz8oZaUbXUVCi5po69AYG01/v+LhFCZVh4oF/PGM5gcFbV4viIwSNvfSoRuTShvLdlzPfxHRtcWEMi6k0sa6FxSdUxBGcZK+NrdpQat+4Kbt+uFZ1j0s6/YEbUz/9nndz/uBEIygGE6QFM2wHC+I0pOyd1U13eAnZv971/ODMIqTNMuLsqqb9oXFb83LZ3oXX1xcu/7wPxoGRyBRaAwWhycQSWQKlUZnMFlsDpfHFwhFYilpGVk5eQVFJWUVVTV1DU0tbR1dPX0DQyNjE1MzABEmNMNyvCBKsqJqumFatuN6fhBGcZJmeVFWddN2/TBO87KW2vqYa5+L7wfvkkOSFVXTDdOyHdfjBUAIRlAMJ0iKZliOxxcIRWKJVCZXKFVqjVanNxhNZovVZnc4XW6P1wcEgSFQGByBRKExWBw+6iOSyBQqjc5gstgcLo8vEIrieqRfIpXJFUqVWqPV6Q1Gk9nSytrG1s7ewdHJ2cXVzd3Ds2qXyMai/d5eqSd9ZgTfW/YkJZdqSChoOAgSieUedKuDJm1Kv3oplvwm+x+xRnY5XeVRcbp91UKuGfabkfOe7RDKvzmSWuDJmeTd756C9wY4tR4AAUigtpU3VuBdayAlExhR4sxBsACiYpaiCUIVKtW1VIM6daMr1RSMZIq9yXnnPXBNQqIDzHse1QicApAuo0pUeg41wMFCIwABMJQMMhBZg0IVrjc5IHAcyQOB4+gsCyKwozgiIqIPajUUdkRFz/NNilE3SxK4nGW3g21aoDZZ8RAwcPfYzWHuxGn5/ze8lRd76yAvJAJQQT711T2kwHiuLM3FQaoGVbyhKJnElIC0SYKUSRLGBXBDCwchbELRYB0IOQoQWZMCYSeBolI+2DW8ujQvNqFYUQkKOSuAh5RXIUB0zZy894o15Ii0jFPUeWcoNWnkPbEwgjUkCAThXQiATn1CTxFAVvRmFGETiKQHDmAAoFqAg0eA/r3ZGeXxWx61O//ycpTzAg6iCQEAEelKOm20e29fy/kfefyd/ycZxTpuCL9GZw6Z2wxr27MbGwt73tpZ+84Uw7OT6bR5zPQ//ZuHy3qxn/hqnlaVx1sWgENCfYQ+LblhYOERfhjOSm97ILK0UkG8SRA23ALX3cZ/xsPqo757YkackJsmh8BMK3twtturJxOefHzFT4PDqNh3PTtUQ4/4hd9c9mSq753lWTmJBQoECK2qiOrDSOvhiDguhZ7HVJQNdBHWl7m1052f7sDRfGAIDroLYqQnHV2EBUErD8OsiwOKGEI9va6C2nA2D9dbu2ulWmhF5IGFhFtKHbRkVaH5Qk3Zg3hOWZWDcUEhQERapzPk5dT149u86CGe4TyqUb1aTqIDbQVxweNTLkD4pK/LWpxnu08S6lw573kAAUXGGAUNC/e6v9dM1ZpzkMTu6uGq5GVv2G6PRi8KAAQDh4CEgoaBhSNviIFDQEJBw8DCdfzmTaqqF636rG059WYW2HprWsqd/eT/p8zY0ePyMTXLy//mTL6OR1lCnBb+qzL5Ph4px8Hh/6Um22f/nRkmjEZYool9X892waU92D7cmqTD0HMIiDomurbWywQuTQPpQb3y0WczqLWF1yaA8nojvG95VdEpjemUAqNFU6fYQOHarwAgIhLRsgbPtyCje6PiG6E6ntIxnVIkSOpcaQjIX7q13KxLu2rm2dp8PPtR2/wv69z7Nvo/31NrJQA=) format('woff2')}@font-face{font-family:'PdfCairo';font-weight:400;unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;src:url(data:font/woff2;base64,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) format('woff2')}@font-face{font-family:'PdfCairo';font-weight:700;unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD;src:url(data:font/woff2;base64,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) format('woff2')}";

/* =====================================================================
   v2.5 E-signatures — ported from the ICTD Policy Platform v3.3.
   This platform's OWN encrypted signature register (sheet «Signers» in the SOP register),
   independent of the policy and MoU platforms.
   AES-256-GCM in the browser; the PIN and the clear picture never leave the device.
   ===================================================================== */
const GAS = !!(window.google && google.script && google.script.run);
const sapi = req => server('apiSign', req);
const ME = String((window.DATA && DATA.user) || '').toLowerCase();
const BASE_URL = (window.DATA && DATA.baseUrl) || '';
const ITER = 310000, te = new TextEncoder(), td = new TextDecoder();
function toB64(buf){ const u=new Uint8Array(buf); let s=''; for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s); }
function fromB64(s){ const b=atob(s), u=new Uint8Array(b.length); for(let i=0;i<b.length;i++) u[i]=b.charCodeAt(i); return u; }
const rand = n => crypto.getRandomValues(new Uint8Array(n));
async function pinBase(pin){ return crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveKey','deriveBits']); }
async function encKey(pin, salt, iter){ return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:iter, hash:'SHA-256'}, await pinBase(pin), {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']); }
/** Auth tag: derived from the PIN with a different salt — proves the PIN to the server but cannot decrypt. */
async function authTag(pin, saltB64, iter){ return toB64(await crypto.subtle.deriveBits({name:'PBKDF2', salt:fromB64(saltB64), iterations:iter, hash:'SHA-256'}, await pinBase(pin), 256)); }
async function sealSignature(dataUrl, pin){
  const salt=rand(16), iv=rand(12), aSalt=toB64(rand(16));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, await encKey(pin, salt, ITER), te.encode(dataUrl));
  return { enc:{ salt:toB64(salt), iv:toB64(iv), ct:toB64(ct), iter:ITER }, auth:{ salt:aSalt, tag:await authTag(pin, aSalt, ITER) } };
}
async function openSignature(enc, pin){
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:fromB64(enc.iv)}, await encKey(pin, fromB64(enc.salt), enc.iter), fromB64(enc.ct));
  return td.decode(pt);
}
const pinOk = p => p.length>=8 && /\d/.test(p) && /[A-Za-z؀-ۿ]/.test(p);
const fmtDT = d => { const x=new Date(d); return isNaN(x)?'':x.toLocaleString('ar-SA-u-ca-gregory-nu-latn',{dateStyle:'medium',timeStyle:'short'}); };

const SIG = { all:[], mine:[], admin:!!(window.DATA&&DATA.admin), ready:false, final:null, row:-1, busy:false,
              mode:null, defMode:(window.DATA&&DATA.displayDefault)||'image' };

/* ---------- signature display (v2.6 — admin setting, as in the policy platform) ---------- */
const MODE_TXT={stamp:'نص التوقيع فقط',image:'صورة التوقيع',blur:'صورة مموّهة (واضحة في النسخة النهائية)'};
const MODE_EN={stamp:'Signature text',image:'Signature image',blur:'Blurred image'};
function effMode(){ return MODE_TXT[SIG.mode]?SIG.mode:(MODE_TXT[SIG.defMode]?SIG.defMode:'image'); }
let PDF_CLEAR=null;   // clear pictures used only while rendering the final PDF in 'blur' mode
/** Irreversible blur: shrink to a few pixels, then scale back up (made in the signer's browser). */
function makeBlur(url){
  return new Promise(res=>{ if(!url) return res(''); const im=new Image(); im.onload=()=>{
    const w=Math.min(420,im.width), h=Math.max(1,Math.round(im.height*w/im.width));
    const sm=document.createElement('canvas'); sm.width=Math.max(4,Math.round(w/14)); sm.height=Math.max(2,Math.round(h/14));
    const sx=sm.getContext('2d'); sx.imageSmoothingEnabled=true; sx.drawImage(im,0,0,sm.width,sm.height);
    const c=document.createElement('canvas'); c.width=w; c.height=h; const x=c.getContext('2d'); x.imageSmoothingEnabled=true; x.imageSmoothingQuality='high'; x.filter='blur(3px)'; x.drawImage(sm,0,0,w,h);
    res(c.toDataURL('image/png')); }; im.onerror=()=>res(''); im.src=url; });
}
function modeCtl(){
  if(!GAS) return '';
  const cur=effMode();
  if(!SIG.admin || SIG.final || !isSaved()) return `<span class="modetag" title="يحددها مسؤول المنصة"><i data-lucide="eye"></i> عرض التوقيع: <b>${esc(MODE_TXT[cur])}</b></span>`;
  return `<label class="modetag" title="للمسؤول — يمكن تغييرها حتى صدور النسخة النهائية"><i data-lucide="eye"></i> عرض التوقيع:
    <select id="modeSel" onchange="setSopDisplay(this.value)">${['stamp','image','blur'].map(m=>`<option value="${m}" ${m===cur?'selected':''}>${MODE_TXT[m]}</option>`).join('')}</select></label>`;
}
/** Admin: display mode of this SOP version (before the final PDF). */
async function setSopDisplay(mode){
  if(!GAS||!SIG.admin) return;
  if(!isSaved()){ toast('احفظ الإجراء في السجل أولًا'); applySignLock(); return; }
  try{
    const blurs={};
    if(mode==='blur'){ for(const [i,a] of signersList().entries()){ if(a.sig&&a.sig.img&&!a.sig.imgBlur){ const b=await makeBlur(a.sig.img); if(b) blurs[i]=b; } } }
    const r=await sapi({action:'setDisplay', code:loaded.sop_no, mode, blurs, baseRev:loaded.rev});
    if(!r.ok) throw new Error(r.error);
    applyServer(r); toast('طريقة عرض التوقيع: '+MODE_TXT[r.mode]);
  }catch(e){ toast(e.message,6000); applySignLock(); }
}
async function saveDefaultDisplay(){
  try{ const m=$('#msDefMode').value; const r=await sapi({action:'setDefaultDisplay', mode:m}); if(!r.ok) throw new Error(r.error);
    SIG.defMode=r.mode; toast('الإعداد الافتراضي لعرض التوقيع: '+MODE_TXT[r.mode]); applySignLock(); renderPreview(); }catch(e){ toast(e.message); }
}
const nonEmpty = r => r && (String(r.role||'').trim() || String(r.name||'').trim() || String(r.email||'').trim() || r.sig);
function signersList(){ return (data.signers||[]).filter(nonEmpty); }
function signState(){ const a=signersList(); const n=a.filter(x=>x.sig).length; return {n, total:a.length, all:a.length>0&&n===a.length}; }
function stripSigs(o){ (o&&o.signers||[]).forEach(a=>{ if(a) delete a.sig; }); return o; }
function isSaved(){ return !!(loaded && loaded.rev && !dirty); }

/* ---------- approval boxes (preview, print, PDF) ---------- */
function approvalHtml(o){
  const list=(o.signers||[]).filter(nonEmpty);
  if(!list.length) return '<div class="txt">— لم يُحدَّد الموقّعون بعد —</div>';
  return '<div class="sign">'+list.map((a,i)=>{
    const s=a.sig;
    if(s){
      const mode=effMode(), clear=PDF_CLEAR&&PDF_CLEAR[i];
      const pic = mode==='stamp' ? `<div class="sigtxt" title="نص التوقيع">${esc(s.signerName)}</div>` :
        clear ? `<div class="sigimg"><img src="${esc(clear)}" alt="توقيع ${esc(s.signerName)}"></div>` :
        mode==='image'&&s.img ? `<div class="sigimg"><img src="${esc(s.img)}" alt="توقيع ${esc(s.signerName)}" draggable="false"></div>` :
        mode==='blur'&&s.imgBlur ? `<div class="sigimg blurred" title="صورة مموّهة — تظهر واضحة في النسخة النهائية الموقّعة"><img src="${esc(s.imgBlur)}" alt="توقيع مموّه" draggable="false"></div>` : '';
      const need = mode!=='stamp' && !pic;
      const mine = GAS && ME===String(s.by||'').toLowerCase() && !SIG.final;
      return `<div class="signed"><b>${esc(a.role)}</b>${esc(a.name)}
      ${pic}
      <div class="stamp"><span class="ok">✔ موقّع إلكترونيًا</span><span class="nm">${esc(s.signerName)}</span>${s.position?`<span class="ps">${esc(s.position)}</span>`:''}<span class="dt">${esc(fmtDT(s.at))}</span><span class="hx" dir="ltr">SHA-256 · ${esc(String(s.docHash||'').slice(0,16))}</span></div>
      ${mine ? `${need?`<button class="btn sm primary no-print" onclick="showSigImg(${i})"><i data-lucide="image"></i>إظهار صورة توقيعي</button>`:''}<button class="btn sm no-print" onclick="unsignRow(${i})"><i data-lucide="undo-2"></i>إزالة توقيعي</button>`:''}</div>`;
    }
    const email=String(a.email||'').trim().toLowerCase();
    const act = !GAS || SIG.final ? '' :
      email && email===ME ? `<button class="btn sm primary no-print" onclick="signRow(${i})"><i data-lucide="pen-line"></i>توقيع</button>` :
      email ? `<span class="await no-print">بانتظار توقيع <span dir="ltr">${esc(email)}</span></span>` :
      `<span class="await no-print">لم يُحدَّد بريد الموقّع</span>`;
    return `<div><b>${esc(a.role)}</b>${esc(a.name)}<div class="line">التوقيع / التاريخ</div>${act}</div>`;
  }).join('')+'</div>';
}

/* ---------- lock + status bar ---------- */
function lockInputs(on){
  document.querySelectorAll('.editor input,.editor textarea,.editor select,.editor button').forEach(el=>{
    if(el.closest('.recbar')) return;
    if(on){ if(!el.disabled){ el.disabled=true; el.dataset.sigLock='1'; } }
    else if(el.dataset.sigLock){ el.disabled=false; delete el.dataset.sigLock; }
  });
  const sv=document.querySelector('.toolbar [onclick="saveToSheet()"]'); if(sv) sv.disabled=on;
}
function applySignLock(){
  const st=signState(), locked=st.n>0 || !!SIG.final;
  document.body.classList.toggle('sig-locked', locked);
  lockInputs(locked);
  const bar=$('#sigbar'); if(!bar) return;
  if(!GAS || (!locked && !st.total)){ bar.hidden=true; return; }
  let h='';
  if(SIG.final) h=`<span><i data-lucide="lock"></i> <b>نسخة نهائية موقّعة</b> — صدرت ${esc(fmtDT(SIG.final.at))}. لا يمكن تعديل هذا الإصدار أو إزالة توقيعاته.</span>
      ${SIG.final.verifyId?`<span>رمز التحقق: <b dir="ltr" class="mono">${esc(SIG.final.verifyId)}</b></span>`:''}
      <span class="tb"><button class="btn sm primary" onclick="downloadFinal()"><i data-lucide="file-down"></i>تنزيل PDF الموقّع</button>
      ${SIG.final.verifyId?`<button class="btn sm" onclick="openVerify('${esc(SIG.final.verifyId)}')"><i data-lucide="shield-check"></i>صفحة التحقق</button>`:''}
      <button class="btn sm" onclick="newVersion()"><i data-lucide="git-branch-plus"></i>إصدار جديد للتعديل</button></span>`;
  else if(st.all) h=`<span><i data-lucide="badge-check"></i> <b>اكتملت التوقيعات (${st.n}/${st.total})</b> — لم تصدر النسخة النهائية بعد.</span>
      <span class="tb"><button class="btn sm primary" onclick="finalizeFlow(false)" ${SIG.busy?'disabled':''}><i data-lucide="file-check-2"></i>${SIG.busy?'جارٍ الإصدار…':'إصدار النسخة النهائية'}</button></span>`;
  else if(st.n) h=`<span><i data-lucide="lock"></i> <b>مقفل للتعديل</b> — يحتوي على ${st.n} من ${st.total} توقيعات. للتعديل: يزيل كل موقّع توقيعه برقمه السري، أو أنشئ إصدارًا جديدًا.</span>
      <span class="tb"><button class="btn sm" onclick="newVersion()"><i data-lucide="git-branch-plus"></i>إصدار جديد للتعديل</button></span>`;
  else h=`<span><i data-lucide="pen-line"></i> التوقيع الإلكتروني: 0 من ${st.total}. ${isSaved()?'':'احفظ الإجراء في السجل أولًا. '}حدّد بريد كل موقّع في قسم «ضبط الوثيقة والاعتماد».</span>`;
  h+=modeCtl();
  bar.innerHTML=h; bar.hidden=false; bar.className='sigbar no-print'+(SIG.final?' final':st.all?' all':'');
  icons();
}

/* ---------- my signatures ---------- */
async function loadMySigs(){
  if(!GAS) return;
  try{ const r=await sapi({action:'sigs'}); SIG.mine=r.items||[]; SIG.all=r.all||[]; SIG.admin=!!r.admin; SIG.ready=!!r.ready; if(r.displayDefault) SIG.defMode=r.displayDefault; }catch(e){ toast(e.message); }
  renderMySigs();
}
function renderMySigs(){
  const tb=$('#msBody'); if(!tb) return;
  $('#msOwnerWrap').hidden=!SIG.admin;
  tb.innerHTML = !SIG.mine.length ? '<tr><td colspan="5" class="hint">لا يوجد توقيع مسجّل باسم حسابك بعد — أضفه من النموذج أدناه.</td></tr>' :
    SIG.mine.map(s=>`<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.position||'')}</td>
      <td>${s.locked?'<span class="chip lk">مقفل مؤقتًا</span>':'<span class="chip">مشفّر 🔒</span>'}</td><td class="hint">${esc(fmtDT(s.createdAt))}</td>
      <td style="white-space:nowrap"><button class="btn sm" onclick="previewSig('${s.id}')" title="معاينة"><i data-lucide="eye"></i></button>
      <button class="btn sm" onclick="changeSigPin('${s.id}')" title="تغيير الرقم السري"><i data-lucide="key-round"></i></button>
      <button class="btn sm danger" onclick="deleteSig('${s.id}')" title="حذف"><i data-lucide="trash-2"></i></button></td></tr>`).join('');
  $('#msAllWrap').hidden=!SIG.admin; $('#msDefWrap').hidden=!SIG.admin; $('#msDefMode').value=SIG.defMode;
  if(SIG.admin) $('#msAll').innerHTML = !(SIG.all||[]).length ? '<tr><td colspan="6" class="hint">لا توجد توقيعات مسجّلة.</td></tr>' :
    SIG.all.map(s=>`<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.position||'')}</td><td dir="ltr">${esc(s.ownerEmail)}</td>
      <td>${s.locked?'<span class="chip lk">مقفل مؤقتًا</span>':'<span class="chip">مشفّر 🔒</span>'}</td><td class="hint">${esc(fmtDT(s.createdAt))}</td>
      <td><button class="btn sm danger" onclick="deleteSig('${s.id}',true)" title="حذف"><i data-lucide="trash-2"></i></button></td></tr>`).join('');
  icons();
}
function openSigs(){ if(!GAS){ toast('التوقيع متاح من داخل المنصة فقط'); return; } dlgSigs.showModal(); loadMySigs(); setTimeout(sizePad,60); }
async function unlockMine(id, pin, purpose){
  const s=SIG.mine.find(x=>x.id===id); if(!s) throw new Error('التوقيع غير موجود');
  const r=await sapi({action:'sigUnlock', id, tag:await authTag(pin,s.authSalt,s.iter), purpose});
  if(!r.ok) throw new Error(r.msg||r.error);
  return openSignature(r.enc, pin);
}

/* image source: upload or draw */
let upURL=null, pctx=null, drawing=false, padDirty=false;
function srcMode(){ const d=document.querySelector('input[name=msSrc]:checked').value==='draw'; $('#msUp').hidden=d; $('#msDraw').hidden=!d; if(d) sizePad(); }
function sizePad(){ const pad=$('#pad'); if(!pad) return; const r=pad.getBoundingClientRect(); if(!r.width) return; pad.width=r.width*2; pad.height=r.height*2; pctx=pad.getContext('2d'); pctx.scale(2,2); pctx.lineWidth=2.4; pctx.lineCap='round'; pctx.lineJoin='round'; pctx.strokeStyle='#14125a'; padDirty=false; }
function padURL(){
  const pad=$('#pad'), d=pctx.getImageData(0,0,pad.width,pad.height).data; let x0=pad.width,y0=pad.height,x1=0,y1=0;
  for(let y=0;y<pad.height;y++) for(let x=0;x<pad.width;x++) if(d[(y*pad.width+x)*4+3]>0){ if(x<x0)x0=x; if(y<y0)y0=y; if(x>x1)x1=x; if(y>y1)y1=y; }
  const m=10; x0=Math.max(0,x0-m); y0=Math.max(0,y0-m); x1=Math.min(pad.width,x1+m); y1=Math.min(pad.height,y1+m);
  const c=document.createElement('canvas'), sc=Math.min(1,500/(x1-x0),200/(y1-y0));
  c.width=Math.round((x1-x0)*sc); c.height=Math.round((y1-y0)*sc);
  c.getContext('2d').drawImage(pad,x0,y0,x1-x0,y1-y0,0,0,c.width,c.height); return c.toDataURL('image/png');
}
function wirePad(){
  const pad=$('#pad'); if(!pad||pad._w) return; pad._w=1;
  const pt=e=>{ const r=pad.getBoundingClientRect(); return [e.clientX-r.left,e.clientY-r.top]; };
  pad.addEventListener('pointerdown',e=>{ if(!pctx) sizePad(); drawing=true; pad.setPointerCapture(e.pointerId); const [x,y]=pt(e); pctx.beginPath(); pctx.moveTo(x,y); });
  pad.addEventListener('pointermove',e=>{ if(!drawing) return; const [x,y]=pt(e); pctx.lineTo(x,y); pctx.stroke(); padDirty=true; });
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>pad.addEventListener(ev,()=>drawing=false));
  $('#msFile').addEventListener('change', e=>{
    const f=e.target.files[0]; if(!f) return;
    if(f.size>5*1024*1024){ toast('حجم الصورة كبير (الحد 5MB)'); e.target.value=''; return; }
    const img=new Image(); img.onload=()=>{
      const sc=Math.min(1,500/img.width,200/img.height), c=document.createElement('canvas');
      c.width=Math.round(img.width*sc); c.height=Math.round(img.height*sc);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      upURL=c.toDataURL('image/png'); $('#msPrev').src=upURL; $('#msPrev').style.display='block'; URL.revokeObjectURL(img.src);
    }; img.src=URL.createObjectURL(f);
  });
}
async function addSig(){
  const name=$('#msName').value.trim(), pin=$('#msPin').value, pin2=$('#msPin2').value;
  const draw=document.querySelector('input[name=msSrc]:checked').value==='draw';
  if(!name) return toast('أدخل الاسم');
  const url = draw ? (padDirty?padURL():null) : upURL;
  if(!url) return toast('أضف صورة التوقيع أو ارسمه');
  if(!pinOk(pin)) return toast('الرقم السري: 8 خانات على الأقل تشمل حروفًا وأرقامًا');
  if(pin!==pin2) return toast('الرقمان السريان غير متطابقين');
  $('#msAdd').disabled=true; toast('جارٍ التشفير والحفظ…');
  try{
    const sealed=await sealSignature(url, pin);
    const r=await sapi(Object.assign({action:'sigAdd', name, position:$('#msPos').value.trim(), org:$('#msOrg').value.trim(), ownerEmail:$('#msOwner').value.trim()}, sealed));
    if(!r.ok) throw new Error(r.error||r.msg);
    ['#msPos','#msPin','#msPin2','#msFile','#msOwner'].forEach(s=>$(s).value=''); upURL=null; $('#msPrev').style.display='none'; if(pctx) sizePad();
    await loadMySigs(); toast('تم تشفير التوقيع وحفظه ✔');
  }catch(e){ toast(e.message); }
  $('#msAdd').disabled=false;
}
let prevTimer;
async function previewSig(id){
  const s=SIG.mine.find(x=>x.id===id);
  const url=await askPin({title:'معاينة التوقيع', sub:s.name, verify:pin=>unlockMine(id,pin,'preview')}); if(!url) return;
  $('#pvTitle').textContent='توقيع: '+s.name; $('#pvImg').src=url; dlgPrev.showModal();
  clearTimeout(prevTimer); prevTimer=setTimeout(closePrev,15000);
}
function closePrev(){ if(dlgPrev.open) dlgPrev.close(); $('#pvImg').removeAttribute('src'); }
async function changeSigPin(id){
  const s=SIG.mine.find(x=>x.id===id);
  const ok=await askPin({title:'تغيير الرقم السري', sub:s.name, change:true, verify:async(pin,np,np2)=>{
    if(!pinOk(np)) throw new Error('الرقم الجديد: 8 خانات على الأقل تشمل حروفًا وأرقامًا');
    if(np!==np2) throw new Error('الرقمان الجديدان غير متطابقين');
    const url=await unlockMine(id, pin, 'pin-change');
    const r=await sapi(Object.assign({action:'sigPin', id, tag:await authTag(pin,s.authSalt,s.iter)}, await sealSignature(url, np)));
    if(!r.ok) throw new Error(r.msg||r.error); return true;
  }});
  if(ok){ await loadMySigs(); toast('تم تغيير الرقم السري'); }
}
async function deleteSig(id,any){
  const s=(any?SIG.all:SIG.mine).find(x=>x.id===id); if(!s) return;
  if(!confirm('حذف توقيع "'+s.name+'" نهائيًا من سجل التوقيعات؟ لا يؤثر ذلك على الإجراءات الموقّعة سابقًا.')) return;
  try{ const r=await sapi({action:'sigDelete', id}); if(!r.ok) throw new Error(r.error); await loadMySigs(); toast('تم حذف التوقيع'); }catch(e){ toast(e.message); }
}

/* ---------- PIN dialog ---------- */
function askPin({title, sub, change=false, verify}){
  return new Promise(resolve=>{
    const i1=$('#pinIn'), i2=$('#pinIn2'), i3=$('#pinIn3'), err=$('#pinErr'), ok=$('#pinOk');
    $('#pinTitle').textContent=title; $('#pinSub').textContent=sub||''; err.textContent='';
    i1.placeholder=change?'الرقم السري الحالي':'الرقم السري';
    [i1,i2,i3].forEach(i=>i.value=''); i2.hidden=i3.hidden=!change;
    dlgPin.showModal(); setTimeout(()=>i1.focus(),50);
    const done=v=>{ if(dlgPin.open) dlgPin.close(); [i1,i2,i3].forEach(i=>i.value=''); ok.onclick=$('#pinCancel').onclick=dlgPin.oncancel=null; i1.onkeydown=null; resolve(v); };
    const go=async()=>{ if(!i1.value||ok.disabled) return; ok.disabled=true; err.textContent='جارٍ التحقق…';
      try{ done(await verify(i1.value,i2.value,i3.value)); }catch(e){ err.textContent=e.message||'رقم سري غير صحيح'; i1.select(); }
      ok.disabled=false; };
    i1.onkeydown=e=>{ if(e.key==='Enter') go(); };
    ok.onclick=go; $('#pinCancel').onclick=()=>done(null); dlgPin.oncancel=e=>{ e.preventDefault(); done(null); };
  });
}

/* ---------- sign / unsign ---------- */
function applyServer(r){
  const d=r.data; SIG.mode=d.sig_mode||null;
  fill(d); dirty=false;
  loaded={sop_no:d.sop_no, version:d.version, status:d.status, rev:r.rev||null};
  updateMode(); applySignLock(); renderPreview(); icons();
  $('#status').textContent='محفوظ في السجل ✓ '+d.sop_no+' · التوقيعات '+signState().n+'/'+signState().total;
  loadRecords(d.sop_no);
}
async function signRow(i){
  if(!GAS) return;
  if(!isSaved()){ toast('احفظ الإجراء في السجل أولًا، ثم وقّع'); return; }
  await loadMySigs();
  if(!SIG.mine.length){ openSigs(); toast('أضف توقيعك المشفّر أولًا، ثم عُد إلى خانة التوقيع'); return; }
  const a=signersList()[i]; SIG.row=i;
  $('#sgInfo').innerHTML=`<b dir="ltr">${esc(loaded.sop_no)}</b> — ${esc($('[data-f=title_ar]').value)} · الإصدار ${esc(loaded.version)}<br>خانة الاعتماد: <b>${esc(a.role)}</b> — ${esc(a.name)}`;
  $('#sgSel').innerHTML=SIG.mine.map(s=>`<option value="${s.id}" ${s.locked?'disabled':''}>${esc(s.name)}${s.position?' — '+esc(s.position):''}${s.locked?' (مقفل مؤقتًا)':''}</option>`).join('');
  $('#sgPin').value=''; $('#sgAgree').checked=false; $('#sgMsg').textContent=''; $('#sgGo').disabled=false;
  dlgSign.showModal(); icons(); setTimeout(()=>$('#sgPin').focus(),50);
}
async function signGo(){
  const i=SIG.row, id=$('#sgSel').value, pin=$('#sgPin').value, m=$('#sgMsg');
  if(!$('#sgAgree').checked){ m.textContent='أكّد الإقرار أولًا'; return; }
  if(!pin){ m.textContent='أدخل الرقم السري'; return; }
  const s=SIG.mine.find(x=>x.id===id); if(!s){ m.textContent='اختر التوقيع'; return; }
  $('#sgGo').disabled=true; m.textContent='جارٍ التحقق وفك تشفير صورة التوقيع…';
  try{
    const img=await sigImageFor(id, pin);        // wrong PIN stops here (counted by the server)
    m.textContent='جارٍ التوقيع…';
    const blur=await makeBlur(img);
    const r=await sapi({action:'sign', code:loaded.sop_no, row:i, signerId:id, img, blur, tag:await authTag(pin,s.authSalt,s.iter), baseRev:loaded.rev});
    if(!r.ok){ m.textContent=r.msg||r.error||'تعذّر التوقيع'; if(r.locked) loadMySigs(); return; }
    dlgSign.close(); applyServer(r); toast('تم التوقيع ✔ — '+(r.allSigned?'اكتملت جميع التوقيعات':'سُجّل توقيعك'));
    if(r.allSigned) finalizeFlow(true);
  }catch(e){ m.textContent=e.message; }
  finally{ $('#sgPin').value=''; $('#sgGo').disabled=false; }
}
/** Decrypts the signer's own image in this browser (PIN-verified) and shrinks it to fit the record. */
async function sigImageFor(id, pin){ return shrinkSig(await unlockMine(id, pin, 'sign')); }
function shrinkSig(url){
  return new Promise(res=>{ const im=new Image(); im.onload=()=>{
    const sc=Math.min(1,420/im.width,160/im.height), c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(im.width*sc)); c.height=Math.max(1,Math.round(im.height*sc));
    c.getContext('2d').drawImage(im,0,0,c.width,c.height);
    let out=c.toDataURL('image/png');
    if(out.length>110000){ const w=document.createElement('canvas'); w.width=c.width; w.height=c.height; const x=w.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,w.width,w.height); x.drawImage(c,0,0); out=w.toDataURL('image/jpeg',0.8); }
    res(out); }; im.onerror=()=>res(''); im.src=url; });
}
async function showSigImg(i){
  const a=signersList()[i]; if(!a||!a.sig) return;
  if(!isSaved()){ toast('أعد فتح الإجراء من السجل أولًا'); return; }
  await loadMySigs();
  const s=SIG.mine.find(x=>x.id===a.sig.signerId);
  if(!s){ toast('التوقيع المستخدم لم يعد موجودًا في سجلك'); return; }
  const r=await askPin({title:'إظهار صورة توقيعك في الإجراء', sub:a.role+' — '+s.name+' · تظهر حسب طريقة العرض: '+MODE_TXT[effMode()], verify:async pin=>{
    const img=await sigImageFor(s.id, pin), blur=await makeBlur(img);
    const x=await sapi({action:'sigShow', code:loaded.sop_no, row:i, img, blur, tag:await authTag(pin,s.authSalt,s.iter), baseRev:loaded.rev});
    if(!x.ok) throw new Error(x.msg||x.error); return x; }});
  if(r){ applyServer(r); toast('أُضيفت صورة توقيعك إلى خانة «'+a.role+'» ✔'); }
}
async function unsignRow(i){
  const a=signersList()[i]; if(!a||!a.sig) return;
  await loadMySigs();
  const s=SIG.mine.find(x=>x.id===a.sig.signerId);
  if(!s){ toast('التوقيع المستخدم لم يعد موجودًا في سجلك'); return; }
  const r=await askPin({title:'إزالة توقيعك', sub:a.role+' — '+s.name, verify:async pin=>{
    const x=await sapi({action:'unsign', code:loaded.sop_no, row:i, tag:await authTag(pin,s.authSalt,s.iter), baseRev:loaded.rev});
    if(!x.ok) throw new Error(x.msg||x.error); return x; }});
  if(r){ applyServer(r); toast('أُزيل توقيعك من خانة «'+a.role+'»'); }
}

/* ---------- new version after signing ---------- */
function newVersion(){
  const cur=$('[data-f=version]').value, nv=nextVersion(cur);
  if(!confirm('إنشاء الإصدار '+nv+' من هذا الإجراء للتعديل؟\nيبقى الإصدار '+cur+' بتوقيعاته محفوظًا في سجل الإصدارات'+(SIG.final?' ونسخته النهائية في الأرشيف.':'.'))) return;
  stripSigs(data); SIG.final=null;
  document.body.classList.remove('sig-locked'); lockInputs(false);
  renderTable('signers');
  bumpVersion();
  applySignLock(); saveToSheet();
}

/* ---------- final signed PDF (A4, rendered in the browser, archived + e-mailed by the server) ---------- */
const CDN='https://cdnjs.cloudflare.com/ajax/libs';
let libsP=null;
function loadScript(src){ return new Promise((res,rej)=>{ const sc=document.createElement('script'); sc.src=src; sc.onload=res; sc.onerror=()=>rej(new Error('تعذّر تحميل مكتبة PDF — تحقق من الاتصال')); document.head.appendChild(sc); }); }
function loadPdfLibs(){ return libsP || (libsP=((window.jspdf&&window.jspdf.jsPDF)?Promise.resolve():loadScript(CDN+'/jspdf/2.5.1/jspdf.umd.min.js')).then(()=>({JsPDF:window.jspdf.jsPDF})).catch(e=>{ libsP=null; throw e; })); }
async function pdfFonts(){
  if(!document.getElementById('pdfFontFaces')){ const st=document.createElement('style'); st.id='pdfFontFaces'; st.textContent=PDF_CAIRO_CSS; document.head.appendChild(st); }
  try{ await Promise.all([document.fonts.load("16px PdfCairo"), document.fonts.load("700 16px PdfCairo")]); }catch(e){}
}
/** All same-origin style rules except @media blocks (they would re-evaluate against the 794-px page image). */
function pdfCss(){
  const out=[];
  for(const sh of document.styleSheets){ let rs=[]; try{ rs=[...sh.cssRules]; }catch(e){ continue; }
    rs.forEach(r=>{ if(r.type===1) out.push(r.cssText); }); }
  return out.join('\n');
}
async function renderPageCanvas(page, css){
  const NS_SVG='http://www.w3.org/2000/svg', NS_XHTML='http://www.w3.org/1999/xhtml';
  const xml=new XMLSerializer().serializeToString(page);
  const svg='<svg xmlns="'+NS_SVG+'" width="794" height="1123"><foreignObject x="0" y="0" width="794" height="1123">'
    +'<div xmlns="'+NS_XHTML+'" style="width:794px;height:1123px;margin:0;padding:0"><style>'+css+'</style>'+xml+'</div></foreignObject></svg>';
  const img=new Image(); img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg); await img.decode();
  await new Promise(r=>setTimeout(r,60));
  const c=document.createElement('canvas'); c.width=1588; c.height=2246;
  const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,c.width,c.height); x.drawImage(img,0,0,c.width,c.height);
  return c;
}
/** Packs the document blocks into A4 pages with the logo header on each; long tables are split by rows (header repeated),
    and a section heading never stays alone at the bottom of a page. */
function paginateDoc(host, nodes, head){
  const pages=[]; let cur, limit=1001;
  const newPage=()=>{ const pg=document.createElement('div'); pg.className='fpage pd';
    if(head){ pg.appendChild(head.cloneNode(true)); }
    const b=document.createElement('div'); b.className='fbody'; pg.appendChild(b); host.appendChild(pg); pages.push(pg); cur=b;
    limit=1001-(head?pg.firstChild.offsetHeight+10:0); };
  const full=()=>cur.offsetHeight>limit;
  const isHead=e=>e && e.classList && e.classList.contains('sec');
  const breakKeepHeads=()=>{ const heads=[]; while(cur.children.length>1 && isHead(cur.lastElementChild)) heads.unshift(cur.removeChild(cur.lastElementChild)); newPage(); heads.forEach(h=>cur.appendChild(h)); };
  const splittable=n=>n.tagName==='TABLE'&&((n.tBodies[0]&&n.tBodies[0].rows.length>1)||(!n.tHead&&n.rows.length>1));
  const split=n=>{
    // a first row made only of <th> is the table header: it repeats on the next page and never stays behind alone
    if(!n.tHead && n.tBodies[0] && n.tBodies[0].rows.length>1){ const f=n.tBodies[0].rows[0]; if(f.querySelector('th') && !f.querySelector('td')){ const th=n.createTHead(); th.appendChild(f); } }
    const body=n.tBodies[0], items=[...body.rows], hasHead=!!n.tHead;
    const shell=()=>{ const c=n.cloneNode(false); if(hasHead) c.appendChild(n.tHead.cloneNode(true)); c.appendChild(document.createElement('tbody')); return c; };
    let part=shell(); const box=()=>part.tBodies[0];
    cur.appendChild(part);
    items.forEach(it=>{
      box().appendChild(it);
      if(!full()) return;
      box().removeChild(it);
      if(!box().children.length){ cur.removeChild(part); breakKeepHeads(); }
      else { newPage(); part=shell(); }
      cur.appendChild(part); box().appendChild(it);
    });
  };
  newPage();
  nodes.forEach(n=>{
    cur.appendChild(n);
    if(full()){
      cur.removeChild(n);
      if(splittable(n)) split(n);
      else { if(cur.children.length) breakKeepHeads(); cur.appendChild(n); }
    }
  });
  return pages.filter(p=>p.querySelector('.fbody').children.length);
}
function qrSvg(text){
  const q=qrcode(0,'M'); q.addData(text); q.make();
  return q.createSvgTag(4,0).replace(/width="\d+px" height="\d+px"/,'width="132" height="132"');
}
function loadQrLib(){ return (window.qrcode)?Promise.resolve():loadScript(CDN+'/qrcode-generator/1.4.4/qrcode.min.js'); }
function certificateHtml(o, vt){
  const list=signersList();
  const rows=list.map((a,i)=>{ const s=a.sig||{}; return `<tr><td>${i+1}</td><td><b>${esc(a.role)}</b><br>${esc(a.name)}</td><td><b>${esc(s.signerName)}</b>${s.position?'<br>'+esc(s.position):''}</td><td dir="ltr">${esc(s.by)}</td><td>${esc(fmtDT(s.at))}</td><td dir="ltr" class="mono">${esc(String(s.signerId||'').slice(0,8))}</td></tr>`; }).join('');
  const hashes=[...new Set(list.map(a=>a.sig&&a.sig.docHash).filter(Boolean))];
  return `<div class="sec">شهادة التوقيع الإلكتروني <span class="en">Electronic Signature Certificate</span></div>
   <table class="kv"><tbody><tr><th>الإجراء</th><td>${esc(o.title_ar)} — <span dir="ltr">${esc(o.sop_no)}</span> · الإصدار ${esc(o.version)}</td></tr>
   <tr><th>الحالة</th><td>${esc(o.status)} · ${esc(o.classification)}</td></tr>
   <tr><th>بصمة المحتوى الموقَّع SHA-256</th><td dir="ltr" class="mono">${hashes.map(esc).join('<br>')}</td></tr>
   <tr><th>تاريخ الإصدار النهائي</th><td>${esc(fmtDT(new Date()))} · <span dir="ltr">${esc(ME)}</span></td></tr></tbody></table>
   ${vt?`<div class="vbox"><div class="vqr">${qrSvg(vt.url)}</div><div class="vtx"><b>التحقق من هذا الإجراء</b><span>امسح الرمز أو افتح منصة الإجراءات ← «التحقق» وأدخل رمز التحقق:</span><span class="vid" dir="ltr">${esc(vt.id)}</span><span>يمكن أيضًا رفع هذا الملف في صفحة التحقق لمطابقة بصمته مع النسخة الأرشيفية.</span></div></div>`:''}
   <table><thead><tr><th>#</th><th>المرحلة</th><th>الموقّع</th><th>البريد الجامعي</th><th>التاريخ والوقت</th><th>معرّف التوقيع</th></tr></thead><tbody>${rows}</tbody></table>
   <div class="txt">وُقّع هذا الإجراء إلكترونيًا عبر منصة الإجراءات التشغيلية القياسية في الإدارة التنفيذية للاتصالات وتقنية المعلومات. تحقّق الخادم من هوية كل موقّع عبر حسابه الجامعي (‎@sr.edu.sa‎) ومن الرقم السري الخاص بتوقيعه المشفّر، وسُجّلت كل عملية في سجل التدقيق (SigningLog). بصمة المحتوى أعلاه تثبت أن نص الإجراء لم يتغير بعد التوقيع. صور التوقيعات فكّ تشفيرها أصحابها بأرقامهم السرية عند التوقيع، وتبقى نسخها الأصلية مشفّرة في سجل التوقيعات.</div>
   <div class="txt" dir="ltr" style="text-align:left">This SOP was signed electronically on the ICTD SOP Register. Each signer was authenticated with a university Google account (@sr.edu.sa) and the PIN of an encrypted personal signature; every action is recorded in the audit log. The SHA-256 above binds the signatures to the signed content.</div>`;
}
async function generatePdfB64(preview, vt){
  await pdfFonts();
  const {JsPDF}=await loadPdfLibs();
  renderPreview();
  const o=collect();
  const td=document.querySelector('#printDoc .pgwrap > tbody > tr > td'), head=document.querySelector('#printDoc .pghead');
  const nodes=[...td.cloneNode(true).children].filter(e=>!e.classList.contains('foot'));
  nodes.forEach(n=>n.querySelectorAll && n.querySelectorAll('.no-print').forEach(e=>e.remove()));
  const host=document.createElement('div'); host.className='fdoc-host'; document.body.appendChild(host);
  try{
    const pages=paginateDoc(host,nodes,head);
    const ct=document.createElement('template'); ct.innerHTML=certificateHtml(o, vt);
    pages.push(...paginateDoc(host,[...ct.content.children],head));
    pages.forEach((pg,i)=>{ const f=document.createElement('div'); f.className='pfoot';
      f.innerHTML=`<span>صفحة ${i+1} من ${pages.length}</span><span dir="ltr">${esc(o.sop_no)} · v${esc(o.version)}</span><span>${esc(o.classification)}</span>`; pg.appendChild(f);
      if(preview){ const w=document.createElement('div'); w.className='wmk'; w.textContent='نسخة معاينة'; pg.appendChild(w); } });
    await Promise.all([...host.querySelectorAll('img')].map(i=>i.complete?0:new Promise(r=>{ i.onload=i.onerror=r; })));
    if(document.fonts&&document.fonts.ready) await document.fonts.ready;
    const css=PDF_CAIRO_CSS+'\n'+pdfCss();
    const pdf=new JsPDF({unit:'mm', format:'a4', orientation:'portrait', compress:true});
    for(let i=0;i<pages.length;i++){
      const canvas=await renderPageCanvas(pages[i], css);
      if(i) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg',0.92),'JPEG',0,0,210,297);
    }
    return pdf.output('datauristring').split(',')[1];
  } finally { host.remove(); }
}
async function finalizeFlow(auto){
  if(!GAS || SIG.busy || SIG.final || !signState().all) return;
  if(!auto && !confirm('إصدار النسخة النهائية الموقّعة بصيغة PDF وأرشفتها وإرسالها بالبريد إلى الموقّعين؟\nبعدها لا يمكن تعديل هذا الإصدار أو إزالة توقيعاته.')) return;
  SIG.busy=true; applySignLock(); toast('جارٍ إنشاء النسخة النهائية PDF…',8000);
  try{
    await loadQrLib();
    const vt=await sapi({action:'vtoken', code:loaded.sop_no});
    if(!vt.ok) throw new Error(vt.error);
    if(effMode()==='blur'){ const fi=await sapi({action:'finalImages', code:loaded.sop_no}); if(!fi.ok) throw new Error(fi.error); PDF_CLEAR=fi.images||{}; }
    let pdf; try{ pdf=await generatePdfB64(false, vt); } finally { PDF_CLEAR=null; renderPreview(); }
    const r=await sapi({action:'finalize', code:loaded.sop_no, pdf});
    if(!r.ok) throw new Error(r.error);
    SIG.final={at:r.at, pdfHash:r.pdfHash, docHash:r.docHash, verifyId:r.verifyId||vt.id};
    toast(r.already?'صدرت النسخة النهائية مسبقًا':'📄 صدرت النسخة النهائية'+((r.sentTo||[]).length?' وأُرسلت إلى '+r.sentTo.length+' مستلمين':''),7000);
  }catch(e){ toast('تعذّر إصدار النسخة النهائية: '+e.message,9000); }
  SIG.busy=false; applySignLock(); renderPreview();
}
function saveB64(b64, name){
  const bin=atob(b64), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([u],{type:'application/pdf'})); a.download=name;
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },2000);
}
async function downloadFinal(){
  try{ const r=await sapi({action:'finalPdf', code:loaded.sop_no, version:loaded.version}); if(!r.ok) throw new Error(r.error); saveB64(r.b64, r.name); }
  catch(e){ toast(e.message); }
}
async function previewPdf(){
  toast('جارٍ إنشاء معاينة PDF…');
  try{ const o=collect(); saveB64(await generatePdfB64(true), (o.sop_no||'SOP')+'_v'+(o.version||'')+'-preview.pdf'); }catch(e){ toast(e.message); }
}
function openHowTo(){ if(BASE_URL) window.open(BASE_URL+'?page=howto','_blank','noopener'); else toast('متاح من داخل المنصة'); }
function openBoard(){ if(BASE_URL) window.open(BASE_URL+'?page=board','_top'); else toast('متاح من داخل المنصة'); }
function openVerify(id){ if(BASE_URL) window.open(BASE_URL+(id?'?verify='+encodeURIComponent(id):'?page=verify'),'_blank','noopener'); else toast('متاح من داخل المنصة'); }

/* ---------- dialogs + styles (injected once, so only app.js changes for future fixes) ---------- */
(function injectSignUi(){
  const st=document.createElement('style'); st.id='sigStyles'; st.textContent=`
dialog{border:1px solid var(--border);border-radius:var(--radius);padding:0;width:min(880px,calc(100vw - 32px));max-height:calc(100vh - 48px);font-family:inherit;color:var(--ink);box-shadow:0 10px 40px rgba(58,20,100,.25)}
dialog::backdrop{background:rgba(36,20,54,.45)}
.dlg-h{background:var(--purple);color:#fff;padding:10px 16px;display:flex;align-items:center;gap:8px;font-weight:700}
.dlg-h .grow{flex:1}.dlg-h .btn{border-color:#fff;background:transparent;color:#fff}
.dlg-b{padding:14px 16px;display:flex;flex-direction:column;gap:10px;overflow:auto;max-height:calc(100vh - 140px)}
.dlg-b .req{color:var(--err);font-weight:600;font-size:12.5px}
.dlg-b label.f{display:flex;flex-direction:column;gap:3px;font-weight:700;font-size:13px}
.ms-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.reg{width:100%;border-collapse:collapse;font-size:12.5px}
.reg th{background:var(--purple-light);color:var(--purple-dark);text-align:right;padding:6px 8px}
.reg td{border-bottom:1px solid var(--border);padding:6px 8px;vertical-align:middle}
.chip{display:inline-block;background:var(--purple-light);color:var(--purple-dark);border-radius:12px;padding:0 8px;font-size:11.5px}.chip.lk{background:#fde7e7;color:#b42318}
.btn.danger{border-color:#b42318;color:#b42318;background:#fff}
#pad{width:100%;height:170px;border:1px dashed var(--purple);border-radius:var(--radius);background:#fff;touch-action:none;cursor:crosshair}
#msPrev{display:none;max-height:90px;margin-top:6px;border:1px solid var(--border);border-radius:var(--radius);background:#fff}
#pvImg{max-width:100%;max-height:220px;align-self:center;background:#fff}
.mono{font-family:monospace;direction:ltr;word-break:break-all}
.sigbar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;background:#fff7e6;border-bottom:1px solid #f1d39a;color:#7a4a00;padding:6px 20px;font-size:12.5px}
.sigbar.all{background:#eef8f1;border-color:#b7e1c4;color:#1d6b3a}.sigbar.final{background:#eaf3fb;border-color:#b5d4ee;color:#0a4f80}
.sigbar[hidden]{display:none}.sigbar svg{width:15px;height:15px;vertical-align:-3px}.sigbar .tb{display:flex;gap:6px;flex-wrap:wrap}
.pd .sign{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:6px 0 8px}
.pd .sign>div{border:1px solid #cbbfe0;border-radius:4px;padding:8px;text-align:center;font-size:12px;min-height:110px;display:flex;flex-direction:column}
.pd .sign b{display:block;color:var(--purple-dark)}
.pd .sign .line{margin-top:auto;padding-top:4px;border-top:1px solid #b7a9cc;font-size:11px;color:var(--muted)}
.pd .sign .signed{border-color:#1d7a46;background:#f3fbf6}
.pd .sign .sigimg{height:62px;display:flex;align-items:center;justify-content:center;margin:4px 0 2px}
.pd .sign .sigimg img{max-height:60px;max-width:100%;object-fit:contain}
.pd .sign .sigimg.blurred img{opacity:.85}
.pd .sign .sigtxt{height:62px;display:flex;align-items:center;justify-content:center;margin:4px 0 2px;font-size:19px;font-weight:700;font-style:italic;color:#1b2f6b;border-bottom:1px dotted #9fb0d8;line-height:1.2;word-break:break-word}
.modetag{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;flex:0 0 auto;font-size:12px;font-weight:600;background:rgba(255,255,255,.65);border:1px solid rgba(0,0,0,.08);border-radius:14px;padding:2px 10px}
.modetag select{font:inherit;font-size:12px;width:auto!important;min-width:0;max-width:260px;padding:2px 4px;border:1px solid #cbbfe0;border-radius:6px;background:#fff}
.defbox{border:1px solid #cbbfe0;background:#faf7fe;border-radius:var(--radius);padding:8px 10px;display:flex;flex-direction:column;gap:4px}
.defbox .tbx{display:flex;gap:6px;flex-wrap:wrap}.defbox select{padding:5px;border:1px solid #cbbfe0;border-radius:6px}
.pd .sign .stamp{margin-top:auto;border:2px solid #1d7a46;color:#1d7a46;border-radius:6px;padding:4px 6px;display:flex;flex-direction:column;gap:1px;font-size:10.5px;line-height:1.45}
.pd .sign .stamp .ok{font-weight:800}.pd .sign .stamp .nm{color:#241436;font-weight:700;font-size:11.5px}.pd .sign .stamp .ps,.pd .sign .stamp .dt{color:#3d6b50}
.pd .sign .stamp .hx{font-family:monospace;font-size:9px;color:#4b7a5e}
.pd .sign .btn{margin-top:6px;align-self:center}
.pd .sign .await{margin-top:6px;font-size:10.5px;color:var(--muted)}
body.sig-locked .editor .card{opacity:.8}
body.sig-locked .editor .card::before{content:"🔒 مقفل للتعديل — يحتوي على توقيعات";display:block;font-size:11.5px;font-weight:700;color:#7a4a00;background:#fff7e6;padding:3px 12px;border-bottom:1px solid #f1d39a}
.rowcard.signedrow{border-inline-start-color:#1d7a46;background:#f3fbf6}
.rowcard .sigok{font-size:11px;font-weight:700;color:#1d7a46;background:#e3f4ea;border-radius:999px;padding:0 8px}
.fdoc-host{position:absolute;left:-10000px;top:0;width:794px}
.fpage{width:794px;height:1123px;box-sizing:border-box;padding:44px 52px 78px;background:#fff;color:#241436;position:relative;overflow:hidden;direction:rtl;margin-bottom:20px;font-size:13px;line-height:1.65;text-align:right}
.fpage table{font-size:12.5px}
.fpage .fbody{display:flow-root}
.fpage,.fpage *{font-family:'PdfCairo',Tahoma,Arial,sans-serif}
.fpage .mono,.fpage .hx{font-family:monospace}
.fpage .pfoot{position:absolute;left:52px;right:52px;bottom:28px;display:flex;justify-content:space-between;font-size:10px;color:#6b5a80;border-top:1px solid #e3dcef;padding-top:6px}
.vbox{display:flex;gap:16px;align-items:center;border:1.5px solid #1d7a46;border-radius:8px;padding:10px 12px;margin:8px 0 10px;background:#f6fbf8}
.vqr{flex:none;width:132px;height:132px;background:#fff;padding:4px}.vqr svg{width:124px;height:124px;display:block}
.vtx{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#3d4a43}.vtx b{color:#1d6b3a;font-size:14px}
.vid{font-family:monospace;font-size:20px;font-weight:700;color:#241436;letter-spacing:1px;text-align:right}
.fpage .wmk{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:84px;font-weight:700;color:rgba(180,35,24,.10);transform:rotate(-30deg)}
@keyframes howtoGlow{0%,100%{box-shadow:0 0 0 0 rgba(143,211,255,0),0 0 6px 1px rgba(255,255,255,.35)}50%{box-shadow:0 0 0 4px rgba(143,211,255,.35),0 0 18px 6px rgba(143,211,255,.75)}}
.glow{animation:howtoGlow 2.2s ease-in-out infinite;border-color:#8fd3ff!important}
@media (prefers-reduced-motion:reduce){.glow{animation:none}}
@media print{.sigbar,dialog,.pd .sign .btn,.pd .sign .await{display:none!important}}`;
  document.head.appendChild(st);
  document.body.insertAdjacentHTML('beforeend',`
<dialog id="dlgSigs">
  <div class="dlg-h"><i data-lucide="signature"></i><span class="grow">توقيعاتي المشفّرة <span class="en" style="color:#d9cdee">My encrypted signatures</span></span>
    <button class="btn sm" onclick="loadMySigs()"><i data-lucide="refresh-cw"></i>تحديث</button>
    <button class="btn sm" onclick="dlgSigs.close()"><i data-lucide="x"></i>إغلاق</button></div>
  <div class="dlg-b">
    <div class="hint">سجل التوقيعات <b>خاص بمنصة الإجراءات التشغيلية فقط</b> ومستقل عن أي منصة أخرى (منها منصة السياسات). تُشفَّر الصورة داخل متصفحك (AES-256-GCM)، ولا يصل الرقم السري ولا الصورة إلى الخادم.</div>
    <div class="hint"><a href="#" onclick="openHowTo();return false">▶ كيفية التوقيع — شرح توضيحي</a>: إضافة التوقيع، والتوقيع على الإجراء، وكيف يُحمى توقيعك.</div>
    <div style="overflow-x:auto"><table class="reg"><thead><tr><th>الاسم</th><th>المسمى</th><th>الحالة</th><th>تاريخ الإضافة</th><th></th></tr></thead><tbody id="msBody"><tr><td colspan="5" class="hint">…</td></tr></tbody></table></div>
    <div id="msDefWrap" hidden class="defbox"><b>طريقة عرض التوقيع الافتراضية للمنصة <span class="en">Default signature display</span></b>
      <span class="hint">(للمسؤول — تُطبَّق على الإجراءات التي ليس لها إعداد خاص، وتُثبَّت في كل إجراء عند أول توقيع)</span>
      <div class="tbx"><select id="msDefMode"><option value="stamp">نص التوقيع فقط</option><option value="image">صورة التوقيع</option><option value="blur">صورة مموّهة (واضحة في النسخة النهائية)</option></select>
      <button class="btn primary" onclick="saveDefaultDisplay()"><i data-lucide="check"></i>حفظ</button></div></div>
    <div id="msAllWrap" hidden>
      <h4 style="margin:6px 0 0;color:var(--purple-dark)">سجل التوقيعات — جميع الموقّعين <span class="hint">(للمسؤول)</span></h4>
      <div style="overflow-x:auto"><table class="reg"><thead><tr><th>الاسم</th><th>المسمى</th><th>البريد</th><th>الحالة</th><th>تاريخ الإضافة</th><th></th></tr></thead><tbody id="msAll"></tbody></table></div>
    </div>
    <h4 style="margin:6px 0 0;color:var(--purple-dark)">إضافة توقيع جديد</h4>
    <div class="ms-grid">
      <label class="f">الاسم *<input type="text" id="msName" placeholder="الاسم الكامل"></label>
      <label class="f">المسمى الوظيفي<input type="text" id="msPos" placeholder="مثال: مدير إدارة العمليات التقنية"></label>
      <label class="f">الجهة<input type="text" id="msOrg" value="جامعة سليمان الراجحي"></label>
    </div>
    <label class="f" id="msOwnerWrap" hidden>بريد صاحب التوقيع (للمسؤول فقط — لتسجيل توقيع شخص آخر، ويسلّمه الرقم السري؛ اتركه فارغًا ليكون باسمك)<input type="email" id="msOwner" dir="ltr" placeholder="name@sr.edu.sa"></label>
    <div><label style="display:inline;margin-inline-end:14px"><input type="radio" name="msSrc" value="upload" checked onchange="srcMode()" style="width:auto"> رفع صورة</label><label style="display:inline"><input type="radio" name="msSrc" value="draw" onchange="srcMode()" style="width:auto"> رسم التوقيع</label></div>
    <div id="msUp"><input type="file" id="msFile" accept="image/png,image/jpeg,image/webp"><div class="hint">يُفضَّل PNG بخلفية شفافة.</div><img id="msPrev" alt=""></div>
    <div id="msDraw" hidden><canvas id="pad"></canvas><button class="btn sm" style="margin-top:6px" onclick="sizePad()"><i data-lucide="eraser"></i>مسح</button></div>
    <div class="ms-grid">
      <label class="f">الرقم السري * (8 خانات على الأقل تشمل حروفًا وأرقامًا)<input type="password" id="msPin" autocomplete="new-password"></label>
      <label class="f">تأكيد الرقم السري *<input type="password" id="msPin2" autocomplete="new-password"></label>
    </div>
    <div class="hint">لا يمكن استرجاع الرقم السري — عند نسيانه احذف التوقيع وأضفه من جديد. يُقفل التوقيع 15 دقيقة بعد 5 محاولات خاطئة.</div>
    <div><button class="btn primary" id="msAdd" onclick="addSig()"><i data-lucide="lock"></i>تشفير وحفظ التوقيع</button></div>
  </div>
</dialog>
<dialog id="dlgSign">
  <div class="dlg-h"><i data-lucide="pen-line"></i><span class="grow">توقيع الإجراء إلكترونيًا</span>
    <button class="btn sm" onclick="dlgSign.close()"><i data-lucide="x"></i>إغلاق</button></div>
  <div class="dlg-b">
    <div id="sgInfo"></div>
    <label class="f">التوقيع<select id="sgSel"></select></label>
    <label class="f">الرقم السري للتوقيع<input type="password" id="sgPin" autocomplete="off" onkeydown="if(event.key==='Enter')signGo()"></label>
    <label style="display:flex;gap:8px;align-items:flex-start;font-weight:600"><input type="checkbox" id="sgAgree" style="margin-top:5px;width:auto"> أقرّ بأنني اطّلعت على نص هذا الإجراء بإصداره الحالي، وأوافق على توقيعه إلكترونيًا. أي تعديل لاحق يتطلب إصدارًا جديدًا وتوقيعًا جديدًا. ستظهر صورة توقيعي في خانة الاعتماد وعند الطباعة.</label>
    <div class="hint">أول مرة؟ شاهد <a href="#" onclick="openHowTo();return false">شرح كيفية التوقيع</a>.</div>
    <div><button class="btn primary" id="sgGo" onclick="signGo()"><i data-lucide="check"></i>توقيع</button> <span id="sgMsg" class="req"></span></div>
  </div>
</dialog>
<dialog id="dlgPin">
  <div class="dlg-h"><i data-lucide="key-round"></i><span class="grow" id="pinTitle">الرقم السري</span></div>
  <div class="dlg-b">
    <div class="hint" id="pinSub"></div>
    <input type="password" id="pinIn" autocomplete="off">
    <input type="password" id="pinIn2" autocomplete="off" placeholder="الرقم السري الجديد" hidden>
    <input type="password" id="pinIn3" autocomplete="off" placeholder="تأكيد الرقم السري الجديد" hidden>
    <div class="req" id="pinErr"></div>
    <div><button class="btn primary" id="pinOk"><i data-lucide="check"></i>تأكيد</button> <button class="btn" id="pinCancel">إلغاء</button></div>
  </div>
</dialog>
<dialog id="dlgPrev">
  <div class="dlg-h"><i data-lucide="eye"></i><span class="grow" id="pvTitle">معاينة التوقيع</span></div>
  <div class="dlg-b"><div class="hint">تُغلق المعاينة تلقائيًا خلال 15 ثانية.</div><img id="pvImg" alt="" draggable="false">
    <div><button class="btn" onclick="closePrev()">إغلاق</button></div></div>
</dialog>`);
  wirePad();
})();

/* ================= Init ================= */
$('#tplVer').textContent=TEMPLATE_VERSION;
(function init(){
  let d=null; try{ d=JSON.parse(localStorage.getItem(DRAFT_KEY)); }catch(e){}
  if(d && d.title_ar) fill(stripSigs(d)); else fill(JSON.parse(JSON.stringify(EXAMPLE)));
  document.body.dataset.pane='edit';
  applySignLock(); icons(); renderPreview(); loadRecords(null, DATA && !DATA.error ? {ok:true, items:DATA.items||[]} : null);
  const dl=DATA&&DATA.params&&DATA.params.code; if(dl) loadRecord(dl);
  else if(DATA&&DATA.params&&DATA.params.fresh) newSop(true);   // v2.7: «＋ إجراء جديد» from the status board
})();

window.__APP_LOADED = '2.8';
