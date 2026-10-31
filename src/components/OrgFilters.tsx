// Lọc theo Tỉnh / Sở và trường (chọn nhiều) cho các bảng có cột trường: khoảng thiếu hụt, đáp ứng chương trình…
import { useProvinceOf } from './OrgScope'
import { opts, type FilterDef, type useMultiFilters } from './MultiFilters'

type R = { org_id: string; org_name: string | null }
/** defs: ô lọc Tỉnh / Sở và Trường (ẩn khi chỉ có một trường); fit(org_id): dòng khớp hai bộ lọc */
export function useOrgFilters(rows: R[], mf: ReturnType<typeof useMultiFilters>) {
  const provOf = useProvinceOf()
  const prov = (id: string) => provOf(id)?.id ?? ''
  const fit = (id: string, skip?: string) => (skip === 'prov' || mf.has('prov', prov(id))) && (skip === 'school' || mf.has('school', id))
  const multi = new Set(rows.map(r => r.org_id)).size > 1
  const defs: FilterDef[] = [
    { key: 'prov', label: 'Tỉnh / Sở', placeholder: 'Mọi Tỉnh / Sở', hidden: !multi,
      options: opts(rows.filter(r => fit(r.org_id, 'prov')).map(r => { const p = provOf(r.org_id); return [p?.id, p?.name] })) },
    { key: 'school', label: 'Trường', placeholder: 'Mọi trường', hidden: !multi,
      options: opts(rows.filter(r => fit(r.org_id, 'school')).map(r => [r.org_id, r.org_name])) },
  ]
  return { defs, fit: (id: string) => fit(id), multi }
}
