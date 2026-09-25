/* Browser notifications remain available after the studio tab closes. */
self.addEventListener("push", (event) => {
  let message;
  try { message = event.data ? event.data.json() : null; }
  catch { return; }
  const id = message && message.projectId;
  if (message?.status !== "completed" || typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return;
  event.waitUntil(self.registration.showNotification("Your image is ready", {
    body: "Open Qwen Image Studio to see your project.",
    icon: "/icon.svg",
    tag: `qwen-image-${id}`,
    data: { projectId: id },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data?.projectId;
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) return;
  const url = new URL(`/?project=${encodeURIComponent(id)}`, self.location.origin);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === url.origin);
    if (existing) {
      const navigated = typeof existing.navigate === "function" ? await existing.navigate(url.href).catch(() => null) : null;
      if (navigated) return navigated.focus();
    }
    await self.clients.openWindow(url.href);
  })());
});
