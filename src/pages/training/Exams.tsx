// Phân hệ 1 › Kiểm tra & luyện tập (110): một chỗ xem mọi đề của tập huấn.
// Đề kiểm tra: bài test nội dung + đề cuối khoá của mọi chương trình (bấm để soạn trong chương trình).
// Đề luyện: đề tự luyện cho giáo viên, không tính điểm tập huấn. Kết quả & câu khó: điểm theo đề, câu hay sai.
import { TryButton, type TrySpec } from '../../components/ExamTryout'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Drawer } from '../../components/Drawer'
import { ElView } from '../../components/ElView'
import { ExamMatrix, LEVELS, cleanMatrix, levelName, listGrades, listSubjects, matrixText, matrixTotal, useBankSubjects, type MRow } from '../../components/ExamMatrix'
import { MultiSelect } from '../../components/MultiSelect'
import { GradeMulti } from '../../components/Pickers'
import { MultiFilters, opts, useMultiFilters, type FilterDef } from '../../components/MultiFilters'
import { downloadXlsx } from '../../lib/sheet'
import { Chip } from '../dist/Editor'
import { ProgramDetail, STATUS, type Status } from './Programs'
import type { FinalExam } from './ExamFrame'

type Prog = { id: string; org_id: string; code: string; title: string; status: Status; version_no: number; family_id: string; pass_score: number | null; final_exam: FinalExam | null }
type TUnit = { id: string; program_id: string; parent_id: string | null; title: string; seq: number; hours?: number | null; mode?: string | null
  detail: { test?: { kind?: string; qids?: string[]; count?: number; minutes?: number; attempts?: number; pass?: number; url?: string; due?: string | null; note?: string } } | null }
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
// ===== Xem chi tiết đề (chỉ xem; bấm Sửa mới mở chỗ soạn) =====
type BQ = { id: string; stem: string; options: string[]; answer: number[]; explain: string | null; level: string; topic: string | null; kind: string; subject: string }
const QKIND: Record<string, string> = { single: 'Một đáp án', multi: 'Nhiều đáp án', truefalse: 'Đúng / sai' }
const letter = (i: number) => String.fromCharCode(65 + i)
/** Danh sách câu hỏi của đề kèm đáp án đúng và lời giải */
function QuestionList({ qids, title }: { qids: string[]; title: string }) {
  const [rows, setRows] = useState<BQ[] | null>(null)
  const [all, setAll] = useState(false)
  useEffect(() => {
    if (!qids.length) { setRows([]); return }
    supabase.from('question_bank').select('id, stem, options, answer, explain, level, topic, kind, subject').in('id', qids.slice(0, 500))
      .then(({ data }) => { const m = new Map(((data as BQ[]) ?? []).map(q => [q.id, q])); setRows(qids.map(id => m.get(id)).filter(Boolean) as BQ[]) })
  }, [qids.join(',')])
  if (!qids.length) return null
  const byLevel = LEVELS.map(([k, l]) => [l, rows?.filter(q => q.level === k).length ?? 0] as const).filter(([, n]) => n)
  const shown = all ? rows ?? [] : (rows ?? []).slice(0, 10)
  return <section className="panel" style={{ display: 'grid', gap: 10 }}>
    <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>{title} ({qids.length})</h3>
      {rows && <small className="sub">{byLevel.map(([l, n]) => `${l} ${n}`).join(' · ')}{rows.length < qids.length ? ` · ${qids.length - rows.length} câu không còn trong ngân hàng` : ''}</small>}</div>
    {!rows ? <p className="sub">Đang tải câu hỏi…</p> : <ol className="paper">{shown.map(q => <li key={q.id}>
      <p className="stem">{q.stem}</p>
      <small className="sub">{levelName(q.level)}{q.topic ? ` · ${q.topic}` : ''} · {QKIND[q.kind] ?? q.kind}</small>
      <div className="choices">{q.options.map((o, k) => <label key={k} className={q.answer.includes(k) ? 'right' : ''}><span aria-hidden="true">{q.answer.includes(k) ? '✓' : ''}</span><b>{letter(k)}</b><span>{o}</span></label>)}</div>
      {q.explain && <p className="sub">Lời giải: {q.explain}</p>}
    </li>)}</ol>}
    {rows && rows.length > 10 && <button type="button" className="linkbtn" onClick={() => setAll(!all)}>{all ? 'Thu gọn' : `Xem cả ${rows.length} câu`}</button>}
  </section>
}
/** Bảng ma trận chủ đề × mức độ */
function MatrixTable({ rows }: { rows: MRow[] }) {
  if (!rows.length) return null
  const ms = rows.some(r => r.subject)
  return <section className="panel" style={{ display: 'grid', gap: 10 }}>
    <h3 style={{ margin: 0 }}>Ma trận đề ({matrixTotal(rows)} câu, rút ngẫu nhiên mỗi lượt)</h3>
    <div className="wrap"><table className="libtable"><thead><tr>{ms && <th>Môn</th>}<th>Chủ đề</th><th>Mức độ</th><th className="num">Số câu</th></tr></thead>
      <tbody>{rows.map((r, k) => <tr key={k}>{ms && <td>{r.subject || 'Mọi môn của đề'}</td>}<td>{r.topic || 'Mọi chủ đề'}</td><td>{levelName(r.level)}</td><td className="num">{r.count}</td></tr>)}</tbody></table></div>
  </section>
}
function StatCards({ s }: { s?: Stat }) {
  return <div className="diststatcards">
    <div className="panel"><i aria-hidden="true">✎</i><span><b>{s?.attempts ?? 0}</b><small>Lượt làm đã nộp</small><small>{s?.teachers ?? 0} giáo viên</small></span></div>
    <div className="panel"><i aria-hidden="true" className="good">★</i><span><b>{num(s?.avg_score)}</b><small>Điểm trung bình</small><small>điểm cao nhất TB {num(s?.best_avg)}</small></span></div>
    <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{s?.passed ?? 0}</b><small>Giáo viên đạt</small></span></div>
  </div>
}
const subjGrade = (x: { subject?: string | null; subjects?: string[] | null; grade?: number | null; grades?: number[] | null } | null | undefined) =>
  `${listSubjects(x).join(', ') || '—'}${listGrades(x).length ? ` · khối ${listGrades(x).join(', ')}` : ' · mọi khối'}`
const pSpec = (x: { subject?: string | null; subjects?: string[] | null; grade?: number | null; grades?: number[] | null; matrix: MRow[]; qids?: string[]; shuffle: boolean }): TrySpec =>
  ({ kind: 'pick', subjects: listSubjects(x), grades: listGrades(x), matrix: cleanMatrix(x.matrix ?? []), qids: x.qids ?? [], shuffle: x.shuffle })
const MODE_LABEL: Record<string, string> = { online: 'Trực tuyến', offline: 'Trực tiếp', hybrid: 'Kết hợp' }

/** Chi tiết bài test nội dung / đề cuối khoá */
function ExamDetail({ r, subjName, stat, onBack, onEdit }: { r: Row; subjName: string; stat?: Stat; onBack: () => void; onEdit: () => void }) {
  const p = r.prog, u = r.unit, t = u?.detail?.test ?? {}, fe = p.final_exam, sp = rowSpec(r)
  const editable = ['draft', 'rejected'].includes(p.status)
  const link = r.kind === 'unit' && t.kind === 'link'
  return <ElView back="Đề kiểm tra" onBack={onBack} title={r.title}
    sub={<><Chip tone={KIND[r.kind][1]}>{KIND[r.kind][0]}</Chip> {p.code} · v{p.version_no} · {p.title} <Chip tone={STATUS[p.status]?.[1]}>{STATUS[p.status]?.[0]}</Chip></>}
    actions={<>{sp && <TryButton orgId={p.org_id} spec={sp} title={r.title} minutes={r.kind === 'unit' ? t.minutes ?? null : fe?.minutes ?? null}
      pass={r.kind === 'unit' ? t.pass ?? p.pass_score ?? 5 : fe?.pass ?? null} />}
      <button type="button" onClick={onEdit}>{editable ? 'Sửa đề' : 'Mở trong chương trình'}</button></>}>
    {!editable && <p className="sub" style={{ marginTop: 0 }}>Chương trình đã {STATUS[p.status]?.[0]?.toLowerCase()}: muốn sửa đề thì tạo phiên bản mới của chương trình.</p>}
    <StatCards s={stat} />
    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>{r.kind === 'unit' ? 'Nội dung tập huấn' : 'Thông tin đề'}</h3>
      <dl className="tpkv">
        <dt>Chương trình</dt><dd>{p.code} · {p.title} (v{p.version_no})</dd>
        {r.kind === 'unit' ? <>
          <dt>Môn</dt><dd>{subjName || '—'}</dd>
          <dt>Nội dung</dt><dd><b>{u?.title}</b></dd>
          <dt>Thời lượng</dt><dd>{u?.hours != null ? `${num(u.hours)} giờ` : '—'}{u?.mode ? ` · ${MODE_LABEL[u.mode] ?? u.mode}` : ''}</dd>
        </> : <>
          <dt>Môn (ngân hàng câu hỏi)</dt><dd>{subjGrade(fe)}</dd>
          <dt>Khi nào làm</dt><dd>Sau khi giáo viên học xong mọi nội dung của chương trình</dd>
        </>}
      </dl>
      <h3 style={{ margin: 0 }}>Cách làm bài</h3>
      <dl className="tpkv">{link ? <>
        <dt>Hình thức</dt><dd>Làm qua link (điểm do người tổ chức nhập)</dd>
        <dt>Link</dt><dd>{t.url ? <a href={t.url} target="_blank" rel="noreferrer">{t.url} ↗</a> : <span className="warnline">Chưa có link</span>}</dd>
        <dt>Điểm đạt</dt><dd>{num(t.pass ?? p.pass_score ?? 5)}/10{t.due ? ` · hạn ${new Date(t.due).toLocaleDateString('vi-VN')}` : ''}</dd>
        {t.note && <><dt>Hướng dẫn</dt><dd>{t.note}</dd></>}
      </> : r.kind === 'unit' ? <>
        <dt>Hình thức</dt><dd>Làm trong hệ thống, chấm tự động</dd>
        <dt>Số câu mỗi lượt</dt><dd>{t.qids?.length ? `${t.count ?? t.qids.length} câu${t.count && t.count < t.qids.length ? `, rút ngẫu nhiên từ ${t.qids.length} câu đã chọn` : ''}` : <span className="warnline">Chưa chọn câu hỏi</span>}</dd>
        <dt>Thời gian · lượt</dt><dd>{t.minutes ? `${t.minutes} phút` : 'Không giới hạn thời gian'} · {t.attempts ? `${t.attempts} lượt` : 'không giới hạn lượt'}</dd>
        <dt>Điểm đạt</dt><dd>{num(t.pass ?? p.pass_score ?? 5)}/10 (đạt thì mở nội dung tiếp theo)</dd>
      </> : <>
        <dt>Số câu</dt><dd>{matrixTotal(fe?.matrix ?? []) + (fe?.qids?.length ?? 0)} câu{fe?.shuffle !== false ? ' · trộn thứ tự câu' : ''}</dd>
        <dt>Thời gian · lượt</dt><dd>{fe?.minutes ? `${fe.minutes} phút` : 'Không giới hạn thời gian'} · {fe?.attempts ? `${fe.attempts} lượt` : 'không giới hạn lượt'}</dd>
        <dt>Điểm đạt</dt><dd>{fe?.pass != null ? `${num(fe.pass)}/10` : 'Không xét'}</dd>
      </>}</dl>
    </section>
    {r.kind === 'final' && <MatrixTable rows={fe?.matrix ?? []} />}
    <QuestionList qids={(r.kind === 'unit' ? (link ? [] : t.qids) : fe?.qids) ?? []} title={r.kind === 'unit' ? 'Câu hỏi đã chọn' : 'Câu chọn sẵn'} />
  </ElView>
}

const progLabel = (p: Prog | undefined) => p ? <><small>{p.code} · v{p.version_no}</small> <Chip tone={STATUS[p.status]?.[1]}>{STATUS[p.status]?.[0]}</Chip><br /><small className="sub">{p.title}</small></> : '—'

// ===== Tab 1: Đề kiểm tra =====
// Cấu hình làm thử của một dòng đề (bài test nội dung chọn câu / đề cuối khoá)
const rowSpec = (r: { kind: 'unit' | 'final'; prog: Prog; unit: TUnit | null }): TrySpec | null => {
  if (r.kind === 'unit') { const t = r.unit?.detail?.test; return t && t.kind !== 'link' && t.qids?.length ? { kind: 'sample', qids: t.qids, count: t.count ?? null } : null }
  const fe = r.prog.final_exam
  return fe ? { kind: 'pick', subjects: listSubjects(fe), grades: listGrades(fe), matrix: cleanMatrix(fe.matrix ?? []), qids: fe.qids ?? [], shuffle: fe.shuffle !== false } : null
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
  const [view, setView] = useState<string | null>(null)
  const f = useMultiFilters()
  useEffect(() => {
    supabase.from('training_program_units').select('id, program_id, parent_id, title, seq, hours, mode, detail').eq('kind', 'content').eq('has_test', true)
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
      if (fe) out.push({ key: 'f' + p.id, kind: 'final', prog: p, unit: null, title: fe.title || 'Đề cuối khoá', sub: subjGrade(fe), missing: false,
        cfg: `${matrixTotal(fe.matrix ?? []) + (fe.qids?.length ?? 0)} câu · ${fe.minutes ? fe.minutes + ' phút' : 'không giới hạn giờ'} · ${fe.attempts ? fe.attempts + ' lượt' : 'không giới hạn lượt'} · đạt ${fe.pass != null ? num(fe.pass) : 'không xét'}` })
    }
    return out
  }, [progs, units, subj])

  if (open) return <ProgramDetail key={open.id + (open.unit ?? '')} id={open.id} admin={admin} go={go} back="Kiểm tra & luyện tập" initialTab="exam" initialContent={open.unit} startFinal={open.final}
    onBack={() => { setOpen(null); setRk(k => k + 1) }} onOpen={id => setOpen({ id, unit: null })} onMsg={setMsg} />

  const statOf = (r: Row) => stats.find(s => s.kind === r.kind && s.ref === (r.kind === 'unit' ? r.unit!.id : r.prog.id))
  const vr = view ? rows.find(r => r.key === view) : undefined
  if (vr) return <ExamDetail r={vr} subjName={vr.sub} stat={statOf(vr)} onBack={() => setView(null)}
    onEdit={() => { setMsg(null); setOpen(vr.kind === 'unit' ? { id: vr.prog.id, unit: vr.unit!.id } : { id: vr.prog.id, unit: null, final: true }) }} />
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
        return <tr key={r.key} className="clickrow" onClick={() => { setMsg(null); setView(r.key) }}>
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
type Practice = { id: string; org_id: string; program_id: string; title: string; subject: string; grade: number | null; subjects?: string[]; grades?: number[]; matrix: MRow[]; qids: string[]
  minutes: number | null; attempts: number; pass: number | null; shuffle: boolean; show_answers: boolean; status: 'draft' | 'published' | 'closed'; note: string | null; updated_at: string }
const PST: Record<Practice['status'], [string, string]> = { draft: ['Nháp', 'warn'], published: ['Đang mở', 'good'], closed: ['Đã đóng', 'off'] }
type PForm = Omit<Practice, 'id' | 'org_id' | 'updated_at' | 'qids'> & { id?: string }

/** Chi tiết đề luyện (chỉ xem; bấm Sửa mới mở chỗ soạn) */
function PracticeDetail({ x, prog, stat, admin, msg, onBack, onEdit }: { x: Practice; prog?: Prog; stat?: Stat; admin: boolean; msg: [string, boolean] | null; onBack: () => void; onEdit: () => void }) {
  const n = matrixTotal(x.matrix ?? []) + (x.qids?.length ?? 0)
  return <ElView back="Đề luyện" onBack={onBack} title={x.title}
    sub={<><Chip tone={PST[x.status][1]}>{PST[x.status][0]}</Chip> {subjGrade(x)}{prog ? ` · ${prog.code} · ${prog.title}` : ''}</>}
    actions={<><TryButton orgId={x.org_id} spec={pSpec(x)} title={x.title} minutes={x.minutes} pass={x.pass} />
      {admin && <button type="button" onClick={onEdit}>Sửa đề</button>}</>}>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status" style={{ marginTop: 0 }}><b>{msg[0]}</b></p>}
    <StatCards s={stat} />
    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>Thông tin đề</h3>
      <dl className="tpkv">
        <dt>Chương trình</dt><dd>{prog ? <>{prog.code} · {prog.title} (v{prog.version_no})</> : '—'}</dd>
        <dt>Môn (ngân hàng câu hỏi)</dt><dd>{subjGrade(x)}</dd>
        <dt>Trạng thái</dt><dd><Chip tone={PST[x.status][1]}>{PST[x.status][0]}</Chip>{x.status === 'published' ? ' · giáo viên đang thấy đề' : ''}</dd>
        {x.note && <><dt>Ghi chú cho giáo viên</dt><dd>{x.note}</dd></>}
      </dl>
      <h3 style={{ margin: 0 }}>Cách làm bài</h3>
      <dl className="tpkv">
        <dt>Số câu mỗi lượt</dt><dd>{n} câu{x.shuffle ? ' · trộn thứ tự câu' : ''}</dd>
        <dt>Thời gian · lượt</dt><dd>{x.minutes ? `${x.minutes} phút` : 'Không giới hạn thời gian'} · {x.attempts ? `${x.attempts} lượt` : 'không giới hạn lượt'}</dd>
        <dt>Điểm đạt</dt><dd>{x.pass != null ? `${num(x.pass)}/10` : 'Không xét'}</dd>
        <dt>Sau khi nộp</dt><dd>{x.show_answers ? 'Giáo viên xem được đáp án và lời giải' : 'Chỉ xem điểm, không xem đáp án'}</dd>
      </dl>
    </section>
    <MatrixTable rows={x.matrix ?? []} />
    <QuestionList qids={x.qids ?? []} title="Câu chọn sẵn" />
  </ElView>
}

export function TrainingPracticeExams() {
  const admin = useAdmin()
  const [rk, setRk] = useState(0)
  const { progs } = usePrograms(rk)
  const stats = useStats(rk)
  const [list, setList] = useState<Practice[] | null>(null)
  const [form, setForm] = useState<PForm | null>(null)
  const [pv, setPv] = useState<string | null>(null)
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
    const subs = listSubjects(form), grs = listGrades(form)
    if (!subs.length) return setMsg(['Chọn môn của đề.', true])
    if (total < 1) return setMsg(['Ma trận cần ít nhất 1 câu.', true])
    setBusy(true)
    const row = { program_id: form.program_id, title: form.title.trim(), subject: subs[0], subjects: subs, grade: grs[0] ?? null, grades: grs, matrix: cleanMatrix(form.matrix).map(r => (r.subject && !subs.includes(r.subject) ? { ...r, subject: undefined } : r)),
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
    setMsg(['Đã xoá đề luyện.', false]); setForm(null); setPv(null); setRk(k => k + 1)
  }
  const blank = (): PForm => ({ program_id: usable.find(p => p.status === 'published')?.id ?? usable[0]?.id ?? '', title: '', subject: '', grade: null, subjects: [], grades: [], matrix: [], minutes: 20, attempts: 0, pass: 5,
    shuffle: true, show_answers: true, status: 'draft', note: '' })

  const all = list ?? []
  const defs: FilterDef[] = [
    { key: 'prog', label: 'Chương trình', placeholder: 'Mọi chương trình', options: opts(all.map(x => [x.program_id, progOf(x.program_id) ? `${progOf(x.program_id)!.code} · ${progOf(x.program_id)!.title}` : '—'])) },
    { key: 'subj', label: 'Môn', placeholder: 'Mọi môn', options: opts(all.flatMap(x => listSubjects(x).map(s => [s, s] as [string, string]))) },
    { key: 'st', label: 'Trạng thái', placeholder: 'Mọi trạng thái', options: (Object.keys(PST) as Practice['status'][]).map(k => [k, PST[k][0]]) },
  ]
  const ql = q.trim().toLowerCase()
  const shown = all.filter(x => f.has('prog', x.program_id) && listSubjects(x).some(s => f.has('subj', s)) && f.has('st', x.status) && (!ql || `${x.title} ${x.subject} ${x.note ?? ''}`.toLowerCase().includes(ql)))
  const stat = (id: string) => stats.find(s => s.kind === 'practice' && s.ref === id)

  const px = pv ? all.find(x => x.id === pv) : undefined
  return <>
    {px ? <PracticeDetail x={px} prog={progOf(px.program_id)} stat={stat(px.id)} admin={admin} msg={form ? null : msg} onBack={() => { setPv(null); setMsg(null) }}
      onEdit={() => { setMsg(null); setForm({ ...px, matrix: [...(px.matrix ?? [])] }) }} /> : <>
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
        return <tr key={x.id} className="clickrow" onClick={() => { setMsg(null); setPv(x.id) }}>
          <td style={{ whiteSpace: 'normal' }}><button type="button" className="namelink">{x.title}</button><br /><small className="sub">{subjGrade(x)}</small></td>
          <td style={{ whiteSpace: 'normal' }}><small>{matrixTotal(x.matrix ?? [])} câu: {matrixText(x.matrix ?? [])}</small></td>
          <td><small>{x.minutes ? `${x.minutes} phút` : 'Không giới hạn'} · {x.attempts ? `${x.attempts} lượt` : 'không giới hạn lượt'}{x.show_answers ? ' · xem đáp án' : ''}</small></td>
          <td style={{ whiteSpace: 'normal' }}>{progLabel(progOf(x.program_id))}</td>
          <td><Chip tone={PST[x.status][1]}>{PST[x.status][0]}</Chip></td>
          <td className="num">{s ? `${s.attempts} · ${s.teachers}` : '0'}</td><td className="num">{num(s?.avg_score)}</td>
          <td><Stop><TryButton orgId={x.org_id} spec={pSpec(x)} title={x.title} minutes={x.minutes} pass={x.pass} /></Stop></td></tr> })}
        {!shown.length && <tr><td colSpan={8}><small className="sub">{all.length ? 'Không có đề nào khớp bộ lọc.' : 'Chưa có đề luyện. Bấm “+ Thêm đề luyện”.'}</small></td></tr>}</tbody>
    </table></div>}
    </>}

    {form && <Drawer wide closeOnOutside={false} onClose={() => setForm(null)} title={form.id ? `Đề luyện: ${form.title}` : 'Thêm đề luyện'}
      actions={admin ? <>
        <button type="button" className="primary" disabled={busy} onClick={() => save(form.status === 'published' ? undefined : 'published')}>{form.status === 'published' ? 'Lưu' : 'Lưu & mở cho GV'}</button>
        {form.status !== 'published' && <button type="button" disabled={busy} onClick={() => save()}>{form.id ? 'Lưu' : 'Lưu nháp'}</button>}
        {form.status === 'published' && <button type="button" disabled={busy} onClick={() => save('closed')}>Đóng đề</button>}
        {form.id && <button type="button" className="danger" disabled={busy} onClick={del}>Xoá</button>}</> : undefined}>
      <div className="panel libform">
        {msg && msg[1] && <p className="msg">{msg[0]}</p>}
        <div className="formgrid libgrid4">
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Chương trình tập huấn *</span><select disabled={!admin} value={form.program_id} onChange={e => setForm({ ...form, program_id: e.target.value, subject: '', subjects: [], matrix: [] })}>
            {usable.map(p => <option key={p.id} value={p.id}>{p.code} · {p.title} · v{p.version_no} · {STATUS[p.status]?.[0]?.toLowerCase()}</option>)}
            {fp && OLD.includes(fp.status) && <option value={fp.id}>{fp.code} · {fp.title} · v{fp.version_no}</option>}</select>
            <small className="sub">Giáo viên học mọi phiên bản của chương trình này đều thấy đề.</small></label>
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Tên đề *</span><input disabled={!admin} maxLength={200} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Luyện tập cảm biến và robot" /></label>
          <div className="field" style={{ gridColumn: 'span 2' }}><span>Môn (ngân hàng câu hỏi, chọn được nhiều) *</span>
            <MultiSelect disabled={!admin} value={listSubjects(form)} onChange={v => setForm({ ...form, subjects: v, subject: v[0] ?? '' })} ariaLabel="Môn của đề" placeholder="— Chọn môn —"
              options={[...subjects.map(s => [s.subject, `${s.subject} (${s.n} câu)`] as [string, string]), ...listSubjects(form).filter(x => !subjects.some(s => s.subject === x)).map(x => [x, x] as [string, string])]} empty="Ngân hàng chưa có câu hỏi." /></div>
          <div className="field"><span>Khối (chọn được nhiều)</span><GradeMulti disabled={!admin} value={listGrades(form)} onChange={v => setForm({ ...form, grades: v, grade: v[0] ?? null })} /></div>
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
          <TryButton orgId={fp?.org_id} spec={pSpec({ ...form, qids: (form as PForm & { qids?: string[] }).qids ?? [] })}
            title={form.title || 'Đề luyện'} minutes={form.minutes} pass={form.pass} disabled={!listSubjects(form).length} /></div>
        <ExamMatrix org={fp?.org_id} subjects={listSubjects(form)} grades={listGrades(form)} rows={form.matrix} onChange={m => setForm({ ...form, matrix: m })} disabled={!admin} />
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
