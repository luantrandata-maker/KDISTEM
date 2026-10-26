// Lưới tuần của bản phân phối: dải Học kỳ 1 / Học kỳ 2, mỗi chương trình một vạch tuần, mỗi môn một hàng ô (số tiết trong tuần),
// hàng cuối "Tiết/tuần" — tuần vượt LOAD_MAX tô cam.
// Có lịch tham chiếu (095): tuần có ngày nghỉ đánh dấu ⚠; bấm số tuần xem ngày thật và ngày nghỉ, bấm ô xem bài trong tuần.
import { Fragment, useRef, useState, type ReactNode } from 'react'
import { LOAD_MAX, progCode, weekLoad, type Plan, type Prog, type Row, type Sched } from './sched'
import { WEEKDAY, dayOf, offIn, vnd, vnShort, type CalWeek } from './calendar'

const KIND: Record<string, string> = { state: 'Lễ nhà nước', tet: 'Tết', break: 'Nghỉ giữa kỳ', school: 'Của trường', other: 'Khác' }
type Pop = { w: number; pid?: string; sub?: string; x: number; y: number }

const Warn = () => <svg aria-label="có ngày nghỉ" role="img" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>

export const COLORS = ['#1f4e9a', '#16a34a', '#d97706', '#7c3aed', '#dc2626', '#0d9488']
export const colorOf = (k: number) => COLORS[k % COLORS.length]

export function WeekGrid({ plan, order, progs, s, titles, cal, calLabel, year, titleOf }: {
  plan: Plan; order: string[]; progs: Map<string, Prog>; s: Sched; titles?: boolean
  cal?: Map<number, CalWeek>; calLabel?: string; year?: string; titleOf?: (unitId: string) => string
}) {
  const [pop, setPop] = useState<Pop | null>(null)
  const wrap = useRef<HTMLDivElement>(null), scroller = useRef<HTMLDivElement>(null)
  const open = (e: React.MouseEvent, p: Omit<Pop, 'x' | 'y'>) => {
    const el = wrap.current; if (!el) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect(), b = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(r.left - b.left - 120, el.clientWidth - 330)), y = r.bottom - b.top + 6
    setPop(o => o && o.w === p.w && o.pid === p.pid && o.sub === p.sub ? null : { ...p, x, y })
  }
  const hol = (w: number) => cal?.get(w)?.holidays.length ? cal.get(w)! : null
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
    <div className="distgridouter" ref={wrap}><div className="distgridwrap" ref={scroller} onScroll={() => setPop(null)}>
      <div className="distgrid" role="table" aria-label="Lịch theo tuần">
        {line('band', 'bands', <span />, <>
          <span className="band hk1" style={{ gridColumn: `2 / span ${plan.hk1_weeks}` }}>Học kỳ 1 · tuần 1–{plan.hk1_weeks}</span>
          {plan.hk2_weeks > 0 && <span className="band hk2" style={{ gridColumn: `${plan.hk1_weeks + 2} / span ${plan.hk2_weeks}` }}>Học kỳ 2 · tuần {plan.hk1_weeks + 1}–{frame}</span>}
          {W > frame && <span className="band out" style={{ gridColumn: `${frame + 2} / span ${W - frame}` }}>Ngoài khung</span>}</>)}
        {line('wk', 'weeks', <b className="lab">Tuần</b>, weeks.map(w => {
          const c = cal?.get(w), h = hol(w)
          return c ? <button type="button" key={w} className={'wk wkbtn' + bandCls(w) + (h ? ' hol' : '') + (pop?.w === w && !pop.pid ? ' sel' : '')}
            title={`Tuần ${w}: ${vnShort(c.starts_on)}–${vnShort(c.ends_on)}${h ? ' · có ngày nghỉ' : ''}`} onClick={e => open(e, { w })}>{h && <Warn />}<span>{w}</span></button>
            : <small key={w} className={'wk' + bandCls(w)}>{w}</small>
        }))}
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
                weeks.map(w => { const n = load.get(w); const h = n && hol(w)
                  return n ? <button type="button" key={w} className={'cell on' + bandCls(w) + (h ? ' hol' : '') + (pop?.w === w && pop.sub === sub.name && pop.pid === pid ? ' sel' : '')} style={{ background: color }}
                    title={`${sub.name} · tuần ${w}: ${n} tiết${h ? ' · tuần có ngày nghỉ' : ''}`} onClick={e => open(e, { w, pid, sub: sub.name })}>{n}</button>
                    : <span key={w} className={'cell' + bandCls(w) + (hol(w) ? ' hol' : '')} /> }))
            })}
          </Fragment>
        })}
        {line('tot', 'totrow', <b className="lab total">Tiết/tuần</b>,
          weeks.map(w => { const n = total.get(w); return <small key={w} className={'tot' + (n && n > LOAD_MAX ? ' over' : '')}>{n || ''}</small> }))}
      </div></div>
      {pop && <div className="distpop" style={{ left: pop.x, top: pop.y }} role="dialog" aria-label={`Tuần ${pop.w}`}>
        <button type="button" className="x" aria-label="Đóng" onClick={() => setPop(null)}>×</button>
        {PopBody(pop)}
      </div>}
    </div>
  )

  function PopBody(p: Pop) {
    const c = cal?.get(p.w)
    const head = <>
      <b className="distpopt">Tuần {p.w}</b> <small className="sub">{p.w <= plan.hk1_weeks ? 'Học kỳ 1' : p.w <= frame ? 'Học kỳ 2' : 'Ngoài khung'}</small>
      {c && <div className="sub">{WEEKDAY[dayOf(c.starts_on)]} {vnShort(c.starts_on)} đến {WEEKDAY[dayOf(c.ends_on)]} {vnd(c.ends_on)}</div>}</>
    const src = c?.holidays.length ? [...new Set(c.holidays.map(h => h.std ? 'Theo chuẩn chung' : h.org_name))].join(', ') + (year ? ' · năm học ' + year : '') : ''
    const hols = c?.holidays.length ? <><ul className="distpophol">{c.holidays.map(h => {
      const n = offIn(h, c.starts_on, c.ends_on), one = h.starts_on === h.ends_on
      return <li key={h.id}><b>{h.name} {one ? vnd(h.starts_on) : `${vnShort(h.starts_on)} – ${vnd(h.ends_on)}`}</b>
        <div className="sub">{one ? `${WEEKDAY[dayOf(h.starts_on)]} ${vnShort(h.starts_on)}` : `${WEEKDAY[dayOf(h.starts_on)]} ${vnShort(h.starts_on)} đến ${WEEKDAY[dayOf(h.ends_on)]} ${vnShort(h.ends_on)}`}{KIND[h.kind] && h.kind !== 'other' ? ' · ' + KIND[h.kind] : ''}</div>
        <div className="sub">{n ? `Nghỉ ${n}/5 ngày học` : 'Rơi vào cuối tuần'} · <b className={h.status === 'expected' ? 'st exp' : 'st ok'}>{h.status === 'expected' ? 'Dự kiến' : 'Chính thức'}</b></div></li>
    })}</ul><div className="distpopsrc sub">{src}</div></> : c ? <p className="sub" style={{ margin: '6px 0 0' }}>Không có ngày nghỉ.</p> : null
    if (!p.pid) return <>{head}{hols}{!c && <p className="sub" style={{ margin: '6px 0 0' }}>Chưa có lịch tham chiếu cho tuần này.</p>}</>
    const rows = s.rows.filter(r => r.program_id === p.pid && !r.skipped && s.subjOf.get(r.unit_id) === p.sub && (r.weeks ?? []).includes(p.w))
    return <>{head}
      <div className="distpoples"><small className="sub">{progCode(progs.get(p.pid))} · {p.sub}</small>
        <ol>{rows.map(r => { const k = (r.weeks ?? []).filter(x => x === p.w).length
          return <li key={r.unit_id}>{titleOf?.(r.unit_id) ?? 'Bài'} <small className="sub">· {k} tiết{r.periods > k ? ` (bài ${r.periods} tiết)` : ''}</small></li> })}</ol></div>
      {c?.holidays.length ? hols : null}
      {calLabel && c && <small className="sub">Lịch: {calLabel}</small>}</>
  }
}
