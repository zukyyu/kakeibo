/* 底値帳 Service Worker
   アプリ本体（シェル）をキャッシュしてオフラインでも起動できるようにする。
   GASへのAPI通信（別オリジン・POST）には一切介入しない。
   ★ index.html 等を更新したら CACHE_VERSION を上げること（例: v1 → v2） */
const CACHE_VERSION = 'v23';
const CACHE_NAME = 'sokone-' + CACHE_VERSION;
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // GET かつ 同一オリジンのみ扱う（GASへのPOSTはそのまま素通し）
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req).then(hit =>
      hit ||
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy));
        return res;
      })
    )
  );
});
