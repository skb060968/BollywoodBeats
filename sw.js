const CACHE_VERSION = '1.15.6'; // OnePlus 11R optimized: phrase tiles 18-22px min, gaps 0.2, borders/padding reduced
const CACHE_NAME = `bollywood-beats-v${CACHE_VERSION}`;
const urlsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/game.js',
  '/Bollywood.xml.txt',
  '/Movies.xml.txt',
  '/Singers.xml.txt',
  '/manifest.json'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing version ${CACHE_VERSION}`);
  // Skip waiting to activate new service worker immediately
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching app shell');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone the response before caching
        const responseToCache = response.clone();
        
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        
        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request);
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
