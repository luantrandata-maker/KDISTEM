import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Reg = {
  id: string; topic: string; status: string; on_date: string; room_id: string; period_id: string
  teachers: { full_name: string; subject: string | null } | null
  classes: { name: string } | null; stem_rooms: { name: string } | null
  period_configs: { name: string; starts_at: string; ends_at: string } | null
}
const TABS = [['pending', 'Chờ duyệt'], ['approved', 'Đã duyệt'], ['rejected', 'Từ chối']] as const

export default function Registrations() {
  const [rows, setRows] = useState<Reg[]>([])
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending')

  async function load() {
    const { data } = await supabase.from('stem_registrations')
      .select('id, topic, status, on_date, room_id, period_id, teachers(full_name, subject), classes(name), stem_rooms(name), period_configs(name, starts_at, ends_at)')
      .order('on_date')
    setRows((data as unknown as Reg[]) ?? [])
  }
  useEffect(() => { load() }, [])

  const slot = (r: Reg) => `${r.room_id}|${r.on_date}|${r.period_id}`
  const taken = new Set(rows.filter(r => r.status === 'approved').map(slot))
  const pendingBySlot = rows.filter(r => r.status === 'pending').reduce<Record<string, number>>((m, r) => ({ ...m, [slot(r)]: (m[slot(r)] ?? 0) + 1 }), {})
  const conflict = (r: Reg) => r.status === 'pending' && ((pendingBySlot[slot(r)] ?? 0) > 1 || taken.has(slot(r)))

  async function decide(r: Reg, status: 'approved' | 'rejected') {
    if (status === 'approved' && taken.has(slot(r))) return alert('Phòng và tiết này đã có đăng ký được duyệt.')
    await supabase.from('stem_registrations').update({ status }).eq('id', r.id)
    load()
  }

  const shown = rows.filter(r => r.status === tab)
  const conflicts = rows.filter(conflict).length

  return (
    <>
      <div className="segmented">
        {TABS.map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l} ({rows.filter(r => r.status === k).length})
          </button>
        ))}
      </div>
      {tab === 'pending' && conflicts > 0 && (
        <div className="panel warnbox">Có {conflicts} đăng ký trùng phòng và tiết. Chỉ duyệt được một đăng ký cho mỗi phòng, tiết, ngày.</div>
      )}
      <div className="reggrid">
        {shown.map(r => (
          <div key={r.id} className={'panel regcard' + (conflict(r) ? ' conflict' : '')}>
            <b>{r.topic}</b>
            <small>{r.teachers?.full_name} · {r.teachers?.subject} · {r.classes?.name}</small>
            <small>{r.stem_rooms?.name} · {new Date(r.on_date).toLocaleDateString('vi-VN')} · {r.period_configs?.name} ({r.period_configs?.starts_at.slice(0, 5)}–{r.period_configs?.ends_at.slice(0, 5)})</small>
            {conflict(r) && <span className="warnline">Trùng phòng/tiết</span>}
            {r.status === 'pending' && (
              <div className="actions">
                <button className="primary" onClick={() => decide(r, 'approved')}>Duyệt</button>
                <button onClick={() => decide(r, 'rejected')}>Từ chối</button>
              </div>
            )}
          </div>
        ))}
        {shown.length === 0 && <p className="sub">Không có đăng ký nào ở trạng thái này.</p>}
      </div>
    </>
  )
}
