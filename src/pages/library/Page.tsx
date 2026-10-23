// Học liệu (Phân hệ 2) theo video demo (23/10): quy trình 3 bước (chỉ bước 1 cần nhập) · 4 thẻ số liệu ·
// tab Học liệu theo chương trình | Cần chuẩn bị theo chương trình | Danh mục học liệu | Kho học liệu dùng chung.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { LibraryByProgram, LibraryNeeds, usePrograms } from './ByProgram'
import { LibraryManage } from './Manage'
import { LibraryBrowse } from './Browse'

type Tab = 'prog' | 'needs' | 'catalog' | 'shared'
type Stats = { docs: number; tools: number; supplies: number; published: number; drafts: number; progsWithKit: number; needs: number }
const GUIDE_KEY = 'lib.guide.closed'

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
  const [closed, setClosed] = useState(() => { try { return localStorage.getItem(GUIDE_KEY) === '1' } catch { return false } })
  const [rk, setRk] = useState(0)
  const s = useStats(orgId, rk)
  const progs = usePrograms(orgId)
  const toggle = () => { setClosed(!closed); try { localStorage.setItem(GUIDE_KEY, closed ? '0' : '1') } catch { /* bỏ qua */ } }
  const steps: [Tab, string, string, string][] = [
    ['prog', 'Bước 01', 'Tải giáo án theo bài', 'Đi theo Chương trình → Môn → Bài học, tải giáo án Word hoặc bài giảng PowerPoint để tách thành bộ học liệu 4 thẻ.'],
    ['needs', 'Bước 02 · Tự tổng hợp', 'Cần chuẩn bị', 'Tự tổng hợp học liệu, thiết bị, vật tư cần có theo chương trình từ định mức của từng bài.'],
    ['catalog', 'Bước 03 · Tự tổng hợp', 'Danh mục học liệu', 'Danh mục tổng: tự tổng hợp mọi học liệu từ giáo án để tra cứu, lọc, đổi trạng thái và cập nhật ảnh đại diện.']]
  const n = (v: number | undefined) => (v == null ? '…' : v)
  const total = s ? s.docs + s.tools + s.supplies : undefined
  return (
    <>
      <div className="panel distintro libguide">
        <div className="bar small"><b className="libguide-h">Quy trình thao tác</b><button type="button" onClick={toggle}>{closed ? 'Mở rộng' : 'Thu gọn'}</button></div>
        {!closed && <>
          <ol className="distguide">{steps.map(([t, k, h, d], i) => <li key={t}>
            <button type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}><i>{i + 1}</i><span><small className="libstepk">{k}</small><b>{h}</b><small>{d}</small></span></button></li>)}</ol>
          <p className="sub" style={{ margin: 0 }}>Chỉ bước 1 cần nhập. Bước 2 và 3 tự tổng hợp từ bộ học liệu của các bài, không phải nhập lại.</p>
        </>}
      </div>
      <div className="diststatcards libstats">
        <div className="panel"><i aria-hidden="true">▤</i><span><b>{n(total)}</b><small>Học liệu</small><small>{s ? `${s.docs} tài liệu · ${s.tools} thiết bị · ${s.supplies} vật tư` : ''}</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{n(s?.published)}</b><small>Đã phát hành</small><small>{s ? `${s.drafts} bản nháp` : ''}</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">◎</i><span><b>{progs.length}</b><small>Chương trình đã gắn</small><small>{s ? `${Math.max(0, progs.length - s.progsWithKit)} chưa có học liệu` : ''}</small></span></div>
        <div className="panel"><i aria-hidden="true" className="warn">⬡</i><span><b>{n(s?.needs)}</b><small>Thiết bị, vật tư cần chuẩn bị</small></span></div>
      </div>
      <div className="distpills" role="tablist">
        {([['prog', 'Học liệu theo chương trình'], ['needs', 'Cần chuẩn bị theo chương trình'], ['catalog', 'Danh mục học liệu'], ['shared', 'Kho học liệu dùng chung']] as [Tab, string][]).map(([t, l]) =>
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>)}
      </div>
      {tab === 'prog' && <LibraryByProgram orgId={orgId} onChanged={() => setRk(k => k + 1)} />}
      {tab === 'needs' && <LibraryNeeds orgId={orgId} />}
      {tab === 'catalog' && <LibraryManage orgId={orgId} />}
      {tab === 'shared' && <LibraryBrowse orgId={orgId} teacherId={teacherId} go={go} />}
    </>
  )
}
