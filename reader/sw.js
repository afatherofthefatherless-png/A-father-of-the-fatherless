// Retiring the /reader/ service worker so old installs pick up the homepage redirects.
self.addEventListener("install", function (event) {
  self.skipWaiting();
});
self.addEventListener("activate", function (event) {
  event.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (k) { return caches.delete(k); }));
    await self.registration.unregister();
    await self.clients.claim();
    var clients = await self.clients.matchAll({ type: "window" });
    clients.forEach(function (client) {
      var url = new URL(client.url);
      if (url.pathname.indexOf("/A-father-of-the-fatherless/reader") === 0) {
        var rest = url.pathname.replace("/A-father-of-the-fatherless/reader", "") || "/";
        if (rest.charAt(rest.length - 1) !== "/") rest += "/";
        client.navigate("/A-father-of-the-fatherless" + rest + url.search + url.hash);
      }
    });
  })());
});
