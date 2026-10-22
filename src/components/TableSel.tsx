import { useState, type ReactNode } from 'react'

// Quy ước bảng:
//  • Bảng chỉ có một tác vụ (Xem / Mở / Soạn…): không ô tick, không nút — bấm vào tên là làm (NameLink).
//  • Bảng nhiều tác vụ: ô tick ở cột đầu (SelTh / SelTd), các nút thao tác nằm trên bảng, bên phải (SelBar).
//  • Tác vụ phá huỷ (Xoá, Gỡ, Bỏ gán…) luôn đi qua ô tick + nút trên bảng, không bấm thẳng trên dòng.

/** Chọn một dòng trong bảng (tick lại để bỏ chọn). */
export function useRowSel<T extends { id: string }>(rows: T[]) {
  const [id, setId] = useState<string | null>(null)
  const cur = rows.find(r => r.id === id) ?? null
  return { cur, is: (r: T) => cur?.id === r.id, toggle: (r: T) => setId(cur?.id === r.id ? null : r.id), clear: () => setId(null) }
}

export function SelTh() {
  return <th className="sel"><span className="sronly">Chọn</span></th>
}

export function SelTd({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return <td className="sel"><input type="checkbox" checked={on} onChange={onToggle} aria-label={'Chọn ' + label} /></td>
}

/** Tên ở dòng bảng một tác vụ: bấm (hoặc Enter) để mở. */
export function NameLink({ onClick, children, title }: { onClick: () => void; children: ReactNode; title?: string }) {
  return <button type="button" className="namelink" onClick={onClick} title={title}>{children}</button>
}

/** Thanh thao tác trên bảng (bên phải). Không chọn dòng nào thì các nút vẫn hiện nhưng bị khoá. */
export function SelBar({ picked, children, left }: { picked: string | null; children: ReactNode; left?: ReactNode }) {
  return (
    <div className="selbar">
      <div className="selbar-left">{left}</div>
      <div className="tools">
        {picked && <small className="sub">Đã chọn: <b>{picked}</b></small>}
        {children}
      </div>
    </div>
  )
}
