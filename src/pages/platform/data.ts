import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ORG_TYPE } from '../../lib/auth'

export type Org = {
  id: string; type: string; parent_id: string | null; code: string | null; name: string; level: string | null
  ward: string | null; address: string | null; activated_at: string | null; status: string; is_platform: boolean
}
export type OrgStat = { org_id: string; members: number; schools: number; schools_active: number; teachers: number; students: number }
export type Role = { id: string; key: string; name: string; org_id: string | null; portal: string | null }
export type Profile = { id: string; full_name: string | null; email: string | null; org_id: string | null }
export type Member = { user_id: string; org_id: string; role_id: string; created_at: string }

export { ORG_TYPE }
export const TYPE_ORDER = ['ministry', 'province', 'department', 'district', 'school', 'provider']
// Loại đơn vị con được phép (khớp ràng buộc org_parent_ok ở CSDL)
export const CHILD_TYPES: Record<string, string[]> = {
  ministry: ['province'], province: ['department'], department: ['district', 'school'], district: ['school'], school: [], provider: [],
}
// Loại đơn vị được TẠO MỚI: từ 01/07/2025 không còn cấp huyện nên không tạo thêm Phòng GD&ĐT.
// Phòng đã có vẫn hiển thị, sửa, chuyển đơn vị cha và nhận trường trực thuộc như trước (CHILD_TYPES).
export const NEW_CHILD_TYPES: Record<string, string[]> = {
  ...CHILD_TYPES, department: CHILD_TYPES.department.filter(t => t !== 'district'),
}
export const ROOT_TYPES = ['ministry', 'provider', 'province', 'department']
export const TYPE_FULL: Record<string, string> = {
  ministry: 'Bộ GD&ĐT', province: 'Tỉnh / Thành phố', department: 'Sở GD&ĐT', district: 'Phòng GD&ĐT', school: 'Trường học', provider: 'Đơn vị cung cấp',
}
export const LEVELS: [string, string][] = [['mamnon', 'Mầm non'], ['tieuhoc', 'Tiểu học'], ['thcs', 'THCS'], ['thpt', 'THPT']]
const SCHOOL_ROLES = ['principal', 'it_admin', 'teacher', 'office_staff', 'student']

// Vai trò gán được tại một đơn vị (khớp role_fits_org)
export function rolesFor(org: Org | undefined, roles: Role[]) {
  if (!org) return []
  return roles.filter(r => r.org_id ? r.org_id === org.id
    : r.key === 'platform_admin' ? org.is_platform
    : org.type === 'school' ? SCHOOL_ROLES.includes(r.key) : r.key === org.type)
}

// Một lần tải cho các màn của cổng nền tảng
export function usePlatform() {
  const [orgs, setOrgs] = useState<Org[]>([])
  const [stats, setStats] = useState<Map<string, OrgStat>>(new Map())
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  async function reload() {
    const [o, s, r] = await Promise.all([
      supabase.from('organizations').select('id, type, parent_id, code, name, level, ward, address, activated_at, status, is_platform').order('name'),
      supabase.rpc('org_tree_stats'),
      supabase.from('roles').select('id, key, name, org_id, portal').order('name'),
    ])
    if (o.error || s.error) {
      const m = (o.error ?? s.error)!.message
      setErr(/schema cache|does not exist|column/i.test(m) ? 'Cơ sở dữ liệu chưa có phần quản trị nền tảng. Hãy chạy migration 021_platform_admin.sql trên Supabase.' : m)
    }
    setOrgs((o.data as Org[]) ?? [])
    setStats(new Map(((s.data as OrgStat[]) ?? []).map(x => [x.org_id, x])))
    setRoles((r.data as Role[]) ?? [])
    setLoading(false)
  }
  useEffect(() => { reload() }, [])
  return { orgs, stats, roles, loading, err, reload }
}

// Đường dẫn cấp trên: Bộ › Tỉnh › Sở
export function pathOf(id: string | null, byId: Map<string, Org>) {
  const out: Org[] = []
  let cur = id ? byId.get(id) : undefined
  while (cur && out.length < 10) { out.unshift(cur); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined }
  return out
}

export const nf = (n: number | null | undefined) => (n ?? 0).toLocaleString('vi-VN')
export const fmtTime = (iso: string) => new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
export function errText(m: string) {
  if (/duplicate key.*code/i.test(m)) return 'Mã đơn vị đã tồn tại.'
  if (/violates foreign key/i.test(m)) return 'Đơn vị còn dữ liệu liên quan (giáo viên, lớp, học sinh...) nên không xoá được. Hãy tạm dừng thay vì xoá.'
  if (/row-level security/i.test(m)) return 'Bạn không có quyền thực hiện thao tác này.'
  return m
}
