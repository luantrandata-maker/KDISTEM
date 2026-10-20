import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadXlsx, importSummary, norm, type Column } from '../lib/sheet'
import ImportExcel from '../components/ImportExcel'
import { Tiles } from './department/charts'
import { useStemTracks } from '../lib/stemTracks'

// Chương trình giáo dục chuẩn (migration 058): danh mục + phiên bản, cấu trúc chủ đề → bài → buổi, yêu cầu cần đạt,
// gửi duyệt / ban hành / thay thế / lưu trữ, gán cho trường và theo dõi độ phủ; trường tạo PPCT từ chương trình.
export type ProgMode = 'school' | 'authority' | 'platform'
type Status = 'draft' | 'pending' | 'approved' | 'rejected' | 'published' | 'superseded' | 'archived'
type Kind = 'subject' | 'stem' | 'school'
type Level = 'tieuhoc' | 'thcs' | 'thpt'
type Program = {
  id: string; org_id: string; family_id: string; version_no: number; code: string | null; title: string; kind: Kind; ct_code: string | null
  level: Level; grade_from: number; grade_to: number; main_subject: string; integrated_subjects: string[]; objectives: string | null
  competency_keys: string[]; rubric_ids: string[]; total_periods: number; status: Status; scope: 'own' | 'children'
  effective_from: string | null; effective_to: string | null; replaced_by: string | null; source_id: string | null
  published_at: string | null; note: string | null; updated_at: string; organizations?: { name: string } | null
}
type UnitType = 'topic' | 'lesson' | 'session'
type Unit = {
  id: string; program_id: string; parent_id: string | null; unit_type: UnitType; seq: number; grade: number | null; subject: string | null
  title: string; periods: number; objectives: string | null; content: string | null
}
type Outcome = { id: string; program_id: string; unit_id: string | null; seq: number; code: string | null; content: string; competency_key: string | null }
type Comp = { key: string; name: string; grp: string }
type Rubric = { id: string; title: string }
type Org = { id: string; name: string; type: string; parent_id: string | null }
type LogRow = { id: number; from_status: string | null; to_status: string; note: string | null; at: string }
type Assign = { id: string; program_id: string; org_id: string; grades: number[] | null; note: string | null; created_at: string; assigner_org: string | null }
type Cover = {
  org_id: string; school: string; area: string | null; assigned: boolean; grades: number[] | null; books: number; classes: number
  lessons: number; done: number; missed: number; outcomes: number; outcomes_done: number
}

export const LEVEL: Record<Level, string> = { tieuhoc: 'Tiểu học', thcs: 'THCS', thpt: 'THPT' }
const LEVEL_GRADES: Record<Level, [number, number]> = { tieuhoc: [1, 5], thcs: [6, 9], thpt: [10, 12] }
export const PKIND: Record<Kind, string> = { subject: 'Môn học', stem: 'Chương trình STEM', school: 'Chương trình nhà trường' }
export const PSTATUS: Record<Status, [string, string]> = {
  draft: ['Nháp', ''], pending: ['Chờ duyệt', 'warn'], approved: ['Đã duyệt', 'good'], rejected: ['Bị trả lại', 'bad'],
  published: ['Đang ban hành', 'good'], superseded: ['Đã thay thế', ''], archived: ['Lưu trữ', ''],
}
const UTYPE: Record<UnitType, string> = { topic: 'Chủ đề', lesson: 'Bài học', session: 'Buổi học' }
const CHILD: Record<UnitType, UnitType | null> = { topic: 'lesson', lesson: 'session', session: null }
const CT = ['CT1', 'CT2', 'CT3', 'CT4', 'CT5']
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 058 trên Supabase.'
  : /row-level|42501/i.test(m) ? 'Bạn không có quyền thực hiện thao tác này.' : m)
const fmtD = (d: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN') : '—')
const grades = (p: Pick<Program, 'grade_from' | 'grade_to'>) => (p.grade_from === p.grade_to ? `Khối ${p.grade_from}` : `Khối ${p.grade_from}–${p.grade_to}`)
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i)

function StatusPill({ s }: { s: Status }) {
  const [label, tone] = PSTATUS[s]
  return tone ? <span className={'gpill ' + tone}>{label}</span> : <span className="pill">{label}</span>
}

function useCanEdit(mode: ProgMode) {
  const [ok, setOk] = useState(mode !== 'school')
  const [admin, setAdmin] = useState(mode !== 'school')
  useEffect(() => {
    if (mode !== 'school') return
    supabase.rpc('has_perm', { p_module: 'curriculum', p_action: 'edit' }).then(({ data }) => setOk(!!data))
    supabase.rpc('is_admin').then(({ data }) => setAdmin(!!data))
  }, [mode])
  return { canEdit: ok, isAdmin: admin }
}

// ================= Danh sách chương trình =================
export function EduPrograms({ orgId, mode = 'school' }: { orgId: string | null; mode?: ProgMode }) {
  const { canEdit, isAdmin } = useCanEdit(mode)
  const { byCode: tracks } = useStemTracks()
  const [list, setList] = useState<Program[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [level, setLevel] = useState('')
  const [kind, setKind] = useState('')
  const [subject, setSubject] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [old, setOld] = useState(false)
  const [form, setForm] = useState<Partial<Program> | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)

  async function load() {
    const { data, error } = await supabase.from('edu_programs').select('*, organizations(name)').order('title').order('version_no', { ascending: false })
    if (error) setMsg([errText(error.message), true])
    setList((data as Program[]) ?? [])
  }
  useEffect(() => { load() }, [orgId])

  const all = list ?? []
  const subjects = useMemo(() => [...new Set(all.map(p => p.main_subject))].sort((a, b) => a.localeCompare(b, 'vi')), [list])
  const shown = all.filter(p => (old || !['superseded', 'archived'].includes(p.status) || status === p.status)
    && (!level || p.level === level) && (!kind || p.kind === kind) && (!subject || p.main_subject === subject || p.integrated_subjects.includes(subject))
    && (!status || p.status === status) && (!q || norm([p.title, p.code, p.main_subject, ...p.integrated_subjects].join(' ')).includes(norm(q))))
  const own = shown.filter(p => p.org_id === orgId)
  const shared = shown.filter(p => p.org_id !== orgId)

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!form || !orgId) return
    const lv = (form.level ?? 'thcs') as Level
    const row = {
      org_id: orgId, title: (form.title ?? '').trim(), code: form.code?.trim() || null, kind: form.kind ?? 'subject',
      ct_code: form.kind === 'stem' ? form.ct_code || null : null, level: lv,
      grade_from: Number(form.grade_from) || LEVEL_GRADES[lv][0], grade_to: Number(form.grade_to) || LEVEL_GRADES[lv][1],
      main_subject: (form.main_subject ?? '').trim(), scope: mode === 'school' ? 'own' : form.scope ?? 'children',
    }
    if (!row.title || !row.main_subject) return setMsg(['Nhập tên chương trình và môn chủ đạo.', true])
    const { data, error } = await supabase.from('edu_programs').insert(row).select('id').single()
    if (error) return setMsg([errText(error.message), true])
    setForm(null); setMsg(null); await load(); setOpenId((data as { id: string }).id)
  }
  async function copy(p: Program) {
    if (!confirm(`Sao chép "${p.title}" (phiên bản ${p.version_no}) về đơn vị thành bản nháp để điều chỉnh?`)) return
    const { data, error } = await supabase.rpc('edu_program_copy', { p_program: p.id })
    if (error) return setMsg([errText(error.message), true])
    await load(); setOpenId(data as string)
  }

  if (openId) return <ProgramDetail id={openId} orgId={orgId} mode={mode} canEdit={canEdit} isAdmin={isAdmin}
    onOpen={setOpenId} onClose={() => { setOpenId(null); load() }} />

  const row = (p: Program, mine: boolean) => (
    <tr key={p.id}>
      <td>{p.code && <small className="sub">{p.code}<br /></small>}<b>{p.title}</b> <small>v{p.version_no}</small>
        {!mine && <><br /><small className="sub">{p.organizations?.name ?? '—'}</small></>}</td>
      <td>{LEVEL[p.level]} · {grades(p)}<br /><small>{PKIND[p.kind]}{p.ct_code ? <> · <span className="gpill">{p.ct_code}</span></> : null}</small></td>
      <td>{p.main_subject}{p.integrated_subjects.length > 0 && <><br /><small className="sub">Tích hợp: {p.integrated_subjects.join(', ')}</small></>}</td>
      <td>{p.total_periods || '—'}</td>
      <td><StatusPill s={p.status} />{p.status === 'published' && p.effective_from && <><br /><small className="sub">từ {fmtD(p.effective_from)}</small></>}</td>
      <td className="tools">
        <button className="primary" onClick={() => setOpenId(p.id)}>Mở</button>
        {!mine && canEdit && ['published', 'superseded'].includes(p.status) && <button onClick={() => copy(p)}>Sao chép về đơn vị</button>}
      </td>
    </tr>
  )
  const table = (rows: Program[], mine: boolean) => (
    <div className="wrap"><table>
      <thead><tr><th>Chương trình</th><th>Cấp · khối · loại</th><th>Môn</th><th>Số tiết</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody>{rows.map(p => row(p, mine))}</tbody>
    </table></div>
  )
  return (
    <>
      <p className="sub">
        {mode === 'school' ? 'Chương trình chuẩn của trường và chương trình do KDI, Sở, Phòng ban hành hoặc gán cho trường. Từ chương trình đang ban hành, trường tạo phân phối chương trình theo tiết.'
          : mode === 'platform' ? 'Chương trình chuẩn của KDI: cấu trúc, yêu cầu cần đạt, phiên bản. Bản đã ban hành và chọn "dùng chung" hiện với mọi đơn vị.'
          : 'Chương trình của đơn vị: soạn, ban hành, gán cho trường trực thuộc và theo dõi mức độ triển khai.'}
      </p>
      <div className="bar">
        <div className="tools">
          <select value={level} onChange={e => setLevel(e.target.value)} aria-label="Cấp học"><option value="">Mọi cấp học</option>{(Object.keys(LEVEL) as Level[]).map(l => <option key={l} value={l}>{LEVEL[l]}</option>)}</select>
          <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Loại"><option value="">Mọi loại</option>{(Object.keys(PKIND) as Kind[]).map(k => <option key={k} value={k}>{PKIND[k]}</option>)}</select>
          {subjects.length > 1 && <select value={subject} onChange={e => setSubject(e.target.value)} aria-label="Môn"><option value="">Mọi môn</option>{subjects.map(s => <option key={s}>{s}</option>)}</select>}
          <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Trạng thái"><option value="">Mọi trạng thái</option>{(Object.keys(PSTATUS) as Status[]).map(s => <option key={s} value={s}>{PSTATUS[s][0]}</option>)}</select>
          <input placeholder="Tìm tên, mã, môn…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
          <label><input type="checkbox" checked={old} onChange={e => setOld(e.target.checked)} /> Hiện bản cũ / lưu trữ</label>
        </div>
        {canEdit && <button className="primary" onClick={() => setForm({ level: 'thcs', kind: 'subject', grade_from: 6, grade_to: 9, scope: mode === 'school' ? 'own' : 'children' })}>Thêm chương trình</button>}
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {form && (
        <form className="panel formgrid" onSubmit={create} style={{ marginBottom: 12 }}>
          <label className="field" style={{ gridColumn: '1/-1' }}><span>Tên chương trình *</span><input required value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Tin học THCS (CT GDPT 2018)" /></label>
          <label className="field"><span>Mã</span><input value={form.code ?? ''} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="VD: TIN-THCS" /></label>
          <label className="field"><span>Loại</span><select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value as Kind })}>{(Object.keys(PKIND) as Kind[]).map(k => <option key={k} value={k}>{PKIND[k]}</option>)}</select></label>
          {form.kind === 'stem' && <label className="field"><span>Chương trình STEM</span><select value={form.ct_code ?? ''} onChange={e => setForm({ ...form, ct_code: e.target.value || null })}><option value="">—</option>{CT.map(c => <option key={c} value={c}>{c}{tracks[c] ? ` · ${tracks[c]!.name}` : ''}</option>)}</select></label>}
          <label className="field"><span>Cấp học</span><select value={form.level} onChange={e => { const l = e.target.value as Level; setForm({ ...form, level: l, grade_from: LEVEL_GRADES[l][0], grade_to: LEVEL_GRADES[l][1] }) }}>{(Object.keys(LEVEL) as Level[]).map(l => <option key={l} value={l}>{LEVEL[l]}</option>)}</select></label>
          <label className="field"><span>Từ khối</span><input type="number" min={1} max={12} value={form.grade_from ?? ''} onChange={e => setForm({ ...form, grade_from: Number(e.target.value) })} /></label>
          <label className="field"><span>Đến khối</span><input type="number" min={1} max={12} value={form.grade_to ?? ''} onChange={e => setForm({ ...form, grade_to: Number(e.target.value) })} /></label>
          <label className="field"><span>Môn chủ đạo *</span><input required list="ct-subjects-new" value={form.main_subject ?? ''} onChange={e => setForm({ ...form, main_subject: e.target.value })} placeholder="VD: Tin học" /></label>
          <datalist id="ct-subjects-new">{(form.kind === 'stem' && form.ct_code ? tracks[form.ct_code]?.subjects ?? [] : []).map(x => <option key={x} value={x} />)}</datalist>
          {mode !== 'school' && <label className="field"><span>Phạm vi</span><select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value as Program['scope'] })}>
            <option value="children">Dùng chung cho đơn vị trực thuộc</option><option value="own">Chỉ đơn vị mình</option></select></label>}
          <div className="formactions"><button className="primary" type="submit">Tạo bản nháp</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}
      {!list ? <p className="sub">Đang tải…</p> : (
        <>
          <h3>Của đơn vị ({own.length})</h3>
          {own.length ? table(own, true) : <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có chương trình nào.{canEdit && ' Bấm "Thêm chương trình", hoặc sao chép chương trình dùng chung bên dưới.'}</p></div>}
          <h3>Dùng chung / được gán ({shared.length})</h3>
          {shared.length ? table(shared, false) : <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có chương trình nào do KDI hoặc cấp trên ban hành cho đơn vị.</p></div>}
        </>
      )}
    </>
  )
}

// ================= Chi tiết một chương trình =================
type Tab = 'info' | 'units' | 'versions' | 'assign'
function ProgramDetail({ id, orgId, mode, canEdit, isAdmin, onOpen, onClose }: {
  id: string; orgId: string | null; mode: ProgMode; canEdit: boolean; isAdmin: boolean; onOpen: (id: string) => void; onClose: () => void
}) {
  const [p, setP] = useState<Program | null>(null)
  const [tab, setTab] = useState<Tab>('info')
  const [comps, setComps] = useState<Comp[]>([])
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [mkBook, setMkBook] = useState<{ grade: number; subject: string; year: string; ppw: string } | null>(null)

  async function load() {
    const { data, error } = await supabase.from('edu_programs').select('*, organizations(name)').eq('id', id).maybeSingle()
    if (error) setMsg([errText(error.message), true])
    setP(data as Program | null)
  }
  useEffect(() => { load(); setTab('info'); setMsg(null) }, [id])
  useEffect(() => {
    supabase.from('competencies').select('key, name, grp').eq('audience', 'student').order('sort').then(({ data }) => setComps((data as Comp[]) ?? []))
  }, [])
  if (!p) return <><button className="linkbtn" onClick={onClose}>‹ Danh sách chương trình</button>{msg ? <p className="msg">{msg[0]}</p> : <p className="sub">Đang tải…</p>}</>

  const mine = p.org_id === orgId
  const editable = mine && canEdit && (p.status === 'draft' || p.status === 'rejected')
  const tabs: [Tab, string][] = [['info', 'Thông tin'], ['units', 'Cấu trúc & yêu cầu cần đạt'], ['versions', 'Phiên bản & duyệt'],
    ...(mode !== 'school' && (mine || p.status === 'published' || p.status === 'superseded') ? [['assign', 'Gán & triển khai'] as [Tab, string]] : [])]

  async function openMkBook() {
    if (!p) return
    let year = ''
    if (orgId) {
      const { data } = await supabase.from('academic_years').select('name').eq('org_id', orgId).eq('is_current', true).limit(1)
      year = ((data as { name: string }[]) ?? [])[0]?.name ?? ''
    }
    setMkBook({ grade: p.grade_from, subject: p.main_subject, year, ppw: '' })
  }
  async function createBook(e: React.FormEvent) {
    e.preventDefault(); if (!mkBook || !p) return
    const ppw = Number(mkBook.ppw.replace(',', '.'))
    const { error } = await supabase.rpc('curriculum_from_program', {
      p_program: p.id, p_grade: mkBook.grade, p_subject: mkBook.subject.trim() || null, p_year: mkBook.year.trim() || null, p_ppw: ppw > 0 ? ppw : null,
    })
    if (error) return setMsg([errText(error.message), true])
    setMkBook(null); setMsg(['Đã tạo PPCT nháp — xem ở Phân phối chương trình.', false])
  }

  return (
    <>
      <div className="bar">
        <div>
          <button className="linkbtn" onClick={onClose}>‹ Danh sách chương trình</button>
          <h3 style={{ margin: '4px 0 0' }}>{p.title} <small>v{p.version_no}</small> <StatusPill s={p.status} /></h3>
          <small className="sub">{[p.code, LEVEL[p.level], grades(p), PKIND[p.kind], p.ct_code, p.main_subject, `${p.total_periods} tiết`, !mine ? p.organizations?.name : null].filter(Boolean).join(' · ')}</small>
        </div>
        <div className="tools">
          {mode === 'school' && canEdit && p.status === 'published' && <button className="primary" onClick={openMkBook}>Tạo PPCT từ chương trình</button>}
        </div>
      </div>
      {mkBook && (
        <form className="panel formgrid" onSubmit={createBook} style={{ marginBottom: 12 }}>
          <label className="field"><span>Khối</span><select value={mkBook.grade} onChange={e => setMkBook({ ...mkBook, grade: Number(e.target.value) })}>{range(p.grade_from, p.grade_to).map(g => <option key={g} value={g}>Khối {g}</option>)}</select></label>
          <label className="field"><span>Môn</span><input value={mkBook.subject} onChange={e => setMkBook({ ...mkBook, subject: e.target.value })} /></label>
          <label className="field"><span>Năm học</span><input value={mkBook.year} onChange={e => setMkBook({ ...mkBook, year: e.target.value })} placeholder="Để trống: mọi năm" /></label>
          <label className="field"><span>Số tiết / tuần</span><input inputMode="decimal" value={mkBook.ppw} onChange={e => setMkBook({ ...mkBook, ppw: e.target.value })} placeholder="VD: 1 hoặc 1,5" /></label>
          <div className="formactions"><button className="primary" type="submit">Tạo PPCT nháp</button> <button type="button" onClick={() => setMkBook(null)}>Huỷ</button></div>
        </form>
      )}
      <div className="segmented">
        {tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {tab === 'info' && <InfoTab p={p} editable={editable} scopeEditable={mine && canEdit && p.status === 'published' && mode !== 'school'} mode={mode} comps={comps} onSaved={m => { setMsg([m, false]); load() }} onError={m => setMsg([m, true])} />}
      {tab === 'units' && <UnitsTab p={p} editable={editable} comps={comps} onChanged={load} onMessage={(m, e) => setMsg([m, !!e])} />}
      {tab === 'versions' && <VersionsTab p={p} mine={mine} canEdit={canEdit} mode={mode} isAdmin={isAdmin} onOpen={onOpen} onChanged={load} onMessage={(m, e) => setMsg([m, !!e])} />}
      {tab === 'assign' && <AssignTab p={p} orgId={orgId} mine={mine} onMessage={(m, e) => setMsg([m, !!e])} />}
    </>
  )
}

// ----- Thông tin -----
function InfoTab({ p, editable, scopeEditable, mode, comps, onSaved, onError }: {
  p: Program; editable: boolean; scopeEditable: boolean; mode: ProgMode; comps: Comp[]; onSaved: (m: string) => void; onError: (m: string) => void
}) {
  const [f, setF] = useState<Program>(p)
  const [integ, setInteg] = useState(p.integrated_subjects.join(', '))
  const { byCode: tracks } = useStemTracks()
  const [rubrics, setRubrics] = useState<Rubric[]>([])
  useEffect(() => { setF(p); setInteg(p.integrated_subjects.join(', ')) }, [p])
  useEffect(() => { supabase.from('rubrics').select('id, title').order('title').then(({ data }) => setRubrics((data as Rubric[]) ?? [])) }, [])
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const body = {
      code: f.code?.trim() || null, title: f.title.trim(), kind: f.kind, ct_code: f.kind === 'stem' ? f.ct_code || null : null, level: f.level,
      grade_from: Number(f.grade_from), grade_to: Number(f.grade_to), main_subject: f.main_subject.trim(),
      integrated_subjects: integ.split(/[,;]/).map(s => s.trim()).filter(Boolean), objectives: f.objectives?.trim() || null,
      competency_keys: f.competency_keys, rubric_ids: f.rubric_ids, note: f.note?.trim() || null, effective_from: f.effective_from || null,
      ...(mode !== 'school' ? { scope: f.scope } : {}),
    }
    const { error } = await supabase.from('edu_programs').update(body).eq('id', p.id)
    if (error) return onError(errText(error.message))
    onSaved('Đã lưu thông tin chương trình.')
  }
  // Phạm vi và ngày hiệu lực đổi được cả khi đã ban hành (không đổi nội dung)
  async function saveScope() {
    const { error } = await supabase.from('edu_programs').update({ scope: f.scope, effective_from: f.effective_from || null }).eq('id', p.id)
    if (error) return onError(errText(error.message))
    onSaved('Đã lưu phạm vi áp dụng.')
  }
  const compName = (k: string) => comps.find(c => c.key === k)?.name ?? k
  const dis = !editable
  return (
    <form className="panel" onSubmit={save}>
      {!editable && <p className="sub" style={{ marginTop: 0 }}>{p.status === 'draft' || p.status === 'rejected' ? 'Bạn chỉ xem được chương trình này.' : 'Chương trình đã gửi duyệt hoặc ban hành: nội dung không sửa được. Tạo phiên bản mới ở tab "Phiên bản & duyệt" để điều chỉnh.'}</p>}
      <div className="formgrid">
        <label className="field" style={{ gridColumn: '1/-1' }}><span>Tên chương trình</span><input disabled={dis} value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
        <label className="field"><span>Mã</span><input disabled={dis} value={f.code ?? ''} onChange={e => setF({ ...f, code: e.target.value })} /></label>
        <label className="field"><span>Loại</span><select disabled={dis} value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as Kind })}>{(Object.keys(PKIND) as Kind[]).map(k => <option key={k} value={k}>{PKIND[k]}</option>)}</select></label>
        {f.kind === 'stem' && <label className="field"><span>Chương trình STEM</span><select disabled={dis} value={f.ct_code ?? ''} onChange={e => setF({ ...f, ct_code: e.target.value || null })}><option value="">—</option>{CT.map(c => <option key={c} value={c}>{c}{tracks[c] ? ` · ${tracks[c]!.name}` : ''}</option>)}</select></label>}
        <label className="field"><span>Cấp học</span><select disabled={dis} value={f.level} onChange={e => setF({ ...f, level: e.target.value as Level })}>{(Object.keys(LEVEL) as Level[]).map(l => <option key={l} value={l}>{LEVEL[l]}</option>)}</select></label>
        <label className="field"><span>Từ khối</span><input disabled={dis} type="number" min={1} max={12} value={f.grade_from} onChange={e => setF({ ...f, grade_from: Number(e.target.value) })} /></label>
        <label className="field"><span>Đến khối</span><input disabled={dis} type="number" min={1} max={12} value={f.grade_to} onChange={e => setF({ ...f, grade_to: Number(e.target.value) })} /></label>
        <label className="field"><span>Môn chủ đạo</span><input disabled={dis} list="ct-subjects-edit" value={f.main_subject} onChange={e => setF({ ...f, main_subject: e.target.value })} /></label>
        <datalist id="ct-subjects-edit">{(f.kind === 'stem' && f.ct_code ? tracks[f.ct_code]?.subjects ?? [] : []).map(x => <option key={x} value={x} />)}</datalist>
        <label className="field"><span>Môn tích hợp</span><input disabled={dis} value={integ} onChange={e => setInteg(e.target.value)} placeholder="Ngăn cách bằng dấu phẩy" /></label>
        <label className="field"><span>Hiệu lực từ</span><input disabled={!editable && !scopeEditable} type="date" value={f.effective_from ?? ''} onChange={e => setF({ ...f, effective_from: e.target.value || null })} /></label>
        {mode !== 'school' && <label className="field"><span>Phạm vi áp dụng</span><select value={f.scope} disabled={!editable && !scopeEditable} onChange={e => setF({ ...f, scope: e.target.value as Program['scope'] })}>
          <option value="children">Dùng chung cho đơn vị trực thuộc</option><option value="own">Chỉ đơn vị mình</option></select></label>}
        <label className="field" style={{ gridColumn: '1/-1' }}><span>Mục tiêu chương trình</span><textarea disabled={dis} rows={3} value={f.objectives ?? ''} onChange={e => setF({ ...f, objectives: e.target.value })} /></label>
        <label className="field" style={{ gridColumn: '1/-1' }}><span>Ghi chú</span><input disabled={dis} value={f.note ?? ''} onChange={e => setF({ ...f, note: e.target.value })} /></label>
      </div>
      <fieldset className="libtargets"><legend>Khung năng lực</legend>
        {editable ? comps.map(c => <label key={c.key}><input type="checkbox" checked={f.competency_keys.includes(c.key)} onChange={() => setF({ ...f, competency_keys: toggle(f.competency_keys, c.key) })} /> {c.name}</label>)
          : <p className="sub" style={{ margin: 0 }}>{f.competency_keys.length ? f.competency_keys.map(compName).join(' · ') : 'Chưa chọn năng lực.'}</p>}
      </fieldset>
      <fieldset className="libtargets"><legend>Tiêu chí đánh giá (rubric)</legend>
        {editable ? (rubrics.length ? rubrics.map(r => <label key={r.id}><input type="checkbox" checked={f.rubric_ids.includes(r.id)} onChange={() => setF({ ...f, rubric_ids: toggle(f.rubric_ids, r.id) })} /> {r.title}</label>)
          : <p className="sub" style={{ margin: 0 }}>Chưa có rubric nào.</p>)
          : <p className="sub" style={{ margin: 0 }}>{f.rubric_ids.length ? f.rubric_ids.map(id => rubrics.find(r => r.id === id)?.title ?? 'Rubric').join(' · ') : 'Chưa gắn rubric.'}</p>}
      </fieldset>
      <div className="formactions">
        {editable && <button className="primary" type="submit">Lưu</button>}
        {scopeEditable && (f.scope !== p.scope || f.effective_from !== p.effective_from) && <button type="button" className="primary" onClick={saveScope}>Lưu phạm vi áp dụng</button>}
      </div>
    </form>
  )
}

// ----- Cấu trúc + YCCĐ -----
const IMPORT: Column[] = [
  { key: 'type', label: 'Loại', required: true, aliases: ['Cấp', 'Loại mục'], width: 12 },
  { key: 'grade', label: 'Khối', width: 8 },
  { key: 'subject', label: 'Môn', width: 16 },
  { key: 'title', label: 'Tên', required: true, aliases: ['Tên chủ đề / bài', 'Tên bài', 'Nội dung'], width: 44 },
  { key: 'periods', label: 'Số tiết', aliases: ['Tiết'], width: 8 },
  { key: 'objectives', label: 'Mục tiêu', width: 30 },
  { key: 'outcomes', label: 'Yêu cầu cần đạt', aliases: ['YCCĐ', 'Yêu cầu'], width: 50 },
]
const typeOf = (s: string): UnitType | null => {
  const n = norm(s)
  if (!n || n.startsWith('chu de') || n === 'topic') return n ? 'topic' : null
  if (n.startsWith('bai') || n === 'lesson') return 'lesson'
  if (n.startsWith('buoi') || n === 'session') return 'session'
  return null
}

function UnitsTab({ p, editable, comps, onChanged, onMessage }: {
  p: Program; editable: boolean; comps: Comp[]; onChanged: () => void; onMessage: (m: string, err?: boolean) => void
}) {
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [outs, setOuts] = useState<Outcome[]>([])
  const [edit, setEdit] = useState<Partial<Unit> | null>(null)
  const [oedit, setOedit] = useState<Partial<Outcome> | null>(null)
  async function load() {
    const [u, o] = await Promise.all([
      supabase.from('edu_program_units').select('*').eq('program_id', p.id).order('seq'),
      supabase.from('edu_outcomes').select('*').eq('program_id', p.id).order('seq'),
    ])
    if (u.error) onMessage(errText(u.error.message), true)
    setUnits((u.data as Unit[]) ?? []); setOuts((o.data as Outcome[]) ?? [])
  }
  useEffect(() => { load() }, [p.id])
  const all = units ?? []
  const kids = (parent: string | null) => all.filter(u => u.parent_id === parent).sort((a, b) => a.seq - b.seq)
  // Thứ tự hiển thị: chủ đề, các bài của nó, các buổi của mỗi bài
  const ordered: { u: Unit; depth: number }[] = []
  const walk = (parent: string | null, depth: number) => kids(parent).forEach(u => { ordered.push({ u, depth }); walk(u.id, depth + 1) })
  walk(null, 0)
  const compName = (k: string | null) => (k ? comps.find(c => c.key === k)?.name ?? k : '')
  // Dòng thêm mục con hiện sau mục con cuối cùng trong nhánh của mục cha
  const newParent = edit && !edit.id ? edit.parent_id ?? null : null
  const addAfter = newParent ? [...ordered].reverse().find(x => x.u.id === newParent || isDesc(all, x.u, newParent))?.u.id ?? null : null
  const addDepth = newParent ? (ordered.find(x => x.u.id === newParent)?.depth ?? 0) + 1 : 0
  const leafTotal = all.filter(u => !all.some(c => c.parent_id === u.id)).reduce((s, u) => s + u.periods, 0)

  async function saveUnit(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return
    const row = {
      program_id: p.id, parent_id: edit.parent_id ?? null, unit_type: edit.unit_type ?? 'topic', seq: Number(edit.seq) || 1,
      grade: edit.grade ? Number(edit.grade) : null, subject: edit.subject?.trim() || null, title: (edit.title ?? '').trim(),
      periods: Number(edit.periods) || 0, objectives: edit.objectives?.trim() || null,
    }
    if (!row.title) return onMessage('Nhập tên.', true)
    const { error } = edit.id ? await supabase.from('edu_program_units').update(row).eq('id', edit.id) : await supabase.from('edu_program_units').insert(row)
    if (error) return onMessage(errText(error.message), true)
    setEdit(null); await load(); onChanged()
  }
  async function delUnit(u: Unit) {
    if (!confirm(`Xoá ${UTYPE[u.unit_type].toLowerCase()} "${u.title}" cùng các mục con và yêu cầu cần đạt?`)) return
    const { error } = await supabase.from('edu_program_units').delete().eq('id', u.id)
    if (error) return onMessage(errText(error.message), true)
    await load(); onChanged()
  }
  async function saveOut(e: React.FormEvent) {
    e.preventDefault(); if (!oedit) return
    const row = { program_id: p.id, unit_id: oedit.unit_id ?? null, seq: Number(oedit.seq) || 1, code: oedit.code?.trim() || null,
      content: (oedit.content ?? '').trim(), competency_key: oedit.competency_key || null }
    if (!row.content) return onMessage('Nhập nội dung yêu cầu cần đạt.', true)
    const { error } = oedit.id ? await supabase.from('edu_outcomes').update(row).eq('id', oedit.id) : await supabase.from('edu_outcomes').insert(row)
    if (error) return onMessage(errText(error.message), true)
    setOedit(null); load()
  }
  async function delOut(o: Outcome) {
    if (!confirm('Xoá yêu cầu cần đạt này?')) return
    const { error } = await supabase.from('edu_outcomes').delete().eq('id', o.id)
    if (error) return onMessage(errText(error.message), true)
    load()
  }
  const addChild = (parent: Unit | null) => {
    const t: UnitType = parent ? CHILD[parent.unit_type] ?? 'session' : 'topic'
    setOedit(null)
    setEdit({ parent_id: parent?.id ?? null, unit_type: t, seq: kids(parent?.id ?? null).reduce((m, u) => Math.max(m, u.seq), 0) + 1, periods: t === 'topic' ? 0 : 1 })
  }

  async function importRows(recs: (Record<string, string> & { _line: number })[]) {
    const bad: string[] = []
    type R = { type: UnitType; grade: number | null; subject: string | null; title: string; periods: number; objectives: string | null; outcomes: string[] }
    const rows: R[] = []
    let hasLesson = false
    for (const r of recs) {
      const t = typeOf(r.type)
      if (!t) { bad.push(`dòng ${r._line}: loại "${r.type}" không rõ (Chủ đề / Bài học / Buổi học)`); continue }
      if (!r.title.trim()) { bad.push(`dòng ${r._line}: thiếu tên`); continue }
      if (t === 'session' && !hasLesson) { bad.push(`dòng ${r._line}: buổi học chưa thuộc bài học nào`); continue }
      if (t === 'topic') hasLesson = false
      if (t === 'lesson') hasLesson = true
      const g = Number(r.grade); const n = Number(String(r.periods).replace(',', '.'))
      rows.push({ type: t, grade: g >= 1 && g <= 12 ? g : null, subject: r.subject.trim() || null, title: r.title.trim(),
        periods: Number.isFinite(n) && n > 0 ? Math.round(n) : 0, objectives: r.objectives.trim() || null,
        outcomes: r.outcomes.split(/\n|;/).map(s => s.trim()).filter(Boolean) })
    }
    if (!rows.length) return importSummary(0, 'mục', bad)
    if (all.length && !confirm(`Thay toàn bộ ${all.length} mục hiện có bằng ${rows.length} mục trong file?`)) return 'Đã huỷ nhập.'
    if (all.length) {
      const { error } = await supabase.from('edu_program_units').delete().eq('program_id', p.id)
      if (error) return errText(error.message)
      await supabase.from('edu_outcomes').delete().eq('program_id', p.id)
    }
    let topic: string | null = null, lesson: string | null = null
    const seqs = new Map<string, number>()
    let nOut = 0
    for (const r of rows) {
      const parent: string | null = r.type === 'topic' ? null : r.type === 'lesson' ? topic : lesson
      const key = parent ?? '_'
      const seq = (seqs.get(key) ?? 0) + 1; seqs.set(key, seq)
      const res = await supabase.from('edu_program_units').insert({
        program_id: p.id, parent_id: parent, unit_type: r.type, seq, grade: r.grade, subject: r.subject,
        title: r.title, periods: r.periods, objectives: r.objectives,
      }).select('id').single()
      if (res.error) { bad.push(`"${r.title}": ${errText(res.error.message)}`); continue }
      const uid: string = (res.data as { id: string }).id
      if (r.type === 'topic') { topic = uid; lesson = null }
      if (r.type === 'lesson') lesson = uid
      if (r.outcomes.length) {
        const o = await supabase.from('edu_outcomes').insert(r.outcomes.map((c, i) => ({ program_id: p.id, unit_id: uid, seq: i + 1, content: c })))
        if (o.error) bad.push(`YCCĐ của "${r.title}": ${errText(o.error.message)}`); else nOut += r.outcomes.length
      }
    }
    await load(); onChanged()
    return importSummary(rows.length, 'mục', bad) + (nOut ? ` · ${nOut} yêu cầu cần đạt` : '')
  }
  function exportRows() {
    downloadXlsx(`Chuong-trinh ${p.title} v${p.version_no}`, IMPORT, ordered.map(({ u }) => [UTYPE[u.unit_type], u.grade, u.subject, u.title, u.periods || null, u.objectives,
      outs.filter(o => o.unit_id === u.id).map(o => (o.code ? o.code + '. ' : '') + o.content).join('\n')]), 'Cấu trúc')
  }

  const unitForm = (depth: number) => (
    <tr>
      <td style={{ paddingLeft: 8 + depth * 22 }}><small>{UTYPE[edit?.unit_type ?? 'topic']}</small><br />
        <input type="number" min={1} value={edit?.seq ?? ''} onChange={e => setEdit({ ...edit, seq: Number(e.target.value) })} aria-label="Thứ tự" style={{ width: 56 }} /></td>
      <td><input value={edit?.title ?? ''} onChange={e => setEdit({ ...edit, title: e.target.value })} aria-label="Tên" autoFocus style={{ width: '100%', minWidth: 200 }} placeholder="Tên chủ đề / bài / buổi" />
        <input value={edit?.objectives ?? ''} onChange={e => setEdit({ ...edit, objectives: e.target.value })} aria-label="Mục tiêu" placeholder="Mục tiêu" style={{ width: '100%', marginTop: 4 }} /></td>
      <td><select value={edit?.grade ?? ''} onChange={e => setEdit({ ...edit, grade: Number(e.target.value) || null })} aria-label="Khối"><option value="">—</option>{range(p.grade_from, p.grade_to).map(g => <option key={g} value={g}>{g}</option>)}</select></td>
      <td><input value={edit?.subject ?? ''} onChange={e => setEdit({ ...edit, subject: e.target.value })} aria-label="Môn" style={{ width: 110 }} placeholder={p.main_subject} /></td>
      <td><input type="number" min={0} value={edit?.periods ?? 0} onChange={e => setEdit({ ...edit, periods: Number(e.target.value) })} aria-label="Số tiết" style={{ width: 64 }} /></td>
      <td className="tools"><button className="primary" type="submit" form="prog-unit">Lưu</button><button type="button" onClick={() => setEdit(null)}>Huỷ</button></td>
    </tr>
  )
  const outForm = (
    <div className="addrow" style={{ flexWrap: 'wrap', gap: 6 }}>
      <input value={oedit?.code ?? ''} onChange={e => setOedit({ ...oedit, code: e.target.value })} placeholder="Mã" aria-label="Mã" style={{ width: 70 }} />
      <input value={oedit?.content ?? ''} onChange={e => setOedit({ ...oedit, content: e.target.value })} placeholder="Yêu cầu cần đạt" aria-label="Yêu cầu cần đạt" autoFocus style={{ flex: 1, minWidth: 220 }} />
      <select value={oedit?.competency_key ?? ''} onChange={e => setOedit({ ...oedit, competency_key: e.target.value || null })} aria-label="Năng lực"><option value="">Năng lực —</option>{comps.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select>
      <button className="primary" type="submit" form="prog-out">Lưu</button><button type="button" onClick={() => setOedit(null)}>Huỷ</button>
    </div>
  )

  if (!units) return <p className="sub">Đang tải…</p>
  return (
    <>
      <Tiles items={[
        { label: 'Chủ đề', value: all.filter(u => u.unit_type === 'topic').length },
        { label: 'Bài học', value: all.filter(u => u.unit_type === 'lesson').length, sub: `${all.filter(u => u.unit_type === 'session').length} buổi học` },
        { label: 'Tổng số tiết', value: leafTotal },
        { label: 'Yêu cầu cần đạt', value: outs.length },
      ]} />
      <div className="bar">
        <p className="sub" style={{ margin: 0 }}>Cấu trúc: chủ đề → bài học → buổi học. Số tiết tính theo mục cuối cùng của mỗi nhánh.</p>
        <div className="tools">
          {editable && <ImportExcel columns={IMPORT} template={`Mau-chuong-trinh-${p.main_subject}`}
            sample={[['Chủ đề', '6', '', 'Chủ đề A. Máy tính và cộng đồng', '', 'Hiểu thông tin và dữ liệu', 'Phân biệt được thông tin và dữ liệu; Nêu được ví dụ về xử lí thông tin'],
              ['Bài học', '', '', 'Bài 1. Thông tin và dữ liệu', '2', '', ''], ['Buổi học', '', '', 'Buổi 1: Thảo luận nhóm', '1', '', '']]}
            onRecords={importRows} onMessage={(m, e) => onMessage(m, e)} />}
          {all.length > 0 && <button onClick={exportRows}>Tải Excel</button>}
          {editable && <button className="primary" onClick={() => addChild(null)}>Thêm chủ đề</button>}
        </div>
      </div>
      <form id="prog-unit" onSubmit={saveUnit} />
      <form id="prog-out" onSubmit={saveOut} />
      {all.length === 0 && !edit ? <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có chủ đề nào.{editable && ' Bấm "Thêm chủ đề" hoặc "Nhập Excel".'}</p></div> : (
        <div className="wrap"><table>
          <thead><tr><th>Mục</th><th>Tên · mục tiêu · yêu cầu cần đạt</th><th>Khối</th><th>Môn</th><th>Số tiết</th><th></th></tr></thead>
          <tbody>
            {ordered.map(({ u, depth }) => {
              const os = outs.filter(o => o.unit_id === u.id).sort((a, b) => a.seq - b.seq)
              return (
                <Fragment key={u.id}>
                  {edit?.id === u.id ? unitForm(depth) : (
                    <tr>
                      <td style={{ paddingLeft: 8 + depth * 22 }}><small className="sub">{UTYPE[u.unit_type]}</small> <b>{u.seq}</b></td>
                      <td>{u.unit_type === 'topic' ? <b>{u.title}</b> : u.title}{u.objectives && <><br /><small className="sub">Mục tiêu: {u.objectives}</small></>}
                        {os.map(o => oedit?.id === o.id ? <div key={o.id}>{outForm}</div> : (
                          <div key={o.id} style={{ fontSize: 13, marginTop: 2 }}>✓ {o.code && <b>{o.code} </b>}{o.content}{o.competency_key && <small className="sub"> · {compName(o.competency_key)}</small>}
                            {editable && <> <button className="linkbtn" onClick={() => { setEdit(null); setOedit(o) }}>Sửa</button> <button className="linkbtn" onClick={() => delOut(o)}>Xoá</button></>}</div>
                        ))}
                        {oedit && !oedit.id && oedit.unit_id === u.id && outForm}
                      </td>
                      <td>{u.grade ?? ''}</td><td><small>{u.subject ?? ''}</small></td><td>{u.periods || (all.some(c => c.parent_id === u.id) ? '' : '—')}</td>
                      <td className="tools">{editable && <>
                        {CHILD[u.unit_type] && <button onClick={() => addChild(u)}>+ {UTYPE[CHILD[u.unit_type]!]}</button>}
                        <button onClick={() => { setEdit(null); setOedit({ unit_id: u.id, seq: os.length + 1 }) }}>+ YCCĐ</button>
                        <button onClick={() => { setOedit(null); setEdit(u) }}>Sửa</button>
                        <button className="danger" onClick={() => delUnit(u)}>Xoá</button>
                      </>}</td>
                    </tr>
                  )}
                  {addAfter === u.id && unitForm(addDepth)}
                </Fragment>
              )
            })}
            {edit && !edit.id && !edit.parent_id && unitForm(0)}
          </tbody>
        </table></div>
      )}
      {outs.some(o => !o.unit_id) && (
        <div className="panel"><b>Yêu cầu cần đạt chung của chương trình</b>
          {outs.filter(o => !o.unit_id).map(o => <div key={o.id}>✓ {o.code && <b>{o.code} </b>}{o.content}</div>)}</div>
      )}
    </>
  )
}
// u nằm trong nhánh của mục ancestor
function isDesc(all: Unit[], u: Unit, ancestor: string): boolean {
  let p = u.parent_id
  for (let i = 0; p && i < 5; i++) { if (p === ancestor) return true; p = all.find(x => x.id === p)?.parent_id ?? null }
  return false
}

// ----- Phiên bản & duyệt -----
function VersionsTab({ p, mine, canEdit, mode, isAdmin, onOpen, onChanged, onMessage }: {
  p: Program; mine: boolean; canEdit: boolean; mode: ProgMode; isAdmin: boolean; onOpen: (id: string) => void; onChanged: () => void
  onMessage: (m: string, err?: boolean) => void
}) {
  const [vers, setVers] = useState<Program[]>([])
  const [log, setLog] = useState<LogRow[]>([])
  const [canAct, setCanAct] = useState(false)
  const [busy, setBusy] = useState(false)
  async function load() {
    const [v, l, r] = await Promise.all([
      supabase.from('edu_programs').select('*').eq('family_id', p.family_id).order('version_no', { ascending: false }),
      supabase.from('edu_program_log').select('id, from_status, to_status, note, at').eq('program_id', p.id).order('at', { ascending: false }),
      supabase.from('approval_requests').select('id').eq('ref_table', 'edu_programs').eq('ref_id', p.id).eq('status', 'pending').limit(1),
    ])
    setVers((v.data as Program[]) ?? []); setLog((l.data as LogRow[]) ?? [])
    const req = ((r.data as { id: string }[]) ?? [])[0]
    if (req) { const { data } = await supabase.rpc('approval_can_act', { p_request: req.id }); setCanAct(!!data) } else setCanAct(false)
  }
  useEffect(() => { load() }, [p.id, p.status])

  async function setStatus(s: Status, ask?: string) {
    const note = ask ? prompt(ask, '') : ''
    if (note === null) return
    setBusy(true)
    const { error } = await supabase.rpc('edu_program_set_status', { p_program: p.id, p_status: s, p_note: note || null })
    setBusy(false)
    if (error) return onMessage(errText(error.message), true)
    onMessage(s === 'pending' ? 'Đã gửi duyệt — hồ sơ ở Hộp phê duyệt.' : s === 'published' ? 'Đã ban hành.' : s === 'archived' ? 'Đã lưu trữ.' : 'Đã mở lại thành bản nháp.')
    onChanged()
  }
  async function decide(d: 'approve' | 'reject') {
    const note = prompt(d === 'approve' ? 'Ghi chú khi duyệt (không bắt buộc):' : 'Lý do trả lại:', '')
    if (note === null) return
    setBusy(true)
    const { error } = await supabase.rpc('approval_decide_ref', { p_table: 'edu_programs', p_ref: p.id, p_decision: d, p_note: note || null })
    setBusy(false)
    if (error) return onMessage(errText(error.message), true)
    onMessage(d === 'approve' ? 'Đã duyệt.' : 'Đã trả lại.'); onChanged()
  }
  async function newVersion() {
    if (!confirm('Tạo phiên bản mới (bản nháp chép từ phiên bản này)? Phiên bản đang ban hành vẫn dùng đến khi bản mới được ban hành.')) return
    setBusy(true)
    const { data, error } = await supabase.rpc('edu_program_new_version', { p_program: p.id })
    setBusy(false)
    if (error) return onMessage(errText(error.message), true)
    onOpen(data as string)
  }
  const can = mine && canEdit
  const canPublishDraft = mode !== 'school' || isAdmin
  return (
    <>
      <div className="panel">
        <div className="tools">
          {can && (p.status === 'draft' || p.status === 'rejected') && <button className="primary" disabled={busy} onClick={() => setStatus('pending', 'Ghi chú gửi người duyệt (không bắt buộc):')}>Gửi duyệt</button>}
          {can && p.status === 'draft' && canPublishDraft && <button disabled={busy} onClick={() => confirm('Ban hành ngay phiên bản này? Phiên bản đang ban hành (nếu có) sẽ bị thay thế.') && setStatus('published')}>Ban hành</button>}
          {p.status === 'pending' && canAct && <><button className="primary" disabled={busy} onClick={() => decide('approve')}>Duyệt</button><button className="danger" disabled={busy} onClick={() => decide('reject')}>Trả lại</button></>}
          {p.status === 'pending' && !canAct && <small className="sub">Đang chờ duyệt ở Hộp phê duyệt.</small>}
          {can && p.status === 'approved' && <button className="primary" disabled={busy} onClick={() => setStatus('published', 'Ghi chú ban hành (không bắt buộc):')}>Ban hành</button>}
          {can && p.status === 'approved' && <button disabled={busy} onClick={() => setStatus('draft')}>Mở lại để sửa</button>}
          {can && p.status === 'published' && <button className="primary" disabled={busy} onClick={newVersion}>Tạo phiên bản mới</button>}
          {can && ['published', 'superseded', 'draft', 'rejected', 'approved'].includes(p.status) && <button disabled={busy} onClick={() => confirm('Lưu trữ phiên bản này? Đơn vị khác không còn thấy bản lưu trữ.') && setStatus('archived', 'Lý do lưu trữ (không bắt buộc):')}>Lưu trữ</button>}
          {can && p.status === 'archived' && <button disabled={busy} onClick={() => setStatus('draft')}>Mở lại thành nháp</button>}
        </div>
        {!can && p.status !== 'pending' && <p className="sub" style={{ margin: 0 }}>{mine ? 'Bạn chỉ xem được chương trình này.' : 'Chương trình của đơn vị khác — sao chép về đơn vị để điều chỉnh.'}</p>}
      </div>
      <h3>Các phiên bản</h3>
      <div className="wrap"><table>
        <thead><tr><th>Phiên bản</th><th>Trạng thái</th><th>Ban hành</th><th>Hiệu lực</th><th>Ghi chú</th><th></th></tr></thead>
        <tbody>{vers.map(v => (
          <tr key={v.id} style={v.id === p.id ? { background: 'var(--soft, #f3f7fd)' } : undefined}>
            <td><b>v{v.version_no}</b></td><td><StatusPill s={v.status} /></td><td>{fmtD(v.published_at)}</td>
            <td>{v.effective_from ? fmtD(v.effective_from) : '—'}{v.effective_to ? ` → ${fmtD(v.effective_to)}` : ''}</td>
            <td><small>{v.note}</small></td>
            <td>{v.id === p.id ? <small className="sub">đang xem</small> : <button onClick={() => onOpen(v.id)}>Mở</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <h3>Lịch sử trạng thái</h3>
      {log.length === 0 ? <p className="sub">Chưa có.</p> : (
        <ul className="sub" style={{ paddingLeft: 18 }}>
          {log.map(l => <li key={l.id}>{new Date(l.at).toLocaleString('vi-VN')} · {l.from_status ? `${PSTATUS[l.from_status as Status]?.[0] ?? l.from_status} → ` : ''}<b>{PSTATUS[l.to_status as Status]?.[0] ?? l.to_status}</b>{l.note ? ` — ${l.note}` : ''}</li>)}
        </ul>
      )}
    </>
  )
}

// ----- Gán cho trường & độ phủ triển khai -----
function AssignTab({ p, orgId, mine, onMessage }: { p: Program; orgId: string | null; mine: boolean; onMessage: (m: string, err?: boolean) => void }) {
  const [orgs, setOrgs] = useState<Org[]>([])
  const [asg, setAsg] = useState<Assign[]>([])
  const [cov, setCov] = useState<Cover[] | null>(null)
  const [form, setForm] = useState<{ org: string; grades: number[]; note: string } | null>(null)
  async function load() {
    const [o, a, c] = await Promise.all([
      supabase.from('organizations').select('id, name, type, parent_id').order('name'),
      supabase.from('edu_program_assignments').select('*').eq('program_id', p.id).order('created_at'),
      supabase.rpc('edu_program_coverage', { p_program: p.id }),
    ])
    setOrgs((o.data as Org[]) ?? []); setAsg((a.data as Assign[]) ?? [])
    if (c.error) onMessage(errText(c.error.message), true)
    setCov((c.data as Cover[]) ?? [])
  }
  useEffect(() => { load() }, [p.id])
  const below: Org[] = []
  const walk = (id: string, depth: number) => orgs.filter(o => o.parent_id === id).forEach(o => { below.push({ ...o, name: ' '.repeat(depth * 3) + o.name }); walk(o.id, depth + 1) })
  if (orgId) walk(orgId, 0)
  const orgName = (id: string) => orgs.find(o => o.id === id)?.name ?? '—'

  async function add(e: React.FormEvent) {
    e.preventDefault(); if (!form?.org) return onMessage('Chọn đơn vị.', true)
    const { error } = await supabase.from('edu_program_assignments').insert({ program_id: p.id, org_id: form.org, grades: form.grades.length ? form.grades.sort((a, b) => a - b) : null, note: form.note.trim() || null })
    if (error) return onMessage(/duplicate|unique/i.test(error.message) ? 'Đơn vị này đã được gán.' : errText(error.message), true)
    setForm(null); onMessage('Đã gán chương trình.'); load()
  }
  async function remove(a: Assign) {
    if (!confirm(`Bỏ gán cho ${orgName(a.org_id)}?`)) return
    const { error } = await supabase.from('edu_program_assignments').delete().eq('id', a.id)
    if (error) return onMessage(errText(error.message), true)
    load()
  }
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
  const rows = cov ?? []
  function exportCov() {
    downloadXlsx(`Do-phu ${p.title}`, [
      { key: 's', label: 'Trường', width: 30 }, { key: 'a', label: 'Địa bàn', width: 22 }, { key: 'g', label: 'Được gán' }, { key: 'b', label: 'Số PPCT' },
      { key: 'c', label: 'Lớp' }, { key: 'd', label: 'Tiết đã dạy' }, { key: 'l', label: 'Tổng tiết' }, { key: 'm', label: 'Chậm / bỏ qua' },
      { key: 'o', label: 'YCCĐ đạt' }, { key: 'on', label: 'Tổng YCCĐ' },
    ], rows.map(r => [r.school, r.area, r.assigned ? (r.grades?.length ? 'Khối ' + r.grades.join(', ') : 'Có') : '', r.books, r.classes, r.done, r.lessons, r.missed, r.outcomes_done, r.outcomes]))
  }
  return (
    <>
      <div className="bar">
        <h3 style={{ margin: 0 }}>Đơn vị được gán ({asg.length})</h3>
        {(mine ? !['draft', 'archived'].includes(p.status) : p.status === 'published') && <button className="primary" onClick={() => setForm({ org: '', grades: [], note: '' })}>Gán cho đơn vị</button>}
      </div>
      {['draft', 'pending', 'approved', 'rejected'].includes(p.status) && <p className="sub">Đơn vị được gán chỉ thấy chương trình khi đã ban hành.</p>}
      {!mine && <p className="sub">Chương trình của {p.organizations?.name ?? 'đơn vị khác'}: đơn vị gán cho trường trực thuộc để triển khai; chỉ bỏ được các bản gán do đơn vị mình tạo.</p>}
      {form && (
        <form className="panel formgrid" onSubmit={add} style={{ marginBottom: 12 }}>
          <label className="field"><span>Đơn vị trực thuộc</span><select value={form.org} onChange={e => setForm({ ...form, org: e.target.value })}>
            <option value="">— chọn —</option>{below.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <div className="field"><span>Khối (không chọn = mọi khối)</span><div className="tools">
            {range(p.grade_from, p.grade_to).map(g => <label key={g}><input type="checkbox" checked={form.grades.includes(g)} onChange={() => setForm({ ...form, grades: form.grades.includes(g) ? form.grades.filter(x => x !== g) : [...form.grades, g] })} /> {g}</label>)}</div></div>
          <label className="field"><span>Ghi chú</span><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
          <div className="formactions"><button className="primary" type="submit">Gán</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}
      {asg.length > 0 && (
        <div className="wrap"><table>
          <thead><tr><th>Đơn vị</th><th>Khối</th><th>Ghi chú</th><th>Ngày gán</th><th></th></tr></thead>
          <tbody>{asg.map(a => (
            <tr key={a.id}><td><b>{orgName(a.org_id)}</b></td><td>{a.grades?.length ? a.grades.join(', ') : 'Mọi khối'}</td><td><small>{a.note}</small></td><td>{fmtD(a.created_at)}</td>
              <td>{(mine || a.assigner_org === orgId) && <button className="danger" onClick={() => remove(a)}>Bỏ gán</button>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="bar" style={{ marginTop: 16 }}>
        <h3 style={{ margin: 0 }}>Mức độ triển khai</h3>
        {rows.length > 0 && <button onClick={exportCov}>Xuất Excel</button>}
      </div>
      <p className="sub">Tính trên mọi phiên bản của chương trình: trường được gán, trường có PPCT tạo từ chương trình, tiết đã dạy và yêu cầu cần đạt đã đạt.</p>
      {!cov ? <p className="sub">Đang tải…</p> : rows.length === 0 ? <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có trường nào được gán hoặc dùng chương trình này.</p></div> : (
        <>
          <Tiles items={[
            { label: 'Trường được gán', value: rows.filter(r => r.assigned).length },
            { label: 'Trường đã có PPCT', value: rows.filter(r => r.books > 0).length, tone: rows.some(r => r.assigned && !r.books) ? 'warn' : 'good' },
            { label: 'Tiết đã dạy', value: `${pct(rows.reduce((s, r) => s + r.done, 0), rows.reduce((s, r) => s + r.lessons, 0))}%` },
            { label: 'Nội dung chậm / bỏ qua', value: rows.reduce((s, r) => s + r.missed, 0), tone: rows.some(r => r.missed) ? 'bad' : undefined },
          ]} />
          <div className="wrap"><table>
            <thead><tr><th>Trường</th><th>Địa bàn</th><th>Được gán</th><th>Số PPCT</th><th>Lớp</th><th>Tiết đã dạy</th><th>Chậm</th><th>YCCĐ đạt</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.org_id}>
                <td><b>{r.school}</b></td><td><small>{r.area ?? '—'}</small></td>
                <td>{r.assigned ? <>✓{r.grades?.length ? <small> khối {r.grades.join(', ')}</small> : null}</> : '—'}</td>
                <td>{r.books || <span className="gpill warn">Chưa có</span>}</td><td>{r.classes}</td>
                <td>{r.lessons ? <>{r.done}/{r.lessons}<div className="progress" style={{ width: 90 }}><i style={{ width: pct(r.done, r.lessons) + '%' }} /></div></> : '—'}</td>
                <td>{r.missed ? <span className="gpill bad">{r.missed}</span> : 0}</td>
                <td>{r.outcomes ? `${r.outcomes_done}/${r.outcomes}` : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </>
  )
}
