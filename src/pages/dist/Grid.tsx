// Lưới tuần của bản phân phối: dải Học kỳ 1 / Học kỳ 2, mỗi chương trình một vạch tuần, mỗi môn một hàng ô (số tiết trong tuần),
// hàng cuối "Tiết/tuần" — tuần vượt LOAD_MAX tô cam.
import { Fragment, type ReactNode } from 'react'
import { LOAD_MAX, progCode, weekLoad, type Plan, type Prog, type Row, type Sched } from './sched'

export const COLORS = ['#1f4e9a', '#16a34a', '#d97706', '#7c3aed', '#dc2626', '#0d9488']
export const colorOf = (k: number) => COLORS[k % COLORS.length]

export function WeekGrid({ plan, order, progs, s, titles }: {
  plan: Plan; order: string[]; progs: Map<string, Prog>; s: Sched; titles?: boolean
}) {
  const frame = plan.hk1_weeks + plan.hk2_weeks
  const W = Math.max(frame, ...s.rows.flatMap(r => r.weeks ?? []))
  const weeks = Array.from({ length: W }, (_, k) => k + 1)
  const total = weekLoad(s.rows)
  const cols = `${titles ? 170 : 110}px repeat(${W}, minmax(26px, 1fr))`
  const bandCls = (w: number) => (w > frame ? ' out' : w === plan.hk1_weeks + 1 ? ' hk2' : '')
  const pct = (w: number) => `${((w - 1) / W) * 100}%`
  const line = (key: string, cls: string, label: ReactNode, cells: ReactNode) =>
    <div key={key} className={'grow ' + cls} style={{ gridTemplateColumns: cols }}>{label}{cells}</div>
  return (
    <div className="distgridwrap">
      <div className="distgrid" role="table" aria-label="Lịch theo tuần">
        {line('band', 'bands', <span />, <>
          <span className="band hk1" style={{ gridColumn: `2 / span ${plan.hk1_weeks}` }}>Học kỳ 1 · tuần 1–{plan.hk1_weeks}</span>
          {plan.hk2_weeks > 0 && <span className="band hk2" style={{ gridColumn: `${plan.hk1_weeks + 2} / span ${plan.hk2_weeks}` }}>Học kỳ 2 · tuần {plan.hk1_weeks + 1}–{frame}</span>}
          {W > frame && <span className="band out" style={{ gridColumn: `${frame + 2} / span ${W - frame}` }}>Ngoài khung</span>}</>)}
        {line('wk', 'weeks', <b className="lab">Tuần</b>, weeks.map(w => <small key={w} className={'wk' + bandCls(w)}>{w}</small>))}
        {order.map((pid, k) => {
          const p = progs.get(pid); const info = s.progs.get(pid); const color = colorOf(k)
          const mine = s.rows.filter(r => r.program_id === pid)
          const ws = mine.filter(r => !r.skipped).flatMap(r => r.weeks ?? [])
          const from = ws.length ? Math.min(...ws) : 0, to = ws.length ? Math.max(...ws) : 0
          return <Fragment key={pid}>
            {line('p', 'progrow', <span className="lab prog"><i style={{ background: color }} /><b>{progCode(p)}</b>{titles && p && <> {p.title}</>}</span>,
              <span className="track" style={{ gridColumn: '2 / -1' }}>{from > 0 && <i style={{ left: pct(from), width: `${((to - from + 1) / W) * 100}%`, background: color }} title={`Tuần ${from}–${to}`} />}</span>)}
            {info?.subjects.map(sub => {
              const load = weekLoad(mine, (r: Row) => s.subjOf.get(r.unit_id) === sub.name)
              return line(sub.name, 'subjrow', <span className="lab subj">{sub.name}</span>,
                weeks.map(w => { const n = load.get(w); return <span key={w} className={'cell' + (n ? ' on' : '') + bandCls(w)} style={n ? { background: color } : undefined}
                  title={n ? `${sub.name} · tuần ${w}: ${n} tiết` : undefined}>{n || ''}</span> }))
            })}
          </Fragment>
        })}
        {line('tot', 'totrow', <b className="lab total">Tiết/tuần</b>,
          weeks.map(w => { const n = total.get(w); return <small key={w} className={'tot' + (n && n > LOAD_MAX ? ' over' : '')}>{n || ''}</small> }))}
      </div>
    </div>
  )
}
