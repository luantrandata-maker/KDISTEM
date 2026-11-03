// Phiên bản và lịch sử áp dụng của bản phân phối (125).
//  • PlanHistory: trong trang một bản — các phiên bản cùng mã và nơi mỗi phiên bản đã được gán, theo năm học.
//  • DistHistory: tab "Lịch sử áp dụng" — mọi lần gán, lọc theo năm học, bản phân phối, trường.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Chip, STATUS, errText } from './Editor'
import { schoolYear } from '../department/Governance'
import { useOrgFilters } from '../../components/OrgFilters'
import { MultiFilters, opts, useMultiFilters, type FilterDef } from '../../components/MultiFilters'
import type { Plan } from './sched'

export type HistRow = {
  book_id: string; year_name: string | null; org_id: string; school: string; plan_id: string; family_id: string; code: string; version_no: number
  plan_title: string; book_title: string; book_status: string; lessons: number; assigned_at: string
}
const BOOK_STATUS: Record<string, [string, string]> = { draft: ['PPCT nháp', 'warn'], published: ['Đã ban hành', 'good'] }
const fmtD = (s: string | null) => (s ? new Date(s).toLocaleDateString('vi-VN') : '—')
const NO_YEAR = 'Chưa ghi năm học'

function useHistory(family: string | null, rk = 0) {
  const [rows, setRows] = useState<HistRow[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setRows(null)
    supabase.rpc('dist_plan_history', { p_family: family, p_year: null }).then(({ data, error }) => {
      if (error) { setErr(errText(error.message)); setRows([]) } else setRows((data as HistRow[]) ?? [])
    })
  }, [family, rk])
  return { rows, err }
}

/** Nhóm theo năm học, năm mới nhất trước. */
function byYear(rows: HistRow[]) {
  const m = new Map<string, HistRow[]>()
  for (const r of rows) { const k = r.year_name ?? NO_YEAR; m.set(k, [...(m.get(k) ?? []), r]) }
  return [...m.entries()].sort((a, b) => (a[0] === NO_YEAR ? 1 : b[0] === NO_YEAR ? -1 : b[0].localeCompare(a[0])))
}

const nextYear = () => { const a = +schoolYear().slice(0, 4) + 1; return `${a}-${a + 1}` }

function HistTable({ rows, showPlan }: { rows: HistRow[]; showPlan: boolean }) {
  const groups = byYear(rows)
  const cols = showPlan ? 7 : 6
  return <div className="wrap"><table className="libtable">
    <thead><tr><th>Trường</th>{showPlan && <th>Bản phân phối</th>}<th>Phiên bản</th><th>PPCT</th><th>Số tiết</th><th>Trạng thái</th><th>Ngày gán</th></tr></thead>
    <tbody>{groups.map(([y, rs]) => <Fragment key={y}>
      <tr className="distyear"><td colSpan={cols}><b>Năm học {y}{y === schoolYear() ? ' (năm nay)' : y === nextYear() ? ' (năm tới)' : ''}</b> <small className="sub">· {new Set(rs.map(r => r.org_id)).size} trường · {rs.length} PPCT</small></td></tr>
      {rs.map(r => <tr key={r.book_id}>
        <td>{r.school}</td>
        {showPlan && <td>{r.plan_title}<br /><small className="sub">{r.code}</small></td>}
        <td>v{r.version_no}</td><td>{r.book_title}</td><td>{r.lessons}</td>
        <td><Chip tone={BOOK_STATUS[r.book_status]?.[1]}>{BOOK_STATUS[r.book_status]?.[0] ?? r.book_status}</Chip></td>
        <td><small>{fmtD(r.assigned_at)}</small></td></tr>)}
    </Fragment>)}
      {rows.length === 0 && <tr><td colSpan={cols}>Chưa gán cho trường nào.</td></tr>}</tbody>
  </table></div>
}

type Ver = { id: string; code: string; version_no: number; status: Plan['status']; title: string; published_at: string | null; updated_at: string }

/** Trong trang một bản: các phiên bản cùng mã và lịch sử áp dụng theo năm học. */
export function PlanHistory({ plan }: { plan: Plan }) {
  const family = plan.family_id ?? plan.id
  const [vers, setVers] = useState<Ver[]>([])
  const { rows, err } = useHistory(family)
  useEffect(() => {
    supabase.from('dist_plans').select('id, code, version_no, status, title, published_at, updated_at').eq('family_id', family).order('version_no', { ascending: false })
      .then(({ data }) => setVers((data as Ver[]) ?? []))
  }, [family])
  const used = (id: string) => (rows ?? []).filter(r => r.plan_id === id)
  return <section className="disthistory">
    <h3>Phiên bản và lịch sử áp dụng</h3>
    {vers.length > 0 && <div className="wrap"><table className="libtable">
      <thead><tr><th>Phiên bản</th><th>Tên</th><th>Trạng thái</th><th>Phát hành</th><th>Đã gán</th></tr></thead>
      <tbody>{vers.map(v => { const u = used(v.id); return <tr key={v.id} className={v.id === plan.id ? 'picked' : undefined}>
        <td><b>v{v.version_no}</b>{v.id === plan.id && <small className="sub"> · đang xem</small>}</td><td>{v.title}</td>
        <td><Chip tone={STATUS[v.status]?.[1]}>{STATUS[v.status]?.[0] ?? v.status}</Chip></td><td><small>{fmtD(v.published_at)}</small></td>
        <td>{u.length ? `${new Set(u.map(r => r.org_id)).size} trường · ${u.length} PPCT` : '—'}</td></tr> })}</tbody>
    </table></div>}
    <h4>Đã áp dụng theo năm học</h4>
    {err ? <p className="msg">{err}</p> : !rows ? <p className="sub">Đang tải…</p> : <HistTable rows={rows} showPlan={false} />}
  </section>
}

/** Danh sách các lần gán kèm bộ lọc Tỉnh / Sở, trường, năm học (và bản phân phối khi không cố định một bản).
 *  now: chỉ năm học hiện tại và năm tới (tab Gán theo trường); không thì mọi năm (tab Lịch sử áp dụng).
 *  Bản gán không ghi năm học = năm học hiện tại của trường. */
function AssignView({ plans, rk, now, family }: { plans: Plan[]; rk: number; now: boolean; family?: string | null }) {
  const { rows, err } = useHistory(null, rk)
  const mf = useMultiFilters()
  const cur = schoolYear(), next = nextYear()
  const base = (rows ?? []).map(r => r.year_name || !now ? r : { ...r, year_name: cur })
    .filter(r => (!family || r.family_id === family) && (!now || r.year_name === cur || r.year_name === next))
  const of = useOrgFilters(base.map(r => ({ org_id: r.org_id, org_name: r.school })), mf)
  const fams = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of rows ?? []) if (!m.has(r.family_id)) m.set(r.family_id, `${r.code} · ${r.plan_title}`)
    for (const p of plans) if (!m.has(p.family_id ?? p.id)) m.set(p.family_id ?? p.id, `${p.code} · ${p.title}`)
    return [...m.entries()]
  }, [rows, plans])
  if (err) return <p className="msg">{err}</p>
  if (!rows) return <p className="sub">Đang tải…</p>
  const yname = (r: HistRow) => r.year_name ?? NO_YEAR
  const yearOpts = opts([...(now ? [cur] : []), ...base.map(yname)].map(y => [y, y === cur ? `${y} (năm nay)` : y === next ? `${y} (năm tới)` : y] as [string, string]), 'desc')
  const defs: FilterDef[] = [...of.defs,
    { key: 'year', label: 'Năm học', placeholder: now ? 'Năm nay và năm tới' : 'Mọi năm học', options: yearOpts },
    ...(family ? [] : [{ key: 'fam', label: 'Bản phân phối', placeholder: 'Mọi bản phân phối', options: opts(fams) }])]
  const shown = base.filter(r => of.fit(r.org_id) && mf.has('year', yname(r)) && mf.has('fam', r.family_id))
  return <>
    <div className="tools distfilter" style={{ flexWrap: 'wrap' }}>
      <MultiFilters defs={defs} f={mf} count={`${new Set(shown.map(r => r.org_id)).size} trường · ${shown.length} PPCT`} />
    </div>
    <HistTable rows={shown} showPlan={!family} />
  </>
}

/** Tab "Gán theo trường": các lần gán năm học hiện tại và năm tới (của bản đang chọn, hoặc mọi bản). */
export function PlanAssigned({ plans, plan, rk }: { plans: Plan[]; plan: Plan | null; rk: number }) {
  return <section className="panel" style={{ marginTop: 14, display: 'grid', gap: 10 }}>
    <h3 style={{ margin: 0 }}>Đã gán năm nay và năm tới{plan ? <small className="sub"> · {plan.code} · {plan.title}</small> : null}</h3>
    <AssignView plans={plans} rk={rk} now family={plan ? plan.family_id ?? plan.id : null} />
  </section>
}

/** Tab "Lịch sử áp dụng": mọi lần gán bản phân phối cho trường, mọi năm học. */
export function DistHistory({ plans, rk }: { plans: Plan[]; rk: number }) {
  return <AssignView plans={plans} rk={rk} now={false} />
}
