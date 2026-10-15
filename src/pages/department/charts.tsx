// Thành phần biểu đồ nhẹ (HTML/CSS), theo quy tắc: một màu cho một chuỗi, nhãn trực tiếp chọn lọc,
// lưới mờ, tooltip khi rê chuột, trạng thái luôn có biểu tượng + chữ.
import { useState } from 'react'
import { grade } from './data'

export const SERIES = '#2a78d6'
// Thang tuần tự một sắc độ (xanh) cho bản đồ nhiệt: nhạt = thấp, đậm = cao
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95']
export const rampColor = (t: number) => RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(t * (RAMP.length - 1))))]
export const rampInk = (t: number) => (t > 0.55 ? '#fff' : '#0b2a52')

export function Tiles({ items }: { items: { label: string; value: string | number; sub?: string; tone?: string }[] }) {
  return (
    <div className="ktiles">
      {items.map(i => (
        <div className={'ktile ' + (i.tone ?? '')} key={i.label}>
          <span>{i.label}</span><b>{i.value}</b>{i.sub && <small>{i.sub}</small>}
        </div>
      ))}
    </div>
  )
}

export function GradePill({ kpi }: { kpi: number }) {
  const g = grade(kpi)
  return <span className={'gpill ' + g.tone}><i aria-hidden="true">{g.icon}</i>{g.label}</span>
}

// Cột dọc một chuỗi; tooltip khi rê; nhãn giá trị chỉ ở cột cao nhất và thấp nhất
export function Columns({ data, unit = '', height = 220, max, fmt = (v: number) => String(v) }: {
  data: { label: string; value: number; tip?: string }[]; unit?: string; height?: number; max?: number; fmt?: (v: number) => string
}) {
  const [hover, setHover] = useState<number | null>(null)
  // Trục tròn số: 4 vạch đều nhau với bước 1/2/2.5/5 × 10^n
  const raw = max ?? Math.max(1, ...data.map(d => d.value))
  const mag = Math.pow(10, Math.floor(Math.log10(raw / 4)))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(st => st * 4 >= raw) ?? raw / 4
  const top = step * 4
  const hi = data.reduce((b, d, i) => (d.value > data[b].value ? i : b), 0)
  const lo = data.reduce((b, d, i) => (d.value < data[b].value ? i : b), 0)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => t * top)
  return (
    <div className="colchart" style={{ height }} role="img" aria-label={`Biểu đồ cột: ${data.map(d => `${d.label} ${fmt(d.value)}${unit}`).join(', ')}`}>
      <div className="grid">{ticks.map(t => <div key={t} style={{ bottom: `${(t / top) * 100}%` }}><span>{fmt(Math.round(t * 10) / 10)}</span></div>)}</div>
      <div className="bars2">
        {data.map((d, i) => (
          <div key={d.label} className="col2" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
            <div className="bar2" style={{ height: `${(d.value / top) * 100}%`, background: SERIES, opacity: hover === null || hover === i ? 1 : 0.55 }}>
              {(i === hi || i === lo) && data.length > 2 && <em>{fmt(d.value)}</em>}
            </div>
            <span className="xl" title={d.label}>{d.label}</span>
            {hover === i && <div className="tip"><b>{d.label}</b><br />{d.tip ?? `${fmt(d.value)}${unit}`}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// Thanh ngang có nhãn — dùng cho xếp hạng, tỉ lệ
export function HBars({ data, unit = '%', max = 100 }: { data: { label: string; value: number; sub?: string }[]; unit?: string; max?: number }) {
  return (
    <div className="hbars">
      {data.map(d => (
        <div className="hbar" key={d.label} title={`${d.label}: ${d.value}${unit}`}>
          <span className="hl">{d.label}{d.sub && <small> · {d.sub}</small>}</span>
          <div className="track"><div className="fill" style={{ width: `${Math.min(100, (d.value / max) * 100)}%`, background: SERIES }} /></div>
          <b>{d.value}{unit}</b>
        </div>
      ))}
    </div>
  )
}

// Lớp phủ bảng xem dữ liệu cho biểu đồ (truy cập không dùng màu)
export function DataTable({ cols, rows }: { cols: string[]; rows: (string | number)[][] }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button className="linkbtn" onClick={() => setOpen(!open)}>{open ? 'Ẩn bảng số liệu' : 'Xem bảng số liệu'}</button>
      {open && <div className="wrap"><table><thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div>}
    </div>
  )
}
