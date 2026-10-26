// Minimal service worker so browsers offer "install to home screen".
// It does not cache anything: family documents always come fresh from the
// server, and nothing private is left on the phone.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
