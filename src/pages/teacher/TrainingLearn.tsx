// Cổng giáo viên › Bài giảng tập huấn › Khoá tập huấn của tôi (migration 086)
// Học lần lượt các nội dung của kế hoạch tập huấn: mở bài giảng / tài liệu, làm bài kiểm tra, vào lớp học ảo, nộp sản phẩm.
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtDate, fmtTime } from '../../lib/time'
import { ElView } from '../../components/ElView'
import { NoTeacher, type TProps } from './common'

type Course = { plan_id: string; plan_code: string | null; name: string; org_name: string | null; starts_on: string | null; ends_on: string | null
  programs: string | null; units: number; done: number; need_product: boolean; product_status: string | null }
type Row = Record<string, string>
type USess = { id: string; title: string; starts_at: string; ends_at: string; mode: string; location: string | null; meeting_url: string | null
  recording_url: string | null; closed: boolean; present: boolean | null }
type Unit = { id: string; ord: number; subject: string; title: string; hours: number; mode: string | null
  detail: { body?: { goal?: string; text?: string; reqs?: string[] }; lectures?: Row[]; docs?: Row[] }
  test: null | { count: number; minutes: number | null; attempts: number; pass: number; used: number; open: string | null }
  seen: string[]; best_score: number | null; done: boolean; unlocked: boolean; sessions: USess[] }
type Product = { url: string | null; note: string | null; status: 'submitted' | 'accepted' | 'returned'; feedback: string | null; submitted_at: string }
type Full = { plan: { id: string; code: string | null; name: string; starts_on: string | null; ends_on: string | null; org_name: string | null }
  programs: { title: string; code: string; pass_attendance: number; pass_score: number | null; need_product: boolean }[]
  units: Unit[]; attendance: { present: number; total: number }; product: Product | null }
type Q = { id: string; stem: string; options: string[]; kind: 'single' | 'multi' | 'truefalse' }

export const PRODUCT_ST: Record<string, [string, string]> = {
  submitted: ['Đã nộp · chờ nhận xét', 'maintenance'], accepted: ['Đã nhận', 'active'], returned: ['Trả lại · cần sửa', 'inactive'],
}
const LECT: Record<string, string> = { slide: 'Slide', video: 'Video', plan: 'Giáo án', other: 'Bài giảng' }
const DOC: Record<string, string> = { doc: 'Tài liệu đọc', guide: 'Hướng dẫn', form: 'Biểu mẫu', ref: 'Tham khảo' }
const OPEN_MS = 15 * 60000
const num = (n: number | null | undefined) => n == null ? '—' : String(n).replace('.', ',')
const pct = (a: number, b: number) => b ? Math.round(a * 100 / b) : 0

// Link YouTube → link nhúng để xem ngay trong trang
function embedUrl(u?: string) {
  if (!u) return null
  const m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/)
  return m ? `https://www.youtube.com/embed/${m[1]}` : null
}

export function TeacherTrainingLearn({ teacherId }: TProps) {
  const [rows, setRows] = useState<Course[] | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const load = () => supabase.rpc('training_my_courses').then(({ data, error }) => {
    if (error) setErr(error.message); else { setErr(''); setRows((data as Course[]) ?? []) }
  })
  useEffect(() => { if (teacherId) load() }, [teacherId])
  if (!teacherId) return <NoTeacher />
  if (open) return <CourseView planId={open} onBack={() => { setOpen(null); load() }} />
  if (!rows) return err ? <p className="sub" role="alert">{err}</p> : <p className="sub">Đang tải…</p>

  const done = rows.filter(r => r.units > 0 && r.done >= r.units).length
  return <>
    <div className="cards">
      <div className="card"><strong>{rows.length}</strong><span>Khoá đang tham gia</span></div>
      <div className="card"><strong>{rows.length - done}</strong><span>Đang học</span></div>
      <div className="card"><strong>{done}</strong><span>Đã học xong nội dung</span></div>
      <div className="card"><strong>{rows.filter(r => r.need_product && r.product_status !== 'accepted').length}</strong><span>Sản phẩm cần nộp / sửa</span></div>
    </div>
    {err && <p className="sub" role="alert" style={{ color: 'var(--bad)' }}>{err}</p>}
    <div className="tlcourses">
      {rows.map(r => <div key={r.plan_id} className="panel tlcourse">
        <div><small className="sub">{r.plan_code}{r.org_name ? ` · ${r.org_name}` : ''}</small>
          <h3>{r.name}</h3>
          <small className="sub">{r.programs || 'Chưa có chương trình'}</small><br />
          <small className="sub">{r.starts_on ? fmtDate(r.starts_on) : '?'} – {r.ends_on ? fmtDate(r.ends_on) : '?'}</small></div>
        <div>
          <div className="progress" aria-label={`Tiến độ ${pct(r.done, r.units)}%`}><i style={{ width: `${pct(r.done, r.units)}%` }} /></div>
          <small className="sub">{r.done}/{r.units} nội dung · {pct(r.done, r.units)}%</small>
          {r.need_product && <><br /><small>Sản phẩm: {r.product_status ? PRODUCT_ST[r.product_status][0] : 'Chưa nộp'}</small></>}
        </div>
        <button type="button" className="primary" onClick={() => setOpen(r.plan_id)}>{r.done ? 'Học tiếp' : 'Vào học'}</button>
      </div>)}
      {!rows.length && <p className="sub">Bạn chưa được ghi danh vào khoá tập huấn nào. Trường chọn giáo viên tham gia ở mục Kế hoạch tập huấn.</p>}
    </div>
  </>
}

function CourseView({ planId, onBack }: { planId: string; onBack: () => void }) {
  const [c, setC] = useState<Full | null>(null)
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [testing, setTesting] = useState<Unit | null>(null)
  const load = () => supabase.rpc('training_course', { p_plan: planId }).then(({ data, error }) => {
    if (error) return setErr(error.message)
    const f = data as Full
    setErr(''); setC(f)
    // Mặc định mở nội dung đầu tiên chưa xong
    setSel(s => s ?? (f.units.find(u => !u.done && u.unlocked) ?? f.units[0])?.id ?? null)
  })
  useEffect(() => { load() }, [planId])
  if (!c) return <ElView back="Khoá tập huấn của tôi" onBack={onBack} title="Khoá tập huấn">{err ? <p className="sub" role="alert">{err}</p> : <p className="sub">Đang tải…</p>}</ElView>
  if (testing) return <TestRun planId={planId} unit={testing} onBack={() => { setTesting(null); load() }} />

  const u = c.units.find(x => x.id === sel) ?? null
  const done = c.units.filter(x => x.done).length
  const needProduct = c.programs.some(p => p.need_product)
  const passAtt = Math.max(0, ...c.programs.map(p => p.pass_attendance))
  const subjects = [...new Set(c.units.map(x => x.subject))]
  return <ElView back="Khoá tập huấn của tôi" onBack={onBack} title={c.plan.name}
    sub={[c.plan.code, c.plan.org_name, c.programs.map(p => p.title).join(' · ')].filter(Boolean).join(' · ')}>
    <div className="diststatcards four">
      <div className="panel"><i className={done === c.units.length && done ? 'good' : ''}>📘</i><span><small>Nội dung đã học</small><b>{done}/{c.units.length}</b><small>{pct(done, c.units.length)}%</small></span></div>
      <div className="panel"><i>🗓</i><span><small>Chuyên cần</small><b>{c.attendance.total ? `${pct(c.attendance.present, c.attendance.total)}%` : '—'}</b><small>{c.attendance.present}/{c.attendance.total} buổi · cần {passAtt}%</small></span></div>
      <div className="panel"><i>📝</i><span><small>Bài kiểm tra đạt</small><b>{c.units.filter(x => x.test && (x.best_score ?? -1) >= x.test.pass).length}/{c.units.filter(x => x.test).length}</b><small>Theo điểm cao nhất</small></span></div>
      <div className={`panel`}><i className={c.product?.status === 'accepted' ? 'good' : c.product?.status === 'returned' ? 'warn' : ''}>📦</i><span><small>Sản phẩm cuối khoá</small>
        <b style={{ fontSize: 16 }}>{!needProduct ? 'Không yêu cầu' : c.product ? PRODUCT_ST[c.product.status][0] : 'Chưa nộp'}</b></span></div>
    </div>
    {err && <p className="sub" role="alert" style={{ color: 'var(--bad)' }}>{err}</p>}
    <div className="tlgrid">
      <nav className="panel tlnav" aria-label="Nội dung tập huấn">
        {subjects.map(s => <div key={s}><small className="sub"><b>{s}</b></small>
          {c.units.filter(x => x.subject === s).map(x => <button key={x.id} type="button" className={`tlunit${x.id === sel ? ' on' : ''}${x.unlocked ? '' : ' locked'}`}
            onClick={() => setSel(x.id)} aria-current={x.id === sel}>
            <span aria-hidden>{x.done ? '✓' : x.unlocked ? x.ord : '🔒'}</span><span>{x.title}<br /><small className="sub">{num(x.hours)} giờ{x.test ? ' · có bài kiểm tra' : ''}</small></span>
          </button>)}</div>)}
        {!c.units.length && <small className="sub">Chương trình chưa có nội dung.</small>}
      </nav>
      <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
        {u && <UnitPanel key={u.id} planId={planId} u={u} onChange={load} onTest={() => setTesting(u)} onErr={setErr} />}
        {needProduct && <ProductPanel planId={planId} p={c.product} allDone={done === c.units.length} onChange={load} />}
      </div>
    </div>
  </ElView>
}

function UnitPanel({ planId, u, onChange, onTest, onErr }: { planId: string; u: Unit; onChange: () => void; onTest: () => void; onErr: (s: string) => void }) {
  const [busy, setBusy] = useState('')
  const [play, setPlay] = useState<string | null>(null)
  const items: [string, Row, 'l' | 'd'][] = [...(u.detail.lectures ?? []).map((r, i) => [`l${i}`, r, 'l'] as [string, Row, 'l']),
    ...(u.detail.docs ?? []).map((r, i) => [`d${i}`, r, 'd'] as [string, Row, 'd'])]
  const seenAll = items.every(([k]) => u.seen.includes(k))
  const body = u.detail.body ?? {}

  async function mark(key: string) {
    if (u.seen.includes(key)) return
    const { error } = await supabase.rpc('training_learn_mark', { p_plan: planId, p_unit: u.id, p_key: key })
    if (error) onErr(error.message); else { onErr(''); onChange() }
  }
  function openItem(key: string, r: Row) {
    const emb = embedUrl(r.url)
    if (emb) setPlay(play === key ? null : key)
    else if (r.url) { const w = window.open(r.url, '_blank'); if (w) w.opener = null }
    mark(key)
  }
  async function join(s: USess) {
    const w = s.meeting_url ? window.open(s.meeting_url, '_blank') : null
    if (w) w.opener = null
    setBusy(s.id)
    const { error } = await supabase.rpc('training_check_in', { p_session: s.id })
    setBusy('')
    if (error) onErr(error.message); else { onErr(''); onChange() }
  }

  if (!u.unlocked) return <section className="panel"><h3 style={{ marginTop: 0 }}>🔒 {u.title}</h3>
    <p className="sub">Nội dung này mở khi bạn hoàn thành các nội dung đứng trước (mở hết bài giảng, tài liệu và đạt bài kiểm tra nếu có).</p></section>

  const now = Date.now()
  return <section className="panel" style={{ display: 'grid', gap: 14 }}>
    <div className="bar" style={{ margin: 0 }}><div><small className="sub">{u.subject} · Nội dung {u.ord}</small><h3 style={{ margin: '2px 0 0' }}>{u.title}</h3></div>
      {u.done ? <span className="pill active">Đã hoàn thành</span> : <span className="pill maintenance">Đang học</span>}</div>
    {(body.goal || body.text || body.reqs?.length) && <dl className="tpkv">
      {body.goal && <><dt>Mục tiêu</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{body.goal}</dd></>}
      {body.text && <><dt>Nội dung</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{body.text}</dd></>}
      {!!body.reqs?.length && <><dt>Yêu cầu cần đạt</dt><dd><ul style={{ margin: 0, paddingLeft: 18 }}>{body.reqs.map((r, i) => <li key={i}>{r}</li>)}</ul></dd></>}
    </dl>}

    {!!items.length && <div>
      <b>Bài giảng & tài liệu</b> <small className="sub">({items.filter(([k]) => u.seen.includes(k)).length}/{items.length} đã mở)</small>
      <ul className="tlitems">{items.map(([k, r, t]) => <li key={k}>
        <span aria-hidden className={u.seen.includes(k) ? 'tlok' : 'tlnot'}>{u.seen.includes(k) ? '✓' : '○'}</span>
        <span style={{ minWidth: 0 }}><b>{r.title || (t === 'l' ? 'Bài giảng' : 'Tài liệu')}</b><br />
          <small className="sub">{t === 'l' ? LECT[r.kind] ?? 'Bài giảng' : DOC[r.kind] ?? 'Tài liệu'}{r.minutes ? ` · ${r.minutes} phút` : ''}{r.note ? ` · ${r.note}` : ''}</small>
          {play === k && embedUrl(r.url) && <div className="tlvideo"><iframe src={embedUrl(r.url)!} title={r.title || 'Video'} allowFullScreen /></div>}</span>
        <button type="button" onClick={() => openItem(k, r)} disabled={!r.url && u.seen.includes(k)}>
          {embedUrl(r.url) ? (play === k ? 'Thu gọn' : 'Xem') : r.url ? 'Mở ↗' : 'Đánh dấu đã đọc'}</button>
      </li>)}</ul>
    </div>}

    {!!u.sessions.length && <div><b>Buổi học / lớp học ảo</b>
      <ul className="tlitems">{u.sessions.map(s => {
        const live = now >= new Date(s.starts_at).getTime() - OPEN_MS && now <= new Date(s.ends_at).getTime() + OPEN_MS && !s.closed
        return <li key={s.id}>
          <span aria-hidden className={s.present ? 'tlok' : 'tlnot'}>{s.present ? '✓' : s.mode === 'online' ? '🎥' : '🏫'}</span>
          <span><b>{fmtDate(s.starts_at)} · {fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</b><br />
            <small className="sub">{s.mode === 'online' ? 'Trực tuyến' : `Trực tiếp${s.location ? ` · ${s.location}` : ''}`}
              {s.present === true ? ' · Có mặt' : s.present === false ? ' · Vắng' : ''}</small></span>
          <span className="tools">
            {live && s.mode === 'online' && s.present !== true && <button type="button" className="primary" disabled={busy === s.id} onClick={() => join(s)}>{s.meeting_url ? 'Tham gia' : 'Điểm danh'}</button>}
            {live && s.mode === 'online' && s.present === true && s.meeting_url && <a className="filebtn" href={s.meeting_url} target="_blank" rel="noreferrer">Vào lại phòng họp</a>}
            {live && s.mode !== 'online' && <small className="sub">Điểm danh bằng mã ở mục Lịch tập huấn</small>}
            {s.recording_url && <a className="filebtn" href={s.recording_url} target="_blank" rel="noreferrer">▶ Xem bản ghi</a>}
          </span>
        </li>
      })}</ul></div>}

    {u.test && <div className="tltest">
      <div><b>Bài kiểm tra</b><br /><small className="sub">{u.test.count} câu{u.test.minutes ? ` · ${u.test.minutes} phút` : ' · không giới hạn thời gian'} · điểm đạt {num(u.test.pass)}/10
        {u.test.attempts ? ` · đã làm ${u.test.used}/${u.test.attempts} lượt` : u.test.used ? ` · đã làm ${u.test.used} lượt` : ''}</small><br />
        <small>Điểm cao nhất: <b>{num(u.best_score)}</b>{u.best_score != null && (u.best_score >= u.test.pass ? ' · Đạt' : ' · Chưa đạt')}</small></div>
      {!seenAll ? <small className="sub">Mở hết bài giảng và tài liệu để làm bài.</small>
        : u.test.attempts && u.test.used >= u.test.attempts && !u.test.open ? <small className="sub">Đã hết lượt làm bài.</small>
        : <button type="button" className="primary" onClick={onTest}>{u.test.open ? 'Làm tiếp' : u.test.used ? 'Làm lại' : 'Làm bài'}</button>}
    </div>}
    {!items.length && !u.test && !u.sessions.length && !body.text && <p className="sub">Nội dung này học ở buổi tập huấn, không có phần học trực tuyến.</p>}
  </section>
}

function TestRun({ planId, unit, onBack }: { planId: string; unit: Unit; onBack: () => void }) {
  const [paper, setPaper] = useState<{ attempt: string; deadline: string | null; questions: Q[] } | null>(null)
  const [ans, setAns] = useState<Record<string, number[]>>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ correct: number; total: number; score: number; pass: number; passed: boolean } | null>(null)
  const [left, setLeft] = useState<number | null>(null)
  const sent = useRef(false)

  useEffect(() => {
    supabase.rpc('training_test_start', { p_plan: planId, p_unit: unit.id }).then(({ data, error }) => {
      if (error) setErr(error.message); else setPaper(data as typeof paper)
    })
  }, [planId, unit.id])
  async function submit() {
    if (!paper || sent.current) return
    sent.current = true; setBusy(true)
    const { data, error } = await supabase.rpc('training_test_submit', { p_attempt: paper.attempt, p_answers: ans })
    setBusy(false)
    if (error) { sent.current = false; return setErr(error.message) }
    setRes(data as typeof res)
  }
  // Đồng hồ đếm ngược; hết giờ thì tự nộp
  useEffect(() => {
    if (!paper?.deadline || res) return
    const tick = () => {
      const s = Math.max(0, Math.round((new Date(paper.deadline!).getTime() - Date.now()) / 1000))
      setLeft(s)
      if (s === 0) submit()
    }
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t)
  }, [paper, res])

  const answered = useMemo(() => paper?.questions.filter(q => ans[q.id]?.length).length ?? 0, [paper, ans])
  const pick = (q: Q, i: number) => setAns(a => {
    if (q.kind !== 'multi') return { ...a, [q.id]: [i] }
    const cur = a[q.id] ?? []
    return { ...a, [q.id]: cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i].sort() }
  })

  return <ElView back={unit.title} onBack={() => { if (res || !paper || confirm('Thoát khi chưa nộp? Lượt làm vẫn giữ, bạn có thể làm tiếp.')) onBack() }}
    title={`Bài kiểm tra: ${unit.title}`}
    sub={unit.test ? `${unit.test.count} câu · điểm đạt ${num(unit.test.pass)}/10` : undefined}
    actions={paper && !res && <>{left != null && <span className={`pill ${left < 60 ? 'inactive' : 'maintenance'}`} role="timer">⏱ {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</span>}
      <button type="button" className="primary" disabled={busy} onClick={() => { if (answered === paper.questions.length || confirm(`Còn ${paper.questions.length - answered} câu chưa làm. Nộp bài?`)) submit() }}>{busy ? 'Đang nộp…' : 'Nộp bài'}</button></>}>
    {err && <p className="sub" role="alert" style={{ color: 'var(--bad)' }}>{err}</p>}
    {res ? <section className="panel" style={{ textAlign: 'center', display: 'grid', gap: 8, justifyItems: 'center' }}>
      <span className={`pill ${res.passed ? 'active' : 'inactive'}`}>{res.passed ? 'Đạt' : 'Chưa đạt'}</span>
      <b style={{ fontSize: 36 }}>{num(res.score)}/10</b>
      <span className="sub">Đúng {res.correct}/{res.total} câu · điểm đạt {num(res.pass)}</span>
      <button type="button" className="primary" onClick={onBack}>Quay lại nội dung</button>
    </section>
      : !paper ? (!err && <p className="sub">Đang phát đề…</p>)
      : <>
        <p className="sub">Đã làm {answered}/{paper.questions.length} câu.{paper.deadline ? ' Hết giờ hệ thống tự nộp bài.' : ''}</p>
        {paper.questions.map((q, n) => <fieldset key={q.id} className="panel tlq">
          <legend><b>Câu {n + 1}.</b> {q.kind === 'multi' && <small className="sub">(chọn nhiều đáp án)</small>}</legend>
          <p style={{ whiteSpace: 'pre-wrap', margin: '0 0 8px' }}>{q.stem}</p>
          {q.options.map((o, i) => <label key={i} className={`tlopt${ans[q.id]?.includes(i) ? ' on' : ''}`}>
            <input type={q.kind === 'multi' ? 'checkbox' : 'radio'} name={q.id} checked={!!ans[q.id]?.includes(i)} onChange={() => pick(q, i)} />
            <span>{String.fromCharCode(65 + i)}. {o}</span></label>)}
        </fieldset>)}
      </>}
  </ElView>
}

function ProductPanel({ planId, p, allDone, onChange }: { planId: string; p: Product | null; allDone: boolean; onChange: () => void }) {
  const [url, setUrl] = useState(p?.url ?? '')
  const [note, setNote] = useState(p?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [edit, setEdit] = useState(!p)
  async function send() {
    setBusy(true); setMsg('')
    const { error } = await supabase.rpc('training_product_submit', { p_plan: planId, p_url: url, p_note: note })
    setBusy(false)
    if (error) return setMsg(error.message)
    setEdit(false); setMsg('Đã nộp sản phẩm.'); onChange()
  }
  return <section className="panel" style={{ display: 'grid', gap: 10 }}>
    <div className="bar" style={{ margin: 0 }}><b>📦 Sản phẩm cuối khoá</b>{p && <span className={`pill ${PRODUCT_ST[p.status][1]}`}>{PRODUCT_ST[p.status][0]}</span>}</div>
    {!allDone && !p && <small className="sub">Nên nộp sau khi học xong các nội dung. Bạn vẫn nộp trước được.</small>}
    {p?.feedback && <p style={{ margin: 0 }}><small className="sub">Nhận xét của đơn vị tổ chức:</small><br />{p.feedback}</p>}
    {p && !edit && <dl className="tpkv">
      <dt>Link</dt><dd>{p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.url}</a> : '—'}</dd>
      <dt>Mô tả</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{p.note || '—'}</dd>
      <dt>Nộp lúc</dt><dd>{fmtDate(p.submitted_at)} {fmtTime(p.submitted_at)}</dd>
    </dl>}
    {edit ? <>
      <label className="field"><span>Link sản phẩm (Drive, video, ảnh…)</span><input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></label>
      <label className="field"><span>Mô tả ngắn</span><textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="Sản phẩm là gì, áp dụng ở lớp nào…" /></label>
      <div className="tools"><button type="button" className="primary" disabled={busy || (!url.trim() && !note.trim())} onClick={send}>{busy ? 'Đang nộp…' : p ? 'Nộp lại' : 'Nộp sản phẩm'}</button>
        {p && <button type="button" onClick={() => setEdit(false)}>Huỷ</button>}</div>
    </> : p?.status !== 'accepted' && <div><button type="button" onClick={() => setEdit(true)}>{p?.status === 'returned' ? 'Sửa và nộp lại' : 'Sửa bài nộp'}</button></div>}
    {msg && <small role="status">{msg}</small>}
  </section>
}
