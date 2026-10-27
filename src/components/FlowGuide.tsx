import { useState, type ReactNode } from 'react'

/** Khung "Quy trình thao tác" (các bước .distguide). Thu gọn: chỉ còn số và tên bước, nhớ theo từng trang trên trình duyệt này. */
export function FlowGuide({ id, title = 'Quy trình thao tác', children }: { id: string; title?: string; children: ReactNode }) {
  const key = 'kdi-guide-' + id
  const [closed, setClosed] = useState(() => { try { return localStorage.getItem(key) === '1' } catch { return false } })
  const toggle = () => { setClosed(!closed); try { localStorage.setItem(key, closed ? '0' : '1') } catch { /* chỉ đổi trong phiên */ } }
  return <div className={'panel distintro libguide' + (closed ? ' compact' : '')}>
    <div className="bar small"><b className="libguide-h">{title}</b>
      <button type="button" aria-expanded={!closed} onClick={toggle}>{closed ? 'Mở rộng' : 'Thu gọn'}</button></div>
    {children}
  </div>
}
