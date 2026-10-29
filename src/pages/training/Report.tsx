// Báo cáo, thống kê tập huấn (118): số lượng, tỷ lệ hoàn thành, kết quả — theo kỳ (năm học · đợt), theo đơn vị, theo kế hoạch.
// Số liệu theo phạm vi người xem (KDI: mọi trường; Sở / Phòng: trường trực thuộc; trường: trường mình) — RPC training_report.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx } from '../../lib/sheet'
import { useAllOrgs } from '../../components/OrgScope'

type Row = { plan_id: string; plan_code: string | null; plan_name: string; plan_org: string | null; year_name: string | null; term: string | null
  starts_on: string | null; ends_on: string | null; hours: number | null; closed: boolean; org_id: string; org_name: string; quota: number | null
  enrolled: number; att_pct: number | null; passed: number; failed: number; certs: number }
type By = 'period' | 'school' | 'parent' | 'plan'
const TERM: Record<string, string> = { summer: 'Dịp hè', hk1: 'Học kỳ I', hk2: 'Học kỳ II', other: 'Khác' }
const BY: [By, string][] = [['period', 'Theo kỳ'], ['parent', 'Theo Phòng / Sở'], ['school', 'Theo trường'], ['plan', 'Theo kế hoạch']]
const pct = (a: number, b: number) => b ? Math.round(a * 1000 / b) / 10 : null
const fmtPct = (v: number | null) => v == null ? '—' : String(v).replace('.', ',') + '%'
const errText = (m: string) => /schema cache|does not exist|function .* not found/i.test(m) ? 'Hãy chạy migration 118 trên Supabase.' : m

type Agg = { key: string; label: string; sub: string; plans: Set<string>; schools: Set<string>; enrolled: number; passed: number; failed: number; certs: number
  hours: number; attW: number; attN: number; closed: Set<string> }
function agg(rows: Row[], keyOf: (r: Row) => [string, string, string]) {
  const m = new Map<string, Agg>()
  for (const r of rows) {
    const [key, label, sub] = keyOf(r)
    let a = m.get(key)
    if (!a) m.set(key, a = { key, label, sub, plans: new Set(), schools: new Set(), enrolled: 0, passed: 0, failed: 0, certs: 0, hours: 0, attW: 0, attN: 0, closed: new Set() })
    a.plans.add(r.plan_id); a.schools.add(r.org_id); a.enrolled += r.enrolled; a.passed += r.passed; a.failed += r.failed; a.certs += r.certs
    a.hours += r.enrolled * (r.hours ?? 0)
    if (r.att_pct != null && r.enrolled) { a.attW += Number(r.att_pct) * r.enrolled; a.attN += r.enrolled }
    if (r.closed) a.closed.add(r.plan_id)
  }
  return [...m.values()]
}

export function TrainingReportPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')
  const [year, setYear] = useState('')
  const [term, setTerm] = useState('')
  const [by, setBy] = useState<By>('period')
  const [only, setOnly] = useState<'all' | 'closed' | 'open'>('all')
  const orgs = useAllOrgs()
  useEffect(() => {
    supabase.rpc('training_report', { p_year: null }).then(({ data, error }) => {
      if (error) { setErr(errText(error.message)); setRows([]) } else setRows((data as Row[]) ?? [])
    })
  }, [])
  const byId = useMemo(() => new Map((orgs ?? []).map(o => [o.id, o])), [orgs])
  const years = useMemo(() => [...new Set((rows ?? []).map(r => r.year_name).filter(Boolean) as string[])].sort().reverse(), [rows])
  const shown = useMemo(() => (rows ?? []).filter(r => (!year || r.year_name === year) && (!term || (r.term ?? 'other') === term)
    && (only === 'all' || (only === 'closed') === r.closed)), [rows, year, term, only])
  const parentOf = (id: string) => { const o = byId.get(id); const p = o?.parent_id ? byId.get(o.parent_id) : undefined; return p ? [p.id, p.name] : ['?', 'Chưa rõ đơn vị quản lý'] }
  const groups = useMemo(() => {
    const keyOf = (r: Row): [string, string, string] => by === 'school' ? [r.org_id, r.org_name, parentOf(r.org_id)[1]]
      : by === 'parent' ? [parentOf(r.org_id)[0], parentOf(r.org_id)[1], '']
      : by === 'plan' ? [r.plan_id, r.plan_name, [r.plan_code, r.plan_org, r.closed ? 'đã kết thúc' : ''].filter(Boolean).join(' · ')]
      : [`${r.year_name ?? '—'}|${r.term ?? 'other'}`, `${r.year_name ?? 'Chưa ghi năm học'} · ${TERM[r.term ?? 'other']}`, '']
    const g = agg(shown, keyOf)
    return by === 'period' ? g.sort((a, b) => b.key.localeCompare(a.key)) : g.sort((a, b) => b.enrolled - a.enrolled || a.label.localeCompare(b.label, 'vi'))
  }, [shown, by, byId])
  const tot = agg(shown, () => ['all', 'Tổng', ''])[0]

  if (!rows) return err ? <p className="msg">{err}</p> : <p className="sub">Đang tải…</p>
  const done = tot ? tot.passed + tot.failed : 0
  function exportX() {
    downloadXlsx(`bao-cao-tap-huan${year ? '-' + year : ''}`, [
      { key: 'g', label: BY.find(b => b[0] === by)![1], width: 34 }, { key: 's', label: 'Ghi chú', width: 26 }, { key: 'k', label: 'Kế hoạch' }, { key: 't', label: 'Trường' },
      { key: 'e', label: 'Lượt GV' }, { key: 'p', label: 'Đạt' }, { key: 'f', label: 'Chưa đạt' }, { key: 'w', label: 'Chưa kết luận' }, { key: 'r', label: 'Tỷ lệ hoàn thành (%)' },
      { key: 'a', label: 'Chuyên cần (%)' }, { key: 'c', label: 'Chứng chỉ' }, { key: 'h', label: 'Giờ bồi dưỡng' }],
      [...groups, ...(tot ? [tot] : [])].map(a => [a.label, a.sub, a.plans.size, a.schools.size, a.enrolled, a.passed, a.failed, a.enrolled - a.passed - a.failed,
        pct(a.passed, a.enrolled), a.attN ? Math.round(a.attW / a.attN * 10) / 10 : null, a.certs, a.hours]))
  }
  return <>
    <div className="bar">
      <div className="tools" style={{ flexWrap: 'wrap' }}>
        <select value={year} onChange={e => setYear(e.target.value)} aria-label="Năm học"><option value="">Mọi năm học</option>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
        <select value={term} onChange={e => setTerm(e.target.value)} aria-label="Đợt"><option value="">Mọi đợt</option>{Object.entries(TERM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={only} onChange={e => setOnly(e.target.value as typeof only)} aria-label="Trạng thái kế hoạch">
          <option value="all">Mọi kế hoạch</option><option value="closed">Đã kết thúc</option><option value="open">Đang triển khai</option></select>
      </div>
      <div className="tools"><button type="button" onClick={exportX} disabled={!groups.length}>Xuất Excel</button></div>
    </div>
    <div className="diststatcards rptcards">
      <div className="panel"><i aria-hidden="true">≋</i><span><b>{tot?.plans.size ?? 0}</b><small>Kế hoạch tập huấn</small><small>{tot?.closed.size ?? 0} đã kết thúc</small></span></div>
      <div className="panel"><i aria-hidden="true">⌂</i><span><b>{tot?.schools.size ?? 0}</b><small>Trường tham gia</small></span></div>
      <div className="panel"><i aria-hidden="true">☺</i><span><b>{tot?.enrolled ?? 0}</b><small>Lượt giáo viên tham gia</small><small>{(tot?.hours ?? 0).toLocaleString('vi-VN')} giờ bồi dưỡng</small></span></div>
      <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{fmtPct(tot ? pct(tot.passed, tot.enrolled) : null)}</b><small>Tỷ lệ hoàn thành (Đạt / tham gia)</small>
        <small>{tot?.passed ?? 0} Đạt · {tot?.failed ?? 0} Chưa đạt · {tot ? tot.enrolled - done : 0} chưa kết luận</small></span></div>
      <div className="panel"><i aria-hidden="true">▣</i><span><b>{tot?.certs ?? 0}</b><small>Chứng chỉ đã cấp</small><small>Chuyên cần TB {fmtPct(tot?.attN ? Math.round(tot.attW / tot.attN * 10) / 10 : null)}</small></span></div>
    </div>
    <div className="segmented" style={{ margin: '12px 0' }}>
      {BY.map(([k, l]) => <button key={k} type="button" className={by === k ? 'on' : ''} onClick={() => setBy(k)}>{l}</button>)}
    </div>
    {!groups.length ? <div className="panel"><p className="sub" style={{ margin: 0 }}>{rows.length ? 'Không có số liệu khớp bộ lọc.' : 'Chưa có kế hoạch tập huấn nào đã phát hành và gán trường trong phạm vi của bạn.'}</p></div>
      : <div className="wrap"><table className="libtable rpttable">
        <thead><tr><th>{BY.find(b => b[0] === by)![1].replace('Theo ', '').replace(/^./, c => c.toUpperCase())}</th>{by !== 'plan' && <th>Kế hoạch</th>}{by !== 'school' && <th>Trường</th>}
          <th>Lượt GV</th><th>Đạt</th><th>Chưa đạt</th><th>Chưa kết luận</th><th style={{ minWidth: 170 }}>Tỷ lệ hoàn thành</th><th>Chuyên cần</th><th>Chứng chỉ</th><th>Giờ bồi dưỡng</th></tr></thead>
        <tbody>{groups.map(a => { const r = pct(a.passed, a.enrolled); const att = a.attN ? Math.round(a.attW / a.attN * 10) / 10 : null
          return <tr key={a.key}>
            <td style={{ whiteSpace: 'normal' }}><b>{a.label}</b>{a.sub && <><br /><small className="sub">{a.sub}</small></>}</td>
            {by !== 'plan' && <td>{a.plans.size}</td>}{by !== 'school' && <td>{a.schools.size}</td>}
            <td>{a.enrolled}</td><td>{a.passed}</td><td>{a.failed || 0}</td><td>{a.enrolled - a.passed - a.failed}</td>
            <td><div className="rptrate"><span className="capbar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r ?? 0} aria-label="Tỷ lệ hoàn thành">
              <i style={{ width: (r ?? 0) + '%' }} className={r != null && r < 50 ? 'near' : ''} /></span><b>{fmtPct(r)}</b></div></td>
            <td>{fmtPct(att)}</td><td>{a.certs}</td><td>{a.hours.toLocaleString('vi-VN')}</td>
          </tr> })}</tbody>
      </table></div>}
    <p className="sub" style={{ marginTop: 10 }}>Tỷ lệ hoàn thành = số giáo viên Đạt / số lượt giáo viên có tên. Giờ bồi dưỡng = số giờ của kế hoạch × số giáo viên có tên.
      Chuyên cần tính trên các buổi đã chốt điểm danh. Số liệu chỉ gồm trường trong phạm vi quản lý của bạn.</p>
  </>
}
