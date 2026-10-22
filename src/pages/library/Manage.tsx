import { useStemTracks } from '../../lib/stemTracks'
import { ViewToggle, useViewMode } from '../../components/ViewToggle'
import { Icon } from '../../components/Icon'
import { lazy, Suspense } from 'react'
import { norm as normText } from '../../lib/sheet'
import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import type { Slide } from '../teacher/Lessons'
import { uploadLearningFile, fmtSize, MAX_FILE_MB } from '../../lib/files'
import {
  KindChip, ProgChip, StatusChip, ItemDrawer, SlidesEditor, SCOPE, MAT_TYPE, KIND, NEW_KINDS, RIGHTS, RightsChip, ProgLine,
  fmtDate, uid, selectItems, useProgramOptions, useNormOptions, unitTree, progLabel, type Item, type Unit, type Rights,
} from './common'
import { GradeChecks, SubjectPicker, gradeList } from '../../components/Pickers'
import { EMPTY_PLAN, PlanEditor, planFilled, planOf, type PlanContent } from './PlanEditor'
import { Drawer } from '../../components/Drawer'
import { EMPTY_NORM, loadUnitNorm, saveUnitNorm, UnitNormEditor, type UnitNorm } from './UnitNorm'
import { LessonEditor, asLesson, lessonStats, type ILesson } from '../../lib/lessonBlocks'

type Org = { id: string; name: string; type: string; parent_id: string | null }
type Stat = { item_id: string; schools: number; copies: number; outdated: number }
type LP = { id: string; title: string; subject: string | null; grades: string | null; program: string | null; summary: string | null; slides: Slide[]; lesson: any; teachers: { full_name: string } | null; org_id: string }
type Form = {
  id?: string; kind: Item['kind']; title: string; summary: string; subject: string; grades: string; program: string; tags: string
  scope: Item['scope']; targets: string[]; slides: Slide[]; mtype: string; url: string; units: Unit[]
  src: 'url' | 'file'; file: { path: string; file_name: string; size: number; mime: string } | null
  program_id: string; unit_id: string; usage_rights: Rights; usage_note: string
  // Bài giảng: tương tác (các khối nội dung theo tiến trình) hoặc slide (slide, tệp, đường dẫn)
  lmode: LMode; ilesson: ILesson | null
  // Bài học: mục tiêu, số tiết, giáo án / bài giảng / định mức vật tư / học liệu khác đã có trong kho
  plan: PlanContent
  objectives: string; periods: string; plan_ids: string[]; lesson_ids: string[]; norm_ids: string[]; material_ids: string[]
}
type Pick = { id: string; label: string }
type LMode = 'interactive' | 'slides'
const blockCount = (l: ILesson | null) => lessonStats(l).blocks
// Chọn loại bài giảng khi tạo
function LessonModePicker({ value, onChange, locked }: { value: LMode; onChange: (m: LMode) => void; locked?: boolean }) {
  const opts: [LMode, string, string][] = [
    ['interactive', 'Bài giảng tương tác', 'Các khối nội dung theo tiến trình CT1–CT5: văn bản, hình, video, mô phỏng, giáo cụ ảo, câu hỏi, game. Học sinh học trên máy.'],
    ['slides', 'Slide bài giảng', 'Slide trình chiếu soạn tại đây, hoặc tải tệp PowerPoint / PDF, hoặc dán đường dẫn Canva, Google Slides.'],
  ]
  return <div className="lmodes" role="radiogroup" aria-label="Loại bài giảng">
    {opts.map(([k, t, d]) => <label key={k} className={'panel lmode' + (value === k ? ' on' : '')}>
      <input type="radio" name="lmode" checked={value === k} disabled={locked && value !== k} onChange={() => onChange(k)} />
      <b>{t}</b><small className="sub">{d}</small></label>)}
  </div>
}
// Soạn bài giảng tương tác (dùng chung trình soạn của giáo viên)
// Nguồn sao chép: bài giảng tương tác trong kho học liệu và bài giảng tương tác đã xuất bản / mẫu của giáo viên
type SrcMeta = { title: string; summary: string | null; subject: string | null; grades: string | null; program: string | null
  tags?: string[]; program_id?: string | null; unit_id?: string | null }
type Src = { id: string; label: string; lesson: ILesson; meta: SrcMeta }
function InteractiveLesson({ value, ct, onChange, onCopy, sources, skip }: {
  value: ILesson | null; ct: string; onChange: (l: ILesson) => void; onCopy: (l: ILesson, meta: SrcMeta) => void; sources: Src[]; skip?: string
}) {
  const pool = sources.filter(x => x.id !== skip)
  function copy(id: string) {
    const src = pool.find(x => x.id === id); if (!src) return
    if (blockCount(value) > 0 && !confirm(`Thay nội dung đang soạn bằng “${src.label}”?`)) return
    onCopy(JSON.parse(JSON.stringify(src.lesson)) as ILesson, src.meta)
  }
  return <>
    <div className="bar small"><b>Bài giảng tương tác</b>
      <select value="" onChange={e => copy(e.target.value)} aria-label="Sao chép từ bài giảng tương tác có sẵn" disabled={!pool.length}>
        <option value="">{pool.length ? 'Sao chép từ bài giảng có sẵn…' : 'Chưa có bài giảng tương tác nào để sao chép'}</option>
        {pool.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select></div>
    <LessonEditor value={value} ct={ct || 'CT1'} onChange={onChange} />
  </>
}
// Chọn nhiều mục: các mục đã chọn hiện thành thẻ, thêm bằng ô chọn
function ChipPicker({ label, hint, options, value, onChange, missing, extra, lead }: {
  label: string; hint?: string; options: Pick[]; value: string[]; onChange: (v: string[]) => void; missing: string; extra?: React.ReactNode; lead?: React.ReactNode
}) {
  const left = options.filter(o => !value.includes(o.id))
  return (
    <div className="libpart" title={hint}>
      <span className="libpartlabel">{label}</span>
      <div className="libpartbody">
        {lead}
        {value.map(id => <span className="chip" key={id}>{options.find(o => o.id === id)?.label ?? missing}
          <button type="button" className="x" aria-label="Bỏ" onClick={() => onChange(value.filter(x => x !== id))}>×</button></span>)}
        <select value="" onChange={e => e.target.value && onChange([...value, e.target.value])} aria-label={label} disabled={!left.length}>
          <option value="">{left.length ? `+ Chọn ${label.toLowerCase()} có sẵn…` : `Không còn ${label.toLowerCase()} có sẵn`}</option>
          {left.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        {extra}
      </div>
    </div>
  )
}
const EMPTY = (kind: Item['kind']): Form => ({
  kind, title: '', summary: '', subject: '', grades: '', program: '', tags: '', scope: 'children', targets: [],
  slides: kind === 'lesson' ? [{ id: uid(), kind: 'title', title: '', body: '' }] : [], mtype: 'worksheet', url: '', units: kind === 'program' ? [{ title: 'Học phần 1', periods: 2, objectives: '', lesson_ids: [] }] : [],
  src: 'file', file: null, program_id: '', unit_id: '', usage_rights: 'adapt', usage_note: '',
  plan: EMPTY_PLAN, objectives: '', periods: '', plan_ids: [], lesson_ids: [], norm_ids: [], material_ids: [],
  lmode: 'interactive', ilesson: null,
})
const MaterialNorms = lazy(() => import('../materialNorms').then(m => ({ default: m.MaterialNorms })))
type T = Item['kind'] | 'plan' | 'norm'
const isPlan = (i: Item) => i.kind === 'material' && i.content.type === 'lesson_plan'
const NOEV = { preventDefault() {} } as React.FormEvent
const MAT_OPTS = Object.entries(MAT_TYPE).filter(([k]) => k !== 'lesson_plan')

// Phát hành học liệu: Sở/Phòng/Tỉnh/Bộ, đơn vị cung cấp (KDI Education) hoặc trường soạn và phát hành tới đơn vị trực thuộc
export function LibraryManage({ orgId }: { orgId: string | null }) {
  const { codes: PROGRAMS } = useStemTracks()
  const [items, setItems] = useState<Item[]>([])
  const [visible, setVisible] = useState<Item[]>([])
  const [stats, setStats] = useState<Map<string, Stat>>(new Map())
  const [targets, setTargets] = useState<Map<string, string[]>>(new Map())
  const [orgs, setOrgs] = useState<Org[]>([])
  const [me, setMe] = useState<Org | null>(null)
  const [lessons, setLessons] = useState<LP[]>([])
  const [form, setForm] = useState<Form | null>(null)
  const [tab, setTab] = useState<T>('unit')
  const [fStatus, setFStatus] = useState('')
  const [fSubject, setFSubject] = useState('')
  const [fGrade, setFGrade] = useState('')
  const [fType, setFType] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [view, setView] = useViewMode('hoc-lieu', 'list')
  const [msg, setMsg] = useState(''); const [info, setInfo] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const { programs, units } = useProgramOptions(orgId)
  const norms = useNormOptions(orgId)
  const [norm, setNorm] = useState<UnitNorm>(EMPTY_NORM)
  // Giáo án / bài giảng soạn ngay trong bài học (lưu thành mục kho riêng, gắn vào bài, phát hành cùng bài)
  const [normOpen, setNormOpen] = useState(false)
  // Giáo án / bài giảng / học liệu soạn ngay trong bài học
  const [sub, setSub] = useState<null | { kind: 'plan' | 'lesson' | 'material'; mtype: string; title: string; slides: Slide[]; src: 'file' | 'url'; url: string; plan: PlanContent
    lmode?: LMode; ilesson?: ILesson | null
    file: { path: string; file_name: string; size: number; mime: string } | null }>(null)
  const [subBusy, setSubBusy] = useState(false)

  async function load() {
    if (!orgId) return
    const [i, s, t, o, l] = await Promise.all([
      selectItems('updated_at'),
      supabase.rpc('library_stats'),
      supabase.from('library_targets').select('item_id, org_id'),
      supabase.from('organizations').select('id, name, type, parent_id').order('name'),
      supabase.from('lesson_plans').select('id, title, subject, grades, program, summary, slides, lesson, org_id, teachers(full_name)').or('status.eq.published,is_template.eq.true').order('updated_at', { ascending: false }).limit(200),
    ])
    if (i.error) return setErr(/schema cache|does not exist|owner_name/i.test(i.error.message) ? 'Hãy chạy migration 023_shared_library.sql trên Supabase.' : i.error.message)
    const all = (i.data as Item[]) ?? []
    setItems(all.filter(x => x.owner_org_id === orgId)); setVisible(all)
    setStats(new Map(((s.data as Stat[]) ?? []).map(x => [x.item_id, x])))
    const tm = new Map<string, string[]>(); ((t.data as { item_id: string; org_id: string }[]) ?? []).forEach(x => tm.set(x.item_id, [...(tm.get(x.item_id) ?? []), x.org_id])); setTargets(tm)
    const os = (o.data as Org[]) ?? []; setOrgs(os); setMe(os.find(x => x.id === orgId) ?? null)
    setLessons((l.data as unknown as LP[]) ?? [])
  }
  useEffect(() => { load() }, [orgId])
  if (err) return <p className="msg">{err}</p>
  if (!me) return <p className="sub">Đang tải…</p>

  // Đơn vị cấp dưới (để chọn đơn vị nhận)
  const below: Org[] = []
  const walk = (id: string, depth: number) => orgs.filter(o => o.parent_id === id).forEach(o => { below.push({ ...o, name: '\u00a0'.repeat(depth * 3) + o.name }); walk(o.id, depth + 1) })
  walk(me.id, 0)
  const canPublic = me.type === 'provider'
  const usable = (x: Item) => x.status === 'published' || x.owner_org_id === orgId
  const lessonPool = visible.filter(x => x.kind === 'lesson' && usable(x))
  const src = (x: { owner_name?: string | null; owner_org_id?: string; org_id?: string }) => ((x.owner_org_id ?? x.org_id) === orgId ? '' : ` · ${x.owner_name ?? ''}`)
  const pick = (list: Item[]): Pick[] => list.map(x => ({ id: x.id, label: x.title + (x.status === 'draft' ? ' (nháp)' : '') + src(x) }))
  const planPool = pick(visible.filter(x => x.kind === 'material' && x.content.type === 'lesson_plan' && usable(x)))
  const matPool = pick(visible.filter(x => x.kind === 'material' && x.content.type !== 'lesson_plan' && usable(x)))
  const iSources: Src[] = [
    ...visible.filter(x => x.kind === 'lesson' && x.content.mode === 'interactive' && usable(x))
      .map(x => ({ id: x.id, label: 'Kho: ' + x.title + src(x), lesson: asLesson(x.content.lesson),
        meta: { title: x.title, summary: x.summary, subject: x.subject, grades: x.grades, program: x.program, tags: x.tags, program_id: x.program_id, unit_id: x.unit_id } as SrcMeta }))
      .filter((x): x is Src => blockCount(x.lesson) > 0),
    ...lessons.map(l => ({ id: l.id, label: 'Giáo viên: ' + l.title + (l.teachers ? ` — ${l.teachers.full_name}` : ''), lesson: asLesson(l.lesson),
      meta: { title: l.title.replace(/^Mẫu:\s*/, ''), summary: l.summary, subject: l.subject, grades: l.grades, program: l.program } }))
      .filter((x): x is Src => blockCount(x.lesson) > 0),
  ]
  const normPool: Pick[] = norms.map(n => ({ id: n.id, label: `${n.title} v${n.version_no}${n.status !== 'published' ? ' (nháp)' : ''}${src(n)}` }))

  function edit(i: Item) {
    setMsg(''); setInfo('')
    setForm({
      id: i.id, kind: i.kind, title: i.title, summary: i.summary ?? '', subject: i.subject ?? '', grades: i.grades ?? '', program: i.program ?? '',
      tags: i.tags.join(', '), scope: i.scope, targets: targets.get(i.id) ?? [], slides: i.content.slides ?? [], mtype: i.content.type ?? 'video',
      url: i.content.url ?? '', units: i.content.units ?? [],
      src: i.content.path ? 'file' : 'url',
      file: i.content.path ? { path: i.content.path, file_name: i.content.file_name ?? 'tệp', size: i.content.size ?? 0, mime: i.content.mime ?? '' } : null,
      program_id: i.program_id ?? '', unit_id: i.unit_id ?? '', usage_rights: i.usage_rights ?? 'adapt', usage_note: i.usage_note ?? '',
      plan: planOf(i.content as any), objectives: i.content.objectives ?? '', periods: i.content.periods ? String(i.content.periods) : '',
      plan_ids: i.content.plan_ids ?? [], lesson_ids: i.content.lesson_ids ?? [], norm_ids: i.content.norm_ids ?? [], material_ids: i.content.material_ids ?? [],
      lmode: i.content.mode === 'interactive' ? 'interactive' : 'slides', ilesson: asLesson(i.content.lesson),
    })
    setNorm(EMPTY_NORM); setSub(null); setNormOpen(false)
    // Vật tư của bài học: định mức gắn với bài (không hiện lại trong ô "định mức có sẵn")
    if (i.kind === 'unit' && orgId) loadUnitNorm(i.id, orgId).then(n => {
      setNorm(n)
      if (n.id) setForm(f => f && f.id === i.id ? { ...f, norm_ids: f.norm_ids.filter(x => x !== n.id) } : f)
    })
  }
  // Sao chép bài giảng tương tác: lấy các khối, điền các ô còn trống như sao chép slide
  function copyInteractive(ilesson: ILesson, m: SrcMeta) {
    if (!form) return
    const keepProg = !!form.program_id
    setForm({ ...form, ilesson, title: form.title || m.title, summary: form.summary || (m.summary ?? ''), subject: form.subject || (m.subject ?? ''),
      grades: form.grades || (m.grades ?? ''), program: form.program || (m.program ?? ''), tags: form.tags || (m.tags ?? []).join(', '),
      program_id: keepProg ? form.program_id : (m.program_id ?? ''), unit_id: keepProg ? form.unit_id : (m.unit_id ?? '') })
  }
  function importLesson(id: string) {
    const l = lessons.find(x => x.id === id); if (!l || !form) return
    setForm({ ...form, title: form.title || l.title.replace(/^Mẫu:\s*/, ''), subject: form.subject || (l.subject ?? ''), grades: form.grades || (l.grades ?? ''),
      program: form.program || (l.program ?? ''), summary: form.summary || (l.summary ?? ''), slides: l.slides.map(s => ({ ...s, id: uid() })) })
  }
  async function save(e: React.FormEvent, publish: boolean) {
    e.preventDefault(); if (!form || !orgId) return
    if (!form.title.trim()) return setMsg('Nhập tên.')
    if (form.scope === 'selected' && form.targets.length === 0) return setMsg('Chọn ít nhất một đơn vị nhận.')
    const isP = form.kind === 'material' && form.mtype === 'lesson_plan'
    const att = form.src === 'file' ? (form.file ? { url: '', ...form.file } : { url: '' }) : { url: form.url.trim() }
    if (isP && publish && !planFilled(form.plan) && !form.file && !form.url.trim()) return setMsg('Soạn nội dung giáo án hoặc đính kèm tệp trước khi phát hành.')
    if (!isP && form.kind === 'material' && form.src === 'file' && !form.file && publish) return setMsg('Chọn tệp học liệu để tải lên.')
    const lessonAtt = form.src === 'file' ? (form.file ? { url: '', ...form.file } : {}) : (form.url.trim() ? { url: form.url.trim() } : {})
    if (form.kind === 'lesson' && form.lmode === 'interactive' && publish && !blockCount(form.ilesson)) return setMsg('Bài giảng tương tác chưa có khối nội dung nào.')
    const content = form.kind === 'lesson'
      ? (form.lmode === 'interactive' ? { mode: 'interactive', lesson: form.ilesson ?? {} } : { mode: 'slides', slides: form.slides, ...lessonAtt })
      : form.kind === 'unit'
      ? { objectives: form.objectives.trim() || null, periods: Number(form.periods) || null, plan_ids: form.plan_ids, lesson_ids: form.lesson_ids, norm_ids: form.norm_ids, material_ids: form.material_ids }
      : isP ? { type: 'lesson_plan', ...att, ...form.plan }
      : form.kind === 'material'
      ? (form.src === 'file' && form.file ? { type: form.mtype, url: '', ...form.file } : { type: form.mtype, url: form.url.trim() })
      : { units: form.units }
    const row = {
      program_id: form.program_id || null, unit_id: form.program_id && form.unit_id ? form.unit_id : null,
      usage_rights: form.usage_rights, usage_note: form.usage_note.trim() || null,
      owner_org_id: orgId, kind: form.kind, title: form.title.trim(), summary: form.summary.trim() || null, subject: form.subject.trim() || null,
      grades: form.grades.trim() || null, program: form.program || null, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      scope: form.scope, content,
    }
    setBusy(true)
    const res = form.id ? await supabase.from('library_items').update(row).eq('id', form.id).select('id').single()
      : await supabase.from('library_items').insert(row).select('id').single()
    if (res.error) { setBusy(false); return setMsg(res.error.message) }
    const id = (res.data as { id: string }).id
    await supabase.from('library_targets').delete().eq('item_id', id)
    if (form.scope === 'selected') {
      const t = await supabase.from('library_targets').insert(form.targets.map(org_id => ({ item_id: id, org_id })))
      if (t.error) { setBusy(false); return setMsg(t.error.message) }
    }
    if (form.kind === 'unit') {
      const g = gradeList(form.grades)
      const r = await saveUnitNorm(norm, { itemId: id, orgId, title: row.title, subject: row.subject, grade: g.length === 1 ? g[0] : null, publish })
      const norm_ids = [...(r.id ? [r.id] : []), ...form.norm_ids.filter(x => x !== r.id && x !== norm.id)]
      const u = await supabase.from('library_items').update({ content: { ...content, norm_ids } }).eq('id', id)
      if (r.error || u.error) { setBusy(false); setMsg('Đã lưu bài học nhưng chưa lưu được vật tư: ' + (r.error ?? u.error?.message)); setForm({ ...form, id }); return load() }
      if (publish) {
        const e = await publishParts([...form.plan_ids, ...form.lesson_ids, ...form.material_ids])
        if (e) { setBusy(false); setMsg('Chưa phát hành được thành phần của bài: ' + e); setForm({ ...form, id }); return load() }
      }
    }
    if (publish) {
      const was = items.find(x => x.id === id)
      const note = was && was.version > 0 ? prompt('Ghi chú cho bản cập nhật (trường đã dùng sẽ thấy):', '') : null
      const p = await supabase.rpc('library_publish', { p_item: id, p_note: note })
      if (p.error) { setBusy(false); setMsg(p.error.message); setForm({ ...form, id }); return load() }
      setInfo(`Đã phát hành “${row.title}” (phiên bản ${p.data}).`)
    } else setInfo('Đã lưu nháp.')
    setBusy(false); setForm(null); load()
  }
  async function pickSubFile(f: File) {
    if (!sub || !orgId) return
    setSubBusy(true); setMsg('')
    try {
      const up = await uploadLearningFile(orgId, 'hoc-lieu', f)
      setSub(cur => cur && { ...cur, file: { path: up.path, file_name: up.name, size: up.size, mime: up.mime }, title: cur.title || up.name.replace(/\.[^.]+$/, '') })
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setSubBusy(false)
  }
  async function saveSub() {
    if (!sub || !form || !orgId) return
    const title = sub.title.trim() || `${sub.kind === 'plan' ? 'Giáo án' : sub.kind === 'lesson' ? 'Bài giảng' : MAT_TYPE[sub.mtype] ?? 'Học liệu'}: ${form.title.trim() || 'bài học'}`
    if (sub.kind === 'plan' && !planFilled(sub.plan) && !sub.file && !sub.url.trim()) return setMsg('Soạn nội dung giáo án hoặc đính kèm tệp.')
    if (sub.kind === 'lesson' && sub.lmode === 'interactive' && !blockCount(sub.ilesson ?? null)) return setMsg('Thêm ít nhất một khối nội dung cho bài giảng tương tác.')
    if (sub.kind === 'material' && !(sub.src === 'file' ? sub.file : sub.url.trim())) return setMsg(sub.src === 'file' ? 'Chọn tệp học liệu để tải lên.' : 'Nhập đường dẫn học liệu.')
    setSubBusy(true)
    const row = {
      owner_org_id: orgId, kind: sub.kind === 'lesson' ? 'lesson' : 'material', title, subject: form.subject.trim() || null, grades: form.grades.trim() || null,
      program: form.program || null, program_id: form.program_id || null, unit_id: form.program_id && form.unit_id ? form.unit_id : null,
      usage_rights: form.usage_rights, scope: form.scope, tags: [] as string[],
      content: sub.kind === 'lesson' && sub.lmode === 'interactive' ? { mode: 'interactive', lesson: sub.ilesson ?? {} }
        : sub.kind === 'lesson' ? { mode: 'slides', slides: sub.slides, ...(sub.src === 'file' ? (sub.file ? { url: '', ...sub.file } : {}) : (sub.url.trim() ? { url: sub.url.trim() } : {})) }
        : sub.kind === 'material' ? { type: sub.mtype, ...(sub.src === 'file' && sub.file ? { url: '', ...sub.file } : { url: sub.url.trim() }) }
        : { type: 'lesson_plan', ...(sub.src === 'file' && sub.file ? { url: '', ...sub.file } : { url: sub.url.trim() }), ...sub.plan },
    }
    const r = await supabase.from('library_items').insert(row).select('*, owner_name, owner_type').single()
    if (r.error) { setSubBusy(false); return setMsg(r.error.message) }
    const it = r.data as Item
    if (form.scope === 'selected' && form.targets.length) await supabase.from('library_targets').insert(form.targets.map(org_id => ({ item_id: it.id, org_id })))
    setVisible(v => [it, ...v]); setItems(v => [it, ...v])
    const key = sub.kind === 'plan' ? 'plan_ids' : sub.kind === 'lesson' ? 'lesson_ids' : 'material_ids'
    setForm(f => f && { ...f, [key]: [...f[key], it.id] })
    setSub(null); setSubBusy(false)
  }
  // Phát hành bài học kéo theo giáo án, bài giảng, học liệu của đơn vị đang là bản nháp
  async function publishParts(ids: string[]) {
    for (const x of visible.filter(v => ids.includes(v.id) && v.owner_org_id === orgId && v.status === 'draft')) {
      const p = await supabase.rpc('library_publish', { p_item: x.id, p_note: null })
      if (p.error) return `“${x.title}”: ${p.error.message}`
    }
    return null
  }
  async function publish(i: Item) {
    const note = i.version > 0 ? prompt('Ghi chú cho bản cập nhật (trường đã dùng sẽ thấy):', '') : null
    if (note === null && i.version > 0) return
    // Bài học: ban hành luôn định mức vật tư đang soạn của bài
    if (i.kind === 'unit' && orgId) {
      const r = await saveUnitNorm(await loadUnitNorm(i.id, orgId), { itemId: i.id, orgId, title: i.title, subject: i.subject, grade: null, publish: true })
      if (r.error) return setMsg('Chưa ban hành được vật tư của bài: ' + r.error)
      const e = await publishParts([...(i.content.plan_ids ?? []), ...(i.content.lesson_ids ?? []), ...(i.content.material_ids ?? [])])
      if (e) return setMsg('Chưa phát hành được thành phần của bài: ' + e)
    }
    const { data, error } = await supabase.rpc('library_publish', { p_item: i.id, p_note: note })
    if (error) setMsg(error.message); else { setMsg(''); setInfo(`Đã phát hành “${i.title}” (phiên bản ${data}).`); load() }
  }
  async function unpublish(i: Item) {
    if (!confirm(`Thu hồi “${i.title}”? Đơn vị nhận không thấy mục này nữa; bản các trường đã dùng vẫn giữ nguyên.`)) return
    const { error } = await supabase.rpc('library_unpublish', { p_item: i.id })
    if (error) setMsg(error.message); else { setInfo('Đã thu hồi.'); load() }
  }
  async function remove(i: Item) {
    if (!confirm(`Xoá “${i.title}”?`)) return
    const { error } = await supabase.from('library_items').delete().eq('id', i.id)
    if (error) setMsg(error.message); else { setInfo('Đã xoá.'); load() }
  }

  async function pickFile(f: File) {
    if (!form || !orgId) return
    setUploading(true); setMsg('')
    try {
      const up = await uploadLearningFile(orgId, 'hoc-lieu', f)
      setForm(cur => cur && { ...cur, file: { path: up.path, file_name: up.name, size: up.size, mime: up.mime }, title: cur.title || up.name.replace(/\.[^.]+$/, '') })
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setUploading(false)
  }

  const ofTab = items.filter(i => tab === 'plan' ? isPlan(i) : tab === 'material' ? i.kind === 'material' && !isPlan(i) : i.kind === tab)
  const subjects = [...new Set(ofTab.map(i => i.subject).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'vi'))
  const shown = ofTab.filter(i => (!fStatus || i.status === fStatus) && (!fSubject || i.subject === fSubject)
    && (!fGrade || gradeList(i.grades ?? '').includes(Number(fGrade))) && (tab !== 'material' || !fType || (i.content.type ?? 'link') === fType)
    && (!q || normText([i.title, i.summary, i.subject, ...i.tags].join(' ')).includes(normText(q))))
  const kindTabs: T[] = ['unit', 'plan', 'lesson', 'material', 'norm']
  const tabLabel = (t: T) => t === 'norm' ? 'Định mức vật tư' : t === 'plan' ? 'Giáo án' : KIND[t][0]
  const addNew = (t: T) => {
    setMsg(''); setInfo(''); setNorm(EMPTY_NORM); setSub(null); setNormOpen(false)
    setForm(t === 'plan' ? { ...EMPTY('material'), mtype: 'lesson_plan' } : EMPTY(t as Item['kind']))
  }
  const setUnit = (k: number, p: Partial<Unit>) => form && setForm({ ...form, units: form.units.map((u, j) => j === k ? { ...u, ...p } : u) })

  // Tóm tắt nội dung / thành phần của một mục cho cột trong danh sách
  const partsOf = (i: Item) => {
    const c = i.content
    if (i.kind === 'unit') {
      const n = (a: string[] | undefined, l: string) => (a ?? []).length ? `${(a ?? []).length} ${l}` : ''
      return [c.periods ? `${c.periods} tiết` : '', n(c.plan_ids, 'giáo án'), n(c.lesson_ids, 'bài giảng'), n(c.norm_ids, 'định mức'), n(c.material_ids, 'học liệu')].filter(Boolean).join(' · ') || '—'
    }
    if (i.kind === 'lesson' && c.mode === 'interactive') return `Tương tác · ${blockCount(asLesson(c.lesson))} khối`
    if (i.kind === 'lesson') return [`${(c.slides ?? []).length} slide`, c.file_name ? 'có tệp' : c.url ? 'có đường dẫn' : ''].filter(Boolean).join(' · ')
    if (isPlan(i)) { const p = planOf(c as any); return [p.periods && `${p.periods} tiết`, p.steps.length && `${p.steps.length} bước`, c.file_name ? 'có tệp' : c.url ? 'có đường dẫn' : ''].filter(Boolean).join(' · ') || 'chưa có nội dung' }
    return [MAT_TYPE[c.type ?? 'link'], c.file_name ?? (c.url ? 'đường dẫn' : 'chưa có tệp')].filter(Boolean).join(' · ')
  }
  return (
    <>
      <div style={{ marginBottom: 10 }}>
        <Tabs items={kindTabs.map(k => [k, tabLabel(k), k === 'norm' ? undefined : items.filter(i => k === 'plan' ? isPlan(i) : k === 'material' ? i.kind === 'material' && !isPlan(i) : i.kind === k).length] as [T, string, number?])}
          value={tab} onChange={t => { setTab(t); setOpen(null); setFType('') }} />
      </div>
      {tab === 'norm' ? <Suspense fallback={<p className="sub">Đang tải…</p>}><MaterialNorms orgId={orgId} /></Suspense> : <>
      <div className="bar">
        <div className="tools">
          <select value={fGrade} onChange={e => setFGrade(e.target.value)} aria-label="Khối"><option value="">Mọi khối</option>{Array.from({ length: 12 }, (_, k) => k + 1).map(g => <option key={g} value={g}>Khối {g}</option>)}</select>
          {tab === 'material' && <select value={fType} onChange={e => setFType(e.target.value)} aria-label="Loại học liệu"><option value="">Mọi loại</option>{MAT_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
          <select value={fSubject} onChange={e => setFSubject(e.target.value)} aria-label="Môn"><option value="">Mọi môn</option>{subjects.map(x => <option key={x}>{x}</option>)}</select>
          <select value={fStatus} onChange={e => setFStatus(e.target.value)} aria-label="Trạng thái"><option value="">Mọi trạng thái</option><option value="published">Đã phát hành</option><option value="draft">Nháp</option><option value="archived">Đã thu hồi</option></select>
          <input placeholder="Tìm tên, mô tả, từ khoá…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
        </div>
        <div className="tools">
          <ViewToggle value={view} onChange={setView} />
          <button type="button" className="primary" onClick={() => addNew(tab)}>Thêm {tabLabel(tab).toLowerCase()}</button>
        </div>
      </div>
      <p className="sub">Học liệu phát hành tới {me.type === 'provider' ? 'các đơn vị bạn chọn hoặc công khai toàn hệ thống' : `các đơn vị trực thuộc ${me.name}`}. Trường “dùng” sẽ có bản riêng để chỉnh sửa; khi bạn phát hành bản cập nhật, trường được báo nhưng bản của họ không bị ghi đè.</p>
      {msg && !form && <p className="msg">{msg}</p>}
      {info && <p className="sub"><b>{info}</b></p>}

      {form && (
        <Drawer wide closeOnOutside={false} onClose={() => setForm(null)}
          actions={<>
            <button type="button" className="primary" disabled={busy || uploading} onClick={() => save(NOEV, true)}>Lưu & phát hành</button>
            <button type="button" disabled={busy || uploading} onClick={() => save(NOEV, false)}>Lưu nháp</button>
            <button type="button" onClick={() => setForm(null)}>Huỷ</button></>}
          title={`${form.id ? 'Sửa' : 'Thêm'} ${form.kind === 'material' && form.mtype === 'lesson_plan' ? 'giáo án' : KIND[form.kind][0].toLowerCase()}${form.id && form.title ? `: ${form.title}` : ''}`}>
        <form className="panel libform" onSubmit={e => save(e, false)}>
          {msg && <p className="msg">{msg}</p>}
          <div className="formgrid libgrid4">
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên *</span><input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Mô tả ngắn</span><textarea rows={2} value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} /></label>
            <label className="field"><span>Môn</span><SubjectPicker value={form.subject} onChange={v => setForm({ ...form, subject: v })} emptyLabel="— Không chọn —" /></label>
            <label className="field"><span>Loại chương trình</span><select value={form.program} onChange={e => setForm({ ...form, program: e.target.value })}><option value="">—</option>{PROGRAMS.map(p => <option key={p}>{p}</option>)}</select></label>
            <label className="field" style={{ gridColumn: 'span 2' }}><span>Từ khoá</span><input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="robot, cảm biến" /></label>
            <div className="field" style={{ gridColumn: '1 / -1' }}><span>Khối</span><GradeChecks inline value={gradeList(form.grades)} onChange={g => setForm({ ...form, grades: g.join(',') })} /></div>
            <label className="field" style={{ gridColumn: 'span 2' }}><span>Chương trình giáo dục</span>
              <select value={form.program_id} onChange={e => setForm({ ...form, program_id: e.target.value, unit_id: '' })} aria-label="Chương trình giáo dục">
                <option value="">— không gắn —</option>{programs.map(p => <option key={p.id} value={p.id}>{progLabel(p)}{p.status === 'draft' ? ' · nháp' : ''}</option>)}</select></label>
            <label className="field" style={{ gridColumn: 'span 2' }}><span>{form.kind === 'unit' ? 'Học phần' : 'Bài'}</span>
              <select value={form.unit_id} disabled={!form.program_id} onChange={e => setForm({ ...form, unit_id: e.target.value })} aria-label={form.kind === 'unit' ? 'Học phần' : 'Bài'}>
                <option value="">{form.kind === 'unit' ? '— chọn học phần —' : '— chọn bài —'}</option>{unitTree(units, form.program_id, form.kind === 'unit' ? 'topic' : 'lesson', form.unit_id).map(u => <option key={u.id} value={u.id}>{u.label}</option>)}</select></label>
            <label className="field"><span>Quyền sử dụng</span>
              <select value={form.usage_rights} onChange={e => setForm({ ...form, usage_rights: e.target.value as Rights })} aria-label="Quyền sử dụng">
                {(Object.keys(RIGHTS) as Rights[]).map(r => <option key={r} value={r}>{RIGHTS[r][0]}</option>)}</select></label>
            <label className="field" style={{ gridColumn: 'span 2' }}><span>Ghi chú quyền sử dụng</span><input value={form.usage_note} onChange={e => setForm({ ...form, usage_note: e.target.value })} placeholder="VD: chỉ dùng trong năm học 2026–2027, ghi nguồn KDI" /></label>
            <label className="field"><span>Phát hành tới</span>
              <select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value as Item['scope'] })}>
                {me.type !== 'provider' && <option value="children">{SCOPE.children}</option>}
                <option value="selected">{SCOPE.selected}</option>
                {canPublic && <option value="public">{SCOPE.public}</option>}
              </select></label>
          </div>
          {form.scope === 'selected' && (
            <fieldset className="libtargets"><legend>Đơn vị nhận (gồm cả đơn vị trực thuộc của đơn vị được chọn)</legend>
              {below.length === 0 && <p className="sub">Đơn vị chưa có cấp dưới.</p>}
              {below.map(o => (
                <label key={o.id}><input type="checkbox" checked={form.targets.includes(o.id)}
                  onChange={e => setForm({ ...form, targets: e.target.checked ? [...form.targets, o.id] : form.targets.filter(x => x !== o.id) })} /> {o.name}</label>
              ))}
            </fieldset>
          )}

          {form.kind === 'unit' && (
            <div className="formgrid libgrid4">
              <label className="field" style={{ gridColumn: 'span 3' }}><span>Mục tiêu bài học</span><textarea rows={2} value={form.objectives} onChange={e => setForm({ ...form, objectives: e.target.value })} /></label>
              <label className="field"><span>Số tiết</span><input type="number" min={0} max={999} value={form.periods} onChange={e => setForm({ ...form, periods: e.target.value })} /></label>
              <h4 className="libparthead">Thành phần của bài</h4>
              <ChipPicker label="Giáo án" hint="soạn giáo án mới cho bài hoặc chọn giáo án có sẵn" options={planPool} value={form.plan_ids} onChange={v => setForm({ ...form, plan_ids: v })} missing="giáo án không còn trong kho"
                extra={sub?.kind !== 'plan' && <button type="button" className="libpartnew" onClick={() => setSub({ kind: 'plan', mtype: '', title: '', slides: [], src: 'file', url: '', file: null, plan: EMPTY_PLAN })}>+ Soạn giáo án mới</button>} />
              {sub?.kind === 'plan' && (
                <div className="panel formgrid" style={{ gridColumn: '1 / -1', margin: 0 }}>
                  <label className="field" style={{ gridColumn: 'span 2' }}><span>Tên giáo án</span><input value={sub.title} onChange={e => setSub({ ...sub, title: e.target.value })} placeholder={`Giáo án: ${form.title || 'tên bài học'}`} /></label>
                  <div style={{ gridColumn: '1 / -1' }}><PlanEditor value={sub.plan} onChange={plan => setSub({ ...sub, plan })} /></div>
                  <div className="field"><span>Tệp đính kèm (không bắt buộc)</span><div className="tools">
                    <label><input type="radio" checked={sub.src === 'file'} onChange={() => setSub({ ...sub, src: 'file' })} /> Tải tệp lên</label>
                    <label><input type="radio" checked={sub.src === 'url'} onChange={() => setSub({ ...sub, src: 'url' })} /> Đường dẫn</label></div></div>
                  {sub.src === 'url'
                    ? <label className="field" style={{ gridColumn: 'span 2' }}><span>Đường dẫn</span><input value={sub.url} onChange={e => setSub({ ...sub, url: e.target.value })} placeholder="https://…" /></label>
                    : <div className="field" style={{ gridColumn: 'span 2' }}><span>Tệp (tối đa {MAX_FILE_MB} MB)</span><div className="tools">
                        {sub.file && <span className="chip">{sub.file.file_name} · {fmtSize(sub.file.size)}</span>}
                        <label className={'filebtn' + (subBusy ? ' busy' : '')}>{subBusy ? 'Đang tải lên…' : sub.file ? 'Thay tệp' : 'Chọn tệp'}
                          <input type="file" hidden disabled={subBusy} onChange={e => { const f = e.target.files?.[0]; if (f) pickSubFile(f); e.target.value = '' }} /></label></div></div>}
                  <div className="formactions"><button type="button" className="primary" disabled={subBusy} onClick={saveSub}>Thêm vào bài</button> <button type="button" onClick={() => setSub(null)}>Huỷ</button></div>
                </div>
              )}
              <ChipPicker label="Bài giảng" hint="soạn bài giảng mới cho bài hoặc chọn bài giảng có sẵn" options={pick(lessonPool)} value={form.lesson_ids} onChange={v => setForm({ ...form, lesson_ids: v })} missing="bài giảng không còn trong kho"
                extra={sub?.kind !== 'lesson' && <button type="button" className="libpartnew" onClick={() => setSub({ kind: 'lesson', mtype: '', title: '', slides: [{ id: uid(), kind: 'title', title: form.title, body: '' }], src: 'file', url: '', file: null, plan: EMPTY_PLAN, lmode: 'interactive', ilesson: null })}>+ Soạn bài giảng mới</button>} />
              {sub?.kind === 'lesson' && (
                <div className="panel" style={{ gridColumn: '1 / -1', margin: 0 }}>
                  <label className="field"><span>Tên bài giảng</span><input value={sub.title} onChange={e => setSub({ ...sub, title: e.target.value })} placeholder={`Bài giảng: ${form.title || 'tên bài học'}`} /></label>
                  <LessonModePicker value={sub.lmode ?? 'slides'} onChange={lmode => setSub({ ...sub, lmode })} />
                  {sub.lmode === 'interactive' ? <InteractiveLesson value={sub.ilesson ?? null} ct={form.program} onChange={ilesson => setSub({ ...sub, ilesson })} onCopy={(ilesson, m) => setSub({ ...sub, ilesson, title: sub.title || m.title })} sources={iSources} /> : <>
                  <div className="bar small"><b>Slide bài giảng</b>
                    <select value="" onChange={e => { const l = lessons.find(x => x.id === e.target.value); if (l) setSub({ ...sub, title: sub.title || l.title.replace(/^Mẫu:\s*/, ''), slides: l.slides.map(s => ({ ...s, id: uid() })) }) }} aria-label="Sao chép từ bài giảng có sẵn">
                      <option value="">Sao chép từ bài giảng có sẵn…</option>
                      {lessons.map(l => <option key={l.id} value={l.id}>{l.title}{l.teachers ? ` — ${l.teachers.full_name}` : ''}</option>)}
                    </select></div>
                  <SlidesEditor slides={sub.slides} onChange={slides => setSub({ ...sub, slides })} />
                  <div className="formgrid" style={{ marginTop: 8 }}>
                    <div className="field"><span>Tệp / đường dẫn bài giảng (không bắt buộc)</span><div className="tools">
                      <label><input type="radio" checked={sub.src === 'file'} onChange={() => setSub({ ...sub, src: 'file' })} /> Tải tệp lên</label>
                      <label><input type="radio" checked={sub.src === 'url'} onChange={() => setSub({ ...sub, src: 'url' })} /> Đường dẫn</label></div></div>
                    {sub.src === 'url'
                      ? <label className="field" style={{ gridColumn: 'span 2' }}><span>Đường dẫn</span><input value={sub.url} onChange={e => setSub({ ...sub, url: e.target.value })} placeholder="https://…" /></label>
                      : <div className="field" style={{ gridColumn: 'span 2' }}><span>Tệp (tối đa {MAX_FILE_MB} MB)</span><div className="tools">
                          {sub.file && <span className="chip">{sub.file.file_name} · {fmtSize(sub.file.size)}</span>}
                          <label className={'filebtn' + (subBusy ? ' busy' : '')}>{subBusy ? 'Đang tải lên…' : sub.file ? 'Thay tệp' : 'Chọn tệp'}
                            <input type="file" hidden disabled={subBusy} onChange={e => { const f = e.target.files?.[0]; if (f) pickSubFile(f); e.target.value = '' }} /></label></div></div>}
                  </div></>}
                  <div className="formactions"><button type="button" className="primary" disabled={subBusy} onClick={saveSub}>Thêm vào bài</button> <button type="button" onClick={() => setSub(null)}>Huỷ</button></div>
                </div>
              )}
              <ChipPicker label="Định mức vật tư" hint="nhập vật tư mới cho bài hoặc chọn định mức có sẵn" options={normPool.filter(o => o.id !== norm.id)} value={form.norm_ids} onChange={v => setForm({ ...form, norm_ids: v })} missing="định mức không còn"
                lead={!normOpen && norm.rows.length > 0 && <span className="chip">Vật tư của bài: {norm.rows.length} vật tư{norm.status === 'published' ? '' : ' (nháp)'}
                  <button type="button" className="linkbtn" onClick={() => setNormOpen(true)}>Sửa</button>
                  <button type="button" className="x" aria-label="Bỏ vật tư của bài" onClick={() => setNorm({ ...norm, rows: [], dirty: true })}>×</button></span>}
                extra={!normOpen && <button type="button" className="libpartnew" onClick={() => setNormOpen(true)}>{norm.rows.length ? 'Sửa vật tư của bài' : '+ Nhập vật tư mới'}</button>} />
              {normOpen && (
                <div className="panel formgrid" style={{ gridColumn: '1 / -1', margin: 0 }}>
                  <UnitNormEditor value={norm} onChange={setNorm} />
                  <div className="formactions"><button type="button" className="primary" onClick={() => setNormOpen(false)}>Xong</button>
                    {' '}<small className="sub">Vật tư được lưu khi lưu bài học.</small></div>
                </div>
              )}
              <ChipPicker label="Học liệu khác" hint="phiếu học tập, video, tài liệu… soạn mới cho bài hoặc chọn học liệu có sẵn" options={matPool} value={form.material_ids} onChange={v => setForm({ ...form, material_ids: v })} missing="học liệu không còn trong kho"
                extra={sub?.kind !== 'material' && <button type="button" className="libpartnew" onClick={() => setSub({ kind: 'material', mtype: 'worksheet', title: '', slides: [], src: 'file', url: '', file: null, plan: EMPTY_PLAN })}>+ Thêm học liệu mới</button>} />
              {sub?.kind === 'material' && (
                <div className="panel formgrid" style={{ gridColumn: '1 / -1', margin: 0 }}>
                  <label className="field" style={{ gridColumn: 'span 2' }}><span>Tên học liệu</span><input value={sub.title} onChange={e => setSub({ ...sub, title: e.target.value })} placeholder={`${MAT_TYPE[sub.mtype] ?? 'Học liệu'}: ${form.title || 'tên bài học'}`} /></label>
                  <label className="field"><span>Loại học liệu</span><select value={sub.mtype} onChange={e => setSub({ ...sub, mtype: e.target.value })} aria-label="Loại học liệu mới">{MAT_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                  <div className="field"><span>Nguồn</span><div className="tools">
                    <label><input type="radio" checked={sub.src === 'file'} onChange={() => setSub({ ...sub, src: 'file' })} /> Tải tệp lên</label>
                    <label><input type="radio" checked={sub.src === 'url'} onChange={() => setSub({ ...sub, src: 'url' })} /> Đường dẫn</label></div></div>
                  {sub.src === 'url'
                    ? <label className="field" style={{ gridColumn: 'span 3' }}><span>Đường dẫn *</span><input value={sub.url} onChange={e => setSub({ ...sub, url: e.target.value })} placeholder="https://…" /></label>
                    : <div className="field" style={{ gridColumn: 'span 3' }}><span>Tệp * (tối đa {MAX_FILE_MB} MB)</span><div className="tools">
                        {sub.file && <span className="chip">{sub.file.file_name} · {fmtSize(sub.file.size)}</span>}
                        <label className={'filebtn' + (subBusy ? ' busy' : '')}>{subBusy ? 'Đang tải lên…' : sub.file ? 'Thay tệp' : 'Chọn tệp'}
                          <input type="file" hidden disabled={subBusy} onChange={e => { const f = e.target.files?.[0]; if (f) pickSubFile(f); e.target.value = '' }} /></label></div></div>}
                  <div className="formactions"><button type="button" className="primary" disabled={subBusy} onClick={saveSub}>Thêm vào bài</button> <button type="button" onClick={() => setSub(null)}>Huỷ</button></div>
                </div>
              )}
              <p className="sub" style={{ gridColumn: '1 / -1', margin: 0 }}>Giáo án, bài giảng, vật tư và học liệu soạn ở đây đi theo bài học: dùng cùng môn, khối, nơi phát hành và được phát hành cùng bài. Vật tư của bài được lưu thành định mức vật tư, ban hành cùng bài học. Trường bấm “Dùng bài học” sẽ có bản riêng của mọi bài giảng được gắn.</p>
            </div>
          )}
          {form.kind === 'lesson' && <LessonModePicker value={form.lmode} onChange={lmode => setForm({ ...form, lmode })} />}
          {form.kind === 'lesson' && form.lmode === 'interactive' && <InteractiveLesson value={form.ilesson} ct={form.program} onChange={ilesson => setForm({ ...form, ilesson })} onCopy={copyInteractive} sources={iSources} skip={form.id} />}
          {form.kind === 'lesson' && form.lmode === 'slides' && (
            <>
              <div className="bar small"><b>Slide bài giảng</b>
                <select value="" onChange={e => importLesson(e.target.value)} aria-label="Sao chép từ bài giảng có sẵn">
                  <option value="">Sao chép từ bài giảng có sẵn…</option>
                  {lessons.map(l => <option key={l.id} value={l.id}>{l.title}{l.teachers ? ` — ${l.teachers.full_name}` : ''}</option>)}
                </select></div>
              <SlidesEditor slides={form.slides} onChange={slides => setForm({ ...form, slides })} />
              <div className="formgrid" style={{ marginTop: 10 }}>
                <div className="field"><span>Tệp / đường dẫn bài giảng (không bắt buộc)</span><div className="tools">
                  <label><input type="radio" checked={form.src === 'file'} onChange={() => setForm({ ...form, src: 'file' })} /> Tải tệp lên</label>
                  <label><input type="radio" checked={form.src === 'url'} onChange={() => setForm({ ...form, src: 'url' })} /> Đường dẫn</label></div></div>
                {form.src === 'url'
                  ? <label className="field" style={{ gridColumn: 'span 2' }}><span>Đường dẫn</span><input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://… (Canva, Google Slides, YouTube…)" /></label>
                  : <div className="field" style={{ gridColumn: 'span 2' }}><span>Tệp (tối đa {MAX_FILE_MB} MB, VD: PowerPoint, PDF)</span><div className="tools">
                      {form.file && <span className="chip">{form.file.file_name} · {fmtSize(form.file.size)}<button type="button" className="x" aria-label="Bỏ tệp" onClick={() => setForm({ ...form, file: null })}>×</button></span>}
                      <label className={'filebtn' + (uploading ? ' busy' : '')}>{uploading ? 'Đang tải lên…' : form.file ? 'Thay tệp' : 'Chọn tệp'}
                        <input type="file" hidden disabled={uploading} onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = '' }} /></label></div></div>}
              </div>
            </>
          )}
          {form.kind === 'material' && form.mtype === 'lesson_plan' && <PlanEditor value={form.plan} onChange={plan => setForm({ ...form, plan })} />}
          {form.kind === 'material' && (
            <div className="formgrid">
              {form.mtype !== 'lesson_plan' && <label className="field"><span>Loại học liệu</span><select value={form.mtype} onChange={e => setForm({ ...form, mtype: e.target.value })} aria-label="Loại học liệu">{MAT_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
              <div className="field"><span>{form.mtype === 'lesson_plan' ? 'Tệp đính kèm (không bắt buộc)' : 'Nguồn'}</span><div className="tools">
                <label><input type="radio" checked={form.src === 'file'} onChange={() => setForm({ ...form, src: 'file' })} /> Tải tệp lên</label>
                <label><input type="radio" checked={form.src === 'url'} onChange={() => setForm({ ...form, src: 'url' })} /> Đường dẫn</label></div></div>
              {form.src === 'url'
                ? <label className="field" style={{ gridColumn: 'span 2' }}><span>Đường dẫn{form.mtype === 'lesson_plan' ? '' : ' *'}</span><input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://…" /></label>
                : <div className="field" style={{ gridColumn: 'span 2' }}><span>Tệp (tối đa {MAX_FILE_MB} MB)</span><div className="tools">
                    {form.file && <span className="chip">{form.file.file_name} · {fmtSize(form.file.size)}</span>}
                    <label className={'filebtn' + (uploading ? ' busy' : '')}>{uploading ? 'Đang tải lên…' : form.file ? 'Thay tệp' : 'Chọn tệp'}
                      <input type="file" hidden disabled={uploading} onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f); e.target.value = '' }} /></label>
                  </div></div>}
            </div>
          )}
          {form.kind === 'program' && (
            <div className="libunitedit">
              <b>Các học phần</b>
              {form.units.map((u, k) => (
                <div className="unitrow" key={k}>
                  <b className="no">{k + 1}</b>
                  <input value={u.title} onChange={e => setUnit(k, { title: e.target.value })} placeholder="Tên học phần" aria-label={`Tên học phần ${k + 1}`} />
                  <input type="number" min={0} value={u.periods ?? 0} onChange={e => setUnit(k, { periods: Number(e.target.value) })} aria-label="Số tiết" title="Số tiết" />
                  <input value={u.objectives ?? ''} onChange={e => setUnit(k, { objectives: e.target.value })} placeholder="Mục tiêu" aria-label="Mục tiêu" />
                  <select value="" onChange={e => e.target.value && setUnit(k, { lesson_ids: [...(u.lesson_ids ?? []), e.target.value] })} aria-label="Gắn bài giảng">
                    <option value="">+ Gắn bài giảng trong kho…</option>
                    {lessonPool.filter(x => !(u.lesson_ids ?? []).includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.title} · {x.owner_name}</option>)}
                  </select>
                  <button type="button" onClick={() => setForm({ ...form, units: form.units.filter((_, j) => j !== k) })} aria-label="Xoá học phần">×</button>
                  {(u.lesson_ids ?? []).length > 0 && <div className="unitlessons">{(u.lesson_ids ?? []).map(id => (
                    <span className="chip" key={id}>{visible.find(x => x.id === id)?.title ?? 'bài giảng'}<button type="button" className="x" aria-label="Bỏ bài giảng" onClick={() => setUnit(k, { lesson_ids: (u.lesson_ids ?? []).filter(x => x !== id) })}>×</button></span>))}</div>}
                </div>
              ))}
              <button type="button" className="linkbtn" onClick={() => setForm({ ...form, units: [...form.units, { title: `Học phần ${form.units.length + 1}`, periods: 2, objectives: '', lesson_ids: [] }] })}>+ Thêm chủ đề</button>
            </div>
          )}
        </form>
        </Drawer>
      )}
      {open && !form && <ItemDrawer root={{ type: 'item', id: open }} all={visible} onClose={() => setOpen(null)} canRestore onRestored={load}
        actions={i => i.owner_org_id !== orgId ? <small className="sub">Mục của {i.owner_name ?? 'đơn vị khác'}: chỉ xem.</small> : <>
          <button type="button" className="primary" onClick={() => edit(i)}>Sửa</button>
          <button type="button" onClick={() => publish(i)}>{i.status === 'published' ? 'Phát hành bản cập nhật' : 'Phát hành'}</button>
          {i.status === 'published' && <button type="button" onClick={() => unpublish(i)}>Thu hồi</button>}
          {i.status !== 'published' && !stats.get(i.id) && <button type="button" className="danger" onClick={() => { remove(i); setOpen(null) }}>Xoá</button>}
        </>} />}

      {view === 'cards' ? (shown.length === 0 ? <p className="sub">{ofTab.length ? 'Không có mục nào khớp bộ lọc.' : `Chưa có ${tabLabel(tab).toLowerCase()} nào. Bấm “Thêm ${tabLabel(tab).toLowerCase()}” để bắt đầu.`}</p> : (
        <div className={'tilegrid ' + (tab === 'lesson' ? 'wide' : 'sq')}>
          {shown.map((i, n) => {
            const s = stats.get(i.id)
            const img = i.content?.type === 'image' && i.content.url ? i.content.url : null
            return (
              <button key={i.id} type="button" className={'tile' + (open === i.id ? ' on' : '')} onClick={() => setOpen(i.id)}>
                <div className={'tileart art' + (n % 6)} style={img ? { backgroundImage: `url("${img}")` } : undefined}>
                  <ProgChip p={i.program} />
                  <span className="tilestatus"><StatusChip s={i.status} /></span>
                  {!img && <span aria-hidden="true"><Icon n={tileIcon(i, tab)} size={40} /></span>}
                </div>
                <div className="tilebody">
                  <b>{i.title}</b>
                  <small>{[i.subject, i.grades && `Khối ${i.grades}`].filter(Boolean).join(' · ') || '—'}</small>
                  <div className="tilemeta">{i.version > 0 && <span>v{i.version}</span>}<span>{s ? `${s.schools} trường dùng` : 'Chưa có trường dùng'}</span><span>{fmtDate(i.updated_at)}</span></div>
                </div>
              </button>
            )
          })}
        </div>
      )) : <div className="wrap">
        <table className="libtable">
          <thead><tr><th>{tabLabel(tab)}</th><th>Chương trình</th><th>{tab === 'unit' ? 'Thành phần' : 'Nội dung'}</th><th>Phát hành tới</th><th>Trạng thái</th><th>Trường đã dùng</th><th>Cập nhật</th></tr></thead>
          <tbody>
            {shown.map(i => {
              const s = stats.get(i.id)
              return (<Fragment key={i.id}>
                <tr className={'rowlink' + (open === i.id ? ' on' : '')} onClick={() => setOpen(i.id)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setOpen(i.id) }}>
                  <td><b>{i.title}</b>
                    <div className="sub" style={{ fontSize: 12 }}>{[i.subject, i.grades && `Khối ${i.grades}`].filter(Boolean).join(' · ') || '—'}{i.program ? <> <ProgChip p={i.program} /></> : null}{i.usage_rights && i.usage_rights !== 'adapt' && <> <RightsChip r={i.usage_rights} /></>}</div></td>
                  <td>{i.edu_programs ? <>{i.edu_programs.title} <small className="sub">v{i.edu_programs.version_no}</small>{i.edu_program_units && <div className="sub" style={{ fontSize: 12 }}>{i.edu_program_units.title}</div>}</> : <small className="sub">—</small>}</td>
                  <td><small>{partsOf(i)}</small></td>
                  <td>{SCOPE[i.scope]}{i.scope === 'selected' && <div className="sub" style={{ fontSize: 12 }}>{(targets.get(i.id) ?? []).map(id => orgs.find(o => o.id === id)?.name).filter(Boolean).join(', ')}</div>}</td>
                  <td><StatusChip s={i.status} />{i.version > 0 && <small className="sub"> v{i.version}</small>}</td>
                  <td>{s ? <>{s.schools} trường{s.outdated ? <div className="sub" style={{ fontSize: 12 }}>{s.outdated} bản dùng phiên bản cũ</div> : null}</> : <small className="sub">Chưa có</small>}</td>
                  <td><small>{fmtDate(i.updated_at)}</small></td>
                </tr>
              </Fragment>)
            })}
            {shown.length === 0 && <tr><td colSpan={7}>{ofTab.length ? 'Không có mục nào khớp bộ lọc.' : `Chưa có ${tabLabel(tab).toLowerCase()} nào. Bấm “Thêm ${tabLabel(tab).toLowerCase()}” để bắt đầu.`}</td></tr>}
          </tbody>
        </table>
      </div>}
      </>}
    </>
  )
}

// Biểu tượng ở thẻ học liệu khi chưa có ảnh
function tileIcon(i: Item, tab: string) {
  if (tab === 'plan') return 'clipboard'
  if (i.kind === 'unit') return 'book'
  if (i.kind === 'lesson') return 'monitor'
  return ({ image: 'image', video: 'film', link: 'link', worksheet: 'fileText', guide: 'book', lesson_plan: 'clipboard' } as Record<string, string>)[i.content?.type ?? ''] ?? 'file'
}
