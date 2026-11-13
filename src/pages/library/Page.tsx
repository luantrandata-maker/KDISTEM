// Học liệu (Phân hệ 2) theo video demo (23/10): quy trình 3 bước (chỉ bước 1 cần nhập) · 4 thẻ số liệu ·
// tab Học liệu theo chương trình (nút Cần chuẩn bị: theo chương trình hoặc theo trường) | Danh mục học liệu (lọc Nguồn: của đơn vị / dùng chung / tất cả).
import { useEffect, useState } from 'react'
import { HeadTabs } from '../../components/PageFrame'
import { DetailHead } from '../../components/DetailHead'
import { supabase } from '../../lib/supabase'
import { LibraryByProgram, LibraryNeeds, usePrograms } from './ByProgram'
import { LibraryManage, type LibSrc } from './Manage'
import { AllOrgs } from '../../components/OrgScope'
import { StatCards } from '../../components/StatCards'

type Tab = 'prog' | 'needs' | 'catalog'
type Stats = { docs: number; tools: number; supplies: number; published: number; drafts: number; progsWithKit: number; needs: number }

function useStats(orgId: string | null, rk: number) {
  const [s, setS] = useState<Stats | null>(null)
  useEffect(() => {
    if (!orgId) return
    ;(async () => {
      const [items, cat, norms] = await Promise.all([
        supabase.from('library_items').select('id, kind, status, program_id').eq('owner_org_id', orgId),
        supabase.from('material_catalog').select('id, kind, active').eq('org_id', orgId),
        supabase.from('material_norms').select('library_item_id, status, material_norm_items(name, unit)').eq('org_id', orgId).not('library_item_id', 'is', null).in('status', ['draft', 'published']),
      ])
      const its = (items.data ?? []) as { id: string; kind: string; status: string; program_id: string | null }[]
      const docs = its.filter(i => i.kind === 'material' || i.kind === 'lesson')
      const cs = (cat.data ?? []) as { kind: string; active: boolean }[]
      const names = new Set<string>()
      for (const n of (norms.data ?? []) as { material_norm_items: { name: string; unit: string }[] }[]) n.material_norm_items.forEach(i => names.add(i.name.trim().toLowerCase() + '|' + i.unit))
      setS({
        docs: docs.length, tools: cs.filter(c => c.kind !== 'supply').length, supplies: cs.filter(c => c.kind === 'supply').length,
        published: docs.filter(d => d.status === 'published').length + cs.filter(c => c.active).length, drafts: docs.filter(d => d.status === 'draft').length,
        progsWithKit: new Set(its.filter(i => i.kind === 'unit' && i.program_id).map(i => i.program_id)).size, needs: names.size,
      })
    })()
  }, [orgId, rk])
  return s
}

export function LibraryPage({ orgId, teacherId, go }: { orgId: string | null; teacherId?: string | null; go?: (p: string) => void }) {
  const [tab, setTab] = useState<Tab>('prog')
  const [rk, setRk] = useState(0)
  // Nguồn của Danh mục học liệu; "Tất cả đơn vị" mở danh sách của mọi đơn vị (thay tab "Học liệu các đơn vị")
  const [src, setSrc] = useState<LibSrc>('own')
  const s = useStats(orgId, rk)
  const progs = usePrograms(orgId)
  const n = (v: number | undefined) => (v == null ? '…' : v)
  const total = s ? s.docs + s.tools + s.supplies : undefined
  return (
    <>
      {/* Thẻ tổng số của cả mục; bấm thẻ để mở tab tương ứng */}
      <StatCards nav onPick={k => k && setTab(k as Tab)} items={[
        { k: 'catalog', icon: 'folders', value: n(total), label: 'Học liệu', sub: s ? `${s.docs} tài liệu · ${s.tools} thiết bị · ${s.supplies} vật tư` : '' },
        { k: 'catalog', icon: 'checkCircle', tone: 'good', value: n(s?.published), label: 'Đã phát hành', sub: s ? `${s.drafts} bản nháp` : '' },
        { k: 'prog', icon: 'book', tone: 'good', value: progs.length, label: 'Chương trình đã gắn', sub: s ? `${Math.max(0, progs.length - s.progsWithKit)} chưa có học liệu` : '' },
        { k: 'needs', icon: 'package', tone: 'warn', value: n(s?.needs), label: 'Thiết bị, vật tư cần chuẩn bị' },
      ]} />
      <HeadTabs><div className="distpills" role="tablist">
        {/* Cần chuẩn bị: mở bằng nút trên thanh công cụ của tab Học liệu theo chương trình (hoặc thẻ số liệu) */}
        {([['prog', 'Học liệu theo chương trình'], ['catalog', 'Danh mục học liệu']] as [Tab, string][]).map(([t, l]) => { const on = tab === t || (t === 'prog' && tab === 'needs')
          return <button key={t} type="button" role="tab" aria-selected={on} className={on ? 'on' : ''} onClick={() => setTab(t)}>{l}</button> })}
      </div></HeadTabs>
      {tab === 'prog' && <LibraryByProgram orgId={orgId} onChanged={() => setRk(k => k + 1)} tools={<button type="button" title="Thiết bị, vật tư cần chuẩn bị theo chương trình" onClick={() => setTab('needs')}>📦 Cần chuẩn bị</button>} />}
      {tab === 'needs' && <><DetailHead back="Học liệu theo chương trình" onBack={() => setTab('prog')} title="Cần chuẩn bị" /><LibraryNeeds orgId={orgId} /></>}
      {tab === 'catalog' && (src === 'units'
        ? <AllOrgs><LibraryManage key="units" orgId={orgId} sources src={src} onSrc={setSrc} onChanged={() => setRk(k => k + 1)} /></AllOrgs>
        : <LibraryManage key="mine" orgId={orgId} sources src={src} onSrc={setSrc} onChanged={() => setRk(k => k + 1)} />)}
    </>
  )
}
