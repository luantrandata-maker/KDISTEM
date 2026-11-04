// Hàng thẻ tổng số dùng chung cho Phân hệ 1 và 2: biểu tượng, số lớn, tên thẻ, dòng chi tiết.
// Thẻ có `k` và trang truyền `onPick` thì bấm được: bấm để lọc danh sách bên dưới, bấm lại để bỏ lọc.
// Số trên thẻ do trang tính theo các bộ lọc đang chọn bên dưới.
import type { ReactNode } from 'react'
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

/** nav: bấm thẻ để mở tab / mục tương ứng (không giữ trạng thái lọc) */
export function StatCards({ items, active, onPick, nav }: { items: Stat[]; active?: string | null; onPick?: (k: string | null) => void; nav?: boolean }) {
  const cols = Math.min(4, Math.max(1, items.length))
  return (
    <div className={`statcards c${cols}`}>
      {items.map((s, i) => {
        const inner = <>
          <i aria-hidden="true" className={s.tone || undefined}><Icon n={s.icon} size={20} /></i>
          <span><b>{s.value}</b><small>{s.label}</small>{s.sub != null && s.sub !== '' && <small>{s.sub}</small>}</span>
        </>
        if (s.k && onPick) {
          const on = !nav && active === s.k
          return <button key={i} type="button" className={'panel' + (on ? ' on' : '')} aria-pressed={on}
            title={nav ? `Mở: ${s.label}` : on ? 'Bấm để bỏ lọc' : `Lọc: ${s.label}`} onClick={() => onPick(on ? null : s.k!)}>{inner}</button>
        }
        return <div key={i} className="panel">{inner}</div>
      })}
    </div>
  )
}
