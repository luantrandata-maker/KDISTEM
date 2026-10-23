// Phân phối chương trình — Bản phân phối (078): ghép nhiều chương trình đã phát hành lên trục tuần theo nhánh
// Cấp học › Khối › Mức độ, phát hành rồi gán cho trường (mỗi chương trình thành một PPCT nháp của trường).
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useEduLevels, gradeRange } from '../../lib/eduLevels'
import { SelBar, SelTd, SelTh, useRowSel } from '../../components/TableSel'
import { ViewToggle, useViewMode } from '../../components/ViewToggle'
import { Tabs } from '../teacher/common'
import { useTiers } from './Tiers'

type Status = 'draft' | 'published' | 'archived'
export type Plan = { id: string; org_id: string; code: string; title: string; level: string; grade: number; tier: string | null; status: Status
  hk1_weeks: number; hk2_weeks: number; note: string | null; updated_at: string; published_at: string | null }
type Mode = 'hk1' | 'hk2' | 'week' | 'after'
type Item = { program_id: string; seq: number; start_mode: Mode; start_week: number | null; after_program: string | null; ppw: number }
type Row = { program_id: string; unit_id: string; seq: number; week: number | null; periods: number; note: string | null; manual: boolean; skipped: boolean }
type Prog = { id: string; title: string; version_no: number; status: string; ct_code: string | null; level: string; grade_from: number; grade_to: number
  main_subject: string; periods_per_week: number | null; deploy_term: string | null }
type U = { id: string; program_id: string; parent_id: string | null; unit_type: 'topic' | 'lesson' | 'session'; seq: number; title: string; periods: number; grade: number | null }

const STATUS: Record<Status, [string, string]> = { draft: ['Nháp', ''], published: ['Đã phát hành', 'good'], archived: ['Ngừng dùng', 'off'] }
export const PlanStatus = ({ s }: { s: Status }) => <span className={'gpill ' + STATUS[s][1]}><i aria-hidden="true">{s === 'published' ? '✓' : s === 'draft' ? '·' : '–'}</i>{STATUS[s][0]}</span>
const MODES: [Mode, string][] = [['hk1', 'Đầu HK I'], ['hk2', 'Đầu HK II'], ['week', 'Tuần cụ thể'], ['after', 'Ngay sau chương trình khác']]
const PSEL = 'id, title, version_no, status, ct_code, level, grade_from, grade_to, main_subject, periods_per_week, deploy_term'
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 078 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Bạn không có quyền với bản phân phối này.' : m.replace(/^Chưa phát hành được: /, 'Chưa phát hành được: '))

// Mở một bản ở tab "Bản phân phối" / chọn sẵn bản ở tab "Gán theo trường" (khi bấm từ tab khác)
let pendingOpen: string | null = null
let pendingAssign: string | null = null

// Các bài của chương trình cho một khối, theo thứ tự cây: bài học; chủ đề không có bài thì tính chủ đề là một bài
function lessonsOf(units: U[], pid: string, grade: number): U[] {
  const mine = units.filter(u => u.program_id === pid)
  const kids = (id: string | null) => mine.filter(u => u.parent_id === id).sort((a, b) => a.seq - b.seq)
  const out: U[] = []
  const walk = (id: string | null, g: number | null) => kids(id).forEach(u => {
    const ug = u.grade ?? g
    if (ug != null && ug !== grade) return
    if (u.unit_type === 'lesson') out.push(u)
    else if (u.unit_type === 'topic') { if (mine.some(x => x.parent_id === u.id)) walk(u.id, ug); else out.push(u) }
  })
  walk(null, null)
  return out
}

// Máy xếp lịch theo nhịp: bài thứ i bắt đầu ở tuần = tuần bắt đầu + (số tiết trước nó ÷ nhịp). Tuần đặt tay giữ nguyên.
function schedule(plan: Plan, items: Item[], prev: Map<string, Row>, units: U[]) {
  const end = new Map<string, number>()
  const rows: Row[] = []
  let seq = 0
  for (const it of [...items].sort((a, b) => a.seq - b.seq)) {
    const start = it.start_mode === 'hk2' ? plan.hk1_weeks + 1 : it.start_mode === 'week' ? Math.max(1, it.start_week ?? 1)
      : it.start_mode === 'after' && it.after_program && end.has(it.after_program) ? end.get(it.after_program)! + 1 : 1
    let c = 0, last = start
    for (const u of lessonsOf(units, it.program_id, plan.grade)) {
      const p = prev.get(u.id)
      const periods = p ? p.periods : Math.max(1, u.periods || 1)
      const auto = start + Math.floor(c / it.ppw)
      const week = p?.manual && p.week ? p.week : auto
      rows.push({ program_id: it.program_id, unit_id: u.id, seq: ++seq, week, periods, note: p?.note ?? null, manual: !!(p?.manual && p.week), skipped: !!p?.skipped })
      if (!p?.skipped && periods > 0) { c += periods; last = Math.max(last, week + Math.ceil(periods / it.ppw) - 1) }
    }
    end.set(it.program_id, last)
  }
  return rows
}

// Số tiết từng tuần (bài nhiều tiết trải theo nhịp, như khi gán cho trường)
function weekLoad(rows: Row[], items: Item[]) {
  const ppw = new Map(items.map(i => [i.program_id, i.ppw]))
  const m = new Map<number, number>()
  for (const r of rows) if (!r.skipped && r.week) for (let k = 0; k < r.periods; k++) {
    const w = r.week + Math.floor(k / (ppw.get(r.program_id) ?? 1)); m.set(w, (m.get(w) ?? 0) + 1)
  }
  return m
}

type Check = { level: 'error' | 'warn'; text: string }
function checks(plan: Plan, items: Item[], rows: Row[], progs: Map<string, Prog>, units: U[]): Check[] {
  const out: Check[] = []
  const frame = plan.hk1_weeks + plan.hk2_weeks
  if (!items.length) out.push({ level: 'error', text: 'Chưa chọn chương trình.' })
  for (const it of items) {
    const p = progs.get(it.program_id)
    if (!p) { out.push({ level: 'error', text: 'Có chương trình không còn đọc được.' }); continue }
    if (p.status !== 'published') out.push({ level: 'error', text: `"${p.title}" chưa phát hành.` })
    if (plan.grade < p.grade_from || plan.grade > p.grade_to) out.push({ level: 'error', text: `"${p.title}" không dạy khối ${plan.grade}.` })
    const mine = rows.filter(r => r.program_id === it.program_id && !r.skipped && r.periods > 0)
    if (!mine.length) out.push({ level: 'error', text: `"${p.title}" không có bài nào cho khối ${plan.grade}.` })
    const endW = Math.max(0, ...mine.map(r => (r.week ?? 0) + Math.ceil(r.periods / it.ppw) - 1))
    if (endW > frame) out.push({ level: 'error', text: `"${p.title}" kéo đến tuần ${endW}, ngoài khung ${frame} tuần.` })
    else if (p.deploy_term === 'hk1' && endW > plan.hk1_weeks) out.push({ level: 'warn', text: `"${p.title}" triển khai HK I nhưng kéo sang HK II (tuần ${endW}).` })
    if (it.start_mode === 'after' && !it.after_program) out.push({ level: 'warn', text: `"${p.title}" chọn "ngay sau chương trình khác" nhưng chưa chọn chương trình.` })
    if (it.start_mode === 'hk2' && plan.hk2_weeks === 0) out.push({ level: 'error', text: `"${p.title}" bắt đầu HK II nhưng khung không có HK II.` })
  }
  const subj = new Map<string, string[]>()
  for (const it of items) { const p = progs.get(it.program_id); if (p) subj.set(p.main_subject.toLowerCase(), [...(subj.get(p.main_subject.toLowerCase()) ?? []), p.title]) }
  for (const [, t] of subj) if (t.length > 1) out.push({ level: 'warn', text: `Trùng môn: ${t.join(', ')} — mỗi chương trình thành một PPCT riêng khi gán.` })
  const noWeek = rows.filter(r => !r.skipped && r.periods > 0 && !r.week).length
  if (noWeek) out.push({ level: 'error', text: `${noWeek} bài chưa có tuần.` })
  const load = weekLoad(rows, items)
  const target = items.reduce((s, i) => s + i.ppw, 0)
  const over = [...load.entries()].filter(([, n]) => n > Math.max(target, 1)).map(([w]) => w).sort((a, b) => a - b)
  if (over.length) out.push({ level: 'warn', text: `Quá tải tiết/tuần (hơn ${target} tiết) ở tuần ${over.slice(0, 8).join(', ')}${over.length > 8 ? '…' : ''}.` })
  const manual = rows.filter(r => r.manual).length
  if (manual) out.push({ level: 'warn', text: `${manual} bài đặt tuần bằng tay — bấm "Tự tính" để xếp lại theo nhịp.` })
  void units
  return out
}

function usePlans(reloadKey: number) {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('dist_plans').select('id, org_id, code, title, level, grade, tier, status, hk1_weeks, hk2_weeks, note, updated_at, published_at').order('code')
      .then(({ data, error }) => { if (error) setErr(errText(error.message)); setPlans((data as Plan[]) ?? []) })
  }, [reloadKey])
  return { plans, err }
}

// ===== Tab "Bản phân phối": khung phân loại + soạn bản 3 bước =====
export function DistPlanEditor({ orgId, goTab }: { orgId: string | null; goTab?: (label: string) => void }) {
  const [rk, setRk] = useState(0)
  const { plans, err } = usePlans(rk)
  const { levels, name: levelName } = useEduLevels()
  const { tiers, name: tierName } = useTiers()
  const [open, setOpen] = useState<string | null>(() => { const x = pendingOpen; pendingOpen = null; return x })
  const [msg, setMsg] = useState<[string, boolean] | null>(null)

  async function create(level: string, grade: number, tier: string | null) {
    if (!orgId) return
    const title = `Bản phân phối ${levelName(level)} · khối ${grade}${tier ? ' · ' + tierName(tier) : ''}`
    const { data, error } = await supabase.from('dist_plans').insert({ org_id: orgId, title, level, grade, tier }).select('id').single()
    if (error) return setMsg([errText(error.message), true])
    setOpen((data as { id: string }).id); setRk(k => k + 1); setMsg(null)
  }
  if (err) return <p className="msg">{err}</p>
  if (!plans) return <p className="sub">Đang tải…</p>
  const plan = plans.find(p => p.id === open) ?? null
  const inBranch = (l: string, g: number, t: string | null) => plans.filter(p => p.level === l && p.grade === g && (p.tier ?? null) === t)
  return (
    <>
      <ol className="flowsteps" aria-label="Quy trình phân phối" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {([['Soạn bản phân phối', `${plans.length} bản`, null], ['Phát hành bản', `${plans.filter(p => p.status === 'published').length} bản có thể gán`, null],
          ['Gán theo trường', 'tạo PPCT cho trường', () => goTab?.('Gán theo trường')]] as [string, string, (() => void) | null][]).map(([t, n, go], k) => (
          <li key={t} className={k === 0 && plans.length ? 'done' : k === 1 && plans.some(p => p.status === 'published') ? 'done' : ''}>
            <button type="button" disabled={!go} onClick={go ?? undefined}><i aria-hidden="true">{k + 1}</i><span><b>{t}</b><small>{n}</small></span></button></li>))}
      </ol>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      <div className="distlayout">
        <nav className="panel disttree" aria-label="Khung phân loại">
          <b>Khung phân loại</b>
          <small className="sub">Cấp học › Khối › Mức độ</small>
          {levels.map(l => {
            const n = plans.filter(p => p.level === l.code).length
            return <details key={l.code} open={plan?.level === l.code || n > 0}>
              <summary>{l.name} <span className="count">{n}</span></summary>
              {gradeRange(l.grade_from, l.grade_to).map(g => {
                const ng = plans.filter(p => p.level === l.code && p.grade === g).length
                return <details key={g} open={plan?.level === l.code && plan.grade === g}>
                  <summary>Khối {g} <span className="count">{ng}</span></summary>
                  {[...tiers.map(t => t.code as string | null), ...(inBranch(l.code, g, null).length ? [null] : [])].map(t => (
                    <div key={t ?? '-'} className="distbranch">
                      <div className="distbranchhead"><span>{tierName(t)}</span>
                        <button type="button" className="linkbtn" onClick={() => create(l.code, g, t)} title="Tạo bản phân phối ở nhánh này">+ Tạo bản</button></div>
                      {inBranch(l.code, g, t).map(p => (
                        <button key={p.id} type="button" className={'distplanbtn' + (p.id === open ? ' on' : '')} onClick={() => { setOpen(p.id); setMsg(null) }}>
                          <small>{p.code}</small> {p.title} <PlanStatus s={p.status} /></button>))}
                    </div>))}
                </details>
              })}
            </details>
          })}
        </nav>
        <div>
          {plan ? <PlanBody key={plan.id + ':' + rk} plan={plan} onChanged={(id, m) => { if (id) setOpen(id); setRk(k => k + 1); if (m) setMsg([m, false]) }} />
            : <div className="panel"><p className="sub" style={{ margin: 0 }}>Chọn một bản ở khung phân loại bên trái, hoặc bấm “+ Tạo bản” ở nhánh Cấp học › Khối › Mức độ cần soạn.</p></div>}
        </div>
      </div>
    </>
  )
}

function PlanBody({ plan: p0, onChanged }: { plan: Plan; onChanged: (openId?: string, msg?: string) => void }) {
  const { name: levelName } = useEduLevels()
  const { name: tierName } = useTiers()
  const [plan, setPlan] = useState<Plan>(p0)
  const [items, setItems] = useState<Item[]>([])
  const [prev, setPrev] = useState<Map<string, Row>>(new Map())
  const [progs, setProgs] = useState<Map<string, Prog>>(new Map())
  const [pool, setPool] = useState<Prog[]>([])
  const [units, setUnits] = useState<U[]>([])
  const [step, setStep] = useState<'1' | '2' | '3'>('1')
  const [view, setView] = useViewMode('ban-phoi', 'list')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [loaded, setLoaded] = useState(false)
  const editable = plan.status === 'draft'

  useEffect(() => {
    (async () => {
      const [it, rw, pl] = await Promise.all([
        supabase.from('dist_plan_items').select('program_id, seq, start_mode, start_week, after_program, ppw').eq('plan_id', p0.id).order('seq'),
        supabase.from('dist_plan_rows').select('program_id, unit_id, seq, week, periods, note, manual, skipped').eq('plan_id', p0.id),
        supabase.from('edu_programs').select(PSEL).eq('level', p0.level).in('status', ['published', 'draft', 'pending', 'approved', 'rejected']).order('title'),
      ])
      const its = ((it.data as Item[]) ?? []).map(i => ({ ...i, ppw: Number(i.ppw) }))
      const ps = (pl.data as Prog[]) ?? []
      const missing = its.map(i => i.program_id).filter(id => !ps.some(p => p.id === id))
      const extra = missing.length ? ((await supabase.from('edu_programs').select(PSEL).in('id', missing)).data as Prog[]) ?? [] : []
      setItems(its); setPool(ps)
      setProgs(new Map([...ps, ...extra].map(p => [p.id, p])))
      setPrev(new Map(((rw.data as Row[]) ?? []).map(r => [r.unit_id, r])))
      setLoaded(true)
    })()
  }, [p0.id])
  const pids = items.map(i => i.program_id).sort().join(',')
  useEffect(() => {
    if (!pids) { setUnits([]); return }
    supabase.from('edu_program_units').select('id, program_id, parent_id, unit_type, seq, title, periods, grade').in('program_id', pids.split(','))
      .then(({ data }) => setUnits((data as U[]) ?? []))
  }, [pids])

  const rows = useMemo(() => schedule(plan, items, prev, units), [plan, items, prev, units])
  const list = useMemo(() => checks(plan, items, rows, progs, units), [plan, items, rows, progs, units])
  const errors = list.filter(c => c.level === 'error')
  const unitTitle = useMemo(() => new Map(units.map(u => [u.id, u.title])), [units])
  const span = (pid: string) => {
    const it = items.find(i => i.program_id === pid)!
    const mine = rows.filter(r => r.program_id === pid && !r.skipped && r.periods > 0 && r.week)
    if (!mine.length) return null
    return { from: Math.min(...mine.map(r => r.week!)), to: Math.max(...mine.map(r => r.week! + Math.ceil(r.periods / it.ppw) - 1)), periods: mine.reduce((s, r) => s + r.periods, 0), lessons: mine.length }
  }
  const touch = () => { setDirty(true); setMsg(null) }
  const setItem = (pid: string, patch: Partial<Item>) => { setItems(xs => xs.map(i => i.program_id === pid ? { ...i, ...patch } : i)); touch() }
  const setRow = (uid: string, patch: Partial<Row>) => {
    const cur = rows.find(r => r.unit_id === uid); if (!cur) return
    setPrev(m => new Map(m).set(uid, { ...cur, ...patch })); touch()
  }
  function toggleProg(p: Prog) {
    if (items.some(i => i.program_id === p.id)) setItems(xs => xs.filter(i => i.program_id !== p.id).map((i, k) => ({ ...i, seq: k + 1, after_program: i.after_program === p.id ? null : i.after_program })))
    else setItems(xs => [...xs, { program_id: p.id, seq: xs.length + 1, start_mode: p.deploy_term === 'hk2' ? 'hk2' : 'hk1', start_week: null, after_program: null, ppw: Number(p.periods_per_week) || 1 }])
    touch()
  }
  function move(pid: string, d: -1 | 1) {
    const xs = [...items].sort((a, b) => a.seq - b.seq); const k = xs.findIndex(i => i.program_id === pid); const j = k + d
    if (j < 0 || j >= xs.length) return
    ;[xs[k], xs[j]] = [xs[j], xs[k]]
    setItems(xs.map((i, n) => ({ ...i, seq: n + 1 }))); touch()
  }

  async function save(): Promise<boolean> {
    setBusy(true); setMsg(null)
    const fail = (m: string) => { setBusy(false); setMsg([errText(m), true]); return false }
    const u = await supabase.from('dist_plans').update({ title: plan.title, hk1_weeks: plan.hk1_weeks, hk2_weeks: plan.hk2_weeks, note: plan.note }).eq('id', plan.id)
    if (u.error) return fail(u.error.message)
    const d1 = await supabase.from('dist_plan_rows').delete().eq('plan_id', plan.id)
    if (d1.error) return fail(d1.error.message)
    const keep = items.map(i => i.program_id)
    const d2 = keep.length ? await supabase.from('dist_plan_items').delete().eq('plan_id', plan.id).not('program_id', 'in', `(${keep.join(',')})`)
      : await supabase.from('dist_plan_items').delete().eq('plan_id', plan.id)
    if (d2.error) return fail(d2.error.message)
    if (items.length) {
      const i1 = await supabase.from('dist_plan_items').upsert(items.map(i => ({ ...i, plan_id: plan.id, start_week: i.start_mode === 'week' ? i.start_week ?? 1 : null, after_program: i.start_mode === 'after' ? i.after_program : null })))
      if (i1.error) return fail(i1.error.message)
    }
    if (rows.length) {
      const r1 = await supabase.from('dist_plan_rows').insert(rows.map(r => ({ ...r, plan_id: plan.id, week: r.week && r.week <= 60 ? r.week : null })))
      if (r1.error) return fail(r1.error.message)
    }
    setBusy(false); setDirty(false)
    return true
  }
  async function publish() {
    if (errors.length) return setMsg(['Còn lỗi ở bảng kiểm tra, chưa phát hành được.', true])
    if (dirty && !(await save())) return
    const { error } = await supabase.from('dist_plans').update({ status: 'published' }).eq('id', plan.id)
    if (error) return setMsg([errText(error.message), true])
    onChanged(plan.id, `Đã phát hành ${plan.code}. Bản này đã gán được cho trường.`)
  }
  async function setStatus(s: Status, note: string) {
    const { error } = await supabase.from('dist_plans').update({ status: s }).eq('id', plan.id)
    if (error) return setMsg([errText(error.message), true])
    onChanged(plan.id, note)
  }
  async function copy() {
    const { data, error } = await supabase.rpc('dist_plan_copy', { p_plan: plan.id })
    if (error) return setMsg([errText(error.message), true])
    onChanged(data as string, `Đã nhân bản ${plan.code} thành bản nháp mới.`)
  }
  async function remove() {
    if (!confirm(`Xoá bản phân phối ${plan.code}? PPCT đã gán cho trường vẫn giữ nguyên.`)) return
    const { error } = await supabase.from('dist_plans').delete().eq('id', plan.id)
    if (error) return setMsg([errText(error.message), true])
    onChanged(undefined, `Đã xoá ${plan.code}.`)
  }

  if (!loaded) return <p className="sub">Đang tải…</p>
  const ordered = [...items].sort((a, b) => a.seq - b.seq)
  const frame = plan.hk1_weeks + plan.hk2_weeks
  const load = weekLoad(rows, items)
  const maxLoad = Math.max(0, ...load.values())
  const lastWeek = Math.max(0, ...rows.filter(r => !r.skipped && r.week).map(r => r.week!))
  const live = rows.filter(r => !r.skipped && r.periods > 0)
  const subjects = new Set(ordered.map(i => progs.get(i.program_id)?.main_subject.toLowerCase()).filter(Boolean))
  const usable = pool.filter(p => p.status === 'published' && plan.grade >= p.grade_from && plan.grade <= p.grade_to)
  const unusable = pool.filter(p => !usable.includes(p))
  const why = (p: Prog) => p.status !== 'published' ? 'chưa phát hành' : `dạy khối ${p.grade_from}${p.grade_to !== p.grade_from ? '–' + p.grade_to : ''}`

  return (
    <div className="panel">
      <div className="bar">
        <div>
          <h3 style={{ margin: 0 }}>{plan.code} · {plan.title} <PlanStatus s={plan.status} /></h3>
          <small className="sub">{levelName(plan.level)} › Khối {plan.grade} › {tierName(plan.tier)}</small>
        </div>
        <div className="tools">
          {editable && <button type="button" disabled={!dirty || busy} onClick={() => onChanged(plan.id)}>Huỷ thay đổi</button>}
          {editable && <button type="button" disabled={busy} onClick={async () => { if (await save()) setMsg(['Đã lưu nháp.', false]) }}>Lưu nháp</button>}
          {editable && <button type="button" className="primary" disabled={busy || errors.length > 0} title={errors.length ? 'Còn lỗi chặn phát hành' : undefined} onClick={publish}>Phát hành</button>}
          {plan.status === 'published' && <button type="button" onClick={() => setStatus('draft', 'Đã chuyển về nháp. PPCT đã gán cho trường không bị ảnh hưởng.')}>Chuyển về nháp</button>}
          {plan.status === 'published' && <button type="button" onClick={() => setStatus('archived', 'Đã ngừng dùng bản phân phối.')}>Ngừng dùng</button>}
          {plan.status === 'archived' && <button type="button" onClick={() => setStatus('draft', 'Đã dùng lại bản (nháp).')}>Dùng lại</button>}
          <button type="button" onClick={copy}>Nhân bản</button>
          {editable && <button type="button" className="danger" onClick={remove}>Xoá</button>}
        </div>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {!editable && <p className="sub">Bản đã {plan.status === 'published' ? 'phát hành' : 'ngừng dùng'}: chỉ xem. Muốn sửa thì chuyển về nháp hoặc nhân bản.</p>}
      <div className="formgrid" style={{ marginBottom: 10 }}>
        <label className="field" style={{ gridColumn: 'span 2' }}><span>Tên bản phân phối</span><input disabled={!editable} value={plan.title} onChange={e => { setPlan({ ...plan, title: e.target.value }); touch() }} /></label>
        <label className="field"><span>Số tuần HK I</span><input type="number" min={1} max={30} disabled={!editable} value={plan.hk1_weeks} onChange={e => { setPlan({ ...plan, hk1_weeks: Math.max(1, Math.min(30, Number(e.target.value) || 1)) }); touch() }} /></label>
        <label className="field"><span>Số tuần HK II</span><input type="number" min={0} max={30} disabled={!editable} value={plan.hk2_weeks} onChange={e => { setPlan({ ...plan, hk2_weeks: Math.max(0, Math.min(30, Number(e.target.value) || 0)) }); touch() }} /></label>
      </div>
      <Tabs value={step} onChange={setStep} items={[['1', '1 · Chọn chương trình', items.length], ['2', '2 · Xếp lịch'], ['3', '3 · Xem bản phối', errors.length || undefined]]} />

      {step === '1' && <div className="distpick">
        <div>
          <h4>Chương trình dùng được <small className="sub">đã phát hành, dạy khối {plan.grade}</small></h4>
          {usable.length === 0 && <p className="sub">Chưa có chương trình đã phát hành nào của cấp {levelName(plan.level)} dạy khối {plan.grade}.</p>}
          {usable.map(p => <label key={p.id} className="distprog">
            <input type="checkbox" disabled={!editable} checked={items.some(i => i.program_id === p.id)} onChange={() => toggleProg(p)} />
            <span><b>{p.title}</b> <small className="sub">v{p.version_no} · {[p.ct_code, p.main_subject, p.periods_per_week && `${p.periods_per_week} tiết/tuần`].filter(Boolean).join(' · ')}</small></span></label>)}
          {unusable.length > 0 && <details style={{ marginTop: 10 }}><summary className="sub">Chưa dùng được ({unusable.length})</summary>
            {unusable.map(p => <div key={p.id} className="distprog off"><span>{p.title} <small className="sub">v{p.version_no} · {why(p)}</small></span></div>)}</details>}
        </div>
        <aside className="panel distsum">
          <h4>Đang chọn</h4>
          <p>{items.length} chương trình · {subjects.size} môn · {live.length} bài · {live.reduce((s, r) => s + r.periods, 0)} tiết</p>
          {subjects.size < items.length && <p className="msg" style={{ margin: 0 }}>Có chương trình trùng môn.</p>}
          <ol>{ordered.map(i => <li key={i.program_id}>{progs.get(i.program_id)?.title ?? '—'}</li>)}</ol>
        </aside>
      </div>}

      {step === '2' && <>
        {ordered.length === 0 && <p className="sub">Chọn chương trình ở bước 1 trước.</p>}
        {ordered.map((it, k) => {
          const p = progs.get(it.program_id); const s = span(it.program_id)
          const out = s && s.to > frame
          return <div key={it.program_id} className="panel distsched">
            <div className="bar">
              <b>{k + 1}. {p?.title ?? '—'} <small className="sub">{p?.main_subject}</small></b>
              <div className="tools">
                <small className={out ? 'msg' : 'sub'}>{s ? `Tuần ${s.from}–${s.to} · ${s.periods} tiết · ${s.lessons} bài` : 'Chưa có bài cho khối này'}{out ? ` · ngoài khung ${frame} tuần` : ''}</small>
                <button type="button" disabled={!editable || k === 0} onClick={() => move(it.program_id, -1)} aria-label="Dạy trước">↑</button>
                <button type="button" disabled={!editable || k === ordered.length - 1} onClick={() => move(it.program_id, 1)} aria-label="Dạy sau">↓</button>
              </div>
            </div>
            <div className="formgrid">
              <label className="field"><span>Bắt đầu</span><select disabled={!editable} value={it.start_mode} onChange={e => setItem(it.program_id, { start_mode: e.target.value as Mode })}>
                {MODES.map(([m, l]) => <option key={m} value={m} disabled={m === 'after' && ordered.length < 2}>{l}</option>)}</select></label>
              {it.start_mode === 'week' && <label className="field"><span>Tuần</span><input type="number" min={1} max={60} disabled={!editable} value={it.start_week ?? 1} onChange={e => setItem(it.program_id, { start_week: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} /></label>}
              {it.start_mode === 'after' && <label className="field"><span>Sau chương trình</span><select disabled={!editable} value={it.after_program ?? ''} onChange={e => setItem(it.program_id, { after_program: e.target.value || null })}>
                <option value="">— chọn —</option>{ordered.filter(x => x.seq < it.seq).map(x => <option key={x.program_id} value={x.program_id}>{progs.get(x.program_id)?.title}</option>)}</select></label>}
              <label className="field"><span>Nhịp (tiết/tuần)</span><input type="number" min={0.5} max={40} step={0.5} disabled={!editable} value={it.ppw} onChange={e => setItem(it.program_id, { ppw: Math.max(0.5, Math.min(40, Number(e.target.value) || 1)) })} /></label>
            </div>
          </div>
        })}
        {ordered.length > 0 && <Timeline items={ordered} progs={progs} span={span} frame={frame} hk1={plan.hk1_weeks} />}
        <p className="sub">"Ngay sau chương trình khác" chỉ chọn được chương trình xếp trước. Tuần của từng bài sửa tay ở bước 3.</p>
      </>}

      {step === '3' && <>
        <div className="diststats">
          <div><small>Chương trình / môn</small><b>{items.length} / {subjects.size}</b></div>
          <div><small>Bài / tiết</small><b>{live.length} / {live.reduce((s, r) => s + r.periods, 0)}</b></div>
          <div><small>Tuần</small><b>{lastWeek ? `1–${lastWeek}` : '—'}</b><small>khung {frame} tuần</small></div>
          <div><small>Tiết/tuần cao nhất</small><b>{maxLoad || '—'}</b></div>
        </div>
        <div className={'panel distchecks' + (errors.length ? ' bad' : '')}>
          <b>Kiểm tra</b>
          {list.length === 0 ? <p className="sub" style={{ margin: 0 }}>Không có lỗi hay cảnh báo.</p>
            : <ul>{list.map((c, k) => <li key={k} className={c.level}>{c.level === 'error' ? 'Lỗi: ' : 'Cảnh báo: '}{c.text}</li>)}</ul>}
          <small className="sub">Lỗi chặn phát hành; cảnh báo vẫn cho phát hành.</small>
        </div>
        <div className="bar"><span /><div className="tools"><ViewToggle value={view} onChange={setView} /></div></div>
        {view === 'list' ? <div className="wrap"><table className="libtable">
          <thead><tr><th>Bài</th><th>Tuần</th><th>Số tiết</th><th>Ghi chú</th><th>Bỏ bài</th></tr></thead>
          <tbody>{ordered.map(it => <Fragment key={it.program_id}>
            <tr className="grouprow"><th colSpan={5}>{progs.get(it.program_id)?.title}</th></tr>
            {rows.filter(r => r.program_id === it.program_id).map(r => <tr key={r.unit_id} style={r.skipped ? { opacity: 0.55 } : undefined}>
              <td>{unitTitle.get(r.unit_id)}</td>
              <td><input type="number" min={1} max={60} disabled={!editable || r.skipped} value={r.week ?? ''} style={{ width: 70 }} aria-label="Tuần"
                onChange={e => setRow(r.unit_id, { week: Number(e.target.value) || null, manual: true })} />
                {r.manual && <> <span className="pill">tay</span> {editable && <button type="button" className="linkbtn" onClick={() => setRow(r.unit_id, { manual: false })}>Tự tính</button>}</>}</td>
              <td><input type="number" min={0} max={50} disabled={!editable} value={r.periods} style={{ width: 64 }} aria-label="Số tiết" onChange={e => setRow(r.unit_id, { periods: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })} /></td>
              <td><input disabled={!editable} value={r.note ?? ''} maxLength={500} aria-label="Ghi chú" onChange={e => setRow(r.unit_id, { note: e.target.value || null })} /></td>
              <td style={{ textAlign: 'center' }}><input type="checkbox" disabled={!editable} checked={r.skipped} aria-label="Bỏ bài" onChange={e => setRow(r.unit_id, { skipped: e.target.checked })} /></td>
            </tr>)}
          </Fragment>)}
            {rows.length === 0 && <tr><td colSpan={5}>Chưa có bài nào.</td></tr>}</tbody>
        </table></div> : <WeekCalendar rows={rows} items={ordered} progs={progs} titles={unitTitle} frame={frame} hk1={plan.hk1_weeks} />}
      </>}
    </div>
  )
}

function Timeline({ items, progs, span, frame, hk1 }: { items: Item[]; progs: Map<string, Prog>; span: (pid: string) => { from: number; to: number } | null; frame: number; hk1: number }) {
  const W = Math.max(frame, ...items.map(i => span(i.program_id)?.to ?? 0))
  const pct = (w: number) => `${((w - 1) / W) * 100}%`
  return <div className="panel disttimeline" aria-label="Xem trước trên trục tuần">
    <div className="distaxis"><span style={{ left: 0 }}>Tuần 1</span><span style={{ left: pct(hk1 + 1) }}>HK II · tuần {hk1 + 1}</span><span style={{ right: 0 }}>{W}</span></div>
    {items.map(it => { const s = span(it.program_id); return <div key={it.program_id} className="distlane">
      <small>{progs.get(it.program_id)?.title}</small>
      <div className="distrack"><i className="hk" style={{ left: pct(hk1 + 1) }} />
        {s && <b className={s.to > frame ? 'over' : ''} style={{ left: pct(s.from), width: `${((s.to - s.from + 1) / W) * 100}%` }} title={`Tuần ${s.from}–${s.to}`} />}</div>
    </div> })}
  </div>
}

function WeekCalendar({ rows, items, progs, titles, frame, hk1 }: { rows: Row[]; items: Item[]; progs: Map<string, Prog>; titles: Map<string, string>; frame: number; hk1: number }) {
  const live = rows.filter(r => !r.skipped && r.week && r.periods > 0)
  const W = Math.max(frame, ...live.map(r => r.week!))
  const color = new Map(items.map((i, k) => [i.program_id, k % 6]))
  return <div className="distcal">
    {Array.from({ length: W }, (_, k) => k + 1).map(w => {
      const here = live.filter(r => r.week === w)
      return <div key={w} className={'distweek' + (w > frame ? ' over' : '') + (w === hk1 + 1 ? ' hk2' : '')}>
        <small>Tuần {w}</small>
        {here.map(r => <span key={r.unit_id} className={'distchip c' + color.get(r.program_id)} title={progs.get(r.program_id)?.title}>{titles.get(r.unit_id)} · {r.periods}t</span>)}
      </div>
    })}
  </div>
}

// ===== Tab "Danh sách bản phân phối" =====
export function DistPlanList({ goTab }: { goTab?: (label: string) => void }) {
  const [rk, setRk] = useState(0)
  const { plans, err } = usePlans(rk)
  const { name: levelName } = useEduLevels()
  const { name: tierName } = useTiers()
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [books, setBooks] = useState<Map<string, number>>(new Map())
  const [q, setQ] = useState(''); const [fs, setFs] = useState('')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  useEffect(() => {
    supabase.from('dist_plan_items').select('plan_id').then(({ data }) => {
      const m = new Map<string, number>(); for (const r of (data ?? []) as { plan_id: string }[]) m.set(r.plan_id, (m.get(r.plan_id) ?? 0) + 1); setCounts(m)
    })
    supabase.from('curriculum_books').select('dist_plan_id, org_id').not('dist_plan_id', 'is', null).then(({ data }) => {
      const m = new Map<string, Set<string>>(); for (const r of (data ?? []) as { dist_plan_id: string; org_id: string }[]) m.set(r.dist_plan_id, (m.get(r.dist_plan_id) ?? new Set()).add(r.org_id))
      setBooks(new Map([...m.entries()].map(([k, v]) => [k, v.size])))
    })
  }, [rk])
  const shown = (plans ?? []).filter(p => (!fs || p.status === fs) && (!q || (p.code + ' ' + p.title).toLowerCase().includes(q.toLowerCase())))
  const sel = useRowSel(shown)
  if (err) return <p className="msg">{err}</p>
  if (!plans) return <p className="sub">Đang tải…</p>
  async function copy(p: Plan) {
    const { data, error } = await supabase.rpc('dist_plan_copy', { p_plan: p.id })
    if (error) return setMsg([errText(error.message), true])
    pendingOpen = data as string; setRk(k => k + 1); setMsg([`Đã nhân bản ${p.code}.`, false]); goTab?.('Bản phân phối')
  }
  const cur = sel.cur
  return (
    <>
      <div className="bar">
        <div className="tools">
          <select value={fs} onChange={e => setFs(e.target.value)} aria-label="Trạng thái"><option value="">Mọi trạng thái</option>{(Object.keys(STATUS) as Status[]).map(s => <option key={s} value={s}>{STATUS[s][0]}</option>)}</select>
          <input placeholder="Tìm mã, tên…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
        </div>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      <SelBar picked={cur ? cur.code : null}>
        <button disabled={!cur} onClick={() => cur && copy(cur)}>Nhân bản</button>
        <button disabled={!cur || cur.status !== 'published'} title={cur && cur.status !== 'published' ? 'Chỉ gán bản đã phát hành' : undefined}
          onClick={() => { if (cur) { pendingAssign = cur.id; goTab?.('Gán theo trường') } }}>Gán trường</button>
      </SelBar>
      <div className="wrap"><table className="libtable">
        <thead><tr><SelTh /><th>Mã</th><th>Bản phân phối</th><th>Nhánh</th><th>Chương trình</th><th>Trạng thái</th><th>Trường đã gán</th><th>Cập nhật</th></tr></thead>
        <tbody>{shown.map(p => <tr key={p.id} className={sel.is(p) ? 'picked' : undefined}>
          <SelTd on={sel.is(p)} onToggle={() => sel.toggle(p)} label={p.code} />
          <td>{p.code}</td>
          <td><button type="button" className="namelink" onClick={() => { pendingOpen = p.id; goTab?.('Bản phân phối') }}>{p.title}</button></td>
          <td>{levelName(p.level)} › Khối {p.grade} › {tierName(p.tier)}</td>
          <td>{counts.get(p.id) ?? 0}</td><td><PlanStatus s={p.status} /></td><td>{books.get(p.id) ?? 0}</td>
          <td><small>{new Date(p.updated_at).toLocaleDateString('vi-VN')}</small></td>
        </tr>)}
          {shown.length === 0 && <tr><td colSpan={8}>{plans.length ? 'Không có bản nào khớp bộ lọc.' : 'Chưa có bản phân phối nào. Soạn ở tab "Bản phân phối".'}</td></tr>}</tbody>
      </table></div>
    </>
  )
}

// ===== Tab "Gán theo trường" =====
type Org = { id: string; name: string; type: string; parent_id: string | null }
type Cls = { id: string; name: string; grade: number; org_id: string }
type Book = { id: string; title: string; status: string; year_name: string | null; org_id: string; dist_plan_id: string; program_id: string | null; curriculum_lessons: { count: number }[] }
const BOOK_STATUS: Record<string, string> = { draft: 'Nháp', pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Bị trả lại', published: 'Đã ban hành' }

export function DistAssign() {
  const [rk, setRk] = useState(0)
  const { plans } = usePlans(rk)
  const [pid, setPid] = useState<string>(() => { const x = pendingAssign; pendingAssign = null; return x ?? '' })
  const [orgs, setOrgs] = useState<Org[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [year, setYear] = useState('')
  const [classes, setClasses] = useState<Cls[]>([])
  const [cls, setCls] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [books, setBooks] = useState<Book[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const pub = (plans ?? []).filter(p => p.status === 'published')
  const plan = pub.find(p => p.id === pid) ?? null
  useEffect(() => { supabase.from('organizations').select('id, name, type, parent_id').order('name').then(({ data }) => setOrgs((data as Org[]) ?? [])) }, [])
  useEffect(() => {
    supabase.from('curriculum_books').select('id, title, status, year_name, org_id, dist_plan_id, program_id, curriculum_lessons(count)').not('dist_plan_id', 'is', null).order('updated_at', { ascending: false })
      .then(({ data }) => setBooks((data as unknown as Book[]) ?? []))
  }, [rk])
  useEffect(() => {
    setCls([])
    if (picked.length !== 1 || !plan) { setClasses([]); return }
    supabase.from('classes').select('id, name, grade, org_id').eq('org_id', picked[0]).eq('grade', plan.grade).order('name').then(({ data }) => setClasses((data as Cls[]) ?? []))
  }, [picked.join(','), plan?.id])
  const schools = orgs.filter(o => o.type === 'school' && (!q || o.name.toLowerCase().includes(q.toLowerCase())))
  const orgName = (id: string) => orgs.find(o => o.id === id)?.name ?? '—'
  const planOf = (id: string) => plans?.find(p => p.id === id)

  async function assign() {
    if (!plan || !picked.length) return
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('dist_plan_assign', { p_plan: plan.id, p_orgs: picked, p_year: year.trim() || null, p_classes: cls.length ? cls : null })
    setBusy(false)
    if (error) return setMsg([errText(error.message), true])
    const r = data as { books: number; skipped: number }
    setMsg([`Đã tạo ${r.books} PPCT nháp cho ${picked.length} trường${r.skipped ? `; ${r.skipped} PPCT đã có từ trước nên bỏ qua` : ''}. Trường kiểm tra rồi ban hành PPCT như thường lệ.`, false])
    setPicked([]); setRk(k => k + 1)
  }

  return (
    <>
      <div className="panel">
        <div className="formgrid">
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Bản phân phối đã phát hành</span>
            <select value={pid} onChange={e => setPid(e.target.value)}><option value="">— chọn bản —</option>{pub.map(p => <option key={p.id} value={p.id}>{p.code} · {p.title} (khối {p.grade})</option>)}</select></label>
          <label className="field"><span>Năm học</span><input value={year} onChange={e => setYear(e.target.value)} placeholder="Để trống = năm học hiện tại của trường" /></label>
        </div>
        {plan && <>
          <div className="bar"><b>Chọn trường ({picked.length})</b><input placeholder="Tìm trường…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm trường" /></div>
          <div className="distschools">{schools.map(o => <label key={o.id}><input type="checkbox" checked={picked.includes(o.id)}
            onChange={e => setPicked(e.target.checked ? [...picked, o.id] : picked.filter(x => x !== o.id))} /> {o.name}</label>)}
            {schools.length === 0 && <small className="sub">Không có trường nào trong phạm vi.</small>}</div>
          {picked.length === 1 && <fieldset className="libtargets"><legend>Lớp khối {plan.grade} (không chọn = áp dụng cả khối)</legend>
            {classes.map(c => <label key={c.id}><input type="checkbox" checked={cls.includes(c.id)} onChange={e => setCls(e.target.checked ? [...cls, c.id] : cls.filter(x => x !== c.id))} /> {c.name}</label>)}
            {classes.length === 0 && <small className="sub">Trường chưa có lớp khối {plan.grade}.</small>}</fieldset>}
          <div className="formactions"><button type="button" className="primary" disabled={busy || !picked.length} onClick={assign}>Gán và tạo PPCT</button>
            <small className="sub"> Mỗi chương trình trong bản thành một PPCT nháp của trường, tiết xếp theo tuần của bản. Gán lại không tạo trùng.</small></div>
        </>}
        {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      </div>
      <h4>PPCT theo trường từ bản phân phối</h4>
      <div className="wrap"><table className="libtable">
        <thead><tr><th>Trường</th><th>Bản phân phối</th><th>PPCT</th><th>Năm học</th><th>Số tiết</th><th>Trạng thái</th></tr></thead>
        <tbody>{books.map(b => <tr key={b.id}>
          <td>{orgName(b.org_id)}</td><td>{planOf(b.dist_plan_id)?.code ?? '—'}</td><td>{b.title}</td><td>{b.year_name ?? '—'}</td>
          <td>{b.curriculum_lessons?.[0]?.count ?? 0}</td><td>{BOOK_STATUS[b.status] ?? b.status}</td></tr>)}
          {books.length === 0 && <tr><td colSpan={6}>Chưa gán bản phân phối nào.</td></tr>}</tbody>
      </table></div>
    </>
  )
}
