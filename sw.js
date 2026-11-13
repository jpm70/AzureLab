/**
 * Service Worker Ligero para el Simulador de Microsoft Azure (Vanilla JS SPA)
 * Estrategia híbrida:
 * - Pre-caché de activos esenciales del App Shell en la fase 'install'.
 * - Stale-While-Revalidate / Cache-First con actualización en segundo plano para HTML, CSS (Tailwind CDN), JS y SVGs.
 * - Soporte 100% OFFLINE tras la primera carga.
 */

const CACHE_NAME = 'azure-portal-lab-v3';

// Recursos críticos de una sola página (App Shell) que se precachean al instalar el Service Worker
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './pwa-192x192.png',
  './pwa-512x512.png',
  './pwa-maskable-512x512.png',
  './apple-touch-icon.png',
  'https://cdn.tailwindcss.com'
];

// 1. Fase de Instalación: Pre-cachea el App Shell y toma control inmediato (skipWaiting)
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const url of PRECACHE_ASSETS) {
        try {
          const request = new Request(url, { mode: url.startsWith('http') ? 'no-cors' : 'same-origin' });
          const response = await fetch(request);
          if (response && (response.status === 200 || response.type === 'opaque')) {
            await cache.put(url, response);
          }
        } catch (err) {
          // Ignorar silenciosamente si algún activo opcional falla durante la instalación inicial
        }
      }
    })
  );
});

// 2. Fase de Activación: Limpia cachés antiguas y reclama todos los clientes abiertos (clients.claim)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((oldCache) => caches.delete(oldCache))
        )
      )
      .then(() => self.clients.claim())
  );
});

// 3. Interceptor de Peticiones (fetch): Cachea dinámicamente HTML, CSS de Tailwind, JS, SVGs e iconos
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Solo interceptar peticiones GET y protocolos HTTP/HTTPS (ignorar chrome-extension://, ws://, etc.)
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  // Navegación SPA (HTML): Responder desde caché inmediatamente o red, con fallback garantizado a /index.html offline
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', responseClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedIndex = await caches.match('./index.html');
          if (cachedIndex) return cachedIndex;
          return caches.match('./');
        })
    );
    return;
  }

  // Activos estáticos y CDN (Tailwind CSS, JS, SVGs, PNGs, Fuentes): Stale-While-Revalidate (100% Offline Ready)
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const networkFetch = fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            (networkResponse.status === 200 || networkResponse.type === 'opaque')
          ) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      // Si está en caché lo entrega al instante sin esperar red; si no, espera a networkFetch
      return cachedResponse || networkFetch;
    })
  );
});
