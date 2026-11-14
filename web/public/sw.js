self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// No Cache API use: authentication, OTP submission and token receipts stay network-only.
self.addEventListener("fetch", () => {});
