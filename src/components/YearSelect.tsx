// Chọn năm học từ danh sách thay cho gõ tay: các năm học đã khai báo (academic_years) cộng năm trước, năm nay và hai năm tới.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { schoolYear } from '../pages/department/Governance'

let cache: Promise<string[]> | null = null
function declared() {
  cache ??= Promise.resolve(supabase.from('academic_years').select('name').then(({ data }) =>
    [...new Set(((data ?? []) as { name: string }[]).map(r => r.name?.trim()).filter(n => /^\d{4}-\d{4}$/.test(n ?? '')))] as string[]))
  return cache
}
/** Năm trước, năm nay, hai năm tới (VD: 2025-2026 … 2028-2029). */
function around() {
  const s = +schoolYear().slice(0, 4)
  return [s - 1, s, s + 1, s + 2].map(a => `${a}-${a + 1}`)
}

export function YearSelect({ value, onChange, emptyLabel, ariaLabel = 'Năm học', disabled }: {
  value: string; onChange: (v: string) => void; emptyLabel?: string; ariaLabel?: string; disabled?: boolean
}) {
  const [names, setNames] = useState<string[]>(around())
  useEffect(() => { let on = true; declared().then(d => { if (on) setNames(n => [...new Set([...n, ...d])]) }); return () => { on = false } }, [])
  const list = [...new Set([...names, ...(value ? [value] : [])])].sort().reverse()
  return <select value={value} disabled={disabled} aria-label={ariaLabel} onChange={e => onChange(e.target.value)}>
    {emptyLabel != null && <option value="">{emptyLabel}</option>}
    {list.map(y => <option key={y} value={y}>{y}{y === schoolYear() ? ' (năm nay)' : ''}</option>)}
  </select>
}
