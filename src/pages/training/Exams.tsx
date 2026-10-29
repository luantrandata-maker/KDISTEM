// Phân hệ 1 › Kiểm tra & luyện tập (110): một chỗ xem mọi đề của tập huấn.
// Đề kiểm tra: bài test nội dung + đề cuối khoá của mọi chương trình (bấm để soạn trong chương trình).
// Đề luyện: đề tự luyện cho giáo viên, không tính điểm tập huấn. Kết quả & câu khó: điểm theo đề, câu hay sai.
import { TryButton, type TrySpec } from '../../components/ExamTryout'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Drawer } from '../../components/Drawer'
import { ExamMatrix, levelName, matrixText, matrixTotal, useBankSubjects, type MRow } from '../../components/ExamMatrix'
import { MultiFilters, opts, useMultiFilters, type FilterDef } from '../../components/MultiFilters'
import { downloadXlsx } from '../../lib/sheet'
import { Chip } from '../dist/Editor'
import { ProgramDetail, STATUS, type Status } from './Programs'
import type { FinalExam } from './ExamFrame'

type Prog = { id: string; org_id: string; code: string; title: string; status: Status; version_no: number; family_id: string; pass_score: number | null; final_exam: FinalExam | null }
type TUnit = { id: string; program_id: string; parent_id: string | null; title: string; seq: number; detail: { test?: { kind?: string; qids?: string[]; count?: number; minutes?: number; attempts?: number; pass?: number } } | null }
type Stat = { kind: Kind; ref: string; program_id: string; title: string; attempts: number; teachers: number; avg_score: number | null; best_avg: number | null; pass: number | null; passed: number }
type Kind = 'unit' | 'final' | 'practice'
const KIND: Record<Kind, [string, string]> = { unit: ['Bài test nội dung', ''], final: ['Đề cuối khoá', 'warn'], practice: ['Đề luyện', 'good'] }
const OLD: Status[] = ['superseded', 'archived']
const num = (n: number | null | undefined) => (n == null ? '—' : String(Math.round(Number(n) * 100) / 100).replace('.', ','))
const ord = (p: Prog) => `${p.code} v${String(p.version_no).padStart(3, '0')}`

function useAdmin() {
  const [admin, setAdmin] = useState(false)
  useEffect(() => { supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data)) }, [])
  return admin
}
function usePrograms(rk: number) {
  const [progs, setProgs] = useState<Prog[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.from('training_programs').select('id, org_id, code, title, status, version_no, family_id, pass_score, final_exam').order('code').order('version_no', { ascending: false })
      .then(({ data, error }) => { if (error) setErr(error.message); setProgs((data as Prog[]) ?? []) })
  }, [rk])
  return { progs, err }
}
function useStats(rk: number) {
  const [stats, setStats] = useState<Stat[]>([])
  useEffect(() => { supabase.rpc('training_exam_stats').then(({ data }) => setStats((data as Stat[]) ?? [])) }, [rk])
  return stats
}
const progLabel = (p: Prog | undefined) => p ? <><small>{p.code} · v{p.version_no}</small> <Chip tone={STATUS[p.status]?.[1]}>{STATUS[p.status]?.[0]}</Chip><br /><small className="sub">{p.title}</small></> : '—'

// ===== Tab 1: Đề kiểm tra =====
// Cấu hình làm thử của một dòng đề (bài test nội dung chọn câu / đề cuối khoá)
const rowSpec = (r: { kind: 'unit' | 'final'; prog: Prog; unit: TUnit | null }): TrySpec | null => {
  if (r.kind === 'unit') { const t = r.unit?.detail?.test; return t && t.kind !== 'link' && t.qids?.length ? { kind: 'sample', qids: t.qids, count: t.count ?? null } : null }
  const fe = r.prog.final_exam
  return fe ? { kind: 'pick', subject: fe.subject, grade: fe.grade ?? null, matrix: fe.matrix ?? [], qids: fe.qids ?? [], shuffle: fe.shuffle !== false } : null
}
const Stop = ({ children }: { children: React.ReactNode }) => <span onClick={e => e.stopPropagation()}>{children}</span>
type Row = { key: string; kind: 'unit' | 'final'; prog: Prog; unit: TUnit | null; title: string; sub: string; cfg: string; missing: boolean }
export function TrainingExamList({ go }: { go?: (page: string) => void }) {
  const admin = useAdmin()
  const [rk, setRk] = useState(0)
  const { progs, err } = usePrograms(rk)
  const stats = useStats(rk)
  const [units, setUnits] = useState<TUnit[]>([])
  const [old, setOld] = useState(false)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<{ id: string; unit: string | null; final?: boolean } | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [add, setAdd] = useState(false)
  const f = useMultiFilters()
  useEffect(() => {
    supabase.from('training_program_units').select('id, program_id, parent_id, title, seq, detail').eq('kind', 'content').eq('has_test', true)
      .then(({ data }) => setUnits((data as TUnit[]) ?? []))
  }, [rk])
  const [subj, setSubj] = useState<Record<string, string>>({})
  useEffect(() => {
    const ids = [...new Set(units.map(u => u.parent_id).filter(Boolean) as string[])]
    if (!ids.length) return
    supabase.from('training_program_units').select('id, title').in('id', ids).then(({ data }) => setSubj(Object.fromEntries(((data as { id: string; title: string }[]) ?? []).map(x => [x.id, x.title]))))
  }, [units])

  const rows = useMemo<Row[]>(() => {
    if (!progs) return []
    const out: Row[] = []
    for (const p of progs) {
      units.filter(u => u.program_id === p.id).sort((a, b) => a.seq - b.seq).forEach(u => {
        const t = u.detail?.test ?? {}, link = t.kind === 'link', n = t.qids?.length ?? 0
        out.push({ key: 'u' + u.id, kind: 'unit', prog: p, unit: u, title: u.title, sub: subj[u.parent_id ?? ''] ?? '', missing: !link && !n,
          cfg: link ? 'Làm qua link' : n ? `${t.count ?? n}/${n} câu · ${t.minutes ? t.minutes + ' phút' : 'không giới hạn giờ'} · ${t.attempts ? t.attempts + ' lượt' : 'không giới hạn lượt'} · đạt ${num(t.pass ?? p.pass_score ?? 5)}` : 'Chưa chọn câu hỏi' })
      })
      const fe = p.final_exam
      if (fe) out.push({ key: 'f' + p.id, kind: 'final', prog: p, unit: null, title: fe.title || 'Đề cuối khoá', sub: `${fe.subject ?? ''}${fe.grade ? ' · khối ' + fe.grade : ''}`, missing: false,
        cfg: `${matrixTotal(fe.matrix ?? []) + (fe.qids?.length ?? 0)} câu · ${fe.minutes ? fe.minutes + ' phút' : 'không giới hạn giờ'} · ${fe.attempts ? fe.attempts + ' lượt' : 'không giới hạn lượt'} · đạt ${fe.pass != null ? num(fe.pass) : 'không xét'}` })
    }
    return out
  }, [progs, units, subj])

  if (open) return <ProgramDetail key={open.id + (open.unit ?? '')} id={open.id} admin={admin} go={go} back="Kiểm tra & luyện tập" initialTab="exam" initialContent={open.unit} startFinal={open.final}
    onBack={() => { setOpen(null); setRk(k => k + 1) }} onOpen={id => setOpen({ id, unit: null })} onMsg={setMsg} />

  const statOf = (r: Row) => stats.find(s => s.kind === r.kind && s.ref === (r.kind === 'unit' ? r.unit!.id : r.prog.id))
  const defs: FilterDef[] = [
    { key: 'prog', label: 'Chương trình', placeholder: 'Mọi chương trình', options: opts(rows.map(r => [r.prog.family_id, `${r.prog.code} · ${r.prog.title}`])) },
    { key: 'kind', label: 'Loại đề', placeholder: 'Mọi loại đề', options: [['unit', 'Bài test nội dung'], ['final', 'Đề cuối khoá']] },
    { key: 'st', label: 'Trạng thái', placeholder: 'Mọi trạng thái', options: opts(rows.map(r => [r.prog.status, STATUS[r.prog.status]?.[0]])) },
  ]
  const ql = q.trim().toLowerCase()
  const shown = rows.filter(r => (old || !OLD.includes(r.prog.status)) && f.has('prog', r.prog.family_id) && f.has('kind', r.kind) && f.has('st', r.prog.status)
    && (!ql || `${r.title} ${r.sub} ${r.prog.code} ${r.prog.title}`.toLowerCase().includes(ql)))
    .sort((a, b) => ord(a.prog).localeCompare(ord(b.prog)) || (a.kind === b.kind ? 0 : a.kind === 'unit' ? -1 : 1))
  const nUnit = rows.filter(r => r.kind === 'unit' && !OLD.includes(r.prog.status)).length, nFinal = rows.filter(r => r.kind === 'final' && !OLD.includes(r.prog.status)).length

  return <>
    <div className="diststatcards">
      <div className="panel"><i aria-hidden="true">≋</i><span><b>{nUnit}</b><small>Bài test nội dung</small><small>{rows.filter(r => r.missing && !OLD.includes(r.prog.status)).length} chưa chọn câu hỏi</small></span></div>
      <div className="panel"><i aria-hidden="true" className="warn">★</i><span><b>{nFinal}</b><small>Đề cuối khoá</small><small>{(progs ?? []).filter(p => !OLD.includes(p.status) && !p.final_exam).length} chương trình chưa có</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{stats.filter(s => s.kind !== 'practice').reduce((a, s) => a + s.attempts, 0)}</b><small>Lượt làm bài đã nộp</small></span></div>
    </div>
    <div className="bar">
      <div className="tools"><MultiFilters defs={defs} f={f} count={`${shown.length}/${rows.length}`} />
        <input placeholder="Tìm đề, nội dung, chương trình…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm đề" />
        <label><input type="checkbox" checked={old} onChange={e => setOld(e.target.checked)} /> Hiện phiên bản cũ</label></div>
      <div className="tools"><button type="button" className="primary" onClick={() => { setMsg(null); setAdd(true) }}>+ Thêm đề kiểm tra</button>
        <button type="button" onClick={() => downloadXlsx('De-kiem-tra-tap-huan', [{ key: 'p', label: 'Chương trình', width: 34 }, { key: 'v', label: 'Phiên bản', width: 14 },
        { key: 'k', label: 'Loại đề', width: 18 }, { key: 't', label: 'Đề / nội dung', width: 36 }, { key: 'c', label: 'Cấu hình', width: 50 }, { key: 'n', label: 'Lượt làm', width: 10 }, { key: 'a', label: 'Điểm TB', width: 10 }],
        shown.map(r => [`${r.prog.code} · ${r.prog.title}`, `v${r.prog.version_no} · ${STATUS[r.prog.status]?.[0]}`, KIND[r.kind][0], r.title, r.cfg, statOf(r)?.attempts ?? 0, statOf(r)?.avg_score ?? '']), 'Đề kiểm tra')}>Xuất Excel</button></div>
    </div>
    <p className="sub">Bấm "+ Thêm đề kiểm tra" để chọn chương trình và loại đề: bài test của một nội dung hoặc đề cuối khoá (theo ma trận). Bấm một dòng để mở và soạn; chương trình đã phát hành thì tạo phiên bản mới để sửa.</p>
    {add && progs && <AddExam progs={progs.filter(p => !OLD.includes(p.status))} onClose={() => setAdd(false)} onErr={m => setMsg([m, true])}
      onGo={(id, unit) => { setAdd(false); setOpen(unit ? { id, unit } : { id, unit: null, final: true }) }} />}
    {(msg || err) && <p className={msg?.[1] || err ? 'msg' : 'sub'} role="status"><b>{err || msg?.[0]}</b></p>}
    {!progs ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
      <thead><tr><th>Đề kiểm tra</th><th>Loại</th><th>Cấu hình</th><th>Chương trình</th><th className="num">Lượt làm</th><th className="num">Điểm TB</th><th></th></tr></thead>
      <tbody>{shown.map(r => { const s = statOf(r)
        return <tr key={r.key} className="clickrow" onClick={() => { setMsg(null); setOpen({ id: r.prog.id, unit: r.unit?.id ?? null }) }}>
          <td style={{ whiteSpace: 'normal' }}><button type="button" className="namelink">{r.title}</button>{r.sub && <><br /><small className="sub">{r.sub}</small></>}</td>
          <td><Chip tone={KIND[r.kind][1]}>{KIND[r.kind][0]}</Chip></td>
          <td style={{ whiteSpace: 'normal' }}>{r.missing ? <small className="warnline">{r.cfg}</small> : <small>{r.cfg}</small>}</td>
          <td style={{ whiteSpace: 'normal' }}>{progLabel(r.prog)}</td>
          <td className="num">{s?.attempts ?? 0}</td><td className="num">{num(s?.avg_score)}</td>
          <td>{(() => { const sp = rowSpec(r); const t = r.unit?.detail?.test, fe = r.prog.final_exam
            return sp && <Stop><TryButton orgId={r.prog.org_id} spec={sp} title={r.title} minutes={r.kind === 'unit' ? t?.minutes ?? null : fe?.minutes ?? null}
              pass={r.kind === 'unit' ? t?.pass ?? r.prog.pass_score ?? 5 : fe?.pass ?? null} /></Stop> })()}</td></tr> })}
        {!shown.length && <tr><td colSpan={7}><small className="sub">{rows.length ? 'Không có đề nào khớp bộ lọc.' : 'Chưa có đề kiểm tra. Bấm "+ Thêm đề kiểm tra" để tạo.'}</small></td></tr>}</tbody>
    </table></div>}
  </>
}

/** Thêm đề kiểm tra: chọn chương trình, loại đề (bài test nội dung / đề cuối khoá) rồi mở chỗ soạn trong chương trình */
const EDITABLE: Status[] = ['draft', 'rejected']
function AddExam({ progs, onClose, onGo, onErr }: { progs: Prog[]; onClose: () => void; onGo: (id: string, unit: string | null) => void; onErr: (m: string) => void }) {
  const sorted = [...progs].sort((a, b) => Number(EDITABLE.includes(b.status)) - Number(EDITABLE.includes(a.status)) || ord(a).localeCompare(ord(b)))
  const [pid, setPid] = useState(sorted[0]?.id ?? '')
  const [kind, setKind] = useState<'unit' | 'final'>('unit')
  const [units, setUnits] = useState<{ id: string; parent_id: string | null; kind: string; seq: number; title: string; has_test: boolean }[] | null>(null)
  const [uid, setUid] = useState('')
  const [busy, setBusy] = useState(false)
  const p = progs.find(x => x.id === pid)
  const editable = !!p && EDITABLE.includes(p.status)
  useEffect(() => {
    setUnits(null); setUid('')
    if (!pid) return
    supabase.from('training_program_units').select('id, parent_id, kind, seq, title, has_test').eq('program_id', pid).then(({ data }) => setUnits((data as typeof units) ?? []))
  }, [pid])
  const subjects = (units ?? []).filter(u => u.kind === 'subject').sort((a, b) => a.seq - b.seq)
  const contents = (units ?? []).filter(u => u.kind === 'content')
  const cur = contents.find(u => u.id === uid)
  async function go() {
    if (!p) return
    if (kind === 'final') return onGo(p.id, null)
    if (!cur) return
    if (!cur.has_test && editable) {
      setBusy(true)
      const { error } = await supabase.from('training_program_units').update({ has_test: true }).eq('id', cur.id)
      setBusy(false)
      if (error) { onErr(error.message); return onClose() }
    }
    onGo(p.id, cur.id)
  }
  return <Drawer onClose={onClose} title="Thêm đề kiểm tra">
    <div style={{ display: 'grid', gap: 12 }}>
      <label className="field"><span>Chương trình tập huấn *</span><select value={pid} onChange={e => setPid(e.target.value)}>
        {sorted.map(x => <option key={x.id} value={x.id}>{x.code} · v{x.version_no} · {x.title} ({STATUS[x.status]?.[0]})</option>)}</select></label>
      {p && !editable && <p className="warnline" style={{ margin: 0 }}>Chương trình đang ở trạng thái "{STATUS[p.status]?.[0]}": mở ra rồi bấm "Tạo phiên bản mới" để soạn đề.</p>}
      <div className="field"><span>Loại đề</span>
        <label><input type="radio" name="kind" checked={kind === 'unit'} onChange={() => setKind('unit')} /> Bài test của một nội dung <small className="sub">(chọn câu từ ngân hàng hoặc làm qua link)</small></label>
        <label><input type="radio" name="kind" checked={kind === 'final'} onChange={() => setKind('final')} /> Đề cuối khoá <small className="sub">(rút ngẫu nhiên theo ma trận, làm sau khi học xong)</small></label></div>
      {kind === 'unit' && <label className="field"><span>Nội dung *</span>
        {!units ? <small className="sub">Đang tải…</small> : contents.length ? <select value={uid} onChange={e => setUid(e.target.value)}>
          <option value="">— Chọn nội dung —</option>
          {subjects.map(sj => <optgroup key={sj.id} label={sj.title}>{contents.filter(c => c.parent_id === sj.id).sort((a, b) => a.seq - b.seq)
            .map(c => <option key={c.id} value={c.id}>{c.title}{c.has_test ? ' · đã có bài test' : ''}</option>)}</optgroup>)}
        </select> : <small className="warnline">Chương trình chưa có nội dung nào.</small>}</label>}
      {kind === 'unit' && cur && !cur.has_test && <small className="sub">{editable ? 'Nội dung sẽ được bật "Có bài test" rồi mở phần Bài kiểm tra để chọn câu hỏi.' : 'Nội dung chưa bật "Có bài test".'}</small>}
      {kind === 'final' && p?.final_exam && <small className="sub">Chương trình đã có đề cuối khoá: mở ra để xem hoặc sửa.</small>}
      <div className="formactions"><button type="button" className="primary" disabled={busy || !p || (kind === 'unit' && !cur)} onClick={go}>Mở để soạn</button></div>
    </div>
  </Drawer>
}

// ===== Tab 2: Đề luyện =====
type Practice = { id: string; org_id: string; program_id: string; title: string; subject: string; grade: number | null; matrix: MRow[]; qids: string[]
  minutes: number | null; attempts: number; pass: number | null; shuffle: boolean; show_answers: boolean; status: 'draft' | 'published' | 'closed'; note: string | null; updated_at: string }
const PST: Record<Practice['status'], [string, string]> = { draft: ['Nháp', 'warn'], published: ['Đang mở', 'good'], closed: ['Đã đóng', 'off'] }
type PForm = Omit<Practice, 'id' | 'org_id' | 'updated_at' | 'qids'> & { id?: string }

export function TrainingPracticeExams() {
  const admin = useAdmin()
  const [rk, setRk] = useState(0)
  const { progs } = usePrograms(rk)
  const stats = useStats(rk)
  const [list, setList] = useState<Practice[] | null>(null)
  const [form, setForm] = useState<PForm | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [q, setQ] = useState('')
  const f = useMultiFilters()
  useEffect(() => {
    supabase.from('training_practice_exams').select('*').order('updated_at', { ascending: false }).then(({ data, error }) => {
      if (error) setMsg([/schema cache|does not exist/i.test(error.message) ? 'Hãy chạy migration 110 trên Supabase.' : error.message, true])
      setList((data as Practice[]) ?? [])
    })
  }, [rk])
  const progOf = (id: string) => progs?.find(p => p.id === id)
  const usable = (progs ?? []).filter(p => !OLD.includes(p.status))
  const fp = form ? progOf(form.program_id) : undefined
  const subjects = useBankSubjects(fp?.org_id)
  const total = form ? matrixTotal(form.matrix) : 0

  async function save(status?: Practice['status']) {
    if (!form || !fp) return setMsg(['Chọn chương trình tập huấn.', true])
    if (!form.title.trim()) return setMsg(['Nhập tên đề.', true])
    if (!form.subject) return setMsg(['Chọn môn của đề.', true])
    if (total < 1) return setMsg(['Ma trận cần ít nhất 1 câu.', true])
    setBusy(true)
    const row = { program_id: form.program_id, title: form.title.trim(), subject: form.subject, grade: form.grade, matrix: form.matrix.map(r => ({ topic: r.topic, level: r.level, count: r.count })),
      minutes: form.minutes, attempts: form.attempts, pass: form.pass, shuffle: form.shuffle, show_answers: form.show_answers, note: form.note?.trim() || null, status: status ?? form.status }
    const { error } = form.id ? await supabase.from('training_practice_exams').update(row).eq('id', form.id)
      : await supabase.from('training_practice_exams').insert({ ...row, org_id: fp.org_id })
    setBusy(false)
    if (error) return setMsg([error.message, true])
    setMsg([row.status === 'published' ? `Đã lưu và mở đề "${row.title}" cho giáo viên.` : `Đã lưu đề "${row.title}".`, false]); setForm(null); setRk(k => k + 1)
  }
  async function del() {
    if (!form?.id || !confirm(`Xoá đề luyện "${form.title}" và các lượt làm của giáo viên?`)) return
    const { error } = await supabase.from('training_practice_exams').delete().eq('id', form.id)
    if (error) return setMsg([error.message, true])
    setMsg(['Đã xoá đề luyện.', false]); setForm(null); setRk(k => k + 1)
  }
  const blank = (): PForm => ({ program_id: usable.find(p => p.status === 'published')?.id ?? usable[0]?.id ?? '', title: '', subject: '', grade: null, matrix: [], minutes: 20, attempts: 0, pass: 5,
    shuffle: true, show_answers: true, status: 'draft', note: '' })

  const all = list ?? []
  const defs: FilterDef[] = [
    { key: 'prog', label: 'Chương trình', placeholder: 'Mọi chương trình', options: opts(all.map(x => [x.program_id, progOf(x.program_id) ? `${progOf(x.program_id)!.code} · ${progOf(x.program_id)!.title}` : '—'])) },
    { key: 'subj', label: 'Môn', placeholder: 'Mọi môn', options: opts(all.map(x => [x.subject, x.subject])) },
    { key: 'st', label: 'Trạng thái', placeholder: 'Mọi trạng thái', options: (Object.keys(PST) as Practice['status'][]).map(k => [k, PST[k][0]]) },
  ]
  const ql = q.trim().toLowerCase()
  const shown = all.filter(x => f.has('prog', x.program_id) && f.has('subj', x.subject) && f.has('st', x.status) && (!ql || `${x.title} ${x.subject} ${x.note ?? ''}`.toLowerCase().includes(ql)))
  const stat = (id: string) => stats.find(s => s.kind === 'practice' && s.ref === id)

  return <>
    <div className="diststatcards">
      <div className="panel"><i aria-hidden="true">≋</i><span><b>{all.length}</b><small>Đề luyện</small><small>{all.filter(x => x.status === 'published').length} đang mở</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">✎</i><span><b>{stats.filter(s => s.kind === 'practice').reduce((a, s) => a + s.attempts, 0)}</b><small>Lượt luyện đã nộp</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">👥</i><span><b>{stats.filter(s => s.kind === 'practice').reduce((a, s) => a + s.teachers, 0)}</b><small>Lượt giáo viên tham gia</small></span></div>
    </div>
    <div className="bar">
      <div className="tools"><MultiFilters defs={defs} f={f} count={`${shown.length}/${all.length}`} />
        <input placeholder="Tìm tên đề, môn…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm đề luyện" /></div>
      <div className="tools">{admin && <button type="button" className="primary" disabled={!usable.length} onClick={() => { setMsg(null); setForm(blank()) }}>+ Thêm đề luyện</button>}</div>
    </div>
    <p className="sub">Đề tự luyện cho giáo viên, không tính vào kết quả tập huấn. Giáo viên có tên trong kế hoạch có chương trình của đề sẽ thấy đề khi đề "Đang mở" (Cổng giáo viên › Bài giảng tập huấn › Luyện tập).</p>
    {msg && !form && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {!list ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
      <thead><tr><th>Đề luyện</th><th>Câu hỏi</th><th>Cách làm</th><th>Chương trình</th><th>Trạng thái</th><th className="num">Lượt · GV</th><th className="num">Điểm TB</th><th></th></tr></thead>
      <tbody>{shown.map(x => { const s = stat(x.id)
        return <tr key={x.id} className="clickrow" onClick={() => { setMsg(null); setForm({ ...x, matrix: [...(x.matrix ?? [])] }) }}>
          <td style={{ whiteSpace: 'normal' }}><button type="button" className="namelink">{x.title}</button><br /><small className="sub">{x.subject}{x.grade ? ` · khối ${x.grade}` : ''}</small></td>
          <td style={{ whiteSpace: 'normal' }}><small>{matrixTotal(x.matrix ?? [])} câu: {matrixText(x.matrix ?? [])}</small></td>
          <td><small>{x.minutes ? `${x.minutes} phút` : 'Không giới hạn'} · {x.attempts ? `${x.attempts} lượt` : 'không giới hạn lượt'}{x.show_answers ? ' · xem đáp án' : ''}</small></td>
          <td style={{ whiteSpace: 'normal' }}>{progLabel(progOf(x.program_id))}</td>
          <td><Chip tone={PST[x.status][1]}>{PST[x.status][0]}</Chip></td>
          <td className="num">{s ? `${s.attempts} · ${s.teachers}` : '0'}</td><td className="num">{num(s?.avg_score)}</td>
          <td><Stop><TryButton orgId={x.org_id} spec={{ kind: 'pick', subject: x.subject, grade: x.grade, matrix: x.matrix ?? [], qids: x.qids ?? [], shuffle: x.shuffle }} title={x.title} minutes={x.minutes} pass={x.pass} /></Stop></td></tr> })}
        {!shown.length && <tr><td colSpan={8}><small className="sub">{all.length ? 'Không có đề nào khớp bộ lọc.' : 'Chưa có đề luyện. Bấm “+ Thêm đề luyện”.'}</small></td></tr>}</tbody>
    </table></div>}

    {form && <Drawer wide closeOnOutside={false} onClose={() => setForm(null)} title={form.id ? `Đề luyện: ${form.title}` : 'Thêm đề luyện'}
      actions={admin ? <>
        <button type="button" className="primary" disabled={busy} onClick={() => save(form.status === 'published' ? undefined : 'published')}>{form.status === 'published' ? 'Lưu' : 'Lưu & mở cho GV'}</button>
        {form.status !== 'published' && <button type="button" disabled={busy} onClick={() => save()}>{form.id ? 'Lưu' : 'Lưu nháp'}</button>}
        {form.status === 'published' && <button type="button" disabled={busy} onClick={() => save('closed')}>Đóng đề</button>}
        {form.id && <button type="button" className="danger" disabled={busy} onClick={del}>Xoá</button>}</> : undefined}>
      <div className="panel libform">
        {msg && msg[1] && <p className="msg">{msg[0]}</p>}
        <div className="formgrid libgrid4">
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Chương trình tập huấn *</span><select disabled={!admin} value={form.program_id} onChange={e => setForm({ ...form, program_id: e.target.value, subject: '', matrix: [] })}>
            {usable.map(p => <option key={p.id} value={p.id}>{p.code} · {p.title} · v{p.version_no} · {STATUS[p.status]?.[0]?.toLowerCase()}</option>)}
            {fp && OLD.includes(fp.status) && <option value={fp.id}>{fp.code} · {fp.title} · v{fp.version_no}</option>}</select>
            <small className="sub">Giáo viên học mọi phiên bản của chương trình này đều thấy đề.</small></label>
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Tên đề *</span><input disabled={!admin} maxLength={200} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Luyện tập cảm biến và robot" /></label>
          <label className="field"><span>Môn (ngân hàng câu hỏi) *</span><select disabled={!admin} value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value, matrix: [] })}>
            <option value="">— Chọn môn —</option>{subjects.map(s => <option key={s.subject} value={s.subject}>{s.subject} ({s.n} câu)</option>)}
            {form.subject && !subjects.some(s => s.subject === form.subject) && <option value={form.subject}>{form.subject}</option>}</select></label>
          <label className="field"><span>Khối</span><select disabled={!admin} value={form.grade ?? ''} onChange={e => setForm({ ...form, grade: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Mọi khối</option>{Array.from({ length: 12 }, (_, k) => <option key={k + 1} value={k + 1}>Khối {k + 1}</option>)}</select></label>
          <label className="field"><span>Thời gian (phút)</span><input disabled={!admin} type="number" min={1} max={300} value={form.minutes ?? ''} placeholder="Không giới hạn"
            onChange={e => setForm({ ...form, minutes: e.target.value ? Number(e.target.value) : null })} /></label>
          <label className="field"><span>Số lượt làm</span><input disabled={!admin} type="number" min={0} max={50} value={form.attempts} onChange={e => setForm({ ...form, attempts: Number(e.target.value) || 0 })} /><small className="sub">0 = không giới hạn</small></label>
          <label className="field"><span>Điểm đạt (thang 10)</span><input disabled={!admin} type="number" min={0} max={10} step={0.5} value={form.pass ?? ''} placeholder="Không xét"
            onChange={e => setForm({ ...form, pass: e.target.value ? Number(e.target.value) : null })} /></label>
          <div className="field"><span>Trộn câu</span><label><input disabled={!admin} type="checkbox" checked={form.shuffle} onChange={e => setForm({ ...form, shuffle: e.target.checked })} /> Trộn thứ tự câu mỗi lượt</label></div>
          <div className="field"><span>Sau khi nộp</span><label><input disabled={!admin} type="checkbox" checked={form.show_answers} onChange={e => setForm({ ...form, show_answers: e.target.checked })} /> Cho xem đáp án và lời giải</label></div>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Ghi chú cho giáo viên</span><input disabled={!admin} maxLength={2000} value={form.note ?? ''} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="VD: Ôn trước buổi 3" /></label>
        </div>
        <div className="bar" style={{ margin: 0 }}><h4 className="libparthead">Ma trận đề ({total} câu)</h4>
          <TryButton orgId={fp?.org_id} spec={{ kind: 'pick', subject: form.subject, grade: form.grade, matrix: form.matrix, qids: (form as PForm & { qids?: string[] }).qids ?? [], shuffle: form.shuffle }}
            title={form.title || 'Đề luyện'} minutes={form.minutes} pass={form.pass} disabled={!form.subject} /></div>
        <ExamMatrix org={fp?.org_id} subject={form.subject} grade={form.grade} rows={form.matrix} onChange={m => setForm({ ...form, matrix: m })} disabled={!admin} />
      </div>
    </Drawer>}
  </>
}

// ===== Tab 3: Kết quả & câu khó =====
type Hard = { question_id: string; stem: string; topic: string | null; level: string; seen: number; wrong: number; wrong_rate: number }
export function TrainingExamStats() {
  const [rk] = useState(0)
  const { progs } = usePrograms(rk)
  const stats = useStats(rk)
  const [open, setOpen] = useState<Stat | null>(null)
  const [hard, setHard] = useState<Hard[] | null>(null)
  const f = useMultiFilters()
  useEffect(() => {
    if (!open) return
    setHard(null)
    supabase.rpc('training_exam_hard', { p_kind: open.kind, p_ref: open.ref }).then(({ data }) => setHard((data as Hard[]) ?? []))
  }, [open])
  const progOf = (id: string) => progs?.find(p => p.id === id)
  const defs: FilterDef[] = [
    { key: 'kind', label: 'Loại đề', placeholder: 'Mọi loại đề', options: (Object.keys(KIND) as Kind[]).map(k => [k, KIND[k][0]]) },
    { key: 'prog', label: 'Chương trình', placeholder: 'Mọi chương trình', options: opts(stats.map(s => [progOf(s.program_id)?.family_id ?? s.program_id, progOf(s.program_id) ? `${progOf(s.program_id)!.code} · ${progOf(s.program_id)!.title}` : '—'])) },
  ]
  const shown = stats.filter(s => f.has('kind', s.kind) && f.has('prog', progOf(s.program_id)?.family_id ?? s.program_id)).sort((a, b) => b.attempts - a.attempts)
  const rate = (s: Stat) => s.teachers ? Math.round(100 * s.passed / s.teachers) : 0

  return <>
    <div className="diststatcards">
      <div className="panel"><i aria-hidden="true">≋</i><span><b>{stats.length}</b><small>Đề đã có người làm</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">✎</i><span><b>{stats.reduce((a, s) => a + s.attempts, 0)}</b><small>Lượt làm bài đã nộp</small></span></div>
      <div className="panel"><i aria-hidden="true" className="warn">!</i><span><b>{stats.filter(s => s.teachers && rate(s) < 50).length}</b><small>Đề dưới 50% giáo viên đạt</small></span></div>
    </div>
    <div className="bar"><div className="tools"><MultiFilters defs={defs} f={f} count={`${shown.length}/${stats.length}`} /></div>
      <div className="tools"><button type="button" onClick={() => downloadXlsx('Ket-qua-de-tap-huan', [{ key: 't', label: 'Đề', width: 36 }, { key: 'k', label: 'Loại', width: 18 }, { key: 'p', label: 'Chương trình', width: 34 },
        { key: 'n', label: 'Lượt làm', width: 10 }, { key: 'g', label: 'Giáo viên', width: 10 }, { key: 'a', label: 'Điểm TB', width: 10 }, { key: 'b', label: 'TB điểm cao nhất', width: 14 }, { key: 'r', label: 'Tỉ lệ đạt (%)', width: 12 }],
        shown.map(s => [s.title, KIND[s.kind][0], progOf(s.program_id) ? `${progOf(s.program_id)!.code} · ${progOf(s.program_id)!.title}` : '', s.attempts, s.teachers, s.avg_score, s.best_avg, rate(s)]), 'Kết quả')}>Xuất Excel</button></div></div>
    <p className="sub">Điểm theo từng đề của các giáo viên bạn được xem. Tỉ lệ đạt tính theo lượt cao nhất của mỗi giáo viên. Bấm một đề để xem câu hay sai, dùng để ôn tập hoặc sửa câu hỏi.</p>
    <div className="wrap"><table className="libtable">
      <thead><tr><th>Đề</th><th>Loại</th><th>Chương trình</th><th className="num">Lượt làm</th><th className="num">Giáo viên</th><th className="num">Điểm TB</th><th className="num">TB điểm cao nhất</th><th>Đạt</th></tr></thead>
      <tbody>{shown.map(s => <tr key={s.kind + s.ref} className="clickrow" onClick={() => setOpen(s)}>
        <td style={{ whiteSpace: 'normal' }}><button type="button" className="namelink">{s.title}</button></td>
        <td><Chip tone={KIND[s.kind][1]}>{KIND[s.kind][0]}</Chip></td>
        <td style={{ whiteSpace: 'normal' }}>{progLabel(progOf(s.program_id))}</td>
        <td className="num">{s.attempts}</td><td className="num">{s.teachers}</td><td className="num">{num(s.avg_score)}</td><td className="num">{num(s.best_avg)}</td>
        <td><span className={'distchip2 ' + (rate(s) >= 80 ? 'good' : rate(s) >= 50 ? 'warn' : 'bad')}>{s.passed}/{s.teachers} · {rate(s)}%</span></td></tr>)}
        {!shown.length && <tr><td colSpan={8}><small className="sub">{stats.length ? 'Không có đề nào khớp bộ lọc.' : 'Chưa có lượt làm bài nào.'}</small></td></tr>}</tbody>
    </table></div>
    {open && <Drawer wide onClose={() => setOpen(null)} title={`Câu hay sai · ${open.title}`}>
      <p className="sub" style={{ marginTop: 0 }}>{KIND[open.kind][0]} · {open.attempts} lượt · {open.teachers} giáo viên · điểm TB {num(open.avg_score)}</p>
      {!hard ? <p className="sub">Đang tải…</p> : <div className="wrap"><table>
        <thead><tr><th>Câu hỏi</th><th>Chủ đề · mức độ</th><th className="num">Gặp</th><th className="num">Sai</th><th>Tỉ lệ sai</th></tr></thead>
        <tbody>{hard.map(h => <tr key={h.question_id}>
          <td style={{ whiteSpace: 'normal', maxWidth: 420 }}>{h.stem}</td><td><small>{h.topic || '—'} · {levelName(h.level)}</small></td>
          <td className="num">{h.seen}</td><td className="num">{h.wrong}</td>
          <td><span className={'distchip2 ' + (h.wrong_rate >= 60 ? 'bad' : h.wrong_rate >= 30 ? 'warn' : 'good')}>{num(h.wrong_rate)}%</span></td></tr>)}
          {!hard.length && <tr><td colSpan={5}><small className="sub">Không đọc được câu hỏi của đề này (bài làm qua link hoặc câu đã bị xoá).</small></td></tr>}</tbody>
      </table></div>}
    </Drawer>}
  </>
}
