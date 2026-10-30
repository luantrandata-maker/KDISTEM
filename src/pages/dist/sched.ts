import { progGrades, unitGradesOf } from '../../lib/eduLevels'
// Máy xếp lịch của bản phân phối (078, 079). Thuần dữ liệu, không gọi Supabase.
//  Chương trình → môn (môn của học phần, mặc định môn chủ đạo) → bài. "Buổi" = tiết.
//  • Không chỉnh riêng từng môn: các môn nối tiếp nhau, tiết chảy liên tục theo nhịp của chương trình
//    (nhịp 2: môn sau lấp nốt tuần môn trước còn dở).
//  • Chỉnh riêng từng môn: mỗi môn bắt đầu cùng chương trình / nối tiếp môn trước / tuần cụ thể, có nhịp riêng.
//  • Bài sửa tuần bằng tay: các tiết của bài trải từ tuần đó theo nhịp; bài sau vẫn xếp như cũ.

export type Status = 'draft' | 'published' | 'superseded' | 'archived'
export type Plan = { id: string; org_id: string; code: string; title: string; level: string; grade: number; tier: string | null; node_id: string | null; status: Status
  hk1_weeks: number; hk2_weeks: number; note: string | null; updated_at: string; published_at: string | null
  family_id: string; version_no: number }
export type Mode = 'hk1' | 'hk2' | 'week' | 'after'
export type SubjMode = 'program' | 'after' | 'week'
/** order: thứ tự bài riêng của bản phân phối (unit_id); trống = theo thứ tự khung chương trình. */
export type Subj = { name: string; on: boolean; mode: SubjMode; week: number | null; ppw: number; order?: string[] | null }
export type Item = { program_id: string; seq: number; start_mode: Mode; start_week: number | null; after_program: string | null; ppw: number
  split: boolean; subjects: Subj[] }
export type Row = { program_id: string; unit_id: string; seq: number; week: number | null; periods: number; note: string | null
  manual: boolean; skipped: boolean; weeks: number[] | null }
export type Prog = { id: string; code: string | null; title: string; version_no: number; status: string; ct_code: string | null; level: string
  grade_from: number; grade_to: number; grades?: number[]; main_subject: string; periods_per_week: number | null; deploy_term: string | null }
export type U = { id: string; program_id: string; parent_id: string | null; unit_type: 'topic' | 'lesson' | 'session'; seq: number; title: string
  periods: number; grade: number | null; grades?: number[]; subject: string | null }
export type Lesson = U & { subj: string }

/** Tiết/tuần vượt mức này thì tô cam ở lịch và cảnh báo. */
export const LOAD_MAX = 5
export const TERM_LABEL: Record<string, string> = { hk1: 'Học kỳ 1', hk2: 'Học kỳ 2', year: 'Cả năm' }
export const progLabel = (p: Prog | undefined) => (p ? (p.code ? p.code + ' · ' : '') + p.title : '—')
export const progCode = (p: Prog | undefined) => p?.code || p?.ct_code || p?.title.slice(0, 12) || '—'
const lc = (s: string) => s.trim().toLowerCase()

/** Bài của chương trình cho một khối, theo thứ tự cây, kèm môn (môn của học phần gần nhất, không có thì môn chủ đạo). */
export function lessonsOf(units: U[], prog: Prog, grade: number): Lesson[] {
  const mine = units.filter(u => u.program_id === prog.id)
  const kids = (id: string | null) => mine.filter(u => u.parent_id === id).sort((a, b) => a.seq - b.seq)
  const out: Lesson[] = []
  const walk = (id: string | null, g: number[], s: string | null) => kids(id).forEach(u => {
    const own = unitGradesOf(u), ug = own.length ? own : g
    if (ug.length && !ug.includes(grade)) return
    const us = u.subject?.trim() || s
    if (u.unit_type === 'lesson') out.push({ ...u, subj: us || prog.main_subject })
    else if (u.unit_type === 'topic') { if (mine.some(x => x.parent_id === u.id)) walk(u.id, ug, us); else out.push({ ...u, subj: us || prog.main_subject }) }
  })
  walk(null, [], null)
  return out
}

/** Các môn có bài cho khối, theo thứ tự xuất hiện: tên, số bài, số buổi chuẩn. */
export function subjectsIn(lessons: Lesson[]) {
  const m = new Map<string, { name: string; lessons: number; periods: number }>()
  for (const l of lessons) {
    const k = lc(l.subj); const x = m.get(k) ?? { name: l.subj, lessons: 0, periods: 0 }
    x.lessons++; x.periods += Math.max(1, l.periods || 1); m.set(k, x)
  }
  return [...m.values()]
}

/** Bài của một môn theo thứ tự riêng của bản (bài chưa có trong thứ tự giữ chỗ theo khung, xếp sau). */
export function orderLessons<T extends { id: string }>(lessons: T[], order?: string[] | null): T[] {
  if (!order?.length) return lessons
  const pos = new Map(order.map((id, k) => [id, k]))
  return lessons.map((l, k) => ({ l, k: pos.has(l.id) ? pos.get(l.id)! : order.length + k })).sort((a, b) => a.k - b.k).map(x => x.l)
}
/** Thứ tự riêng có khác thứ tự khung không. */
export const reordered = (lessons: { id: string }[], order?: string[] | null) => orderLessons(lessons, order).some((l, k) => l.id !== lessons[k].id)

/** Danh sách môn dùng để xếp: giữ thứ tự / cài đặt đã lưu, thêm môn mới (đang bật), bỏ môn không còn bài. */
export function effSubjects(it: Item, avail: string[]): Subj[] {
  const known = new Map(it.subjects.map(s => [lc(s.name), s]))
  const have = new Set(avail.map(lc))
  const kept = it.subjects.filter(s => have.has(lc(s.name)))
  const added = avail.filter(n => !known.has(lc(n))).map(n => ({ name: n, on: true, mode: 'after' as SubjMode, week: null, ppw: it.ppw }))
  return [...kept, ...added].map((s, k) => ({ ...s, mode: k === 0 && s.mode === 'after' ? 'program' : s.mode, ppw: Number(s.ppw) || it.ppw }))
}

export function progStart(plan: Plan, it: Item, end: Map<string, number>) {
  return it.start_mode === 'hk2' ? plan.hk1_weeks + 1 : it.start_mode === 'week' ? Math.max(1, it.start_week ?? 1)
    : it.start_mode === 'after' && it.after_program && end.has(it.after_program) ? end.get(it.after_program)! + 1 : 1
}

export type Sched = {
  rows: Row[]
  /** Môn của từng bài (khoá: unit_id) */
  subjOf: Map<string, string>
  /** Theo chương trình: tuần bắt đầu, các môn đang dạy theo thứ tự (kèm tuần từng môn) */
  progs: Map<string, { start: number; subjects: { name: string; from: number; to: number; periods: number; std: number; lessons: number }[] }>
}

export function schedule(plan: Plan, items: Item[], prev: Map<string, Row>, units: U[], progs: Map<string, Prog>): Sched {
  const end = new Map<string, number>()
  const rows: Row[] = []
  const subjOf = new Map<string, string>()
  const info: Sched['progs'] = new Map()
  let seq = 0
  for (const it of [...items].sort((a, b) => a.seq - b.seq)) {
    const p = progs.get(it.program_id)
    if (!p) continue
    const start = progStart(plan, it, end)
    const lessons = lessonsOf(units, p, plan.grade)
    const subs = effSubjects(it, subjectsIn(lessons).map(s => s.name)).filter(s => s.on)
    let c = 0, prevEnd = start - 1, last = start - 1
    const sinfo: { name: string; from: number; to: number; periods: number; std: number; lessons: number }[] = []
    for (const s of subs) {
      const ppw = it.split ? Math.max(0.5, s.ppw) : Math.max(0.5, it.ppw)
      const sStart = !it.split ? start : s.mode === 'week' ? Math.max(1, s.week ?? start) : s.mode === 'after' ? prevEnd + 1 : start
      let n = it.split ? 0 : c
      let from = Infinity, to = 0, periodsSum = 0, std = 0, count = 0
      for (const u of orderLessons(lessons.filter(l => lc(l.subj) === lc(s.name)), s.order)) {
        const pr = prev.get(u.id)
        const periods = pr ? pr.periods : Math.max(1, u.periods || 1)
        std += Math.max(1, u.periods || 1)
        const skipped = !!pr?.skipped
        let weeks: number[] | null = null
        const manual = !!(pr?.manual && pr.week)
        if (!skipped && periods > 0) {
          weeks = manual ? Array.from({ length: periods }, (_, k) => pr!.week! + Math.floor(k / ppw))
            : Array.from({ length: periods }, (_, k) => sStart + Math.floor((n + k) / ppw))
          n += periods
          from = Math.min(from, ...weeks); to = Math.max(to, ...weeks); periodsSum += periods; count++
        }
        rows.push({ program_id: it.program_id, unit_id: u.id, seq: ++seq, week: weeks ? weeks[0] : manual ? pr!.week : null, periods,
          note: pr?.note ?? null, manual, skipped, weeks })
        subjOf.set(u.id, s.name)
      }
      if (!it.split) c = n
      if (to) { prevEnd = to; last = Math.max(last, to) }
      sinfo.push({ name: s.name, from: from === Infinity ? 0 : from, to, periods: periodsSum, std, lessons: count })
    }
    end.set(it.program_id, Math.max(last, start - 1))
    info.set(it.program_id, { start, subjects: sinfo })
  }
  return { rows, subjOf, progs: info }
}

/** Số tiết theo tuần; lọc theo chương trình / môn nếu cần. */
export function weekLoad(rows: Row[], keep: (r: Row) => boolean = () => true) {
  const m = new Map<number, number>()
  for (const r of rows) if (!r.skipped && keep(r)) {
    const ws = r.weeks ?? (r.week ? Array.from({ length: r.periods }, () => r.week!) : [])
    for (const w of ws) m.set(w, (m.get(w) ?? 0) + 1)
  }
  return m
}

/** Khoảng tuần của các dòng (bỏ bài đã bỏ). */
export function spanOf(rows: Row[]) {
  const ws = rows.filter(r => !r.skipped).flatMap(r => r.weeks ?? (r.week ? [r.week] : []))
  if (!ws.length) return null
  return { from: Math.min(...ws), to: Math.max(...ws), periods: rows.filter(r => !r.skipped).reduce((s, r) => s + r.periods, 0) }
}

/** Tuần của học kỳ triển khai chương trình (null = cả năm, không ràng buộc). */
export function termRange(plan: Plan, term: string | null) {
  if (term === 'hk1') return { from: 1, to: plan.hk1_weeks, label: 'Học kỳ 1' }
  if (term === 'hk2') return { from: plan.hk1_weeks + 1, to: plan.hk1_weeks + plan.hk2_weeks, label: 'Học kỳ 2' }
  return null
}

export type Check = { level: 'error' | 'warn'; text: string }
export function checks(plan: Plan, items: Item[], s: Sched, progs: Map<string, Prog>): Check[] {
  const out: Check[] = []
  const frame = plan.hk1_weeks + plan.hk2_weeks
  if (!items.length) out.push({ level: 'error', text: 'Chưa chọn chương trình.' })
  for (const it of items) {
    const p = progs.get(it.program_id)
    if (!p) { out.push({ level: 'error', text: 'Có chương trình không còn đọc được.' }); continue }
    const name = progCode(p)
    if (p.status !== 'published') out.push({ level: 'error', text: `${name} chưa phát hành.` })
    if (!progGrades(p).includes(plan.grade)) out.push({ level: 'error', text: `${name} không dạy khối ${plan.grade}.` })
    const mine = s.rows.filter(r => r.program_id === it.program_id)
    const sp = spanOf(mine)
    if (!sp) { out.push({ level: 'error', text: `${name} chưa có bài nào được chọn cho khối ${plan.grade}.` }); continue }
    if (sp.to > frame) out.push({ level: 'error', text: `${name} kéo đến tuần ${sp.to}, ngoài khung ${frame} tuần.` })
    const t = termRange(plan, p.deploy_term)
    if (t && (sp.from < t.from || sp.to > t.to)) out.push({ level: 'warn', text: `${name} đang xếp tuần ${sp.from}–${sp.to}, ngoài ${t.label} (tuần ${t.from}–${t.to}).` })
    if (it.start_mode === 'after' && !it.after_program) out.push({ level: 'warn', text: `${name} chọn "ngay sau chương trình khác" nhưng chưa chọn chương trình.` })
  }
  const load = weekLoad(s.rows)
  const over = [...load.entries()].filter(([, n]) => n > LOAD_MAX).map(([w]) => w).sort((a, b) => a - b)
  if (over.length) out.push({ level: 'warn', text: `Vượt ${LOAD_MAX} tiết/tuần ở tuần ${over.slice(0, 8).join(', ')}${over.length > 8 ? '…' : ''}.` })
  const manual = s.rows.filter(r => r.manual && !r.skipped).length
  if (manual) out.push({ level: 'warn', text: `${manual} bài đặt tuần bằng tay.` })
  return out
}
