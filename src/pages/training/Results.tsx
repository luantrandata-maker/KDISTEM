// Phân hệ 1 — Đánh giá kết quả tập huấn (087). Mỗi kế hoạch một bảng kết quả, mỗi giáo viên một dòng.
// Hệ thống tự tính chuyên cần, bài kiểm tra, tiến độ học, sản phẩm và gợi ý Đạt / Chưa đạt theo điều kiện của chương trình;
// đơn vị lập kế hoạch chấm sản phẩm, kết luận, cho thi lại. Đạt thì có chứng chỉ chờ duyệt ở mục Chứng chỉ tập huấn.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ElView } from '../../components/ElView'
import { Chip } from '../dist/Editor'

type Plan = { id: string; org_id: string; plan_code: string | null; name: string }
type M = { sessions: number; present: number; excused: number; att_pct: number | null; att_req: number; units: number; done: number; tests: number
  tests_passed: number; avg_score: number | null; score_req: number | null; need_product: boolean; product_status: string | null
  ok_att: boolean; ok_tests: boolean; ok_units: boolean; ok_product: boolean; suggest: 'pass' | 'fail' }
export type ResRow = { teacher_id: string; teacher_name: string; subject: string | null; org_name: string | null; metrics: M; result: 'pending' | 'pass' | 'fail'
  reason: string | null; product_score: number | null; comment: string | null; extra_attempts: number; decided_at: string | null
  product_url: string | null; product_note: string | null; cert_id: string | null; cert_status: string | null; cert_code: string | null }
type F = 'all' | 'ready' | 'pending' | 'pass' | 'fail'

export const RESULT: Record<string, [string, string]> = { pending: ['Chờ kết luận', ''], pass: ['Đạt', 'good'], fail: ['Chưa đạt', 'bad'] }
export const CERT_ST: Record<string, [string, string]> = { pending: ['Chờ duyệt cấp', 'warn'], issued: ['Đã cấp', 'good'], revoked: ['Đã thu hồi', 'bad'] }
const PRODUCT: Record<string, string> = { submitted: 'Đã nộp, chờ nhận xét', accepted: 'Đã nhận', returned: 'Trả lại' }
const num = (n: number | null | undefined) => n == null ? '—' : String(n).replace('.', ',')
const errText = (m: string) => /schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 087 trên Supabase.' : m
const ok = (b: boolean) => <span aria-label={b ? 'đạt điều kiện' : 'chưa đạt điều kiện'} className={b ? 'tlok' : 'warnline'}>{b ? '✓' : '✗'}</span>

export function TrainingResultsPage({ orgId }: { orgId: string }) {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [plan, setPlan] = useState('')
  const [rows, setRows] = useState<ResRow[] | null>(null)
  const [can, setCan] = useState(false)
  const [f, setF] = useState<F>('all')
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    supabase.from('training_plans').select('id, org_id, plan_code, name').neq('pub_status', 'draft').order('plan_code', { ascending: false }).then(({ data, error }) => {
      if (error) { setMsg([errText(error.message), true]); setPlans([]); return }
      const ps = (data as Plan[]) ?? []
      // Kế hoạch của đơn vị mình lên trước
      ps.sort((a, b) => Number(b.org_id === orgId) - Number(a.org_id === orgId))
      setPlans(ps); setPlan(p => p || ps[0]?.id || '')
    })
  }, [orgId])
  const load = () => {
    if (!plan) return
    setRows(null)
    supabase.rpc('training_plan_results', { p_plan: plan }).then(({ data, error }) => { if (error) { setMsg([errText(error.message), true]); setRows([]) } else setRows((data as ResRow[]) ?? []) })
    supabase.rpc('training_plan_can_manage', { p_plan: plan }).then(({ data }) => setCan(!!data))
  }
  useEffect(load, [plan])

  const p = plans?.find(x => x.id === plan)
  const cur = rows?.find(r => r.teacher_id === open)
  if (cur && p) return <ResultDetail plan={p} r={cur} can={can} onBack={() => setOpen(null)} onDone={m => { setMsg([m, false]); load() }} />

  const all = rows ?? []
  const ready = all.filter(r => r.result === 'pending' && r.metrics.suggest === 'pass')
  const cnt = (k: F) => k === 'all' ? all.length : k === 'ready' ? ready.length : all.filter(r => r.result === k).length
  const shown = all.filter(r => (f === 'all' || (f === 'ready' ? r.result === 'pending' && r.metrics.suggest === 'pass' : r.result === f))
    && (r.teacher_name + ' ' + (r.org_name ?? '')).toLowerCase().includes(q.toLowerCase()))
  async function confirmAll() {
    if (!confirm(`Kết luận Đạt cho ${ready.length} giáo viên đủ điều kiện? Chứng chỉ của họ sẽ chờ duyệt cấp.`)) return
    const { data, error } = await supabase.rpc('training_results_confirm', { p_plan: plan })
    if (error) return setMsg([errText(error.message), true])
    setMsg([`Đã kết luận Đạt cho ${data} giáo viên. Duyệt cấp chứng chỉ ở mục Chứng chỉ tập huấn.`, false]); load()
  }
  const steps: [string, string, F][] = [
    ['Tự tính kết quả', 'Chuyên cần từ điểm danh (vắng có phép không tính), điểm bài kiểm tra, tiến độ học và sản phẩm cuối khoá.', 'all'],
    ['Chấm & kết luận', 'Chấm điểm sản phẩm, nhận xét. Xác nhận Đạt cho người đủ điều kiện; Chưa đạt thì ghi lý do và cho thi lại.', 'ready'],
    ['Cấp chứng chỉ', 'Giáo viên Đạt có chứng chỉ chờ duyệt ở mục Chứng chỉ tập huấn.', 'pass']]

  return <>
    <div className="panel distintro">
      <ol className="distguide">{steps.map(([h, d, k], i) => <li key={h}><button type="button" onClick={() => setF(k)}><i>{i + 1}</i><span><b>{h}</b><small>{d}</small></span></button></li>)}</ol>
    </div>
    <div className="diststatcards four">
      <div className="panel"><i aria-hidden="true">👥</i><span><b>{rows ? all.length : '…'}</b><small>Giáo viên</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{cnt('pass')}</b><small>Đạt</small></span></div>
      <div className="panel"><i aria-hidden="true" className={cnt('fail') ? 'warn' : ''}>✗</i><span><b>{cnt('fail')}</b><small>Chưa đạt</small></span></div>
      <div className="panel"><i aria-hidden="true" className={ready.length ? 'warn' : ''}>…</i><span><b>{cnt('pending')}</b><small>Chờ kết luận</small><small>{ready.length} đủ điều kiện</small></span></div>
    </div>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    <section className="panel" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
      <div className="distfilter">
        <select value={plan} onChange={e => { setPlan(e.target.value); setOpen(null) }} aria-label="Kế hoạch tập huấn" style={{ maxWidth: 420 }}>
          {!plans?.length && <option value="">Chưa có kế hoạch đã phát hành</option>}
          {plans?.map(x => <option key={x.id} value={x.id}>{x.plan_code} · {x.name}{x.org_id === orgId ? '' : ' (được giao)'}</option>)}</select>
        <input placeholder="Tìm giáo viên, trường…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm giáo viên" />
        {can && ready.length > 0 && <button type="button" className="primary" onClick={confirmAll}>Xác nhận Đạt cho {ready.length} GV đủ điều kiện</button>}
      </div>
      <div className="distfilter">{([['all', 'Tất cả'], ['ready', 'Đủ điều kiện, chờ kết luận'], ['pending', 'Chờ kết luận'], ['pass', 'Đạt'], ['fail', 'Chưa đạt']] as [F, string][])
        .map(([k, l]) => <button key={k} type="button" className={`distfchip${f === k ? ' on' : ''}`} onClick={() => setF(k)}>{l} ({cnt(k)})</button>)}</div>
      {!can && p && <small className="sub">Kế hoạch của đơn vị khác: chỉ xem kết quả giáo viên trong phạm vi của mình.</small>}
      {!rows ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
        <thead><tr><th>Giáo viên</th><th>Chuyên cần</th><th>Bài kiểm tra</th><th>Học trực tuyến</th><th>Sản phẩm</th><th>Gợi ý</th><th>Kết luận</th><th>Chứng chỉ</th></tr></thead>
        <tbody>{shown.map(r => { const m = r.metrics
          return <tr key={r.teacher_id}>
            <td><button type="button" className="namelink" onClick={() => setOpen(r.teacher_id)}>{r.teacher_name}</button><br /><small className="sub">{r.org_name ?? '—'}</small></td>
            <td>{ok(m.ok_att)} {m.att_pct == null ? '—' : `${num(m.att_pct)}%`}<br /><small className="sub">{m.present}/{m.sessions - m.excused} buổi · cần {m.att_req}%</small></td>
            <td>{m.tests ? <>{ok(m.ok_tests)} {m.tests_passed}/{m.tests} đạt<br /><small className="sub">TB {num(m.avg_score)}</small></> : <small className="sub">Không có</small>}</td>
            <td>{ok(m.ok_units)} {m.done}/{m.units}</td>
            <td>{m.need_product ? <>{ok(m.ok_product)} {m.product_status ? PRODUCT[m.product_status] : 'Chưa nộp'}{r.product_score != null && <><br /><small className="sub">Điểm {num(r.product_score)}</small></>}</> : <small className="sub">Không yêu cầu</small>}</td>
            <td><Chip tone={m.suggest === 'pass' ? 'good' : ''}>{m.suggest === 'pass' ? 'Đủ điều kiện' : 'Chưa đủ'}</Chip></td>
            <td><Chip tone={RESULT[r.result][1]}>{RESULT[r.result][0]}</Chip>{r.reason && <><br /><small className="sub">{r.reason}</small></>}
              {r.extra_attempts > 0 && r.result === 'pending' && <><br /><small className="sub">Thi lại · +{r.extra_attempts} lượt</small></>}</td>
            <td>{r.cert_status ? <><Chip tone={CERT_ST[r.cert_status][1]}>{CERT_ST[r.cert_status][0]}</Chip>{r.cert_code && <><br /><small className="sub">{r.cert_code}</small></>}</> : '—'}</td>
          </tr> })}
          {!shown.length && <tr><td colSpan={8}><small className="sub">{all.length ? 'Không có giáo viên nào khớp.' : 'Kế hoạch chưa có giáo viên ghi danh.'}</small></td></tr>}</tbody>
      </table></div>}
    </section>
  </>
}

function ResultDetail({ plan, r, can, onBack, onDone }: { plan: Plan; r: ResRow; can: boolean; onBack: () => void; onDone: (m: string) => void }) {
  const m = r.metrics
  const [score, setScore] = useState(r.product_score == null ? '' : String(r.product_score))
  const [comment, setComment] = useState(r.comment ?? '')
  const [reason, setReason] = useState(r.reason ?? '')
  const [extra, setExtra] = useState('1')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function call(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc(fn, args)
    setBusy(false)
    if (error) return setErr(errText(error.message))
    onDone(ok)
  }
  const base = { p_plan: plan.id, p_teacher: r.teacher_id }
  const conds: [string, boolean, string][] = [
    ['Chuyên cần', m.ok_att, m.sessions ? `${m.present}/${m.sessions - m.excused} buổi${m.excused ? ` (${m.excused} vắng có phép không tính)` : ''} = ${m.att_pct == null ? '—' : num(m.att_pct) + '%'} · cần ≥ ${m.att_req}%` : 'Chưa có buổi học'],
    ['Học trực tuyến', m.ok_units, `${m.done}/${m.units} nội dung hoàn thành`],
    ['Bài kiểm tra', m.ok_tests, m.tests ? `${m.tests_passed}/${m.tests} bài đạt · điểm TB ${num(m.avg_score)}${m.score_req != null ? ` · điểm đạt ${num(m.score_req)}` : ''}` : 'Không có bài kiểm tra'],
    ['Sản phẩm cuối khoá', m.ok_product, m.need_product ? `${m.product_status ? PRODUCT[m.product_status] : 'Chưa nộp'}${r.product_score != null ? ` · điểm ${num(r.product_score)} (cần ≥ 5)` : ''}` : 'Không yêu cầu']]
  return <ElView back="Đánh giá kết quả" onBack={onBack} title={r.teacher_name}
    sub={<>{[r.subject, r.org_name, `${plan.plan_code} · ${plan.name}`].filter(Boolean).join(' · ')} · <Chip tone={RESULT[r.result][1]}>{RESULT[r.result][0]}</Chip></>}>
    {err && <p className="msg" role="alert">{err}</p>}
    <section className="panel" style={{ display: 'grid', gap: 10 }}>
      <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Điều kiện hoàn thành</h3>
        <Chip tone={m.suggest === 'pass' ? 'good' : 'warn'}>{m.suggest === 'pass' ? 'Gợi ý: Đạt' : 'Gợi ý: Chưa đủ điều kiện'}</Chip></div>
      <dl className="tpkv">{conds.map(([k, b, d]) => <div key={k} style={{ display: 'contents' }}><dt>{ok(b)} {k}</dt><dd>{d}</dd></div>)}</dl>
    </section>
    {m.need_product && <section className="panel" style={{ display: 'grid', gap: 10 }}>
      <h3 style={{ margin: 0 }}>Sản phẩm & nhận xét của giảng viên</h3>
      {r.product_url || r.product_note ? <p style={{ margin: 0 }}>{r.product_url && <a href={r.product_url} target="_blank" rel="noreferrer">Mở sản phẩm ↗</a>}{r.product_note && <><br /><small className="sub">{r.product_note}</small></>}</p>
        : <small className="sub">Giáo viên chưa nộp sản phẩm.</small>}
      {can ? <div className="formgrid">
        <label className="field"><span>Điểm sản phẩm (0–10)</span><input type="number" min={0} max={10} step={0.5} value={score} onChange={e => setScore(e.target.value)} /></label>
        <label className="field" style={{ gridColumn: '1/-1' }}><span>Nhận xét</span><textarea rows={3} value={comment} onChange={e => setComment(e.target.value)} /></label>
        <div><button type="button" disabled={busy} onClick={() => call('training_result_grade', { ...base, p_score: score === '' ? null : Number(score), p_comment: comment }, 'Đã lưu điểm và nhận xét.')}>Lưu điểm & nhận xét</button></div>
      </div> : <dl className="tpkv"><dt>Điểm</dt><dd>{num(r.product_score)}</dd><dt>Nhận xét</dt><dd>{r.comment || '—'}</dd></dl>}
      <small className="sub">Nhận / trả lại sản phẩm ở chi tiết kế hoạch › Tiến độ học trực tuyến.</small>
    </section>}
    {can && <section className="panel" style={{ display: 'grid', gap: 10 }}>
      <h3 style={{ margin: 0 }}>Kết luận</h3>
      <label className="field"><span>Lý do / ghi chú (bắt buộc khi Chưa đạt{m.suggest !== 'pass' ? ', hoặc khi Đạt dù chưa đủ điều kiện' : ''})</span><textarea rows={2} value={reason} onChange={e => setReason(e.target.value)}
        placeholder={m.suggest === 'pass' ? 'Không bắt buộc khi Đạt' : 'VD: vắng 3 buổi, chưa nộp sản phẩm…'} /></label>
      <div className="tools">
        <button type="button" className="primary" disabled={busy} onClick={() => call('training_result_set', { ...base, p_result: 'pass', p_reason: reason }, `Đã kết luận Đạt cho ${r.teacher_name}. Chứng chỉ chờ duyệt cấp.`)}>Kết luận Đạt</button>
        <button type="button" disabled={busy} onClick={() => call('training_result_set', { ...base, p_result: 'fail', p_reason: reason }, `Đã kết luận Chưa đạt cho ${r.teacher_name}.`)}>Chưa đạt</button>
        {r.result !== 'pending' && <button type="button" disabled={busy} onClick={() => call('training_result_set', { ...base, p_result: 'pending', p_reason: null }, 'Đã đưa về chờ kết luận.')}>Huỷ kết luận</button>}
      </div>
      {r.result === 'pass' && r.cert_status === 'issued' && <small className="warnline">Đổi sang Chưa đạt hoặc huỷ kết luận sẽ thu hồi chứng chỉ {r.cert_code}.</small>}
      {r.result !== 'pass' && <div className="tools" style={{ alignItems: 'center' }}>
        <span>Cho học bù / thi lại: thêm</span>
        <select value={extra} onChange={e => setExtra(e.target.value)} aria-label="Số lượt thêm">{[1, 2, 3, 4, 5].map(n => <option key={n}>{n}</option>)}</select>
        <span>lượt làm bài kiểm tra</span>
        <button type="button" disabled={busy} onClick={() => call('training_result_retake', { ...base, p_extra: Number(extra) }, `Đã cho ${r.teacher_name} thi lại, giáo viên nhận được thông báo.`)}>Cho thi lại</button>
      </div>}
    </section>}
  </ElView>
}
