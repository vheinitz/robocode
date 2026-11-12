// Service Worker — macht RoboCode offline-fähig und installierbar (PWA).
//
// Strategie: die App-Hülle (index.html + gehashte JS/CSS-Chunks) wird beim
// Benutzen gecacht (runtime cache-first). Navigationsanfragen fallen offline auf
// die gecachte index.html zurück (Single-Page-App). Die großen Firmware-.bin
// werden bewusst NICHT automatisch gecacht (Offline-Flashen ist Randfall; die
// Firmware kommt beim Flashen frisch über das Netz).

const CACHE = 'robocode-shell-v1'

self.addEventListener('install', (e) => {
  self.skipWaiting()
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll(['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png']).catch(() => {}),
    ),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // nur eigene Dateien
  if (url.pathname.includes('/firmware/')) return // Firmware nicht cachen

  // Navigation → App-Hülle (offline-Fallback auf index.html).
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))))
    return
  }

  // Sonst: cache-first, dann Netz (und erfolgreiche Antworten nachlegen).
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res.ok && res.type === 'basic') {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          })
          .catch(() => hit),
    ),
  )
})
