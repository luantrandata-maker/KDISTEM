// Làm thử đề (migration 121), giống "Chơi thử" ở Kho hoạt động: người soạn rút một đề theo đúng cấu hình đang soạn,
// làm thử, xem điểm, đáp án, lời giải và cơ cấu đề để điều chỉnh. Không ghi lượt làm, không tính điểm.
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { LEVEL, letter, type Level } from '../pages/elearning/common'

export type TrySpec =
  | { kind: 'sample'; qids: string[]; count?: number | null }
  | { kind: 'pick'; subject?: string | null; grade?: number | null; matrix?: { topic: string; level: string; count: number }[] | null; qids?: string[]; shuffle?: boolean }
  | { kind: 'levels'; subject?: string | null; grade?: number | null; count: number; levels: Record<string, number>; topics?: string[] }

type Q = { id: string; stem: string; options: string[]; kind: string; answer: number[]; explain: string | null; topic: string | null; level: Level }

const KIND: Record<string, string> = { single: 'Một đáp án', multi: 'Nhiều đáp án', truefalse: 'Đúng / sai' }
const LEVELS: Level[] = ['nhan_biet', 'thong_hieu', 'van_dung', 'van_dung_cao']
const mmss = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const same = (a: number[] = [], b: number[] = []) => a.length === b.length && a.every(x => b.includes(x))

/** Số câu đề cần theo cấu hình (để báo khi ngân hàng không đủ câu) */
export function tryWant(s: TrySpec): number {
  if (s.kind === 'sample') return Math.min(s.count || s.qids.length, s.qids.length)
  if (s.kind === 'levels') return s.count
  return (s.matrix ?? []).reduce((a, r) => a + (Number(r.count) || 0), 0) + (s.qids?.length ?? 0)
}

/** Nút "Làm thử" mở cửa sổ làm thử */
export function TryButton({ orgId, spec, title, minutes, pass, disabled, label = 'Làm thử' }:
  { orgId?: string | null; spec: TrySpec; title: string; minutes?: number | null; pass?: number | null; disabled?: boolean; label?: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const empty = tryWant(spec) === 0
  // Không biết đơn vị của đề thì rút theo đơn vị của người đang soạn
  const go = async () => setOpen(orgId ?? ((await supabase.rpc('my_org_id')).data as string | null) ?? null)
  return <>
    <button type="button" disabled={disabled || empty} title={empty ? 'Đề chưa có câu hỏi' : 'Làm thử đề như người học, không lưu điểm'} onClick={go}>▶ {label}</button>
    {open && <ExamTryout orgId={open} spec={spec} title={title} minutes={minutes} pass={pass} onClose={() => setOpen(null)} />}
  </>
}

export function ExamTryout({ orgId, spec, title, minutes, pass, onClose }:
  { orgId: string; spec: TrySpec; title: string; minutes?: number | null; pass?: number | null; onClose: () => void }) {
  const [qs, setQs] = useState<Q[] | null>(null)
  const [err, setErr] = useState('')
  const [ans, setAns] = useState<Record<string, number[]>>({})
  const [done, setDone] = useState(false)
  const [t0, setT0] = useState(Date.now())
  const [now, setNow] = useState(Date.now())
  const [used, setUsed] = useState(0)
  const want = tryWant(spec)
  const box = useRef<HTMLDivElement>(null)

  async function draw() {
    setQs(null); setErr(''); setAns({}); setDone(false)
    const { data, error } = await supabase.rpc('exam_preview', { p_org: orgId, p_spec: spec })
    if (error) return setErr(/schema cache|does not exist/i.test(error.message) ? 'Hãy chạy migration 121 trên Supabase.' : error.message)
    setQs((data as Q[]) ?? []); setT0(Date.now()); setNow(Date.now())
  }
  useEffect(() => { draw() }, [])
  useEffect(() => { if (done) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [done])
  useEffect(() => { if (!done && minutes && qs?.length && now - t0 >= minutes * 60000) submit() }, [now])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])

  function submit() { setUsed(Date.now() - t0); setDone(true); box.current?.scrollTo({ top: 0 }) }
  const answered = qs?.filter(q => ans[q.id]?.length).length ?? 0
  const correct = qs?.filter(q => same(ans[q.id], q.answer)).length ?? 0
  const score = qs?.length ? Math.round(correct * 100 / qs.length) / 10 : 0

  // Cơ cấu đề: số câu theo mức độ, chủ đề, loại câu; tỉ lệ đúng theo mức độ sau khi nộp
  const mix = useMemo(() => {
    const by = <K extends string>(f: (q: Q) => K) => {
      const m = new Map<K, { n: number; ok: number }>()
      for (const q of qs ?? []) { const k = f(q), v = m.get(k) ?? { n: 0, ok: 0 }; v.n++; if (same(ans[q.id], q.answer)) v.ok++; m.set(k, v) }
      return m
    }
    return { level: by(q => q.level), topic: by(q => q.topic || 'Không ghi chủ đề'), kind: by(q => q.kind) }
  }, [qs, ans])
  const pct = (n: number) => qs?.length ? Math.round(n * 100 / qs.length) : 0
  const left = minutes ? minutes * 60000 - (now - t0) : null

  return <div className="modalbg" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={box} className="modal wide" role="dialog" aria-modal="true" aria-label={`Làm thử ${title}`}>
      <div className="modalhead"><div><h3>Làm thử: {title}</h3>
        <small>{qs ? `${qs.length} câu` : 'Đang rút đề…'}{minutes ? ` · ${minutes} phút` : ' · không giới hạn thời gian'}{pass != null ? ` · điểm đạt ${pass}/10` : ''} · không lưu điểm, không tính lượt</small></div>
        {!done && qs && <span className={'timer' + (left != null && left < 60000 ? ' hot' : '')} role="timer" aria-live="off">{left != null ? `Còn ${mmss(left)}` : mmss(now - t0)}</span>}
        <button type="button" className="x" onClick={onClose} aria-label="Đóng">✕</button></div>
      <div className="modalbody">
        {err && <p className="msg">{err}</p>}
        {qs && qs.length < want && <p className="warnline">Ngân hàng chỉ đủ {qs.length}/{want} câu theo cấu hình. Người làm sẽ nhận đề thiếu câu; thêm câu hỏi hoặc giảm số câu trong ma trận.</p>}
        {qs && !qs.length && !err && <p className="sub">Không rút được câu nào theo cấu hình hiện tại.</p>}

        {qs && qs.length > 0 && <section className="trymix" aria-label="Cơ cấu đề">
          <div><b>Mức độ</b>{LEVELS.filter(l => mix.level.get(l)).map(l => { const v = mix.level.get(l)!; return <span key={l}>{LEVEL[l]} <b>{v.n}</b> <small className="sub">({pct(v.n)}%{done ? ` · đúng ${v.ok}/${v.n}` : ''})</small></span> })}</div>
          <div><b>Chủ đề</b>{[...mix.topic].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => <span key={k}>{k} <b>{v.n}</b>{done && <small className="sub"> · đúng {v.ok}/{v.n}</small>}</span>)}</div>
          <div><b>Loại câu</b>{[...mix.kind].map(([k, v]) => <span key={k}>{KIND[k] ?? k} <b>{v.n}</b></span>)}</div>
        </section>}

        {done && qs && <div className="tryres">
          <span className="bigscore">{score}<small>/10</small></span>
          <div><b>Đúng {correct}/{qs.length} câu</b>{pass != null && <> · {score >= pass ? <span className="pill active">Đạt</span> : <span className="pill inactive">Chưa đạt</span>}</>}<br />
            <small className="sub">Thời gian làm: {mmss(used)}{minutes ? ` / ${minutes} phút` : ''}. {answered < qs.length ? `Bỏ trống ${qs.length - answered} câu.` : ''}</small></div>
        </div>}

        {qs && qs.length > 0 && <ol className="paper">{qs.map(q => {
          const mine = ans[q.id] ?? [], ok = same(mine, q.answer)
          return <li key={q.id} className={done ? (ok ? 'qok' : 'qbad') : ''}>
            <p className="stem">{done && <span className={'pill ' + (ok ? 'active' : 'inactive')}>{ok ? 'Đúng' : 'Chưa đúng'}</span>} {q.stem}{q.kind === 'multi' && <small> (chọn tất cả đáp án đúng)</small>}</p>
            <small className="sub">{LEVEL[q.level] ?? q.level}{q.topic ? ` · ${q.topic}` : ''}</small>
            <div className="choices">{q.options.map((o, k) => {
              const on = mine.includes(k)
              return <label key={k} className={(on ? 'on ' : '') + (done && q.answer.includes(k) ? 'right' : '')}>
                <input type={q.kind === 'multi' ? 'checkbox' : 'radio'} name={'try' + q.id} checked={on} disabled={done}
                  onChange={() => setAns(a => ({ ...a, [q.id]: q.kind === 'multi' ? (on ? (a[q.id] ?? []).filter(x => x !== k) : [...(a[q.id] ?? []), k]) : [k] }))} />
                <b>{letter(k)}</b><span>{o}</span></label>
            })}</div>
            {done && <p className="sub">Đáp án: <b>{q.answer.map(letter).join(', ')}</b>{q.explain ? ` · ${q.explain}` : ''}</p>}
          </li>
        })}</ol>}
      </div>
      <div className="modalfoot">
        {qs && !done && <small className="sub" style={{ marginRight: 'auto' }}>Đã trả lời {answered}/{qs.length}</small>}
        {qs && done && <small style={{ marginRight: 'auto' }}><b>{score}/10</b> · đúng {correct}/{qs.length} câu</small>}
        <button type="button" onClick={draw}>Rút đề khác</button>
        {done ? <button type="button" onClick={() => { setAns({}); setDone(false); setT0(Date.now()); setNow(Date.now()) }}>Làm lại đề này</button>
          : <button type="button" className="primary" disabled={!qs?.length} onClick={submit}>Nộp thử</button>}
        <button type="button" onClick={onClose}>Đóng</button>
      </div>
    </div>
  </div>
}
