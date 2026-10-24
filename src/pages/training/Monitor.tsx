// Phân hệ 1 — Giám sát tập huấn (088): mỗi kế hoạch × trường được giao. KDI / Sở / Phòng thấy các trường trong phạm vi, trường thấy dòng của mình.
// Cảnh báo: trường chưa chọn đủ GV theo chỉ tiêu, GV vắng nhiều, khoá sắp kết thúc mà còn GV chưa đủ điều kiện. Hiệu quả: mức năng lực trước / sau.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx } from '../../lib/sheet'
import { Chip } from '../dist/Editor'
import { Bar } from './Competency'

type Row = { plan_id: string; plan_code: string | null; plan_name: string; plan_org: string | null; year_name: string | null; starts_on: string | null; ends_on: string | null
  org_id: string; org_name: string; quota: number | null; org_status: string; enrolled: number; sessions: number; sessions_closed: number
  att_pct: number | null; low_att: number; online_done: number; passed: number; failed: number; not_ready: number; certs: number }
type Eff = { competency: string; competency_name: string; teachers: number; before_avg: number | null; after_avg: number | null }
type Alert = { kind: 'quota' | 'att' | 'ready'; row: Row; text: string }

const ORG_ST: Record<string, [string, string]> = { assigned: ['Chưa gửi DS', 'warn'], submitted: ['Chờ duyệt DS', ''], returned: ['Bị trả lại', 'bad'], approved: ['Đã duyệt DS', 'good'] }
const vnDate = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : '—'
const num = (n: number | null | undefined) => n == null ? '—' : String(n).replace('.', ',')
const pct = (a: number, b: number) => b ? Math.round(a * 100 / b) : 0
const errText = (m: string) => /schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 088 trên Supabase.' : m
const today = () => new Date().toISOString().slice(0, 10)

function alertsOf(r: Row): Alert[] {
  const a: Alert[] = []
  if (r.quota != null && r.enrolled < r.quota && (!r.ends_on || r.ends_on >= today()))
    a.push({ kind: 'quota', row: r, text: `${r.org_name} mới chọn ${r.enrolled}/${r.quota} GV theo chỉ tiêu` })
  if (r.low_att > 0) a.push({ kind: 'att', row: r, text: `${r.org_name}: ${r.low_att} GV vắng nhiều, dưới mức chuyên cần` })
  if (r.not_ready > 0) a.push({ kind: 'ready', row: r, text: `${r.org_name}: khoá kết thúc ${vnDate(r.ends_on)}, ${r.not_ready} GV chưa đủ điều kiện hoàn thành` })
  return a
}
const ALERT_ICON = { quota: '👥', att: '⏱', ready: '⚑' }

export function TrainingMonitorPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [eff, setEff] = useState<Eff[]>([])
  const [year, setYear] = useState('')
  const [f, setF] = useState<'all' | 'alert' | 'running' | 'done'>('all')
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    supabase.rpc('training_monitor', { p_year: null }).then(({ data, error }) => { if (error) setErr(errText(error.message)); setRows((data as Row[]) ?? []) })
    supabase.rpc('training_competency_effect').then(({ data }) => setEff((data as Eff[]) ?? []))
  }, [])
  const yearsList = useMemo(() => [...new Set((rows ?? []).map(r => r.year_name).filter((y): y is string => !!y))].sort().reverse(), [rows])
  const inYear = (rows ?? []).filter(r => !year || r.year_name === year)
  const alerts = inYear.flatMap(alertsOf)
  const hasAlert = new Set(alerts.map(a => a.row.plan_id + '|' + a.row.org_id))
  const running = (r: Row) => (!r.starts_on || r.starts_on <= today()) && (!r.ends_on || r.ends_on >= today())
  const shown = inYear.filter(r => (f === 'all' || (f === 'alert' ? hasAlert.has(r.plan_id + '|' + r.org_id) : f === 'running' ? running(r) : !!r.ends_on && r.ends_on < today()))
    && (!q || `${r.plan_code ?? ''} ${r.plan_name} ${r.org_name}`.toLowerCase().includes(q.toLowerCase())))
  const sum = (k: keyof Row) => inYear.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  const quota = inYear.reduce((s, r) => s + (r.quota ?? r.enrolled), 0)
  const attRows = inYear.filter(r => r.att_pct != null)
  const attAvg = attRows.length ? Math.round(attRows.reduce((s, r) => s + Number(r.att_pct) * r.enrolled, 0) / Math.max(1, attRows.reduce((s, r) => s + r.enrolled, 0))) : null
  const plansN = new Set(inYear.map(r => r.plan_id)).size

  function excel() {
    downloadXlsx(`giam-sat-tap-huan${year ? '-' + year : ''}`, [{ key: 'c', label: 'Mã KH' }, { key: 'p', label: 'Kế hoạch', width: 34 }, { key: 'u', label: 'Đơn vị lập' , width: 22 },
      { key: 'y', label: 'Năm học' }, { key: 's', label: 'Bắt đầu' }, { key: 'e', label: 'Kết thúc' }, { key: 'o', label: 'Trường', width: 28 }, { key: 'st', label: 'Danh sách' },
      { key: 'q', label: 'Chỉ tiêu' }, { key: 'n', label: 'Đã chọn GV' }, { key: 'ss', label: 'Buổi đã chốt / tổng' }, { key: 'a', label: 'Chuyên cần %' }, { key: 'la', label: 'GV vắng nhiều' },
      { key: 'on', label: 'Hoàn thành học trực tuyến' }, { key: 'ps', label: 'Đạt' }, { key: 'fl', label: 'Chưa đạt' }, { key: 'cr', label: 'Chứng chỉ' }, { key: 'w', label: 'Cảnh báo', width: 50 }],
      shown.map(r => [r.plan_code, r.plan_name, r.plan_org, r.year_name, vnDate(r.starts_on), vnDate(r.ends_on), r.org_name, ORG_ST[r.org_status]?.[0] ?? r.org_status,
        r.quota ?? '', r.enrolled, `${r.sessions_closed}/${r.sessions}`, r.att_pct ?? '', r.low_att, r.online_done, r.passed, r.failed, r.certs, alertsOf(r).map(a => a.text).join('; ')]), 'Giám sát')
  }
  return <>
    <div className="diststatcards four">
      <div className="panel"><i aria-hidden="true">📋</i><span><b>{rows ? plansN : '…'}</b><small>Kế hoạch đang theo dõi</small><small>{inYear.length} lượt giao trường</small></span></div>
      <div className="panel"><i aria-hidden="true" className={pct(sum('enrolled'), quota) >= 90 ? 'good' : 'warn'}>👥</i><span><b>{sum('enrolled')}{quota ? `/${quota}` : ''}</b><small>GV đã chọn / chỉ tiêu</small></span></div>
      <div className="panel"><i aria-hidden="true" className={attAvg == null ? '' : attAvg >= 80 ? 'good' : 'warn'}>⏱</i><span><b>{attAvg == null ? '—' : `${attAvg}%`}</b><small>Chuyên cần trung bình</small><small>{sum('low_att')} GV vắng nhiều</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{sum('passed')}</b><small>GV Đạt · {pct(sum('passed'), sum('enrolled'))}%</small><small>{sum('certs')} chứng chỉ đã cấp</small></span></div>
    </div>
    {err && <p className="msg" role="alert">{err}</p>}
    {alerts.length > 0 && <section className="panel monalerts" style={{ marginTop: 14 }}>
      <h3 style={{ margin: 0 }}>Cảnh báo ({alerts.length})</h3>
      <ul>{alerts.slice(0, 12).map((a, i) => <li key={i} className={a.kind}><span aria-hidden="true">{ALERT_ICON[a.kind]}</span>
        <span>{a.text}<br /><small className="sub">{a.row.plan_code} · {a.row.plan_name}</small></span></li>)}</ul>
      {alerts.length > 12 && <button type="button" className="linkbtn" onClick={() => setF('alert')}>Xem cả {alerts.length} cảnh báo trong bảng</button>}
    </section>}
    <section className="panel" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
      <div className="distfilter">
        <select value={year} onChange={e => setYear(e.target.value)} aria-label="Năm học"><option value="">Mọi năm học</option>{yearsList.map(y => <option key={y} value={y}>Năm học {y}</option>)}</select>
        <input placeholder="Tìm kế hoạch, trường…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm kế hoạch" />
        <button type="button" onClick={excel} disabled={!shown.length}>Xuất Excel</button>
      </div>
      <div className="distfilter">{([['all', 'Tất cả'], ['alert', 'Có cảnh báo'], ['running', 'Đang diễn ra'], ['done', 'Đã kết thúc']] as const)
        .map(([k, l]) => <button key={k} type="button" className={`distfchip${f === k ? ' on' : ''}`} onClick={() => setF(k)}>{l}{k === 'alert' ? ` (${hasAlert.size})` : ''}</button>)}</div>
      {!rows ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
        <thead><tr><th>Kế hoạch</th><th>Trường</th><th>GV / chỉ tiêu</th><th>Buổi học</th><th>Chuyên cần</th><th>Học trực tuyến</th><th>Kết quả</th><th>Chứng chỉ</th></tr></thead>
        <tbody>{shown.map(r => { return <tr key={r.plan_id + r.org_id}>
          <td><b>{r.plan_name}</b><br /><small className="sub">{r.plan_code} · {r.plan_org} · {vnDate(r.starts_on)} – {vnDate(r.ends_on)}</small></td>
          <td>{r.org_name}<br /><Chip tone={ORG_ST[r.org_status]?.[1]}>{ORG_ST[r.org_status]?.[0] ?? r.org_status}</Chip></td>
          <td>{r.quota != null ? <><Bar v={pct(r.enrolled, r.quota)} warnBelow={100} /> {r.enrolled}/{r.quota}</> : r.enrolled}</td>
          <td>{r.sessions_closed}/{r.sessions} <small className="sub">đã chốt</small></td>
          <td>{r.att_pct == null ? '—' : `${num(r.att_pct)}%`}{r.low_att > 0 && <><br /><small className="warnline">{r.low_att} GV vắng nhiều</small></>}</td>
          <td>{r.online_done}/{r.enrolled}</td>
          <td><span className="tlok">{r.passed} Đạt</span>{r.failed > 0 && <> · <span className="warnline">{r.failed} chưa đạt</span></>}
            {r.not_ready > 0 && <><br /><small className="warnline">{r.not_ready} GV chưa đủ ĐK, sắp kết thúc</small></>}</td>
          <td>{r.certs}</td>
        </tr> })}
          {!shown.length && <tr><td colSpan={8}><small className="sub">{inYear.length ? 'Không có dòng nào khớp.' : 'Chưa có kế hoạch tập huấn đã phát hành được giao cho trường.'}</small></td></tr>}</tbody>
      </table></div>}
    </section>
    <section className="panel" style={{ display: 'grid', gap: 10, marginTop: 14 }}>
      <h3 style={{ margin: 0 }}>Năng lực trước / sau tập huấn</h3>
      <p className="sub" style={{ margin: 0 }}>Giáo viên đã Đạt khoá tập huấn: mức trung bình ở đánh giá năng lực gần nhất trước năm học của khoá so với đánh giá từ năm học của khoá trở đi, theo năng lực đích của chương trình.</p>
      {eff.length ? <div className="wrap"><table className="libtable">
        <thead><tr><th>Năng lực</th><th>Số GV</th><th>Trước</th><th>Sau</th><th>Thay đổi</th></tr></thead>
        <tbody>{eff.map(e => { const d = e.before_avg != null && e.after_avg != null ? Number(e.after_avg) - Number(e.before_avg) : null
          return <tr key={e.competency}><td>{e.competency_name}</td><td>{e.teachers}</td><td>{num(e.before_avg)}</td><td>{num(e.after_avg)}</td>
            <td>{d == null ? <small className="sub">chưa đủ dữ liệu</small> : <Chip tone={d > 0 ? 'good' : d < 0 ? 'bad' : ''}>{d > 0 ? '+' : ''}{num(Math.round(d * 100) / 100)}</Chip>}</td></tr> })}</tbody>
      </table></div> : <small className="sub">Chưa có giáo viên Đạt khoá tập huấn có năng lực đích.</small>}
    </section>
  </>
}
