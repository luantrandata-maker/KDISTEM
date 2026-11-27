// Sau mỗi lần cập nhật (deploy), các tệp của bản cũ không còn trên máy chủ. Tab đang mở từ trước mở một màn chưa tải
// sẽ đi tìm tệp cũ và lỗi → trước đây cả trang trắng. Gặp lỗi kiểu này thì tải lại trang một lần để lấy bản mới.
const KEY = 'chunk-reload-at'
export const isChunkError = (e: unknown) => /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading (CSS )?chunk .* failed/i
  .test(String((e as { message?: string })?.message ?? e))

/** Tải lại trang; không tải lại lần nữa nếu vừa tải lại trong 20 giây (tránh vòng lặp khi mất mạng). Trả về false nếu không tải lại. */
export function reloadForUpdate(): boolean {
  const last = Number(sessionStorage.getItem(KEY) || 0)
  if (Date.now() - last < 20000) return false
  sessionStorage.setItem(KEY, String(Date.now()))
  location.reload()
  return true
}

export function installChunkReload() {
  window.addEventListener('vite:preloadError', e => { if (reloadForUpdate()) e.preventDefault() })
  window.addEventListener('unhandledrejection', e => { if (isChunkError(e.reason)) reloadForUpdate() })
}
