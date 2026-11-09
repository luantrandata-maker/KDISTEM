import { useState, type ReactNode } from 'react'

/** Trạng thái đóng/mở của khung hướng dẫn: mặc định thu gọn, bấm Mở rộng để xem; nhớ theo từng trang trên trình duyệt này */
export function useGuide(id: string): [boolean, () => void] {
  const key = 'kdi-guide-' + id
  const [closed, setClosed] = useState(() => { try { return localStorage.getItem(key) !== '0' } catch { return true } })
  const toggle = () => { setClosed(!closed); try { localStorage.setItem(key, closed ? '0' : '1') } catch { /* chỉ đổi trong phiên */ } }
  return [closed, toggle]
}

/** Khung "Quy trình thao tác" (các bước .distguide). Thu gọn: chỉ còn số và tên bước.
 *  Trang truyền `guide` (từ useGuide) thì khi thu gọn khung ẩn hẳn, trang tự đặt nút mở (GuideButton) ở hàng công cụ. */
export function FlowGuide({ id, title = 'Quy trình thao tác', guide, children }: { id: string; title?: string; guide?: [boolean, () => void]; children: ReactNode }) {
  const own = useGuide(id)
  const [closed, toggle] = guide ?? own
  if (guide && closed) return null
  return <div className={'panel distintro libguide' + (closed ? ' compact' : '')}>
    <div className="bar small"><b className="libguide-h">{title}</b>
      <button type="button" aria-expanded={!closed} onClick={toggle}>{closed ? 'Mở rộng' : 'Thu gọn'}</button></div>
    {children}
  </div>
}

/** Nút nhỏ mở lại khung hướng dẫn đã thu gọn */
export function GuideButton({ guide, title = 'Quy trình thao tác' }: { guide: [boolean, () => void]; title?: string }) {
  if (!guide[0]) return null
  return <button type="button" className="guidebtn" aria-expanded={false} onClick={guide[1]} title={`Xem ${title.toLowerCase()}`}>ⓘ {title}</button>
}
