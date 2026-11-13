// Bảng dùng chung có công cụ: lọc theo cột (hàng lọc dưới tiêu đề, mặc định ẩn; mỗi ô mở danh sách giá trị có tìm, tick chọn nhiều), ẩn/hiện và kéo đổi thứ tự cột,
// kéo mép tiêu đề để đổi độ rộng, nút "Thu gọn" thu bảng vừa màn hình (chữ xuống dòng, không phải kéo ngang).
// Cách hiển thị (cột ẩn, thứ tự, độ rộng, vừa khít) nhớ theo từng bảng trên trình duyệt này.
// Sắp xếp khi bấm tiêu đề vẫn do lib/tableSort lo (hàng lọc có class ttfilter được bỏ qua).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type HTMLAttributes } from 'react'
import { norm } from '../lib/sheet'

export type Col<T> = {
  key: string
  label: string
  cell: (r: T) => ReactNode
  /** Chữ để lọc cột; bỏ trống thì cột không có ô lọc */
  text?: (r: T) => string
  /** Giá trị để tick chọn khi lọc (một dòng có thể nhiều giá trị, vd. nhiều môn); mặc định là text */
  values?: (r: T) => string[]
  /** Không cho ẩn (vd. cột tên) */
  fixed?: boolean
  /** Ẩn mặc định */
  off?: boolean
  thClass?: string
}
type View = { hidden: string[]; order: string[]; widths: Record<string, number>; fit: boolean; seen?: string[] }
const EMPTY: View = { hidden: [], order: [], widths: {}, fit: false }
const load = (id: string, cols: Col<unknown>[]): View => {
  try {
    const v = JSON.parse(localStorage.getItem('tt:' + id) ?? 'null')
    // Cột mới thêm sau khi người dùng đã lưu cách hiển thị: cột "ẩn mặc định" vẫn ẩn
    if (v) { const seen: string[] = v.seen ?? []; return { ...EMPTY, ...v, hidden: [...new Set([...(v.hidden ?? []), ...cols.filter(c => c.off && !seen.includes(c.key)).map(c => c.key)])] } }
  } catch { /* mặc định */ }
  return { ...EMPTY, hidden: cols.filter(c => c.off).map(c => c.key) }
}
const fold = (s: string) => norm(s).toLowerCase()
const BLANK = '(Trống)'
const valsOf = <T,>(c: Col<T>, r: T) => { const v = (c.values ? c.values(r) : [c.text!(r)]).map(x => (x ?? '').trim()).filter(Boolean); return v.length ? v : [BLANK] }
const foldVi = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()

/** Ô lọc một cột: bấm mở danh sách giá trị có ô tìm, tick chọn nhiều */
function ColFilter({ label, options, value, onChange }: { label: string; options: [string, number][]; value: string[]; onChange: (v: string[]) => void }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!pos) return
    const close = (e: Event) => { if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setPos(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null) }
    const off = () => setPos(null)
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc); window.addEventListener('resize', off)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); window.removeEventListener('resize', off) }
  }, [pos])
  const open = () => {
    if (pos) return setPos(null)
    const r = btn.current!.getBoundingClientRect()
    setQ(''); setPos({ top: Math.min(r.bottom + 4, window.innerHeight - 340), left: Math.max(8, Math.min(r.left, window.innerWidth - 288)) })
  }
  const sel = new Set(value)
  const list = q.trim() ? options.filter(([o]) => fold(o).includes(fold(q.trim()))) : options
  const flip = (o: string) => onChange(sel.has(o) ? value.filter(x => x !== o) : [...value, o])
  return <>
    <button type="button" ref={btn} className={'ttfbtn' + (value.length ? ' on' : '')} aria-expanded={!!pos} aria-label={`Lọc cột ${label}`} onClick={open}
      title={value.join(', ') || undefined}>{value.length === 0 ? 'Tất cả' : value.length === 1 ? value[0] : `${value.length} đã chọn`}</button>
    {pos && <div ref={box} className="ttfpop" role="dialog" aria-label={`Lọc ${label}`} style={{ top: pos.top, left: pos.left }}>
      <input autoFocus placeholder="Tìm…" value={q} onChange={e => setQ(e.target.value)} aria-label={`Tìm giá trị ${label}`} />
      <div className="ttfacts">
        <button type="button" disabled={!list.length} onClick={() => onChange([...new Set([...value, ...list.map(([o]) => o)])])}>{q.trim() ? 'Chọn các mục tìm thấy' : 'Chọn tất cả'}</button>
        <button type="button" disabled={!value.length} onClick={() => onChange([])}>Bỏ chọn</button>
      </div>
      <ul>{list.slice(0, 300).map(([o, n]) => <li key={o}><label><input type="checkbox" checked={sel.has(o)} onChange={() => flip(o)} /> <span>{o}</span> <small className="sub">{n}</small></label></li>)}
        {!list.length && <li><small className="sub">Không có giá trị nào khớp.</small></li>}
        {list.length > 300 && <li><small className="sub">Còn {list.length - 300} giá trị, gõ để tìm.</small></li>}</ul>
    </div>}
  </>
}

export function DataTable<T>({ id, rows, cols, rowKey, empty, className, head, foot, left, right, onRow, simple, noTools, rowProps, aside }: {
  id: string; rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; empty?: ReactNode; className?: string
  /** Thuộc tính thêm cho từng dòng (vd: kéo thả) */
  rowProps?: (r: T) => HTMLAttributes<HTMLTableRowElement>
  /** Ô đầu dòng tiêu đề / dòng dữ liệu (vd. ô chọn), không lọc, không ẩn */
  head?: { th: ReactNode; td: (r: T) => ReactNode }
  /** Dòng cuối (vd. dòng thêm mới). Dạng hàm: nhận khoá các cột đang hiện theo thứ tự (kèm cột đầu nếu có) để dựng ô thẳng cột */
  foot?: ReactNode | ((keys: string[]) => ReactNode)
  /** Ô tìm, bộ lọc của trang: nằm cùng hàng với công cụ bảng (bên trái) */
  left?: ReactNode
  /** Nút chính của trang (vd. Thêm…): cuối hàng, bên phải */
  right?: ReactNode
  /** Bấm cả dòng để mở */
  onRow?: (r: T) => void
  /** Bảng gọn: bỏ nút "Lọc theo cột" và "Thu gọn", chỉ giữ Ẩn/hiện cột */
  simple?: boolean
  /** Không hiện hàng công cụ (dùng khi nhiều bảng con dùng chung một thanh công cụ ngoài) */
  noTools?: boolean
  /** Khung bên trái bảng, cùng viền với bảng (vd. cây nhóm theo khối) */
  aside?: ReactNode
}) {
  const [view, setViewS] = useState<View>(() => load(id, cols as Col<unknown>[]))
  const setView = (f: (v: View) => View) => setViewS(v => { const n = { ...f(v), seen: [...new Set([...(v.seen ?? []), ...cols.map(c => c.key)])] }; try { localStorage.setItem('tt:' + id, JSON.stringify(n)) } catch { /* chỉ trong phiên */ } return n })
  const [filterOn, setFilterOn] = useState(false)
  // Ô tìm trong bảng: luôn có, trừ khi trang đã đặt ô tìm của riêng nó ở thanh công cụ (left)
  const [q, setQ] = useState('')
  const toolsRef = useRef<HTMLDivElement>(null)
  const [ownSearch, setOwnSearch] = useState(false)
  useLayoutEffect(() => {
    const el = toolsRef.current?.querySelector('.ttleft')
    setOwnSearch(!!el?.querySelector('input[type=search], input[placeholder^="Tìm"], input[placeholder^="tìm"]'))
  })
  const [flt, setFlt] = useState<Record<string, string[]>>({})
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

  // Thứ tự: theo danh sách đã lưu, cột mới (chưa có trong danh sách) giữ vị trí gốc ở cuối; cột "Cập nhật" mặc định luôn cuối bảng
  const ordered = useMemo(() => {
    const pos = new Map(view.order.map((k, i) => [k, i]))
    const base = (c: Col<T>, i: number) => 1000 + i + (c.label === 'Cập nhật' ? 500 : 0)
    return cols.map((c, i) => ({ c, i })).sort((a, b) => (pos.get(a.c.key) ?? base(a.c, a.i)) - (pos.get(b.c.key) ?? base(b.c, b.i))).map(x => x.c)
  }, [cols, view.order])
  const shownCols = ordered.filter(c => c.fixed || !view.hidden.includes(c.key))
  const active = Object.entries(flt).filter(([k, v]) => v.length && shownCols.some(c => c.key === k))
  const match = (r: T, skip?: string) => active.every(([k, v]) => { if (k === skip) return true; const c = cols.find(x => x.key === k); return !c?.text || valsOf(c, r).some(x => v.includes(x)) })
  const qk = ownSearch ? '' : foldVi(q.trim())
  const hit = (r: T) => !qk || cols.some(c => c.text && valsOf(c, r).some(v => foldVi(v).includes(qk)))
  const shown = active.length || qk ? rows.filter(r => match(r) && hit(r)) : rows
  // Giá trị của từng cột (đếm theo các dòng khớp những cột lọc khác), sắp theo chữ
  const options = (c: Col<T>): [string, number][] => {
    const m = new Map<string, number>()
    rows.forEach(r => { if (match(r, c.key)) new Set(valsOf(c, r)).forEach(v => m.set(v, (m.get(v) ?? 0) + 1)) })
    ;(flt[c.key] ?? []).forEach(v => { if (!m.has(v)) m.set(v, 0) })
    return [...m].sort((a, b) => a[0] === BLANK ? 1 : b[0] === BLANK ? -1 : a[0].localeCompare(b[0], 'vi', { numeric: true }))
  }

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
  // Chỉ nhắc số cột ẩn khi người dùng tự đổi so với mặc định
  const customHidden = [...view.hidden].sort().join() !== cols.filter(c => c.off).map(c => c.key).sort().join()
  const nHidden = cols.filter(c => !c.fixed && view.hidden.includes(c.key)).length
  const changed = nHidden > 0 || view.order.length > 0 || Object.keys(view.widths).length > 0 || view.fit

  // Cột chính (thường là tên): giữ độ rộng tối thiểu để tên không bị ép từng chữ khi màn hình hẹp
  const lead = shownCols.find(c => !/c-no|c-sel/.test(c.thClass ?? '') && c.key !== 'no')
  const tbl = <div className="wrap"><table className={`libtable ttable${view.fit && !simple ? ' ttfit' : ''}${className ? ' ' + className : ''}`}>
      <colgroup>{head && <col style={{ width: 36 }} />}{shownCols.map(c => <col key={c.key} style={view.widths[c.key] ? { width: view.widths[c.key] } : undefined} />)}</colgroup>
      <thead>
        <tr>{head && <th className="c-sel">{head.th}</th>}{shownCols.map(c => <th key={c.key} className={[c.thClass, c === lead ? 'c-lead' : ''].filter(Boolean).join(' ') || undefined}
          style={view.widths[c.key] ? { width: view.widths[c.key], minWidth: view.widths[c.key] } : undefined}>{c.label}
          <span className="ttresize" role="separator" aria-label={`Đổi độ rộng cột ${c.label}`} onMouseDown={e => resize(c.key, e)} onClick={e => e.stopPropagation()}
            onDoubleClick={e => { e.stopPropagation(); setView(v => { const w = { ...v.widths }; delete w[c.key]; return { ...v, widths: w } }) }} /></th>)}</tr>
        {filterOn && <tr className="ttfilter">{head && <th />}{shownCols.map(c => <th key={c.key}>{c.text
          ? <ColFilter label={c.label} options={options(c)} value={flt[c.key] ?? []} onChange={v => setFlt(f => ({ ...f, [c.key]: v }))} />
          : null}</th>)}</tr>}
      </thead>
      <tbody>{shown.map(r => <tr key={rowKey(r)} className={onRow ? 'clickrow' : undefined} onClick={onRow && (() => onRow(r))} {...rowProps?.(r)}>{head && <td>{head.td(r)}</td>}{shownCols.map(c => <td key={c.key}><div className="tdc">{c.cell(r)}</div></td>)}</tr>)}
        {!shown.length && <tr><td colSpan={shownCols.length + (head ? 1 : 0)}>{rows.length ? <small className="sub">{qk ? `Không có dòng nào khớp “${q.trim()}”.` : 'Không có dòng nào khớp bộ lọc cột.'}</small> : empty}</td></tr>}</tbody>
      {typeof foot === 'function' ? foot([...(head ? ['_head'] : []), ...shownCols.map(c => c.key)]) : foot}
    </table></div>

  return <div className="tt">
    {!noTools && <div className="tttools" ref={toolsRef}>
      {!ownSearch && <input type="search" className="ttsearch" placeholder="Tìm trong bảng…" aria-label="Tìm trong bảng" value={q} onChange={e => setQ(e.target.value)} />}
      {left && <div className="ttleft">{left}</div>}
      {shown.length !== rows.length ? <small className="sub ttcount">{shown.length}/{rows.length} dòng</small> : !left && <small className="sub ttcount">{rows.length} dòng</small>}
      <div className="ttgroup" role="group" aria-label="Tuỳ chỉnh bảng">
      {!simple && <button type="button" className={filterOn ? 'on' : ''} aria-pressed={filterOn} onClick={() => { setFilterOn(!filterOn); if (filterOn) setFlt({}) }}
        title={filterOn ? 'Ẩn ô lọc dưới tiêu đề cột' : 'Hiện ô lọc dưới tiêu đề từng cột'}><TIcon d={IC.filter} />Lọc{active.length > 0 && <span className="ttbadge">{active.length}</span>}</button>}
      <div className="ttmenu" ref={menuRef}>
        <button type="button" className={menu ? 'on' : ''} aria-expanded={menu} onClick={() => setMenu(!menu)} title="Ẩn/hiện cột, kéo để đổi thứ tự"><TIcon d={IC.cols} />Cột{nHidden > 0 && customHidden && <span className="ttbadge" title={`${nHidden} cột đang ẩn`}>{nHidden} ẩn</span>}</button>
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
      {!simple && <button type="button" className={view.fit ? 'on' : ''} aria-pressed={view.fit} onClick={() => setView(v => ({ ...v, fit: !v.fit }))}
        title="Thu bảng vừa chiều ngang màn hình, chữ dài tự xuống dòng"><TIcon d={IC.fit} />Thu gọn</button>}
      </div>
      {right}
    </div>}
    {aside ? <SideSplit aside={aside}>{tbl}</SideSplit> : tbl}
  </div>
}

/** Biểu tượng nét mảnh cho thanh công cụ bảng */
const IC = {
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  cols: 'M4 4h16v16H4zM9.5 4v16M14.5 4v16',
  fit: 'M8 8l-4 4 4 4M16 8l4 4-4 4M4 12h16',
}
function TIcon({ d }: { d: string }) {
  return <svg className="ticon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
}

/** Khung bên trái (cây Cấp → Khối) cạnh bảng / thẻ: kéo mép phải để đổi độ rộng, nút « » để thu gọn / mở lại.
 *  Độ rộng và trạng thái thu gọn nhớ chung cho mọi bảng trên trình duyệt này. */
const SIDE_KEY = 'tt:side'
const loadSide = (): { w: number; off: boolean } => { try { return { w: 190, off: false, ...JSON.parse(localStorage.getItem(SIDE_KEY) ?? '{}') } } catch { return { w: 190, off: false } } }
export function SideSplit({ aside, children }: { aside: ReactNode; children: ReactNode }) {
  const [side0, setSideS] = useState(loadSide)
  const setSide = (v: { w: number; off: boolean }) => { setSideS(v); try { localStorage.setItem(SIDE_KEY, JSON.stringify(v)) } catch { /* chỉ trong phiên */ } }
  // Khung hẹp (laptop nhỏ, phóng to trình duyệt): tự thu cây để bảng đủ chỗ; bấm » vẫn mở được
  const box = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  const [openNarrow, setOpenNarrow] = useState(false)
  useEffect(() => {
    const el = box.current; if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 900))
    ro.observe(el); return () => ro.disconnect()
  }, [])
  const side = { ...side0, off: side0.off || (narrow && !openNarrow) }
  const show = () => { setOpenNarrow(true); setSide({ ...side0, off: false }) }
  const hide = () => { setOpenNarrow(false); setSide({ ...side0, off: true }) }
  const drag = (e: React.MouseEvent) => {
    e.preventDefault()
    const x0 = e.clientX, w0 = side.w
    let w = w0
    const mv = (ev: MouseEvent) => { w = Math.max(140, Math.min(420, w0 + ev.clientX - x0)); setSideS(v => ({ ...v, w })) }
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); document.body.classList.remove('ttdragging'); setSide({ w, off: false }) }
    document.body.classList.add('ttdragging')
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up)
  }
  return <div ref={box} className={'ttbody' + (side.off ? ' sideoff' : '')} style={{ gridTemplateColumns: side.off ? '34px minmax(0,1fr)' : `${side.w}px minmax(0,1fr)` }}>
    {side.off
      ? <div className="ttaside ttaside-off"><button type="button" className="ttsidebtn" onClick={show} title="Hiện cây nhóm theo khối" aria-label="Hiện cây nhóm theo khối">»</button></div>
      : <div className="ttaside">
        <button type="button" className="ttsidebtn ttsidehide" onClick={hide} title="Ẩn cây nhóm theo khối" aria-label="Ẩn cây nhóm theo khối">«</button>
        {aside}
        <span className="ttsidegrip" role="separator" aria-orientation="vertical" aria-label="Kéo để đổi độ rộng" title="Kéo để đổi độ rộng · bấm đúp để về mặc định"
          onMouseDown={drag} onDoubleClick={() => setSide({ w: 190, off: false })} />
      </div>}
    {children}
  </div>
}

/** Gom các ô lọc ít dùng (Tỉnh / Sở, trường…) vào nút "Bộ lọc" */
export function MoreFilters({ active, children }: { active?: boolean; children: ReactNode }) {
  if (!children) return null
  return <details className="morefilt"><summary>Bộ lọc{active && <b> •</b>}</summary><div className="panel">{children}</div></details>
}
