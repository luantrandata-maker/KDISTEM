// Lọc theo Tỉnh / Sở và trường (chọn nhiều) cho các bảng có cột trường: khoảng thiếu hụt, đáp ứng chương trình…
import { useMemo } from 'react'
import { useAllMode, useAllOrgs, useProvinceOf } from './OrgScope'
import { MultiFilters, opts, useMultiFilters, type FilterDef } from './MultiFilters'

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

/** Lọc Tỉnh / Sở + trường / đơn vị cho danh sách có org_id (thay ô "Mọi đơn vị" cũ, chọn nhiều).
 *  fit(id hoặc mảng id): khớp khi một trong các đơn vị khớp (vd. kế hoạch: đơn vị lập hoặc trường được giao).
 *  node(ids): các ô lọc, ẩn khi dữ liệu chỉ thuộc một đơn vị. one: id khi đang chọn đúng một đơn vị. */
export function useOrgFilter() {
  const mf = useMultiFilters()
  const provOf = useProvinceOf()
  const ctx = useAllMode(), loaded = useAllOrgs()
  const byId = useMemo(() => new Map((ctx ?? loaded ?? []).map(o => [o.id, o])), [ctx, loaded])
  const prov = (id: string) => provOf(id)?.id ?? ''
  const fit1 = (id: string, skip?: string) => (skip === 'prov' || mf.has('prov', prov(id))) && (skip === 'org' || mf.has('org', id))
  const fit = (ids: string | null | undefined | (string | null | undefined)[]) => {
    if (!mf.active) return true
    return [ids].flat().some(x => !!x && fit1(x))
  }
  const node = (ids: (string | null | undefined)[], onPick?: () => void) => {
    const xs = [...new Set(ids.filter((x): x is string => !!x))]
    if (xs.length < 2) return null
    const schools = xs.every(x => byId.get(x)?.type === 'school')
    const defs: FilterDef[] = [
      { key: 'prov', label: 'Tỉnh / Sở', placeholder: 'Mọi Tỉnh / Sở', onPick,
        options: opts(xs.filter(x => fit1(x, 'prov')).map(x => { const p = provOf(x); return [p?.id, p?.name] })) },
      { key: 'org', label: schools ? 'Trường' : 'Trường / đơn vị', placeholder: schools ? 'Mọi trường' : 'Mọi trường / đơn vị', onPick,
        options: opts(xs.filter(x => fit1(x, 'org')).map(x => [x, byId.get(x)?.name])) },
    ]
    return <MultiFilters defs={defs} f={mf} />
  }
  const sel = mf.get('org')
  return { fit, node, one: sel.length === 1 ? sel[0] : '', active: mf.active }
}
