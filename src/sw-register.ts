// Ứng dụng cài được (PWA) + mở lại khi mất mạng: đăng ký service worker ở bản dựng thật.
// Tách riêng và import đầu tiên trong main.tsx để vẫn đăng ký được kể cả khi phần còn lại lỗi khi khởi động.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const reg = () => navigator.serviceWorker.register('/sw.js').catch(() => { /* trình duyệt chặn: vẫn dùng bình thường */ })
  if (document.readyState === 'complete') reg(); else window.addEventListener('load', reg)
}
export {}
