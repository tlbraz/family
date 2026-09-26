// Kept so the app stays installable and older copies of this worker get replaced.
// It does nothing: shares go straight to the server (/api/share) and nothing is cached.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(Promise.all([self.clients.claim(), caches.delete('share')])));
