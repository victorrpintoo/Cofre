/* =========================================================
   Service worker de Cofre
   Guarda una copia de la app en el dispositivo para que
   abra aunque no haya internet.
   - Archivos de la app: primero intenta internet (para tener
     siempre la versión nueva) y si no hay, usa la copia.
   - Librería de gráficas y letras: usa la copia guardada.
   Si cambias algo grande, sube el número de CACHE.
   ========================================================= */
const CACHE = "cofre-v5";
const ARCHIVOS = [
  "./",
  "index.html",
  "estilos.css",
  "app.js",
  "manifest.json",
  "iconos/icono.svg",
  "iconos/icono-180.png",
  "iconos/icono-192.png",
  "iconos/icono-512.png",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js",
];

// 1) Al instalarse: guardar la copia de los archivos
self.addEventListener("install", evento => {
  evento.waitUntil(
    caches.open(CACHE).then(cache =>
      // Uno por uno, para que si falla uno no se pierdan los demás
      Promise.allSettled(ARCHIVOS.map(url => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

// 2) Al activarse: borrar copias de versiones viejas
self.addEventListener("activate", evento => {
  evento.waitUntil(
    caches.keys()
      .then(nombres => Promise.all(nombres.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// 3) Cada vez que la app pide un archivo
self.addEventListener("fetch", evento => {
  const pedido = evento.request;
  if (pedido.method !== "GET") return;
  const mismaApp = new URL(pedido.url).origin === self.location.origin;

  if (mismaApp) {
    // Primero internet (preguntando siempre si hay versión nueva); si no hay, la copia guardada
    evento.respondWith(
      fetch(pedido, { cache: "no-cache" })
        .then(respuesta => {
          if (respuesta.ok) {
            const copia = respuesta.clone();
            caches.open(CACHE).then(cache => cache.put(pedido, copia));
          }
          return respuesta;
        })
        .catch(() =>
          caches.match(pedido, { ignoreSearch: true })
            .then(guardada => guardada || (pedido.mode === "navigate" ? caches.match("index.html") : undefined))
        )
    );
  } else {
    // Gráficas y letras: primero la copia; si no está, internet (y se guarda)
    evento.respondWith(
      caches.match(pedido).then(guardada =>
        guardada || fetch(pedido).then(respuesta => {
          if (respuesta.ok || respuesta.type === "opaque") {
            const copia = respuesta.clone();
            caches.open(CACHE).then(cache => cache.put(pedido, copia));
          }
          return respuesta;
        })
      )
    );
  }
});
