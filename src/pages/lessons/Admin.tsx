import { NameLink, SelBar, SelTd, SelTh, useRowSel } from '../../components/TableSel'
// Giáo án & bài giảng cho Trường (duyệt, theo dõi, mẫu giáo án), Sở / Phòng (giáo án đã xuất bản của trường trực thuộc, mẫu dùng chung)
// và KDI (mẫu giáo án dùng chung toàn hệ thống)
import { Suspense, lazy, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { OrgFilter, useAllMode, useOrgName } from '../../components/OrgScope'
import { Tabs } from '../teacher/common'
import { Tiles } from '../department/charts'
import { downloadXlsx } from '../../lib/sheet'
import {
  type LPlan, type LStatus, type NormItem, LSTATUS, LStatusPill, fmtD, errText, PLAN_COLS, useTemplates, useAttachables, totalMinutes,
  PlanDocument, printPlan, TemplatesManager, PLAN_MODE,
} from './common'
import { normPlan, LectureView, PlanOverlay } from './Studio'
import { ACT, type ActKind } from '../teacher/activity'
import { asLesson, lessonStats } from '../../lib/lessonBlocks'
const ActivityDesk = lazy(() => import('../teacher/Activities').then(m => ({ default: m.ActivityDesk })))

type P = { orgId: string | null; go?: (page: string) => void }
const NOUN = PLAN_MODE ? 'giáo án' : 'bài giảng'

function useRights(orgId: string | null) {
  const [r, setR] = useState({ isSchool: false, canWrite: false, ready: false })
  useEffect(() => {
    if (!orgId) return
    supabase.from('organizations').select('type').eq('id', orgId).maybeSingle().then(async ({ data }) => {
      const t = (data as { type: string } | null)?.type ?? null
      if (t !== 'school') return setR({ isSchool: false, canWrite: true, ready: true })
      const [a, p, q] = await Promise.all([supabase.rpc('is_admin'), supabase.rpc('has_perm', { p_module: 'library', p_action: 'edit' }), supabase.rpc('is_platform_admin')])
      setR({ isSchool: true, canWrite: !!a.data || !!p.data || !!q.data, ready: true })
    })
  }, [orgId])
  return r
}

// Xem trước một giáo án (dùng ở các màn quản lý)
export function PlanPreview({ plan, orgId, onClose, extra }: { plan: LPlan; orgId: string | null; onClose: () => void; extra?: React.ReactNode }) {
  const templates = useTemplates()
  const att = useAttachables(orgId)
  const [items, setItems] = useState<NormItem[]>([])
  const [overlay, setOverlay] = useState<{ plan: LPlan; kind: 'show' | 'player' } | null>(null)
  const blocks = lessonStats(asLesson(plan.lesson)).blocks
  useEffect(() => {
    if (plan.norm_id) supabase.from('material_norm_items').select('*').eq('norm_id', plan.norm_id).order('seq').then(({ data }) => setItems((data as NormItem[]) ?? []))
  }, [plan.norm_id])
  return (
    <>
      <div className="bar">
        <span className="tools"><button onClick={onClose}>← Danh sách</button><LStatusPill s={plan.status} />{plan.version_no > 0 && <small>Phiên bản {plan.version_no}</small>}</span>
        <span className="tools">{extra}
          {!PLAN_MODE && blocks > 0 && <><button onClick={() => setOverlay({ plan, kind: 'player' })}>Xem như học sinh</button><button onClick={() => setOverlay({ plan, kind: 'show' })}>Trình chiếu</button></>}
          {PLAN_MODE && <button onClick={() => printPlan(plan.title)}>In / lưu PDF</button>}</span>
      </div>
      <PlanOverlay o={overlay} onClose={() => setOverlay(null)} />
      {plan.review_note && <p className="sub"><b>Ý kiến duyệt gần nhất:</b> {plan.review_note}</p>}
      <div className="panel">{PLAN_MODE ? <PlanDocument plan={plan} tpl={templates.find(t => t.id === plan.template_id)} acts={att.acts} libs={att.libs} rubs={att.rubs}
        norm={att.norms.find(n => n.id === plan.norm_id) ?? null} items={items} teacher={plan.teachers?.full_name} /> : <LectureView plan={plan} teacher={plan.teachers?.full_name} />}</div>
    </>
  )
}

const FILTERS: [string, string, LStatus[]][] = [
  ['', 'Tất cả', []], ['pending', 'Chờ duyệt', ['pending']], ['draft', 'Đang soạn', ['draft', 'editing']], ['approved', 'Đã duyệt', ['approved']],
  ['rejected', 'Bị trả lại', ['rejected']], ['published', 'Đã xuất bản', ['published']], ['archived', 'Lưu trữ', ['archived']],
]

// ===== Trường =====
export function SchoolLessons({ orgId, go }: P) {
  const rights = useRights(orgId)
  const [tab, setTab] = useState<'plans' | 'tpl' | 'acts'>('plans')
  // Quản trị hệ thống: giáo án của mọi trường (mẫu giáo án ở tab riêng)
  if (useAllMode()) return <SchoolPlans orgId={orgId} />
  return (
    <>
      <Tabs value={tab} onChange={setTab} items={PLAN_MODE ? [['plans', 'Giáo án của giáo viên'], ['tpl', 'Mẫu giáo án'], ['acts', 'Kho hoạt động']]
        : [['plans', 'Bài giảng của giáo viên'], ['acts', 'Kho hoạt động']]} />
      {tab === 'plans' ? <SchoolPlans orgId={orgId} go={go} /> : tab === 'acts' ? rights.ready && <SchoolActivities orgId={orgId} canWrite={rights.canWrite} />
        : rights.ready && <TemplatesManager orgId={orgId} canWrite={rights.canWrite} isSchool />}
    </>
  )
}

function SchoolPlans({ orgId, go }: P) {
  const templates = useTemplates()
  const [rows, setRows] = useState<LPlan[]>([])
  const [st, setSt] = useState('')
  const [teacher, setTeacher] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<LPlan | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [reviewRequired, setReviewRequired] = useState<boolean | null>(null)
  const every = useAllMode(), orgName = useOrgName()
  const [fo, setFo] = useState('')
  async function load() {
    const base = supabase.from('lesson_plans').select(PLAN_COLS)
    const { data, error } = await (every ? base : base.eq('org_id', orgId ?? '')).order('updated_at', { ascending: false })
    if (error) setMsg([errText(error.message), true])
    // Bản nháp sửa bài đã xuất bản (076): chỉ hiện khi đang gửi duyệt / đã có kết quả duyệt, ghi rõ là bản nháp
    setRows(((data as LPlan[]) ?? []).filter(p => !p.draft_of || !['draft', 'editing'].includes(p.status))
      .map(p => normPlan(p.draft_of ? { ...p, title: p.title + ' (bản nháp sửa)' } : p)))
  }
  useEffect(() => { load() }, [orgId])
  useEffect(() => { if (orgId && !every) supabase.rpc('lesson_review_required', { p_org: orgId }).then(({ data }) => setReviewRequired(!!data)) }, [orgId])

  const plans = rows.filter(r => !r.is_template && (!fo || r.org_id === fo))
  const teachers = [...new Map(plans.filter(p => p.teacher_id).map(p => [p.teacher_id!, p.teachers?.full_name ?? '—'])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const statuses = FILTERS.find(f => f[0] === st)?.[2] ?? []
  const shown = plans.filter(p => (!statuses.length || statuses.includes(p.status)) && (!teacher || p.teacher_id === teacher)
    && (!q || p.title.toLowerCase().includes(q.toLowerCase())))
  const n = (ss: LStatus[]) => plans.filter(p => ss.includes(p.status)).length

  async function decide(p: LPlan, d: 'approve' | 'reject') {
    const note = prompt(d === 'approve' ? 'Ý kiến khi duyệt (không bắt buộc):' : 'Lý do trả lại / góp ý cho giáo viên:', '')
    if (note === null) return
    if (d === 'reject' && !note.trim()) return setMsg(['Nhập góp ý khi trả lại bài giảng.', true])
    const { error } = await supabase.rpc('approval_decide_ref', { p_table: 'lesson_plans', p_ref: p.id, p_decision: d, p_note: note.trim() || null })
    if (error) return setMsg([errText(error.message), true])
    setMsg([d === 'approve' ? `Đã duyệt “${p.title}”. Giáo viên có thể xuất bản.` : `Đã trả lại “${p.title}” cho giáo viên.`, false]); setOpen(null); load()
  }
  function exportX() {
    downloadXlsx(PLAN_MODE ? 'Giao-an' : 'Bai-giang', [
      { key: 't', label: PLAN_MODE ? 'Giáo án' : 'Bài giảng', width: 36 }, { key: 'gv', label: 'Giáo viên', width: 22 }, { key: 'm', label: 'Môn' }, { key: 'k', label: 'Khối' },
      { key: 'tpl', label: 'Mẫu', width: 24 }, { key: 'b', label: 'Số bước' }, { key: 'ph', label: 'Phút' }, { key: 'tt', label: 'Trạng thái' },
      { key: 'v', label: 'Phiên bản' }, { key: 'u', label: 'Cập nhật' },
    ], shown.map(p => [p.title, p.teachers?.full_name ?? '', p.subject ?? '', p.grades ?? '', templates.find(t => t.id === p.template_id)?.name ?? '',
      p.steps.length, totalMinutes(p.steps), LSTATUS[p.status]?.[0] ?? p.status, p.version_no, fmtD(p.updated_at)]))
  }

  const psel = useRowSel(shown)
  if (open) return <PlanPreview plan={open} orgId={orgId} onClose={() => setOpen(null)} extra={open.status === 'pending' && <>
    <button className="primary" onClick={() => decide(open, 'approve')}>Duyệt</button> <button className="danger" onClick={() => decide(open, 'reject')}>Trả lại</button></>} />
  return (
    <>
      <Tiles items={[
        { label: PLAN_MODE ? 'Giáo án' : 'Bài giảng', value: plans.length, sub: `${new Set(plans.map(p => p.teacher_id)).size} giáo viên soạn` },
        { label: 'Chờ duyệt', value: n(['pending']), tone: n(['pending']) ? 'warn' : undefined },
        { label: 'Đang soạn', value: n(['draft', 'editing']) },
        { label: 'Đã xuất bản', value: n(['published']), sub: `${rows.filter(r => r.is_template).length} bài mẫu của trường` },
        { label: 'Bị trả lại', value: n(['rejected']) },
      ]} />
      <p className="sub">{reviewRequired === null ? '' : reviewRequired
        ? `Trường đang bật quy trình duyệt ${NOUN}: giáo viên gửi duyệt, tổ trưởng / BGH duyệt rồi giáo viên mới xuất bản.`
        : `Trường chưa bật quy trình duyệt ${NOUN}: giáo viên tự xuất bản. Bật trong Quy trình phê duyệt (loại “Giáo án”) nếu cần duyệt.`}
        {go && <> <button className="linkbtn" onClick={() => go('Quy trình phê duyệt')}>Quy trình phê duyệt</button></>}</p>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      <div className="tools" style={{ marginBottom: 12 }}>
        <input className="search" style={{ margin: 0 }} placeholder={`Tìm ${NOUN}…`} value={q} onChange={e => setQ(e.target.value)} aria-label={`Tìm ${NOUN}`} />
        <select value={st} onChange={e => setSt(e.target.value)} aria-label="Lọc trạng thái">{FILTERS.map(([k, l, ss]) => <option key={k} value={k}>{l}{ss.length ? ` (${n(ss)})` : ''}</option>)}</select>
        <OrgFilter ids={rows.map(r => r.org_id)} value={fo} onChange={setFo} />
        <select value={teacher} onChange={e => setTeacher(e.target.value)} aria-label="Lọc giáo viên"><option value="">Tất cả giáo viên</option>{teachers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <button onClick={exportX} disabled={!shown.length}>Xuất Excel</button>
      </div>
      <SelBar picked={psel.cur?.title ?? null}>
        <button className="primary" disabled={psel.cur?.status !== 'pending'} onClick={() => psel.cur && decide(psel.cur, 'approve')}>Duyệt</button>
        <button className="danger" disabled={psel.cur?.status !== 'pending'} onClick={() => psel.cur && decide(psel.cur, 'reject')}>Trả lại</button>
      </SelBar>
      <div className="wrap"><table>
        <thead><tr><SelTh /><th>{PLAN_MODE ? 'Giáo án' : 'Bài giảng'}</th><th>Giáo viên</th>{PLAN_MODE && <th>Mẫu</th>}<th>{PLAN_MODE ? 'Tiến trình' : 'Nội dung'}</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead>
        <tbody>{shown.map(p => (
          <tr key={p.id} className={psel.is(p) ? 'picked' : undefined}>
            <SelTd on={psel.is(p)} onToggle={() => psel.toggle(p)} label={p.title} />
            <td><NameLink onClick={() => setOpen(p)}>{p.title}</NameLink><br /><small className="sub">{[p.subject, p.grades && `Khối ${p.grades}`, p.periods && `${p.periods} tiết`].filter(Boolean).join(' · ')}</small></td>
            <td>{p.teachers?.full_name ?? '—'}{every && <><br /><small className="sub">{orgName(p.org_id)}</small></>}</td>
            {PLAN_MODE && <td><small>{templates.find(t => t.id === p.template_id)?.name ?? 'Không theo mẫu'}</small></td>}
            <td><small>{PLAN_MODE ? `${p.steps.length} bước · ${totalMinutes(p.steps)} phút · ${p.slides.length} slide`
              : `${lessonStats(asLesson(p.lesson)).blocks} khối · ${p.slides.length} slide`}</small></td>
            <td><LStatusPill s={p.status} />{p.version_no > 0 && <small> v{p.version_no}</small>}</td>
            <td><small>{fmtD(p.updated_at)}</small></td>
          </tr>
        ))}</tbody>
      </table></div>
      {shown.length === 0 && <p className="sub">Không có {NOUN} nào.</p>}
    </>
  )
}

// ===== Sở / Phòng =====
export function DeptLessons({ orgId }: P) {
  const rights = useRights(orgId)
  const [tab, setTab] = useState<'plans' | 'tpl'>('plans')
  if (!PLAN_MODE) return <PublishedPlans orgId={orgId} />
  return (
    <>
      <Tabs value={tab} onChange={setTab} items={[['plans', 'Giáo án đã xuất bản'], ['tpl', 'Mẫu giáo án dùng chung']]} />
      {tab === 'plans' ? <PublishedPlans orgId={orgId} /> : rights.ready && <TemplatesManager orgId={orgId} canWrite={rights.canWrite} isSchool={false} />}
    </>
  )
}

function PublishedPlans({ orgId }: P) {
  const templates = useTemplates()
  const [rows, setRows] = useState<LPlan[]>([])
  const [orgs, setOrgs] = useState<Map<string, string>>(new Map())
  const [school, setSchool] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<LPlan | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('lesson_plans').select(PLAN_COLS).eq('status', 'published').neq('org_id', orgId ?? '').order('published_at', { ascending: false, nullsFirst: false }).limit(1000)
      .then(({ data, error }) => { if (error) setErr(errText(error.message)); setRows(((data as LPlan[]) ?? []).map(normPlan)) })
    supabase.from('organizations').select('id, name').eq('type', 'school').then(({ data }) => setOrgs(new Map(((data as { id: string; name: string }[]) ?? []).map(o => [o.id, o.name]))))
  }, [orgId])
  const schools = [...new Set(rows.map(r => r.org_id))].map(id => [id, orgs.get(id) ?? '—'] as const).sort((a, b) => a[1].localeCompare(b[1]))
  const shown = rows.filter(r => (!school || r.org_id === school) && (!q || r.title.toLowerCase().includes(q.toLowerCase())))
  const byTpl = (id: string | null) => templates.find(t => t.id === id)?.name
  if (open) return <PlanPreview plan={open} orgId={orgId} onClose={() => setOpen(null)} />
  return (
    <>
      <Tiles items={[
        { label: PLAN_MODE ? 'Giáo án đã xuất bản' : 'Bài giảng đã xuất bản', value: rows.length },
        { label: `Trường có ${NOUN}`, value: schools.length },
        ...(PLAN_MODE ? [{ label: 'Theo mẫu dùng chung', value: rows.filter(r => r.template_id && byTpl(r.template_id)).length },
          { label: 'Có gắn định mức vật tư', value: rows.filter(r => r.norm_id).length }]
          : [{ label: 'Có bài giảng tương tác', value: rows.filter(r => lessonStats(asLesson(r.lesson)).blocks > 0).length }]),
      ]} />
      <p className="sub">Chỉ xem {NOUN} giáo viên các trường trực thuộc đã xuất bản (bản nháp và bài chờ duyệt thuộc quyền của trường).</p>
      {err && <p className="msg">{err}</p>}
      <div className="tools" style={{ marginBottom: 12 }}>
        <input className="search" style={{ margin: 0 }} placeholder={`Tìm ${NOUN}…`} value={q} onChange={e => setQ(e.target.value)} aria-label={`Tìm ${NOUN}`} />
        <select value={school} onChange={e => setSchool(e.target.value)} aria-label="Lọc trường"><option value="">Tất cả trường</option>{schools.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      </div>
      <div className="wrap"><table>
        <thead><tr><th>{PLAN_MODE ? 'Giáo án' : 'Bài giảng'}</th><th>Trường</th><th>Giáo viên</th>{PLAN_MODE && <th>Mẫu</th>}<th>{PLAN_MODE ? 'Tiến trình' : 'Nội dung'}</th><th>Xuất bản</th></tr></thead>
        <tbody>{shown.map(p => (
          <tr key={p.id}>
            <td><NameLink onClick={() => setOpen(p)}>{p.title}</NameLink><br /><small className="sub">{[p.subject, p.grades && `Khối ${p.grades}`].filter(Boolean).join(' · ')}</small></td>
            <td>{orgs.get(p.org_id) ?? '—'}</td><td>{p.teachers?.full_name ?? '—'}</td>
            {PLAN_MODE && <td><small>{byTpl(p.template_id) ?? '—'}</small></td>}
            <td><small>{PLAN_MODE ? `${p.steps.length} bước · ${totalMinutes(p.steps)} phút` : `${lessonStats(asLesson(p.lesson)).blocks} khối · ${p.slides.length} slide`}</small></td>
            <td><small>v{p.version_no} · {fmtD(p.published_at)}</small></td>
          </tr>
        ))}</tbody>
      </table></div>
      {shown.length === 0 && <p className="sub">Chưa có {NOUN} nào được xuất bản.</p>}
    </>
  )
}

// ===== KDI: mẫu giáo án dùng chung =====
export function PlatformLessonTemplates({ orgId }: P) {
  return <TemplatesManager orgId={orgId} canWrite isSchool={false} />
}

// ===== Trường: Kho hoạt động (bài mẫu của trường và hoạt động giáo viên soạn) =====
type ActRow = { id: string; kind: ActKind; title: string; subject: string | null; grades: string | null; status: string; is_template: boolean
  updated_at: string; teacher_id: string | null; teachers: { full_name: string } | null }
function SchoolActivities({ orgId, canWrite }: { orgId: string | null; canWrite: boolean }) {
  const [rows, setRows] = useState<ActRow[]>([])
  const [desk, setDesk] = useState<{ mode: 'new' } | { mode: 'open'; id: string } | null>(null)
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [err, setErr] = useState('')
  async function load() {
    const { data, error } = await supabase.from('activities').select('id, kind, title, subject, grades, status, is_template, updated_at, teacher_id, teachers(full_name)')
      .eq('org_id', orgId ?? '').eq('domain', 'school').order('updated_at', { ascending: false })
    if (error) setErr(errText(error.message))
    setRows((data as unknown as ActRow[]) ?? [])
  }
  useEffect(() => { if (orgId) load() }, [orgId])
  if (desk) return <Suspense fallback={<p className="sub">Đang tải…</p>}><ActivityDesk orgId={orgId} start={desk} onClose={() => { setDesk(null); load() }} /></Suspense>
  const shown = rows.filter(r => (!kind || r.kind === kind) && (!q || `${r.title} ${r.subject ?? ''} ${r.teachers?.full_name ?? ''}`.toLowerCase().includes(q.toLowerCase())))
  const kinds = [...new Set(rows.map(r => r.kind))]
  return (
    <>
      <Tiles items={[
        { label: 'Hoạt động', value: rows.length, sub: `${new Set(rows.map(r => r.teacher_id).filter(Boolean)).size} giáo viên soạn` },
        { label: 'Đã xuất bản', value: rows.filter(r => r.status === 'published').length },
        { label: 'Bài mẫu của trường', value: rows.filter(r => r.is_template).length },
      ]} />
      <p className="sub">Hoạt động tương tác (trắc nghiệm, nối cặp, sắp xếp…) giáo viên thêm vào bài giảng. Bài mẫu của trường do quản trị trường soạn, giáo viên dùng lại được.</p>
      {err && <p className="msg">{err}</p>}
      <div className="tools" style={{ marginBottom: 12 }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm hoạt động…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm hoạt động" />
        <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Lọc loại"><option value="">Tất cả loại</option>{kinds.map(k => <option key={k} value={k}>{ACT[k]?.label ?? k}</option>)}</select>
        {canWrite && <button className="primary" onClick={() => setDesk({ mode: 'new' })}>+ Thêm hoạt động mẫu</button>}
      </div>
      <div className="wrap"><table>
        <thead><tr><th>Hoạt động</th><th>Loại</th><th>Giáo viên</th><th>Môn · khối</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead>
        <tbody>{shown.map(a => (
          <tr key={a.id}>
            <td><NameLink onClick={() => setDesk({ mode: 'open', id: a.id })}>{a.title}</NameLink>{a.is_template && <> <span className="pill">Mẫu</span></>}</td>
            <td>{ACT[a.kind]?.label ?? a.kind}</td>
            <td>{a.teachers?.full_name ?? <small>Trường</small>}</td>
            <td><small>{[a.subject, a.grades && `Khối ${a.grades}`].filter(Boolean).join(' · ')}</small></td>
            <td><span className={'pill ' + (a.status === 'published' ? 'active' : '')}>{a.status === 'published' ? 'Đã xuất bản' : 'Nháp'}</span></td>
            <td><small>{fmtD(a.updated_at)}</small></td>
          </tr>
        ))}</tbody>
      </table></div>
      {shown.length === 0 && <p className="sub">Chưa có hoạt động nào.</p>}
    </>
  )
}
