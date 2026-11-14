// Phân hệ 1 — Đánh giá năng lực nhà giáo (088): đợt đánh giá, khoảng thiếu hụt → gợi ý đào tạo, khung năng lực (KDI).
import { useEffect, useMemo, useState } from 'react'
import { HeadAction } from '../../components/PageFrame'
import { supabase } from '../../lib/supabase'
import { OrgPick } from '../../components/OrgScope'
import { downloadXlsx } from '../../lib/sheet'
import { ElView } from '../../components/ElView'
import { Chip } from '../dist/Editor'
import { schoolYear } from '../department/Governance'
import { LevelChip, useCompetencies, resetCompetencies, LV_NAME, SLV_NAME, type Comp } from '../competency'
import { Tabs } from '../teacher/common'
import { MultiFilters, useMultiFilters } from '../../components/MultiFilters'
import { useOrgFilters } from '../../components/OrgFilters'
import { LevelNames } from '../settings/Custom'
import { StatCards } from '../../components/StatCards'
import { DataTable, type Col } from '../../components/DataTable'
import { GroupTree, groupNodes, inGroup, useGroupSel } from '../../components/GroupTree'

const m133 = (m: string) => /schema cache|does not exist|Could not find/i.test(m) ? 'Hãy chạy migration 133 trên Supabase.' : errText(m)
const errText = (m: string) => /schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 088 trên Supabase.' : /row-level|42501/i.test(m) ? 'Bạn không có quyền với mục này.' : m
const vnDate = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : '—'
const today = () => new Date().toISOString().slice(0, 10)
const pct = (a: number, b: number) => b ? Math.round(a * 100 / b) : 0
const years = () => { const y = schoolYear(); const s = +y.slice(0, 4); return [`${s + 1}-${s + 2}`, y, `${s - 1}-${s}`] }

// ================= Đợt đánh giá =================
type Round = { id: string; org_id: string; name: string; school_year: string; opens_on: string; due_on: string; target_level: number; note: string | null
  status: 'open' | 'closed'; reminded_at: string | null; created_at: string; organizations?: { name: string } | null }
type Prog = { org_id: string; org_name: string; teachers: number; self_done: number; manager_done: number }
const GAP_NOTE = 'Mức năng lực lấy theo đánh giá năm học (ưu tiên mức trường đánh giá, nếu chưa có thì mức tự đánh giá đã nộp). Chứng chỉ đào tạo đã cấp nâng mức lên bằng mức đích của chương trình. Nhà giáo dưới mức yêu cầu được gợi ý chương trình đào tạo đã phát hành có bồi dưỡng năng lực đó.'
const roundSt = (r: Round): [string, string] => r.status === 'closed' ? ['Đã đóng', ''] : r.due_on < today() ? ['Quá hạn', 'bad'] : r.opens_on > today() ? ['Sắp mở', ''] : ['Đang mở', 'good']

export function AssessmentRoundsPage({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Round[] | null>(null)
  const [can, setCan] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // Ô tìm; đơn vị mở, năm học, mức yêu cầu, trạng thái lọc theo cột của bảng
  const [q, setQ] = useState('')
  const [ysel, setYsel] = useGroupSel('training-rounds-year')
  const load = () => supabase.from('assessment_rounds').select('*, organizations(name)').order('created_at', { ascending: false })
    .then(({ data, error }) => { if (error) setMsg([errText(error.message), true]); setRows((data as Round[]) ?? []) })
  useEffect(() => { load(); supabase.rpc('training_can_write', { p_org: orgId }).then(({ data }) => setCan(!!data)) }, [orgId])
  const cur = rows?.find(r => r.id === open)
  if (creating) return <RoundForm orgId={orgId} onBack={() => setCreating(false)}
    onSaved={id => { setCreating(false); setMsg(['Đã mở đợt đánh giá. Theo dõi tiến độ và nhắc nhà giáo ở tab "Tiến độ".', false]); load().then(() => setOpen(id)) }} />
  if (cur) return <RoundDetail r={cur} onBack={() => setOpen(null)} onChanged={m => { setMsg([m, false]); load() }} />
  const all = rows ?? []
  const found = all.filter(r => !q || r.name.toLowerCase().includes(q.toLowerCase()))
  // Cây năm học bên trái bảng
  const ynodes = groupNodes(found, r => [r.school_year ?? ''], { desc: true, none: 'Chưa có năm học' })
  const ycur = ysel === 'all' || ynodes.some(n => ysel === 'a:' + n.key) ? ysel : 'all'
  const shown = found.filter(r => inGroup(ycur, r.school_year ?? ''))
  const openN = all.filter(r => r.status === 'open').length
  const add = () => { setMsg(null); setCreating(true) }
  return <>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {!rows ? <p className="sub">Đang tải…</p> : <DataTable id="training-rounds" rows={shown} rowKey={r => r.id}
      aside={found.length ? <GroupTree label="Năm học" nodes={ynodes} total={found.length} sel={ycur} onSel={setYsel} /> : undefined} cols={[
      { key: 'name', label: 'Đợt', fixed: true, text: r => r.name, cell: r => <button type="button" className="namelink" onClick={() => setOpen(r.id)}>{r.name}</button> },
      { key: 'org', label: 'Đơn vị mở', text: r => r.organizations?.name ?? '', cell: r => r.organizations?.name ?? '—' },
      { key: 'year', label: 'Năm học', text: r => r.school_year, cell: r => r.school_year },
      { key: 'time', label: 'Thời gian', cell: r => `${vnDate(r.opens_on)} – ${vnDate(r.due_on)}` },
      { key: 'lv', label: 'Mức yêu cầu', text: r => `Mức ${r.target_level} · ${LV_NAME[r.target_level - 1]}`, cell: r => `Mức ${r.target_level} · ${LV_NAME[r.target_level - 1]}` },
      { key: 'st', label: 'Trạng thái', text: r => roundSt(r)[0], cell: r => { const st = roundSt(r); return <Chip tone={st[1]}>{st[0]}</Chip> } },
    ] as Col<Round>[]}
      empty={<small className="sub">{all.length ? 'Không có đợt nào khớp bộ lọc.' : `Chưa có đợt đánh giá nào.${can ? ' Bấm "+ Mở đợt đánh giá" để bắt đầu.' : ''}`}</small>}
      left={<><input placeholder="Tìm tên đợt…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm đợt đánh giá" />
        <small className="sub">{shown.length}/{all.length} đợt · {openN} đang mở</small></>}
      right={can && <HeadAction><button type="button" className="primary ttadd" onClick={add}>+ Mở đợt đánh giá</button></HeadAction>} />}
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
    <label className="field"><span>Ghi chú cho nhà giáo</span><textarea rows={3} value={f.note} onChange={e => set({ ...f, note: e.target.value })} /></label>
  </>
}

/** Trang riêng để mở đợt đánh giá mới (giống "Thêm chương trình đào tạo"). */
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
  return <ElView back="Đợt đánh giá" onBack={onBack} title="Mở đợt đánh giá năng lực" sub="Đợt áp dụng cho tất cả nhà giáo trong đơn vị mở đợt và các trường trực thuộc.">
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
    setInfo(data ? `Đã gửi nhắc tới ${data} nhà giáo chưa nộp tự đánh giá.` : 'Vừa nhắc xong, hoặc tất cả nhà giáo có tài khoản đã nộp. Có thể nhắc lại sau 10 phút.')
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
    if (!confirm(`Xoá đợt "${r.name}"? Bản đánh giá nhà giáo đã làm vẫn giữ trong hồ sơ năng lực.`)) return
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
    <StatCards items={[
      { icon: 'school', value: rows ? all.length : '…', label: 'Trường' },
      { icon: 'users', value: tot.t, label: 'Nhà giáo' },
      { icon: 'edit', tone: pct(tot.s, tot.t) >= 80 ? 'good' : 'warn', value: `${pct(tot.s, tot.t)}%`, label: 'Đã tự đánh giá', sub: `${tot.s}/${tot.t} GV` },
      { icon: 'checkCircle', tone: pct(tot.m, tot.t) >= 80 ? 'good' : 'warn', value: `${pct(tot.m, tot.t)}%`, label: 'Trường đã đánh giá', sub: `${tot.m}/${tot.t} GV` },
    ]} />
    <section className="panel" style={{ marginTop: 14 }}>
      {!rows ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
        <thead><tr><th>Trường</th><th>Số GV</th><th>Tự đánh giá</th><th>Trường đánh giá</th></tr></thead>
        <tbody>{all.map(x => <tr key={x.org_id}><td>{x.org_name}</td><td>{x.teachers}</td>
          <td><Bar v={pct(x.self_done, x.teachers)} /> {x.self_done}/{x.teachers}</td><td><Bar v={pct(x.manager_done, x.teachers)} /> {x.manager_done}/{x.teachers}</td></tr>)}
          {!all.length && <tr><td colSpan={4}><small className="sub">Chưa có nhà giáo trong phạm vi đợt.</small></td></tr>}</tbody>
      </table></div>}
    </section></>}
  </ElView>
}
export const Bar = ({ v, warnBelow = 50 }: { v: number; warnBelow?: number }) =>
  <span className="minibar" title={`${v}%`}><i style={{ width: `${Math.min(100, v)}%` }} className={v < warnBelow ? 'warn' : ''} /></span>

// ================= Khoảng thiếu hụt → gợi ý chương trình đào tạo =================
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
  const [view, setView] = useState<'teacher' | 'school'>('school')
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

  // Lọc Tỉnh / Sở, trường (chọn nhiều); ô tìm chỉ tìm tên nhà giáo
  const mf = useMultiFilters()
  const of = useOrgFilters(rows ?? [], mf)
  const all = (rows ?? []).filter(g => of.fit(g.org_id))
  const [card, setCard] = useState<string | null>(null)
  // Thẻ tổng số tính theo ô tìm và bộ lọc đơn vị; bấm thẻ "Chưa có chương trình phù hợp" để lọc
  const base = all.filter(g => !q || g.teacher_name.toLowerCase().includes(q.toLowerCase()))
  const shown = base.filter(g => (!comp || g.competency === comp) && (card !== 'nosuggest' || !g.suggest.length))
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
  const perComp = comps.map(c => [c, base.filter(g => g.competency === c.key).length] as [Comp, number])
  const top = [...perComp].sort((a, b) => b[1] - a[1])[0]
  const cardBase = base.filter(g => !comp || g.competency === comp)
  const teachersN = new Set(cardBase.map(g => g.teacher_id)).size
  const noSuggest = cardBase.filter(g => !g.suggest.length).length
  const gapActive = card ?? (comp && top && top[1] && comp === top[0].key ? 'top' : null)

  async function enroll(planId: string, teacherId: string, name: string) {
    const { error } = await supabase.from('training_enrollments').insert({ org_id: orgId, plan_id: planId, teacher_id: teacherId })
    if (error) return setMsg([errText(error.message), true])
    setMsg([`Đã ghi danh ${name} vào kế hoạch. Nhớ gửi danh sách duyệt ở mục Kế hoạch đào tạo.`, false]); loadPlans()
  }
  function excel() {
    downloadXlsx(`khoang-thieu-hut-${year}`, [{ key: 't', label: 'Nhà giáo', width: 26 }, { key: 'o', label: 'Trường', width: 28 }, { key: 'c', label: 'Năng lực', width: 30 },
      { key: 'l', label: 'Mức hiện tại' }, { key: 's', label: 'Chương trình gợi ý', width: 50 }],
      shown.map(g => [g.teacher_name, g.org_name, g.competency_name, g.level, g.suggest.map(s => `${s.code ?? ''} ${s.title}`.trim()).join('; ')]), 'Thiếu hụt')
  }
  return <>
    <StatCards active={gapActive} onPick={k => {
      // "Thiếu nhiều nhất" chọn năng lực đó; "Chưa có chương trình" lọc riêng; bấm lại để bỏ
      if (k === 'top') { setCard(null); if (top) setComp(top[0].key) }
      else if (k) setCard(k)
      else if (gapActive === 'top') setComp('')
      else setCard(null)
    }} items={[
      { icon: 'users', tone: teachersN ? 'warn' : 'good', value: rows ? teachersN : '…', label: 'GV có thiếu hụt' },
      { icon: 'gap', value: cardBase.length, label: 'Lượt thiếu hụt' },
      { k: top && top[1] ? 'top' : undefined, icon: 'chart', value: top && top[1] ? top[0].name : '—', label: `Thiếu nhiều nhất${top && top[1] ? ` · ${top[1]} GV` : ''}` },
      { k: 'nosuggest', icon: 'help', tone: noSuggest ? 'warn' : '', value: noSuggest, label: 'Chưa có chương trình phù hợp' },
    ]} />
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {(() => {
      // Cây năng lực bên trái (thay hàng nút năng lực); chuyển Tổng hợp theo trường / Theo nhà giáo như Bảng / Lịch
      const tree = <GroupTree label="Năng lực" total={base.length} sel={comp ? 'a:' + comp : 'all'} onSel={k => setComp(k === 'all' ? '' : k.slice(2))}
        nodes={perComp.map(([c, n]) => ({ key: c.key, label: c.name, count: n }))} />
      const left = <>
        <select value={year} onChange={e => setYear(e.target.value)} aria-label="Năm học">{years().map(y => <option key={y} value={y}>Năm học {y}</option>)}</select>
        <select value={target} onChange={e => setTarget(+e.target.value)} aria-label="Mức yêu cầu">{[2, 3, 4].map(l => <option key={l} value={l}>Yêu cầu từ Mức {l} ({LV_NAME[l - 1]})</option>)}</select>
        <MultiFilters defs={of.defs} f={mf} />
        <input placeholder="Tìm tên nhà giáo…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm nhà giáo" />
        <span className="infotip" tabIndex={0} title={GAP_NOTE} aria-label={GAP_NOTE}>ⓘ Cách tính</span></>
      const right = <>
        <div className="segmented viewtoggle" role="group" aria-label="Xem theo">{([['school', 'Theo trường'], ['teacher', 'Theo nhà giáo']] as const).map(([k, l]) =>
          <button key={k} type="button" className={view === k ? 'on' : ''} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}</div>
        <button type="button" onClick={excel} disabled={!shown.length}>Xuất Excel</button></>
      if (!rows) return <p className="sub">Đang tải…</p>
      type BS = (typeof bySchool)[number]
      type BT = (typeof byTeacher)[number]
      if (view === 'school') return <DataTable id="comp-gaps-school" rows={bySchool} rowKey={s => s.name} aside={tree} left={left} right={right}
        empty={<small className="sub">Không có thiếu hụt.</small>} cols={[
          { key: 'name', label: 'Trường', fixed: true, text: s => s.name, cell: s => s.name },
          { key: 'n', label: 'GV có thiếu hụt', cell: s => <b>{s.teachers.size}</b> },
          ...comps.map(c => ({ key: 'c_' + c.key, label: c.name, cell: (s: BS) => s.per[c.key] ?? <small className="sub">0</small> })),
        ] as Col<BS>[]} />
      return <>
        <DataTable id="comp-gaps-teacher" rows={byTeacher.slice(0, 300)} rowKey={gs => gs[0].teacher_id} aside={tree} left={left} right={right}
          empty={<small className="sub">{all.length ? 'Không có nhà giáo nào khớp.' : 'Không có nhà giáo dưới mức yêu cầu (trong số nhà giáo đã có kết quả đánh giá năm học này).'}</small>} cols={[
            { key: 'name', label: 'Nhà giáo', fixed: true, text: gs => `${gs[0].teacher_name} ${gs[0].org_name ?? ''}`, cell: gs => <><b>{gs[0].teacher_name}</b><br /><small className="sub">{gs[0].org_name ?? '—'}</small></> },
            { key: 'gap', label: 'Năng lực dưới mức yêu cầu', text: gs => gs.map(g => g.competency_name).join(', '),
              cell: gs => gs.map(g => <div key={g.competency} className="gaprow">{g.competency_name} <LevelChip v={g.level} comp={comps.find(c => c.key === g.competency)} /></div>) },
            { key: 'sug', label: 'Chương trình đào tạo gợi ý', cell: gs => { const g0 = gs[0]
              const sug = [...new Map(gs.flatMap(g => g.suggest).map(s => [s.id, s])).values()]
              return sug.length ? sug.map(s => {
                const ps = plans.filter(p => p.org_id === g0.org_id && p.training_plans.training_plan_items.some(i => i.program_id === s.id))
                return <div key={s.id} className="gaprow"><span>{s.code && <small className="sub">{s.code} · </small>}{s.title} <small className="sub">(mức đích {s.target_level})</small></span>
                  {ps.map(p => enrolled.has(p.plan_id + '|' + g0.teacher_id)
                    ? <Chip key={p.plan_id} tone="good">Đã ghi danh {p.training_plans.plan_code}</Chip>
                    : <button key={p.plan_id} type="button" className="linkbtn" onClick={() => enroll(p.plan_id, g0.teacher_id, g0.teacher_name)}>+ Ghi danh vào {p.training_plans.plan_code ?? p.training_plans.name}</button>)}
                </div> }) : <small className="sub">Chưa có chương trình đã phát hành bồi dưỡng năng lực này.</small> } },
          ] as Col<BT>[]} />
        {plans.length === 0 && byTeacher.length > 0 && <small className="sub">Nút ghi danh hiện khi trường có kế hoạch được giao đang chọn nhà giáo và kế hoạch đó có chương trình được gợi ý.</small>}
      </>
    })()}
  </>
}

// ================= Khung năng lực (KDI): nhà giáo và học sinh =================
// audience cố định: phân hệ 2 (Đào tạo nhà giáo) chỉ khung nhà giáo, phân hệ 1 (Chương trình & học liệu) chỉ khung học sinh
export function CompetencyFrameworkPage({ audience }: { audience?: 'teacher' | 'student' }) {
  const [aud, setAud] = useState<'teacher' | 'student'>('teacher')
  if (audience) return <CompetencyFramework audience={audience} />
  return <>
    <Tabs value={aud} onChange={setAud} items={[['teacher', 'Năng lực nhà giáo'], ['student', 'Năng lực học sinh']]} />
    <CompetencyFramework key={aud} audience={aud} />
  </>
}

const AUD = {
  teacher: { title: 'Năng lực nhà giáo', grp: 'Nhà giáo STEM', prefix: 'gv_', example: 'gv_hop_tac', levels: LV_NAME,
    intro: 'Khung năng lực nhà giáo dùng chung cho tất cả đơn vị: tự đánh giá, trường đánh giá, khoảng thiếu hụt và năng lực đích của chương trình đào tạo đều theo khung này.' },
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
  const [card, setCard] = useState<string | null>(null)
  const [view, setView] = useState<Comp | null>(null)
  const [usage, setUsage] = useState<{ source: string; n: number }[] | null>(null)
  useEffect(() => {
    setUsage(null); if (!view) return
    supabase.rpc('competency_usage', { p_key: view.key }).then(({ data, error }) => { if (error) setMsg([m133(error.message), true]); else setUsage((data as { source: string; n: number }[]) ?? []) })
  }, [view?.key])
  async function del() {
    if (!view || !confirm(`Xoá năng lực "${view.name}"? Không hoàn tác được.`)) return
    const { error } = await supabase.rpc('competency_delete', { p_key: view.key })
    if (error) return setMsg([m133(error.message), true])
    setMsg([`Đã xoá năng lực "${view.name}".`, false]); setView(null); resetCompetencies()
  }
  const openEdit = (c: Comp) => { setIsNew(false); setMsg(null); setEdit({ ...c, levels: [...c.levels] }) }
  const lack = (c: Comp) => c.levels.some(l => !l?.trim())
  const list = card === 'lack' ? comps.filter(lack) : comps
  const groups = [...new Set(comps.map(c => c.grp))]
  async function save() {
    if (!edit) return
    if (!edit.key.match(/^[a-z][a-z_]{1,40}$/)) return setMsg([`Mã chỉ gồm chữ thường không dấu và dấu gạch dưới (VD: ${A.example}).`, true])
    if (!edit.name.trim() || edit.levels.some(l => !l.trim())) return setMsg(['Nhập tên và mô tả đủ 4 mức.', true])
    const row = { key: edit.key, audience, grp: edit.grp.trim() || A.grp, name: edit.name.trim(), description: edit.description?.trim() || null, levels: edit.levels.map(l => l.trim()), sort: edit.sort }
    const { error } = isNew ? await supabase.from('competencies').insert(row) : await supabase.from('competencies').update(row).eq('key', edit.key)
    if (error) return setMsg([/duplicate|unique/i.test(error.message) ? 'Mã năng lực đã có.' : errText(error.message), true])
    setMsg([isNew ? 'Đã thêm năng lực.' : 'Đã lưu năng lực.', false]); if (!isNew) setView({ ...edit, ...row }); setEdit(null); resetCompetencies()
  }
  function add() {
    setIsNew(true); setMsg(null)
    setEdit({ key: A.prefix, audience, grp: comps[comps.length - 1]?.grp ?? A.grp, name: '', description: '', levels: ['', '', '', ''], sort: (comps[comps.length - 1]?.sort ?? 100) + 10 })
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
        <label className="field"><span>Thứ tự hiển thị <small className="sub">(số nhỏ hiện trước)</small></span><input type="number" value={edit.sort} onChange={e => setEdit({ ...edit, sort: +e.target.value })} title="Vị trí của năng lực trong danh sách và phiếu đánh giá: số nhỏ đứng trước. Mặc định đứng cuối nhóm." /></label>
      </div>
      <label className="field"><span>Mô tả</span><textarea rows={2} value={edit.description ?? ''} onChange={e => setEdit({ ...edit, description: e.target.value })} /></label>
      <div className="formgrid">{edit.levels.map((l, i) => <label key={i} className="field"><span>{lvLabel(i)}</span>
        <textarea rows={3} value={l} onChange={e => setEdit({ ...edit, levels: edit.levels.map((x, k) => k === i ? e.target.value : x) })} /></label>)}</div>
      <div className="formactions"><button type="button" onClick={() => { setEdit(null); setMsg(null) }}>Huỷ</button> <button type="button" className="primary" onClick={save}>{isNew ? 'Thêm năng lực' : 'Lưu'}</button></div>
    </section>
  </ElView>
  if (view) {
    const used = (usage ?? []).length > 0
    return <ElView back={A.title} onBack={() => { setView(null); setMsg(null) }} title={view.name} sub={<>{view.key} · {view.grp}</>}
      actions={<><button type="button" onClick={() => openEdit(view)}>Sửa</button>
        <button type="button" className="danger" disabled={usage === null || used} title={used ? 'Năng lực đang được dùng nên không xoá được' : undefined} onClick={del}>Xoá</button></>}>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      <section className="panel" style={{ display: 'grid', gap: 12 }}>
        {view.description && <p style={{ margin: 0 }}>{view.description}</p>}
        <div className="wrap"><table className="libtable">
          <thead><tr><th style={{ width: 200 }}>Mức</th><th>Mô tả</th></tr></thead>
          <tbody>{view.levels.map((l, i) => <tr key={i}><td><b>{lvLabel(i)}</b></td><td>{l || <small className="sub">Chưa mô tả</small>}</td></tr>)}</tbody>
        </table></div>
        <small className="sub">Mã <b>{view.key}</b> · Nhóm <b>{view.grp}</b> · Thứ tự hiển thị <b>{view.sort}</b></small>
        <div><b>Nơi đang dùng</b>{usage === null ? <small className="sub"> · đang kiểm tra…</small>
          : used ? <ul style={{ margin: '6px 0 0' }}>{usage.map(u => <li key={u.source}>{u.source}: {u.n}</li>)}</ul>
          : <small className="sub"> · chưa dùng ở đâu, xoá được.</small>}
          {used && <small className="sub">Năng lực đã được dùng nên không xoá được, vì kết quả cũ lưu theo mã năng lực. Anh/chị vẫn sửa được tên và mô tả.</small>}</div>
      </section>
    </ElView>
  }
  return <>
    {!compact && (() => {
      const filled = comps.reduce((n, c) => n + c.levels.filter(l => l?.trim()).length, 0), nLack = comps.filter(lack).length
      return <StatCards active={card} onPick={setCard} items={[
        { icon: 'target', value: comps.length, label: 'Năng lực', sub: `${groups.length} nhóm` },
        { icon: 'layers', value: A.levels.length, label: 'Mức', sub: A.levels.join(' · ') },
        { k: 'lack', icon: 'clipboard', tone: nLack ? 'warn' : 'good', value: filled, label: 'Tiêu chí', sub: nLack ? `Mô tả mức · ${nLack} năng lực còn thiếu` : 'Mô tả mức · đủ cho tất cả năng lực' },
      ]} />
    })()}
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {names && <LevelNames keys={[audience === 'teacher' ? 'comp_level_teacher' : 'comp_level_student']} />}
    <DataTable id={'comp-framework-' + audience} rows={list} rowKey={c => c.key} cols={[
      { key: 'name', label: 'Năng lực', fixed: true, text: c => `${c.name} ${c.key}`, cell: c => <><button type="button" className="namelink" onClick={() => { setMsg(null); setView(c) }}>{c.name}</button>
        <br /><small className="sub">{c.key}</small>{c.description && <><br /><small>{c.description}</small></>}</> },
      { key: 'grp', label: 'Nhóm', text: c => c.grp, cell: c => <small>{c.grp}</small> },
      ...A.levels.map((_, i) => ({ key: 'lv' + i, label: lvLabel(i), text: (c: Comp) => c.levels[i] ?? '', cell: (c: Comp) => <small>{c.levels[i]}</small> })),
    ] as Col<Comp>[]}
      empty={<small className="sub">{comps.length ? 'Không có năng lực nào khớp.' : 'Chưa có năng lực nào.'}</small>}
      left={<small className="sub">{list.length} năng lực</small>}
      right={<><button type="button" onClick={() => setNames(!names)}>{names ? 'Đóng tên các mức' : 'Đổi tên các mức'}</button>
        <HeadAction><button type="button" className="primary ttadd" onClick={add}>+ Thêm năng lực</button></HeadAction></>} />
    {!compact && <div className="tablenote"><p style={{ margin: 0 }}>{A.intro} Sửa mô tả mức có hiệu lực ngay; mã năng lực không đổi được vì kết quả đã lưu theo mã.</p></div>}
  </>
}
