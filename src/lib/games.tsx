// Trò chơi lớp học (iGame): đường đua tri thức, vòng quay may mắn, chia đội, đồng hồ thử thách.
// Dùng ở Kho hoạt động (chơi thử), khối "Game hoá" trong bài giảng tương tác và khi trình chiếu.
import { useEffect, useRef, useState } from 'react'

export type RaceItem = { q: string; options: string[]; answer: number }
const shuffle = <T,>(a: T[]) => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]] } return x }

// ===== Đường đua tri thức: em đua với 2 đội máy, trả lời đúng thì xe tiến =====
export function RaceGame({ items, seconds = 20, title }: { items: RaceItem[]; seconds?: number; title?: string }) {
  const teams = ['Đội của em', 'Đội Xanh', 'Đội Cam']
  const [stage, setStage] = useState<'ready' | 'play' | 'done'>('ready')
  const [i, setI] = useState(0); const [pos, setPos] = useState([0, 0, 0]); const [pick, setPick] = useState<number | null>(null)
  const [left, setLeft] = useState(seconds); const [streak, setStreak] = useState(0)
  const timer = useRef<number>(0)
  const total = items.length
  useEffect(() => {
    if (stage !== 'play' || pick !== null) return
    setLeft(seconds)
    timer.current = window.setInterval(() => setLeft(l => { if (l <= 1) { window.clearInterval(timer.current); answer(-1); return 0 } return l - 1 }), 1000)
    return () => window.clearInterval(timer.current)
  }, [stage, i, pick === null])
  function answer(j: number) {
    if (pick !== null) return
    window.clearInterval(timer.current)
    setPick(j)
    const ok = j === items[i]?.answer
    setStreak(s => (ok ? s + 1 : 0))
    setPos(p => [p[0] + (ok ? 1 : 0), p[1] + (Math.random() < 0.6 ? 1 : 0), p[2] + (Math.random() < 0.5 ? 1 : 0)])
  }
  function next() { if (i + 1 >= total) setStage('done'); else { setI(i + 1); setPick(null) } }
  function reset() { setStage('ready'); setI(0); setPos([0, 0, 0]); setPick(null); setStreak(0) }
  if (!total) return <p className="sub">Chưa có câu hỏi cho đường đua.</p>
  const rank = teams.map((t, k) => ({ t, k, v: pos[k] })).sort((a, b) => b.v - a.v)
  const it = items[i]
  return (
    <div className="game race">
      {title && <div className="gamehead"><small>GAME HOÁ LỚP HỌC</small><b>{title}</b></div>}
      <div className="gamestats">
        <span><small>Câu hỏi</small><b>{Math.min(i + 1, total)}/{total}</b></span><span><small>Điểm</small><b>{pos[0]}</b></span>
        <span><small>Chuỗi đúng</small><b>{streak || '—'}</b></span><span><small>Về đích</small><b>{pos[0]}/{total}</b></span>
        {stage === 'play' && pick === null && <span className="live">● {left}s</span>}
      </div>
      <div className="racetrack">
        {teams.map((t, k) => (
          <div className="lane" key={t}><span className={'lanename t' + k}>{t}</span>
            <div className="road"><span className={'car t' + k} style={{ left: `calc(${(100 * Math.min(pos[k], total)) / total}% - ${(28 * Math.min(pos[k], total)) / total}px)` }} aria-hidden="true">🏎</span></div>
            <b className="lanepts">{pos[k]}</b></div>
        ))}
      </div>
      {stage === 'ready' && (
        <div className="gamecta"><div><b>Sẵn sàng vào đường đua?</b><br /><small>{total} câu · mỗi câu {seconds} giây · trả lời đúng thì xe tiến một chặng. Về đích trước hai đội bạn để thắng!</small></div>
          <button type="button" className="primary" onClick={() => setStage('play')}>▶ Bắt đầu đua</button></div>
      )}
      {stage === 'play' && it && (
        <div className="gameq">
          <div className="timebar"><i style={{ width: `${(100 * left) / seconds}%` }} /></div>
          <b>{it.q}</b>
          <div className="actopts">
            {it.options.map((o, j) => (
              <button type="button" key={j} disabled={pick !== null}
                className={'actopt' + (pick !== null && j === it.answer ? ' right' : '') + (pick === j && j !== it.answer ? ' wrong' : '') + (pick === j ? ' on' : '')}
                onClick={() => answer(j)}><b>{String.fromCharCode(65 + j)}</b> {o}</button>
            ))}
          </div>
          {pick !== null && (
            <div className="bar" style={{ marginTop: 8 }}>
              <span className={pick === it.answer ? 'okline' : 'warnline'}>{pick === it.answer ? 'Chính xác! Xe của em tiến lên.' : pick < 0 ? `Hết giờ — đáp án là ${String.fromCharCode(65 + it.answer)}.` : `Chưa đúng — đáp án là ${String.fromCharCode(65 + it.answer)}.`}</span>
              <button type="button" className="primary" onClick={next}>{i + 1 >= total ? 'Xem kết quả' : 'Câu tiếp ›'}</button>
            </div>
          )}
        </div>
      )}
      {stage === 'done' && (
        <div className="gameq">
          <b>Bảng xếp hạng</b>
          <ol className="ranklist">{rank.map((r, k) => <li key={r.t} className={r.k === 0 ? 'me' : ''}>{['🥇', '🥈', '🥉'][k]} {r.t} — {r.v} chặng</li>)}</ol>
          <p>{rank[0].k === 0 ? 'Đội của em về nhất!' : 'Cố gắng hơn ở lượt sau nhé!'} Em trả lời đúng {pos[0]}/{total} câu.</p>
          <button type="button" onClick={reset}>↺ Chơi lại</button>
        </div>
      )}
    </div>
  )
}

// ===== Vòng quay may mắn: chọn ngẫu nhiên học sinh trả lời =====
const WHEEL_COLORS = ['#2e95f2', '#f2a53f', '#7c3aed', '#16a34a', '#dc2626', '#0f7490', '#c026d3', '#64748b']
export function WheelGame({ names, questions, title }: { names: string[]; questions?: string[]; title?: string }) {
  const list = names.filter(Boolean).length ? names.filter(Boolean) : ['Nhóm 1', 'Nhóm 2', 'Nhóm 3', 'Nhóm 4']
  const [rot, setRot] = useState(0); const [spinning, setSpinning] = useState(false); const [won, setWon] = useState<number | null>(null); const [q, setQ] = useState<string | null>(null)
  const seg = 360 / list.length
  function spin() {
    if (spinning) return
    const k = Math.floor(Math.random() * list.length)
    const target = 360 * 5 + (360 - (k * seg + seg / 2))
    setSpinning(true); setWon(null); setQ(null)
    setRot(r => r - (r % 360) + target)
    window.setTimeout(() => { setSpinning(false); setWon(k); const qs = (questions ?? []).filter(Boolean); if (qs.length) setQ(qs[Math.floor(Math.random() * qs.length)]) }, 3200)
  }
  const arc = (k: number) => {
    const a0 = ((k * seg - 90) * Math.PI) / 180, a1 = (((k + 1) * seg - 90) * Math.PI) / 180
    return `M100 100 L${100 + 95 * Math.cos(a0)} ${100 + 95 * Math.sin(a0)} A95 95 0 ${seg > 180 ? 1 : 0} 1 ${100 + 95 * Math.cos(a1)} ${100 + 95 * Math.sin(a1)} Z`
  }
  return (
    <div className="game wheel">
      {title && <div className="gamehead"><small>GAME HOÁ LỚP HỌC</small><b>{title}</b></div>}
      <div className="wheelwrap">
        <div style={{ position: 'relative', width: 220, flex: 'none' }}>
          <svg viewBox="0 0 200 200" style={{ width: 220, transform: `rotate(${rot}deg)`, transition: spinning ? 'transform 3.1s cubic-bezier(.17,.67,.21,1)' : 'none' }} role="img" aria-label="Vòng quay">
            {list.map((n, k) => {
              const mid = ((k + 0.5) * seg - 90) * Math.PI / 180
              return <g key={k}><path d={arc(k)} fill={WHEEL_COLORS[k % WHEEL_COLORS.length]} stroke="#fff" strokeWidth={1.5} />
                <text x={100 + 60 * Math.cos(mid)} y={100 + 60 * Math.sin(mid)} textAnchor="middle" dominantBaseline="middle" fill="#fff" style={{ fontSize: list.length > 10 ? 7 : 9, fontWeight: 700 }}
                  transform={`rotate(${(k + 0.5) * seg} ${100 + 60 * Math.cos(mid)} ${100 + 60 * Math.sin(mid)})`}>{n.length > 14 ? n.slice(0, 13) + '…' : n}</text></g>
            })}
            <circle cx={100} cy={100} r={14} fill="#fff" stroke="#152e5d" strokeWidth={3} />
          </svg>
          <span className="wheelpin" aria-hidden="true">▼</span>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <p className="sub" style={{ marginTop: 0 }}>Quay để chọn ngẫu nhiên {list.length} bạn / nhóm lên bảng giải thích kết quả.</p>
          <button type="button" className="primary" onClick={spin} disabled={spinning}>{spinning ? 'Đang quay…' : '✦ Bắt đầu chơi'}</button>
          {won !== null && <div className="gamewin" role="status">🎉 <b>{list[won]}</b> trả lời!</div>}
          {q && <div className="gameq"><small className="sub">Câu hỏi</small><br /><b>{q}</b></div>}
        </div>
      </div>
    </div>
  )
}

// ===== Chia đội thi đấu =====
export function TeamsGame({ names, teams = 4, title }: { names: string[]; teams?: number; title?: string }) {
  const list = names.filter(Boolean)
  const [groups, setGroups] = useState<string[][]>([])
  const split = () => { const s = shuffle(list); const g: string[][] = Array.from({ length: teams }, () => []); s.forEach((n, k) => g[k % teams].push(n)); setGroups(g) }
  return (
    <div className="game">
      {title && <div className="gamehead"><small>GAME HOÁ LỚP HỌC</small><b>{title}</b></div>}
      <div className="bar"><small className="sub">{list.length} học sinh · {teams} đội</small><button type="button" className="primary" onClick={split} disabled={!list.length}>⇄ Chia đội ngẫu nhiên</button></div>
      {groups.length > 0 && <div className="teamgrid">{groups.map((g, k) => (
        <div key={k} className="teamcard" style={{ borderTopColor: WHEEL_COLORS[k % WHEEL_COLORS.length] }}><b>Đội {k + 1}</b><small>{g.length} bạn</small>{g.map(n => <span key={n}>{n}</span>)}</div>
      ))}</div>}
    </div>
  )
}

// ===== Đồng hồ thử thách: đếm ngược =====
export function TimerGame({ seconds = 300, title, task }: { seconds?: number; title?: string; task?: string }) {
  const [left, setLeft] = useState(seconds); const [run, setRun] = useState(false)
  useEffect(() => { setLeft(seconds) }, [seconds])
  useEffect(() => {
    if (!run) return
    const t = window.setInterval(() => setLeft(l => { if (l <= 1) { setRun(false); return 0 } return l - 1 }), 1000)
    return () => window.clearInterval(t)
  }, [run])
  const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(left % 60).padStart(2, '0')
  return (
    <div className="game">
      {title && <div className="gamehead"><small>GAME HOÁ LỚP HỌC</small><b>{title}</b></div>}
      {task && <p style={{ marginTop: 0 }}>{task}</p>}
      <div className={'bigclock' + (left === 0 ? ' end' : left <= 30 ? ' warn' : '')} role="timer" aria-live="off">{mm}:{ss}</div>
      <div className="timebar"><i style={{ width: `${(100 * left) / Math.max(1, seconds)}%` }} /></div>
      <div className="actions" style={{ justifyContent: 'center' }}>
        <button type="button" className="primary" onClick={() => setRun(!run)} disabled={left === 0}>{run ? 'Tạm dừng' : 'Bắt đầu'}</button>
        <button type="button" onClick={() => { setRun(false); setLeft(seconds) }}>Đặt lại</button>
      </div>
      {left === 0 && <p className="okline" style={{ textAlign: 'center' }}>Hết giờ! Các đội dừng bút.</p>}
    </div>
  )
}
