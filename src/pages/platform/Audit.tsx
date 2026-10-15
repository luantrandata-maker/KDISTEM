import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import { fmtTime } from './data'

type Row = { id: number; at: string; actor: string | null; org_id: string | null; entity: string; action: string; summary: string; detail: Record<string, unknown> | null }
type E = 'all' | 'organizations' | 'memberships' | 'invitations' | 'roles'
const ENTITY: Record<string, string> = { organizations: 'Đơn vị', memberships: 'Vai trò', invitations: 'Lời mời', roles: 'Vai trò tuỳ chỉnh' }
const ACTION: Record<string, [string, string]> = { insert: ['+', 'Thêm'], update: ['✎', 'Sửa'], delete: ['−', 'Xoá'] }
const FIELD: Record<string, string> = {
  name: 'Tên', code: 'Mã', parent_id: 'Đơn vị cha', status: 'Trạng thái', activated_at: 'Kích hoạt', level: 'Cấp học', ward: 'Xã/phường',
  address: 'Địa chỉ', sent_at: 'Gửi email', accepted_at: 'Nhận lúc', accepted_user: 'Tài khoản nhận', note: 'Ghi chú', type: 'Loại', is_platform: 'Chủ nền tảng',
}
const show = (v: unknown) => v === null || v === undefined ? '—' : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? fmtTime(v) : String(v)

// Nhật ký hệ thống: ai thay đổi đơn vị, vai trò, lời mời lúc nào
export function PlatformAudit() {
  const [rows, setRows] = useState<Row[]>([])
  const [names, setNames] = useState<Map<string, string>>(new Map())
  const [e, setE] = useState<E>('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let req = supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(300)
    if (e !== 'all') req = req.eq('entity', e)
    req.then(async ({ data, error }) => {
      if (error) return setErr(/schema cache|does not exist/i.test(error.message) ? 'Hãy chạy migration 021_platform_admin.sql trên Supabase.' : error.message)
      const list = (data as Row[]) ?? []
      setRows(list)
      const ids = [...new Set(list.map(r => r.actor).filter(Boolean))] as string[]
      if (ids.length) {
        const { data: ps } = await supabase.from('profiles').select('id, full_name, email').in('id', ids)
        setNames(new Map(((ps as { id: string; full_name: string | null; email: string | null }[]) ?? []).map(p => [p.id, p.full_name ?? p.email ?? '?'])))
      }
    })
  }, [e])
  if (err) return <p className="msg">{err}</p>
  const s = q.trim().toLowerCase()
  const shown = rows.filter(r => !s || r.summary.toLowerCase().includes(s) || (names.get(r.actor ?? '') ?? '').toLowerCase().includes(s))
  return (
    <>
      <div className="bar">
        <Tabs items={[['all', 'Tất cả'], ['organizations', 'Đơn vị'], ['memberships', 'Vai trò'], ['invitations', 'Lời mời'], ['roles', 'Vai trò tuỳ chỉnh']]} value={e} onChange={setE} />
        <input className="search" placeholder="Tìm trong nhật ký…" value={q} onChange={ev => setQ(ev.target.value)} aria-label="Tìm trong nhật ký" />
      </div>
      <div className="wrap">
        <table>
          <thead><tr><th>Thời gian</th><th>Thao tác</th><th>Nội dung</th><th>Người thực hiện</th></tr></thead>
          <tbody>
            {shown.map(r => {
              const [icon, label] = ACTION[r.action] ?? ['', r.action]
              const changes = r.action === 'update' && r.detail ? Object.entries(r.detail) as [string, { from: unknown; to: unknown }][] : []
              return (
                <tr key={r.id}>
                  <td><small>{fmtTime(r.at)}</small></td>
                  <td><span className={'act ' + r.action}><i aria-hidden="true">{icon}</i>{label} {ENTITY[r.entity]?.toLowerCase()}</span></td>
                  <td>{r.summary}
                    {changes.length > 0 && <><br /><button type="button" className="linkbtn" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Ẩn chi tiết' : `${changes.length} thay đổi`}</button></>}
                    {open === r.id && <ul className="changes">{changes.map(([k, v]) => <li key={k}><b>{FIELD[k] ?? k}</b>: {show(v.from)} → {show(v.to)}</li>)}</ul>}
                  </td>
                  <td>{r.actor ? names.get(r.actor) ?? '—' : <small className="sub">Hệ thống</small>}</td>
                </tr>
              )
            })}
            {shown.length === 0 && <tr><td colSpan={4}>Chưa có thay đổi nào.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="sub">Hiện 300 thay đổi gần nhất.</p>
    </>
  )
}
