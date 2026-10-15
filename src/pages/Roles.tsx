import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Role = { id: string; key: string; name: string; is_system: boolean }
type Perm = { role_id: string; module: string; can_view: boolean; can_detail: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean }
const MODULES: [string, string][] = [
  ['teachers', 'Giáo viên'], ['classes', 'Lớp học'], ['students', 'Học sinh'], ['assignments', 'Phân công giảng dạy'],
  ['stem_rooms', 'Phòng STEM'], ['equipment', 'Thiết bị'], ['warranty', 'Bảo hành thiết bị'], ['timetable', 'Thời khóa biểu'],
  ['stem_registrations', 'Đăng ký dạy STEM'], ['buildings', 'Tòa nhà & Tầng'], ['periods', 'Cấu hình tiết học'],
  ['accounts', 'Tài khoản'], ['roles', 'Vai trò và phân quyền'],
  ['edu_plan', 'Kế hoạch giáo dục'], ['stem_assign', 'Phân công GV dạy STEM'], ['curriculum', 'Phân phối chương trình'],
  ['packages', 'Gói STEM'], ['training', 'Tập huấn giáo viên'],
]
const ACTIONS = [['can_view', 'Xem'], ['can_detail', 'Chi tiết'], ['can_create', 'Tạo mới'], ['can_edit', 'Chỉnh sửa'], ['can_delete', 'Xoá']] as const

// Mặc định của hệ thống nằm ở role_permissions (chỉ đọc). Trường chỉnh quyền cho vai trò bằng org_role_permissions,
// dòng của trường (nếu có) thay thế dòng mặc định.
export default function Roles({ orgId }: { orgId?: string | null }) {
  const [roles, setRoles] = useState<Role[]>([])
  const [perms, setPerms] = useState<Perm[]>([])
  const [sel, setSel] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const [r, d, o] = await Promise.all([
      supabase.from('roles').select('*').order('name'),
      supabase.from('role_permissions').select('*'),
      orgId ? supabase.from('org_role_permissions').select('*').eq('org_id', orgId) : Promise.resolve({ data: [] }),
    ])
    const rs = ((r.data as Role[]) ?? []).filter(x => !['department', 'provider'].includes(x.key))
    const own = ((o.data as (Perm & { org_id: string })[]) ?? []).map(({ org_id: _, ...x }) => x as Perm)
    const key = (x: Perm) => x.role_id + '|' + x.module
    const merged = new Map(((d.data as Perm[]) ?? []).map(x => [key(x), x]))
    own.forEach(x => merged.set(key(x), x))
    setRoles(rs); setPerms([...merged.values()]); if (!sel && rs[0]) setSel(rs[0].id)
  }
  useEffect(() => { load() }, [orgId])

  const get = (module: string): Perm =>
    perms.find(p => p.role_id === sel && p.module === module) ??
    { role_id: sel, module, can_view: false, can_detail: false, can_create: false, can_edit: false, can_delete: false }

  async function toggle(module: string, key: (typeof ACTIONS)[number][0]) {
    const cur = get(module)
    const next = { ...cur, [key]: !cur[key] }
    if (key === 'can_view' && !next.can_view) Object.assign(next, { can_detail: false, can_create: false, can_edit: false, can_delete: false })
    else if (key !== 'can_view' && next[key]) next.can_view = true
    setPerms([...perms.filter(p => !(p.role_id === sel && p.module === module)), next])
    if (!orgId) return setErr('Tài khoản chưa thuộc trường nào.')
    const { error } = await supabase.from('org_role_permissions').upsert({ ...next, org_id: orgId })
    if (error) { setErr('Không lưu được: ' + error.message); load() } else setErr('')
  }

  const role = roles.find(r => r.id === sel)
  return (
    <div className="rolegrid">
      <div className="panel rolelist">
        {roles.map(r => (
          <button key={r.id} className={r.id === sel ? 'on' : ''} onClick={() => setSel(r.id)}>{r.name}{r.is_system && <small> · hệ thống</small>}</button>
        ))}
      </div>
      <div>
        <p className="sub">{role ? `Quyền của vai trò “${role.name}”` : ''}. Tick vào ô để cấp quyền, thay đổi được lưu ngay.</p>
        {err && <p className="msg">{err}</p>}
        <div className="wrap">
          <table>
            <thead><tr><th>Chức năng</th>{ACTIONS.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
            <tbody>
              {MODULES.map(([m, label]) => {
                const p = get(m)
                return (
                  <tr key={m}><td><b>{label}</b></td>
                    {ACTIONS.map(([k, l]) => (
                      <td key={k}><input type="checkbox" checked={p[k]} onChange={() => toggle(m, k)} aria-label={`${label}: ${l}`} /></td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
