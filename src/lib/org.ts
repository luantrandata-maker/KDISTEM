import { supabase } from './supabase'
let cached: string | null = null
export async function myOrgId(): Promise<string> {
  if (cached) return cached
  const { data: u } = await supabase.auth.getUser()
  const { data } = await supabase.from('profiles').select('org_id').eq('id', u.user!.id).single()
  cached = data!.org_id as string
  return cached
}
