import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Portal = 'school_admin' | 'teacher'
type Role = { id: string; key: string; name: string; is_system: boolean; org_id: string | null; portal: string | null; description: string | null }
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
const PORTAL_LABEL: Record<string, string> = { school_admin: 'Giao diện Quản trị trường', teacher: 'Giao diện Giáo viên' }
const FULL_ACCESS = ['principal', 'it_admin']
const HIDDEN = ['ministry', 'province', 'department', 'district', 'provider', 'student']
const empty = (role_id: string, module: string): Perm => ({ role_id, module, can_view: false, can_detail: false, can_create: false, can_edit: false, can_delete: false })

// Mặc định của hệ thống nằm ở role_permissions (chỉ đọc). Trường chỉnh quyền cho vai trò bằng org_role_permissions,
// dòng của trường (nếu có) thay thế dòng mặc định. Vai trò tuỳ chỉnh (roles.org_id = trường) chỉ có quyền ở org_role_permissions.
export default function Roles({ orgId }: { orgId?: string | null }) {
  const [roles, setRoles] = useState<Role[]>([])
  const [perms, setPerms] = useState<Perm[]>([])
  const [members, setMembers] = useState<Record<string, number>>({})
  const [sel, setSel] = useState('')
  const [err, setErr] = useState('')
  const [form, setForm] = useState<null | { id?: string; name: string; description: string; portal: Portal; copyFrom: string }>(null)

  async function load(selectId?: string) {
    const [r, d, o, u] = await Promise.all([
      supabase.from('roles').select('id, key, name, is_system, org_id, portal, description').order('is_system', { ascending: false }).order('name'),
      supabase.from('role_permissions').select('*'),
      orgId ? supabase.from('org_role_permissions').select('*').eq('org_id', orgId) : Promise.resolve({ data: [] }),
      orgId ? supabase.from('memberships').select('role_id').eq('org_id', orgId) : Promise.resolve({ data: [] }),
    ])
    const rs = ((r.data as Role[]) ?? []).filter(x => !HIDDEN.includes(x.key))
    const own = ((o.data as (Perm & { org_id: string })[]) ?? []).map(({ org_id: _, ...x }) => x as Perm)
    const key = (x: Perm) => x.role_id + '|' + x.module
    const merged = new Map(((d.data as Perm[]) ?? []).map(x => [key(x), x]))
    own.forEach(x => merged.set(key(x), x))
    const count: Record<string, number> = {}
    ;((u.data as { role_id: string }[]) ?? []).forEach(x => { count[x.role_id] = (count[x.role_id] ?? 0) + 1 })
    setRoles(rs); setPerms([...merged.values()]); setMembers(count)
    setSel(cur => selectId ?? (rs.some(x => x.id === cur) ? cur : rs[0]?.id ?? ''))
  }
  useEffect(() => { load() }, [orgId])

  const get = (roleId: string, module: string): Perm => perms.find(p => p.role_id === roleId && p.module === module) ?? empty(roleId, module)

  async function toggle(module: string, k: (typeof ACTIONS)[number][0]) {
    if (!orgId) return setErr('Tài khoản chưa thuộc trường nào.')
    const cur = get(sel, module)
    const next = { ...cur, [k]: !cur[k] }
    if (k === 'can_view' && !next.can_view) Object.assign(next, { can_detail: false, can_create: false, can_edit: false, can_delete: false })
    else if (k !== 'can_view' && next[k]) next.can_view = true
    setPerms([...perms.filter(p => !(p.role_id === sel && p.module === module)), next])
    const { error } = await supabase.from('org_role_permissions').upsert({ ...next, org_id: orgId })
    if (error) { setErr('Không lưu được: ' + error.message); load() } else setErr('')
  }

  async function saveRole(e: React.FormEvent) {
    e.preventDefault()
    if (!form || !orgId) return
    const body = { name: form.name.trim(), description: form.description.trim() || null, portal: form.portal }
    if (form.id) {
      const { error } = await supabase.from('roles').update(body).eq('id', form.id)
      if (error) return setErr('Không lưu được: ' + error.message)
      setForm(null); setErr(''); return load(form.id)
    }
    const { data, error } = await supabase.from('roles').insert({ ...body, org_id: orgId }).select('id').single()
    if (error || !data) return setErr('Không tạo được vai trò: ' + (error?.message ?? ''))
    // Sao chép quyền hiệu lực của vai trò mẫu sang vai trò mới
    if (form.copyFrom) {
      const rows = MODULES.map(([m]) => get(form.copyFrom, m)).filter(p => p.can_view)
        .map(p => ({ ...p, role_id: data.id, org_id: orgId }))
      if (rows.length) {
        const r2 = await supabase.from('org_role_permissions').insert(rows)
        if (r2.error) setErr('Đã tạo vai trò nhưng chưa sao chép được quyền: ' + r2.error.message)
      }
    }
    setForm(null); load(data.id)
  }

  async function removeRole(r: Role) {
    const n = members[r.id] ?? 0
    if (!confirm(`Xoá vai trò “${r.name}”?${n ? `\n${n} người đang có vai trò này sẽ bị gỡ vai trò.` : ''}`)) return
    const { error } = await supabase.from('roles').delete().eq('id', r.id)
    if (error) return setErr('Không xoá được: ' + error.message)
    setErr(''); load()
  }

  const role = roles.find(r => r.id === sel)
  const full = role && FULL_ACCESS.includes(role.key)
  const custom = role && !role.is_system
  return (
    <>
      <div className="bar">
        <p className="sub" style={{ margin: 0, flex: 1, minWidth: 260 }}>Vai trò hệ thống dùng chung mọi trường; quyền bạn chỉnh ở đây chỉ áp dụng cho trường của bạn.</p>
        <button className="primary" onClick={() => setForm({ name: '', description: '', portal: 'school_admin', copyFrom: '' })}>+ Thêm vai trò</button>
      </div>
      {err && <p className="msg">{err}</p>}
      {form && (
        <form className="panel formgrid" onSubmit={saveRole}>
          <label className="field"><span>Tên vai trò *</span>
            <input required maxLength={60} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="VD: Tổ trưởng chuyên môn" /></label>
          <label className="field"><span>Giao diện sử dụng *</span>
            <select value={form.portal} onChange={e => setForm({ ...form, portal: e.target.value as Portal })}>
              <option value="school_admin">{PORTAL_LABEL.school_admin}</option>
              <option value="teacher">{PORTAL_LABEL.teacher}</option>
            </select></label>
          {!form.id && (
            <label className="field"><span>Sao chép quyền từ</span>
              <select value={form.copyFrom} onChange={e => setForm({ ...form, copyFrom: e.target.value })}>
                <option value="">Không sao chép (bắt đầu trống)</option>
                {roles.filter(r => !FULL_ACCESS.includes(r.key)).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select></label>
          )}
          <label className="field"><span>Mô tả</span>
            <input maxLength={200} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Phạm vi công việc của vai trò" /></label>
          <div className="formactions">
            <button className="primary" type="submit">{form.id ? 'Lưu' : 'Tạo vai trò'}</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button>
          </div>
        </form>
      )}
      <div className="rolegrid">
        <div className="panel rolelist">
          {roles.map(r => (
            <button key={r.id} className={r.id === sel ? 'on' : ''} onClick={() => setSel(r.id)}>
              {r.name} <small>· {r.is_system ? 'hệ thống' : 'tuỳ chỉnh'} · {members[r.id] ?? 0} người</small>
            </button>
          ))}
        </div>
        <div>
          {role && (
            <div className="tools">
              <p className="sub">
                <b>{role.name}</b>{role.portal && ` · ${PORTAL_LABEL[role.portal] ?? ''}`}{role.description && ` · ${role.description}`}
              </p>
              {custom && <span>
                <button onClick={() => setForm({ id: role.id, name: role.name, description: role.description ?? '', portal: (role.portal as Portal) ?? 'school_admin', copyFrom: '' })}>Sửa</button>{' '}
                <button onClick={() => removeRole(role)}>Xoá</button>
              </span>}
            </div>
          )}
          {full ? (
            <p className="panel">Vai trò này có <b>toàn quyền</b> trong trường, không cần cấu hình.</p>
          ) : (
            <>
              <p className="sub">Tick vào ô để cấp quyền, thay đổi được lưu ngay và có hiệu lực ở cả cơ sở dữ liệu.</p>
              <div className="wrap">
                <table>
                  <thead><tr><th>Chức năng</th>{ACTIONS.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
                  <tbody>
                    {MODULES.map(([m, label]) => {
                      const p = get(sel, m)
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
            </>
          )}
        </div>
      </div>
    </>
  )
}
