// Ngày nghỉ hiệu lực của một đơn vị (095: effective_holidays — lịch chuẩn chung + ngày nghỉ riêng, bỏ ngày đơn vị đã bỏ qua).
// Dùng để cảnh báo buổi học / buổi tập huấn rơi vào ngày nghỉ, như khi xếp lịch bản phân phối chương trình.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

export type Holiday = { id: string; name: string; starts_on: string; ends_on: string; org_name: string; skipped: boolean }
const pad = (n: number) => String(n).padStart(2, '0')
/** Ngày 'YYYY-MM-DD' theo giờ máy */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return dayKey(d) }

const cache = new Map<string, Promise<Holiday[]>>()
function load(org: string) {
  let p = cache.get(org)
  if (!p) {
    p = Promise.resolve(supabase.rpc('effective_holidays', { p_org: org, p_from: shift(-500), p_to: shift(900) })
      .then(({ data, error }) => (error ? [] : ((data as Holiday[]) ?? []).filter(h => !h.skipped))))
    cache.set(org, p)
  }
  return p
}

/** Ngày nghỉ của đơn vị: holOn('2026-09-02') → các ngày nghỉ rơi vào ngày đó. */
export function useHolidays(org: string | null | undefined) {
  const [list, setList] = useState<Holiday[]>([])
  useEffect(() => { if (!org) { setList([]); return } let on = true; load(org).then(h => { if (on) setList(h) }); return () => { on = false } }, [org])
  return useMemo(() => {
    const holOn = (d: string) => (d ? list.filter(h => h.starts_on <= d && h.ends_on >= d) : [])
    const holName = (d: string) => holOn(d).map(h => h.name).join(', ')
    return { list, holOn, holName }
  }, [list])
}
export type Holidays = ReturnType<typeof useHolidays>
