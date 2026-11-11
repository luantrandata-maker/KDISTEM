// Hàng thẻ tổng số dùng chung cho Phân hệ 1 và 2: biểu tượng, số lớn, tên thẻ, dòng chi tiết.
// Thẻ có `k` và trang truyền `onPick` thì bấm được: bấm để lọc danh sách bên dưới, bấm lại để bỏ lọc.
// Số trên thẻ do trang tính theo các bộ lọc đang chọn bên dưới.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'

export type Stat = {
  /** Khoá lọc; bỏ trống thì thẻ chỉ hiển thị số */
  k?: string
  icon: string
  value: ReactNode
  label: string
  sub?: ReactNode
  /** good: xanh (tốt) · warn: cam (cần chú ý) */
  tone?: 'good' | 'warn' | ''
}

const KEY = 'statcards-mini'
const readMini = () => { try { return localStorage.getItem(KEY) !== '0' } catch { return true } }

/** nav: bấm thẻ để mở tab / mục tương ứng (không giữ trạng thái lọc).
 *  Nút ▴ thu gọn: các số chuyển lên bên phải tiêu đề trang (.pagehead), không chiếm dòng riêng.
 *  Lựa chọn nhớ theo trình duyệt, dùng chung mọi trang. */
export function StatCards({ items, active, onPick, nav }: { items: Stat[]; active?: string | null; onPick?: (k: string | null) => void; nav?: boolean }) {
  const [mini, setMini] = useState(readMini)
  // Chỗ đặt số khi thu gọn: tiêu đề trang; trang ẩn thẻ (.nocards) thì không hiện
  const anchor = useRef<HTMLSpanElement>(null)
  const [head, setHead] = useState<Element | null | false>(null)
  useLayoutEffect(() => {
    const a = anchor.current
    setHead(!a || a.closest('.nocards') ? false : a.closest('main')?.querySelector(':scope > .pagehead') ?? null)
  }, [mini])
  const flip = () => { const v = !mini; setMini(v); try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* bỏ qua */ } }
  const cols = Math.min(5, Math.max(1, items.length))
  const pick = (s: Stat) => s.k && onPick ? () => onPick(!nav && active === s.k ? null : s.k!) : undefined
  if (mini) {
    const bar = <div className="statmini">
      {items.map((s, i) => {
        const on = !nav && !!s.k && active === s.k
        const inner = <><b>{s.value}</b><small>{s.label}</small></>
        return pick(s)
          ? <button key={i} type="button" className={on ? 'on' : ''} aria-pressed={on} title={nav ? `Mở: ${s.label}` : on ? 'Bấm để bỏ lọc' : `Lọc: ${s.label}`} onClick={pick(s)}>{inner}</button>
          : <span key={i}>{inner}</span>
      })}
      <button type="button" className="statflip" onClick={flip} title="Hiện thẻ tổng hợp" aria-label="Hiện thẻ tổng hợp">▾ Hiện thẻ</button>
    </div>
    return <><span ref={anchor} hidden />{head === false ? null : head ? createPortal(bar, head) : bar}</>
  }
  return (
    <div className="statwrap">
    <button type="button" className="statflip" onClick={flip} title="Thu gọn thẻ tổng hợp" aria-label="Thu gọn thẻ tổng hợp">▴ Thu gọn</button>
    <div className={`statcards c${cols}`}>
      {items.map((s, i) => {
        const inner = <>
          <i aria-hidden="true" className={s.tone || undefined}><Icon n={s.icon} size={20} /></i>
          <span><b>{s.value}</b><small>{s.label}</small>{s.sub != null && s.sub !== '' && <small>{s.sub}</small>}</span>
        </>
        if (s.k && onPick) {
          const on = !nav && active === s.k
          return <button key={i} type="button" className={'panel' + (on ? ' on' : '')} aria-pressed={on}
            title={nav ? `Mở: ${s.label}` : on ? 'Bấm để bỏ lọc' : `Lọc: ${s.label}`} onClick={pick(s)}>{inner}</button>
        }
        return <div key={i} className="panel">{inner}</div>
      })}
    </div>
    </div>
  )
}
