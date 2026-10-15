import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import { KIND_LABEL, KINDS, StepTrail, StatusPill, fmt, decideText, approvalError, type Req, type Action } from './common'

type T = 'mine' | 'sent' | 'open' | 'done'
const DECISION: Record<string, string> = { approve: 'Duyệt', reject: 'Từ chối', comment: 'Ghi chú', cancel: 'Rút hồ sơ' }

// Hộp phê duyệt: hồ sơ tôi cần duyệt ở bước hiện tại, hồ sơ tôi đã gửi, toàn bộ hồ sơ của đơn vị
export function ApprovalInbox({ orgId }: { orgId: string | null }) {
  const [tab, setTab] = useState<T>('mine')
  const [lists, setLists] = useState<Record<T, Req[]>>({ mine: [], sent: [], open: [], done: [] })
  const [kind, setKind] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [acts, setActs] = useState<Action[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [note, setNote] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState(''); const [info, setInfo] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  async function load() {
    const { data: { user } } = await supabase.auth.getUser()
    const sel = '*, organizations(name)'
    const [mine, sent, openR, done] = await Promise.all([
      supabase.rpc('approval_inbox').select(sel),
      supabase.from('approval_requests').select(sel).eq('requested_by', user?.id ?? '').order('created_at', { ascending: false }).limit(100),
      supabase.from('approval_requests').select(sel).eq('status', 'pending').order('created_at').limit(300),
      supabase.from('approval_requests').select(sel).in('status', ['approved', 'rejected', 'cancelled']).order('decided_at', { ascending: false }).limit(150),
    ])
    if (mine.error) return setErr(/schema cache|does not exist/i.test(mine.error.message) ? 'Hãy chạy migration 022_approval_engine.sql trên Supabase.' : mine.error.message)
    setLists({ mine: (mine.data as Req[]) ?? [], sent: (sent.data as Req[]) ?? [], open: (openR.data as Req[]) ?? [], done: (done.data as Req[]) ?? [] })
  }
  useEffect(() => { load() }, [orgId])

  async function history(r: Req) {
    if (open === r.id) return setOpen(null)
    setOpen(r.id)
    const { data } = await supabase.from('approval_actions').select('*').eq('request_id', r.id).order('at')
    const list = (data as Action[]) ?? []; setActs(list)
    const ids = [...new Set(list.map(a => a.actor).concat(r.requested_by).filter(Boolean))] as string[]
    if (ids.length) {
      const { data: ps } = await supabase.from('profiles').select('id, full_name, email').in('id', ids)
      setNames(new Map(((ps as { id: string; full_name: string | null; email: string | null }[]) ?? []).map(p => [p.id, p.full_name ?? p.email ?? '?'])))
    }
  }
  async function decide(r: Req, decision: 'approve' | 'reject' | 'comment') {
    if (decision === 'reject' && !note[r.id]?.trim() && !confirm('Từ chối mà không ghi lý do?')) return
    setBusy(r.id); setMsg(''); setInfo('')
    const { data, error } = await supabase.rpc('approval_decide', { p_request: r.id, p_decision: decision, p_note: note[r.id] ?? null })
    setBusy(null)
    if (error) return setMsg(approvalError(error.message))
    setInfo(`“${r.title}”: ${decision === 'comment' ? 'đã thêm ghi chú.' : decideText(data as never)}`)
    setNote({ ...note, [r.id]: '' }); load(); if (open === r.id) { setOpen(null) }
  }
  async function cancel(r: Req) {
    if (!confirm(`Rút hồ sơ “${r.title}”?`)) return
    const { error } = await supabase.rpc('approval_cancel', { p_request: r.id, p_note: null })
    if (error) setMsg(approvalError(error.message)); else { setInfo('Đã rút hồ sơ.'); load() }
  }

  if (err) return <p className="msg">{err}</p>
  const rows = lists[tab].filter(r => !kind || r.kind === kind)
  const mineIds = new Set(lists.mine.map(r => r.id))
  return (
    <>
      <div className="bar">
        <Tabs items={[['mine', 'Chờ tôi duyệt', lists.mine.length], ['sent', 'Tôi đã gửi', lists.sent.length],
          ['open', 'Đang xử lý', lists.open.length], ['done', 'Đã xong']]} value={tab} onChange={t => { setTab(t); setOpen(null) }} />
        <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Loại hồ sơ">
          <option value="">Mọi loại hồ sơ</option>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {msg && <p className="msg">{msg}</p>}
      {info && <p className="sub"><b>{info}</b></p>}
      {rows.length === 0 && <div className="panel"><p className="sub" style={{ margin: 0 }}>{tab === 'mine' ? 'Không có hồ sơ nào đang chờ bạn duyệt.' : 'Không có hồ sơ.'}</p></div>}
      <div className="reqlist">
        {rows.map(r => {
          const canAct = mineIds.has(r.id)
          return (
            <article className="panel req" key={r.id}>
              <header className="bar">
                <div>
                  <span className="kindchip">{KIND_LABEL[r.kind] ?? r.kind}</span>
                  <h3>{r.title}</h3>
                  <p className="sub">{r.summary}{r.org_id !== orgId && r.organizations ? ` · ${r.organizations.name}` : ''} · gửi {fmt(r.created_at)}</p>
                </div>
                <StatusPill status={r.status} />
              </header>
              {r.steps.length > 1 ? <StepTrail req={r} />
                : <p className="sub onestep">Duyệt 1 bước · {r.steps[0]?.approver === 'role' ? r.steps[0].role_name : 'người có quyền duyệt'} · {r.steps[0]?.org_name}</p>}
              {canAct && (
                <div className="decide">
                  <input placeholder="Ý kiến (nên ghi khi từ chối)" value={note[r.id] ?? ''} onChange={e => setNote({ ...note, [r.id]: e.target.value })} aria-label="Ý kiến" />
                  <div className="actions">
                    <button className="primary" disabled={busy === r.id} onClick={() => decide(r, 'approve')}>
                      {r.current_step < r.steps.length ? `Duyệt bước ${r.current_step} → chuyển tiếp` : 'Duyệt'}</button>
                    <button disabled={busy === r.id} onClick={() => decide(r, 'reject')}>Từ chối</button>
                    <button disabled={busy === r.id || !note[r.id]?.trim()} onClick={() => decide(r, 'comment')}>Chỉ ghi chú</button>
                  </div>
                </div>
              )}
              <div className="actions">
                <button type="button" className="linkbtn" onClick={() => history(r)} aria-expanded={open === r.id}>{open === r.id ? 'Ẩn lịch sử' : 'Lịch sử duyệt'}</button>
                {tab === 'sent' && r.status === 'pending' && <button type="button" className="linkbtn" onClick={() => cancel(r)}>Rút hồ sơ</button>}
              </div>
              {open === r.id && (
                <ul className="feed">
                  <li><time>{fmt(r.created_at)}</time><span>Gửi duyệt</span><small>{r.requested_by ? names.get(r.requested_by) ?? '—' : '—'}</small></li>
                  {acts.map(a => (
                    <li key={a.id}><time>{fmt(a.at)}</time>
                      <span>Bước {a.step_no} · <b>{DECISION[a.decision] ?? a.decision}</b>{a.note ? ` — “${a.note}”` : ''}</span>
                      <small>{a.actor ? names.get(a.actor) ?? r.steps[a.step_no - 1]?.org_name ?? '—' : '—'}</small></li>
                  ))}
                </ul>
              )}
            </article>
          )
        })}
      </div>
    </>
  )
}
