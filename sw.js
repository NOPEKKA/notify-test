/* Notify Test — service worker
   - แคชไฟล์หลักให้เปิดออฟไลน์ได้ (จำเป็นต่อการติดตั้งเป็นแอป)
   - แสดงการแจ้งเตือน + จับเวลาเตือนแบบสำรองเมื่อหน้าเว็บถูกพักการทำงาน */
const VERSION = 'v1.0.0';
const CACHE = 'notify-test-' + VERSION;
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/badge-96.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // network-first เพื่อให้ได้เวอร์ชันล่าสุดเสมอ ถ้าออฟไลน์ค่อยใช้แคช
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});

/* ---------- ตั้งเวลาเตือนฝั่ง SW (สำรอง) ---------- */
const timers = new Map(); // id -> { t, done }

function options(d) {
  return {
    body: d.body,
    tag: d.id,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    vibrate: [200, 100, 200],
    requireInteraction: false,
    data: { id: d.id, at: Date.now() }
  };
}

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'schedule') {
    const old = timers.get(d.id);
    if (old) { clearTimeout(old.t); old.done(); }
    // รอเพิ่ม 1.5 วิ ให้หน้าเว็บยิงก่อนถ้ายังทำงานอยู่ (จะได้ไม่เตือนซ้ำ)
    const wait = Math.max(0, d.at - Date.now()) + 1500;
    e.waitUntil(new Promise((done) => {
      const t = setTimeout(async () => {
        timers.delete(d.id);
        try {
          const existing = await self.registration.getNotifications({ tag: d.id });
          if (!existing.length) await self.registration.showNotification(d.title, options(d));
          const all = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
          all.forEach((c) => c.postMessage({ type: 'fired', id: d.id, by: 'sw' }));
        } finally { done(); }
      }, wait);
      timers.set(d.id, { t, done });
    }));
  } else if (d.type === 'cancel') {
    const x = timers.get(d.id);
    if (x) { clearTimeout(x.t); x.done(); timers.delete(d.id); }
  }
});

/* ---------- กดที่การแจ้งเตือน → เปิด/โฟกัสแอป ---------- */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { c.postMessage({ type: 'clicked', id: e.notification.tag }); return c.focus(); }
    }
    return self.clients.openWindow('./');
  })());
});

/* รองรับ Push จริงในอนาคต (ยังไม่ได้ต่อเซิร์ฟเวอร์) */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Notify Test', options({
    id: 'push-' + Date.now(), body: d.body || 'มีข้อความใหม่'
  })));
});
