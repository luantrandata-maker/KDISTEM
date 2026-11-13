// Soạn / xem một bản phân phối trên một trang (không chia bước):
//  1. Chương trình & môn — thẻ gọn, tick chương trình và từng môn.
//  2. Xếp lịch — mỗi chương trình một dòng: bắt đầu, nhịp, kết quả; "Thứ tự bài" mở phần chỉnh riêng từng môn và kéo thả thứ tự.
//  3. Bản phối — dải tóm tắt / kiểm tra, Bảng (cột trái lọc chương trình · môn, tick giữ / bỏ bài) hoặc Lịch.
// Bản đã phát hành / ngừng dùng chỉ xem; muốn đổi thì "Tạo bản mới từ bản này".
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { DetailHead } from '../../components/DetailHead'
import { supabase } from '../../lib/supabase'
import { fmtGrades, progGrades, useEduLevels } from '../../lib/eduLevels'
import { useCls } from './cls'
import { useTiers } from './Tiers'
import { WeekGrid, colorOf } from './Grid'
import { useDistCalendar, type DistCal } from './calendar'
import { PlanHistory } from './History'
import { DataTable, type Col } from '../../components/DataTable'
import {
  checks, effSubjects, lessonsOf, orderLessons, reordered, progCode, schedule, spanOf, subjectsIn, termRange, weekLoad, LOAD_MAX,
  type Item, type Mode, type Plan, type Prog, type Row, type Status, type Subj, type SubjMode, type U,
} from './sched'

const PSEL = 'id, code, title, version_no, status, ct_code, level, grade_from, grade_to, grades, main_subject, periods_per_week, deploy_term'
const USEL = 'id, program_id, parent_id, unit_type, seq, title, periods, grade, grades, subject'
export const STATUS: Record<Status, [string, string]> = { draft: ['Nháp', 'warn'], published: ['Đã phát hành', 'good'], superseded: ['Đã thay thế', 'off'], archived: ['Ngừng dùng', 'off'] }
export const Chip = ({ tone, children }: { tone?: string; children: ReactNode }) => <span className={'distchip2 ' + (tone ?? '')}>{children}</span>
export const errText = (m: string) => (/schema cache|does not exist|column .* of relation/i.test(m) ? 'Hãy chạy migration 078, 079 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Bạn không có quyền với bản phân phối này.' : m)
const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')
const wkLabel = (ws: number[] | null) => {
  if (!ws?.length) return '—'
  const u = [...new Set(ws)].sort((x, y) => x - y), a = u[0], b = u[u.length - 1]
  return a === b ? String(a) : b - a + 1 === u.length ? `${a}–${b}` : u.join(', ')   // tiết bị tách: liệt kê từng tuần
}

/** Các bậc phân loại của bản phân phối (theo khung phân loại; chưa gắn thì cấp học › khối › phân loại cũ) */
export function useCrumbParts() {
  const { name: levelName } = useEduLevels()
  const { name: tierName } = useTiers()
  const { path } = useCls()
  return (p: Plan) => {
    const ns = path(p.node_id)
    return ns.length ? ns.map(n => n.name) : [levelName(p.level), `Khối ${p.grade}`, p.tier ? tierName(p.tier) : 'Chưa phân loại']
  }
}
export function useBreadcrumb() {
  const parts = useCrumbParts()
  return (p: Plan) => parts(p).join(' › ')
}

import { ActionBar } from '../../components/ActionBar'
export { MoreMenu } from '../../components/MoreMenu'

function Stepper({ value, onChange, disabled, label }: { value: number; onChange: (v: number) => void; disabled?: boolean; label: string }) {
  const set = (v: number) => onChange(Math.max(0.5, Math.min(40, Math.round(v * 2) / 2)))
  return <span className="stepper">
    <button type="button" disabled={disabled || value <= 0.5} onClick={() => set(value >= 2 ? value - 1 : 0.5)} aria-label={'Giảm ' + label}>−</button>
    <input type="number" min={0.5} max={40} step={0.5} disabled={disabled} value={value} aria-label={label} onChange={e => set(Number(e.target.value) || 1)} />
    <button type="button" disabled={disabled} onClick={() => set(value < 1 ? 1 : value + 1)} aria-label={'Tăng ' + label}>+</button>
  </span>
}

export type SubjCardData = {
  name: string; meta: string; changed: boolean; controls: ReactNode | null
  lessons: { id: string; title: string; periods: number }[]; weekOf: (id: string) => string
  /** Tick chọn bài đưa vào phân phối (bỏ tick = không dạy bài này trong bản) */
  isOn?: (id: string) => boolean; onToggle?: (ids: string[], on: boolean) => void
  onMove: (from: number, to: number) => void; onReset: () => void
}
/** Các môn của một chương trình trong bản: mỗi môn một thẻ thu gọn được, kéo cả thẻ để đổi thứ tự môn,
 *  kéo từng bài để đổi thứ tự bài (chỉ áp dụng cho bản phân phối này). Bàn phím: Alt + ↑↓. */
function SubjCards({ items, onMoveSubj }: { items: SubjCardData[]; onMoveSubj: (from: number, to: number) => void }) {
  const [shut, setShut] = useState<Set<string>>(new Set())
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const many = items.length > 1
  const key = (k: number) => (e: KeyboardEvent<HTMLElement>) => {
    if (!e.altKey || e.target !== e.currentTarget) return
    const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (d && k + d >= 0 && k + d < items.length) {
      e.preventDefault(); const list = e.currentTarget.closest('.distsubjlist'); onMoveSubj(k, k + d)
      requestAnimationFrame(() => (list?.children[k + d]?.querySelector('.distsubjgrip') as HTMLElement | null)?.focus())
    }
  }
  return <div className="distsubjlist">{items.map((x, k) => {
    const open = !shut.has(x.name)
    const toggle = () => setShut(o => { const n = new Set(o); if (n.has(x.name)) n.delete(x.name); else n.add(x.name); return n })
    return <section key={x.name} className={'distsubj' + (drag === k ? ' drag' : '') + (over === k && drag !== null && drag !== k ? ' over' : '')}
      onDragOver={many && drag !== null ? e => { e.preventDefault(); setOver(k) } : undefined}
      onDrop={many && drag !== null ? e => { e.preventDefault(); if (drag !== k) onMoveSubj(drag, k); setDrag(null); setOver(null) } : undefined}>
      <header>
        {many && <span className="distsubjgrip" tabIndex={0} role="button" draggable aria-label={`Kéo để đổi thứ tự môn ${x.name}, thứ ${k + 1}`} title="Kéo để đổi thứ tự môn (Alt + ↑↓)"
          onKeyDown={key(k)} onDragStart={e => { setDrag(k); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { setDrag(null); setOver(null) }}>⠿</span>}
        <button type="button" className="distsubjtoggle" aria-expanded={open} onClick={toggle}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(90deg)' : undefined }}><path d="m9 6 6 6-6 6" /></svg>
          <b>{x.name}</b> <small className="sub">{x.meta}</small></button>
        {x.changed && <span className="gpill warn">Đã đổi thứ tự bài</span>}
      </header>
      {x.controls && <div className="distsubjctl">{x.controls}</div>}
      {open && <LessonOrder {...x} />}
    </section>
  })}</div>
}

/** Danh sách bài của một môn trong bản: kéo thả hoặc Alt + ↑↓ để đổi thứ tự. */
function LessonOrder({ lessons, changed, weekOf, onMove, onReset, isOn, onToggle }: SubjCardData) {
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const key = (k: number) => (e: KeyboardEvent<HTMLLIElement>) => {
    if (!e.altKey) return
    const d = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
    if (d && k + d >= 0 && k + d < lessons.length) {
      e.preventDefault(); e.stopPropagation(); const list = e.currentTarget.parentElement; onMove(k, k + d)
      requestAnimationFrame(() => (list?.children[k + d] as HTMLElement | undefined)?.focus())
    }
  }
  return <div className="distlessons">
    <div className="distlessonsbar">{onToggle && isOn && lessons.length > 0 ? (() => {
      const n = lessons.filter(l => isOn(l.id)).length
      return <label className="distlessall"><input type="checkbox" checked={n === lessons.length} ref={el => { if (el) el.indeterminate = n > 0 && n < lessons.length }}
        onChange={() => onToggle(lessons.map(l => l.id), n < lessons.length)} /><small className="sub">Chọn bài đưa vào phân phối · {n}/{lessons.length} bài</small></label>
    })() : <small className="sub">Danh sách bài học</small>}
      {changed && <button type="button" className="linkbtn" onClick={onReset}>Về thứ tự khung</button>}</div>
    {lessons.length ? <ol>{lessons.map((l, k) => <li key={l.id} tabIndex={0} draggable aria-label={`${l.title}, bài ${k + 1}`}
      className={(drag === k ? 'drag' : '') + (over === k && drag !== k ? ' over' : '') + (isOn && !isOn(l.id) ? ' off' : '')} onKeyDown={key(k)}
      onDragStart={e => { e.stopPropagation(); setDrag(k); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { setDrag(null); setOver(null) }}
      onDragOver={e => { if (drag === null) return; e.preventDefault(); e.stopPropagation(); setOver(k) }}
      onDrop={e => { if (drag === null) return; e.preventDefault(); e.stopPropagation(); if (drag !== k) onMove(drag, k); setDrag(null); setOver(null) }}>
      <i aria-hidden="true">⠿</i>
      {onToggle && isOn && <input type="checkbox" checked={isOn(l.id)} aria-label={`Đưa bài ${l.title} vào phân phối`} title="Bỏ tick: không đưa bài này vào phân phối"
        onClick={e => e.stopPropagation()} onChange={e => onToggle([l.id], e.target.checked)} />}
      <span className="t">{l.title}</span>
      <small className="sub">{l.periods} tiết</small><span className="distwk">{weekOf(l.id)}</span></li>)}</ol>
      : <p className="sub" style={{ margin: '0 4px 4px' }}>Môn này chưa có bài.</p>}
  </div>
}

type PickOpt = { p: Prog; meta: string; off: boolean }
/** Nút "+ Thêm chương trình": sổ danh sách có ô tìm; chương trình chưa dùng được hiện mờ cuối danh sách. */
function ProgPicker({ opts, picked, onAdd, hint }: { opts: PickOpt[]; picked: Set<string>; onAdd: (p: Prog) => void; hint: string }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const qq = q.trim().toLowerCase()
  const shown = opts.filter(o => !qq || `${o.p.code ?? ''} ${o.p.ct_code ?? ''} ${o.p.title} ${o.meta}`.toLowerCase().includes(qq))
  const free = shown.filter(o => !o.off), off = shown.filter(o => o.off)
  const row = (o: PickOpt) => { const on = picked.has(o.p.id)
    return <li key={o.p.id}><button type="button" disabled={o.off || on} className={on ? 'on' : undefined} onClick={() => { onAdd(o.p); setQ('') }}>
      <span className="pk">{on ? '✓' : o.off ? '' : '+'}</span><span><b>{o.p.code || o.p.ct_code || ''}</b> {o.p.title}<small className="sub">{on ? 'Đã chọn · ' : ''}{o.meta}</small></span></button></li> }
  return <div className="distpicker" ref={box}>
    <button type="button" className="primary" aria-expanded={open} onClick={() => setOpen(!open)}>+ Thêm chương trình</button>
    {open && <div className="distpickpop" role="dialog" aria-label="Chọn chương trình">
      <input autoFocus placeholder="Tìm theo mã, tên chương trình, môn…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm chương trình" />
      <small className="sub">{hint} · {opts.filter(o => !o.off).length} chương trình dùng được</small>
      <ul>{free.map(row)}
        {off.length > 0 && <li className="sep"><small className="sub">Chưa dùng được ({off.length})</small></li>}
        {off.map(row)}
        {!shown.length && <li className="sep"><small className="sub">Không có chương trình nào khớp.</small></li>}</ul>
    </div>}
  </div>
}

type Toast = { text: string; bad?: boolean } | null
function useToast() {
  const [t, setT] = useState<Toast>(null)
  useEffect(() => { if (!t) return; const h = setTimeout(() => setT(null), t.bad ? 6000 : 3000); return () => clearTimeout(h) }, [t])
  return [t ? <div className={'disttoast' + (t.bad ? ' bad' : '')} role="status">{t.text}</div> : null, setT] as const
}

export function PlanBody({ plan: p0, orgId, back, backLabel, onChanged, onAssign }: {
  plan: Plan; orgId?: string | null; back: () => void; backLabel: string
  onChanged: (openId?: string, msg?: string) => void; onAssign?: (id: string) => void
}) {
  const crumbParts = useCrumbParts()
  const { name: levelName } = useEduLevels()
  const [plan, setPlan] = useState<Plan>(p0)
  const [items, setItems] = useState<Item[]>([])
  const [prev, setPrev] = useState<Map<string, Row>>(new Map())
  const [progs, setProgs] = useState<Map<string, Prog>>(new Map())
  const [pool, setPool] = useState<Prog[]>([])
  const [units, setUnits] = useState<U[]>([])
  const [loaded, setLoaded] = useState(false)
  /** Bản nháp mở ở chế độ xem; bấm "Chỉnh sửa" mới sửa được */
  const [editing, setEditing] = useState(false)
  const editable = plan.status === 'draft' && editing
  /** Bản của đơn vị mình: tạo được phiên bản mới; bản của đơn vị khác chỉ nhân bản. */
  const own = !!orgId && plan.org_id === orgId
  const [sel, setSel] = useState('')        // lọc bảng bài: '' = tất cả, hoặc 'chương trình|môn'
  const [q, setQ] = useState('')
  const [openOrd, setOpenOrd] = useState<Set<string>>(new Set())   // chương trình đang mở "Thứ tự bài"
  const [view, setView] = useState<'table' | 'cal'>('table')
  const [editRows, setEditRows] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useToast()
  const cal = useDistCalendar()

  useEffect(() => {
    (async () => {
      const [it, rw, pl] = await Promise.all([
        supabase.from('dist_plan_items').select('program_id, seq, start_mode, start_week, after_program, ppw, split, subjects').eq('plan_id', p0.id).order('seq'),
        supabase.from('dist_plan_rows').select('program_id, unit_id, seq, week, periods, note, manual, skipped, weeks').eq('plan_id', p0.id),
        supabase.from('edu_programs').select(PSEL).eq('level', p0.level).in('status', ['published', 'draft', 'pending', 'approved', 'rejected']).order('title'),
      ])
      if (it.error) setToast({ text: errText(it.error.message), bad: true })
      const its = ((it.data ?? []) as Item[]).map(i => ({ ...i, ppw: Number(i.ppw), split: !!i.split, subjects: Array.isArray(i.subjects) ? i.subjects : [] }))
      const ps = (pl.data as Prog[]) ?? []
      const missing = its.map(i => i.program_id).filter(id => !ps.some(p => p.id === id))
      const extra = missing.length ? ((await supabase.from('edu_programs').select(PSEL).in('id', missing)).data as Prog[]) ?? [] : []
      const usable = ps.filter(p => p.status === 'published' && progGrades(p).includes(p0.grade)).map(p => p.id)
      const ids = [...new Set([...usable, ...its.map(i => i.program_id)])]
      const us = ids.length ? ((await supabase.from('edu_program_units').select(USEL).in('program_id', ids)).data as U[]) ?? [] : []
      setItems(its); setPool(ps); setUnits(us)
      setProgs(new Map([...ps, ...extra].map(p => [p.id, p])))
      setPrev(new Map(((rw.data as Row[]) ?? []).map(r => [r.unit_id, r])))
      setLoaded(true)
    })()
  }, [p0.id])

  const s = useMemo(() => schedule(plan, items, prev, units, progs), [plan, items, prev, units, progs])
  const list = useMemo(() => checks(plan, items, s, progs), [plan, items, s, progs])
  const errors = list.filter(c => c.level === 'error'), warns = list.filter(c => c.level === 'warn')
  const lessonsBy = useMemo(() => {
    const m = new Map<string, ReturnType<typeof lessonsOf>>()
    for (const p of progs.values()) m.set(p.id, lessonsOf(units, p, plan.grade))
    return m
  }, [units, progs, plan.grade])
  const title = useMemo(() => new Map(units.map(u => [u.id, u.title])), [units])
  const rowOf = useMemo(() => new Map(s.rows.map(r => [r.unit_id, r])), [s.rows])
  const ordered = [...items].sort((a, b) => a.seq - b.seq)
  const order = ordered.map(i => i.program_id)
  const frame = plan.hk1_weeks + plan.hk2_weeks
  const avail = (pid: string) => subjectsIn(lessonsBy.get(pid) ?? [])
  const subjectsOf = (it: Item) => effSubjects(it, avail(it.program_id).map(x => x.name))
  const onSubjects = ordered.reduce((n, it) => n + subjectsOf(it).filter(x => x.on).length, 0)
  const live = s.rows.filter(r => !r.skipped && r.periods > 0)
  const periods = live.reduce((n, r) => n + r.periods, 0)
  const std = [...s.progs.values()].reduce((n, p) => n + p.subjects.reduce((m, x) => m + x.std, 0), 0)
  const all = spanOf(s.rows)
  const maxLoad = Math.max(0, ...weekLoad(s.rows).values())
  const holWeeks = [...weekLoad(s.rows).keys()].filter(w => cal.weeks.get(w)?.holidays.length).sort((a, b) => a - b)
  const grid = (titles?: boolean) => <>
    <CalBar cal={cal} />
    <WeekGrid plan={plan} order={order} progs={progs} s={s} titles={titles} cal={cal.state === 'ok' ? cal.weeks : undefined} calLabel={cal.label} year={cal.year} titleOf={id => title.get(id) ?? ''}
      onShift={editable ? shiftRange : undefined} onAuto={editable ? (pid, sub, a, b) => setRows(inRange(pid, sub, a, b).map(r => r.unit_id), { manual: false }) : undefined} />
  </>

  const touch = () => { setDirty(true) }
  const setItem = (pid: string, patch: Partial<Item>) => { setItems(xs => xs.map(i => i.program_id === pid ? { ...i, ...patch } : i)); touch() }
  const setSubjects = (it: Item, f: (xs: Subj[]) => Subj[]) => setItem(it.program_id, { subjects: f(subjectsOf(it)) })
  const setRow = (uid: string, patch: Partial<Row>) => {
    const cur = s.rows.find(r => r.unit_id === uid); if (!cur) return
    setPrev(m => new Map(m).set(uid, { ...cur, ...patch })); touch()
  }
  /** Bài (đang dạy) của một môn có tuần bắt đầu trong đoạn [a, b] */
  const inRange = (pid: string, sub: string, a: number, b: number) =>
    s.rows.filter(r => r.program_id === pid && !r.skipped && s.subjOf.get(r.unit_id) === sub && r.weeks?.length && r.weeks[0] >= a && r.weeks[0] <= b)
  /** Dời các bài trong đoạn tuần đi d tuần (đặt tuần bằng tay) */
  /** Dời các tiết nằm trong đoạn tuần [a, b] của một môn đi d tuần. Dời theo từng tiết, nên một bài nhiều tiết có thể tách
   *  (vd. tiết 2 sang tuần sau vì nghỉ lễ). Thứ tự tiết giữ nguyên: tiết phía sau / phía trước bị đè thì dời theo,
   *  nên giữa các tiết của một bài không có bài khác chen vào. */
  function shiftRange(pid: string, sub: string, a: number, b: number, d: number) {
    const rows = s.rows.filter(r => r.program_id === pid && !r.skipped && s.subjOf.get(r.unit_id) === sub && r.weeks?.length)
    const seq = rows.flatMap(r => r.weeks!.map((w, k) => ({ r, k, w })))
    const idx = seq.map((x, i) => (x.w >= a && x.w <= b ? i : -1)).filter(i => i >= 0)
    if (!idx.length) return setToast({ text: `Môn ${sub} không có tiết nào trong tuần ${a}–${b}.`, bad: true })
    const nw = seq.map(x => x.w), moved = new Set(idx)
    for (const i of idx) nw[i] += d
    if (d > 0) {
      let lim = Math.max(...idx.map(i => nw[i]))
      for (let i = Math.max(...idx) + 1; i < seq.length; i++) { if (moved.has(i)) continue; if (seq[i].w > lim) break; nw[i] += d; moved.add(i); lim = Math.max(lim, nw[i]) }
    } else {
      let lim = Math.min(...idx.map(i => nw[i]))
      for (let i = Math.min(...idx) - 1; i >= 0; i--) { if (moved.has(i)) continue; if (seq[i].w < lim) break; nw[i] += d; moved.add(i); lim = Math.min(lim, nw[i]) }
    }
    if ([...moved].some(i => nw[i] < 1)) return setToast({ text: 'Không lùi được nữa: tiết đầu đã ở tuần 1.', bad: true })
    const touched = new Map<string, Row>()
    for (const i of moved) touched.set(seq[i].r.unit_id, seq[i].r)
    setPrev(m => {
      const n = new Map(m)
      for (const r of touched.values()) {
        const weeks = seq.map((x, i) => ({ x, i })).filter(({ x }) => x.r.unit_id === r.unit_id).map(({ i }) => nw[i]).sort((x, y) => x - y)
        n.set(r.unit_id, { ...r, week: weeks[0], weeks, manual: true })
      }
      return n
    }); touch()
    const split = [...touched.values()].filter(r => !r.weeks!.every((_, k) => moved.has(seq.findIndex(x => x.r === r && x.k === k)))).length
    setToast({ text: `Đã dời ${moved.size} tiết (${touched.size} bài) môn ${sub} ${d > 0 ? 'về sau' : 'lên trước'} ${Math.abs(d)} tuần${split ? ` · tách ${split} bài nhiều tiết` : ''}.` })
  }
  const setRows = (uids: string[], patch: Partial<Row>) => {
    const ids = new Set(uids)
    setPrev(m => { const n = new Map(m); for (const r of s.rows) if (ids.has(r.unit_id)) n.set(r.unit_id, { ...r, ...patch }); return n }); touch()
  }
  function addItem(p: Prog, only?: string) {
    const subs = avail(p.id).map(x => ({ name: x.name, on: !only || x.name === only, mode: 'after' as SubjMode, week: null, ppw: Number(p.periods_per_week) || 1 }))
    setItems(xs => [...xs, { program_id: p.id, seq: xs.length + 1, start_mode: p.deploy_term === 'hk2' ? 'hk2' : 'hk1', start_week: null, after_program: null,
      ppw: Number(p.periods_per_week) || 1, split: false, subjects: subs }]); touch()
  }
  function removeItem(pid: string) {
    setItems(xs => xs.filter(i => i.program_id !== pid).map((i, k) => ({ ...i, seq: k + 1, after_program: i.after_program === pid ? null : i.after_program }))); touch()
  }
  function toggleSubj(p: Prog, name: string, on: boolean) {
    const it = items.find(i => i.program_id === p.id)
    if (!it) { if (on) addItem(p, name); return }
    const next = subjectsOf(it).map(x => x.name === name ? { ...x, on } : x)
    if (!next.some(x => x.on)) removeItem(p.id); else setItem(p.id, { subjects: next })
  }

  async function save(): Promise<boolean> {
    setBusy(true)
    const fail = (m: string) => { setBusy(false); setToast({ text: errText(m), bad: true }); return false }
    const u = await supabase.from('dist_plans').update({ title: plan.title.trim() || 'Bản phân phối mới', hk1_weeks: plan.hk1_weeks, hk2_weeks: plan.hk2_weeks, note: plan.note?.trim() || null }).eq('id', plan.id)
    if (u.error) return fail(u.error.message)
    const d1 = await supabase.from('dist_plan_rows').delete().eq('plan_id', plan.id)
    if (d1.error) return fail(d1.error.message)
    const keep = items.map(i => i.program_id)
    const d2 = keep.length ? await supabase.from('dist_plan_items').delete().eq('plan_id', plan.id).not('program_id', 'in', `(${keep.join(',')})`)
      : await supabase.from('dist_plan_items').delete().eq('plan_id', plan.id)
    if (d2.error) return fail(d2.error.message)
    if (items.length) {
      const i1 = await supabase.from('dist_plan_items').upsert(items.map(i => ({ ...i, plan_id: plan.id, subjects: subjectsOf(i),
        start_week: i.start_mode === 'week' ? i.start_week ?? 1 : null, after_program: i.start_mode === 'after' ? i.after_program : null })))
      if (i1.error) return fail(i1.error.message)
    }
    if (s.rows.length) {
      const r1 = await supabase.from('dist_plan_rows').insert(s.rows.map(r => ({ ...r, plan_id: plan.id, week: r.week && r.week <= 60 ? r.week : null,
        weeks: r.weeks ? r.weeks.map(w => Math.min(60, w)) : null })))
      if (r1.error) return fail(r1.error.message)
    }
    setBusy(false); setDirty(false)
    const at = new Date(); setSavedAt(at)
    setToast({ text: `Đã lưu nháp lúc ${at.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}.` })
    return true
  }
  async function publish() {
    if (errors.length) { return setToast({ text: 'Còn lỗi ở phần kiểm tra, chưa phát hành được.', bad: true }) }
    if (dirty && !(await save())) return
    const { error } = await supabase.from('dist_plans').update({ status: 'published' }).eq('id', plan.id)
    if (error) return setToast({ text: errText(error.message), bad: true })
    onChanged(plan.id, `Đã phát hành ${plan.code}. Bản này gán được cho trường.`)
  }
  async function setStatus(st: Status, note: string) {
    const { error } = await supabase.from('dist_plans').update({ status: st }).eq('id', plan.id)
    if (error) return setToast({ text: errText(error.message), bad: true })
    onChanged(plan.id, note)
  }
  async function copy() {
    const { data, error } = await supabase.rpc('dist_plan_copy', { p_plan: plan.id })
    if (error) return setToast({ text: errText(error.message), bad: true })
    onChanged(data as string, `Đã tạo bản nháp mới từ ${plan.code}.`)
  }
  async function newVersion() {
    const { data, error } = await supabase.rpc('dist_plan_new_version', { p_plan: plan.id })
    if (error) return setToast({ text: errText(error.message), bad: true })
    onChanged(data as string, `Đã tạo phiên bản ${(plan.version_no ?? 1) + 1} (nháp) của ${plan.code}. Phát hành xong thì phiên bản cũ chuyển sang "Đã thay thế".`)
  }
  async function remove() {
    if (!confirm(`Xoá bản phân phối ${plan.code}? PPCT đã gán cho trường vẫn giữ nguyên.`)) return
    const { error } = await supabase.from('dist_plans').delete().eq('id', plan.id)
    if (error) return setToast({ text: errText(error.message), bad: true })
    onChanged(undefined, `Đã xoá ${plan.code}.`)
  }
  const leave = () => { if (!dirty || confirm('Bản đang có thay đổi chưa lưu. Rời đi và bỏ thay đổi?')) back() }

  if (!loaded) return <div className="panel"><p className="sub" style={{ margin: 0 }}>Đang tải…</p></div>
  const validity = errors.length ? <Chip tone="bad">⊗ {errors.length} lỗi</Chip> : warns.length ? <Chip tone="warn">⚠ {warns.length} cảnh báo</Chip> : <Chip tone="good">✓ Hợp lệ</Chip>
  const savedText = dirty ? 'Chưa lưu thay đổi' : savedAt ? `Đã lưu lúc ${savedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : 'Đã lưu'
  const roNote = plan.status === 'draft' ? 'Bản nháp' : plan.status === 'published' ? 'Đã phát hành, không sửa trực tiếp' : plan.status === 'superseded' ? 'Đã có phiên bản mới thay thế' : 'Đã ngừng dùng'

  const head = (
    <div className="disthead2">
      <DetailHead back={backLabel} onBack={leave} />
      <div className="distttl">
        <div className="distttlrow">
          {editable ? <input className="disttitlein" value={plan.title} maxLength={200} aria-label="Tên bản phân phối" placeholder="Tên bản phân phối"
            title="Bấm để sửa tên" onChange={e => { setPlan({ ...plan, title: e.target.value }); touch() }} />
            : <h2 className="disttitle">{plan.title}</h2>}
          <Chip tone={STATUS[plan.status][1]}>{STATUS[plan.status][0]}</Chip>
          {editable && validity}
        </div>
        <small className="sub">{plan.code} · Phiên bản {plan.version_no ?? 1} · {editable
          ? <span className={dirty ? 'distunsaved' : undefined}>{savedText}</span>
          : plan.status === 'draft' ? <>{roNote}, bấm biểu tượng bút để sửa</>
          : <>{roNote}, muốn đổi thì {own ? 'tạo phiên bản mới' : 'nhân bản để sửa'}</>}</small>
        {!editable && plan.note && <small className="sub distnote">{plan.note}</small>}
      </div>
      <span className="distheadright">
        <ActionBar menuExtra={editable && <label className="distnotebox"><b>Ghi chú</b>
            <textarea rows={3} value={plan.note ?? ''} maxLength={2000} placeholder="Mục tiêu, đối tượng áp dụng…" onChange={e => { setPlan({ ...plan, note: e.target.value }); touch() }} /></label>}
          items={[
            plan.status === 'draft' && !editing && { key: 'edit', label: 'Chỉnh sửa', icon: 'pencil', onClick: () => setEditing(true) },
            editable && { key: 'done', label: dirty ? 'Hủy thay đổi' : 'Xong', rank: 1, disabled: busy, onClick: () => { if (dirty) { if (confirm('Bỏ các thay đổi chưa lưu?')) onChanged(plan.id) } else setEditing(false) } },
            editable && { key: 'save', label: busy ? 'Đang lưu…' : 'Lưu nháp', kind: dirty ? 'primary' : undefined, rank: 1, disabled: !dirty || busy, onClick: save },
            plan.status === 'draft' && { key: 'pub', label: 'Phát hành', kind: editing ? 'primary' : undefined, rank: 1, disabled: busy, title: errors.length ? 'Còn lỗi chặn phát hành' : undefined, onClick: publish },
            plan.status === 'published' && onAssign && { key: 'assign', label: 'Gán cho trường', onClick: () => onAssign(plan.id) },
            plan.status !== 'draft' && own && { key: 'ver', label: 'Tạo phiên bản mới', kind: 'primary', onClick: newVersion },
            plan.status !== 'draft' && !own && { key: 'copyedit', label: 'Nhân bản để sửa', kind: 'primary', onClick: copy },
            (plan.status === 'draft' || own) && { key: 'copy', label: 'Nhân bản', rank: 3, onClick: copy },
            plan.status === 'draft' && { key: 'del', label: 'Xoá bản phân phối', icon: 'trash', kind: 'danger', onClick: remove },
            plan.status === 'published' && { key: 'todraft', label: 'Chuyển về nháp', rank: 4, onClick: () => setStatus('draft', 'Đã chuyển về nháp. PPCT đã gán cho trường không đổi.') },
            plan.status === 'published' && { key: 'arch', label: 'Ngừng dùng', rank: 4, onClick: () => setStatus('archived', 'Đã ngừng dùng bản phân phối.') },
            plan.status === 'archived' && { key: 'reuse', label: 'Dùng lại', onClick: () => setStatus('draft', 'Đã dùng lại bản (nháp).') },
          ]} />
      </span>
    </div>
  )

  /** Dành cho: phân loại và các chương trình trong bản */
  const forStrip = <div className="distfor">
    <div className="distforrow"><span className="distforlab">Dành cho</span>
      <span className="distforpath">{crumbParts(plan).map((x, k) => <Fragment key={k}>{k > 0 && <span className="sep">›</span>}<b>{x}</b></Fragment>)}</span></div>
    {!editable && <div className="distforrow"><span className="distforlab">Chương trình ({ordered.length})</span>
      <span className="distforprogs">{ordered.length ? ordered.map((it, k) => {
        const p = progs.get(it.program_id); const subs = subjectsOf(it).filter(x => x.on).map(x => x.name)
        return <span key={it.program_id} className="distforprog"><i style={{ background: colorOf(k) }} /><b>{progCode(p)}</b><span>{p?.title}</span>
          {subs.length > 0 && <small>{subs.join(', ')}</small>}</span>
      }) : <span className="sub">Chưa chọn chương trình</span>}</span></div>}
  </div>

  /** Dải tóm tắt: hợp lệ / lỗi, số buổi, số tuần, tải cao nhất, tuần có ngày nghỉ */
  const summary = (withChecks: boolean) => {
    const tone = !withChecks ? '' : errors.length ? 'bad' : warns.length ? 'warn' : 'good'
    return <div className={'distsumbar ' + tone}>
      <div className="distsumrow">
        {withChecks && <b className="distsumst">{errors.length ? `⊗ ${errors.length} lỗi, chưa phát hành được` : warns.length ? `⚠ ${warns.length} cảnh báo, vẫn phát hành được` : '✓ Hợp lệ, có thể phát hành'}</b>}
        <span><b>{items.length}</b> chương trình · {onSubjects} môn</span>
        <span><b>{periods}</b>{std ? `/${std}` : ''} buổi</span>
        <span>{all ? <>Tuần <b>{all.from}–{all.to}</b> / {frame}</> : 'Chưa xếp tuần'}</span>
        <span className={maxLoad > LOAD_MAX ? 'over' : undefined}>Cao nhất <b>{maxLoad}</b> tiết/tuần</span>
        {holWeeks.length > 0 && <span className="hol">⚠ Tuần {holWeeks.slice(0, 8).join(', ')}{holWeeks.length > 8 ? '…' : ''} có ngày nghỉ</span>}
      </div>
      {withChecks && list.length > 0 && <ul>{list.map((c, k) => <li key={k} className={c.level}>{c.level === 'error' ? '⊗' : '⚠'} {c.text}</li>)}</ul>}
    </div>
  }

  if (!editable) return (
    <div className="panel distpanel">
      {head}
      {forStrip}
      <div className="distsumline">{summary(false)}<ViewSwitch view={view} setView={setView} /></div>
      {view === 'cal' ? Calendar() : Table()}
      <PlanHistory plan={plan} />
      {toast}
    </div>
  )

  return (
    <div className="panel distpanel">
      {head}
      {forStrip}
      {Programs()}
      {Schedule()}
      <section className="distsec2">
        <h3><i>3</i>Bản phối<span className="sp" /><ViewSwitch view={view} setView={setView} /></h3>
        {summary(true)}
        {view === 'cal' ? Calendar() : Table()}
      </section>
      {(plan.version_no ?? 1) > 1 && <PlanHistory plan={plan} />}
      {toast}
    </div>
  )

  // ===== 1. Chương trình & môn =====
  function Programs() {
    const usable = pool.filter(p => p.status === 'published' && progGrades(p).includes(plan.grade))
    const unusable = pool.filter(p => !usable.includes(p))
    const why = (p: Prog) => p.status !== 'published' ? 'chưa phát hành' : `dạy ${fmtGrades(progGrades(p), 'khối ')}`
    const opts: PickOpt[] = [
      ...usable.map(p => { const subs = avail(p.id); const n = subs.reduce((t, x) => t + x.lessons, 0)
        return { p, meta: subs.length ? `${subs.map(x => x.name).join(', ')} · ${n} bài` : `chưa có bài cho khối ${plan.grade}`, off: !subs.length } }),
      ...unusable.map(p => ({ p, meta: why(p), off: true })),
    ]
    return <section className="distsec2 first">
      <h3><i>1</i>Chương trình & môn <small className="sub">{items.length} chương trình · {onSubjects} môn</small><span className="sp" />
        <ProgPicker opts={opts} picked={new Set(order)} onAdd={addItem} hint={`Cấp ${levelName(plan.level)}, Khối ${plan.grade}`} /></h3>
      {!ordered.length ? <p className="sub" style={{ margin: 0 }}>Chưa chọn chương trình. Bấm “+ Thêm chương trình” để tìm và chọn.</p>
        : <div className="distpcs">{ordered.map((it, k) => {
          const p = progs.get(it.program_id); if (!p) return null
          const subs = avail(p.id), on = subjectsOf(it)
          return <div key={p.id} className="distpc on">
            <span className="distpch"><i style={{ background: colorOf(k) }} /><b>{p.code || progCode(p)}</b> <span>{p.title}</span></span>
            {subs.map(x => <label key={x.name} className="distpcsub" title="Bỏ tick để bỏ môn khỏi bản">
              <input type="checkbox" checked={!!on.find(o => o.name === x.name)?.on} onChange={e => toggleSubj(p, x.name, e.target.checked)} />
              {x.name} <small className="sub">{x.lessons} bài</small></label>)}
            <button type="button" className="distpcx" aria-label={`Bỏ chương trình ${p.code || p.title}`} title="Bỏ chương trình khỏi bản" onClick={() => removeItem(p.id)}>×</button>
          </div>
        })}</div>}
    </section>
  }

  // ===== 2. Xếp lịch =====
  function Schedule() {
    const wk = (v: number, min: number, f: (n: number) => void, label: string) =>
      <input type="number" className="distwkin" min={min} max={30} value={v} aria-label={label} onChange={e => { f(Math.max(min, Math.min(30, Number(e.target.value) || min))); touch() }} />
    return <section className="distsec2">
      <h3><i>2</i>Xếp lịch<span className="sp" />
        <small className="sub distframe2">Khung: HK1 {wk(plan.hk1_weeks, 1, n => setPlan({ ...plan, hk1_weeks: n }), 'Số tuần Học kỳ 1')} tuần · HK2 {wk(plan.hk2_weeks, 0, n => setPlan({ ...plan, hk2_weeks: n }), 'Số tuần Học kỳ 2')} tuần</small></h3>
      {!ordered.length ? <p className="sub">Tick chương trình ở phần 1 để xếp lịch.</p>
        : <div className="wrap"><table className="libtable distsched">
          <thead><tr><th>Chương trình · môn</th><th style={{ width: 230 }}>Bắt đầu</th><th style={{ width: 150 }}>Nhịp (tiết/tuần)</th><th>Kết quả</th><th style={{ width: 120 }} /></tr></thead>
          <tbody>{ordered.map((it, k) => {
            const p = progs.get(it.program_id)
            const sp = spanOf(s.rows.filter(r => r.program_id === it.program_id))
            const t = termRange(plan, p?.deploy_term ?? null)
            const outTerm = sp && t && (sp.from < t.from || sp.to > t.to), outFrame = sp && sp.to > frame
            const onSubs = subjectsOf(it).filter(x => x.on)
            const open = openOrd.has(it.program_id)
            const toggle = () => setOpenOrd(o => { const n = new Set(o); if (open) n.delete(it.program_id); else n.add(it.program_id); return n })
            return <Fragment key={it.program_id}>
              <tr>
                <td><i className="distdot" style={{ background: colorOf(k) }} /><b>{progCode(p)}</b> · {onSubs.map(x => x.name).join(', ')}
                  <small className="sub distschedsub">{p?.title}{p?.periods_per_week ? ` · chuẩn ${fmt(Number(p.periods_per_week))} tiết/tuần` : ''}</small></td>
                <td><span className="diststart">
                  <select value={it.start_mode} aria-label="Bắt đầu" onChange={e => setItem(it.program_id, { start_mode: e.target.value as Mode, start_week: e.target.value === 'week' ? it.start_week ?? sp?.from ?? 1 : it.start_week })}>
                    <option value="hk1">Đầu HK1 (tuần 1)</option>
                    {plan.hk2_weeks > 0 && <option value="hk2">Đầu HK2 (tuần {plan.hk1_weeks + 1})</option>}
                    <option value="week">Tuần cụ thể…</option>
                    {k > 0 && <option value="after">Sau chương trình…</option>}</select>
                  {it.start_mode === 'week' && <input type="number" className="distwkin" min={1} max={60} value={it.start_week ?? 1} aria-label="Tuần bắt đầu"
                    onChange={e => setItem(it.program_id, { start_week: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />}
                  {it.start_mode === 'after' && <select value={it.after_program ?? ''} aria-label="Sau chương trình" onChange={e => setItem(it.program_id, { after_program: e.target.value || null })}>
                    <option value="">— chọn —</option>{ordered.filter(x => x.seq < it.seq).map(x => <option key={x.program_id} value={x.program_id}>{progCode(progs.get(x.program_id))}</option>)}</select>}
                </span></td>
                <td>{it.split ? <small className="sub">Riêng từng môn</small> : <Stepper label="nhịp" value={it.ppw} onChange={v => setItem(it.program_id, { ppw: v })} />}</td>
                <td><span className={'gpill ' + (!sp ? '' : outFrame ? 'bad' : outTerm ? 'warn' : 'good')}>
                  {!sp ? 'Chưa có bài' : <>{outFrame || outTerm ? '⚠ ' : ''}Tuần {sp.from}–{sp.to} · {sp.periods} tiết{outFrame ? ` · ngoài khung` : outTerm ? ` · ngoài ${t!.label}` : ''}</>}</span></td>
                <td><button type="button" className="linkbtn" aria-expanded={open} onClick={toggle}>Chọn & sắp bài {open ? '▾' : '▸'}</button></td>
              </tr>
              {open && <tr className="distschedx"><td colSpan={5}>{Order(it)}</td></tr>}
            </Fragment>
          })}</tbody></table></div>}
    </section>
  }

  /** Thứ tự dạy và chỉnh riêng từng môn của một chương trình (mở từ "Thứ tự bài") */
  function Order(it: Item) {
    const info = s.progs.get(it.program_id)
    const subs = subjectsOf(it), onSubs = subs.filter(x => x.on)
    const subInfo = (n: string) => info?.subjects.find(x => x.name === n)
    const move = (a: number, b: number) => setSubjects(it, xs => {
      const onNames = xs.filter(x => x.on).map(x => x.name); const [m] = onNames.splice(a, 1); onNames.splice(b, 0, m)
      return [...onNames.map(n => xs.find(x => x.name === n)!), ...xs.filter(x => !x.on)]
    })
    return <>
      <label className="distsplit"><input type="checkbox" checked={it.split} onChange={e => {
        setItem(it.program_id, { split: e.target.checked, subjects: subs.map(x => ({ ...x, ppw: e.target.checked ? it.ppw : x.ppw })) })
      }} /><span><b>Chỉnh riêng từng môn</b> <small className="sub">mỗi môn bắt đầu và nhịp riêng</small></span></label>
      <small className="sub distsubjhint">Tick chọn bài sẽ dạy · kéo môn hoặc bài để đổi thứ tự dạy (chỉ trong bản này). Bàn phím: Alt + ↑↓</small>
      <SubjCards onMoveSubj={move} items={onSubs.map((x, j) => {
        const base = (lessonsBy.get(it.program_id) ?? []).filter(l => l.subj.trim().toLowerCase() === x.name.trim().toLowerCase())
        const list = orderLessons(base, x.order); const si = subInfo(x.name)
        const lessons = list.map(l => ({ id: l.id, title: l.title, periods: rowOf.get(l.id)?.periods ?? Math.max(1, l.periods || 1) }))
        const total = lessons.reduce((a, l) => a + l.periods, 0)
        const set = (patch: Partial<Subj>) => setSubjects(it, xs => xs.map(y => y.name === x.name ? { ...y, ...patch } : y))
        const setOrder = (ids: string[] | null) => set({ order: ids })
        const rate = it.split ? x.ppw : it.ppw
        const span = si?.to ? `Tuần ${si.from}–${si.to} · ${si.periods} tiết` : 'Chưa xếp'
        return {
          name: x.name, changed: reordered(base, x.order),
          meta: `${lessons.filter(l => !rowOf.get(l.id)?.skipped).length}/${lessons.length} bài · ${si?.periods ?? total} tiết${si?.to ? ` · Tuần ${si.from}–${si.to}` : ''} · ${fmt(rate)} tiết/tuần`,
          controls: it.split ? <>
            <select aria-label={'Bắt đầu môn ' + x.name} value={j === 0 && x.mode === 'after' ? 'program' : x.mode} onChange={e => set({ mode: e.target.value as SubjMode, week: e.target.value === 'week' ? x.week ?? si?.from ?? 1 : x.week })}>
              <option value="program">Theo chương trình</option>{j > 0 && <option value="after">Nối tiếp môn trước</option>}<option value="week">Tuần cụ thể…</option></select>
            {x.mode === 'week' && <input className="wk" type="number" aria-label={'Tuần bắt đầu môn ' + x.name} min={1} max={60} value={x.week ?? 1} onChange={e => set({ week: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />}
            <label className="inl">Nhịp <input type="number" min={0.5} max={40} step={0.5} value={x.ppw} onChange={e => set({ ppw: Math.max(0.5, Math.min(40, Number(e.target.value) || 1)) })} /></label>
            <span className="distsubjspan">{span}</span></> : null,
          lessons, weekOf: (id: string) => { const r = rowOf.get(id); return r?.skipped ? 'Không dạy' : r?.weeks?.length ? 'Tuần ' + wkLabel(r.weeks) : '—' },
          isOn: (id: string) => !rowOf.get(id)?.skipped, onToggle: (ids: string[], on: boolean) => setRows(ids, { skipped: !on }),
          onMove: (a: number, b: number) => { const ids = list.map(l => l.id); const [m] = ids.splice(a, 1); ids.splice(b, 0, m); setOrder(ids) },
          onReset: () => setOrder(null),
        }
      })} />
    </>
  }

  function Calendar() {
    return <>
      <p className="distlegend">{ordered.map((it, k) => <span key={it.program_id}><i style={{ background: colorOf(k) }} /><b>{progCode(progs.get(it.program_id))}</b></span>)}
        <span className="sub">Số trong ô là tiết của môn trong tuần (rê chuột vào ô để xem tên bài). Tuần ⚠ có ngày nghỉ theo lịch tham chiếu. Tổng màu cam là vượt {LOAD_MAX} tiết.</span></p>
      {grid(true)}
    </>
  }

  /** Bảng bài: giống bảng "Môn & bài học" của chương trình — cột trái lọc theo chương trình · môn, bảng phẳng bên phải.
   *  Bản nháp: tick để giữ / bỏ bài khỏi phân phối; "Tùy chỉnh từng bài" để sửa tuần, số tiết, ghi chú. */
  function Table() {
    const edit = editable && editRows
    type FR = { r: Row; pid: string; k: number; code: string; subj: string }
    const flat: FR[] = ordered.flatMap((it, k) => {
      const code = progCode(progs.get(it.program_id)); const info = s.progs.get(it.program_id)
      const mine = s.rows.filter(r => r.program_id === it.program_id)
      return (info?.subjects ?? []).flatMap(sub => mine.filter(r => s.subjOf.get(r.unit_id) === sub.name).map(r => ({ r, pid: it.program_id, k, code, subj: sub.name })))
    })
    const keyOf = (x: { pid: string; subj: string }) => x.pid + '|' + x.subj
    const groups = ordered.flatMap((it, k) => (s.progs.get(it.program_id)?.subjects ?? []).map(sub => ({ pid: it.program_id, k, code: progCode(progs.get(it.program_id)), subj: sub.name, info: sub })))
    const inSel = sel ? flat.filter(x => keyOf(x) === sel) : flat
    const qq = q.trim().toLowerCase()
    const shown = qq ? inSel.filter(x => (title.get(x.r.unit_id) ?? '').toLowerCase().includes(qq)) : inSel
    const keepN = (xs: FR[]) => xs.filter(x => !x.r.skipped).length
    const nav = (key: string, label: ReactNode, xs: FR[], meta: string) => <div key={key || '*'} className={'slnavrow' + (sel === key ? ' on' : '')}>
      <button type="button" className={'slnavi' + (sel === key ? ' on' : '')} onClick={() => setSel(key)}>
        <span className="slnm">{label}</span><span className="slcnt">{keepN(xs)}{keepN(xs) !== xs.length ? `/${xs.length}` : ''} bài · {meta}</span></button></div>
    const cols: Col<FR>[] = [
      { key: 'no', label: '#', thClass: 'c-no', fixed: true, cell: x => <span className="sub">{inSel.indexOf(x) + 1}</span> },
      ...(!sel ? [
        { key: 'prog', label: 'Chương trình', thClass: 'c-prog', text: (x: FR) => x.code, cell: (x: FR) => <span className="distprogcell"><i className="distdot" style={{ background: colorOf(x.k) }} />{x.code}</span> },
        { key: 'subj', label: 'Môn', thClass: 'c-subj', text: (x: FR) => x.subj, cell: (x: FR) => <button type="button" className="slsubjlink" onClick={() => setSel(keyOf(x))}>{x.subj}</button> },
      ] : []),
      { key: 'title', label: 'Tên bài học', thClass: 'c-title', fixed: true, text: x => title.get(x.r.unit_id) ?? '',
        cell: x => <>{title.get(x.r.unit_id)}{x.r.skipped && <small className="sub"> · không dạy (bỏ tick ở Xếp lịch › Chọn & sắp bài)</small>}</> },
      { key: 'week', label: 'Tuần', thClass: 'c-wk', text: x => wkLabel(x.r.weeks), cell: x => edit && !x.r.skipped ? <span className="distwkcell">
        <input type="number" className="slcell" min={1} max={60} value={x.r.week ?? ''} aria-label="Tuần" onChange={e => setRow(x.r.unit_id, { week: Number(e.target.value) || null, manual: true })} />
        {x.r.manual && <button type="button" className="linkbtn" title="Xếp lại theo nhịp" onClick={() => setRow(x.r.unit_id, { manual: false })}>Tự tính</button>}</span>
        : x.r.skipped ? <span className="sub">—</span> : <>{wkLabel(x.r.weeks)}{x.r.manual && <small className="sub"> · tay</small>}</> },
      { key: 'per', label: 'Số tiết', thClass: 'c-per', text: x => String(x.r.periods), cell: x => edit && !x.r.skipped
        ? <input type="number" className="slcell" min={1} max={50} value={x.r.periods} aria-label="Số tiết" onChange={e => setRow(x.r.unit_id, { periods: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} /> : x.r.periods },
      { key: 'note', label: 'Ghi chú', thClass: 'c-note', text: x => x.r.note ?? '', cell: x => edit
        ? <input className="slcell" value={x.r.note ?? ''} maxLength={500} aria-label="Ghi chú" onChange={e => setRow(x.r.unit_id, { note: e.target.value || null })} /> : x.r.note ?? '' },
    ]
    if (!ordered.length) return <p className="sub">Chưa có chương trình nào trong bản.</p>
    return <div className="slwrap distslwrap">
      <nav className="slnav" aria-label="Chương trình và môn">
        {nav('', 'Tất cả', flat, `${periods} tiết`)}
        {groups.map(g => nav(keyOf(g), <><i className="distdot" style={{ background: colorOf(g.k) }} />{g.code} · {g.subj}</>,
          flat.filter(x => keyOf(x) === keyOf(g)), g.info.to ? `Tuần ${g.info.from}–${g.info.to}` : 'chưa xếp'))}
      </nav>
      <div className="slmain">
        <DataTable id="dist-rows" simple rows={shown} rowKey={x => x.r.unit_id} className="slt disttbl" cols={cols}
          rowProps={x => ({ className: x.r.skipped ? 'skipped' : undefined })}
          left={<input placeholder="Tìm bài…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm bài" />}
          right={editable ? <button type="button" className={editRows ? 'primary' : ''} onClick={() => setEditRows(!editRows)}>{editRows ? 'Xong chỉnh sửa' : 'Tùy chỉnh từng bài'}</button> : undefined}
          empty={<small className="sub">{inSel.length ? 'Không có bài nào khớp ô tìm.' : 'Chưa có bài.'}</small>} />
      </div>
    </div>
  }
}

/** Chọn lịch tham chiếu cho lưới tuần: Chuẩn chung / lịch của đơn vị, năm học. */
function CalBar({ cal }: { cal: DistCal }) {
  if (cal.state === 'missing') return null
  return <div className="distcalbar">
    <label className="field"><span>Lịch áp dụng</span><select value={cal.src} onChange={e => cal.setSrc(e.target.value)}>
      {cal.srcs.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
    <label className="field"><span>Năm học tham chiếu</span><select value={cal.year} disabled={!cal.years.length} onChange={e => cal.setYear(e.target.value)}>
      {!cal.years.length && <option value="">Chưa có năm học</option>}
      {cal.years.map(y => <option key={y} value={y}>{y}</option>)}</select></label>
    <small className="sub hint">{cal.state === 'none' ? 'Chưa có lịch năm học này. Khai báo ở Thiết lập chung › Năm học & ngày nghỉ.'
      : cal.state === 'loading' ? 'Đang tải lịch…' : `Tuần đánh dấu ⚠ có ngày nghỉ. Bấm số tuần để xem ngày thật; bấm ô để xem bài trong tuần.`}</small>
  </div>
}

function ViewSwitch({ view, setView }: { view: 'table' | 'cal'; setView: (v: 'table' | 'cal') => void }) {
  return <div className="segmented distseg" role="group" aria-label="Kiểu xem">
    <button type="button" className={view === 'table' ? 'on' : ''} aria-pressed={view === 'table'} onClick={() => setView('table')}>Bảng</button>
    <button type="button" className={view === 'cal' ? 'on' : ''} aria-pressed={view === 'cal'} onClick={() => setView('cal')}>Lịch</button>
  </div>
}
