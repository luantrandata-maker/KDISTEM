// Phân hệ 1 — Đánh giá năng lực nhà giáo (088): đợt đánh giá, khoảng thiếu hụt → gợi ý tập huấn, khung năng lực (KDI).
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { OrgPick } from '../../components/OrgScope'
import { downloadXlsx } from '../../lib/sheet'
import { ElView } from '../../components/ElView'
import { Chip } from '../dist/Editor'
import { schoolYear } from '../department/Governance'
import { LevelChip, useCompetencies, resetCompetencies, LV_NAME, SLV_NAME, type Comp } from '../competency'
import { FlowGuide } from '../../components/FlowGuide'
import { Tabs } from '../teacher/common'
import { MultiFilters, useMultiFilters } from '../../components/MultiFilters'
import { useOrgFilters } from '../../components/OrgFilters'
import { LevelNames } from '../settings/Custom'

const errText = (m: string) => /schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 088 trên Supabase.' : /row-level|42501/i.test(m) ? 'Bạn không có quyền với mục này.' : m
const vnDate = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : '—'
const today = () => new Date().toISOString().slice(0, 10)
const pct = (a: number, b: number) => b ? Math.round(a * 100 / b) : 0
const years = () => { const y = schoolYear(); const s = +y.slice(0, 4); return [`${s + 1}-${s + 2}`, y, `${s - 1}-${s}`] }

// ================= Đợt đánh giá =================
type Round = { id: string; org_id: string; name: string; school_year: string; opens_on: string; due_on: string; target_level: number; note: string | null
  status: 'open' | 'closed'; reminded_at: string | null; created_at: string; organizations?: { name: string } | null }
type Prog = { org_id: string; org_name: string; teachers: number; self_done: number; manager_done: number }
const roundSt = (r: Round): [string, string] => r.status === 'closed' ? ['Đã đóng', ''] : r.due_on < today() ? ['Quá hạn', 'bad'] : r.opens_on > today() ? ['Sắp mở', ''] : ['Đang mở', 'good']

export function AssessmentRoundsPage({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Round[] | null>(null)
  const [can, setCan] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const load = () => supabase.from('assessment_rounds').select('*, organizations(name)').order('created_at', { ascending: false })
    .then(({ data, error }) => { if (error) setMsg([errText(error.message), true]); setRows((data as Round[]) ?? []) })
  useEffect(() => { load(); supabase.rpc('training_can_write', { p_org: orgId }).then(({ data }) => setCan(!!data)) }, [orgId])
  const cur = rows?.find(r => r.id === open)
  if (creating) return <RoundForm orgId={orgId} onBack={() => setCreating(false)}
    onSaved={id => { setCreating(false); setMsg(['Đã mở đợt đánh giá. Theo dõi tiến độ và nhắc giáo viên ở tab "Tiến độ".', false]); load().then(() => setOpen(id)) }} />
  if (cur) return <RoundDetail r={cur} onBack={() => setOpen(null)} onChanged={m => { setMsg([m, false]); load() }} />
  const all = rows ?? []
  const openN = all.filter(r => r.status === 'open').length
  const add = () => { setMsg(null); setCreating(true) }
  return <>
    <FlowGuide id="training-rounds">
      <ol className="distguide">
        <li><button type="button" onClick={() => can && add()}><i>1</i><span><b>Mở đợt đánh giá</b><small>Đặt năm học, hạn nộp và mức yêu cầu. Đợt áp dụng cho mọi giáo viên trong đơn vị và các trường trực thuộc.</small></span></button></li>
        <li><button type="button" onClick={() => all[0] && setOpen(all[0].id)}><i>2</i><span><b>Theo dõi & nhắc</b><small>Xem từng trường đã tự đánh giá / được trường đánh giá bao nhiêu, gửi nhắc giáo viên chưa nộp.</small></span></button></li>
        <li><button type="button" disabled><i>3</i><span><b>Xem thiếu hụt</b><small>Kết quả vào hồ sơ năng lực; mục Khoảng thiếu hụt gợi ý chương trình tập huấn cho người dưới mức yêu cầu.</small></span></button></li>
      </ol>
    </FlowGuide>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    <section className="panel" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
      <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Đợt đánh giá năng lực <small className="sub">· {openN} đang mở</small></h3>
        {can && <button type="button" className="primary" onClick={add}>+ Mở đợt đánh giá</button>}</div>
      {!rows ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
        <thead><tr><th>Đợt</th><th>Đơn vị mở</th><th>Năm học</th><th>Thời gian</th><th>Mức yêu cầu</th><th>Trạng thái</th></tr></thead>
        <tbody>{all.map(r => { const st = roundSt(r); return <tr key={r.id}>
          <td><button type="button" className="namelink" onClick={() => setOpen(r.id)}>{r.name}</button></td>
          <td>{r.organizations?.name ?? '—'}</td><td>{r.school_year}</td><td>{vnDate(r.opens_on)} – {vnDate(r.due_on)}</td>
          <td>Mức {r.target_level} · {LV_NAME[r.target_level - 1]}</td><td><Chip tone={st[1]}>{st[0]}</Chip></td></tr> })}
          {!all.length && <tr><td colSpan={6}><small className="sub">Chưa có đợt đánh giá nào.{can ? ' Bấm "+ Mở đợt đánh giá" để bắt đầu.' : ''}</small></td></tr>}</tbody>
      </table></div>}
    </section>
  </>
}

type RForm = { org_id?: string; name: string; school_year: string; opens_on: string; due_on: string; target_level: number; note: string }
const roundBad = (f: RForm) => !f.name.trim() ? 'Nhập tên đợt.' : !f.due_on ? 'Chọn hạn nộp.' : f.due_on < f.opens_on ? 'Hạn nộp phải sau ngày mở.' : ''
function RoundFields({ f, set, orgPick }: { f: RForm; set: (f: RForm) => void; orgPick?: boolean }) {
  return <>
    <div className="formgrid">
      {orgPick && <OrgPick kind="unit" value={f.org_id ?? ''} onChange={v => set({ ...f, org_id: v })} title="Đơn vị mở đợt" />}
      <label className="field"><span>Tên đợt *</span><input value={f.name} onChange={e => set({ ...f, name: e.target.value })} placeholder={`Đánh giá năng lực GV năm học ${f.school_year}`} /></label>
      <label className="field"><span>Năm học</span><select value={f.school_year} onChange={e => set({ ...f, school_year: e.target.value })}>{[...new Set([...years(), f.school_year])].map(y => <option key={y}>{y}</option>)}</select></label>
      <label className="field"><span>Ngày mở</span><input type="date" value={f.opens_on} onChange={e => set({ ...f, opens_on: e.target.value })} /></label>
      <label className="field"><span>Hạn nộp *</span><input type="date" value={f.due_on} onChange={e => set({ ...f, due_on: e.target.value })} /></label>
      <label className="field"><span>Mức yêu cầu</span><select value={f.target_level} onChange={e => set({ ...f, target_level: +e.target.value })}>
        {[1, 2, 3, 4].map(l => <option key={l} value={l}>Mức {l} · {LV_NAME[l - 1]}</option>)}</select></label>
    </div>
    <label className="field"><span>Ghi chú cho giáo viên</span><textarea rows={3} value={f.note} onChange={e => set({ ...f, note: e.target.value })} /></label>
  </>
}

/** Trang riêng để mở đợt đánh giá mới (giống "Thêm chương trình tập huấn"). */
function RoundForm({ orgId, onBack, onSaved }: { orgId: string; onBack: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState<RForm>({ org_id: orgId, name: '', school_year: schoolYear(), opens_on: today(), due_on: '', target_level: 2, note: '' })
  const [err, setErr] = useState('')
  async function save() {
    const bad = roundBad(f); if (bad) return setErr(bad)
    const { data, error } = await supabase.from('assessment_rounds').insert({ org_id: f.org_id || orgId, name: f.name.trim(), school_year: f.school_year, opens_on: f.opens_on,
      due_on: f.due_on, target_level: f.target_level, note: f.note.trim() || null }).select('id').single()
    if (error) return setErr(errText(error.message))
    onSaved((data as { id: string }).id)
  }
  return <ElView back="Đợt đánh giá" onBack={onBack} title="Mở đợt đánh giá năng lực" sub="Đợt áp dụng cho mọi giáo viên trong đơn vị mở đợt và các trường trực thuộc.">
    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      {err && <p className="msg" role="alert">{err}</p>}
      <RoundFields f={f} set={setF} orgPick />
      <div className="formactions"><button type="button" onClick={onBack}>Huỷ</button> <button type="button" className="primary" onClick={save}>Mở đợt</button></div>
    </section>
  </ElView>
}

function RoundDetail({ r, onBack, onChanged }: { r: Round; onBack: () => void; onChanged: (m: string) => void }) {
  const [rows, setRows] = useState<Prog[] | null>(null)
  const [can, setCan] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'info' | 'progress'>('progress')
  const [f, setF] = useState<RForm | null>(null)
  useEffect(() => {
    supabase.rpc('assessment_round_progress', { p_round: r.id }).then(({ data, error }) => { if (error) setErr(errText(error.message)); setRows((data as Prog[]) ?? []) })
    supabase.rpc('training_can_write', { p_org: r.org_id }).then(({ data }) => setCan(!!data))
  }, [r.id])
  const all = rows ?? []
  const tot = all.reduce((a, x) => ({ t: a.t + x.teachers, s: a.s + x.self_done, m: a.m + x.manager_done }), { t: 0, s: 0, m: 0 })
  async function remind() {
    setBusy(true); setErr(''); setInfo('')
    const { data, error } = await supabase.rpc('assessment_round_remind', { p_round: r.id })
    setBusy(false)
    if (error) return setErr(errText(error.message))
    setInfo(data ? `Đã gửi nhắc tới ${data} giáo viên chưa nộp tự đánh giá.` : 'Vừa nhắc xong, hoặc mọi giáo viên có tài khoản đã nộp. Có thể nhắc lại sau 10 phút.')
  }
  async function setStatus(status: 'open' | 'closed') {
    const { error } = await supabase.from('assessment_rounds').update({ status }).eq('id', r.id)
    if (error) return setErr(errText(error.message))
    onChanged(status === 'closed' ? 'Đã đóng đợt đánh giá.' : 'Đã mở lại đợt đánh giá.')
  }
  async function saveInfo() {
    if (!f) return
    const bad = roundBad(f); if (bad) return setErr(bad)
    const { error } = await supabase.from('assessment_rounds').update({ name: f.name.trim(), school_year: f.school_year, opens_on: f.opens_on, due_on: f.due_on,
      target_level: f.target_level, note: f.note.trim() || null }).eq('id', r.id)
    if (error) return setErr(errText(error.message))
    setF(null); setErr(''); onChanged('Đã lưu thông tin đợt đánh giá.')
  }
  async function del() {
    if (!confirm(`Xoá đợt "${r.name}"? Bản đánh giá giáo viên đã làm vẫn giữ trong hồ sơ năng lực.`)) return
    const { error } = await supabase.from('assessment_rounds').delete().eq('id', r.id)
    if (error) return setErr(errText(error.message))
    onChanged('Đã xoá đợt đánh giá.'); onBack()
  }
  function excel() {
    downloadXlsx(`dot-danh-gia-${r.school_year}`, [{ key: 'o', label: 'Trường', width: 30 }, { key: 't', label: 'Số GV' }, { key: 's', label: 'Đã tự đánh giá' }, { key: 'sp', label: '% tự ĐG' },
      { key: 'm', label: 'Trường đã đánh giá' }, { key: 'mp', label: '% trường ĐG' }],
      all.map(x => [x.org_name, x.teachers, x.self_done, pct(x.self_done, x.teachers), x.manager_done, pct(x.manager_done, x.teachers)]), 'Tiến độ')
  }
  const st = roundSt(r)
  const startEdit = () => { setErr(''); setTab('info'); setF({ name: r.name, school_year: r.school_year, opens_on: r.opens_on, due_on: r.due_on, target_level: r.target_level, note: r.note ?? '' }) }
  return <ElView back="Đợt đánh giá" onBack={onBack} title={r.name}
    sub={<>{r.organizations?.name} · năm học {r.school_year} · {vnDate(r.opens_on)} – {vnDate(r.due_on)} · mức yêu cầu {r.target_level} · <Chip tone={st[1]}>{st[0]}</Chip></>}
    actions={<>
      <button type="button" onClick={excel} disabled={!all.length}>Xuất Excel</button>
      {can && r.status === 'open' && <button type="button" disabled={busy} onClick={remind}>Nhắc GV chưa nộp</button>}
      {can && <details className="distmore"><summary aria-label="Thao tác khác">···</summary><div className="distmenu">
        <button type="button" onClick={() => setStatus(r.status === 'open' ? 'closed' : 'open')}>{r.status === 'open' ? 'Đóng đợt' : 'Mở lại đợt'}</button>
        <button type="button" className="danger" onClick={del}>Xoá đợt</button></div></details>}</>}>
    {err && <p className="msg" role="alert">{err}</p>}
    {info && <p className="sub" role="status"><b>{info}</b></p>}
    <div className="segmented" style={{ marginBottom: 12 }}>
      {([['info', 'Thông tin đợt'], ['progress', 'Tiến độ']] as const).map(([k, l]) => <button key={k} type="button" className={tab === k ? 'on' : ''} disabled={!!f && k !== 'info'} onClick={() => setTab(k)}>{l}</button>)}
    </div>
    {tab === 'info' && <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Thông tin đợt</h3>{can && !f && <button type="button" onClick={startEdit}>Sửa thông tin</button>}</div>
      {f ? <>
        <RoundFields f={f} set={setF} />
        <div className="formactions"><button type="button" onClick={() => { setF(null); setErr('') }}>Huỷ thay đổi</button> <button type="button" className="primary" onClick={saveInfo}>Lưu thông tin</button></div>
      </> : <dl className="tpkv">
        <dt>Đơn vị mở</dt><dd>{r.organizations?.name ?? '—'}</dd>
        <dt>Năm học</dt><dd>{r.school_year}</dd>
        <dt>Thời gian</dt><dd>{vnDate(r.opens_on)} – {vnDate(r.due_on)}</dd>
        <dt>Mức yêu cầu</dt><dd>Mức {r.target_level} · {LV_NAME[r.target_level - 1]}</dd>
        <dt>Trạng thái</dt><dd><Chip tone={st[1]}>{st[0]}</Chip></dd>
        <dt>Ghi chú cho GV</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{r.note || '—'}</dd>
        <dt>Nhắc gần nhất</dt><dd>{r.reminded_at ? new Date(r.reminded_at).toLocaleString('vi-VN') : '—'}</dd>
      </dl>}
    </section>}
    {tab === 'progress' && <>
    <div className="diststatcards four">
      <div className="panel"><i aria-hidden="true">🏫</i><span><b>{rows ? all.length : '…'}</b><small>Trường</small></span></div>
      <div className="panel"><i aria-hidden="true">👥</i><span><b>{tot.t}</b><small>Giáo viên</small></span></div>
      <div className="panel"><i aria-hidden="true" className={pct(tot.s, tot.t) >= 80 ? 'good' : 'warn'}>✎</i><span><b>{pct(tot.s, tot.t)}%</b><small>Đã tự đánh giá</small><small>{tot.s}/{tot.t} GV</small></span></div>
      <div className="panel"><i aria-hidden="true" className={pct(tot.m, tot.t) >= 80 ? 'good' : 'warn'}>✓</i><span><b>{pct(tot.m, tot.t)}%</b><small>Trường đã đánh giá</small><small>{tot.m}/{tot.t} GV</small></span></div>
    </div>
    <section className="panel" style={{ marginTop: 14 }}>
      {!rows ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
        <thead><tr><th>Trường</th><th>Số GV</th><th>Tự đánh giá</th><th>Trường đánh giá</th></tr></thead>
        <tbody>{all.map(x => <tr key={x.org_id}><td>{x.org_name}</td><td>{x.teachers}</td>
          <td><Bar v={pct(x.self_done, x.teachers)} /> {x.self_done}/{x.teachers}</td><td><Bar v={pct(x.manager_done, x.teachers)} /> {x.manager_done}/{x.teachers}</td></tr>)}
          {!all.length && <tr><td colSpan={4}><small className="sub">Chưa có giáo viên trong phạm vi đợt.</small></td></tr>}</tbody>
      </table></div>}
    </section></>}
  </ElView>
}
export const Bar = ({ v, warnBelow = 50 }: { v: number; warnBelow?: number }) =>
  <span className="minibar" title={`${v}%`}><i style={{ width: `${Math.min(100, v)}%` }} className={v < warnBelow ? 'warn' : ''} /></span>

// ================= Khoảng thiếu hụt → gợi ý chương trình tập huấn =================
type Gap = { teacher_id: string; teacher_name: string; org_id: string; org_name: string | null; competency: string; competency_name: string; level: number
  suggest: { id: string; code: string | null; title: string; target_level: number }[] }
type OpenPlan = { plan_id: string; org_id: string; status: string; quota: number | null; training_plans: { plan_code: string | null; name: string; training_plan_items: { program_id: string }[] } }

export function CompetencyGapsPage({ orgId }: { orgId: string }) {
  const comps = useCompetencies('teacher')
  const [year, setYear] = useState(schoolYear())
  const [target, setTarget] = useState(2)
  const [rows, setRows] = useState<Gap[] | null>(null)
  const [plans, setPlans] = useState<OpenPlan[]>([])
  const [enrolled, setEnrolled] = useState<Set<string>>(new Set())
  const [comp, setComp] = useState('')
  const [q, setQ] = useState('')
  const [view, setView] = useState<'teacher' | 'school'>('teacher')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const load = () => {
    setRows(null)
    supabase.rpc('competency_gaps', { p_year: year, p_target: target }).then(({ data, error }) => { if (error) setMsg([errText(error.message), true]); setRows((data as Gap[]) ?? []) })
  }
  useEffect(load, [year, target])
  // Kế hoạch được giao cho trường đang mở chọn GV (để ghi danh ngay từ gợi ý)
  const loadPlans = () => {
    supabase.from('training_plan_orgs').select('plan_id, org_id, status, quota, training_plans!inner(plan_code, name, training_plan_items(program_id))')
      .in('status', ['assigned', 'returned']).eq('org_id', orgId).then(({ data }) => {
        const ps = (data as unknown as OpenPlan[]) ?? []; setPlans(ps)
        if (ps.length) supabase.from('training_enrollments').select('plan_id, teacher_id').in('plan_id', ps.map(p => p.plan_id))
          .then(({ data: e }) => setEnrolled(new Set(((e ?? []) as { plan_id: string; teacher_id: string }[]).map(x => x.plan_id + '|' + x.teacher_id))))
      })
  }
  useEffect(loadPlans, [orgId])

  // Lọc Tỉnh / Sở, trường (chọn nhiều); ô tìm chỉ tìm tên giáo viên
  const mf = useMultiFilters()
  const of = useOrgFilters(rows ?? [], mf)
  const all = (rows ?? []).filter(g => of.fit(g.org_id))
  const shown = all.filter(g => (!comp || g.competency === comp) && (!q || g.teacher_name.toLowerCase().includes(q.toLowerCase())))
  const byTeacher = useMemo(() => {
    const m = new Map<string, Gap[]>()
    shown.forEach(g => m.set(g.teacher_id, [...(m.get(g.teacher_id) ?? []), g]))
    return [...m.values()]
  }, [shown])
  const bySchool = useMemo(() => {
    const m = new Map<string, { name: string; teachers: Set<string>; per: Record<string, number> }>()
    all.forEach(g => { const k = g.org_id; const x = m.get(k) ?? { name: g.org_name ?? '—', teachers: new Set(), per: {} }; x.teachers.add(g.teacher_id); x.per[g.competency] = (x.per[g.competency] ?? 0) + 1; m.set(k, x) })
    return [...m.values()].sort((a, b) => b.teachers.size - a.teachers.size)
  }, [all])
  const perComp = comps.map(c => [c, all.filter(g => g.competency === c.key).length] as [Comp, number])
  const top = [...perComp].sort((a, b) => b[1] - a[1])[0]
  const teachersN = new Set(all.map(g => g.teacher_id)).size
  const noSuggest = all.filter(g => !g.suggest.length).length

  async function enroll(planId: string, teacherId: string, name: string) {
    const { error } = await supabase.from('training_enrollments').insert({ org_id: orgId, plan_id: planId, teacher_id: teacherId })
    if (error) return setMsg([errText(error.message), true])
    setMsg([`Đã ghi danh ${name} vào kế hoạch. Nhớ gửi danh sách duyệt ở mục Kế hoạch tập huấn.`, false]); loadPlans()
  }
  function excel() {
    downloadXlsx(`khoang-thieu-hut-${year}`, [{ key: 't', label: 'Giáo viên', width: 26 }, { key: 'o', label: 'Trường', width: 28 }, { key: 'c', label: 'Năng lực', width: 30 },
      { key: 'l', label: 'Mức hiện tại' }, { key: 's', label: 'Chương trình gợi ý', width: 50 }],
      shown.map(g => [g.teacher_name, g.org_name, g.competency_name, g.level, g.suggest.map(s => `${s.code ?? ''} ${s.title}`.trim()).join('; ')]), 'Thiếu hụt')
  }
  return <>
    <div className="panel distintro">
      <p style={{ margin: 0 }}>Mức năng lực lấy theo đánh giá năm học (ưu tiên mức trường đánh giá, nếu chưa có thì mức tự đánh giá đã nộp). Chứng chỉ tập huấn đã cấp nâng mức lên bằng mức đích của chương trình.
        Giáo viên dưới mức yêu cầu được gợi ý chương trình tập huấn đã phát hành có bồi dưỡng năng lực đó.</p>
    </div>
    <div className="diststatcards four">
      <div className="panel"><i aria-hidden="true" className={teachersN ? 'warn' : 'good'}>👥</i><span><b>{rows ? teachersN : '…'}</b><small>GV có thiếu hụt</small></span></div>
      <div className="panel"><i aria-hidden="true">≠</i><span><b>{all.length}</b><small>Lượt thiếu hụt</small></span></div>
      <div className="panel"><i aria-hidden="true">▲</i><span><b>{top && top[1] ? top[0].name : '—'}</b><small>Thiếu nhiều nhất{top && top[1] ? ` · ${top[1]} GV` : ''}</small></span></div>
      <div className="panel"><i aria-hidden="true" className={noSuggest ? 'warn' : ''}>?</i><span><b>{noSuggest}</b><small>Chưa có chương trình phù hợp</small></span></div>
    </div>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    <section className="panel" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
      <div className="distfilter">
        <select value={year} onChange={e => setYear(e.target.value)} aria-label="Năm học">{years().map(y => <option key={y} value={y}>Năm học {y}</option>)}</select>
        <select value={target} onChange={e => setTarget(+e.target.value)} aria-label="Mức yêu cầu">{[2, 3, 4].map(l => <option key={l} value={l}>Yêu cầu từ Mức {l} ({LV_NAME[l - 1]})</option>)}</select>
        <MultiFilters defs={of.defs} f={mf} />
        <input placeholder="Tìm tên giáo viên…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm giáo viên" />
        <button type="button" onClick={excel} disabled={!shown.length}>Xuất Excel</button>
      </div>
      <div className="distfilter">
        <button type="button" className={`distfchip${!comp ? ' on' : ''}`} onClick={() => setComp('')}>Mọi năng lực ({all.length})</button>
        {perComp.map(([c, n]) => <button key={c.key} type="button" className={`distfchip${comp === c.key ? ' on' : ''}`} onClick={() => setComp(c.key)}>{c.name} ({n})</button>)}
        <span style={{ flex: 1 }} />
        <button type="button" className={`distfchip${view === 'teacher' ? ' on' : ''}`} onClick={() => setView('teacher')}>Theo giáo viên</button>
        <button type="button" className={`distfchip${view === 'school' ? ' on' : ''}`} onClick={() => setView('school')}>Tổng hợp theo trường</button>
      </div>
      {!rows ? <p className="sub">Đang tải…</p> : view === 'school' ? <div className="wrap"><table className="libtable">
        <thead><tr><th>Trường</th><th>GV có thiếu hụt</th>{comps.map(c => <th key={c.key}>{c.name}</th>)}</tr></thead>
        <tbody>{bySchool.map(s => <tr key={s.name}><td>{s.name}</td><td><b>{s.teachers.size}</b></td>{comps.map(c => <td key={c.key}>{s.per[c.key] ?? <small className="sub">0</small>}</td>)}</tr>)}
          {!bySchool.length && <tr><td colSpan={comps.length + 2}><small className="sub">Không có thiếu hụt.</small></td></tr>}</tbody></table></div>
      : <div className="wrap"><table className="libtable">
        <thead><tr><th>Giáo viên</th><th>Năng lực dưới mức yêu cầu</th><th>Chương trình tập huấn gợi ý</th></tr></thead>
        <tbody>{byTeacher.slice(0, 300).map(gs => { const g0 = gs[0]
          const sug = [...new Map(gs.flatMap(g => g.suggest).map(s => [s.id, s])).values()]
          return <tr key={g0.teacher_id}>
            <td><b>{g0.teacher_name}</b><br /><small className="sub">{g0.org_name ?? '—'}</small></td>
            <td>{gs.map(g => <div key={g.competency} className="gaprow">{g.competency_name} <LevelChip v={g.level} comp={comps.find(c => c.key === g.competency)} /></div>)}</td>
            <td>{sug.length ? sug.map(s => {
              const ps = plans.filter(p => p.org_id === g0.org_id && p.training_plans.training_plan_items.some(i => i.program_id === s.id))
              return <div key={s.id} className="gaprow"><span>{s.code && <small className="sub">{s.code} · </small>}{s.title} <small className="sub">(mức đích {s.target_level})</small></span>
                {ps.map(p => enrolled.has(p.plan_id + '|' + g0.teacher_id)
                  ? <Chip key={p.plan_id} tone="good">Đã ghi danh {p.training_plans.plan_code}</Chip>
                  : <button key={p.plan_id} type="button" className="linkbtn" onClick={() => enroll(p.plan_id, g0.teacher_id, g0.teacher_name)}>+ Ghi danh vào {p.training_plans.plan_code ?? p.training_plans.name}</button>)}
              </div> }) : <small className="sub">Chưa có chương trình đã phát hành bồi dưỡng năng lực này.</small>}</td>
          </tr> })}
          {!byTeacher.length && <tr><td colSpan={3}><small className="sub">{all.length ? 'Không có giáo viên nào khớp.' : 'Không có giáo viên dưới mức yêu cầu (trong số giáo viên đã có kết quả đánh giá năm học này).'}</small></td></tr>}</tbody>
      </table></div>}
      {plans.length === 0 && view === 'teacher' && byTeacher.length > 0 && <small className="sub">Nút ghi danh hiện khi trường có kế hoạch được giao đang chọn giáo viên và kế hoạch đó có chương trình được gợi ý.</small>}
    </section>
  </>
}

// ================= Khung năng lực (KDI): giáo viên và học sinh =================
export function CompetencyFrameworkPage() {
  const [aud, setAud] = useState<'teacher' | 'student'>('teacher')
  return <>
    <Tabs value={aud} onChange={setAud} items={[['teacher', 'Năng lực giáo viên'], ['student', 'Năng lực học sinh']]} />
    <CompetencyFramework key={aud} audience={aud} />
  </>
}

const AUD = {
  teacher: { title: 'Năng lực giáo viên', grp: 'Giáo viên STEM', prefix: 'gv_', example: 'gv_hop_tac', levels: LV_NAME,
    intro: 'Khung năng lực giáo viên dùng chung cho mọi đơn vị: tự đánh giá, trường đánh giá, khoảng thiếu hụt và năng lực đích của chương trình tập huấn đều theo khung này.' },
  student: { title: 'Năng lực học sinh', grp: 'Năng lực đặc thù', prefix: '', example: 'ngoai_ngu', levels: SLV_NAME,
    intro: 'Khung năng lực học sinh dùng chung: năng lực của chương trình giáo dục, yêu cầu cần đạt, tiêu chí chấm (rubric) và hồ sơ năng lực học sinh đều theo khung này.' },
}
export function CompetencyFramework({ audience, compact }: { audience: 'teacher' | 'student'; compact?: boolean }) {
  const A = AUD[audience]
  const lvLabel = (i: number) => A.levels[i] === `Mức ${i + 1}` ? A.levels[i] : `Mức ${i + 1} · ${A.levels[i]}`
  const [names, setNames] = useState(false)
  const comps = useCompetencies(audience)
  const [edit, setEdit] = useState<Comp | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const list = comps
  const groups = [...new Set(list.map(c => c.grp))]
  async function save() {
    if (!edit) return
    if (!edit.key.match(/^[a-z][a-z_]{1,40}$/)) return setMsg([`Mã chỉ gồm chữ thường không dấu và dấu gạch dưới (VD: ${A.example}).`, true])
    if (!edit.name.trim() || edit.levels.some(l => !l.trim())) return setMsg(['Nhập tên và mô tả đủ 4 mức.', true])
    const row = { key: edit.key, audience, grp: edit.grp.trim() || A.grp, name: edit.name.trim(), description: edit.description?.trim() || null, levels: edit.levels.map(l => l.trim()), sort: edit.sort }
    const { error } = isNew ? await supabase.from('competencies').insert(row) : await supabase.from('competencies').update(row).eq('key', edit.key)
    if (error) return setMsg([/duplicate|unique/i.test(error.message) ? 'Mã năng lực đã có.' : errText(error.message), true])
    setMsg([isNew ? 'Đã thêm năng lực.' : 'Đã lưu năng lực.', false]); setEdit(null); resetCompetencies()
  }
  function add() {
    setIsNew(true); setMsg(null)
    setEdit({ key: A.prefix, audience, grp: list[list.length - 1]?.grp ?? A.grp, name: '', description: '', levels: ['', '', '', ''], sort: (list[list.length - 1]?.sort ?? 100) + 10 })
  }
  if (edit) return <ElView back={A.title} onBack={() => { setEdit(null); setMsg(null) }} title={isNew ? 'Thêm năng lực' : edit.name}
    sub={isNew ? 'Mã năng lực không đổi được sau khi lưu vì kết quả đánh giá lưu theo mã.' : <>{edit.key} · {edit.grp}</>}>
    {msg && msg[1] && <p className="msg" role="alert"><b>{msg[0]}</b></p>}
    <section className="panel" style={{ display: 'grid', gap: 10 }}>
      <div className="formgrid">
        <label className="field"><span>Mã *</span><input value={edit.key} disabled={!isNew} onChange={e => setEdit({ ...edit, key: e.target.value })} placeholder={A.example} /></label>
        <label className="field"><span>Tên năng lực *</span><input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label>
        <label className="field"><span>Nhóm</span><input list={'cgrp-' + audience} value={edit.grp} onChange={e => setEdit({ ...edit, grp: e.target.value })} />
          <datalist id={'cgrp-' + audience}>{groups.map(g => <option key={g} value={g} />)}</datalist></label>
        <label className="field"><span>Thứ tự</span><input type="number" value={edit.sort} onChange={e => setEdit({ ...edit, sort: +e.target.value })} /></label>
      </div>
      <label className="field"><span>Mô tả</span><textarea rows={2} value={edit.description ?? ''} onChange={e => setEdit({ ...edit, description: e.target.value })} /></label>
      <div className="formgrid">{edit.levels.map((l, i) => <label key={i} className="field"><span>{lvLabel(i)}</span>
        <textarea rows={3} value={l} onChange={e => setEdit({ ...edit, levels: edit.levels.map((x, k) => k === i ? e.target.value : x) })} /></label>)}</div>
      <div className="formactions"><button type="button" onClick={() => { setEdit(null); setMsg(null) }}>Huỷ</button> <button type="button" className="primary" onClick={save}>{isNew ? 'Thêm năng lực' : 'Lưu'}</button></div>
    </section>
  </ElView>
  return <>
    {!compact && <div className="panel distintro"><p style={{ margin: 0 }}>{A.intro} Sửa mô tả mức có hiệu lực ngay; mã năng lực không đổi được vì kết quả đã lưu theo mã.</p></div>}
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    <section className="panel" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
      <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>{A.title} ({list.length})</h3>
        <span className="tools"><button type="button" onClick={() => setNames(!names)}>{names ? 'Đóng tên các mức' : 'Đổi tên các mức'}</button>
          <button type="button" className="primary" onClick={add}>+ Thêm năng lực</button></span></div>
      {names && <LevelNames keys={[audience === 'teacher' ? 'comp_level_teacher' : 'comp_level_student']} />}
      <div className="wrap"><table className="libtable">
        <thead><tr><th>Năng lực</th><th>Nhóm</th>{A.levels.map((_, i) => <th key={i}>{lvLabel(i)}</th>)}<th /></tr></thead>
        <tbody>{list.map(c => <tr key={c.key}><td><button type="button" className="namelink" onClick={() => { setIsNew(false); setMsg(null); setEdit({ ...c, levels: [...c.levels] }) }}>{c.name}</button><br /><small className="sub">{c.key}</small>{c.description && <><br /><small>{c.description}</small></>}</td>
          <td><small>{c.grp}</small></td>
          {c.levels.map((l, i) => <td key={i}><small>{l}</small></td>)}
          <td><button type="button" onClick={() => { setIsNew(false); setMsg(null); setEdit({ ...c, levels: [...c.levels] }) }}>Sửa</button></td></tr>)}
          {!list.length && <tr><td colSpan={7}><small className="sub">Chưa có năng lực nào.</small></td></tr>}</tbody>
      </table></div>
    </section>
  </>
}
