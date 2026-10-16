import { useEffect, useRef } from 'react'

// Nút Quay lại của trình duyệt / điện thoại đi lùi bên trong ứng dụng thay vì rời ứng dụng.
//  • Mỗi lần đổi trang (menu, thông báo, đổi giao diện): một mục lịch sử { role, page } — navigatePage().
//  • Màn con trong một trang (chi tiết phòng, chi tiết thiết bị, chi tiết gói, chủ đề…): useBackClose(open, close)
//    thêm một mục lịch sử khi mở; Back của trình duyệt đóng màn con đúng như nút "← Quay lại" trên trang.
//    Đóng bằng nút trên trang thì mục lịch sử đó cũng được bỏ đi, nên không phải bấm Back "thừa".

type PageState = { role?: string; page?: string; sub?: number }
type Sub = { id: number; close: () => void; popped: boolean }

const subs: Sub[] = []
let ignore = 0                      // số sự kiện popstate do chính ứng dụng gây ra (history.back() khi đóng màn con)
let seq = Date.now()                // tăng dần, kể cả sau khi tải lại trang
let pageListener: ((s: PageState) => void) | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', e => {
    if (ignore > 0) { ignore--; return }
    const state = (e.state ?? {}) as PageState
    const level = state.sub ?? 0
    // Đóng các màn con mở sau mục lịch sử đang quay về (trong cùng → ngoài cùng)
    for (let i = subs.length - 1; i >= 0; i--) {
      if (subs[i].id > level) { const s = subs.splice(i, 1)[0]; s.popped = true; s.close() }
    }
    pageListener?.(state)
  })
}

// App đăng ký nhận trang cần hiển thị khi người dùng bấm Back/Forward
export function onHistoryPage(fn: ((s: PageState) => void) | null) { pageListener = fn }

export function navigatePage(role: string, page: string, replace = false) {
  const cur = (history.state ?? {}) as PageState
  if (!replace && cur.role === role && cur.page === page && !cur.sub) return
  const state: PageState = { role, page }
  if (replace) history.replaceState(state, '')
  else history.pushState(state, '')
}

export function useBackClose(open: boolean, close: () => void) {
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!open) return
    const sub: Sub = { id: ++seq, close: () => closeRef.current(), popped: false }
    history.pushState({ ...((history.state ?? {}) as PageState), sub: sub.id }, '')
    subs.push(sub)
    return () => {
      const i = subs.indexOf(sub)
      if (i >= 0) subs.splice(i, 1)
      // Đóng bằng nút trên trang (không phải Back): bỏ mục lịch sử của màn con nếu nó vẫn ở trên cùng
      if (!sub.popped && ((history.state ?? {}) as PageState).sub === sub.id) { ignore++; history.back() }
    }
  }, [open])
}
