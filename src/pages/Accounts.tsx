import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Acc = { id: string; full_name: string; email: string | null; organizations: { name: string } | null }
export default function Accounts() {
  const [rows, setRows] = useState<Acc[]>([])
  const [roleOf, setRoleOf] = useState<Record<string, string[]>>({})
  useEffect(() => {
    Promise.all([
      supabase.from('profiles').select('id, full_name, email, organizations(name)').order('full_name'),
      supabase.from('user_roles').select('user_id, roles(name)'),
    ]).then(([p, r]) => {
      setRows((p.data as unknown as Acc[]) ?? [])
      const m: Record<string, string[]> = {}
      ;((r.data as unknown as { user_id: string; roles: { name: string } | null }[]) ?? []).forEach(x => { (m[x.user_id] ??= []).push(x.roles?.name ?? '') })
      setRoleOf(m)
    })
  }, [])
  return (
    <>
      <p className="sub">{rows.length} tài khoản đang được gán vào trường</p>
      <table>
        <thead><tr><th>Người dùng</th><th>Đơn vị</th><th>Vai trò</th></tr></thead>
        <tbody>
          {rows.map(a => (
            <tr key={a.id}><td><b>{a.full_name}</b><br /><small>{a.email}</small></td><td>{a.organizations?.name}</td>
              <td>{(roleOf[a.id] ?? []).map(n => <span className="chip" key={n}>{n}</span>)}{!(roleOf[a.id]?.length) && <small>Chưa có vai trò</small>}</td></tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={3}>Chưa có tài khoản nào.</td></tr>}
        </tbody>
      </table>
    </>
  )
}
