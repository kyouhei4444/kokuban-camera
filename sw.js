/* ============================================================
   sw.js  オフライン動作
   外部の API を使わないので、本体を入れておけば圏外でも撮影できる。
   更新を早く反映したいときは APP_CACHE の版数を上げる。
   ============================================================ */
var APP_CACHE = 'kokuban-app-v1';

var SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/exif.js',
  './js/zip.js',
  './js/board.js',
  './js/store.js',
  './js/camera.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(APP_CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function (err) {
          console.warn('[SW] キャッシュ失敗:', u, err);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k !== APP_CACHE) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  // キャッシュ優先 + 背後で更新
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(APP_CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
