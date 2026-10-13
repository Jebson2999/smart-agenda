// Service worker do ASTRAL Smart Agenda (PWA).
// - Arquivos do aplicativo: cache primeiro (nomes com hash, nunca mudam).
// - Navegação: rede primeiro; sem conexão, abre o aplicativo em cache ou a página offline.
// - API: sempre pela rede — dados da agenda não ficam guardados no aparelho.
const VERSION = '09519ff138';
const CACHE = `asa-${VERSION}`;
const PRECACHE = ["/","/offline.html","/assets/app-4e16dea80f.js","/assets/app-b6280867bd.css","/manifest.webmanifest","/icons/icon-192.png","/fonts/inter-400.woff","/fonts/inter-500.woff","/fonts/inter-600.woff","/fonts/inter-700.woff"];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('asa-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // rede, sem cache

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(async () => (await caches.match('/')) || (await caches.match('/offline.html'))),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          }),
      ),
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
