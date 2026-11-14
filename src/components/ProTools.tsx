// Công cụ của bảng dạng mới (DataTable `pro`): ngăn kéo "Bộ lọc" có ghim, menu thao tác dòng ⋮, khung nổi dùng chung.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Khung nổi gắn dưới một nút; đóng khi bấm ra ngoài hoặc Esc. */
export function Pop({ anchor, onClose, children, width, align = 'left', className }: {
  anchor: HTMLElement | null; onClose: () => void; children: ReactNode; width?: number; align?: 'left' | 'right'; className?: string
}) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    if (!anchor || !box.current) return
    const r = anchor.getBoundingClientRect(), w = box.current.offsetWidth, h = box.current.offsetHeight
    let left = align === 'right' ? r.right - w : r.left
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
    let top = r.bottom + 6
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6)
    setPos({ top, left })
  }, [anchor, align])
  useEffect(() => {
    const close = (e: Event) => { const t = e.target as Node; if (!box.current?.contains(t) && !anchor?.contains(t)) onClose() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc); window.addEventListener('resize', onClose)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); window.removeEventListener('resize', onClose) }
  }, [anchor, onClose])
  return createPortal(<div ref={box} className={'tpop' + (className ? ' ' + className : '')} role="dialog"
    style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width }}>{children}</div>, document.body)
}

export type RowAction = { label: string; onClick: () => void; danger?: boolean }

/** Nút ⋮ cuối dòng: mở danh sách thao tác của riêng dòng đó. */
export function RowMenu({ items, label }: { items: RowAction[]; label: string }) {
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  if (!items.length) return null
  return <>
    <button type="button" ref={btn} className="trowmenu" aria-label={'Thao tác: ' + label} aria-expanded={open} onClick={() => setOpen(!open)}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
    </button>
    {open && <Pop anchor={btn.current} onClose={() => setOpen(false)} align="right" className="tmenu">
      {items.map(a => <button key={a.label} type="button" className={a.danger ? 'danger' : undefined} onClick={() => { setOpen(false); a.onClick() }}>{a.label}</button>)}
    </Pop>}
  </>
}

export type FilterDef = { key: string; label: string; options: [string, number][] }

/** Ngăn kéo "Bộ lọc" bên phải: mỗi cột một nhóm giá trị có ô tick; nút Ghim đưa bộ lọc ra thanh lọc trên bảng. */
export function FilterDrawer({ defs, value, pins, onPin, onApply, onClose }: {
  defs: FilterDef[]; value: Record<string, string[]>; pins: string[]
  onPin: (key: string) => void; onApply: (v: Record<string, string[]>) => void; onClose: () => void
}) {
  const [tmp, setTmp] = useState<Record<string, string[]>>(() => ({ ...value }))
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(defs.map(d => [d.key, (value[d.key] ?? []).length > 0])))
  const [q, setQ] = useState('')
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc); return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase()
  const shown = q.trim() ? defs.filter(d => fold(d.label + ' ' + d.options.map(o => o[0]).join(' ')).includes(fold(q.trim()))) : defs
  const flip = (k: string, o: string) => setTmp(t => { const cur = t[k] ?? []; return { ...t, [k]: cur.includes(o) ? cur.filter(x => x !== o) : [...cur, o] } })
  return createPortal(<>
    <div className="tscrim" onClick={onClose} />
    <aside className="tdrawer" role="dialog" aria-label="Bộ lọc">
      <header><b>Bộ lọc</b><button type="button" className="tx" onClick={onClose} aria-label="Đóng">×</button></header>
      <div className="tdbody">
        <input type="search" className="tdsearch" placeholder="Tìm bộ lọc" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm bộ lọc" />
        <p className="tdhint">Bấm <b>Ghim</b> ở cuối dòng để bộ lọc đó hiện sẵn trên thanh lọc, lần sau lọc nhanh không cần mở bảng này.</p>
        {shown.map(d => {
          const n = (tmp[d.key] ?? []).length, isOpen = open[d.key] || !!q.trim(), pinned = pins.includes(d.key)
          return <div key={d.key} className={'tdsec' + (isOpen ? ' open' : '')}>
            <div className="tdh">
              <button type="button" className="tdt" aria-expanded={isOpen} onClick={() => setOpen(o => ({ ...o, [d.key]: !isOpen }))}>
                {d.label}{n > 0 && <span className="tdn">{n}</span>}<span className="tdcar" aria-hidden="true">›</span></button>
              <button type="button" className="tdpin" aria-pressed={pinned} onClick={() => onPin(d.key)} title={`Hiện bộ lọc ${d.label} ngay trên thanh lọc của bảng`}>
                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3z" /><path d="M12 14v7" /></svg>{pinned ? 'Đã ghim' : 'Ghim'}</button>
            </div>
            {isOpen && <div className="tdopts">{d.options.map(([o, c]) => <label key={o}>
              <input type="checkbox" checked={(tmp[d.key] ?? []).includes(o)} onChange={() => flip(d.key, o)} /><span>{o}</span><small>{c}</small></label>)}
              {!d.options.length && <small className="sub">Không có giá trị.</small>}</div>}
          </div>
        })}
        {!shown.length && <p className="sub">Không có bộ lọc nào khớp.</p>}
      </div>
      <footer><button type="button" onClick={() => setTmp({})}>Xoá hết bộ lọc</button><button type="button" className="primary" onClick={() => onApply(tmp)}>Lọc</button></footer>
    </aside>
  </>, document.body)
}

/** Bảng chiếm phần còn lại của màn hình: chỉ dòng trong bảng cuộn, tiêu đề trang và thanh lọc đứng yên. */
export function useFillHeight(on: boolean, reserve = 64) {
  const ref = useRef<HTMLDivElement>(null)
  const [h, setH] = useState<number | null>(null)
  const fit = useRef(() => {})
  fit.current = () => {
    const el = ref.current; if (!on || !el) return
    if (window.innerWidth < 900) return setH(null)
    const top = el.getBoundingClientRect().top + window.scrollY
    // Trang dạng một khung (xem index.css): đo đúng phần nằm dưới bảng (chân bảng, viền khung, lề dưới của trang)
    // để khung chạm sát lề dưới, khoảng trống dưới bằng khoảng trống trên
    let flat = false
    try { flat = !!el.closest('main')?.matches(':has(>.pframe .ttpro):not(:has(.pdclose))') } catch { /* trình duyệt cũ */ }
    let below = reserve
    if (flat) {
      const main = el.closest('main') as HTMLElement, frame = main.querySelector(':scope > .pframe') as HTMLElement | null
      if (frame) below = frame.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom + parseFloat(getComputedStyle(main).paddingBottom || '0')
    }
    setH(Math.max(320, Math.round(window.innerHeight - top - below)))
  }
  // Đo lại sau mỗi lần vẽ (thanh chọn, dòng bộ lọc hiện / ẩn làm bảng dịch xuống)
  useLayoutEffect(() => fit.current())
  useEffect(() => {
    if (!on) return
    const f = () => fit.current()
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [on])
  return { ref, h }
}
