
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
const SYNC_KEYS = ['kyoto_notes','kyoto_photos','kyoto_covers','kyoto_custom_spots','kyoto_order','kyoto_block_order','kyoto_route_maps','kyoto_pack','kyoto_shop','kyoto_rules','kyoto_docs','kyoto_hidden_fixed_spots'];
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
/* 除了「目前正聚焦」的欄位外，任何還開著、尚未送出的表單（例如「評論與資訊」新增框、
   景點編輯框、打包清單新增框）也算「使用者正在編輯」，即使手機鍵盤造成短暫失焦，
   也不能被背景同步強制重繪清空。 */
function isAnyComposerOpen(){
  if(isUserEditingForm()) return true;
  if(document.querySelector('.note-edit-area[style*="display: block"], .note-edit-area[style*="display:block"]')) return true;
  if(document.querySelector('[id^="spot-edit-short-"], [id^="spot-edit-full-"]')) return true;
  if(typeof isPackComposerEditing==='function' && isPackComposerEditing()) return true;
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
    if(isAnyComposerOpen()||!deferredRemoteRows.size)return;
    const rows=[...deferredRemoteRows.values()];
    deferredRemoteRows.clear();
    rows.forEach(r=>applyRemoteRow(r,true));
  },280);
}
document.addEventListener('focusout',flushDeferredRemoteRows,true);
document.addEventListener('keydown',e=>{if(e.key==='Escape')flushDeferredRemoteRows();},true);

function applyRemoteRow(row, forceApply=false){
  if(!row||typeof row.value==='undefined')return;
  if(!forceApply && isAnyComposerOpen()){ queueRemoteRow(row); return; }
  const rt=row.updated_at||new Date().toISOString(), lt=getSyncMeta()[row.key];
  /* 用 >= 而非 >：自己剛推送出去、又被下一次輪詢讀回來的「回聲」時間戳會完全相同，
     不需要（也不應該）再觸發一次整區重繪。 */
  if(lt&&Date.parse(lt)>=Date.parse(rt))return;
  cloudSync.applyingRemote=true;
  try{let remote;try{remote=JSON.parse(row.value);}catch(e){remote=null;}remote=normalizeSyncValue(row.key,remote);let value=remote;if(MEDIA_SYNC_KEYS.has(row.key)){const local=localValueForKey(row.key);value=mergePreservingLocal(local,remote);}const valueStr=JSON.stringify(value);replaceLocalJson(row.key,value);setSyncMeta(row.key,rt);applyStoreUpdate(row.key,valueStr);}catch(e){console.error('套用家人資料失敗',e);}finally{cloudSync.applyingRemote=false;}
}
/* 若目前有任何未送出的編輯表單開著，先記下「稍後要重繪」，
   等表單關閉／送出後再統一補畫一次，避免蓋掉使用者還沒儲存的內容。 */
window._dayRemoteRenderPending = false;
function safeRenderDayContent(){
  if(isAnyComposerOpen()){ window._dayRemoteRenderPending=true; return; }
  window._dayRemoteRenderPending=false;
  if(typeof renderDayContent==='function') renderDayContent();
}
function flushPendingDayRender(){
  if(window._dayRemoteRenderPending && !isAnyComposerOpen()){
    window._dayRemoteRenderPending=false;
    if(typeof renderDayContent==='function') renderDayContent();
  }
}
function applyStoreUpdate(key,jsonStr){
  let parsed;try{parsed=JSON.parse(jsonStr);}catch(e){return;}
  switch(key){case'kyoto_notes':notesStore=parsed;break;case'kyoto_photos':photoStore=parsed;break;case'kyoto_covers':coverStore=parsed;break;case'kyoto_custom_spots':customSpotsStore=parsed;break;case'kyoto_order':orderStore=parsed;break;case'kyoto_block_order':blockOrderStore=parsed;break;case'kyoto_route_maps':routeMapStore=parsed;break;case'kyoto_pack':packData=migratePackCategoryNames(parsed);if(isPackComposerEditing()){window._packRemoteRenderPending=true;}else{renderPackList();}return;case'kyoto_shop':shopData=normalizeStructuredList('kyoto_shop',parsed);renderShopList();return;case'kyoto_rules':rulesData=normalizeStructuredList('kyoto_rules',parsed);renderRulesList();return;case'kyoto_docs':docsData=mergeDocsWithDefaults(parsed);persistDocs();renderDocsList();return;case'kyoto_hidden_fixed_spots':hiddenFixedSpotsStore=parsed||{};safeRenderDayContent();if(typeof updateSpotCount==='function')updateSpotCount();return;default:return;}
  safeRenderDayContent();if(typeof updateSpotCount==='function')updateSpotCount();
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
  {url:"https://caede-kyoto.com/wp/wp-content/uploads/2018/11/%E6%9D%B1%E5%AF%BA%E3%81%AE%E7%B4%85%E8%91%89%E3%80%80%E5%A4%9C%E6%99%AF.jpg", pos:'center 50%'},
  {url:"https://souda-kyoto.jp/blog/pknb6o0000007ogc-img/ogp.jpg", pos:'center 50%'},
  {url:"https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQBPtfFM6kQwqbDkxpbj4Hh5wZRXg_FqIcCwCuUuVmXVfYBLpr_CxeUppSX&s=10", pos:'center 50%'},
  {url:"https://res.klook.com/image/upload/activities/mrjn0ysimpxxnbhjlctx.jpg", pos:'center 50%'},
  {url:"https://tripper.tw/wp-content/uploads/%E8%A5%BF%E6%9C%AC%E9%A1%98%E5%AF%BA%E9%8A%80%E6%9D%8F01.jpg", pos:'center 50%'}
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
{dayNum:"1",date:"11/27",weekday:"五",region:"啟程・抵達京都",enRegion:"KIX \u2192 Kyoto Station",drive:"🚆 HARUKA 約 75–90 分鐘",title:"入洛日和",dayDesc:"楓都初章・京都駅前的暖色序曲",wear:"長袖內層＋毛衣／刷毛＋薄羽絨",weatherIco:"🍁",spots:[
    S("08:05 TPE → 11:35 KIX","transport","08:05 桃園起飛，11:35 抵達關西機場。",{dur:"約3.5小時",fullDesc:"抵達後依序完成入境、領取行李與交通票券，避免在抵達日安排跨區景點。",img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("HARUKA特急","transport","由關西機場直達京都站，是攜帶行李時最省力的選擇。",{dur:"約75–90分鐘",fullDesc:"建議預留入境與購票時間；抵達京都後先至 Richmond Hotel 寄放行李，再開始輕鬆散步。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("京都站周邊","attraction","Porta、伊勢丹與車站建築都適合抵達日下午慢慢逛。",{tags:["輕鬆"],fullDesc:"抵達日以熟悉車站動線、購買飲水與補給為主，不建議再拉去醍醐寺。",img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("東福寺（機動）","attraction","只有班機、入境與交通都順利，且仍有入場時間才考慮。",{tags:["備案"],fullDesc:"東福寺是抵達日的可刪項目，不應影響晚餐與休息；若時間不足直接留在京都站。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("Richmond Hotel 京都站","hotel","第一晚與最後一晚住宿，方便搭乘機場交通與寄放行李。",{img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("京豆富不二乃","food","京都站內的豆腐料理選擇。",{tags:["京都料理"],img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("名代とんかつ かつくら","food","適合抵達日快速且有飽足感的炸豬排。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("京都鶏白湯そば 純","food","京都站周邊快速麵食備案。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"2",date:"11/28",weekday:"六",region:"紅葉機動日・只選一區",enRegion:"Ohara / Takao / Kurama",drive:"🚌 依紅葉與天氣選一條路線",title:"楓信未定",dayDesc:"山里錦秋・三境擇一的紅葉物語",wear:"山區加圍巾、手套、厚襪與防風外套",weatherIco:"🍂",spots:[
    S("三千院＋大原散步","attraction","適合想看苔庭、落葉與安靜村落的低至中強度版本。",{tags:["方案A","最悠閒"],dur:"半日至一日",fullDesc:"大原路線步調最慢，適合紅葉已進入落葉期或前一日移動疲累時選擇。可圍繞三千院與村落散步，不必塞滿寺院。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("高雄：神護寺＋西明寺","attraction","紅葉密度高，但階梯與移動強度較高。",{tags:["方案B","紅葉密度"],dur:"約5–7小時",fullDesc:"以神護寺與西明寺為主，高山寺只在時間與體力充足時加入。若紅葉仍在見頃，這條路線最有季節感。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("鞍馬寺（貴船視體力）","activity","晴朗時適合山林散步；是否翻山至貴船現場決定。",{tags:["方案C","山林"],dur:"約4–7小時",fullDesc:"不預設一定完成鞍馬到貴船的完整健行。路況濕滑、天色轉暗或體力不足時，原路折返即可。",img:"https://images.unsplash.com/photo-1545569341-9eb8b30979d9?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("Daiwa Roynet Hotel 烏丸四條","hotel","連住兩晚，方便回飯店休息與逛烏丸、河原町。",{img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("新風館＋LE LABO","shopping","晚間回市區後的輕鬆逛街組合。",{img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("京都天ぷら天天天","food","正式晚餐候選，建議事先訂位。",{tags:["預約"],img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("京の焼肉処 弘","food","京都燒肉晚餐候選。",{tags:["預約"],img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("空蟬亭","food","晚餐候選，依訂位與當日動線安排。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"3",date:"11/29",weekday:"日",region:"東山・紅葉星期日輕量版",enRegion:"Shinnyodo \u2192 Eikando \u2192 Nanzenji",drive:"🚇 市區大眾運輸＋步行",title:"東山有秋",dayDesc:"東山錦繡・古寺與庭園的秋日長卷",wear:"好走鞋＋可穿脫保暖層",weatherIco:"🍁",spots:[
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
{dayNum:"4",date:"11/30",weekday:"一",region:"修學院 → 宇治 → 奈良",enRegion:"Northern Kyoto \u2192 Uji \u2192 Nara",drive:"🚆 大眾運輸跨城移動",title:"茶里鹿影",dayDesc:"洛北茶旅・由修學院走向宇治奈良",wear:"洋蔥式穿搭，行李移動日以輕便為主",weatherIco:"🍵",spots:[
    S("詩仙堂・圓光寺・曼殊院三選二","attraction","上午不要貪多，依紅葉與開門時間選兩處。",{tags:["三選二"],dur:"約3小時",fullDesc:"三座寺院位置相近但仍需步行與轉乘，選兩處才能維持慢旅節奏。修學院離宮若要去需事前預約，且會取代其中一部分行程。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("平等院","attraction","宇治核心景點，安排午後參觀。",{tags:["宇治核心"],dur:"約60–90分鐘",fullDesc:"搭配宇治川散步，不把宇治只當轉車點。旺季若鳳翔館需排隊，保留彈性。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("宇治川＋宇治上神社","attraction","以河岸步行串接兩岸景點。",{dur:"約60分鐘",fullDesc:"河岸氣氛舒適，可依時間增加宇治上神社；避免為了打卡頻繁往返。",img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("興聖寺（機動）","attraction","若時間充足再走琴坂與寺院。",{tags:["可刪"],fullDesc:"宇治至少留三小時，但若前段延誤，興聖寺優先刪除，確保傍晚順利抵達奈良。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("辻利兵衛本店","food","宇治甜點候選。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("クウネルノツヅキ","food","宇治咖啡甜點備案。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("奈良大和魯內飯店","hotel","奈良住宿，晚餐以飯店附近為主。",{img:"https://images.unsplash.com/photo-1584545284372-f22510eb7c26?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"5",date:"12/1",weekday:"二",region:"奈良 → 龜岡 → 保津川／嵐山",enRegion:"Nara \u2192 Kameoka \u2192 Arashiyama",drive:"🚗 奈良取車後前往龜岡",title:"一川嵐色",dayDesc:"川舟嵐影・保津川與嵯峨野的一日",wear:"船上體感冷：防風外套、圍巾、手套",weatherIco:"🚣",spots:[
    S("奈良公園・浮見堂・飛火野","attraction","清晨選一至兩處散步，避開晚一點的人潮。",{tags:["清晨"],dur:"約60–90分鐘",fullDesc:"退房與取車前的輕量行程，不延伸到過多寺院。",img:"https://images.unsplash.com/photo-1584545284372-f22510eb7c26?auto=format&fit=crop&w=1200&q=82"}),
    S("保津川漂流（天氣好版）","activity","約 11:00 搭船，約 13:00 抵達嵐山。",{tags:["晴天版"],dur:"約2小時",fullDesc:"奈良退房租車後前往龜岡飯店停車寄物，再前往乘船處。漂流是當日主體，抵達嵐山後只安排兩個重點。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82",tip:"出發前確認營運、風況與水位；船上長時間吹風，務必加強保暖。"}),
    S("JR 嵯峨嵐山（雨風版）","transport","天候不適合漂流時，從龜岡搭 JR 往返嵐山。",{tags:["備案"],fullDesc:"JR 版可把時間留給天龍寺、竹林與一至兩座寺院，但仍不建議塞滿整個嵐山。",img:"https://images.unsplash.com/photo-1545569341-9eb8b30979d9?auto=format&fit=crop&w=1200&q=82"}),
    S("天龍寺","attraction","兩個嵐山重點之一。",{dur:"約60分鐘",fullDesc:"無論漂流版或 JR 版都優先保留；抵達較晚時注意停止入場時間。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("常寂光寺／寶筐院二選一","attraction","下午第二個紅葉重點，依當時紅葉與人潮決定。",{tags:["二選一"],fullDesc:"漂流版只再選一座；JR 版若時間多，可把二尊院列為額外備選。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("Route Inn 龜岡","hotel","車停飯店、行李寄放，輕裝前往保津川與嵐山。",{img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("嵐山商店街","shopping","午餐、咖啡與伴手禮簡單安排，不特別追排隊名店。",{img:"https://images.unsplash.com/photo-1545569341-9eb8b30979d9?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"6",date:"12/2",weekday:"三",region:"龜岡 → 南丹 → 綾部 → 京丹後",enRegion:"Kameoka \u2192 Nantan \u2192 Ayabe \u2192 Kyotango",drive:"🚗 約 150 km／分段慢行",title:"山盡見海",dayDesc:"丹波晚楓・穿越山寺奔向日本海",wear:"山區與丹後加強防風保暖",weatherIco:"🚗",spots:[
    S("玉寶山 龍穩寺","attraction","可能遇到晚楓或落葉紅毯，是此日季節重點。",{tags:["晚楓"],dur:"約60分鐘",fullDesc:"是否仍有紅葉依當年進度而定；即使落葉，參道與山寺氛圍仍適合慢慢散步。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("大本本部 梅松苑","attraction","綾部的重要園區與建築群。",{dur:"約60分鐘",fullDesc:"作為南丹到京丹後途中停靠點，參觀後在綾部簡單午餐，不再增加遠繞景點。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("綾部午餐","food","以順路、停車方便為優先。",{tags:["簡單吃"],fullDesc:"這天的目標是準時抵達京丹後旅館，午餐不追排隊名店。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("シーサイド佐竹","hotel","海邊溫泉旅館，約 15:00 入住並在旅館享用晚餐。",{tags:["旅館晚餐"],img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"7",date:"12/3",weekday:"四",region:"京丹後海岸・旅館休息日",enRegion:"Kyotango Coast",drive:"🚗 海岸短距離移動",title:"海辺無事",dayDesc:"潮騷慢泊・丹後海岸的靜謐休日",wear:"海風強，羽絨或防風外套＋帽子",weatherIco:"🌊",spots:[
    S("立岩＋後ヶ濱海岸","attraction","晴天版的海岸主景。",{tags:["晴天版"],dur:"約60–90分鐘",fullDesc:"天氣晴朗、能見度佳時優先。海邊風大，不需在單點停留過久。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"}),
    S("道之驛 てんきてんき丹後","shopping","海岸途中休息、伴手禮與天候備案。",{tags:["雨天可去"],fullDesc:"晴天可與立岩串接；雨天則作為室內停留與補給點。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"}),
    S("琴引濱＋網野咖啡","attraction","順路版，適合不想往返太多海岸點時。",{tags:["順路版"],fullDesc:"選琴引濱後就搭配網野午餐或咖啡，不再往立岩方向硬繞。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"}),
    S("雨天版：午餐＋道之驛＋咖啡","food","大雨或強風時取消海岸久留。",{tags:["雨天版"],fullDesc:"把時間留給午餐、採買與旅館設施，15:00 準時入住。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("HOTEL＆湖邸 艸花","hotel","15:00 入住，這日把旅館本身當作行程。",{tags:["慢旅"],img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"}),
    S("間人／網野午餐","food","依當天海岸動線選擇，不為餐廳大幅繞路。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"8",date:"12/4",weekday:"五",region:"京丹後 → 金剛院 → 天橋立 → 舞鶴",enRegion:"Kyotango \u2192 Amanohashidate \u2192 Maizuru",drive:"🚗 約 100–130 km",title:"橋立暮景",dayDesc:"海之京都・金剛院與天橋立遠景",wear:"防風保暖，纜車與展望台體感更冷",weatherIco:"🌉",spots:[
    S("金剛院","attraction","舞鶴山間古寺，作為天橋立前的寧靜停靠。",{dur:"約60–90分鐘",fullDesc:"上午退房後前往，不要再增加過多寺院，保留天橋立的日照時間。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("府中側：籠神社＋傘松公園","attraction","已搭過 View Land 時選這岸。",{tags:["方案A"],dur:"約2–3小時",fullDesc:"以籠神社與傘松公園為主，不做沙洲完整徒步或繞行。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"}),
    S("文珠側：View Land＋智恩寺","attraction","未看過飛龍觀時選這岸。",{tags:["方案B"],dur:"約2–3小時",fullDesc:"View Land、智恩寺與沙洲前段即可；天橋立只選一岸。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("天橋立午餐","food","依選擇的岸就近用餐。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("Route Inn 西舞鶴","hotel","傍晚入住，晚餐於西舞鶴安排。",{img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"9",date:"12/5",weekday:"六",region:"舞鶴 → 京都",enRegion:"Maizuru \u2192 Kyoto",drive:"🚗 上午舞鶴；下午回京都還車",title:"港町別章",dayDesc:"港町餘韻・舞鶴紅磚與灣景之晨",wear:"展望台風大；回京都後可減少一層",weatherIco:"⚓",spots:[
    S("舞鶴港とれとれセンター","food","早上以海鮮市場早餐／早午餐開始。",{tags:["早餐"],dur:"約60–90分鐘",fullDesc:"先吃再逛，依當日營業攤位選擇，不需要刻意點太多。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"}),
    S("五老天空塔","attraction","俯瞰舞鶴灣的代表展望點。",{tags:["上午"],dur:"約60分鐘",fullDesc:"排在上午以提高能見度；若雲霧太濃，可縮短停留。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"}),
    S("舞鶴紅磚公園","attraction","港町歷史建築群，適合回京都前散步。",{dur:"約60–90分鐘",fullDesc:"作為舞鶴最後一站，結束後直接開車回京都還車。",img:"https://images.unsplash.com/photo-1500534314209-a25ddb2bd4297?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("Richmond Hotel 京都站","hotel","回到京都站住宿，方便隔日前往機場。",{img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("最後晚餐候選","food","京の焼肉処 弘、天天天、空蟬亭或かぼちゃのたね擇一。",{tags:["預約"],img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ]},
{dayNum:"10",date:"12/6",weekday:"日",region:"京都晚楓保險 → 關西機場",enRegion:"Kyoto \u2192 KIX \u2192 TPE",drive:"🚆 15:00 前由京都站前往 KIX",title:"餘白京都",dayDesc:"京洛惜別・銀杏晚楓與歸途",wear:"市區洋蔥式穿搭，機艙備薄外套",weatherIco:"✈️",spots:[
    S("西本願寺","attraction","京都站附近的晨間第一站。",{dur:"約45–60分鐘",fullDesc:"距京都站不遠，適合退房後開始；保持節奏，不延誤後續。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("京都御苑","attraction","作為 12 月初晚楓與銀杏保險。",{tags:["晚楓保險"],dur:"約60分鐘",fullDesc:"腹地大，選擇一段散步即可，不必完整繞行。",img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"}),
    S("下鴨神社＋糺之森","attraction","林蔭與晚楓氣氛，視時間保留。",{tags:["機動"],dur:"約60–90分鐘",fullDesc:"若前段延誤，縮短糺之森散步，務必 14:00 左右回京都站。",img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("19:00 KIX → 21:19 TPE","transport","19:00 關西機場起飛，21:15 抵達桃園。",{dur:"約3小時15分",fullDesc:"15:00 前從京都站出發，預留取行李、機場交通與報到時間。",img:"https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1200&q=82"})
  ],moreSpots:[
    S("イノダコーヒ本店","food","早餐候選，但不為排隊影響離境日節奏。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("まるき製パン所／fiveran","food","麵包外帶候選。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("Point Pour Point","food","甜點咖啡候選。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"}),
    S("ごちそう焼むすび おにまる","food","適合帶走的飯糰。",{img:"https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=1200&q=82"})
  ]}
];


/* ============ 京都內容精修（2026-08） ============ */
(function refineKyotoContent(){
  const imageMap = {"08:05 TPE → 11:35 KIX": "https://preview.redd.it/during-my-flight-to-kyoto-v0-hlohiahw1rse1.jpeg?auto=webp&s=2a56c05f02ca2827b16ac9ff3dd224bfe0155136", "京都站周邊": "https://www.agoda.com/wp-content/uploads/2020/02/Shijo-dori-street-Takashimaya-MARUI-Kyoto-shopping-Japan.jpg", "東福寺": "https://caede-kyoto-asia.com/wp/wp-content/uploads/2020/10/01-81.jpg", "Richmond Hotel 京都站": "https://richmondhotel.jp/datas/cache/images/2023/03/16/1920x800_ea1e9d427fb5664c32c517a73e421e58_6b6a3d25465b474f3daed67958cbbf3e53054f50.jpg", "京豆富不二乃": "https://www.kyotofu.co.jp/wordpress/wp-content/uploads/2016/11/742eca49c8febf7bb8071f2fab2d03f8_up.jpg", "名代とんかつ かつくら": "https://www.katsukura.jp/wp/wp-content/uploads/2020/08/%E2%96%B3%E7%89%B9%E4%B8%8A%E3%83%AD%E3%83%BC%E3%82%B9200%EF%BD%9C20180314_6913.jpg", "京都鶏白湯そば 純": "https://www.leafkyoto.net/leaf/wp-content/uploads/2023/02/230225-jun-1-1024x682.jpg", "三千院＋大原散步": "https://www.tabirai.net/tabirai-uploader/img/0040920/s1_0040920.png", "高雄：神護寺＋西明寺": "https://farm66.static.flickr.com/65535/54736539956_fa37fb8581_b.jpg", "鞍馬寺": "https://caede-kyoto-asia.com/wp/wp-content/uploads/2020/10/02-14.jpg", "真如堂": "https://lh4.googleusercontent.com/proxy/LqrQznuDfV3n5sfPn5of1ZChxBeGBieQDVv_P4DtZEtJMoxk6TV6kT2brT1-XHz5raANlle8PKSwmn2PsCW0pNr2HMKi6IR_8jXQ1PG2T-obA7aRaA", "永觀堂": "https://cdn.zekkei-japan.jp/images/articles/2a49a79e5bae0f2b3ae829133ddf8254.jpg", "南禪寺": "https://tw.wamazing.com/media/wp-content/uploads/sites/4/2021/09/pixta_13874853_M-1.jpg.webp", "天授庵": "https://immay.tw/wp-content/uploads/pixnet/1480130872-2300882830.jpg", "無鄰菴": "https://image.walkerplus.com/wpimg/walkertouch/wtd/event/75/n/321275_1.jpg?x=1920&notupsize=1", "Daiwa Roynet Hotel 烏丸四條": "https://www.daiwaroynet.jp/datas/cache/images/2026/05/01/1760x790_ea1e9d427fb5664c32c517a73e421e58_9be1fcf273f3f8b55bfd470c73bf86754c6cdb69.jpg", "新風館＋LE LABO": "https://static.gltjp.com/glt/data/directory/14000/13502/20220821_072100_cddb5e78_w1920.webp", "京都天ぷら天天天": "https://tblg.k-img.com/restaurant/images/Rvw/350587/640x640_rect_f8d6b6be333bd5851317c1ac254c8085.jpg", "京の焼肉処 弘": "https://rimage.hitosara.com/gg/image/0006078791/0006078791F2_740x555y.jpg?t=1779683033", "空蟬亭": "https://live.staticflickr.com/65535/55284753095_a0c5cd61eb_c.jpg", "DRAGON BURGER": "https://media.vogue.com.tw/photos/63b56fd292e09ec5550899a4/2:3/w_2560%2Cc_limit/IMG_1406.jpg", "祇園辻利": "https://tw.tabiiro.travel/lpimg/gourmet/316016/main/img1.jpg", "BAL": "https://www.bal-bldg.com/app/uploads/sites/2/2024/10/kyoto-pop-up.jpg", "Kyoto LOFT": "https://marukoblog.tw/wp-content/uploads/2023/07/loft-_4.jpg", "SOU・SOU 一条街": "https://file001.shop-pro.jp/PA01018/434/shop_img/info/tabi01_sp.jpg", "詩仙堂": "https://caede-kyoto-asia.com/wp/wp-content/uploads/2020/06/04-2.jpg", "圓光寺": "https://farm66.static.flickr.com/65535/54199970608_6cbb5f5f23_b.jpg", "曼殊院": "https://kavana.tw/wp-content/uploads/thumb_20200828122401_50.jpg", "平等院": "https://img.japanyokoso.com/pac_dir/spot/2021/L00781_A_01_fan.jpg", "宇治上神社": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT8QWfgazaHjXjfET6R2Q5_WoJkJD0ejcM2zYONj487kQVi946hpswXs0ji&s=10", "興聖寺": "https://static.gltjp.com/glt/data/directory/15000/14548/20230721_205450_930c1f08_w640.webp", "辻利兵衛本店": "https://www.tsujirihei.co.jp/shop/images/img13.jpg", "クウネルノツヅキ": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTEkXIPQW3BlTbBoxf_OBURJ7wYFl-zSMMcov8MfsQXEpwvH2IAP8bucV4&s=10", "Daiwa Roynet Hotel 奈良": "https://www.daiwaroynet.jp/datas/cache/images/2022/01/31/1760x790_ea1e9d427fb5664c32c517a73e421e58_1e3ed9f95d00c160b50aeeed0f36998c4d499d33.jpg", "奈良公園・浮見堂・飛火野": "https://ak-d.tripcdn.com/images/1mi3712000p672el42D70.jpg?proc=source/trip", "保津川漂流": "https://cdn.jeepe.jp/uploads/public_image/image/221/normal_545cb563-d31e-4929-99de-680651f197e6.jpg", "天龍寺": "https://static.japan-food.guide/uploads/ckeditor_asset/data/000/012/365/1562a0d6b690843513e57450a5b0879766183e64dc2b714bfb9be66d7b399b16/image.jpeg", "常寂光寺": "https://farm66.static.flickr.com/65535/54258308911_40eb264834_b.jpg", "寶筐院": "https://lh3.googleusercontent.com/proxy/Dv1UuAW4MxO4yobYsqIyWtbdcMVMI0S-ZDzk05A_Jfr_rCK1PYeAAH4IA26ZpfvAZChfyMl7Uix8adys8D9cyx-N9xkfdHT0yNzL9qziFYdEge_g", "玉寶山 龍穩寺": "https://img.vocus.cc/5oZfPImpIJY-lnsyppvZN0siZt1Cg0DgTpXkqZ61O20/w:740/f:webp/plain/https://images.vocus.cc/498f3673-00c3-474c-ae65-262413c0ed39.jpg", "大本本部 梅松苑": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcStUHt0pAA-sVoB4xkrOdJVvV3uPDt-kdExpZnWKlMvAVBQfk9ZGzFuJ94&s=10", "シーサイド佐竹": "https://www.kyotango.gr.jp/wp-content/uploads/2019/03/3ee03f2a84c5f48ee7287dbf1648e62d.jpg", "後ヶ濱海岸": "https://www.kyotango.gr.jp/wp-content/uploads/2023/01/fe7fbedcc24d6c1aef81e6e21480e05d.jpg", "道之驛 てんきてんき丹後": "https://www.kyotango.gr.jp/wp-content/uploads/2019/03/b0760acfdbc23c07950bd21d5b2436c3-1.jpg", "HOTEL＆湖邸 艸花": "https://www.kyotango.gr.jp/wp-content/uploads/2022/06/912aa273f1b2884cd4959f013e2177e9.jpg", "金剛院": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQQY33QTqQOPwtY8a2jDECPvbZnvnv1OE3X457MM1ysBfI8qrVzfnkdavg&s=10", "府中側：籠神社＋傘松公園": "https://farm66.static.flickr.com/65535/55341985802_5d219dc002_b.jpg", "文珠側：View Land＋智恩寺": "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTS6wcfUt3Zl6gR1o-yC-g312RI2CObFOIiL5_nqe7EE2UAlryBKJhnuCI&s=10", "Route Inn 西舞鶴": "https://trvis.r10s.com/d/strg/ctrl/26/184983e9172cb121da6459bedf69d5cb9deb447d.47.9.26.3.jpg", "五老天空塔": "https://www.kyototourism.org/wp/wp-content/uploads/2021/01/Sea_Goro-Sky-Tower-01.jpg", "舞鶴紅磚公園": "https://www.e-japannavi.com/syuyu/kyoto/tango_images/akarenga_park_img700465_01.jpg", "舞鶴港とれとれセンター": "https://toretore.org/wp/wp-content/uploads/2015/10/de2b208e096e93812571d01a60225507-1024x681.jpg", "西本願寺": "https://tripper.tw/wp-content/uploads/%E8%A5%BF%E6%9C%AC%E9%A1%98%E5%AF%BA%E9%8A%80%E6%9D%8F01.jpg", "京都御苑": "https://kyoto-tabiya.com/wp-content/uploads/62a0bd2937ef4acb8fbc6caae2e6f7f2.jpg", "下鴨神社＋糺之森": "https://www.tw-kyoto.yumeyakata.com/wp-content/uploads/2024/11/autumn-leaves1-2-757x1024.jpg", "19:00 KIX → 21:19 TPE": "https://media.cntraveller.com/photos/692844606d000544b56e4083/master/w_1600%2Cc_limit/Japan_271125_GettyImages-1656936311.jpg", "イノダコーヒ本店": "https://ja.kyoto.travel/resource/tourism/2527-1.jpg", "まるき製パン所／fiveran": "https://img.hanako.tokyo/2023/09/02234344/DMA-DSCF5666-768x512.jpg", "Point Pour Point": "https://www.leafkyoto.net/leaf/wp-content/uploads/2025/04/250408-pointpourpoint-1-1024x682.jpg", "ごちそう焼むすび おにまる": "https://www.onimaru-net.com/build/images/index/teaser/menu_hati.78cf1ee9.png"};
  const dayTitles = [
    "楓都初章・京都駅前的暖色序曲",
    "山里錦秋・三境擇一的紅葉物語",
    "東山錦繡・古寺與庭園的秋日長卷",
    "洛北茶旅・由修學院走向宇治奈良",
    "川舟嵐影・保津川與嵯峨野的一日",
    "丹波晚楓・穿越山寺奔向日本海",
    "潮騷慢泊・丹後海岸的靜謐休日",
    "海之京都・金剛院與天橋立遠景",
    "港町餘韻・舞鶴紅磚與灣景之晨",
    "京洛惜別・銀杏晚楓與歸途"
  ];
  days.forEach((d,i)=>d.title=dayTitles[i]);
  const routeLabels=['關西機場 → 京都站','大原／高雄／鞍馬・貴船','真如堂 → 永觀堂 → 南禪寺','修學院 → 宇治 → 奈良','奈良 → 龜岡 → 嵐山','龜岡 → 南丹 → 綾部 → 京丹後','京丹後海岸','金剛院 → 天橋立 → 舞鶴','舞鶴 → 京都','京都 → 關西機場'];
  days.forEach((d,i)=>d.enRegion=routeLabels[i]);

  const all=()=>days.flatMap(d=>[...d.spots,...d.moreSpots]);
  function find(name){ return all().find(s=>s.name===name); }
  function addTag(s,tag){ if(s && !s.tags.includes(tag)) s.tags.push(tag); }
  function split(dayIndex, oldName, newSpots){
    const d=days[dayIndex], idx=d.spots.findIndex(s=>s.name===oldName);
    if(idx>=0) d.spots.splice(idx,1,...newSpots);
  }
  function moveToMore(dayIndex,name){
    const d=days[dayIndex],idx=d.spots.findIndex(s=>s.name===name);
    if(idx>=0)d.moreSpots.unshift(d.spots.splice(idx,1)[0]);
  }

  // 標題中的機動字樣改為標籤
  all().forEach(s=>{
    const labels=[];
    s.name=s.name.replace(/\s*[（(](機動|二選一|三選二|天氣好版|雨風版)[）)]/g,(_,x)=>{labels.push(x);return "";});
    labels.forEach(x=>addTag(s,x));
  });

  // 拆分合併景點
  split(2,"天授庵／無鄰菴二選一",[
    S("天授庵","attraction","南禪寺塔頭，以枯山水與池泉庭園展現截然不同的秋景。",{tags:["與無鄰菴擇一"],dur:"約45–60分鐘",fullDesc:"天授庵緊鄰南禪寺三門，動線最順。前庭以白砂、苔地與幾何石組構成，後庭則有池泉、楓樹與竹林；紅葉旺季空間不大，若入口排隊過長，可把時間留給無鄰菴。"}),
    S("無鄰菴","attraction","明治時代名園，以東山為借景、琵琶湖疏水為庭園注入流動感。",{tags:["與天授庵擇一","建議預約"],dur:"約45–60分鐘",fullDesc:"無鄰菴的魅力不在密集楓紅，而在草地、溪流、石景和遠方東山共同構成的開闊景深。適合想避開寺院式庭園、慢慢坐看水聲與秋色的人；熱門時段常採預約或分流，出發前先確認。"})
  ]);
  split(3,"詩仙堂・圓光寺・曼殊院三選二",[
    S("詩仙堂","attraction","小巧而層次分明的山居庭園，白砂、杜鵑丘與楓色相互映襯。",{tags:["三選二"],dur:"約45–60分鐘",fullDesc:"詩仙堂由書院望向庭園的框景十分優雅，秋季色彩集中、停留節奏安靜。入口到庭園有些坡度，建議開門前後抵達；若院內已擁擠，不必久候經典空景。"}),
    S("圓光寺","attraction","十牛之庭與額緣庭園是洛北紅葉代表，落葉期也很有韻味。",{tags:["三選二","紅葉重點"],dur:"約60–75分鐘",fullDesc:"圓光寺從書院向外望，可看到楓樹、苔庭與石燈籠形成如畫框般的景致；後方高處還能俯瞰京都。旺季通常需注意預約或入場安排，若當年紅葉狀況最好，可優先保留。"}),
    S("曼殊院","attraction","門跡寺院氣質典雅，白砂庭園與勅使門周邊楓色較沉靜。",{tags:["三選二","較清幽"],dur:"約45–60分鐘",fullDesc:"曼殊院的庭園留白較多，氛圍比圓光寺安靜，適合作為洛北散步的收尾。三處全走會壓縮宇治時間，因此只選兩處；若希望少一點人潮，可把曼殊院排進組合。"})
  ]);
  split(4,"常寂光寺／寶筐院二選一",[
    S("常寂光寺","attraction","小倉山坡地上的紅葉名所，仁王門、多寶塔與嵯峨野遠景層層展開。",{tags:["與寶筐院擇一"],dur:"約60分鐘",fullDesc:"常寂光寺需要走一段階梯，但沿途楓樹密度高，登高後視野開闊。搭船抵達嵐山後若體力仍好，這裡較有完整的『山寺紅葉』體驗；雨後石階濕滑，鞋底抓地力要足。"}),
    S("寶筐院","attraction","以細緻苔庭和密集楓樹聞名，庭園近距離、秋色包覆感強。",{tags:["與常寂光寺擇一"],dur:"約45–60分鐘",fullDesc:"寶筐院面積不大，秋季庭園色彩非常集中，適合不想再爬太多坡、想在較小空間細看楓葉的人。入口與庭園通道狹窄，旺季若排隊過長，就選常寂光寺避免消耗時間。"})
  ]);
  // 逛街拆分
  const d3=days[2], shopIdx=d3.moreSpots.findIndex(s=>s.name==="BAL・Kyoto LOFT・KIDDY LAND");
  if(shopIdx>=0)d3.moreSpots.splice(shopIdx,1,
    S("BAL","shopping","河原町一帶偏設計與質感選物的商場，適合傍晚慢逛。",{fullDesc:"京都 BAL 聚集服飾、生活選物、書店與咖啡空間，比大型百貨更偏成熟質感。東山行程提早結束時可來休息，不必為了逛完每層延後晚餐。"}),
    S("Kyoto LOFT","shopping","文具、生活雜貨與旅行小物集中，適合補買實用品。",{fullDesc:"LOFT 適合尋找日系文具、美妝與季節限定商品；把它當成雨天或晚上備案即可，先列購物清單，避免在紅葉日花掉太多時間。"}),
    S("KIDDY LAND","shopping","角色商品與可愛雜貨的輕鬆停靠點。",{fullDesc:"適合在河原町逛街時順路進入，不需專程跨區。熱門角色新品可能排隊，若店內過於擁擠，直接保留體力回飯店。"})
  );

  // 交通與景點分類
  const jr=find("JR 嵯峨嵐山");
  if(jr){ const d=days[4]; d.spots=d.spots.filter(s=>s!==jr); }
  const hozu=find("保津川漂流");
  if(hozu){
    hozu.tags=["天候機動"];
    hozu.desc="晴朗、風小且正常營運時搭船；雨風不適合則改由龜岡搭 JR 前往嵐山。";
    hozu.fullDesc="保津川下り從龜岡沿峽谷順流抵達嵐山，約兩小時，船夫會依水勢操舟，沿途可看溪谷、岩壁與山林。先把車和行李留在 Route Inn 龜岡，再輕裝前往乘船處。雨天、強風、水位或停航時，不另設一張交通卡，直接採雨備方案：從龜岡搭 JR 至嵯峨嵐山，把時間留給天龍寺與一座紅葉寺院。";
    hozu.tip="前一晚與當日早晨再次確認營運；船上體感溫度低，準備防風外套、圍巾與手套。";
  }
  moveToMore(0,"HARUKA特急");
  const market=find("舞鶴港とれとれセンター"); if(market) market.cat="attraction";

  // 飯店與航班
  const nara=find("奈良大和魯內飯店"); if(nara)nara.name="Daiwa Roynet Hotel 奈良";
  const ret=find("19:00 KIX → 21:19 TPE"); if(ret){ret.desc="19:00 關西機場起飛，21:19 抵達桃園。";ret.fullDesc="建議 15:00 前由京都站出發，預留取行李、搭乘機場交通、報到與安檢時間。";}
  const out=find("08:05 TPE → 11:35 KIX"); if(out){out.desc="08:05 桃園起飛，11:35 抵達關西機場。";out.fullDesc="早班機抵達後先完成入境與領取行李，再依票券搭乘 HARUKA 前往京都。抵達日不追趕遠距景點，東福寺只在流程非常順暢、仍有充足參觀時間時加入。";}

  // 每日提示移入詳細介紹
  const naraWalk=find("奈良公園・浮見堂・飛火野");
  if(naraWalk){naraWalk.desc="清晨在奈良公園東側選一至兩處散步。";naraWalk.fullDesc="浮見堂適合看鷺池晨光，飛火野則有開闊草地與鹿群；兩者不必都完整走完。退房與取車前只選一至兩處，利用清晨較安靜的時段散步，避開稍晚抵達的團體人潮，也不要再延伸到太多寺院。";}

  // 景點介紹加深
  const details={
    "東福寺":"東福寺以通天橋俯瞰洗玉澗的楓林聞名，深秋時紅、橙、黃葉交疊，落葉期也有層次。抵達日只有在入境、HARUKA 與寄放行李都非常順利時才前往；若剩餘時間不足一個半小時，直接留在京都站較從容。",
    "三千院＋大原散步":"三千院位於大原山里，聚碧園與有清園以苔地、杉木、石佛和柔和楓色構成安靜景觀。比市中心紅葉名所更適合慢走；可沿村落小徑、溪流與土產店散步，不必把周邊寺院全部收集。落葉期的苔庭與紅葉地毯仍很漂亮。",
    "高雄：神護寺＋西明寺":"高雄山區氣溫通常低於市區，紅葉進度也較早。神護寺需走較多階梯，寺域開闊、山谷景觀強烈；西明寺規模較小，朱橋與溪谷更有幽靜感。高山寺只有在時間與體力充足時再加，避免三寺全走變成趕路。",
    "鞍馬寺（貴船視體力）":"鞍馬寺沿山勢而建，從仁王門到本殿金堂一路穿過杉林與石階，秋季氣氛清冽。是否翻山到貴船應依路況、天色與膝力決定；濕滑、接近日落或體力不足時原路折返，仍能完整感受鞍馬山林。",
    "真如堂":"真如堂的三重塔、本堂與楓林相互映襯，是東山北側很有層次的紅葉寺院。清晨先抵達，可先看本堂前與塔周邊，再往永觀堂方向移動；不要為等待完全無人的畫面停留過久。",
    "永觀堂":"永觀堂依山勢形成多層伽藍，放生池、多寶塔與長廊串起京都最具代表性的紅葉景觀。旺季人潮難以避免，仍值得保留為當日核心；若入口排隊過長，就縮減額外庭園，而不是犧牲後續休息。",
    "南禪寺":"南禪寺腹地寬廣，三門、法堂與磚造水路閣展現不同時代的建築語彙。從永觀堂步行而來很順，適合放慢速度散步；若時間有限，集中在三門與水路閣，不必逐一進入所有塔頭。",
    "平等院":"平等院鳳凰堂臨阿字池而建，水面倒影與朱紅建築是宇治代表景觀；鳳翔館則可近看雲中供養菩薩與文物。午後至少留一至一個半小時，若館內排隊明顯，先完成庭園環線，再依剩餘時間決定。",
    "宇治上神社":"宇治上神社藏在宇治川東岸林蔭間，規模不大，氣氛比平等院安靜。本殿與拜殿具有古老而克制的美感，適合與朝霧橋、河岸步道串成一段，不必為了打卡來回穿越河川。",
    "興聖寺":"興聖寺以通往山門的琴坂聞名，兩側楓樹在深秋形成狹長色帶。它位於宇治川上游，步行會增加時間；若修學院行程延誤，優先刪除此站，以確保宇治至少三小時及傍晚順利到奈良。",
    "天龍寺":"天龍寺曹源池庭園以嵐山與龜山為借景，秋末仍能看到山色、池水與庭石的平衡。無論搭船或 JR 都優先保留，抵達後先確認最後入場時間；參觀後從北門銜接嵯峨野，比在商店街來回更順。",
    "玉寶山 龍穩寺":"龍穩寺藏在南丹山間，參道石階、山門與楓樹形成沉靜的晚秋景致。12 月初可能是枝頭晚楓，也可能轉為落葉紅毯；兩種狀態都適合拍攝。山路較窄，放慢車速並依現場指示停車。",
    "大本本部 梅松苑":"梅松苑是大本在綾部的重要聖地，園區包含神苑、長生殿、みろく殿與歷史建築，尺度比一般寺院更大。建築內部可能需預約或受參觀規範限制，現場保持安靜、依指示行走；此站後安排簡單午餐，再直接往丹後。",
    "金剛院":"金剛院位於舞鶴山間，三重塔、山門與楓樹共同形成古樸景觀。12 月初可能已進入落葉期，石階與苔地反而更有深秋氣氛；上午光線與遊客量通常較舒服，參觀後直接前往天橋立。",
    "五老天空塔":"五老岳位於舞鶴灣中央制高點，天氣清楚時可俯瞰曲折海岸、港區與島嶼。展望台風勢常比市區強，排在上午有利於能見度；若低雲籠罩，不必久候，可把時間留給紅磚公園。",
    "舞鶴紅磚公園":"舞鶴紅磚公園保存近代海軍倉庫群，紅磚外牆、港灣與鐵道遺構呈現獨特港町風貌。可挑一至兩棟展館參觀，再沿外圍散步拍照；這是回京都前的最後一站，務必預留還車時間。",
    "舞鶴港とれとれセンター":"舞鶴港とれとれセンター兼具海鮮市場、用餐與地方物產功能，可以先看當日魚貨，再向店家詢問適合現吃的生魚片、烤物或海鮮丼。把它當作舞鶴港的生活型景點，而不只是早餐店；週末熱門時段停車與座位較忙，早到較從容。",
    "西本願寺":"西本願寺靠近京都站，境內寬敞，唐門、御影堂與阿彌陀堂展現桃山至江戶時代的寺院建築。12 月初可留意大銀杏與地面落葉；離境日只走核心區域，不因拍照延誤後續。",
    "京都御苑":"京都御苑腹地廣大，銀杏、楓樹與松林分散在苑內，是紅葉尾聲時的保險景點。選擇一段靠近入口的路線即可，不必環繞整座御苑；留意腳程與回京都站所需時間。",
    "下鴨神社＋糺之森":"糺之森的紅葉通常比京都市區多數寺院晚，12 月初仍可能保有黃紅色林蔭。從森林步道走向下鴨神社本殿，氣氛由自然轉為莊重；若前段延誤，就縮短森林散步，確保 14:00 左右回京都站。"
  };
  Object.entries(details).forEach(([n,v])=>{const s=find(n);if(s)s.fullDesc=v;});

  // D6 午餐與 D8 天橋立餐飲
  days[5].moreSpots.unshift(
    S("綾部站周邊簡餐／外帶","food","以停車方便、出餐穩定為主，避免拖延 15:00 入住。",{tags:["12/2 午餐首選"],fullDesc:"建議在梅松苑參觀後移動到綾部站周邊，用市營停車場停車，再選蕎麥、定食或麵包外帶。這天車程長，餐廳不必追名店；若龍穩寺停留較久，就在綾部買飯糰、麵包或便當上車，途中找安全休息點用餐。"}),
    S("道之驛 京丹波 味夢之里","food","高速道路順路、停車與外帶選擇多的穩健備案。",{tags:["12/2 外帶備案"],fullDesc:"若想提早完成午餐，可在京都縱貫道沿線的道之驛停靠，選丹波食材定食、黑豆或熟食便當。優點是停車容易、時間可控；缺點是會較早吃，後段前往綾部與京丹後仍需一段車程。"})
  );
  days[7].moreSpots.unshift(
    S("つるや食堂","food","府中側午餐首選，可嘗試宮津在地魚介丼。",{tags:["府中側","午餐"],fullDesc:"店在元伊勢籠神社一帶，適合走府中側與傘松公園時安排。可留意金樽鰯等宮津在地魚料理；漁獲與菜單會隨季節變動，12 月出發前再次確認營業與候位狀況。"}),
    S("AmaTerrace","food","傘松公園展望餐廳，適合不想下山再找餐廳的景觀型選擇。",{tags:["府中側","午餐"],fullDesc:"位於傘松公園，能一邊看天橋立一邊吃海鮮丼或輕食。餐點不是精緻會席路線，但動線最省力，適合把時間留給展望台與籠神社。"}),
    S("Cafe du Pin","food","文珠側運河景觀咖啡，供應日替午餐與輕食。",{tags:["文珠側","輕午餐"],fullDesc:"位於廻旋橋附近，大窗可看松並木與運河。若不想吃太重，可選日替餐、三明治或宮津沙丁魚類輕食，再接智恩寺與 View Land。"}),
    S("海鮮工房 はしだて物産・かにめし","food","天橋立站旁可外帶的蟹飯／海鮮便當選擇。",{tags:["外帶","蟹肉便當"],fullDesc:"你想到的『蟹肉便當』多半就是天橋立站附近販售的かにめし類商品：以蟹高湯炊飯再鋪蟹肉，適合時間緊或想帶到車上／飯店吃。數量可能有限，建議當天早些確認並預留購買時間。"}),
    S("HAMAKAZE Café","food","前往西舞鶴途中可在宮津吃晚餐或早晚餐。",{tags:["晚餐備案"],fullDesc:"位於道之驛海の京都宮津，停車方便，提供以當地魚介延伸的咖啡餐與洋風料理。若天橋立結束較晚，可先在宮津吃完再往西舞鶴；若已接近關店時間，改在西舞鶴車站周邊用餐。"}),
    S("天橋立酒店・冬季蟹料理","food","想正式吃蟹，可預約冬季限定午餐或會席。",{tags:["需預約","冬季"],fullDesc:"11 月至 3 月常有蟹御膳、蟹會席或蟹與寒鰤組合，通常需事前預約且用餐約兩小時。若選正式蟹餐，天橋立景點就只排一岸，避免午餐和觀景都趕。"})
  );

  // 圖片套用
  all().forEach(s=>{ if(imageMap[s.name]) s.img=imageMap[s.name]; });
  // 合併名稱的圖片別名
  const alias={"鞍馬寺（貴船視體力）":"鞍馬寺","保津川漂流":"保津川漂流"};
  Object.entries(alias).forEach(([n,k])=>{const s=find(n);if(s&&imageMap[k])s.img=imageMap[k];});
})();



/* ============ 京都內容深度修正（2026-08 v2） ============ */
(function deepenKyotoContent(){
  const all=()=>days.flatMap(d=>[...(d.spots||[]),...(d.moreSpots||[])]);
  const find=n=>all().find(s=>s.name===n);
  const dayTitles=[
    '關西機場 → 京都站',
    '京都北部／西北部・紅葉機動日',
    '東山 Area',
    '修學院 → 宇治 → 奈良',
    '奈良 → 龜岡 → 嵐山',
    '龜岡 → 南丹 → 綾部 → 京丹後',
    '京丹後海岸',
    '京丹後 → 金剛院 → 天橋立 → 舞鶴',
    '舞鶴 → 京都',
    '京都 → 關西機場'
  ];
  days.forEach((d,i)=>d.title=dayTitles[i]);

  // HARUKA 固定在食衣住；所有住宿統一排在食衣住最後。
  const haruka=find('HARUKA特急'); if(haruka){haruka.life=true;haruka.name='HARUKA特急';}
  all().filter(x=>x.cat==='hotel').forEach(x=>x.life=true);

  // 航班卡標題。
  const outbound=find('08:05 TPE → 11:35 KIX');
  if(outbound){outbound.desc='早班機由桃園前往關西機場，抵達後銜接京都市區交通。';outbound.customInfo='只有班機、入境、領取行李與交通都順利，且仍保有充足入場時間，才考慮加入東福寺。';}
  const inbound=find('19:00 KIX → 21:19 TPE');
  if(inbound){inbound.desc='晚間由關西機場返回桃園，下午需預留足夠機場移動時間。';inbound.customInfo='建議 15:00 前由京都站出發，並預留取行李、轉乘、報到與安檢時間。';}

  // 鞍馬＋貴船：把體力判斷放入評論與資訊。
  const kurama=all().find(x=>/^鞍馬寺/.test(x.name)||x.name==='鞍馬');
  if(kurama){
    kurama.name='鞍馬＋貴船';
    kurama.desc='由鞍馬山林走向貴船水岸，串起京都北部最具山氣的一段路線。';
    kurama.fullDesc='行程由鞍馬寺仁王門進入，沿杉林、石階與山腰伽藍逐步上行，抵達本殿金堂後可感受鞍馬山沉靜而清冽的氣氛。若繼續翻越木之根道前往貴船，後半段會轉為較自然的山徑與下坡，最後銜接貴船神社與水岸聚落。秋末日照時間短，山區體感也比市中心冷，鞋底抓地力與保暖層都要準備好。即使不完成全程，單走鞍馬寺往返也能保有完整的山寺體驗。';
    kurama.customInfo='貴船段視體力、山徑狀況與天色決定；雨後濕滑、膝蓋不適或接近日落時，從鞍馬原路折返，不勉強翻山。';
    kurama.hours='鞍馬寺通常 09:00–16:15；貴船神社參拜時間依季節公告';
    kurama.note='山區步道可能因天候或維護調整，出發前查看官方公告。';
    kurama.link='https://www.kuramadera.or.jp/'; kurama.linkLabel='鞍馬寺官方資訊';
  }

  // 每張卡：封面一句話；內文至少 3–4 句。戰術資訊放入評論與資訊。
  const tacticByName={
    '京都站周邊':'Porta、伊勢丹與車站建築都適合抵達日下午慢慢逛，不需要再跨區移動。',
    '東福寺':'只有班機、入境與交通都順利，且仍有足夠入場時間才考慮；否則直接留在京都站。',
    '真如堂':'清晨先看本堂與三重塔周邊，完成核心區域後就往永觀堂移動，避免為空景久候。',
    '永觀堂':'旺季入口排隊過長時，縮減天授庵或無鄰菴的停留，不犧牲午后休息時間。',
    '南禪寺':'時間有限時集中三門、法堂與水路閣，不必逐一收集所有塔頭。',
    '天授庵':'若入口隊伍明顯過長，可將時間留給無鄰菴或南禪寺本寺。',
    '無鄰菴':'熱門時段建議事先預約；預約不到時再以天授庵替代。',
    '奈良公園・浮見堂・飛火野':'清晨選一至兩處散步即可，利用較安靜的時段避開稍晚抵達的團體人潮。',
    '保津川漂流':'前一晚與當日早晨確認營運；若因雨、風、水位或停航取消，改搭 JR 前往嵐山。',
    '天龍寺':'抵達嵐山後先確認最後入場時間，再決定常寂光寺或寶筐院的停留長度。',
    '玉寶山 龍穩寺':'山路較窄，慢速行駛並依現場指示停車；不要為追晚楓延誤後段入住。',
    '五老天空塔':'上午能見度通常較穩定；低雲籠罩時不久候，直接把時間留給紅磚公園。',
    '西本願寺':'離境日只走核心區域，確保約 14:00 回京都站取行李。',
    '京都御苑':'選一段靠近出入口的路線即可，不環繞整座御苑。',
    '下鴨神社＋糺之森':'若前段延誤，縮短糺之森散步，確保準時返回京都站。'
  };
  const appendByCat={
    attraction:'此處的價值不只在單一拍照點，而在建築、庭園或周邊街區共同形成的空間感。建議依當天人潮與紅葉進度調整停留，不必為了收集所有角度反覆折返。出發前再核對官方開放資訊，秋季特別公開與最後入場時間可能另行調整。',
    activity:'這段體驗會受到天候、路況與日照時間影響，應把安全與移動餘裕放在完成度之前。穿著抓地力佳的鞋，並把保暖與防風層放在容易取用的位置。若現場條件不理想，採用備案仍能維持整天節奏。',
    food:'這間店適合作為當日動線中的用餐停靠點，而不是為了名店排隊犧牲主要行程。菜單、供應量與候位狀況可能隨季節改變，熱門品項也可能提早售完。建議在出發前確認營業日，必要時準備附近替代選項或外帶方案。',
    shopping:'這裡適合安排在傍晚、雨天或主要景點提早結束時順路停留。先列好想買的品項，能避免在店內停留過久或重複購買。營業樓層與休館日可能因商場公告調整，當天再確認最穩妥。',
    hotel:'這間住宿在行程中主要承擔休息、寄放行李與銜接隔日交通的功能。入住前確認停車、早餐、寄放行李與最晚報到方式，能減少移動日的不確定性。抵達後先完成必要手續，再決定是否追加附近散步或用餐。',
    transport:'這段交通是當日行程的重要銜接，班次與月台資訊應以營運單位當日公告為準。建議保留轉乘、購票與尋找月台的緩衝，不把行程排到剛好銜接。大型行李較多時，優先選擇少轉乘且能保留座位的方案。'
  };
  function sentenceCount(t){return (String(t||'').match(/[。！？]/g)||[]).length;}
  all().forEach((spot)=>{
    if(!spot.desc) spot.desc=`${spot.name}是本日動線中的一站。`;
    spot.desc=String(spot.desc).split(/[。！？]/)[0].trim()+'。';
    let full=String(spot.fullDesc||spot.desc).trim();
    if(sentenceCount(full)<3) full += appendByCat[spot.cat]||appendByCat.attraction;
    if(sentenceCount(full)<4) full += '實際停留長度仍以當天體力、交通與現場狀況彈性調整。';
    spot.fullDesc=full;
    if(tacticByName[spot.name]) spot.customInfo=tacticByName[spot.name];
  });

  // 開放時間、公休日與官方資訊（季節特別公開仍以官網公告為準）。
  const info={
    '東福寺':['通常 09:00–16:00；秋季可能延長','秋季無固定休，但部分區域可能因法要限制','https://tofukuji.jp/','東福寺官方網站'],
    '三千院＋大原散步':['3–10月通常 09:00–17:00；11月約 08:30–17:00；12–2月約 09:00–16:30','全年開放，法務或天候可能調整','https://www.sanzenin.or.jp/','三千院官方網站'],
    '真如堂':['境內通常 06:00–17:00；庭園與堂內拝観另有時間','法要時可能停止堂內參觀','https://shin-nyo-do.jp/','真如堂官方網站'],
    '永觀堂':['通常 09:00–17:00，最後入場約 16:00；秋季寺寶展另公告','寺務或特別活動時可能調整','https://www.eikando.or.jp/','永觀堂官方網站'],
    '南禪寺':['境內自由；方丈庭園通常 08:40–16:30／17:00 依季節','年末可能停止部分拝観','https://www.nanzenji.or.jp/','南禪寺官方網站'],
    '無鄰菴':['通常 09:00–17:00，最後入場約 16:30','12/29–12/31 等維護日可能休園','https://murin-an.jp/','無鄰菴官方網站'],
    '詩仙堂':['通常 09:00–17:00，最後入場約 16:45','5/23 丈山忌等可能停止一般拝観','https://kyoto-shisendo.net/','詩仙堂官方網站'],
    '圓光寺':['通常 09:00–17:00；秋季特別拝観可能採預約制','行事與秋季管制依公告','https://www.enkouji.jp/','圓光寺官方網站'],
    '曼殊院':['通常 09:00–17:00，最後入場約 16:30','法要與維護時可能休止','https://www.manshuinmonzeki.jp/','曼殊院官方網站'],
    '平等院':['庭園通常 08:30–17:30；鳳翔館 09:00–17:00；鳳凰堂內部另排隊','全年開放，內部拝観可能臨時停止','https://www.byodoin.or.jp/','平等院官方網站'],
    '宇治上神社':['境內參拜通常約 09:00–16:30','祭典或維護時調整','https://www.kyoto-uji-kankou.or.jp/tourism/ujigamijinja/','宇治市觀光資訊'],
    '興聖寺':['通常約 09:00–16:00','法要時可能限制拝観','https://www.uji-koushouji.jp/','興聖寺官方網站'],
    '保津川漂流':['通常 09:00 起依季節班次出航；冬季班表另行公告','惡劣天候、增水、強風或河川狀況不佳時停航','https://www.hozugawakudari.jp/','保津川下り官方網站'],
    '天龍寺':['庭園通常 08:30–17:00，最後入場約 16:50','法要與行事時部分區域可能限制','https://www.tenryuji.com/','天龍寺官方網站'],
    '常寂光寺':['通常 09:00–17:00，最後入場約 16:30','寺務與天候時可能調整','https://www.jojakko-ji.or.jp/','常寂光寺官方網站'],
    '寶筐院':['通常 09:00–16:00；秋季可能延長','寺務與維護時可能休止','https://www.houkyouin.jp/','寶筐院官方網站'],
    '大本本部 梅松苑':['園區參觀時間與導覽依官方公告','祭典、行事或宗教活動時可能限制','https://oomoto.or.jp/','大本官方網站'],
    '道之驛 てんきてんき丹後':['商店通常約 09:00–17:00；餐飲時段另見公告','冬季與臨時休館日依官方公告','https://tenkitenki-mura.jp/','官方網站'],
    '金剛院':['通常約 09:00–16:00','寺務與冬季天候時可能調整','https://www.kongoin.or.jp/','金剛院官方網站'],
    '府中側：籠神社＋傘松公園':['籠神社參拜與傘松公園纜車時間依季節公告','纜車可能因強風或維護停駛','https://www.amano-hashidate.com/','傘松公園官方資訊'],
    '文珠側：View Land＋智恩寺':['View Land 通常約 09:00–17:00，依季節調整','單軌／吊椅可能因強風或維護停駛','https://www.viewland.jp/','View Land 官方網站'],
    '五老天空塔':['通常約 09:00–17:00，季節可能調整','惡劣天候與維護時休館','https://goro-sky.jp/','五老天空塔官方網站'],
    '舞鶴港とれとれセンター':['通常約 09:00–17:00','星期三等休館日依月曆公告，旺季可能變更','https://toretore.org/','官方網站'],
    '西本願寺':['境內通常清晨開門至傍晚，季節時間不同','法要期間可能限制部分堂宇','https://www.hongwanji.kyoto/','西本願寺官方網站'],
    '京都御苑':['苑地全天開放；休憩設施另有時間','苑內設施休館日依各設施公告','https://fng.or.jp/kyoto/','京都御苑官方網站'],
    '下鴨神社＋糺之森':['境內通常清晨至傍晚參拜，授與所時間另行公告','祭典時動線與時間可能調整','https://www.shimogamo-jinja.or.jp/','下鴨神社官方網站'],
    'HARUKA特急':['依 JR 西日本當日班表','運休與延誤依 JR 西日本公告','https://www.westjr.co.jp/global/tc/travel/shopping/access/train.html','HARUKA 官方資訊']
  };
  Object.entries(info).forEach(([n,v])=>{const x=find(n);if(x){x.hours=v[0];x.note=v[1]+'；紅葉季、特別公開與最後入場以官網當日公告為準。';x.link=v[2];x.linkLabel=v[3];}});

  // 每日穿搭改為依地區與活動差異化。
  const wears=[
    '機場與車站溫差大：薄發熱衣＋針織層＋可收納外套，鞋子以長時間移動舒適為主。',
    '大原／高雄／鞍馬皆比市中心冷：保暖內層、薄羽絨、防風外套、圍巾、手套與抓地鞋。',
    '東山步行量大：排汗內層＋毛衣＋輕羽絨，午後回市區可脫層，鞋底需防滑。',
    '洛北早晨偏冷、宇治午後較溫和：洋蔥式三層穿搭，帶輕便雨具並避免厚重手提包。',
    '奈良清晨與保津川船上體感冷：保暖帽、圍巾、手套、防風外層與不怕濺水的鞋。',
    '自駕移動日避免過厚外套妨礙駕駛；下車參拜時再加羽絨，車內準備暖暖包與乾襪。',
    '海岸風強且濕度高：防風防潑水外套、保暖中層、帽子與可固定的圍巾，避免長裙拖地。',
    '寺院石階與展望台海風並存：抓地鞋、薄羽絨加防風殼，車上備一套乾燥保暖層。',
    '市場與紅磚公園較平坦，但五老岳風大：市區層次穿搭外加防風外套，拍照時再脫厚層。',
    '離境日以輕便可穿脫為主：發熱衣＋針織＋薄羽絨，隨身包保留圍巾並方便機上收納。'
  ];
  const lifeInfo={
    '京都站周邊':['Porta 店舖多為 10:00–20:30 左右；伊勢丹多為 10:00–20:00','各樓層與餐飲店公休日不同'],
    '新風館＋LE LABO':['商場多為 11:00–20:00；餐飲店可能延長','不定休，以新風館公告為準'],
    'BAL':['通常 11:00–20:00','不定休，以館方公告為準'],
    'Kyoto LOFT':['通常約 10:00–20:00','依所在商場休館日調整'],
    'KIDDY LAND':['通常約 11:00–20:00','不定休，以分店公告為準'],
    'SOU・SOU 一条街':['多數店舖通常約 12:00–20:00','各店公休日不同'],
    'Richmond Hotel 京都站':['入住與退房依訂房方案，常見為 14:00／11:00','櫃檯全年服務'],
    'Daiwa Roynet Hotel 烏丸四條':['入住與退房依訂房方案，常見為 14:00／11:00','櫃檯全年服務'],
    'Daiwa Roynet Hotel 奈良':['入住與退房依訂房方案，常見為 14:00／11:00','櫃檯全年服務'],
    'Route Inn 龜岡':['入住與退房依訂房方案，常見為 15:00／10:00','櫃檯全年服務'],
    'シーサイド佐竹':['入住與退房依方案，晚餐入住時間須特別確認','休館日依旅館公告'],
    'HOTEL＆湖邸 艸花':['入住與退房依方案，晚餐入住時間須特別確認','休館日依旅館公告'],
    'Route Inn 西舞鶴':['入住與退房依訂房方案，常見為 15:00／10:00','櫃檯全年服務']
  };
  Object.entries(lifeInfo).forEach(([n,v])=>{const x=find(n);if(x){x.hours=x.hours||v[0];x.note=x.note||v[1]+'；請以預約確認信或官方公告為準。';}});
  days.forEach((d,i)=>d.wear=wears[i]);
})();


/* ============ 最終內容整理：每日標題、簡介與住宿名稱 ============ */
(function finalizeKyotoCopy(){
  const titles=[
    ['入洛日和','楓都初章・京都駅前的暖色序曲'],
    ['楓信未定','山里錦秋・三境擇一的紅葉物語'],
    ['東山有秋','東山錦繡・古寺與庭園的秋日長卷'],
    ['茶里鹿影','洛北茶旅・由修學院走向宇治奈良'],
    ['一川嵐色','川舟嵐影・保津川與嵯峨野的一日'],
    ['山盡見海','丹波晚楓・穿越山寺奔向日本海'],
    ['海辺無事','潮騷慢泊・丹後海岸的靜謐休日'],
    ['橋立暮景','海之京都・金剛院與天橋立遠景'],
    ['港町別章','港町餘韻・舞鶴紅磚與灣景之晨'],
    ['餘白京都','京洛惜別・銀杏晚楓與歸途']
  ];
  days.forEach((d,i)=>{d.title=titles[i][0];d.dayDesc=titles[i][1];});
  const all=days.flatMap(d=>[...(d.spots||[]),...(d.moreSpots||[])]);
  all.forEach(s=>{ if(s.name==='Daiwa Roynet Hotel 京都四條烏丸'||s.name==='大和魯內飯店 京都四條烏丸')s.name='Daiwa Roynet Hotel 烏丸四條'; });

  const advice=/建議|避免|若|如果|只有|不必|優先|確認|視當|依當|人潮|排隊|預留|出發前|當日|現場|可刪|機動|體力|時間不足|不要|適合.*時|再決定/;
  const factualTail={
    attraction:['空間由建築、庭園與周邊景觀共同構成，步行過程能看到不同角度與層次。','秋末的光線、葉色與落葉狀態會讓同一處景觀呈現不同表情。'],
    activity:['體驗的重點在沿途地形、自然環境與移動過程，而不只在抵達終點。','路線會隨季節呈現不同景觀，秋末尤其能感受到山林或水岸的色彩變化。'],
    food:['餐點以店家代表料理與當地食材為主，適合作為認識區域飲食風格的一站。','店內氛圍與菜單會隨季節調整，秋冬通常能見到較溫暖厚實的料理。'],
    shopping:['店內集合生活雜貨、設計選品或地方特色商品，能補充旅行中的實用品與伴手禮。','不同樓層或品牌各有主題，整體比單一專賣店更容易一次比較。'],
    hotel:['住宿提供旅途中休息、整理行李與銜接翌日行程的基地。','客房與公共空間的設備依房型而異，訂房內容以確認信所列方案為準。'],
    transport:['這段交通串接機場、城市或景點，是當日移動的重要環節。','車廂、座位與行李空間依班次與車型而異，實際運行以營運單位公告為準。']
  };
  all.forEach(s=>{
    const sentences=String(s.fullDesc||'').split(/(?<=[。！？])/).map(x=>x.trim()).filter(Boolean);
    const facts=[],tips=[];
    sentences.forEach(x=>(advice.test(x)?tips:facts).push(x));
    if(tips.length){ const moved=tips.join(''); if(!String(s.customInfo||'').includes(moved)) s.customInfo=[s.customInfo,moved].filter(Boolean).join('<br>'); }
    const tails=factualTail[s.cat]||factualTail.attraction;
    while(facts.length<3) facts.push(tails[(facts.length)%tails.length]);
    s.fullDesc=facts.slice(0,4).join('');
  });
})();

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

/* 內建「評論與資訊」也可由使用者修改或刪除。undefined=沿用預設、null=隱藏、字串=自訂版本。 */
let infoOverrideStore = JSON.parse(localStorage.getItem('kyoto_info_overrides') || '{}');
function persistInfoOverrides(){ safeSetItem('kyoto_info_overrides', infoOverrideStore); }
function currentBuiltInInfo(key, fallback){
  return Object.prototype.hasOwnProperty.call(infoOverrideStore,key) ? infoOverrideStore[key] : fallback;
}
function editBuiltInInfo(key, fallback){
  const current=currentBuiltInInfo(key,fallback);
  const next=prompt('編輯這筆評論與資訊', current==null?'':current);
  if(next===null)return;
  const value=next.trim();
  infoOverrideStore[key]=value||null;
  persistInfoOverrides(); renderDayContent();
  setTimeout(()=>document.getElementById('spot-card-'+key)?.classList.add('open'),50);
}
function deleteBuiltInInfo(key){
  if(!confirm('要刪除這筆預設評論與資訊嗎？'))return;
  infoOverrideStore[key]=null; persistInfoOverrides(); renderDayContent();
  setTimeout(()=>document.getElementById('spot-card-'+key)?.classList.add('open'),50);
}

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
function editNote(key, noteIdx) {
  if(!notesStore[key] || typeof notesStore[key][noteIdx] === 'undefined') return;
  const next = prompt('編輯評論與資訊', notesStore[key][noteIdx]);
  if(next === null) return;
  const text = next.trim();
  if(!text) return;
  notesStore[key][noteIdx] = text;
  persistNotes();
  renderDayContent();
  setTimeout(()=>{ const card=document.getElementById('spot-card-'+key); if(card) card.classList.add('open'); },50);
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
    flushPendingDayRender();
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
let hiddenFixedSpotsStore = JSON.parse(localStorage.getItem('kyoto_hidden_fixed_spots')) || {};
function persistHiddenFixedSpots(){ safeSetItem('kyoto_hidden_fixed_spots', hiddenFixedSpotsStore); }
function hideFixedSpot(dayIdx,key){ if(!confirm('要從這一天隱藏此項目嗎？之後可用「還原預設項目」恢復。'))return; if(!hiddenFixedSpotsStore[dayIdx])hiddenFixedSpotsStore[dayIdx]=[]; if(!hiddenFixedSpotsStore[dayIdx].includes(key))hiddenFixedSpotsStore[dayIdx].push(key); persistHiddenFixedSpots(); renderDayContent(); updateSpotCount(); }
function restoreFixedSpots(dayIdx){ delete hiddenFixedSpotsStore[dayIdx]; persistHiddenFixedSpots(); renderDayContent(); updateSpotCount(); }
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
  const hidden = new Set(hiddenFixedSpotsStore[dayIdx] || []);
  const allFixed = d.spots.map((s,i)=>({spot:s, key:`d${dayIdx}-m${i}`, fixedMeta:{dayIdx}}))
    .concat((d.moreSpots||[]).map((s,i)=>({spot:s, key:`d${dayIdx}-s${i}`, fixedMeta:{dayIdx}})))
    .filter(o=>!hidden.has(o.key));
  const allCustom = customSpots.map((s,i)=>({spot:s, key:`d${dayIdx}-c${i}`, customMeta:{dayIdx, i}}));
  const belongs=(o)=> listType==='life' ? (o.spot.life || cats.includes(o.spot.cat)) : (!o.spot.life && cats.includes(o.spot.cat));
  const result=allFixed.filter(belongs).concat(allCustom.filter(belongs));
  if(listType==='life') result.sort((a,b)=>(a.spot.cat==='hotel')-(b.spot.cat==='hotel'));
  return result;
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

function spotCardHTML(spot, key, isMainSpot, customMeta, orderInfo, fixedMeta){
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
  if(spot.hours) infoBits.push(`<div class="info-item"><div class="k">營業／開放時間</div><div class="v info-hours">${spot.hours}</div></div>`);
  if(spot.note) infoBits.push(`<div class="info-item full-w important-info"><div class="k">重要提點／門票</div><div class="v">${spot.note}</div></div>`);
  
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
  let notesListHTML = userNotes.length ? userNotes.map((n,ni)=>`<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-top:6px; padding-top:6px; border-top:1px dashed rgba(0,0,0,0.12);"><span style="flex:1; white-space:pre-line;">${n}</span><span class="note-actions"><button onclick="event.stopPropagation(); editNote('${idx}', ${ni})" title="編輯">✎</button><button onclick="event.stopPropagation(); deleteNote('${idx}', ${ni})" title="刪除">✕</button></span></div>`).join('') : '';
  const builtInInfo = currentBuiltInInfo(idx, spot.customInfo || null);
  let displayInfo = '';
  if (builtInInfo) displayInfo += `<div class="built-in-info-row"><span class="built-in-info-text">${builtInInfo}</span><span class="note-actions built-in-actions"><button onclick="event.stopPropagation(); editBuiltInInfo('${idx}', ${JSON.stringify(spot.customInfo||'')})" title="編輯這筆">✎</button><button onclick="event.stopPropagation(); deleteBuiltInInfo('${idx}')" title="刪除這筆">✕</button></span></div>`;
  if (notesListHTML) displayInfo += `<div class="user-info-list" style="margin-top:${builtInInfo ? '8px' : '0'};"><span class="user-info-label">✏️ 您新增的資訊：</span>${notesListHTML}</div>`;

  let customInfoBox = '';
  if (displayInfo) {
    customInfoBox = `<div class="custom-info-box" onclick="event.stopPropagation()"><div class="custom-info-heading"><b>💬 評論與資訊</b><button class="custom-info-add" onclick="toggleEditNote(event, '${idx}')">＋ 新增</button></div>${displayInfo}</div>`;
  }

  let noteEditArea = `<div class="note-edit-area" style="margin-top:10px; display:none;" id="edit-note-${idx}" onclick="event.stopPropagation()"><textarea id="note-input-${idx}" placeholder="新增一筆攻略、必點菜單或提醒...（可重複新增多筆）" style="width:100%; border:1px solid var(--line); border-radius:8px; padding:8px; font-size:12px; font-family:inherit; resize:vertical; min-height:60px; outline:none; margin-bottom:6px;"></textarea><div style="display:flex; gap:6px;"><button onclick="addNote('${idx}')" style="padding:6px 14px; font-size:11px; background:var(--blue); color:#fff; border:none; border-radius:6px; cursor:pointer; font-weight:700;">💾 新增這筆</button><button onclick="toggleEditNote(event, '${idx}')" style="padding:6px 14px; font-size:11px; background:#f2f3ec; color:var(--ink); border:none; border-radius:6px; cursor:pointer; font-weight:700;">收合</button></div></div>${!displayInfo ? `<button class="btn-note-toggle" onclick="toggleEditNote(event, '${idx}')" style="background:transparent; border:1px dashed #c1c8cf; border-radius:999px; padding:6px 12px; font-size:11.5px; color:#7A5A42; cursor:pointer; font-family:inherit; margin-top:6px; margin-bottom:10px;" id="btn-note-${idx}">➕ 新增評論與資訊</button>` : ''}`;

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
  const fixedDelBtn = fixedMeta ? `<button onclick="event.stopPropagation(); hideFixedSpot(${fixedMeta.dayIdx}, '${idx}')" style="background:#fff0ec; color:#AD1E17; border:none; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap;">➖ 刪減此項</button>` : '';
  const delBtn = customMeta ? `<button onclick="event.stopPropagation(); delCustomSpot(${customMeta.dayIdx}, ${customMeta.i})" style="background:#fff0ec; color:#c1502f; border:none; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap;">🗑️ 刪除此景點</button>` : '';
  const editBtn = customMeta ? `<button onclick="event.stopPropagation(); toggleEditSpot('${idx}')" style="background:#eef3fb; color:var(--blue); border:none; padding:4px 10px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; white-space:nowrap;">✏️ 編輯簡介</button>` : '';
  const customBar = (customMeta || orderInfo || fixedMeta) ? `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px; flex-wrap:wrap;"><span style="display:flex; gap:6px; flex-wrap:wrap;">${customMeta ? `<span class="badge" style="background:#eef3fb; color:var(--blue);">${genLabel}</span>` : ''}</span><span style="display:flex; gap:6px; flex-wrap:wrap;">${orderBtns}${editBtn}${delBtn}${fixedDelBtn}</span></div>` : '';
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

  let mainSpotsHTML = mainList.map(o=>spotCardHTML(o.spot, o.key, true, o.customMeta, {dayIdx:activeDay, listType:'main'}, o.fixedMeta)).join('');
  if(!mainSpotsHTML) mainSpotsHTML = '<div class="empty">此區域今天暫無排定主要亮點。</div>';

  let secondaryCardsHTML = lifeList.map(o=>spotCardHTML(o.spot, o.key, false, o.customMeta, {dayIdx:activeDay, listType:'life'}, o.fixedMeta)).join('');
  if(!secondaryCardsHTML) secondaryCardsHTML = '<div class="empty">此區域今天暫無排定食衣住項目，歡迎在下方新增您的私房景點。</div>';

  const addSpotFormHTML = `
    <div class="section-card" style="margin-top:4px;">
      <h3 style="margin:0 0 10px;">✨ 新增景點／食衣住項目</h3>
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
      <div class="region">【Day ${d.dayNum}｜${d.date}】<br>${d.title}</div>
      ${d.drive ? `<div class="drive-info">${d.drive}</div>` : ''}
      ${d.gas ? `<div class="gas-info">${d.gas}</div>` : ''}
      ${d.dayDesc ? `<h2>${d.dayDesc}</h2>` : ''}
      <div class="weather-strip"><div class="ico">${d.weatherIco}</div><div class="txt"><b style="font-family:'Zen Kaku Gothic New', sans-serif; font-size:14px;">${d.enRegion}</b><br><span style="font-size:11.5px; opacity:0.85;">${d.wear}</span></div></div>
      <div class="stay-line">🏡 ${[...(d.spots||[]),...(d.moreSpots||[])].filter(s=>s.cat==='hotel').map(s=>s.name).join('、') || '返家／無住宿'}</div>
    </div>
    <div id="day-card-${activeDay}">
      <div class="spot-subtabs"><button class="spot-subtab${curSubTab==='main'?' active':''}" data-type="main" onclick="switchSubTab(${activeDay}, 'main')">📌 主要亮點 (${mainList.length})</button><button class="spot-subtab${curSubTab==='more'?' active':''}" data-type="more" onclick="switchSubTab(${activeDay}, 'more')">🍴 食衣住 (${lifeList.length})</button><button class="spot-subtab${curSubTab==='routemap'?' active':''}" data-type="routemap" onclick="switchSubTab(${activeDay}, 'routemap')">🗺️ 路線圖${routeMaps.length ? ` (${routeMaps.length})` : ''}</button></div>
      <div class="subtab-content${curSubTab==='main'?' active':''}" data-type="main">${mainSpotsHTML}<button onclick="switchSubTab(${activeDay}, 'more'); setTimeout(()=>document.getElementById('newSpotName-${activeDay}')?.focus(),80)" class="restore-default-btn">＋ 新增景點／食衣住項目</button></div>
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
    el.innerHTML = `<div class="weather-error"><span>${CITIES[k].label}：${reason}</span><button onclick="fetchWeatherFor('${k}', 0)">🔄 重試</button></div>`;
    return;
  }

  const cw = data.current;
  const [ico, desc] = wmoInfo(cw.weather_code);
  const temp = Math.round(cw.temperature_2m);
  const wind = cw.wind_speed_10m;
  const precip = cw.precipitation;
  const sr = data.daily && data.daily.sunrise ? data.daily.sunrise[0].substring(11, 16) : '--:--';
  const ss = data.daily && data.daily.sunset ? data.daily.sunset[0].substring(11, 16) : '--:--';
  const uvRaw = data.daily && data.daily.uv_index_max ? Number(data.daily.uv_index_max[0]) : null;
  const uvText = uvRaw==null ? '未知' : uvRaw < 3 ? '低' : uvRaw < 6 ? '中' : uvRaw < 8 ? '高' : '很高';
  const tip = getDynamicTip(temp, cw.weather_code);
  const badgeHtml = entry.stale
    ? `<span class="live-badge stale"><span class="dot"></span>快取${entry.fetchedAt ? '・' + new Date(entry.fetchedAt).toLocaleString('zh-TW',{hour12:false, month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : ''}</span>`
    : `<span class="live-badge"><span class="dot"></span>即時</span>`;

  const MW_TIMES = { Kyoto:'市區各寺院轉色速度不同，東山與洛北請分開判斷。', Ohara:'山區通常比京都市區更早轉色，也更早落葉。', Nara:'奈良公園多為銀杏、櫸木與楓葉交錯，晚秋色調較柔和。', Kameoka:'保津峽約在 11 月中下旬進入觀賞期，風雨後落葉速度會加快。', Kyotango:'海岸以海景為主，紅葉集中在山寺與內陸路段。', Amanohashidate:'可留意成相寺與府中側山區的晚楓。', Maizuru:'金剛院可能保有晚楓或落葉紅毯，紅磚區則以港景為主。' };

  el.innerHTML = `
    <div class="weather-city-card">
      <div class="weather-primary">
        <div class="weather-place">
          <strong>${CITIES[k].label}</strong>
          ${badgeHtml}
        </div>
        <div class="weather-main">
          <span class="weather-icon">${ico}</span>
          <div><b>${desc}</b><strong>${temp}°C</strong></div>
        </div>
      </div>
      <div class="weather-metrics" aria-label="氣象數據">
        <span>💨 ${wind} km/h</span>
        <span>🌧️ ${precip} mm</span>
        <span>☀️ UV ${uvText}</span>
      </div>
      <div class="weather-sun-row">
        <span>🌅 日出 ${sr}</span>
        <span>🌇 日落 ${ss}</span>
      </div>
      <div class="weather-travel-note"><b>🍁 紅葉提醒</b><span>${MW_TIMES[k]}</span></div>
      <div class="weather-wear-note"><b>🧥 穿搭</b><span>${tip}</span></div>
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
  {ic:'✈️',t:'去程航班 TPE → KIX',s:'11/27 08:05 → 11:35',chip:'待確認',link:'',img:null,confirmed:false},
  {ic:'🚆',t:'HARUKA特急',s:'11/27 KIX → 京都站',chip:'待確認',link:'',img:null,confirmed:false},
  {ic:'🏨',t:'京都站 Richmond',s:'11/27、12/5',chip:'住宿',link:'',img:null,confirmed:false},
  {ic:'🏨',t:'Daiwa Roynet Hotel 烏丸四條',s:'11/28–11/29',chip:'住宿',link:'',img:null,confirmed:false},
  {ic:'🏨',t:'Daiwa Roynet Hotel 奈良',s:'11/30',chip:'住宿',link:'',img:null,confirmed:false},
  {ic:'🏨',t:'Route Inn 龜岡',s:'12/1',chip:'住宿',link:'',img:null,confirmed:false},
  {ic:'🏨',t:'シーサイド佐竹',s:'12/2',chip:'住宿',link:'',img:null,confirmed:false},
  {ic:'🏨',t:'HOTEL＆湖邸 艸花',s:'12/3',chip:'住宿',link:'',img:null,confirmed:false},
  {ic:'🏨',t:'Route Inn 西舞鶴',s:'12/4',chip:'住宿',link:'',img:null,confirmed:false},
  {ic:'🚗',t:'奈良租車／京都還車',s:'12/1–12/5・確認冬季胎',chip:'待確認',link:'',img:null,confirmed:false},
  {ic:'🚣',t:'保津川漂流',s:'12/1・依天候與營運確認',chip:'機動',link:'',img:null,confirmed:false},
  {ic:'✈️',t:'回程航班 KIX → TPE',s:'12/6 19:00 → 21:19',chip:'待確認',link:'',img:null,confirmed:false}
];
function mergeDocsWithDefaults(value){
  const existing=normalizeStructuredList('kyoto_docs', Array.isArray(value)?value:[]);
  const map=new Map(existing.map(d=>[String(d.t||'').trim(),d]));
  defaultDocsData.forEach(def=>{
    const key=String(def.t||'').trim();
    map.set(key,map.has(key)?{...def,...map.get(key)}:{...def});
  });
  return [...map.values()];
}
let docsData = mergeDocsWithDefaults(JSON.parse(localStorage.getItem('kyoto_docs')||'null'));
/* 把舊版缺少的住宿卡補回本機／雲端。 */
setTimeout(()=>persistDocs(),0);
function persistDocs(){ safeSetItem('kyoto_docs', docsData); }

function renderDocsList() {
  const wrap = document.getElementById('docsListWrap');
  if(!wrap) return;
  wrap.innerHTML = docsData.map((d, i) => `
    <article class="voucher-card ${d.confirmed?'is-confirmed':''}">
      <div class="voucher-main" onclick="handleDocClick(${i})">
        <div class="voucher-icon">${d.ic}</div>
        <div class="voucher-copy">
          <div class="voucher-title">${d.t}</div>
          <div class="voucher-sub">${d.s}</div>
        </div>
      </div>
      <div class="voucher-actions">
        <button class="voucher-status" onclick="toggleDocConfirmed(${i})">${d.confirmed?'已確認':(d.chip||'待確認')}</button>
        ${d.img ? `<button class="voucher-upload has-file" onclick="openAttachModal('${d.img}')">📱 顯示截圖</button>
                   <button class="voucher-remove" onclick="removeDocImg(${i})">移除截圖</button>`
                : `<button class="voucher-upload" onclick="document.getElementById('docFile-${i}').click()">📎 上傳截圖</button>`}
        <input type="file" id="docFile-${i}" accept="image/*" style="display:none" onchange="handleDocPhoto(event, ${i})">
      </div>
    </article>
  `).join('');
}
function toggleDocConfirmed(i){ docsData[i].confirmed=!docsData[i].confirmed; persistDocs(); renderDocsList(); }
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

/* ============ 路線摘要：可收合 ============ */
function toggleRouteSummary(force){
  const card = document.getElementById('routeSummaryCard');
  const heading = document.getElementById('routeSummaryHeading');
  if(!card) return;
  const collapsed = typeof force === 'boolean' ? force : !card.classList.contains('collapsed');
  card.classList.toggle('collapsed', collapsed);
  if(heading) heading.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  try{ localStorage.setItem('kyoto_route_summary_collapsed', collapsed ? '1' : '0'); }catch(e){}
}
(function initRouteSummaryState(){
  let collapsed = false;
  try{ collapsed = localStorage.getItem('kyoto_route_summary_collapsed') === '1'; }catch(e){}
  document.addEventListener('DOMContentLoaded', () => toggleRouteSummary(collapsed));
})();

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



/* ============ 餐飲內容精修：每間店改為具體介紹，不再套用通用句型 ============ */
(function refineKyotoFoodCopy(){
  const all=()=>days.flatMap(d=>[...(d.spots||[]),...(d.moreSpots||[])]);
  const copy={
    '京豆富不二乃':{
      desc:'京都站伊勢丹內的豆腐料理專門店，以京豆腐、湯葉與豆乳料理組成套餐。',
      fullDesc:'京豆富不二乃位於 JR 京都伊勢丹，以京都藤野豆腐的豆腐、湯葉與豆乳製品為核心。套餐通常會把冷豆腐、湯豆腐、田樂、湯葉或豆乳甜點依不同形式組合，口味清雅但品項豐富。座位在車站百貨內，抵達日不用再拖行李跨區移動，特別適合想吃一頓安穩京都料理的人。它不是追求濃重調味的店，而是用大豆香氣與細緻口感呈現京都家常料理的溫和層次。'
    },
    '名代とんかつ かつくら':{
      desc:'京都起家的炸豬排店，主打厚切豬排、現磨芝麻醬與麥飯高麗菜。',
      fullDesc:'名代とんかつ かつくら是京都發跡的炸豬排品牌，特色是麵衣薄而酥、肉排仍保有水分。上桌前可自行研磨芝麻，再加入店家的濃口或甘口醬汁調整味道。套餐通常搭配麥飯、味噌湯與高麗菜，適合剛抵達京都、需要一頓飽足但不必研究菜單太久的晚餐。京都站店交通方便，尖峰時段容易候位，可把它視為車站內的可靠選項而非一定要久排的名店。'
    },
    '京都鶏白湯そば 純':{
      desc:'以濃厚雞白湯為主角的拉麵店，湯頭乳白滑順並搭配雞叉燒。',
      fullDesc:'京都鶏白湯そば 純以長時間熬煮的雞白湯為主軸，湯色乳白、質地濃稠，卻比豚骨少一點厚重油脂感。麵體與雞叉燒會承接湯汁，常見配料包含洋蔥、蔥與調味蛋，讓濃湯多一些清爽層次。它適合抵達日想快速吃熱食、又不想安排正式會席的情況。店面座位與供應數量有限，若現場排隊太長，可直接改吃京都站 Porta 內其他麵店。'
    },
    '京都天ぷら天天天':{
      desc:'以現炸天婦羅搭配季節食材的料理店，適合安排較完整的晚餐。',
      fullDesc:'京都天ぷら天天天以現點現炸的天婦羅為核心，會依季節使用蔬菜、魚介與京都食材。天婦羅分批上桌，可依食材選擇鹽、天露或檸檬，口感比一次盛盤更能維持酥脆。秋冬菜色通常會出現根菜、菇類與較有旨味的魚介，適合在紅葉行程後慢慢用餐。這類店的價值在炸製節奏與食材狀態，建議預約並保留完整用餐時間，不要塞在需要趕路的晚上。'
    },
    '京の焼肉処 弘':{
      desc:'京都在地燒肉品牌，擅長以多部位和牛與內臟拼盤呈現肉質差異。',
      fullDesc:'京の焼肉処 弘是京都常見的在地燒肉品牌，菜單從赤身、霜降部位到內臟都有完整選擇。適合多人點拼盤共享，用不同厚度與油脂比例比較各部位，而不是只集中點高霜降肉。部分分店由町家改造，空間較有京都氣氛，但各店菜單與座位型態不完全相同。晚餐熱門時段建議先訂位，並確認預約的是哪一家分店，避免跑錯地址。'
    },
    '空蟬亭':{
      desc:'以熟成豬肉與炸豬排為特色的小店，重點是肉質甜味與低溫火候。',
      fullDesc:'空蟬亭以豬肉料理與炸豬排聞名，會依肉品部位與熟成狀態調整炸製方式。成品通常保留柔嫩中心與細緻肉汁，和傳統全熟、厚重醬汁型炸豬排的方向不同。店內座位不多，用餐節奏偏向專心品嘗主菜，而不是快速翻桌的大型餐廳。若想安排這家，建議事前確認當日供應與預約方式，避免到了現場才發現售完。'
    },
    'DRAGON BURGER':{
      desc:'東福寺附近的京都風漢堡店，把九條蔥、柴漬等元素放進漢堡。',
      fullDesc:'DRAGON BURGER 位於東福寺周邊，特色是以漢堡形式結合京都食材與日式調味。菜單常見九條蔥、柴漬、柚子或味噌等元素，整體仍保留牛肉漢堡的飽足感。店面適合從東福寺或東山行程中間停下來吃一頓，不需要再進市中心找午餐。紅葉旺季周邊人流大，若候位過久，應以不影響永觀堂與南禪寺入場時間為優先。'
    },
    '祇園辻利':{
      desc:'祇園老字號宇治茶店，可品嘗抹茶甜點、茶飲與季節限定品。',
      fullDesc:'祇園辻利以宇治茶與抹茶製品為主，從單純茶飲到聖代、霜淇淋與伴手禮都有選擇。抹茶甜點的重點在茶味與苦甜平衡，不只是鮮綠色外觀。若只想補充體力，可外帶茶飲或霜淇淋；想坐下休息則要把候位時間算進去。祇園店在觀光旺季經常排隊，不必為了吃到指定品項犧牲東山主要景點。'
    },
    '辻利兵衛本店':{
      desc:'宇治老茶舖的本店茶寮，以濃厚抹茶甜點與日式庭院空間見長。',
      fullDesc:'辻利兵衛本店位於宇治，茶寮由老建築改造，保留較安靜的庭院與町家氛圍。甜點常把抹茶用在聖代、蛋糕、蕨餅與冰品中，茶味通常比一般觀光區甜點更鮮明。它適合宇治行程中安排一段完整休息，而不是匆忙外帶後邊走邊吃。若平等院與宇治上神社停留較久，可改選簡單茶飲，以免壓縮前往奈良的時間。'
    },
    'クウネルノツヅキ':{
      desc:'宇治的個性甜點店，以造型鮮明的甜點與季節水果作品受到注意。',
      fullDesc:'クウネルノツヅキ以帶有設計感的甜點聞名，作品常結合季節水果、奶油、慕斯與酥脆元素。相較傳統抹茶茶寮，它更像現代甜點工作室，適合想在宇治行程中穿插不同風格的人。品項會隨季節與當日製作量改變，看到想吃的款式不一定每天都有。若是外帶，需留意甜點保存與後續移動時間，尤其當天還要前往奈良。'
    },
    'ごちそう焼むすび おにまる':{
      desc:'把炙燒配料鋪在飯糰上的外帶店，適合離境日快速解決午餐。',
      fullDesc:'ごちそう焼むすび おにまる主打份量較大的烤飯糰，會在米飯上搭配肉類、魚卵、蛋或蔬菜等配料。它比一般便利商店飯糰更像一份可以手拿的完整餐點，適合需要掌握時間的離境日。可依當天路線帶回京都站、車上或機場前食用，但含醬汁與配料的款式不一定方便邊走邊吃。選購時以一至兩個主食搭配飲品即可，避免買太多增加隨身行李。'
    },
    'イノダコーヒ本店':{
      desc:'京都代表性老咖啡館，本店以復古洋館、早餐與深焙咖啡著稱。',
      fullDesc:'イノダコーヒ本店是京都老牌咖啡館，本店由町家與洋館空間構成，氣氛帶有昭和時代的端正感。招牌咖啡偏深焙，傳統喝法會預先加入砂糖與牛奶，也可依喜好另外調整。早餐、三明治與甜點都屬經典洋食風格，適合作為京都最後一天較從容的開場。週末早晨可能需要候位，若離境時間緊，就不適合在此久等。'
    },
    'つるや食堂':{
      desc:'籠神社附近的食堂，以宮津魚介與在地丼飯銜接府中側行程。',
      fullDesc:'つるや食堂位於天橋立府中側，從籠神社與傘松公園動線前往較自然。料理重點是宮津灣與丹後周邊魚介，常見丼飯、定食或依漁獲調整的在地料理。它的優勢不是豪華擺盤，而是能在觀景前後吃到有地域感、份量適中的午餐。漁獲與供應內容會依季節變動，當天若已售完，直接改用傘松公園餐廳最省時間。'
    },
    'AmaTerrace':{
      desc:'傘松公園內的展望餐廳，可邊看天橋立邊吃海鮮丼與輕食。',
      fullDesc:'AmaTerrace 位於傘松公園展望區，不必下山就能完成午餐，特別適合只走府中側的安排。餐點以海鮮丼、咖哩、麵食與輕食為主，料理本身走觀景設施餐廳路線。最大優點是窗外或露台就能看天橋立，省下重新停車和找餐廳的時間。若纜車因強風停駛或餐廳休業，則需回到籠神社周邊用餐。'
    },
    'Cafe du Pin':{
      desc:'廻旋橋旁的水岸咖啡館，以運河景觀、日替午餐和輕食為主。',
      fullDesc:'Cafe du Pin 位於文珠側廻旋橋附近，窗邊可看到運河、松並木與船隻通行。菜單以日替午餐、三明治、咖啡與甜點為主，適合不想吃太重、但需要坐下休息的人。它的位置便於接續智恩寺與天橋立 View Land，不必另外開車移動。遇到廻旋橋開啟或觀光船進出時，景觀很有趣，但熱門座位不一定能指定。'
    },
    '海鮮工房 はしだて物産・かにめし':{
      desc:'天橋立站周邊的外帶蟹飯，以蟹高湯炊飯鋪上蟹肉，適合帶走。',
      fullDesc:'這類かにめし以蟹高湯炊煮米飯，再鋪上蟹肉或蟹鬆，是丹後冬季很直觀的外帶選擇。它比正式蟹會席省時，也更適合當天還要前往西舞鶴的行程。可帶到車上、海邊休息點或飯店食用，但購買後仍應留意保存溫度與食用時間。冬季與假日數量可能有限，若確定想吃，抵達天橋立後先詢問預留最穩妥。'
    },
    'HAMAKAZE Café':{
      desc:'道之驛海の京都宮津內的咖啡餐廳，停車方便並供應在地魚介料理。',
      fullDesc:'HAMAKAZE Café 位於道之驛海の京都宮津，適合自駕離開天橋立後順路停靠。菜單把宮津魚介放進洋食、咖哩、漢堡或套餐中，選擇比純海鮮食堂更容易配合不同口味。停車與洗手間都方便，可作為較晚午餐、早晚餐或簡單休息點。若天橋立行程拖到接近關店時間，應直接前往西舞鶴，不要為了這一站繞路久候。'
    },
    '天橋立酒店・冬季蟹料理':{
      desc:'冬季限定的蟹御膳或蟹會席，適合願意用兩小時換一頓完整蟹料理。',
      fullDesc:'天橋立酒店冬季常推出以松葉蟹或紅楚蟹為主題的御膳與會席，可能包含蟹刺身、燒蟹、蟹鍋與蟹飯。這種安排能一次品嘗不同烹調方式，完整度遠高於便當或單點。相對地，用餐時間通常較長，且多數方案需要預約，取消規定也較嚴格。若選擇正式蟹餐，當天景點只走天橋立一岸，才能避免整天都在趕時間。'
    },
    '道之驛 京丹波 味夢之里':{
      desc:'京都縱貫道旁的大型休息站，可吃丹波食材定食並採買便當熟食。',
      fullDesc:'道之驛 京丹波 味夢之里結合餐廳、熟食、農產與伴手禮，停車和洗手間都比市區餐廳方便。餐飲常見丹波黑豆、栗子、蔬菜、肉類與地方加工品，能快速完成一頓有在地感的午餐。若不想坐下內用，也可買飯糰、麵包或便當帶走，掌握前往綾部與京丹後的時間。它適合作為穩定的移動日備案，不必因排隊名店打亂 15:00 左右入住旅館的目標。'
    },
    '綾部站周邊簡餐／外帶':{
      desc:'利用綾部站周邊停車與商店快速補給，重點是準時銜接京丹後入住。',
      fullDesc:'綾部站周邊適合在梅松苑參觀後短暫停車，選擇蕎麥、定食、麵包或飯糰。這不是指定單一餐廳，而是為長途移動日保留的彈性用餐區。若龍穩寺與梅松苑停留順利，可以坐下吃一頓簡餐；若已落後，就改買外帶並在安全休息點食用。核心原則是不要讓午餐拖延京丹後旅館的入住與晚餐時間。'
    },
    '舞鶴港とれとれセンター':{
      desc:'舞鶴港旁的海鮮市場，可選現場魚介料理、壽司與燒物作早餐或早午餐。',
      fullDesc:'舞鶴港とれとれセンター集合鮮魚店、海產加工品與可現場食用的料理攤位。可依當日漁獲選生魚片、壽司、烤魚、海鮮丼或貝類，不必全桌人都點同一套套餐。市場型態適合早上邊看邊選，也方便採買冷藏或常溫伴手禮。各店開門時間、休市日與可料理品項不完全一致，出發前需確認當日營業狀況。'
    },
    '天橋立午餐':{
      desc:'依府中側或文珠側擇一用餐，優先選與當日觀景動線相同的一岸。',
      fullDesc:'天橋立午餐不應為了單一店家跨岸往返，先決定走府中側或文珠側，再從同岸選餐廳。府中側可安排籠神社周邊魚介料理或傘松公園 AmaTerrace；文珠側則可選廻旋橋附近咖啡、海鮮或蟹飯外帶。想吃正式冬季蟹料理，需要預約並預留約兩小時。只想快速補充體力時，蟹飯或海鮮便當最符合傍晚前往西舞鶴的節奏。'
    },
    '綾部午餐':{
      desc:'以綾部市區的定食、蕎麥或外帶為主，保留下午前往京丹後的車程。',
      fullDesc:'綾部午餐的重點是位置與出餐速度，而不是安排一頓耗時的目的型餐廳。可在車站周邊找定食或蕎麥，也可使用麵包、飯糰與便當作外帶。當天前段還有龍穩寺與梅松苑，實際抵達時間可能浮動，因此不適合訂無法延遲的精緻餐廳。吃完後應直接往京丹後移動，避免壓縮旅館入住與晚餐。'
    },
    '間人／網野午餐':{
      desc:'在間人或網野選海鮮、定食或咖啡輕食，配合當天海岸路線決定。',
      fullDesc:'這天 11:00 退房後才開始海岸慢遊，午餐可依天候和路線在間人或網野解決。晴天走立岩與後ヶ濱，可優先找間人一帶魚介料理；走琴引濱與網野，則選網野市區定食或咖啡更順。若前一晚旅館早餐較豐盛，可把午餐延後並選輕食。冬季海岸店家營業較不固定，當天應準備道之驛或便利商店備案。'
    },
    '雨天版：午餐＋道之驛＋咖啡':{
      desc:'遇到強風或降雨時，用室內午餐、道之驛與咖啡取代長時間海岸停留。',
      fullDesc:'丹後海岸遇到強風或持續降雨時，不必勉強在礁岸與沙灘久留。可先找一間海鮮定食或麵店坐下吃午餐，再到道之驛採買丹後食品與伴手禮。下午以網野或峰山的咖啡店作休息點，提早前往 HOTEL＆湖邸 艸花。這個版本仍保留在地飲食與購物，但把濕滑、低溫和海風暴露降到最低。'
    },
    '最後晚餐候選':{
      desc:'回到京都後依還車與入住時間，從天婦羅、燒肉或熟成豬排中擇一。',
      fullDesc:'最後一晚不必再跨區蒐集景點，晚餐應依還車、進飯店與行李整理的實際時間選擇。想吃較完整的料理可預約京都天ぷら天天天；多人想共享可選京の焼肉処 弘；偏好豬肉主菜則考慮空蟬亭。三者風格與用餐時間不同，不建議同時保留多個熱門預約。若舞鶴回程延誤，就直接改吃京都站周邊，讓最後一晚保持從容。'
    }
  };
  all().forEach(s=>{if(s.cat==='food'&&copy[s.name])Object.assign(s,copy[s.name]);});
})();

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


/* 紅葉前線地圖：可新增、改名、替換與刪除。 */
let foliageMapStore = JSON.parse(localStorage.getItem('kyoto_foliage_maps')) || [];
foliageMapStore = foliageMapStore.map((item,i)=> typeof item==='string' ? {url:item,title:`紅葉地圖 ${i+1}`} : item);
function persistFoliageMaps(){ localStorage.setItem('kyoto_foliage_maps',JSON.stringify(foliageMapStore)); }
function renderFoliageMaps(){
  const el=document.getElementById('foliageMapGallery'); if(!el)return;
  el.innerHTML=foliageMapStore.length?foliageMapStore.map((item,i)=>`<div class="foliage-map-item">
    <img src="${item.url}" onclick="openAttachModal('${item.url}')" alt="${item.title||'紅葉前線地圖'}">
    <div class="foliage-map-caption">${item.title||`紅葉地圖 ${i+1}`}</div>
    <div class="foliage-map-actions"><button onclick="editFoliageMap(${i})">✎</button><button onclick="document.getElementById('foliageReplace-${i}').click()">↻</button><button onclick="removeFoliageMap(${i})">✕</button></div>
    <input type="file" id="foliageReplace-${i}" accept="image/*" style="display:none" onchange="replaceFoliageMap(event,${i})">
  </div>`).join(''):'<div class="empty">尚未上傳紅葉前線地圖。</div>';
}
async function handleFoliageMapUpload(e){
  const files=[...(e.target.files||[])];
  for(const f of files){ try{foliageMapStore.push({url:await fileToDataURL(f),title:f.name.replace(/\.[^.]+$/,'')});}catch(err){console.error(err);} }
  try{persistFoliageMaps();}catch(err){alert('圖片容量過大，請先刪除舊地圖或改用較小截圖。');}
  e.target.value=''; renderFoliageMaps();
}
function editFoliageMap(i){ const next=prompt('修改地圖名稱',foliageMapStore[i].title||''); if(next===null)return; foliageMapStore[i].title=next.trim()||`紅葉地圖 ${i+1}`; persistFoliageMaps(); renderFoliageMaps(); }
async function replaceFoliageMap(e,i){ const f=e.target.files&&e.target.files[0]; e.target.value=''; if(!f)return; foliageMapStore[i].url=await fileToDataURL(f); persistFoliageMaps(); renderFoliageMaps(); }
function removeFoliageMap(i){ if(!confirm('刪除這張紅葉地圖？'))return; foliageMapStore.splice(i,1);persistFoliageMaps();renderFoliageMaps();}
document.addEventListener('DOMContentLoaded',renderFoliageMaps);

/* ============ 景點封面一句話簡介重寫（2026-08） ============ */
(function rewriteAttractionCardSummaries(){
  const summaries = {
    '京都站周邊':'以巨型車站建築、空中步道、百貨與地下街組成的京都交通與購物樞紐。',
    '東福寺':'以通天橋俯瞰洗玉澗楓林聞名，是京都最具規模感的紅葉名所之一。',
    '三千院＋大原散步':'在苔庭、杉林與山里小徑之間感受大原安靜而柔和的秋日景色。',
    '高雄：神護寺＋西明寺':'沿清瀧川串起山寺、朱橋與密集楓林，是京都近郊紅葉最濃烈的區域之一。',
    '鞍馬＋貴船':'從鞍馬山的杉林古寺一路延伸至貴船水岸，兼具山林健行與神社聚落風景。',
    '真如堂':'三重塔、本堂與大片楓林構成層次豐富、古意濃厚的東山紅葉景觀。',
    '永觀堂':'以放生池、多寶塔與滿山楓色聞名，被視為京都最具代表性的紅葉寺院。',
    '南禪寺':'宏偉三門、禪寺伽藍與磚造水路閣交織出京都少見的歷史建築景觀。',
    '天授庵':'一座同時擁有枯山水與池泉庭園的南禪寺塔頭，秋色精緻而集中。',
    '無鄰菴':'以東山為借景、疏水為溪流的明治名園，呈現開闊自然的近代庭園美學。',
    '詩仙堂':'白砂、杜鵑丘與山居書院共同形成小巧而雅致的洛北庭園。',
    '圓光寺':'以十牛之庭、苔地與額緣紅葉聞名，是洛北最具畫框感的秋景寺院。',
    '曼殊院':'白砂庭園、門跡寺院建築與沉靜楓色展現典雅內斂的洛北秋意。',
    '平等院':'鳳凰堂倒映阿字池的經典景色，是宇治最具象徵性的世界遺產。',
    '宇治川＋宇治上神社':'沿宇治川散步可串接古橋、水岸與日本最古老神社建築之一。',
    '宇治上神社':'藏在宇治川東岸林蔭中的古社，以樸實而珍貴的平安時代建築聞名。',
    '興聖寺':'通往山門的琴坂在秋季被楓葉包圍，是宇治最有幽谷氣氛的紅葉步道。',
    '奈良公園・浮見堂・飛火野':'鹿群、草地、池畔亭閣與古都山景共同構成奈良最經典的清晨風景。',
    '保津川漂流':'搭乘傳統木船穿越保津峽溪谷，在近距離感受岩壁、山林與水勢變化。',
    '天龍寺':'以曹源池庭園借景嵐山，是嵯峨野最具代表性的禪寺與世界遺產。',
    '常寂光寺':'沿小倉山石階穿行楓林，可一路眺望多寶塔與嵯峨野秋景。',
    '寶筐院':'密集楓樹包圍細緻苔庭，形成近距離而沉浸感十足的秋色空間。',
    '玉寶山 龍穩寺':'山門、石階與滿地落葉交織出南丹山寺深沉靜謐的晚秋景象。',
    '大本本部 梅松苑':'廣大園區集結神苑、殿堂與近代宗教建築，是綾部最具代表性的文化景觀。',
    '立岩＋後ヶ濱海岸':'巨大玄武岩岩柱矗立日本海邊，展現京丹後粗獷而開闊的海岸地貌。',
    '琴引濱＋網野咖啡':'以會鳴響的細砂海灘結合悠閒海邊聚落，呈現京丹後柔和的海岸日常。',
    '金剛院':'三重塔、山門與山間楓林相映，是舞鶴近郊古樸而清幽的紅葉寺院。',
    '府中側：籠神社＋傘松公園':'從丹後一宮古社登上傘松公園，可俯瞰天橋立經典的「昇龍觀」。',
    '文珠側：View Land＋智恩寺':'從飛龍觀展望台俯瞰沙洲，再走訪以智慧信仰聞名的智恩寺。',
    '五老天空塔':'位於舞鶴灣中央制高點，可一次俯瞰港灣、島嶼與曲折海岸線。',
    '舞鶴紅磚公園':'保存近代海軍紅磚倉庫群，展現舞鶴獨特的港町工業歷史風貌。',
    '舞鶴港とれとれセンター':'結合鮮魚市場、現吃海鮮與地方物產，是認識舞鶴港飲食文化的最佳入口。',
    '西本願寺':'以巨大木造伽藍、華麗唐門與百年銀杏聞名，是京都站旁的重要世界遺產。',
    '京都御苑':'廣闊林蔭、御所建築與四季樹木構成京都市中心最從容的自然空間。',
    '下鴨神社＋糺之森':'穿過原生古森林走向朱紅神社，可同時感受晚楓、古道與世界遺產氛圍。'
  };
  const all = days.flatMap(d => [...(d.spots || []), ...(d.moreSpots || [])]);
  all.forEach(s => {
    const normalized = String(s.name || '')
      .replace(/\s*[（(](機動|二選一|三選二|天氣好版|晴天版|雨風版)[）)]/g, '')
      .trim();
    if (summaries[s.name]) s.desc = summaries[s.name];
    else if (summaries[normalized]) s.desc = summaries[normalized];
  });
})();
