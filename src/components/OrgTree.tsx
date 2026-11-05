// Cây lọc bên trái: Tất cả → Tỉnh / Sở → Trường, kèm số dòng ở mỗi mục (như danh bạ nhân viên).
// Dùng: const t = useOrgTree(orgIdCủaTừngDòng); <div className="treelayout">{t.side}<div>…bảng lọc theo t.fit(org_id)…</div></div>
import { useMemo, useState } from 'react'
import { useAllMode, useAllOrgs, useProvinceOf, type ScopeOrg } from './OrgScope'

export function useOrgTree(rowOrgs: (string | null | undefined)[]) {
  const provOf = useProvinceOf()
  const ctx = useAllMode(), loaded = useAllOrgs()
  const byId = useMemo(() => new Map(((ctx ?? loaded ?? []) as ScopeOrg[]).map(o => [o.id, o])), [ctx, loaded])
  const [sel, setSel] = useState('')          // '' | 'p:<tỉnh/sở>' | 'o:<trường>'
  const [open, setOpen] = useState<Set<string>>(new Set())
  const key = rowOrgs.join(',')
  const groups = useMemo(() => {
    const per = new Map<string, number>()
    rowOrgs.forEach(id => { if (id) per.set(id, (per.get(id) ?? 0) + 1) })
    const g = new Map<string, { id: string; name: string; n: number; orgs: { id: string; name: string; n: number }[] }>()
    per.forEach((n, id) => {
      const p = provOf(id), pid = p?.id ?? '-'
      const x = g.get(pid) ?? { id: pid, name: p?.name ?? 'Khác', n: 0, orgs: [] }
      x.n += n; x.orgs.push({ id, name: byId.get(id)?.name ?? '…', n }); g.set(pid, x)
    })
    return [...g.values()].map(x => ({ ...x, orgs: x.orgs.sort((a, b) => a.name.localeCompare(b.name, 'vi')) })).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  }, [key, provOf, byId]) // eslint-disable-line react-hooks/exhaustive-deps
  const provOfRow = useMemo(() => new Map(groups.flatMap(g => g.orgs.map(o => [o.id, g.id] as const))), [groups])
  const fit = (id: string | null | undefined) => !sel || (sel.startsWith('p:') ? provOfRow.get(id ?? '') === sel.slice(2) : id === sel.slice(2))
  const total = rowOrgs.filter(Boolean).length
  const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const side = <nav className="orgtree" aria-label="Lọc theo Tỉnh / Sở và trường">
    <button type="button" className={'otrow' + (!sel ? ' on' : '')} onClick={() => setSel('')}><span>Tất cả</span><b>{total}</b></button>
    {/* Chỉ một Tỉnh / Sở: liệt kê thẳng các trường; nhiều Tỉnh / Sở: thêm một lớp Tỉnh / Sở */}
    {groups.length === 1 ? groups[0].orgs.map(o => <button key={o.id} type="button" className={'otrow otsub' + (sel === 'o:' + o.id ? ' on' : '')} onClick={() => setSel('o:' + o.id)} title={o.name}>
      <span>{o.name}</span><b>{o.n}</b></button>) : groups.map(g => <div key={g.id}>
      <div className={'otrow' + (sel === 'p:' + g.id ? ' on' : '')}>
        <button type="button" className="otcaret" aria-label={open.has(g.id) ? 'Thu gọn' : 'Mở rộng'} aria-expanded={open.has(g.id)} onClick={() => toggle(g.id)}>{open.has(g.id) ? '▾' : '▸'}</button>
        <button type="button" className="otname" onClick={() => { setSel('p:' + g.id); setOpen(s => new Set(s).add(g.id)) }}><span>{g.name}</span><b>{g.n}</b></button>
      </div>
      {open.has(g.id) && g.orgs.map(o => <button key={o.id} type="button" className={'otrow otsub' + (sel === 'o:' + o.id ? ' on' : '')} onClick={() => setSel('o:' + o.id)} title={o.name}>
        <span>{o.name}</span><b>{o.n}</b></button>)}
    </div>)}
  </nav>
  return { side, fit, sel, clear: () => setSel('') }
}
