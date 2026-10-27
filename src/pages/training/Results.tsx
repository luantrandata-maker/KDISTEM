// Phân hệ 1 — Đánh giá kết quả tập huấn (087). Mỗi kế hoạch một bảng kết quả, mỗi giáo viên một dòng.
// Hệ thống tự tính chuyên cần, bài kiểm tra, tiến độ học, sản phẩm và gợi ý Đạt / Chưa đạt theo điều kiện của chương trình;
// đơn vị lập kế hoạch chấm sản phẩm, kết luận, cho thi lại. Đạt thì có chứng chỉ chờ duyệt ở mục Chứng chỉ tập huấn.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ElView } from '../../components/ElView'
import { Chip } from '../dist/Editor'
import { ClsTree } from '../dist/ClsTree'
import { OrgFilter, useAllMode } from '../../components/OrgScope'
import { PlanResults } from './ResultsWork'
import { FlowGuide } from '../../components/FlowGuide'

export type RPlan = { id: string; org_id: string; plan_code: string | null; name: string }
type M = { sessions: number; present: number; excused: number; att_pct: number | null; att_req: number; units: number; done: number; tests: number
  tests_passed: number; avg_score: number | null; score_req: number | null; need_product: boolean; product_status: string | null
  ok_att: boolean; ok_tests: boolean; ok_units: boolean; ok_product: boolean; suggest: 'pass' | 'fail' }
export type ResRow = { teacher_id: string; teacher_name: string; subject: string | null; org_name: string | null; metrics: M; result: 'pending' | 'pass' | 'fail'
  reason: string | null; product_score: number | null; comment: string | null; extra_attempts: number; decided_at: string | null
  product_url: string | null; product_note: string | null; cert_id: string | null; cert_status: string | null; cert_code: string | null }

export const RESULT: Record<string, [string, string]> = { pending: ['Chờ kết luận', ''], pass: ['Đạt', 'good'], fail: ['Chưa đạt', 'bad'] }
export const CERT_ST: Record<string, [string, string]> = { pending: ['Chờ duyệt cấp', 'warn'], issued: ['Đã cấp', 'good'], revoked: ['Đã thu hồi', 'bad'] }
const PRODUCT: Record<string, string> = { submitted: 'Đã nộp, chờ nhận xét', accepted: 'Đã nhận', returned: 'Trả lại' }
const num = (n: number | null | undefined) => n == null ? '—' : String(n).replace('.', ',')
const errText = (m: string) => /schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 087 trên Supabase.' : m
const ok = (b: boolean) => <span aria-label={b ? 'đạt điều kiện' : 'chưa đạt điều kiện'} className={b ? 'tlok' : 'warnline'}>{b ? '✓' : '✗'}</span>

type TPlanRow = RPlan & { node_id: string | null; pub_status: string; year_name: string | null }
type Cnt = { n: number; pass: number; fail: number; cert: number }

export function TrainingResultsPage({ orgId }: { orgId: string }) {
  const [plans, setPlans] = useState<TPlanRow[] | null>(null)
  const [cnt, setCnt] = useState<Map<string, Cnt>>(new Map())
  const [open, setOpen] = useState<string | null>(null)
  const [tab, setTab] = useState<'tree' | 'list'>('tree')
  const [q, setQ] = useState('')
  const [fo, setFo] = useState('')
  const [err, setErr] = useState('')
  const [rk, setRk] = useState(0)
  const all = !!useAllMode()
  useEffect(() => {
    (async () => {
      const p = await supabase.from('training_plans').select('id, org_id, plan_code, name, node_id, pub_status, year_name').neq('pub_status', 'draft').order('plan_code', { ascending: false })
      if (p.error) { setErr(errText(p.error.message)); setPlans([]); return }
      const ps = (p.data as TPlanRow[]) ?? []
      ps.sort((a, b) => Number(b.org_id === orgId) - Number(a.org_id === orgId))
      setPlans(ps)
      const ids = ps.map(x => x.id)
      if (!ids.length) return
      const [e, r, c] = await Promise.all([
        supabase.from('training_enrollments').select('plan_id').in('plan_id', ids),
        supabase.from('training_results').select('plan_id, result').in('plan_id', ids),
        supabase.from('certificates').select('plan_id, status').in('plan_id', ids),
      ])
      const m = new Map<string, Cnt>()
      const g = (id: string) => { if (!m.has(id)) m.set(id, { n: 0, pass: 0, fail: 0, cert: 0 }); return m.get(id)! }
      for (const x of (e.data ?? []) as { plan_id: string }[]) g(x.plan_id).n++
      for (const x of (r.data ?? []) as { plan_id: string; result: string }[]) { if (x.result === 'pass') g(x.plan_id).pass++; if (x.result === 'fail') g(x.plan_id).fail++ }
      for (const x of (c.data ?? []) as { plan_id: string; status: string }[]) if (x.status === 'issued') g(x.plan_id).cert++
      setCnt(m)
    })()
  }, [orgId, rk])

  const cur = plans?.find(p => p.id === open)
  if (cur) return <ElView back="Đánh giá kết quả tập huấn" onBack={() => { setOpen(null); setRk(x => x + 1) }} title={cur.name}
    sub={[cur.plan_code, cur.year_name].filter(Boolean).join(' · ')}><PlanResults plan={cur} /></ElView>

  const list = (plans ?? []).filter(p => (!fo || p.org_id === fo) && (!q || `${p.plan_code ?? ''} ${p.name}`.toLowerCase().includes(q.toLowerCase())))
  const tot = [...cnt.values()].reduce((a, c) => ({ n: a.n + c.n, pass: a.pass + c.pass, fail: a.fail + c.fail, cert: a.cert + c.cert }), { n: 0, pass: 0, fail: 0, cert: 0 })
  const table = (rows: TPlanRow[], empty: string) => <div className="wrap"><table className="libtable">
    <thead><tr><th>Kế hoạch tập huấn</th><th>Giáo viên</th><th>Đạt</th><th>Chưa đạt</th><th>Chờ kết luận</th><th>Chứng chỉ đã cấp</th></tr></thead>
    <tbody>{rows.map(p => { const c = cnt.get(p.id) ?? { n: 0, pass: 0, fail: 0, cert: 0 }, wait = Math.max(0, c.n - c.pass - c.fail)
      return <tr key={p.id}>
        <td><button type="button" className="namelink" onClick={() => setOpen(p.id)}>{p.name}</button><br /><small className="sub">{[p.plan_code, p.year_name, p.org_id === orgId ? '' : 'được giao'].filter(Boolean).join(' · ')}</small></td>
        <td>{c.n}</td>
        <td><b className="tlok">{c.pass}</b>{c.n ? <small className="sub"> · {Math.round(c.pass * 100 / c.n)}%</small> : null}</td>
        <td>{c.fail || '—'}</td>
        <td>{wait ? <Chip tone="warn">{wait} chờ</Chip> : '—'}</td>
        <td>{c.cert}</td>
      </tr> })}
      {!rows.length && <tr><td colSpan={6}>{empty}</td></tr>}</tbody>
  </table></div>
  const steps: [string, string][] = [
    ['Chọn kế hoạch', 'Chọn mục trong khung phân loại (môn học, cấp độ…) rồi mở kế hoạch đã phát hành.'],
    ['Chấm điểm', 'Hệ thống tự tính chuyên cần, bài kiểm tra, học trực tuyến; nhập điểm sản phẩm hàng loạt.'],
    ['Kết luận', 'Chọn nhiều giáo viên để kết luận Đạt / Chưa đạt; xác nhận Đạt cho người đủ điều kiện.'],
    ['Cấp chứng chỉ', 'Duyệt cấp và in hàng loạt chứng chỉ có QR tra cứu.']]
  return <>
    <FlowGuide id="training-results">
      <ol className="distguide four">{steps.map(([h, d], i) => <li key={h}><button type="button" onClick={() => setTab('tree')}><i>{i + 1}</i><span><b>{h}</b><small>{d}</small></span></button></li>)}</ol>
    </FlowGuide>
    <div className="diststatcards four">
      <div className="panel"><i aria-hidden="true">≋</i><span><b>{plans?.length ?? '…'}</b><small>Kế hoạch đã phát hành</small></span></div>
      <div className="panel"><i aria-hidden="true">👥</i><span><b>{tot.n}</b><small>Lượt giáo viên ghi danh</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{tot.pass}</b><small>Đạt</small><small>{tot.n ? Math.round(tot.pass * 100 / tot.n) : 0}% · {Math.max(0, tot.n - tot.pass - tot.fail)} chờ kết luận</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">▣</i><span><b>{tot.cert}</b><small>Chứng chỉ đã cấp</small></span></div>
    </div>
    <div className="distpills" role="tablist">
      {([['tree', 'Theo khung phân loại'], ['list', 'Tất cả kế hoạch']] as ['tree' | 'list', string][]).map(([t, l]) =>
        <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>)}
    </div>
    {err && <p className="msg">{err}</p>}
    {!plans ? <p className="sub">Đang tải…</p> : tab === 'tree'
      ? <ClsTree scope="training" items={list} header={() => <OrgFilter ids={plans.map(p => p.org_id)} value={fo} onChange={setFo} />}>
          {rows => table(rows, 'Không có kế hoạch đã phát hành trong mục này.')}</ClsTree>
      : <>
        <div className="bar"><div className="tools">
          <input placeholder="Tìm mã, tên kế hoạch…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm kế hoạch" />
          {all && <OrgFilter ids={plans.map(p => p.org_id)} value={fo} onChange={setFo} />}
          <small className="sub">{list.length}/{plans.length} kế hoạch</small></div></div>
        {table(list, 'Chưa có kế hoạch tập huấn đã phát hành.')}
      </>}
  </>
}

export function ResultDetail({ plan, r, can, onBack, onDone, back = 'Đánh giá kết quả' }: { plan: RPlan; r: ResRow; can: boolean; onBack: () => void; onDone: (m: string) => void; back?: string }) {
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
  return <ElView back={back} onBack={onBack} title={r.teacher_name}
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
