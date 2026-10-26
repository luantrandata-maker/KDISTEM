// Lịch tham chiếu của bản phân phối (095): tuần học có ngày thật và ngày nghỉ, theo "Chuẩn chung" (lịch KDI)
// hoặc lịch của đơn vị đang làm việc. Tuần của bản phân phối = tuần học (tuần nghỉ trọn 5 ngày không tính).
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { myOrgId } from '../../lib/org'

export type Hol = { id: string; name: string; starts_on: string; ends_on: string; status: string; kind: string; std: boolean; skipped: boolean; org_name: string; note: string | null; source: string | null }
export type CalWeek = { week: number; term: number; starts_on: string; ends_on: string; off_days: number; holidays: Hol[] }
export type CalSrc = { id: string; label: string }

export const vnd = (d: string) => d.split('-').reverse().join('/')
export const vnShort = (d: string) => d.slice(8, 10) + '/' + d.slice(5, 7)
export const WEEKDAY = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']
export const dayOf = (d: string) => new Date(d + 'T00:00:00').getDay()
export const addD = (d: string, n: number) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10) }
/** Số ngày học (Thứ Hai – Thứ Sáu) của ngày nghỉ rơi trong tuần */
export function offIn(h: { starts_on: string; ends_on: string }, from: string, to: string) {
  let n = 0
  for (let d = h.starts_on < from ? from : h.starts_on; d <= (h.ends_on > to ? to : h.ends_on); d = addD(d, 1)) { const w = dayOf(d); if (w >= 1 && w <= 5) n++ }
  return n
}

/** Năm học mặc định: năm học đang diễn ra, không có thì năm gần nhất sau hôm nay. */
function pickYear(names: string[]) {
  const t = new Date(), y = t.getMonth() >= 7 ? t.getFullYear() : t.getFullYear() - 1
  const cur = `${y}-${y + 1}`
  return names.includes(cur) ? cur : names.find(n => n > cur) ?? names[names.length - 1] ?? ''
}

export function useDistCalendar() {
  const [srcs, setSrcs] = useState<CalSrc[]>([])
  const [src, setSrc] = useState('')
  const [years, setYears] = useState<string[]>([])
  const [year, setYear] = useState('')
  const [weeks, setWeeks] = useState<Map<number, CalWeek>>(new Map())
  const [state, setState] = useState<'loading' | 'ok' | 'none' | 'missing'>('loading')

  useEffect(() => {
    (async () => {
      const [{ data: std, error }, me] = await Promise.all([supabase.rpc('platform_org_id'), myOrgId().catch(() => '')])
      if (error) { setState('missing'); return }
      const list: CalSrc[] = std ? [{ id: std as string, label: 'Chuẩn chung' }] : []
      if (me && me !== std) {
        const { data: o } = await supabase.from('organizations').select('name').eq('id', me).maybeSingle()
        list.push({ id: me, label: 'Lịch của ' + ((o as { name: string } | null)?.name ?? 'đơn vị') })
      }
      setSrcs(list); setSrc(list[list.length - 1]?.id ?? '')
    })()
  }, [])
  useEffect(() => {
    if (!src) return
    supabase.rpc('calendar_years', { p_org: src }).then(({ data }) => {
      const ns = ((data as { name: string }[]) ?? []).map(x => x.name)
      setYears(ns); setYear(y => ns.includes(y) ? y : pickYear(ns))
      if (!ns.length) setState('none')
    })
  }, [src])
  useEffect(() => {
    if (!src || !year) return
    setState('loading')
    ;(async () => {
      const { data: c } = await supabase.rpc('curriculum_calendar', { p_org: src, p_year: year })
      const rows = ((c as { week: number | null; term: number; starts_on: string; ends_on: string; off_days: number }[]) ?? [])
      if (!rows.length) { setWeeks(new Map()); setState('none'); return }
      const { data: h } = await supabase.rpc('effective_holidays', { p_org: src, p_from: rows[0].starts_on, p_to: rows[rows.length - 1].ends_on })
      const hols = ((h as Hol[]) ?? []).filter(x => !x.skipped)
      const m = new Map<number, CalWeek>()
      for (const r of rows) if (r.week != null) m.set(r.week, { week: r.week, term: r.term, starts_on: r.starts_on, ends_on: r.ends_on, off_days: r.off_days,
        holidays: hols.filter(x => x.starts_on <= r.ends_on && x.ends_on >= r.starts_on) })
      setWeeks(m); setState('ok')
    })()
  }, [src, year])
  const label = srcs.find(x => x.id === src)?.label ?? ''
  return { srcs, src, setSrc, years, year, setYear, weeks, state, label }
}
export type DistCal = ReturnType<typeof useDistCalendar>
