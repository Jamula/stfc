// Entry point — registers the stfc-app shell and all tab components.
import "./app.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // The app remains fully online-capable if service worker installation is unavailable.
    });
  });
}
