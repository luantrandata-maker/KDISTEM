import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Profile = { id: string; org_id: string | null; full_name: string }
export type Access = {
  loading: boolean; profile: Profile | null; roleKeys: string[]; isAdmin: boolean
  canView: (module: string) => boolean
}

export function useAccess(session: Session | null): Access {
  const [state, setState] = useState<Omit<Access, 'canView' | 'isAdmin'>>({ loading: true, profile: null, roleKeys: [] })
  const [views, setViews] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!session) { setState({ loading: false, profile: null, roleKeys: [] }); return }
    let live = true
    ;(async () => {
      const uid = session.user.id
      const [p, r] = await Promise.all([
        supabase.from('profiles').select('id, org_id, full_name').eq('id', uid).maybeSingle(),
        supabase.from('user_roles').select('role_id, roles(key)').eq('user_id', uid),
      ])
      const rows = (r.data as unknown as { role_id: string; roles: { key: string } | null }[]) ?? []
      // Quyền hiệu lực = mặc định hệ thống + ghi đè của trường (tính ở CSDL, cùng logic với RLS)
      const perms = rows.length ? (await supabase.rpc('my_permissions')).data ?? [] : []
      if (!live) return
      setViews(new Set(perms.filter((x: any) => x.can_view).map((x: any) => x.module)))
      setState({ loading: false, profile: (p.data as Profile) ?? null, roleKeys: rows.map(x => x.roles?.key ?? '') })
    })()
    return () => { live = false }
  }, [session])

  const isAdmin = state.roleKeys.some(k => k === 'principal' || k === 'it_admin')
  return { ...state, isAdmin, canView: m => isAdmin || views.has(m) }
}
