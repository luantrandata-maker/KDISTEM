// Service worker của KSCHOOL STEM: cho phép cài ứng dụng và mở lại giao diện khi mất mạng.
// - Trang (điều hướng): mạng trước, mất mạng thì dùng bản index.html đã lưu.
// - /assets/* (tên tệp có mã băm, không đổi nội dung): lấy từ bộ nhớ trước.
// - /geo, /standards, /icons: dùng bản đã lưu và cập nhật nền.
// - Không bao giờ lưu yêu cầu tới máy chủ dữ liệu (Supabase) hay yêu cầu khác GET. Dữ liệu ngoại tuyến do ứng dụng tự lưu (IndexedDB).
const VERSION = 'kschool-v1'
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png']

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put('/', copy)); return res })
      .catch(() => caches.match('/')))
    return
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)) }
      return res
    })))
    return
  }
  if (/^\/(geo|standards|icons)\//.test(url.pathname) || url.pathname === '/manifest.webmanifest') {
    e.respondWith(caches.open(VERSION).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res }).catch(() => hit)
      return hit || net
    })))
  }
})

self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting() })
