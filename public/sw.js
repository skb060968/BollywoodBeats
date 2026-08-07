const CACHE_VERSION = '4.0.12';
const CACHE_PREFIX = 'bollywood-beats-';
const CACHE_NAME = `${CACHE_PREFIX}v${CACHE_VERSION}`;
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/Bollywood.xml.txt',
  '/BollywoodStars.xml.txt',
  '/Movies.xml.txt',
  '/Singers.xml.txt',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
    await Promise.allSettled(APP_SHELL.map(url => cache.add(url)));
  }));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const isFirebase = /(^|\.)(firebaseio\.com|firebasedatabase\.app|firebaseapp\.com|googleapis\.com)$/.test(url.hostname);
  if (url.origin !== self.location.origin || isFirebase) return;

  // Cache Storage cannot store 206 Partial Content responses. Media elements
  // commonly use Range requests, so let those requests pass through untouched.
  if (request.headers.has('range')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      return (await caches.match('/')) || (await caches.match('/index.html')) || Response.error();
    }));
    return;
  }

  event.respondWith((async () => {
    const cacheKey = new Request(url.origin + url.pathname, { method: 'GET' });
    try {
      const response = await fetch(request);
      if (response.status === 200 && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(cacheKey, response.clone());
      }
      return response;
    } catch (_) {
      return (await caches.match(cacheKey)) || Response.error();
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(
    names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)),
  )).then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});