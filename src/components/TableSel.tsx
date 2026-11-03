import { useState, type ReactNode } from 'react'

// Quy ước bảng:
//  • Bảng chỉ có một tác vụ (Xem / Mở / Soạn…): không ô tick, không nút — bấm vào tên là làm (NameLink).
//  • Bảng nhiều tác vụ: ô tick ở cột đầu (SelTh / SelTd), các nút thao tác nằm trên bảng, bên phải (SelBar).
//  • Tác vụ phá huỷ (Xoá, Gỡ, Bỏ gán…) luôn đi qua ô tick + nút trên bảng, không bấm thẳng trên dòng.

/** Chọn một dòng trong bảng (tick lại để bỏ chọn). */
export function useRowSel<T>(rows: T[], key: (r: T) => string = r => (r as { id: string }).id) {
  const [id, setId] = useState<string | null>(null)
  const cur = rows.find(r => key(r) === id) ?? null
  const is = (r: T) => cur !== null && key(cur) === key(r)
  return { cur, is, toggle: (r: T) => setId(is(r) ? null : key(r)), clear: () => setId(null) }
}

/** Chọn nhiều dòng; chỉ giữ các dòng đang hiện (lọc đi thì tự bỏ chọn). */
export function useMultiSel<T>(rows: T[], key: (r: T) => string = r => (r as { id: string }).id) {
  const [ids, setIds] = useState<Set<string>>(() => new Set())
  const list = rows.filter(r => ids.has(key(r)))
  const is = (r: T) => ids.has(key(r))
  const all = rows.length > 0 && list.length === rows.length
  return {
    list, is, all, some: list.length > 0 && !all,
    toggle: (r: T) => setIds(s => { const n = new Set(s); if (n.has(key(r))) n.delete(key(r)); else n.add(key(r)); return n }),
    toggleAll: () => setIds(all ? new Set() : new Set(rows.map(key))),
    clear: () => setIds(new Set()),
  }
}

/** Ô tick ở tiêu đề: chọn / bỏ chọn tất cả dòng đang hiện. */
export function SelAllTh({ all, some, onToggle }: { all: boolean; some: boolean; onToggle: () => void }) {
  return <th className="sel"><input type="checkbox" checked={all} ref={el => { if (el) el.indeterminate = some }} onChange={onToggle} aria-label="Chọn tất cả" /></th>
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
