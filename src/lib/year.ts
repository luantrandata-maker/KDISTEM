import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Một dòng academic_years = một học kỳ của một năm học (vd 2026-2027 · HK I).
export type Year = { id: string; name: string; term: string; starts_on: string | null; ends_on: string | null; is_current: boolean }

export const yearLabel = (y: Year | null | undefined) => (y ? `${y.name} · ${y.term}` : 'Chưa có năm học')

// Lớp / phân công thuộc cả năm học (gắn với một học kỳ bất kỳ của năm đó); TKB thuộc từng học kỳ.
export const sameSchoolYear = (years: Year[], yearId: string | null | undefined, selected: Year | null) =>
  !selected || !yearId || years.find(y => y.id === yearId)?.name === selected.name

const key = (orgId: string) => 'year.' + orgId

// Năm học đang chọn ở đầu menu: nhớ theo trình duyệt, mặc định là học kỳ hiện tại của trường
export function useYears(orgId: string | null | undefined) {
  const [years, setYears] = useState<Year[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  async function reload() {
    if (!orgId) return
    const { data } = await supabase.from('academic_years').select('id, name, term, starts_on, ends_on, is_current')
      .eq('org_id', orgId).order('name', { ascending: false }).order('term')
    const ys = (data as Year[]) ?? []
    setYears(ys)
    let saved: string | null = null
    try { saved = localStorage.getItem(key(orgId)) } catch { /* bỏ qua */ }
    setSelectedId(cur => {
      const want = cur ?? saved
      return ys.some(y => y.id === want) ? want : ys.find(y => y.is_current)?.id ?? ys[0]?.id ?? null
    })
  }
  useEffect(() => { reload() }, [orgId])

  function select(id: string) {
    setSelectedId(id)
    try { if (orgId) localStorage.setItem(key(orgId), id) } catch { /* bỏ qua */ }
  }
  const year = years.find(y => y.id === selectedId) ?? null
  return { years, year, select, reload }
}
