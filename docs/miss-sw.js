// 미출결 확인 알림 서비스 워커.
//  · 서버(학원관리)가 보내는 웹 푸시를 받으면 — 화면이 꺼져 있거나 앱을 닫아도 — 로그인 토큰으로 "지금 확인할 학생"을 읽어 알림을 띄운다.
//    푸시에는 내용이 없다(깨우기 신호만). 이름은 여기서 서버에 물어 채운다.
//  · 화면이 열려 있을 때 화면이 직접 띄우는 알림도 이 워커로 표시한다.
// 페이지 파일을 저장(캐시)하지 않는다 — fetch 를 가로채지 않으므로 화면 업데이트에 영향이 없다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

function idb() { return new Promise((res, rej) => { const r = indexedDB.open('mm-push', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function idbGet(k) { try { const db = await idb(); return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch { return null; } }
const b64u8 = s => { const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
async function callApi(cfg, action, extra) {
  const r = await fetch(cfg.api, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token: cfg.token, ...(extra || {}) }) });
  return r.json();
}

self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let title = '출결 확인 알림', body = '눌러서 미출결 확인 화면을 여세요';
    try {
      const cfg = await idbGet('cfg');
      if (cfg && cfg.api && cfg.token) {
        const o = await callApi(cfg, 'attWatchBadge');
        if (o && o.ok) {
          const b = o.data;
          if (b.n) { title = `출결 확인 필요 ${b.mine || b.n}명`; body = (b.names || []).join(', ') + (b.stage2 ? ` · ${b.stage2}명 재알림` : '') + ' — 눌러서 확인'; }
          else { title = '출결 확인 알림'; body = '지금은 확인할 학생이 없습니다 (이미 처리됨)'; }
        }
      }
    } catch {}
    await self.registration.showNotification(title, { body, tag: 'miss', renotify: true, icon: 'icons/checkin-192.png', badge: 'icons/checkin-192.png', data: { go: 'miss' } });
  })());
});

// 브라우저가 구독을 바꾸면 새 구독을 서버에 다시 알린다
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const cfg = await idbGet('cfg'); if (!cfg || !cfg.key || !cfg.token) return;
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8(cfg.key) });
    await callApi(cfg, 'pushSubscribe', { sub: sub.toJSON(), ua: 'renew' });
  })().catch(() => {}));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL('academy.html#miss', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.includes('academy.html')) { c.postMessage({ go: 'miss' }); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
