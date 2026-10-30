import { CoverPicker, coverStyle } from '../../components/Cover'
import { useHiddenBtn } from '../../components/PageButtons'
import { MultiSelect } from '../../components/MultiSelect'
import { NameLink, SelBar, SelTd, SelTh, useRowSel } from '../../components/TableSel'
import { Icon } from '../../components/Icon'
// Soạn bài giảng (060): giáo án theo mẫu, tiến trình dạy học theo bước, gắn hoạt động / học liệu / rubric / định mức vật tư,
// xem trước – in, trình chiếu, dạy thử; lưu nháp → gửi duyệt → xuất bản; nhân bản, phiên bản, dạy thử & góp ý
import { useStemTracks } from '../../lib/stemTracks'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { TProps, NoTeacher, PROGRAM_COLOR, Tabs, handoff, useMyClasses } from '../teacher/common'
import { SlideView, SlideStudio, newSlide, ago } from '../teacher/Lessons'
import { useProgramOptions, unitTree, progLabel } from '../library/common'
import { GradeChecks, SubjectPicker, gradeList } from '../../components/Pickers'
import { asLesson, emptyLesson, lessonStats, LessonEditor, LessonOutline, LessonPlayer, LessonShow, type ILesson } from '../../lib/lessonBlocks'
import {
  type LPlan, type LStatus, type Template, type Step, type Adjust, type Version, type Review, type NormItem, type NormLite,
  LStatusPill, editable, BASIS, uid, fmtD, errText, PLAN_COLS, useTemplates, useAttachables, libLabel, actLabel, phasesOf, totalMinutes,
  PlanDocument, printPlan, PLAN_MODE,
} from './common'

// Hàng cũ (trước 060) có thể thiếu cột mới → chuẩn hoá về giá trị rỗng
export const normPlan = (p: LPlan): LPlan => ({
  ...p, doc: p.doc ?? {}, steps: p.steps ?? [], slides: p.slides ?? [], library_ids: p.library_ids ?? [], rubric_ids: p.rubric_ids ?? [],
  norm_adjust: p.norm_adjust ?? [], version_no: p.version_no ?? 0, template_id: p.template_id ?? null, lesson: p.lesson ?? {}, cover_url: p.cover_url ?? null,
})
const blocksOf = (p: LPlan) => lessonStats(asLesson(p.lesson)).blocks
// Mở bài giảng: có khối tương tác → trình chiếu theo khối; không thì slide cũ
type Overlay = { plan: LPlan; kind: 'show' | 'player' } | null
export function PlanOverlay({ o, onClose }: { o: Overlay; onClose: () => void }) {
  if (!o) return null
  const l = asLesson(o.plan.lesson)
  if (!l) return null
  const sub = [o.plan.subject, o.plan.grades && `Khối ${o.plan.grades}`].filter(Boolean).join(' · ')
  return o.kind === 'show' ? <LessonShow title={o.plan.title} ct={o.plan.program} sub={sub} lesson={l} onClose={onClose} />
    : <LessonPlayer title={o.plan.title} ct={o.plan.program} sub={o.plan.summary ?? undefined} lesson={l} onClose={onClose} />
}
async function rpcErr(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args)
  return { data, err: error ? errText(error.message) : '' }
}

type View = { mode: 'list' } | { mode: 'new' } | { mode: 'edit'; id: string } | { mode: 'present'; plan: LPlan; i: number; back?: string }
type LTab = 'all' | 'draft' | 'pending' | 'rejected' | 'published'
const IN_TAB: Record<LTab, LStatus[]> = {
  all: [], draft: ['draft', 'editing'], pending: ['pending', 'approved'], rejected: ['rejected'], published: ['published', 'archived'],
}

export function TeacherLessonStudio({ teacherId, orgId, go }: TProps) {
  const hid = useHiddenBtn()
  const { codes: PROGRAMS } = useStemTracks()
  const [plans, setPlans] = useState<LPlan[]>([])
  const [view, setView] = useState<View>({ mode: 'list' })
  const [tab, setTab] = useState<LTab>('all')
  const [library, setLibrary] = useState(false)
  const [q, setQ] = useState('')
  const [program, setProgram] = useState('')
  const [err, setErr] = useState('')
  const [reviewRequired, setReviewRequired] = useState(false)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const templates = useTemplates()
  // Trang khác (Kho bài giảng, Thư viện STEM) mở thẳng một giáo án
  useEffect(() => {
    let id: string | null = null
    try { id = sessionStorage.getItem('kdi.openPlan'); if (id) sessionStorage.removeItem('kdi.openPlan') } catch { /* bỏ qua */ }
    if (id) setView({ mode: 'edit', id })
  }, [])
  const present = (p: LPlan) => blocksOf(p) > 0 ? setOverlay({ plan: p, kind: 'show' }) : setView({ mode: 'present', plan: p, i: 0 })

  async function load() {
    const { data, error } = await supabase.from('lesson_plans').select(PLAN_COLS).order('updated_at', { ascending: false })
    if (error) setErr(errText(error.message))
    setPlans(((data as LPlan[]) ?? []).map(normPlan))
  }
  useEffect(() => { load() }, [teacherId])
  useEffect(() => { if (orgId) supabase.rpc('lesson_review_required', { p_org: orgId }).then(({ data }) => setReviewRequired(!!data)) }, [orgId])

  // Bản nháp để sửa (076) không hiện thành thẻ riêng: thẻ bài gốc có nút mở bản nháp
  const draftOf = new Map(plans.filter(p => p.draft_of).map(p => [p.draft_of as string, p]))
  const mine = plans.filter(p => p.teacher_id === teacherId && !p.is_template && !p.draft_of)
  // 094: kèm bài giảng KDI đã xuất bản (bài của đơn vị khác mà giáo viên đọc được)
  const shared = plans.filter(p => !p.draft_of && (p.org_id === orgId ? (p.is_template || (p.teacher_id !== teacherId && p.status === 'published')) : p.status === 'published' && p.is_template))
  const src = library ? shared : mine
  const filtered = src.filter(p => (!program || p.program === program) && (!q || p.title.toLowerCase().includes(q.toLowerCase())))
  const shown = library || tab === 'all' ? filtered : filtered.filter(p => IN_TAB[tab].includes(p.status))
  const count = (t: LTab) => (t === 'all' ? filtered.length : filtered.filter(p => IN_TAB[t].includes(p.status)).length)

  async function clone(p: LPlan) {
    const { data, err } = await rpcErr('lesson_plan_clone', { p_plan: p.id, p_title: null })
    if (err) return setErr('Không nhân bản được: ' + err)
    setLibrary(false); setTab('all'); await load(); setView({ mode: 'edit', id: data as string })
  }
  async function remove(p: LPlan) {
    if (!confirm(`Xoá bài giảng “${p.title}”? Lịch sử phiên bản và góp ý của bài cũng bị xoá.`)) return
    const { error } = await supabase.from('lesson_plans').delete().eq('id', p.id)
    if (error) setErr(errText(error.message)); load()
  }

  if (!teacherId) return <NoTeacher />
  if (view.mode === 'new') return <NewPlan teacherId={teacherId} orgId={orgId} templates={templates} onTemplates={() => { setView({ mode: 'list' }); setLibrary(true) }}
    onCancel={() => setView({ mode: 'list' })} onCreated={id => { load(); setView({ mode: 'edit', id }) }} />
  if (view.mode === 'edit') return <Editor id={view.id} teacherId={teacherId} orgId={orgId} go={go} templates={templates} reviewRequired={reviewRequired}
    onClose={() => { setView({ mode: 'list' }); load() }} onOpen={id => setView({ mode: 'edit', id })} onPresent={p => setView({ mode: 'present', plan: p, i: 0, back: p.id })} />
  if (view.mode === 'present') return <Presenter plan={view.plan} i={view.i} onMove={i => setView({ ...view, i })}
    onClose={() => setView(view.back ? { mode: 'edit', id: view.back } : { mode: 'list' })} />

  return (
    <>
      <PlanOverlay o={overlay} onClose={() => setOverlay(null)} />
      <div className="bar">
        {library
          ? <p className="sub" style={{ margin: 0 }}><button onClick={() => setLibrary(false)} style={{ marginRight: 10 }}>← Bài giảng của tôi</button><b>Mẫu bài giảng</b> · bài mẫu của KDI, của trường và bài đồng nghiệp đã xuất bản. Bấm “Dùng mẫu này” để có bản của bạn rồi sửa tiếp.</p>
          : <Tabs<LTab> value={tab} onChange={setTab} items={[['all', 'Tất cả', count('all')], ['draft', 'Đang soạn', count('draft')],
              ['pending', 'Chờ duyệt / đã duyệt', count('pending')], ['rejected', 'Bị trả lại', count('rejected')], ['published', 'Đã xuất bản', count('published')]]} />}
        <span className="tools">
          {!library && <button onClick={() => setLibrary(true)}>Mẫu bài giảng</button>}
          {go && <button onClick={() => go('Thư viện STEM')} title="Học liệu do Sở, Phòng, KDI Education phát hành">Thư viện STEM</button>}
          {!hid('new') && <button className="primary" onClick={() => setView({ mode: 'new' })}>+ Tạo bài giảng</button>}
        </span>
      </div>
      {!library && <p className="sub" style={{ marginTop: 0 }}>{reviewRequired
        ? 'Trường đang bật quy trình duyệt bài giảng: soạn xong bấm “Gửi duyệt”, được duyệt rồi mới xuất bản.'
        : 'Trường chưa bật quy trình duyệt bài giảng: soạn xong bạn tự xuất bản. Có thể gửi duyệt nếu muốn tổ chuyên môn góp ý.'}</p>}
      <div className="tools" style={{ marginBottom: 12 }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm theo tên bài…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm bài giảng" />
        <select value={program} onChange={e => setProgram(e.target.value)} aria-label="Lọc chương trình">
          <option value="">Tất cả chương trình</option>{PROGRAMS.map(c => <option key={c}>{c}</option>)}</select>
      </div>
      {err && <p className="msg">{err}</p>}
      <div className="lessongrid">
        {shown.map(p => {
          const tpl = templates.find(t => t.id === p.template_id)
          return (
            <div className="panel lessoncard" key={p.id}>
              <div className="lessoncover" style={coverStyle(p, true)}>
                {p.program && <span className="progchip" style={{ background: PROGRAM_COLOR[p.program], color: '#fff' }}>{p.program}</span>}
                {p.from_package && <span className="progchip pkgchip">Gói STEM</span>}
                {p.is_template && <span className="progchip pkgchip">Mẫu</span>}
                {p.library_item_id && <span className="progchip pkgchip" title={`Từ kho học liệu dùng chung, phiên bản ${p.library_version ?? '?'}`}>Từ kho v{p.library_version}</span>}
                <span className="slidecount">{blocksOf(p) > 0 ? `${blocksOf(p)} khối · ${lessonStats(asLesson(p.lesson)).interactive} tương tác` : PLAN_MODE ? `${p.steps.length} bước · ${p.slides.length} slide` : `${p.slides.length} slide`}</span>
              </div>
              <b>{p.title}</b>
              <small>{[p.subject, p.grades && `Khối ${p.grades}`, PLAN_MODE && p.periods && `${p.periods} tiết`, PLAN_MODE && tpl?.name].filter(Boolean).join(' · ')}{library && p.teachers ? ` · ${p.teachers.full_name}` : ''}</small>
              <div className="lessonfoot">
                <LStatusPill s={p.status} />{p.version_no > 0 && <small>v{p.version_no}</small>}
                <small>{ago(p.updated_at)}</small>
              </div>
              {p.status === 'rejected' && p.review_note && <small className="msg" style={{ margin: 0 }}>Góp ý: {p.review_note}</small>}
              {!library && draftOf.has(p.id) && <small className="sub" style={{ margin: 0 }}><Icon n="pencil" /> Đang có bản nháp sửa · {ago(draftOf.get(p.id)!.updated_at)}</small>}
              <div className="tools">
                {library ? <>
                  <button className="primary" onClick={() => clone(p)}>Dùng mẫu này</button>
                  <button onClick={() => present(p)}>Trình chiếu</button>
                  {blocksOf(p) > 0 && <button onClick={() => setOverlay({ plan: p, kind: 'player' })}>Xem như học sinh</button>}
                </> : <>
                  <button className="primary" onClick={() => setView({ mode: 'edit', id: draftOf.get(p.id)?.id ?? p.id })}>{editable(p.status) || draftOf.has(p.id) ? 'Soạn' : 'Mở'}</button>
                  <button onClick={() => present(p)}>Trình chiếu</button>
                  <button onClick={() => clone(p)}>Nhân bản</button>
                  {p.status !== 'pending' && <button className="x" onClick={() => remove(p)} aria-label={`Xoá ${p.title}`}>×</button>}
                </>}
              </div>
            </div>
          )
        })}
        {shown.length === 0 && <p className="sub">{library ? 'Kho chưa có bài nào.' : 'Chưa có bài giảng nào ở mục này. Bấm “Tạo bài giảng” để soạn từ bài trống, hoặc vào “Mẫu bài giảng” để dùng mẫu.'}</p>}
      </div>
    </>
  )
}

// ===== Tạo giáo án: chọn mẫu hoặc trang trắng =====
// teacherId = null: bài giảng của KDI (quản trị nền tảng) — lưu là bài mẫu, không gắn giáo viên
function NewPlan({ teacherId, orgId, templates, onCancel, onCreated, onTemplates }: {
  teacherId: string | null; orgId: string | null; templates: Template[]; onCancel: () => void; onCreated: (id: string) => void; onTemplates?: () => void
}) {
  const { codes: PROGRAMS } = useStemTracks()
  const [tpl, setTpl] = useState<string>('')
  const [f, setF] = useState({ title: '', subject: '', grades: '', periods: '2', program: '' })
  const [err, setErr] = useState('')
  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId) return
    if (!f.title.trim()) return setErr('Nhập tên bài.')
    const t = templates.find(x => x.id === tpl)
    const { data, error } = await supabase.from('lesson_plans').insert({
      org_id: orgId, teacher_id: teacherId, is_template: !teacherId, status: 'draft', title: f.title.trim(), subject: f.subject || null, grades: f.grades || null,
      periods: PLAN_MODE ? Number(f.periods) || null : null, template_id: PLAN_MODE ? t?.id ?? null : null, doc: Object.fromEntries((t?.sections ?? []).map(s => [s.key, ''])),
      steps: [], slides: [{ ...newSlide('title'), title: f.title.trim() }], program: f.program || null, lesson: emptyLesson(f.program || null),
    }).select('id').single()
    if (error || !data) return setErr('Không tạo được bài giảng: ' + errText(error?.message ?? ''))
    onCreated((data as { id: string }).id)
  }
  return (
    <form onSubmit={create}>
      <div className="bar"><b>{teacherId ? 'Tạo bài giảng mới' : 'Thêm mẫu bài giảng của KDI'}</b><span className="tools"><button type="button" onClick={onCancel}>← Danh sách</button></span></div>
      {!PLAN_MODE && onTemplates && <div className="tplpick">
        <label className="panel on"><input type="radio" name="from" checked readOnly /><b>Bài trống</b><small className="sub">Đặt tên bài rồi tự soạn slide, bài giảng tương tác, thêm hoạt động từ kho.</small></label>
        <label className="panel"><input type="radio" name="from" checked={false} onChange={onTemplates} /><b>Từ mẫu bài giảng</b><small className="sub">Chọn một mẫu của KDI / trường, bấm “Dùng mẫu này” để có bản của bạn rồi sửa tiếp.</small></label>
      </div>}
      {PLAN_MODE && <><h3>1. Chọn mẫu giáo án</h3>
      <div className="tplpick">
        <label className={'panel' + (tpl === '' ? ' on' : '')}><input type="radio" name="tpl" checked={tpl === ''} onChange={() => setTpl('')} />
          <b>Trang trắng</b><small className="sub">Tự đặt các mục và các bước hoạt động.</small></label>
        {templates.map(t => (
          <label key={t.id} className={'panel' + (tpl === t.id ? ' on' : '')}><input type="radio" name="tpl" checked={tpl === t.id} onChange={() => setTpl(t.id)} />
            <b>{t.name}</b>{t.description && <small className="sub">{t.description}</small>}
            <small>{t.sections.length} mục · {t.phases.length ? t.phases.map(p => p.title).join(' → ') : 'không chia pha'}</small></label>
        ))}
      </div></>}
      <h3>{PLAN_MODE ? '2. Thông tin bài' : 'Thông tin bài'}</h3>
      <div className="panel formgrid">
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên bài *</span><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} maxLength={200} autoFocus /></label>
        <label className="field"><span>Môn</span><SubjectPicker value={f.subject} onChange={v => setF({ ...f, subject: v })} emptyLabel="— Không chọn —" /></label>
        <div className="field" style={{ gridColumn: 'span 2' }}><span>Khối</span><GradeChecks value={gradeList(f.grades)} onChange={g => setF({ ...f, grades: g.join(',') })} /></div>
        {PLAN_MODE && <label className="field"><span>Số tiết</span><input type="number" min={1} max={20} value={f.periods} onChange={e => setF({ ...f, periods: e.target.value })} /></label>}
        <label className="field"><span>Chương trình STEM (tiến trình bài giảng)</span><select value={f.program} onChange={e => setF({ ...f, program: e.target.value })}>
          <option value="">— không theo CT —</option>{PROGRAMS.map(c => <option key={c}>{c}</option>)}</select></label>
        <div className="formactions"><button className="primary" type="submit">Tạo và bắt đầu soạn</button></div>
      </div>
      {err && <p className="msg">{err}</p>}
    </form>
  )
}

// ===== Trình chiếu =====
function Presenter({ plan, i, onMove, onClose }: { plan: LPlan; i: number; onMove: (i: number) => void; onClose: () => void }) {
  const n = plan.slides.length
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') onMove(Math.min(n - 1, i + 1)); if (e.key === 'ArrowLeft') onMove(Math.max(0, i - 1)); if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [i, n])
  return (
    <div className="presenter">
      <div className="bar"><b>{plan.title}</b><span className="tools">
        <button onClick={() => onMove(Math.max(0, i - 1))} disabled={i === 0}>‹ Trước</button>
        <span>{i + 1}/{n || 1}</span>
        <button onClick={() => onMove(Math.min(n - 1, i + 1))} disabled={i >= n - 1}>Sau ›</button>
        <button onClick={() => document.querySelector('.presenter .slide')?.requestFullscreen?.()}>Toàn màn hình</button>
        <button onClick={onClose}>Đóng</button></span></div>
      <SlideView slide={plan.slides[i]} reveal />
    </div>
  )
}

// ===== Trình soạn giáo án =====
type ETab = 'info' | 'lesson' | 'doc' | 'steps' | 'slides' | 'res' | 'mat' | 'ver'
type Est = { item_id: string; name: string; unit: string; kind: string; reusable: boolean; per_qty: number; multiplier: number; need: number; stock: number | null; shortage: number; unit_price: number | null; cost: number | null }

function Editor({ id, teacherId, orgId, go, templates, reviewRequired, onClose, onOpen, onPresent }: {
  id: string; teacherId: string; orgId: string | null; go?: (page: string) => void; templates: Template[]; reviewRequired: boolean
  onClose: () => void; onOpen: (id: string) => void; onPresent: (p: LPlan) => void
}) {
  const hid = useHiddenBtn()
  const [p, setP] = useState<LPlan | null>(null)
  // Bài gốc (khi đang mở bản nháp) hoặc bản nháp đang có (khi mở bài đã xuất bản)
  const [link, setLink] = useState<{ id: string; title: string } | null>(null)
  const [tab, setTab] = useState<ETab>('info')
  const [preview, setPreview] = useState(false)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [busy, setBusy] = useState(false)
  const [versions, setVersions] = useState<Version[]>([])
  const [reviews, setReviews] = useState<Review[]>([])
  const [items, setItems] = useState<NormItem[]>([])
  const [school, setSchool] = useState<string | null>(null)
  const att = useAttachables(orgId)
  const { programs, units } = useProgramOptions(orgId)
  const classes = useMyClasses(teacherId)

  async function load() {
    const { data, error } = await supabase.from('lesson_plans').select(PLAN_COLS).eq('id', id).maybeSingle()
    if (error || !data) return setMsg([errText(error?.message ?? 'Không tìm thấy bài giảng.'), true])
    setP(normPlan(data as LPlan)); setDirty(false)
    const d = data as LPlan
    const l = d.draft_of ? await supabase.from('lesson_plans').select('id, title').eq('id', d.draft_of).maybeSingle()
      : d.status === 'published' ? await supabase.from('lesson_plans').select('id, title').eq('draft_of', d.id).maybeSingle() : null
    setLink((l?.data as { id: string; title: string } | null) ?? null)
    if (blocksOf(data as LPlan) > 0) setTab(t => (t === 'info' ? 'lesson' : t))
    const [v, r] = await Promise.all([
      supabase.from('lesson_plan_versions').select('*').eq('plan_id', id).order('version_no', { ascending: false }),
      supabase.from('lesson_plan_reviews').select('*, classes(name), profiles(full_name)').eq('plan_id', id).order('created_at', { ascending: false }),
    ])
    setVersions((v.data as Version[]) ?? [])
    if (r.error) { const r2 = await supabase.from('lesson_plan_reviews').select('*, classes(name)').eq('plan_id', id).order('created_at', { ascending: false }); setReviews((r2.data as Review[]) ?? []) }
    else setReviews((r.data as Review[]) ?? [])
  }
  useEffect(() => { load() }, [id])
  useEffect(() => { if (orgId) supabase.from('organizations').select('name').eq('id', orgId).maybeSingle().then(({ data }) => setSchool((data as { name: string } | null)?.name ?? null)) }, [orgId])
  useEffect(() => {
    if (!p?.norm_id) { setItems([]); return }
    supabase.from('material_norm_items').select('*').eq('norm_id', p.norm_id).order('seq').order('name').then(({ data }) => setItems((data as NormItem[]) ?? []))
  }, [p?.norm_id])

  if (!p) return <>{msg ? <p className="msg">{msg[0]}</p> : <p className="sub">Đang tải…</p>}<button onClick={onClose}>← Danh sách</button></>
  const ro = !editable(p.status)
  const tpl = templates.find(t => t.id === p.template_id)
  const norm = att.norms.find(n => n.id === p.norm_id) ?? null
  const upd = (patch: Partial<LPlan>) => { if (ro) return; setP({ ...p, ...patch }); setDirty(true) }
  const say = (m: string, bad = false) => setMsg([m, bad])

  function problems(): string[] {
    const out: string[] = []
    if (!PLAN_MODE) return out
    p!.steps.forEach((s, i) => { if (!s.title.trim()) out.push(`Bước ${i + 1} chưa có tên`) })
    return out
  }
  function missingRequired(): string[] {
    if (!PLAN_MODE) return []
    return (tpl?.sections ?? []).filter(s => s.required && !(p!.doc[s.key] ?? '').trim()).map(s => s.title)
  }
  async function save(quiet = false): Promise<boolean> {
    const bad = problems(); if (bad.length) { say(bad.join(' · '), true); return false }
    setBusy(true)
    const body = {
      title: p!.title.trim() || 'Bài giảng chưa đặt tên', subject: p!.subject || null, grades: p!.grades || null, program: p!.program || null,
      from_package: p!.from_package, summary: p!.summary || null, slides: p!.slides, template_id: p!.template_id, doc: p!.doc, steps: p!.steps,
      program_id: p!.program_id, unit_id: p!.unit_id, library_ids: p!.library_ids, rubric_ids: p!.rubric_ids, norm_id: p!.norm_id,
      norm_adjust: p!.norm_adjust, periods: p!.periods, lesson: p!.lesson?.goals ? { ...p!.lesson, goals: p!.lesson.goals.map((g: string) => g.trim()).filter(Boolean) } : (p!.lesson ?? {}), cover_url: p!.cover_url?.trim() || null,
      ...(p!.status === 'draft' ? { status: 'editing' } : {}),
    }
    const { data, error } = await supabase.from('lesson_plans').update(body).eq('id', p!.id).select(PLAN_COLS).single()
    setBusy(false)
    if (error || !data) { say('Không lưu được: ' + errText(error?.message ?? ''), true); return false }
    setP(normPlan(data as LPlan)); setDirty(false); if (!quiet) say('Đã lưu bản nháp.')
    return true
  }
  async function submit() {
    const miss = missingRequired()
    if (miss.length) { setTab('doc'); return say('Còn mục bắt buộc chưa soạn: ' + miss.join(', '), true) }
    if (dirty && !(await save(true))) return
    setBusy(true)
    const { error } = await supabase.from('lesson_plans').update({ status: 'pending' }).eq('id', p!.id)
    setBusy(false)
    if (error) return say(errText(error.message), true)
    await load(); say(reviewRequired ? 'Đã gửi duyệt. Bài giảng khoá sửa cho tới khi có kết quả.' : 'Đã gửi duyệt.')
  }
  async function run(fn: string, args: Record<string, unknown>, ok: string) {
    if (dirty && !ro && !(await save(true))) return
    setBusy(true); const r = await rpcErr(fn, args); setBusy(false)
    if (r.err) return say(r.err, true)
    await load(); say(ok)
  }
  async function publish() {
    const miss = missingRequired()
    if (miss.length) { setTab('doc'); return say('Còn mục bắt buộc chưa soạn: ' + miss.join(', '), true) }
    const note = prompt('Ghi chú cho phiên bản xuất bản (không bắt buộc):', p!.version_no ? 'Cập nhật sau dạy thử' : 'Bản đầu tiên')
    if (note === null) return
    if (p!.draft_of) {
      // Xuất bản thay bản cũ: nội dung chép sang bài gốc, bản nháp được bỏ → mở lại bài gốc
      if (dirty && !(await save(true))) return
      setBusy(true); const r = await rpcErr('lesson_plan_publish', { p_plan: p!.id, p_note: note }); setBusy(false)
      if (r.err) return say(r.err, true)
      return onOpen(p!.draft_of)
    }
    run('lesson_plan_publish', { p_plan: p!.id, p_note: note }, 'Đã xuất bản — đồng nghiệp thấy bài trong Mẫu bài giảng.')
  }
  async function makeDraft() {
    setBusy(true); const r = await rpcErr('lesson_plan_draft', { p_plan: p!.id }); setBusy(false)
    if (r.err) return say(r.err, true)
    onOpen(r.data as string)
  }
  async function dropDraft() {
    if (!confirm('Bỏ bản nháp này? Mọi thay đổi trong bản nháp sẽ mất; bài đã xuất bản giữ nguyên.')) return
    const orig = p!.draft_of!
    setBusy(true); const { error } = await supabase.from('lesson_plans').delete().eq('id', p!.id); setBusy(false)
    if (error) return say(errText(error.message), true)
    onOpen(orig)
  }
  const close = () => { if (!dirty || confirm('Có thay đổi chưa lưu. Thoát không lưu?')) onClose() }
  function teachTrial() {
    if (dirty && !confirm('Có thay đổi chưa lưu. Vẫn mở lớp học với bản đã lưu?')) return
    handoff.set('classroom.plan', p!.id); go?.('Giáo dục STEM')
  }

  const canPublish = ['draft', 'editing', 'rejected', 'approved'].includes(p.status) && (p.status === 'approved' || !reviewRequired || p.is_template)
  const canSubmit = editable(p.status) && !p.is_template

  return (
    <>
      <div className="bar">
        <span className="tools"><button onClick={close}>← Danh sách</button>
          <LStatusPill s={p.status} />{p.version_no > 0 && <small>Phiên bản {p.version_no}</small>}
          {dirty && <small>Chưa lưu</small>}</span>
        <span className="tools">
          {PLAN_MODE && <button onClick={() => setPreview(!preview)}>{preview ? 'Quay lại soạn' : 'Xem trước giáo án'}</button>}
          {blocksOf(p) > 0 && <button onClick={() => setOverlay({ plan: p, kind: 'player' })}><Icon n="eye" /> Xem như học sinh</button>}
          <button onClick={() => (blocksOf(p) > 0 ? setOverlay({ plan: p, kind: 'show' }) : onPresent(p))} disabled={!p.slides.length && !blocksOf(p)}>Trình chiếu</button>
          {go && <button onClick={teachTrial} title="Mở lớp học Giáo dục STEM với bài giảng này">Dạy thử</button>}
          {!ro && <button onClick={() => save()} disabled={busy || !dirty}>Lưu nháp</button>}
          {canSubmit && reviewRequired && <button className="primary" onClick={submit} disabled={busy}>Gửi duyệt</button>}
          {canPublish && !hid('publish') && <button className={reviewRequired && p.status !== 'approved' ? '' : 'primary'} onClick={publish} disabled={busy}>{p.draft_of ? 'Xuất bản thay bản cũ' : 'Xuất bản'}</button>}
          {canSubmit && !reviewRequired && <button onClick={submit} disabled={busy}>Gửi duyệt</button>}
        </span>
      </div>
      <PlanOverlay o={overlay} onClose={() => setOverlay(null)} />
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      {p.draft_of && <div className="panel bar" style={{ borderLeft: '4px solid var(--primary)', alignItems: 'center' }}>
        <span><Icon n="pencil" /> Đây là <b>bản nháp để sửa</b>{link ? <> của “{link.title}”</> : null}. Học sinh và đồng nghiệp vẫn dùng bản đã xuất bản cho tới khi bạn bấm “Xuất bản thay bản cũ”.</span>
        <span className="tools">{link && <button onClick={() => onOpen(link.id)} disabled={busy}>Xem bản đang dùng</button>}
          <button className="danger" onClick={dropDraft} disabled={busy}>Bỏ bản nháp</button></span>
      </div>}
      {ro && <ReadOnlyBanner p={p} busy={busy} draftId={link && !p.draft_of ? link.id : null}
        onWithdraw={() => run('lesson_plan_withdraw', { p_plan: p.id }, 'Đã rút lại — bài giảng trở về bản nháp.')}
        onDraft={makeDraft} onOpenDraft={() => link && onOpen(link.id)}
        onNewVersion={() => {
          if (p.status === 'published' && !confirm('Gỡ xuất bản để sửa thẳng? Đồng nghiệp không còn thấy bài trong kho, lớp đang dùng sẽ thấy nội dung đang sửa. Muốn giữ bản đang dùng, chọn "Tạo bản nháp để sửa".')) return
          run('lesson_plan_new_version', { p_plan: p.id }, p.status === 'published' ? 'Đã gỡ xuất bản — bài trở về đang soạn. Bản cũ vẫn lưu trong lịch sử.' : 'Đã tạo phiên bản mới để soạn. Bản cũ vẫn lưu trong lịch sử.')
        }} />}
      {p.status === 'rejected' && <div className="panel" style={{ borderLeft: '4px solid var(--bad, #dc2626)' }}>
        <b>Bài giảng bị trả lại.</b> {p.review_note ? <>Góp ý: <i>{p.review_note}</i></> : 'Sửa theo góp ý rồi gửi duyệt lại.'}</div>}

      {PLAN_MODE && preview ? (
        <>
          <div className="tools" style={{ margin: '8px 0' }}><button className="primary" onClick={() => printPlan(p.title)}>In / lưu PDF</button></div>
          <div className="panel"><PlanDocument plan={p} tpl={tpl} acts={att.acts} libs={att.libs} rubs={att.rubs} norm={norm} items={items}
            teacher={p.teachers?.full_name} schoolName={school} /></div>
        </>
      ) : <>
        <Tabs<ETab> value={tab} onChange={setTab} items={PLAN_MODE ? [
          ['info', 'Thông tin'], ['doc', 'Giáo án'], ['steps', 'Tiến trình dạy học', p.steps.length], ['lesson', 'Bài giảng tương tác', blocksOf(p)], ['slides', 'Slide trình chiếu', p.slides.length],
          ['res', 'Học liệu & đánh giá', p.library_ids.length + p.rubric_ids.length], ['mat', 'Vật tư'], ['ver', 'Phiên bản & duyệt', versions.length],
        ] : [
          ['info', 'Thông tin'], ['lesson', 'Bài giảng tương tác', blocksOf(p)], ['slides', 'Slide trình chiếu', p.slides.length], ['ver', 'Phiên bản & duyệt', versions.length],
        ]} />
        {tab === 'info' && <InfoTab p={p} upd={upd} ro={ro} templates={templates} programs={programs} units={units} />}
        {tab === 'lesson' && <LessonTab p={p} upd={upd} ro={ro} />}
        {PLAN_MODE && tab === 'doc' && <DocTab p={p} upd={upd} ro={ro} tpl={tpl} />}
        {PLAN_MODE && tab === 'steps' && <StepsTab p={p} upd={upd} ro={ro} tpl={tpl} att={att} teacherId={teacherId} go={go} />}
        {tab === 'slides' && <>
          {!ro && <p className="sub">Slide dùng để trình chiếu trên lớp (Giáo dục STEM) và cho học sinh xem theo thời gian thực.</p>}
          <SlideStudio slides={p.slides} onChange={s => upd({ slides: s })} readOnly={ro} />
        </>}
        {PLAN_MODE && tab === 'res' && <ResTab p={p} upd={upd} ro={ro} att={att} />}
        {PLAN_MODE && tab === 'mat' && <MatTab p={p} upd={upd} ro={ro} norms={att.norms} norm={norm} items={items} classes={classes} dirty={dirty} say={say} onSaved={() => save(true)} />}
        {tab === 'ver' && <VerTab p={p} versions={versions} reviews={reviews} classes={classes} reviewRequired={reviewRequired} busy={busy}
          onRestore={v => { if (confirm(`Khôi phục nội dung phiên bản ${v} vào bản đang soạn? Nội dung hiện tại sẽ bị thay thế.`)) run('lesson_plan_restore', { p_plan: p.id, p_version: v }, `Đã khôi phục nội dung phiên bản ${v}.`) }}
          onNewVersion={() => run('lesson_plan_new_version', { p_plan: p.id }, 'Đã tạo phiên bản mới để soạn.')}
          onWithdraw={() => run('lesson_plan_withdraw', { p_plan: p.id }, 'Đã rút lại.')}
          onSubmit={submit} onPublish={publish} canSubmit={canSubmit} canPublish={canPublish}
          onReviewed={load} say={say} />}
      </>}
    </>
  )
}

function ReadOnlyBanner({ p, busy, draftId, onWithdraw, onNewVersion, onDraft, onOpenDraft }: {
  p: LPlan; busy: boolean; draftId: string | null; onWithdraw: () => void; onNewVersion: () => void; onDraft: () => void; onOpenDraft: () => void
}) {
  const text = p.status === 'pending' ? 'Bài giảng đang chờ duyệt nên không sửa được. Rút lại nếu cần sửa tiếp.'
    : p.status === 'approved' ? 'Bài giảng đã được duyệt. Bấm “Xuất bản” để phát hành, hoặc tạo phiên bản mới nếu cần sửa.'
    : p.status === 'published' ? (draftId ? `Đã xuất bản (phiên bản ${p.version_no}, ${fmtD(p.published_at)}) và đang có một bản nháp sửa. Học sinh vẫn xem bản này.`
      : `Đã xuất bản (phiên bản ${p.version_no}, ${fmtD(p.published_at)}) nên đang ở chế độ xem. Muốn sửa, tạo bản nháp — học sinh vẫn xem bản này cho tới khi bạn xuất bản thay.`)
    : 'Bài giảng đang lưu trữ. Tạo phiên bản mới để soạn tiếp.'
  return (
    <div className="panel bar" style={{ borderLeft: '4px solid var(--warn, #d97706)', alignItems: 'center' }}>
      <span><Icon n="lock" /> {text}</span>
      <span className="tools">
        {p.status === 'pending' && <button onClick={onWithdraw} disabled={busy}>Rút lại</button>}
        {p.status === 'published' && (draftId ? <button className="primary" onClick={onOpenDraft} disabled={busy}>Mở bản nháp</button>
          : <button className="primary" onClick={onDraft} disabled={busy}>Tạo bản nháp để sửa</button>)}
        {p.status === 'published' && !draftId && <button onClick={onNewVersion} disabled={busy}>Gỡ xuất bản</button>}
        {['approved', 'archived'].includes(p.status) && <button onClick={onNewVersion} disabled={busy}>Tạo phiên bản mới</button>}
      </span>
    </div>
  )
}

type TabP = { p: LPlan; upd: (x: Partial<LPlan>) => void; ro: boolean }

function InfoTab({ p, upd, ro, templates, programs, units }: TabP & { templates: Template[]; programs: ReturnType<typeof useProgramOptions>['programs']; units: ReturnType<typeof useProgramOptions>['units'] }) {
  const { codes: PROGRAMS } = useStemTracks()
  const tree = unitTree(units, p.program_id, 'lesson', p.unit_id)
  function pickTemplate(tid: string) {
    const t = templates.find(x => x.id === tid)
    const doc = { ...p.doc }; (t?.sections ?? []).forEach(s => { if (!(s.key in doc)) doc[s.key] = '' })
    upd({ template_id: tid || null, doc })
  }
  return (
    <fieldset disabled={ro} className="panel formgrid" style={{ border: 0 }}>
      <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên bài *</span><input value={p.title} onChange={e => upd({ title: e.target.value })} maxLength={200} /></label>
      <label className="field"><span>Môn</span><SubjectPicker value={p.subject} onChange={v => upd({ subject: v })} emptyLabel="— Không chọn —" /></label>
      <div className="field" style={{ gridColumn: 'span 2' }}><span>Khối</span><GradeChecks value={gradeList(p.grades ?? '')} onChange={g => upd({ grades: g.join(',') })} /></div>
      {PLAN_MODE && <label className="field"><span>Số tiết</span><input type="number" min={1} max={20} value={p.periods ?? ''} onChange={e => upd({ periods: e.target.value ? Number(e.target.value) : null })} /></label>}
      <label className="field"><span>Nhóm chương trình</span>
        <select value={p.program ?? ''} onChange={e => upd({ program: e.target.value || null })}><option value="">—</option>{PROGRAMS.map(c => <option key={c}>{c}</option>)}</select></label>
      {PLAN_MODE && <label className="field"><span>Mẫu giáo án</span>
        <select value={p.template_id ?? ''} onChange={e => pickTemplate(e.target.value)} aria-label="Mẫu giáo án">
          <option value="">Trang trắng (không theo mẫu)</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
      <label className="field"><span>Chương trình giáo dục</span>
        <select value={p.program_id ?? ''} onChange={e => upd({ program_id: e.target.value || null, unit_id: null })} aria-label="Chương trình giáo dục">
          <option value="">— không gắn —</option>{programs.map(x => <option key={x.id} value={x.id}>{progLabel(x)}{x.status === 'draft' ? ' · nháp' : ''}</option>)}</select></label>
      <label className="field"><span>Bài trong chương trình</span>
        <select value={p.unit_id ?? ''} onChange={e => upd({ unit_id: e.target.value || null })} disabled={ro || !p.program_id} aria-label="Bài trong chương trình">
          <option value="">— chọn bài —</option>{tree.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select></label>
      <label className="field"><span>Nội dung Gói STEM</span>
        <span><input type="checkbox" checked={p.from_package} onChange={e => upd({ from_package: e.target.checked })} /> Thuộc gói STEM của trường</span></label>
      <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tóm tắt</span><textarea rows={2} value={p.summary ?? ''} onChange={e => upd({ summary: e.target.value })} /></label>
    </fieldset>
  )
}

// ===== Bài giảng tương tác theo khối (063) =====
function LessonTab({ p, upd, ro }: TabP) {
  const { codes } = useStemTracks()
  const l = asLesson(p.lesson)
  const [meta, setMeta] = useState(false)
  const setL = (x: ILesson) => upd({ lesson: x })
  if (!l) return (
    <div className="panel">
      <b>Chưa có bài giảng tương tác.</b>
      <p className="sub">Soạn bài giảng theo tiến trình {p.program ?? 'CT1–CT5'}: mỗi giai đoạn gồm các khối nội dung — đoạn văn, hình, video, mô phỏng 2D, giáo cụ ảo, kéo – thả, câu hỏi, game, rubric. Học sinh học trên máy, thầy cô trình chiếu từng khối.</p>
      {!ro && <div className="tools">{codes.map(c => <button key={c} className={c === (p.program ?? 'CT1') ? 'primary' : ''} onClick={() => upd({ lesson: emptyLesson(c), program: p.program ?? c })}>Tiến trình {c}</button>)}</div>}
    </div>
  )
  return (
    <>
      <div className="panel" style={{ marginBottom: 10 }}>
        <div className="bar"><span><b>Thông tin bài giảng</b> <small className="sub">ảnh bìa, mục tiêu, thẻ — hiện ở Kho bài giảng</small></span><button type="button" onClick={() => setMeta(!meta)}>{meta ? 'Thu gọn' : 'Mở'}</button></div>
        {meta && <fieldset disabled={ro} className="formgrid" style={{ border: 0, padding: 0, margin: '8px 0 0' }}>
          <div className="field" style={{ gridColumn: '1 / -1' }}><span>Ảnh bìa tự tạo</span><CoverPicker value={l.cover} program={p.program} disabled={ro} onChange={c => setL({ ...l, cover: c })} />
            <small>Màu mặc định theo nhóm chương trình. Có ảnh từ đường dẫn thì ảnh đó được dùng.</small></div>
          <label className="field"><span>Hoặc ảnh từ đường dẫn (https://…)</span><input value={p.cover_url ?? ''} onChange={e => upd({ cover_url: e.target.value })} /></label>
          <label className="field"><span>Thẻ (cách nhau dấu phẩy)</span><input value={(l.tags ?? []).join(', ')} onChange={e => setL({ ...l, tags: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} placeholder="Có giáo cụ ảo, Có kéo-thả" /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Mục tiêu bài học (mỗi dòng một mục tiêu)</span>
            <textarea rows={3} value={(l.goals ?? []).join('\n')} onChange={e => setL({ ...l, goals: e.target.value.split('\n') })} /></label>
        </fieldset>}
      </div>
      <LessonEditor value={l} ct={p.program} onChange={setL} readOnly={ro} />
    </>
  )
}

function DocTab({ p, upd, ro, tpl }: TabP & { tpl?: Template }) {
  const [extra, setExtra] = useState('')
  const sections = [...(tpl?.sections ?? []), ...Object.keys(p.doc).filter(k => !(tpl?.sections ?? []).some(s => s.key === k)).map(k => ({ key: k, title: k, hint: '', required: false }))]
  return (
    <div className="panel formgrid">
      {!tpl && <p className="sub" style={{ gridColumn: '1 / -1', margin: 0 }}>Giáo án không theo mẫu: tự thêm các mục cần soạn, hoặc chọn mẫu ở tab Thông tin.</p>}
      {sections.map(s => (
        <label className="field" key={s.key} style={{ gridColumn: '1 / -1' }}>
          <span>{s.title}{s.required && ' *'}{!ro && !tpl?.sections.some(x => x.key === s.key) &&
            <button type="button" className="linkbtn" onClick={() => { const d = { ...p.doc }; delete d[s.key]; upd({ doc: d }) }}> · bỏ mục</button>}</span>
          <textarea rows={4} readOnly={ro} value={p.doc[s.key] ?? ''} placeholder={s.hint || ''} onChange={e => upd({ doc: { ...p.doc, [s.key]: e.target.value } })} />
        </label>
      ))}
      {!ro && <div className="addrow" style={{ gridColumn: '1 / -1', display: 'flex', gap: 6 }}>
        <input value={extra} onChange={e => setExtra(e.target.value)} placeholder="Tên mục thêm (VD: Dặn dò, Rút kinh nghiệm)" aria-label="Tên mục thêm" />
        <button type="button" onClick={() => { const k = extra.trim(); if (k && !(k in p.doc)) upd({ doc: { ...p.doc, [k]: '' } }); setExtra('') }}>+ Thêm mục</button>
      </div>}
    </div>
  )
}

function Chips({ ids, label, onRemove }: { ids: string[]; label: (id: string) => string; onRemove?: (id: string) => void }) {
  return <>{ids.map(id => <span className="chip" key={id}>{label(id)}{onRemove && <button type="button" className="x" onClick={() => onRemove(id)} aria-label={`Bỏ ${label(id)}`}>×</button>}</span>)}</>
}

function StepsTab({ p, upd, ro, tpl, att, teacherId, go }: TabP & { tpl?: Template; att: ReturnType<typeof useAttachables>; teacherId: string; go?: (page: string) => void }) {
  const phases = phasesOf(tpl, p.steps)
  const total = totalMinutes(p.steps), budget = (p.periods ?? 0) * 45
  const setStep = (sid: string, patch: Partial<Step>) => upd({ steps: p.steps.map(s => s.id === sid ? { ...s, ...patch } : s) })
  const addStep = (phase: string) => {
    const idx = p.steps.map(s => s.phase ?? '').lastIndexOf(phase)
    const s: Step = { id: uid(), phase: phase || undefined, title: '', minutes: 10, library_ids: [] }
    const steps = idx < 0 ? [...p.steps, s] : [...p.steps.slice(0, idx + 1), s, ...p.steps.slice(idx + 1)]
    upd({ steps })
  }
  const move = (sid: string, d: -1 | 1) => {
    const i = p.steps.findIndex(s => s.id === sid), ph = p.steps[i].phase ?? ''
    let j = i + d; while (j >= 0 && j < p.steps.length && (p.steps[j].phase ?? '') !== ph) j += d
    if (j < 0 || j >= p.steps.length) return
    const n = [...p.steps];[n[i], n[j]] = [n[j], n[i]]; upd({ steps: n })
  }
  const myActs = att.acts.filter(a => a.teacher_id === teacherId && !a.is_template), otherActs = att.acts.filter(a => !(a.teacher_id === teacherId && !a.is_template))
  return (
    <>
      <div className="bar">
        <span>Tổng thời lượng: <b>{total} phút</b>{budget > 0 && <> / {p.periods} tiết × 45 = {budget} phút <span className={'gpill ' + (total > budget ? 'bad' : total < budget * 0.8 ? 'warn' : 'good')}>
          {total > budget ? `vượt ${total - budget} phút` : total < budget * 0.8 ? `còn ${budget - total} phút` : 'vừa đủ'}</span></>}</span>
        {go && <span className="tools"><button onClick={() => go('Kho hoạt động & Bài giảng')} title="Tạo trắc nghiệm, phiếu, thảo luận… rồi quay lại gắn vào bước">Kho hoạt động tương tác</button></span>}
      </div>
      {phases.map(ph => {
        const st = p.steps.filter(s => (s.phase ?? '') === ph.key)
        if (!st.length && ro) return null
        if (!st.length && ph.key === '' && tpl?.phases.length) return !ro ? <p key="_" className="sub"><button className="linkbtn" onClick={() => addStep('')}>+ Thêm bước ngoài các pha của mẫu</button></p> : null
        return (
          <section key={ph.key || '_'} style={{ marginBottom: 16 }}>
            <h3 style={{ marginBottom: 4 }}>{ph.title} <small className="sub">· {totalMinutes(st)} phút</small></h3>
            {ph.hint && <p className="sub" style={{ marginTop: 0 }}>{ph.hint}</p>}
            {st.map(s => { const k = p.steps.indexOf(s); return (
              <fieldset key={s.id} disabled={ro} className="panel formgrid stepcard">
                <label className="field" style={{ gridColumn: 'span 2' }}><span>Bước {k + 1} · tên hoạt động *</span>
                  <input value={s.title} onChange={e => setStep(s.id, { title: e.target.value })} placeholder="VD: Quan sát mô hình, đặt câu hỏi" /></label>
                <label className="field"><span>Thời gian (phút)</span><input type="number" min={0} max={300} value={s.minutes ?? ''} onChange={e => setStep(s.id, { minutes: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                <span className="tools" style={{ alignSelf: 'end' }}>
                  <button type="button" onClick={() => move(s.id, -1)} aria-label="Đưa bước lên">↑</button>
                  <button type="button" onClick={() => move(s.id, 1)} aria-label="Đưa bước xuống">↓</button>
                  <button type="button" className="danger" onClick={() => upd({ steps: p.steps.filter(x => x.id !== s.id) })}>Xoá</button></span>
                <label className="field" style={{ gridColumn: '1 / -1' }}><span>Mục tiêu</span><input value={s.goal ?? ''} onChange={e => setStep(s.id, { goal: e.target.value })} /></label>
                <label className="field" style={{ gridColumn: 'span 2' }}><span>Hoạt động của giáo viên</span><textarea rows={3} value={s.teacher ?? ''} onChange={e => setStep(s.id, { teacher: e.target.value })} /></label>
                <label className="field" style={{ gridColumn: 'span 2' }}><span>Hoạt động của học sinh</span><textarea rows={3} value={s.student ?? ''} onChange={e => setStep(s.id, { student: e.target.value })} /></label>
                <label className="field" style={{ gridColumn: 'span 2' }}><span>Sản phẩm dự kiến</span><input value={s.product ?? ''} onChange={e => setStep(s.id, { product: e.target.value })} /></label>
                <label className="field"><span>Hoạt động tương tác</span>
                  <select value={s.activity_id ?? ''} onChange={e => setStep(s.id, { activity_id: e.target.value || null })} aria-label={`Hoạt động tương tác bước ${k + 1}`}>
                    <option value="">— không —</option>
                    {myActs.length > 0 && <optgroup label="Của tôi">{myActs.map(a => <option key={a.id} value={a.id}>{actLabel(a)}</option>)}</optgroup>}
                    {otherActs.length > 0 && <optgroup label="Mẫu / đồng nghiệp">{otherActs.map(a => <option key={a.id} value={a.id}>{actLabel(a)}</option>)}</optgroup>}
                  </select></label>
                <label className="field"><span>Rubric đánh giá</span>
                  <select value={s.rubric_id ?? ''} onChange={e => setStep(s.id, { rubric_id: e.target.value || null })} aria-label={`Rubric bước ${k + 1}`}>
                    <option value="">— không —</option>{att.rubs.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
                <div className="field" style={{ gridColumn: '1 / -1' }}><span>Học liệu / phiếu học tập</span>
                  <div><Chips ids={s.library_ids ?? []} label={lid => libLabel(att.libs.find(l => l.id === lid))} onRemove={ro ? undefined : lid => setStep(s.id, { library_ids: (s.library_ids ?? []).filter(x => x !== lid) })} />
                    {!ro && <select value="" onChange={e => e.target.value && setStep(s.id, { library_ids: [...(s.library_ids ?? []), e.target.value] })} aria-label={`Gắn học liệu bước ${k + 1}`} style={{ maxWidth: 320 }}>
                      <option value="">+ Gắn học liệu…</option>{att.libs.filter(l => !(s.library_ids ?? []).includes(l.id)).map(l => <option key={l.id} value={l.id}>{libLabel(l)}</option>)}</select>}</div></div>
              </fieldset>
            ) })}
            {!ro && <button className="linkbtn" onClick={() => addStep(ph.key)}>+ Thêm bước vào “{ph.title}”</button>}
          </section>
        )
      })}
      {ro && p.steps.length === 0 && <p className="sub">Giáo án chưa có bước hoạt động.</p>}
    </>
  )
}

function ResTab({ p, upd, ro, att }: TabP & { att: ReturnType<typeof useAttachables> }) {
  const stepLibs = new Set(p.steps.flatMap(s => s.library_ids ?? []))
  return (
    <div className="twocol">
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Học liệu, phiếu học tập ({p.library_ids.length})</h3>
        <p className="sub">Học liệu đã phát hành trong kho dùng chung (của trường, Sở, KDI). Học liệu gắn ở từng bước tiến trình: {stepLibs.size}.</p>
        <MultiSelect disabled={ro} value={p.library_ids} onChange={v => upd({ library_ids: v })} placeholder="Chọn học liệu, phiếu học tập…" ariaLabel="Học liệu"
          options={att.libs.map(l => [l.id, libLabel(l) + (l.owner_name ? ' · ' + l.owner_name : '')])} empty="Không có học liệu phù hợp." />
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Rubric đánh giá ({p.rubric_ids.length})</h3>
        <MultiSelect disabled={ro} value={p.rubric_ids} onChange={v => upd({ rubric_ids: v })} placeholder="Chọn rubric…" ariaLabel="Rubric đánh giá"
          options={att.rubs.map(r => [r.id, r.title + (!r.org_id ? ' · dùng chung' : '')])} empty="Chưa có rubric." />
        {att.rubs.length === 0 && <p className="sub">Chưa có rubric. Tạo rubric ở Kho hoạt động & Bài giảng.</p>}
      </div>
    </div>
  )
}

function MatTab({ p, upd, ro, norms, norm, items, classes, dirty, say, onSaved }: TabP & {
  norms: NormLite[]; norm: NormLite | null; items: NormItem[]; classes: { id: string; name: string }[]; dirty: boolean; say: (m: string, bad?: boolean) => void; onSaved: () => Promise<boolean>
}) {
  const [f, setF] = useState({ cls: '', students: '', groups: '', sessions: '' })
  const [est, setEst] = useState<Est[] | null>(null)
  const [reason, setReason] = useState('')
  const adj = useMemo(() => new Map(p.norm_adjust.map(a => [a.item_id, a])), [p.norm_adjust])
  useEffect(() => { setEst(null) }, [p.norm_id])
  function setAdj(item: NormItem, patch: Partial<Adjust>) {
    const cur = adj.get(item.id) ?? { item_id: item.id, qty: item.qty }
    const next = { ...cur, ...patch }
    const rest = p.norm_adjust.filter(a => a.item_id !== item.id)
    upd({ norm_adjust: Number(next.qty) === Number(item.qty) && !next.note ? rest : [...rest, next] })
  }
  const opt = (s: string) => (s.trim() ? Number(s) : null)
  async function estimate(e: React.FormEvent) {
    e.preventDefault(); if (!norm) return
    if (!f.cls && !f.students) return say('Chọn lớp hoặc nhập số học sinh để dự trù.', true)
    const { data, error } = await supabase.rpc('material_norm_estimate', { p_norm: norm.id, p_class: f.cls || null, p_students: opt(f.students), p_groups: opt(f.groups), p_products: null, p_sessions: opt(f.sessions) })
    if (error) return say(errText(error.message), true)
    setEst((data as Est[]) ?? [])
  }
  async function propose() {
    if (dirty && !(await onSaved())) return
    const { error } = await supabase.rpc('lesson_plan_propose_norm', { p_plan: p.id, p_reason: reason })
    if (error) return say(errText(error.message), true)
    setReason(''); say(`Đã gửi đề xuất điều chỉnh định mức “${norm?.title}” tới đơn vị ban hành.`)
  }
  const changed = items.filter(i => adj.has(i.id) && Number(adj.get(i.id)!.qty) !== Number(i.qty))
  return (
    <>
      <div className="panel formgrid">
        <label className="field" style={{ gridColumn: 'span 2' }}><span>Định mức vật tư áp dụng</span>
          <select value={p.norm_id ?? ''} disabled={ro} onChange={e => upd({ norm_id: e.target.value || null, norm_adjust: [] })} aria-label="Định mức vật tư">
            <option value="">— không gắn —</option>{norms.map(n => <option key={n.id} value={n.id}>{n.title} (v{n.version_no}){n.owner_name ? ` · ${n.owner_name}` : ''}</option>)}</select></label>
        {norm && <p className="sub" style={{ alignSelf: 'end', margin: 0 }}>Tính cho {BASIS[norm.basis]}{norm.basis !== 'student' ? `, ${norm.group_size} HS/nhóm` : ''}, {norm.sessions} buổi.</p>}
      </div>
      {norm && <>
        <h3>Số lượng dùng trong giáo án</h3>
        <p className="sub">Sửa cột “Giáo án dùng” nếu bài của bạn cần khác định mức. Phần chênh lệch có thể gửi thành đề xuất điều chỉnh định mức.</p>
        <div className="wrap"><table>
          <thead><tr><th>Vật tư / công cụ</th><th>Đơn vị</th><th>Định mức</th><th>Giáo án dùng</th><th>Ghi chú</th></tr></thead>
          <tbody>{items.map(i => {
            const a = adj.get(i.id)
            return (
              <tr key={i.id}><td>{i.name}{i.reusable && <small className="sub"> · dùng lại</small>}</td><td>{i.unit}</td><td>{i.qty}</td>
                <td><input type="number" min={0} step="any" style={{ width: 90 }} disabled={ro} value={a?.qty ?? i.qty} onChange={e => setAdj(i, { qty: Number(e.target.value) })} aria-label={`Số lượng ${i.name}`} />
                  {a && Number(a.qty) !== Number(i.qty) && <span className="gpill warn">{Number(a.qty) > Number(i.qty) ? '+' : ''}{Math.round((Number(a.qty) - Number(i.qty)) * 100) / 100}</span>}</td>
                <td><input disabled={ro} value={a?.note ?? ''} placeholder={i.note ?? ''} onChange={e => setAdj(i, { note: e.target.value })} aria-label={`Ghi chú ${i.name}`} /></td></tr>
            )
          })}</tbody>
        </table></div>
        {changed.length > 0 && (
          <div className="panel" style={{ marginTop: 8 }}>
            <b>Đề xuất điều chỉnh định mức</b> <small className="sub">({changed.length} vật tư khác định mức)</small>
            <div className="addrow" style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input style={{ flex: 1 }} value={reason} onChange={e => setReason(e.target.value)} placeholder="Lý do (VD: lớp đông, mô hình cần thêm động cơ)" aria-label="Lý do đề xuất" />
              <button onClick={propose}>Gửi đề xuất</button>
            </div>
          </div>
        )}
        <h3>Dự trù cho lớp</h3>
        <form className="panel formgrid" onSubmit={estimate}>
          <label className="field"><span>Lớp</span><select value={f.cls} onChange={e => setF({ ...f, cls: e.target.value })} aria-label="Lớp dự trù">
            <option value="">— nhập số học sinh —</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field"><span>Số học sinh{f.cls ? ' (trống = sĩ số)' : ''}</span><input value={f.students} onChange={e => setF({ ...f, students: e.target.value })} inputMode="numeric" /></label>
          {norm.basis !== 'student' && <label className="field"><span>Số nhóm (trống = tự chia)</span><input value={f.groups} onChange={e => setF({ ...f, groups: e.target.value })} inputMode="numeric" /></label>}
          <label className="field"><span>Số buổi (trống = {norm.sessions})</span><input value={f.sessions} onChange={e => setF({ ...f, sessions: e.target.value })} inputMode="numeric" /></label>
          <div className="formactions"><button className="primary" type="submit">Dự trù</button></div>
        </form>
        {est && (
          <div className="wrap"><table>
            <thead><tr><th>Vật tư</th><th>Đơn vị</th><th>Theo định mức</th><th>Theo giáo án</th><th>Tồn kho</th><th>Thiếu</th></tr></thead>
            <tbody>{est.map(r => {
              const a = adj.get(r.item_id); const need = a ? Number(a.qty) * r.multiplier : Number(r.need)
              const short = Math.max(need - Number(r.stock ?? 0), 0)
              return <tr key={r.item_id}><td>{r.name}</td><td>{r.unit}</td><td>{Number(r.need)}</td><td>{a ? <b>{need}</b> : need}</td>
                <td>{r.stock == null ? '—' : Number(r.stock)}</td><td>{short > 0 ? <span className="gpill bad">{short}</span> : <span className="gpill good">đủ</span>}</td></tr>
            })}</tbody>
          </table></div>
        )}
      </>}
      {!norm && <p className="sub">Gắn định mức vật tư (do KDI, Sở hoặc trường ban hành) để dự trù vật tư cho bài và đề xuất điều chỉnh khi cần.</p>}
    </>
  )
}

function VerTab({ p, versions, reviews, classes, reviewRequired, busy, onRestore, onNewVersion, onWithdraw, onSubmit, onPublish, canSubmit, canPublish, onReviewed, say }: {
  p: LPlan; versions: Version[]; reviews: Review[]; classes: { id: string; name: string }[]; reviewRequired: boolean; busy: boolean
  onRestore: (v: number) => void; onNewVersion: () => void; onWithdraw: () => void; onSubmit: () => void; onPublish: () => void
  canSubmit: boolean; canPublish: boolean; onReviewed: () => void; say: (m: string, bad?: boolean) => void
}) {
  const hid = useHiddenBtn()
  const [f, setF] = useState({ kind: 'trial' as Review['kind'], class_id: '', taught_on: new Date().toISOString().slice(0, 10), rating: '4', note: '' })
  const vsel = useRowSel(versions)
  const rsel = useRowSel(reviews)
  async function addReview(e: React.FormEvent) {
    e.preventDefault()
    if (!f.note.trim()) return say('Nhập nhận xét.', true)
    const { error } = await supabase.from('lesson_plan_reviews').insert({
      plan_id: p.id, kind: f.kind, note: f.note.trim(),
      ...(f.kind === 'trial' ? { class_id: f.class_id || null, taught_on: f.taught_on || null, rating: Number(f.rating) || null } : {}),
    })
    if (error) return say(errText(error.message), true)
    setF({ ...f, note: '' }); say(f.kind === 'trial' ? 'Đã ghi nhận buổi dạy thử.' : 'Đã thêm góp ý.'); onReviewed()
  }
  async function delReview(r: Review) {
    if (!confirm('Xoá ghi nhận này?')) return
    const { error } = await supabase.from('lesson_plan_reviews').delete().eq('id', r.id)
    if (error) return say(errText(error.message), true); onReviewed()
  }
  const flow: [LStatus[], string][] = [[['draft', 'editing', 'rejected'], 'Soạn nháp'], [['pending'], 'Chờ duyệt'], [['approved'], 'Đã duyệt'], [['published'], 'Xuất bản']]
  return (
    <>
      <div className="panel">
        <ol className="steps" style={{ display: 'flex', gap: 18, listStyle: 'none', padding: 0 }}>
          {flow.filter(([, l]) => reviewRequired || (l !== 'Chờ duyệt' && l !== 'Đã duyệt') || p.status === 'pending' || p.status === 'approved').map(([ss, l]) =>
            <li key={l}>{ss.includes(p.status) ? <b>● {l}</b> : <span className="sub">○ {l}</span>}</li>)}
        </ol>
        <p className="sub" style={{ margin: '4px 0 8px' }}>{reviewRequired
          ? 'Trường yêu cầu duyệt: gửi duyệt → tổ trưởng / BGH duyệt → bạn xuất bản. Mỗi lần xuất bản lưu một phiên bản.'
          : 'Trường chưa bật duyệt bài giảng: bạn tự xuất bản (không qua duyệt). Mỗi lần xuất bản lưu một phiên bản.'}</p>
        <span className="tools">
          {canSubmit && <button className={reviewRequired ? 'primary' : ''} onClick={onSubmit} disabled={busy}>Gửi duyệt</button>}
          {p.status === 'pending' && <button onClick={onWithdraw} disabled={busy}>Rút lại</button>}
          {canPublish && !hid('publish') && <button className="primary" onClick={onPublish} disabled={busy}>Xuất bản</button>}
          {['approved', 'archived'].includes(p.status) && <button onClick={onNewVersion} disabled={busy}>Tạo phiên bản mới</button>}
        </span>
        {p.review_note && <p style={{ marginBottom: 0 }}><b>Ý kiến người duyệt:</b> <i>{p.review_note}</i></p>}
      </div>

      <h3>Lịch sử phiên bản ({versions.length})</h3>
      {versions.length === 0 ? <p className="sub">Chưa xuất bản lần nào.</p> : (<>
        {editable(p.status) && <SelBar picked={vsel.cur ? 'v' + vsel.cur.version_no : null}>
          <button disabled={!vsel.cur || busy} onClick={() => vsel.cur && onRestore(vsel.cur.version_no)}>Khôi phục vào bản soạn</button></SelBar>}
        <div className="wrap"><table>
          <thead><tr>{editable(p.status) && <SelTh />}<th>Phiên bản</th><th>Xuất bản</th><th>Ghi chú</th><th>Nội dung</th></tr></thead>
          <tbody>{versions.map(v => (
            <tr key={v.id} className={vsel.is(v) ? 'picked' : undefined}>{editable(p.status) && <SelTd on={vsel.is(v)} onToggle={() => vsel.toggle(v)} label={'v' + v.version_no} />}<td><b>v{v.version_no}</b>{v.version_no === p.version_no && p.status === 'published' && <span className="gpill good">đang dùng</span>}</td>
              <td>{fmtD(v.published_at)}</td><td>{v.note ?? ''}</td>
              <td><small>{v.snapshot.title} · {(v.snapshot.steps ?? []).length} bước · {(v.snapshot.slides ?? []).length} slide</small></td></tr>
          ))}</tbody>
        </table></div>
      </>)}

      <h3>Dạy thử & góp ý ({reviews.length})</h3>
      <form className="panel formgrid" onSubmit={addReview}>
        <label className="field"><span>Loại</span><select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as Review['kind'] })} aria-label="Loại ghi nhận">
          <option value="trial">Dạy thử trên lớp</option><option value="comment">Góp ý</option></select></label>
        {f.kind === 'trial' && <>
          <label className="field"><span>Lớp</span><select value={f.class_id} onChange={e => setF({ ...f, class_id: e.target.value })} aria-label="Lớp dạy thử">
            <option value="">—</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="field"><span>Ngày dạy</span><input type="date" value={f.taught_on} onChange={e => setF({ ...f, taught_on: e.target.value })} /></label>
          <label className="field"><span>Mức hiệu quả</span><select value={f.rating} onChange={e => setF({ ...f, rating: e.target.value })} aria-label="Mức hiệu quả">
            {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</option>)}</select></label>
        </>}
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Nhận xét *</span><textarea rows={2} value={f.note} onChange={e => setF({ ...f, note: e.target.value })}
          placeholder={f.kind === 'trial' ? 'Học sinh hứng thú? Thời gian các bước? Cần điều chỉnh gì?' : 'Góp ý cho bài giảng'} /></label>
        <div className="formactions"><button className="primary" type="submit">Lưu</button></div>
      </form>
      {reviews.length > 0 && (<>
        <SelBar picked={rsel.cur ? fmtD(rsel.cur.taught_on ?? rsel.cur.created_at) : null}>
          <button className="danger" disabled={!rsel.cur} onClick={() => { if (rsel.cur) { delReview(rsel.cur); rsel.clear() } }}>Xoá</button></SelBar>
        <div className="wrap"><table>
          <thead><tr><SelTh /><th>Ngày</th><th>Loại</th><th>Lớp</th><th>Đánh giá</th><th>Nhận xét</th><th>Người ghi</th></tr></thead>
          <tbody>{reviews.map(r => (
            <tr key={r.id} className={rsel.is(r) ? 'picked' : undefined}><SelTd on={rsel.is(r)} onToggle={() => rsel.toggle(r)} label={'ghi nhận ' + fmtD(r.taught_on ?? r.created_at)} /><td>{fmtD(r.taught_on ?? r.created_at)}</td><td>{r.kind === 'trial' ? 'Dạy thử' : 'Góp ý'}</td><td>{r.classes?.name ?? '—'}</td>
              <td>{r.rating ? '★'.repeat(r.rating) : '—'}</td><td>{r.note}</td><td><small>{r.profiles?.full_name ?? ''}</small></td></tr>
          ))}</tbody>
        </table></div>
      </>)}
    </>
  )
}

// ===== Cổng Quản trị nền tảng: thêm bài giảng của KDI, xem chi tiết bài giảng bất kỳ =====
type Desk = { mode: 'new' } | { mode: 'view'; id: string } | { mode: 'edit'; id: string } | { mode: 'present'; plan: LPlan; i: number; back: Desk }
export function LessonDesk({ orgId, start, onClose }: { orgId: string | null; start: { mode: 'new' } | { mode: 'view'; id: string }; onClose: () => void }) {
  const [v, setV] = useState<Desk>(start)
  const templates = useTemplates()
  const [reviewRequired, setReviewRequired] = useState(false)
  useEffect(() => { if (orgId) supabase.rpc('lesson_review_required', { p_org: orgId }).then(({ data }) => setReviewRequired(!!data)) }, [orgId])
  if (v.mode === 'new') return <NewPlan teacherId={null} orgId={orgId} templates={templates} onCancel={onClose} onCreated={id => setV({ mode: 'edit', id })} />
  if (v.mode === 'edit') return <Editor id={v.id} teacherId="" orgId={orgId} templates={templates} reviewRequired={reviewRequired}
    onClose={onClose} onOpen={id => setV({ mode: 'edit', id })} onPresent={p => setV({ mode: 'present', plan: p, i: 0, back: v })} />
  if (v.mode === 'present') return <Presenter plan={v.plan} i={v.i} onMove={i => setV({ ...v, i })} onClose={() => setV(v.back)} />
  return <PlanDetail id={v.id} orgId={orgId} templates={templates} onClose={onClose}
    onEdit={id => setV({ mode: 'edit', id })} onPresent={p => setV({ mode: 'present', plan: p, i: 0, back: v })} />
}

// Xem chi tiết một bài giảng (chỉ đọc): thông tin, giáo án đầy đủ, xem như học sinh, trình chiếu
function PlanDetail({ id, orgId, templates, onClose, onEdit, onPresent }: {
  id: string; orgId: string | null; templates: Template[]; onClose: () => void; onEdit: (id: string) => void; onPresent: (p: LPlan) => void
}) {
  const [p, setP] = useState<LPlan | null>(null)
  const [err, setErr] = useState('')
  const [school, setSchool] = useState<string | null>(null)
  const [items, setItems] = useState<NormItem[]>([])
  const [overlay, setOverlay] = useState<Overlay>(null)
  const att = useAttachables(p?.org_id ?? null)
  useEffect(() => {
    supabase.from('lesson_plans').select(PLAN_COLS).eq('id', id).maybeSingle().then(({ data, error }) => {
      if (error || !data) return setErr(errText(error?.message ?? 'Không tìm thấy bài giảng (có thể bài chưa xuất bản nên không xem được).'))
      const x = normPlan(data as LPlan); setP(x)
      supabase.from('organizations').select('name').eq('id', x.org_id).maybeSingle().then(({ data: o }) => setSchool((o as { name: string } | null)?.name ?? null))
      if (x.norm_id) supabase.from('material_norm_items').select('*').eq('norm_id', x.norm_id).order('seq').order('name').then(({ data: n }) => setItems((n as NormItem[]) ?? []))
    })
  }, [id])
  if (!p) return <><div className="bar"><button onClick={onClose}>← Danh sách</button></div>{err ? <p className="msg">{err}</p> : <p className="sub">Đang tải…</p>}</>
  const tpl = templates.find(t => t.id === p.template_id)
  const norm = att.norms.find(n => n.id === p.norm_id) ?? null
  const st = lessonStats(asLesson(p.lesson))
  return (
    <>
      <div className="bar">
        <span className="tools"><button onClick={onClose}>← Danh sách</button><LStatusPill s={p.status} />{p.version_no > 0 && <small>Phiên bản {p.version_no}</small>}
          {p.is_template && <span className="pill">Mẫu</span>}</span>
        <span className="tools">
          {st.blocks > 0 && <button onClick={() => setOverlay({ plan: p, kind: 'player' })}><Icon n="eye" /> Xem như học sinh</button>}
          <button onClick={() => (st.blocks > 0 ? setOverlay({ plan: p, kind: 'show' }) : onPresent(p))} disabled={!p.slides.length && !st.blocks}>Trình chiếu</button>
          {PLAN_MODE && <button onClick={() => printPlan(p.title)}>In / lưu PDF</button>}
          {orgId && p.org_id === orgId && <button className="primary" onClick={() => onEdit(p.id)}>Soạn</button>}
        </span>
      </div>
      <PlanOverlay o={overlay} onClose={() => setOverlay(null)} />
      <div className="cards syscards">
        <div className="card"><strong style={{ fontSize: 16 }}>{school ?? '—'}</strong><span>Đơn vị</span></div>
        <div className="card"><strong style={{ fontSize: 16 }}>{p.teachers?.full_name ?? (p.is_template ? 'Bài mẫu' : '—')}</strong><span>Giáo viên</span></div>
        <div className="card"><strong>{PLAN_MODE ? st.blocks || p.steps.length : st.blocks}</strong><span>{st.blocks || !PLAN_MODE ? `khối · ${st.interactive} tương tác` : 'bước hoạt động'}</span></div>
        <div className="card"><strong>{p.slides.length}</strong><span>Slide</span></div>
      </div>
      <div className="panel">{PLAN_MODE ? <PlanDocument plan={p} tpl={tpl} acts={att.acts} libs={att.libs} rubs={att.rubs} norm={norm} items={items}
        teacher={p.teachers?.full_name} schoolName={school} /> : <LectureView plan={p} teacher={p.teachers?.full_name} school={school} />}</div>
    </>
  )
}

// Nội dung một bài giảng để xem (chế độ chỉ bài giảng): thông tin, mục tiêu, tiến trình các khối, danh sách slide
export function LectureView({ plan, teacher, school }: { plan: LPlan; teacher?: string | null; school?: string | null }) {
  const l = asLesson(plan.lesson)
  const blocks = lessonStats(l).blocks
  return (
    <article className="plandoc">
      <header>
        {school && <small>{school}</small>}
        <h1>{plan.title}</h1>
        <p>{[plan.subject && `Môn ${plan.subject}`, plan.grades && `Khối ${plan.grades}`, plan.program, teacher && `Giáo viên: ${teacher}`,
          plan.version_no > 0 && `Phiên bản ${plan.version_no}`].filter(Boolean).join(' · ')}</p>
        {plan.summary && <p><i>{plan.summary}</i></p>}
      </header>
      {(l?.goals ?? []).length > 0 && <section><h2>Mục tiêu bài học</h2><ul>{l!.goals!.map((g, i) => <li key={i}>{g}</li>)}</ul></section>}
      {l && blocks > 0 && <section><h2>Bài giảng tương tác</h2><LessonOutline lesson={l} ct={plan.program} /></section>}
      {plan.slides.length > 0 && <section><h2>Slide trình chiếu ({plan.slides.length})</h2>
        <ol>{plan.slides.map((x, i) => <li key={x.id ?? i}>{x.title || `Slide ${i + 1}`}</li>)}</ol></section>}
      {!blocks && !plan.slides.length && <p className="sub">Bài chưa có nội dung.</p>}
    </article>
  )
}
