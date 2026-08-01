
/* ============ 家人共用密碼入口 ============
   GitHub Pages 是純前端網站，因此這是避免陌生人誤入的家庭入口，不等同銀行等級驗證。
   密碼只以 SHA-256 雜湊值比對，不把明碼寫進程式。 */
const FAMILY_PASS_HASH = '59f8fe9c483ba6e0096ebd2a326226e82d35240fb01d66529080caee28284bb6';
const FAMILY_SESSION_KEY = 'kyoto_family_unlocked_v1';
async function sha256Hex(text){
  const bytes=new TextEncoder().encode(text);
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function unlockFamilySite(){
  sessionStorage.setItem(FAMILY_SESSION_KEY,'1');
  document.body.classList.remove('family-locked');
  const gate=document.getElementById('familyGate');
  if(gate){ gate.hidden=true; gate.setAttribute('aria-hidden','true'); }
}
async function submitFamilyGate(){
  const input=document.getElementById('familyGateInput');
  const err=document.getElementById('familyGateError');
  const btn=document.getElementById('familyGateButton');
  if(!input||!btn) return;
  btn.disabled=true;
  if(err) err.textContent='';
  try{
    const ok=(await sha256Hex(input.value))===FAMILY_PASS_HASH;
    if(ok){ unlockFamilySite(); input.value=''; }
    else { if(err) err.textContent='密碼不正確，請再試一次。'; input.select(); }
  }catch(e){ if(err) err.textContent='此瀏覽器無法完成密碼驗證，請改用最新版 Chrome、Safari 或 Edge。'; }
  finally{ btn.disabled=false; }
}
document.addEventListener('DOMContentLoaded',()=>{
  const input=document.getElementById('familyGateInput');
  const btn=document.getElementById('familyGateButton');
  if(sessionStorage.getItem(FAMILY_SESSION_KEY)==='1') unlockFamilySite();
  else setTimeout(()=>input&&input.focus(),80);
  if(btn) btn.addEventListener('click',submitFamilyGate);
  if(input) input.addEventListener('keydown',e=>{ if(e.key==='Enter') submitFamilyGate(); });
});


/* ============ 家人共用同步（Supabase REST） ============
   不依賴外部 Supabase SDK 或 Realtime WebSocket，避免 CDN／WebSocket
   在手機、公司或醫院網路被攔截。每 12 秒檢查一次家人更新。 */
const SUPABASE_URL = "https://xkahhddatpoxuembeiwl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrYWhoZGRhdHBveHVlbWJlaXdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0NDExNDksImV4cCI6MjEwMDAxNzE0OX0.Jdpxpz7rgyK_OikYkRrVQComDWZiaI4fgf5ZV_SdaII";

const SYNC_META_KEY = 'kyoto_sync_meta_v3';
const SYNC_KEYS = ['kyoto_notes','kyoto_photos','kyoto_covers','kyoto_custom_spots','kyoto_order','kyoto_block_order','kyoto_route_maps','kyoto_pack','kyoto_shop','kyoto_rules','kyoto_docs'];
const MEDIA_SYNC_KEYS = new Set(['kyoto_photos','kyoto_covers','kyoto_route_maps']);
const STRUCTURED_LIST_KEYS = new Set(['kyoto_shop','kyoto_rules','kyoto_docs']);
const cloudSync = {enabled:false, applyingRemote:false, pending:{}, timer:null, pollTimer:null, lastError:null, ready:false};
const MEDIA_BUCKET = 'trip-media';

function makeMediaPath(folder, ext='jpg'){
  const id = (crypto.randomUUID ? crypto.randomUUID() : Date.now()+'-'+Math.random().toString(36).slice(2));
  return `${folder}/${new Date().toISOString().slice(0,10)}/${id}.${ext}`;
}
function publicMediaUrl(path){
  return `${SUPABASE_URL}/storage/v1/object/public/${MEDIA_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
function storageHeaders(contentType){
  return {'apikey':SUPABASE_ANON_KEY,'Authorization':'Bearer '+SUPABASE_ANON_KEY,'Content-Type':contentType,'x-upsert':'false'};
}
async function compressImageToBlob(file){
  if(!file.type.startsWith('image/')) return file;
  const dataUrl = await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
  const img = await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=dataUrl;});
  const MAX_DIM=1800; let w=img.naturalWidth,h=img.naturalHeight;
  if(w>MAX_DIM||h>MAX_DIM){if(w>h){h=Math.round(h*MAX_DIM/w);w=MAX_DIM;}else{w=Math.round(w*MAX_DIM/h);h=MAX_DIM;}}
  const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h; canvas.getContext('2d').drawImage(img,0,0,w,h);
  return await new Promise(resolve=>canvas.toBlob(b=>resolve(b||file),'image/jpeg',0.84));
}
async function uploadMediaBlob(blob, folder='uploads'){
  if(!navigator.onLine) throw new Error('目前離線，照片會在恢復網路後才能上傳');
  const ext=blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg';
  const path=makeMediaPath(folder,ext);
  const r=await fetch(`${SUPABASE_URL}/storage/v1/object/${MEDIA_BUCKET}/${path}`,{method:'POST',headers:storageHeaders(blob.type||'application/octet-stream'),body:blob});
  const text=await r.text();
  if(!r.ok){
    if(/Bucket not found|not found/i.test(text)) throw new Error('Supabase Storage 尚未設定，請執行 SUPABASE_SETUP.sql');
    if(/row-level security|permission denied|Unauthorized/i.test(text)) throw new Error('Supabase Storage 上傳權限尚未設定');
    throw new Error(text||`圖片上傳失敗 HTTP ${r.status}`);
  }
  return publicMediaUrl(path);
}
async function uploadMediaFile(file, folder){ return uploadMediaBlob(await compressImageToBlob(file),folder); }
async function uploadLegacyDataUrl(dataUrl, folder){ const blob=await (await fetch(dataUrl)).blob(); return uploadMediaBlob(blob,folder); }
function isLegacyDataUrl(v){ return typeof v==='string' && /^data:image\//i.test(v); }

/* 將任何深度的舊 Base64 圖片遞迴搬到 Storage。
   這同時處理景點照片、封面、路線圖、購物、規範及憑證。 */
async function migrateMediaTree(value, folder='legacy', progress=null){
  if(isLegacyDataUrl(value)){
    if(progress) progress.total++;
    const url=await uploadLegacyDataUrl(value,folder);
    if(progress){ progress.done++; updateMigrationStatus(progress); }
    return url;
  }
  if(Array.isArray(value)){
    const out=[];
    for(let i=0;i<value.length;i++) out.push(await migrateMediaTree(value[i],`${folder}/${i}`,progress));
    return out;
  }
  if(value && typeof value==='object'){
    const out={};
    for(const [k,v] of Object.entries(value)){
      const safe=String(k).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80)||'item';
      out[k]=await migrateMediaTree(v,`${folder}/${safe}`,progress);
    }
    return out;
  }
  return value;
}
function updateMigrationStatus(progress){
  const el=document.getElementById('cloudSyncStatus');
  if(!el)return;
  el.style.display='inline-flex';
  el.classList.add('sync-saving');
  el.textContent=`☁️ 正在搬移舊圖片 ${progress.done}/${progress.total}`;
}
function replaceLocalJson(key,value){
  const json=JSON.stringify(value);
  try{
    localStorage.removeItem(key);
    localStorage.setItem(key,json);
    return true;
  }catch(e){
    /* 本機快取滿不應阻止雲端共用；資料仍保留在記憶體與 Supabase。 */
    console.warn('本機快取空間不足，略過快取：',key,e);
    try{ localStorage.removeItem(key); }catch(_e){}
    return false;
  }
}

function syncHeaders(extra={}){ return {'apikey':SUPABASE_ANON_KEY,'Authorization':'Bearer '+SUPABASE_ANON_KEY,'Content-Type':'application/json',...extra}; }
function getSyncMeta(){ try{return JSON.parse(localStorage.getItem(SYNC_META_KEY))||{};}catch(e){return {};} }
function setSyncMeta(key,timestamp){const m=getSyncMeta();m[key]=timestamp||new Date().toISOString();try{localStorage.setItem(SYNC_META_KEY,JSON.stringify(m));}catch(e){}}
function localValueForKey(key){const raw=localStorage.getItem(key);if(raw==null)return null;try{return JSON.parse(raw);}catch(e){return null;}}
function isBlankSyncValue(v){if(v==null||v==='')return true;if(Array.isArray(v))return v.length===0;if(typeof v==='object')return Object.keys(v).length===0;return false;}
function mergePreservingLocal(local,remote){
  if(isBlankSyncValue(local)) return remote;
  if(isBlankSyncValue(remote)) return local;
  if(Array.isArray(local)&&Array.isArray(remote)){
    const out=[];[...local,...remote].forEach(v=>{const sig=typeof v==='string'?v:JSON.stringify(v);if(!out.some(x=>(typeof x==='string'?x:JSON.stringify(x))===sig))out.push(v);});return out;
  }
  if(typeof local==='object'&&typeof remote==='object'){
    const out={...remote};Object.keys(local).forEach(k=>{out[k]=k in remote?mergePreservingLocal(local[k],remote[k]):local[k];});return out;
  }
  return local;
}

function stableItemId(prefix, parts){
  const text=parts.map(v=>String(v??'').trim().toLowerCase()).join('|');
  let h=2166136261;
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}
  return `${prefix}-${(h>>>0).toString(36)}`;
}
function mergeUniqueUrls(a,b){
  return [...new Set([...(Array.isArray(a)?a:[]),...(Array.isArray(b)?b:[])].filter(Boolean))];
}
function normalizeStructuredList(key,value){
  if(!Array.isArray(value)) return value;
  const map=new Map();
  value.forEach((raw,index)=>{
    if(!raw||typeof raw!=='object') return;
    const item={...raw};
    if(key==='kyoto_shop'){
      item.cat=item.cat||'supermarket';
      item.imgs=mergeUniqueUrls(item.imgs,item.img?[item.img]:[]);
      item.img=null;
      item.id=item.id||stableItemId('shop',[item.cat,item.name,item.location]);
    }else if(key==='kyoto_rules'){
      item.id=item.id||stableItemId('rule',[item.title,item.text]);
    }else if(key==='kyoto_docs'){
      item.id=item.id||stableItemId('doc',[item.ic,item.t,item.s]);
    }
    const fallback=`${key}-${index}`;
    const id=item.id||fallback;
    if(!map.has(id)){ map.set(id,item); return; }
    const prev=map.get(id);
    if(key==='kyoto_shop'){
      map.set(id,{...prev,...item,imgs:mergeUniqueUrls(prev.imgs,item.imgs),qty:Math.max(Number(prev.qty)||1,Number(item.qty)||1),checked:Boolean(prev.checked||item.checked)});
    }else{
      map.set(id,{...prev,...item,img:item.img||prev.img||null});
    }
  });
  return [...map.values()];
}
function normalizeSyncValue(key,value){
  return STRUCTURED_LIST_KEYS.has(key)?normalizeStructuredList(key,value):value;
}
function friendlySyncError(e){
  const msg=String(e&&e.message||e||'未知錯誤');
  if(/Failed to fetch|NetworkError/i.test(msg)) return '無法連上雲端資料庫';
  if(/relation.*kyoto_sync.*does not exist|PGRST205/i.test(msg)) return '尚未建立 kyoto_sync 資料表';
  if(/row-level security|permission denied|42501/i.test(msg)) return 'Supabase 權限尚未設定';
  if(/Storage 尚未設定|Bucket not found/i.test(msg)) return '圖片雲端空間尚未設定';
  if(/Storage 上傳權限/i.test(msg)) return '圖片雲端上傳權限尚未設定';
  if(/quota|exceed/i.test(msg)) return '本機快取空間不足，但雲端同步仍會繼續';
  if(/JWT|apikey|401|403/i.test(msg)) return 'Supabase 金鑰或權限錯誤';
  return msg.slice(0,80);
}
async function restGetRows(){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/kyoto_sync?select=key,value,updated_at`,{headers:syncHeaders(),cache:'no-store'});
  const text=await r.text(); if(!r.ok) throw new Error(text||`HTTP ${r.status}`); return text?JSON.parse(text):[];
}
async function restUpsert(key,valueObj,updatedAt){
  const r=await fetch(`${SUPABASE_URL}/rest/v1/kyoto_sync?on_conflict=key`,{method:'POST',headers:syncHeaders({'Prefer':'resolution=merge-duplicates,return=minimal'}),body:JSON.stringify({key,value:JSON.stringify(valueObj),updated_at:updatedAt||new Date().toISOString()})});
  const text=await r.text(); if(!r.ok) throw new Error(text||`HTTP ${r.status}`); return true;
}
async function initCloudSync(){
  updateSyncStatus(null,'connecting');
  try{
    cloudSync.enabled=true;
    await reconcileInitialCloudData();
    cloudSync.ready=true; cloudSync.lastError=null; updateSyncStatus();
    clearInterval(cloudSync.pollTimer); cloudSync.pollTimer=setInterval(pollCloudChanges,12000);
  }catch(e){cloudSync.lastError=e;console.error('家人同步初始化失敗：',e);updateSyncStatus(e);}
}
async function reconcileInitialCloudData(){
  const rows=await restGetRows();
  const remoteMap=new Map(rows.map(r=>[r.key,r]));
  const meta=getSyncMeta();
  for(const key of SYNC_KEYS){
    const remote=remoteMap.get(key);
    const localRaw=localStorage.getItem(key);
    const localTime=Date.parse(meta[key]||0)||0;
    const remoteTime=Date.parse(remote&&remote.updated_at||0)||0;
    let localValue=null, remoteValue=null;
    try{ if(localRaw!=null) localValue=JSON.parse(localRaw); }catch(e){}
    try{ if(remote) remoteValue=JSON.parse(remote.value); }catch(e){}

    if(MEDIA_SYNC_KEYS.has(key)){
      const progress={done:0,total:0};
      if(localValue!=null) localValue=await migrateMediaTree(localValue,`legacy/local/${key}`,progress);
      if(remoteValue!=null) remoteValue=await migrateMediaTree(remoteValue,`legacy/cloud/${key}`,progress);
      let merged;
      if(localValue!=null && remoteValue!=null) merged=mergePreservingLocal(localValue,remoteValue);
      else merged=localValue!=null?localValue:remoteValue;
      if(merged!=null){
        const t=new Date(Math.max(localTime,remoteTime,Date.now())).toISOString();
        cloudSync.applyingRemote=true;
        try{ replaceLocalJson(key,merged); setSyncMeta(key,t); applyStoreUpdate(key,JSON.stringify(merged)); }
        finally{ cloudSync.applyingRemote=false; }
        await restUpsert(key,merged,t);
      }
      continue;
    }

    if(remote&&remoteTime>=localTime){ applyRemoteRow(remote); }
    else if(localValue!=null){ await restUpsert(key,localValue,meta[key]||new Date().toISOString()); }
  }
}

async function pollCloudChanges(){
  if(!navigator.onLine||cloudSync.applyingRemote)return;
  try{const rows=await restGetRows();rows.forEach(applyRemoteRow);cloudSync.lastError=null;updateSyncStatus();}
  catch(e){cloudSync.lastError=e;updateSyncStatus(e);}
}

/* 背景同步不得打斷任何正在輸入的表單。
   遠端資料會先排隊，等輸入框失焦後再一次套用。 */
const deferredRemoteRows = new Map();
let deferredRemoteTimer = null;
function isUserEditingForm(){
  const a=document.activeElement;
  if(!a) return false;
  if(a.matches && a.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select, [contenteditable="true"]')) return true;
  return false;
}
function queueRemoteRow(row){
  if(!row||!row.key)return;
  const prev=deferredRemoteRows.get(row.key);
  if(!prev || Date.parse(prev.updated_at||0)<=Date.parse(row.updated_at||0)) deferredRemoteRows.set(row.key,row);
}
function flushDeferredRemoteRows(){
  clearTimeout(deferredRemoteTimer);
  deferredRemoteTimer=setTimeout(()=>{
    if(isUserEditingForm()||!deferredRemoteRows.size)return;
    const rows=[...deferredRemoteRows.values()];
    deferredRemoteRows.clear();
    rows.forEach(r=>applyRemoteRow(r,true));
  },280);
}
document.addEventListener('focusout',flushDeferredRemoteRows,true);
document.addEventListener('keydown',e=>{if(e.key==='Escape')flushDeferredRemoteRows();},true);

function applyRemoteRow(row, forceApply=false){
  if(!row||typeof row.value==='undefined')return;
  if(!forceApply && isUserEditingForm()){ queueRemoteRow(row); return; }
  const rt=row.updated_at||new Date().toISOString(), lt=getSyncMeta()[row.key]; if(lt&&Date.parse(lt)>Date.parse(rt))return;
  cloudSync.applyingRemote=true;
  try{let remote;try{remote=JSON.parse(row.value);}catch(e){remote=null;}remote=normalizeSyncValue(row.key,remote);let value=remote;if(MEDIA_SYNC_KEYS.has(row.key)){const local=localValueForKey(row.key);value=mergePreservingLocal(local,remote);}const valueStr=JSON.stringify(value);replaceLocalJson(row.key,value);setSyncMeta(row.key,rt);applyStoreUpdate(row.key,valueStr);}catch(e){console.error('套用家人資料失敗',e);}finally{cloudSync.applyingRemote=false;}
}
function applyStoreUpdate(key,jsonStr){
  let parsed;try{parsed=JSON.parse(jsonStr);}catch(e){return;}
  switch(key){case'kyoto_notes':notesStore=parsed;break;case'kyoto_photos':photoStore=parsed;break;case'kyoto_covers':coverStore=parsed;break;case'kyoto_custom_spots':customSpotsStore=parsed;break;case'kyoto_order':orderStore=parsed;break;case'kyoto_block_order':blockOrderStore=parsed;break;case'kyoto_route_maps':routeMapStore=parsed;break;case'kyoto_pack':packData=migratePackCategoryNames(parsed);if(isPackComposerEditing()){window._packRemoteRenderPending=true;}else{renderPackList();}return;case'kyoto_shop':shopData=normalizeStructuredList('kyoto_shop',parsed);renderShopList();return;case'kyoto_rules':rulesData=normalizeStructuredList('kyoto_rules',parsed);renderRulesList();return;case'kyoto_docs':docsData=normalizeStructuredList('kyoto_docs',parsed);renderDocsList();return;default:return;}
  if(typeof renderDayContent==='function')renderDayContent();if(typeof updateSpotCount==='function')updateSpotCount();
}
function scheduleCloudPush(key,valueObj){
  if(!cloudSync.enabled||cloudSync.applyingRemote)return;const t=new Date().toISOString();setSyncMeta(key,t);cloudSync.pending[key]={valueObj,updatedAt:t};clearTimeout(cloudSync.timer);cloudSync.timer=setTimeout(flushCloudPush,700);updateSyncStatus(null,'saving');
}
async function flushCloudPush(){
  const entries=Object.entries(cloudSync.pending);cloudSync.pending={};
  for(const[key,item]of entries){try{await restUpsert(key,item.valueObj,item.updatedAt);cloudSync.lastError=null;}catch(e){cloudSync.lastError=e;console.error('同步寫入失敗',e);updateSyncStatus(e);return;}}
  updateSyncStatus();setTimeout(pollCloudChanges,500);
}
function updateSyncStatus(err,state){
  const el=document.getElementById('cloudSyncStatus');if(!el)return;el.style.display='inline-flex';el.classList.toggle('sync-error',!!err);el.classList.toggle('sync-saving',state==='saving'||state==='connecting');
  if(err){el.textContent='⚠️ '+friendlySyncError(err);el.title=String(err&&err.message||err);}
  else if(state==='connecting')el.textContent='☁️ 正在連接家人同步';else if(state==='saving')el.textContent='☁️ 正在同步變更';else el.textContent='☁️ 家人共享已同步';
}
/* ============ HEADER IMAGES ============ */
const headerBgs = [
  {url:'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82', pos:'center 48%'},
  {url:'https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82', pos:'center 48%'},
  {url:'https://images.unsplash.com/photo-1545569341-9eb8b30979d9?auto=format&fit=crop&w=1200&q=82', pos:'center 50%'},
  {url:'https://images.unsplash.com/photo-1584545284372-f22510eb7c26?auto=format&fit=crop&w=1200&q=82', pos:'center 45%'},
  {url:'https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82', pos:'center 52%'}
];
document.addEventListener('DOMContentLoaded', () => {
  const pick = headerBgs[Math.floor(Math.random() * headerBgs.length)];
  const header = document.getElementById('main-header');
  header.style.backgroundImage = `linear-gradient(180deg, rgba(249,221,144,0.16) 0%, rgba(122,50,1,0.78) 100%), url('${pick.url}')`;
  header.style.backgroundPosition = pick.pos;
});

function loadLocalMap(e){
  const f = e.target.files[0];
  if(f){
    document.getElementById('handDrawnMapImg').src = URL.createObjectURL(f);
    document.getElementById('handDrawnMapImg').style.display = 'block';
    document.getElementById('mapFallback').style.display = 'none';
  }
}

/* ============ DATA ============ */
const CAT = {
  food:{label:'美食', cls:'cat-food', emoji:'🍽️'},
  activity:{label:'活動／步道', cls:'cat-activity', emoji:'🥾'},
  shopping:{label:'購物', cls:'cat-shopping', emoji:'🛍️'},
  attraction:{label:'景點', cls:'cat-attraction', emoji:'🏞️'},
  hotel:{label:'住宿', cls:'cat-hotel', emoji:'🏨'},
  transport:{label:'交通', cls:'cat-transport', emoji:'✈️'},
};

function S(name, cat, desc, opts={}){
  return Object.assign({name, cat, desc, tags:[], park:null, tip:null, dur:null, note:null, link:null, linkLabel:'查看網頁', img:null, hours:null, docMap:null, customInfo:null, recDishes:null, fullDesc:null}, opts);
}

const days = [
{dayNum:"1",date:"11/27",weekday:"五",region:"啟程・抵達京都",enRegion:"KIX \u2192 Kyoto Station",drive:"🚆 HARUKA 約 75–90 分鐘",title:"輕鬆抵達，從京都站暖身",dayDesc:"抵達日不追景點；完成入境、移動與寄放行李後，以京都站周邊散步為主。班機與入境都順利才加東福寺。",wear:"長袖內層＋毛衣／刷毛＋薄羽絨",weatherIco:"🍁",spots:[
    S("TPE → KIX 航班","transport","08:05 桃園起飛，11:35 抵達關西機場。",{dur:"約3.5小時",fullDesc:"抵達後依序完成入境、領取行李與交通票券，避免在抵達日安排跨區景點。",img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("HARUKA 關西機場特急","transport","由關西機場直達京都站，是攜帶行李時最省力的選擇。",{dur:"約75–90分鐘",fullDesc:"建議預留入境與購票時間；抵達京都後先至 Richmond Hotel 寄放行李，再開始輕鬆散步。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("京都站周邊","attraction","Porta、伊勢丹與車站建築都適合抵達日下午慢慢逛。",{tags:["輕鬆"],fullDesc:"抵達日以熟悉車站動線、購買飲水與補給為主，不建議再拉去醍醐寺。",img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("東福寺（機動）","attraction","只有班機、入境與交通都順利，且仍有入場時間才考慮。",{tags:["備案"],fullDesc:"東福寺是抵達日的可刪項目，不應影響晚餐與休息；若時間不足直接留在京都站。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("Richmond Hotel 京都站","hotel","第一晚與最後一晚住宿，方便搭乘機場交通與寄放行李。",{img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("京豆富不二乃","food","京都站內的豆腐料理選擇。",{tags:["京都料理"],img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("名代とんかつ かつくら","food","適合抵達日快速且有飽足感的炸豬排。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("京都鶏白湯そば 純","food","京都站周邊快速麵食備案。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"2",date:"11/28",weekday:"六",region:"紅葉機動日・只選一區",enRegion:"Ohara / Takao / Kurama",drive:"🚌 依紅葉與天氣選一條路線",title:"三千院、高雄、鞍馬三選一",dayDesc:"慢旅原則：三區絕不全跑。出發前 2–3 天依紅葉情報、降雨與體力決定。晚上回四條烏丸逛街。",wear:"山區加圍巾、手套、厚襪與防風外套",weatherIco:"🍂",spots:[
    S("三千院＋大原散步","attraction","適合想看苔庭、落葉與安靜村落的低至中強度版本。",{tags:["方案A","最悠閒"],dur:"半日至一日",fullDesc:"大原路線步調最慢，適合紅葉已進入落葉期或前一日移動疲累時選擇。可圍繞三千院與村落散步，不必塞滿寺院。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("高雄：神護寺＋西明寺","attraction","紅葉密度高，但階梯與移動強度較高。",{tags:["方案B","紅葉密度"],dur:"約5–7小時",fullDesc:"以神護寺與西明寺為主，高山寺只在時間與體力充足時加入。若紅葉仍在見頃，這條路線最有季節感。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("鞍馬寺（貴船視體力）","activity","晴朗時適合山林散步；是否翻山至貴船現場決定。",{tags:["方案C","山林"],dur:"約4–7小時",fullDesc:"不預設一定完成鞍馬到貴船的完整健行。路況濕滑、天色轉暗或體力不足時，原路折返即可。",img:"https://images.unsplash.com/photo-1545569341-9eb8b30979d9?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("大和魯內飯店 京都四條烏丸","hotel","連住兩晚，方便回飯店休息與逛烏丸、河原町。",{img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("新風館＋LE LABO","shopping","晚間回市區後的輕鬆逛街組合。",{img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("京都天婦羅 天天天","food","正式晚餐候選，建議事先訂位。",{tags:["預約"],img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("京の焼肉処 弘","food","京都燒肉晚餐候選。",{tags:["預約"],img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("空蟬亭","food","晚餐候選，依訂位與當日動線安排。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"3",date:"11/29",weekday:"日",region:"東山・紅葉星期日輕量版",enRegion:"Shinnyodo \u2192 Eikando \u2192 Nanzenji",drive:"🚇 市區大眾運輸＋步行",title:"早起看紅葉，午後回市區休息",dayDesc:"紅葉旺季星期日人潮大，不做完整東山縱走；以真如堂、永觀堂、南禪寺為主，額外庭園只選一處。",wear:"好走鞋＋可穿脫保暖層",weatherIco:"🍁",spots:[
    S("真如堂","attraction","早起先到，避開較晚抵達的團體人潮。",{tags:["早起"],dur:"約60–90分鐘",fullDesc:"真如堂是這日的第一站；欣賞紅葉與本堂周邊後就往南移動，不在同區反覆折返。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("永觀堂","attraction","京都代表性紅葉寺院，旺季人多但值得保留。",{tags:["必看"],dur:"約60–90分鐘",fullDesc:"星期日應把永觀堂放在行程核心，接受一定人潮；若排隊過長，就縮短其他加點。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("南禪寺","attraction","以三門、水路閣與院內散步收尾。",{dur:"約60分鐘",fullDesc:"南禪寺腹地較開闊，適合在永觀堂後舒緩人潮壓力。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("天授庵／無鄰菴二選一","attraction","依預約、人潮與體力只加一座庭園。",{tags:["機動"],fullDesc:"兩者不必都去。若當天已疲累，直接回岡崎、四條或河原町休息逛街。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("DRAGON BURGER","food","東山一帶用餐候選。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("祇園辻利","food","抹茶甜點休息站。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("BAL・Kyoto LOFT・KIDDY LAND","shopping","下午回河原町後再選擇逛街。",{img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("SOU・SOU 一条街","shopping","京都服飾與設計品牌集中區。",{img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"4",date:"11/30",weekday:"一",region:"修學院 → 宇治 → 奈良",enRegion:"Northern Kyoto \u2192 Uji \u2192 Nara",drive:"🚆 大眾運輸跨城移動",title:"庭園晨光、宇治午後與奈良夜晚",dayDesc:"上午修學院區三選二，中午回飯店取行李；宇治至少保留 3 小時，再前往奈良入住。",wear:"洋蔥式穿搭，行李移動日以輕便為主",weatherIco:"🍵",spots:[
    S("詩仙堂・圓光寺・曼殊院三選二","attraction","上午不要貪多，依紅葉與開門時間選兩處。",{tags:["三選二"],dur:"約3小時",fullDesc:"三座寺院位置相近但仍需步行與轉乘，選兩處才能維持慢旅節奏。修學院離宮若要去需事前預約，且會取代其中一部分行程。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("平等院","attraction","宇治核心景點，安排午後參觀。",{tags:["宇治核心"],dur:"約60–90分鐘",fullDesc:"搭配宇治川散步，不把宇治只當轉車點。旺季若鳳翔館需排隊，保留彈性。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("宇治川＋宇治上神社","attraction","以河岸步行串接兩岸景點。",{dur:"約60分鐘",fullDesc:"河岸氣氛舒適，可依時間增加宇治上神社；避免為了打卡頻繁往返。",img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("興聖寺（機動）","attraction","若時間充足再走琴坂與寺院。",{tags:["可刪"],fullDesc:"宇治至少留三小時，但若前段延誤，興聖寺優先刪除，確保傍晚順利抵達奈良。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("辻利兵衛本店","food","宇治甜點候選。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("クウネルノツヅキ","food","宇治咖啡甜點備案。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("奈良大和魯內飯店","hotel","奈良住宿，晚餐以飯店附近為主。",{img:"https://images.unsplash.com/photo-1584545284372-f22510eb7c26?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"5",date:"12/1",weekday:"二",region:"奈良 → 龜岡 → 保津川／嵐山",enRegion:"Nara \u2192 Kameoka \u2192 Arashiyama",drive:"🚗 奈良取車後前往龜岡",title:"保津川漂流為主體，嵐山只留兩個重點",dayDesc:"清晨奈良散步後取車。晴朗且風小搭保津川漂流；陰雨或風大改搭 JR。車與行李留在龜岡飯店。",wear:"船上體感冷：防風外套、圍巾、手套",weatherIco:"🚣",spots:[
    S("奈良公園・浮見堂・飛火野","attraction","清晨選一至兩處散步，避開晚一點的人潮。",{tags:["清晨"],dur:"約60–90分鐘",fullDesc:"退房與取車前的輕量行程，不延伸到過多寺院。",img:"https://images.unsplash.com/photo-1584545284372-f22510eb7c26?auto=format&fit=crop&w=1200&q=82"}),
    S("保津川漂流（天氣好版）","activity","約 11:00 搭船，約 13:00 抵達嵐山。",{tags:["晴天版"],dur:"約2小時",fullDesc:"奈良退房租車後前往龜岡飯店停車寄物，再前往乘船處。漂流是當日主體，抵達嵐山後只安排兩個重點。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82",tip:"出發前確認營運、風況與水位；船上長時間吹風，務必加強保暖。"}),
    S("JR 嵯峨嵐山（雨風版）","transport","天候不適合漂流時，從龜岡搭 JR 往返嵐山。",{tags:["備案"],fullDesc:"JR 版可把時間留給天龍寺、竹林與一至兩座寺院，但仍不建議塞滿整個嵐山。",img:"https://images.unsplash.com/photo-1545569341-9eb8b30979d9?auto=format&fit=crop&w=1200&q=82"}),
    S("天龍寺","attraction","兩個嵐山重點之一。",{dur:"約60分鐘",fullDesc:"無論漂流版或 JR 版都優先保留；抵達較晚時注意停止入場時間。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("常寂光寺／寶筐院二選一","attraction","下午第二個紅葉重點，依當時紅葉與人潮決定。",{tags:["二選一"],fullDesc:"漂流版只再選一座；JR 版若時間多，可把二尊院列為額外備選。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("Route Inn 龜岡","hotel","車停飯店、行李寄放，輕裝前往保津川與嵐山。",{img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("嵐山商店街","shopping","午餐、咖啡與伴手禮簡單安排，不特別追排隊名店。",{img:"https://images.unsplash.com/photo-1545569341-9eb8b30979d9?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"6",date:"12/2",weekday:"三",region:"龜岡 → 南丹 → 綾部 → 京丹後",enRegion:"Kameoka \u2192 Nantan \u2192 Ayabe \u2192 Kyotango",drive:"🚗 約 150 km／分段慢行",title:"晚楓山寺與丹後海邊旅宿",dayDesc:"以龍穩寺與梅松苑為兩個停靠點，綾部簡單午餐後直接往京丹後，約 15:00 入住。",wear:"山區與丹後加強防風保暖",weatherIco:"🚗",spots:[
    S("玉寶山 龍穩寺","attraction","可能遇到晚楓或落葉紅毯，是此日季節重點。",{tags:["晚楓"],dur:"約60分鐘",fullDesc:"是否仍有紅葉依當年進度而定；即使落葉，參道與山寺氛圍仍適合慢慢散步。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("大本本部 梅松苑","attraction","綾部的重要園區與建築群。",{dur:"約60分鐘",fullDesc:"作為南丹到京丹後途中停靠點，參觀後在綾部簡單午餐，不再增加遠繞景點。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("綾部午餐","food","以順路、停車方便為優先。",{tags:["簡單吃"],fullDesc:"這天的目標是準時抵達京丹後旅館，午餐不追排隊名店。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("シーサイド佐竹","hotel","海邊溫泉旅館，約 15:00 入住並在旅館享用晚餐。",{tags:["旅館晚餐"],img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"7",date:"12/3",weekday:"四",region:"京丹後海岸・旅館休息日",enRegion:"Kyotango Coast",drive:"🚗 海岸短距離移動",title:"依天氣選海岸，不去休息日的牧場",dayDesc:"11:00 退房後慢遊，15:00 入住艸花。星期四丹後牧場休息，因此以海岸、咖啡與旅館休息為主。",wear:"海風強，羽絨或防風外套＋帽子",weatherIco:"🌊",spots:[
    S("立岩＋後ヶ濱海岸","attraction","晴天版的海岸主景。",{tags:["晴天版"],dur:"約60–90分鐘",fullDesc:"天氣晴朗、能見度佳時優先。海邊風大，不需在單點停留過久。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"}),
    S("道之驛 てんきてんき丹後","shopping","海岸途中休息、伴手禮與天候備案。",{tags:["雨天可去"],fullDesc:"晴天可與立岩串接；雨天則作為室內停留與補給點。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"}),
    S("琴引濱＋網野咖啡","attraction","順路版，適合不想往返太多海岸點時。",{tags:["順路版"],fullDesc:"選琴引濱後就搭配網野午餐或咖啡，不再往立岩方向硬繞。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"}),
    S("雨天版：午餐＋道之驛＋咖啡","food","大雨或強風時取消海岸久留。",{tags:["雨天版"],fullDesc:"把時間留給午餐、採買與旅館設施，15:00 準時入住。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("HOTEL＆湖邸 艸花","hotel","15:00 入住，這日把旅館本身當作行程。",{tags:["慢旅"],img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"}),
    S("間人／網野午餐","food","依當天海岸動線選擇，不為餐廳大幅繞路。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"8",date:"12/4",weekday:"五",region:"京丹後 → 金剛院 → 天橋立 → 舞鶴",enRegion:"Kyotango \u2192 Amanohashidate \u2192 Maizuru",drive:"🚗 約 100–130 km",title:"海之京都一路向東，只選天橋立一岸",dayDesc:"上午金剛院，中午抵達天橋立。已搭過 View Land 就走府中側；沒看過飛龍觀才走文珠側。",wear:"防風保暖，纜車與展望台體感更冷",weatherIco:"🌉",spots:[
    S("金剛院","attraction","舞鶴山間古寺，作為天橋立前的寧靜停靠。",{dur:"約60–90分鐘",fullDesc:"上午退房後前往，不要再增加過多寺院，保留天橋立的日照時間。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("府中側：籠神社＋傘松公園","attraction","已搭過 View Land 時選這岸。",{tags:["方案A"],dur:"約2–3小時",fullDesc:"以籠神社與傘松公園為主，不做沙洲完整徒步或繞行。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"}),
    S("文珠側：View Land＋智恩寺","attraction","未看過飛龍觀時選這岸。",{tags:["方案B"],dur:"約2–3小時",fullDesc:"View Land、智恩寺與沙洲前段即可；天橋立只選一岸。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("天橋立午餐","food","依選擇的岸就近用餐。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("Route Inn 西舞鶴","hotel","傍晚入住，晚餐於西舞鶴安排。",{img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"9",date:"12/5",weekday:"六",region:"舞鶴 → 京都",enRegion:"Maizuru \u2192 Kyoto",drive:"🚗 上午舞鶴；下午回京都還車",title:"海鮮市場、天空塔與紅磚，傍晚回京都",dayDesc:"五老天空塔放上午，避免傍晚能見度不佳；紅磚公園後回京都還車並入住京都站。",wear:"展望台風大；回京都後可減少一層",weatherIco:"⚓",spots:[
    S("舞鶴港とれとれセンター","food","早上以海鮮市場早餐／早午餐開始。",{tags:["早餐"],dur:"約60–90分鐘",fullDesc:"先吃再逛，依當日營業攤位選擇，不需要刻意點太多。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"}),
    S("五老天空塔","attraction","俯瞰舞鶴灣的代表展望點。",{tags:["上午"],dur:"約60分鐘",fullDesc:"排在上午以提高能見度；若雲霧太濃，可縮短停留。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"}),
    S("舞鶴紅磚公園","attraction","港町歷史建築群，適合回京都前散步。",{dur:"約60–90分鐘",fullDesc:"作為舞鶴最後一站，結束後直接開車回京都還車。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("Richmond Hotel 京都站","hotel","回到京都站住宿，方便隔日前往機場。",{img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("最後晚餐候選","food","京の焼肉処 弘、天天天、空蟬亭或かぼちゃのたね擇一。",{tags:["預約"],img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"10",date:"12/6",weekday:"日",region:"京都晚楓保險 → 關西機場",enRegion:"Kyoto \u2192 KIX \u2192 TPE",drive:"🚆 15:00 前由京都站前往 KIX",title:"最後的晚楓散步，從容返台",dayDesc:"退房寄放行李後走西本願寺、京都御苑與糺之森；14:00 左右回京都站，15:00 前搭車往機場。",wear:"市區洋蔥式穿搭，機艙備薄外套",weatherIco:"✈️",spots:[
    S("西本願寺","attraction","京都站附近的晨間第一站。",{dur:"約45–60分鐘",fullDesc:"距京都站不遠，適合退房後開始；保持節奏，不延誤後續。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("京都御苑","attraction","作為 12 月初晚楓與銀杏保險。",{tags:["晚楓保險"],dur:"約60分鐘",fullDesc:"腹地大，選擇一段散步即可，不必完整繞行。",img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("下鴨神社＋糺之森","attraction","林蔭與晚楓氣氛，視時間保留。",{tags:["機動"],dur:"約60–90分鐘",fullDesc:"若前段延誤，縮短糺之森散步，務必 14:00 左右回京都站。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("KIX → TPE 航班","transport","19:00 關西機場起飛，21:15 抵達桃園。",{dur:"約3小時15分",fullDesc:"15:00 前從京都站出發，預留取行李、機場交通與報到時間。",img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("イノダコーヒ本店","food","早餐候選，但不為排隊影響離境日節奏。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("まるき製パン所／fiveran","food","麵包外帶候選。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("Point Pour Point","food","甜點咖啡候選。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("ごちそう焼むすび おにまる","food","適合帶走的飯糰。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ]}
];

/* ============ 筆記/照片/自訂景點系統 (LocalStorage 永久保存) ============ */

/* 共用安全寫入函式：localStorage 容量有限（通常僅 5-10MB／裝置），
   照片存多了可能會寫入失敗。統一在這裡攔截錯誤並提示使用者，
   而不是讓資料默默遺失、卻讓使用者誤以為「上傳照片沒反應」。 */
function safeSetItem(key, valueObj){
  let localOk = true;
  try {
    localStorage.setItem(key, JSON.stringify(valueObj));
  } catch(e) {
    localOk = false;
    console.error('localStorage 寫入失敗：', key, e);
  }
  // 若已啟用家人共享同步，改把資料推上雲端；雲端會自動用它自己的（容量大很多的）
  // 離線快取保存，所以就算這台裝置的 localStorage 滿了也不代表資料真的保不住。
  valueObj=normalizeSyncValue(key,valueObj);
  if (!cloudSync.applyingRemote) scheduleCloudPush(key, valueObj);
  if (!localOk && !cloudSync.enabled) {
    alert('⚠️ 這台裝置瀏覽器的儲存空間已滿，剛才的變更可能無法保存。請先刪除幾張較舊或較大的照片，再重新上傳。');
    return false;
  }
  return true;
}

let notesStore = JSON.parse(localStorage.getItem('kyoto_notes')) || {};
/* 相容舊版資料：以前每個景點只能存一則筆記（字串），現在改成可以新增多筆 */
Object.keys(notesStore).forEach(k=>{
  if (typeof notesStore[k] === 'string') {
    notesStore[k] = notesStore[k].trim() ? [notesStore[k].trim()] : [];
  }
});
function persistNotes(){ safeSetItem('kyoto_notes', notesStore); }
function addNote(key) {
  const input = document.getElementById('note-input-'+key);
  if(!input) return;
  const text = input.value.trim();
  if(!text) return;
  if(!notesStore[key]) notesStore[key] = [];
  notesStore[key].push(text);
  persistNotes();
  renderDayContent();
  setTimeout(()=>{
    const card = document.getElementById('spot-card-'+key); if(card) card.classList.add('open');
    const editArea = document.getElementById('edit-note-'+key); if(editArea) editArea.style.display = 'block';
    const toggleBtn = document.getElementById('btn-note-'+key); if(toggleBtn) toggleBtn.style.display = 'none';
  }, 50);
}
function deleteNote(key, noteIdx) {
  if(!notesStore[key]) return;
  notesStore[key].splice(noteIdx, 1);
  persistNotes();
  renderDayContent();
  setTimeout(()=>{
    const card = document.getElementById('spot-card-'+key); if(card) card.classList.add('open');
  }, 50);
}
function toggleEditNote(event, key) {
  event.stopPropagation();
  const editArea = document.getElementById('edit-note-'+key);
  const toggleBtn = document.getElementById('btn-note-'+key);
  if (editArea.style.display === 'none') {
    editArea.style.display = 'block';
    if(toggleBtn) toggleBtn.style.display = 'none';
  } else {
    editArea.style.display = 'none';
    if(toggleBtn) toggleBtn.style.display = 'inline-block';
  }
}

/* 景點照片：改用 base64 存進 LocalStorage，重新整理／關閉頁面後仍會保留。
   上傳時會先自動壓縮（最長邊 1600px、JPEG 品質 0.82），
   避免手機原圖動輒 3-8MB，很快就把裝置的 localStorage 容量塞滿導致上傳失敗。 */
let photoStore = JSON.parse(localStorage.getItem('kyoto_photos')) || {};
function persistPhotos(){ return safeSetItem('kyoto_photos', photoStore); }

/* 景點封面：使用者可指定某張照片（或原始配圖）作為主要亮點卡片的封面，
   而不是每次上傳新照片就自動覆蓋原本的封面 */
let coverStore = JSON.parse(localStorage.getItem('kyoto_covers')) || {};
function persistCover(){ safeSetItem('kyoto_covers', coverStore); }
function setCoverPhoto(key, sel) {
  coverStore[key] = sel;
  persistCover();
  renderDayContent();
  setTimeout(()=>{ const card = document.getElementById('spot-card-'+key); if(card) card.classList.add('open'); }, 50);
}

/* 自訂新增景點：依「天」儲存在 LocalStorage，重新整理後仍會保留 */
let customSpotsStore = JSON.parse(localStorage.getItem('kyoto_custom_spots')) || {};
function persistCustomSpots(){ safeSetItem('kyoto_custom_spots', customSpotsStore); }
function getCustomSpots(dayIdx){ return customSpotsStore[dayIdx] || []; }

/* 依關鍵字與分類，自動組出一段景點簡介（離線生成，不需要網路，句型會隨機變化避免制式感） */
function generateAutoDesc(name, catKey, keywordsStr, dur){
  const c = CAT[catKey] || CAT.attraction;
  const kws = (keywordsStr||'').split(/[,，、]/).map(s=>s.trim()).filter(Boolean);
  const pick = arr => arr[Math.floor(Math.random()*arr.length)];

  const openers = {
    food: [`提到在地美食，「${name}」是您這趟旅程特別記下的一站`, `「${name}」是您收藏進口袋名單的用餐選擇`, `說到用餐，「${name}」是您這次特別想去嘗試的地方`],
    activity: [`「${name}」是您安排在行程中的一段體驗`, `「${name}」被您加進了這次的戶外／步道行程`, `這次行程中，「${name}」是您特別想安排的活動`],
    shopping: [`「${name}」是您順路想去逛逛的採購點`, `「${name}」被您列進了這趟旅程的購物清單`, `逛街採買方面，「${name}」是您特別留意到的地方`],
    attraction: [`「${name}」是您私房收藏的景點`, `「${name}」被您加進了這趟旅程的必訪名單`, `這次行程中，「${name}」是您特別想造訪的地方`],
    hotel: [`「${name}」是您這晚安排的住宿／休憩地點`, `「${name}」被您排進了這趟旅程的住宿清單`],
    transport: [`「${name}」是您這段行程安排的交通方式`, `「${name}」是您這趟旅程的交通安排之一`],
  };

  const kwSentence = kws.length
    ? (kws.length > 1
        ? `聽說這裡以「${kws.join('、')}」最受喜愛，很值得留意。`
        : `聽說這裡因「${kws[0]}」讓人印象深刻，很值得留意。`)
    : '';

  const closers = {
    food: ['實際營業時間與是否需要訂位，建議出發前再次確認。', '尖峰用餐時段可能需要稍候，建議預留一點彈性時間。', '若人氣較高，建議提早前往或先查詢是否可訂位。'],
    activity: ['出發前建議留意當天天氣與路況，並穿著合適的鞋子。', '建議依體力與時間彈性調整走訪範圍與路線。', '建議事先查詢開放時間與難易度，安排合適的時段前往。'],
    shopping: ['記得留意營業時間，也保留一點伴手禮預算。', '若剛好順路，很適合安排在移動途中稍作停留。', '建議先查一下營業時間，避免撲空。'],
    attraction: ['可依現場狀況彈性安排拍照與停留時間。', '建議留意人潮與光線，安排合適的造訪時段。', '建議事先查詢是否需要預約或有開放時間限制。'],
    hotel: ['記得提前確認入住與退房時間，以及辦理入住的方式。', '建議提前查看周邊生活機能與停車資訊。'],
    transport: ['建議提前確認實際時刻表與轉乘方式。', '建議預留緩衝時間，避免銜接過於緊湊。'],
  };

  const durSentence = dur ? `這裡建議停留${dur}左右。` : '';
  const full = `${pick(openers[catKey] || openers.attraction)}。${kwSentence}${durSentence}${pick(closers[catKey] || closers.attraction)}`;
  const short = `您親自新增的私房${c.label}景點${kws.length ? '，以「'+kws.join('、')+'」最受期待' : ''}。`;
  return {short, full};
}

/* 嘗試連網搜尋景點資料並生成簡介：這個功能只有在 Claude 對話介面「即時建立的 Artifact 畫布」中才能連線；
   本檔案是以可下載的靜態網頁形式提供，不論是在預覽或下載後開啟，通常都無法連上 Anthropic 伺服器，
   會自動改用上面經過強化的離線生成版本，不會中斷操作 */
async function generateAutoDescOnline(name, catKey, keywordsStr, dur){

  const c = CAT[catKey] || CAT.attraction;
  const kws = (keywordsStr||'').trim();
  const searchHint = kws ? `搜尋時請把「${name}」與關鍵字「${kws}」一起考慮，找出跟這些關鍵字最相關的資訊。` : `請直接搜尋「${name}」這個名稱找相關資訊。`;
  const prompt = `請使用網路搜尋工具，查詢京都・奈良・丹後「${name}」這個${c.label}的公開資訊。${searchHint}找到資料後，用繁體中文寫一段約80–120字、適合放進旅遊行程App的景點簡介，語氣自然口語、不要條列式，盡量帶入搜尋到的具體特色（不要只寫「以...聞名」這類空泛說法）。${dur ? '可自然帶入建議停留時間「'+dur+'」，':''}只回傳簡介本文，不要加前言、引號或任何說明文字。若確實搜尋不到這個名稱的公開資訊，才依名稱、分類與關鍵字合理推測寫一段通用但得體的簡介。`;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }]
    })
  });
  if(!resp.ok) throw new Error('API 回應失敗：' + resp.status);
  const data = await resp.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  if(!text) throw new Error('沒有取得簡介文字');
  const short = text.length > 44 ? text.slice(0, 44) + '…' : text;
  return { short, full: text };
}

async function addCustomSpot(dayIdx){
  const nameEl = document.getElementById('newSpotName-'+dayIdx);
  const catEl = document.getElementById('newSpotCat-'+dayIdx);
  const kwEl = document.getElementById('newSpotKw-'+dayIdx);
  const durEl = document.getElementById('newSpotDur-'+dayIdx);
  const btnEl = document.getElementById('addSpotBtn-'+dayIdx);
  const statusEl = document.getElementById('addSpotStatus-'+dayIdx);
  const name = nameEl.value.trim();
  if(!name){ nameEl.focus(); return; }
  const catKey = catEl.value;
  const kw = kwEl.value;
  const dur = durEl.value.trim();

  if(btnEl){ btnEl.disabled = true; btnEl.textContent = '🔍 搜尋景點資料中...'; }
  if(statusEl){ statusEl.textContent = '正在嘗試連網搜尋「'+name+'」的公開資訊，若無法連線將自動改用簡易生成…'; }

  let short, full, genSource;
  try {
    const online = await generateAutoDescOnline(name, catKey, kw, dur);
    short = online.short; full = online.full; genSource = 'online';
  } catch(err) {
    console.warn('連網生成簡介失敗，改用離線生成：', err);
    const offline = generateAutoDesc(name, catKey, kw, dur);
    short = offline.short; full = offline.full; genSource = 'offline';
  }

  const spot = S(name, catKey, short, { fullDesc: full, dur: dur || null, genSource });
  if(!customSpotsStore[dayIdx]) customSpotsStore[dayIdx] = [];
  customSpotsStore[dayIdx].push(spot);
  persistCustomSpots();
  nameEl.value=''; kwEl.value=''; durEl.value='';
  renderDayContent();
  updateSpotCount();
}
function delCustomSpot(dayIdx, i){
  if(!customSpotsStore[dayIdx]) return;
  customSpotsStore[dayIdx].splice(i,1);
  persistCustomSpots();
  renderDayContent();
  updateSpotCount();
}
function toggleEditSpot(idx){
  const el = document.getElementById('spot-edit-'+idx);
  if(el) el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
}
function saveSpotEdit(dayIdx, i, idx){
  if(!customSpotsStore[dayIdx] || !customSpotsStore[dayIdx][i]) return;
  const shortEl = document.getElementById('spot-edit-short-'+idx);
  const fullEl = document.getElementById('spot-edit-full-'+idx);
  const spot = customSpotsStore[dayIdx][i];
  const newShort = shortEl ? shortEl.value.trim() : '';
  const newFull = fullEl ? fullEl.value.trim() : '';
  if(newShort) spot.desc = newShort;
  if(newFull) spot.fullDesc = newFull;
  spot.genSource = 'edited';
  persistCustomSpots();
  renderDayContent();
  updateSpotCount();
}
function updateSpotCount(){
  let total = days.reduce((a,d)=>a+d.spots.length + (d.moreSpots?d.moreSpots.length:0),0);
  Object.values(customSpotsStore).forEach(arr => total += arr.length);
  document.getElementById('spotCount').textContent = total;
}

/* ============ 景點排序 (LocalStorage 永久保存) ============ */
const MAIN_CATS = ['attraction','activity','transport'];
const LIFE_CATS = ['food','shopping','hotel'];
let orderStore = JSON.parse(localStorage.getItem('kyoto_order')) || {};
function persistOrder(){ safeSetItem('kyoto_order', orderStore); }
function getOrderKey(dayIdx, listType){ return dayIdx + '-' + listType; }

function getNaturalList(dayIdx, listType){
  const d = days[dayIdx];
  const customSpots = getCustomSpots(dayIdx);
  const cats = listType === 'main' ? MAIN_CATS : LIFE_CATS;
  const allFixed = d.spots.map((s,i)=>({spot:s, key:`d${dayIdx}-m${i}`}))
    .concat((d.moreSpots||[]).map((s,i)=>({spot:s, key:`d${dayIdx}-s${i}`})));
  const allCustom = customSpots.map((s,i)=>({spot:s, key:`d${dayIdx}-c${i}`, customMeta:{dayIdx, i}}));
  return allFixed.filter(o=>cats.includes(o.spot.cat)).concat(allCustom.filter(o=>cats.includes(o.spot.cat)));
}

function applyOrder(dayIdx, listType, list){
  const okey = getOrderKey(dayIdx, listType);
  const naturalKeys = list.map(o=>o.key);
  let order = orderStore[okey];
  if(!order || !order.length) return list;
  order = order.filter(k=>naturalKeys.includes(k));
  naturalKeys.forEach(k=>{ if(!order.includes(k)) order.push(k); });
  const byKey = {}; list.forEach(o=>byKey[o.key]=o);
  return order.map(k=>byKey[k]).filter(Boolean);
}

function moveSpot(dayIdx, listType, key, dir){
  const natural = getNaturalList(dayIdx, listType);
  const naturalKeys = natural.map(o=>o.key);
  const okey = getOrderKey(dayIdx, listType);
  let order = orderStore[okey];
  if(!order || !order.length) order = naturalKeys.slice();
  else {
    order = order.filter(k=>naturalKeys.includes(k));
    naturalKeys.forEach(k=>{ if(!order.includes(k)) order.push(k); });
  }
  const i = order.indexOf(key);
  const j = i + dir;
  if(i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  orderStore[okey] = order;
  persistOrder();
  renderDayContent();
}

/* ============ 景點內「資訊與評論」區塊排序 (LocalStorage 永久保存) ============ */
let blockOrderStore = JSON.parse(localStorage.getItem('kyoto_block_order')) || {};
function persistBlockOrder(){ safeSetItem('kyoto_block_order', blockOrderStore); }
function moveBlock(spotKey, blockId, dir, hasBadges, hasInfo){
  const naturalIds = [];
  if(hasBadges) naturalIds.push('badges');
  if(hasInfo) naturalIds.push('info');
  naturalIds.push('note');
  let order = blockOrderStore[spotKey];
  if(!order || !order.length) order = naturalIds.slice();
  else {
    order = order.filter(id=>naturalIds.includes(id));
    naturalIds.forEach(id=>{ if(!order.includes(id)) order.push(id); });
  }
  const i = order.indexOf(blockId);
  const j = i + dir;
  if(i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  blockOrderStore[spotKey] = order;
  persistBlockOrder();
  renderDayContent();
}


let routeMapStore = JSON.parse(localStorage.getItem('kyoto_route_maps')) || {};
function persistRouteMaps(){ safeSetItem('kyoto_route_maps', routeMapStore); }
async function handleRouteMapUpload(e, dayIdx){
  const files = Array.from(e.target.files || []); e.target.value='';
  if(!files.length) return;
  if(!routeMapStore[dayIdx]) routeMapStore[dayIdx] = [];
  updateSyncStatus(null,'saving');
  try{
    const urls=[]; for(const f of files) urls.push(await uploadMediaFile(f,`route-maps/day-${dayIdx}`));
    routeMapStore[dayIdx].push(...urls); persistRouteMaps(); renderDayContent();
  }catch(err){ alert('⚠️ '+friendlySyncError(err)+'\n'+String(err.message||err)); updateSyncStatus(err); }
}
function removeRouteMap(dayIdx, i){
  if(!routeMapStore[dayIdx]) return;
  routeMapStore[dayIdx].splice(i, 1);
  persistRouteMaps();
  renderDayContent();
}

/* ============ RENDER: ITINERARY ============ */
const dayScroll = document.getElementById('dayScroll');
const dayContent = document.getElementById('dayContent');
let activeDay = 0;

function mapsLink(name){ return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name + ' Japan'); }

function renderDayChips(){
  dayScroll.innerHTML = days.map((d,i)=>`
    <div class="day-chip ${i===activeDay?'active':''}" data-i="${i}" onclick="setActiveDay(${i})">
      <div class="d">${d.date}</div>
      <div class="m">週${d.weekday}</div>
    </div>`).join('');
}

let activeSubTabStore = {}; /* dayIdx -> 'main' | 'more' | 'routemap'，記住使用者目前停留在哪個子分頁 */

function setActiveDay(i) {
  activeDay = i;
  renderDayChips();
  renderDayContent();
  document.getElementById('view-itinerary').scrollIntoView({behavior:'smooth', block:'start'});
}

/* 保留景點卡片展開狀態，避免背景同步重繪後自動收合。 */
const openSpotCardKeys = new Set();
function rememberOpenSpotCards(){
  document.querySelectorAll('[id^="spot-card-"].open').forEach(card=>{
    openSpotCardKeys.add(card.id.replace('spot-card-',''));
  });
}
function restoreOpenSpotCards(){
  openSpotCardKeys.forEach(key=>{
    const card=document.getElementById('spot-card-'+key);
    if(card) card.classList.add('open');
  });
}
function toggleSpotDetails(key) {
  const card = document.getElementById('spot-card-'+key);
  if(!card) return;
  const willOpen=!card.classList.contains('open');
  card.classList.toggle('open', willOpen);
  if(willOpen) openSpotCardKeys.add(String(key));
  else openSpotCardKeys.delete(String(key));
}

function spotCardHTML(spot, key, isMainSpot, customMeta, orderInfo){
  const idx = key;
  const c = CAT[spot.cat];
  const badges = [];
  if(spot.tags){
    spot.tags.forEach(t=>{
      if(t==='必吃') badges.push('<span class="badge b-eat">🍴 必吃</span>');
      if(t==='必買') badges.push('<span class="badge b-buy">🎁 必買</span>');
      if(t==='必拍') badges.push('<span class="badge b-photo">📸 必拍</span>');
    });
  }
  
  const infoBits = [];
  if(spot.dur) infoBits.push(`<div class="info-item"><div class="k">建議停留</div><div class="v">${spot.dur}</div></div>`);
  if(spot.hours) infoBits.push(`<div class="info-item"><div class="k">營業/開放時間</div><div class="v" style="color:#2f8a52;">${spot.hours}</div></div>`);
  if(spot.note) infoBits.push(`<div class="info-item" style="grid-column: 1 / -1;"><div class="k">重要提點 / 門票</div><div class="v" style="font-weight:500; font-size:11.5px; color:#c1502f;">${spot.note}</div></div>`);
  
  const userPhotos = photoStore[idx] || [];
  let thumbImgs = userPhotos.length > 0 ? userPhotos : (spot.img ? [spot.img] : []);
  const thumbImgsAreUserPhotos = userPhotos.length > 0;

  /* 封面：預設優先使用原本配圖（不會被新上傳的照片自動蓋掉），
     使用者可在照片區點「設為封面」自行指定要用哪一張（含步道地圖、菜單翻譯等也不會被誤認成封面） */
  const coverSel = coverStore[idx];
  let bg;
  if (coverSel === 'original' && spot.img) bg = spot.img;
  else if (typeof coverSel === 'number' && userPhotos[coverSel]) bg = userPhotos[coverSel];
  else bg = spot.img || userPhotos[0] || 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Lake_Hawea_New_Zealand.jpg/640px-Lake_Hawea_New_Zealand.jpg';

  /* 使用者新增的資訊：可新增多筆，各自獨立刪除，不會互相覆蓋 */
  let userNotes = notesStore[idx] || [];
  let notesListHTML = userNotes.length ? userNotes.map((n,ni)=>`<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-top:6px; padding-top:6px; border-top:1px dashed rgba(0,0,0,0.12);"><span style="flex:1; white-space:pre-line;">${n}</span><button onclick="event.stopPropagation(); deleteNote('${idx}', ${ni})" style="background:none; border:none; color:#c1502f; cursor:pointer; font-size:11px; flex:none; padding:0 0 0 4px;">✕</button></div>`).join('') : '';
  let displayInfo = '';
  if (spot.customInfo) displayInfo += spot.customInfo;
  if (notesListHTML) displayInfo += `<div style="margin-top:${spot.customInfo ? '8px' : '0'};"><span style="color:#7A5A42; font-weight:700; font-size:11px;">✏️ 您新增的資訊：</span>${notesListHTML}</div>`;

  let customInfoBox = '';
  if (displayInfo) {
    customInfoBox = `<div class="custom-info-box" onclick="event.stopPropagation()"><b>💡 資訊與筆記：</b><br>${displayInfo}<button onclick="toggleEditNote(event, '${idx}')" style="position:absolute; top:8px; right:8px; background:none; border:none; cursor:pointer; font-size:12px; opacity:0.6;">➕ 新增</button></div>`;
  }

  let noteEditArea = `<div class="note-edit-area" style="margin-top:10px; display:none;" id="edit-note-${idx}" onclick="event.stopPropagation()"><textarea id="note-input-${idx}" placeholder="新增一筆攻略、必點菜單或提醒...（可重複新增多筆）" style="width:100%; border:1px solid var(--line); border-radius:8px; padding:8px; font-size:12px; font-family:inherit; resize:vertical; min-height:60px; outline:none; margin-bottom:6px;"></textarea><div style="display:flex; gap:6px;"><button onclick="addNote('${idx}')" style="padding:6px 14px; font-size:11px; background:var(--blue); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:700;">💾 新增這筆</button><button onclick="toggleEditNote(event, '${idx}')" style="padding:6px 14px; font-size:11px; background:#f2f3ec; color:var(--ink); border:none; border-radius:6px; cursor:pointer; font-weight:700;">收合</button></div></div>${!displayInfo ? `<button class="btn-note-toggle" onclick="toggleEditNote(event, '${idx}')" style="background:transparent; border:1px dashed #c1c8cf; border-radius:999px; padding:6px 12px; font-size:11.5px; color:#7A5A42; cursor:pointer; font-family:inherit; margin-top:6px; margin-bottom:10px;" id="btn-note-${idx}">➕ 添加評論或資訊</button>` : ''}`;

  let miniStripHTML = thumbImgs.length > 0 ? `<div class="mini-photo-strip" onclick="event.stopPropagation();">` + thumbImgs.map((u, i) => `<div style="position:relative; display:inline-block;"><img src="${u}" onclick="openAttachModal('${u}')">${thumbImgsAreUserPhotos ? `<button onclick="removePhoto(event, '${idx}', ${i})" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.5); color:#fff; border:none; border-radius:50%; width:16px; height:16px; font-size:8px; cursor:pointer;">✕</button>` : ''}</div>`).join('') + `</div>` : '';

  /* 照片區：主要亮點卡片會列出「原始配圖 + 所有使用者上傳的照片」，並可個別指定作為封面；
     次要（食衣住）景點沒有封面概念，維持原本只顯示使用者照片的邏輯 */
  let pStrip = '';
  if (isMainSpot) {
    const galleryEntries = [];
    if (spot.img) galleryEntries.push({url: spot.img, sel: 'original'});
    userPhotos.forEach((u, i) => galleryEntries.push({url: u, sel: i}));
    if (galleryEntries.length) {
      pStrip = `<div class="photo-strip" onclick="event.stopPropagation()">` + galleryEntries.map(g => {
        const isCover = g.url === bg;
        const selArg = (typeof g.sel === 'string') ? `'${g.sel}'` : g.sel;
        const coverTag = isCover
          ? `<span style="position:absolute; bottom:3px; left:3px; right:3px; background:var(--blue); color:#fff; font-size:8.5px; font-weight:700; padding:2px 3px; border-radius:5px; text-align:center; line-height:1.3;">★ 封面</span>`
          : `<button onclick="event.stopPropagation(); setCoverPhoto('${idx}', ${selArg})" style="position:absolute; bottom:3px; left:3px; right:3px; background:rgba(0,0,0,.6); color:#fff; border:none; font-size:8.5px; font-weight:700; padding:2px 3px; border-radius:5px; cursor:pointer; line-height:1.3;">設為封面</button>`;
        const removeBtn = (g.sel !== 'original')
          ? `<button onclick="removePhoto(event, '${idx}', ${g.sel})" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.5); color:#fff; border:none; border-radius:50%; width:20px; height:20px; font-size:10px; cursor:pointer;">✕</button>`
          : '';
        return `<div class="photo-item-wrap"><img src="${g.url}" onclick="openAttachModal('${g.url}')">${removeBtn}${coverTag}</div>`;
      }).join('') + `</div>`;
    }
  } else {
    pStrip = (userPhotos.length) ? `<div class="photo-strip" onclick="event.stopPropagation()">` + userPhotos.map((u, i)=>`<div class="photo-item-wrap"><img src="${u}" onclick="openAttachModal('${u}')"><button onclick="removePhoto(event, '${idx}', ${i})" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.5); color:#fff; border:none; border-radius:50%; width:20px; height:20px; font-size:10px; cursor:pointer;">✕</button></div>`).join('') + `</div>` : '';
  }

  const badgesHTML = badges.length ? `<div class="badges" style="margin-bottom:6px;">${badges.join('')}</div>` : '';
  const infoHTML = infoBits.length ? `<div class="info-grid">${infoBits.join('')}</div>` : '';
  const noteHTML = `${customInfoBox}${noteEditArea}`;
  const blockDefs = [];
  if(badgesHTML) blockDefs.push({id:'badges', html: badgesHTML});
  if(infoHTML) blockDefs.push({id:'info', html: infoHTML});
  blockDefs.push({id:'note', html: noteHTML});
  const naturalBlockIds = blockDefs.map(b=>b.id);
  let blockOrder = blockOrderStore[idx];
  if(blockOrder && blockOrder.length){
    blockOrder = blockOrder.filter(id=>naturalBlockIds.includes(id));
    naturalBlockIds.forEach(id=>{ if(!blockOrder.includes(id)) blockOrder.push(id); });
  } else {
    blockOrder = naturalBlockIds.slice();
  }
  const byBlockId = {}; blockDefs.forEach(b=>byBlockId[b.id]=b);
  const orderedBlocks = blockOrder.map(id=>byBlockId[id]).filter(Boolean);
  const hasBadgesFlag = badgesHTML ? 'true' : 'false';
  const hasInfoFlag = infoHTML ? 'true' : 'false';
  const reorderableBlocksHTML = orderedBlocks.map((b,pos)=>{
    const upBtn = pos > 0 ? `<button onclick="event.stopPropagation(); moveBlock('${idx}','${b.id}',-1,${hasBadgesFlag},${hasInfoFlag})" style="background:#eef1e6; border:none; cursor:pointer; font-size:10px; color:#9aa3ad; padding:2px 6px; border-radius:5px;">⬆</button>` : '';
    const downBtn = pos < orderedBlocks.length - 1 ? `<button onclick="event.stopPropagation(); moveBlock('${idx}','${b.id}',1,${hasBadgesFlag},${hasInfoFlag})" style="background:#eef1e6; border:none; cursor:pointer; font-size:10px; color:#9aa3ad; padding:2px 6px; border-radius:5px;">⬇</button>` : '';
    return (orderedBlocks.length > 1 ? `<div style="display:flex; justify-content:flex-end; gap:4px; margin:2px 0;">${upBtn}${downBtn}</div>` : '') + b.html;
  }).join('');

  const genLabel = spot.genSource === 'edited' ? '✏️ 簡介已由您編輯' : (spot.genSource === 'online' ? '🔍 簡介已透過網路搜尋生成' : (spot.genSource === 'offline' ? '📝 簡介為簡易生成（未連上網路）' : '🆕 自訂景點'));
  const orderBtns = orderInfo ? `<button onclick="event.stopPropagation(); moveSpot(${orderInfo.dayIdx}, '${orderInfo.listType}', '${idx}', -1)" style="background:#eef1e6; color:var(--ink-soft); border:none; padding:4px 9px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;">⬆ 上移</button><button onclick="event.stopPropagation(); moveSpot(${orderInfo.dayIdx}, '${orderInfo.listType}', '${idx}', 1)" style="background:#eef1e6; color:var(--ink-soft); border:none; padding:4px 9px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;">⬇ 下移</button>` : '';
  const delBtn = customMeta ? `<button onclick="event.stopPropagation(); delCustomSpot(${customMeta.dayIdx}, ${customMeta.i})" style="background:#fff0ec; color:#c1502f; border:none; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap;">🗑️ 刪除此景點</button>` : '';
  const editBtn = customMeta ? `<button onclick="event.stopPropagation(); toggleEditSpot('${idx}')" style="background:#eef3fb; color:var(--blue); border:none; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap;">✏️ 編輯簡介</button>` : '';
  const customBar = (customMeta || orderInfo) ? `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;"><span style="display:flex; gap:6px; flex-wrap:wrap;">${customMeta ? `<span class="badge" style="background:#eef3fb; color:var(--blue);">${genLabel}</span>` : ''}</span><span style="display:flex; gap:6px; flex-wrap:wrap;">${orderBtns}${editBtn}${delBtn}</span></div>` : '';
  const editSpotAreaHTML = customMeta ? `<div id="spot-edit-${idx}" style="display:none; margin-bottom:10px; background:#f7f9fc; border:1px dashed #c7d6ea; border-radius:8px; padding:10px;" onclick="event.stopPropagation()">
      <div style="font-size:11px; font-weight:700; color:var(--ink-soft); margin-bottom:4px;">簡短介紹（列表中顯示）</div>
      <textarea id="spot-edit-short-${idx}" style="width:100%; border:1px solid var(--line); border-radius:6px; padding:6px; font-size:12px; font-family:inherit; resize:vertical; min-height:40px; outline:none; margin-bottom:8px; box-sizing:border-box;">${(spot.desc||'').replace(/</g,'&lt;')}</textarea>
      <div style="font-size:11px; font-weight:700; color:var(--ink-soft); margin-bottom:4px;">完整簡介（展開後顯示）</div>
      <textarea id="spot-edit-full-${idx}" style="width:100%; border:1px solid var(--line); border-radius:6px; padding:6px; font-size:12px; font-family:inherit; resize:vertical; min-height:80px; outline:none; margin-bottom:8px; box-sizing:border-box;">${(spot.fullDesc||spot.desc||'').replace(/</g,'&lt;')}</textarea>
      <div style="display:flex; gap:6px;">
        <button onclick="saveSpotEdit(${customMeta.dayIdx}, ${customMeta.i}, '${idx}')" style="padding:6px 14px; font-size:11px; background:var(--blue); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:700;">💾 儲存</button>
        <button onclick="toggleEditSpot('${idx}')" style="padding:6px 14px; font-size:11px; background:#f2f3ec; color:var(--ink); border:none; border-radius:6px; cursor:pointer; font-weight:700;">取消</button>
      </div>
    </div>` : '';

  if (!isMainSpot) {
    return `<div class="sub-spot-card sub-spot-${spot.cat || 'other'}" id="spot-card-${idx}"><div class="sub-spot-header" onclick="toggleSpotDetails('${idx}')"><div class="sub-spot-header-content"><h4>${spot.name}</h4><p class="short-desc">${spot.desc}</p>${miniStripHTML}</div><div class="chevron">▼</div></div><div class="sub-spot-details-wrap"><div class="sub-spot-details" onclick="event.stopPropagation()">${customBar}${editSpotAreaHTML}<p class="full-desc">${spot.fullDesc || spot.desc}</p>${spot.recDishes ? `<div class="dish-tag">🍲 必點推薦：${spot.recDishes}</div>` : ''}${reorderableBlocksHTML}<div class="action-row" style="margin-top:10px;"><a class="btn btn-map" href="${mapsLink(spot.name)}" target="_blank" rel="noopener">🗺️ 導航</a>${spot.link ? `<a class="btn btn-photo" href="${spot.link}" target="_blank" rel="noopener">🔗 ${spot.linkLabel}</a>` : ''}<button class="btn btn-photo" onclick="document.getElementById('file-${idx}').click()">📷 上傳照片</button></div><input type="file" accept="image/*" id="file-${idx}" style="display:none" multiple onchange="handlePhoto(event, '${idx}')">${pStrip}</div></div></div>`;
  }

  return `<div class="guide-card" id="spot-card-${idx}"><div class="guide-header" style="background-image:url('${bg}');" onclick="toggleSpotDetails('${idx}')">${photoStore[idx] && photoStore[idx].length > 0 ? `<span class="own-badge" onclick="event.stopPropagation(); document.getElementById('file-${idx}').click()">✅ 已有你的實拍照片</span>` : `<button class="own-badge" style="border:none; cursor:pointer;" onclick="event.stopPropagation(); document.getElementById('file-${idx}').click()">📷 新增我的照片</button>`}<div class="guide-header-content"><span class="cat-label ${c.cls}">${c.emoji} ${c.label}</span><h3>${spot.name}</h3><p class="short-desc">${spot.desc}</p></div><div class="chevron">▼</div></div><div class="guide-details-wrap"><div class="guide-details" onclick="event.stopPropagation()">${customBar}${editSpotAreaHTML}<p class="full-desc">${spot.fullDesc || spot.desc}</p>${reorderableBlocksHTML}${spot.tip?`<div class="tip-box"><b>📸 拍照與自駕小解密：</b>${spot.tip}</div>`:''}${spot.docMap?`<div class="tip-box" style="background: linear-gradient(120deg,#e8f8ee,#fff); border-color:#D0F4FC; color:#22513f;"><b>🗺️ DOC 官方步道地圖與狀態：</b><a href="${spot.docMap}" target="_blank" rel="noopener" style="color:var(--blue); font-weight:700; text-decoration:underline;">點此開啟</a></div>`:''}${spot.park?`<div class="park-box"><b>🅿️ 停車＆自駕補給：</b>${spot.park}</div>`:''}<div class="action-row" style="margin-top:10px;"><a class="btn btn-map" href="${mapsLink(spot.name)}" target="_blank" rel="noopener">🗺️ 導航導出</a>${spot.link ? `<a class="btn btn-photo" href="${spot.link}" target="_blank" rel="noopener">🔗 ${spot.linkLabel}</a>` : ''}<button class="btn btn-photo" onclick="document.getElementById('file-${idx}').click()">📷 上傳照片</button></div><input type="file" accept="image/*" id="file-${idx}" style="display:none" multiple onchange="handlePhoto(event, '${idx}')">${pStrip}</div></div></div>`;
}

/* 讀取檔案並自動壓縮：長邊限制在 1600px、轉存為 JPEG(品質0.82)，
   一般手機相片可從 3-8MB 壓到數百KB，大幅降低 localStorage 塞滿導致上傳失敗的機率。
   若圖片無法被瀏覽器解碼（極少數情況），則退回存原始檔案。 */
function fileToDataURL(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = () => {
      const rawDataUrl = reader.result;
      const img = new Image();
      img.onload = () => {
        try {
          const MAX_DIM = 1600;
          let w = img.naturalWidth, h = img.naturalHeight;
          if (w > MAX_DIM || h > MAX_DIM) {
            if (w > h) { h = Math.round(h * MAX_DIM / w); w = MAX_DIM; }
            else { w = Math.round(w * MAX_DIM / h); h = MAX_DIM; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch(err) {
          resolve(rawDataUrl);
        }
      };
      img.onerror = () => resolve(rawDataUrl);
      img.src = rawDataUrl;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function handlePhoto(e, idx){
  const files = Array.from(e.target.files || []); e.target.value='';
  if(!files.length) return;
  if(!photoStore[idx]) photoStore[idx] = [];
  updateSyncStatus(null,'saving');
  try{
    const urls=[]; for(const f of files) urls.push(await uploadMediaFile(f,`spot-photos/${idx.replace(/[^a-zA-Z0-9_-]/g,'_')}`));
    photoStore[idx].push(...urls); persistPhotos(); renderDayContent();
    setTimeout(()=>{ const card=document.getElementById('spot-card-'+idx); if(card) card.classList.add('open'); },50);
  }catch(err){ alert('⚠️ '+friendlySyncError(err)+'\n'+String(err.message||err)); updateSyncStatus(err); }
}
function removePhoto(e, idx, photoIdx) {
  e.stopPropagation();
  photoStore[idx].splice(photoIdx, 1);
  const sel = coverStore[idx];
  if (typeof sel === 'number') {
    if (sel === photoIdx) delete coverStore[idx];
    else if (sel > photoIdx) coverStore[idx] = sel - 1;
    persistCover();
  }
  persistPhotos();
  renderDayContent();
  setTimeout(()=>{ const card = document.getElementById('spot-card-'+idx); if(card) card.classList.add('open'); }, 50);
}

function openAttachModal(src) {
  document.getElementById('attachModalImg').src = src;
  document.getElementById('attachModal').classList.add('active');
}
function closeAttachModal() { document.getElementById('attachModal').classList.remove('active'); }

function switchSubTab(dayIdx, tabType) {
  activeSubTabStore[dayIdx] = tabType;
  const container = document.getElementById(`day-card-${dayIdx}`);
  if (!container) return;
  container.querySelectorAll('.spot-subtab').forEach(btn => btn.classList.toggle('active', btn.dataset.type === tabType));
  container.querySelectorAll('.subtab-content').forEach(content => content.classList.toggle('active', content.dataset.type === tabType));
}

const FUEL_BRANDS = ['NPD','Waitomo','Gull','Z','BP','Mobil','Caltex','Challenge'];
function fuelPricePanel(day){
  if(!day.gas) return '';
  return `<div class="fuel-price-panel"><div class="fuel-price-head"><span>${day.gas}</span><a href="https://www.google.com/maps/search/gas+station+Kyoto+Japan" target="_blank" rel="noopener">🚗 查看沿途加油站</a></div><div class="fuel-brand-row">${[].map(b=>`<a href="https://www.google.com/maps/search/${encodeURIComponent(b+' petrol station New Zealand')}" target="_blank" rel="noopener">${b}</a>`).join('')}</div><small>逐站即時價格由 Gaspy 社群更新；品牌按鈕可快速搜尋沿途分店。</small></div>`;
}

function renderDayContent(){
  rememberOpenSpotCards();
  const previousScrollY = window.scrollY;
  const d = days[activeDay];
  const curSubTab = activeSubTabStore[activeDay] || 'main';

  const mainList = applyOrder(activeDay, 'main', getNaturalList(activeDay, 'main'));
  const lifeList = applyOrder(activeDay, 'life', getNaturalList(activeDay, 'life'));

  let mainSpotsHTML = mainList.map(o=>spotCardHTML(o.spot, o.key, true, o.customMeta, {dayIdx:activeDay, listType:'main'})).join('');
  if(!mainSpotsHTML) mainSpotsHTML = '<div class="empty">此區域今天暫無排定主要亮點。</div>';

  let secondaryCardsHTML = lifeList.map(o=>spotCardHTML(o.spot, o.key, false, o.customMeta, {dayIdx:activeDay, listType:'life'})).join('');
  if(!secondaryCardsHTML) secondaryCardsHTML = '<div class="empty">此區域今天暫無排定食衣住項目，歡迎在下方新增您的私房景點。</div>';

  const addSpotFormHTML = `
    <div class="section-card" style="margin-top:4px;">
      <h3 style="margin:0 0 10px;">✨ 新增我的私房景點</h3>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <input type="text" id="newSpotName-${activeDay}" placeholder="景點名稱（必填）" style="padding:10px 12px; border:1px solid var(--line); border-radius:8px; font-family:inherit; font-size:13px;">
        <select id="newSpotCat-${activeDay}" style="padding:10px 12px; border:1px solid var(--line); border-radius:8px; font-family:inherit; font-size:13px;">
          ${Object.keys(CAT).map(k=>`<option value="${k}">${CAT[k].emoji} ${CAT[k].label}</option>`).join('')}
        </select>
        <input type="text" id="newSpotKw-${activeDay}" placeholder="關鍵字，如：夜景、羊駝、手作巧克力（可留空）" style="padding:10px 12px; border:1px solid var(--line); border-radius:8px; font-family:inherit; font-size:13px;">
        <input type="text" id="newSpotDur-${activeDay}" placeholder="建議停留時間，如：約1小時（可留空）" style="padding:10px 12px; border:1px solid var(--line); border-radius:8px; font-family:inherit; font-size:13px;">
        <button id="addSpotBtn-${activeDay}" onclick="addCustomSpot(${activeDay})" style="background:linear-gradient(135deg, var(--blue), #FC7D2E); color:#fff; border:none; padding:11px; border-radius:999px; font-family:inherit; font-size:13px; font-weight:700; cursor:pointer;">＋ 新增並自動生成簡介</button>
      </div>
      <div style="font-size:11px; color:var(--ink-soft); margin-top:8px; line-height:1.5;" id="addSpotStatus-${activeDay}">新增後會依景點名稱與關鍵字自動組出一段簡介（句型會隨機變化），並嘗試連網搜尋補充更具體的資訊——但這個檔案是可下載的靜態網頁，連網搜尋通常無法成功，實際上多半會使用自動組成的版本。之後仍可在景點卡片中補充您的個人筆記。</div>
    </div>`;

  const routeMaps = routeMapStore[activeDay] || [];
  const routeMapGalleryHTML = routeMaps.length ? `<div class="route-map-gallery">${routeMaps.map((u,i)=>`<div class="route-map-item"><img src="${u}" onclick="openAttachModal('${u}')" alt="Day ${d.dayNum} 路線圖"><button class="route-map-remove" onclick="removeRouteMap(${activeDay}, ${i})">✕</button></div>`).join('')}</div>` : '<div class="empty">尚未上傳今天的行動路線圖。</div>';
  const routeMapHTML = `
    <div class="section-card" style="margin-top:4px;">
      <h3 style="margin:0 0 10px;">🗺️ 我的當日行動路線圖</h3>
      ${routeMapGalleryHTML}
      <button onclick="document.getElementById('routeMapFile-${activeDay}').click()" style="background:linear-gradient(135deg, var(--blue), #FC7D2E); color:#fff; border:none; padding:11px 16px; border-radius:999px; font-family:inherit; font-size:13px; font-weight:700; cursor:pointer;">📷 上傳路線圖</button>
      <input type="file" accept="image/*" id="routeMapFile-${activeDay}" style="display:none" multiple onchange="handleRouteMapUpload(event, ${activeDay})">
      <div style="font-size:11px; color:var(--ink-soft); margin-top:8px; line-height:1.5;">可上傳您自己規劃或手繪的當日路線圖／導航截圖，會保存在此裝置的瀏覽器中，重新整理或關閉頁面都不會消失。</div>
    </div>`;

  dayContent.innerHTML = `
    <div class="day-card-head">
      <div class="region">【Day ${d.dayNum}｜${d.date}】<br>${d.region}</div>
      ${d.drive ? `<div class="drive-info">${d.drive}</div>` : ''}
      ${d.gas ? `<div class="gas-info">${d.gas}</div>` : ''}
      <h2>${d.title}</h2>
      ${d.dayDesc ? `<div class="day-desc-box">${d.dayDesc}</div>` : ''}
      <div class="weather-strip"><div class="ico">${d.weatherIco}</div><div class="txt"><b style="font-family:'Zen Kaku Gothic New', sans-serif; font-size:14px;">${d.enRegion}</b><br><span style="font-size:11.5px; opacity:0.85;">${d.wear}</span></div></div>
      <div class="stay-line">🏡 ${d.spots.filter(s=>s.cat==='hotel').map(s=>s.name).join('、') || '—'}</div>
    </div>
    <div id="day-card-${activeDay}">
      <div class="spot-subtabs"><button class="spot-subtab${curSubTab==='main'?' active':''}" data-type="main" onclick="switchSubTab(${activeDay}, 'main')">📌 主要亮點 (${mainList.length})</button><button class="spot-subtab${curSubTab==='more'?' active':''}" data-type="more" onclick="switchSubTab(${activeDay}, 'more')">🍴 食衣住 (${lifeList.length})</button><button class="spot-subtab${curSubTab==='routemap'?' active':''}" data-type="routemap" onclick="switchSubTab(${activeDay}, 'routemap')">🗺️ 路線圖${routeMaps.length ? ` (${routeMaps.length})` : ''}</button></div>
      <div class="subtab-content${curSubTab==='main'?' active':''}" data-type="main">${mainSpotsHTML}</div>
      <div class="subtab-content${curSubTab==='more'?' active':''}" data-type="more" style="background:#f4f6f0; border-radius:0 0 var(--r-lg) var(--r-lg); padding:16px 12px 16px; margin-bottom:16px;">${secondaryCardsHTML}${addSpotFormHTML}</div>
      <div class="subtab-content${curSubTab==='routemap'?' active':''}" data-type="routemap" style="background:#f4f6f0; border-radius:0 0 var(--r-lg) var(--r-lg); padding:16px 12px 16px; margin-bottom:16px;">${routeMapHTML}</div>
    </div>
  `;
  restoreOpenSpotCards();
  /* 背景同步重繪時維持目前閱讀位置，避免畫面突然跳到其他地方。 */
  if(Math.abs(window.scrollY-previousScrollY)>2){
    requestAnimationFrame(()=>window.scrollTo({top:previousScrollY, behavior:'auto'}));
  }
}

/* ============ RENDER: ENHANCED LIVE WEATHER & OUTFIT ============ */
const CITIES = {
  'Kyoto': {lat:35.0116, lon:135.7681, label:'京都'},
  'Ohara': {lat:35.1190, lon:135.8270, label:'大原／三千院'},
  'Nara': {lat:34.6851, lon:135.8048, label:'奈良'},
  'Kameoka': {lat:35.0134, lon:135.5736, label:'龜岡／嵐山'},
  'Kyotango': {lat:35.6244, lon:135.0610, label:'京丹後'},
  'Amanohashidate': {lat:35.5704, lon:135.1910, label:'天橋立'},
  'Maizuru': {lat:35.4748, lon:135.3859, label:'舞鶴'},
};
const WMO = {
  0:['☀️','晴朗'],1:['🌤️','大致晴朗'],2:['⛅','局部多雲'],3:['☁️','多雲'],
  45:['🌫️','有霧'],48:['🌫️','霧淞'],
  51:['🌦️','毛毛雨'],53:['🌦️','毛毛雨'],55:['🌦️','強毛毛雨'],
  61:['🌧️','小雨'],63:['🌧️','中雨'],65:['🌧️','大雨'],
  71:['🌨️','小雪'],73:['🌨️','中雪'],75:['❄️','大雪'],
  80:['🌦️','陣雨'],81:['🌧️','強陣雨'],82:['⛈️','劇烈陣雨'],
  95:['⛈️','雷雨'],96:['⛈️','雷雨挾冰雹'],99:['⛈️','強雷雨挾冰雹'],
};
function wmoInfo(code){ return WMO[code] || ['🌡️','—']; }

function getDynamicTip(temp, code) {
  let tip = "";
  if(temp < 10) tip += "🌡️ 氣溫較低，建議穿著保暖防風衣物。";
  else if(temp > 20) tip += "🌡️ 氣溫舒適，可洋蔥式穿搭。";
  else tip += "🌡️ 氣溫涼爽，建議攜帶薄外套。";
  
  if([51,53,55,61,63,65,80,81,82,95,96,99].includes(code)) tip += " ☔ 有降雨機率，請務必攜帶雨具！";
  if([0,1,2].includes(code)) tip += " 🕶️ 紫外線較強，請注意防曬與配戴墨鏡。";
  if([71,73,75].includes(code)) tip += " ❄️ 降雪機率高，請注意保暖與行車安全！";
  return tip;
}

function getUVStars(uv) {
  if(!uv) return '未知';
  if(uv <= 2) return '★☆☆☆☆ (低)';
  if(uv <= 5) return '★★☆☆☆ (中)';
  if(uv <= 7) return '★★★☆☆ (高)';
  if(uv <= 10) return '★★★★☆ (甚高)';
  return '★★★★★ (極高)';
}

let liveWeatherCache = {};

/* ---- 天氣離線快取 (localStorage) ---- */
const WEATHER_CACHE_KEY = 'kyoto_weather_cache_v1';
function loadWeatherCache(){
  try{ return JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY)) || {}; }catch(e){ return {}; }
}
function saveWeatherCacheEntry(k, entry){
  try{
    const cache = loadWeatherCache();
    cache[k] = entry;
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(cache));
  }catch(e){ /* storage full or unavailable, ignore */ }
}

async function fetchWeatherFor(k, attempt){
  const {lat, lon} = CITIES[k];
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 9000);
  try{
    if(!navigator.onLine) throw new Error('OFFLINE');
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,precipitation,weather_code&daily=sunrise,sunset,uv_index_max&timezone=Asia%2FTokyo`, { signal: controller.signal });
    clearTimeout(timeout);
    if(!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    liveWeatherCache[k] = { data, error:null, stale:false, fetchedAt: Date.now() };
    saveWeatherCacheEntry(k, liveWeatherCache[k]);
  }catch(err){
    clearTimeout(timeout);
    if(!attempt && navigator.onLine){
      await new Promise(r=>setTimeout(r, 1200));
      return fetchWeatherFor(k, 1);
    }
    const cached = loadWeatherCache()[k];
    if(cached && cached.data){
      liveWeatherCache[k] = { data: cached.data, error:null, stale:true, fetchedAt: cached.fetchedAt };
    } else {
      liveWeatherCache[k] = { data:null, error: (err && err.name === 'AbortError') ? '連線逾時' : (err && err.message === 'OFFLINE' ? '目前離線' : '連線失敗') };
    }
  }
  renderOneLiveCity(k);
}

function renderWeatherFromCache(){
  const wrap = document.getElementById('liveWeatherList');
  if(!wrap) return;
  const cache = loadWeatherCache();
  const hasAny = Object.keys(CITIES).some(k=>cache[k] && cache[k].data);
  wrap.innerHTML = Object.keys(CITIES).map(k=>`<div class="weather-day" id="live-${k}"><div class="date" style="width:auto; text-align:left;"><b style="font-size:12.5px;">${CITIES[k].label}</b></div><div class="mid"><div class="out">讀取中...</div></div></div>`).join('');
  Object.keys(CITIES).forEach(k=>{
    if(cache[k] && cache[k].data){
      liveWeatherCache[k] = { data: cache[k].data, error:null, stale:true, fetchedAt: cache[k].fetchedAt };
      renderOneLiveCity(k);
    }
  });
  const timeEl = document.getElementById('liveWeatherTime');
  if(timeEl && hasAny){
    const times = Object.keys(CITIES).map(k=>cache[k] && cache[k].fetchedAt).filter(Boolean);
    const latest = times.length ? new Date(Math.max(...times)).toLocaleString('zh-TW', {hour12:false}) : '—';
    timeEl.textContent = navigator.onLine
      ? `顯示上次快取資料（更新於 ${latest}），正在取得最新資訊...`
      : `⚠️ 目前離線，顯示上次快取資料（更新於 ${latest}）`;
  }
  return hasAny;
}

async function loadLiveWeather(){
  const wrap = document.getElementById('liveWeatherList');
  if(!wrap) return;
  const timeEl = document.getElementById('liveWeatherTime');

  if(!navigator.onLine){
    const hasAny = renderWeatherFromCache();
    if(!hasAny && timeEl) timeEl.textContent = '⚠️ 目前離線，且尚無快取資料可顯示，請連上網路後再試一次。';
    return;
  }

  wrap.innerHTML = Object.keys(CITIES).map(k=>`<div class="weather-day" id="live-${k}"><div class="date" style="width:auto; text-align:left;"><b style="font-size:12.5px;">${CITIES[k].label}</b></div><div class="mid"><div class="out">讀取中...</div></div></div>`).join('');
  if(timeEl) timeEl.textContent = '即時資料抓取中...';

  await Promise.all(Object.keys(CITIES).map(k=>fetchWeatherFor(k, 0)));

  const failCount = Object.values(liveWeatherCache).filter(v=>v && v.error).length;
  const staleCount = Object.values(liveWeatherCache).filter(v=>v && v.stale).length;
  if(timeEl){
    if(staleCount && staleCount === Object.keys(CITIES).length){
      const times = Object.values(liveWeatherCache).map(v=>v.fetchedAt).filter(Boolean);
      timeEl.textContent = `⚠️ 目前離線，顯示快取資料（更新於 ${times.length?new Date(Math.max(...times)).toLocaleString('zh-TW',{hour12:false}):'—'}）`;
    } else if(failCount){
      timeEl.textContent = `即時資料更新於：${new Date().toLocaleString('zh-TW', {hour12:false})}（${failCount} 個地點連線失敗，可點擊下方「重新整理」再試一次）`;
    } else {
      timeEl.textContent = '即時資料更新於：' + new Date().toLocaleString('zh-TW', {hour12:false});
    }
  }
}

function renderOneLiveCity(k){
  const el = document.getElementById('live-'+k);
  if(!el) return;
  const entry = liveWeatherCache[k];
  const data = entry && entry.data;
  if(!data || !data.current){
    const reason = (entry && entry.error) ? entry.error : '暫時無法取得氣象資料';
    el.innerHTML = `<div class="mid" style="display:flex; align-items:center; justify-content:space-between; width:100%;"><div class="out">${CITIES[k].label}：${reason}</div><button onclick="fetchWeatherFor('${k}', 0)" style="background:#f2f3ec; border:none; color:var(--ink-soft); padding:4px 10px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer;">🔄 重試</button></div>`;
    return;
  }
  
  const cw = data.current;
  const [ico, desc] = wmoInfo(cw.weather_code);
  const temp = Math.round(cw.temperature_2m);
  const wind = cw.wind_speed_10m;
  const precip = cw.precipitation;
  const sr = data.daily && data.daily.sunrise ? data.daily.sunrise[0].substring(11, 16) : '--:--';
  const ss = data.daily && data.daily.sunset ? data.daily.sunset[0].substring(11, 16) : '--:--';
  const uv = data.daily && data.daily.uv_index_max ? getUVStars(data.daily.uv_index_max[0]) : '未知';
  const tip = getDynamicTip(temp, cw.weather_code);
  const badgeHtml = entry.stale
    ? `<span class="live-badge stale"><span class="dot"></span>快取${entry.fetchedAt ? '・' + new Date(entry.fetchedAt).toLocaleString('zh-TW',{hour12:false, month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : ''}</span>`
    : `<span class="live-badge"><span class="dot"></span>即時</span>`;
  
  const MW_TIMES = { Kyoto:'紅葉夜間參拜依公告', Ohara:'日落前離開山區', Nara:'清晨散步佳', Kameoka:'漂流依營運', Kyotango:'海風留意', Amanohashidate:'展望台依營運', Maizuru:'上午能見度佳' };
  
  el.innerHTML = `
    <div style="display:flex; flex-direction:column; width:100%;">
      <div style="display:flex; align-items:center; gap:12px; width:100%; border-bottom:1px dashed #eee; padding-bottom:10px; margin-bottom:10px;">
        <div class="date" style="width:auto; text-align:left;"><b style="font-size:12.5px;">${CITIES[k].label}</b>${badgeHtml}</div>
        <div class="ico">${ico}</div>
        <div class="mid"><div class="place" style="font-size:14px; font-weight:900; white-space:nowrap;">${desc}</div><div class="out" style="font-size:11px; font-weight:700;">${temp}°C</div></div>
        <div class="w-bot" style="text-align:right;">
          <span style="display:block; font-size:10px;">風速 ${wind} km/h</span>
          <span style="display:block; font-size:10px; color:#c1502f;">降雨 ${precip} mm</span>
          <span style="display:block; font-size:10px; color:var(--teal);">UV ${uv}</span>
        </div>
      </div>
      <div class="astro-box" style="margin-top:0;">
        <span>🌅 日出 ${sr}</span>
        <span>🌇 日落 ${ss}</span>
        <span class="mw">🌌 銀河 ${MW_TIMES[k]}</span>
      </div>
      <div class="live-tip-box"><b>🧥 穿搭與裝備建議：</b><br>${tip}</div>
    </div>
  `;
}


/* ============ 內嵌 Windy 天氣圖 ============ */
function initRainRadar(){ refreshRainRadar(); }
function refreshRainRadar(){
  const el = document.getElementById('rainRadarMap');
  const timeEl = document.getElementById('rainRadarTime');
  if(!el) return;
  if(!navigator.onLine){
    el.innerHTML='<div class="satellite-offline">☁️ 目前離線，無法載入 Windy 即時圖。恢復網路後按「重新整理」。</div>';
    if(timeEl) timeEl.textContent='Windy 即時圖需要網路連線。';
    return;
  }
  const src='https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=km%2Fh&zoom=5&overlay=satellite&product=satellite&level=surface&lat=35.25&lon=135.55';
  el.innerHTML=`<iframe class="windy-satellite-frame" src="${src}" title="京都・丹後 Windy 即時圖" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
  if(timeEl) timeEl.textContent='Windy 即時天氣圖';
  simplifyMetServiceButton();
}
function simplifyMetServiceButton(){
  document.querySelectorAll('a,button').forEach(el=>{
    const t=(el.textContent||'').trim();
    if(/MetService/i.test(t)) el.textContent='🔗 查看 MetService';
  });
}

/* ============ GUIDE LISTS ============ */
/* 這四份清單（打包／購物／規範／票券）過去只存在記憶體中，
   重新整理頁面就會整個消失、勾選與照片也不會保留。
   現在改為讀取與寫入 LocalStorage，行為和景點筆記／照片一致。 */
const PACK_SUBCATS = {
  '🎒 隨身背包':['證件與金錢','電子用品','健康與隨身用品','機上用品','其他'],
  '👜 手提行李':['攝影器材','電子用品','衣物備用','易碎／貴重物品','其他'],
  '🧳 託運行李':['外套與保暖層','上衣與褲裝','鞋襪與配件','盥洗與保養','藥品與備品','其他']
};
function jsQuote(v){ return String(v).replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }

const defaultPackData = {
  '🎒 隨身背包':[{name:'護照＋機票／訂房憑證',qty:1,checked:false},{name:'ICOCA／交通票券',qty:1,checked:false},{name:'行動電源＋充電線',qty:2,checked:false},{name:'折疊傘',qty:1,checked:false},{name:'常備藥品',qty:1,checked:false}],
  '👜 手提行李':[{name:'相機＋記憶卡',qty:1,checked:false},{name:'機上保暖外套',qty:1,checked:false},{name:'貴重物品',qty:1,checked:false}],
  '🧳 託運行李':[{name:'薄羽絨／防風外套',qty:1,checked:false},{name:'毛衣或刷毛中層',qty:2,checked:false},{name:'好走防滑鞋',qty:1,checked:false},{name:'圍巾＋手套＋厚襪',qty:1,checked:false},{name:'保濕與護唇用品',qty:1,checked:false}]
};
function migratePackCategoryNames(data){
  // 相容舊資料：把舊版類別名稱「🧳 托運行李（衣物防寒）」自動搬到新的簡化名稱「🧳 託運行李」
  if (data && data['🧳 托運行李（衣物防寒）']) {
    if (!data['🧳 託運行李']) data['🧳 託運行李'] = data['🧳 托運行李（衣物防寒）'];
    delete data['🧳 托運行李（衣物防寒）'];
  }
  if(!data) data = structuredClone(defaultPackData);
  Object.keys(data).forEach(cat=>{
    const fallback=(PACK_SUBCATS[cat]||['其他'])[0];
    data[cat]=(data[cat]||[]).map(it=>({...it, subcat:it.subcat || fallback}));
  });
  return data;
}
let packData = migratePackCategoryNames(JSON.parse(localStorage.getItem('kyoto_pack')) || structuredClone(defaultPackData));
function persistPack(){ safeSetItem('kyoto_pack', packData); }

const defaultShopData = [{name:'京都限定伴手禮',qty:1,checked:false,img:null,cat:'souvenir',location:'京都'},{name:'丹後海產／加工品',qty:1,checked:false,img:null,cat:'souvenir',location:'京丹後・舞鶴'},{name:'旅途中飲水與暖暖包',qty:1,checked:false,img:null,cat:'supermarket',location:''}];
let shopData = normalizeStructuredList('kyoto_shop', JSON.parse(localStorage.getItem('kyoto_shop')) || defaultShopData);
function persistShop(){ safeSetItem('kyoto_shop', shopData); }
const SHOP_CATS = {supermarket:{label:'🛒 超市', color:'#2f8a52'}, souvenir:{label:'🎁 紀念品', color:'#c1502f'}};

const listSectionOpen = { pack:{}, shop:{supermarket:false, souvenir:false} };
function toggleListSection(type, key){
  if(!listSectionOpen[type]) listSectionOpen[type] = {};
  listSectionOpen[type][key] = !listSectionOpen[type][key];
  if(type === 'pack') renderPackList(); else renderShopList();
}
function escAttr(v){ return String(v ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function capturePackComposerState(){
  const composer=document.getElementById('packComposer');
  const input=document.getElementById('newPackItem');
  return {
    open:!!composer?.classList.contains('open'),
    value:input?.value||'',
    focused:document.activeElement===input,
    start:input?.selectionStart??null,
    end:input?.selectionEnd??null,
    cat:window._packSelectedCat,
    subcat:window._packSelectedSubcat
  };
}
function isPackComposerEditing(){
  const composer=document.getElementById('packComposer');
  const input=document.getElementById('newPackItem');
  return !!(composer?.classList.contains('open') && (document.activeElement===input || (input?.value||'').trim()));
}
function restorePackComposerState(state){
  if(!state)return;
  if(state.cat)window._packSelectedCat=state.cat;
  if(state.subcat)window._packSelectedSubcat=state.subcat;
  renderPackSubcatChips();
  const input=document.getElementById('newPackItem');
  const composer=document.getElementById('packComposer');
  if(composer)composer.classList.toggle('open',!!state.open);
  if(input){
    input.value=state.value||'';
    if(state.focused){
      requestAnimationFrame(()=>{
        input.focus({preventScroll:true});
        if(state.start!=null)try{input.setSelectionRange(state.start,state.end??state.start);}catch(e){}
      });
    }
  }
}
function renderPackList(){
  const wrap = document.getElementById('packListWrap');
  if(!wrap) return;
  const composerState=capturePackComposerState();
  const groups = Object.keys(packData).map((cat,catIdx)=>{
    const isOpen = listSectionOpen.pack[cat] === true;
    const done = packData[cat].filter(it=>it.checked).length;
    const subcats = PACK_SUBCATS[cat] || ['其他'];
    const subHTML = subcats.map(sub=>{
      const entries=packData[cat].map((it,i)=>({it,i})).filter(x=>(x.it.subcat||subcats[0])===sub);
      if(!entries.length) return '';
      return `<div class="pack-subgroup"><div class="pack-subgroup-title">${sub}</div>${entries.map(({it,i})=>`<div class="pack-item ${it.checked?'checked':''}"><input type="checkbox" ${it.checked?'checked':''} onchange="togglePack('${jsQuote(cat)}',${i})"><div class="name shop-item-title">${it.name}</div><div class="qty"><button onclick="changeQty('${jsQuote(cat)}',${i},-1)">－</button><span>${it.qty}</span><button onclick="changeQty('${jsQuote(cat)}',${i},1)">＋</button></div><button class="del" onclick="delPack('${jsQuote(cat)}',${i})">✕</button></div>`).join('')}</div>`;
    }).join('');
    return `<section class="checklist-group pack-group pack-group-${catIdx}"><button class="checklist-group-head" onclick="toggleListSection('pack', '${jsQuote(cat)}')" aria-expanded="${isOpen}"><span>${cat}</span><small>${done}/${packData[cat].length}</small><b>${isOpen?'⌃':'⌄'}</b></button><div class="checklist-group-body ${isOpen?'open':''}">${subHTML || '<div class="empty compact">此分類目前沒有項目。</div>'}</div></section>`;
  }).join('');
  wrap.innerHTML = groups + `<button class="pack-add-trigger" onclick="togglePackComposer()">＋ 新增行李品項</button><div id="packComposer" class="pack-composer"><div class="composer-label">放在哪一類？</div><div class="pack-type-grid">${Object.keys(packData).map((c,i)=>`<button class="pack-type-btn ${i===0?'active':''}" onclick="choosePackCategory('${jsQuote(c)}',this)">${c}</button>`).join('')}</div><div class="composer-label">細分類</div><div id="packSubcatChips" class="pack-subcat-chips"></div><div class="pack-entry-row"><input type="text" id="newPackItem" placeholder="輸入品項，例如：充電線" onkeydown="if(event.key==='Enter') addPackItem()"><button onclick="addPackItem()">加入清單</button></div><button class="composer-cancel" onclick="togglePackComposer(false)">取消</button></div>`;
  window._packSelectedCat = window._packSelectedCat || Object.keys(packData)[0];
  window._packSelectedSubcat = window._packSelectedSubcat || (PACK_SUBCATS[window._packSelectedCat]||['其他'])[0];
  restorePackComposerState(composerState);
}
function togglePackComposer(force){ const el=document.getElementById('packComposer'); if(!el)return; const show=typeof force==='boolean'?force:!el.classList.contains('open'); el.classList.toggle('open',show); if(show){setTimeout(()=>document.getElementById('newPackItem')?.focus(),80);}else if(window._packRemoteRenderPending){window._packRemoteRenderPending=false;renderPackList();} }
function choosePackCategory(cat,btn){ window._packSelectedCat=cat; window._packSelectedSubcat=(PACK_SUBCATS[cat]||['其他'])[0]; document.querySelectorAll('.pack-type-btn').forEach(b=>b.classList.toggle('active',b===btn)); renderPackSubcatChips(); }
function renderPackSubcatChips(){ const el=document.getElementById('packSubcatChips'); if(!el)return; const list=PACK_SUBCATS[window._packSelectedCat]||['其他']; if(!list.includes(window._packSelectedSubcat)) window._packSelectedSubcat=list[0]; el.innerHTML=list.map(s=>`<button class="pack-subcat-chip ${s===window._packSelectedSubcat?'active':''}" onclick="choosePackSubcat('${jsQuote(s)}')">${s}</button>`).join(''); }
function choosePackSubcat(sub){ window._packSelectedSubcat=sub; renderPackSubcatChips(); }
function syncPackSubcatOptions(){ renderPackSubcatChips(); }
function togglePack(cat,i){ packData[cat][i].checked = !packData[cat][i].checked; persistPack(); renderPackList(); }
function changeQty(cat,i,delta){ packData[cat][i].qty = Math.max(1, packData[cat][i].qty+delta); persistPack(); renderPackList(); }
function delPack(cat,i){ packData[cat].splice(i,1); persistPack(); renderPackList(); }
function addPackItem(){ const cat=window._packSelectedCat||Object.keys(packData)[0]; const subcat=window._packSelectedSubcat||(PACK_SUBCATS[cat]||['其他'])[0]; const input=document.getElementById('newPackItem'); if(input&&input.value.trim()){ packData[cat].push({name:input.value.trim(),qty:1,checked:false,subcat}); persistPack(); listSectionOpen.pack[cat]=true; window._packSelectedCat=cat; window._packSelectedSubcat=subcat; renderPackList(); setTimeout(()=>togglePackComposer(true),0); } }

function shopImgs(it){
  if(Array.isArray(it.imgs)) return it.imgs;
  return it.img ? [it.img] : [];
}
function renderShopList(){
  const wrap = document.getElementById('shopListWrap');
  if(!wrap) return;
  const groups = Object.keys(SHOP_CATS).map(catKey=>{
    const meta = SHOP_CATS[catKey];
    const entries = shopData.map((it,i)=>({it,i})).filter(x=>(x.it.cat || 'supermarket') === catKey);
    const isOpen = listSectionOpen.shop[catKey] === true;
    const done = entries.filter(x=>x.it.checked).length;
    const itemsHTML = entries.length ? entries.map(({it,i})=>{
      const imgs = shopImgs(it);
      const photosHTML = imgs.length ? `<div class="shop-photo-row">${imgs.map((src,pi)=>`<div class="shop-photo"><img src="${src}" onclick="openAttachModal('${src}')"><button onclick="removeShopImg(${i},${pi})">✕</button></div>`).join('')}</div>` : '';
      return `<div class="pack-item shop-item ${it.checked?'checked':''}"><input type="checkbox" ${it.checked?'checked':''} onchange="toggleShop(${i})"><div class="name shop-item-title">${it.name}</div><div class="qty"><button onclick="document.getElementById('shopFile-${i}').click()" class="camera-btn">📷</button><button onclick="changeShopQty(${i},-1)">－</button><span>${it.qty}</span><button onclick="changeShopQty(${i},1)">＋</button></div><button class="del" onclick="delShop(${i})">✕</button><input type="file" id="shopFile-${i}" accept="image/*" multiple style="display:none" onchange="handleShopPhoto(event, ${i})"><div class="shop-extra"><input type="text" value="${escAttr(it.location||'')}" placeholder="建議購買位置或其他資訊..." onchange="setShopLocation(${i}, this.value)"></div>${photosHTML}</div>`;
    }).join('') : '<div class="empty compact">此清單目前沒有項目。</div>';
    return `<section class="checklist-group shop-group shop-${catKey}"><button class="checklist-group-head" onclick="toggleListSection('shop','${catKey}')" aria-expanded="${isOpen}"><span>${meta.label}</span><small>${done}/${entries.length}</small><b>${isOpen?'⌃':'⌄'}</b></button><div class="checklist-group-body ${isOpen?'open':''}">${itemsHTML}</div></section>`;
  }).join('');
  wrap.innerHTML = groups + `<div class="add-row shop-add-row"><select id="newShopCat" class="pill-select">${Object.keys(SHOP_CATS).map(k=>`<option value="${k}">${SHOP_CATS[k].label}</option>`).join('')}</select><input type="text" id="newShopItem" placeholder="新增購物項目..."><button onclick="addShopItem()">＋</button></div>`;
}
async function handleShopPhoto(e,i){
  const files=Array.from(e.target.files||[]);
  e.target.value='';
  if(!files.length)return;
  try{
    if(!Array.isArray(shopData[i].imgs))shopData[i].imgs=shopImgs(shopData[i]);
    shopData[i].img=null;
    updateSyncStatus(null,'saving');
    const urls=await Promise.all(files.map(f=>uploadMediaFile(f,'shopping')));
    shopData[i].imgs=mergeUniqueUrls(shopData[i].imgs,urls);
    persistShop();renderShopList();
  }catch(err){alert('⚠️ '+friendlySyncError(err)+'\n'+String(err.message||err));updateSyncStatus(err);}
}
function removeShopImg(i, photoIdx){ const imgs = shopImgs(shopData[i]); imgs.splice(photoIdx,1); shopData[i].imgs = imgs; shopData[i].img = null; persistShop(); renderShopList(); }
function toggleShop(i){ shopData[i].checked = !shopData[i].checked; persistShop(); renderShopList(); }
function changeShopQty(i,delta){ shopData[i].qty = Math.max(1, shopData[i].qty+delta); persistShop(); renderShopList(); }
function delShop(i){ shopData.splice(i,1); persistShop(); renderShopList(); }
function addShopItem(){ const input = document.getElementById('newShopItem'); const cat = document.getElementById('newShopCat')?.value || 'supermarket'; if(input && input.value.trim()){ shopData.push({id:'shop-'+crypto.randomUUID(),name:input.value.trim(), qty:1, checked:false, imgs:[], cat, location:''}); persistShop(); listSectionOpen.shop[cat] = true; renderShopList(); } }
function setShopCat(i, val){ shopData[i].cat = val; persistShop(); renderShopList(); }
function setShopLocation(i, val){ shopData[i].location = val; persistShop(); }

/* ============ CUSTOM TRAVEL RULES ============ */
const defaultRulesData = [
  {title:'🍁 紅葉機動原則',text:'11/28 三千院、高雄、鞍馬只選一區；出發前 2–3 天依紅葉與天氣決定。',img:null},
  {title:'🚣 保津川雙版本',text:'晴朗且風小才搭漂流；陰雨或風大改搭 JR。漂流後嵐山只留兩個重點。',img:null},
  {title:'🚗 冬季自駕',text:'京丹後與舞鶴建議預約冬季胎車輛；山區與海岸留意低溫、強風與日落時間。',img:null},
  {title:'🕓 寺院時間',text:'12 月日落早，多數寺院 16:00–17:00 停止入場，戶外景點盡量在 16:00 前完成。',img:null}
];
let rulesData = normalizeStructuredList('kyoto_rules', JSON.parse(localStorage.getItem('kyoto_rules')) || defaultRulesData);
function persistRules(){ safeSetItem('kyoto_rules', rulesData); }

function renderRulesList() {
  const wrap = document.getElementById('rulesListWrap');
  if(!wrap) return;
  wrap.innerHTML = rulesData.map((r, i) => {
    // 相容舊資料：舊格式把標題用 <b>...</b> 包在 text 開頭，這裡拆出來當標題
    let title = r.title, body = r.text;
    if(!title && body){
      const m = body.match(/^<b>(.*?)<\/b>\s*[：:]?\s*/);
      if(m){ title = m[1]; body = body.slice(m[0].length); }
    }
    return `
    <div class="rule-item" style="align-items:flex-start; background:#f9f9f9; padding:10px; border-radius:8px; border:1px solid #eee;">
      <span class="dot" style="margin-top:2px;">●</span>
      <div style="flex:1;">
        ${title ? `<div style="font-weight:900; font-size:13.5px; color:var(--ink); margin-bottom:3px;">${title}</div>` : ''}
        <div style="font-size:12.5px; color:var(--ink-soft); line-height:1.6;">${body}</div>
        <div style="margin-top:8px; display:flex; gap:8px;">
          ${r.img ? `<button onclick="openAttachModal('${r.img}')" style="background:var(--teal); color:#fff; border:none; padding:6px 12px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer; box-shadow:var(--shadow-sm);">🖼️ 檢視附圖</button>
                     <button onclick="removeRuleImg(${i})" style="background:#f2f3ec; color:var(--ink); border:none; padding:6px 12px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer;">✕ 移除</button>` 
                  : `<button onclick="document.getElementById('ruleFile-${i}').click()" style="background:#fff; border:1px dashed #ccc; color:var(--ink-soft); padding:6px 12px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer;">📷 新增附圖</button>`}
          <input type="file" id="ruleFile-${i}" accept="image/*" style="display:none" onchange="handleRulePhoto(event, ${i})">
        </div>
      </div>
      <button class="del" onclick="delRule(${i})" style="margin-top:2px;">✕</button>
    </div>
  `;
  }).join('') + `
    <div class="add-row" style="flex-direction:column; align-items:stretch; gap:8px;">
      <input type="text" id="newRuleTitle" placeholder="標題（例如：行李限重）...">
      <div style="display:flex; gap:8px;">
        <input type="text" id="newRuleItem" placeholder="內文說明...">
        <button onclick="addRuleItem()">＋</button>
      </div>
    </div>
  `;
}
async function handleRulePhoto(e,i){const f=e.target.files[0];e.target.value='';if(!f)return;try{rulesData[i].img=await uploadMediaFile(f,'rules');persistRules();renderRulesList();}catch(err){alert('⚠️ '+friendlySyncError(err)+'\n'+String(err.message||err));updateSyncStatus(err);}}
function removeRuleImg(i) { rulesData[i].img = null; persistRules(); renderRulesList(); }
function delRule(i) { rulesData.splice(i, 1); persistRules(); renderRulesList(); }
function addRuleItem() {
  const titleInput = document.getElementById('newRuleTitle');
  const input = document.getElementById('newRuleItem');
  if(input && input.value.trim()){
    rulesData.push({ id:'rule-'+crypto.randomUUID(), title: titleInput ? titleInput.value.trim() : '', text: input.value.trim(), img: null });
    persistRules(); renderRulesList();
  }
}

/* ============ DYNAMIC DOCS/VOUCHERS ============ */
const defaultDocsData = [
  {ic:'✈️',t:'去程航班 TPE → KIX',s:'11/27 08:05 → 11:35',chip:'待上傳',link:'',img:null},
  {ic:'🚆',t:'HARUKA／機場交通',s:'KIX → 京都站',chip:'確認票券',link:'',img:null},
  {ic:'🚗',t:'奈良租車／京都還車',s:'12/1–12/5・確認冬季胎',chip:'待確認',link:'',img:null},
  {ic:'🚣',t:'保津川漂流',s:'12/1・依天候與營運確認',chip:'機動',link:'',img:null},
  {ic:'✈️',t:'回程航班 KIX → TPE',s:'12/6 19:00 → 21:15',chip:'待上傳',link:'',img:null}
];
let docsData = normalizeStructuredList('kyoto_docs', JSON.parse(localStorage.getItem('kyoto_docs')) || defaultDocsData);
function persistDocs(){ safeSetItem('kyoto_docs', docsData); }

function renderDocsList() {
  const wrap = document.getElementById('docsListWrap');
  if(!wrap) return;
  wrap.innerHTML = docsData.map((d, i) => `
    <div class="doc-item">
      <div class="l" style="flex:1; cursor:pointer;" onclick="handleDocClick(${i})">
        <div class="ic">${d.ic}</div>
        <div>
          <div class="t" style="${d.link && !d.img ? 'color:var(--blue); text-decoration:underline;' : ''}">${d.t}</div>
          <div class="s">${d.s}</div>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px; align-items:flex-end;">
        <div class="chip" style="${d.img ? 'background:var(--blue); color:#fff;' : ''}">${d.img ? '憑證就緒' : d.chip}</div>
        ${d.img ? `<button onclick="openAttachModal('${d.img}')" style="background:var(--blue); color:#fff; border:none; padding:6px 10px; border-radius:6px; font-size:11px; font-weight:900; cursor:pointer; white-space:nowrap; box-shadow:var(--shadow-sm);">📱 出示截圖</button>
                   <button onclick="removeDocImg(${i})" style="background:transparent; color:#c1502f; border:none; padding:0; font-size:10px; font-weight:700; cursor:pointer; text-decoration:underline;">✕ 移除</button>`
                : `<button onclick="document.getElementById('docFile-${i}').click()" style="background:#fff; border:1px dashed #ccc; color:var(--ink-soft); padding:5px 10px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap;">📎 上傳截圖</button>`}
        <input type="file" id="docFile-${i}" accept="image/*" style="display:none" onchange="handleDocPhoto(event, ${i})">
      </div>
    </div>
  `).join('');
}
function handleDocClick(i) { const d = docsData[i]; if(d.img) openAttachModal(d.img); else if(d.link) window.open(d.link, '_blank'); }
async function handleDocPhoto(e,i){const f=e.target.files[0];e.target.value='';if(!f)return;try{docsData[i].img=await uploadMediaFile(f,'documents');persistDocs();renderDocsList();}catch(err){alert('⚠️ '+friendlySyncError(err)+'\n'+String(err.message||err));updateSyncStatus(err);}}
function removeDocImg(i) { docsData[i].img = null; persistDocs(); renderDocsList(); }


/* 舊版曾把圖片 Base64 放進 localStorage。首次載入新版時，逐張搬到 Supabase Storage，
   成功後只保留短網址，從根本解決 QuotaExceededError。 */
async function migrateLegacyMediaToCloud(){
  if(!navigator.onLine) return false;
  const progress={done:0,total:0};
  const stores={
    kyoto_photos:photoStore,
    kyoto_covers:coverStore,
    kyoto_route_maps:routeMapStore,
    kyoto_shop:shopData,
    kyoto_rules:rulesData,
    kyoto_docs:docsData
  };
  let changed=false;
  for(const [key,value] of Object.entries(stores)){
    const before=JSON.stringify(value);
    const migrated=await migrateMediaTree(value,`legacy/local/${key}`,progress);
    if(JSON.stringify(migrated)!==before) changed=true;
    if(key==='kyoto_photos') photoStore=migrated;
    else if(key==='kyoto_covers') coverStore=migrated;
    else if(key==='kyoto_route_maps') routeMapStore=migrated;
    else if(key==='kyoto_shop') shopData=migrated;
    else if(key==='kyoto_rules') rulesData=migrated;
    else if(key==='kyoto_docs') docsData=migrated;
    replaceLocalJson(key,migrated);
  }
  if(changed){
    renderDayContent();renderShopList();renderRulesList();renderDocsList();
  }
  return progress.done>0;
}

async function startFamilyCloud(){
  try{
    updateSyncStatus(null,'connecting');
    await migrateLegacyMediaToCloud();
    await initCloudSync();
  }catch(err){console.error('圖片搬移／同步啟動失敗',err);updateSyncStatus(err);}
}

/* ============ 線上／離線狀態 ============ */
function updateNetStatus(){
  const el = document.getElementById('netStatus');
  if(!el) return;
  const online = navigator.onLine;
  el.classList.toggle('online', online);
  el.classList.toggle('offline', !online);
  el.innerHTML = online
    ? '<span class="net-dot online"></span><span class="net-txt">線上</span>'
    : '<span class="net-dot offline"></span><span class="net-txt">離線</span>';
}
window.addEventListener('online', ()=>{ updateNetStatus(); loadLiveWeather(); refreshRainRadar(); });
window.addEventListener('offline', updateNetStatus);

/* ============ Service Worker（離線快取整個網頁） ============ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(function(){ /* 若以 file:// 開啟或不支援，靜默略過 */ });
  });
}

/* ============ TABS ============ */
function setTab(tab) {
  document.querySelectorAll('.tab-btn, .nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll(`[onclick="setTab('${tab}')"]`).forEach(b => b.classList.add('active'));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-'+tab).classList.add('active');
  window.scrollTo({top:0, behavior:'smooth'});
  if(tab === 'weather'){ setTimeout(refreshRainRadar, 100); }
}

function removeUnneededUtilityUI(){
  const patterns=[/跨裝置資料備份/,/匯出備份/,/匯入備份/,/輸出.*行程/,/儲存.*行程/];
  document.querySelectorAll('button,a,section,.card,.guide-card,.utility-card').forEach(el=>{
    const text=(el.textContent||'').replace(/\s+/g,' ').trim();
    if(patterns.some(r=>r.test(text))){
      const card=el.closest('section,.card,.guide-card,.utility-card') || el;
      card.style.display='none';
    }
  });
}

/* ============ INIT ============ */
updateSpotCount();
renderDayChips();
renderDayContent();
renderPackList();
renderShopList();

/* ============ 頁面初始化 ============ */
renderRulesList();
renderDocsList();
updateNetStatus();
simplifyMetServiceButton();
removeUnneededUtilityUI();
renderWeatherFromCache();
loadLiveWeather();
initRainRadar();
startFamilyCloud();
