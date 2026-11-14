// Kế hoạch đào tạo dạng lịch: xem theo tuần / tháng (mỗi ngày các kế hoạch đang diễn ra) hoặc theo năm (mỗi kế hoạch một thanh trên 12 tháng).
// Dùng chung bộ lọc với tab "Danh sách kế hoạch". Bấm kế hoạch để mở.
import { useMemo, useState } from 'react'
import type { TPlan } from './Plans'
import { useFitMonth, weeksOf } from '../../lib/fitCal'

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const vn = (s: string) => s.split('-').reverse().join('/')
const from = (p: TPlan) => (p.starts_on ?? p.ends_on)!
const to = (p: TPlan) => (p.ends_on && p.ends_on >= from(p) ? p.ends_on : from(p))
const when = (p: TPlan) => (from(p) === to(p) ? vn(from(p)) : `${vn(from(p))} – ${vn(to(p))}`)
const TONE: Record<string, string> = { draft: 'draft', published: 'pub', archived: 'off' }

/** Xếp các kế hoạch của một tuần thành thanh liền: mỗi thanh một làn, thanh dài/bắt đầu sớm nằm trên */
type Seg = { p: TPlan; c0: number; c1: number; lane: number; cont: boolean; more: boolean }
function lay(week: string[], plans: TPlan[]): Seg[] {
  const a = week[0], b = week[6]
  const segs = plans.filter(p => from(p) <= b && to(p) >= a).map(p => {
    const c0 = from(p) < a ? 0 : week.indexOf(from(p)), c1 = to(p) > b ? 6 : week.indexOf(to(p))
    return { p, c0, c1, lane: 0, cont: from(p) < a, more: to(p) > b }
  }).sort((x, y) => x.c0 - y.c0 || (y.c1 - y.c0) - (x.c1 - x.c0) || x.p.name.localeCompare(y.p.name))
  const end: number[] = []
  for (const g of segs) { let l = end.findIndex(e => e < g.c0); if (l < 0) { l = end.length; end.push(-1) } end[l] = g.c1; g.lane = l }
  return segs
}

export function PlanCal({ plans, onOpen, label }: { plans: TPlan[]; onOpen: (id: string) => void; label: (p: TPlan) => string }) {
  const dated = useMemo(() => plans.filter(p => p.starts_on || p.ends_on).sort((a, b) => from(a).localeCompare(from(b)) || a.name.localeCompare(b.name)), [plans])
  const undated = plans.filter(p => !p.starts_on && !p.ends_on)
  const [view, setView] = useState<'week' | 'month' | 'year'>('month')
  // Mở ở tháng hiện tại; tháng này trống thì nhảy tới kế hoạch sắp tới gần nhất (hoặc kế hoạch gần đây nhất)
  const [anchor, setAnchor] = useState(() => {
    const t = new Date(), m0 = ymd(new Date(t.getFullYear(), t.getMonth(), 1)), m1 = ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0))
    if (!dated.length || dated.some(p => from(p) <= m1 && to(p) >= m0)) return new Date(t.getFullYear(), t.getMonth(), t.getDate())
    const next = dated.find(p => from(p) > m1) ?? dated[dated.length - 1]
    return new Date(from(next) + 'T00:00')
  })
  const [pick, setPick] = useState<string | null>(null)
  const today = ymd(new Date())
  const on = (s: string) => dated.filter(p => from(p) <= s && to(p) >= s)
  const shift = (k: number) => { setPick(null); setAnchor(a => view === 'week' ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * k) : view === 'month' ? new Date(a.getFullYear(), a.getMonth() + k, 1) : new Date(a.getFullYear() + k, a.getMonth(), 1)) }

  // Tháng: lưới các tuần của tháng bắt đầu từ thứ Hai, vừa một màn hình
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7))
  const nWk = weeksOf(anchor)
  const days = Array.from({ length: nWk * 7 }, (_, k) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + k))
  const fit = useFitMonth(view === 'month', nWk, 22, true)
  // Số làn thanh mỗi tuần vừa chiều cao: hàng tuần trừ dòng số ngày (~26px), mỗi làn ~24px
  const fz = typeof document === 'undefined' ? 1 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fz')) || 1
  const LANES = fit.style ? Math.max(2, Math.floor(((fit.style.height - 34 * fz) / nWk - 28 * fz) / (24 * fz))) : 4
  // Tuần: 7 ngày từ thứ Hai của tuần chứa ngày đang xem
  const w0 = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - ((anchor.getDay() + 6) % 7))
  const week = Array.from({ length: 7 }, (_, k) => new Date(w0.getFullYear(), w0.getMonth(), w0.getDate() + k))
  const inWeek = dated.filter(p => from(p) <= ymd(week[6]) && to(p) >= ymd(week[0]))
  const mFrom = ymd(first), mTo = ymd(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0))
  const inMonth = dated.filter(p => from(p) <= mTo && to(p) >= mFrom)

  // Năm: thanh theo tỉ lệ ngày trong năm
  const y = anchor.getFullYear(), y0 = `${y}-01-01`, y1 = `${y}-12-31`
  const yDays = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 864e5
  const pos = (s: string) => { const [a, b, c] = s.split('-').map(Number); return (Date.UTC(a, b - 1, c) - Date.UTC(y, 0, 1)) / 864e5 / yDays * 100 }
  const inYear = dated.filter(p => from(p) <= y1 && to(p) >= y0)
  const nowPct = today.startsWith(String(y)) ? pos(today) : null

  const chip = (p: TPlan, s?: string) => {
    const head = !s || s === from(p) || new Date(s + 'T00:00').getDay() === 1 || s.endsWith('-01')
    return <button key={p.id} type="button" className={'tpcalev ' + (TONE[p.pub_status] ?? '') + (s && s !== from(p) ? ' cont' : '') + (s && s !== to(p) ? ' more' : '')}
      title={`${p.name}\n${when(p)}`} onClick={() => onOpen(p.id)}>{head ? p.name : <span aria-hidden="true">{p.name}</span>}</button>
  }

  return <section className="panel" style={{ display: 'grid', gap: 10 }}>
    <div className="bar" style={{ margin: 0 }}>
      <div className="tools">
        <button type="button" aria-label="Trước" onClick={() => shift(-1)}>‹</button>
        <b style={{ minWidth: 110, textAlign: 'center' }}>{view === 'week' ? `${vn(ymd(week[0])).slice(0, 5)} – ${vn(ymd(week[6]))}` : view === 'month' ? `Tháng ${anchor.getMonth() + 1}/${y}` : `Năm ${y}`}</b>
        <button type="button" aria-label="Sau" onClick={() => shift(1)}>›</button>
        <button type="button" onClick={() => { setPick(null); const t = new Date(); setAnchor(new Date(t.getFullYear(), t.getMonth(), t.getDate())) }}>Hôm nay</button>
        <div className="segmented" style={{ margin: 0 }}>{([['week', 'Tuần'], ['month', 'Tháng'], ['year', 'Năm']] as const).map(([k, l]) =>
          <button key={k} type="button" className={view === k ? 'on' : ''} aria-pressed={view === k} onClick={() => { setPick(null); setView(k) }}>{l}</button>)}</div>
      </div>
      <small className="sub tpcallegend"><i className="pub" /> Đã phát hành <i className="draft" /> Nháp <i className="off" /> Ngừng dùng
        · {view === 'week' ? `${inWeek.length} kế hoạch trong tuần` : view === 'month' ? `${inMonth.length} kế hoạch trong tháng` : `${inYear.length} kế hoạch trong năm`}</small>
    </div>

    {view !== 'year' ? <>
      <div ref={view === 'month' ? fit.ref : undefined} className={'tpbars ' + view} style={view === 'month' && fit.style ? { height: fit.style.height } : undefined}>
        <div className="tpbhead">{(view === 'week' ? week : days.slice(0, 7)).map((d, k) =>
          <span key={k}>{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'][k]}</span>)}</div>
        {(view === 'week' ? [week] : Array.from({ length: nWk }, (_, w) => days.slice(w * 7, w * 7 + 7))).map(wd => {
          const ws = wd.map(ymd), segs = lay(ws, dated), nL = segs.reduce((m, g) => Math.max(m, g.lane + 1), 0)
          const cap = view === 'week' ? nL : LANES, show = nL > cap ? cap - 1 : cap
          const hidden = (c: number) => segs.filter(g => g.lane >= show && g.c0 <= c && g.c1 >= c).length
          return <div key={ws[0]} className="tpbwk" style={{ gridTemplateRows: `var(--dh) repeat(${Math.max(view === 'week' ? Math.max(nL, 10) : cap, 1)}, var(--lane))` }}>
            {wd.map((d, c) => { const s = ws[c]
              return <div key={s} className={'tpbday' + (view === 'month' && d.getMonth() !== anchor.getMonth() ? ' out' : '') + (s === today ? ' today' : '') + (pick === s ? ' pick' : '')} style={{ gridColumn: c + 1 }}>
                <small>{d.getDate()}{d.getDate() === 1 && view === 'month' ? `/${d.getMonth() + 1}` : ''}</small></div> })}
            {segs.filter(g => g.lane < show).map(g => <button key={g.p.id} type="button"
              className={'tpbar ' + (TONE[g.p.pub_status] ?? '') + (g.cont ? ' cont' : '') + (g.more ? ' more' : '')}
              style={{ gridColumn: `${g.c0 + 1} / ${g.c1 + 2}`, gridRow: g.lane + 2 }}
              title={`${g.p.name}\n${[label(g.p), when(g.p)].filter(Boolean).join(' · ')}`} onClick={() => onOpen(g.p.id)}>
              <b>{g.p.name}</b>{g.c1 > g.c0 && label(g.p) && <small>· {label(g.p)}</small>}</button>)}
            {nL > cap && ws.map((s, c) => { const n = hidden(c)
              return n > 0 && <button key={'m' + s} type="button" className="tpbmore" style={{ gridColumn: c + 1, gridRow: cap + 1 }} onClick={() => setPick(pick === s ? null : s)}>+{n} kế hoạch</button> })}
          </div> })}
      </div>
      {pick && <div className="tpcalday">
        <b>Ngày {vn(pick)}: {on(pick).length} kế hoạch</b>
        <ul>{on(pick).map(p => <li key={p.id}>{chip(p)}<small className="sub">{[label(p), when(p)].filter(Boolean).join(' · ')}</small></li>)}</ul>
      </div>}
    </> : <div className="tpgantt">
      <div className="tpganttrow head"><span />
        <div className="tpgantttrack">{Array.from({ length: 12 }, (_, m) => <span key={m}>Th{m + 1}</span>)}</div></div>
      {inYear.map(p => { const a = Math.max(0, pos(from(p))), b = Math.min(100, pos(to(p)) + 100 / yDays)
        return <div key={p.id} className="tpganttrow">
          <button type="button" className="namelink" title={p.name} onClick={() => onOpen(p.id)}>{p.name}<small className="sub">{[label(p), when(p)].filter(Boolean).join(' · ')}</small></button>
          <div className="tpgantttrack">{Array.from({ length: 12 }, (_, m) => <span key={m} />)}
            {nowPct != null && <i className="now" style={{ left: `${nowPct}%` }} aria-hidden="true" />}
            <button type="button" className={'tpganttbar ' + (TONE[p.pub_status] ?? '')} style={{ left: `${a}%`, width: `${Math.max(b - a, 0.8)}%` }}
              title={`${p.name}\n${when(p)}`} aria-label={`${p.name}, ${when(p)}`} onClick={() => onOpen(p.id)} />
          </div>
        </div> })}
      {!inYear.length && <p className="sub" style={{ margin: 8 }}>Không có kế hoạch nào trong năm {y}.</p>}
    </div>}

    {undated.length > 0 && <p className="sub" style={{ margin: 0 }}>Chưa có ngày ({undated.length}): {undated.map((p, k) => <span key={p.id}>{k > 0 && '; '}
      <button type="button" className="namelink" onClick={() => onOpen(p.id)}>{p.name}</button></span>)}. Điền "Từ ngày / Đến ngày" trong thông tin kế hoạch để hiện trên lịch.</p>}
  </section>
}
