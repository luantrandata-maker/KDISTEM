// Thanh lọc chọn nhiều dùng chung (27/10): mỗi bộ lọc là một ô MultiSelect, rỗng = tất cả; nút "Bỏ lọc" khi đang lọc.
import { useState } from 'react'
import { MultiSelect, type MsOption } from './MultiSelect'

export type FilterDef = { key: string; label: string; placeholder: string; options: MsOption[]; hidden?: boolean; onPick?: (v: string[]) => void }
export type FilterVals = Record<string, string[]>

/** Giữ giá trị các bộ lọc; has(k, v) = khớp (bộ lọc rỗng thì luôn khớp); any(k, vs) = một trong các giá trị khớp */
export function useMultiFilters() {
  const [vals, setVals] = useState<FilterVals>({})
  const get = (k: string) => vals[k] ?? []
  const set = (k: string, v: string[]) => setVals(o => ({ ...o, [k]: v }))
  const has = (k: string, v: string | number | null | undefined) => !get(k).length || get(k).includes(String(v ?? ''))
  const any = (k: string, vs: (string | number | null | undefined)[]) => !get(k).length || vs.some(v => get(k).includes(String(v ?? '')))
  const active = Object.values(vals).some(v => v.length > 0)
  return { vals, get, set, has, any, active, clear: () => setVals({}) }
}

const MS = { width: 168, flex: '0 0 168px' }
/** Các ô lọc; đặt trong .tools của thanh công cụ */
export function MultiFilters({ defs, f, count }: { defs: FilterDef[]; f: ReturnType<typeof useMultiFilters>; count?: string }) {
  return <>
    {defs.filter(d => !d.hidden).map(d => <MultiSelect key={d.key} value={f.get(d.key)} onChange={v => { f.set(d.key, v); d.onPick?.(v) }}
      options={d.options} placeholder={d.placeholder} ariaLabel={d.label} style={MS} compact />)}
    {f.active && <button type="button" className="fclear" onClick={f.clear}>Bỏ lọc</button>}
    {count && <small className="sub">{count}</small>}
  </>
}

/** Các lựa chọn không trùng, sắp theo nhãn */
export const opts = (xs: [string | number | null | undefined, string | null | undefined][], sort: 'label' | 'none' | 'desc' = 'label'): MsOption[] => {
  const m = new Map<string, string>()
  for (const [v, l] of xs) if (v != null && v !== '') m.set(String(v), l || String(v))
  const out = [...m.entries()]
  if (sort === 'label') out.sort((a, b) => a[1].localeCompare(b[1], 'vi', { numeric: true }))
  if (sort === 'desc') out.sort((a, b) => b[1].localeCompare(a[1], 'vi', { numeric: true }))
  return out
}
