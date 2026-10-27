// Kết quả & chứng chỉ của một kế hoạch tập huấn, theo 3 bước như lập kế hoạch:
//  1. Chấm điểm: bảng tổng hợp tự tính (chuyên cần, bài kiểm tra, học trực tuyến, sản phẩm), nhập điểm sản phẩm hàng loạt; bảng điểm danh theo buổi.
//  2. Kết luận: chọn nhiều giáo viên, kết luận Đạt / Chưa đạt / huỷ; xác nhận Đạt cho người đủ điều kiện.
//  3. Chứng chỉ: duyệt cấp hàng loạt, in hàng loạt (mỗi chứng chỉ một trang A4 ngang).
// Dùng ở mục Đánh giá kết quả tập huấn và bước 5 của chi tiết kế hoạch. Dữ liệu và quy tắc ở migration 087.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabase'
import { downloadXlsx } from '../../lib/sheet'
import { Chip } from '../dist/Editor'
import { CERT_ST, RESULT, ResultDetail, type ResRow, type RPlan } from './Results'
import { CertPaper, type Payload } from './Certificates'
import { TestScores } from './TestScores'

type Tab = 'grade' | 'decide' | 'cert'
type F = 'all' | 'ready' | 'pending' | 'pass' | 'fail'
type Sess = { id: string; title: string; starts_at: string }
type Att = { session_id: string; teacher_id: string; present: boolean | null; excuse_status: string | null }
type Cert = { id: string; code: string | null; status: 'pending' | 'issued' | 'revoked'; plan_id: string; teacher_id: string; teacher_name: string; org_name: string | null; issued_on: string | null; can_manage: boolean }

const PRODUCT: Record<string, string> = { submitted: 'Đã nộp, chờ nhận xét', accepted: 'Đã nhận', returned: 'Trả lại' }
const num = (n: number | null | undefined) => (n == null ? '—' : String(n).replace('.', ','))
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 087 trên Supabase.' : m)
const ok = (b: boolean) => <span aria-label={b ? 'đạt điều kiện' : 'chưa đạt điều kiện'} className={b ? 'tlok' : 'warnline'}>{b ? '✓' : '✗'}</span>
const dm = (iso: string) => new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
const gradeChip = (m: ResRow['metrics']) => <Chip tone={m.suggest === 'pass' ? 'good' : ''}>{m.grade ?? (m.suggest === 'pass' ? 'Đủ điều kiện' : 'Chưa đủ')}</Chip>
const totalOf = (m: ResRow['metrics']) => m.total != null ? <><br /><small className="sub">Tổng {num(m.total)}/10</small></> : null
const ready = (r: ResRow) => r.result === 'pending' && r.metrics.suggest === 'pass'

export function PlanResults({ plan, embedded }: { plan: RPlan; embedded?: boolean }) {
  const [rows, setRows] = useState<ResRow[] | null>(null)
  const [can, setCan] = useState(false)
  const [certs, setCerts] = useState<Cert[]>([])
  const [sess, setSess] = useState<Sess[]>([])
  const [att, setAtt] = useState<Att[]>([])
  const [tab, setTab] = useState<Tab>('grade')
  const [view, setView] = useState<'sum' | 'att' | 'test'>('sum')
  const [f, setF] = useState<F>('all')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [scores, setScores] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [print, setPrint] = useState<Payload[] | null>(null)

  function load() {
    supabase.rpc('training_plan_results', { p_plan: plan.id }).then(({ data, error }) => {
      if (error) { setMsg([errText(error.message), true]); setRows([]) } else { setRows((data as ResRow[]) ?? []); setScores({}) }
    })
    supabase.rpc('training_plan_can_manage', { p_plan: plan.id }).then(({ data }) => setCan(!!data))
    supabase.rpc('training_cert_list', { p_mine: false }).then(({ data }) => setCerts(((data as Cert[]) ?? []).filter(c => c.plan_id === plan.id)))
    supabase.from('training_sessions').select('id, title, starts_at').eq('plan_id', plan.id).order('starts_at').then(({ data }) => setSess((data as Sess[]) ?? []))
    supabase.from('training_attendance').select('session_id, teacher_id, present, excuse_status, training_sessions!inner(plan_id)').eq('training_sessions.plan_id', plan.id)
      .then(({ data }) => setAtt((data as unknown as Att[]) ?? []))
    setSel(new Set())
  }
  useEffect(load, [plan.id])

  // In hàng loạt: chỉ phần chứng chỉ hiện khi in
  useEffect(() => {
    if (!print) return
    document.body.classList.add('certprinting')
    const done = () => { document.body.classList.remove('certprinting'); setPrint(null) }
    const t = setTimeout(() => { window.addEventListener('afterprint', done, { once: true }); window.print() }, 600)
    return () => { clearTimeout(t); document.body.classList.remove('certprinting') }
  }, [print])

  const all = rows ?? []
  const cur = all.find(r => r.teacher_id === open)
  if (cur) return <ResultDetail plan={plan} r={cur} can={can} back={embedded ? 'Kết quả & chứng chỉ' : 'Đánh giá kết quả'} onBack={() => setOpen(null)}
    onDone={m => { setOpen(null); setMsg([m, false]); load() }} />

  const cnt = (k: F) => (k === 'all' ? all.length : k === 'ready' ? all.filter(ready).length : all.filter(r => r.result === k).length)
  const shown = all.filter(r => (f === 'all' || (f === 'ready' ? ready(r) : r.result === f))
    && `${r.teacher_name} ${r.org_name ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const issued = certs.filter(c => c.status === 'issued').length
  const name = (r: ResRow) => <><button type="button" className="namelink" onClick={() => setOpen(r.teacher_id)}>{r.teacher_name}</button><br /><small className="sub">{r.org_name ?? '—'}</small></>
  const toggle = (id: string) => setSel(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allBox = (ids: string[]) => <input type="checkbox" aria-label="Chọn tất cả" checked={ids.length > 0 && ids.every(i => sel.has(i))}
    onChange={e => setSel(e.target.checked ? new Set(ids) : new Set())} />

  async function each(ids: string[], label: string, fn: (id: string) => PromiseLike<{ error: { message: string } | null }>) {
    let n = 0; const bad: string[] = []
    for (const id of ids) {
      setBusy(`${label} ${n + bad.length + 1}/${ids.length}…`)
      const { error } = await fn(id)
      if (error) bad.push(`${all.find(r => r.teacher_id === id)?.teacher_name ?? id}: ${errText(error.message)}`); else n++
    }
    setBusy('')
    setMsg([bad.length ? `${label}: xong ${n}, lỗi ${bad.length} (${bad.slice(0, 3).join('; ')})` : `${label}: xong ${n} giáo viên.`, bad.length > 0]); load()
  }
  const dirty = Object.entries(scores).filter(([id, v]) => { const r = all.find(x => x.teacher_id === id); return r && v !== (r.product_score == null ? '' : String(r.product_score)) })
  function saveScores() {
    const badv = dirty.find(([, v]) => v !== '' && !(Number(v.replace(',', '.')) >= 0 && Number(v.replace(',', '.')) <= 10))
    if (badv) return setMsg(['Điểm sản phẩm phải từ 0 đến 10.', true])
    const val = new Map(dirty)
    each([...val.keys()], 'Lưu điểm', id => {
      const v = val.get(id)!, r = all.find(x => x.teacher_id === id)!
      return supabase.rpc('training_result_grade', { p_plan: plan.id, p_teacher: id, p_score: v === '' ? null : Number(v.replace(',', '.')), p_comment: r.comment ?? '' })
    })
  }
  function decide(result: 'pass' | 'fail' | 'pending') {
    const ids = [...sel]
    let reason: string | null = null
    if (result === 'fail') { reason = prompt(`Lý do Chưa đạt cho ${ids.length} giáo viên:`, ''); if (!reason?.trim()) return }
    if (result === 'pass') {
      const weak = all.filter(r => sel.has(r.teacher_id) && r.metrics.suggest !== 'pass')
      if (weak.length) { reason = prompt(`${weak.length} giáo viên chưa đủ điều kiện. Ghi lý do vẫn kết luận Đạt:`, ''); if (!reason?.trim()) return }
    }
    if (result === 'pending' && !confirm(`Huỷ kết luận của ${ids.length} giáo viên? Chứng chỉ đã cấp (nếu có) sẽ bị thu hồi.`)) return
    each(ids, result === 'pass' ? 'Kết luận Đạt' : result === 'fail' ? 'Kết luận Chưa đạt' : 'Huỷ kết luận',
      id => supabase.rpc('training_result_set', { p_plan: plan.id, p_teacher: id, p_result: result, p_reason: result === 'pending' ? null : reason }))
  }
  async function confirmReady() {
    const n = cnt('ready')
    if (!confirm(`Kết luận Đạt cho ${n} giáo viên đủ điều kiện? Chứng chỉ của họ sẽ chờ duyệt cấp.`)) return
    const { data, error } = await supabase.rpc('training_results_confirm', { p_plan: plan.id })
    if (error) return setMsg([errText(error.message), true])
    setMsg([`Đã kết luận Đạt cho ${data} giáo viên. Duyệt cấp ở bước 3.`, false]); setTab('cert'); load()
  }
  async function issue(ids: string[]) {
    setBusy('Đang cấp…')
    const { data, error } = await supabase.rpc('training_cert_issue', { p_ids: ids })
    setBusy('')
    if (error) return setMsg([errText(error.message), true])
    setMsg([`Đã cấp ${data} chứng chỉ, giáo viên nhận được thông báo.`, false]); load()
  }
  async function printMany(ids: string[]) {
    setBusy('Đang chuẩn bị bản in…')
    const out: Payload[] = []
    for (const id of ids) { const { data } = await supabase.rpc('training_cert_view', { p_id: id }); if (data) out.push(data as Payload) }
    setBusy('')
    if (out.length) setPrint(out)
  }
  function exportXlsx() {
    const st = (r: ResRow) => certs.find(c => c.teacher_id === r.teacher_id)
    downloadXlsx(`Ket-qua-tap-huan-${plan.plan_code ?? plan.name.slice(0, 30)}.xlsx`,
      [{ key: 'n', label: 'Giáo viên', width: 26 }, { key: 'o', label: 'Trường', width: 28 }, { key: 'a', label: 'Chuyên cần (%)' }, { key: 'b', label: 'Buổi có mặt' },
       { key: 't', label: 'Bài kiểm tra đạt' }, { key: 'g', label: 'Điểm TB' }, { key: 'u', label: 'Học trực tuyến' }, { key: 'p', label: 'Sản phẩm', width: 20 },
       { key: 's', label: 'Điểm sản phẩm' }, { key: 'f', label: 'Đề cuối khoá' }, { key: 'z', label: 'Tổng điểm' }, { key: 'y', label: 'Xếp loại (gợi ý)' }, { key: 'k', label: 'Kết luận' }, { key: 'l', label: 'Lý do', width: 30 }, { key: 'c', label: 'Số chứng chỉ', width: 18 }],
      all.map(r => { const m = r.metrics
        return [r.teacher_name, r.org_name, m.att_pct, `${m.present}/${m.sessions - m.excused}`, m.tests ? `${m.tests_passed}/${m.tests}` : '', m.avg_score,
          `${m.done}/${m.units}`, m.need_product ? (m.product_status ? PRODUCT[m.product_status] : 'Chưa nộp') : 'Không yêu cầu', r.product_score, m.finals ? m.final_score : '', m.total,
          m.grade ?? (m.suggest === 'pass' ? 'Đủ điều kiện' : 'Chưa đủ'), RESULT[r.result][0], r.reason, st(r)?.status === 'issued' ? st(r)?.code : st(r) ? CERT_ST[st(r)!.status][0] : ''] }),
      'Kết quả')
  }

  const steps: [Tab, string, string][] = [
    ['grade', 'Chấm điểm', `${all.length} GV · ${all.filter(r => r.metrics.need_product && r.metrics.product_status && r.product_score == null).length} sản phẩm chờ chấm`],
    ['decide', 'Kết luận', `${cnt('pass')} đạt · ${cnt('fail')} chưa đạt · ${cnt('pending')} chờ`],
    ['cert', 'Cấp chứng chỉ', `${issued} đã cấp · ${certs.filter(c => c.status === 'pending').length} chờ duyệt`]]
  const filters = <div className="distfilter">
    <input placeholder="Tìm giáo viên, trường…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm giáo viên" />
    {([['all', 'Tất cả'], ['ready', 'Đủ điều kiện, chờ kết luận'], ['pending', 'Chờ kết luận'], ['pass', 'Đạt'], ['fail', 'Chưa đạt']] as [F, string][])
      .map(([k, l]) => <button key={k} type="button" className={`distfchip${f === k ? ' on' : ''}`} onClick={() => { setF(k); setSel(new Set()) }}>{l} <b>{cnt(k)}</b></button>)}
  </div>

  return <div style={{ display: 'grid', gap: 12 }}>
    <div className="diststatcards four">
      <div className="panel"><i aria-hidden="true">👥</i><span><b>{rows ? all.length : '…'}</b><small>Giáo viên ghi danh</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{cnt('pass')}</b><small>Đạt</small><small>{all.length ? Math.round(cnt('pass') * 100 / all.length) : 0}% số giáo viên</small></span></div>
      <div className="panel"><i aria-hidden="true" className={cnt('ready') ? 'warn' : ''}>…</i><span><b>{cnt('pending')}</b><small>Chờ kết luận</small><small>{cnt('ready')} đủ điều kiện</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">▣</i><span><b>{issued}</b><small>Chứng chỉ đã cấp</small></span></div>
    </div>
    <ol className="diststeps">{steps.map(([k, t, s], i) => <li key={k}><button type="button" className={tab === k ? 'on' : ''} aria-current={tab === k ? 'step' : undefined}
      onClick={() => { setTab(k); setSel(new Set()) }}><i>{i + 1}</i><span><b>{t}</b><small>{s}</small></span></button></li>)}</ol>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {busy && <p className="sub" role="status">{busy}</p>}
    {!can && <small className="sub">Kế hoạch của đơn vị khác: chỉ xem kết quả giáo viên trong phạm vi của mình.</small>}
    {!rows ? <p className="sub">Đang tải…</p> : <>

    {tab === 'grade' && <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <div className="bar" style={{ margin: 0 }}>
        <div className="distpills" role="tablist" style={{ margin: 0 }}>
          {([['sum', 'Bảng tổng hợp'], ['test', 'Điểm bài test'], ['att', `Điểm danh theo buổi (${sess.length})`]] as ['sum' | 'att' | 'test', string][]).map(([k, l]) =>
            <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
        </div>
        <div className="tools"><button type="button" onClick={exportXlsx} disabled={!all.length}>Xuất Excel</button>
          {can && view === 'sum' && <button type="button" className="primary" disabled={!dirty.length || !!busy} onClick={saveScores}>Lưu điểm{dirty.length ? ` (${dirty.length})` : ''}</button>}</div>
      </div>
      {filters}
      {view === 'sum' ? <div className="wrap"><table className="libtable trestable">
        <thead><tr><th>Giáo viên</th><th>Chuyên cần</th><th>Bài kiểm tra</th><th>Học trực tuyến</th><th>Sản phẩm</th><th>Điểm SP</th>{all.some(r => r.metrics.finals) && <th>Đề cuối khoá</th>}<th>Tổng · xếp loại</th></tr></thead>
        <tbody>{shown.map(r => { const m = r.metrics, v = scores[r.teacher_id] ?? (r.product_score == null ? '' : String(r.product_score))
          return <tr key={r.teacher_id}>
            <td>{name(r)}</td>
            <td>{ok(m.ok_att)} {m.att_pct == null ? '—' : `${num(m.att_pct)}%`}<br /><small className="sub">{m.present}/{m.sessions - m.excused} buổi · cần {m.att_req}%</small></td>
            <td>{m.tests ? <>{ok(m.ok_tests)} {m.tests_passed}/{m.tests} đạt<br /><small className="sub">TB {num(m.avg_score)}</small></> : <small className="sub">Không có</small>}</td>
            <td>{ok(m.ok_units)} {m.done}/{m.units}</td>
            <td>{m.need_product ? <>{ok(m.ok_product)} {m.product_status ? PRODUCT[m.product_status] : 'Chưa nộp'}{r.product_url && <><br /><a href={r.product_url} target="_blank" rel="noreferrer" className="linkbtn">Mở sản phẩm ↗</a></>}</>
              : <small className="sub">Không yêu cầu</small>}</td>
            <td>{m.need_product ? (can && r.result !== 'pass'
              ? <input className="trscore" inputMode="decimal" aria-label={`Điểm sản phẩm của ${r.teacher_name}`} placeholder="0–10" value={v}
                  onChange={e => setScores(s => ({ ...s, [r.teacher_id]: e.target.value }))} />
              : num(r.product_score)) : '—'}</td>
            {all.some(x => x.metrics.finals) && <td>{m.finals ? <>{ok(m.ok_final !== false)} {num(m.final_score)}</> : '—'}</td>}
            <td>{gradeChip(m)}{totalOf(m)}</td>
          </tr> })}
          {!shown.length && <tr><td colSpan={8}><small className="sub">{all.length ? 'Không có giáo viên nào khớp.' : 'Kế hoạch chưa có giáo viên ghi danh.'}</small></td></tr>}</tbody>
      </table></div>
      : view === 'test' ? <TestScores planId={plan.id} planCode={plan.plan_code ?? plan.name.slice(0, 30)} can={can} only={new Set(shown.map(r => r.teacher_id))} onSaved={load} />
      : <AttGrid rows={shown} sess={sess} att={att} />}
      <small className="sub">Điểm sản phẩm từ 5 trở lên mới tính đạt. Nhận / trả lại sản phẩm ở chi tiết kế hoạch › Tiến độ học trực tuyến. Bấm tên giáo viên để xem chi tiết, nhận xét.</small>
      <button type="button" className="primary" style={{ justifySelf: 'end' }} onClick={() => setTab('decide')}>Tiếp tục: Kết luận →</button>
    </section>}

    {tab === 'decide' && <section className="panel" style={{ display: 'grid', gap: 12 }}>
      {filters}
      {can && <div className="tools">
        {cnt('ready') > 0 && <button type="button" className="primary" disabled={!!busy} onClick={confirmReady}>Xác nhận Đạt cho {cnt('ready')} GV đủ điều kiện</button>}
        <span className="sub">{sel.size ? `Đã chọn ${sel.size}:` : 'Chọn giáo viên để kết luận hàng loạt.'}</span>
        <button type="button" disabled={!sel.size || !!busy} onClick={() => decide('pass')}>Đạt</button>
        <button type="button" disabled={!sel.size || !!busy} onClick={() => decide('fail')}>Chưa đạt</button>
        <button type="button" disabled={!sel.size || !!busy} onClick={() => decide('pending')}>Huỷ kết luận</button>
      </div>}
      <div className="wrap"><table className="libtable">
        <thead><tr>{can && <th style={{ width: 32 }}>{allBox(shown.map(r => r.teacher_id))}</th>}<th>Giáo viên</th><th>Điều kiện</th><th>Gợi ý</th><th>Kết luận</th><th>Chứng chỉ</th></tr></thead>
        <tbody>{shown.map(r => { const m = r.metrics, c = certs.find(x => x.teacher_id === r.teacher_id)
          return <tr key={r.teacher_id}>
            {can && <td><input type="checkbox" aria-label={`Chọn ${r.teacher_name}`} checked={sel.has(r.teacher_id)} onChange={() => toggle(r.teacher_id)} /></td>}
            <td>{name(r)}</td>
            <td><small>{ok(m.ok_att)} chuyên cần · {ok(m.ok_tests)} kiểm tra · {ok(m.ok_units)} trực tuyến{m.need_product && <> · {ok(m.ok_product)} sản phẩm</>}
              {!!m.finals && <> · {ok(m.ok_final !== false)} đề cuối khoá</>}{m.total_req != null && <> · {ok(m.ok_total !== false)} tổng điểm</>}</small></td>
            <td>{gradeChip(m)}{totalOf(m)}</td>
            <td><Chip tone={RESULT[r.result][1]}>{RESULT[r.result][0]}</Chip>{r.reason && <><br /><small className="sub">{r.reason}</small></>}
              {r.extra_attempts > 0 && r.result === 'pending' && <><br /><small className="sub">Thi lại · +{r.extra_attempts} lượt</small></>}</td>
            <td>{c ? <><Chip tone={CERT_ST[c.status][1]}>{CERT_ST[c.status][0]}</Chip>{c.code && <><br /><small className="sub">{c.code}</small></>}</> : '—'}</td>
          </tr> })}
          {!shown.length && <tr><td colSpan={6}><small className="sub">Không có giáo viên nào khớp.</small></td></tr>}</tbody>
      </table></div>
      <small className="sub">Chưa đạt thì ghi lý do; mở từng giáo viên để cho thi lại. Huỷ kết luận Đạt sẽ thu hồi chứng chỉ đã cấp.</small>
      <button type="button" className="primary" style={{ justifySelf: 'end' }} onClick={() => setTab('cert')}>Tiếp tục: Cấp chứng chỉ →</button>
    </section>}

    {tab === 'cert' && <section className="panel" style={{ display: 'grid', gap: 12 }}>
      {(() => {
        const list = certs.filter(c => `${c.teacher_name} ${c.org_name ?? ''} ${c.code ?? ''}`.toLowerCase().includes(q.toLowerCase()))
        const pickIssue = [...sel].filter(id => certs.find(c => c.id === id && c.can_manage && c.status !== 'issued'))
        const pickPrint = [...sel].filter(id => certs.find(c => c.id === id && c.status === 'issued'))
        return <>
          <div className="distfilter"><input placeholder="Tìm giáo viên, số chứng chỉ…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm chứng chỉ" />
            <span className="sub">{sel.size ? `Đã chọn ${sel.size}` : 'Chọn chứng chỉ để duyệt cấp hoặc in hàng loạt.'}</span>
            {can && <button type="button" className="primary" disabled={!pickIssue.length || !!busy} onClick={() => issue(pickIssue)}>Duyệt cấp{pickIssue.length ? ` (${pickIssue.length})` : ''}</button>}
            <button type="button" disabled={!pickPrint.length || !!busy} onClick={() => printMany(pickPrint)}>In / Lưu PDF{pickPrint.length ? ` (${pickPrint.length})` : ''}</button></div>
          <div className="wrap"><table className="libtable">
            <thead><tr><th style={{ width: 32 }}>{allBox(list.map(c => c.id))}</th><th>Giáo viên</th><th>Số chứng chỉ</th><th>Ngày cấp</th><th>Trạng thái</th></tr></thead>
            <tbody>{list.map(c => <tr key={c.id}>
              <td><input type="checkbox" aria-label={`Chọn ${c.teacher_name}`} checked={sel.has(c.id)} onChange={() => toggle(c.id)} /></td>
              <td><b>{c.teacher_name}</b><br /><small className="sub">{c.org_name ?? '—'}</small></td>
              <td>{c.code ?? <small className="sub">Có sau khi duyệt</small>}</td>
              <td>{c.issued_on ? new Date(c.issued_on + 'T00:00').toLocaleDateString('vi-VN') : '—'}</td>
              <td><Chip tone={CERT_ST[c.status][1]}>{CERT_ST[c.status][0]}</Chip></td>
            </tr>)}
              {!list.length && <tr><td colSpan={5}><small className="sub">Chưa có chứng chỉ. Kết luận Đạt ở bước 2 thì chứng chỉ vào danh sách chờ duyệt.</small></td></tr>}</tbody>
          </table></div>
          <small className="sub">Số chứng chỉ, hạn hiệu lực lấy theo mẫu chứng chỉ của chương trình. Thu hồi, xem từng chứng chỉ ở mục Chứng chỉ tập huấn.</small>
        </>
      })()}
    </section>}
    </>}
    {print && createPortal(<div className="certprint">{print.map((p, i) => <div key={i} className="certprintpage"><CertPaper p={p} /></div>)}</div>, document.body)}
  </div>
}

/** Điểm danh theo buổi: mỗi giáo viên một dòng, mỗi buổi một cột */
function AttGrid({ rows, sess, att }: { rows: ResRow[]; sess: Sess[]; att: Att[] }) {
  const key = useMemo(() => new Map(att.map(a => [a.session_id + '|' + a.teacher_id, a])), [att])
  const now = Date.now()
  if (!sess.length) return <p className="sub">Kế hoạch chưa có buổi học. Xếp lịch ở bước 2 của kế hoạch.</p>
  const cell = (s: Sess, t: string) => {
    const a = key.get(s.id + '|' + t)
    if (a?.present) return <span className="tratt ok" title="Có mặt">✓</span>
    if (a?.excuse_status === 'approved') return <span className="tratt ex" title="Vắng có phép">P</span>
    if (a?.present === false) return <span className="tratt no" title="Vắng">✗</span>
    return <span className="tratt" title={new Date(s.starts_at).getTime() > now ? 'Chưa diễn ra' : 'Chưa điểm danh'}>·</span>
  }
  return <>
    <div className="wrap"><table className="libtable tratttable">
      <thead><tr><th>Giáo viên</th>{sess.map((s, i) => <th key={s.id} title={s.title}>B{i + 1}<br /><small className="sub">{dm(s.starts_at)}</small></th>)}<th>Có mặt</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.teacher_id}><td><b>{r.teacher_name}</b><br /><small className="sub">{r.org_name ?? '—'}</small></td>
        {sess.map(s => <td key={s.id}>{cell(s, r.teacher_id)}</td>)}
        <td><b>{r.metrics.present}</b>/{r.metrics.sessions - r.metrics.excused}</td></tr>)}</tbody>
    </table></div>
    <small className="sub">✓ có mặt · ✗ vắng · P vắng có phép (không tính vào mẫu số) · · chưa điểm danh. Điểm danh ở mục Lịch tập huấn.</small>
  </>
}
