// Coinpree Push Notification Service Worker
// Handles push events even when the site tab is closed

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Coinpree Signal", body: event.data.text() };
  }

  const title = data.title || "Coinpree Signal";
  const options = {
    body: data.body || "",
    icon: data.icon || "/favicon.ico",
    badge: "/favicon.ico",
    data: data.url ? { url: data.url } : undefined,
    requireInteraction: false,
  };

  // Only show the OS notification if the app tab is NOT currently visible.
  // When the tab is open the in-app scanner already fires the alert toast —
  // showing the push notification on top would duplicate it.
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const appVisible = clients.some(
          (c) => c.visibilityState === "visible"
        );
        if (appVisible) return; // in-app toast handles it — skip OS notification
        return self.registration.showNotification(title, options);
      })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
