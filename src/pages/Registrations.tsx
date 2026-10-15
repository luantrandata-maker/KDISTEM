import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ProgChips } from '../components/Chips'
import { useLatestRequests, decideText, approvalError } from './approvals/common'

type Reg = {
  id: string; topic: string; status: string; on_date: string; room_id: string; period_id: string; program: string | null; lesson: string | null; equipment_note: string | null
  teachers: { full_name: string; subject: string | null } | null; classes: { name: string } | null; stem_rooms: { name: string } | null
  period_configs: { name: string; starts_at: string; ends_at: string } | null
}
const TABS = [['pending', 'Chờ duyệt'], ['approved', 'Đã duyệt'], ['rejected', 'Từ chối']] as const
const WD = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7']
const hm = (t: string) => t.slice(0, 5)

export default function Registrations() {
  const [rows, setRows] = useState<Reg[]>([])
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [msg, setMsg] = useState('')

  async function load() {
    const { data } = await supabase.from('stem_registrations')
      .select('id, topic, status, on_date, room_id, period_id, program, lesson, equipment_note, teachers(full_name, subject), classes(name), stem_rooms(name), period_configs(name, starts_at, ends_at)').order('on_date')
    setRows((data as unknown as Reg[]) ?? [])
  }
  useEffect(() => { load() }, [])

  const slot = (r: Reg) => `${r.room_id}|${r.on_date}|${r.period_id}`
  const taken = new Set(rows.filter(r => r.status === 'approved').map(slot))
  const pending = rows.filter(r => r.status === 'pending')
  const groups = pending.reduce<Record<string, Reg[]>>((m, r) => { (m[slot(r)] ??= []).push(r); return m }, {})
  const conflictGroups = Object.values(groups).filter(g => g.length > 1)
  const inConflict = new Set(conflictGroups.flat().map(r => r.id))

  const { map: reqs, reload: reloadReqs } = useLatestRequests('stem_registrations', pending.map(r => r.id))
  async function approve(r: Reg) {
    if (taken.has(slot(r))) return alert('Phòng và tiết này đã có đăng ký được duyệt.')
    const rivals = (groups[slot(r)] ?? []).filter(x => x.id !== r.id)
    if (rivals.length && !confirm(`Duyệt đơn này sẽ tự động từ chối ${rivals.length} đơn trùng phòng/tiết còn lại. Tiếp tục?`)) return
    // Duyệt qua công cụ phê duyệt (migration 022): quy trình nhiều bước thì đơn còn chờ tới khi đủ bước
    const { data, error } = await supabase.rpc('approval_decide_ref', { p_table: 'stem_registrations', p_ref: r.id, p_decision: 'approve', p_note: null })
    if (error) { setMsg(approvalError(error.message)); return load() }
    setMsg(decideText(data as never))
    if ((data as { status: string }).status === 'approved' && rivals.length)
      for (const x of rivals) await supabase.rpc('approval_decide_ref', { p_table: 'stem_registrations', p_ref: x.id, p_decision: 'reject', p_note: 'Trùng phòng và tiết với đăng ký đã duyệt' })
    load(); reloadReqs()
  }
  async function reject(r: Reg) {
    const { error } = await supabase.rpc('approval_decide_ref', { p_table: 'stem_registrations', p_ref: r.id, p_decision: 'reject', p_note: null })
    setMsg(error ? approvalError(error.message) : 'Đã từ chối.'); load()
  }

  const Card = ({ r }: { r: Reg }) => (
    <div className="panel regcard" style={{ margin: 0 }}>
      <div className="bar" style={{ alignItems: 'flex-start' }}><b>{r.topic}</b><span>{r.program && <><span className="badge">STEM</span> <ProgChips programs={r.program} /></>}</span></div>
      <small>{r.teachers?.full_name} · {r.teachers?.subject} · {r.classes?.name}</small>
      <small>{r.stem_rooms?.name} · {new Date(r.on_date).toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' })} · {WD[new Date(r.on_date).getDay()]} · {r.period_configs?.name} ({r.period_configs && `${hm(r.period_configs.starts_at)}–${hm(r.period_configs.ends_at)}`})</small>
      {r.equipment_note && <small style={{ color: '#a8650c' }}>Mượn TB: {r.equipment_note}</small>}
      {r.lesson && <div className="panel" style={{ background: 'var(--soft)', margin: 0, padding: 8 }}><small>{r.lesson}</small></div>}
      {r.status === 'pending' && (reqs.get(r.id)?.steps.length ?? 1) > 1 && (() => { const q = reqs.get(r.id)!; const st = q.steps[q.current_step - 1]
        return <small className="stepnote">Bước {q.current_step}/{q.steps.length}: {st?.name} · {st?.approver === 'role' ? st.role_name : 'người có quyền duyệt'}</small> })()}
      {r.status === 'pending' && <div className="actions"><button className="primary" style={{ flex: 1 }} onClick={() => approve(r)}>✓ Duyệt</button><button onClick={() => reject(r)}>✕ Từ chối</button></div>}
    </div>
  )

  const others = pending.filter(r => !inConflict.has(r.id))
  return (
    <>
      {msg && <p className="sub"><b>{msg}</b></p>}
      <div className="segmented">
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} ({rows.filter(r => r.status === k).length})</button>)}
      </div>
      {tab === 'pending' && (<>
        {conflictGroups.map(g => (
          <div className="panel conflictbox" key={slot(g[0])}>
            <div className="bar"><b style={{ color: 'var(--bad)' }}>Tranh chấp — {g[0].stem_rooms?.name} · {new Date(g[0].on_date).toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric' })} · {WD[new Date(g[0].on_date).getDay()]} · {g[0].period_configs?.name} ({g[0].period_configs && `${hm(g[0].period_configs.starts_at)}–${hm(g[0].period_configs.ends_at)}`})</b>
              <span className="pill inactive">{g.length} đơn — duyệt 1</span></div>
            <div className="reggrid" style={{ marginTop: 10 }}>{g.map(r => <Card key={r.id} r={r} />)}</div>
          </div>))}
        <div className="reggrid">{others.map(r => <Card key={r.id} r={r} />)}</div>
        {pending.length === 0 && <p className="sub">Không còn đăng ký nào chờ duyệt.</p>}
      </>)}
      {tab !== 'pending' && <div className="reggrid">{rows.filter(r => r.status === tab).map(r => <Card key={r.id} r={r} />)}
        {rows.filter(r => r.status === tab).length === 0 && <p className="sub">Không có đăng ký nào ở trạng thái này.</p>}</div>}
    </>
  )
}
