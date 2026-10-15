import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { sendInviteEmail } from '../../lib/invite'
import { Tabs } from '../teacher/common'
import { usePlatform, ORG_TYPE, rolesFor, pathOf, fmtTime, errText, type Profile, type Member } from './data'

type F = 'all' | 'none' | 'multi' | 'authority' | 'school'

// Người dùng & vai trò trên toàn hệ thống: ai giữ vai trò gì ở đơn vị nào
export function PlatformUsers() {
  const { orgs, roles, loading, err } = usePlatform()
  const [users, setUsers] = useState<Profile[]>([])
  const [mems, setMems] = useState<Member[]>([])
  const [q, setQ] = useState('')
  const [f, setF] = useState<F>('all')
  const [adding, setAdding] = useState<{ user: string; org: string; role: string } | null>(null)
  const [msg, setMsg] = useState(''); const [info, setInfo] = useState('')

  async function load() {
    const [p, m] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, org_id').order('full_name').limit(2000),
      supabase.from('memberships').select('user_id, org_id, role_id, created_at').limit(10000),
    ])
    setUsers((p.data as Profile[]) ?? []); setMems((m.data as Member[]) ?? [])
  }
  useEffect(() => { load() }, [])
  const byId = useMemo(() => new Map(orgs.map(o => [o.id, o])), [orgs])
  const roleName = (id: string) => roles.find(r => r.id === id)?.name ?? '?'
  const memOf = useMemo(() => {
    const m = new Map<string, Member[]>(); mems.forEach(x => m.set(x.user_id, [...(m.get(x.user_id) ?? []), x])); return m
  }, [mems])
  if (loading) return <p className="sub">Đang tải…</p>
  if (err) return <p className="msg">{err}</p>

  const orgsOf = (u: string) => new Set((memOf.get(u) ?? []).map(m => m.org_id))
  const shown = users.filter(u => {
    const ms = memOf.get(u.id) ?? []
    const types = ms.map(m => byId.get(m.org_id)?.type)
    const ok = f === 'all' || (f === 'none' && ms.length === 0) || (f === 'multi' && orgsOf(u.id).size > 1)
      || (f === 'authority' && types.some(t => t && !['school', 'provider'].includes(t))) || (f === 'school' && types.includes('school'))
    const s = q.trim().toLowerCase()
    return ok && (!s || (u.full_name ?? '').toLowerCase().includes(s) || (u.email ?? '').toLowerCase().includes(s))
  })
  const count = (x: F) => users.filter(u => {
    const ms = memOf.get(u.id) ?? []; const types = ms.map(m => byId.get(m.org_id)?.type)
    return x === 'none' ? ms.length === 0 : x === 'multi' ? orgsOf(u.id).size > 1
      : x === 'authority' ? types.some(t => t && !['school', 'provider'].includes(t)) : x === 'school' ? types.includes('school') : true
  }).length

  async function removeRole(m: Member, u: Profile) {
    if (!confirm(`Gỡ vai trò ${roleName(m.role_id)} của ${u.full_name ?? u.email} tại ${byId.get(m.org_id)?.name}?`)) return
    const { error } = await supabase.from('memberships').delete().eq('user_id', m.user_id).eq('org_id', m.org_id).eq('role_id', m.role_id)
    if (error) setMsg(errText(error.message)); else { setMsg(''); setInfo('Đã gỡ vai trò.'); load() }
  }
  async function addRole(e: React.FormEvent) {
    e.preventDefault(); if (!adding?.org || !adding.role) return
    const { error } = await supabase.from('memberships').insert({ user_id: adding.user, org_id: adding.org, role_id: adding.role })
    if (error) setMsg(error.message.includes('duplicate') ? 'Người này đã có vai trò đó tại đơn vị.' : errText(error.message))
    else { setMsg(''); setInfo('Đã gán vai trò.'); setAdding(null); load() }
  }
  const orgLabel = (id: string) => pathOf(id, byId).map(o => o.name).join(' › ')
  const sortedOrgs = [...orgs].sort((a, b) => orgLabel(a.id).localeCompare(orgLabel(b.id), 'vi'))

  return (
    <>
      <div className="bar">
        <Tabs items={[['all', 'Tất cả', users.length], ['authority', 'Cơ quan quản lý', count('authority')], ['school', 'Trường', count('school')],
          ['multi', 'Nhiều đơn vị', count('multi')], ['none', 'Chưa thuộc đơn vị', count('none')]]} value={f} onChange={setF} />
        <input className="search" placeholder="Tìm theo tên hoặc email…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm người dùng" />
      </div>
      {msg && <p className="msg">{msg}</p>}
      {info && <p className="sub"><b>{info}</b></p>}
      <div className="wrap">
        <table>
          <thead><tr><th>Người dùng</th><th>Đang làm việc tại</th><th>Vai trò theo đơn vị</th></tr></thead>
          <tbody>
            {shown.slice(0, 300).map(u => {
              const ms = memOf.get(u.id) ?? []
              const active = u.org_id ? byId.get(u.org_id) : undefined
              return (
                <tr key={u.id}>
                  <td><b>{u.full_name ?? '—'}</b><br /><small>{u.email}</small></td>
                  <td>{active ? <>{active.name}<br /><small className="sub">{ORG_TYPE[active.type]}</small></> : <small className="sub">Chưa có</small>}</td>
                  <td>
                    {ms.map(m => (
                      <span className="chip" key={m.org_id + m.role_id} title={orgLabel(m.org_id)}>
                        {roleName(m.role_id)} · {byId.get(m.org_id)?.name ?? '?'}
                        <button className="x" onClick={() => removeRole(m, u)} aria-label="Gỡ vai trò">×</button>
                      </span>
                    ))}
                    {adding?.user === u.id ? (
                      <form className="inlineform" onSubmit={addRole}>
                        <select value={adding.org} onChange={e => setAdding({ ...adding, org: e.target.value, role: '' })} aria-label="Đơn vị">
                          <option value="">Chọn đơn vị…</option>
                          {sortedOrgs.map(o => <option key={o.id} value={o.id}>{orgLabel(o.id)}</option>)}
                        </select>
                        <select value={adding.role} onChange={e => setAdding({ ...adding, role: e.target.value })} aria-label="Vai trò" disabled={!adding.org}>
                          <option value="">Vai trò…</option>
                          {rolesFor(byId.get(adding.org), roles).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                        <button className="primary" disabled={!adding.role}>Gán</button> <button type="button" onClick={() => setAdding(null)}>Huỷ</button>
                      </form>
                    ) : <button type="button" className="linkbtn" onClick={() => setAdding({ user: u.id, org: '', role: '' })}>+ Gán vai trò</button>}
                  </td>
                </tr>
              )
            })}
            {shown.length === 0 && <tr><td colSpan={3}>Không có người dùng phù hợp.</td></tr>}
          </tbody>
        </table>
      </div>
      {shown.length > 300 && <p className="sub">Đang hiện 300/{shown.length} người. Hãy tìm theo tên hoặc email để thu hẹp.</p>}
    </>
  )
}

type Invite = { id: string; org_id: string; email: string; full_name: string | null; role_id: string; status: string; note: string | null; created_at: string; sent_at: string | null; accepted_at: string | null }

// Lời mời trên toàn hệ thống
export function PlatformInvites() {
  const { orgs, roles, loading, err } = usePlatform()
  const [rows, setRows] = useState<Invite[]>([])
  const [f, setF] = useState<'pending' | 'accepted' | 'cancelled'>('pending')
  const [msg, setMsg] = useState(''); const [info, setInfo] = useState('')
  async function load() {
    const { data } = await supabase.from('invitations').select('id, org_id, email, full_name, role_id, status, note, created_at, sent_at, accepted_at').order('created_at', { ascending: false }).limit(1000)
    setRows((data as Invite[]) ?? [])
  }
  useEffect(() => { load() }, [])
  if (loading) return <p className="sub">Đang tải…</p>
  if (err) return <p className="msg">{err}</p>
  const byId = new Map(orgs.map(o => [o.id, o]))
  async function resend(i: Invite) {
    const r = await sendInviteEmail(i.email, i.full_name)
    if (r.error) return setMsg(`Không gửi được tới ${i.email}: ${r.error.message}`)
    await supabase.from('invitations').update({ sent_at: new Date().toISOString() }).eq('id', i.id)
    setMsg(''); setInfo(`Đã gửi lại email tới ${i.email}.`); load()
  }
  async function cancel(i: Invite) {
    if (!confirm(`Huỷ lời mời ${i.email}?`)) return
    const { error } = await supabase.from('invitations').update({ status: 'cancelled' }).eq('id', i.id)
    if (error) setMsg(errText(error.message)); else { setInfo('Đã huỷ lời mời.'); load() }
  }
  const shown = rows.filter(r => r.status === f)
  return (
    <>
      <Tabs items={[['pending', 'Đang chờ', rows.filter(r => r.status === 'pending').length], ['accepted', 'Đã nhận', rows.filter(r => r.status === 'accepted').length],
        ['cancelled', 'Đã huỷ', rows.filter(r => r.status === 'cancelled').length]]} value={f} onChange={setF} />
      <p className="sub">Tạo lời mời mới ở <b>Cây tổ chức</b> → chọn đơn vị → <i>Người phụ trách & vai trò</i>.</p>
      {msg && <p className="msg">{msg}</p>}
      {info && <p className="sub"><b>{info}</b></p>}
      <div className="wrap">
        <table>
          <thead><tr><th>Email</th><th>Đơn vị</th><th>Vai trò</th><th>{f === 'accepted' ? 'Nhận lúc' : 'Tạo lúc'}</th><th>Email mời</th>{f === 'pending' && <th></th>}</tr></thead>
          <tbody>
            {shown.map(i => (
              <tr key={i.id}>
                <td><b>{i.email}</b>{i.full_name && <><br /><small>{i.full_name}</small></>}{i.note && <><br /><small className="msg">{i.note}</small></>}</td>
                <td>{byId.get(i.org_id)?.name ?? '—'}<br /><small className="sub">{ORG_TYPE[byId.get(i.org_id)?.type ?? '']}</small></td>
                <td>{roles.find(r => r.id === i.role_id)?.name ?? '—'}</td>
                <td>{fmtTime(f === 'accepted' && i.accepted_at ? i.accepted_at : i.created_at)}</td>
                <td>{i.sent_at ? fmtTime(i.sent_at) : <small className="sub">Chưa gửi</small>}</td>
                {f === 'pending' && <td><button onClick={() => resend(i)}>Gửi lại</button> <button onClick={() => cancel(i)}>Huỷ</button></td>}
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={6}>Không có lời mời.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
