import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { RoleKey } from './nav'

export type Profile = { id: string; org_id: string | null; full_name: string }
export type MyRole = { role_id: string; key: string; name: string; portal: RoleKey | null }
export type Access = {
  loading: boolean; profile: Profile | null; roles: MyRole[]; roleKeys: string[]; isAdmin: boolean
  portals: RoleKey[]                       // các giao diện người dùng được vào (theo vai trò hệ thống và tuỳ chỉnh)
  canView: (module: string) => boolean
}

const PORTAL_ORDER: RoleKey[] = ['school_admin', 'teacher', 'student', 'department']

export function useAccess(session: Session | null): Access {
  const [state, setState] = useState<{ loading: boolean; profile: Profile | null; roles: MyRole[] }>({ loading: true, profile: null, roles: [] })
  const [views, setViews] = useState<Set<string>>(new Set())
  const uid = session?.user.id

  useEffect(() => {
    if (!uid) { setState({ loading: false, profile: null, roles: [] }); return }
    let live = true
    ;(async () => {
      const [p, r] = await Promise.all([
        supabase.from('profiles').select('id, org_id, full_name').eq('id', uid).maybeSingle(),
        supabase.rpc('my_roles'),
      ])
      const roles = (r.data as MyRole[]) ?? []
      // Quyền hiệu lực = mặc định hệ thống + ghi đè của trường (tính ở CSDL, cùng logic với RLS)
      const perms = roles.length ? (await supabase.rpc('my_permissions')).data ?? [] : []
      if (!live) return
      setViews(new Set(perms.filter((x: any) => x.can_view).map((x: any) => x.module)))
      setState({ loading: false, profile: (p.data as Profile) ?? null, roles })
    })()
    return () => { live = false }
  }, [uid])

  const roleKeys = state.roles.map(r => r.key)
  const isAdmin = roleKeys.some(k => k === 'principal' || k === 'it_admin')
  const portals = isAdmin ? PORTAL_ORDER : PORTAL_ORDER.filter(p => state.roles.some(r => r.portal === p))
  return { ...state, roleKeys, isAdmin, portals, canView: m => isAdmin || views.has(m) }
}
