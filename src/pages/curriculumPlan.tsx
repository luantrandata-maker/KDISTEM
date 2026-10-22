import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Tiles } from './department/charts'
import { BOOK_STATUS, KIND, LessonEditor, REASONS, errText, useCanEdit, useReasonDialog, type Book, type PpctMode, type ReasonCode } from './curriculum'
import { downloadXlsx, norm } from '../lib/sheet'

// Kế hoạch dạy học — đợt 1 (migration 071)
//  • Kế hoạch năm: bảng môn × khối của một năm học (trường) hoặc của bộ mẫu (KDI / Sở): số tiết HK I / HK II,
//    trạng thái, cảnh báo vượt sức chứa (số tuần × số tiết / tuần); tạo PPCT cho ô trống; chuyển sang năm học mới.
//  • Phân bổ tiết: chọn PPCT gắn chương trình → chia số tiết từng bài vào HK I / HK II → sinh lại danh sách tiết.

type Year = { id: string; name: string; term: string; starts_on: string | null; ends_on: string | null; is_current: boolean | null }
type Counts = { book_id: string; hk1: number; hk2: number; other: number }
type Prog = { id: string; title: string; version_no: number; grade_from: number; grade_to: number; main_subject: string; status: string; org_id: string }
type Unit = { id: string; parent_id: string | null; unit_type: 'topic' | 'lesson' | 'session'; seq: number; grade: number | null; subject: string | null; title: string; periods: number }
type Alloc = { unit_id: string; periods: number; term: 1 | 2 | null }

const yearNames = (years: Year[] | undefined) => [...new Set((years ?? []).map(y => y.name))]
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','))

// Số tuần HK I / HK II của năm học (mẫu không có năm học: 18 / 17)
function useTermWeeks(orgId: string | null, year: string | null) {
  const [w, setW] = useState<{ hk1: number; hk2: number }>({ hk1: 18, hk2: 17 })
  useEffect(() => {
    if (!orgId || !year) { setW({ hk1: 18, hk2: 17 }); return }
    supabase.rpc('curriculum_term_weeks', { p_org: orgId, p_year: year }).then(({ data }) => {
      const r = ((data as { hk1: number; hk2: number }[]) ?? [])[0]; if (r) setW(r)
    })
  }, [orgId, year])
  return w
}

// Chương trình dùng được để tạo PPCT: của đơn vị mình hoặc đã ban hành
function usePrograms(orgId: string | null) {
  const [list, setList] = useState<Prog[]>([])
  useEffect(() => {
    supabase.from('edu_programs').select('id, title, version_no, grade_from, grade_to, main_subject, status, org_id').in('status', ['draft', 'pending', 'approved', 'published'])
      .order('title').then(({ data }) => setList(((data as Prog[]) ?? []).filter(p => p.status === 'published' || p.org_id === orgId)))
  }, [orgId])
  return list
}

// ================= Kế hoạch năm =================
export function YearPlan({ orgId, mode = 'school', year, years }: { orgId: string | null; mode?: PpctMode; year?: { name: string } | null; years?: Year[] }) {
  const canEdit = useCanEdit(mode)
  const names = yearNames(years)
  const [yname, setYname] = useState<string>(mode === 'school' ? year?.name ?? names[0] ?? '' : '')
  const [books, setBooks] = useState<Book[] | null>(null)
  const [counts, setCounts] = useState<Map<string, Counts>>(new Map())
  const [classGrades, setClassGrades] = useState<number[]>([])
  const [open, setOpen] = useState<Book | null>(null)
  const [mk, setMk] = useState<{ grade: number; subject: string; program: string; ppw: string } | null>(null)
  const [roll, setRoll] = useState<string | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const weeks = useTermWeeks(orgId, mode === 'school' ? yname || null : null)
  const programs = usePrograms(orgId)

  async function load() {
    if (!orgId) return
    let q = supabase.from('curriculum_books').select('*, edu_programs(title, version_no)').eq('org_id', orgId).order('grade').order('subject')
    if (mode === 'school' && yname) q = q.eq('year_name', yname)
    const { data, error } = await q
    if (error) setMsg([errText(error.message), true])
    const bs = (data as Book[]) ?? []
    setBooks(bs)
    setOpen(o => (o ? bs.find(b => b.id === o.id) ?? null : null))
    if (bs.length) {
      const { data: c } = await supabase.rpc('curriculum_term_counts', { p_books: bs.map(b => b.id) })
      setCounts(new Map(((c as Counts[]) ?? []).map(r => [r.book_id, r])))
    } else setCounts(new Map())
    if (mode === 'school') {
      const { data: cl } = await supabase.from('classes').select('grade').eq('org_id', orgId)
      setClassGrades([...new Set(((cl as { grade: number }[]) ?? []).map(r => r.grade))])
    }
  }
  useEffect(() => { load() }, [orgId, yname])

  const grades = useMemo(() => [...new Set([...(books ?? []).map(b => b.grade), ...classGrades])].sort((a, b) => a - b), [books, classGrades])
  const subjects = useMemo(() => [...new Set((books ?? []).map(b => b.subject))].sort((a, b) => a.localeCompare(b, 'vi')), [books])
  const cell = (s: string, g: number) => (books ?? []).filter(b => b.grade === g && b.subject === s)

  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!mk) return
    const ppw = Number(mk.ppw.replace(',', '.')) || null
    if (mk.program) {
      const { data, error } = await supabase.rpc('curriculum_from_program', { p_program: mk.program, p_grade: mk.grade, p_subject: mk.subject.trim() || null, p_year: yname || null, p_ppw: ppw })
      if (error) return setMsg([errText(error.message), true])
      setMsg(['Đã tạo PPCT nháp từ chương trình. Chia lại số tiết từng bài ở tab "Phân bổ tiết" nếu cần.', false])
      setMk(null); await load()
      const { data: nb } = await supabase.from('curriculum_books').select('*').eq('id', data as string).single()
      if (nb) setOpen(nb as Book)
    } else {
      if (!mk.subject.trim()) return setMsg(['Nhập môn học.', true])
      const { error } = await supabase.from('curriculum_books').insert({
        org_id: orgId, grade: mk.grade, subject: mk.subject.trim(), title: `${mk.subject.trim()} ${mk.grade}`, year_name: yname || null,
        periods_per_week: ppw, status: 'draft', scope: mode === 'school' ? 'own' : 'children',
      })
      if (error) return setMsg([errText(error.message), true])
      setMsg(['Đã thêm PPCT trống — bấm vào ô để soạn từng tiết.', false]); setMk(null); load()
    }
  }
  async function rollover() {
    if (!roll) return
    if (!confirm(`Sao chép mọi PPCT năm học ${yname} sang ${roll} (bản nháp)? Môn đã có PPCT ở năm ${roll} được giữ nguyên.`)) return
    const { data, error } = await supabase.rpc('curriculum_rollover', { p_from: yname, p_to: roll })
    if (error) return setMsg([errText(error.message), true])
    setMsg([`Đã chuyển ${data} PPCT sang năm học ${roll} (bản nháp). Chọn năm ${roll} để xem và gửi duyệt.`, false]); setRoll(null)
  }

  if (open) return <LessonEditor book={open} canEdit={canEdit && open.org_id === orgId} mode={mode} onClose={() => { setOpen(null); load() }} onChanged={load} />

  const all = books ?? []
  const tot = (b: Book) => counts.get(b.id) ?? { book_id: b.id, hk1: 0, hk2: 0, other: 0 }
  const over = (b: Book) => {
    const ppw = Number(b.periods_per_week) || 0; if (!ppw) return ''
    const c = tot(b), p: string[] = []
    if (c.hk1 > weeks.hk1 * ppw) p.push(`HK I vượt ${c.hk1 - weeks.hk1 * ppw} tiết`)
    if (c.hk2 > weeks.hk2 * ppw) p.push(`HK II vượt ${c.hk2 - weeks.hk2 * ppw} tiết`)
    return p.join(' · ')
  }
  const progFor = (g: number) => programs.filter(p => p.grade_from <= g && g <= p.grade_to)
  const sum = (k: 'hk1' | 'hk2') => all.reduce((s, b) => s + tot(b)[k], 0)

  return (
    <>
      <p className="sub">
        {mode === 'school' ? 'Kế hoạch cả năm học: mỗi ô là PPCT của một môn ở một khối, kèm số tiết từng học kỳ. Ô trống là khối chưa có PPCT.'
          : 'Bộ PPCT mẫu theo môn và khối. Trường sao chép mẫu về rồi điều chỉnh theo năm học của trường.'}
      </p>
      <div className="bar">
        <div className="tools">
          {mode === 'school' && <label className="field" style={{ margin: 0 }}><span>Năm học</span>
            <select value={yname} onChange={e => setYname(e.target.value)} aria-label="Năm học">
              {names.length === 0 && <option value="">Chưa có năm học</option>}
              {names.map(n => <option key={n}>{n}</option>)}
            </select></label>}
          {mode === 'school' && <small className="sub">HK I {weeks.hk1} tuần · HK II {weeks.hk2} tuần</small>}
        </div>
        <div className="tools">
          {canEdit && mode === 'school' && names.length > 1 && all.length > 0 && <button onClick={() => setRoll(names.find(n => n !== yname) ?? null)}>Chuyển sang năm học mới</button>}
          {canEdit && <button className="primary" onClick={() => setMk({ grade: grades[0] ?? 6, subject: '', program: '', ppw: '' })}>Thêm PPCT</button>}
        </div>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}

      {roll !== null && (
        <div className="panel bar">
          <span>Chuyển toàn bộ PPCT năm <b>{yname}</b> sang năm</span>
          <select value={roll} onChange={e => setRoll(e.target.value)} aria-label="Năm học mới">{names.filter(n => n !== yname).map(n => <option key={n}>{n}</option>)}</select>
          <span className="tools"><button className="primary" onClick={rollover}>Chuyển</button><button onClick={() => setRoll(null)}>Huỷ</button></span>
        </div>
      )}

      {mk && (
        <form className="panel formgrid" onSubmit={create}>
          <label className="field"><span>Khối *</span><input type="number" min={1} max={12} required value={mk.grade} onChange={e => setMk({ ...mk, grade: Number(e.target.value) || 1, program: '' })} /></label>
          <label className="field"><span>Theo chương trình</span><select value={mk.program} onChange={e => {
            const p = programs.find(x => x.id === e.target.value); setMk({ ...mk, program: e.target.value, subject: p ? p.main_subject : mk.subject })
          }}>
            <option value="">— Tự soạn, không theo chương trình —</option>
            {progFor(mk.grade).map(p => <option key={p.id} value={p.id}>{p.title} (v{p.version_no}){p.status !== 'published' ? ' · nháp' : ''}</option>)}
          </select></label>
          <label className="field"><span>Môn học *</span><input required value={mk.subject} onChange={e => setMk({ ...mk, subject: e.target.value })} placeholder="VD: Công nghệ" /></label>
          <label className="field"><span>Số tiết / tuần</span><input inputMode="decimal" value={mk.ppw} onChange={e => setMk({ ...mk, ppw: e.target.value })} placeholder="VD: 1 hoặc 1,5" /></label>
          <div className="formactions"><button className="primary" type="submit">Tạo PPCT nháp</button> <button type="button" onClick={() => setMk(null)}>Huỷ</button></div>
        </form>
      )}

      {books === null ? <p className="sub">Đang tải…</p> : (
        <>
          <Tiles items={[
            { label: 'Số PPCT', value: all.length, sub: `${subjects.length} môn · ${grades.length} khối` },
            { label: mode === 'school' ? 'Đang dùng' : 'Đã ban hành', value: all.filter(b => b.status === 'published').length, tone: 'good' },
            { label: 'Nháp / chờ duyệt', value: all.filter(b => b.status !== 'published').length },
            { label: 'Tổng tiết', value: sum('hk1') + sum('hk2'), sub: `HK I ${sum('hk1')} · HK II ${sum('hk2')}` },
            { label: 'Vượt sức chứa', value: all.filter(b => over(b)).length, tone: all.some(b => over(b)) ? 'bad' : '' },
          ]} />
          {subjects.length === 0 ? (
            <div className="panel"><p className="sub" style={{ margin: 0 }}>{mode === 'school' ? `Năm học ${yname || '—'} chưa có PPCT nào.` : 'Chưa có PPCT mẫu nào.'}
              {canEdit && ' Bấm "Thêm PPCT" để tạo từ chương trình giáo dục hoặc tự soạn.'}</p></div>
          ) : (
            <div className="wrap"><table className="yearplan">
              <thead><tr><th>Môn học</th>{grades.map(g => <th key={g}>Khối {g}</th>)}</tr></thead>
              <tbody>{subjects.map(s => (
                <tr key={s}><td><b>{s}</b></td>
                  {grades.map(g => {
                    const bs = cell(s, g)
                    return (
                      <td key={g}>
                        {bs.map(b => {
                          const c = tot(b), o = over(b)
                          return (
                            <button key={b.id} className={'ypcell' + (o ? ' over' : '')} onClick={() => setOpen(b)} title={b.title}>
                              <span className={'pill ' + BOOK_STATUS[b.status][1]}>{b.status === 'published' && mode !== 'school' ? 'Đã ban hành' : BOOK_STATUS[b.status][0]}</span>
                              <b>{c.hk1 + c.hk2 + c.other} tiết</b>
                              <small>HK I {c.hk1} · HK II {c.hk2}{c.other ? ` · chưa xếp ${c.other}` : ''}{b.periods_per_week ? ` · ${fmt(Number(b.periods_per_week))} tiết/tuần` : ''}</small>
                              {o && <small className="bad">{o}</small>}
                            </button>
                          )
                        })}
                        {bs.length === 0 && (canEdit ? <button className="ypcell empty" onClick={() => setMk({ grade: g, subject: s, program: '', ppw: '' })}>+ Tạo</button> : <small className="sub">—</small>)}
                      </td>
                    )
                  })}
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
    </>
  )
}

// ================= Phân bổ tiết =================
export function Allocation({ orgId, mode = 'school', year, years }: { orgId: string | null; mode?: PpctMode; year?: { name: string } | null; years?: Year[] }) {
  const canEdit = useCanEdit(mode)
  const names = yearNames(years)
  const [yname, setYname] = useState<string>(mode === 'school' ? year?.name ?? names[0] ?? '' : '')
  const [books, setBooks] = useState<Book[]>([])
  const [bookId, setBookId] = useState('')
  const [units, setUnits] = useState<Unit[]>([])
  const [alloc, setAlloc] = useState<Map<string, Alloc>>(new Map())
  const [lessons, setLessons] = useState(0)
  const [review, setReview] = useState(false)
  const [test, setTest] = useState(false)
  const [mk, setMk] = useState<{ program: string; grade: number; ppw: string } | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [busy, setBusy] = useState(false)
  const programs = usePrograms(orgId)
  const weeks = useTermWeeks(orgId, mode === 'school' ? yname || null : null)
  const { ask, dialog } = useReasonDialog()

  async function loadBooks(select?: string) {
    if (!orgId) return
    let q = supabase.from('curriculum_books').select('*, edu_programs(title, version_no)').eq('org_id', orgId).not('program_id', 'is', null).order('grade').order('subject')
    if (mode === 'school' && yname) q = q.eq('year_name', yname)
    const { data, error } = await q
    if (error) setMsg([errText(error.message), true])
    const bs = (data as Book[]) ?? []
    setBooks(bs)
    setBookId(cur => select ?? (bs.some(b => b.id === cur) ? cur : bs[0]?.id ?? ''))
  }
  useEffect(() => { loadBooks() }, [orgId, yname])

  const book = books.find(b => b.id === bookId) ?? null
  async function loadBook() {
    if (!book?.program_id) { setUnits([]); return }
    const [u, l, b] = await Promise.all([
      supabase.from('edu_program_units').select('id, parent_id, unit_type, seq, grade, subject, title, periods').eq('program_id', book.program_id).order('seq'),
      supabase.from('curriculum_lessons').select('id', { count: 'exact', head: true }).eq('book_id', book.id),
      supabase.from('curriculum_books').select('allocation').eq('id', book.id).single(),
    ])
    setUnits((u.data as Unit[]) ?? []); setLessons(l.count ?? 0)
    const saved = (((b.data as { allocation: Alloc[] | null } | null)?.allocation) ?? []) as Alloc[]
    setAlloc(new Map(saved.map(a => [a.unit_id, { unit_id: a.unit_id, periods: Number(a.periods) || 0, term: a.term === 1 || a.term === 2 ? a.term : null }])))
  }
  useEffect(() => { loadBook() }, [bookId, book?.program_id])

  // Cây chương trình của khối: chỉ các nhánh có bài thuộc khối (khối kế thừa từ chủ đề cha)
  const prog = programs.find(p => p.id === book?.program_id)
  const tree = useMemo(() => {
    if (!book) return [] as { u: Unit; depth: number; leaf: boolean }[]
    const kids = (pid: string | null) => units.filter(u => u.parent_id === pid).sort((a, b) => a.seq - b.seq)
    const subjOk = (s: string | null) => !s || !prog || book.subject.toLowerCase() === prog.main_subject.toLowerCase() || s.toLowerCase() === book.subject.toLowerCase()
    const out: { u: Unit; depth: number; leaf: boolean }[] = []
    const walk = (pid: string | null, depth: number, g: number | null, s: string | null): boolean => {
      let any = false
      for (const u of kids(pid)) {
        const gg = u.grade ?? g, ss = u.subject ?? s
        const ch = depth < 2 ? kids(u.id) : []
        if (ch.length === 0) {
          if ((gg == null || gg === book.grade) && subjOk(ss)) { out.push({ u, depth, leaf: true }); any = true }
        } else {
          const at = out.length
          out.push({ u, depth, leaf: false })
          if (walk(u.id, depth + 1, gg, ss)) any = true
          else out.splice(at, 1)
        }
      }
      return any
    }
    walk(null, 0, null, null)
    return out
  }, [units, book, prog])
  const leaves = tree.filter(t => t.leaf)
  const get = (u: Unit): Alloc => alloc.get(u.id) ?? { unit_id: u.id, periods: Math.max(u.periods, 1), term: null }
  const set = (ids: string[], patch: Partial<Alloc>) => setAlloc(m => {
    const n = new Map(m)
    for (const id of ids) { const u = units.find(x => x.id === id); if (u) n.set(id, { ...get(u), ...patch }) }
    return n
  })
  const leafIds = (pid: string) => {
    const at = tree.findIndex(t => t.u.id === pid), d = tree[at].depth, ids: string[] = []
    for (let i = at + 1; i < tree.length && tree[i].depth > d; i++) if (tree[i].leaf) ids.push(tree[i].u.id)
    return ids
  }

  // Học kỳ dự kiến (giống cách sinh trên máy chủ): bài không ghi học kỳ xếp nối tiếp đến hết sức chứa HK I
  const ppw = Number(book?.periods_per_week) || 0
  const plan = useMemo(() => {
    const rows = leaves.map(t => ({ id: t.u.id, ...get(t.u) })).filter(r => r.periods > 0)
    const total = rows.reduce((s, r) => s + r.periods, 0)
    const cap = ppw ? weeks.hk1 * ppw : null
    let before = 0
    const term = new Map<string, 1 | 2>()
    for (const r of rows) {
      term.set(r.id, r.term ?? (cap != null ? (before < cap ? 1 : 2) : (before * 2 < total ? 1 : 2)))
      before += r.periods
    }
    const extra = (review ? 1 : 0) + (test ? 1 : 0)
    const hk1 = rows.filter(r => term.get(r.id) === 1).reduce((s, r) => s + r.periods, 0)
    const hk2 = total - hk1
    return { term, total, hk1: hk1 + (hk1 ? extra : 0), hk2: hk2 + (hk2 ? extra : 0) }
  }, [leaves, alloc, ppw, weeks, review, test])
  const unitTotal = leaves.reduce((s, t) => s + Math.max(t.u.periods, 0), 0)
  const cap1 = ppw ? weeks.hk1 * ppw : null, cap2 = ppw ? weeks.hk2 * ppw : null

  async function generate() {
    if (!book) return
    if (lessons > 0 && !confirm(`Thay toàn bộ ${lessons} tiết hiện có của "${book.title}" bằng ${plan.hk1 + plan.hk2} tiết theo bảng phân bổ?`)) return
    const reason = await ask(book, 'phân bổ lại tiết')
    if (reason === null) return
    setBusy(true)
    const payload = leaves.map(t => get(t.u))
    const { data, error } = await supabase.rpc('curriculum_generate', { p_book: book.id, p_alloc: payload, p_review: review, p_test: test,
      p_reason: reason ? reason.text || REASONS[reason.code] : null, p_reason_code: reason?.code ?? null })
    setBusy(false)
    if (error) return setMsg([errText(error.message), true])
    setMsg([`Đã sinh ${data} tiết cho "${book.title}". Xem và chỉnh từng tiết ở tab Phân phối chương trình.`, false]); loadBook()
  }
  async function create(e: React.FormEvent) {
    e.preventDefault(); if (!mk?.program) return
    const ppwN = Number(mk.ppw.replace(',', '.')) || null
    const { data, error } = await supabase.rpc('curriculum_from_program', { p_program: mk.program, p_grade: mk.grade, p_subject: null, p_year: yname || null, p_ppw: ppwN })
    if (error) return setMsg([errText(error.message), true])
    setMk(null); setMsg(['Đã tạo PPCT nháp từ chương trình — chia lại số tiết bên dưới rồi bấm "Sinh PPCT".', false])
    loadBooks(data as string)
  }

  const mkProg = programs.find(p => p.id === mk?.program)
  return (
    <>
      <p className="sub">Chia số tiết của từng bài trong chương trình vào học kỳ I / học kỳ II, rồi sinh danh sách tiết của PPCT. Bài để "Tự động" được xếp nối tiếp cho đến hết sức chứa học kỳ I.</p>
      <div className="bar">
        <div className="tools">
          {mode === 'school' && <select value={yname} onChange={e => setYname(e.target.value)} aria-label="Năm học">{names.map(n => <option key={n}>{n}</option>)}</select>}
          <select value={bookId} onChange={e => setBookId(e.target.value)} aria-label="PPCT" style={{ maxWidth: 360 }}>
            {books.length === 0 && <option value="">Chưa có PPCT theo chương trình</option>}
            {books.map(b => <option key={b.id} value={b.id}>Khối {b.grade} · {b.subject} — {b.title}</option>)}
          </select>
        </div>
        {canEdit && <button className="primary" onClick={() => setMk({ program: '', grade: 0, ppw: '' })}>Tạo PPCT từ chương trình</button>}
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}

      {mk && (
        <form className="panel formgrid" onSubmit={create}>
          <label className="field"><span>Chương trình *</span><select required value={mk.program} onChange={e => {
            const p = programs.find(x => x.id === e.target.value); setMk({ ...mk, program: e.target.value, grade: p?.grade_from ?? 0 })
          }}><option value="">— Chọn chương trình —</option>
            {programs.map(p => <option key={p.id} value={p.id}>{p.title} (v{p.version_no}) · khối {p.grade_from}{p.grade_to > p.grade_from ? '–' + p.grade_to : ''}{p.status !== 'published' ? ' · nháp' : ''}</option>)}</select></label>
          <label className="field"><span>Khối *</span><select required value={mk.grade || ''} onChange={e => setMk({ ...mk, grade: Number(e.target.value) })}>
            {!mkProg && <option value="">—</option>}
            {mkProg && Array.from({ length: mkProg.grade_to - mkProg.grade_from + 1 }, (_, i) => mkProg.grade_from + i).map(g => <option key={g} value={g}>Khối {g}</option>)}</select></label>
          <label className="field"><span>Số tiết / tuần</span><input inputMode="decimal" value={mk.ppw} onChange={e => setMk({ ...mk, ppw: e.target.value })} placeholder="VD: 1 hoặc 1,5" /></label>
          <div className="formactions"><button className="primary" type="submit">Tạo PPCT nháp</button> <button type="button" onClick={() => setMk(null)}>Huỷ</button></div>
        </form>
      )}

      {book && (
        <>
          <div className={'panel allocbar' + ((cap1 != null && plan.hk1 > cap1) || (cap2 != null && plan.hk2 > cap2) ? ' warnbox' : '')}>
            <span>Chương trình (khối {book.grade}): <b>{unitTotal} tiết</b></span>
            <span>Đã chia: <b>{plan.total} tiết</b>{plan.total !== unitTotal && <small> ({plan.total > unitTotal ? '+' : ''}{plan.total - unitTotal} so với chương trình)</small>}</span>
            <span>HK I: <b className={cap1 != null && plan.hk1 > cap1 ? 'bad' : ''}>{plan.hk1}</b>{cap1 != null && <small> / sức chứa {fmt(cap1)}</small>}</span>
            <span>HK II: <b className={cap2 != null && plan.hk2 > cap2 ? 'bad' : ''}>{plan.hk2}</b>{cap2 != null && <small> / sức chứa {fmt(cap2)}</small>}</span>
            {!ppw && <small className="sub">Chưa nhập số tiết / tuần — không tính được sức chứa và tuần.</small>}
          </div>
          {leaves.length === 0 ? <div className="panel"><p className="sub" style={{ margin: 0 }}>Chương trình chưa có bài nào cho khối {book.grade}.</p></div> : (
            <div className="wrap"><table>
              <thead><tr><th>Chủ đề / bài trong chương trình</th><th>Tiết theo CT</th><th>Số tiết phân bổ</th><th>Học kỳ</th></tr></thead>
              <tbody>{tree.map(({ u, depth, leaf }) => {
                const a = get(u)
                return leaf ? (
                  <tr key={u.id}>
                    <td style={{ paddingLeft: 12 + depth * 18 }}>{u.title}</td>
                    <td>{u.periods}</td>
                    <td><input type="number" min={0} max={200} disabled={!canEdit} value={a.periods} style={{ width: 72 }} aria-label={`Số tiết ${u.title}`}
                      onChange={e => set([u.id], { periods: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })} /></td>
                    <td><select disabled={!canEdit} value={a.term ?? ''} aria-label={`Học kỳ ${u.title}`} onChange={e => set([u.id], { term: (Number(e.target.value) || null) as 1 | 2 | null })}>
                      <option value="">Tự động ({a.periods ? (plan.term.get(u.id) === 2 ? 'HK II' : 'HK I') : '—'})</option><option value="1">HK I</option><option value="2">HK II</option></select></td>
                  </tr>
                ) : (
                  <tr key={u.id} className="grouprow">
                    <td style={{ paddingLeft: 12 + depth * 18 }}><b>{u.title}</b></td>
                    <td><small>{leafIds(u.id).reduce((s, id) => s + (units.find(x => x.id === id)?.periods ?? 0), 0)}</small></td>
                    <td><small>{leafIds(u.id).reduce((s, id) => { const x = units.find(v => v.id === id); return s + (x ? get(x).periods : 0) }, 0)}</small></td>
                    <td>{canEdit && <select value="" aria-label={`Học kỳ cả ${u.title}`} onChange={e => e.target.value && set(leafIds(u.id), { term: e.target.value === 'auto' ? null : (Number(e.target.value) as 1 | 2) })}>
                      <option value="">Cả chủ đề…</option><option value="1">→ HK I</option><option value="2">→ HK II</option><option value="auto">→ Tự động</option></select>}</td>
                  </tr>
                )
              })}</tbody>
            </table></div>
          )}
          {canEdit && leaves.length > 0 && (
            <div className="bar" style={{ marginTop: 12 }}>
              <div className="tools">
                <label><input type="checkbox" checked={review} onChange={e => setReview(e.target.checked)} /> Thêm tiết ôn tập cuối mỗi học kỳ</label>
                <label><input type="checkbox" checked={test} onChange={e => setTest(e.target.checked)} /> Thêm tiết kiểm tra cuối mỗi học kỳ</label>
              </div>
              <div className="tools">
                <button onClick={() => setAlloc(new Map())}>Về số tiết theo chương trình</button>
                <button className="primary" disabled={busy} onClick={generate}>{busy ? 'Đang sinh…' : lessons ? `Sinh lại PPCT (${lessons} tiết hiện có)` : 'Sinh PPCT'}</button>
              </div>
            </div>
          )}
        </>
      )}
      {dialog}
      {!book && books.length === 0 && <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có PPCT nào gắn chương trình giáo dục{mode === 'school' && yname ? ` trong năm học ${yname}` : ''}.{canEdit && ' Bấm "Tạo PPCT từ chương trình" để bắt đầu.'}</p></div>}
    </>
  )
}


// ================= Lịch dự kiến (072) =================
type CalWeek = { cal: number; week: number | null; term: number; starts_on: string; ends_on: string; off_days: number; holiday: string | null }
type PLesson = { id: string; seq: number; week: number | null; term: number | null; title: string; kind: keyof typeof KIND }
type Sess = { id: string; session_date: string; status: string; subject: string; curriculum_lesson_id: string | null }
const dm = (d: string) => d.slice(8, 10) + '/' + d.slice(5, 7)
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
const today = () => { const x = new Date(); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10) }
const MONTH = (d: string) => `Tháng ${Number(addDays(d, 2).slice(5, 7))}/${addDays(d, 2).slice(0, 4)}`

export function Schedule({ orgId, mode = 'school', year, years }: { orgId: string | null; mode?: PpctMode; year?: { name: string } | null; years?: Year[] }) {
  const canEdit = useCanEdit(mode)
  const names = yearNames(years)
  const [yname, setYname] = useState<string>(mode === 'school' ? year?.name ?? names[0] ?? '' : '')
  const [books, setBooks] = useState<Book[]>([])
  const [bookId, setBookId] = useState('')
  const [lessons, setLessons] = useState<PLesson[] | null>(null)
  const [cal, setCal] = useState<CalWeek[]>([])
  const [view, setView] = useState<'week' | 'month'>('week')
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [classId, setClassId] = useState('')
  const [sess, setSess] = useState<Sess[]>([])
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const { ask, dialog } = useReasonDialog()

  useEffect(() => {
    if (!orgId) return
    let q = supabase.from('curriculum_books').select('*').eq('org_id', orgId).order('grade').order('subject')
    if (mode === 'school' && yname) q = q.eq('year_name', yname)
    q.then(({ data, error }) => {
      if (error) setMsg([errText(error.message), true])
      const bs = (data as Book[]) ?? []
      setBooks(bs); setBookId(cur => (bs.some(b => b.id === cur) ? cur : bs[0]?.id ?? ''))
    })
  }, [orgId, yname])
  const book = books.find(b => b.id === bookId) ?? null

  async function loadLessons() {
    if (!book) { setLessons([]); return }
    const [l, c] = await Promise.all([
      supabase.from('curriculum_lessons').select('id, seq, week, term, title, kind').eq('book_id', book.id).order('seq'),
      book.year_name ? supabase.rpc('curriculum_calendar', { p_org: book.org_id, p_year: book.year_name }) : Promise.resolve({ data: [] }),
    ])
    setLessons((l.data as PLesson[]) ?? []); setCal(((c as any).data as CalWeek[]) ?? [])
  }
  useEffect(() => { loadLessons() }, [bookId])
  useEffect(() => {
    setClassId(''); setSess([])
    if (!book || mode !== 'school') { setClasses([]); return }
    supabase.from('classes').select('id, name').eq('org_id', book.org_id).eq('grade', book.grade).order('name').then(({ data }) => setClasses((data as { id: string; name: string }[]) ?? []))
  }, [bookId])
  useEffect(() => {
    if (!classId || !book || cal.length === 0) { setSess([]); return }
    supabase.from('teaching_sessions').select('id, session_date, status, subject, curriculum_lesson_id').eq('class_id', classId)
      .gte('session_date', cal[0].starts_on).lte('session_date', cal[cal.length - 1].ends_on).order('session_date')
      .then(({ data }) => setSess(((data as Sess[]) ?? []).filter(s => norm(s.subject) === norm(book.subject) && s.status !== 'cancelled')))
  }, [classId, cal])

  // Ngày dự kiến của từng tiết: tiết thứ k của tuần ↔ buổi dạy thứ k của môn trong tuần (theo thời khóa biểu của lớp)
  const dates = useMemo(() => {
    const m = new Map<string, { date: string; done: boolean }>()
    if (!lessons) return m
    for (const s of sess) if (s.curriculum_lesson_id && s.status === 'taught') m.set(s.curriculum_lesson_id, { date: s.session_date, done: true })
    for (const w of cal) {
      if (w.week == null) continue
      const ls = lessons.filter(l => l.week === w.week && !m.has(l.id))
      const ss = sess.filter(s => s.session_date >= w.starts_on && s.session_date <= w.ends_on && !(s.status === 'taught' && s.curriculum_lesson_id))
      ls.forEach((l, i) => { if (ss[i]) m.set(l.id, { date: ss[i].session_date, done: false }) })
    }
    return m
  }, [lessons, sess, cal])

  async function reschedule() {
    if (!book) return
    if (book.status !== 'published' && !confirm(`Xếp lại tuần cho các tiết chưa dạy của "${book.title}" theo ${book.periods_per_week ?? '?'} tiết / tuần, bắt đầu từ tuần hiện tại?`)) return
    const reason = await ask(book, 'xếp lại lịch')
    if (reason === null) return
    const { data, error } = await supabase.rpc('curriculum_reschedule', { p_book: book.id, p_reason: reason ? reason.text || REASONS[reason.code] : null, p_reason_code: reason?.code ?? null })
    if (error) return setMsg([errText(error.message), true])
    setMsg([data ? `Đã xếp lại tuần cho ${data} tiết.` : 'Lịch đã khớp, không có tiết nào cần dời.', false]); loadLessons()
  }
  function exportXlsx() {
    if (!book || !lessons) return
    const ws = new Map(cal.filter(c => c.week != null).map(c => [c.week as number, c]))
    downloadXlsx(`Lich-du-kien ${book.title}`, [
      { key: 'w', label: 'Tuần' }, { key: 'd', label: 'Từ – đến', width: 16 }, { key: 'h', label: 'Học kỳ' }, { key: 's', label: 'Tiết' },
      { key: 't', label: 'Tên bài / nội dung', width: 44 }, { key: 'k', label: 'Loại tiết', width: 14 }, { key: 'x', label: 'Ngày dự kiến' },
    ], lessons.map(l => {
      const w = l.week ? ws.get(l.week) : undefined, d = dates.get(l.id)
      return [l.week, w ? `${dm(w.starts_on)}–${dm(addDays(w.starts_on, 4))}` : '', l.term === 2 ? 'HK II' : l.term === 1 ? 'HK I' : '', l.seq, l.title, KIND[l.kind], d ? dm(d.date) : '']
    }), book.title)
  }

  const now = today()
  const ls = lessons ?? []
  const byWeek = (w: number) => ls.filter(l => l.week === w)
  const maxWeek = cal.reduce((m, c) => Math.max(m, c.week ?? 0), 0)
  const loose = ls.filter(l => l.week == null || (cal.length > 0 && l.week > maxWeek))
  const plainWeeks = [...new Set(ls.map(l => l.week).filter((w): w is number => w != null))].sort((a, b) => a - b)
  const months = useMemo(() => {
    const out: [string, CalWeek[]][] = []
    for (const w of cal) { const k = MONTH(w.starts_on); const last = out[out.length - 1]; if (last && last[0] === k) last[1].push(w); else out.push([k, [w]]) }
    return out
  }, [cal])
  const ppw = Number(book?.periods_per_week) || 0
  const lessonLine = (l: PLesson) => {
    const d = dates.get(l.id)
    return (
      <li key={l.id}><b>Tiết {l.seq}</b> · {l.title}{l.kind !== 'lesson' && <> <span className="gpill">{KIND[l.kind]}</span></>}
        {d && <small className={d.done ? 'good' : 'sub'}> · {d.done ? 'đã dạy' : 'dự kiến'} {dm(d.date)}</small>}</li>
    )
  }

  return (
    <>
      <p className="sub">Lịch dự kiến của PPCT theo tuần học: tuần 1 là tuần khai giảng, tuần nghỉ cả tuần (lễ, Tết) không tính số tuần. Chọn lớp để xem ngày dự kiến theo thời khóa biểu.</p>
      <div className="bar">
        <div className="tools">
          {mode === 'school' && <select value={yname} onChange={e => setYname(e.target.value)} aria-label="Năm học">{names.map(n => <option key={n}>{n}</option>)}</select>}
          <select value={bookId} onChange={e => setBookId(e.target.value)} aria-label="PPCT" style={{ maxWidth: 320 }}>
            {books.length === 0 && <option value="">Chưa có PPCT</option>}
            {books.map(b => <option key={b.id} value={b.id}>Khối {b.grade} · {b.subject} — {b.title}</option>)}
          </select>
          {classes.length > 0 && <select value={classId} onChange={e => setClassId(e.target.value)} aria-label="Lớp"><option value="">— Ngày theo lớp —</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
          {cal.length > 0 && <div className="segmented" style={{ margin: 0 }}>
            <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>Theo tuần</button>
            <button className={view === 'month' ? 'on' : ''} onClick={() => setView('month')}>Theo tháng</button>
          </div>}
        </div>
        <div className="tools">
          {ls.length > 0 && <button onClick={exportXlsx}>Xuất Excel</button>}
          {canEdit && book && book.org_id === orgId && ls.length > 0 && <button className="primary" disabled={!ppw} title={ppw ? '' : 'Nhập số tiết / tuần của PPCT trước'} onClick={reschedule}>Xếp lại lịch</button>}
        </div>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {dialog}

      {!book ? <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có PPCT{mode === 'school' && yname ? ` trong năm học ${yname}` : ''}.</p></div>
        : lessons === null ? <p className="sub">Đang tải…</p>
        : cal.length === 0 ? (
          <>
            <p className="sub">{mode === 'school' ? 'Năm học chưa có ngày bắt đầu — lịch chỉ hiện theo số tuần.' : 'Mẫu PPCT không gắn năm học — lịch hiện theo số tuần.'}</p>
            <div className="calweeks">{plainWeeks.map(w => (
              <div key={w} className="calweek"><div className="calhead"><b>Tuần {w}</b></div><ul>{byWeek(w).map(lessonLine)}</ul></div>
            ))}</div>
          </>
        ) : view === 'week' ? (
          <div className="calweeks">{cal.map(w => {
            const cur = now >= w.starts_on && now <= w.ends_on, items = w.week != null ? byWeek(w.week) : []
            return (
              <div key={w.cal} className={'calweek' + (cur ? ' cur' : '') + (w.week == null ? ' off' : '')}>
                <div className="calhead">
                  <b>{w.week != null ? `Tuần ${w.week}` : 'Nghỉ'}</b>
                  <small>{dm(w.starts_on)}–{dm(addDays(w.starts_on, 4))} · HK {w.term === 2 ? 'II' : 'I'}{cur ? ' · tuần này' : ''}</small>
                  {w.holiday && <small className="warn">{w.week != null ? `Nghỉ ${w.off_days} ngày: ` : ''}{w.holiday}</small>}
                  {ppw > 0 && w.week != null && items.length > Math.ceil(ppw) && <small className="bad">{items.length} tiết / tuần (định mức {fmt(ppw)})</small>}
                </div>
                {items.length > 0 ? <ul>{items.map(lessonLine)}</ul> : w.week != null && <small className="sub">Không có tiết</small>}
              </div>
            )
          })}</div>
        ) : (
          <div className="calmonths">{months.map(([m, ws]) => {
            const n = ws.reduce((s, w) => s + (w.week != null ? byWeek(w.week).length : 0), 0)
            return (
              <div key={m} className="panel calmonth">
                <h3>{m} <small className="sub">{n} tiết</small></h3>
                {ws.map(w => (
                  <div key={w.cal} className={'calmrow' + (now >= w.starts_on && now <= w.ends_on ? ' cur' : '')}>
                    <span className="calmw">{w.week != null ? `T${w.week}` : 'Nghỉ'}<small>{dm(w.starts_on)}</small></span>
                    <span>{w.week == null ? <small className="warn">{w.holiday}</small>
                      : byWeek(w.week).map(l => l.title).join(' · ') || <small className="sub">—</small>}</span>
                  </div>
                ))}
              </div>
            )
          })}</div>
        )}
      {loose.length > 0 && cal.length > 0 && (
        <div className="panel warnbox" style={{ marginTop: 12 }}>
          <b>{loose.length} tiết chưa có tuần hoặc nằm ngoài năm học</b>{canEdit && ppw > 0 && ' — bấm "Xếp lại lịch" để xếp tuần.'}
          <ul>{loose.slice(0, 10).map(lessonLine)}</ul>
        </div>
      )}
    </>
  )
}

// ================= Gán chương trình cho trường (KDI / Sở, 073) =================
type Cov = { org_id: string; school: string; area: string | null; assigned: boolean; grades: number[] | null; books: number; classes: number }
type Org = { id: string; name: string; type: string; parent_id: string | null }

export function AssignPrograms({ orgId, mode = 'authority' }: { orgId: string | null; mode?: PpctMode }) {
  const canEdit = useCanEdit(mode)
  const programs = usePrograms(orgId)
  const [progId, setProgId] = useState('')
  const [orgs, setOrgs] = useState<Org[]>([])
  const [cov, setCov] = useState<Map<string, Cov>>(new Map())
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [grades, setGrades] = useState<number[]>([])
  const [make, setMake] = useState(true)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | 'assigned' | 'not'>('all')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [busy, setBusy] = useState(false)
  const prog = programs.find(p => p.id === progId)

  useEffect(() => { if (!progId && programs[0]) setProgId(programs[0].id) }, [programs])
  useEffect(() => {
    supabase.from('organizations').select('id, name, type, parent_id').order('name').then(({ data }) => setOrgs((data as Org[]) ?? []))
  }, [orgId])
  async function loadCov() {
    if (!progId) return
    const { data, error } = await supabase.rpc('edu_program_coverage', { p_program: progId })
    if (error) setMsg([errText(error.message), true])
    setCov(new Map(((data as Cov[]) ?? []).map(c => [c.org_id, c])))
  }
  useEffect(() => { loadCov(); setSel(new Set()); setGrades(prog ? range(prog.grade_from, prog.grade_to) : []) }, [progId, prog?.id])

  const byId = useMemo(() => new Map(orgs.map(o => [o.id, o])), [orgs])
  const schools = orgs.filter(o => o.type === 'school' && o.id !== orgId)
  const area = (o: Org) => (o.parent_id ? byId.get(o.parent_id)?.name ?? '' : '')
  const shown = schools.filter(o => {
    const c = cov.get(o.id)
    if (only === 'assigned' && !c?.assigned) return false
    if (only === 'not' && c?.assigned) return false
    return !q || norm(o.name + ' ' + area(o)).includes(norm(q))
  })
  const toggle = (id: string, on: boolean) => setSel(s => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })

  async function assign() {
    if (!prog || sel.size === 0) return
    if (!confirm(`Gán "${prog.title}" (khối ${grades.join(', ') || 'mọi khối'}) cho ${sel.size} trường${make ? ' và tạo sẵn PPCT nháp cho các trường' : ''}?`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('edu_program_assign_bulk', { p_program: prog.id, p_orgs: [...sel], p_grades: grades, p_make_books: make, p_note: null })
    setBusy(false)
    if (error) return setMsg([errText(error.message), true])
    const r = data as { assigned: number; books: number }
    setMsg([`Đã gán cho ${r.assigned} trường${make ? `, tạo sẵn ${r.books} PPCT nháp (khối + môn đã có PPCT trong năm học thì giữ nguyên)` : ''}.`, false])
    setSel(new Set()); loadCov()
  }
  // Bỏ gán các trường đang chọn (chỉ trường đã được gán)
  async function unassign() {
    const ids = [...sel].filter(id => cov.get(id)?.assigned)
    if (!prog || !ids.length || !confirm(`Bỏ gán "${prog.title}" khỏi ${ids.length} trường? PPCT trường đã tạo vẫn giữ nguyên.`)) return
    const { error } = await supabase.from('edu_program_assignments').delete().eq('program_id', prog.id).in('org_id', ids)
    if (error) return setMsg([errText(error.message), true])
    setSel(new Set()); loadCov()
  }

  const vals = [...cov.values()]
  return (
    <>
      <p className="sub">Gán chương trình cho nhiều trường cùng lúc, chọn khối được học. Bật "Tạo sẵn PPCT nháp" để mỗi trường có ngay PPCT của từng khối, lấy từ mẫu PPCT đã ban hành{mode === 'authority' ? ' của Sở hoặc KDI' : ''} hoặc sinh từ chương trình.</p>
      <div className="bar">
        <div className="tools">
          <select value={progId} onChange={e => setProgId(e.target.value)} aria-label="Chương trình" style={{ maxWidth: 360 }}>
            {programs.length === 0 && <option value="">Chưa có chương trình</option>}
            {programs.map(p => <option key={p.id} value={p.id}>{p.title} (v{p.version_no}) · khối {p.grade_from}{p.grade_to > p.grade_from ? '–' + p.grade_to : ''}{p.status !== 'published' ? ' · nháp' : ''}</option>)}
          </select>
          <input placeholder="Tìm trường, địa bàn…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm trường" />
          <div className="segmented" style={{ margin: 0 }}>
            {([['all', 'Tất cả'], ['assigned', 'Đã gán'], ['not', 'Chưa gán']] as const).map(([k, l]) => <button key={k} className={only === k ? 'on' : ''} onClick={() => setOnly(k)}>{l}</button>)}
          </div>
        </div>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {prog && <Tiles items={[
        { label: 'Trường được gán', value: vals.filter(c => c.assigned).length, sub: `/${schools.length} trường` },
        { label: 'Trường đã có PPCT', value: vals.filter(c => c.books > 0).length, tone: 'good' },
        { label: 'Lớp đang học theo', value: vals.reduce((s, c) => s + c.classes, 0) },
        { label: 'Được gán, chưa có PPCT', value: vals.filter(c => c.assigned && c.books === 0).length, tone: vals.some(c => c.assigned && c.books === 0) ? 'bad' : '' },
      ]} />}
      {canEdit && prog && sel.size > 0 && prog.status !== 'published' && prog.org_id !== orgId && <p className="msg">Chỉ gán được chương trình đã ban hành.</p>}
      {canEdit && prog && (
        <div className="panel bar">
          <span className="tools">
            <b>Khối:</b>
            {range(prog.grade_from, prog.grade_to).map(g => <label key={g}><input type="checkbox" checked={grades.includes(g)} onChange={e => setGrades(gs => e.target.checked ? [...gs, g].sort((a, b) => a - b) : gs.filter(x => x !== g))} /> {g}</label>)}
            <label style={{ marginLeft: 12 }}><input type="checkbox" checked={make} onChange={e => setMake(e.target.checked)} /> Tạo sẵn PPCT nháp cho trường</label>
          </span>
          <span className="tools">
            <button className="danger" disabled={busy || ![...sel].some(id => cov.get(id)?.assigned)} onClick={unassign}>Bỏ gán</button>
            <button className="primary" disabled={busy || sel.size === 0} onClick={assign}>{busy ? 'Đang gán…' : `Gán cho ${sel.size} trường`}</button>
          </span>
        </div>
      )}
      {prog && (
        <div className="wrap"><table>
          <thead><tr>
            {canEdit && <th><input type="checkbox" aria-label="Chọn tất cả" checked={shown.length > 0 && shown.every(o => sel.has(o.id))} onChange={e => setSel(e.target.checked ? new Set(shown.map(o => o.id)) : new Set())} /></th>}
            <th>Trường</th><th>Địa bàn</th><th>Khối được gán</th><th>Số PPCT</th><th>Lớp đang theo</th></tr></thead>
          <tbody>{shown.map(o => {
            const c = cov.get(o.id)
            return (
              <tr key={o.id}>
                {canEdit && <td><input type="checkbox" checked={sel.has(o.id)} onChange={e => toggle(o.id, e.target.checked)} aria-label={`Chọn ${o.name}`} /></td>}
                <td><b>{o.name}</b></td><td><small>{area(o)}</small></td>
                <td>{c?.assigned ? (c.grades?.length ? 'Khối ' + c.grades.join(', ') : 'Mọi khối') : <small className="sub">Chưa gán</small>}</td>
                <td>{c?.books ? c.books : c?.assigned ? <span className="pill inactive">Chưa có</span> : '—'}</td>
                <td>{c?.classes || '—'}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
      )}
    </>
  )
}
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i)

// ================= Lớp × môn của trường (073) =================
type CovRow = { class_id: string; class_name: string; grade: number; subject: string; book_id: string; book_title: string; explicit: boolean }

export function ClassCoverage({ orgId, years }: { orgId: string | null; years?: Year[] }) {
  const canEdit = useCanEdit('school')
  const cur = (years ?? []).find(y => y.is_current)?.name ?? null
  const [rows, setRows] = useState<CovRow[]>([])
  const [classes, setClasses] = useState<{ id: string; name: string; grade: number }[]>([])
  const [books, setBooks] = useState<Book[]>([])
  const [asg, setAsg] = useState<{ grades: number[] | null; edu_programs: { main_subject: string; grade_from: number; grade_to: number } | null }[]>([])
  const [grade, setGrade] = useState(0)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [loaded, setLoaded] = useState(false)

  async function load() {
    if (!orgId) return
    const yearIds = (years ?? []).filter(y => y.name === cur).map(y => y.id)
    const [c, cl, b, a] = await Promise.all([
      supabase.rpc('curriculum_class_coverage', { p_org: orgId }),
      supabase.from('classes').select('id, name, grade, year_id').eq('org_id', orgId).order('grade').order('name'),
      supabase.from('curriculum_books').select('*').eq('org_id', orgId),
      supabase.from('edu_program_assignments').select('grades, edu_programs(main_subject, grade_from, grade_to)').eq('org_id', orgId),
    ])
    if (c.error) setMsg([errText(c.error.message), true])
    setRows((c.data as CovRow[]) ?? [])
    setClasses(((cl.data as { id: string; name: string; grade: number; year_id: string | null }[]) ?? []).filter(x => !x.year_id || yearIds.length === 0 || yearIds.includes(x.year_id)))
    setBooks(((b.data as Book[]) ?? []).filter(x => !cur || !x.year_name || x.year_name === cur))
    setAsg((a.data as any[]) ?? [])
    setLoaded(true)
  }
  useEffect(() => { load() }, [orgId, cur])

  const want = (g: number, s: string) =>
    books.some(b => b.grade === g && norm(b.subject) === norm(s)) ||
    asg.some(a => a.edu_programs && norm(a.edu_programs.main_subject) === norm(s) && (a.grades?.length ? a.grades.includes(g) : a.edu_programs.grade_from <= g && g <= a.edu_programs.grade_to))
  const subjects = [...new Set([...books.map(b => b.subject), ...asg.map(a => a.edu_programs?.main_subject).filter((s): s is string => !!s)])].sort((a, b) => a.localeCompare(b, 'vi'))
  const grades = [...new Set(classes.map(c => c.grade))].sort((a, b) => a - b)
  const shown = classes.filter(c => !grade || c.grade === grade)
  const cell = (cid: string, s: string) => rows.find(r => r.class_id === cid && norm(r.subject) === norm(s))
  let need = 0, have = 0
  for (const c of classes) for (const s of subjects) if (want(c.grade, s)) { need++; if (cell(c.id, s)) have++ }

  async function change(c: { id: string; name: string }, s: string, bookId: string) {
    const { error } = await supabase.rpc('curriculum_set_class_book', { p_class: c.id, p_subject: s, p_book: bookId || null })
    if (error) return setMsg([errText(error.message), true])
    setMsg([`Đã đổi PPCT môn ${s} của lớp ${c.name}.`, false]); load()
  }

  return (
    <>
      <p className="sub">Mỗi ô là PPCT mà lớp đang học theo trong năm học {cur ?? 'hiện tại'}. Ô đỏ là môn khối đó cần học (đã có PPCT hoặc được gán chương trình) nhưng lớp chưa có PPCT đang dùng. "Riêng" là PPCT chọn riêng cho lớp. PPCT không chọn lớp nào áp dụng cho mọi lớp còn lại của khối.</p>
      <div className="bar">
        {grades.length > 1 && <div className="segmented" style={{ margin: 0 }}>
          {[0, ...grades].map(g => <button key={g} className={grade === g ? 'on' : ''} onClick={() => setGrade(g)}>{g ? `Khối ${g}` : 'Tất cả'}</button>)}
        </div>}
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {!loaded ? <p className="sub">Đang tải…</p> : (
        <>
          <Tiles items={[
            { label: 'Số lớp', value: classes.length, sub: `${subjects.length} môn` },
            { label: 'Ô đã có PPCT', value: have, sub: need ? `${Math.round(have * 100 / need)}%` : '', tone: 'good' },
            { label: 'Ô còn thiếu', value: need - have, tone: need > have ? 'bad' : '' },
          ]} />
          {subjects.length === 0 ? <div className="panel"><p className="sub" style={{ margin: 0 }}>Trường chưa có PPCT nào trong năm học này.</p></div> : (
            <div className="wrap"><table className="yearplan">
              <thead><tr><th>Lớp</th>{subjects.map(s => <th key={s}>{s}</th>)}</tr></thead>
              <tbody>{shown.map(c => (
                <tr key={c.id}><td><b>{c.name}</b><br /><small>Khối {c.grade}</small></td>
                  {subjects.map(s => {
                    const r = cell(c.id, s), opts = books.filter(b => b.grade === c.grade && norm(b.subject) === norm(s) && b.status === 'published')
                    if (!r && !want(c.grade, s)) return <td key={s}><small className="sub">—</small></td>
                    return (
                      <td key={s}>
                        <div className={'ypcell' + (r ? '' : ' over')} style={{ cursor: 'default' }}>
                          {r ? <><b>{r.book_title}</b>{r.explicit && <small>Riêng cho lớp</small>}</> : <small className="bad">Chưa có PPCT đang dùng</small>}
                          {canEdit && opts.length > 0 && (
                            <select value={r?.explicit ? r.book_id : ''} onChange={e => change(c, s, e.target.value)} aria-label={`PPCT môn ${s} lớp ${c.name}`}>
                              <option value="">PPCT chung của khối</option>
                              {opts.map(b => <option key={b.id} value={b.id}>Riêng: {b.title}</option>)}
                            </select>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
    </>
  )
}

// ================= Kế hoạch so với thực hiện (074) =================
type WeekRow = { week: number; month: string | null; term: number | null; planned: number; taught: number }
type ProgRow = { school: string; area: string | null; class_name: string; grade: number; subject: string; book_id: string; book_title: string; total: number; week: number | null;
  planned: number; reached: number; taught: number; gap: number; missed: number; no_evidence: number }

// Biểu đồ đường: tiết kế hoạch cộng dồn (nét đứt) và tiết đã dạy cộng dồn (nét liền) theo tuần học
function PlanChart({ rows, upTo }: { rows: WeekRow[]; upTo: number | null }) {
  const W = 720, H = 240, L = 40, R = 12, T = 14, B = 28
  let p = 0, t = 0
  const pts = rows.map(r => { p += r.planned; t += r.taught; return { w: r.week, p, t } })
  const max = Math.max(1, ...pts.map(x => Math.max(x.p, x.t)))
  const n = Math.max(1, rows.length)
  const x = (w: number) => L + ((w - 1) / Math.max(1, n - 1)) * (W - L - R)
  const y = (v: number) => T + (1 - v / max) * (H - T - B)
  const last = upTo ?? Math.max(0, ...rows.filter(r => r.taught > 0).map(r => r.week))
  const line = (k: 'p' | 't', lim?: number) => pts.filter(q => lim == null || q.w <= lim).map((q, i) => `${i ? 'L' : 'M'}${x(q.w).toFixed(1)},${y(q[k]).toFixed(1)}`).join(' ')
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(max * f))
  const cur = pts.find(q => q.w === last)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="planchart" role="img" aria-label="Biểu đồ tiết kế hoạch và tiết đã dạy cộng dồn theo tuần">
      {ticks.map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 6} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
      {rows.filter(r => r.week === 1 || r.week % 4 === 0).map(r => <text key={r.week} x={x(r.week)} y={H - 8} textAnchor="middle">T{r.week}</text>)}
      {last > 0 && <line x1={x(last)} x2={x(last)} y1={T} y2={H - B} className="now" />}
      <path d={line('p')} className="plan" />
      <path d={line('t', last || undefined)} className="done" />
      {cur && <>
        <circle cx={x(cur.w)} cy={y(cur.t)} r={4} className="donept" />
        <text x={x(cur.w) + 6} y={y(cur.t) - 6} className="lbl">{cur.t} / {cur.p} tiết</text>
      </>}
    </svg>
  )
}

export function PlanVsActual({ orgId, mode = 'school' }: { orgId: string | null; mode?: PpctMode }) {
  const canEdit = useCanEdit(mode)
  const [grade, setGrade] = useState(0)
  const [classId, setClassId] = useState('')
  const [classes, setClasses] = useState<{ id: string; name: string; grade: number }[]>([])
  const [rows, setRows] = useState<WeekRow[] | null>(null)
  const [cur, setCur] = useState<number | null>(null)
  const [reasons, setReasons] = useState<Map<string, number>>(new Map())
  const [alert, setAlert] = useState<{ lag_threshold: number; enabled: boolean }>({ lag_threshold: 3, enabled: true })
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const scope = mode === 'school' ? orgId : null

  useEffect(() => {
    if (mode !== 'school' || !orgId) return
    supabase.from('classes').select('id, name, grade').eq('org_id', orgId).order('grade').order('name').then(({ data }) => setClasses((data as typeof classes) ?? []))
    supabase.from('curriculum_alert_settings').select('lag_threshold, enabled').eq('org_id', orgId).maybeSingle().then(({ data }) => { if (data) setAlert(data as typeof alert) })
    supabase.from('academic_years').select('name').eq('org_id', orgId).eq('is_current', true).limit(1).then(async ({ data }) => {
      const y = ((data as { name: string }[]) ?? [])[0]?.name
      if (!y) return
      const { data: w } = await supabase.rpc('curriculum_week_of', { p_org: orgId, p_year: y, p_day: new Date().toISOString().slice(0, 10) })
      setCur((w as number | null) ?? null)
    })
  }, [orgId, mode])
  useEffect(() => {
    setRows(null)
    supabase.rpc('curriculum_weekly', { p_org: scope, p_class: classId || null, p_grade: grade || null }).then(({ data, error }) => {
      if (error) setMsg([errText(error.message), true])
      setRows((data as WeekRow[]) ?? [])
    })
    let q = supabase.from('curriculum_changes').select('reason_code, action').in('action', ['update', 'delete', 'insert', 'import', 'reschedule', 'shift', 'swap', 'makeup'])
    if (scope) q = q.eq('org_id', scope)
    q.limit(5000).then(({ data }) => {
      const m = new Map<string, number>()
      for (const r of (data as { reason_code: string | null }[]) ?? []) m.set(r.reason_code ?? 'none', (m.get(r.reason_code ?? 'none') ?? 0) + 1)
      setReasons(m)
    })
  }, [scope, classId, grade])

  const rs = rows ?? []
  const upTo = cur ?? (rs.some(r => r.taught > 0) ? Math.max(...rs.filter(r => r.taught > 0).map(r => r.week)) : null)
  const sumTo = (k: 'planned' | 'taught', f: (r: WeekRow) => boolean) => rs.filter(f).reduce((s, r) => s + r[k], 0)
  const planNow = sumTo('planned', r => upTo == null || r.week <= upTo), doneNow = sumTo('taught', () => true)
  const months = useMemo(() => {
    const m = new Map<string, { planned: number; taught: number }>()
    for (const r of rs) { const k = r.month ?? '—'; const v = m.get(k) ?? { planned: 0, taught: 0 }; v.planned += r.planned; v.taught += r.taught; m.set(k, v) }
    return [...m.entries()]
  }, [rows])
  const terms = [1, 2].map(t => ({ t, planned: sumTo('planned', r => (r.term ?? 1) === t), due: sumTo('planned', r => (r.term ?? 1) === t && (upTo == null || r.week <= upTo)), taught: sumTo('taught', r => (r.term ?? 1) === t) }))
  const pct = (a: number, b: number) => (b ? Math.round((a * 100) / b) + '%' : '—')

  async function saveAlert() {
    if (!orgId) return
    const { error } = await supabase.from('curriculum_alert_settings').upsert({ org_id: orgId, lag_threshold: alert.lag_threshold, enabled: alert.enabled, updated_at: new Date().toISOString() })
    setMsg(error ? [errText(error.message), true] : ['Đã lưu ngưỡng cảnh báo.', false])
  }
  async function sendNow() {
    const { data, error } = await supabase.rpc('curriculum_lag_alerts')
    setMsg(error ? [errText(error.message), true] : [data ? `Đã gửi cảnh báo cho ${data} lớp × môn đang chậm.` : 'Không có lớp nào chậm quá ngưỡng (hoặc đã được nhắc trong 7 ngày qua).', false])
  }
  async function exportReport() {
    const { data, error } = await supabase.rpc('curriculum_progress', { p_org: scope })
    if (error) return setMsg([errText(error.message), true])
    const list = ((data as ProgRow[]) ?? []).filter(r => (!grade || r.grade === grade))
    const { data: ch } = await supabase.from('curriculum_changes').select('book_id').in('book_id', [...new Set(list.map(r => r.book_id))])
    const cnt = new Map<string, number>(); for (const c of (ch as { book_id: string }[]) ?? []) cnt.set(c.book_id, (cnt.get(c.book_id) ?? 0) + 1)
    downloadXlsx('Bao-cao-thuc-hien-PPCT', [
      { key: 's', label: 'Trường', width: 28 }, { key: 'a', label: 'Địa bàn', width: 20 }, { key: 'c', label: 'Lớp' }, { key: 'm', label: 'Môn', width: 18 },
      { key: 'b', label: 'PPCT', width: 30 }, { key: 'n', label: 'Tổng số tiết' }, { key: 'w', label: 'Tuần hiện tại' }, { key: 'p', label: 'Kế hoạch đến nay' },
      { key: 'r', label: 'Đã dạy tới tiết' }, { key: 't', label: 'Số tiết đã dạy' }, { key: 'g', label: 'Chênh lệch (+ chậm)' }, { key: 'x', label: 'Tỉ lệ hoàn thành' },
      { key: 'k', label: 'Tiết bỏ qua / chậm' }, { key: 'e', label: 'Thiếu minh chứng' }, { key: 'd', label: 'Số lần điều chỉnh PPCT' },
    ], list.map(r => [r.school, r.area, r.class_name, r.subject, r.book_title, r.total, r.week, r.planned, r.reached, r.taught, r.gap, pct(r.reached, r.planned), r.missed, r.no_evidence, cnt.get(r.book_id) ?? 0]), 'Thực hiện PPCT')
  }

  const grades = [...new Set(classes.map(c => c.grade))]
  const reasonList = [...reasons.entries()].sort((a, b) => b[1] - a[1])
  return (
    <div className="panel">
      <div className="bar">
        <h3 style={{ margin: 0 }}>Kế hoạch so với thực hiện</h3>
        <div className="tools">
          {mode === 'school' && <>
            <select value={grade} onChange={e => { setGrade(Number(e.target.value)); setClassId('') }} aria-label="Khối"><option value={0}>Cả trường</option>{grades.map(g => <option key={g} value={g}>Khối {g}</option>)}</select>
            <select value={classId} onChange={e => setClassId(e.target.value)} aria-label="Lớp"><option value="">Mọi lớp</option>{classes.filter(c => !grade || c.grade === grade).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </>}
          {mode !== 'school' && <select value={grade} onChange={e => setGrade(Number(e.target.value))} aria-label="Khối"><option value={0}>Mọi khối</option>{range(1, 12).map(g => <option key={g} value={g}>Khối {g}</option>)}</select>}
          <button onClick={exportReport}>Xuất báo cáo học kỳ</button>
        </div>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {rows === null ? <p className="sub">Đang tải…</p> : rs.length === 0 || rs.every(r => !r.planned) ? <p className="sub" style={{ margin: 0 }}>Chưa có PPCT đang dùng nào có tiết theo tuần trong phạm vi này.</p> : (
        <>
          <Tiles items={[
            { label: upTo ? `Kế hoạch đến tuần ${upTo}` : 'Kế hoạch', value: planNow, sub: `cả năm ${sumTo('planned', () => true)} tiết` },
            { label: 'Đã dạy', value: doneNow, sub: pct(doneNow, planNow) + ' kế hoạch đến nay', tone: doneNow >= planNow ? 'good' : '' },
            { label: 'Chênh lệch', value: planNow - doneNow > 0 ? `chậm ${planNow - doneNow}` : 'đúng / vượt', tone: planNow - doneNow > 0 ? 'bad' : 'good' },
          ]} />
          <div className="chartlegend"><span className="k plan" /> Kế hoạch cộng dồn <span className="k done" /> Đã dạy cộng dồn {upTo ? <small className="sub">· vạch dọc: tuần {upTo}</small> : null}</div>
          <PlanChart rows={rs} upTo={upTo} />
          <div className="pvgrid">
            <div>
              <h4>Theo học kỳ</h4>
              <table><thead><tr><th>Học kỳ</th><th>Kế hoạch</th><th>Đến nay</th><th>Đã dạy</th><th>Hoàn thành</th></tr></thead>
                <tbody>{terms.map(t => <tr key={t.t}><td>HK {t.t === 1 ? 'I' : 'II'}</td><td>{t.planned}</td><td>{t.due}</td><td>{t.taught}</td><td>{pct(t.taught, t.due)}</td></tr>)}</tbody></table>
            </div>
            <div>
              <h4>Theo tháng</h4>
              <table><thead><tr><th>Tháng</th><th>Kế hoạch</th><th>Đã dạy</th></tr></thead>
                <tbody>{months.map(([m, v]) => <tr key={m}><td>{m === '—' ? '—' : `${m.slice(5)}/${m.slice(0, 4)}`}</td><td>{v.planned}</td><td className={v.taught < v.planned && m <= new Date().toISOString().slice(0, 7) ? 'bad' : ''}>{v.taught}</td></tr>)}</tbody></table>
            </div>
            <div>
              <h4>Lý do điều chỉnh</h4>
              {reasonList.length === 0 ? <small className="sub">Chưa có điều chỉnh nào.</small> : (
                <table><tbody>{reasonList.map(([k, v]) => <tr key={k}><td>{k === 'none' ? <small className="sub">Không ghi mã lý do</small> : REASONS[k as ReasonCode] ?? k}</td><td><b>{v}</b></td></tr>)}</tbody></table>
              )}
            </div>
          </div>
        </>
      )}
      {mode === 'school' && canEdit && (
        <div className="bar" style={{ marginTop: 12 }}>
          <span className="tools">
            <label><input type="checkbox" checked={alert.enabled} onChange={e => setAlert({ ...alert, enabled: e.target.checked })} /> Tự cảnh báo khi lớp chậm từ</label>
            <input type="number" min={1} max={50} value={alert.lag_threshold} onChange={e => setAlert({ ...alert, lag_threshold: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 64 }} aria-label="Ngưỡng tiết chậm" /> tiết
            <button onClick={saveAlert}>Lưu</button>
          </span>
          <button onClick={sendNow}>Gửi cảnh báo ngay</button>
        </div>
      )}
    </div>
  )
}
