/* Saiyai service worker — app-shell cache for offline + installability */
var CACHE = "saiyai-v1";
var SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).catch(function () {}));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return; // POST ไป Apps Script ปล่อยผ่าน
  var sameOrigin = new URL(req.url).origin === self.location.origin;
  if (!sameOrigin) return; // การเรียก Google Drive (list) ให้ไปตรงเสมอ
  // network-first สำหรับไฟล์แอป แล้ว fallback เป็น cache เมื่อออฟไลน์
  e.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      return res;
    }).catch(function () {
      return caches.match(req).then(function (m) { return m || caches.match("./"); });
    })
  );
});
