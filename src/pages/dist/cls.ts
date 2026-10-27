import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Khung phân loại: bản phân phối (082: Cấp học › Khối lớp › Mức độ…) và kế hoạch tập huấn (101: Cấp học › Cấp độ…).
export type ClsLevel = { id: string; name: string; kind: 'subject' | 'level' | 'grade' | 'tier' | 'custom'; sort: number; active: boolean }
export type ClsNode = { id: string; cls_level_id: string; parent_id: string | null; name: string; sort: number; edu_level?: string | null }
export type ClsScope = 'dist' | 'training'
export const CLS_TABLES: Record<ClsScope, { levels: string; nodes: string }> = {
  dist: { levels: 'dist_cls_levels', nodes: 'dist_nodes' }, training: { levels: 'training_cls_levels', nodes: 'training_nodes' },
}
type Data = { levels: ClsLevel[]; nodes: ClsNode[] }

const cache: Partial<Record<ClsScope, Data>> = {}
const subs: Record<ClsScope, Set<(d: Data) => void>> = { dist: new Set(), training: new Set() }
async function load(scope: ClsScope) {
  const t = CLS_TABLES[scope]
  const [lv, nd] = await Promise.all([
    supabase.from(t.levels).select('id, name, kind, sort, active').order('sort'),
    supabase.from(t.nodes).select('id, cls_level_id, parent_id, name, sort, edu_level').order('sort').order('name'),
  ])
  const d = cache[scope] = { levels: (lv.data as ClsLevel[]) ?? [], nodes: (nd.data as ClsNode[]) ?? [] }
  subs[scope].forEach(f => f(d))
}

/** Đọc khung phân loại; reload() tải lại cho mọi nơi đang dùng. */
export function useCls(scope: ClsScope = 'dist') {
  const [d, setD] = useState<Data>(cache[scope] ?? { levels: [], nodes: [] })
  useEffect(() => { subs[scope].add(setD); if (!cache[scope]) load(scope); return () => { subs[scope].delete(setD) } }, [scope])
  const active = d.levels.filter(l => l.active)
  const byId = new Map(d.nodes.map(n => [n.id, n]))
  const lvOf = (n: ClsNode) => d.levels.find(l => l.id === n.cls_level_id)
  /** Các mục từ gốc đến mục này, chỉ tính mục thuộc cấp đang bật */
  const path = (id: string | null | undefined) => {
    const out: ClsNode[] = []
    for (let n = id ? byId.get(id) : undefined; n; n = n.parent_id ? byId.get(n.parent_id) : undefined) if (lvOf(n)?.active) out.unshift(n)
    return out
  }
  return { ...d, scope, tables: CLS_TABLES[scope], ready: !!cache[scope], active, byId, lvOf, path, reload: () => load(scope) }
}
