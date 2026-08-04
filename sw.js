/* 京都・奈良・丹後行程：App Shell、圖片與已瀏覽內容離線快取 */
const CACHE_VERSION='kyoto-trip-v44-editable-transport';
const SHELL_CACHE=`kyoto-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE=`kyoto-runtime-${CACHE_VERSION}`;
const IMAGE_CACHE=`kyoto-images-${CACHE_VERSION}`;
const SHELL=['./','./index.html','./app.js','./style.css','./images/map.webp'];

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
      const windows=await self.clients.matchAll({type:'window'});
      await Promise.all(windows.map(client=>client.navigate(client.url).catch(()=>null)));
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

  if(url.origin===self.location.origin){
    event.respondWith(caches.match(req).then(cached=>{
      const update=fetch(req).then(res=>{if(res.ok)caches.open(SHELL_CACHE).then(c=>c.put(req,res.clone()));return res;}).catch(()=>cached);
      return cached||update;
    }));
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
