const CACHE_VERSION = '1.30.0'; // Fixed level progression - update UI after nextLevel
const CACHE_NAME = `bollywood-beats-v${CACHE_VERSION}`;
const urlsToCache = [
  '/',
  '/index.html',
  '/single-player.html',
  '/styles.css',
  '/game.js',
  '/multiplayer-styles.css',
  '/multiplayer-game.js',
  '/firebase-config.js',
  '/firebase-sync.js',
  '/deep-link-handler.js',
  '/app-banner.css',
  '/platform-ui.js',
  '/Bollywood.xml.txt',
  '/BollywoodStars.xml.txt',
  '/Movies.xml.txt',
  '/Singers.xml.txt',
  '/manifest.json'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  console.log(`[SW] Installing version ${CACHE_VERSION}`);
  // Don't skip waiting automatically - let the page control it
  
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
