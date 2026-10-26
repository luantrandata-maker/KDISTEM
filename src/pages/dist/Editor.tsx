// Soạn / xem một bản phân phối theo video demo được duyệt (23/10):
//  1. Chọn chương trình — tick chương trình và từng môn, khung "Đang chọn" bên phải.
//  2. Xếp lịch — mỗi chương trình một thẻ: bắt đầu, nhịp, "Chỉnh riêng từng môn", thứ tự dạy kéo thả; xem trước trên trục tuần.
//  3. Xem bản phối — số liệu, kiểm tra, Bảng (nhóm chương trình › môn › bài, tuỳ chỉnh từng bài) hoặc Lịch.
// Bản đã phát hành / ngừng dùng chỉ xem; muốn đổi thì "Tạo bản mới từ bản này".
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtGrades, progGrades, useEduLevels } from '../../lib/eduLevels'
import { useCls } from './cls'
import { useTiers } from './Tiers'
import { WeekGrid, colorOf } from './Grid'
import { useDistCalendar, type DistCal } from './calendar'
import {
  checks, effSubjects, lessonsOf, orderLessons, reordered, progCode, schedule, spanOf, subjectsIn, termRange, weekLoad, TERM_LABEL, LOAD_MAX,
  type Item, type Mode, type Plan, type Prog, type Row, type Status, type Subj, type SubjMode, type U,
} from './sched'

const PSEL = 'id, code, title, version_no, status, ct_code, level, grade_from, grade_to, grades, main_subject, periods_per_week, deploy_term'
const USEL = 'id, program_id, parent_id, unit_type, seq, title, periods, grade, grades, subject'
export const STATUS: Record<Status, [string, string]> = { draft: ['Nháp', 'warn'], published: ['Đã phát hành', 'good'], archived: ['Ngừng dùng', 'off'] }
export const Chip = ({ tone, children }: { tone?: string; children: ReactNode }) => <span className={'distchip2 ' + (tone ?? '')}>{children}</span>
export const errText = (m: string) => (/schema cache|does not exist|column .* of relation/i.test(m) ? 'Hãy chạy migration 078, 079 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Bạn không có quyền với bản phân phối này.' : m)
const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')
const wkLabel = (ws: number[] | null) => { if (!ws?.length) return '—'; const a = Math.min(...ws), b = Math.max(...ws); return a === b ? String(a) : `${a}–${b}` }

export function useBreadcrumb() {
  const { name: levelName } = useEduLevels()
  const { name: tierName } = useTiers()
  const { path } = useCls()
  return (p: Plan) => {
    const ns = path(p.node_id)
    return ns.length ? ns.map(n => n.name).join(' › ') : `${levelName(p.level)} › Khối ${p.grade} › ${p.tier ? tierName(p.tier) : 'Chưa phân loại'}`
  }
}

/** Nút "…" mở danh sách thao tác phụ. */
export function MoreMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  return <details ref={ref} className="distmore" onClick={e => { if ((e.target as HTMLElement).closest('button')) ref.current?.removeAttribute('open') }}>
    <summary aria-label="Thao tác khác">···</summary><div className="distmenu">{children}</div></details>
}

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
function LessonOrder({ lessons, changed, weekOf, onMove, onReset }: SubjCardData) {
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
    <div className="distlessonsbar"><small className="sub">Danh sách bài học</small>
      {changed && <button type="button" className="linkbtn" onClick={onReset}>Về thứ tự khung</button>}</div>
    {lessons.length ? <ol>{lessons.map((l, k) => <li key={l.id} tabIndex={0} draggable aria-label={`${l.title}, bài ${k + 1}`}
      className={(drag === k ? 'drag' : '') + (over === k && drag !== k ? ' over' : '')} onKeyDown={key(k)}
      onDragStart={e => { e.stopPropagation(); setDrag(k); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => { setDrag(null); setOver(null) }}
      onDragOver={e => { if (drag === null) return; e.preventDefault(); e.stopPropagation(); setOver(k) }}
      onDrop={e => { if (drag === null) return; e.preventDefault(); e.stopPropagation(); if (drag !== k) onMove(drag, k); setDrag(null); setOver(null) }}>
      <i aria-hidden="true">⠿</i><span className="t">{l.title}</span>
      <small className="sub">{l.periods} tiết</small><span className="distwk">{weekOf(l.id)}</span></li>)}</ol>
      : <p className="sub" style={{ margin: '0 4px 4px' }}>Môn này chưa có bài.</p>}
  </div>
}

type Toast = { text: string; bad?: boolean } | null
function useToast() {
  const [t, setT] = useState<Toast>(null)
  useEffect(() => { if (!t) return; const h = setTimeout(() => setT(null), t.bad ? 6000 : 3000); return () => clearTimeout(h) }, [t])
  return [t ? <div className={'disttoast' + (t.bad ? ' bad' : '')} role="status">{t.text}</div> : null, setT] as const
}

export function PlanBody({ plan: p0, back, backLabel, onChanged, onAssign }: {
  plan: Plan; back: () => void; backLabel: string
  onChanged: (openId?: string, msg?: string) => void; onAssign?: (id: string) => void
}) {
  const crumb = useBreadcrumb()
  const { name: levelName } = useEduLevels()
  const [plan, setPlan] = useState<Plan>(p0)
  const [items, setItems] = useState<Item[]>([])
  const [prev, setPrev] = useState<Map<string, Row>>(new Map())
  const [progs, setProgs] = useState<Map<string, Prog>>(new Map())
  const [pool, setPool] = useState<Prog[]>([])
  const [units, setUnits] = useState<U[]>([])
  const [loaded, setLoaded] = useState(false)
  const editable = plan.status === 'draft'
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [view, setView] = useState<'table' | 'cal'>(editable ? 'table' : 'cal')
  const [editRows, setEditRows] = useState(false)
  const [closed, setClosed] = useState<Set<string>>(new Set())    // nhóm chương trình thu gọn ở Bảng
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
      if (its.length && p0.status === 'draft') setStep(rw.data?.length ? 3 : 2)
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
  const holNote = holWeeks.length ? `Có tiết rơi vào tuần có ngày nghỉ: tuần ${holWeeks.slice(0, 10).join(', ')}${holWeeks.length > 10 ? '…' : ''} (${cal.label}, năm học ${cal.year}). Bấm số tuần ⚠ ở lịch để xem ngày nghỉ.` : ''
  const grid = (titles?: boolean) => <>
    <CalBar cal={cal} />
    <WeekGrid plan={plan} order={order} progs={progs} s={s} titles={titles} cal={cal.state === 'ok' ? cal.weeks : undefined} calLabel={cal.label} year={cal.year} titleOf={id => title.get(id) ?? ''} />
  </>

  const touch = () => { setDirty(true) }
  const setItem = (pid: string, patch: Partial<Item>) => { setItems(xs => xs.map(i => i.program_id === pid ? { ...i, ...patch } : i)); touch() }
  const setSubjects = (it: Item, f: (xs: Subj[]) => Subj[]) => setItem(it.program_id, { subjects: f(subjectsOf(it)) })
  const setRow = (uid: string, patch: Partial<Row>) => {
    const cur = s.rows.find(r => r.unit_id === uid); if (!cur) return
    setPrev(m => new Map(m).set(uid, { ...cur, ...patch })); touch()
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
    if (errors.length) { setStep(3); return setToast({ text: 'Còn lỗi ở phần kiểm tra, chưa phát hành được.', bad: true }) }
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
  async function remove() {
    if (!confirm(`Xoá bản phân phối ${plan.code}? PPCT đã gán cho trường vẫn giữ nguyên.`)) return
    const { error } = await supabase.from('dist_plans').delete().eq('id', plan.id)
    if (error) return setToast({ text: errText(error.message), bad: true })
    onChanged(undefined, `Đã xoá ${plan.code}.`)
  }
  const leave = () => { if (!dirty || confirm('Bản đang có thay đổi chưa lưu. Rời đi và bỏ thay đổi?')) back() }

  if (!loaded) return <div className="panel"><p className="sub" style={{ margin: 0 }}>Đang tải…</p></div>
  const validity = errors.length ? <Chip tone="bad">⊗ {errors.length} lỗi</Chip> : warns.length ? <Chip tone="warn">⚠ {warns.length} cảnh báo</Chip> : <Chip tone="good">✓ Hợp lệ</Chip>
  const savedChip = !editable ? null : dirty ? <Chip tone="warn">Chưa lưu thay đổi</Chip>
    : <Chip tone="good">{savedAt ? `Đã lưu lúc ${savedAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}` : 'Đã lưu'}</Chip>

  const head = (
    <div className="disthead">
      <button type="button" className="distback" onClick={leave}>← {backLabel}</button>
      <span className="distcrumb">{crumb(plan)} · {plan.code}</span>
      <span className="distheadright">
        <Chip tone={STATUS[plan.status][1]}>{STATUS[plan.status][0]}</Chip>
        {savedChip}
        {editable ? validity : <Chip>Chỉ xem</Chip>}
        {editable && <button type="button" disabled={!dirty || busy} onClick={() => onChanged(plan.id)}>Hủy thay đổi</button>}
        {editable && <button type="button" className={dirty ? 'primary' : ''} disabled={!dirty || busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu nháp'}</button>}
        {editable && <button type="button" className="primary" disabled={busy} title={errors.length ? 'Còn lỗi chặn phát hành' : undefined} onClick={publish}>Phát hành</button>}
        {!editable && <button type="button" className="primary" onClick={copy}>Tạo bản mới từ bản này</button>}
        <MoreMenu>
          {editable && <button type="button" onClick={copy}>Nhân bản</button>}
          {plan.status === 'published' && onAssign && <button type="button" onClick={() => onAssign(plan.id)}>Gán cho trường</button>}
          {plan.status === 'published' && <button type="button" onClick={() => setStatus('draft', 'Đã chuyển về nháp. PPCT đã gán cho trường không đổi.')}>Chuyển về nháp</button>}
          {plan.status === 'published' && <button type="button" onClick={() => setStatus('archived', 'Đã ngừng dùng bản phân phối.')}>Ngừng dùng</button>}
          {plan.status === 'archived' && <button type="button" onClick={() => setStatus('draft', 'Đã dùng lại bản (nháp).')}>Dùng lại</button>}
          {editable && <div className="distframe"><b>Khung học kỳ</b>
            <label>Học kỳ 1 <input type="number" min={1} max={30} value={plan.hk1_weeks} onChange={e => { setPlan({ ...plan, hk1_weeks: Math.max(1, Math.min(30, Number(e.target.value) || 1)) }); touch() }} /> tuần</label>
            <label>Học kỳ 2 <input type="number" min={0} max={30} value={plan.hk2_weeks} onChange={e => { setPlan({ ...plan, hk2_weeks: Math.max(0, Math.min(30, Number(e.target.value) || 0)) }); touch() }} /> tuần</label></div>}
          {editable && <button type="button" className="danger" onClick={remove}>Xoá bản</button>}
        </MoreMenu>
      </span>
    </div>
  )

  const stats = <span className="diststatline">
    <span><b>{items.length}</b> chương trình · {onSubjects} môn</span><span><b>{periods}</b> buổi</span>
    <span><b>{all ? all.to - all.from + 1 : 0}</b> tuần</span><span><b>{maxLoad}</b> tiết/tuần cao nhất</span></span>

  if (!editable) return (
    <div className="panel distpanel">
      {head}
      <h2 className="disttitle">{plan.title}</h2>
      {plan.note && <p className="sub">{plan.note}</p>}
      <div className="distinfo"><b>{plan.status === 'published' ? 'Bản đã phát hành, không sửa trực tiếp.' : 'Bản đã ngừng dùng.'}</b>{' '}
        Muốn thay đổi, bấm “Tạo bản mới từ bản này” để chỉnh trên một bản nháp. PPCT đã gán cho trường không đổi theo.</div>
      <div className="distviewbar"><ViewSwitch view={view} setView={setView} />{stats}</div>
      {view === 'cal' ? Calendar() : Table()}
      {toast}
    </div>
  )

  return (
    <div className="panel distpanel">
      {head}
      <input className="disttitlein" value={plan.title} maxLength={200} aria-label="Tên bản phân phối" onChange={e => { setPlan({ ...plan, title: e.target.value }); touch() }} onFocus={e => e.target.select()} />
      <input className="distnotein" value={plan.note ?? ''} maxLength={2000} placeholder="Ghi chú: mục tiêu, đối tượng áp dụng…" aria-label="Ghi chú" onChange={e => { setPlan({ ...plan, note: e.target.value }); touch() }} />
      <ol className="diststeps">
        {([[1, 'Chọn chương trình', `${items.length} chương trình · ${onSubjects} môn`],
          [2, 'Xếp lịch', all ? `Tuần ${all.from}–${all.to}` : 'Chưa xếp'],
          [3, 'Xem bản phối', `${periods} buổi · ${errors.length ? errors.length + ' lỗi' : warns.length + ' lưu ý'}`]] as [1 | 2 | 3, string, string][]).map(([k, t, sub]) =>
          <li key={k}><button type="button" className={step === k ? 'on' : ''} aria-current={step === k ? 'step' : undefined} onClick={() => setStep(k)}>
            <i>{k}</i><span><b>{t}</b><small>{sub}</small></span></button></li>)}
      </ol>
      {step === 1 && Step1()}
      {step === 2 && Step2()}
      {step === 3 && Step3()}
      {toast}
    </div>
  )

  // ===== Bước 1 =====
  function Step1() {
    const usable = pool.filter(p => p.status === 'published' && progGrades(p).includes(plan.grade))
    const unusable = pool.filter(p => !usable.includes(p))
    const why = (p: Prog) => p.status !== 'published' ? 'chưa phát hành' : `dạy ${fmtGrades(progGrades(p), 'khối ')}`
    return <div className="distpick">
      <div>
        <p className="distpickhead"><b>Chương trình dùng được cho Khối {plan.grade}</b> <span className="sub">{usable.length} chương trình · lọc theo cấp {levelName(plan.level)} và Khối {plan.grade}</span></p>
        {usable.length === 0 && <p className="sub">Chưa có chương trình đã phát hành nào của cấp này dạy khối {plan.grade}.</p>}
        {usable.map(p => {
          const it = items.find(i => i.program_id === p.id)
          const subs = avail(p.id), on = it ? subjectsOf(it) : []
          const total = subs.reduce((n, x) => n + x.periods, 0)
          return <div key={p.id} className={'distprogcard' + (it ? ' on' : '')}>
            <label className="distproghead"><input type="checkbox" checked={!!it} onChange={() => it ? removeItem(p.id) : addItem(p)} />
              <span><span className="ttl">{p.ct_code && <Chip tone="ct">{p.ct_code}</Chip>}<b>{p.code ? p.code + ' · ' : ''}{p.title}</b></span>
                <small className="sub">{[TERM_LABEL[p.deploy_term ?? 'year'], p.periods_per_week && `${fmt(Number(p.periods_per_week))} tiết/tuần`, `${subs.length} môn`, `${total} buổi`].filter(Boolean).join(' · ')}</small></span></label>
            {subs.length > 0 && <div className="distsubjs">{subs.map(x => <label key={x.name}>
              <input type="checkbox" checked={!!on.find(o => o.name === x.name)?.on} onChange={e => toggleSubj(p, x.name, e.target.checked)} />
              {x.name} <small className="sub">{x.lessons} bài · {x.periods} buổi</small></label>)}</div>}
            {subs.length === 0 && <small className="sub">Chương trình chưa có bài cho khối {plan.grade}.</small>}
          </div>
        })}
        {unusable.length > 0 && <details className="distunusable"><summary>Chưa dùng được ({unusable.length})</summary>
          {unusable.map(p => <div key={p.id} className="distprogcard off"><span>{p.code ? p.code + ' · ' : ''}{p.title} <small className="sub">v{p.version_no} · {why(p)}</small></span></div>)}</details>}
      </div>
      <aside className="panel distsum">
        <b>Đang chọn</b>
        {items.length === 0 ? <p className="sub">Tick chương trình bên trái để thêm vào bản.</p>
          : <ol>{ordered.map((i, k) => <li key={i.program_id}><i style={{ background: colorOf(k) }} />{progCode(progs.get(i.program_id))}
            <small className="sub"> · {subjectsOf(i).filter(x => x.on).map(x => x.name).join(', ')}</small></li>)}</ol>}
        <div className="distsumnums">
          <span><b>{items.length}</b><small>chương trình</small></span><span><b>{onSubjects}</b><small>môn</small></span>
          <span><b>{live.length}</b><small>bài</small></span><span><b>{periods}</b><small>buổi</small></span>
        </div>
        <button type="button" className="primary" disabled={!items.length} onClick={() => setStep(2)}>Tiếp tục: Xếp lịch →</button>
      </aside>
    </div>
  }

  // ===== Bước 2 =====
  function Step2() {
    if (!ordered.length) return <p className="sub">Chọn chương trình ở bước 1 trước.</p>
    return <>
      <div className="distcards">{ordered.map((it, k) => {
        const p = progs.get(it.program_id); const info = s.progs.get(it.program_id)
        const sp = spanOf(s.rows.filter(r => r.program_id === it.program_id))
        const t = termRange(plan, p?.deploy_term ?? null)
        const outTerm = sp && t && (sp.from < t.from || sp.to > t.to), outFrame = sp && sp.to > frame
        const subs = subjectsOf(it), onSubs = subs.filter(x => x.on)
        const subInfo = (n: string) => info?.subjects.find(x => x.name === n)
        const move = (a: number, b: number) => setSubjects(it, xs => {
          const onNames = xs.filter(x => x.on).map(x => x.name); const [m] = onNames.splice(a, 1); onNames.splice(b, 0, m)
          return [...onNames.map(n => xs.find(x => x.name === n)!), ...xs.filter(x => !x.on)]
        })
        return <div key={it.program_id} className="distcard" style={{ borderTopColor: colorOf(k) }}>
          <div className="distcardhead"><i style={{ background: colorOf(k) }} />{p?.ct_code && <Chip tone="ct">{p.ct_code}</Chip>}<b>{p?.code ? p.code + ' · ' : ''}{p?.title ?? '—'}</b></div>
          <small className="sub">Thời lượng chương trình: {TERM_LABEL[p?.deploy_term ?? 'year']}{p?.periods_per_week ? ` · chuẩn ${fmt(Number(p.periods_per_week))} tiết/tuần` : ''}</small>
          <div className="distcardrow">
            <label className="field"><span>Bắt đầu</span><select value={it.start_mode} onChange={e => setItem(it.program_id, { start_mode: e.target.value as Mode, start_week: e.target.value === 'week' ? it.start_week ?? sp?.from ?? 1 : it.start_week })}>
              <option value="hk1">Đầu Học kỳ 1 (tuần 1)</option>
              {plan.hk2_weeks > 0 && <option value="hk2">Đầu Học kỳ 2 (tuần {plan.hk1_weeks + 1})</option>}
              <option value="week">Tuần cụ thể…</option>
              {k > 0 && <option value="after">Ngay sau chương trình khác…</option>}</select></label>
            {it.start_mode === 'week' && <label className="field narrow"><span>Tuần</span><input type="number" min={1} max={60} value={it.start_week ?? 1}
              onChange={e => setItem(it.program_id, { start_week: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} /></label>}
            {it.start_mode === 'after' && <label className="field"><span>Sau chương trình</span><select value={it.after_program ?? ''} onChange={e => setItem(it.program_id, { after_program: e.target.value || null })}>
              <option value="">— chọn —</option>{ordered.filter(x => x.seq < it.seq).map(x => <option key={x.program_id} value={x.program_id}>{progCode(progs.get(x.program_id))}</option>)}</select></label>}
            <label className="field"><span>Nhịp (tiết/tuần)</span><Stepper label="nhịp" value={it.ppw} onChange={v => setItem(it.program_id, { ppw: v })} /></label>
          </div>
          <div className={'distresult ' + (!sp ? '' : outFrame ? 'bad' : outTerm ? 'warn' : 'good')}>
            {!sp ? 'Chưa có bài nào được chọn.' : <>{outFrame || outTerm ? '⚠' : '✓'} <b>Tuần {sp.from}–{sp.to}</b> · {sp.periods} tiết
              {outFrame ? ` · ngoài khung ${frame} tuần` : outTerm ? ` · ngoài ${t!.label}` : ''}</>}
          </div>
          <label className="distsplit"><input type="checkbox" checked={it.split} onChange={e => {
            setItem(it.program_id, { split: e.target.checked, subjects: subs.map(x => ({ ...x, ppw: e.target.checked ? it.ppw : x.ppw })) })
          }} />
            <span><b>Chỉnh riêng từng môn</b><small className="sub">{it.split ? 'Mỗi môn có thể bắt đầu và có nhịp riêng.' : 'Đang xếp nối tiếp các môn theo nhịp của chương trình.'}</small></span></label>
          <small className="sub distsubjhint">Thứ tự dạy · kéo cả môn hoặc từng bài để đổi thứ tự (chỉ áp dụng cho bản phân phối này). Bàn phím: Alt + ↑↓</small>
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
              meta: `${lessons.length} bài · ${si?.periods ?? total} tiết${si?.to ? ` · Tuần ${si.from}–${si.to}` : ''} · ${fmt(rate)} tiết/tuần`,
              controls: it.split ? <>
                <select aria-label={'Bắt đầu môn ' + x.name} value={j === 0 && x.mode === 'after' ? 'program' : x.mode} onChange={e => set({ mode: e.target.value as SubjMode, week: e.target.value === 'week' ? x.week ?? si?.from ?? 1 : x.week })}>
                  <option value="program">Theo chương trình</option>{j > 0 && <option value="after">Nối tiếp môn trước</option>}<option value="week">Tuần cụ thể…</option></select>
                {x.mode === 'week' && <input className="wk" type="number" aria-label={'Tuần bắt đầu môn ' + x.name} min={1} max={60} value={x.week ?? 1} onChange={e => set({ week: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />}
                <label className="inl">Nhịp <input type="number" min={0.5} max={40} step={0.5} value={x.ppw} onChange={e => set({ ppw: Math.max(0.5, Math.min(40, Number(e.target.value) || 1)) })} /></label>
                <span className="distsubjspan">{span}</span></> : null,
              lessons, weekOf: (id: string) => { const r = rowOf.get(id); return r?.skipped ? 'Đã bỏ' : r?.weeks?.length ? 'Tuần ' + wkLabel(r.weeks) : '—' },
              onMove: (a: number, b: number) => { const ids = list.map(l => l.id); const [m] = ids.splice(a, 1); ids.splice(b, 0, m); setOrder(ids) },
              onReset: () => setOrder(null),
            }
          })} />
        </div>
      })}</div>
      <h4 className="distsec">Chi tiết theo tuần</h4>
      {grid()}
      <div className="formactions" style={{ textAlign: 'right' }}><button type="button" className="primary" onClick={() => setStep(3)}>Tiếp tục: Xem bản phối →</button></div>
    </>
  }

  // ===== Bước 3 =====
  function Step3() {
    return <>
      <div className="diststats">
        <div><b>{items.length}</b><small>chương trình · {onSubjects} môn</small></div>
        <div><b>{periods}/{std}</b><small>buổi / chuẩn</small></div>
        <div><b>{all ? all.to - all.from + 1 : 0}/{frame}</b><small>tuần</small></div>
        <div className={maxLoad > LOAD_MAX ? 'over' : ''}><b>{maxLoad}</b><small>tiết/tuần cao nhất</small></div>
      </div>
      <div className={'distchecks ' + (errors.length ? 'bad' : warns.length ? 'warn' : 'good')}>
        <b>{errors.length ? 'Lỗi (chưa phát hành được)' : warns.length ? 'Cảnh báo (có thể phát hành)' : 'Hợp lệ — có thể phát hành'}</b>
        {list.length > 0 && <ul>{list.map((c, k) => <li key={k} className={c.level}>{c.level === 'error' ? '⊗' : '⚠'} {c.text}</li>)}</ul>}
        {holNote && <ul><li className="warn">⚠ {holNote}</li></ul>}
      </div>
      <div className="distviewbar"><ViewSwitch view={view} setView={setView} />
        {view === 'table' && <button type="button" className={editRows ? 'primary' : ''} onClick={() => setEditRows(!editRows)}>{editRows ? 'Xong chỉnh sửa' : 'Tùy chỉnh từng bài'}</button>}</div>
      {view === 'cal' ? Calendar() : Table()}
    </>
  }

  function Calendar() {
    return <>
      <p className="distlegend">{ordered.map((it, k) => <span key={it.program_id}><i style={{ background: colorOf(k) }} /><b>{progCode(progs.get(it.program_id))}</b></span>)}
        <span className="sub">Số trong ô là tiết của môn trong tuần (bấm ô để xem bài). Tuần ⚠ có ngày nghỉ theo lịch tham chiếu. Tổng màu cam là vượt {LOAD_MAX} tiết.</span></p>
      {grid(true)}
    </>
  }

  function Table() {
    const edit = editable && editRows
    return <div className="wrap"><table className="libtable disttable">
      <thead><tr><th style={{ width: 44 }}>#</th><th>Bài học</th><th style={{ width: 120 }}>Tuần</th><th style={{ width: 90 }}>Số tiết</th><th>Ghi chú</th>{edit && <th style={{ width: 70 }} />}</tr></thead>
      <tbody>{ordered.map((it, k) => {
        const p = progs.get(it.program_id); const info = s.progs.get(it.program_id)
        const mine = s.rows.filter(r => r.program_id === it.program_id); const sp = spanOf(mine)
        const shut = closed.has(it.program_id)
        return <Fragment key={it.program_id}>
          <tr className="distgprog"><th colSpan={edit ? 6 : 5}>
            <button type="button" className="linkbtn" aria-expanded={!shut} onClick={() => setClosed(c => { const n = new Set(c); if (shut) n.delete(it.program_id); else n.add(it.program_id); return n })}>{shut ? '▸' : '▾'}</button>
            <i style={{ background: colorOf(k) }} /><b>{progCode(p)}</b> {p?.title}
            <small className="sub">{sp ? `Tuần ${sp.from}–${sp.to} · ${sp.periods} tiết · ${fmt(it.ppw)} tiết/tuần` : 'Chưa có bài'}</small></th></tr>
          {!shut && info?.subjects.map(sub => {
            const rows = mine.filter(r => s.subjOf.get(r.unit_id) === sub.name)
            return <Fragment key={sub.name}>
              <tr className="distgsubj"><th colSpan={edit ? 6 : 5}><b>{sub.name}</b> <small className="sub">{sub.to ? `Tuần ${sub.from}–${sub.to}` : '—'}</small>
                <span className={'gpill ' + (sub.periods === sub.std ? 'good' : 'warn')}>{sub.periods}/{sub.std} buổi</span></th></tr>
              {rows.map((r, j) => <tr key={r.unit_id} className={r.skipped ? 'skipped' : undefined}>
                <td>{j + 1}</td>
                <td>{title.get(r.unit_id)}{r.skipped && <small className="sub"> · đã bỏ</small>}</td>
                <td>{edit && !r.skipped ? <><input type="number" min={1} max={60} value={r.week ?? ''} style={{ width: 64 }} aria-label="Tuần"
                  onChange={e => setRow(r.unit_id, { week: Number(e.target.value) || null, manual: true })} />
                  {r.manual && <button type="button" className="linkbtn" title="Xếp lại theo nhịp" onClick={() => setRow(r.unit_id, { manual: false })}>Tự tính</button>}</>
                  : <>{wkLabel(r.weeks)}{r.manual && <small className="sub"> · tay</small>}</>}</td>
                <td>{edit && !r.skipped ? <input type="number" min={1} max={50} value={r.periods} style={{ width: 60 }} aria-label="Số tiết"
                  onChange={e => setRow(r.unit_id, { periods: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} /> : r.periods}</td>
                <td>{edit ? <input value={r.note ?? ''} maxLength={500} aria-label="Ghi chú" onChange={e => setRow(r.unit_id, { note: e.target.value || null })} /> : r.note ?? ''}</td>
                {edit && <td><button type="button" onClick={() => setRow(r.unit_id, { skipped: !r.skipped })}>{r.skipped ? 'Dùng lại' : 'Bỏ'}</button></td>}
              </tr>)}
            </Fragment>
          })}
        </Fragment>
      })}
        {!ordered.length && <tr><td colSpan={5}>Chưa có chương trình nào trong bản.</td></tr>}</tbody>
    </table></div>
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
