// Kế hoạch đào tạo dạng lịch: dòng thời gian, mỗi kế hoạch một hàng, thanh kéo từ ngày bắt đầu tới ngày kết thúc.
// Tuần / Tháng: cột là từng ngày; Năm: cột là 12 tháng. Khối lịch cao vừa phần còn lại của màn hình, cuộn bên trong
// (tên kế hoạch và hàng ngày đứng yên), như các trang dạng bảng. Dùng chung bộ lọc với dạng Bảng. Bấm kế hoạch để mở.
import { useMemo, useState } from 'react'
import type { TPlan } from './Plans'
import { useFillRest } from '../../lib/fitCal'

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const vn = (s: string) => s.split('-').reverse().join('/')
const from = (p: TPlan) => (p.starts_on ?? p.ends_on)!
const to = (p: TPlan) => (p.ends_on && p.ends_on >= from(p) ? p.ends_on : from(p))
const when = (p: TPlan) => (from(p) === to(p) ? vn(from(p)) : `${vn(from(p))} – ${vn(to(p))}`)
const TONE: Record<string, string> = { draft: 'draft', published: 'pub', archived: 'off' }
const WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

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
  const today = ymd(new Date())
  // Chú thích màu kiêm bộ lọc trạng thái phát hành
  const [stF, setStF] = useState<'' | 'published' | 'draft' | 'archived'>('')
  const shift = (k: number) => setAnchor(a => view === 'week' ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * k) : view === 'month' ? new Date(a.getFullYear(), a.getMonth() + k, 1) : new Date(a.getFullYear() + k, a.getMonth(), 1))
  const fill = useFillRest(true)

  // Tuần: 7 ngày từ thứ Hai; Tháng: các ngày của tháng
  const w0 = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - ((anchor.getDay() + 6) % 7))
  const nDays = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate()
  const days = view === 'week' ? Array.from({ length: 7 }, (_, k) => new Date(w0.getFullYear(), w0.getMonth(), w0.getDate() + k))
    : Array.from({ length: nDays }, (_, k) => new Date(anchor.getFullYear(), anchor.getMonth(), k + 1))
  const ds = days.map(ymd), d0 = ds[0], d1 = ds[ds.length - 1]
  const y = anchor.getFullYear(), y0 = `${y}-01-01`, y1 = `${y}-12-31`
  const [a, b] = view === 'year' ? [y0, y1] : [d0, d1]
  const inRange = dated.filter(p => from(p) <= b && to(p) >= a), shown = inRange.filter(p => !stF || p.pub_status === stF)

  // Vị trí thanh: theo cột ngày (tuần / tháng) hoặc theo tỉ lệ ngày trong năm
  const yDays = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 864e5
  const pos = (s: string) => { const [yy, mm, dd] = s.split('-').map(Number); return (Date.UTC(yy, mm - 1, dd) - Date.UTC(y, 0, 1)) / 864e5 / yDays * 100 }
  const nCol = view === 'year' ? 12 : days.length
  const tpl = { gridTemplateColumns: `repeat(${nCol}, minmax(${view === 'month' ? 30 : 0}px, 1fr))` }
  const bar = (p: TPlan) => {
    const tip = `${p.name}\n${[label(p), when(p)].filter(Boolean).join(' · ')}`, cls = 'tptlbar ' + (TONE[p.pub_status] ?? '')
    if (view === 'year') {
      const l = Math.max(0, pos(from(p))), r = Math.min(100, pos(to(p)) + 100 / yDays)
      return <button type="button" className={cls + ' abs'} title={tip} aria-label={tip} onClick={() => onOpen(p.id)} style={{ left: `${l}%`, width: `${Math.max(r - l, 0.8)}%` }} />
    }
    const c0 = from(p) < a ? 0 : ds.indexOf(from(p)), c1 = to(p) > b ? ds.length - 1 : ds.indexOf(to(p))
    return <button type="button" className={cls + (from(p) < a ? ' cont' : '') + (to(p) > b ? ' more' : '')} title={tip} onClick={() => onOpen(p.id)}
      style={{ gridColumn: `${c0 + 1} / ${c1 + 2}`, gridRow: 1 }}>{c1 - c0 >= (view === 'week' ? 0 : 2) ? when(p) : ''}</button>
  }
  const nowPct = view === 'year' && today.startsWith(String(y)) ? pos(today) : null

  return <section className="panel tptlpanel">
    <div className="bar" style={{ margin: 0 }}>
      <div className="tools">
        <button type="button" aria-label="Trước" onClick={() => shift(-1)}>‹</button>
        <b style={{ minWidth: 110, textAlign: 'center' }}>{view === 'week' ? `${vn(d0).slice(0, 5)} – ${vn(d1)}` : view === 'month' ? `Tháng ${anchor.getMonth() + 1}/${y}` : `Năm ${y}`}</b>
        <button type="button" aria-label="Sau" onClick={() => shift(1)}>›</button>
        <button type="button" onClick={() => { const t = new Date(); setAnchor(new Date(t.getFullYear(), t.getMonth(), t.getDate())) }}>Hôm nay</button>
        <div className="segmented" style={{ margin: 0 }}>{([['week', 'Tuần'], ['month', 'Tháng'], ['year', 'Năm']] as const).map(([k, l]) =>
          <button key={k} type="button" className={view === k ? 'on' : ''} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}</div>
      </div>
      <div className="tplegf" role="group" aria-label="Lọc theo trạng thái">
        {([['', 'Tất cả'], ['published', 'Đã phát hành'], ['draft', 'Nháp'], ['archived', 'Ngừng dùng']] as const).map(([k, l]) =>
          <button key={l} type="button" className={'tplegb' + (stF === k ? ' on' : '')} aria-pressed={stF === k} onClick={() => setStF(k)}>
            {k && <i className={TONE[k]} />}{l} <b>{k ? inRange.filter(p => p.pub_status === k).length : inRange.length}</b></button>)}
        <small className="sub">trong {({ week: 'tuần', month: 'tháng', year: 'năm' })[view]}</small></div>
    </div>

    <div ref={fill.ref} style={fill.style} className={'tptl ' + view} role="table" aria-label="Kế hoạch đào tạo theo thời gian">
      <div className="tptlrow head" role="row">
        <div className="tptlname" role="columnheader">Kế hoạch</div>
        <div className="tptltrack" style={tpl}>{view === 'year'
          ? Array.from({ length: 12 }, (_, m) => <span key={m} className={'tptlcol' + (today.startsWith(`${y}-${String(m + 1).padStart(2, '0')}`) ? ' today' : '')}>Th{m + 1}</span>)
          : days.map((d, k) => <span key={k} className={'tptlcol' + (d.getDay() % 6 === 0 ? ' wkend' : '') + (ds[k] === today ? ' today' : '')}>
            <small>{WD[d.getDay()]}</small><b>{view === 'week' ? `${d.getDate()}/${d.getMonth() + 1}` : d.getDate()}</b></span>)}</div>
      </div>
      {shown.map(p => <div key={p.id} className="tptlrow" role="row">
        <button type="button" className="tptlname" title={p.name} onClick={() => onOpen(p.id)}>
          <b>{p.name}</b><small className="sub">{[label(p), when(p)].filter(Boolean).join(' · ')}</small></button>
        <div className="tptltrack" style={tpl}>
          {view === 'year' ? Array.from({ length: 12 }, (_, m) => <span key={m} className="tptlcol" style={{ gridColumn: m + 1, gridRow: 1 }} />)
            : days.map((d, k) => <span key={k} className={'tptlcol' + (d.getDay() % 6 === 0 ? ' wkend' : '') + (ds[k] === today ? ' today' : '')} style={{ gridColumn: k + 1, gridRow: 1 }} />)}
          {nowPct != null && <i className="now" style={{ left: `${nowPct}%` }} aria-hidden="true" />}
          {bar(p)}
        </div>
      </div>)}
      {!shown.length && <p className="sub tptlempty">Không có kế hoạch nào trong {view === 'week' ? 'tuần' : view === 'month' ? `tháng ${anchor.getMonth() + 1}/${y}` : `năm ${y}`}.</p>}
    </div>

    {undated.length > 0 && <p className="sub" style={{ margin: 0 }}>Chưa có ngày ({undated.length}): {undated.map((p, k) => <span key={p.id}>{k > 0 && '; '}
      <button type="button" className="namelink" onClick={() => onOpen(p.id)}>{p.name}</button></span>)}. Điền "Từ ngày / Đến ngày" trong thông tin kế hoạch để hiện trên lịch.</p>}
  </section>
}
