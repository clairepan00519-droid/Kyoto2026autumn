/* 京都・奈良・丹後行程：App Shell、圖片與已瀏覽內容離線快取 */
const CACHE_VERSION='kyoto-trip-v50-polish';
const SHELL_CACHE=`kyoto-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE=`kyoto-runtime-${CACHE_VERSION}`;
const IMAGE_CACHE=`kyoto-images-${CACHE_VERSION}`;
const SHELL=['./','./index.html','./app.js','./style.css','./manifest.webmanifest','./images/map.webp','./images/header.webp','./images/icon-192.png','./images/apple-touch-icon.png','./images/favicon.png','./images/nav-itinerary.webp','./images/nav-route.webp','./images/nav-guide.webp','./images/nav-weather.webp','./images/nav-food.webp','./images/nav-shopping.webp','./images/nav-lodging.webp','./images/other-1.webp','./images/other-2.webp','./images/other-3.webp','./images/other-4.webp','./images/other-5.webp'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL_CACHE).then(async cache=>{
    await Promise.all(SHELL.map(async path=>{
      try{const res=await fetch(path,{cache:'reload'});if(res.ok)await cache.put(path,res);}catch(e){}
    }));
  }));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k!==SHELL_CACHE&&k!==RUNTIME_CACHE&&k!==IMAGE_CACHE).map(k=>caches.delete(k))))
    .then(async()=>{
      await self.clients.claim();
      /* 不再強制 navigate 重新載入（會打斷正在輸入的家人）；改通知頁面，由使用者決定何時更新 */
      const windows=await self.clients.matchAll({type:'window'});
      windows.forEach(client=>client.postMessage({type:'SW_ACTIVATED',version:CACHE_VERSION}));
    }));
});

function isWeather(url){return url.hostname.includes('api.open-meteo.com')||url.hostname.includes('api.rainviewer.com');}
function isStaticLib(url){return url.hostname.includes('fonts.googleapis.com')||url.hostname.includes('fonts.gstatic.com')||url.hostname.includes('cdnjs.cloudflare.com');}
function imageFallback(){
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="100%" height="100%" fill="#eadfce"/><text x="600" y="330" text-anchor="middle" font-size="50" font-family="sans-serif" fill="#745b49">京都・奈良・丹後</text><text x="600" y="390" text-anchor="middle" font-size="25" font-family="sans-serif" fill="#745b49">離線圖片尚未下載</text></svg>';
  return new Response(svg,{headers:{'Content-Type':'image/svg+xml;charset=utf-8','Cache-Control':'no-store'}});
}

self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  let url;try{url=new URL(req.url);}catch(e){return;}
  if(isWeather(url))return;

  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(res=>{const copy=res.clone();caches.open(SHELL_CACHE).then(c=>c.put('./index.html',copy));return res;}).catch(async()=>await caches.match('./index.html')||await caches.match('./')));
    return;
  }

  if(url.origin===self.location.origin&&/\.(webp|png|jpe?g|gif|svg|ico)$/i.test(url.pathname)){
    event.respondWith(caches.match(req).then(c=>c||fetch(req).then(res=>{if(res.ok)caches.open(SHELL_CACHE).then(x=>x.put(req,res.clone()));return res;})));
    return;
  }

  if(url.origin===self.location.origin){
    /* 改為 network-first：先嘗試連網取得最新版本，離線或連線失敗時才退回快取。
       舊版是「快取優先」，會讓家人在你更新網站後，仍看到部署前的舊版 app.js／index.html，
       且往往要重新整理兩次才會換到新版，這是「家人看到的網站跟我的不一樣」的常見成因之一。 */
    event.respondWith(fetch(req,{cache:'no-store'}).then(res=>{
      if(res.ok)caches.open(SHELL_CACHE).then(c=>c.put(req,res.clone()));
      return res;
    }).catch(()=>caches.match(req)));
    return;
  }

  if(req.destination==='image'){
    event.respondWith(caches.open(IMAGE_CACHE).then(async cache=>{
      const cached=await cache.match(req);if(cached)return cached;
      try{const res=await fetch(req);if(res.ok||res.type==='opaque')await cache.put(req,res.clone());return res;}catch(e){return imageFallback();}
    }));
    return;
  }

  if(isStaticLib(url)){
    event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{caches.open(RUNTIME_CACHE).then(c=>c.put(req,res.clone()));return res;})));
  }
});
