import { NameLink, SelBar, SelTd, SelTh, useRowSel } from '../../components/TableSel'
// Giáo án & bài giảng cho Trường (duyệt, theo dõi, mẫu giáo án), Sở / Phòng (giáo án đã xuất bản của trường trực thuộc, mẫu dùng chung)
// và KDI (mẫu giáo án dùng chung toàn hệ thống)
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import { Tiles } from '../department/charts'
import { downloadXlsx } from '../../lib/sheet'
import {
  type LPlan, type LStatus, type NormItem, LSTATUS, LStatusPill, fmtD, errText, PLAN_COLS, useTemplates, useAttachables, totalMinutes,
  PlanDocument, printPlan, TemplatesManager,
} from './common'
import { normPlan } from './Studio'

type P = { orgId: string | null; go?: (page: string) => void }

function useRights(orgId: string | null) {
  const [r, setR] = useState({ isSchool: false, canWrite: false, ready: false })
  useEffect(() => {
    if (!orgId) return
    supabase.from('organizations').select('type').eq('id', orgId).maybeSingle().then(async ({ data }) => {
      const t = (data as { type: string } | null)?.type ?? null
      if (t !== 'school') return setR({ isSchool: false, canWrite: true, ready: true })
      const [a, p] = await Promise.all([supabase.rpc('is_admin'), supabase.rpc('has_perm', { p_module: 'library', p_action: 'edit' })])
      setR({ isSchool: true, canWrite: !!a.data || !!p.data, ready: true })
    })
  }, [orgId])
  return r
}

// Xem trước một giáo án (dùng ở các màn quản lý)
export function PlanPreview({ plan, orgId, onClose, extra }: { plan: LPlan; orgId: string | null; onClose: () => void; extra?: React.ReactNode }) {
  const templates = useTemplates()
  const att = useAttachables(orgId)
  const [items, setItems] = useState<NormItem[]>([])
  useEffect(() => {
    if (plan.norm_id) supabase.from('material_norm_items').select('*').eq('norm_id', plan.norm_id).order('seq').then(({ data }) => setItems((data as NormItem[]) ?? []))
  }, [plan.norm_id])
  return (
    <>
      <div className="bar">
        <span className="tools"><button onClick={onClose}>← Danh sách</button><LStatusPill s={plan.status} />{plan.version_no > 0 && <small>Phiên bản {plan.version_no}</small>}</span>
        <span className="tools">{extra}<button onClick={() => printPlan(plan.title)}>In / lưu PDF</button></span>
      </div>
      {plan.review_note && <p className="sub"><b>Ý kiến duyệt gần nhất:</b> {plan.review_note}</p>}
      <div className="panel"><PlanDocument plan={plan} tpl={templates.find(t => t.id === plan.template_id)} acts={att.acts} libs={att.libs} rubs={att.rubs}
        norm={att.norms.find(n => n.id === plan.norm_id) ?? null} items={items} teacher={plan.teachers?.full_name} /></div>
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
  const [tab, setTab] = useState<'plans' | 'tpl'>('plans')
  return (
    <>
      <Tabs value={tab} onChange={setTab} items={[['plans', 'Giáo án của giáo viên'], ['tpl', 'Mẫu giáo án']]} />
      {tab === 'plans' ? <SchoolPlans orgId={orgId} go={go} /> : rights.ready && <TemplatesManager orgId={orgId} canWrite={rights.canWrite} isSchool />}
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
  async function load() {
    const { data, error } = await supabase.from('lesson_plans').select(PLAN_COLS).eq('org_id', orgId ?? '').order('updated_at', { ascending: false })
    if (error) setMsg([errText(error.message), true])
    // Bản nháp sửa bài đã xuất bản (076): chỉ hiện khi đang gửi duyệt / đã có kết quả duyệt, ghi rõ là bản nháp
    setRows(((data as LPlan[]) ?? []).filter(p => !p.draft_of || !['draft', 'editing'].includes(p.status))
      .map(p => normPlan(p.draft_of ? { ...p, title: p.title + ' (bản nháp sửa)' } : p)))
  }
  useEffect(() => { load() }, [orgId])
  useEffect(() => { if (orgId) supabase.rpc('lesson_review_required', { p_org: orgId }).then(({ data }) => setReviewRequired(!!data)) }, [orgId])

  const plans = rows.filter(r => !r.is_template)
  const teachers = [...new Map(plans.filter(p => p.teacher_id).map(p => [p.teacher_id!, p.teachers?.full_name ?? '—'])).entries()].sort((a, b) => a[1].localeCompare(b[1]))
  const statuses = FILTERS.find(f => f[0] === st)?.[2] ?? []
  const shown = plans.filter(p => (!statuses.length || statuses.includes(p.status)) && (!teacher || p.teacher_id === teacher)
    && (!q || p.title.toLowerCase().includes(q.toLowerCase())))
  const n = (ss: LStatus[]) => plans.filter(p => ss.includes(p.status)).length

  async function decide(p: LPlan, d: 'approve' | 'reject') {
    const note = prompt(d === 'approve' ? 'Ý kiến khi duyệt (không bắt buộc):' : 'Lý do trả lại / góp ý cho giáo viên:', '')
    if (note === null) return
    if (d === 'reject' && !note.trim()) return setMsg(['Nhập góp ý khi trả lại giáo án.', true])
    const { error } = await supabase.rpc('approval_decide_ref', { p_table: 'lesson_plans', p_ref: p.id, p_decision: d, p_note: note.trim() || null })
    if (error) return setMsg([errText(error.message), true])
    setMsg([d === 'approve' ? `Đã duyệt “${p.title}”. Giáo viên có thể xuất bản.` : `Đã trả lại “${p.title}” cho giáo viên.`, false]); setOpen(null); load()
  }
  function exportX() {
    downloadXlsx('Giao-an', [
      { key: 't', label: 'Giáo án', width: 36 }, { key: 'gv', label: 'Giáo viên', width: 22 }, { key: 'm', label: 'Môn' }, { key: 'k', label: 'Khối' },
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
        { label: 'Giáo án', value: plans.length, sub: `${new Set(plans.map(p => p.teacher_id)).size} giáo viên soạn` },
        { label: 'Chờ duyệt', value: n(['pending']), tone: n(['pending']) ? 'warn' : undefined },
        { label: 'Đang soạn', value: n(['draft', 'editing']) },
        { label: 'Đã xuất bản', value: n(['published']), sub: `${rows.filter(r => r.is_template).length} bài mẫu của trường` },
        { label: 'Bị trả lại', value: n(['rejected']) },
      ]} />
      <p className="sub">{reviewRequired === null ? '' : reviewRequired
        ? 'Trường đang bật quy trình duyệt giáo án: giáo viên gửi duyệt, tổ trưởng / BGH duyệt rồi giáo viên mới xuất bản.'
        : 'Trường chưa bật quy trình duyệt giáo án: giáo viên tự xuất bản. Bật trong Quy trình phê duyệt (loại “Giáo án”) nếu cần duyệt.'}
        {go && <> <button className="linkbtn" onClick={() => go('Quy trình phê duyệt')}>Quy trình phê duyệt</button></>}</p>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      <div className="tools" style={{ marginBottom: 12 }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm giáo án…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm giáo án" />
        <select value={st} onChange={e => setSt(e.target.value)} aria-label="Lọc trạng thái">{FILTERS.map(([k, l, ss]) => <option key={k} value={k}>{l}{ss.length ? ` (${n(ss)})` : ''}</option>)}</select>
        <select value={teacher} onChange={e => setTeacher(e.target.value)} aria-label="Lọc giáo viên"><option value="">Tất cả giáo viên</option>{teachers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <button onClick={exportX} disabled={!shown.length}>Xuất Excel</button>
      </div>
      <SelBar picked={psel.cur?.title ?? null}>
        <button className="primary" disabled={psel.cur?.status !== 'pending'} onClick={() => psel.cur && decide(psel.cur, 'approve')}>Duyệt</button>
        <button className="danger" disabled={psel.cur?.status !== 'pending'} onClick={() => psel.cur && decide(psel.cur, 'reject')}>Trả lại</button>
      </SelBar>
      <div className="wrap"><table>
        <thead><tr><SelTh /><th>Giáo án</th><th>Giáo viên</th><th>Mẫu</th><th>Tiến trình</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead>
        <tbody>{shown.map(p => (
          <tr key={p.id} className={psel.is(p) ? 'picked' : undefined}>
            <SelTd on={psel.is(p)} onToggle={() => psel.toggle(p)} label={p.title} />
            <td><NameLink onClick={() => setOpen(p)}>{p.title}</NameLink><br /><small className="sub">{[p.subject, p.grades && `Khối ${p.grades}`, p.periods && `${p.periods} tiết`].filter(Boolean).join(' · ')}</small></td>
            <td>{p.teachers?.full_name ?? '—'}</td>
            <td><small>{templates.find(t => t.id === p.template_id)?.name ?? 'Không theo mẫu'}</small></td>
            <td><small>{p.steps.length} bước · {totalMinutes(p.steps)} phút · {p.slides.length} slide</small></td>
            <td><LStatusPill s={p.status} />{p.version_no > 0 && <small> v{p.version_no}</small>}</td>
            <td><small>{fmtD(p.updated_at)}</small></td>
          </tr>
        ))}</tbody>
      </table></div>
      {shown.length === 0 && <p className="sub">Không có giáo án nào.</p>}
    </>
  )
}

// ===== Sở / Phòng =====
export function DeptLessons({ orgId }: P) {
  const rights = useRights(orgId)
  const [tab, setTab] = useState<'plans' | 'tpl'>('plans')
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
        { label: 'Giáo án đã xuất bản', value: rows.length },
        { label: 'Trường có giáo án', value: schools.length },
        { label: 'Theo mẫu dùng chung', value: rows.filter(r => r.template_id && byTpl(r.template_id)).length },
        { label: 'Có gắn định mức vật tư', value: rows.filter(r => r.norm_id).length },
      ]} />
      <p className="sub">Chỉ xem giáo án giáo viên các trường trực thuộc đã xuất bản (bản nháp và giáo án chờ duyệt thuộc quyền của trường).</p>
      {err && <p className="msg">{err}</p>}
      <div className="tools" style={{ marginBottom: 12 }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm giáo án…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm giáo án" />
        <select value={school} onChange={e => setSchool(e.target.value)} aria-label="Lọc trường"><option value="">Tất cả trường</option>{schools.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      </div>
      <div className="wrap"><table>
        <thead><tr><th>Giáo án</th><th>Trường</th><th>Giáo viên</th><th>Mẫu</th><th>Tiến trình</th><th>Xuất bản</th></tr></thead>
        <tbody>{shown.map(p => (
          <tr key={p.id}>
            <td><NameLink onClick={() => setOpen(p)}>{p.title}</NameLink><br /><small className="sub">{[p.subject, p.grades && `Khối ${p.grades}`].filter(Boolean).join(' · ')}</small></td>
            <td>{orgs.get(p.org_id) ?? '—'}</td><td>{p.teachers?.full_name ?? '—'}</td>
            <td><small>{byTpl(p.template_id) ?? '—'}</small></td>
            <td><small>{p.steps.length} bước · {totalMinutes(p.steps)} phút</small></td>
            <td><small>v{p.version_no} · {fmtD(p.published_at)}</small></td>
          </tr>
        ))}</tbody>
      </table></div>
      {shown.length === 0 && <p className="sub">Chưa có giáo án nào được xuất bản.</p>}
    </>
  )
}

// ===== KDI: mẫu giáo án dùng chung =====
export function PlatformLessonTemplates({ orgId }: P) {
  return <TemplatesManager orgId={orgId} canWrite isSchool={false} />
}
