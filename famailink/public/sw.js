self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const fallback = {
    title: "Famailink",
    body: "You have a new family update.",
    url: "/conversations",
    tag: "famailink-share",
    notificationId: "",
  };

  let payload = fallback;
  try {
    const incoming = event.data ? event.data.json() : null;
    if (incoming && typeof incoming === "object") {
      payload = {
        ...fallback,
        ...incoming,
      };
    }
  } catch {
    payload = fallback;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/android-chrome-192x192.png",
      badge: "/favicon-32x32.png",
      tag: payload.tag,
      data: {
        url: payload.url,
        notificationId: payload.notificationId,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = new URL(event.notification?.data?.url || "/conversations", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("navigate" in client) {
          client.focus();
          return client.navigate(destination);
        }
      }
      return self.clients.openWindow(destination);
    }),
  );
});
