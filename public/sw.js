const CACHE_VERSION = '2.0.1'; // Fix lifeline clicks by adding event listeners dynamically
const CACHE_NAME = `bollywood-beats-v${CACHE_VERSION}`;

// Only cache static assets that don't change - Vite handles JS/CSS with hashed names
const urlsToCache = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/Bollywood.xml.txt',
  '/BollywoodStars.xml.txt',
  '/Movies.xml.txt',
  '/Singers.xml.txt'
];

// Install event - cache static resources only
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing version ${CACHE_VERSION}`);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        // Cache each file individually and ignore errors
        return Promise.allSettled(
          urlsToCache.map(url => 
            cache.add(url).catch(err => {
              console.warn(`[SW] Failed to cache ${url}:`, err);
              return null;
            })
          )
        );
      })
  );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  const { request } = event;
  
  // Skip service worker for non-GET requests (POST, PUT, DELETE, HEAD, etc.)
  if (request.method !== 'GET') {
    return; // Let browser handle it normally
  }
  
  const url = new URL(request.url);
  
  // Skip caching for:
  // 1. Firebase requests
  // 2. External API requests
  if (
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebase.com')
  ) {
    event.respondWith(fetch(request));
    return;
  }
  
  // For GET requests of our own resources, use network-first strategy
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only cache successful GET responses
        if (response && response.status === 200 && request.method === 'GET') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(request);
      })
  );
});

// Activate event - cleanup old caches and notify clients
self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating version ${CACHE_VERSION}`);
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all([
        // Delete old caches
        ...cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log(`[SW] Deleting old cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        }),
        // Take control of all clients immediately
        self.clients.claim()
      ]);
    }).then(() => {
      // Notify all clients about the update
      return self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'UPDATE_AVAILABLE',
            version: CACHE_VERSION
          });
        });
      });
    })
  );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
