// 미출결 확인 알림 전용 서비스 워커. 화면(학원관리)이 열려 있는 동안 휴대폰·PC 알림을 띄우고, 누르면 미출결 화면으로 간다.
// 페이지 파일을 저장(캐시)하지 않는다 — fetch 를 가로채지 않으므로 화면 업데이트에 영향이 없다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL('academy.html#miss', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.includes('academy.html')) { c.postMessage({ go: 'miss' }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
