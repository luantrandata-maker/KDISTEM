import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { RoleKey } from './nav'

export type Profile = { id: string; org_id: string | null; full_name: string; locked_at?: string | null; locked_reason?: string | null }
// Quyền dùng phân hệ theo hợp đồng (migration 024). state: open = chưa có hợp đồng (không giới hạn)
export type Entitlement = { state: 'open' | 'active' | 'expired'; plan: string | null; contract: string | null; ends_on: string | null
  source_org: string | null; gated: string[]; perm_modules: string[] | null }
export type MyRole = { role_id: string; key: string; name: string; portal: RoleKey | null }
// Một tổ chức người dùng là thành viên (migration 019); active = tổ chức đang làm việc
export type MyOrg = { org_id: string; name: string; type: string; parent_name: string | null; roles: string[]; active: boolean }
export const ORG_TYPE: Record<string, string> = {
  ministry: 'Bộ', province: 'Tỉnh', department: 'Sở', district: 'Phòng', school: 'Trường', provider: 'Đơn vị cung cấp',
}
export type Access = {
  loading: boolean; profile: Profile | null; roles: MyRole[]; roleKeys: string[]; isAdmin: boolean
  orgs: MyOrg[]                            // các tổ chức có vai trò (để chuyển "đang làm việc tại")
  portals: RoleKey[]                       // các giao diện người dùng được vào (theo vai trò hệ thống và tuỳ chỉnh)
  canView: (module: string) => boolean     // được xem: có trong gói và vai trò được phép
  permitted: (module: string) => boolean   // vai trò được phép (không xét gói) — để hiện mờ mục chưa có trong gói
  entitled: (module: string) => boolean    // đơn vị được dùng chức năng này theo gói dịch vụ
  entitlement: Entitlement | null
  mfaRequired: boolean
  idleMinutes: number
}

const PORTAL_ORDER: RoleKey[] = ['platform', 'school_admin', 'teacher', 'student', 'department', 'parent', 'judge']

export function useAccess(session: Session | null): Access {
  const [state, setState] = useState<{ loading: boolean; profile: Profile | null; roles: MyRole[]; orgs: MyOrg[]; ent: Entitlement | null; mfa: boolean; idle: number }>({ loading: true, profile: null, roles: [], orgs: [], ent: null, mfa: false, idle: 0 })
  const [views, setViews] = useState<Set<string>>(new Set())
  const uid = session?.user.id

  useEffect(() => {
    if (!uid) { setState({ loading: false, profile: null, roles: [], orgs: [], ent: null, mfa: false, idle: 0 }); return }
    let live = true
    ;(async () => {
      const [p, r, o, e, m, st] = await Promise.all([
        supabase.from('profiles').select('id, org_id, full_name, locked_at, locked_reason').eq('id', uid).maybeSingle(),
        supabase.rpc('my_roles'),
        supabase.rpc('my_orgs'),   // chưa chạy migration 019 → lỗi, coi như chỉ một tổ chức
        supabase.rpc('my_entitlement'),   // chưa chạy migration 024 → lỗi, coi như không giới hạn
        supabase.rpc('mfa_required'),
        supabase.from('security_settings').select('idle_minutes').maybeSingle(),
      ])
      // CSDL chưa có cột khoá (trước 024): đọc lại hồ sơ không kèm cột đó
      const prof = p.error ? (await supabase.from('profiles').select('id, org_id, full_name').eq('id', uid).maybeSingle()).data : p.data
      const roles = (r.data as MyRole[]) ?? []
      // Quyền hiệu lực = mặc định hệ thống + ghi đè của trường (tính ở CSDL, cùng logic với RLS)
      const perms = roles.length ? (await supabase.rpc('my_permissions')).data ?? [] : []
      if (!live) return
      setViews(new Set(perms.filter((x: any) => x.can_view).map((x: any) => x.module)))
      setState({ loading: false, profile: (prof as Profile) ?? null, roles, orgs: o.error ? [] : (o.data as MyOrg[]) ?? [],
        ent: e.error ? null : (e.data as Entitlement) ?? null, mfa: !m.error && m.data === true, idle: (st.data as any)?.idle_minutes ?? 0 })
    })()
    return () => { live = false }
  }, [uid])

  const roleKeys = state.roles.map(r => r.key)
  const isAdmin = roleKeys.some(k => k === 'principal' || k === 'it_admin')
  const own = new Set<RoleKey>(PORTAL_ORDER.filter(p => state.roles.some(r => r.portal === p)))
  // Quản trị trường xem thử được mọi giao diện của trường; quản trị nền tảng xem được cổng quản lý trên toàn hệ thống
  if (isAdmin) (['school_admin', 'teacher', 'student', 'department'] as RoleKey[]).forEach(p => own.add(p))
  if (own.has('platform')) own.add('department')
  const portals = PORTAL_ORDER.filter(p => own.has(p))
  const ent = state.ent
  const entitled = (m: string) => !ent || ent.perm_modules === null || !ent.gated.includes(m) || ent.perm_modules.includes(m)
  return { loading: state.loading, profile: state.profile, roles: state.roles, orgs: state.orgs, roleKeys, isAdmin, portals,
    canView: m => entitled(m) && (isAdmin || views.has(m)), permitted: m => isAdmin || views.has(m), entitled, entitlement: ent, mfaRequired: state.mfa, idleMinutes: state.idle }
}

// Đổi tổ chức đang làm việc rồi tải lại để mọi quyền, menu, dữ liệu tính theo tổ chức mới
export async function switchOrg(orgId: string) {
  const { error } = await supabase.rpc('switch_org', { p_org: orgId })
  if (error) return error.message
  try { sessionStorage.clear() } catch { /* bỏ qua */ }
  window.location.reload()
  return null
}
