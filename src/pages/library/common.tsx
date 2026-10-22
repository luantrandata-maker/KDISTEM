import { Icon } from '../../components/Icon'
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { openFile, fmtSize } from '../../lib/files'
import { SlideView, KIND as SLIDE_KIND, type Slide, type SlideKind } from '../teacher/Lessons'
import { PROGRAM_COLOR } from '../teacher/common'
import { PlanView, planOf } from './PlanEditor'
import { Drawer } from '../../components/Drawer'
import { LessonOutline, LessonPlayer, asLesson, lessonStats } from '../../lib/lessonBlocks'

export type Unit = { title: string; periods?: number; objectives?: string; lesson_ids?: string[] }
export type Item = {
  id: string; owner_org_id: string; kind: 'program' | 'unit' | 'lesson' | 'material'; title: string; summary: string | null
  subject: string | null; grades: string | null; program: string | null; tags: string[]
  content: {
    // Bài giảng (070): tương tác (lesson = các khối) hoặc slide
    mode?: 'interactive' | 'slides'; lesson?: unknown
    slides?: Slide[]; type?: string; url?: string; units?: Unit[]; path?: string; file_name?: string; size?: number; mime?: string
    // Bài học (065): mục tiêu, số tiết và các thành phần đã có trong kho
    objectives?: string | null; periods?: number | null; plan_ids?: string[]; lesson_ids?: string[]; norm_ids?: string[]; material_ids?: string[]
  }
  scope: 'children' | 'selected' | 'public'; status: 'draft' | 'published' | 'archived'; version: number
  published_at: string | null; change_note: string | null; updated_at: string
  owner_name?: string | null; owner_type?: string | null
  program_id?: string | null; unit_id?: string | null; usage_rights?: Rights; usage_note?: string | null
  edu_programs?: { title: string; version_no: number } | null; edu_program_units?: { title: string } | null
}
// Truy vấn học liệu kèm chương trình / bài; CSDL chưa có 059 thì quay về truy vấn cũ
export async function selectItems(order: 'updated_at' | 'published_at'): Promise<{ data: Item[] | null; error: { message: string } | null }> {
  const q = async (cols: string) => {
    const r = await supabase.from('library_items').select(cols).order(order, { ascending: false, nullsFirst: false })
    return { data: r.data as unknown as Item[] | null, error: r.error }
  }
  const r = await q('*, owner_name, owner_type, edu_programs(title, version_no), edu_program_units(title)')
  return r.error && /relationship|schema cache|column/i.test(r.error.message) ? q('*, owner_name, owner_type') : r
}
export function ProgLine({ i }: { i: Item }) {
  if (!i.edu_programs) return null
  return <small className="sub">Chương trình: {i.edu_programs.title} (v{i.edu_programs.version_no}){i.edu_program_units ? ` › ${i.edu_program_units.title}` : ''}</small>
}
export type Rights = 'view' | 'use' | 'adapt'
export type Version = { id: string; item_id: string; version: number; title: string; change_note: string | null; published_at: string; content: Item['content'] }
export type ProgOpt = { id: string; title: string; version_no: number; status: string; org_id: string }
export type UnitOpt = { id: string; program_id: string; parent_id: string | null; unit_type: 'topic' | 'lesson' | 'session'; seq: number; title: string }
export type Copy = { item_id: string; adopted_version: number; lesson_plan_id: string | null; created_at: string; adopted_by: string | null }

export const KIND: Record<Item['kind'], [string, string]> = {
  unit: ['Bài học', '◫'], lesson: ['Bài giảng', '▶'], material: ['Học liệu', '◆'], program: ['Chương trình', '▤'],
}
/** Loại tạo mới ở trang Phát hành học liệu; chương trình soạn ở "Chương trình giáo dục" (mục chương trình cũ vẫn xem / sửa được) */
export const NEW_KINDS: Item['kind'][] = ['unit', 'lesson', 'material']
/** Định mức vật tư gắn vào bài học (059) */
export type NormOpt = { id: string; title: string; version_no: number; status: string; org_id: string; owner_name?: string | null }
export function useNormOptions(orgId: string | null) {
  const [norms, setNorms] = useState<NormOpt[]>([])
  useEffect(() => {
    supabase.from('material_norms').select('id, title, version_no, status, org_id, owner_name').order('title').order('version_no', { ascending: false })
      .then(({ data }) => setNorms(((data ?? []) as NormOpt[]).filter(n => n.status === 'published' || n.org_id === orgId)))
  }, [orgId])
  return norms
}
export const MAT_TYPE: Record<string, string> = {
  lesson_plan: 'Giáo án', worksheet: 'Phiếu học tập', image: 'Hình ảnh', video: 'Video', guide: 'Tài liệu hướng dẫn', document: 'Tài liệu', link: 'Đường dẫn',
}
export const RIGHTS: Record<Rights, [string, string]> = {
  view: ['Chỉ xem', 'warn'], use: ['Được dùng nguyên bản', ''], adapt: ['Được sao chép, chỉnh sửa', 'good'],
}
export function RightsChip({ r }: { r?: Rights | null }) {
  if (!r) return null
  const [label, tone] = RIGHTS[r]
  return <span className={'gpill ' + tone} title="Quyền sử dụng">{label}</span>
}
// Chương trình giáo dục (058) mà đơn vị thấy + các học phần / bài của chúng, để gắn học liệu, định mức
export function useProgramOptions(orgId: string | null) {
  const [programs, setPrograms] = useState<ProgOpt[]>([])
  const [units, setUnits] = useState<UnitOpt[]>([])
  useEffect(() => {
    supabase.from('edu_programs').select('id, title, version_no, status, org_id').in('status', ['published', 'draft', 'superseded']).order('title')
      .then(({ data }) => setPrograms(((data as ProgOpt[]) ?? []).filter(p => p.status === 'published' || (p.status === 'draft' && p.org_id === orgId))))
    supabase.from('edu_program_units').select('id, program_id, parent_id, unit_type, seq, title').in('unit_type', ['topic', 'lesson']).order('seq')
      .then(({ data }) => setUnits((data as UnitOpt[]) ?? []))
  }, [orgId])
  return { programs, units }
}
// Chủ đề → bài của một chương trình theo thứ tự cây, kèm thụt lề.
// only: 'topic' = chỉ học phần (gắn bài học), 'lesson' = chỉ bài, ghi kèm học phần (gắn giáo án, bài giảng, học liệu, định mức).
// keep: giá trị đang chọn vẫn hiện dù không thuộc loại được lọc.
export function unitTree(units: UnitOpt[], programId: string | null | undefined, only?: 'topic' | 'lesson', keep?: string | null): { id: string; label: string }[] {
  if (!programId) return []
  const mine = units.filter(u => u.program_id === programId)
  const out: { id: string; label: string }[] = []
  const walk = (parent: string | null, depth: number, path: string[]) => mine.filter(u => u.parent_id === parent).sort((a, b) => a.seq - b.seq).forEach(u => {
    if (!only) out.push({ id: u.id, label: '\u00a0'.repeat(depth * 4) + (u.unit_type === 'topic' ? '' : '· ') + u.title })
    else if (u.unit_type === only || u.id === keep) out.push({ id: u.id, label: only === 'lesson' && path.length ? `${path.join(' › ')} › ${u.title}` : u.title })
    walk(u.id, depth + 1, u.unit_type === 'topic' ? [...path, u.title] : path)
  })
  walk(null, 0, [])
  return out
}
export const progLabel = (p?: ProgOpt | null) => (p ? `${p.title} (v${p.version_no})` : '')
export const SCOPE: Record<Item['scope'], string> = {
  children: 'Mọi đơn vị trực thuộc', selected: 'Đơn vị được chọn', public: 'Công khai toàn hệ thống',
}
export const STATUS: Record<Item['status'], [string, string, string]> = {
  draft: ['✎', 'Nháp', ''], published: ['✓', 'Đã phát hành', 'good'], archived: ['−', 'Đã thu hồi', 'warn'],
}
export const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : '—'
export const uid = () => Math.random().toString(36).slice(2, 9)

export function KindChip({ kind }: { kind: Item['kind'] }) {
  const [label, icon] = KIND[kind]
  return <span className={'libkind k-' + kind}><i aria-hidden="true">{icon}</i>{label}</span>
}
export function ProgChip({ p }: { p: string | null }) {
  return p ? <span className="progchip" style={{ background: PROGRAM_COLOR[p] }}>{p}</span> : null
}
export function StatusChip({ s }: { s: Item['status'] }) {
  const [icon, label, tone] = STATUS[s]
  return <span className={'gpill ' + tone}><i aria-hidden="true">{icon}</i>{label}</span>
}

// Xem trước nội dung một mục kho
export function ItemPreview({ item, all, canRestore, onRestored, onOpen }: { item: Item; all: Item[]; canRestore?: boolean; onRestored?: () => void; onOpen?: (e: DrawerEntry) => void }) {
  const [i, setI] = useState(0)
  const [play, setPlay] = useState(false)
  const il = item.kind === 'lesson' && item.content.mode === 'interactive' ? asLesson(item.content.lesson) : null
  if (il) {
    const st = lessonStats(il)
    return (
      <div className="libpreview">
        <p><b>Bài giảng tương tác</b> · {st.blocks} khối nội dung · {st.interactive} khối tương tác · khoảng {st.minutes} phút{' '}
          {st.blocks > 0 && <button type="button" className="linkbtn" onClick={() => setPlay(true)}><Icon n="eye" /> Xem như học sinh</button>}</p>
        <LessonOutline lesson={il} ct={item.program} />
        {play && <LessonPlayer title={item.title} ct={item.program} lesson={il} onClose={() => setPlay(false)} />}
        <Versions item={item} canRestore={canRestore} onRestored={onRestored} />
      </div>
    )
  }
  if (item.kind === 'lesson') {
    const slides = item.content.slides ?? []
    return (
      <div className="libpreview">
        {(item.content.path || item.content.url) && <p><b>Tệp bài giảng:</b> {item.content.path
          ? <button type="button" className="linkbtn" onClick={() => openFile(item.content.path!)}>{item.content.file_name ?? 'Mở tệp'}{item.content.size ? ` (${fmtSize(item.content.size)})` : ''} ↗</button>
          : <a href={item.content.url} target="_blank" rel="noreferrer">{item.content.url}</a>}</p>}
        {slides.length > 0 && <SlideView slide={slides[i]} reveal />}
        {slides.length > 1 && (
          <div className="bar small">
            <button type="button" disabled={i === 0} onClick={() => setI(i - 1)}>← Trước</button>
            <small>Slide {i + 1}/{slides.length}</small>
            <button type="button" disabled={i >= slides.length - 1} onClick={() => setI(i + 1)}>Sau →</button>
          </div>
        )}
        <Versions item={item} canRestore={canRestore} onRestored={onRestored} />
      </div>
    )
  }
  if (item.kind === 'material') {
    const plan = item.content.type === 'lesson_plan' ? planOf(item.content as any) : null
    const hasFile = !!(item.content.path || item.content.url)
    return (
      <div className="libpreview">
        {plan && <PlanView plan={plan} />}
        {(!plan || hasFile) && <p><b>{plan ? 'Tệp đính kèm' : MAT_TYPE[item.content.type ?? 'link'] ?? 'Đường dẫn'}:</b> {item.content.path
          ? <button type="button" className="linkbtn" onClick={() => openFile(item.content.path!)}>{item.content.file_name ?? 'Mở tệp'}{item.content.size ? ` (${fmtSize(item.content.size)})` : ''} ↗</button>
          : item.content.url ? <a href={item.content.url} target="_blank" rel="noreferrer">{item.content.url}</a> : <i>chưa có tệp hoặc đường dẫn</i>}</p>}
        {item.usage_rights && <p><b>Quyền sử dụng:</b> <RightsChip r={item.usage_rights} />{item.usage_note ? <small className="sub"> {item.usage_note}</small> : null}</p>}
        <Versions item={item} canRestore={canRestore} onRestored={onRestored} />
      </div>
    )
  }
  if (item.kind === 'unit') return <UnitPreview item={item} all={all} canRestore={canRestore} onRestored={onRestored} onOpen={onOpen} />
  const units = item.content.units ?? []
  return (
    <ol className="libunits">
      {units.map((u, k) => (
        <li key={k}>
          <b>{u.title}</b>{u.periods ? <small> · {u.periods} tiết</small> : null}
          {u.objectives && <p className="sub">{u.objectives}</p>}
          {(u.lesson_ids ?? []).length > 0 && <p className="sub">Bài giảng: {(u.lesson_ids ?? []).map(id => all.find(x => x.id === id)?.title ?? 'bài giảng không còn trong kho').join(' · ')}</p>}
        </li>
      ))}
      {units.length === 0 && <li className="sub">Chưa có chủ đề nào.</li>}
    </ol>
  )
}

type NormView = { id: string; title: string; version_no: number; status?: string; basis?: string; group_size?: number
  material_norm_items?: { id: string; name: string; unit: string | null; qty: number; kind?: string; reusable?: boolean; seq?: number }[] }
const NORM_COLS = 'id, title, version_no, status, basis, group_size, material_norm_items(id, name, unit, qty, kind, reusable, seq)'
function UnitPreview({ item, all, canRestore, onRestored, onOpen }: { item: Item; all: Item[]; canRestore?: boolean; onRestored?: () => void; onOpen?: (e: DrawerEntry) => void }) {
  const c = item.content
  const [norms, setNorms] = useState<NormView[]>([])
  const ids = (c.norm_ids ?? []).join(',')
  useEffect(() => {
    if (!ids) return setNorms([])
    supabase.from('material_norms').select(NORM_COLS).in('id', ids.split(','))
      .then(({ data }) => setNorms((data ?? []) as NormView[]))
  }, [ids])
  // Mỗi thành phần là một dòng bấm được để mở chi tiết của nó
  const group = (label: string, list: string[] | undefined) => (
    <div><b>{label}</b>{(list ?? []).length === 0 ? <small className="sub"> — chưa gắn</small> : (
      <ul className="childlist">{(list ?? []).map(id => {
        const x = all.find(v => v.id === id)
        if (!x) return <li key={id} className="gone">Mục không còn trong kho hoặc chưa được phát hành tới đơn vị</li>
        const sub = [x.kind === 'material' ? MAT_TYPE[x.content.type ?? 'link'] : x.kind === 'lesson' ? (x.content.mode === 'interactive' ? `tương tác · ${lessonStats(asLesson(x.content.lesson)).blocks} khối` : `${(x.content.slides ?? []).length} slide`) : '', x.status === 'draft' ? 'nháp' : `v${x.version}`].filter(Boolean).join(' · ')
        return <li key={id}>{onOpen ? <button type="button" onClick={() => onOpen({ type: 'item', id })}><span>{x.title}</span><small>{sub} ›</small></button> : <span>{x.title}</span>}</li>
      })}</ul>)}</div>)
  return (
    <div className="libpreview">
      {(c.objectives || c.periods) && <p>{c.periods ? <b>{c.periods} tiết. </b> : null}{c.objectives}</p>}
      {group('Giáo án', c.plan_ids)}
      {group('Bài giảng', c.lesson_ids)}
      <div><b>Định mức vật tư</b>{(c.norm_ids ?? []).length === 0 ? <small className="sub"> — chưa gắn</small> : (
        <ul className="childlist">{norms.map(n => <li key={n.id}>{onOpen
          ? <button type="button" onClick={() => onOpen({ type: 'norm', id: n.id })}><span>{n.title}</span><small>{(n.material_norm_items ?? []).length} vật tư · v{n.version_no} ›</small></button>
          : <span>{n.title} <small className="sub">v{n.version_no}</small></span>}</li>)}</ul>)}</div>
      {group('Học liệu khác', c.material_ids)}
      <Versions item={item} canRestore={canRestore} onRestored={onRestored} />
    </div>
  )
}

/** Chi tiết một định mức vật tư (mở từ bài học) */
function NormDetail({ id }: { id: string }) {
  const [n, setN] = useState<NormView | null | undefined>(undefined)
  useEffect(() => { supabase.from('material_norms').select(NORM_COLS).eq('id', id).maybeSingle().then(({ data }) => setN(data as NormView | null)) }, [id])
  if (n === undefined) return <p className="sub">Đang tải…</p>
  if (!n) return <p className="sub">Không xem được định mức này.</p>
  const basis = n.basis === 'student' ? '1 học sinh' : n.basis === 'product' ? '1 sản phẩm' : `1 nhóm${n.group_size ? ` (${n.group_size} HS)` : ''}`
  const KINDS: Record<string, string> = { supply: 'Vật tư tiêu hao', tool: 'Công cụ', equipment: 'Thiết bị' }
  return (
    <div>
      <p className="sub">Phiên bản {n.version_no}{n.status === 'draft' ? ' · nháp' : n.status === 'published' ? ' · đang ban hành' : ''} · tính cho {basis}</p>
      <div className="wrap"><table>
        <thead><tr><th>Vật tư</th><th>Loại</th><th>Số lượng</th><th>Dùng lại</th></tr></thead>
        <tbody>{[...(n.material_norm_items ?? [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)).map(x => (
          <tr key={x.id}><td>{x.name}</td><td>{KINDS[x.kind ?? ''] ?? ''}</td><td>{x.qty} {x.unit ?? ''}</td><td>{x.reusable ? '✓' : ''}</td></tr>))}
          {(n.material_norm_items ?? []).length === 0 && <tr><td colSpan={4} className="sub">Chưa có vật tư.</td></tr>}</tbody>
      </table></div>
    </div>
  )
}

export type DrawerEntry = { type: 'item' | 'norm'; id: string }
/** Bảng chi tiết bên phải: thông tin mục + các thành phần con bấm vào để xem tiếp (có nút quay lại). */
export function ItemDrawer({ root, all, onClose, actions, canRestore, onRestored }: {
  root: DrawerEntry; all: Item[]; onClose: () => void; actions?: (i: Item) => React.ReactNode; canRestore?: boolean; onRestored?: () => void
}) {
  const [stack, setStack] = useState<DrawerEntry[]>([root])
  useEffect(() => setStack([root]), [root.type, root.id])
  const cur = stack[stack.length - 1]
  const item = cur.type === 'item' ? all.find(x => x.id === cur.id) : undefined
  const label = (e: DrawerEntry) => e.type === 'norm' ? 'Định mức vật tư' : all.find(x => x.id === e.id)?.title ?? '…'
  const open = (e: DrawerEntry) => setStack(s => [...s, e])
  const title = cur.type === 'norm' ? 'Định mức vật tư' : item?.title ?? 'Không tìm thấy mục'
  return (
    <Drawer title={title} onClose={onClose} actions={item && actions ? actions(item) : undefined} onBack={stack.length > 1 ? () => setStack(s => s.slice(0, -1)) : undefined}
      head={stack.length > 1 && <nav className="drawercrumbs">{stack.slice(0, -1).map((e, k) => (
        <span key={k}><button type="button" onClick={() => setStack(s => s.slice(0, k + 1))}>{label(e)}</button> ›</span>))}<span>{cur.type === 'norm' ? 'Định mức vật tư' : item?.title}</span></nav>}>
      {cur.type === 'norm' ? <NormDetail id={cur.id} /> : !item ? <p className="sub">Mục không còn trong kho hoặc chưa được phát hành tới đơn vị.</p> : <>
        <div className="drawermeta"><KindChip kind={item.kind} /><ProgChip p={item.program} />
          {item.kind === 'material' && <small className="sub">{MAT_TYPE[item.content.type ?? 'link']}</small>}
          {item.usage_rights && item.usage_rights !== 'adapt' && <RightsChip r={item.usage_rights} />}</div>
        <p className="sub" style={{ margin: '0 0 4px' }}>{[item.owner_name, item.version > 0 ? `v${item.version}` : 'nháp', item.grades && `Khối ${item.grades}`, item.subject, `cập nhật ${fmtDate(item.updated_at)}`].filter(Boolean).join(' · ')}</p>
        {item.edu_programs && <p style={{ margin: '2px 0' }}><ProgLine i={item} /></p>}
        {item.summary && item.summary.trim() !== item.title.trim() && <p>{item.summary}</p>}
        <ItemPreview key={item.id} item={item} all={all} canRestore={canRestore} onRestored={onRestored} onOpen={open} />
      </>}
    </Drawer>
  )
}

// Lịch sử phiên bản phát hành (059); chủ học liệu khôi phục được bản cũ vào bản đang soạn
export function Versions({ item, canRestore, onRestored }: { item: Item; canRestore?: boolean; onRestored?: () => void }) {
  const [rows, setRows] = useState<Version[] | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    supabase.from('library_item_versions').select('id, item_id, version, title, change_note, published_at, content').eq('item_id', item.id)
      .order('version', { ascending: false }).then(({ data }) => setRows((data as Version[]) ?? []))
  }, [item.id, item.version])
  if (!rows || rows.length === 0) return null
  async function restore(v: Version) {
    if (!confirm(`Khôi phục nội dung phiên bản ${v.version} vào bản đang soạn? Cần phát hành lại để thành phiên bản mới.`)) return
    const { error } = await supabase.rpc('library_restore_version', { p_item: item.id, p_version: v.version })
    if (error) return setMsg(error.message)
    setMsg(`Đã khôi phục phiên bản ${v.version} thành bản nháp.`); onRestored?.()
  }
  return (
    <div className="libversions">
      <b>Phiên bản</b>
      <table><tbody>{rows.map(v => (
        <tr key={v.id}><td>v{v.version}{v.version === item.version ? <small className="sub"> (hiện tại)</small> : null}</td><td>{fmtDate(v.published_at)}</td>
          <td><small>{v.change_note ?? ''}</small></td>
          <td>{v.content?.path && <button type="button" className="linkbtn" onClick={() => openFile(v.content.path!)}>Mở tệp</button>}
            {canRestore && v.version !== item.version && <button type="button" onClick={() => restore(v)}>Khôi phục</button>}</td></tr>
      ))}</tbody></table>
      {msg && <p className="sub">{msg}</p>}
    </div>
  )
}

// Soạn slide gọn cho bài giảng trong kho (cùng định dạng với trình soạn bài giảng của giáo viên)
export function SlidesEditor({ slides, onChange }: { slides: Slide[]; onChange: (s: Slide[]) => void }) {
  const [sel, setSel] = useState(0)
  const cur = slides[sel]
  const set = (p: Partial<Slide>) => onChange(slides.map((s, k) => k === sel ? { ...s, ...p } : s))
  const add = (kind: SlideKind) => {
    const s: Slide = { id: uid(), kind, title: '', body: '', ...(kind === 'question' ? { options: ['', ''], answer: 0 } : {}), ...(kind === 'task' ? { minutes: 10 } : {}), ...(kind === 'media' ? { url: '' } : {}) }
    onChange([...slides, s]); setSel(slides.length)
  }
  return (
    <div className="sleditor">
      <ol className="slthumbs">
        {slides.map((s, k) => (
          <li key={s.id}><button type="button" className={k === sel ? 'on' : ''} onClick={() => setSel(k)}>
            <small>{k + 1} · {SLIDE_KIND[s.kind]}</small><span>{s.title || 'Chưa có tiêu đề'}</span></button></li>
        ))}
        <li className="sladd">{(Object.keys(SLIDE_KIND) as SlideKind[]).map(k => <button type="button" key={k} onClick={() => add(k)}>+ {SLIDE_KIND[k]}</button>)}</li>
      </ol>
      {cur ? (
        <div className="slform">
          <label className="field"><span>Tiêu đề</span><input value={cur.title} onChange={e => set({ title: e.target.value })} /></label>
          {cur.kind !== 'media' && <label className="field"><span>Nội dung</span><textarea rows={4} value={cur.body ?? ''} onChange={e => set({ body: e.target.value })} /></label>}
          {cur.kind === 'media' && <label className="field"><span>Đường dẫn video / hình</span><input value={cur.url ?? ''} onChange={e => set({ url: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" /></label>}
          {cur.kind === 'task' && <label className="field"><span>Thời gian (phút)</span><input type="number" min={1} value={cur.minutes ?? 10} onChange={e => set({ minutes: Number(e.target.value) })} /></label>}
          {cur.kind === 'question' && (
            <div className="field"><span>Phương án (chọn đáp án đúng)</span>
              {(cur.options ?? []).map((o, k) => (
                <div className="optrow" key={k}>
                  <input type="radio" name={'ans' + cur.id} checked={cur.answer === k} onChange={() => set({ answer: k })} aria-label={`Đáp án ${String.fromCharCode(65 + k)} đúng`} />
                  <input value={o} onChange={e => set({ options: (cur.options ?? []).map((x, j) => j === k ? e.target.value : x) })} placeholder={`Phương án ${String.fromCharCode(65 + k)}`} />
                </div>
              ))}
              {(cur.options ?? []).length < 6 && <button type="button" className="linkbtn" onClick={() => set({ options: [...(cur.options ?? []), ''] })}>+ Thêm phương án</button>}
            </div>
          )}
          <div className="actions">
            <button type="button" disabled={sel === 0} onClick={() => { const s = [...slides]; [s[sel - 1], s[sel]] = [s[sel], s[sel - 1]]; onChange(s); setSel(sel - 1) }}>↑ Lên</button>
            <button type="button" disabled={sel >= slides.length - 1} onClick={() => { const s = [...slides]; [s[sel + 1], s[sel]] = [s[sel], s[sel + 1]]; onChange(s); setSel(sel + 1) }}>↓ Xuống</button>
            <button type="button" className="danger" onClick={() => { onChange(slides.filter((_, k) => k !== sel)); setSel(Math.max(0, sel - 1)) }}>Xoá slide</button>
          </div>
          <SlideView slide={cur} reveal />
        </div>
      ) : <p className="sub">Thêm slide đầu tiên ở cột bên trái.</p>}
    </div>
  )
}
