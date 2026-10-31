// Lọc theo Tỉnh / Sở và trường (chọn nhiều). Lựa chọn gồm mọi trường người dùng thấy (cả khi chưa có dữ liệu) và các đơn vị có trong dữ liệu;
// ô lọc chỉ ẩn khi người dùng chỉ thấy một trường (vd. tài khoản trường).
import { useMemo } from 'react'
import { useAllMode, useAllOrgs, useProvinceOf, type ScopeOrg } from './OrgScope'
import { MultiFilters, opts, useMultiFilters, type FilterDef } from './MultiFilters'

function useOrgCandidates() {
  const ctx = useAllMode(), loaded = useAllOrgs()
  const list = (ctx ?? loaded ?? []) as ScopeOrg[]
  const byId = useMemo(() => new Map(list.map(o => [o.id, o])), [list])
  const schools = useMemo(() => list.filter(o => o.type === 'school' && !o.is_platform).map(o => o.id), [list])
  return { byId, schools }
}

type R = { org_id: string; org_name: string | null }
/** defs: ô lọc Tỉnh / Sở và Trường; fit(org_id): dòng khớp hai bộ lọc */
export function useOrgFilters(rows: R[], mf: ReturnType<typeof useMultiFilters>) {
  const provOf = useProvinceOf()
  const { byId, schools } = useOrgCandidates()
  const prov = (id: string) => provOf(id)?.id ?? ''
  const fit = (id: string, skip?: string) => (skip === 'prov' || mf.has('prov', prov(id))) && (skip === 'school' || mf.has('school', id))
  const names = new Map<string, string>(rows.map(r => [r.org_id, r.org_name ?? '']))
  const xs = [...new Set([...rows.map(r => r.org_id), ...schools])]
  const multi = xs.length > 1
  const defs: FilterDef[] = [
    { key: 'prov', label: 'Tỉnh / Sở', placeholder: 'Mọi Tỉnh / Sở', hidden: !multi,
      options: opts(xs.filter(x => fit(x, 'prov')).map(x => { const p = provOf(x); return [p?.id, p?.name] })) },
    { key: 'school', label: 'Trường', placeholder: 'Mọi trường', hidden: !multi,
      options: opts(xs.filter(x => fit(x, 'school')).map(x => [x, names.get(x) || byId.get(x)?.name])) },
  ]
  return { defs, fit: (id: string) => fit(id), multi }
}

/** Lọc Tỉnh / Sở + trường / đơn vị cho danh sách có org_id (chọn nhiều).
 *  fit(id hoặc mảng id): khớp khi một trong các đơn vị khớp (vd. kế hoạch: đơn vị lập hoặc trường được giao).
 *  node(ids): các ô lọc. one: id khi đang chọn đúng một đơn vị. */
export function useOrgFilter() {
  const mf = useMultiFilters()
  const provOf = useProvinceOf()
  const { byId, schools } = useOrgCandidates()
  const prov = (id: string) => provOf(id)?.id ?? ''
  const fit1 = (id: string, skip?: string) => (skip === 'prov' || mf.has('prov', prov(id))) && (skip === 'org' || mf.has('org', id))
  const fit = (ids: string | null | undefined | (string | null | undefined)[]) => {
    if (!mf.active) return true
    return [ids].flat().some(x => !!x && fit1(x))
  }
  const node = (ids: (string | null | undefined)[], onPick?: () => void) => {
    const own = [...new Set(ids.filter((x): x is string => !!x))]
    const xs = [...new Set([...own, ...schools])]
    if (xs.length < 2) return null
    const onlySchools = own.every(x => byId.get(x)?.type === 'school')
    const defs: FilterDef[] = [
      { key: 'prov', label: 'Tỉnh / Sở', placeholder: 'Mọi Tỉnh / Sở', onPick,
        options: opts(xs.filter(x => fit1(x, 'prov')).map(x => { const p = provOf(x); return [p?.id, p?.name] })) },
      { key: 'org', label: onlySchools ? 'Trường' : 'Trường / đơn vị', placeholder: onlySchools ? 'Mọi trường' : 'Mọi trường / đơn vị', onPick,
        options: opts(xs.filter(x => fit1(x, 'org')).map(x => [x, byId.get(x)?.name])) },
    ]
    return <MultiFilters defs={defs} f={mf} />
  }
  const sel = mf.get('org')
  return { fit, node, one: sel.length === 1 ? sel[0] : '', active: mf.active }
}
