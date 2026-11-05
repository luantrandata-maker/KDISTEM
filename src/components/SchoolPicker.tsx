// Chọn trường khi có rất nhiều trường (vd. 2.200 trường TP.HCM): chọn Tỉnh / Sở trước, rồi gõ để tìm trường.
// Dùng ở mọi chỗ KDI gán cho trường. Tỉnh / Sở của một đơn vị lấy theo cây đơn vị (useProvinceOf).
import { useMemo, useState } from 'react'
import { MultiSelect } from './MultiSelect'
import { useProvinceOf } from './OrgScope'

export type PickOpt = { id: string; name: string; note?: string | null }

/** Lọc theo Tỉnh / Sở cho một danh sách đơn vị: trả về ô chọn Tỉnh / Sở và danh sách đã lọc */
export function useRegionFilter<T extends { id: string }>(items: T[], keep: string[] = []) {
  const provOf = useProvinceOf()
  const [region, setRegion] = useState('')
  const { regions, regionOf } = useMemo(() => {
    const regionOf = new Map<string, string>(), names = new Map<string, string>()
    for (const it of items) { const r = provOf(it.id); if (r) { regionOf.set(it.id, r.id); names.set(r.id, r.name) } }
    const count = new Map<string, number>()
    regionOf.forEach(r => count.set(r, (count.get(r) ?? 0) + 1))
    const regions = [...names].map(([id, name]) => ({ id, name, n: count.get(id) ?? 0 })).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
    return { regions, regionOf }
  }, [items, provOf])
  const shown = useMemo(() => region ? items.filter(it => regionOf.get(it.id) === region || keep.includes(it.id)) : items,
    [items, region, regionOf, keep.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const select = regions.length > 0
    ? <select value={region} onChange={e => setRegion(e.target.value)} aria-label="Tỉnh / Sở" className="regionsel">
        <option value="">Tất cả Tỉnh / Sở ({items.length})</option>
        {regions.map(r => <option key={r.id} value={r.id}>{r.name} ({r.n})</option>)}
      </select>
    : null
  return { region, setRegion, regionOf, regions, shown, select }
}

/**
 * Ô chọn trường: Tỉnh / Sở bên trái, ô tìm và chọn trường bên phải.
 * `single`: chỉ chọn một trường (value có 0 hoặc 1 phần tử).
 */
export function SchoolPicker({ options, value, onChange, single, placeholder, ariaLabel = 'Trường', empty = 'Không có trường nào trong phạm vi.', disabled, style }: {
  options: PickOpt[]; value: string[]; onChange: (v: string[]) => void; single?: boolean
  placeholder?: string; ariaLabel?: string; empty?: string; disabled?: boolean; style?: React.CSSProperties
}) {
  const { shown, select } = useRegionFilter(options, value)
  return <div className="schoolpicker" style={style}>
    {select}
    <MultiSelect value={value} onChange={onChange} single={single} disabled={disabled} ariaLabel={ariaLabel} empty={empty}
      placeholder={placeholder ?? (single ? 'Gõ để tìm trường…' : 'Gõ để tìm, chọn trường…')}
      options={shown.map(o => [o.id, o.note ? `${o.name} · ${o.note}` : o.name])} />
  </div>
}
