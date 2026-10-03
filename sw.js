// Wordbox — offline. Sieć najpierw (żeby nowa wersja aplikacji dochodziła), cache jako zapas.
var CACHE = 'wordbox-v1';
var SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                       // logowanie i zapisy zawsze przez sieć
  if (new URL(req.url).origin !== self.location.origin) return;  // Supabase i CDN pomijamy
  e.respondWith(
    fetch(req).then(function (res) {
      // do pamięci tylko pełne odpowiedzi (audio przychodzi też jako 206 — tych nie wolno zapisywać)
      if (res.status === 200) { var copy = res.clone(); caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {}); }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (m) { return m || caches.match('./index.html'); });
    })
  );
});
