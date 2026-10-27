// Kế hoạch tập huấn dạng lịch: xem theo tháng (mỗi ngày các kế hoạch đang diễn ra) hoặc theo năm (mỗi kế hoạch một thanh trên 12 tháng).
// Dùng chung bộ lọc với tab "Danh sách kế hoạch". Bấm kế hoạch để mở.
import { useMemo, useState } from 'react'
import type { TPlan } from './Plans'

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const vn = (s: string) => s.split('-').reverse().join('/')
const from = (p: TPlan) => (p.starts_on ?? p.ends_on)!
const to = (p: TPlan) => (p.ends_on && p.ends_on >= from(p) ? p.ends_on : from(p))
const when = (p: TPlan) => (from(p) === to(p) ? vn(from(p)) : `${vn(from(p))} – ${vn(to(p))}`)
const TONE: Record<string, string> = { draft: 'draft', published: 'pub', archived: 'off' }
const MAX = 3

export function PlanCal({ plans, onOpen, label }: { plans: TPlan[]; onOpen: (id: string) => void; label: (p: TPlan) => string }) {
  const dated = useMemo(() => plans.filter(p => p.starts_on || p.ends_on).sort((a, b) => from(a).localeCompare(from(b)) || a.name.localeCompare(b.name)), [plans])
  const undated = plans.filter(p => !p.starts_on && !p.ends_on)
  const [view, setView] = useState<'month' | 'year'>('month')
  // Mở ở tháng hiện tại; tháng này trống thì nhảy tới kế hoạch sắp tới gần nhất (hoặc kế hoạch gần đây nhất)
  const [anchor, setAnchor] = useState(() => {
    const t = new Date(), m0 = ymd(new Date(t.getFullYear(), t.getMonth(), 1)), m1 = ymd(new Date(t.getFullYear(), t.getMonth() + 1, 0))
    if (!dated.length || dated.some(p => from(p) <= m1 && to(p) >= m0)) return new Date(t.getFullYear(), t.getMonth(), 1)
    const next = dated.find(p => from(p) > m1) ?? dated[dated.length - 1]
    const d = new Date(from(next) + 'T00:00'); return new Date(d.getFullYear(), d.getMonth(), 1)
  })
  const [pick, setPick] = useState<string | null>(null)
  const today = ymd(new Date())
  const on = (s: string) => dated.filter(p => from(p) <= s && to(p) >= s)
  const shift = (k: number) => { setPick(null); setAnchor(a => view === 'month' ? new Date(a.getFullYear(), a.getMonth() + k, 1) : new Date(a.getFullYear() + k, a.getMonth(), 1)) }

  // Tháng: lưới 6 tuần bắt đầu từ thứ Hai
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7))
  const days = Array.from({ length: 42 }, (_, k) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + k))
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
        <b style={{ minWidth: 110, textAlign: 'center' }}>{view === 'month' ? `Tháng ${anchor.getMonth() + 1}/${y}` : `Năm ${y}`}</b>
        <button type="button" aria-label="Sau" onClick={() => shift(1)}>›</button>
        <button type="button" onClick={() => { setPick(null); const t = new Date(); setAnchor(new Date(t.getFullYear(), t.getMonth(), 1)) }}>Hôm nay</button>
        <div className="segmented" style={{ margin: 0 }}>{([['month', 'Tháng'], ['year', 'Năm']] as const).map(([k, l]) =>
          <button key={k} type="button" className={view === k ? 'on' : ''} aria-pressed={view === k} onClick={() => { setPick(null); setView(k) }}>{l}</button>)}</div>
      </div>
      <small className="sub tpcallegend"><i className="pub" /> Đã phát hành <i className="draft" /> Nháp <i className="off" /> Ngừng dùng
        · {view === 'month' ? `${inMonth.length} kế hoạch trong tháng` : `${inYear.length} kế hoạch trong năm`}</small>
    </div>

    {view === 'month' ? <>
      <div className="tscal tpcal">
        {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(d => <div key={d} className="tscalh">{d}</div>)}
        {days.map(d => { const s = ymd(d), ps = on(s)
          return <div key={s} className={'tscald' + (d.getMonth() !== anchor.getMonth() ? ' out' : '') + (s === today ? ' today' : '') + (pick === s ? ' pick' : '')}>
            <small>{d.getDate()}</small>
            {ps.slice(0, ps.length > MAX ? MAX - 1 : MAX).map(p => chip(p, s))}
            {ps.length > MAX && <button type="button" className="tpcalmore" onClick={() => setPick(pick === s ? null : s)}>+{ps.length - MAX + 1} kế hoạch</button>}
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
