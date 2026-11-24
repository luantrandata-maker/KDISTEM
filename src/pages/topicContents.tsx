import React, { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { FILE_BUCKET, MAX_FILE_MB, fileUrl, openFile, uploadLearningFile } from '../lib/files'
import { readKitFile, type KitDraft, type KitStep } from '../lib/kitImport'
import type { MaterialGroup, ProgramModule, ProgramTopic } from '../lib/programFrame'
import { useStemTracks } from '../lib/stemTracks'
import { TopicForm, TopicOverview } from './topicInfo'
import { embedUrl } from './elearning/common'
import { RowMenu } from '../components/ProTools'

// 6 nội dung của chủ đề (164, 165): mỗi tab là danh sách mục. Bấm vào mục để xem ngay trên trang (Word, PowerPoint, PDF, ảnh,
// link Google Drive / Docs / YouTube). Kế hoạch giảng dạy, bài giảng tách tự động từ file Word / PowerPoint (lấy luôn vật tư,
// phiếu học tập, yêu cầu cần đạt). Bài kiểm tra: tải file, dán link hoặc chọn đề có sẵn. KDI thêm, sửa, xoá; người khác chỉ xem.

export const TOPIC_KINDS = [
  { key: 'plan', label: 'Kế hoạch giảng dạy' },
  { key: 'lecture', label: 'Bài giảng' },
  { key: 'worksheet', label: 'Phiếu học tập' },
  { key: 'test', label: 'Bài kiểm tra' },
  { key: 'material', label: 'Vật tư' },
  { key: 'resource', label: 'Kho học liệu' },
] as const
type Kind = typeof TOPIC_KINDS[number]['key']
const kindLabel = (k: Kind) => TOPIC_KINDS.find(x => x.key === k)!.label
const PER: Record<string, string> = { product: '1 sản phẩm', student: 'Học sinh', group: 'Nhóm', class: 'Lớp' }
// Cột "Cả lớp" ở Vật tư: tạm tính lớp 35 học sinh, nhóm 5 em (1 sản phẩm = 1 nhóm)
const CLASS_N = 35, GROUP_N = 5, MAT_SHOW = 6, STEP_SHOW = 10
const fmtN = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',')
const classQty = (i: { qty: number | null; per: string | null }) => i.qty == null || !i.per ? null
  : Number(i.qty) * (i.per === 'student' ? CLASS_N : i.per === 'class' ? 1 : Math.ceil(CLASS_N / GROUP_N))
const ACCEPT: Partial<Record<Kind, string>> = { plan: '.docx,.doc,.pdf', lecture: '.pptx,.ppt,.pdf' }

type TextPart = { title: string; body: string }
type Content = { steps?: KitStep[]; sections?: Record<string, string>; slides?: string[]; parts?: TextPart[]; reusable?: boolean } | null
export type TopicItem = {
  id: string; topic_id: string; kind: Kind; seq: number; title: string; detail: string; url: string | null
  file_path: string | null; file_name: string | null; material_group_id: string | null; qty: number | null; unit: string | null; per: string | null
  exam_id: string | null; content: Content
}
type Draft = Omit<TopicItem, 'id'> & { id?: string }
type Exam = { id: string; title: string; subject: string | null; grade: number | null; mode: string; question_ids: string[]; criteria: { count?: number } | null; duration_min: number | null; status: string }

const errText = (m: string) => (/schema cache|does not exist|column/i.test(m) ? 'Hãy tải lại trang; nếu vẫn lỗi thì chạy migration 164–165 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Chỉ KDI sửa được nội dung chủ đề.' : m)
const ext = (n: string | null) => (n ?? '').split('.').pop()!.toLowerCase()
const examQs = (e: Exam) => (e.mode === 'fixed' ? e.question_ids.length : e.criteria?.count ?? 0)
const examMeta = (e: Exam) => [examQs(e) ? `${examQs(e)} câu` : '', e.duration_min ? `${e.duration_min} phút` : '', e.status === 'draft' ? 'Nháp' : ''].filter(Boolean).join(' · ')

async function platformOrg() { const { data } = await supabase.rpc('platform_org_id'); return data as string }
async function uploadTopicFile(file: File) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`Tệp ${(file.size / 1048576).toFixed(0)} MB, lớn hơn ${MAX_FILE_MB} MB: hãy đưa lên Google Drive rồi dán link.`)
  return uploadLearningFile(await platformOrg(), 'program-topics', file)
}

// ----- Khung xem tệp / link ngay trên trang -----
function viewSrc(i: TopicItem, signed: string | null): { src: string; full: string; img?: boolean } | null {
  if (i.file_path && signed) {
    const e = ext(i.file_name ?? i.file_path)
    if (['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls'].includes(e)) {
      const u = encodeURIComponent(signed)
      return { src: `https://view.officeapps.live.com/op/embed.aspx?src=${u}`, full: `https://view.officeapps.live.com/op/view.aspx?src=${u}` }
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(e)) return { src: signed, full: signed, img: true }
    if (['pdf', 'mp4', 'webm', 'mp3', 'txt'].includes(e)) return { src: signed, full: signed }
    return null
  }
  if (i.url) {
    const g = i.url.match(/docs\.google\.com\/(document|presentation|spreadsheets|forms)\/d\/([\w-]+)/)
    if (g) return { src: `https://docs.google.com/${g[1]}/d/${g[2]}/${g[1] === 'forms' ? 'viewform?embedded=true' : 'preview'}`, full: i.url }
    const em = embedUrl(i.url)
    if (em) return { src: em, full: i.url }
  }
  return null
}

export function Viewer({ item }: { item: TopicItem }) {
  const [signed, setSigned] = useState<string | null>(null)
  const [ready, setReady] = useState(!item.file_path)
  useEffect(() => { if (item.file_path) fileUrl(item.file_path).then(u => { setSigned(u); setReady(true) }) }, [item.file_path])
  if (!ready) return <p className="sub">Đang mở tệp…</p>
  const v = viewSrc(item, signed)
  if (!v) return <p className="sub">Không xem trước được loại tệp này trên trang. {item.file_path || item.url ? 'Hãy bấm Tải về / Mở link.' : ''}</p>
  return <div style={{ marginTop: 10 }}>
    {v.img ? <img src={v.src} alt={item.title} style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid var(--line)' }} />
      : <iframe title={item.title} src={v.src} allowFullScreen style={{ width: '100%', height: '70vh', minHeight: 380, border: '1px solid var(--line)', borderRadius: 6, background: '#fff' }} />}
    <div style={{ marginTop: 6 }}><a href={v.full} target="_blank" rel="noopener noreferrer">{ext(item.file_name) === 'pptx' || /presentation/.test(item.url ?? '') ? 'Trình chiếu' : 'Toàn màn hình'} ↗</a>
      {item.file_path && /^(docx|doc|pptx|ppt|xlsx|xls)$/.test(ext(item.file_name)) && <span className="sub"> · Tệp Office lớn hơn 10 MB có thể không xem trước được, hãy Tải về.</span>}</div>
  </div>
}

/** Bảng hoạt động: nhóm theo Buổi (có tổng phút), dài quá thì thu gọn */
export function Steps({ steps }: { steps: KitStep[] }) {
  const [all, setAll] = useState(steps.length <= STEP_SHOW)
  const shown = all ? steps : steps.slice(0, STEP_SHOW - 2)
  const sum = (p?: string) => steps.filter(x => (x.phase ?? '') === (p ?? '')).reduce((a, b) => a + (Number(b.minutes) || 0), 0)
  let last: string | undefined = '\u0000'
  return <div className="wrap" style={{ marginTop: 8 }}><table className="slt ttdense tcsteps" style={{ width: '100%' }}>
    <thead><tr><th style={{ width: 44 }}>#</th><th>Hoạt động</th><th style={{ width: 70, textAlign: 'right' }}>Phút</th></tr></thead>
    <tbody>{shown.map((s, k) => { const p = s.phase ?? '', head = p !== last ? (last = p, p) : null
      return <React.Fragment key={k}>
        {head !== null && head && <tr className="tcphase"><td colSpan={3}>{head}{sum(head) ? <span> · {sum(head)} phút</span> : null}</td></tr>}
        <tr><td>{k + 1}</td><td>{s.title}{s.goal && <div className="sub">Mục tiêu: {s.goal}</div>}</td><td style={{ textAlign: 'right' }}>{s.minutes ?? ''}</td></tr>
      </React.Fragment> })}</tbody>
  </table>
  {steps.length > STEP_SHOW && <button type="button" className="linkbtn tcmore" onClick={() => setAll(!all)}>{all ? 'Thu gọn ▴' : `Xem thêm ${steps.length - shown.length} hoạt động ▾`}</button>}</div>
}

const Q_KIND: Record<string, string> = { single: 'Một đáp án', multi: 'Nhiều đáp án', truefalse: 'Đúng / Sai' }
const Q_LEVEL: Record<string, string> = { nhan_biet: 'Nhận biết', thong_hieu: 'Thông hiểu', van_dung: 'Vận dụng', van_dung_cao: 'Vận dụng cao' }
export function ExamView({ id }: { id: string }) {
  type Q = { id: string; stem: string; kind: string; level: string }
  const [qs, setQs] = useState<Q[] | null>(null)
  const [e, setE] = useState<Exam | null | undefined>(undefined)
  useEffect(() => {
    supabase.from('practice_exams').select('id,title,subject,grade,mode,question_ids,criteria,duration_min,status').eq('id', id).maybeSingle().then(({ data }) => {
      const x = data as Exam | null; setE(x)
      if (x?.mode === 'fixed' && x.question_ids.length) supabase.from('question_bank').select('id,stem,kind,level').in('id', x.question_ids).then(({ data: q }) =>
        setQs(x.question_ids.map(i => (q ?? []).find((r: { id: string }) => r.id === i)).filter(Boolean) as Q[]))
    })
  }, [id])
  if (e === undefined) return <p className="sub">Đang mở đề…</p>
  if (!e) return <p className="sub">Không mở được đề (đề đã xoá hoặc chưa được chia sẻ cho đơn vị của anh/chị).</p>
  return <div style={{ marginTop: 8 }}>
    <p className="sub" style={{ margin: 0 }}>{[e.subject, e.grade ? 'Khối ' + e.grade : '', examMeta(e), e.mode === 'random' ? 'Rút ngẫu nhiên từ Ngân hàng câu hỏi' : ''].filter(Boolean).join(' · ')}</p>
    {qs && qs.length > 0 && <div className="tcexstat">{Object.entries(Q_LEVEL).map(([k, l]) => { const n = qs.filter(q => q.level === k).length
      return n ? <span key={k}><b>{n}</b> {l.toLowerCase()}</span> : null })}</div>}
    {/* Bảng câu hỏi gọn: hiện khoảng 10 câu, còn lại cuộn trong khung (tiêu đề cột đứng yên) */}
    {qs && <div className="wrap tcexq" style={{ marginTop: 8 }}><table className="slt ttdense" style={{ width: '100%' }}>
      <thead><tr><th style={{ width: 44 }}>#</th><th>Câu hỏi</th><th style={{ width: 120 }}>Loại</th><th style={{ width: 120 }}>Mức độ</th></tr></thead>
      <tbody>{qs.map((q, k) => <tr key={q.id + k}><td>{k + 1}</td><td style={{ whiteSpace: 'normal' }}>{q.stem}</td><td>{Q_KIND[q.kind] ?? q.kind}</td><td>{Q_LEVEL[q.level] ?? q.level}</td></tr>)}</tbody>
    </table></div>}
    {qs && qs.length > 10 && <p className="sub tcexqn">{qs.length} câu · cuộn trong bảng để xem hết</p>}
  </div>
}

/** Mở mục ở tab mới: link mở thẳng; tệp Word / PowerPoint / Excel mở bằng trình xem Office, tệp khác (PDF, ảnh…) mở link tải có hạn */
async function openItem(i: TopicItem) {
  if (!i.file_path) { if (i.url) window.open(i.url, '_blank', 'noopener,noreferrer'); return }
  const w = window.open('', '_blank')   // mở tab ngay khi bấm để trình duyệt không chặn, rồi mới gán địa chỉ
  const u = await fileUrl(i.file_path)
  if (!u || !w) { w?.close(); alert('Không mở được tệp (không có quyền hoặc tệp đã bị xoá).'); return }
  w.opener = null
  w.location.href = OFFICE.includes(ext(i.file_name ?? i.file_path)) ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(u)}` : u
}
const OFFICE = ['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls']
const FTAG: Record<string, string> = { docx: 'WORD', doc: 'WORD', pptx: 'POWERPOINT', ppt: 'POWERPOINT', xlsx: 'EXCEL', xls: 'EXCEL', pdf: 'PDF' }

/** Danh sách hoạt động của giáo án (trang chủ đề): nhóm theo Buổi, có số phút từng buổi và tổng; dài quá thì thu gọn */
function StepList({ steps }: { steps: KitStep[] }) {
  const [all, setAll] = useState(steps.length <= STEP_SHOW)
  const shown = all ? steps : steps.slice(0, STEP_SHOW - 2)
  const mins = (x: KitStep[]) => x.reduce((a, b) => a + (Number(b.minutes) || 0), 0)
  const total = mins(steps)
  let last: string | undefined = '\u0000'
  return <div className="tcsl">
    {shown.map((s, k) => { const p = s.phase ?? '', head = p !== last ? (last = p, p) : null, m = mins(steps.filter(x => (x.phase ?? '') === p))
      return <Fragment key={k}>
        {head && <div className="tcslph">{head}{m ? ` · ${m} phút` : ''}</div>}
        <div className="tcslr"><span className="tcslno">{k + 1}</span><span className="tcslt">{s.title}{s.goal && <small>{s.goal}</small>}</span>
          <span className="tcslm">{s.minutes != null && String(s.minutes) !== '' ? `${s.minutes} phút` : ''}</span></div>
      </Fragment> })}
    {steps.length > STEP_SHOW && <button type="button" className="linkbtn tcmore" onClick={() => setAll(!all)}>{all ? 'Thu gọn ▴' : `Xem thêm ${steps.length - shown.length} hoạt động ▾`}</button>}
    {all && total > 0 && <div className="tcslph tcsltot"><span>Tổng</span><span>{total} phút</span></div>}
  </div>
}

export function TopicContents({ topic, admin, onTopicChanged, module }: { topic: ProgramTopic; admin: boolean; onTopicChanged?: () => void
  /** Học phần của chủ đề (trang gọi đã có thì truyền vào, không thì tự tải) */
  module?: ProgramModule }) {
  const topicId = topic.id
  // Thông tin chung: bấm ✎ để sửa ngay tại chỗ; lưu xong tải lại chủ đề để phần xem cập nhật (kể cả trang gọi không tải lại)
  const [t, setT] = useState(topic)
  useEffect(() => { setT(topic); setInfoEdit(false) }, [topic])
  const [mod, setMod] = useState<ProgramModule | undefined>(module)
  useEffect(() => {
    if (module) { setMod(module); return }
    supabase.from('program_modules').select('*').eq('id', topic.module_id).maybeSingle().then(({ data }) => setMod((data ?? undefined) as ProgramModule | undefined))
  }, [module, topic.module_id])
  const { byCode } = useStemTracks()
  const track = mod ? byCode[mod.track_code] : undefined
  const [infoEdit, setInfoEdit] = useState(false)
  const infoSaved = () => {
    setInfoEdit(false); onTopicChanged?.()
    supabase.from('program_topics').select('*').eq('id', topicId).maybeSingle().then(({ data }) => { if (data) setT(data as ProgramTopic) })
  }
  const [items, setItems] = useState<TopicItem[]>([])
  const [groups, setGroups] = useState<MaterialGroup[]>([])
  const [kind, setKind] = useState<Kind>('plan')
  const [edit, setEdit] = useState<Draft | null>(null)
  // Bấm "+ Thêm" khi tab đã có nội dung (kế hoạch, bài giảng, phiếu): hỏi sửa bản đang có hay thêm bản mới
  const [ask, setAsk] = useState(false)
  const [editMode, setEditMode] = useState<Mode | undefined>()
  // Sửa một bản đã có hoạt động / các phần (vd. giáo án tách từ Word): mở thẳng bảng Nhập trực tiếp để sửa nội dung
  const editItem = (i: TopicItem, m?: Mode) => { setAsk(false); setEditMode(m ?? (MANUAL.includes(i.kind) && (i.content?.steps?.length || i.content?.parts?.length) ? 'manual' : undefined)); setEdit(i) }
  const [openId, setOpenId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [more, setMore] = useState<Record<string, boolean>>({})
  const [cur, setCur] = useState('ov')
  const wrapRef = useRef<HTMLDivElement>(null)
  const secRefs = useRef<Record<string, HTMLElement | null>>({})
  const lock = useRef(0)   // vừa bấm mục lục: giữ mục được bấm, không để cuộn mượt đổi màu giữa chừng
  // Mục lục tô mục đang xem: mục cuối cùng có đầu đã cuộn qua mép trên khung cuộn (ngăn bên phải hoặc cả trang)
  useEffect(() => {
    const root = wrapRef.current?.closest('.drawerbody') as HTMLElement | null
    const target: HTMLElement | Window = root ?? window
    const on = () => {
      if (Date.now() < lock.current) return
      const top = (root?.getBoundingClientRect().top ?? 0) + 90
      let c = 'ov'
      for (const [k, el] of Object.entries(secRefs.current)) if (el && el.getBoundingClientRect().top <= top) c = k
      const end = root ? root.scrollTop + root.clientHeight >= root.scrollHeight - 4 : window.innerHeight + window.scrollY >= document.body.scrollHeight - 4
      setCur(end ? 'resource' : c)
    }
    target.addEventListener('scroll', on, { passive: true }); on()
    return () => target.removeEventListener('scroll', on)
  }, [importing])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const reload = () => supabase.from('program_topic_items').select('*').eq('topic_id', topicId).order('seq')
    .then(({ data, error }) => { setItems((data ?? []) as TopicItem[]); setMsg(error ? errText(error.message) : '') })
  useEffect(() => { setEdit(null); setAsk(false); setImporting(false); setOpenId(null); reload() }, [topicId])
  useEffect(() => { supabase.from('material_groups').select('*').eq('active', true).order('sort').then(({ data }) => setGroups((data ?? []) as MaterialGroup[])) }, [])

  const gName = (id: string | null) => groups.find(g => g.id === id)?.name ?? ''
  const nextSeq = (k: Kind) => items.filter(i => i.kind === k).reduce((s, i) => Math.max(s, i.seq), 0) + 1
  const blank = (kind: Kind): Draft => ({ topic_id: topicId, kind, seq: nextSeq(kind), title: '', detail: '', url: null, file_path: null, file_name: null,
    material_group_id: null, qty: null, unit: null, per: kind === 'material' ? 'product' : null, exam_id: null, content: null })
  const planFile = items.find(i => i.kind === 'plan' && i.file_path && /^docx$/.test(ext(i.file_name)))

  async function del(i: TopicItem) {
    if (!confirm(`Xoá "${i.title}"?`)) return
    const { error } = await supabase.from('program_topic_items').delete().eq('id', i.id)
    if (error) return setMsg(errText(error.message)); reload()
  }
  async function refetchMaterials() {
    if (!planFile?.file_path) return
    setBusy(true); setMsg('')
    try {
      const { data, error } = await supabase.storage.from(FILE_BUCKET).download(planFile.file_path)
      if (error || !data) throw new Error('Không tải được file giáo án.')
      const d = await readKitFile(new File([data], planFile.file_name ?? 'giao-an.docx'))
      if (!d.norms.rows.length) throw new Error('Không tìm thấy vật tư trong file giáo án.')
      const old = items.filter(i => i.kind === 'material')
      if (!confirm(`Thay ${old.length} dòng vật tư hiện có bằng ${d.norms.rows.length} dòng lấy từ "${planFile.file_name}"?`)) { setBusy(false); return }
      if (old.length) { const r = await supabase.from('program_topic_items').delete().in('id', old.map(i => i.id)); if (r.error) throw new Error(errText(r.error.message)) }
      const r = await supabase.from('program_topic_items').insert(materialRows(d, topicId, 1)); if (r.error) throw new Error(errText(r.error.message))
      reload()
    } catch (e) { setMsg((e as Error).message) }
    setBusy(false)
  }

  if (importing) return <div style={{ marginTop: 16 }}>
    <TopicImport topic={t} items={items} onClose={() => setImporting(false)} onDone={k => { setImporting(false); setKind(k); reload(); onTopicChanged?.() }} />
  </div>

  // Một trang cuộn (v71): khung Thông tin chung ở đầu, bên dưới một khung "Nội dung dạy học" gồm 6 mục liền nhau. Cột trái là mục lục
  // đứng yên, bấm để nhảy tới mục, cuộn tới đâu tô xanh tới đó. Thẻ tệp / link bấm vào là mở tab mới, không mở sẵn trong trang.
  // Mỗi mục chỉ có nút ＋ (thêm) và ⋮ (tách từ Word / PowerPoint, lấy lại vật tư…); người không phải KDI không thấy nút nào.
  const ofKind = (k: Kind) => items.filter(i => i.kind === k)
  const goto = (id: string) => { lock.current = Date.now() + 900; setCur(id); secRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const addTo = (k: Kind) => { setKind(k); setEditMode(undefined); setOpenId(null); if (MANUAL.includes(k) && ofKind(k).length) { setEdit(null); setAsk(true) } else { setAsk(false); setEdit(blank(k)) } }
  const startImport = () => { setEdit(null); setAsk(false); setImporting(true) }
  const extra = (k: Kind) => [
    // Tách từ file chỉ dùng lần đầu: mục đã có nội dung thì ẩn (sửa tiếp bằng ⋮ Sửa trên thẻ)
    ...(k === 'plan' && !ofKind('plan').length ? [{ label: 'Tách từ giáo án Word', onClick: startImport }] : []),
    ...(k === 'lecture' && !ofKind('lecture').length ? [{ label: 'Tách từ bài giảng PowerPoint', onClick: startImport }] : []),
    ...(k === 'material' && planFile ? [{ label: 'Lấy lại vật tư từ giáo án', onClick: refetchMaterials }] : []),
  ]
  const summary = (k: Kind): string => {
    const l = ofKind(k)
    if (k === 'material' && busy) return 'Đang đọc giáo án…'
    if (!l.length) return 'Chưa có'
    if (k === 'material') return `${l.length} loại · cả lớp tính theo lớp ${CLASS_N} học sinh, nhóm ${GROUP_N} em`
    if (k === 'plan' && l.length === 1) { const st = l[0].content?.steps ?? []; const m = st.reduce((x, y) => x + (Number(y.minutes) || 0), 0)
      return [l[0].title, st.length ? `${st.length} hoạt động` : '', m ? `${m} phút` : ''].filter(Boolean).join(' · ') }
    if (l.length === 1) return l[0].title
    return `${l.length} bản`
  }
  const itemCard = (i: TopicItem) => {
    const file = !!(i.file_path || i.url)
    const icon = i.exam_id ? '📝' : i.file_path ? ({ docx: '📄', doc: '📄', pptx: '📊', ppt: '📊', pdf: '📕' } as Record<string, string>)[ext(i.file_name)] ?? '📎' : i.url ? '🔗' : '📋'
    const tag = i.file_path ? FTAG[ext(i.file_name ?? i.file_path)] ?? ext(i.file_name ?? i.file_path).toUpperCase() : i.url ? 'LINK' : ''
    const meta = [i.exam_id ? 'Đề có sẵn' : '', i.file_name, !i.file_name && i.url ? i.url.replace(/^https?:\/\//, '') : '', i.content?.slides?.length ? `${i.content.slides.length} slide` : '', i.content?.parts?.length ? `${i.content.parts.length} phần` : ''].filter(Boolean).join(' · ')
    const menu = [...(i.file_path ? [{ label: 'Tải về', onClick: () => openFile(i.file_path!) }] : []),
      ...(admin ? [{ label: 'Sửa', onClick: () => { setKind(i.kind); editItem(i) } }, { label: 'Xoá', danger: true, onClick: () => del(i) }] : [])]
    const plan = i.kind === 'plan' && !!i.content?.steps?.length
    const card = <div className={'tccard' + (file ? ' go' : '')} role={file ? 'link' : undefined} tabIndex={file ? 0 : undefined}
      title={file ? (i.url && !i.file_path ? 'Mở link ở tab mới' : 'Mở tệp ở tab mới') : undefined}
      onClick={() => file && openItem(i)} onKeyDown={e => { if (file && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openItem(i) } }}>
      <span className="tcic" aria-hidden>{icon}</span>
      <span className="tcmain"><b>{i.title}{tag && <i className="tcft">{tag}</i>}</b>{meta && <small className="sub">{meta}</small>}</span>
      {file && <span className="tcgo" aria-hidden>↗</span>}
      {menu.length > 0 && <span className="tccm" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}><RowMenu label={i.title} items={menu} /></span>}
    </div>
    return <div key={i.id} className="tcitem">
      {plan ? <>{i.detail && <p className="tcdetail">{i.detail}</p>}<StepList steps={i.content!.steps!} />{(file || menu.length > 0) && card}</>
        : <>{card}{i.detail && <p className="sub tcdetail">{i.detail}</p>}</>}
      {i.exam_id && <ExamView id={i.exam_id} />}
      {!plan && !!i.content?.steps?.length && <StepList steps={i.content.steps} />}
      {!!i.content?.parts?.length && <div style={{ display: 'grid', gap: 10, marginTop: 6 }}>{i.content.parts.map((x, k) => <section key={k}>
        {x.title && <h4 style={{ margin: '0 0 4px' }}>{x.title}</h4>}<p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{x.body}</p></section>)}</div>}
      {!!i.content?.slides?.length && !i.file_path && <ol className="sub" style={{ paddingLeft: 20 }}>{i.content.slides.map((s, k) => <li key={k}>{s}</li>)}</ol>}
    </div>
  }
  const materialTable = (l: TopicItem[]) => {
    const all = !!more.material || l.length <= MAT_SHOW, shown = all ? l : l.slice(0, MAT_SHOW)
    return <>
      <div className="wrap"><table className="slt ttdense" style={{ width: '100%' }}>
        <thead><tr><th>Vật tư</th><th>Nhóm vật tư</th><th>Định mức</th><th>Tính theo</th><th style={{ textAlign: 'right' }} title={`Lớp ${CLASS_N} học sinh, nhóm ${GROUP_N} em`}>Cả lớp</th>{admin && <th />}</tr></thead>
        <tbody>{shown.map(i => { const c = classQty(i); return <tr key={i.id}>
          <td><b>{i.title}</b>{i.content?.reusable && <span className="sub"> · dùng lại</span>}{i.detail && <div className="sub">{i.detail}</div>}</td>
          <td>{gName(i.material_group_id)}</td>
          <td>{i.qty != null ? `${Number(i.qty)} ${i.unit ?? ''}` : ''}</td>
          <td>{i.per ? <span className="tcper">{PER[i.per]}</span> : ''}</td>
          <td style={{ textAlign: 'right' }}>{c != null ? <b>{fmtN(c)} {i.unit ?? ''}</b> : <span className="sub">—</span>}</td>
          {admin && <td className="c-menu"><RowMenu label={i.title} items={[{ label: 'Sửa', onClick: () => { setKind('material'); editItem(i) } }, { label: 'Xoá', danger: true, onClick: () => del(i) }]} /></td>}
        </tr> })}</tbody>
      </table></div>
      {l.length > MAT_SHOW && <button type="button" className="linkbtn tcmore" onClick={() => setMore(m => ({ ...m, material: !all }))}>{all ? 'Thu gọn ▴' : `Xem thêm ${l.length - MAT_SHOW} loại ▾`}</button>}
    </>
  }

  return <div className="tconewrap" ref={wrapRef}>
    <div className="tcone">
      <nav className="tctoc" aria-label="Mục lục chủ đề"><div className="tctocin">
        <p className="tctoch">Mục lục</p>
        <button type="button" className={cur === 'ov' ? 'on' : ''} onClick={() => goto('ov')}><span className="tcst ov" aria-hidden>i</span>Thông tin chung</button>
        {TOPIC_KINDS.map(k => { const n = ofKind(k.key).length
          return <button key={k.key} type="button" className={cur === k.key ? 'on' : ''} onClick={() => goto(k.key)}>
            <span className={'tcst ' + (n ? 'y' : 'n')} aria-hidden>{n ? '✓' : '!'}</span>{k.label}<i>{n || '–'}</i></button> })}
      </div></nav>
      <div className="tcsecs">
        <section className="tcsec tcbox" data-sec="ov" ref={el => { secRefs.current.ov = el }}>
          <div className="tcsech"><span className="tcno ov">i</span><h3>Thông tin chung</h3><span style={{ flex: 1 }} />
            {admin && !infoEdit && <button type="button" className="tcib" title="Chỉnh sửa thông tin chung" aria-label="Chỉnh sửa thông tin chung" onClick={() => setInfoEdit(true)}>✎</button>}</div>
          {infoEdit ? <TopicForm t={t} track={track} onCancel={() => setInfoEdit(false)} onSaved={infoSaved} />
            : <TopicOverview t={t} module={mod && track?.use_modules !== false ? mod.name : undefined} textbook={track?.schedule_mode === 'subject'} />}
          {msg && <p className="msg">{msg}</p>}
        </section>
        <div className="tcbox tcsix">
          <p className="tcsixh">Nội dung dạy học</p>
          {TOPIC_KINDS.map((k, n) => { const l = ofKind(k.key), here = kind === k.key, x = extra(k.key)
            return <section key={k.key} className="tcsec" data-sec={k.key} ref={el => { secRefs.current[k.key] = el }}>
              <div className="tcsech"><span className="tcno">{n + 1}</span><h3>{k.label}</h3><small className={l.length ? 'sub' : 'tcnone'} title={summary(k.key)}>{summary(k.key)}</small>
                {admin && <button type="button" className="tcib pl" title={'Thêm ' + k.label.toLowerCase()} aria-label={'Thêm ' + k.label.toLowerCase()} onClick={() => addTo(k.key)}>＋</button>}
                {admin && x.length > 0 && <span className="tcsm"><RowMenu label={k.label} items={x} /></span>}</div>
              {here && ask && !edit && <div className="tcask" role="alertdialog" aria-label="Đã có nội dung">
                <p>ⓘ Chủ đề này đã có <b>{l.length} {k.label.toLowerCase()}</b>{l.length === 1 ? <>: <b>{l[0].title}</b>{l[0].content?.steps?.length ? ` (${l[0].content.steps.length} hoạt động)` : ''}</> : ''}.<br />
                  Sửa {l.length === 1 ? 'bản đó' : 'một bản đang có'} hay thêm một bản khác?</p>
                <div className="tcaskbtns">
                  {l.length === 1 && <button type="button" className="primary" onClick={() => editItem(l[0], 'manual')}>✎ Sửa bản đang có</button>}
                  <button type="button" onClick={() => { setAsk(false); setEdit(blank(k.key)) }}>+ Vẫn thêm bản mới</button>
                  <button type="button" className="ghost" onClick={() => setAsk(false)}>Huỷ</button>
                </div>
                {l.length > 1 && <div className="tcaskpick">{l.map(i => <button key={i.id} type="button" onClick={() => editItem(i, 'manual')}>✎ Sửa “{i.title}”</button>)}</div>}
              </div>}
              {here && edit ? <ItemForm d={edit} startMode={editMode} groups={groups} topic={t} onCancel={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />
                : !l.length ? <p className="tcempty">Chưa có {k.label.toLowerCase()}.{admin ? ' Bấm ＋ để thêm.' : ''}{k.key === 'plan' && admin ? ' Có sẵn giáo án Word thì bấm ⋮ → Tách từ giáo án Word để tự lấy hoạt động, vật tư, link học liệu.' : ''}{k.key === 'material' && admin && !planFile ? ' Hoặc tách giáo án Word ở mục Kế hoạch giảng dạy để lấy vật tư tự động.' : ''}</p>
                : k.key === 'material' ? materialTable(l)
                : <div className={ask && here ? 'tcdim' : undefined}>{l.map(itemCard)}</div>}
            </section> })}
        </div>
      </div>
    </div>
  </div>
}

// ----- Thêm / sửa một mục -----
type Mode = 'file' | 'link' | 'exam' | 'manual'
// Nhập trực tiếp: kế hoạch giảng dạy điền bảng hoạt động (cùng kiểu với giáo án tách từ Word); bài giảng, phiếu học tập điền các phần văn bản
const MANUAL: Kind[] = ['plan', 'lecture', 'worksheet']
function ItemForm({ d, startMode, groups, topic, onCancel, onSaved }: { d: Draft; startMode?: Mode; groups: MaterialGroup[]; topic: ProgramTopic; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Draft>(d)
  const [mode, setMode] = useState<Mode>(startMode ?? (d.exam_id ? 'exam' : d.url && !d.file_path ? 'link' : !d.file_path && MANUAL.includes(d.kind) && (d.id ? true : false) ? 'manual' : 'file'))
  const [steps, setSteps] = useState<KitStep[]>(() => d.content?.steps?.length ? d.content.steps : [{ phase: '', title: '', goal: '' }])
  const [parts, setParts] = useState<TextPart[]>(() => d.content?.parts?.length ? d.content.parts : [{ title: '', body: '' }])
  const [exams, setExams] = useState<Exam[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const set = (p: Partial<Draft>) => setF(x => ({ ...x, ...p }))
  const mat = f.kind === 'material', test = f.kind === 'test'
  useEffect(() => {
    if (test) supabase.from('practice_exams').select('id,title,subject,grade,mode,question_ids,criteria,duration_min,status').order('created_at', { ascending: false }).limit(300)
      .then(({ data }) => setExams((data ?? []) as Exam[]))
  }, [test])

  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true); setMsg('')
    try { const r = await uploadTopicFile(file); set({ file_path: r.path, file_name: r.name, title: f.title || file.name.replace(/\.[^.]+$/, '') }) }
    catch (e) { setMsg((e as Error).message) }
    setBusy(false)
  }
  async function save() {
    if (!f.title.trim()) return setMsg('Nhập tên.')
    const manual = mode === 'manual'
    const st = steps.map(x => ({ ...x, title: x.title.trim(), phase: x.phase?.trim() || undefined, goal: x.goal?.trim() || undefined })).filter(x => x.title)
    const pt = parts.map(x => ({ title: x.title.trim(), body: x.body.trim() })).filter(x => x.title || x.body)
    if (manual && (f.kind === 'plan' ? !st.length : !pt.length)) return setMsg(f.kind === 'plan' ? 'Nhập ít nhất một hoạt động.' : 'Nhập ít nhất một phần nội dung.')
    const content = !manual ? f.content : f.kind === 'plan' ? { ...(f.content ?? {}), steps: st } : { ...(f.content ?? {}), parts: pt }
    const row = { ...f, content, url: mode === 'link' ? f.url : null, file_path: mode === 'file' || manual ? f.file_path : null, file_name: mode === 'file' || manual ? f.file_name : null, exam_id: mode === 'exam' ? f.exam_id : null }
    if (!mat && mode === 'exam' && !row.exam_id) return setMsg('Chọn một đề.')
    if (!mat && mode === 'link' && row.url && !/^https?:\/\//i.test(row.url.trim())) return setMsg('Link phải bắt đầu bằng http:// hoặc https://')
    setBusy(true)
    const { id, ...rest } = row
    const { error } = id ? await supabase.from('program_topic_items').update(rest).eq('id', id) : await supabase.from('program_topic_items').insert(rest)
    setBusy(false)
    if (error) return setMsg(errText(error.message)); onSaved()
  }
  const qn = q.trim().toLowerCase()
  const shown = exams.filter(e => !qn || [e.title, e.subject, e.grade ? 'khối ' + e.grade : ''].join(' ').toLowerCase().includes(qn))
    .sort((a, b) => Number(b.grade === topic.grade) - Number(a.grade === topic.grade)).slice(0, 30)

  return <div className="panel">
    <div className="formgrid">
      {!mat && <div className="field" style={{ gridColumn: '1 / -1' }}><span>Cách thêm</span>
        <div className="seg">{([['file', 'Tải file lên'], ['link', 'Dán link'], ...(test ? [['exam', 'Chọn từ đề có sẵn']] : []), ...(MANUAL.includes(f.kind) ? [['manual', 'Nhập trực tiếp']] : [])] as [Mode, string][]).map(([k, l]) =>
          <button key={k} type="button" className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>)}</div></div>}
      {!mat && mode === 'exam' && <div className="field" style={{ gridColumn: '1 / -1' }}><span>Tìm đề (E-learning & luyện thi → Đề luyện)</span>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tên đề, môn, khối…" />
        <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
          {shown.map(e => <label key={e.id} style={{ display: 'flex', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--line)', color: 'var(--text)', cursor: 'pointer' }}>
            <input type="radio" checked={f.exam_id === e.id} onChange={() => set({ exam_id: e.id, title: f.title || e.title })} />
            <span><b>{e.title}</b><br /><small className="sub">{[e.subject, e.grade ? 'Khối ' + e.grade : '', examMeta(e)].filter(Boolean).join(' · ')}</small></span></label>)}
          {!shown.length && <p className="sub" style={{ padding: 10, margin: 0 }}>Không có đề phù hợp.</p>}
        </div>
        <small className="sub">Chưa có đề? Tạo ở E-learning & luyện thi → Đề luyện (chia sẻ cho trường), rồi quay lại chọn.</small></div>}
      <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên *</span><input value={f.title} maxLength={200} onChange={e => set({ title: e.target.value })} placeholder={mat ? 'Ví dụ: Giấy màu A4' : 'Ví dụ: Giáo án Chong chóng giấy'} /></label>
      {mat ? <>
        <label className="field"><span>Nhóm vật tư</span><select value={f.material_group_id ?? ''} onChange={e => set({ material_group_id: e.target.value || null })}>
          <option value="">—</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        <label className="field"><span>Số lượng</span><input type="number" min={0} step="any" value={f.qty ?? ''} onChange={e => set({ qty: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        <label className="field"><span>Đơn vị</span><input value={f.unit ?? ''} onChange={e => set({ unit: e.target.value })} placeholder="tờ, cái, bộ…" /></label>
        <label className="field"><span>Tính theo</span><select value={f.per ?? ''} onChange={e => set({ per: e.target.value || null })}>
          <option value="">—</option>{Object.entries(PER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </> : mode === 'link' ? <label className="field" style={{ gridColumn: '1 / -1' }}><span>Đường link (Google Drive, Docs, Slides, YouTube… xem được ngay trên trang)</span>
        <input value={f.url ?? ''} onChange={e => set({ url: e.target.value })} placeholder="https://…" /></label>
        : mode === 'file' ? <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tệp{f.file_name ? ' · ' + f.file_name : ''} (tối đa {MAX_FILE_MB} MB)</span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="file" accept={ACCEPT[f.kind]} disabled={busy} onChange={e => upload(e.target.files?.[0])} />
            {busy && <span className="sub">Đang tải lên…</span>}
            {f.file_name && <button type="button" onClick={() => set({ file_path: null, file_name: null })}>Bỏ tệp</button>}</span></label>
        : mode === 'manual' && f.kind === 'plan' ? <StepsEditor steps={steps} onChange={setSteps} />
        : mode === 'manual' ? <PartsEditor parts={parts} onChange={setParts} /> : null}
      <label className="field" style={{ gridColumn: '1 / -1' }}><span>{mat ? 'Ghi chú' : 'Mô tả'}</span><textarea rows={mat ? 2 : 4} value={f.detail} maxLength={4000} onChange={e => set({ detail: e.target.value })} /></label>
    </div>
    {msg && <p className="msg">{msg}</p>}
    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
      <button className="primary" disabled={busy} onClick={save}>Lưu</button>
      <button onClick={onCancel}>Huỷ</button>
    </div>
  </div>
}

// ----- Tách giáo án Word / bài giảng PowerPoint -----
const BASIS: Record<string, string> = { product: 'product', group: 'group', student: 'student' }
function materialRows(d: KitDraft, topicId: string, seq0: number) {
  return d.norms.rows.map((r, k) => ({ topic_id: topicId, kind: 'material', seq: seq0 + k, title: r.name.slice(0, 200), detail: '', qty: r.qty, unit: r.unit || null,
    per: BASIS[d.norms.basis ?? 'product'] ?? 'product', content: { reusable: r.reusable, type: r.kind } }))
}
const linkKind = (l: { title: string; type: string }): Kind => (/kiểm tra|kiem tra|quiz|test/i.test(l.title) ? 'test'
  : /bài giảng|bai giang|slide/i.test(l.title) ? 'lecture' : l.type === 'worksheet' || /phiếu/i.test(l.title) ? 'worksheet' : 'resource')
type Part = 'plan' | 'lecture' | 'material' | 'links' | 'objectives'

function TopicImport({ topic, items, onClose, onDone }: { topic: ProgramTopic; items: TopicItem[]; onClose: () => void; onDone: (k: Kind) => void }) {
  const [draft, setDraft] = useState<{ d: KitDraft; file: File } | null>(null)
  const [parts, setParts] = useState<Part[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function read(file: File) {
    setErr(''); setBusy(true)
    try {
      const d = await readKitFile(file)
      const p: Part[] = []
      if (d.source === 'docx' && d.plan) p.push('plan')
      if (d.source === 'pptx') p.push('lecture')
      if (d.norms.rows.length) p.push('material')
      if (d.links.length) p.push('links')
      if (d.info.objectives && !topic.objectives?.trim()) p.push('objectives')
      if (!p.length) setErr(['Không đọc được nội dung nào từ file này.', ...d.warnings].join(' '))
      else { setDraft({ d, file }); setParts(p) }
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const big = (draft?.file.size ?? 0) > MAX_FILE_MB * 1024 * 1024
  async function apply() {
    if (!draft) return
    const { d, file } = draft
    setBusy(true); setErr('')
    try {
      let up: { path: string; name: string } | null = null
      if ((parts.includes('plan') || parts.includes('lecture')) && !big) up = await uploadTopicFile(file)
      const seq = (k: Kind) => items.filter(i => i.kind === k).reduce((s, i) => Math.max(s, i.seq), 0) + 1
      const name = d.info.title || topic.title
      const rows: Record<string, unknown>[] = []
      if (parts.includes('plan')) rows.push({ topic_id: topic.id, kind: 'plan', seq: seq('plan'), title: `Giáo án ${name}`.slice(0, 200), detail: d.info.summary ?? '',
        file_path: up?.path ?? null, file_name: up?.name ?? null, content: { steps: d.plan?.steps ?? [], sections: d.plan?.sections ?? {} } })
      if (parts.includes('lecture')) rows.push({ topic_id: topic.id, kind: 'lecture', seq: seq('lecture'), title: `Bài giảng ${name}`.slice(0, 200), detail: '',
        file_path: up?.path ?? null, file_name: up?.name ?? null, content: { slides: (d.slides ?? []).map(s => s.title || '(không tiêu đề)') } })
      if (parts.includes('links')) {
        const n: Partial<Record<Kind, number>> = {}
        for (const l of d.links) { const k = linkKind(l); n[k] = (n[k] ?? seq(k)); rows.push({ topic_id: topic.id, kind: k, seq: n[k]!++, title: l.title.slice(0, 200), detail: '', url: l.url }) }
      }
      if (parts.includes('material')) rows.push(...materialRows(d, topic.id, seq('material')))
      if (rows.length) { const r = await supabase.from('program_topic_items').insert(rows); if (r.error) throw new Error(errText(r.error.message)) }
      if (parts.includes('objectives') && d.info.objectives) {
        const r = await supabase.from('program_topics').update({ objectives: d.info.objectives }).eq('id', topic.id); if (r.error) throw new Error(errText(r.error.message))
      }
      onDone(parts.includes('plan') ? 'plan' : parts.includes('lecture') ? 'lecture' : parts.includes('material') ? 'material' : 'worksheet')
    } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const tick = (p: Part, label: React.ReactNode, body?: React.ReactNode) => <div className="panel" style={{ marginBottom: 10 }}>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text)' }}>
      <input type="checkbox" checked={parts.includes(p)} onChange={e => setParts(e.target.checked ? [...parts, p] : parts.filter(x => x !== p))} />{label}</label>
    {parts.includes(p) && body}
  </div>

  if (!draft) return <div className="panel">
    <b>Tách từ giáo án Word / bài giảng PowerPoint</b>
    <p className="sub">Giáo án .docx được tách thành kế hoạch giảng dạy (các hoạt động dạy học), vật tư, link phiếu học tập / học liệu và yêu cầu cần đạt.
      Bài giảng .pptx thành bài giảng (danh sách slide). Tệp gốc tối đa {MAX_FILE_MB} MB được đính kèm để xem ngay trên trang. Anh/chị xem trước rồi mới thêm.</p>
    <label className={'filebtn primary' + (busy ? ' busy' : '')}>{busy ? 'Đang đọc file…' : 'Chọn file .docx / .pptx'}
      <input type="file" hidden accept=".docx,.pptx" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = '' }} /></label>
    {' '}<button onClick={onClose}>Huỷ</button>
    {err && <p className="msg">{err}</p>}
  </div>

  const { d, file } = draft
  const byKind = d.links.map(l => ({ ...l, k: linkKind(l) }))
  return <div>
    <div className="panel" style={{ marginBottom: 10 }}><b>Xem trước: {file.name}</b>
      <div className="sub">Chọn phần muốn thêm vào chủ đề. Mục đã có giữ nguyên, phần tách được thêm vào sau.</div></div>
    {d.source === 'docx' && d.plan && tick('plan', <><b>Kế hoạch giảng dạy</b><span className="sub">· 1 giáo án, {d.plan.steps.length} hoạt động</span></>,
      d.plan.steps.length > 0 && <Steps steps={d.plan.steps} />)}
    {d.source === 'pptx' && tick('lecture', <><b>Bài giảng</b><span className="sub">· {d.slides?.length ?? 0} slide</span></>,
      <ol className="sub" style={{ paddingLeft: 20, maxHeight: 200, overflow: 'auto' }}>{(d.slides ?? []).map((s, k) => <li key={k}>{s.title || '(không tiêu đề)'}</li>)}</ol>)}
    {d.norms.rows.length > 0 && tick('material', <><b>Vật tư</b><span className="sub">· {d.norms.rows.length} loại, tính theo {PER[d.norms.basis ?? 'product'] ?? '1 sản phẩm'}</span></>,
      <table className="slt ttdense" style={{ width: '100%', marginTop: 8 }}><thead><tr><th>Vật tư</th><th>Số lượng</th></tr></thead>
        <tbody>{d.norms.rows.map((r, k) => <tr key={k}><td>{r.name}{r.reusable && <span className="sub"> · dùng lại</span>}</td><td>{r.qty} {r.unit}</td></tr>)}</tbody></table>)}
    {d.links.length > 0 && tick('links', <><b>Link học liệu</b><span className="sub">· {d.links.length} link</span></>,
      <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>{byKind.map((l, k) => <li key={k}>{l.title} <span className="sub">→ {kindLabel(l.k)} · {l.url.replace(/^https?:\/\//, '').slice(0, 50)}…</span></li>)}</ul>)}
    {d.info.objectives && !topic.objectives?.trim() && tick('objectives', <><b>Yêu cầu cần đạt của chủ đề</b><span className="sub">· đang trống</span></>,
      <p className="sub" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{d.info.objectives}</p>)}
    {big && (parts.includes('plan') || parts.includes('lecture')) && <p className="warnline">Tệp {(file.size / 1048576).toFixed(0)} MB, lớn hơn {MAX_FILE_MB} MB nên không đính kèm được. Phần tách vẫn thêm bình thường; hãy đưa tệp lên Google Drive rồi dán link vào mục sau.</p>}
    {d.warnings.map((w, k) => <p key={k} className="warnline">{w}</p>)}
    {err && <p className="msg">{err}</p>}
    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
      <button className="primary" disabled={busy || !parts.length} onClick={apply}>{busy ? 'Đang thêm…' : 'Thêm vào chủ đề'}</button>
      <button disabled={busy} onClick={() => { setDraft(null); setErr('') }}>Chọn file khác</button>
      <button disabled={busy} onClick={onClose}>Huỷ</button>
    </div>
  </div>
}

// ----- Nhập trực tiếp -----
function StepsEditor({ steps, onChange }: { steps: KitStep[]; onChange: (v: KitStep[]) => void }) {
  const up = (k: number, p: Partial<KitStep>) => onChange(steps.map((x, i) => i === k ? { ...x, ...p } : x))
  const total = steps.reduce((a, x) => a + (Number(x.minutes) || 0), 0)
  return <div className="field" style={{ gridColumn: '1 / -1' }}><span>Các hoạt động</span>
    <div className="wrap"><table className="slt ttdense mfedit" style={{ width: '100%' }}>
      <thead><tr><th style={{ width: 36 }}>#</th><th style={{ width: '18%' }}>Giai đoạn</th><th>Hoạt động *</th><th style={{ width: '28%' }}>Mục tiêu</th><th style={{ width: 80 }}>Phút</th><th style={{ width: 36 }} /></tr></thead>
      <tbody>{steps.map((x, k) => <tr key={k}><td className="sub">{k + 1}</td>
        <td><input value={x.phase ?? ''} maxLength={80} onChange={e => up(k, { phase: e.target.value })} placeholder="Khởi động…" /></td>
        <td><input value={x.title} maxLength={300} onChange={e => up(k, { title: e.target.value })} placeholder="Học sinh làm gì" /></td>
        <td><input value={x.goal ?? ''} maxLength={300} onChange={e => up(k, { goal: e.target.value })} /></td>
        <td><input type="number" min={0} value={x.minutes ?? ''} onChange={e => up(k, { minutes: e.target.value === '' ? undefined : Number(e.target.value) })} /></td>
        <td><button type="button" className="linkbtn" aria-label="Xoá hoạt động" onClick={() => onChange(steps.filter((_, i) => i !== k))}>×</button></td></tr>)}</tbody>
    </table></div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <button type="button" className="linkbtn" onClick={() => onChange([...steps, { phase: '', title: '', goal: '' }])}>+ Thêm hoạt động</button>
      {total > 0 && <small className="sub">Tổng {total} phút</small>}</div>
  </div>
}
function PartsEditor({ parts, onChange }: { parts: TextPart[]; onChange: (v: TextPart[]) => void }) {
  const up = (k: number, p: Partial<TextPart>) => onChange(parts.map((x, i) => i === k ? { ...x, ...p } : x))
  return <div className="field" style={{ gridColumn: '1 / -1' }}><span>Nội dung (từng phần có tiêu đề)</span>
    <div style={{ display: 'grid', gap: 10 }}>{parts.map((x, k) => <div key={k} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10, display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8 }}><input style={{ flex: 1 }} value={x.title} maxLength={200} onChange={e => up(k, { title: e.target.value })} placeholder={`Phần ${k + 1}: tiêu đề`} />
        <button type="button" className="linkbtn" aria-label="Xoá phần" onClick={() => onChange(parts.filter((_, i) => i !== k))}>×</button></div>
      <textarea rows={4} value={x.body} maxLength={8000} onChange={e => up(k, { body: e.target.value })} placeholder="Nội dung" /></div>)}</div>
    <div><button type="button" className="linkbtn" onClick={() => onChange([...parts, { title: '', body: '' }])}>+ Thêm phần</button></div>
  </div>
}
