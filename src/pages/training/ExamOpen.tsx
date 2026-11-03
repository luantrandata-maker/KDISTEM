// Giảng viên mở đề (129): ở một buổi tập huấn, giảng viên / đơn vị tổ chức mở bài kiểm tra hoặc đề cuối khoá cho học viên vào làm,
// chọn cho học viên có mặt ở buổi hoặc cả kế hoạch, đặt thời gian tự đóng; theo dõi ai đã vào làm, đã nộp, điểm; đóng đề khi xong.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Chip } from '../dist/Editor'

type Win = { id: string; session_id: string | null; audience: 'all' | 'session'; opened_at: string; closes_at: string | null; closed_at: string | null; open: boolean }
type BRow = { teacher_id: string; name: string; school: string | null; started_at: string | null; submitted_at: string | null; score: number | null; opened: string | null }
type Ex = { kind: 'unit' | 'final'; unit_id: string | null; program_id: string | null; title: string; sub: string | null; test_kind: 'bank' | 'link'; minutes: number | null
  mode: 'self' | 'trainer'; this_session: boolean; window: Win | null; rows: BRow[] }

const hm = (d: string) => new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
const num = (n: number | null) => n == null ? '—' : String(Math.round(n * 10) / 10).replace('.', ',')
const DUR: [string, string][] = [['', 'Đến khi bấm Đóng đề'], ['15', '15 phút'], ['30', '30 phút'], ['45', '45 phút'], ['60', '60 phút'], ['90', '90 phút'], ['120', '2 giờ'], ['1440', '1 ngày']]
const errText = (m: string) => /schema cache|does not exist/i.test(m) ? 'Hệ thống chưa cập nhật phần mở đề, báo quản trị.' : m

export function SessionExams({ planId, sessionId, offline }: { planId: string; sessionId: string; offline: boolean }) {
  const [list, setList] = useState<Ex[] | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [see, setSee] = useState<string | null>(null)
  const [aud, setAud] = useState<Record<string, 'session' | 'all'>>({})
  const [dur, setDur] = useState<Record<string, string>>({})
  const load = () => supabase.rpc('training_exam_board', { p_plan: planId, p_session: sessionId }).then(({ data, error }) => {
    if (error) { setErr(errText(error.message)); setList([]) } else { setErr(''); setList((data ?? []) as Ex[]) }
  })
  useEffect(() => { load() }, [planId, sessionId])
  const anyOpen = !!list?.some(e => e.window?.open)
  // Đề đang mở: cập nhật danh sách làm bài mỗi 10 giây
  useEffect(() => {
    if (!anyOpen) return
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [anyOpen, planId, sessionId])

  const key = (e: Ex) => e.unit_id ?? e.program_id ?? ''
  async function open(e: Ex) {
    setBusy(key(e)); setMsg('')
    const a = aud[key(e)] ?? 'session', d = dur[key(e)] ?? ''
    const { error } = await supabase.rpc('training_exam_open', { p_plan: planId, p_unit: e.unit_id, p_program: e.program_id, p_session: sessionId,
      p_audience: a, p_minutes: d ? Number(d) : null })
    setBusy('')
    if (error) return setMsg(errText(error.message))
    setMsg(`Đã mở "${e.title}" cho ${a === 'session' ? 'học viên có mặt ở buổi này' : 'tất cả học viên của kế hoạch'}.`)
    setSee(key(e)); load()
  }
  async function close(e: Ex) {
    if (!e.window || !confirm(`Đóng đề "${e.title}"? Học viên đang làm vẫn nộp được bài đang làm, nhưng không vào làm mới.`)) return
    setBusy(key(e))
    const { error } = await supabase.rpc('training_exam_close', { p_window: e.window.id })
    setBusy('')
    if (error) return setMsg(errText(error.message))
    setMsg(`Đã đóng "${e.title}".`); load()
  }

  if (list === null) return null
  const led = list.filter(e => e.mode === 'trainer'), self = list.filter(e => e.mode !== 'trainer')
  if (!list.length && !err) return null
  return <section className="panel" style={{ display: 'grid', gap: 12 }}>
    <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Đề kiểm tra</h3>
      <small className="sub">{led.length} đề do giảng viên mở{self.length ? ` · ${self.length} đề học viên tự làm (không cần mở)` : ''}</small></div>
    {err && <p className="msg">{err}</p>}
    {msg && <p className="sub" role="status"><b>{msg}</b></p>}
    {!led.length && !err && <p className="sub" style={{ margin: 0 }}>Các đề của kế hoạch này để học viên tự làm khi học xong. Muốn giảng viên mở đề trong buổi học thì đổi
      "Làm bài kiểm tra" ở Kế hoạch tập huấn › Thông tin kế hoạch, hoặc chọn "Giảng viên mở đề" ở từng bài kiểm tra của chương trình.</p>}
    {led.map(e => {
      const k = key(e), w = e.window, n = e.rows.length
      const started = e.rows.filter(r => r.started_at || r.opened).length, sent = e.rows.filter(r => r.submitted_at).length
      return <div key={k} className="panel" style={{ display: 'grid', gap: 8, padding: 12 }}>
        <div className="bar" style={{ margin: 0, alignItems: 'flex-start' }}>
          <span><b>{e.kind === 'final' ? '📝 ' : ''}{e.title}</b> {e.this_session && <Chip tone="good">Nội dung của buổi này</Chip>}<br />
            <small className="sub">{e.kind === 'final' ? 'Đề cuối khoá' : e.sub}{e.test_kind === 'link' ? ' · làm qua link' : e.minutes ? ` · ${e.minutes} phút mỗi lượt` : ''}</small></span>
          {w?.open ? <span className="tools"><Chip tone="bad">Đang mở</Chip>
            <small className="sub">{w.closes_at ? `tự đóng lúc ${hm(w.closes_at)}` : 'đến khi bấm Đóng đề'}</small>
            <button type="button" className="danger" disabled={busy === k} onClick={() => close(e)}>Đóng đề</button></span>
            : w ? <small className="sub">Đã đóng lúc {hm(w.closed_at ?? w.closes_at ?? w.opened_at)}</small> : <small className="sub">Chưa mở</small>}
        </div>
        {!w?.open && <div className="tools" style={{ flexWrap: 'wrap' }}>
          <select value={aud[k] ?? 'session'} aria-label="Ai được làm" onChange={ev => setAud({ ...aud, [k]: ev.target.value as 'session' | 'all' })}>
            <option value="session">Học viên có mặt ở buổi này{offline ? ' (đã điểm danh)' : ''}</option>
            <option value="all">Tất cả học viên của kế hoạch</option></select>
          <select value={dur[k] ?? ''} aria-label="Thời gian mở đề" onChange={ev => setDur({ ...dur, [k]: ev.target.value })}>
            {DUR.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <button type="button" className="primary" disabled={busy === k} onClick={() => open(e)}>{w ? 'Mở lại đề' : 'Mở đề'}</button>
        </div>}
        {w && <>
          <small className="sub">{w.audience === 'session' ? 'Cho học viên có mặt ở buổi' : 'Cho tất cả học viên của kế hoạch'} · mở lúc {hm(w.opened_at)} ·
            {e.test_kind === 'link' ? ` ${started}/${n} đã mở bài` : ` ${started}/${n} đã vào làm · ${sent}/${n} đã nộp`}
            {' '}<button type="button" className="linkbtn" onClick={() => setSee(see === k ? null : k)}>{see === k ? 'Ẩn danh sách' : 'Xem danh sách'}</button></small>
          {see === k && <div className="wrap"><table className="libtable">
            <thead><tr><th>Giáo viên</th><th>Trường</th><th>Trạng thái</th><th style={{ width: 80 }}>Điểm</th></tr></thead>
            <tbody>{e.rows.map(r => <tr key={r.teacher_id}>
              <td><b>{r.name}</b></td><td>{r.school ?? '—'}</td>
              <td>{r.submitted_at ? <><Chip tone="good">Đã nộp</Chip> <small className="sub">{hm(r.submitted_at)}</small></>
                : r.started_at ? <><Chip tone="warn">Đang làm</Chip> <small className="sub">từ {hm(r.started_at)}</small></>
                : r.opened ? <Chip tone="warn">Đã mở link</Chip> : <small className="sub">Chưa vào</small>}</td>
              <td className="num">{num(r.score)}</td>
            </tr>)}
              {!n && <tr><td colSpan={4}><small className="sub">{w.audience === 'session' ? 'Chưa học viên nào điểm danh có mặt ở buổi này.' : 'Kế hoạch chưa có học viên học nội dung này.'}</small></td></tr>}</tbody>
          </table></div>}
        </>}
      </div>
    })}
  </section>
}
