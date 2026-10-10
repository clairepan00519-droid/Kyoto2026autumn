/* 京都・奈良・丹後行程：App Shell、圖片與已瀏覽內容離線快取 */
const CACHE_VERSION='kyoto-trip-v94';
const SHELL_CACHE=`kyoto-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE=`kyoto-runtime-${CACHE_VERSION}`;
/* 圖片快取獨立於版本：更新網站不會清掉已下載的圖片，也不必重新下載 */
const IMAGE_CACHE='kyoto-images-persist';
const SHELL=['./','./index.html','./app.js','./style.css','./manifest.webmanifest','./images/map.webp','./images/hero-bg.webp','./images/icon-192.png','./images/apple-touch-icon.png','./images/favicon.png','./images/nav-itinerary.webp','./images/nav-route.webp','./images/nav-guide.webp','./images/nav-weather.webp','./images/nav-food.webp','./images/nav-shopping.webp','./images/nav-lodging.webp','./images/other-1.webp','./images/other-2.webp','./images/other-3.webp','./images/other-4.webp','./images/other-5.webp','./images/deer-lying.webp','./images/deer-suitcase.webp','./images/deer-photo.webp','./images/deer-heart.webp','./images/deer-rain.webp','./images/deer-search.webp','./images/deer-car.webp','./images/deer-sleep.webp','./images/tl-deer.webp','./images/mood-excited.webp','./images/mood-content.webp','./images/mood-touched.webp','./images/mood-surprised.webp','./images/mood-accomplished.webp','./images/mood-tired.webp','./images/mood-sleepy.webp','./images/mood-disappointed.webp','./images/day1-arrival.webp','./images/day2-northern-maples.webp','./images/day3-higashiyama.webp','./images/day4-uji-nara.webp','./images/day5-hozugawa.webp','./images/day6-ayabe.webp','./images/day7-coast.webp','./images/day8-amanohashidate.webp','./images/day9-maizuru.webp','./images/day10-departure.webp','./images/splash-deer-suitcase.webp','./images/splash-deer-map.webp','./images/splash-deer-wakeup.webp','./splash.css','./splash.js','./images/icon-512.png','./leaflet.js','./leaflet.css','./images/weather-01-sunny.webp','./images/weather-02-partly-cloudy.webp','./images/weather-03-cloudy.webp','./images/weather-04-rain.webp','./images/weather-05-showers.webp','./images/weather-06-thunderstorm.webp','./images/weather-07-snow.webp','./images/weather-08-fog.webp','./images/weather-09-windy.webp','./images/weather-10-cold.webp'];

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
      /* 不強制重新載入（會打斷正在輸入的家人），改通知頁面由使用者決定 */
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

/* 頁面請求「把全部圖片下載到這台裝置」 */
async function precacheImages(urls){
  const cache=await caches.open(IMAGE_CACHE);
  const list=[...new Set(urls)].filter(u=>/^https?:/i.test(u));
  let done=0,failed=0;const total=list.length;
  const post=async()=>{const cs=await self.clients.matchAll({type:'window'});cs.forEach(c=>c.postMessage({type:'PRECACHE_PROGRESS',done,failed,total}));};
  const queue=list.slice();
  async function worker(){
    while(queue.length){
      const url=queue.shift();
      try{
        if(await cache.match(url)){done++;}
        else{
          let res=null;
          try{const r=await fetch(url,{mode:'cors'});if(r.ok)res=r;}catch(e){}
          if(!res){try{const r=await fetch(url,{mode:'no-cors'});if(r&&(r.ok||r.type==='opaque'))res=r;}catch(e){}}
          if(res){await cache.put(url,res);done++;}else failed++;
        }
      }catch(e){failed++;}
      if((done+failed)%4===0)await post();
    }
  }
  await Promise.all([worker(),worker(),worker(),worker()]);
  await post();
}
self.addEventListener('message',event=>{
  const d=event.data||{};
  if(d.type==='PRECACHE_IMAGES'&&Array.isArray(d.urls))event.waitUntil(precacheImages(d.urls));
});

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
    /* 程式碼與版面：先連網取最新版，離線才用快取 */
    event.respondWith(fetch(req,{cache:'no-store'}).then(res=>{
      if(res.ok)caches.open(SHELL_CACHE).then(c=>c.put(req,res.clone()));
      return res;
    }).catch(()=>caches.match(req)));
    return;
  }

  if(req.destination==='image'){
    /* 圖片：有快取就用快取（含「下載離線圖片」存下的），沒有才連網並順便存起來 */
    event.respondWith(caches.open(IMAGE_CACHE).then(async cache=>{
      const cached=await cache.match(req.url)||await cache.match(req);if(cached)return cached;
      try{const res=await fetch(req);if(res.ok||res.type==='opaque')await cache.put(req,res.clone());return res;}catch(e){return imageFallback();}
    }));
    return;
  }

  if(isStaticLib(url)){
    event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{caches.open(RUNTIME_CACHE).then(c=>c.put(req,res.clone()));return res;})));
  }
});
