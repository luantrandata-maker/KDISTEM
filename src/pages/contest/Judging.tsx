import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Chấm thi (migration 051): giám khảo thấy các bài được phân công; ẩn danh nếu cuộc thi chọn chấm ẩn danh.
type A = { assignment_id: string; competition_id: string; competition: string; round_name: string; anonymous: boolean; criteria: { key: string; label: string; max: number }[]
  entry_code: string; field: string | null; title: string; school: string | null; members: string | null; abstract: string | null; docs: Record<string, string>; doc_labels: { key: string; label: string }[]; links: { label: string; url: string }[]
  scores: Record<string, number>; total: number | null; comment: string | null; submitted_at: string | null; open: boolean }

export function JudgingPage() {
  const [list, setList] = useState<A[] | null>(null)
  const [cur, setCur] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ scores: Record<string, string>; comment: string }>({ scores: {}, comment: '' })
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  async function load() {
    const { data, error } = await supabase.rpc('my_judging')
    if (error) setMsg([/schema cache|does not exist/i.test(error.message) ? 'Hãy chạy migration 051 trên Supabase.' : error.message, true])
    setList((data as A[]) ?? [])
  }
  useEffect(() => { load() }, [])
  const a = list?.find(x => x.assignment_id === cur)
  useEffect(() => { if (a) setDraft({ scores: Object.fromEntries(Object.entries(a.scores ?? {}).map(([k, v]) => [k, String(v)])), comment: a.comment ?? '' }) }, [cur])
  if (!list) return <p className="sub">Đang tải…</p>
  async function save(submit: boolean) {
    if (!a) return
    const scores = Object.fromEntries(Object.entries(draft.scores).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v.replace(',', '.'))]))
    const { data, error } = await supabase.rpc('judge_score', { p_assignment: a.assignment_id, p_scores: scores, p_comment: draft.comment, p_submit: submit })
    if (error) return setMsg([error.message, true])
    setMsg([submit ? `Đã nộp điểm: ${data} điểm.` : 'Đã lưu nháp.', false]); await load()
    if (submit) { const next = list!.find(x => x.open && !x.submitted_at && x.assignment_id !== a.assignment_id); setCur(next?.assignment_id ?? null) }
  }
  const total = a ? a.criteria.reduce((s, c) => s + (Number((draft.scores[c.key] ?? '').replace(',', '.')) || 0), 0) : 0
  const comps = [...new Set(list.map(x => x.competition))]
  return (
    <>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {!list.length && <p className="sub">Bạn chưa được phân công chấm bài nào.</p>}
      <div className="judgegrid">
        <div>{comps.map(cn => { const xs = list.filter(x => x.competition === cn); return (
          <div key={cn} className="panel"><b>{cn}</b><br /><small className="sub">{xs[0].round_name} · đã chấm {xs.filter(x => x.submitted_at).length}/{xs.length}{xs[0].anonymous ? ' · ẩn danh' : ''}</small>
            {xs.map(x => <button key={x.assignment_id} className={'judgeitem' + (x.assignment_id === cur ? ' on' : '')} onClick={() => setCur(x.assignment_id)}>
              <code>{x.entry_code}</code> {x.title}<small>{x.field ?? ''} · {x.submitted_at ? `✓ ${Number(x.total)} điểm` : x.open ? 'chưa chấm' : 'đã đóng'}</small></button>)}</div>) })}</div>
        {a && <div className="panel">
          <h3 style={{ marginTop: 0 }}><code>{a.entry_code}</code> {a.title}</h3>
          <p className="sub" style={{ marginTop: 0 }}>{[a.field, a.school, a.members].filter(Boolean).join(' · ') || 'Bài ẩn danh'}</p>
          {a.abstract && <p style={{ whiteSpace: 'pre-line' }}><b>Tóm tắt:</b> {a.abstract}</p>}
          <p>{Object.entries(a.docs).filter(([, u]) => u).map(([k, u]) => <a key={k} href={u} target="_blank" rel="noreferrer noopener" style={{ marginRight: 12 }}>🔗 {a.doc_labels?.find(d => d.key === k)?.label ?? k}</a>)}
            {a.links.map((l, i) => <a key={i} href={l.url} target="_blank" rel="noreferrer noopener" style={{ marginRight: 12 }}>🔗 {l.label}</a>)}</p>
          <table><thead><tr><th>Tiêu chí</th><th>Điểm</th><th>Tối đa</th></tr></thead>
            <tbody>{a.criteria.map(c => <tr key={c.key}><td>{c.label}</td><td><input inputMode="decimal" disabled={!a.open} value={draft.scores[c.key] ?? ''} onChange={e => setDraft({ ...draft, scores: { ...draft.scores, [c.key]: e.target.value } })} style={{ width: 80 }} aria-label={c.label} /></td><td>{c.max}</td></tr>)}
              <tr><td><b>Tổng</b></td><td><b>{Math.round(total * 100) / 100}</b></td><td>{a.criteria.reduce((s, c) => s + c.max, 0)}</td></tr></tbody></table>
          <label className="field"><span>Nhận xét cho dự án</span><textarea rows={3} disabled={!a.open} value={draft.comment} onChange={e => setDraft({ ...draft, comment: e.target.value })} /></label>
          {a.open ? <div className="formactions"><button onClick={() => save(false)}>Lưu nháp</button> <button className="primary" onClick={() => save(true)}>Nộp điểm</button></div>
            : <p className="sub">Vòng chấm đã đóng.</p>}
        </div>}
      </div>
    </>
  )
}
