// Nhập nhanh bộ học liệu 4 thẻ của bài học (Phân hệ 2 · Học liệu, đợt 4b):
//  • File mẫu Excel 4 sheet (01 Thông tin · 02 Nội dung bài học · 03 Link học liệu · 04 Định mức vật tư)
//  • Tách tự động giáo án Word (.docx) và bài giảng PowerPoint (.pptx)
// Chạy hoàn toàn trên trình duyệt. Kết quả là bản nháp (KitDraft) để người soạn xem trước rồi mới áp dụng vào form.
import { unzipSync, strFromU8 } from 'fflate'
import { norm } from './sheet'

export type KitStep = { phase?: string; title: string; minutes?: number; goal?: string; teacher?: string; student?: string; product?: string; note?: string }
export type KitSlide = { title: string; body: string }
export type KitLink = { title: string; type: string; url: string }
export type KitNormRow = { name: string; unit: string; kind: 'supply' | 'tool' | 'equipment'; qty: number; reusable: boolean }
export type KitDraft = {
  source: 'xlsx' | 'docx' | 'pptx'
  info: { title?: string; subject?: string; grades?: string; periods?: number; objectives?: string; summary?: string }
  /** Thẻ 02: giáo án (từ Excel / Word) */
  plan: { sections: Record<string, string>; steps: KitStep[] } | null
  /** Thẻ 02: bài giảng slide (từ PowerPoint) */
  slides: KitSlide[] | null
  links: KitLink[]
  norms: { basis?: 'group' | 'student' | 'product'; group_size?: number; rows: KitNormRow[] }
  warnings: string[]
}
const emptyDraft = (source: KitDraft['source']): KitDraft => ({ source, info: {}, plan: null, slides: null, links: [], norms: { rows: [] }, warnings: [] })

/** Các thẻ mà bản nháp sẽ điền (để chuyển về "Cần kiểm tra" khi áp dụng) */
export function kitTouched(d: KitDraft): ('info' | 'content' | 'links' | 'norms')[] {
  const i = d.info
  return [
    (i.title || i.subject || i.grades || i.periods || i.objectives || i.summary) ? 'info' as const : null,
    (d.plan && (d.plan.steps.length || Object.keys(d.plan.sections).length)) || d.slides?.length ? 'content' as const : null,
    d.links.length ? 'links' as const : null,
    d.norms.rows.length ? 'norms' as const : null,
  ].filter((x): x is 'info' | 'content' | 'links' | 'norms' => !!x)
}

// ---------- Từ điển chung ----------
export const MAT_LABEL: Record<string, string> = {
  worksheet: 'Phiếu học tập', image: 'Hình ảnh', video: 'Video', guide: 'Tài liệu hướng dẫn', document: 'Tài liệu', link: 'Đường dẫn',
}
const KIND_LABEL: Record<KitNormRow['kind'], string> = { supply: 'Vật tư tiêu hao', tool: 'Công cụ', equipment: 'Thiết bị' }
const BASIS_LABEL = { group: '1 nhóm', student: '1 học sinh', product: '1 sản phẩm' } as const

/** Đoán loại học liệu từ chữ người dùng gõ hoặc từ đường dẫn */
export function guessMatType(label: string, url = ''): string {
  const n = norm(label)
  for (const [k, v] of Object.entries(MAT_LABEL)) if (n && (n === norm(v) || n === k)) return k
  if (/phieu/.test(n)) return 'worksheet'
  if (/video|clip/.test(n) || /youtu\.?be|vimeo|\.mp4\b/i.test(url)) return 'video'
  if (/anh|hinh/.test(n) || /\.(png|jpe?g|gif|webp|svg)\b/i.test(url)) return 'image'
  if (/huong dan/.test(n)) return 'guide'
  if (/tai lieu|sach|doc|pdf/.test(n) || /docs\.google|drive\.google|\.(pdf|docx?|pptx?|xlsx?)\b/i.test(url)) return 'document'
  return 'link'
}
function guessKind(label: string): KitNormRow['kind'] {
  const n = norm(label)
  if (/thiet bi|may|equipment/.test(n)) return 'equipment'
  if (/cong cu|dung cu|tool/.test(n)) return 'tool'
  return 'supply'
}
const yes = (s: string) => /^(x|co|yes|true|1|dung lai|duoc)$/.test(norm(s))
const num = (s: string) => { const v = Number(String(s).replace(',', '.').replace(/[^\d.]/g, '')); return Number.isFinite(v) && v > 0 ? v : 0 }
const isExample = (r: string[]) => /^\s*vd\s*[:.]/i.test(r.find(c => c.trim()) ?? '')

// ---------- File mẫu Excel 4 sheet ----------
export const SHEETS = ['01 Thông tin', '02 Nội dung bài học', '03 Link học liệu', '04 Định mức vật tư'] as const
export const INFO_KEYS: [keyof KitDraft['info'] | 'basis' | 'group_size', string, string][] = [
  ['title', 'Tên bài học', 'VD: Bài 3. Xe đua dây thun'],
  ['subject', 'Môn', 'Công nghệ'],
  ['grades', 'Khối', '6'],
  ['periods', 'Số tiết', '2'],
  ['objectives', 'Mục tiêu', 'Học sinh lắp được xe chạy bằng dây thun; giải thích được thế năng đàn hồi'],
  ['summary', 'Tóm tắt', ''],
  ['basis', 'Định mức tính cho', '1 nhóm'],
  ['group_size', 'Số HS / nhóm', '4'],
]
export const STEP_COLS = ['Buổi / giai đoạn', 'Hoạt động *', 'Thời lượng (phút)', 'Mục tiêu', 'Giáo viên', 'Học sinh', 'Sản phẩm']
export const LINK_COLS = ['Tên học liệu *', 'Loại', 'Đường dẫn *']
export const NORM_COLS = ['Tên vật tư *', 'Đơn vị', 'Loại', 'Số lượng *', 'Dùng lại']

/** Dữ liệu cho file mẫu (người soạn tải về, điền, tải lên lại). Dòng bắt đầu "VD:" bị bỏ qua khi đọc. */
export function templateSheets(title = '') {
  return [
    { name: SHEETS[0], header: ['Mục', 'Nội dung', 'Ví dụ'], rows: INFO_KEYS.map(([k, l, ex]) => [l, k === 'title' ? title : k === 'basis' ? '1 nhóm' : k === 'group_size' ? '4' : '', ex.replace(/^VD:\s*/, '')]) },
    { name: SHEETS[1], header: STEP_COLS, rows: [
      ['VD: Khởi động', 'Xem video xe dây thun', '5', 'Tạo hứng thú', 'Chiếu video, đặt câu hỏi', 'Quan sát, trả lời', ''],
      ['VD: Thực hành', 'Lắp khung xe', '25', '', 'Hướng dẫn theo nhóm', 'Lắp theo bản vẽ', 'Khung xe'],
    ] },
    { name: SHEETS[2], header: LINK_COLS, rows: [['VD: Video hướng dẫn lắp xe', 'Video', 'https://youtu.be/…']] },
    { name: SHEETS[3], header: NORM_COLS, rows: [['VD: Dây thun', 'sợi', 'Vật tư tiêu hao', '4', ''], ['VD: Kéo', 'cái', 'Công cụ', '1', 'x']] },
  ]
}

type SheetRows = { name: string; rows: string[][] }
const findSheet = (sheets: SheetRows[], i: number) => {
  const want = norm(SHEETS[i]), code = String(i + 1).padStart(2, '0'), word = norm(SHEETS[i].slice(3))
  return sheets.find(s => norm(s.name) === want) ?? sheets.find(s => norm(s.name).startsWith(code)) ?? sheets.find(s => norm(s.name).includes(word))
}
/** Bảng có tiêu đề: tìm dòng tiêu đề, trả về các dòng dữ liệu dạng {cột: giá trị} */
function table(rows: string[][], cols: string[]) {
  const keys = cols.map(c => norm(c.replace('*', '')))
  const hi = rows.findIndex(r => r.filter(c => keys.includes(norm(c.replace('*', '')))).length >= 2)
  if (hi < 0) return null
  const idx = keys.map(k => rows[hi].findIndex(c => norm(c.replace('*', '')) === k))
  return rows.map((r, n) => ({ r, line: n + 1 })).slice(hi + 1).filter(({ r }) => r.some(c => c.trim()) && !isExample(r))
    .map(({ r, line }) => ({ line, get: (k: number) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '') }))
}

/** Đọc bản nháp từ các sheet của file mẫu (đã đổi ô thành chữ) */
export function kitFromSheets(sheets: SheetRows[]): KitDraft {
  const d = emptyDraft('xlsx')
  const [s1, s2, s3, s4] = [0, 1, 2, 3].map(i => findSheet(sheets, i))
  if (!s1 && !s2 && !s3 && !s4) { d.warnings.push(`Không thấy sheet nào của file mẫu (${SHEETS.join(', ')}). Hãy tải file mẫu và điền vào đó.`); return d }
  if (s1) {
    for (const r of s1.rows) {
      if (isExample(r)) continue
      const k = INFO_KEYS.find(x => norm(x[1]) === norm(r[0] ?? ''))?.[0]; const v = (r[1] ?? '').trim()
      if (!k || !v) continue
      if (k === 'periods') { const p = Math.round(num(v)); if (p) d.info.periods = p; else d.warnings.push(`01 Thông tin: số tiết "${v}" không hợp lệ.`) }
      else if (k === 'basis') d.norms.basis = /hoc sinh/.test(norm(v)) ? 'student' : /san pham/.test(norm(v)) ? 'product' : 'group'
      else if (k === 'group_size') { const g = Math.round(num(v)); if (g) d.norms.group_size = Math.min(20, g) }
      else d.info[k] = v
    }
  }
  if (s2) {
    const t = table(s2.rows, STEP_COLS)
    if (!t) d.warnings.push('02 Nội dung bài học: không thấy dòng tiêu đề (cần cột "Hoạt động").')
    else {
      const steps: KitStep[] = []
      for (const r of t) {
        const title = r.get(1); if (!title) { d.warnings.push(`02 Nội dung bài học, dòng ${r.line}: thiếu tên hoạt động.`); continue }
        steps.push({ phase: r.get(0) || undefined, title, minutes: Math.round(num(r.get(2))) || undefined, goal: r.get(3) || undefined, teacher: r.get(4) || undefined, student: r.get(5) || undefined, product: r.get(6) || undefined })
      }
      if (steps.length) d.plan = { sections: d.info.objectives ? { 'Mục tiêu': d.info.objectives } : {}, steps }
    }
  }
  if (s3) {
    const t = table(s3.rows, LINK_COLS)
    if (!t) d.warnings.push('03 Link học liệu: không thấy dòng tiêu đề (cần cột "Tên học liệu", "Đường dẫn").')
    else for (const r of t) {
      const title = r.get(0), url = r.get(2)
      if (!title || !url) { d.warnings.push(`03 Link học liệu, dòng ${r.line}: cần đủ tên và đường dẫn.`); continue }
      if (!/^https?:\/\//i.test(url)) { d.warnings.push(`03 Link học liệu, dòng ${r.line}: đường dẫn phải bắt đầu bằng http:// hoặc https://.`); continue }
      d.links.push({ title, type: guessMatType(r.get(1), url), url })
    }
  }
  if (s4) {
    const t = table(s4.rows, NORM_COLS)
    if (!t) d.warnings.push('04 Định mức vật tư: không thấy dòng tiêu đề (cần cột "Tên vật tư", "Số lượng").')
    else for (const r of t) {
      const name = r.get(0), qty = num(r.get(3))
      if (!name || !qty) { d.warnings.push(`04 Định mức vật tư, dòng ${r.line}: cần tên và số lượng lớn hơn 0.`); continue }
      const kind = guessKind(r.get(2))
      d.norms.rows.push({ name, unit: r.get(1) || 'cái', kind, qty, reusable: r.get(4) ? yes(r.get(4)) : kind !== 'supply' })
    }
  }
  return d
}

// ---------- Word (.docx) ----------
type Block = { type: 'p'; text: string; heading: number; bold: boolean; list: boolean } | { type: 'table'; rows: string[][] }
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
function runText(xml: string) {
  // <w:t>, tab, xuống dòng mềm
  let out = ''
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out += m[1] !== undefined ? unxml(m[1]) : m[0] === '<w:tab/>' ? '\t' : '\n'
  return out
}
function para(xml: string, headingStyles: Set<string>): Block {
  const style = /<w:pStyle w:val="([^"]+)"/.exec(xml)?.[1] ?? ''
  const lvl = /heading\s*(\d)|^(?:title)$/i.exec(style) ?? (headingStyles.has(style) ? ['', '1'] : null)
  const heading = lvl ? Number(lvl[1] ?? 1) || 1 : 0
  const text = runText(xml).replace(/[  ]+/g, ' ').trim()
  const runs = xml.match(/<w:r[ >][\s\S]*?<\/w:r>/g) ?? []
  const textRuns = runs.filter(r => /<w:t[ >]/.test(r) && runText(r).trim())
  const bold = textRuns.length > 0 && textRuns.every(r => /<w:b\/>|<w:b w:val="(?:1|true)"\/>/.test(r))
  return { type: 'p', text, heading, bold, list: /<w:numPr>/.test(xml) }
}
/** Tách document.xml thành đoạn văn và bảng theo thứ tự (bỏ qua bảng lồng) */
function blocks(doc: string, headingStyles: Set<string>): Block[] {
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(doc)?.[1] ?? doc
  const out: Block[] = []
  let i = 0
  while (i < body.length) {
    const p = body.indexOf('<w:p', i), t = body.indexOf('<w:tbl>', i)
    if (p < 0 && t < 0) break
    if (t >= 0 && (p < 0 || t < p)) {
      // bảng: tìm thẻ đóng tương ứng
      let depth = 0, j = t
      const re = /<w:tbl>|<\/w:tbl>/g; re.lastIndex = t
      let m: RegExpExecArray | null
      while ((m = re.exec(body))) { depth += m[0] === '<w:tbl>' ? 1 : -1; if (depth === 0) { j = m.index + m[0].length; break } }
      const xml = body.slice(t, j)
      const rows = (xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? []).map(tr => (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [])
        .map(tc => (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(x => runText(x).trim()).filter(Boolean).join('\n')))
      out.push({ type: 'table', rows: rows.filter(r => r.some(c => c)) })
      i = j
    } else {
      // <w:p> hoặc <w:p ...> (không nhầm với <w:pPr>, <w:pStyle>…)
      const ch = body[p + 4]
      if (ch !== '>' && ch !== ' ') { i = p + 4; continue }
      const end = body.indexOf('</w:p>', p)
      const self = body.indexOf('/>', p)
      if (self >= 0 && self < body.indexOf('>', p) + 1 && (end < 0 || self < end)) { i = self + 2; continue }
      const xml = body.slice(p, end + 6)
      const b = para(xml, headingStyles)
      if (b.type === 'p' && b.text) out.push(b)
      i = end + 6
    }
  }
  return out
}
const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi

type Sec = 'objectives' | 'prepare' | 'process' | 'other'
function sectionOf(title: string): Sec {
  const n = norm(title)
  if (/muc tieu|yeu cau can dat/.test(n)) return 'objectives'
  if (/thiet bi|hoc lieu|chuan bi|do dung|vat tu|vat lieu|dung cu/.test(n)) return 'prepare'
  if (/tien trinh|hoat dong day hoc|cac hoat dong|to chuc day hoc|noi dung bai hoc/.test(n)) return 'process'
  return 'other'
}
/** Đoạn văn có vẻ là đề mục: kiểu Heading, hoặc "I. …", "1. …", "A. …" ngắn, in đậm hoặc viết hoa.
 *  level: 1 = mục lớn (Heading 1, số La Mã, viết hoa không số), 2 = mục con ("1. …", Heading 2), 3 = nhỏ hơn */
function headingTitle(b: Block): { title: string; level: number } | null {
  if (b.type !== 'p') return null
  const t = b.text
  if (t.length > 90) return null
  const roman = /^[IVX]{1,4}[.)]\s+\S/.test(t)
  const numbered = roman || /^(?:[A-D]|\d{1,2})[.)]\s+\S/.test(t)
  const upper = t === t.toUpperCase() && /[A-ZĐÂĂÊÔƠƯ]/.test(t)
  const clean = t.replace(/^(?:[IVX]{1,4}|[A-D]|\d{1,2})[.)]\s+/, '').replace(/[:.]\s*$/, '')
  if (b.heading) return { title: clean, level: roman ? 1 : b.heading }
  if ((numbered && (b.bold || upper)) || (upper && t.length > 3) || (b.bold && sectionOf(t) !== 'other')) return { title: clean, level: roman || (upper && !numbered) ? 1 : 2 }
  return null
}
const ACT_RE = /^(?:\d+[.)]\s*)?(?:hoạt động|hđ)\s*(\d+|[a-z])?\s*[:.\-–)]?\s*(.*)$/i
const MIN_RE = /\(?\s*(\d{1,3})\s*(?:phút|ph(?=[\s.)]|$)|['’′])\s*\)?/i
const BUOI_RE = /^(buổi|tiết)\s*(\d+)\b/i
const sentence = (s: string) => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s)

/** Vật tư từ một dòng chữ: "Dây thun: 4 sợi", "- 2 cái kéo", "Bìa cứng (1 tấm)" */
function normFromLine(line: string): KitNormRow | null {
  const s = line.replace(/^[\s\-–•*+·▪●○◦]+/, '').replace(/^\d+[.)]\s+/, '').replace(/^(?:giáo viên|học sinh|gv|hs)(?:\s*\([^)]*\))?\s*[:\-–]\s*/i, '').trim()
  if (!s || s.length > 120) return null
  let m = /^(.+?)\s*[:\-–(]\s*(\d+(?:[.,]\d+)?)\s*([^\d\s(),;:]+(?:\s[^\d\s(),;:]+)?)?\s*\)?\s*[.;]?$/.exec(s)
  if (m) return { name: m[1].trim(), qty: num(m[2]), unit: (m[3] ?? 'cái').trim(), kind: 'supply', reusable: false }
  m = /^(\d+(?:[.,]\d+)?)\s+(\S+)\s+(.+?)[.;]?$/.exec(s)
  if (m) return { name: m[3].trim(), qty: num(m[1]), unit: m[2], kind: 'supply', reusable: false }
  return null
}
function normsFromTable(rows: string[][]): KitNormRow[] | null {
  if (rows.length < 2) return null
  const h = rows[0].map(norm)
  const ni = h.findIndex(c => /ten|vat tu|vat lieu|thiet bi|do dung|dung cu|cong cu|hoc lieu/.test(c) && !/so luong|don vi/.test(c))
  const qi = h.findIndex(c => /so luong|sl\b|dinh muc/.test(c))
  if (ni < 0 || qi < 0) return null
  const ui = h.findIndex(c => /don vi|dvt/.test(c)), ki = h.findIndex(c => /^loai|phan loai/.test(c))
  // Bảng "Công cụ và thiết bị" → công cụ (dùng lại); bảng "Nguyên vật liệu" → vật tư tiêu hao
  const headKind: KitNormRow['kind'] = /thiet bi/.test(h[ni]) && !/cong cu/.test(h[ni]) ? 'equipment' : /cong cu|dung cu/.test(h[ni]) ? 'tool' : 'supply'
  return rows.slice(1).map(r => {
    const q = /(\d+(?:[.,]\d+)?)\s*(\S*)/.exec(r[qi] ?? '')
    const kind = ki >= 0 ? guessKind(r[ki] ?? '') : headKind
    return { name: (r[ni] ?? '').trim(), qty: q ? num(q[1]) : 0, unit: (ui >= 0 ? r[ui] : q?.[2]) || 'cái', kind, reusable: kind !== 'supply' }
  }).filter(x => x.name && x.qty > 0)
}
function stepsFromTable(rows: string[][]): KitStep[] | null {
  if (rows.length < 2) return null
  const h = rows[0].map(norm)
  const ai = h.findIndex(c => /hoat dong|noi dung|buoc/.test(c) && !/giao vien|hoc sinh/.test(c))
  if (ai < 0) return null
  const ti = h.findIndex(c => /thoi (gian|luong)|phut/.test(c)), gi = h.findIndex(c => /giao vien|gv/.test(c)), si = h.findIndex(c => /hoc sinh|hs/.test(c))
  const pi = h.findIndex(c => /san pham/.test(c)), mi = h.findIndex(c => /muc tieu/.test(c))
  return rows.slice(1).map(r => {
    const raw = (r[ai] ?? '').trim(), first = raw.split('\n')[0]
    const a = ACT_RE.exec(first)
    return { title: (a?.[2] || first).replace(MIN_RE, '').trim(), minutes: Number(MIN_RE.exec(ti >= 0 ? r[ti] ?? '' : raw)?.[1] ?? num(ti >= 0 ? r[ti] ?? '' : '')) || undefined,
      teacher: gi >= 0 ? r[gi] || undefined : undefined, student: si >= 0 ? r[si] || undefined : undefined,
      product: pi >= 0 ? r[pi] || undefined : undefined, goal: mi >= 0 ? r[mi] || undefined : undefined,
      note: raw.includes('\n') ? raw.split('\n').slice(1).join('\n') : undefined }
  }).filter(s => s.title)
}
const basisOf = (s: string): KitDraft['norms']['basis'] | undefined => {
  const n = norm(s)
  return /(mot|1|moi) san pham/.test(n) ? 'product' : /(mot|1|moi) nhom/.test(n) ? 'group' : /(mot|1|moi) hoc sinh/.test(n) ? 'student' : undefined
}

/** Tên file theo quy ước KDI: "TinkBH-G1-GA-Cột đèn giao thông xoay-1T (2024).docx" → tên bài, khối, số tiết */
export function infoFromFileName(name: string): KitDraft['info'] {
  const base = name.replace(/\.[^.]+$/, '')
  const m = /^[^-]+-G(\d{1,2})-(?:GA|BG|KHBD)-(.+?)-(\d{1,2})T\b/i.exec(base)
  return m ? { title: m[2].trim(), grades: m[1], periods: Number(m[3]) } : {}
}

export function kitFromDocxXml(doc: string, rels = '', styles = '', fileName = ''): KitDraft {
  const d = emptyDraft('docx')
  // Kiểu đoạn do người dùng đặt tên kiểu "Tiêu đề 1" → coi là đề mục
  const hs = new Set<string>()
  for (const m of styles.matchAll(/<w:style [^>]*w:styleId="([^"]+)"[\s\S]*?<w:name w:val="([^"]+)"/g)) if (/heading|title|tieu de|đề mục/i.test(norm(m[2]) + ' ' + m[2])) hs.add(m[1])
  const bs = blocks(doc, hs)
  if (!bs.length) { d.warnings.push('File Word không có nội dung đọc được.'); return d }

  // Tên bài: "Bài …", "Chủ đề …"; hoặc đoạn kiểu Title/Heading; hoặc dòng viết hoa đầu trang (bỏ tên trường, "KẾ HOẠCH BÀI DẠY")
  const paras = bs.filter((b): b is Extract<Block, { type: 'p' }> => b.type === 'p')
  // (không dùng \b: với chữ có dấu, "Tổ\b" khớp cả "Tổng kết")
  const skip = (t: string) => /^(kế hoạch bài (dạy|học)|giáo án|trường|sở|phòng|tổ|buổi|tiết)(?=[\s:.,\-–]|$)/i.test(t)
  const titleB = paras.slice(0, 15).find(b => /^(bài|chủ đề|chuyên đề)\s*\d*/i.test(b.text) && b.text.length < 140)
    ?? paras.slice(0, 6).find(b => b.heading && sectionOf(b.text) === 'other' && !skip(b.text) && !/^(môn|lớp|khối|thời lượng)\b/i.test(b.text))
    ?? paras.slice(0, 6).find(b => b.text === b.text.toUpperCase() && /[A-ZĐ]/.test(b.text) && b.text.length < 120 && !skip(b.text) && sectionOf(b.text) === 'other')
  const fromName = infoFromFileName(fileName)
  if (titleB) d.info.title = sentence(titleB.text.replace(/\s*\(\s*\d+\s*tiết\s*\)\s*$/i, '').replace(/^(?:kế hoạch bài dạy|giáo án)\s*[:\-–]\s*/i, '').trim())
  else if (fromName.title) d.info.title = fromName.title
  const headIdx = Math.max(0, bs.findIndex(b => b.type === 'p' && !!headingTitle(b) && b !== titleB && sectionOf(b.text) !== 'other'))
  const head = paras.filter(b => bs.indexOf(b) < (headIdx || 25)).slice(0, 25).map(b => b.text).join('\n')
  const per = /(\d{1,2})\s*tiết/i.exec(head)
  d.info.periods = per ? Number(per[1]) : fromName.periods
  const subj = /môn(?: học)?\s*[:\-–]\s*([^\n;|]{2,40}?)(?:\s*[;|,]|\s+lớp|\s+khối|\n|$)/i.exec(head)
  if (subj) d.info.subject = subj[1].trim()
  const gr = /(?:lớp|khối)\s*[:\-–]?\s*(\d{1,2})\b/i.exec(head)
  d.info.grades = gr ? gr[1] : fromName.grades
  // Mô tả bài học: dòng "Mô tả bài học" rồi đoạn kế tiếp, hoặc "Mô tả: …"
  const mi = paras.findIndex(b => /^mô tả(?: bài học| chung)?\s*[:.]?\s*/i.test(b.text) && b.text.length < 200)
  if (mi >= 0) {
    const inline = paras[mi].text.replace(/^mô tả(?: bài học| chung)?\s*[:.]?\s*/i, '').trim()
    d.info.summary = inline || (paras[mi + 1] && !headingTitle(paras[mi + 1]) ? paras[mi + 1].text : undefined)
  }
  for (const k of Object.keys(d.info) as (keyof KitDraft['info'])[]) if (d.info[k] === undefined) delete d.info[k]

  // Chia theo đề mục lớn; đề mục con giữ lại trong mục lớn (kèm cấp) để tách hoạt động
  type Part = { title: string; sec: Sec; items: Block[] }
  const parts: Part[] = []
  let cur: Part | null = null
  for (const b of bs) {
    if (b === titleB) continue
    const h = headingTitle(b)
    // "BUỔI 2", "Tiết 2" giữa phần hoạt động: là mốc buổi, không phải mục mới
    if (h && BUOI_RE.test(h.title)) { if (cur?.sec === 'process') cur.items.push({ type: 'p', text: h.title, heading: -1, bold: true, list: false }); continue }
    // Phần đầu trang, thông tin tài liệu: không phải mục của giáo án
    if (h && (skip(h.title) || /^(thông tin tài liệu|mô tả( bài học)?)$/i.test(h.title))) { cur = null; continue }
    if (h && (h.level === 1 || !cur || sectionOf(h.title) !== 'other')) { cur = { title: h.title, sec: sectionOf(h.title), items: [] }; parts.push(cur); continue }
    if (!cur) continue
    cur.items.push(h ? { type: 'p', text: h.title, heading: h.level, bold: true, list: false } : b)
  }
  const text = (items: Block[]) => items.map(b => b.type === 'p' ? b.text : b.rows.map(r => r.join(' | ')).join('\n')).join('\n').trim()

  const sections: Record<string, string> = {}
  const steps: KitStep[] = []
  const bases = new Set<string>()
  for (const p of parts) {
    if (p.sec === 'objectives') {
      const t = text(p.items); if (t) { d.info.objectives = d.info.objectives ? d.info.objectives + '\n' + t : t; sections['Mục tiêu'] = d.info.objectives }
    } else if (p.sec === 'prepare') {
      const leftover: string[] = []
      let basis: KitDraft['norms']['basis'] | undefined
      for (const b of p.items) {
        if (b.type === 'table') {
          const r = normsFromTable(b.rows)
          if (r?.length) { d.norms.rows.push(...r); if (basis) { bases.add(basis); d.norms.basis ??= basis } }
          else leftover.push(text([b]))
          continue
        }
        basis = basisOf(b.text) ?? basis
        const r = normFromLine(b.text)
        if (r) d.norms.rows.push(r); else leftover.push(b.text)
      }
      sections['Thiết bị dạy học và học liệu'] = text(p.items)
      if (leftover.some(l => l.trim() && !/^(giáo viên|học sinh|gv|hs)\s*[:.]?$/i.test(l.trim())) && !d.norms.rows.length)
        d.warnings.push('Mục chuẩn bị không ghi số lượng vật tư: đã giữ nguyên văn trong giáo án, hãy nhập định mức ở thẻ 04.')
    } else if (p.sec === 'process') {
      let st = null as KitStep | null
      let phase: string | undefined
      const add = (s: KitStep) => { st = { ...s, phase }; steps.push(st) }
      const note = (t: string) => { if (st) st.note = [st.note, t].filter(Boolean).join('\n') }
      for (const b of p.items) {
        if (b.type === 'table') { const r = stepsFromTable(b.rows); if (r?.length) { r.forEach(add); st = null } else note(text([b])); continue }
        if (b.heading === -1) { const m = BUOI_RE.exec(b.text)!; phase = `${sentence(m[1])} ${m[2]}`; st = null; continue }
        const a = ACT_RE.exec(b.text)
        const mins = Number(MIN_RE.exec(b.text)?.[1]) || undefined
        // Hoạt động mới: dòng "Hoạt động 1: …", hoặc đề mục con cấp 2 ("4. Tổng kết (2’)")
        if ((a && (a[1] || a[2]) && (b.heading > 0 || b.bold || !st || mins)) || (b.heading > 0 && b.heading <= 2)) {
          const raw = a && (a[1] || a[2]) ? (a[2] || `Hoạt động ${a[1]}`) : b.text
          add({ title: raw.replace(MIN_RE, '').replace(/[\s:.\-–]+$/, '').trim() || b.text, minutes: mins })
          continue
        }
        if (st && !st.minutes) { const mm = /^(?:thời gian|thời lượng)\s*[:\-–]?\s*(\d{1,3})\s*phút/i.exec(b.text); if (mm) { st.minutes = Number(mm[1]); continue } }
        const g = /^(?:a\)\s*)?mục tiêu\s*[:\-–]\s*(.+)$/i.exec(b.text)
        if (st && g && !st.goal) st.goal = g[1]
        else note(b.heading > 2 ? `▸ ${b.text}` : b.text)
      }
      // Buổi đầu không ghi "BUỔI 1" nhưng sau đó có "BUỔI 2" → đặt "Buổi 1" cho các hoạt động trước đó
      const firstPhase = steps.find(s => s.phase)?.phase
      if (firstPhase) { const m = /(\D+)\s*(\d+)/.exec(firstPhase); if (m && m[2] !== '1') steps.forEach(s => { if (!s.phase) s.phase = `${m[1].trim()} 1` }) }
      if (!steps.length) { const t = text(p.items); if (t) sections['Tiến trình dạy học (ghi chú)'] = t }
    } else {
      const t = text(p.items); const k = p.title.slice(0, 80)
      if (t) sections[k] = sections[k] ? sections[k] + '\n' + t : t
    }
  }
  if (bases.size > 1) d.warnings.push(`Giáo án tính vật tư theo nhiều cách (${[...bases].map(b => BASIS_LABEL[b as 'group']).join(', ')}); định mức của bài chỉ có một cách tính (đang chọn ${BASIS_LABEL[d.norms.basis!]}). Hãy kiểm tra lại số lượng ở thẻ 04.`)
  if (!parts.length) { sections['Nội dung giáo án'] = text(bs.filter(b => b !== titleB)); d.warnings.push('Không nhận ra đề mục (Mục tiêu, Chuẩn bị, Tiến trình…): toàn bộ nội dung được đưa vào giáo án, hãy chia lại các mục.') }
  else {
    if (!d.info.objectives) d.warnings.push('Không thấy mục "Mục tiêu" / "Yêu cầu cần đạt".')
    if (!steps.length) d.warnings.push('Không tách được hoạt động dạy học (dòng bắt đầu bằng "Hoạt động 1:", "Hoạt động 2:"…): tiến trình được giữ dạng ghi chú.')
  }
  d.plan = { sections, steps }

  // Liên kết: siêu liên kết trong file + đường dẫn gõ trong chữ
  const relMap = new Map([...rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*TargetMode="External"/g)].map(m => [m[1], unxml(m[2])]))
  const seen = new Set<string>()
  for (const m of doc.matchAll(/<w:hyperlink [^>]*r:id="([^"]+)"[^>]*>([\s\S]*?)<\/w:hyperlink>/g)) {
    const url = relMap.get(m[1]); if (!url || !/^https?:/i.test(url) || seen.has(url)) continue
    seen.add(url); const label = runText(m[2]).trim()
    d.links.push({ title: label && label !== url ? label.slice(0, 120) : linkTitle(url), type: guessMatType(label, url), url })
  }
  for (const b of paras) for (const u of b.text.match(URL_RE) ?? []) {
    const url = u.replace(/[.,;]+$/, ''); if (seen.has(url)) continue
    seen.add(url); const before = b.text.slice(0, b.text.indexOf(u)).replace(/[:\-–]\s*$/, '').replace(/^[\s\-–•*+]+/, '').trim()
    d.links.push({ title: before && before.length < 100 ? before : linkTitle(url), type: guessMatType(before, url), url })
  }
  return d
}
const linkTitle = (url: string) => { try { const u = new URL(url); return /youtu/.test(u.host) ? 'Video YouTube' : u.host.replace(/^www\./, '') } catch { return url.slice(0, 60) } }

// ---------- PowerPoint (.pptx) ----------
export function kitFromPptxXml(slides: string[], rels: string[] = [], fileName = ''): KitDraft {
  const d = emptyDraft('pptx')
  d.info = infoFromFileName(fileName)
  const out: KitSlide[] = []
  slides.forEach((xml, i) => {
    const shapes = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []
    let title = ''; const body: string[] = []
    for (const sp of shapes) {
      const isTitle = /<p:ph [^>]*type="(?:title|ctrTitle)"/.test(sp)
      const paras = (sp.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []).map(p => unxml((p.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map(t => t.slice(5, -6)).join('')).trim()).filter(Boolean)
      if (isTitle && !title) title = paras.join(' ')
      else body.push(...paras)
    }
    if (!title && body.length) title = body.shift()!
    if (title || body.length) out.push({ title: title.slice(0, 200), body: body.map(b => (body.length > 1 ? '• ' : '') + b).join('\n') })
    for (const m of (rels[i] ?? '').matchAll(/Target="(https?:[^"]+)"[^>]*TargetMode="External"/g)) {
      const url = unxml(m[1]); if (!d.links.some(l => l.url === url)) d.links.push({ title: linkTitle(url), type: guessMatType('', url), url })
    }
  })
  if (!out.length) d.warnings.push('File PowerPoint không có chữ đọc được (slide chỉ có hình?). Tệp gốc vẫn được đính kèm vào bài giảng.')
  d.slides = out
  return d
}

// ---------- Đọc file ----------
export async function readKitFile(file: File): Promise<KitDraft> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx')) {
    const { default: readXlsxFile } = await import('read-excel-file/browser')
    const sheets = await readXlsxFile(file)
    const cell = (v: unknown) => v == null ? '' : v instanceof Date ? `${String(v.getDate()).padStart(2, '0')}/${String(v.getMonth() + 1).padStart(2, '0')}/${v.getFullYear()}` : String(v).trim()
    return kitFromSheets(sheets.map(s => ({ name: s.sheet, rows: s.data.map(r => r.map(cell)) })))
  }
  if (name.endsWith('.doc') || name.endsWith('.ppt')) throw new Error('File Word/PowerPoint đời cũ (.doc, .ppt): hãy mở và "Lưu thành" .docx hoặc .pptx rồi tải lại.')
  if (!name.endsWith('.docx') && !name.endsWith('.pptx')) throw new Error('Chọn file mẫu Excel (.xlsx), giáo án Word (.docx) hoặc bài giảng PowerPoint (.pptx).')
  let zip: Record<string, Uint8Array>
  // Chỉ giải nén phần chữ (.xml, .rels): bỏ qua hình, video nhúng (file KDI có thể hơn 100 MB)
  try { zip = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: f => /\.(xml|rels)$/i.test(f.name) }) } catch { throw new Error('Không mở được file: file bị hỏng hoặc không đúng định dạng.') }
  const txt = (p: string) => (zip[p] ? strFromU8(zip[p]) : '')
  if (name.endsWith('.docx')) {
    if (!zip['word/document.xml']) throw new Error('File .docx không đúng định dạng Word.')
    return kitFromDocxXml(txt('word/document.xml'), txt('word/_rels/document.xml.rels'), txt('word/styles.xml'), file.name)
  }
  const ids = Object.keys(zip).map(p => /^ppt\/slides\/slide(\d+)\.xml$/.exec(p)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b)
  // Thứ tự slide theo presentation.xml nếu có
  const pres = txt('ppt/presentation.xml'), prels = txt('ppt/_rels/presentation.xml.rels')
  const order = [...pres.matchAll(/<p:sldId [^>]*r:id="([^"]+)"/g)].map(m => new RegExp(`Id="${m[1]}"[^>]*Target="slides/slide(\\d+)\\.xml"|Target="slides/slide(\\d+)\\.xml"[^>]*Id="${m[1]}"`).exec(prels))
    .map(m => Number(m?.[1] ?? m?.[2])).filter(n => ids.includes(n))
  const seq = order.length === ids.length ? order : ids
  return kitFromPptxXml(seq.map(n => txt(`ppt/slides/slide${n}.xml`)), seq.map(n => txt(`ppt/slides/_rels/slide${n}.xml.rels`)), file.name)
}

export const kitSummary = (d: KitDraft) => ({
  info: [d.info.title && `Tên: ${d.info.title}`, d.info.subject && `Môn: ${d.info.subject}`, d.info.grades && `Khối: ${d.info.grades}`, d.info.periods && `${d.info.periods} tiết`, d.info.objectives && 'có mục tiêu'].filter(Boolean) as string[],
  content: d.slides ? `${d.slides.length} slide` : d.plan ? `${d.plan.steps.length} hoạt động · ${Object.keys(d.plan.sections).length} mục giáo án` : '',
  links: d.links.length ? `${d.links.length} học liệu` : '',
  norms: d.norms.rows.length ? `${d.norms.rows.length} vật tư${d.norms.basis ? ` / ${BASIS_LABEL[d.norms.basis]}` : ''}` : '',
})
export { KIND_LABEL }
