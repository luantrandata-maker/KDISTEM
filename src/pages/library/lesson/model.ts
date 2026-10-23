// Bộ học liệu 4 thẻ của bài học, theo video demo (23/10). Nội dung có cấu trúc nằm trong library_items.content.kit (080).
// Thuần dữ liệu: đổi bản nháp đọc từ file (giáo án Word, bài giảng PowerPoint, file mẫu Excel, CSV từng thẻ) thành nội dung 4 thẻ.
import { templateSheets, kitFromSheets, SHEETS, type KitDraft, type DocRole } from '../../../lib/kitImport'
import type { KitCard } from '../common'

export type Subj = { name: string; reqs: string[] }
export type Who = { dates: string[]; date: string; by: string }
export type KInfo = {
  /** Môn học trong chương trình (bài thuộc môn nào của chương trình) */
  prog_subject: string
  description: string
  main: Subj
  integrated: Subj[]
  /** Yêu cầu cần đạt */
  reqs: string[]
  authored: Who; reviewed: Who; revised: Who
}
export type KStep = { title: string; lines: string[] }
export type KAct = { title: string; minutes: number | null; general: string; steps: KStep[] }
export type KSession = { note: string; acts: KAct[] }
export type FileRef = { path: string; file_name: string; size: number; mime: string }
export type KDoc = { key: string; title: string; type: string; url: string; file: FileRef | null
  /** Tên, cỡ tệp gốc khi chưa đính kèm được (quá lớn) */
  file_name?: string; size?: number
  meta?: string; outline?: string[]; item_id: string | null }
export type MKind = 'supply' | 'tool' | 'equipment'
export type KMat = { key: string; catalog_id: string | null; name: string; unit: string; qty: string; kind: MKind; reusable: boolean }
export type KitData = {
  info: KInfo; sessions: KSession[]; docs: KDoc[]; mats: { product: KMat[]; group: KMat[] }
  issues: string[]; source: { docx?: string; pptx?: string; xlsx?: string }
}

export const key = () => Math.random().toString(36).slice(2, 10)
const who = (): Who => ({ dates: [], date: '', by: '' })
export const emptyInfo = (): KInfo => ({ prog_subject: '', description: '', main: { name: '', reqs: [] }, integrated: [], reqs: [], authored: who(), reviewed: who(), revised: who() })
export const emptyKit = (): KitData => ({ info: emptyInfo(), sessions: [], docs: [], mats: { product: [], group: [] }, issues: [], source: {} })

/** Đọc content.kit đã lưu (thiếu trường nào thì điền mặc định) */
export function kitOf(c: unknown): KitData {
  const k = (c && typeof c === 'object' ? c : {}) as Partial<KitData>
  const e = emptyKit()
  const i = { ...e.info, ...(k.info ?? {}) } as KInfo
  return {
    info: { ...i, main: { name: i.main?.name ?? '', reqs: i.main?.reqs ?? [] }, integrated: i.integrated ?? [], reqs: i.reqs ?? [],
      authored: { ...who(), ...i.authored }, reviewed: { ...who(), ...i.reviewed }, revised: { ...who(), ...i.revised } },
    sessions: (k.sessions ?? []).map(s => ({ note: s.note ?? '', acts: (s.acts ?? []).map(a => ({ title: a.title ?? '', minutes: a.minutes ?? null, general: a.general ?? '', steps: (a.steps ?? []).map(x => ({ title: x.title ?? '', lines: x.lines ?? [] })) })) })),
    docs: (k.docs ?? []).map(d => ({ ...d, key: d.key || key(), item_id: d.item_id ?? null, file: d.file ?? null })),
    mats: { product: (k.mats?.product ?? []).map(m => ({ ...m, key: m.key || key() })), group: (k.mats?.group ?? []).map(m => ({ ...m, key: m.key || key() })) },
    issues: k.issues ?? [], source: k.source ?? {},
  }
}

export const DOC_TYPE: Record<string, string> = {
  worksheet: 'Tài liệu / phiếu học tập', slides: 'Bài giảng mẫu', plan: 'Giáo án', video: 'Video', image: 'Hình ảnh', guide: 'Tài liệu hướng dẫn', document: 'Tài liệu', link: 'Đường dẫn',
}
export const CARDS: { k: KitCard; no: string; title: string; desc: string }[] = [
  { k: 'info', no: '01', title: 'Thông tin bài học', desc: 'Thông tin nhận diện bài học, trình bày theo cặp trường – giá trị.' },
  { k: 'content', no: '02', title: 'Nội dung bài học', desc: 'Các buổi, hoạt động dạy học và từng bước tiến hành.' },
  { k: 'links', no: '03', title: 'Link học liệu', desc: 'Tài liệu, phiếu học tập, giáo án và bài giảng kèm theo. Khi chốt, mỗi dòng tự tạo học liệu trong danh mục.' },
  { k: 'norms', no: '04', title: 'Định mức vật tư', desc: 'Nguyên vật liệu cho một sản phẩm, công cụ và thiết bị cho một nhóm. Khi chốt, vật tư mới tự thêm vào danh mục.' },
]

export const sessionMinutes = (s: KSession) => s.acts.reduce((n, a) => n + (a.minutes ?? 0), 0)
export const kitCounts = (k: KitData) => ({
  sessions: k.sessions.length,
  acts: k.sessions.reduce((n, s) => n + s.acts.length, 0),
  steps: k.sessions.reduce((n, s) => n + s.acts.reduce((m, a) => m + a.steps.length, 0), 0),
  reqs: k.info.reqs.length,
  supplies: k.mats.product.length,
  tools: k.mats.group.length,
  docs: k.docs.length,
})

// ---------- Từ bản nháp đọc file sang 4 thẻ ----------
const lines = (t: string | undefined) => (t ?? '').split('\n').map(x => x.replace(/^[\s\-–•*+▪●◦]+/, '').trim()).filter(Boolean)
/** Dòng là tên môn (ngắn, không kết thúc bằng dấu câu) hay là một yêu cầu */
const isSubjectLine = (t: string) => t.length <= 40 && !/[.:;!?]$/.test(t) && t.split(/\s+/).length <= 6

/** "Nội dung tích hợp trong bài học": Môn học chủ đạo / Môn học tích hợp, mỗi môn kèm các yêu cầu */
export function integratedFrom(text: string): { main: Subj; integrated: Subj[] } {
  const main: Subj = { name: '', reqs: [] }; const integrated: Subj[] = []
  let zone: 'main' | 'int' | null = null; let cur: Subj | null = null
  for (const l of lines(text)) {
    if (/^môn( học)? chủ đạo\b/i.test(l)) { zone = 'main'; cur = null; const r = l.replace(/^môn( học)? chủ đạo\s*[:\-–]?\s*/i, ''); if (r) { main.name = r; cur = main } continue }
    if (/^môn( học)? tích hợp\b/i.test(l)) { zone = 'int'; cur = null; const r = l.replace(/^môn( học)? tích hợp\s*[:\-–]?\s*/i, ''); if (r) { cur = { name: r, reqs: [] }; integrated.push(cur) } continue }
    if (!zone) continue
    if (zone === 'main') { if (!main.name && isSubjectLine(l)) { main.name = l; cur = main } else main.reqs.push(l); continue }
    if (!cur || (isSubjectLine(l) && cur.reqs.length)) { cur = { name: l, reqs: [] }; integrated.push(cur) } else cur.reqs.push(l)
  }
  return { main, integrated }
}
/** Ghi chú của hoạt động (từ giáo án Word): dòng "▸ 1.1. Khởi động" mở một bước; dòng trước bước đầu là nội dung chung */
function stepsFromNote(note: string | undefined): { general: string; steps: KStep[] } {
  const steps: KStep[] = []; const general: string[] = []
  for (const raw of (note ?? '').split('\n')) {
    const l = raw.trim(); if (!l) continue
    if (l.startsWith('▸')) { steps.push({ title: l.replace(/^▸\s*/, '').replace(/^\d+(\.\d+)*[.)]?\s*/, '').trim(), lines: [] }); continue }
    const t = l.replace(/^[\-–•*+▪●◦]\s*/, '')
    if (steps.length) steps[steps.length - 1].lines.push(t); else general.push(t)
  }
  return { general: general.join('\n'), steps }
}
const pickDate = (ds: string[]) => (ds.length === 1 ? ds[0] : '')

export type ParseResult = { kit: KitData; title?: string; subject?: string; grades?: string; periods?: number; objectives?: string; touched: KitCard[] }

/** Bản nháp đọc từ một file → nội dung 4 thẻ (chỉ phần file có) */
export function kitFromDraft(d: KitDraft, fileName: string): ParseResult {
  const k = emptyKit(); const touched = new Set<KitCard>()
  const s = d.plan?.sections ?? {}
  const integ = Object.entries(s).find(([t]) => /tích hợp/i.test(t))
  if (integ) { const r = integratedFrom(integ[1]); k.info.main = r.main; k.info.integrated = r.integrated; touched.add('info') }
  if (d.info.summary) { k.info.description = d.info.summary; touched.add('info') }
  if (d.info.objectives) { k.info.reqs = lines(d.info.objectives); touched.add('info') }
  if (d.info.title || d.info.subject || d.info.grades || d.info.periods) touched.add('info')
  for (const r of ['authored', 'reviewed', 'revised'] as DocRole[]) {
    const m = d.meta?.[r]; if (!m || (!m.dates.length && !m.by.length)) continue
    k.info[r] = { dates: m.dates, date: pickDate(m.dates), by: m.by.join(', ') }; touched.add('info')
  }
  // Thẻ 02: các hoạt động nhóm theo buổi
  if (d.plan?.steps.length) {
    const by = new Map<string, KAct[]>()
    for (const st of d.plan.steps) {
      const ph = st.phase && /\d/.test(st.phase) ? st.phase : 'Buổi 1'
      const fromNote = stepsFromNote(st.note)
      const extra: KStep[] = [
        st.goal ? { title: 'Mục tiêu', lines: lines(st.goal) } : null,
        st.teacher ? { title: 'Giáo viên', lines: lines(st.teacher) } : null,
        st.student ? { title: 'Học sinh', lines: lines(st.student) } : null,
        st.product ? { title: 'Sản phẩm', lines: lines(st.product) } : null,
      ].filter((x): x is KStep => !!x)
      const act: KAct = { title: st.title, minutes: st.minutes ?? null, general: fromNote.general, steps: [...extra, ...fromNote.steps] }
      by.set(ph, [...(by.get(ph) ?? []), act])
    }
    k.sessions = [...by.values()].map(acts => ({ note: '', acts }))
    touched.add('content')
  }
  // Thẻ 03: đường dẫn trong file
  for (const l of d.links) k.docs.push({ key: key(), title: l.title, type: l.type in DOC_TYPE ? l.type : 'link', url: l.url, file: null, item_id: null })
  if (d.links.length) touched.add('links')
  // Thẻ 04: vật tư tiêu hao → cho 1 sản phẩm; công cụ, thiết bị → cho 1 nhóm
  for (const r of d.norms.rows) {
    const m: KMat = { key: key(), catalog_id: null, name: r.name, unit: r.unit, qty: String(r.qty), kind: r.kind, reusable: r.reusable }
    ;(r.kind === 'supply' ? k.mats.product : k.mats.group).push(m)
  }
  if (d.norms.rows.length) touched.add('norms')
  if (d.source === 'docx') k.source.docx = fileName
  if (d.source === 'pptx') k.source.pptx = fileName
  if (d.source === 'xlsx') k.source.xlsx = fileName
  // Định mức tách 2 bảng (sản phẩm / nhóm) nên không còn vướng "nhiều cách tính"
  k.issues = d.warnings.filter(w => !/tính vật tư theo nhiều cách/.test(w))
  return { kit: k, title: d.info.title, subject: d.info.subject, grades: d.info.grades, periods: d.info.periods, objectives: d.info.objectives, touched: [...touched] }
}

/** Gộp phần của các thẻ được chọn từ bản đọc file vào bộ đang có */
export function mergeKit(base: KitData, add: KitData, cards: KitCard[]): KitData {
  const k = { ...base, info: { ...base.info }, mats: { ...base.mats }, source: { ...base.source, ...add.source } }
  if (cards.includes('info')) {
    const a = add.info
    k.info = { ...k.info, description: a.description || k.info.description, main: a.main.name || a.main.reqs.length ? a.main : k.info.main,
      integrated: a.integrated.length ? a.integrated : k.info.integrated, reqs: a.reqs.length ? a.reqs : k.info.reqs,
      authored: a.authored.dates.length || a.authored.by ? a.authored : k.info.authored,
      reviewed: a.reviewed.dates.length || a.reviewed.by ? a.reviewed : k.info.reviewed,
      revised: a.revised.dates.length || a.revised.by ? a.revised : k.info.revised }
  }
  if (cards.includes('content') && add.sessions.length) k.sessions = add.sessions
  if (cards.includes('links')) {
    const have = new Set(k.docs.map(d => d.url || d.file?.path || d.title))
    k.docs = [...k.docs, ...add.docs.filter(d => !have.has(d.url || d.file?.path || d.title))]
  }
  if (cards.includes('norms')) {
    const upd = (cur: KMat[], inc: KMat[]) => { const out = [...cur]; for (const m of inc) { const i = out.findIndex(x => x.name.trim().toLowerCase() === m.name.trim().toLowerCase()); if (i >= 0) out[i] = { ...out[i], qty: m.qty, unit: m.unit || out[i].unit }; else out.push(m) } return out }
    k.mats = { product: upd(k.mats.product, add.mats.product), group: upd(k.mats.group, add.mats.group) }
  }
  k.issues = [...new Set([...base.issues, ...add.issues])]
  return k
}

// ---------- CSV từng thẻ ----------
const csvCell = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
/** Mẫu CSV của một thẻ (cùng cột với sheet tương ứng của file mẫu Excel) */
export function cardCsv(card: KitCard, title = '') {
  const i = ['info', 'content', 'links', 'norms'].indexOf(card)
  const sh = templateSheets(title)[i]
  return '﻿' + [sh.header, ...sh.rows].map(r => r.map(c => csvCell(String(c ?? ''))).join(',')).join('\r\n')
}
export function cardFromRows(card: KitCard, rows: string[][]): KitDraft {
  const i = ['info', 'content', 'links', 'norms'].indexOf(card)
  return kitFromSheets([{ name: SHEETS[i], rows }])
}
export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Kế hoạch bài dạy (mục kho "Giáo án") dựng lại từ thẻ 02, để giáo viên dùng ở Soạn bài giảng */
export function planFromKit(k: KitData, periods: number | null) {
  const steps = k.sessions.flatMap((s, si) => s.acts.map(a => ({
    id: key(), phase: `Buổi ${si + 1}`, title: a.title, minutes: a.minutes ?? undefined,
    note: [a.general, ...a.steps.map(x => [x.title, ...x.lines.map(l => '• ' + l)].join('\n'))].filter(Boolean).join('\n'),
  })))
  const doc: Record<string, string> = {}
  if (k.info.reqs.length) doc['Mục tiêu'] = k.info.reqs.join('\n')
  if (k.info.description) doc['Mô tả bài học'] = k.info.description
  return { template_id: null, doc, steps, periods }
}
