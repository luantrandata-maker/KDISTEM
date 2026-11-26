import { useEffect, useRef, useState } from 'react'

// Lọc theo Cấp › Khối: danh sách tick hai tầng. Tick cấp = chọn / bỏ cả các khối của cấp; không tick gì = tất cả.
export const GRADE_LEVELS = [{ k: 'th', name: 'Tiểu học', grades: [1, 2, 3, 4, 5] }, { k: 'thcs', name: 'THCS', grades: [6, 7, 8, 9] }, { k: 'thpt', name: 'THPT', grades: [10, 11, 12] }] as const

/** Tên ngắn của các khối đang chọn: "Tất cả", "Tiểu học + THCS", "Khối 1, 3" */
export function gradesLabel(value: number[], all: number[] = GRADE_LEVELS.flatMap(l => [...l.grades])) {
  const v = value.filter(g => all.includes(g))
  if (!v.length || v.length === all.length) return 'Tất cả'
  const lv = GRADE_LEVELS.map(l => ({ l, gs: l.grades.filter(g => all.includes(g)) })).filter(x => x.gs.length)
  const full = lv.filter(x => x.gs.every(g => v.includes(g)))
  const rest = v.filter(g => !full.some(x => (x.gs as number[]).includes(g)))
  return [...full.map(x => x.l.name), ...(rest.length ? ['Khối ' + rest.join(', ')] : [])].join(' + ')
}

// Nút nằm bên phải: mép phải khung thẳng mép phải nút
const place = (b: HTMLElement) => { const r = b.getBoundingClientRect()
  return { top: Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 380)), left: Math.max(8, Math.min(r.right - 240, window.innerWidth - 248)) } }

export function LevelTicks({ value, onChange, grades, label = 'Cấp / Khối', count }: {
  value: number[]; onChange: (v: number[]) => void
  /** Các khối có thể chọn (mặc định cả 12 khối) */
  grades?: number[]; label?: string
  /** Số mục ở mỗi khối, hiện mờ bên phải */
  count?: (g: number) => number
}) {
  const all = grades ?? GRADE_LEVELS.flatMap(l => [...l.grades])
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const box = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!pos) return
    const close = (e: Event) => { if (!box.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setPos(null) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPos(null) }
    const off = () => setPos(null)
    // Trang cuộn (hay bảng đổi cao sau khi lọc): khung đi theo nút; cuộn trong khung thì giữ
    const scr = (e: Event) => { if (!box.current?.contains(e.target as Node) && btn.current) setPos(place(btn.current)) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc); window.addEventListener('resize', off); window.addEventListener('scroll', scr, true)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); window.removeEventListener('resize', off); window.removeEventListener('scroll', scr, true) }
  }, [pos])
  const open = () => { if (pos) setPos(null); else setPos(place(btn.current!)) }
  const sel = value.filter(g => all.includes(g))
  const set = (v: number[]) => { const s = all.filter(g => v.includes(g)); onChange(s.length === all.length ? [] : s) }
  const levels = GRADE_LEVELS.map(l => ({ ...l, gs: l.grades.filter(g => all.includes(g)) as number[] })).filter(l => l.gs.length)
  const on = (g: number) => sel.includes(g)
  const flip = (g: number) => set(on(g) ? sel.filter(x => x !== g) : [...sel, g])
  const flipLv = (gs: number[]) => set(gs.every(on) ? sel.filter(g => !gs.includes(g)) : [...sel, ...gs])
  const txt = gradesLabel(sel, all)
  return <span className="lvgrp">
    {label && <span className="lvlab">{label}</span>}
    <button type="button" ref={btn} className={'tdd' + (sel.length ? ' on' : '')} aria-expanded={!!pos} aria-haspopup="dialog" onClick={open} title={txt}>
      <span className="gtlab">{txt}</span><span className="tcar" aria-hidden="true" /></button>
    {pos && <div ref={box} className="ttfpop gtpop" role="dialog" aria-label={`Lọc ${label}`} style={{ top: pos.top, left: pos.left }}>
      <div className="ttfacts">
        <button type="button" disabled={!sel.length} onClick={() => onChange([])}>Tất cả khối</button>
      </div>
      <ul>{levels.map(l => { const n = l.gs.filter(on).length
        return <li key={l.k} className="gtlv">
          <label><input type="checkbox" checked={n === l.gs.length} ref={el => { if (el) el.indeterminate = n > 0 && n < l.gs.length }} onChange={() => flipLv(l.gs)} /> <span><b>{l.name}</b></span>
            {count && <small className="sub">{l.gs.reduce((s, g) => s + count(g), 0)}</small>}</label>
          <ul>{l.gs.map(g => <li key={g}><label><input type="checkbox" checked={on(g)} onChange={() => flip(g)} /> <span>Khối {g}</span>
            {count && <small className="sub">{count(g)}</small>}</label></li>)}</ul>
        </li> })}</ul>
    </div>}
  </span>
}
