// Phân hệ 1 — Đánh giá năng lực nhà giáo (088): đợt đánh giá, khoảng thiếu hụt → gợi ý tập huấn, khung năng lực (KDI).
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx } from '../../lib/sheet'
import { ElView } from '../../components/ElView'
import { Chip } from '../dist/Editor'
import { schoolYear } from '../department/Governance'
import { LevelChip, useCompetencies, resetCompetencies, type Comp } from '../competency'

const errText = (m: string) => /schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 088 trên Supabase.' : /row-level|42501/i.test(m) ? 'Bạn không có quyền với mục này.' : m
const vnDate = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : '—'
const today = () => new Date().toISOString().slice(0, 10)
const LV_NAME = ['Chưa đạt', 'Đạt', 'Khá', 'Tốt']
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
  const [form, setForm] = useState<Partial<Round> | null>(null)
  const load = () => supabase.from('assessment_rounds').select('*, organizations(name)').order('created_at', { ascending: false })
    .then(({ data, error }) => { if (error) setMsg([errText(error.message), true]); setRows((data as Round[]) ?? []) })
  useEffect(() => { load(); supabase.rpc('training_can_write', { p_org: orgId }).then(({ data }) => setCan(!!data)) }, [orgId])
  const cur = rows?.find(r => r.id === open)
  if (cur) return <RoundDetail r={cur} onBack={() => setOpen(null)} onChanged={m => { setMsg([m, false]); load() }} />

  async function save() {
    if (!form) return
    if (!form.name?.trim() || !form.due_on) return setMsg(['Nhập tên đợt và hạn nộp.', true])
    if (form.due_on < (form.opens_on ?? today())) return setMsg(['Hạn nộp phải sau ngày mở.', true])
    const { error } = await supabase.from('assessment_rounds').insert({ org_id: orgId, name: form.name.trim(), school_year: form.school_year, opens_on: form.opens_on,
      due_on: form.due_on, target_level: form.target_level, note: form.note?.trim() || null })
    if (error) return setMsg([errText(error.message), true])
    setForm(null); setMsg(['Đã mở đợt đánh giá. Bấm vào đợt để theo dõi tiến độ và nhắc giáo viên.', false]); load()
  }
  const all = rows ?? []
  const openN = all.filter(r => r.status === 'open').length
  return <>
    <div className="panel distintro">
      <ol className="distguide">
        <li><button type="button" onClick={() => can && setForm(f => f ?? { school_year: schoolYear(), opens_on: today(), target_level: 2 })}><i>1</i><span><b>Mở đợt đánh giá</b><small>Đặt năm học, hạn nộp và mức yêu cầu. Đợt áp dụng cho mọi giáo viên trong đơn vị và các trường trực thuộc.</small></span></button></li>
        <li><button type="button" onClick={() => all[0] && setOpen(all[0].id)}><i>2</i><span><b>Theo dõi & nhắc</b><small>Xem từng trường đã tự đánh giá / được trường đánh giá bao nhiêu, gửi nhắc giáo viên chưa nộp.</small></span></button></li>
        <li><button type="button" disabled><i>3</i><span><b>Xem thiếu hụt</b><small>Kết quả vào hồ sơ năng lực; mục Khoảng thiếu hụt gợi ý chương trình tập huấn cho người dưới mức yêu cầu.</small></span></button></li>
      </ol>
    </div>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    <section className="panel" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
      <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Đợt đánh giá năng lực <small className="sub">· {openN} đang mở</small></h3>
        {can && !form && <button type="button" className="primary" onClick={() => setForm({ school_year: schoolYear(), opens_on: today(), target_level: 2 })}>Mở đợt mới</button>}</div>
      {form && <div className="panel" style={{ display: 'grid', gap: 10, background: 'var(--soft)' }}>
        <div className="formgrid">
          <label className="field"><span>Tên đợt</span><input value={form.name ?? ''} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={`Đánh giá năng lực GV năm học ${form.school_year}`} /></label>
          <label className="field"><span>Năm học</span><select value={form.school_year} onChange={e => setForm({ ...form, school_year: e.target.value })}>{years().map(y => <option key={y}>{y}</option>)}</select></label>
          <label className="field"><span>Ngày mở</span><input type="date" value={form.opens_on ?? ''} onChange={e => setForm({ ...form, opens_on: e.target.value })} /></label>
          <label className="field"><span>Hạn nộp</span><input type="date" value={form.due_on ?? ''} onChange={e => setForm({ ...form, due_on: e.target.value })} /></label>
          <label className="field"><span>Mức yêu cầu</span><select value={form.target_level} onChange={e => setForm({ ...form, target_level: +e.target.value })}>
            {[1, 2, 3, 4].map(l => <option key={l} value={l}>Mức {l} · {LV_NAME[l - 1]}</option>)}</select></label>
        </div>
        <label className="field"><span>Ghi chú cho giáo viên</span><textarea rows={2} value={form.note ?? ''} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
        <div className="formactions"><button type="button" onClick={() => setForm(null)}>Huỷ</button> <button type="button" className="primary" onClick={save}>Mở đợt</button></div>
      </div>}
      {!rows ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
        <thead><tr><th>Đợt</th><th>Đơn vị mở</th><th>Năm học</th><th>Thời gian</th><th>Mức yêu cầu</th><th>Trạng thái</th></tr></thead>
        <tbody>{all.map(r => { const st = roundSt(r); return <tr key={r.id}>
          <td><button type="button" className="namelink" onClick={() => setOpen(r.id)}>{r.name}</button></td>
          <td>{r.organizations?.name ?? '—'}</td><td>{r.school_year}</td><td>{vnDate(r.opens_on)} – {vnDate(r.due_on)}</td>
          <td>Mức {r.target_level} · {LV_NAME[r.target_level - 1]}</td><td><Chip tone={st[1]}>{st[0]}</Chip></td></tr> })}
          {!all.length && <tr><td colSpan={6}><small className="sub">Chưa có đợt đánh giá nào.{can ? ' Bấm "Mở đợt mới" để bắt đầu.' : ''}</small></td></tr>}</tbody>
      </table></div>}
    </section>
  </>
}

function RoundDetail({ r, onBack, onChanged }: { r: Round; onBack: () => void; onChanged: (m: string) => void }) {
  const [rows, setRows] = useState<Prog[] | null>(null)
  const [can, setCan] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
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
    onChanged(status === 'closed' ? 'Đã đóng đợt đánh giá.' : 'Đã mở lại đợt đánh giá.'); onBack()
  }
  function excel() {
    downloadXlsx(`dot-danh-gia-${r.school_year}`, [{ key: 'o', label: 'Trường', width: 30 }, { key: 't', label: 'Số GV' }, { key: 's', label: 'Đã tự đánh giá' }, { key: 'sp', label: '% tự ĐG' },
      { key: 'm', label: 'Trường đã đánh giá' }, { key: 'mp', label: '% trường ĐG' }],
      all.map(x => [x.org_name, x.teachers, x.self_done, pct(x.self_done, x.teachers), x.manager_done, pct(x.manager_done, x.teachers)]), 'Tiến độ')
  }
  const st = roundSt(r)
  return <ElView back="Đợt đánh giá" onBack={onBack} title={r.name}
    sub={<>{r.organizations?.name} · năm học {r.school_year} · {vnDate(r.opens_on)} – {vnDate(r.due_on)} · mức yêu cầu {r.target_level} · <Chip tone={st[1]}>{st[0]}</Chip></>}
    actions={<>
      <button type="button" onClick={excel} disabled={!all.length}>Xuất Excel</button>
      {can && r.status === 'open' && <button type="button" disabled={busy} onClick={remind}>Nhắc GV chưa nộp</button>}
      {can && <button type="button" onClick={() => setStatus(r.status === 'open' ? 'closed' : 'open')}>{r.status === 'open' ? 'Đóng đợt' : 'Mở lại'}</button>}</>}>
    {err && <p className="msg" role="alert">{err}</p>}
    {info && <p className="sub" role="status"><b>{info}</b></p>}
    {r.note && <p className="sub">{r.note}</p>}
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
    </section>
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

  const all = rows ?? []
  const shown = all.filter(g => (!comp || g.competency === comp) && (!q || (g.teacher_name + ' ' + (g.org_name ?? '')).toLowerCase().includes(q.toLowerCase())))
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
        <input placeholder="Tìm giáo viên, trường…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm giáo viên" />
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

// ================= Khung năng lực (KDI) =================
export function CompetencyFrameworkPage() {
  const comps = useCompetencies('teacher')
  const [list, setList] = useState<Comp[]>([])
  const [edit, setEdit] = useState<Comp | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  useEffect(() => { setList(comps) }, [comps.length])
  async function reload() {
    resetCompetencies()
    const { data } = await supabase.from('competencies').select('*').eq('audience', 'teacher').order('sort')
    setList((data as Comp[]) ?? [])
  }
  async function save() {
    if (!edit) return
    if (!edit.key.match(/^[a-z][a-z0-9_]{1,40}$/)) return setMsg(['Mã chỉ gồm chữ thường không dấu, số và dấu gạch dưới (VD: gv_hop_tac).', true])
    if (!edit.name.trim() || edit.levels.some(l => !l.trim())) return setMsg(['Nhập tên và mô tả đủ 4 mức.', true])
    const row = { key: edit.key, audience: 'teacher', grp: edit.grp || 'Năng lực giáo viên STEM', name: edit.name.trim(), description: edit.description?.trim() || null, levels: edit.levels.map(l => l.trim()), sort: edit.sort }
    const { error } = isNew ? await supabase.from('competencies').insert(row) : await supabase.from('competencies').update(row).eq('key', edit.key)
    if (error) return setMsg([/duplicate|unique/i.test(error.message) ? 'Mã năng lực đã có.' : errText(error.message), true])
    setMsg([isNew ? 'Đã thêm năng lực.' : 'Đã lưu năng lực.', false]); setEdit(null); reload()
  }
  function add() {
    setIsNew(true); setMsg(null)
    setEdit({ key: 'gv_', audience: 'teacher', grp: list[0]?.grp ?? 'Năng lực giáo viên STEM', name: '', description: '', levels: ['', '', '', ''], sort: (list[list.length - 1]?.sort ?? 100) + 10 })
  }
  return <>
    <div className="panel distintro"><p style={{ margin: 0 }}>Khung năng lực giáo viên STEM dùng chung cho mọi đơn vị: tự đánh giá, trường đánh giá, khoảng thiếu hụt và năng lực đích của chương trình tập huấn đều theo khung này.
      Sửa mô tả mức có hiệu lực ngay; mã năng lực không đổi được vì kết quả đánh giá đã lưu theo mã.</p></div>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {edit && <section className="panel" style={{ display: 'grid', gap: 10, marginTop: 14 }}>
      <h3 style={{ margin: 0 }}>{isNew ? 'Thêm năng lực' : edit.name}</h3>
      <div className="formgrid">
        <label className="field"><span>Mã</span><input value={edit.key} disabled={!isNew} onChange={e => setEdit({ ...edit, key: e.target.value })} /></label>
        <label className="field"><span>Tên năng lực</span><input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label>
        <label className="field"><span>Thứ tự</span><input type="number" value={edit.sort} onChange={e => setEdit({ ...edit, sort: +e.target.value })} /></label>
      </div>
      <label className="field"><span>Mô tả</span><textarea rows={2} value={edit.description ?? ''} onChange={e => setEdit({ ...edit, description: e.target.value })} /></label>
      <div className="formgrid">{edit.levels.map((l, i) => <label key={i} className="field"><span>Mức {i + 1} · {LV_NAME[i]}</span>
        <textarea rows={3} value={l} onChange={e => setEdit({ ...edit, levels: edit.levels.map((x, k) => k === i ? e.target.value : x) })} /></label>)}</div>
      <div className="formactions"><button type="button" onClick={() => setEdit(null)}>Huỷ</button> <button type="button" className="primary" onClick={save}>Lưu</button></div>
    </section>}
    <section className="panel" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
      <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Năng lực giáo viên ({list.length})</h3>{!edit && <button type="button" className="primary" onClick={add}>Thêm năng lực</button>}</div>
      <div className="wrap"><table className="libtable">
        <thead><tr><th>Năng lực</th>{LV_NAME.map((l, i) => <th key={l}>Mức {i + 1} · {l}</th>)}<th /></tr></thead>
        <tbody>{list.map(c => <tr key={c.key}><td><b>{c.name}</b><br /><small className="sub">{c.key}</small>{c.description && <><br /><small>{c.description}</small></>}</td>
          {c.levels.map((l, i) => <td key={i}><small>{l}</small></td>)}
          <td><button type="button" onClick={() => { setIsNew(false); setMsg(null); setEdit({ ...c, levels: [...c.levels] }) }}>Sửa</button></td></tr>)}
          {!list.length && <tr><td colSpan={6}><small className="sub">Đang tải…</small></td></tr>}</tbody>
      </table></div>
    </section>
  </>
}
