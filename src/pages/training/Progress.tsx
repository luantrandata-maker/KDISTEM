// Phân hệ 1 — Tiến độ học trực tuyến của giáo viên trong một kế hoạch tập huấn (086).
// Đơn vị lập kế hoạch: xem mọi GV, nhận / trả lại sản phẩm. Trường: xem GV của trường mình.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Chip } from '../dist/Editor'

type Row = { teacher_id: string; teacher_name: string; org_name: string | null; units: number; done: number; tests: number; tests_passed: number
  avg_score: number | null; present: number; sessions: number; product_status: 'submitted' | 'accepted' | 'returned' | null
  product_url: string | null; product_note: string | null; product_feedback: string | null; last_at: string | null }
type F = 'all' | 'none' | 'doing' | 'done' | 'product'
const PST: Record<string, [string, string]> = { submitted: ['Chờ nhận xét', 'warn'], accepted: ['Đã nhận', 'good'], returned: ['Trả lại', 'bad'] }
const pct = (a: number, b: number) => b ? Math.round(a * 100 / b) : 0
const stOf = (r: Row): Exclude<F, 'all' | 'product'> => r.done === 0 && !r.last_at ? 'none' : r.units && r.done >= r.units ? 'done' : 'doing'

export function PlanProgress({ planId, manage }: { planId: string; manage: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')
  const [f, setF] = useState<F>('all')
  const [busy, setBusy] = useState('')
  const load = () => supabase.rpc('training_plan_progress', { p_plan: planId }).then(({ data, error }) => {
    if (error) setErr(/does not exist|schema cache/i.test(error.message) ? 'Hãy chạy migration 086 trên Supabase.' : error.message)
    else { setErr(''); setRows((data as Row[]) ?? []) }
  })
  useEffect(() => { load() }, [planId])

  async function review(r: Row, accept: boolean) {
    const fb = accept ? prompt(`Nhận xét cho sản phẩm của ${r.teacher_name} (không bắt buộc):`, r.product_feedback ?? '') : prompt(`Lý do trả lại sản phẩm của ${r.teacher_name}:`)
    if (fb === null || (!accept && !fb.trim())) return
    setBusy(r.teacher_id)
    const { error } = await supabase.rpc('training_product_review', { p_plan: planId, p_teacher: r.teacher_id, p_accept: accept, p_feedback: fb })
    setBusy('')
    if (error) setErr(error.message); else load()
  }

  if (!rows) return <section className="panel">{err ? <p className="sub" role="alert">{err}</p> : <p className="sub">Đang tải tiến độ…</p>}</section>
  const n = (k: F) => k === 'all' ? rows.length : k === 'product' ? rows.filter(r => r.product_status === 'submitted').length : rows.filter(r => stOf(r) === k).length
  const shown = rows.filter(r => f === 'all' || (f === 'product' ? r.product_status === 'submitted' : stOf(r) === f))
  const chips: [F, string][] = [['all', 'Tất cả'], ['none', 'Chưa học'], ['doing', 'Đang học'], ['done', 'Đã học xong'], ['product', 'Sản phẩm chờ nhận xét']]
  return <section className="panel" style={{ display: 'grid', gap: 12 }}>
    <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Tiến độ học trực tuyến</h3>
      <small className="sub">{rows.length} giáo viên · {n('done')} đã học xong · {rows.filter(r => r.product_status).length} đã nộp sản phẩm</small></div>
    {err && <p className="sub" role="alert" style={{ color: 'var(--bad)' }}>{err}</p>}
    <div className="distfilter">{chips.map(([k, l]) => <button key={k} type="button" className={`distfchip${f === k ? ' on' : ''}`} onClick={() => setF(k)}>{l} ({n(k)})</button>)}</div>
    <div className="wrap"><table className="libtable">
      <thead><tr><th>Giáo viên</th><th style={{ width: 170 }}>Nội dung đã học</th><th>Bài kiểm tra</th><th>Chuyên cần</th><th>Sản phẩm</th>{manage && <th></th>}</tr></thead>
      <tbody>{shown.map(r => <tr key={r.teacher_id}>
        <td><b>{r.teacher_name}</b><br /><small className="sub">{r.org_name ?? '—'}{r.last_at ? ` · học gần nhất ${new Date(r.last_at).toLocaleDateString('vi-VN')}` : ''}</small></td>
        <td><div className="progress"><i style={{ width: `${pct(r.done, r.units)}%` }} /></div><small className="sub">{r.done}/{r.units} · {pct(r.done, r.units)}%</small></td>
        <td>{r.tests ? <>{r.tests_passed}/{r.tests} đạt<br /><small className="sub">Điểm TB {r.avg_score == null ? '—' : String(r.avg_score).replace('.', ',')}</small></> : <small className="sub">Không có</small>}</td>
        <td>{r.sessions ? <>{pct(r.present, r.sessions)}%<br /><small className="sub">{r.present}/{r.sessions} buổi</small></> : <small className="sub">Chưa có buổi</small>}</td>
        <td style={{ whiteSpace: 'normal', maxWidth: 260 }}>{r.product_status ? <>
          <Chip tone={PST[r.product_status][1]}>{PST[r.product_status][0]}</Chip>
          {r.product_url && <><br /><a href={r.product_url} target="_blank" rel="noreferrer">Mở sản phẩm ↗</a></>}
          {r.product_note && <><br /><small className="sub">{r.product_note}</small></>}
          {r.product_feedback && <><br /><small>Nhận xét: {r.product_feedback}</small></>}
        </> : <small className="sub">Chưa nộp</small>}</td>
        {manage && <td><div className="tools">{r.product_status && r.product_status !== 'accepted' && <>
          <button type="button" className="primary" disabled={busy === r.teacher_id} onClick={() => review(r, true)}>Nhận</button>
          <button type="button" disabled={busy === r.teacher_id} onClick={() => review(r, false)}>Trả lại</button></>}
          {r.product_status === 'accepted' && <button type="button" disabled={busy === r.teacher_id} onClick={() => review(r, false)}>Trả lại</button>}</div></td>}
      </tr>)}
        {!shown.length && <tr><td colSpan={manage ? 6 : 5}><small className="sub">{rows.length ? 'Không có giáo viên nào khớp bộ lọc.' : 'Chưa có giáo viên ghi danh.'}</small></td></tr>}</tbody>
    </table></div>
  </section>
}
