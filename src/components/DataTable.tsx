// Bảng dùng chung có công cụ: lọc theo cột (hàng lọc dưới tiêu đề, mặc định ẩn), ẩn/hiện và kéo đổi thứ tự cột,
// kéo mép tiêu đề để đổi độ rộng, nút "Vừa khít" thu bảng vừa màn hình (chữ xuống dòng, không phải kéo ngang).
// Cách hiển thị (cột ẩn, thứ tự, độ rộng, vừa khít) nhớ theo từng bảng trên trình duyệt này.
// Sắp xếp khi bấm tiêu đề vẫn do lib/tableSort lo (hàng lọc có class ttfilter được bỏ qua).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { norm } from '../lib/sheet'

export type Col<T> = {
  key: string
  label: string
  cell: (r: T) => ReactNode
  /** Chữ để lọc cột; bỏ trống thì cột không có ô lọc */
  text?: (r: T) => string
  /** Không cho ẩn (vd. cột tên) */
  fixed?: boolean
  /** Ẩn mặc định */
  off?: boolean
  thClass?: string
}
type View = { hidden: string[]; order: string[]; widths: Record<string, number>; fit: boolean }
const EMPTY: View = { hidden: [], order: [], widths: {}, fit: false }
const load = (id: string, cols: Col<unknown>[]): View => {
  try { const v = JSON.parse(localStorage.getItem('tt:' + id) ?? 'null'); if (v) return { ...EMPTY, ...v } } catch { /* mặc định */ }
  return { ...EMPTY, hidden: cols.filter(c => c.off).map(c => c.key) }
}
const fold = (s: string) => norm(s).toLowerCase()

export function DataTable<T>({ id, rows, cols, rowKey, empty, className, head, foot, left, right, onRow }: {
  id: string; rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; empty?: ReactNode; className?: string
  /** Ô đầu dòng tiêu đề / dòng dữ liệu (vd. ô chọn), không lọc, không ẩn */
  head?: { th: ReactNode; td: (r: T) => ReactNode }
  foot?: ReactNode
  /** Ô tìm, bộ lọc của trang: nằm cùng hàng với công cụ bảng (bên trái) */
  left?: ReactNode
  /** Nút chính của trang (vd. Thêm…): cuối hàng, bên phải */
  right?: ReactNode
  /** Bấm cả dòng để mở */
  onRow?: (r: T) => void
}) {
  const [view, setViewS] = useState<View>(() => load(id, cols as Col<unknown>[]))
  const setView = (f: (v: View) => View) => setViewS(v => { const n = f(v); try { localStorage.setItem('tt:' + id, JSON.stringify(n)) } catch { /* chỉ trong phiên */ } return n })
  const [filterOn, setFilterOn] = useState(false)
  const [flt, setFlt] = useState<Record<string, string>>({})
  const [menu, setMenu] = useState(false)
  const [drag, setDrag] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [menu])

  // Thứ tự: theo danh sách đã lưu, cột mới (chưa có trong danh sách) giữ vị trí gốc ở cuối
  const ordered = useMemo(() => {
    const pos = new Map(view.order.map((k, i) => [k, i]))
    return cols.map((c, i) => ({ c, i })).sort((a, b) => (pos.get(a.c.key) ?? 1000 + a.i) - (pos.get(b.c.key) ?? 1000 + b.i)).map(x => x.c)
  }, [cols, view.order])
  const shownCols = ordered.filter(c => c.fixed || !view.hidden.includes(c.key))
  const active = Object.entries(flt).filter(([k, v]) => v.trim() && shownCols.some(c => c.key === k))
  const shown = active.length ? rows.filter(r => active.every(([k, v]) => { const c = cols.find(x => x.key === k); return !c?.text || fold(c.text(r)).includes(fold(v.trim())) })) : rows

  const move = (from: string, to: string) => setView(v => {
    const keys = ordered.map(c => c.key), a = keys.indexOf(from), b = keys.indexOf(to)
    if (a < 0 || b < 0 || a === b) return v
    keys.splice(b, 0, keys.splice(a, 1)[0])
    return { ...v, order: keys }
  })
  const toggle = (k: string) => setView(v => ({ ...v, hidden: v.hidden.includes(k) ? v.hidden.filter(x => x !== k) : [...v.hidden, k] }))
  // Kéo mép phải tiêu đề để đổi độ rộng
  const resize = (k: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const th = (e.currentTarget as HTMLElement).parentElement!, x0 = e.clientX, w0 = th.getBoundingClientRect().width
    const mv = (ev: MouseEvent) => { const w = Math.max(48, Math.round(w0 + ev.clientX - x0)); setViewS(v => ({ ...v, widths: { ...v.widths, [k]: w } })) }
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); setView(v => v) }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up)
  }
  const nHidden = cols.filter(c => !c.fixed && view.hidden.includes(c.key)).length
  const changed = nHidden > 0 || view.order.length > 0 || Object.keys(view.widths).length > 0 || view.fit

  return <div className="tt">
    <div className="tttools">
      {left && <div className="ttleft">{left}</div>}
      {shown.length !== rows.length ? <small className="sub ttcount">{shown.length}/{rows.length} dòng</small> : !left && <small className="sub ttcount">{rows.length} dòng</small>}
      <button type="button" className={filterOn ? 'on' : ''} aria-pressed={filterOn} onClick={() => { setFilterOn(!filterOn); if (filterOn) setFlt({}) }}
        title="Hiện ô lọc dưới tiêu đề từng cột">⛉ {filterOn ? 'Ẩn bộ lọc cột' : 'Lọc theo cột'}{active.length ? ` (${active.length})` : ''}</button>
      <div className="ttmenu" ref={menuRef}>
        <button type="button" aria-expanded={menu} onClick={() => setMenu(!menu)} title="Chọn cột hiển thị, kéo để đổi thứ tự">▥ Ẩn/hiện cột{nHidden ? ` (${nHidden} ẩn)` : ''}</button>
        {menu && <div className="ttpop" role="dialog" aria-label="Hiển thị cột">
          <div className="ttpophead"><b>Hiển thị cột</b>
            <button type="button" onClick={() => setView(v => ({ ...v, hidden: [] }))}>Hiện tất cả</button></div>
          <small className="sub">Tick để ẩn/hiện · giữ ⠿ rồi kéo để đổi thứ tự</small>
          <ul>{ordered.map((c, i) => <li key={c.key} draggable onDragStart={() => setDrag(c.key)} onDragEnd={() => setDrag(null)}
            onDragOver={e => { e.preventDefault(); if (drag && drag !== c.key) move(drag, c.key) }} className={drag === c.key ? 'drag' : ''}>
            <span className="ttgrip" aria-hidden="true">⠿</span>
            <label><input type="checkbox" checked={c.fixed || !view.hidden.includes(c.key)} disabled={c.fixed} onChange={() => toggle(c.key)} /> {c.label}</label>
            <span className="ttmv">
              <button type="button" disabled={i === 0} aria-label={`Đưa ${c.label} lên`} onClick={() => move(c.key, ordered[i - 1].key)}>↑</button>
              <button type="button" disabled={i === ordered.length - 1} aria-label={`Đưa ${c.label} xuống`} onClick={() => move(c.key, ordered[i + 1].key)}>↓</button></span>
          </li>)}</ul>
          {changed && <button type="button" className="ttreset" onClick={() => { setView(() => ({ ...EMPTY, hidden: cols.filter(c => c.off).map(c => c.key) })); setMenu(false) }}>Về mặc định</button>}
        </div>}
      </div>
      <button type="button" className={view.fit ? 'on' : ''} aria-pressed={view.fit} onClick={() => setView(v => ({ ...v, fit: !v.fit }))}
        title="Thu bảng vừa chiều ngang màn hình, chữ dài tự xuống dòng">⇔ Vừa khít</button>
      {right}
    </div>
    <div className="wrap"><table className={`libtable ttable${view.fit ? ' ttfit' : ''}${className ? ' ' + className : ''}`}>
      <colgroup>{head && <col style={{ width: 36 }} />}{shownCols.map(c => <col key={c.key} style={view.widths[c.key] ? { width: view.widths[c.key] } : undefined} />)}</colgroup>
      <thead>
        <tr>{head && <th>{head.th}</th>}{shownCols.map(c => <th key={c.key} className={c.thClass}
          style={view.widths[c.key] ? { width: view.widths[c.key], minWidth: view.widths[c.key] } : undefined}>{c.label}
          <span className="ttresize" role="separator" aria-label={`Đổi độ rộng cột ${c.label}`} onMouseDown={e => resize(c.key, e)} onClick={e => e.stopPropagation()}
            onDoubleClick={e => { e.stopPropagation(); setView(v => { const w = { ...v.widths }; delete w[c.key]; return { ...v, widths: w } }) }} /></th>)}</tr>
        {filterOn && <tr className="ttfilter">{head && <th />}{shownCols.map(c => <th key={c.key}>{c.text
          ? <input value={flt[c.key] ?? ''} placeholder="Lọc…" aria-label={`Lọc cột ${c.label}`} onChange={e => setFlt(f => ({ ...f, [c.key]: e.target.value }))} />
          : null}</th>)}</tr>}
      </thead>
      <tbody>{shown.map(r => <tr key={rowKey(r)} className={onRow ? 'clickrow' : undefined} onClick={onRow && (() => onRow(r))}>{head && <td>{head.td(r)}</td>}{shownCols.map(c => <td key={c.key}>{c.cell(r)}</td>)}</tr>)}
        {!shown.length && <tr><td colSpan={shownCols.length + (head ? 1 : 0)}>{rows.length ? <small className="sub">Không có dòng nào khớp bộ lọc cột.</small> : empty}</td></tr>}</tbody>
      {foot}
    </table></div>
  </div>
}

/** Gom các ô lọc ít dùng (Tỉnh / Sở, trường…) vào nút "Bộ lọc" */
export function MoreFilters({ active, children }: { active?: boolean; children: ReactNode }) {
  if (!children) return null
  return <details className="morefilt"><summary>Bộ lọc{active && <b> •</b>}</summary><div className="panel">{children}</div></details>
}
