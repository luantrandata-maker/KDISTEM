// Mô phỏng 2D và giáo cụ ảo dùng trong bài giảng tương tác, kho hoạt động và học liệu.
// Tất cả chạy trên trình duyệt (SVG + React), không cần tải thêm thư viện.
import { useEffect, useRef, useState } from 'react'

export type SimModel = 'circuit_series' | 'circuit_parallel' | 'pendulum' | 'lever' | 'ruler' | 'scale' | 'thermometer'
export const SIMS: Record<SimModel, { label: string; group: 'sim' | 'tool'; desc: string; subject: string }> = {
  circuit_series: { label: 'Mạch điện nối tiếp', group: 'sim', desc: 'Kéo thanh trượt hiệu điện thế và điện trở, bấm ngắt công tắc, tháo một bóng để thấy cả dãy cùng tắt.', subject: 'Vật lý · Công nghệ' },
  circuit_parallel: { label: 'Mạch điện song song', group: 'sim', desc: 'So sánh độ sáng và dòng điện; tháo một bóng thì bóng còn lại vẫn sáng.', subject: 'Vật lý · Công nghệ' },
  pendulum: { label: 'Con lắc đơn', group: 'sim', desc: 'Đổi chiều dài dây, bấm giờ 10 dao động để tìm chu kì.', subject: 'Vật lý · KHTN' },
  lever: { label: 'Đòn bẩy cân bằng', group: 'sim', desc: 'Đặt vật nặng hai bên điểm tựa sao cho đòn bẩy nằm ngang.', subject: 'Vật lý · Toán' },
  ruler: { label: 'Thước đo 20 cm', group: 'tool', desc: 'Kéo mép phải của thanh đo đến đúng số đo yêu cầu.', subject: 'KHTN' },
  scale: { label: 'Cân điện tử (TARE)', group: 'tool', desc: 'Đặt quả cân cho đủ khối lượng; bấm TARE để trừ bì.', subject: 'KHTN' },
  thermometer: { label: 'Nhiệt kế', group: 'tool', desc: 'Kéo nhiệt độ, đọc °C, đổi sang °F và K.', subject: 'KHTN' },
}
export const SIM_MODELS = Object.keys(SIMS) as SimModel[]
export const SIM_DEFAULTS: Record<SimModel, Record<string, number>> = {
  circuit_series: { V: 7.3, R: 5.8 }, circuit_parallel: { V: 6, R: 5.8 }, pendulum: { L: 0.5 }, lever: { left: 3, right: 2 },
  ruler: { target: 12.5 }, scale: { target: 235 }, thermometer: { target: 37 },
}

const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toLocaleString('vi-VN', { maximumFractionDigits: d }) : '—')
function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="simslider"><span>{label} <b>{fmt(value, 2)} {unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} aria-label={label} />
    </label>
  )
}
const Stat = ({ k, v }: { k: string; v: string }) => <div className="simstat"><small>{k}</small><b>{v}</b></div>
const Target = ({ ok, text }: { ok: boolean; text: string }) => <span className={'simtarget' + (ok ? ' ok' : '')}>{ok ? '✓ ' : '◎ '}{text}</span>

export function SimView({ model, params, compact }: { model: SimModel; params?: Record<string, number>; compact?: boolean }) {
  const p = { ...SIM_DEFAULTS[model], ...(params ?? {}) }
  const box = 'simbox' + (compact ? ' compact' : '')
  switch (model) {
    case 'circuit_series': return <div className={box}><Circuit mode="series" V0={p.V} R0={p.R} /></div>
    case 'circuit_parallel': return <div className={box}><Circuit mode="parallel" V0={p.V} R0={p.R} /></div>
    case 'pendulum': return <div className={box}><Pendulum L0={p.L} /></div>
    case 'lever': return <div className={box}><Lever /></div>
    case 'ruler': return <div className={box}><Ruler target={p.target} /></div>
    case 'scale': return <div className={box}><Scale target={p.target} /></div>
    case 'thermometer': return <div className={box}><Thermo target={p.target} /></div>
    default: return <div className={box}>Mô phỏng chưa hỗ trợ.</div>
  }
}

// ===== Mạch điện 2 bóng: nối tiếp / song song =====
function Circuit({ mode, V0, R0 }: { mode: 'series' | 'parallel'; V0: number; R0: number }) {
  const [V, setV] = useState(V0); const [R, setR] = useState(R0)
  const [on, setOn] = useState(true); const [removed, setRemoved] = useState(false)
  const n = removed ? 1 : 2
  let I = 0, Ib = [0, 0]
  if (on) {
    if (mode === 'series') { I = removed ? 0 : V / (2 * R); Ib = [I, removed ? 0 : I] }
    else { Ib = [V / R, removed ? 0 : V / R]; I = Ib[0] + Ib[1] }
  }
  const P = Ib.map(i => i * i * R)
  const ref = 36 / 5.8                       // công suất bóng ở 6 V song song
  const glow = (pw: number) => Math.min(1, pw / ref)
  const bulb = (x: number, y: number, i: number) => {
    const g = glow(P[i]); const gone = i === 1 && removed
    return (
      <g key={i}>
        {g > 0.02 && <circle cx={x} cy={y} r={14 + 22 * g} fill="#facc15" opacity={0.15 + 0.45 * g} />}
        <circle cx={x} cy={y} r={13} fill={gone ? '#e5e7eb' : g > 0.02 ? '#fde047' : '#f8fafc'} stroke={gone ? '#94a3b8' : '#a16207'} strokeWidth={2} strokeDasharray={gone ? '4 3' : undefined} />
        {!gone && <path d={`M${x - 7} ${y - 7} L${x + 7} ${y + 7} M${x + 7} ${y - 7} L${x - 7} ${y + 7}`} stroke="#a16207" strokeWidth={1.6} />}
        <text x={x} y={y - 22} textAnchor="middle" className="simlbl">{gone ? 'đã tháo' : `${fmt(P[i])} W`}</text>
      </g>
    )
  }
  const wire = on ? '#334155' : '#94a3b8'
  return (
    <>
      <div className="simhead"><b>I qua nguồn = {fmt(I)} A</b><span className="simtag">{mode === 'series' ? 'Nối tiếp' : 'Song song'} · {n} bóng</span></div>
      <svg viewBox="0 0 320 190" className="simsvg" role="img" aria-label={`Sơ đồ mạch ${mode === 'series' ? 'nối tiếp' : 'song song'}`}>
        {mode === 'series' ? (
          <>
            <path d="M40 40 H280 V150 H200 M150 150 H40 V40" fill="none" stroke={wire} strokeWidth={3} />
            {bulb(120, 40, 0)}{bulb(200, 40, 1)}
          </>
        ) : (
          <>
            <path d="M40 30 H280 V150 H200 M150 150 H40 V30 M110 30 V90 M210 30 V90 M110 90 H210" fill="none" stroke={wire} strokeWidth={3} />
            {bulb(110, 60, 0)}{bulb(210, 60, 1)}
          </>
        )}
        <g><line x1={60} y1={140} x2={60} y2={160} stroke="#111" strokeWidth={4} /><line x1={70} y1={145} x2={70} y2={155} stroke="#111" strokeWidth={4} />
          <text x={65} y={180} textAnchor="middle" className="simlbl">{fmt(V, 1)} V</text></g>
        <g><circle cx={150} cy={150} r={4} fill="#334155" /><circle cx={200} cy={150} r={4} fill="#334155" />
          <line x1={150} y1={150} x2={on ? 200 : 192} y2={on ? 150 : 128} stroke="#334155" strokeWidth={3} />
          <text x={175} y={178} textAnchor="middle" className="simlbl">Công tắc: {on ? 'ĐÓNG' : 'MỞ'}</text></g>
      </svg>
      <div className="simstats">
        <Stat k="Hiệu điện thế" v={`${fmt(V, 1)} V`} /><Stat k="Điện trở / bóng" v={`${fmt(R, 1)} Ω`} />
        <Stat k="Dòng qua nguồn" v={`${fmt(I)} A`} /><Stat k="Công suất / bóng" v={`${fmt(P[0])} W`} />
      </div>
      <div className="simctl">
        <Slider label="Hiệu điện thế nguồn" value={V} min={1.5} max={12} step={0.1} unit="V" onChange={setV} />
        <Slider label="Điện trở mỗi bóng" value={R} min={2} max={20} step={0.1} unit="Ω" onChange={setR} />
      </div>
      <div className="actions">
        <button type="button" className={on ? 'primary' : ''} onClick={() => setOn(!on)}>{on ? 'Ngắt công tắc' : 'Đóng công tắc'}</button>
        <button type="button" onClick={() => setRemoved(!removed)}>{removed ? 'Lắp lại bóng 2' : 'Tháo bóng 2'}</button>
        <button type="button" onClick={() => { setV(V0); setR(R0); setOn(true); setRemoved(false) }}>Đặt lại</button>
      </div>
    </>
  )
}

// ===== Con lắc đơn =====
function Pendulum({ L0 }: { L0: number }) {
  const [L, setL] = useState(L0); const [run, setRun] = useState(false)
  const [t, setT] = useState(0); const [watch, setWatch] = useState<number | null>(null); const [laps, setLaps] = useState<number | null>(null)
  const start = useRef(0); const raf = useRef(0)
  const T = 2 * Math.PI * Math.sqrt(L / 9.8)
  useEffect(() => {
    if (!run) return
    start.current = performance.now() - t * 1000
    const tick = (now: number) => { setT((now - start.current) / 1000); raf.current = requestAnimationFrame(tick) }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [run])
  const th = run || t > 0 ? 0.35 * Math.cos((2 * Math.PI * t) / T) : 0.35
  const len = 40 + 110 * (L / 2)
  const x = 160 + len * Math.sin(th), y = 20 + len * Math.cos(th)
  const count = Math.floor(t / T)
  return (
    <>
      <div className="simhead"><b>Chu kì T ≈ {fmt(T)} s</b><span className="simtag">Dao động đã đếm: {count}</span></div>
      <svg viewBox="0 0 320 180" className="simsvg" role="img" aria-label="Con lắc đơn">
        <line x1={110} y1={20} x2={210} y2={20} stroke="#334155" strokeWidth={4} />
        <line x1={160} y1={20} x2={x} y2={y} stroke="#475569" strokeWidth={2} />
        <circle cx={x} cy={y} r={11} fill="#2e95f2" stroke="#1c63bb" strokeWidth={2} />
        <text x={300} y={170} textAnchor="end" className="simlbl">t = {fmt(t, 1)} s</text>
      </svg>
      <div className="simstats">
        <Stat k="Chiều dài dây" v={`${fmt(L)} m`} /><Stat k="Chu kì lí thuyết" v={`${fmt(T)} s`} />
        <Stat k="Bấm giờ" v={watch == null ? '—' : `${fmt(t - watch, 1)} s`} /><Stat k="10 dao động" v={laps == null ? '—' : `${fmt(laps, 2)} s`} />
      </div>
      <div className="simctl"><Slider label="Chiều dài dây" value={L} min={0.1} max={2} step={0.05} unit="m" onChange={v => { setL(v); setT(0); setWatch(null); setLaps(null) }} /></div>
      <div className="actions">
        <button type="button" className="primary" onClick={() => setRun(!run)}>{run ? 'Dừng' : 'Thả con lắc'}</button>
        <button type="button" disabled={!run} onClick={() => { if (watch == null) setWatch(t); else { setLaps(t - watch); setWatch(null) } }}>{watch == null ? 'Bấm giờ' : 'Dừng đồng hồ'}</button>
        <button type="button" onClick={() => { setRun(false); setT(0); setWatch(null); setLaps(null) }}>Đặt lại</button>
      </div>
    </>
  )
}

// ===== Đòn bẩy =====
function Lever() {
  const [mL, setML] = useState(3); const [dL, setDL] = useState(2); const [mR, setMR] = useState(2); const [dR, setDR] = useState(4)
  const diff = mR * dR - mL * dL
  const ang = Math.max(-14, Math.min(14, diff * 2))
  const ok = diff === 0
  const block = (d: number, m: number, side: -1 | 1) => (
    <g key={side}><rect x={160 + side * d * 25 - 12} y={84 - 10 - 6 * m} width={24} height={10 + 6 * m} rx={3} fill={side < 0 ? '#f2a53f' : '#2e95f2'} />
      <text x={160 + side * d * 25} y={70 - 6 * m} textAnchor="middle" className="simlbl">{m} kg</text></g>
  )
  return (
    <>
      <div className="simhead"><b>{ok ? 'Đòn bẩy cân bằng' : diff > 0 ? 'Lệch về bên phải' : 'Lệch về bên trái'}</b><Target ok={ok} text="m₁·d₁ = m₂·d₂" /></div>
      <svg viewBox="0 0 320 150" className="simsvg" role="img" aria-label="Đòn bẩy">
        <g transform={`rotate(${ang} 160 84)`}>
          <rect x={20} y={84} width={280} height={8} rx={3} fill="#64748b" />
          {[1, 2, 3, 4, 5].map(i => <g key={i}><line x1={160 - i * 25} y1={92} x2={160 - i * 25} y2={98} stroke="#334155" /><line x1={160 + i * 25} y1={92} x2={160 + i * 25} y2={98} stroke="#334155" /></g>)}
          {block(dL, mL, -1)}{block(dR, mR, 1)}
        </g>
        <polygon points="160,92 145,130 175,130" fill="#334155" />
      </svg>
      <div className="simstats"><Stat k="Mô men trái" v={`${mL * dL}`} /><Stat k="Mô men phải" v={`${mR * dR}`} /></div>
      <div className="simctl">
        <Slider label="Khối lượng trái" value={mL} min={1} max={5} step={1} unit="kg" onChange={setML} />
        <Slider label="Khoảng cách trái" value={dL} min={1} max={5} step={1} unit="ô" onChange={setDL} />
        <Slider label="Khối lượng phải" value={mR} min={1} max={5} step={1} unit="kg" onChange={setMR} />
        <Slider label="Khoảng cách phải" value={dR} min={1} max={5} step={1} unit="ô" onChange={setDR} />
      </div>
    </>
  )
}

// ===== Thước đo =====
function Ruler({ target }: { target: number }) {
  const [v, setV] = useState(7.5)
  const ok = Math.abs(v - target) <= 0.3
  return (
    <>
      <div className="simhead"><span className="simlcd">{fmt(v, 1)} cm</span><span className="sub">= {fmt(v * 10, 0)} mm = {fmt(v / 100, 3)} m</span><Target ok={ok} text={`Mục tiêu ${fmt(target, 1)} cm (±0,3)`} /></div>
      <svg viewBox="0 0 320 70" className="simsvg" role="img" aria-label="Thước 20 cm">
        <rect x={10} y={8} width={(300 * v) / 20} height={22} rx={4} fill="#22d3ee" opacity={0.8} />
        <rect x={10} y={32} width={300} height={30} fill="#fde68a" stroke="#a16207" />
        {Array.from({ length: 201 }, (_, i) => <line key={i} x1={10 + i * 1.5} y1={32} x2={10 + i * 1.5} y2={32 + (i % 10 === 0 ? 14 : i % 5 === 0 ? 10 : 6)} stroke="#713f12" strokeWidth={0.6} />)}
        {Array.from({ length: 21 }, (_, i) => <text key={i} x={10 + i * 15} y={58} textAnchor="middle" className="simlbl" style={{ fontSize: 7 }}>{i}</text>)}
      </svg>
      <div className="simctl"><Slider label="Kéo mép thanh đo" value={v} min={0} max={20} step={0.1} unit="cm" onChange={setV} /></div>
    </>
  )
}

// ===== Cân điện tử có TARE =====
function Scale({ target }: { target: number }) {
  const [items, setItems] = useState<number[]>([]); const [cup, setCup] = useState(false); const [tare, setTare] = useState(0)
  const total = items.reduce((a, b) => a + b, 0) + (cup ? 50 : 0)
  const shown = total - tare
  const ok = shown === target
  return (
    <>
      <div className="simhead"><span className="simlcd">{fmt(shown, 1)} g</span>{tare > 0 && <span className="sub">đã trừ bì {tare} g</span>}<Target ok={ok} text={`Mục tiêu ${target} g`} /></div>
      <div className="simplate">{cup && <span className="simcup">Cốc 50 g</span>}{items.map((g, i) => <button type="button" key={i} className="simweight" onClick={() => setItems(items.filter((_, j) => j !== i))} title="Bấm để lấy ra">{g} g</button>)}
        {!cup && !items.length && <small className="sub">Đĩa cân trống — bấm quả cân bên dưới để đặt lên</small>}</div>
      <div className="actions">
        {[1, 2, 5, 10, 20, 50, 100, 200, 500].map(g => <button type="button" key={g} onClick={() => setItems([...items, g])}>+{g} g</button>)}
      </div>
      <div className="actions">
        <button type="button" onClick={() => setCup(!cup)}>{cup ? 'Lấy cốc ra' : 'Đặt cốc lên cân'}</button>
        <button type="button" className="primary" onClick={() => setTare(total)}>TARE (về 0)</button>
        <button type="button" onClick={() => { setItems([]); setCup(false); setTare(0) }}>Xoá đĩa</button>
      </div>
    </>
  )
}

// ===== Nhiệt kế =====
function Thermo({ target }: { target: number }) {
  const [c, setC] = useState(25)
  const ok = Math.abs(c - target) < 0.5
  const h = ((c + 10) / 110) * 120
  return (
    <>
      <div className="simhead"><span className="simlcd">{fmt(c, 1)} °C</span><span className="sub">= {fmt(c * 1.8 + 32, 1)} °F = {fmt(c + 273.15, 1)} K</span><Target ok={ok} text={`Mục tiêu ${target} °C`} /></div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <svg viewBox="0 0 60 160" style={{ width: 54, flex: 'none' }} role="img" aria-label="Nhiệt kế">
          <rect x={24} y={8} width={12} height={130} rx={6} fill="#f1f5f9" stroke="#94a3b8" />
          <rect x={26} y={138 - h} width={8} height={h} fill="#ef4444" />
          <circle cx={30} cy={145} r={11} fill="#ef4444" />
        </svg>
        <div style={{ flex: 1 }}>
          <Slider label="Nhiệt độ" value={c} min={-10} max={100} step={0.5} unit="°C" onChange={setC} />
          <div className="actions">{[0, 25, 37, 60, 100].map(x => <button type="button" key={x} onClick={() => setC(x)}>{x} °C</button>)}</div>
        </div>
      </div>
    </>
  )
}
