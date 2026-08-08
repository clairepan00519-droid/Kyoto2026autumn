/* ===========================================================
   紐西蘭南島環線行程 - Service Worker
   功能：
   1. 快取完整網站外殼（HTML、CSS、JavaScript 與本機環線圖），
      有網路時自動更新快取，離線時改讀取快取版本。
   2. 快取 Google 字型等曾載入的外部靜態資源。
   3. 對地圖圖磚（OpenStreetMap／RainViewer）採用「先讀快取、
      同時背景更新」策略，瀏覽過的區域離線時仍可能顯示。
   4. 天氣 API（Open-Meteo／RainViewer 資料）不在此攔截，
      交由網頁本身的 localStorage 快取機制處理，
      這樣才能顯示「資料更新於 xx:xx」等使用者可理解的訊息。

   注意：Service Worker 必須透過 https:// 或 http://localhost
   才能註冊成功；若直接用 file:// 開啟本機檔案，瀏覽器會拒絕
   註冊（這是瀏覽器安全限制，非本網頁的問題）。若你是把整個
   資料夾放到雲端空間（GitHub Pages、Netlify、Vercel 等）分享
   連結使用，此檔案就會正常運作並提供離線瀏覽能力。
   =========================================================== */

const CACHE_VERSION = 'nz-trip-v22-safety-weather-backup';
const SHELL_CACHE = `nz-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `nz-runtime-${CACHE_VERSION}`;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      // 快取目前這一頁本身（不論檔名為何），讓離線時仍能開啟
      return cache.addAll([
        './', './index.html', './app.js', './style.css', './images/map.webp'
      ]).catch(() => {});
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isMapTile(url) {
  return (
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('rainviewer.com')
  );
}

function isStaticLib(url) {
  return (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdnjs.cloudflare.com')
  );
}

function isWeatherApi(url) {
  return (
    url.hostname.includes('api.open-meteo.com') ||
    url.hostname.includes('api.rainviewer.com')
  );
}

function isImageRequest(req) {
  return req.destination === 'image' || /\.(?:png|jpe?g|webp|gif|svg)(?:\?|$)/i.test(new URL(req.url).pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // 天氣資料 API：不攔截，交給網頁自己的 localStorage 快取處理
  if (isWeatherApi(url)) {
    return;
  }

  // 景點照片：看過的圖片優先從快取顯示；完全沒快取且離線時以本機環線圖代替，
  // 避免卡片出現破圖。由於外站可能限制跨站存取，快取失敗不影響文字行程。
  if (isImageRequest(req) && url.origin !== self.location.origin) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => { if(res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; })
            .catch(() => cached || caches.match('./images/map.webp'));
          return cached || network;
        })
      )
    );
    return;
  }

  // 這份行程頁面本身（HTML 導覽請求）：Network-first，離線時退回快取
  if (req.mode === 'navigate' || url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, clone)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('./'))
        )
    );
    return;
  }

  // 字型 / Leaflet 等外部函式庫：Cache-first
  if (isStaticLib(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((res) => {
            const clone = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, clone)).catch(() => {});
            return res;
          })
          .catch(() => cached);
      })
    );
    return;
  }

  // 地圖圖磚：Stale-while-revalidate（先顯示快取，背景更新）
  if (isMapTile(url)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const fetchPromise = fetch(req)
            .then((res) => {
              cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }
});
