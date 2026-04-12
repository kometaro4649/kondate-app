const CACHE_NAME = 'kondate-v5';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css?v=5',
  '/js/config.js?v=5',
  '/js/dishes-data.js?v=5',
  '/js/holidays.js?v=5',
  '/js/app.js?v=5',
  '/manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Firebase / CDN は常にネットワーク優先
  if (e.request.url.includes('firebase') || e.request.url.includes('gstatic')) {
    return;
  }
  // HTML ナビゲーションは常にネットワーク優先（確実に最新版を取得）
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }
  // その他はキャッシュ優先
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
