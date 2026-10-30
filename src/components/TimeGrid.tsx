// Lưới tuần theo giờ (kiểu lịch Google): mỗi ngày một cột, trục dọc là giờ trong ngày, mỗi buổi là một khối
// đặt đúng khung giờ. Buổi trùng giờ chia cột trong ngày. Dùng ở Lịch tập huấn (tuần) và Xếp lịch kế hoạch tập huấn.
import { useEffect, useState } from 'react'

export type TEvent = { id: string; start: Date; end: Date; title: string; sub?: string; cls?: string; color?: string; tip?: string; onClick?: () => void }

const HH = 44   // chiều cao một giờ (px)
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
const pad = (n: number) => String(n).padStart(2, '0')
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const minOf = (d: Date) => d.getHours() * 60 + d.getMinutes()

/** Chia cột cho các buổi trùng giờ trong một ngày */
function lanes(evs: TEvent[]) {
  const out: { e: TEvent; lane: number; of: number }[] = []
  const sorted = [...evs].sort((a, b) => +a.start - +b.start || +b.end - +a.end)
  let group: typeof out = [], end = -Infinity
  const flush = () => { const n = Math.max(1, ...group.map(g => g.lane + 1)); group.forEach(g => { g.of = n }); out.push(...group); group = [] }
  for (const e of sorted) {
    if (+e.start >= end && group.length) flush()
    const used = new Set(group.filter(g => +g.e.end > +e.start).map(g => g.lane))
    let lane = 0; while (used.has(lane)) lane++
    group.push({ e, lane, of: 1 }); end = Math.max(end, +e.end)
  }
  if (group.length) flush()
  return out
}

/** dayNote: ghi chú của ngày (VD: tên ngày nghỉ) — tô đầu cột và cả cột, hiện khi rê chuột. */
export function TimeGrid({ days, events, from = 7, to = 18, shade, label = 'Lịch theo giờ', dayNote }:
  { days: Date[]; events: TEvent[]; from?: number; to?: number; shade?: [number, number, string]; label?: string; dayNote?: (d: Date) => string | undefined }) {
  // Mở rộng khung giờ cho đủ mọi buổi trong tuần
  const inDays = events.filter(e => days.some(d => same(d, e.start)))
  const h0 = Math.max(0, Math.min(from, ...inDays.map(e => e.start.getHours())))
  const h1 = Math.min(24, Math.max(to, ...inDays.map(e => same(e.start, e.end) ? Math.ceil(minOf(e.end) / 60) : 24)))
  const hours = Array.from({ length: h1 - h0 }, (_, k) => h0 + k)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t) }, [])
  const y = (min: number) => (min - h0 * 60) / 60 * HH
  const cols = `52px repeat(${days.length}, minmax(96px, 1fr))`
  return <div className="tgrid" role="table" aria-label={label}>
    <div className="tghead" style={{ gridTemplateColumns: cols }}><span />
      {days.map(d => { const note = dayNote?.(d)
        return <b key={+d} className={(same(d, now) ? 'today' : d.getDay() === 0 || d.getDay() === 6 ? 'wkend' : '') + (note ? ' hol' : '')} title={note ? 'Ngày nghỉ: ' + note : undefined}>
          {WD[d.getDay()]} <small>{pad(d.getDate())}/{pad(d.getMonth() + 1)}</small>{note && <em className="tghol">Nghỉ: {note}</em>}</b> })}</div>
    <div className="tgbody" style={{ gridTemplateColumns: cols, height: hours.length * HH }}>
      <div className="tghours">{hours.map(h => <small key={h} style={{ top: (h - h0) * HH }}>{pad(h)}:00</small>)}</div>
      {days.map(d => {
        const evs = lanes(events.filter(e => same(d, e.start)))
        return <div key={+d} className={'tgday' + (same(d, now) ? ' today' : '') + (d.getDay() === 0 || d.getDay() === 6 ? ' wkend' : '') + (dayNote?.(d) ? ' hol' : '')}>
          {hours.map(h => <i key={h} className="tgline" style={{ top: (h - h0) * HH }} />)}
          {shade && <span className="tgshade" style={{ top: y(shade[0]), height: y(shade[1]) - y(shade[0]) }} title={shade[2]} />}
          {same(d, now) && minOf(now) >= h0 * 60 && minOf(now) <= h1 * 60 && <i className="tgnow" style={{ top: y(minOf(now)) }} aria-hidden="true" />}
          {evs.map(({ e, lane, of }) => {
            const top = y(minOf(e.start)), end = same(e.start, e.end) ? minOf(e.end) : h1 * 60
            const h = Math.max(22, y(end) - top - 2)
            const Tag = e.onClick ? 'button' : 'div'
            return <Tag key={e.id} type={e.onClick ? 'button' : undefined} className={'tgev ' + (e.cls ?? '')} onClick={e.onClick}
              style={{ top, height: h, left: `calc(${lane * 100 / of}% + 2px)`, width: `calc(${100 / of}% - 4px)`, ...(e.color ? { background: e.color, borderColor: e.color, color: '#fff' } : {}) }}
              title={e.tip ?? `${e.title}\n${hm(e.start)}–${hm(e.end)}${e.sub ? '\n' + e.sub : ''}`}>
              <b>{hm(e.start)}–{hm(e.end)}</b> <span>{e.title}</span>{e.sub && h > 50 && <small>{e.sub}</small>}</Tag>
          })}
        </div>
      })}
    </div>
  </div>
}
