import { Icon } from '../components/Icon'
import { YearSelect } from '../components/YearSelect'
import { CompetencySetupLink } from '../components/CompetencySetup'
import { useCompetencies, LV_NAME } from './competency'
import { useHiddenBtn } from '../components/PageButtons'
import { CustomInputs, customCell } from '../components/CustomFields'
import { fieldsOf, useSettings } from '../lib/settings'
import { MultiSelect, NumMultiSelect } from '../components/MultiSelect'
import { SchoolPicker } from '../components/SchoolPicker'
import { useOrgFilter } from '../components/OrgFilters'
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DataTable, SideSplit, type Col } from '../components/DataTable'
import { useGradeTree, MultiTag } from '../components/GradeTree'
import { Drawer } from '../components/Drawer'
import { supabase, fetchAll } from '../lib/supabase'
import { OrgPick, useAllMode, useAllOrgs } from '../components/OrgScope'
import { downloadXlsx, importSummary, norm, type Column } from '../lib/sheet'
import ImportExcel from '../components/ImportExcel'
import { Tiles } from './department/charts'
import { useStemTracks } from '../lib/stemTracks'
import { asLesson, lessonStats, LessonEditor, type ILesson } from '../lib/lessonBlocks'
import { useSubjects } from './subjects'
import { NameLink, SelBar, SelTd, SelTh, useRowSel } from '../components/TableSel'
import { ViewToggle, useViewMode } from '../components/ViewToggle'
import { fmtGrades, progGrades, useEduLevels, gradeName, gradeRange } from '../lib/eduLevels'
import { ChipMulti, GradeChecks, GradePicker, SubjectMulti, SubjectPicker, gradeList } from '../components/Pickers'
import { ElView } from '../components/ElView'
import { StatCards } from '../components/StatCards'

// Khái niệm (064): Chương trình → Học phần (unit 'topic', trước gọi là chủ đề; gắn Môn học qua edu_unit_subjects)
// → Bài học / Buổi học (gắn Học liệu qua edu_unit_materials) → Bài giảng (lesson_plans gắn unit_id, soạn ở "Soạn bài giảng").
// Chương trình giáo dục chuẩn (migration 058): danh mục + phiên bản, cấu trúc học phần → bài học → buổi học, yêu cầu cần đạt,
// gửi duyệt / phát hành / thay thế / ngừng dùng, gán cho trường và theo dõi độ phủ; trường tạo PPCT từ chương trình.
export type ProgMode = 'school' | 'authority' | 'platform'
type Status = 'draft' | 'pending' | 'approved' | 'rejected' | 'published' | 'superseded' | 'archived'
type Kind = 'subject' | 'stem' | 'school'
type Deploy = 'year' | 'hk1' | 'hk2'
type Level = string
type Program = {
  id: string; org_id: string; family_id: string; version_no: number; code: string | null; title: string; kind: Kind; ct_code: string | null
  level: Level; grade_from: number; grade_to: number; main_subject: string; integrated_subjects: string[]; objectives: string | null
  ct_codes: string[]; levels: string[]; main_subjects: string[]; grades: number[]
  competency_keys: string[]; rubric_ids: string[]; total_periods: number; status: Status; scope: 'own' | 'children'
  periods_per_week: number | null; deploy_term: Deploy
  effective_from: string | null; effective_to: string | null; replaced_by: string | null; source_id: string | null; builder?: string | null
  published_at: string | null; note: string | null; updated_at: string; organizations?: { name: string } | null
  custom?: Record<string, unknown> | null
}
type UnitType = 'topic' | 'lesson' | 'session'
type Unit = {
  id: string; program_id: string; parent_id: string | null; unit_type: UnitType; seq: number; grade: number | null; grades?: number[]; subject: string | null
  title: string; periods: number; objectives: string | null; content: string | null; lesson?: any
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

export const PKIND: Record<Kind, string> = { subject: 'Môn học', stem: 'Chương trình STEM', school: 'Chương trình nhà trường' }
export const PSTATUS: Record<Status, [string, string]> = {
  draft: ['Nháp', ''], pending: ['Nháp · chờ duyệt', 'warn'], approved: ['Nháp · đã duyệt', ''], rejected: ['Nháp · bị trả lại', 'bad'],
  published: ['Đã phát hành', 'good'], superseded: ['Ngừng dùng · có bản mới', 'off'], archived: ['Ngừng dùng', 'off'],
}
// Ba nhóm trạng thái người dùng thấy: Nháp (gồm chờ duyệt, bị trả lại) · Đã phát hành · Ngừng dùng (gồm bản đã có bản mới)
const SGROUP: Record<string, [string, Status[]]> = {
  draft: ['Nháp', ['draft', 'pending', 'approved', 'rejected']], published: ['Đã phát hành', ['published']], off: ['Ngừng dùng', ['superseded', 'archived']],
}
export const DEPLOY: Record<Deploy, [string, string]> = { year: ['Cả năm', 'tuần 1–35'], hk1: ['Học kỳ 1', 'tuần 1–18'], hk2: ['Học kỳ 2', 'tuần 19–35'] }
type USubject = { unit_id: string; subject_id: string; is_main: boolean; seq: number }
type UMaterial = { unit_id: string; item_id: string; seq: number; note: string | null; library_items?: { title: string; content: { type?: string; url?: string } | null } | null }
type MatOpt = { id: string; title: string; owner_org_id: string; status: string; content: { type?: string } | null }
// Bài học trong danh sách bài học (kho học liệu, library_items kind 'unit')
type LibUnit = { id: string; title: string; subject: string | null; grades: string | null; owner_org_id: string; status: string
  content: { objectives?: string | null; periods?: number | null; material_ids?: string[] } | null }
const MAT_ICON: Record<string, string> = { video: 'film', document: 'file', link: 'link', image: 'image', worksheet: 'fileText', lesson_plan: 'book', guide: 'book' }
const CHILD: Record<UnitType, UnitType | null> = { topic: 'lesson', lesson: 'session', session: null }
// 092: một học phần / bài thuộc nhiều khối; bản ghi cũ chỉ có grade
const unitGrades = (u: Pick<Unit, 'grade' | 'grades'>) => u.grades?.length ? u.grades : u.grade ? [u.grade] : []
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 058 trên Supabase.'
  : /row-level|42501/i.test(m) ? 'Bạn không có quyền thực hiện thao tác này.' : m)
const fmtD = (d: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN') : '—')
const grades = (p: Partial<Program>) => fmtGrades(progGrades(p))
// Đổi cấp học: giữ khối còn thuộc cấp mới, nếu không còn khối nào thì chọn hết khối của cấp
const gradesForLevels = (LV: Parameters<typeof gradeSpan>[0], lvs: string[], cur: number[]) => {
  const [a, b] = gradeSpan(LV, lvs); const keep = cur.filter(g => g >= a && g <= b)
  return keep.length ? keep : range(a, b)
}
// 089: nhiều nhóm / cấp học / môn chủ đạo (phần tử đầu là giá trị chính); bản ghi cũ chưa có mảng thì lấy cột đơn
const ctsOf = (p: Partial<Program>) => p.ct_codes?.length ? p.ct_codes : p.ct_code ? [p.ct_code] : []
const lvsOf = (p: Partial<Program>) => p.levels?.length ? p.levels : p.level ? [p.level] : []
const mainsOf = (p: Partial<Program>) => p.main_subjects?.length ? p.main_subjects : p.main_subject ? [p.main_subject] : []
const gradeSpan = (LV: Record<string, { grade_from: number; grade_to: number } | undefined>, lvs: string[]): [number, number] => {
  const ls = lvs.map(l => LV[l]).filter(Boolean) as { grade_from: number; grade_to: number }[]
  return ls.length ? [Math.min(...ls.map(l => l.grade_from)), Math.max(...ls.map(l => l.grade_to))] : [1, 12]
}
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
    // Quản trị hệ thống thao tác thay trường (100): sửa và ban hành được như Ban giám hiệu
    Promise.all([supabase.rpc('has_perm', { p_module: 'curriculum', p_action: 'edit' }), supabase.rpc('is_admin'), supabase.rpc('is_platform_admin')])
      .then(([p, a, pa]) => { setOk(!!p.data || !!pa.data); setAdmin(!!a.data || !!pa.data) })
  }, [mode])
  return { canEdit: ok, isAdmin: admin }
}

// ================= Danh sách chương trình =================
export function EduPrograms({ orgId, mode = 'school' }: { orgId: string | null; mode?: ProgMode; goTab?: (tab: string) => void }) {
  const hid = useHiddenBtn()
  const { canEdit, isAdmin } = useCanEdit(mode)
  const { name: levelName } = useEduLevels()
  const progFields = fieldsOf(useSettings(), 'program')
  const [list, setList] = useState<Program[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [card, setCard] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Program> | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const comps: Comp[] = useCompetencies('student')

  // Quản trị hệ thống: chương trình của tất cả đơn vị trong một danh sách, sửa thẳng; thêm mới chọn đơn vị trong form
  const every = useAllMode()
  const pickedSchool = !!form?.org_id && every?.find(o => o.id === form.org_id)?.type === 'school'
  async function load() {
    const { data, error } = await supabase.from('edu_programs').select('*, organizations(name)').order('title').order('version_no', { ascending: false })
    if (error) setMsg([errText(error.message), true])
    const rows = (data as Program[]) ?? []
    setList(rows)
  }
  useEffect(() => { load() }, [orgId])

  const all = list ?? []
  // Trạng thái, loại, môn, đơn vị tạo: lọc bằng "Lọc theo cột" của bảng
  const inCard = (p: Program) => !card || SGROUP[card][1].includes(p.status)
  const shown = all.filter(p => inCard(p) && (!q || norm([p.title, p.code, ...mainsOf(p), ...p.integrated_subjects].join(' ')).includes(norm(q))))
  const own = every ? shown : shown.filter(p => p.org_id === orgId)
  const shared = every ? [] : shown.filter(p => p.org_id !== orgId)
  // Cây Cấp → Khối bên trái mỗi bảng
  const gtOwn = useGradeTree('edu-programs', own, progGrades)
  const gtShared = useGradeTree('edu-programs-shared', shared, progGrades)

  async function copy(p: Program) {
    if (!confirm(`Sao chép "${p.title}" (phiên bản ${p.version_no}) về đơn vị thành bản nháp để điều chỉnh?`)) return
    const { data, error } = await supabase.rpc('edu_program_copy', { p_program: p.id, p_org: orgId })
    if (error) return setMsg([errText(error.message), true])
    setOpenId(data as string); load()
  }

  const sel = useRowSel(shared)
  const [view, setView] = useViewMode('chuong-trinh', 'list')
  if (openId) return <ProgramDetail id={openId} orgId={orgId} mode={mode} canEdit={canEdit} isAdmin={isAdmin}
    onOpen={setOpenId} onClose={() => { setOpenId(null); load() }} />

  const canCopy = canEdit
  const progCols: Col<Program>[] = [
    { key: 'name', label: 'Chương trình', fixed: true, values: p => [p.title], text: p => [p.code, p.title].join(' '),
      cell: p => <div className="eptitle"><NameLink onClick={() => setOpenId(p.id)}>{p.title}</NameLink>
        <small className="sub">{[p.code, 'v' + p.version_no, p.organizations?.name].filter(Boolean).join(' · ')}</small></div> },
    { key: 'grade', label: 'Khối', values: p => [grades(p)], text: p => grades(p), cell: p => <>{grades(p) || '—'}<br /><MultiTag grades={progGrades(p)} /></> },
    { key: 'group', label: 'Nhóm', values: p => ctsOf(p), text: p => ctsOf(p).join(' '), cell: p => ctsOf(p).length ? <span className="epgroups">{ctsOf(p).map(c => <span key={c} className="epgroup">{c}</span>)}</span> : '—' },
    { key: 'lv', label: 'Cấp', off: true, values: p => lvsOf(p).map(levelName), text: p => lvsOf(p).map(levelName).join(', '), cell: p => lvsOf(p).map(levelName).join(', ') || '—' },
    { key: 'kind', label: 'Loại', off: true, text: p => PKIND[p.kind], cell: p => PKIND[p.kind] },
    { key: 'subj', label: 'Môn', values: p => [...mainsOf(p), ...p.integrated_subjects], text: p => [...mainsOf(p), ...p.integrated_subjects].join(' '),
      cell: p => <>{mainsOf(p).join(', ')}{p.integrated_subjects.length > 0 && <small className="sub epsub">+ tích hợp {p.integrated_subjects.join(', ')}</small>}</> },
    { key: 'periods', label: 'Số tiết · triển khai', off: true, values: p => [p.total_periods ? p.total_periods + ' tiết' : '', DEPLOY[p.deploy_term ?? 'year']?.[0] ?? ''], text: p => String(p.total_periods || ''),
      cell: p => <>{p.total_periods || '—'}<br /><small className="sub">{[p.periods_per_week && `${p.periods_per_week} tiết/tuần`, DEPLOY[p.deploy_term ?? 'year']?.[0]].filter(Boolean).join(' · ')}</small></> },
    { key: 'scope', label: 'Phạm vi áp dụng', off: true, text: p => p.scope === 'own' ? 'Đơn vị tạo và đơn vị được gán' : 'Tất cả đơn vị trực thuộc',
      cell: p => p.scope === 'own' ? 'Đơn vị tạo và đơn vị được gán' : 'Tất cả đơn vị trực thuộc' },
    { key: 'org', label: 'Đơn vị tạo', off: true, text: p => p.organizations?.name ?? '', cell: p => p.organizations?.name ?? '—' },
    { key: 'status', label: 'Trạng thái', text: p => PSTATUS[p.status][0],
      cell: p => <><StatusPill s={p.status} /><small className="sub epsub nowrap">{p.status === 'published' && p.effective_from ? `Hiệu lực từ ${fmtD(p.effective_from)}` : `Cập nhật ${fmtD(p.updated_at)}`}</small></> },
    ...progFields.filter(x => x.column).map(x => ({ key: 'c_' + x.key, label: x.label, cell: (p: Program) => customCell(x, p.custom?.[x.key]) })),
    { key: 'upd', label: 'Cập nhật', off: true, text: p => fmtD(p.updated_at), cell: p => <small className="sub nowrap">{fmtD(p.updated_at)}</small> },
  ]
  const table = (rows: Program[], mine: boolean, left?: ReactNode, right?: ReactNode, empty?: ReactNode) => (
    <DataTable className="eptable" id={mine ? 'edu-programs-v5' : 'edu-programs-shared-v5'} rows={(mine ? gtOwn : gtShared).filter(rows)} rowKey={p => p.id} cols={progCols} left={left} right={right} empty={empty}
      aside={rows.length ? (mine ? gtOwn : gtShared).tree : undefined}
      head={!mine && canCopy ? { th: <span className="sronly">Chọn</span>, td: p => <input type="checkbox" checked={sel.is(p)} onChange={() => sel.toggle(p)} aria-label={'Chọn ' + p.title} /> } : undefined} />
  )
  const cards = (rows: Program[], mine: boolean) => (
    <div className="tilegrid wide">
      {rows.map((p, i) => (
        <div key={p.id} className={'tilewrap' + (!mine && sel.is(p) ? ' picked' : '')}>
          <button className="tile" onClick={() => setOpenId(p.id)}>
            <div className={'tileart art' + (i % 6)}>
              {ctsOf(p).length > 0 && <span className="progchip" style={{ background: 'var(--surface)', color: 'var(--navy)' }}>{ctsOf(p).join(' · ')}</span>}
              <span className="tilestatus"><StatusPill s={p.status} /></span>
              <span aria-hidden="true"><Icon n="book" size={36} /></span>
            </div>
            <div className="tilebody">
              <b>{p.title}</b>
              <small>{mainsOf(p).join(', ')}{p.integrated_subjects.length > 0 ? ' · tích hợp ' + p.integrated_subjects.join(', ') : ''}</small>
              <div className="tilemeta"><span>{lvsOf(p).map(levelName).join(', ')} · {grades(p)}</span><span>{PKIND[p.kind]}</span>{p.total_periods > 0 && <span>{p.total_periods} tiết</span>}{p.periods_per_week && <span>{p.periods_per_week} tiết/tuần</span>}<span>{DEPLOY[p.deploy_term ?? 'year']?.[0]}</span><span>v{p.version_no}</span></div>
              {(!mine || every) && <small>{p.organizations?.name ?? '—'}</small>}
            </div>
          </button>
          {!mine && canCopy && <label className="tilecheck"><input type="checkbox" checked={sel.is(p)} onChange={() => sel.toggle(p)} aria-label={'Chọn ' + p.title} /></label>}
        </div>
      ))}
    </div>
  )
  const show = (rows: Program[], mine: boolean, left?: ReactNode, right?: ReactNode, empty?: ReactNode) => view === 'cards'
    ? <>{(left || right) && <div className="tttools">{left && <div className="ttleft">{left}</div>}{right}</div>}{rows.length
      ? <SideSplit aside={(mine ? gtOwn : gtShared).tree}><div className="gtcards">{cards((mine ? gtOwn : gtShared).filter(rows), mine)}</div></SideSplit>
      : <p className="sub">{empty}</p>}</>
    : table(rows, mine, left, right, empty)
  if (form) return (
    <ElView back="Chương trình giáo dục" onBack={() => setForm(null)} title={'Thêm chương trình'}>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      <InfoTab p={form} isNew editable scopeEditable reqEditable mode={mode} comps={comps} orgId={orgId} pickedSchool={pickedSchool}
        onOrg={v => setForm({ ...form, org_id: v })} onCancel={() => setForm(null)}
        onError={m => setMsg([m, true])} onSaved={(_, id) => { setForm(null); setMsg(null); if (id) setOpenId(id); load() }} />
    </ElView>
  )
  return (
    <>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {!list ? <p className="sub">Đang tải…</p> : (
        <>
          {(() => {
            // Số trên thẻ: chương trình của đơn vị (cổng KDI: tất cả), theo ô tìm
            const base = all.filter(p => (every || p.org_id === orgId) && (!q || norm([p.title, p.code, ...mainsOf(p), ...p.integrated_subjects].join(' ')).includes(norm(q))))
            const n = (k: string) => base.filter(p => SGROUP[k][1].includes(p.status)).length
            const wait = base.filter(p => p.status === 'pending').length
            return <StatCards active={card} onPick={setCard} items={[
              { icon: 'book', value: base.length - n('off'), label: 'Chương trình', sub: `${new Set(base.flatMap(mainsOf)).size} môn` },
              { k: 'published', icon: 'checkCircle', tone: 'good', value: n('published'), label: 'Đã phát hành' },
              { k: 'draft', icon: 'edit', tone: wait ? 'warn' : '', value: n('draft'), label: 'Nháp', sub: wait ? `${wait} chờ duyệt` : undefined },
              { k: 'off', icon: 'pause', value: n('off'), label: 'Ngừng dùng' },
            ]} />
          })()}
          {!every && <h3>Của đơn vị ({own.length})</h3>}
          {show(own, true, <>
            <input placeholder="Tìm tên, mã, môn…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
            <small className="sub">{gtOwn.filter(own).length} chương trình</small>
          </>, <>
            <ViewToggle value={view} onChange={setView} />
            {canEdit && !hid('add') && <button type="button" className="primary ttadd" onClick={() => setForm({ level: 'thcs', levels: ['thcs'], kind: 'subject', grade_from: 6, grade_to: 9, grades: [6, 7, 8, 9], scope: mode === 'school' ? 'own' : 'children', integrated_subjects: [], competency_keys: [], rubric_ids: [], deploy_term: 'year' })}>+ Thêm chương trình</button>}
          </>, <small className="sub">Chưa có chương trình nào.{canEdit && ' Bấm "Thêm chương trình", hoặc sao chép chương trình dùng chung bên dưới.'}</small>)}
          {!every && <>
          <h3>Dùng chung / được gán ({shared.length})</h3>
          {shared.length ? show(shared, false, undefined, canCopy && <button type="button" className="primary ttadd" disabled={!sel.cur || !['published', 'superseded'].includes(sel.cur.status)} onClick={() => sel.cur && copy(sel.cur)}
            title={sel.cur ? undefined : 'Tick một chương trình bên dưới'}>Sao chép về đơn vị</button>) : <p className="sub">Chưa có chương trình nào do KDI hoặc cấp trên phát hành cho đơn vị.</p>}</>}
        </>
      )}
    </>
  )
}

// ================= Chi tiết một chương trình =================
type Tab = 'info' | 'assign'
function ProgramDetail({ id, orgId, mode, canEdit, isAdmin, onOpen, onClose }: {
  id: string; orgId: string | null; mode: ProgMode; canEdit: boolean; isAdmin: boolean; onOpen: (id: string) => void; onClose: () => void
}) {
  const hid = useHiddenBtn()
  const [p, setP] = useState<Program | null>(null)
  const [tab, setTab] = useState<Tab>('info')
  const comps: Comp[] = useCompetencies('student')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [mkBook, setMkBook] = useState<{ grade: number; subject: string; year: string; ppw: string } | null>(null)
  const { name: levelName } = useEduLevels()
  const [editInfo, setEditInfo] = useState(false)
  const [rev, setRev] = useState(0)

  async function load() {
    const { data, error } = await supabase.from('edu_programs').select('*, organizations(name)').eq('id', id).maybeSingle()
    if (error) setMsg([errText(error.message), true])
    setP(data as Program | null)
  }
  useEffect(() => { load(); setTab('info'); setEditInfo(false); setMsg(null) }, [id])
  const every = useAllMode()
  if (!p) return <><button className="linkbtn" onClick={onClose}>← Danh sách chương trình</button>{msg ? <p className="msg">{msg[0]}</p> : <p className="sub">Đang tải…</p>}</>

  const mine = p.org_id === orgId || !!every
  const editable = mine && canEdit && (p.status === 'draft' || p.status === 'rejected')
  const scopeEditable = mine && canEdit && p.status === 'published' && mode !== 'school'
  const tabs: [Tab, string][] = [['info', 'Chương trình'],
    ...(mode !== 'school' && (mine || p.status === 'published' || p.status === 'superseded') ? [['assign', 'Gán & triển khai'] as [Tab, string]] : [])]

  async function openMkBook() {
    if (!p) return
    let year = ''
    if (orgId) {
      const { data } = await supabase.from('academic_years').select('name').eq('org_id', orgId).eq('is_current', true).limit(1)
      year = ((data as { name: string }[]) ?? [])[0]?.name ?? ''
    }
    setMkBook({ grade: p.grade_from, subject: p.main_subject, year, ppw: p.periods_per_week ? String(p.periods_per_week) : '' })
  }
  async function createBook(e: React.FormEvent) {
    e.preventDefault(); if (!mkBook || !p) return
    const ppw = Number(mkBook.ppw.replace(',', '.'))
    const { error } = await supabase.rpc('curriculum_from_program', {
      p_program: p.id, p_grade: mkBook.grade, p_subject: mkBook.subject.trim() || null, p_year: mkBook.year.trim() || null, p_ppw: ppw > 0 ? ppw : null, p_org: orgId,
    })
    if (error) return setMsg([errText(error.message), true])
    setMkBook(null); setMsg(['Đã tạo PPCT nháp — xem ở Phân phối chương trình.', false])
  }

  // Xoá chương trình nháp (kèm học phần, yêu cầu cần đạt); bản đã gửi duyệt / phát hành thì ngừng dùng
  async function removeDraft() {
    if (!p || !confirm(`Xoá chương trình nháp "${p.title}" (v${p.version_no})? Toàn bộ học phần, bài và yêu cầu cần đạt của bản này cũng bị xoá.`)) return
    const { error } = await supabase.from('edu_programs').delete().eq('id', p.id)
    if (error) return setMsg([errText(error.message), true])
    onClose()
  }

  return (
    <>
      <div className="bar">
        <div>
          <button className="linkbtn" onClick={onClose}>← Danh sách chương trình</button>
          <h3 style={{ margin: '4px 0 0' }}>{p.title} <small>v{p.version_no}</small> <StatusPill s={p.status} /></h3>
          <small className="sub">{[p.code, lvsOf(p).map(levelName).join(', '), grades(p), PKIND[p.kind], ctsOf(p).join(', '), mainsOf(p).join(', '), `${p.total_periods} tiết`, !mine ? p.organizations?.name : null].filter(Boolean).join(' · ')}</small>
        </div>
        <div className="tools">
          {!editInfo && tab === 'info' && editable && <button type="button" onClick={() => setEditInfo(true)}><Icon n="pencil" size={15} /> Sửa thông tin</button>}
          {mode === 'school' && canEdit && p.status === 'published' && !hid('ppct') && <button className="primary" onClick={openMkBook}>Tạo PPCT từ chương trình</button>}
          {!editInfo && <VersionActions p={p} mine={mine} canEdit={canEdit} mode={mode} isAdmin={isAdmin} onOpen={onOpen} onChanged={load} onMessage={(m, e) => setMsg([m, !!e])} onDelete={editable ? removeDraft : undefined} />}
        </div>
      </div>
      {mkBook && (
        <form className="panel formgrid" onSubmit={createBook} style={{ marginBottom: 12 }}>
          <label className="field"><span>Khối</span><select value={mkBook.grade} onChange={e => setMkBook({ ...mkBook, grade: Number(e.target.value) })}>{progGrades(p).map(g => <option key={g} value={g}>Khối {g}</option>)}</select></label>
          <label className="field"><span>Môn</span><SubjectPicker level={p.level} value={mkBook.subject} onChange={v => setMkBook({ ...mkBook, subject: v })} extra={[...mainsOf(p), ...p.integrated_subjects]} /></label>
          <label className="field"><span>Năm học</span><YearSelect value={mkBook.year} onChange={v => setMkBook({ ...mkBook, year: v })} emptyLabel="Tất cả năm" /></label>
          <label className="field"><span>Số tiết / tuần</span><input inputMode="decimal" value={mkBook.ppw} onChange={e => setMkBook({ ...mkBook, ppw: e.target.value })} placeholder="VD: 1 hoặc 1,5" /></label>
          <div className="formactions"><button className="primary" type="submit">Tạo PPCT nháp</button> <button type="button" onClick={() => setMkBook(null)}>Huỷ</button></div>
        </form>
      )}
      <div className="segmented pdtabs">
        {tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {tab === 'info' && <InfoTab key={'i' + editInfo} p={p} editable={editable} forceEdit={editInfo} onEdit={() => setEditInfo(true)} onBack={() => setEditInfo(false)} rev={rev}
        lessons={<SubjectLessonsTab p={p} editable={editable} onChanged={() => { load(); setRev(r => r + 1) }} onMessage={(m, e) => setMsg([m, !!e])} />}
        versions={<VersionsTab p={p} onOpen={onOpen} compact />}
        onGoAssign={tabs.some(t => t[0] === 'assign') ? () => setTab('assign') : undefined}
        onDelete={editable ? removeDraft : undefined} scopeEditable={scopeEditable} reqEditable={mine && canEdit} mode={mode} comps={comps} onSaved={m => { setMsg([m, false]); setEditInfo(false); load() }} onError={m => setMsg([m, true])} />}
      {tab === 'assign' && <AssignTab p={p} orgId={orgId} mine={mine} onMessage={(m, e) => setMsg([m, !!e])} />}
    </>
  )
}

// ----- Thông tin -----
// Một form cho cả thêm mới và sửa: đủ tất cả thông tin chương trình, phạm vi & hiệu lực, yêu cầu năng lực giáo viên; một nút Lưu.
type Req = { competency: string; min_level: number }
type InfoProps = {
  p: Partial<Program>; isNew?: boolean; editable: boolean; scopeEditable: boolean; reqEditable?: boolean; mode: ProgMode; comps: Comp[]
  orgId?: string | null; pickedSchool?: boolean; onOrg?: (id: string) => void
  onSaved: (m: string, newId?: string) => void; onError: (m: string) => void; onDelete?: () => void; onGoAssign?: () => void; onCancel?: () => void
  /** Trang xem: khối Môn & bài học (cột chính) và Phiên bản (cột phải) */
  lessons?: React.ReactNode; versions?: React.ReactNode; rev?: number
  /** true: hiện form sửa; false: thẻ chỉ xem, bấm Sửa thì gọi onEdit để mở form ngay tại tab Thông tin */
  forceEdit?: boolean; onEdit?: () => void; onBack?: () => void
}
function InfoTab({ p, isNew, editable, scopeEditable, reqEditable, mode, comps, orgId, pickedSchool, onOrg, onSaved, onError, onDelete, onGoAssign, onCancel, lessons, versions, rev, forceEdit, onEdit, onBack }: InfoProps) {
  const [f, setF] = useState<Partial<Program>>(p)
  // Chương trình đã có: mặc định xem dạng thẻ; bấm Sửa mới mở form
  const editing = !!isNew || !!forceEdit
  const [lessonN, setLessonN] = useState<number | null>(null)
  useEffect(() => { if (p.id) supabase.from('edu_program_units').select('id', { count: 'exact', head: true }).eq('program_id', p.id).eq('unit_type', 'lesson').then(({ count }) => setLessonN(count ?? 0)) }, [p.id, p.updated_at, rev])
  const { byCode: tracks, allCodes: CT } = useStemTracks()
  const { byCode: LV, levels: LVL } = useEduLevels()
  const progFields = fieldsOf(useSettings(), 'program')
  const levelOpts: [string, string][] = LVL.map(l => [l.code, l.name])
  const [rubrics, setRubrics] = useState<Rubric[]>([])
  const tcomps = useCompetencies('teacher')
  const fam = p.family_id ?? p.id
  const [reqs0, setReqs0] = useState<Req[]>([])
  const [reqs, setReqs] = useState<Req[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!isNew) setF(p) }, [p])   // thêm mới: giữ nội dung đang nhập khi đổi đơn vị quản lý
  useEffect(() => { supabase.from('rubrics').select('id, title').order('title').then(({ data }) => setRubrics((data as Rubric[]) ?? [])) }, [])
  useEffect(() => {
    if (!fam) return
    supabase.from('edu_program_teacher_reqs').select('competency, min_level').eq('edu_family', fam).then(({ data }) => { const r = (data as Req[]) ?? []; setReqs0(r); setReqs(r) })
  }, [fam])
  const [asgN, setAsgN] = useState<number | null>(null)
  useEffect(() => { if (p.id) supabase.from('edu_program_assignments').select('id', { count: 'exact', head: true }).eq('program_id', p.id).then(({ count }) => setAsgN(count ?? 0)) }, [p.id])
  const orgs = useAllOrgs()
  const allMode = useAllMode()
  const builders = useMemo(() => [...new Set(['KDI Education', ...(orgs ?? []).filter(o => !o.is_platform && o.type !== 'school').map(o => o.name)])], [orgs])

  const dis = !editable
  const scopeEdit = editable || scopeEditable
  const reqEdit = editable || !!reqEditable
  const canSave = editable || scopeEditable || !!reqEditable
  const span = gradeSpan(LV, lvsOf(f as Program))
  const trackSubjects = f.kind === 'stem' ? ctsOf(f as Program).flatMap(c => tracks[c]?.subjects ?? []) : []
  const today = new Date().toISOString().slice(0, 10)
  const effNote = p.effective_to && p.effective_to < today ? 'Hết hiệu lực' : p.effective_from && p.effective_from > today ? 'Chưa đến ngày hiệu lực' : ''
  const showScope = mode !== 'school' && !pickedSchool
  // Đơn vị quản lý (chỉ chọn khi Quản trị hệ thống thêm mới): mặc định theo đơn vị xây dựng, chọn tay thì thôi đi theo
  const orgPick = !!(isNew && onOrg && allMode)
  const [orgTouched, setOrgTouched] = useState(false)
  const setOrg = (id: string) => { setF(x => ({ ...x, org_id: id })); onOrg?.(id) }
  const pickBuilder = (v: string) => {
    setF(x => ({ ...x, builder: v }))
    const k = v.trim().toLowerCase(), hit = k && (orgs ?? []).find(o => o.name.trim().toLowerCase() === k)
    if (orgPick && !orgTouched && hit) setOrg(hit.id)
  }
  useEffect(() => {   // thêm mới: điền sẵn đơn vị xây dựng bằng tên đơn vị đang làm việc
    if (!isNew || f.builder || !orgs) return
    const own = orgs.find(o => o.id === (f.org_id || orgId))
    if (own && !own.is_platform) setF(x => x.builder ? x : { ...x, builder: own.name })
  }, [isNew, orgs])
  const reqDirty = JSON.stringify(reqs) !== JSON.stringify(reqs0)
  const integ = f.integrated_subjects ?? []

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (f.effective_from && f.effective_to && f.effective_to < f.effective_from) return onError('Ngày hết hiệu lực phải sau ngày bắt đầu.')
    if (reqs.some(r => !r.competency)) return onError('Chọn năng lực cho tất cả dòng yêu cầu năng lực giáo viên.')
    const scopePart = { ...(showScope ? { scope: f.scope ?? 'children' } : isNew ? { scope: 'own' as const } : {}),
      effective_from: f.effective_from || null, effective_to: f.effective_to || null, builder: f.builder?.trim() || null }
    let body: Record<string, unknown> | null = null
    if (editable) {
      const cts = ctsOf(f as Program), lvs = lvsOf(f as Program), mains = mainsOf(f as Program)
      if (!(f.title ?? '').trim()) return onError('Nhập tên chương trình.')
      if (!cts.length || !lvs.length || !mains.length) return onError('Chọn ít nhất một nhóm chương trình, một cấp học và một môn chủ đạo.')
      const gs = progGrades(f as Program).filter(g => g >= span[0] && g <= span[1])
      if (!gs.length) return onError('Chọn ít nhất một khối.')
      body = {
        code: f.code?.trim() || null, title: (f.title ?? '').trim(), kind: f.kind ?? 'subject', ct_codes: cts, ct_code: cts[0], levels: lvs, level: lvs[0],
        main_subjects: mains, main_subject: mains[0], periods_per_week: f.periods_per_week ? Number(f.periods_per_week) : null, deploy_term: f.deploy_term ?? 'year',
        grades: gs, grade_from: gs[0], grade_to: gs[gs.length - 1], integrated_subjects: integ.filter(x => !mains.includes(x)), objectives: f.objectives?.trim() || null,
        competency_keys: f.competency_keys ?? [], rubric_ids: f.rubric_ids ?? [], note: f.note?.trim() || null,
        ...(progFields.length ? { custom: f.custom ?? {} } : {}), ...scopePart,
      }
    } else if (scopeEditable) body = scopePart
    setBusy(true)
    let id = p.id
    if (isNew) {
      const { data, error } = await supabase.from('edu_programs').insert({ ...body, org_id: f.org_id || orgId }).select('id').single()
      if (error) { setBusy(false); return onError(errText(error.message)) }
      id = (data as { id: string }).id
    } else if (body) {
      const { error } = await supabase.from('edu_programs').update(body).eq('id', p.id!)
      if (error) { setBusy(false); return onError(errText(error.message)) }
    }
    if (reqEdit && id && (isNew ? reqs.length > 0 : reqDirty)) {
      const { error } = await supabase.rpc('edu_program_set_teacher_reqs', { p_program: id, p_reqs: reqs })
      if (error) { setBusy(false); return onError((isNew ? 'Đã tạo chương trình nhưng chưa lưu được yêu cầu năng lực giáo viên: ' : '') + errText(error.message)) }
      setReqs0(reqs)
    }
    setBusy(false)
    onSaved(isNew ? 'Đã tạo chương trình nháp.' : 'Đã lưu chương trình.', isNew ? id : undefined)
  }

  const S = (n: number) => ({ gridColumn: `span ${n}` })
  if (!isNew && !editing) {
    const q = p as Program
    const mains = mainsOf(q), integs = q.integrated_subjects ?? []
    const nameOf = (list: { key?: string; id?: string; name?: string; title?: string }[], k: string) => { const x = list.find(o => (o.key ?? o.id) === k); return x?.name ?? x?.title ?? k }
    const edit = () => onEdit?.()
    const nSubj = mains.length + integs.filter(x => !mains.includes(x)).length
    const dep = DEPLOY[q.deploy_term ?? 'year']
    const none = <span className="sub">Chưa có</span>
    const chips = (xs: string[]) => xs.length ? <span className="pvchips">{xs.map(x => <span key={x} className="pill">{x}</span>)}</span> : none
    return <>
      <div className="pdgrid">
        <div className="pdmain">
          <div className="pdstats">
            <div><b>{nSubj}</b><span>môn</span></div>
            <div><b>{lessonN ?? '…'}</b><span>bài học</span></div>
            <div><b>{q.total_periods ?? 0}</b><span>tiết{q.periods_per_week != null ? ` · ${String(q.periods_per_week).replace('.', ',')} tiết/tuần` : ''}</span></div>
            <div><b>{dep?.[0] ?? '—'}</b><span>{dep?.[1] ?? 'thời gian triển khai'}</span></div>
            {mode !== 'school' && <div><b>{asgN ?? '…'}</b><span>đơn vị được gán</span></div>}
          </div>
          <div className="panel pdcard pdsl"><h4>Môn & bài học</h4>{lessons}</div>
        </div>
        <div className="pdside">
          <div className="panel pdcard"><h4>Thông tin chung</h4>
            <dl className="pddl sm">
              <dt>Mã</dt><dd>{q.code || none}</dd>
              <dt>Nhóm</dt><dd>{ctsOf(q).map(c => c + (tracks[c] ? ' · ' + tracks[c]!.name : '')).join(', ') || '—'}</dd>
              <dt>Loại</dt><dd>{PKIND[q.kind]}</dd>
              <dt>Cấp · khối</dt><dd>{lvsOf(q).map(c => LV[c]?.name ?? c).join(', ')}{progGrades(q).length ? ' · ' + progGrades(q).join(', ') : ''}</dd>
              <dt>Môn chủ đạo</dt><dd>{mains.join(', ') || '—'}</dd>
              {integs.length > 0 && <><dt>Môn tích hợp</dt><dd>{integs.join(', ')}</dd></>}
              <dt>Xây dựng</dt><dd>{q.builder || '—'}</dd>
            </dl>
          </div>
          <div className="panel pdcard"><h4>Mục tiêu & đánh giá</h4>
            <dl className="pddl sm">
              <dt>Mục tiêu</dt><dd style={{ whiteSpace: 'pre-line' }}>{q.objectives || <span className="sub">Chưa nhập{editable ? ' · bấm “Sửa thông tin” để thêm' : ''}</span>}</dd>
              <dt>Năng lực học sinh</dt><dd>{chips((q.competency_keys ?? []).map(k => nameOf(comps, k)))}</dd>
              <dt>Tiêu chí đánh giá</dt><dd>{chips((q.rubric_ids ?? []).map(k => nameOf(rubrics, k)))}</dd>
              {progFields.map(x => <Fragment key={x.key}><dt>{x.label}</dt><dd>{customCell(x, q.custom?.[x.key]) ?? '—'}</dd></Fragment>)}
              {q.note && <><dt>Ghi chú</dt><dd style={{ whiteSpace: 'pre-line' }}>{q.note}</dd></>}
            </dl>
          </div>
          <div className="panel pdcard"><h4>Năng lực giáo viên
            {!editable && reqEditable && <button type="button" className="linkbtn" onClick={edit}>Điều chỉnh ›</button>}</h4>
            {reqs0.length ? <div className="pvchips">{reqs0.map(r => <span key={r.competency} className="pill">{nameOf(tcomps, r.competency)} · từ Mức {r.min_level}</span>)}</div>
              : <small className="sub">Chưa đặt yêu cầu: chỉ giáo viên Đạt khoá đào tạo có gắn chương trình mới được tính đáp ứng.</small>}
          </div>
          <div className="panel pdcard"><h4>Phạm vi & hiệu lực {effNote && <span className={'pill ' + (effNote.startsWith('Hết') ? 'bad' : 'warn')}>{effNote}</span>}
            {!editable && scopeEditable && <button type="button" className="linkbtn" onClick={edit}>Điều chỉnh ›</button>}</h4>
            <dl className="pddl sm">
              {showScope && <><dt>Áp dụng</dt><dd>{q.scope === 'own' ? 'Chỉ đơn vị mình và đơn vị được gán' : 'Tất cả đơn vị trực thuộc'}</dd></>}
              <dt>Hiệu lực</dt><dd>{q.effective_from ? 'Từ ' + fmtD(q.effective_from) : 'Chưa đặt'}{q.effective_to ? ' đến ' + fmtD(q.effective_to) : ''}</dd>
              {mode !== 'school' && <><dt>Được gán</dt><dd>{asgN ?? '…'} đơn vị{onGoAssign && <> · <button type="button" className="linkbtn" onClick={onGoAssign}>Gán thêm ›</button></>}</dd></>}
            </dl>
          </div>
          {versions && <div className="panel pdcard"><h4>Phiên bản</h4>{versions}</div>}
        </div>
      </div>
    </>
  }
  const cts1 = ctsOf(f as Program), lvs1 = lvsOf(f as Program), mains1 = mainsOf(f as Program)
  const gs1 = progGrades(f as Program).filter(g => g >= span[0] && g <= span[1])
  const missing = [!(f.title ?? '').trim() && 'Tên chương trình', !lvs1.length && 'Cấp học', !gs1.length && 'Khối', !cts1.length && 'Nhóm chương trình', !mains1.length && 'Môn chủ đạo'].filter(Boolean) as string[]
  const gradeOpts = span[1] >= span[0] ? gradeRange(span[0], span[1]) : []
  const togGrade = (g: number) => { const cur = progGrades(f as Program); setF({ ...f, grades: cur.includes(g) ? cur.filter(x => x !== g) : [...cur, g].sort((a, b) => a - b) }) }
  const secs: [string, string, boolean][] = [
    ['pf-1', 'Thông tin cơ bản', !missing.length],
    ['pf-2', 'Mục tiêu & đánh giá', !!(f.objectives?.trim() || f.competency_keys?.length || f.rubric_ids?.length)],
    ['pf-3', 'Năng lực giáo viên', reqs.length > 0],
    ['pf-4', 'Đơn vị & phạm vi', !!f.builder?.trim()],
  ]
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const cancelBtn = onCancel ? <button type="button" onClick={onCancel}>Huỷ</button>
    : !isNew ? <button type="button" onClick={() => { setF(p); setReqs(reqs0); onBack?.() }}>Huỷ</button> : null
  const saveBtn = canSave && <button className="primary" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : isNew ? 'Tạo bản nháp' : 'Lưu thay đổi'}</button>
  const Seg = <T extends string>({ value, opts, onPick, off }: { value: T; opts: [T, string][]; onPick: (v: T) => void; off?: boolean }) =>
    <div className="pfseg" role="radiogroup">{opts.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} disabled={off} onClick={() => onPick(k)}>{l}</button>)}</div>
  return <form className="pform pfwrap" onSubmit={save}>
    <nav className="panel pfnav" aria-label="Các phần của form">
      {secs.map(([id, t, ok], i) => <button key={id} type="button" className={ok ? 'ok' : ''} onClick={() => go(id)}><i>{ok ? '✓' : i + 1}</i>{t}</button>)}
    </nav>
    <div className="pfmain">
      {!isNew && !editable && <p className="sub" style={{ margin: 0 }}>{p.status === 'draft' || p.status === 'rejected' ? 'Bạn chỉ xem được chương trình này.' : 'Chương trình đã gửi duyệt hoặc phát hành: nội dung không sửa được (bấm "Tạo phiên bản mới" ở đầu trang). Năng lực giáo viên, đơn vị, phạm vi và hiệu lực vẫn sửa được.'}</p>}

      <section id="pf-1" className="panel pfcard">
        <h4><i>1</i>Thông tin cơ bản</h4><p className="pfhint">Mục chọn đầu tiên là mục chính. Mỗi môn chủ đạo thành một nhóm bài học.</p>
        <div className="pgrid">
          <label className="field" style={S(6)}><span>Tên chương trình *</span><input disabled={dis} value={f.title ?? ''} onChange={e => setF({ ...f, title: e.target.value })} placeholder="VD: Tin học THCS (CT GDPT 2018)" /></label>
          <label className="field" style={S(2)}><span>Mã chương trình</span><input disabled={dis} value={f.code ?? ''} onChange={e => setF({ ...f, code: e.target.value })} placeholder="VD: TIN-THCS" /></label>
          <label className="field" style={S(4)}><span>Loại chương trình</span><select disabled={dis} value={f.kind ?? 'subject'} onChange={e => setF({ ...f, kind: e.target.value as Kind })}>{(Object.keys(PKIND) as Kind[]).map(k => <option key={k} value={k}>{PKIND[k]}</option>)}</select></label>
          <div className="field" style={S(6)}><span>Cấp học *</span>
            <ChipMulti disabled={dis} value={lvs1} onChange={v => setF({ ...f, levels: v, level: v[0] ?? f.level, grades: gradesForLevels(LV, v, progGrades(f as Program)) })} options={levelOpts} ariaLabel="Cấp học" firstHint="Cấp học chính" /></div>
          <div className="field" style={S(6)}><span>Khối *</span>
            {gradeOpts.length ? <div className="pftog">{gradeOpts.map(g => <button key={g} type="button" disabled={dis} aria-pressed={gs1.includes(g)} className={gs1.includes(g) ? 'on' : ''} onClick={() => togGrade(g)} title={gradeName(g)}>{g}</button>)}
              {!dis && gs1.length < gradeOpts.length && <button type="button" className="linkbtn" onClick={() => setF({ ...f, grades: gradeOpts })}>Chọn cả cấp</button>}</div>
              : <GradeChecks disabled={dis} from={span[0]} to={span[1]} value={progGrades(f as Program)} onChange={g => setF({ ...f, grades: g })} />}</div>
          <div className="field" style={S(12)}><span>Nhóm chương trình *</span>
            <ChipMulti disabled={dis} value={cts1} onChange={v => setF({ ...f, ct_codes: v, ct_code: v[0] ?? null })} options={CT.map(c => [c, `${c}${tracks[c] ? ' · ' + tracks[c]!.name : ''}`])} ariaLabel="Nhóm chương trình" firstHint="Nhóm chính" /></div>
          <div className="field" style={S(6)}><span>Môn chủ đạo *</span>
            <SubjectMulti primary="chính" disabled={dis} level={lvs1.length === 1 ? lvs1[0] : null} value={mains1}
              onChange={v => setF({ ...f, main_subjects: v, main_subject: v[0] ?? '', integrated_subjects: integ.filter(x => !v.includes(x)) })} extra={trackSubjects} /></div>
          <div className="field" style={S(6)}><span>Môn tích hợp</span><SubjectMulti disabled={dis} level={lvs1.length === 1 ? lvs1[0] : null} value={integ}
            onChange={v => setF({ ...f, integrated_subjects: v })} exclude={mains1} extra={trackSubjects} /></div>
          <label className="field" style={S(3)}><span>Số tiết / tuần</span><input disabled={dis} type="number" min={0.5} max={40} step={0.5} value={f.periods_per_week ?? ''} onChange={e => setF({ ...f, periods_per_week: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="VD: 2" title="Dùng làm mặc định khi tạo phân phối chương trình" /></label>
          <div className="field" style={S(9)}><span>Thời gian triển khai</span>
            <Seg value={(f.deploy_term ?? 'year') as Deploy} off={dis} onPick={d => setF({ ...f, deploy_term: d })} opts={(Object.keys(DEPLOY) as Deploy[]).map(d => [d, `${DEPLOY[d][0]} · ${DEPLOY[d][1]}`])} /></div>
        </div>
      </section>

      <section id="pf-2" className="panel pfcard">
        <h4><i>2</i>Mục tiêu & đánh giá</h4><p className="pfhint">Không bắt buộc. Có thể bổ sung sau.</p>
        <div className="pgrid">
          <label className="field" style={S(12)}><span>Mục tiêu chương trình</span><textarea disabled={dis} rows={2} value={f.objectives ?? ''} onChange={e => setF({ ...f, objectives: e.target.value })} placeholder="Học sinh hoàn thành chương trình sẽ…" /></label>
          <div className="field" style={S(6)}><span>Năng lực học sinh {editable && <CompetencySetupLink audience="student" />}</span>
            <MultiSelect disabled={dis} value={f.competency_keys ?? []} onChange={v => setF({ ...f, competency_keys: v })} options={comps.map(c => [c.key, c.name])}
              placeholder="Chọn năng lực…" ariaLabel="Khung năng lực" empty="Chưa có khung năng lực." /></div>
          <div className="field" style={S(6)}><span>Tiêu chí đánh giá (rubric)</span>
            <MultiSelect disabled={dis} value={f.rubric_ids ?? []} onChange={v => setF({ ...f, rubric_ids: v })} placeholder="Chọn rubric…" ariaLabel="Rubric" empty="Chưa có rubric nào."
              options={[...rubrics.map(r => [r.id, r.title] as [string, string]), ...(f.rubric_ids ?? []).filter(id => !rubrics.some(r => r.id === id)).map(id => [id, 'Rubric'] as [string, string])]} /></div>
          <label className="field" style={S(12)}><span>Ghi chú</span><textarea disabled={dis} rows={1} value={f.note ?? ''} onChange={e => setF({ ...f, note: e.target.value })} /></label>
          {progFields.length > 0 && <div style={{ gridColumn: '1/-1' }} className="formgrid"><CustomInputs disabled={dis} fields={progFields} value={f.custom ?? {}} onChange={v => setF({ ...f, custom: v })} /></div>}
        </div>
      </section>

      <section id="pf-3" className="panel pfcard">
        <h4><i>3</i>Yêu cầu năng lực giáo viên</h4>
        <p className="pfhint">Giáo viên đáp ứng khi Đạt khoá đào tạo có gắn chương trình, hoặc khi đạt đủ các mức dưới đây
          (mức cao hơn giữa lần trường đánh giá gần nhất và mức đạt qua các khoá đào tạo; tự đánh giá không tính).</p>
        {reqs.length > 0 && <table className="pfreqs"><thead><tr><th>Năng lực</th><th>Mức tối thiểu</th><th /></tr></thead><tbody>
          {reqs.map((r, i) => <tr key={i}>
            <td><select disabled={!reqEdit} value={r.competency} aria-label={`Năng lực ${i + 1}`} onChange={e => setReqs(reqs.map((x, j) => j === i ? { ...x, competency: e.target.value } : x))}>
              <option value="">Chọn năng lực…</option>
              {tcomps.filter(c => c.key === r.competency || !reqs.some(x => x.competency === c.key)).map(c => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select></td>
            <td><div className="pflv" role="radiogroup" aria-label={`Mức tối thiểu ${i + 1}`}>{[1, 2, 3, 4].map(l => <button key={l} type="button" role="radio" aria-checked={r.min_level === l} disabled={!reqEdit}
              className={r.min_level === l ? 'on' : r.min_level > l ? 'in' : ''} title={`Từ Mức ${l} · ${LV_NAME[l - 1]}`} onClick={() => setReqs(reqs.map((x, j) => j === i ? { ...x, min_level: l } : x))}>{l}</button>)}
              <small className="sub">{LV_NAME[r.min_level - 1]}</small></div></td>
            <td>{reqEdit && <button type="button" className="x" aria-label="Bỏ yêu cầu" onClick={() => setReqs(reqs.filter((_, j) => j !== i))}>×</button>}</td>
          </tr>)}
        </tbody></table>}
        {!reqs.length && <small className="sub">Chưa đặt yêu cầu: chỉ giáo viên Đạt khoá đào tạo có gắn chương trình mới được tính đáp ứng.</small>}
        {reqEdit && tcomps.some(c => !reqs.some(r => r.competency === c.key)) && <div className="pfadd"><button type="button" className="linkbtn"
          onClick={() => { const c = tcomps.find(c => !reqs.some(r => r.competency === c.key)); if (c) setReqs([...reqs, { competency: c.key, min_level: 2 }]) }}>+ Thêm năng lực</button>
          {reqs.length === 0 && <> · <button type="button" className="linkbtn" onClick={() => setReqs(tcomps.map(c => ({ competency: c.key, min_level: 2 })))}>Thêm tất cả năng lực (Mức 2)</button></>}</div>}
      </section>

      <section id="pf-4" className="panel pfcard">
        <h4><i>4</i>Đơn vị, phạm vi & hiệu lực {effNote && <span className={'pill ' + (effNote.startsWith('Hết') ? 'bad' : 'warn')}>{effNote}</span>}</h4>
        <p className="pfhint">Vẫn sửa được sau khi phát hành.</p>
        <div className="pgrid">
          <label className="field" style={S(showScope ? 5 : 6)}><span>Đơn vị xây dựng <small className="sub">(nơi biên soạn nội dung)</small></span>
            <input list="edu-builders" maxLength={200} disabled={!scopeEdit} value={f.builder ?? ''} onChange={e => pickBuilder(e.target.value)} placeholder="KDI Education, Sở GD&ĐT…, Trường…" />
            <datalist id="edu-builders">{builders.map(b => <option key={b} value={b} />)}</datalist></label>
          {orgPick && <div style={S(showScope ? 7 : 6)}><OrgPick kind="any" title="Đơn vị quản lý" value={f.org_id ?? orgId ?? ''} onChange={v => { setOrgTouched(true); setOrg(v) }} />
            <small className="sub">Đơn vị sở hữu, sửa và phát hành chương trình. Mặc định theo đơn vị xây dựng.</small></div>}
          {showScope && <div className="field" style={S(orgPick ? 12 : 7)}><span>Áp dụng cho</span>
            <Seg value={(f.scope ?? 'children') as Program['scope']} off={!scopeEdit} onPick={v => setF({ ...f, scope: v })} opts={[['children', 'Tất cả đơn vị trực thuộc'], ['own', 'Chỉ đơn vị mình và đơn vị được gán']]} /></div>}
          <label className="field" style={S(4)}><span>Hiệu lực từ</span><input disabled={!scopeEdit} type="date" value={f.effective_from ?? ''} onChange={e => setF({ ...f, effective_from: e.target.value || null })} /></label>
          <label className="field" style={S(4)}><span>Hiệu lực đến <small className="sub">(để trống = không hạn)</small></span><input disabled={!scopeEdit} type="date" min={f.effective_from ?? undefined} value={f.effective_to ?? ''} onChange={e => setF({ ...f, effective_to: e.target.value || null })} /></label>
          {!isNew && mode !== 'school' && <div className="field" style={S(4)}><span>Đơn vị được gán</span>
            <div className="pfasg"><b>{asgN ?? '…'}</b> đơn vị{onGoAssign && <button type="button" className="linkbtn" onClick={onGoAssign}>Gán cho đơn vị →</button>}</div></div>}
        </div>
      </section>

    </div>

    <aside className="pfside">
      <div className="panel pdcard">
        <h4>Xem nhanh</h4>
        <dl className="pddl sm">
          <dt>Tên</dt><dd><b>{f.title?.trim() || '—'}</b></dd>
          <dt>Đối tượng</dt><dd>{[lvs1.map(l => LV[l]?.name ?? l).join(', '), gs1.length ? fmtGrades(gs1) : ''].filter(Boolean).join(' · ') || '—'}</dd>
          <dt>Nhóm</dt><dd>{cts1.length ? cts1.map((c, i) => i === 0 && cts1.length > 1 ? c + ' (chính)' : c).join(', ') : '—'}</dd>
          <dt>Môn chủ đạo</dt><dd>{mains1.length ? mains1.map((c, i) => i === 0 && mains1.length > 1 ? c + ' (chính)' : c).join(', ') : '—'}</dd>
          <dt>Thời lượng</dt><dd>{[f.periods_per_week ? `${f.periods_per_week} tiết/tuần` : '', DEPLOY[(f.deploy_term ?? 'year') as Deploy]?.[0]].filter(Boolean).join(' · ')}</dd>
          {showScope && <><dt>Áp dụng</dt><dd>{f.scope === 'own' ? 'Đơn vị mình và đơn vị được gán' : 'Tất cả đơn vị trực thuộc'}</dd></>}
        </dl>
        {editable && (missing.length ? <p className="pfmiss">Còn thiếu: {missing.join(', ')}</p> : <p className="pfok">✓ Đã đủ thông tin bắt buộc</p>)}
        {(canSave || cancelBtn || onDelete) && <div className="pfsidebtn">{saveBtn}{cancelBtn}
          {onDelete && <button type="button" className="danger" onClick={onDelete} title="Xoá bản nháp">Xoá</button>}</div>}
      </div>
    </aside>
  </form>
}


// ----- Môn & bài học: chương trình → môn → bài học (không qua học phần) -----
// Bài cũ nằm trong học phần vẫn hiện, môn lấy theo học phần; tên học phần hiện ở cột "Chủ đề" (ẩn mặc định).
type LRow = { u: Unit; subject: string; topic: string; outs: Outcome[] }
type PasteRow = { title: string; grades: number[]; periods: number; outs: string[]; lib?: LibUnit }
const stripNo = (s: string) => s.replace(/^\s*(bài|bai|tiết|tiet|buổi|buoi)?\s*\d+\s*[.:)\-–]\s*/i, '').trim()
export function parseLessonLines(text: string, fallbackGrades: number[]): PasteRow[] {
  return text.split(/\r?\n/).map(l => l.split('\t')).map(c => {
    const title = stripNo(c[0] ?? '')
    const g = gradeList(String(c[1] ?? '')).filter(x => x >= 1 && x <= 12)
    const n = Number(String(c[2] ?? '').replace(',', '.'))
    return { title, grades: g.length ? g : fallbackGrades, periods: Number.isFinite(n) && n > 0 ? Math.round(n) : 1,
      outs: String(c[3] ?? '').split(/;|\n/).map(s => s.trim()).filter(Boolean) }
  }).filter(r => r.title)
}

const LIMPORT: Column[] = [
  { key: 'subject', label: 'Môn', aliases: ['Môn học'], width: 16 },
  { key: 'grade', label: 'Khối', width: 8 },
  { key: 'title', label: 'Tên bài', required: true, aliases: ['Tên bài học', 'Bài học', 'Tên'], width: 44 },
  { key: 'periods', label: 'Số tiết', aliases: ['Tiết'], width: 8 },
  { key: 'outcomes', label: 'Yêu cầu cần đạt', aliases: ['YCCĐ', 'Yêu cầu'], width: 50 },
]

/** Chi tiết một bài: mục tiêu, yêu cầu cần đạt, học liệu gắn, buổi học và nội dung (trước ở tab Thiết lập) */
function LessonDetail({ u, p, all, umats, outs, editable, onClose, onChanged, onMessage }: {
  u: Unit; p: Program; all: Unit[]; umats: UMaterial[]; outs: Outcome[]; editable: boolean; onClose: () => void; onChanged: () => void; onMessage: (m: string, err?: boolean) => void
}) {
  const [matOpts, setMatOpts] = useState<MatOpt[] | null>(null)
  const [pick, setPick] = useState({ item: '', note: '' })
  const [lessonOf, setLessonOf] = useState<Unit | null>(null)
  useEffect(() => {
    if (!editable) return
    supabase.from('library_items').select('id, title, owner_org_id, status, content').eq('kind', 'material').neq('status', 'archived').order('title')
      .then(({ data }) => setMatOpts(((data as MatOpt[]) ?? []).filter(m => m.status === 'published' || m.owner_org_id === p.org_id)))
  }, [editable])
  const sessions = all.filter(c => c.parent_id === u.id && c.unit_type === 'session').sort((a, b) => a.seq - b.seq)
  const mine = umats.filter(x => x.unit_id === u.id)
  const myOuts = outs.filter(o => o.unit_id === u.id).sort((a, b) => a.seq - b.seq)
  const run = async (q: PromiseLike<{ error: { message: string } | null }>) => { const { error } = await q; if (error) { onMessage(errText(error.message), true); return false } onChanged(); return true }
  const upd = (id: string, patch: Partial<Unit>) => run(supabase.from('edu_program_units').update(patch).eq('id', id))
  async function saveOuts(text: string) {
    const list = text.split(/\n|;/).map(x => x.trim()).filter(Boolean)
    if (myOuts.map(o => o.content).join('\n') === list.join('\n')) return
    if (myOuts.length && !(await run(supabase.from('edu_outcomes').delete().in('id', myOuts.map(o => o.id))))) return
    if (list.length) await run(supabase.from('edu_outcomes').insert(list.map((content, i) => ({ program_id: p.id, unit_id: u.id, seq: i + 1, content }))))
  }
  async function addMat() {
    if (!pick.item) return
    const seq = mine.reduce((m, x) => Math.max(m, x.seq), 0) + 1
    if (await run(supabase.from('edu_unit_materials').insert({ unit_id: u.id, item_id: pick.item, seq, note: pick.note.trim() || null }))) setPick({ item: '', note: '' })
  }
  const addSession = () => run(supabase.from('edu_program_units').insert({ program_id: p.id, parent_id: u.id, unit_type: 'session', seq: sessions.reduce((m, x) => Math.max(m, x.seq), 0) + 1,
    grades: unitGrades(u), subject: u.subject, title: `Buổi ${sessions.length + 1}`, periods: 1 }))
  const delSession = (x: Unit) => confirm(`Xoá "${x.title}"?`) && run(supabase.from('edu_program_units').delete().eq('id', x.id))
  const lessonBtn = (x: Unit) => (editable || asLesson(x.lesson)) && <button type="button" onClick={() => setLessonOf(x)}>
    {editable ? 'Soạn nội dung' : 'Xem nội dung'}{asLesson(x.lesson) ? ` · ${lessonStats(asLesson(x.lesson)).blocks} khối` : ''}</button>
  return <Drawer wide title={u.title} onClose={onClose}>
    <p className="sub" style={{ marginTop: 0 }}>{[u.subject, unitGrades(u).length ? 'Khối ' + unitGrades(u).join(', ') : '', u.periods ? `${u.periods} tiết` : ''].filter(Boolean).join(' · ')}</p>
    <div className="lddet">
      <label className="field"><span>Mục tiêu</span>{editable
        ? <textarea rows={2} defaultValue={u.objectives ?? ''} onBlur={e => e.target.value.trim() !== (u.objectives ?? '') && upd(u.id, { objectives: e.target.value.trim() || null })} />
        : <div>{u.objectives || '—'}</div>}</label>
      <label className="field"><span>Yêu cầu cần đạt <small className="sub">(mỗi dòng một yêu cầu)</small></span>{editable
        ? <textarea key={myOuts.map(o => o.id).join()} rows={Math.max(2, myOuts.length)} defaultValue={myOuts.map(o => o.content).join('\n')} onBlur={e => saveOuts(e.target.value)} />
        : <div>{myOuts.length ? myOuts.map(o => <div key={o.id}>✓ {o.content}</div>) : '—'}</div>}</label>

      <div className="field"><span>Học liệu gắn với bài</span>
        <div className="umats">{mine.map(x => <span key={x.item_id} className="chip" title={x.note ?? undefined}><Icon n={MAT_ICON[x.library_items?.content?.type ?? ''] ?? 'paperclip'} /> {x.library_items?.title ?? 'Học liệu không còn xem được'}{x.note && <small className="sub"> · {x.note}</small>}
          {editable && <button type="button" className="x" aria-label={`Bỏ học liệu ${x.library_items?.title ?? ''}`} onClick={() => run(supabase.from('edu_unit_materials').delete().eq('unit_id', x.unit_id).eq('item_id', x.item_id))}>×</button>}</span>)}
          {!mine.length && <small className="sub">Chưa gắn học liệu.</small>}</div>
        {editable && <div className="tools" style={{ marginTop: 6 }}>
          <select value={pick.item} onChange={e => setPick({ ...pick, item: e.target.value })} aria-label="Học liệu" style={{ minWidth: 220, flex: 1 }}>
            <option value="">{matOpts ? (matOpts.length ? '+ Chọn học liệu trong kho…' : 'Chưa có học liệu — thêm ở "Phát hành học liệu"') : 'Đang tải…'}</option>
            {(matOpts ?? []).filter(m => !mine.some(x => x.item_id === m.id)).map(m => <option key={m.id} value={m.id}>{m.title}{m.status !== 'published' ? ' (nháp)' : ''}</option>)}</select>
          <input value={pick.note} onChange={e => setPick({ ...pick, note: e.target.value })} placeholder="Dùng ở phần nào (không bắt buộc)" aria-label="Ghi chú" maxLength={500} />
          <button type="button" className="primary" disabled={!pick.item} onClick={addMat}>Gắn</button></div>}
      </div>

      <div className="field"><span>Buổi học <small className="sub">(không bắt buộc: chia bài thành nhiều buổi, mỗi buổi soạn nội dung riêng)</small></span>
        {sessions.length ? <div className="wrap"><table><tbody>{sessions.map(x => <tr key={x.id}>
          <td>{editable ? <input className="slcell" defaultValue={x.title} aria-label="Tên buổi" onBlur={e => e.target.value.trim() && e.target.value.trim() !== x.title && upd(x.id, { title: e.target.value.trim() })} /> : x.title}</td>
          <td style={{ width: 90 }}>{editable ? <input className="slcell" inputMode="numeric" defaultValue={String(x.periods || '')} aria-label="Số tiết" onBlur={e => upd(x.id, { periods: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /> : x.periods} tiết</td>
          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{lessonBtn(x)} {editable && <button type="button" className="danger" onClick={() => delSession(x)}>Xoá</button>}</td></tr>)}</tbody></table></div>
          : <div className="tools">{lessonBtn(u)}{!editable && !asLesson(u.lesson) && <small className="sub">Chưa chia buổi.</small>}</div>}
        {editable && <div><button type="button" className="linkbtn" onClick={addSession}>+ Thêm buổi học</button></div>}
      </div>
    </div>
    {lessonOf && <SessionLessonEditor unit={lessonOf} ct={p.ct_code} editable={editable} onClose={() => setLessonOf(null)}
      onSaved={() => { setLessonOf(null); onChanged(); onMessage('Đã lưu nội dung.') }} />}
  </Drawer>
}

export function SubjectLessonsTab({ p, editable, onChanged, onMessage }: {
  p: Program; editable: boolean; onChanged: () => void; onMessage: (m: string, err?: boolean) => void
}) {
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [outs, setOuts] = useState<Outcome[]>([])
  const [usubs, setUsubs] = useState<USubject[]>([])
  const [umats, setUmats] = useState<UMaterial[]>([])
  const [openL, setOpenL] = useState<string | null>(null)
  const [kitOf, setKitOf] = useState<Map<string, string>>(new Map())
  const [libUnits, setLibUnits] = useState<LibUnit[] | null>(null)
  const { subjects } = useSubjects()
  // Môn đang chọn ở cột trái ('' = tất cả các môn)
  const [cur, setCur] = useState('')
  const [newSubj, setNewSubj] = useState('')
  const [q, setQ] = useState('')
  const [gf, setGf] = useState(0)
  // Dòng thêm bài mới: đủ các cột; bấm ⧉ ở một dòng để chép sẵn giá trị lên đây
  const [nd, setNd] = useState({ title: '', grades: '', periods: '', outs: '' })
  const [paste, setPaste] = useState<{ subj: string; text: string } | null>(null)
  const [addSubj, setAddSubj] = useState(false)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [addMain, setAddMain] = useState(true)   // môn thêm mới: mặc định là môn chủ đạo
  const [busy, setBusy] = useState(false)
  const lc = (x: string) => x.trim().toLowerCase()

  async function load() {
    const [u, o, us, um] = await Promise.all([
      supabase.from('edu_program_units').select('*').eq('program_id', p.id).order('seq'),
      supabase.from('edu_outcomes').select('*').eq('program_id', p.id).order('seq'),
      supabase.from('edu_unit_subjects').select('unit_id, subject_id, is_main, seq').eq('program_id', p.id).order('seq'),
      supabase.from('edu_unit_materials').select('unit_id, item_id, seq, note, library_items(title, content)').eq('program_id', p.id).order('seq'),
    ])
    if (u.error) onMessage(errText(u.error.message), true)
    const us_ = (u.data as Unit[]) ?? []
    setUnits(us_); setOuts((o.data as Outcome[]) ?? []); setUsubs((us.data as USubject[]) ?? [])
    setUmats((um.data as unknown as UMaterial[]) ?? [])
    const ids = us_.filter(x => x.unit_type === 'lesson').map(x => x.id)
    if (ids.length) {
      const { data } = await supabase.from('library_items').select('unit_id, status').eq('kind', 'unit').neq('status', 'archived').in('unit_id', ids)
      const k = new Map<string, string>(); ((data as { unit_id: string; status: string }[]) ?? []).forEach(x => { if (k.get(x.unit_id) !== 'published') k.set(x.unit_id, x.status) }); setKitOf(k)
    } else setKitOf(new Map())
  }
  useEffect(() => { load() }, [p.id])
  async function loadLib() {
    if (libUnits) return
    const { data } = await supabase.from('library_items').select('id, title, subject, grades, owner_org_id, status, content').eq('kind', 'unit').neq('status', 'archived').order('title')
    setLibUnits(((data as LibUnit[]) ?? []).filter(i => i.status === 'published' || i.owner_org_id === p.org_id))
  }
  useEffect(() => { if (editable) loadLib() }, [editable])

  if (!units) return <p className="sub">Đang tải…</p>
  const mats = new Map<string, number>(); umats.forEach(x => mats.set(x.unit_id, (mats.get(x.unit_id) ?? 0) + 1))
  const all = units
  const byId = new Map(all.map(u => [u.id, u]))
  const subjName = (id: string) => subjects.find(s => s.id === id)?.name ?? ''
  const topicOf = (u: Unit) => { let t = u.parent_id ? byId.get(u.parent_id) : undefined; while (t && t.unit_type !== 'topic') t = t.parent_id ? byId.get(t.parent_id) : undefined; return t }
  const topicSubj = (t: Unit | undefined) => { if (!t) return ''; const m = usubs.filter(x => x.unit_id === t.id).sort((a, b) => Number(b.is_main) - Number(a.is_main))[0]; return (m && subjName(m.subject_id)) || t.subject?.trim() || '' }
  const mains = mainsOf(p)
  // Thứ tự: theo cây hiện có (học phần → bài), bài gắn thẳng vào môn ở cuối theo seq
  const order: Unit[] = []
  const walk = (parent: string | null) => all.filter(u => u.parent_id === parent).sort((a, b) => a.seq - b.seq).forEach(u => { order.push(u); walk(u.id) })
  walk(null)
  const rows: LRow[] = order.filter(u => u.unit_type === 'lesson').map(u => {
    const t = topicOf(u)
    return { u, subject: u.subject?.trim() || topicSubj(t) || mains[0] || 'Chưa có môn', topic: t?.title ?? '', outs: outs.filter(o => o.unit_id === u.id).sort((a, b) => a.seq - b.seq) }
  })
  const subjList = [...new Map([...mains, ...p.integrated_subjects, ...rows.map(r => r.subject)].filter(Boolean).map(s => [lc(s), s.trim()] as [string, string])).values()]
  const fit = (r: LRow) => (!gf || unitGrades(r.u).includes(gf)) && (!q || norm(r.u.title).includes(norm(q)))
  const rowsOf = (subj: string) => rows.filter(r => lc(r.subject) === lc(subj))
  const sel = subjList.find(x => lc(x) === lc(cur)) ?? ''
  const sIdx = (x: string) => { const i = subjList.findIndex(y => lc(y) === lc(x)); return i < 0 ? 999 : i }
  const inSel = sel ? rowsOf(sel) : [...rows].sort((a, b) => sIdx(a.subject) - sIdx(b.subject))
  const shown = inSel.filter(fit)
  const target = sel || subjList.find(x => lc(x) === lc(newSubj)) || subjList[0] || ''
  const pg = progGrades(p)
  const defGrades = gf ? [gf] : pg.length === 1 ? pg : []
  const usable = subjects.filter(s => s.active && (!s.levels.length || p.levels?.some(l => s.levels.includes(l)) || s.levels.includes(p.level)) && !subjList.some(n => lc(n) === lc(s.name)))

  async function update(u: Unit, patch: Partial<Unit>) {
    const { error } = await supabase.from('edu_program_units').update(patch).eq('id', u.id)
    if (error) return onMessage(errText(error.message), true)
    setUnits(us => us?.map(x => x.id === u.id ? { ...x, ...patch } : x) ?? us)
  }
  async function setOuts_(u: Unit, text: string) {
    const list = text.split(/\n|;/).map(s => s.trim()).filter(Boolean)
    const old = outs.filter(o => o.unit_id === u.id)
    if (old.map(o => o.content).join('\n') === list.join('\n')) return
    if (old.length) { const { error } = await supabase.from('edu_outcomes').delete().in('id', old.map(o => o.id)); if (error) return onMessage(errText(error.message), true) }
    if (list.length) { const { error } = await supabase.from('edu_outcomes').insert(list.map((content, i) => ({ program_id: p.id, unit_id: u.id, seq: i + 1, content }))); if (error) return onMessage(errText(error.message), true) }
    load()
  }
  // Thêm bài vào môn đang chọn: gắn thẳng vào chương trình (không học phần), nối cuối
  async function addLessons(list: PasteRow[], subj: string, quiet = false) {
    if (!list.length) return 0
    setBusy(true)
    let seq = all.filter(u => u.parent_id === null).reduce((m, u) => Math.max(m, u.seq), 0)
    let bad = 0
    for (const r of list) {
      const lib = r.lib ?? libUnits?.find(i => lc(i.title) === lc(r.title) && (!i.subject || lc(i.subject) === lc(subj)))
      const res = await supabase.from('edu_program_units').insert({ program_id: p.id, parent_id: null, unit_type: 'lesson', seq: ++seq, grades: r.grades, subject: subj,
        title: r.title, periods: r.periods, objectives: lib?.content?.objectives ?? null }).select('id').single()
      if (res.error) { bad++; onMessage(errText(res.error.message), true); continue }
      const id = (res.data as { id: string }).id
      if (r.outs.length) await supabase.from('edu_outcomes').insert(r.outs.map((content, i) => ({ program_id: p.id, unit_id: id, seq: i + 1, content })))
      const m = (lib?.content?.material_ids ?? []).filter(x => typeof x === 'string')
      if (m.length) await supabase.from('edu_unit_materials').insert(m.map((item_id, i) => ({ unit_id: id, item_id, seq: i + 1, note: null })))
    }
    setBusy(false); if (!quiet) { await load(); onChanged() }
    if (!bad && !quiet) onMessage(`Đã thêm ${list.length} bài vào môn ${subj}.`)
    return list.length - bad
  }
  // Excel mẫu gọn: Môn · Khối · Tên bài · Số tiết · Yêu cầu cần đạt (thêm vào cuối, không xoá bài đang có)
  async function importLessons(recs: (Record<string, string> & { _line: number })[]) {
    const bad: string[] = [], bySubj = new Map<string, PasteRow[]>()
    for (const r of recs) {
      const title = stripNo(r.title ?? '')
      if (!title) { bad.push(`dòng ${r._line}: thiếu tên bài`); continue }
      const subj = (r.subject ?? '').trim() || subjList[0] || ''
      if (!subj) { bad.push(`dòng ${r._line}: thiếu môn`); continue }
      const g = gradeList(String(r.grade ?? '')).filter(x => x >= 1 && x <= 12), n = Number(String(r.periods ?? '').replace(',', '.'))
      const k = subjList.find(x => lc(x) === lc(subj)) ?? subj
      bySubj.set(k, [...(bySubj.get(k) ?? []), { title, grades: g.length ? g : defGrades, periods: Number.isFinite(n) && n > 0 ? Math.round(n) : 1,
        outs: String(r.outcomes ?? '').split(/\n|;/).map(x => x.trim()).filter(Boolean) }])
    }
    const extra = [...bySubj.keys()].filter(k => !subjList.some(x => lc(x) === lc(k)))
    if (extra.length) await supabase.from('edu_programs').update({ integrated_subjects: [...p.integrated_subjects, ...extra] }).eq('id', p.id)
    let ok = 0
    for (const [k, list] of bySubj) ok += await addLessons(list, k, true)
    await load(); onChanged()
    return importSummary(ok, 'bài', bad)
  }
  function exportLessons() {
    downloadXlsx(`Mon-bai-hoc ${p.title} v${p.version_no}`, LIMPORT, rows.map(r => [r.subject, unitGrades(r.u).join(', ') || null, r.u.title, r.u.periods || null, r.outs.map(o => o.content).join('\n')]), 'Bài học')
  }
  async function remove(r: LRow) {
    if (!confirm(`Xoá bài "${r.u.title}"? Yêu cầu cần đạt và học liệu gắn với bài cũng bị bỏ.`)) return
    const { error } = await supabase.from('edu_program_units').delete().eq('id', r.u.id)
    if (error) return onMessage(errText(error.message), true)
    load(); onChanged()
  }
  // Kéo thả đổi vị trí trong cùng môn. Bài thuộc chủ đề cũ khác nhóm thì chuyển sang cùng nhóm với bài được thả vào.
  async function moveTo(dragId: string, over: LRow) {
    const r = rows.find(x => x.u.id === dragId)
    if (!r || r.u.id === over.u.id) return
    if (lc(r.subject) !== lc(over.subject)) return onMessage('Chỉ kéo thả được trong cùng một môn.', true)
    const par = over.u.parent_id, same = r.u.parent_id === par
    const sibs = rowsOf(r.subject).filter(x => x.u.parent_id === par)
    const rest = sibs.filter(x => x !== r)
    const seqs = [...rest.map(x => x.u.seq), same ? r.u.seq : Math.max(0, ...all.filter(u => u.parent_id === par).map(u => u.seq)) + 1].sort((a, b) => a - b)
    const next = [...rest]
    const at = rest.indexOf(over) + (same && sibs.indexOf(r) < sibs.indexOf(over) ? 1 : 0)
    next.splice(at, 0, r)
    const ch = next.map((x, i) => [x, seqs[i]] as const).filter(([x, sq]) => x.u.seq !== sq || x === r && !same)
    setUnits(us => us?.map(u => { const c = ch.find(([x]) => x.u.id === u.id); return c ? { ...u, seq: c[1], parent_id: u.id === r.u.id ? par : u.parent_id } : u }) ?? us)
    const res = await Promise.all(ch.map(([x, sq]) => supabase.from('edu_program_units').update(x === r && !same ? { seq: sq, parent_id: par } : { seq: sq }).eq('id', x.u.id)))
    const err = res.find(x => x.error)?.error
    if (err) onMessage(errText(err.message), true)
    load()
  }
  async function addSubject(name: string) {
    setAddSubj(false); if (!name) return setAddMain(true)
    const { error } = await supabase.from('edu_programs').update(addMain
      ? { main_subjects: [...mainsOf(p), name], integrated_subjects: p.integrated_subjects.filter(x => lc(x) !== lc(name)) }
      : { integrated_subjects: [...p.integrated_subjects, name] }).eq('id', p.id)
    if (error) return onMessage(errText(error.message), true)
    setAddMain(true); setCur(name); onChanged()
  }
  async function removeSubject(name: string) {
    const rs = rowsOf(name), n = rs.length
    if (!confirm(`Bạn có muốn xoá môn "${name}" khỏi chương trình không?${n ? ` Môn này đang có ${n} bài, các bài cùng yêu cầu cần đạt và buổi học của chúng cũng bị xoá.` : ''}`)) return
    const ids = new Set(rs.map(r => r.u.id))
    for (let grow = true; grow;) { grow = false; for (const u of all) if (u.parent_id && ids.has(u.parent_id) && !ids.has(u.id)) { ids.add(u.id); grow = true } }
    if (ids.size) { const { error } = await supabase.from('edu_program_units').delete().in('id', [...ids]); if (error) return onMessage(errText(error.message), true) }
    const left = mainsOf(p).filter(x => lc(x) !== lc(name))
    const { error } = await supabase.from('edu_programs').update({ main_subjects: left, main_subject: left[0] ?? '', integrated_subjects: p.integrated_subjects.filter(x => lc(x) !== lc(name)) }).eq('id', p.id)
    if (error) return onMessage(errText(error.message), true)
    if (lc(cur) === lc(name)) setCur('')
    load(); onChanged()
  }
  const kitChip = (u: Unit) => { const k = kitOf.get(u.id), n = mats.get(u.id) ?? 0
    return <>{n > 0 && <span className="gpill good">{n} học liệu</span>} {k === 'published' ? <span className="gpill good">Bộ học liệu</span> : k ? <span className="gpill warn">Bộ học liệu đang soạn</span> : !n && <span className="gpill warn">Chưa có</span>}</> }
  const cell = (r: LRow, key: 'title' | 'grades' | 'periods' | 'outs') => {
    const u = r.u
    const val = key === 'title' ? u.title : key === 'grades' ? unitGrades(u).join(', ') : key === 'periods' ? String(u.periods || '') : r.outs.map(o => o.content).join('\n')
    if (!editable) return key === 'outs' ? <span className="yc">{val || '—'}</span> : val || '—'
    const save = (v: string) => {
      if (v === val) return
      if (key === 'title') return v.trim() ? update(u, { title: v.trim() }) : undefined
      if (key === 'grades') return update(u, { grades: gradeList(v).filter(x => x >= 1 && x <= 12) })
      if (key === 'periods') return update(u, { periods: Math.max(0, Math.round(Number(v.replace(',', '.')) || 0)) })
      return setOuts_(u, v)
    }
    return key === 'outs'
      ? <textarea key={u.id + val} className="slcell" defaultValue={val} rows={Math.min(4, Math.max(1, r.outs.length))} placeholder="Mỗi dòng một yêu cầu" aria-label={`Yêu cầu cần đạt của ${u.title}`} onBlur={e => save(e.target.value)} />
      : <input key={u.id + val} className="slcell" defaultValue={val} aria-label={`${key === 'title' ? 'Tên' : key === 'grades' ? 'Khối' : 'Số tiết'} bài ${u.title}`}
          inputMode={key === 'title' ? undefined : 'numeric'} onBlur={e => save(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
  }
  async function addDraft() {
    const t = nd.title.trim(); if (!t || busy) return
    if (/\n/.test(t)) { setPaste({ subj: target, text: t }); return }
    const g = gradeList(nd.grades).filter(x => x >= 1 && x <= 12), n = Number(nd.periods.replace(',', '.'))
    const ok = await addLessons([{ title: stripNo(t), grades: g.length ? g : defGrades, periods: Number.isFinite(n) && n > 0 ? Math.round(n) : 1,
      outs: nd.outs.split(/\n|;/).map(x => x.trim()).filter(Boolean) }], target)
    if (ok) { setNd(d => ({ ...d, title: '', outs: '' })); document.getElementById('sl-new-title')?.focus() }
  }
  // Nhân bản bài: tạo ngay một bài giống hệt (môn, tên, khối, số tiết, yêu cầu cần đạt, học liệu) ngay dưới bài gốc
  async function duplicate(r: LRow) {
    setBusy(true)
    const later = all.filter(u => u.parent_id === r.u.parent_id && u.seq > r.u.seq).sort((a, b) => b.seq - a.seq)
    for (const u of later) { const { error } = await supabase.from('edu_program_units').update({ seq: u.seq + 1 }).eq('id', u.id); if (error) { setBusy(false); return onMessage(errText(error.message), true) } }
    const res = await supabase.from('edu_program_units').insert({ program_id: p.id, parent_id: r.u.parent_id, unit_type: r.u.unit_type, seq: r.u.seq + 1, grade: r.u.grade, grades: r.u.grades ?? null,
      subject: r.u.subject, title: r.u.title, periods: r.u.periods, objectives: r.u.objectives, content: r.u.content }).select('id').single()
    if (res.error) { setBusy(false); return onMessage(errText(res.error.message), true) }
    const id = (res.data as { id: string }).id
    if (r.outs.length) await supabase.from('edu_outcomes').insert(r.outs.map((o, i) => ({ program_id: p.id, unit_id: id, seq: i + 1, content: o.content, code: o.code, competency_key: o.competency_key })))
    const m = umats.filter(x => x.unit_id === r.u.id)
    if (m.length) await supabase.from('edu_unit_materials').insert(m.map((x, i) => ({ unit_id: id, item_id: x.item_id, seq: i + 1, note: x.note ?? null })))
    setBusy(false); await load(); onChanged()
    onMessage(`Đã nhân bản bài "${r.u.title}" ngay bên dưới, anh có thể sửa trực tiếp.`)
  }

  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addDraft() } }
  const pasted = paste ? parseLessonLines(paste.text, defGrades).map(r => ({ ...r, lib: libUnits?.find(i => lc(i.title) === lc(r.title)) })) : []
  const totalP = (rs: LRow[]) => rs.reduce((t, r) => t + (r.u.periods || 0), 0)

  const noOf = (r: LRow) => inSel.indexOf(r) + 1
  const cols: Col<LRow>[] = [
    { key: 'no', label: '#', thClass: 'c-no', fixed: true, cell: r => <span className="sub">{noOf(r)}</span> },
    ...(!sel ? [{ key: 'subj', label: 'Môn', thClass: 'c-subj', text: (r: LRow) => r.subject, cell: (r: LRow) => <button type="button" className="slsubjlink" onClick={() => setCur(r.subject)}>{r.subject}</button> }] : []),
    { key: 'title', label: 'Tên bài học', thClass: 'c-title', fixed: true, text: r => r.u.title, cell: r => <>{editable ? cell(r, 'title') : <NameLink onClick={() => setOpenL(r.u.id)}>{r.u.title}</NameLink>}
</> },
    { key: 'topic', label: 'Chủ đề cũ', thClass: 'c-topic', off: true, text: r => r.topic, cell: r => r.topic ? <small className="sub">{r.topic}</small> : <span className="sub">—</span> },
    { key: 'grades', label: 'Khối', thClass: 'c-grade', text: r => unitGrades(r.u).join(', '), cell: r => cell(r, 'grades') },
    { key: 'periods', label: 'Số tiết', thClass: 'c-per', text: r => String(r.u.periods || ''), cell: r => cell(r, 'periods') },
    { key: 'outs', label: 'Yêu cầu cần đạt', thClass: 'c-outs', cell: r => cell(r, 'outs') },
    { key: 'mat', label: 'Học liệu · buổi', thClass: 'c-mat', text: r => kitOf.get(r.u.id) === 'published' || mats.get(r.u.id) ? 'Có học liệu' : 'Chưa có',
      cell: r => { const ns = all.filter(c => c.parent_id === r.u.id && c.unit_type === 'session').length
        return <button type="button" className="slopen" onClick={() => setOpenL(r.u.id)} title="Mở chi tiết: học liệu, buổi học, nội dung">{kitChip(r.u)}{ns > 0 && <span className="pill">{ns} buổi</span>}<span className="slmore">Chi tiết ›</span></button> } },
    ...(editable ? [{ key: 'act', label: '', thClass: 'c-act', fixed: true, cell: (r: LRow) =>
      <span className="slact"><span className="sldrag" draggable title="Kéo để đổi vị trí" aria-label={`Kéo ${r.u.title} để đổi vị trí`}
        onDragStart={e => { setDrag(r.u.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.u.id); const tr = (e.target as HTMLElement).closest('tr'); if (tr) e.dataTransfer.setDragImage(tr, 20, 20) }}
        onDragEnd={() => { setDrag(null); setOver(null) }}>⠿</span>
        <button type="button" disabled={busy} aria-label={`Nhân bản bài ${r.u.title}`} title="Nhân bản: tạo ngay một bài giống hệt bên dưới" onClick={() => duplicate(r)}>⧉</button>
        <button type="button" className="danger" aria-label={`Xoá ${r.u.title}`} onClick={() => remove(r)}>×</button></span> }] : []),
  ]
  const navItem = (key: string, label: string, rs: LRow[], main?: boolean) => <div key={key || '*'} className={'slnavrow' + (lc(sel) === lc(key) ? ' on' : '')}>
    <button type="button" className={'slnavi' + (lc(sel) === lc(key) ? ' on' : '')} onClick={() => setCur(key)}>
      <span className="slnm">{label}{main && <small className="sub"> · chủ đạo</small>}</span><span className="slcnt">{rs.length} bài · {totalP(rs)} tiết</span></button>
    {editable && key && <button type="button" className="slnavx" title={`Xoá môn ${label}`} aria-label={`Xoá môn ${label}`} onClick={() => removeSubject(key)}>×</button>}</div>

  return <div className="slwrap">
    <nav className="slnav" aria-label="Môn trong chương trình">
      {navItem('', 'Tất cả', rows)}
      {subjList.map(x => navItem(x, x, rowsOf(x), mains.some(m => lc(m) === lc(x))))}
      {editable && (addSubj ? <div className="sladdbox">
          <div className="sladdkind" role="radiogroup" aria-label="Loại môn">
            <button type="button" role="radio" aria-checked={addMain} className={addMain ? 'on' : ''} onClick={() => setAddMain(true)}>Chủ đạo</button>
            <button type="button" role="radio" aria-checked={!addMain} className={!addMain ? 'on' : ''} onClick={() => setAddMain(false)}>Tích hợp</button>
          </div>
          <select className="sladdsel" autoFocus defaultValue="" onChange={e => addSubject(e.target.value)} aria-label="Thêm môn">
            <option value="">— Chọn môn —</option>{usable.map(x => <option key={x.id} value={x.name}>{x.name}</option>)}</select>
          <button type="button" className="linkbtn" onClick={() => setAddSubj(false)}>Huỷ</button>
        </div>
        : <button type="button" className="sladdsubj" onClick={() => setAddSubj(true)}>+ Thêm môn</button>)}
    </nav>
    <div className="slmain">
      <DataTable id="edu-lessons-v2" simple rows={shown} rowKey={r => r.u.id} className="slt"
        rowProps={editable ? r => ({ className: drag === r.u.id ? 'sldragging' : over === r.u.id && drag ? 'slover' : undefined,
          onDragOver: e => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== r.u.id) setOver(r.u.id) },
          onDrop: e => { e.preventDefault(); const id = drag; setDrag(null); setOver(null); if (id) moveTo(id, r) } }) : undefined}
        empty={<small className="sub">{inSel.length ? 'Không có bài nào khớp bộ lọc.' : !subjList.length ? 'Chưa có môn. Chọn môn chủ đạo ở “Sửa thông tin” hoặc bấm “+ Thêm môn”.' : `${sel ? 'Môn ' + sel : 'Chương trình'} chưa có bài học.${editable ? ' Gõ tên bài ở dòng dưới hoặc bấm “Dán danh sách bài”.' : ''}`}</small>}
        left={<><input placeholder={sel ? `Tìm bài môn ${sel}…` : 'Tìm bài trong mọi môn…'} value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm bài" />
          {pg.length > 1 && <select value={gf} onChange={e => setGf(Number(e.target.value))} aria-label="Khối"><option value={0}>Tất cả khối</option>{pg.map(g => <option key={g} value={g}>Khối {g}</option>)}</select>}</>}
        right={<>
          {rows.length > 0 && <button type="button" onClick={exportLessons}>⤓ Tải Excel</button>}
          {editable && <ImportExcel label="⇪ Nhập Excel" columns={LIMPORT} template="Mau-mon-bai-hoc" onRecords={importLessons} onMessage={(m, e) => onMessage(m, e)}
            sample={[['Tin học', '6', 'Bài 1. Thông tin và dữ liệu', '2', 'Phân biệt được thông tin và dữ liệu; Nêu được ví dụ'], ['Tin học', '6', 'Bài 2. Xử lí thông tin', '2', '']]} />}
          {editable && target && <button type="button" className="primary ttadd" onClick={() => setPaste({ subj: target, text: '' })}>⧉ Dán danh sách bài</button>}
        </>}
        cols={cols}
        foot={editable && target ? <tfoot><tr className="slnew"><td colSpan={10}><div className="slnewrow">
          <select value={target} disabled={!!sel || subjList.length < 2} onChange={e => setNewSubj(e.target.value)} aria-label="Môn của bài mới">{subjList.map(x => <option key={x} value={x}>{x}</option>)}</select>
          <input id="sl-new-title" className="slnt" value={nd.title} disabled={busy} placeholder="+ Tên bài mới (dán nhiều dòng để thêm nhiều bài)" aria-label={`Tên bài mới môn ${target}`}
            onChange={e => setNd({ ...nd, title: e.target.value })} onKeyDown={enter}
            onPaste={e => { const t = e.clipboardData.getData('text'); if (/\n/.test(t.trim())) { e.preventDefault(); setPaste({ subj: target, text: t }) } }} />
          <input className="slng" value={nd.grades} disabled={busy} placeholder={defGrades.join(', ') || 'Khối'} aria-label="Khối của bài mới" inputMode="numeric" onChange={e => setNd({ ...nd, grades: e.target.value })} onKeyDown={enter} />
          <input className="slnp" value={nd.periods} disabled={busy} placeholder="Số tiết" aria-label="Số tiết của bài mới" inputMode="numeric" onChange={e => setNd({ ...nd, periods: e.target.value })} onKeyDown={enter} />
          <input className="slno" value={nd.outs} disabled={busy} placeholder="Yêu cầu cần đạt (ngăn cách bằng ;)" aria-label="Yêu cầu cần đạt của bài mới" onChange={e => setNd({ ...nd, outs: e.target.value })} onKeyDown={enter} />
          <button type="button" className="primary" disabled={busy || !nd.title.trim()} onClick={addDraft}>+ Thêm</button>
        </div></td></tr></tfoot> : undefined} />
      {editable && <small className="sub">Bấm vào ô để sửa ngay, rời ô là lưu. Kéo ⠿ để đổi vị trí bài trong cùng môn. Dòng cuối: điền các cột rồi Enter để thêm bài; bấm ⧉ để nhân bản bài (đủ môn, tên, khối, số tiết, yêu cầu cần đạt) ngay bên dưới. Bấm “Chi tiết ›” để gắn học liệu, chia buổi và soạn nội dung.</small>}
    </div>
    {openL && byId.get(openL) && <LessonDetail u={byId.get(openL)!} p={p} all={all} umats={umats} outs={outs} editable={editable}
      onClose={() => setOpenL(null)} onChanged={() => { load(); onChanged() }} onMessage={onMessage} />}
    {paste && <Drawer title={`Dán danh sách bài vào môn ${paste.subj}`} onClose={() => setPaste(null)} closeOnOutside={false}
      actions={<><button type="button" className="primary" disabled={!pasted.length || busy} onClick={async () => { await addLessons(pasted, paste.subj); setPaste(null) }}>Thêm {pasted.length} bài</button>
        <button type="button" onClick={() => setPaste(null)}>Huỷ</button></>}>
      <p className="sub" style={{ marginTop: 0 }}>Mỗi dòng một bài. Dán thẳng từ Excel / Word được, các cột theo thứ tự: <b>Tên bài · Khối · Số tiết · Yêu cầu cần đạt</b> (chỉ tên là bắt buộc). Số thứ tự kiểu “Bài 6.” ở đầu dòng tự bỏ.</p>
      <textarea autoFocus rows={8} value={paste.text} onChange={e => setPaste({ ...paste, text: e.target.value })} placeholder={'Bài 1. Thông tin và dữ liệu\t6\t2\nBài 2. Xử lí thông tin\t6\t2'} style={{ width: '100%', fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13 }} aria-label="Danh sách bài" />
      {pasted.length > 0 && <div className="wrap" style={{ marginTop: 10 }}><table>
        <thead><tr><th>Tên bài</th><th>Khối</th><th>Số tiết</th><th>Yêu cầu cần đạt</th><th></th></tr></thead>
        <tbody>{pasted.map((r, i) => <tr key={i}><td>{r.title}</td><td>{r.grades.join(', ') || '—'}</td><td>{r.periods}</td><td><small>{r.outs.join('; ') || '—'}</small></td>
          <td>{rowsOf(paste.subj).some(x => lc(x.u.title) === lc(r.title)) ? <span className="gpill warn">Trùng bài đã có</span> : r.lib ? <span className="gpill good">Có trong kho → gắn học liệu</span> : <span className="pill">Mới</span>}</td></tr>)}</tbody>
      </table></div>}
      <p className="sub">{pasted.length} bài · {pasted.reduce((t, r) => t + r.periods, 0)} tiết</p>
    </Drawer>}
  </div>
}

// Soạn nội dung chi tiết một buổi học (063): bài giảng tương tác theo tiến trình CT — hiện ở Thư viện STEM của giáo viên
function SessionLessonEditor({ unit, ct, editable, onClose, onSaved }: { unit: Unit; ct: string | null; editable: boolean; onClose: () => void; onSaved: () => void }) {
  const [val, setVal] = useState<ILesson | null>(asLesson(unit.lesson))
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')
  async function save() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('edu_program_units').update({ lesson: val ?? {} }).eq('id', unit.id).select('id')
    setBusy(false)
    if (error) return setErr(errText(error.message))
    if (!data?.length) return setErr('Không lưu được — bạn không có quyền sửa chương trình này.')
    onSaved()
  }
  return (
    <div className="overlay player" role="dialog" aria-modal="true" aria-label={'Nội dung buổi học ' + unit.title}>
      <div className="playtop">
        <button type="button" className="x" onClick={onClose} aria-label="Đóng">×</button>
        {ct && <span className="progchip ct">{ct}</span>}<b className="ellipsis">{/^buổi\s*\d/i.test(unit.title) || unit.unit_type !== 'session' ? unit.title : `Buổi ${unit.seq}: ${unit.title}`}</b>
        {!editable && <small className="sub">Chỉ xem — chương trình đã gửi duyệt / phát hành, tạo phiên bản mới để sửa.</small>}
        <span style={{ marginLeft: 'auto' }} />
        {err && <span className="warnline">{err}</span>}
        {editable && <button className="primary" onClick={save} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>}
        <button onClick={onClose}>Đóng</button>
      </div>
      <div style={{ overflow: 'auto', padding: 16, flex: 1 }}>
        <LessonEditor value={val} ct={ct} onChange={setVal} readOnly={!editable} title={unit.title} />
      </div>
    </div>
  )
}
// u nằm trong nhánh của mục ancestor
function isDesc(all: Unit[], u: Unit, ancestor: string): boolean {
  let p = u.parent_id
  for (let i = 0; p && i < 5; i++) { if (p === ancestor) return true; p = all.find(x => x.id === p)?.parent_id ?? null }
  return false
}

// ----- Phiên bản & duyệt -----
/** Nút gửi duyệt / duyệt / phát hành / tạo phiên bản mới / ngừng dùng — hiện trên thẻ thông tin */
function VersionActions({ p, mine, canEdit, mode, isAdmin, onOpen, onChanged, onMessage, onDelete }: {
  p: Program; mine: boolean; canEdit: boolean; mode: ProgMode; isAdmin: boolean; onOpen: (id: string) => void; onChanged: () => void; onDelete?: () => void
  onMessage: (m: string, err?: boolean) => void
}) {
  const hid = useHiddenBtn()
  const [canAct, setCanAct] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.from('approval_requests').select('id').eq('ref_table', 'edu_programs').eq('ref_id', p.id).eq('status', 'pending').limit(1).then(async r => {
      const req = ((r.data as { id: string }[]) ?? [])[0]
      if (req) { const { data } = await supabase.rpc('approval_can_act', { p_request: req.id }); setCanAct(!!data) } else setCanAct(false)
    })
  }, [p.id, p.status])
  async function setStatus(s: Status, ask?: string) {
    const note = ask ? prompt(ask, '') : ''
    if (note === null) return
    setBusy(true)
    const { error } = await supabase.rpc('edu_program_set_status', { p_program: p.id, p_status: s, p_note: note || null })
    setBusy(false)
    if (error) return onMessage(errText(error.message), true)
    onMessage(s === 'pending' ? 'Đã gửi duyệt — hồ sơ ở Hộp phê duyệt.' : s === 'published' ? 'Đã phát hành.' : s === 'archived' ? 'Đã ngừng dùng.' : 'Đã mở lại thành bản nháp.')
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
    if (!confirm('Tạo phiên bản mới (bản nháp chép từ phiên bản này)? Phiên bản đang phát hành vẫn dùng đến khi bản mới được phát hành.')) return
    setBusy(true)
    const { data, error } = await supabase.rpc('edu_program_new_version', { p_program: p.id })
    setBusy(false)
    if (error) return onMessage(errText(error.message), true)
    onOpen(data as string)
  }
  const can = mine && canEdit
  const canPublishDraft = mode !== 'school' || isAdmin
  return <>
          {can && (p.status === 'draft' || p.status === 'rejected') && <button className={mode === 'platform' ? undefined : 'primary'} disabled={busy} onClick={() => setStatus('pending', 'Ghi chú gửi người duyệt (không bắt buộc):')}>Gửi duyệt</button>}
          {can && p.status === 'draft' && canPublishDraft && <button className={mode === 'platform' ? 'primary' : undefined} disabled={busy} onClick={() => confirm('Phát hành ngay phiên bản này? Phiên bản đang phát hành (nếu có) sẽ bị thay thế.') && setStatus('published')}>Phát hành</button>}
          {p.status === 'pending' && canAct && <><button className="primary" disabled={busy} onClick={() => decide('approve')}>Duyệt</button><button className="danger" disabled={busy} onClick={() => decide('reject')}>Trả lại</button></>}
          {p.status === 'pending' && !canAct && <small className="sub">Đang chờ duyệt ở Hộp phê duyệt.</small>}
          {can && p.status === 'approved' && <button className="primary" disabled={busy} onClick={() => setStatus('published', 'Ghi chú phát hành (không bắt buộc):')}>Phát hành</button>}
          {can && p.status === 'approved' && <button disabled={busy} onClick={() => setStatus('draft')}>Mở lại để sửa</button>}
          {can && p.status === 'published' && !hid('version') && <button className="primary" disabled={busy} onClick={newVersion}>Tạo phiên bản mới</button>}
          {can && ['published', 'superseded', 'draft', 'rejected', 'approved'].includes(p.status) && <details className="pdmore"><summary aria-label="Thao tác khác" title="Thao tác khác">⋯</summary>
            <div>{onDelete && <button type="button" className="danger" disabled={busy} onClick={onDelete}>Xoá bản nháp</button>}<button type="button" className="danger" disabled={busy} onClick={() => confirm('Ngừng dùng phiên bản này? Đơn vị khác không còn thấy bản ngừng dùng.') && setStatus('archived', 'Lý do ngừng dùng (không bắt buộc):')}>Ngừng dùng phiên bản này</button></div></details>}
          {can && p.status === 'archived' && <button disabled={busy} onClick={() => setStatus('draft')}>Mở lại thành nháp</button>}
  </>
}

function VersionsTab({ p, onOpen, compact }: { p: Program; onOpen: (id: string) => void; compact?: boolean }) {
  const [vers, setVers] = useState<Program[]>([])
  const [log, setLog] = useState<LogRow[]>([])
  useEffect(() => {
    Promise.all([
      supabase.from('edu_programs').select('*').eq('family_id', p.family_id).order('version_no', { ascending: false }),
      supabase.from('edu_program_log').select('id, from_status, to_status, note, at').eq('program_id', p.id).order('at', { ascending: false }),
    ]).then(([v, l]) => { setVers((v.data as Program[]) ?? []); setLog((l.data as LogRow[]) ?? []) })
  }, [p.id, p.status])
  if (compact) return <>
    <ul className="pdvers">{vers.map(v => <li key={v.id} className={v.id === p.id ? 'on' : ''}>
      {v.id === p.id ? <b>v{v.version_no}</b> : <NameLink onClick={() => onOpen(v.id)}>v{v.version_no}</NameLink>}
      {v.id === p.id && <span className="slmeta">đang xem</span>}<span style={{ flex: 1 }} /><StatusPill s={v.status} /><small className="sub">{v.published_at ? fmtD(v.published_at) : ''}</small></li>)}</ul>
    {log.length > 0 && <details className="pdlog"><summary>Lịch sử trạng thái ({log.length})</summary><ul className="sub">
      {log.map(l => <li key={l.id}>{new Date(l.at).toLocaleString('vi-VN')} · {l.from_status ? `${PSTATUS[l.from_status as Status]?.[0] ?? l.from_status} → ` : ''}<b>{PSTATUS[l.to_status as Status]?.[0] ?? l.to_status}</b>{l.note ? ` — ${l.note}` : ''}</li>)}</ul></details>}
  </>
  return (
    <>
      <h3>Các phiên bản</h3>
      <div className="wrap"><table>
        <thead><tr><th>Phiên bản</th><th>Trạng thái</th><th>Phát hành</th><th>Hiệu lực</th><th>Ghi chú</th></tr></thead>
        <tbody>{vers.map(v => (
          <tr key={v.id} style={v.id === p.id ? { background: 'var(--soft, #f3f7fd)' } : undefined}>
            <td>{v.id === p.id ? <><b>v{v.version_no}</b> <small className="sub">đang xem</small></> : <NameLink onClick={() => onOpen(v.id)}>v{v.version_no}</NameLink>}</td><td><StatusPill s={v.status} /></td><td>{fmtD(v.published_at)}</td>
            <td>{v.effective_from ? fmtD(v.effective_from) : '—'}{v.effective_to ? ` → ${fmtD(v.effective_to)}` : ''}</td>
            <td><small>{v.note}</small></td>
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
  const hid = useHiddenBtn()
  const [orgs, setOrgs] = useState<Org[]>([])
  const [asg, setAsg] = useState<Assign[]>([])
  const [cov, setCov] = useState<Cover[] | null>(null)
  const [form, setForm] = useState<{ org: string; grades: number[]; note: string } | null>(null)
  const asel = useRowSel(asg)
  const orgF = useOrgFilter()
  async function load() {
    const [o, a, c] = await Promise.all([
      fetchAll(() => supabase.from('organizations').select('id, name, type, parent_id').order('name').order('id')),
      supabase.from('edu_program_assignments').select('*').eq('program_id', p.id).order('created_at'),
      supabase.rpc('edu_program_coverage', { p_program: p.id }),
    ])
    setOrgs((o.data as Org[]) ?? []); setAsg((a.data as Assign[]) ?? [])
    if (c.error) onMessage(errText(c.error.message), true)
    setCov((c.data as Cover[]) ?? [])
  }
  useEffect(() => { load() }, [p.id])
  const every = useAllMode()
  // Quản trị nền tảng (xem tất cả đơn vị): gán được cho đơn vị bất kỳ, kể cả trường không thuộc đơn vị sở hữu (vd. chương trình của KDI Education)
  const below = useMemo(() => {
    const kids = new Map<string | null, Org[]>()
    orgs.forEach(o => kids.set(o.parent_id, [...(kids.get(o.parent_id) ?? []), o]))
    const out: Org[] = []
    const walk = (id: string | null, depth: number) => (kids.get(id) ?? []).forEach(o => {
      if (o.id !== p.org_id) out.push({ ...o, name: '\u00a0'.repeat(depth * 3) + o.name })
      walk(o.id, depth + 1) })
    if (every) walk(null, 0)
    else if (orgId) walk(orgId, 0)
    return out
  }, [orgs, every, orgId, p.org_id])
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
      {['draft', 'pending', 'approved', 'rejected'].includes(p.status) && <p className="sub">Đơn vị được gán chỉ thấy chương trình khi đã phát hành.</p>}
      {!mine && <p className="sub">Chương trình của {p.organizations?.name ?? 'đơn vị khác'}: đơn vị gán cho trường trực thuộc để triển khai; chỉ bỏ được các bản gán do đơn vị mình tạo.</p>}
      {form && (
        <form className="panel formgrid" onSubmit={add} style={{ marginBottom: 12 }}>
          <div className="field" style={{ gridColumn: '1 / -1' }}><span>Tỉnh / Sở và đơn vị trực thuộc</span>
            <SchoolPicker single value={form.org ? [form.org] : []} onChange={v => setForm({ ...form, org: v[0] ?? '' })} options={below}
              placeholder="Gõ để tìm trường / đơn vị…" ariaLabel="Đơn vị trực thuộc" empty="Không có đơn vị trực thuộc." /></div>
          <div className="field"><span>Khối (không chọn = tất cả khối)</span>
            <NumMultiSelect value={form.grades} onChange={g => setForm({ ...form, grades: g })} options={progGrades(p).map(g => ({ value: g, label: gradeName(g) }))} placeholder="Tất cả khối" ariaLabel="Khối" /></div>
          <label className="field"><span>Ghi chú</span><input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
          <div className="formactions"><button className="primary" type="submit">Gán</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}
      {asg.length > 0 && (<>
        {asg.length > 1 && <div className="distfilter">{orgF.node(asg.map(a => a.org_id))}</div>}
        <SelBar picked={asel.cur ? orgName(asel.cur.org_id) : null}>
          <button className="danger" disabled={!asel.cur || !(mine || asel.cur.assigner_org === orgId)} onClick={() => { if (asel.cur) { remove(asel.cur); asel.clear() } }}>Bỏ gán</button>
        </SelBar>
        <div className="wrap"><table>
          <thead><tr><SelTh /><th>Đơn vị</th><th>Khối</th><th>Ghi chú</th><th>Ngày gán</th></tr></thead>
          <tbody>{asg.filter(a => orgF.fit(a.org_id)).map(a => (
            <tr key={a.id} className={asel.is(a) ? 'picked' : undefined}><SelTd on={asel.is(a)} onToggle={() => asel.toggle(a)} label={orgName(a.org_id)} />
              <td><b>{orgName(a.org_id)}</b></td><td>{a.grades?.length ? a.grades.join(', ') : 'Tất cả khối'}</td><td><small>{a.note}</small></td><td>{fmtD(a.created_at)}</td></tr>
          ))}</tbody>
        </table></div>
      </>)}
      <div className="bar" style={{ marginTop: 16 }}>
        <h3 style={{ margin: 0 }}>Mức độ triển khai</h3>
        {rows.length > 0 && !hid('export') && <button onClick={exportCov}>Xuất Excel</button>}
      </div>
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
      <p className="sub tablenote">Tính trên tất cả phiên bản của chương trình: trường được gán, trường có PPCT tạo từ chương trình, tiết đã dạy và yêu cầu cần đạt đã đạt.</p>
    </>
  )
}
