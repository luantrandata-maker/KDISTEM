// Học liệu đào tạo: cùng khuôn với Học liệu của chương trình giáo dục — quy trình 3 bước, 4 thẻ số liệu,
// tab Học liệu theo chương trình | Cần chuẩn bị | Danh mục học liệu (Nội dung, Bài giảng, Link tài liệu, Định mức vật tư, Kho hoạt động).
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx } from '../../lib/sheet'
import { FlowGuide } from '../../components/FlowGuide'
import { StatCards } from '../../components/StatCards'
import { kitOf } from '../library/lesson/model'
import { allUnits } from './Materials'
import { TrainingByProgram } from './ByProgram'
import type { Detail } from './Content'

type Tab = 'prog' | 'needs' | 'catalog'
type Prog = { id: string; code: string; title: string; status: string }
type Unit = { id: string; program_id: string; kind: string; title: string; detail: Detail | null }
type Lesson = { id: string; title: string; program_id: string | null; unit_id: string | null; status: string; content: { kit?: unknown } | null }
type Data = { progs: Prog[]; units: Unit[]; lessons: Lesson[] }
// Một dòng vật tư: per = person (mỗi người) | group (mỗi nhóm, mỗi sản phẩm) | class (cả lớp)
type Mat = { prog: string | null; uid: string | null; name: string; unit: string; qty: number; per: 'person' | 'group' | 'class'; src: string }

const num = (v: unknown) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0 }

function useTrainingLib() {
  const [d, setD] = useState<Data | null>(null)
  useEffect(() => {
    Promise.all([
      supabase.from('training_programs').select('id, code, title, status').neq('status', 'archived').order('code'),
      allUnits(),
      supabase.from('training_lessons').select('id, title, program_id, unit_id, status, content'),
    ]).then(([p, u, l]) => setD({ progs: (p.data as Prog[]) ?? [], units: ((u.data ?? []) as unknown as Unit[]).filter(x => x.kind === 'content'), lessons: (l.data as Lesson[]) ?? [] }))
  }, [])
  return d
}

/** Vật tư từ nội dung chương trình và từ bài giảng đào tạo (thẻ 04) */
function matsOf(d: Data): Mat[] {
  const out: Mat[] = []
  d.units.forEach(u => (u.detail?.mats ?? []).forEach(r => { if (r.name?.trim())
    out.push({ prog: u.program_id, uid: u.id, name: r.name.trim(), unit: (r.unit ?? '').trim(), qty: num(r.qty), per: r.per === 'person' ? 'person' : r.per === 'class' ? 'class' : 'group', src: u.title }) }))
  d.lessons.forEach(l => { if (!l.content?.kit) return
    const k = kitOf(l.content.kit)
    ;[...k.mats.product, ...k.mats.group].forEach(m => { if (m.name?.trim()) out.push({ prog: l.program_id, uid: l.unit_id, name: m.name.trim(), unit: (m.unit ?? '').trim(), qty: num(m.qty), per: 'group', src: l.title }) })
  })
  return out
}

function useStats(d: Data | null) {
  return useMemo(() => {
    if (!d) return null
    let docs = 0, acts = 0
    d.units.forEach(u => { docs += (u.detail?.docs?.length ?? 0) + (u.detail?.lectures?.length ?? 0); acts += u.detail?.acts?.length ?? 0 })
    d.lessons.forEach(l => { if (l.content?.kit) { const k = kitOf(l.content.kit); docs += k.docs.length; acts += k.bank.length } })
    const mats = matsOf(d)
    const withKit = new Set([...d.units.filter(u => { const x = u.detail ?? {}; return (x.docs?.length || x.lectures?.length || x.mats?.length || x.acts?.length) }).map(u => u.program_id),
      ...d.lessons.map(l => l.program_id)].filter(Boolean))
    return { docs, acts, mats: mats.length, needs: new Set(mats.map(m => m.name.toLowerCase() + '|' + m.unit)).size,
      lessons: d.lessons.length, published: d.lessons.filter(l => l.status === 'published').length, progs: d.progs.length, withKit: d.progs.filter(p => withKit.has(p.id)).length }
  }, [d])
}

export function TrainingLibraryPage({ parts, ...p }: { parts: [string, ComponentType<any>][]; orgId: string } & Record<string, unknown>) {
  const [tab, setTab] = useState<Tab>('prog')
  const [part, setPart] = useState(0)
  const d = useTrainingLib()
  const s = useStats(d)
  const n = (v: number | undefined) => (v == null ? '…' : v)
  const steps: [Tab, string, string, string][] = [
    ['prog', 'Bước 01', 'Soạn học liệu theo nội dung', 'Đi theo Chương trình đào tạo → Môn → Nội dung, tải giáo án Word hoặc bài giảng PowerPoint để tách thành bộ học liệu 5 thẻ.'],
    ['needs', 'Bước 02 · Tự tổng hợp', 'Cần chuẩn bị', 'Tự tổng hợp thiết bị, vật tư cần có cho một khoá đào tạo theo số học viên và số nhóm.'],
    ['catalog', 'Bước 03 · Tự tổng hợp', 'Danh mục học liệu', 'Danh mục tổng: nội dung, bài giảng, link tài liệu, định mức vật tư và kho hoạt động của tất cả chương trình đào tạo.'],
  ]
  const Part = parts[part]?.[1]
  return <>
    <FlowGuide id="training-library">
      <ol className="distguide">{steps.map(([t, k, h, dd], i) => <li key={t}>
        <button type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}><i>{i + 1}</i><span><small className="libstepk">{k}</small><b>{h}</b><small>{dd}</small></span></button></li>)}</ol>
      <p className="sub" style={{ margin: 0 }}>Chỉ bước 1 cần nhập. Bước 2 và 3 tự tổng hợp từ học liệu của các nội dung và bài giảng, không phải nhập lại.</p>
    </FlowGuide>
    <StatCards nav onPick={k => k && setTab(k as Tab)} items={[
      { k: 'catalog', icon: 'folders', value: n(s ? s.docs + s.mats + s.acts : undefined), label: 'Học liệu', sub: s ? `${s.docs} tài liệu · ${s.mats} vật tư · ${s.acts} hoạt động` : '' },
      { k: 'catalog', icon: 'checkCircle', tone: 'good', value: n(s?.lessons), label: 'Bài giảng đào tạo', sub: s ? `${s.published} đã phát hành` : '' },
      { k: 'prog', icon: 'book', tone: 'good', value: n(s?.progs), label: 'Chương trình đào tạo', sub: s ? `${s.progs - s.withKit} chưa có học liệu` : '' },
      { k: 'needs', icon: 'package', tone: 'warn', value: n(s?.needs), label: 'Thiết bị, vật tư cần chuẩn bị' },
    ]} />
    <div className="distpills" role="tablist">
      {([['prog', 'Học liệu theo chương trình'], ['needs', 'Cần chuẩn bị'], ['catalog', 'Danh mục học liệu']] as [Tab, string][]).map(([t, l]) =>
        <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>)}
    </div>
    {tab === 'prog' && <TrainingByProgram orgId={p.orgId} />}
    {tab === 'needs' && <Needs d={d} />}
    {tab === 'catalog' && <>
      <div className="distfilter">{parts.map(([l], i) => <button key={l} type="button" className={`distfchip${part === i ? ' on' : ''}`} onClick={() => setPart(i)}>{l}</button>)}</div>
      {/* Danh mục: bỏ hàng thẻ số liệu của từng tab con (đã có thẻ tổng ở trên) */}
      {Part && <div className="nocards"><Part key={part} {...p} /></div>}
    </>}
  </>
}

const PER_L = { person: 'mỗi người', group: 'mỗi nhóm', class: 'cả lớp' }

type PlanOpt = { id: string; plan_code: string | null; name: string; pub_status: string | null; training_plan_items: { program_id: string; quota: number | null; units: string[] | null }[] }

/** Kế hoạch tập huấn + số học viên đã ghi danh của từng kế hoạch (chỉ tải khi chọn "Theo kế hoạch") */
function usePlans(on: boolean) {
  const [v, setV] = useState<{ plans: PlanOpt[]; enr: Map<string, number> } | null>(null)
  useEffect(() => {
    if (!on || v) return
    Promise.all([
      supabase.from('training_plans').select('id, plan_code, name, pub_status, training_plan_items(program_id, quota, units)').order('plan_code', { ascending: false }),
      supabase.from('training_enrollments').select('plan_id').limit(50000),
    ]).then(([p, e]) => { const m = new Map<string, number>(); ((e.data as { plan_id: string }[]) ?? []).forEach(x => m.set(x.plan_id, (m.get(x.plan_id) ?? 0) + 1))
      setV({ plans: ((p.data as PlanOpt[]) ?? []).filter(x => x.training_plan_items?.length), enr: m }) })
  }, [on, v])
  return v
}

function Needs({ d }: { d: Data | null }) {
  const [by, setBy] = useState<'prog' | 'plan'>('prog')
  const [pid, setPid] = useState('')
  const [planId, setPlanId] = useState('')
  const [people, setPeople] = useState(30)
  const [groups, setGroups] = useState(6)
  const pl = usePlans(by === 'plan')
  const progs = useMemo(() => { if (!d) return []; const has = new Set(matsOf(d).map(m => m.prog)); return d.progs.filter(p => has.has(p.id)) }, [d])
  useEffect(() => { if (!pid && progs.length) setPid((progs.find(p => p.status === 'published') ?? progs[0]).id) }, [progs, pid])
  const plan = pl?.plans.find(x => x.id === planId)
  // Chọn kế hoạch: số học viên lấy theo số đã ghi danh (chưa có thì theo tổng chỉ tiêu), số nhóm ~ 5 người/nhóm
  function pickPlan(id: string) {
    setPlanId(id); const x = pl?.plans.find(y => y.id === id); if (!x) return
    const n = pl!.enr.get(id) || x.training_plan_items.reduce((a, i) => a + (i.quota ?? 0), 0)
    if (n > 0) { setPeople(Math.min(2000, n)); setGroups(Math.max(1, Math.min(200, Math.ceil(n / 5)))) }
  }
  useEffect(() => { if (by === 'plan' && pl && !planId && pl.plans.length) pickPlan((pl.plans.find(x => x.pub_status === 'published') ?? pl.plans[0]).id) }, [by, pl, planId])
  const rows = useMemo(() => {
    if (!d) return []
    let mats: (Mat & { tag?: string })[]
    if (by === 'prog') { if (!pid) return []; mats = matsOf(d).filter(x => x.prog === pid) }
    else { if (!plan) return []
      const items = new Map(plan.training_plan_items.map(i => [i.program_id, i])), code = new Map(d.progs.map(p => [p.id, p.code])), many = items.size > 1
      mats = matsOf(d).filter(x => { const i = x.prog ? items.get(x.prog) : undefined; return !!i && (!i.units || !x.uid || i.units.includes(x.uid)) })
        .map(x => many ? { ...x, src: `${code.get(x.prog!) ?? ''} · ${x.src}` } : x) }
    const m = new Map<string, { name: string; unit: string; total: number; parts: string[]; srcs: Set<string> }>()
    mats.forEach(x => {
      const k = x.name.toLowerCase() + '|' + x.unit
      const r = m.get(k) ?? { name: x.name, unit: x.unit, total: 0, parts: [], srcs: new Set<string>() }
      r.total += x.qty * (x.per === 'person' ? people : x.per === 'group' ? groups : 1)
      r.parts.push(`${String(x.qty).replace('.', ',')} ${PER_L[x.per]}`); r.srcs.add(x.src); m.set(k, r)
    })
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }, [d, by, pid, plan, people, groups])
  if (!d) return <p className="sub">Đang tải…</p>
  if (!progs.length) return <p className="sub">Chưa có chương trình đào tạo nào có định mức vật tư. Thêm vật tư ở thẻ 04 của nội dung hoặc bài giảng đào tạo.</p>
  const p = progs.find(x => x.id === pid)
  const fmt = (v: number) => String(Math.round(v * 100) / 100).replace('.', ',')
  return <>
    <div className="bar">
      <div className="tools">
        <span className="segmented" role="group" aria-label="Tổng hợp theo">
          <button type="button" className={by === 'prog' ? 'on' : ''} aria-pressed={by === 'prog'} onClick={() => setBy('prog')}>Theo chương trình</button>
          <button type="button" className={by === 'plan' ? 'on' : ''} aria-pressed={by === 'plan'} onClick={() => setBy('plan')}>Theo kế hoạch tập huấn</button></span>
        {by === 'prog' ? <select value={pid} onChange={e => setPid(e.target.value)} aria-label="Chương trình đào tạo">
          {progs.map(x => <option key={x.id} value={x.id}>{x.code} · {x.title}{x.status !== 'published' ? ' · nháp' : ''}</option>)}</select>
        : !pl ? <small className="sub">Đang tải kế hoạch…</small>
        : !pl.plans.length ? <small className="sub">Chưa có kế hoạch tập huấn nào có chương trình.</small>
        : <select value={planId} onChange={e => pickPlan(e.target.value)} aria-label="Kế hoạch tập huấn">
          {pl.plans.map(x => <option key={x.id} value={x.id}>{x.plan_code ? x.plan_code + ' · ' : ''}{x.name}{x.pub_status !== 'published' ? ' · nháp' : ''}</option>)}</select>}
        <label className="tools">Số học viên <input type="number" min={1} max={2000} value={people} onChange={e => setPeople(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))} style={{ width: 80 }} aria-label="Số học viên" /></label>
        <label className="tools">Số nhóm <input type="number" min={1} max={200} value={groups} onChange={e => setGroups(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} style={{ width: 80 }} aria-label="Số nhóm" /></label>
      </div>
      <div className="tools"><button type="button" disabled={!rows.length} onClick={() => downloadXlsx(`Can-chuan-bi-${(by === 'plan' ? plan?.plan_code : p?.code) || 'dao-tao'}.xlsx`,
        [{ key: 'n', label: 'Thiết bị, vật tư', width: 34 }, { key: 'u', label: 'Đơn vị', width: 10 }, { key: 't', label: 'Tổng cần', width: 10 }, { key: 'd', label: 'Định mức', width: 30 }, { key: 's', label: 'Dùng ở', width: 40 }],
        rows.map(r => [r.name, r.unit, Math.round(r.total * 100) / 100, r.parts.join('; '), [...r.srcs].join('; ')]), 'Cần chuẩn bị')}>Xuất Excel</button></div>
    </div>
    {by === 'plan' && plan && <small className="sub" style={{ display: 'block' }}>Kế hoạch gồm {plan.training_plan_items.length} chương trình: {plan.training_plan_items.map(i => d.progs.find(x => x.id === i.program_id)?.code ?? '?').join(', ')}
      {' · '}{pl?.enr.get(plan.id) ? `${pl.enr.get(plan.id)} học viên đã ghi danh` : 'chưa có học viên ghi danh, tạm lấy theo chỉ tiêu'}. Chỉ tính các nội dung kế hoạch chọn học.</small>}
    {by === 'plan' && plan && !rows.length && <p className="sub">Các chương trình trong kế hoạch này chưa có định mức vật tư.</p>}
    <small className="sub">Tổng cho {by === 'plan' ? 'kế hoạch' : 'một khoá'} {people} học viên, {groups} nhóm. Vật tư ghi “mỗi sản phẩm” trong bài giảng được tính theo nhóm.</small>
    <div className="wrap"><table className="libtable">
      <thead><tr><th>Thiết bị, vật tư</th><th>Đơn vị</th><th>Tổng cần</th><th>Định mức</th><th>Dùng ở</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.name + '|' + r.unit}>
        <td><b>{r.name}</b></td><td>{r.unit || '—'}</td><td><b>{fmt(r.total)}</b></td>
        <td style={{ whiteSpace: 'normal' }}><small>{r.parts.join('; ')}</small></td>
        <td style={{ whiteSpace: 'normal' }}><small className="sub">{[...r.srcs].join('; ')}</small></td></tr>)}</tbody>
    </table></div>
  </>
}
