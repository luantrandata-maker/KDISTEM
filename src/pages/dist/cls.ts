import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Khung phân loại bản phân phối (082): các cấp (Cấp học › Khối lớp › Mức độ…) và các mục trong cây.
export type ClsLevel = { id: string; name: string; kind: 'level' | 'grade' | 'tier' | 'custom'; sort: number; active: boolean }
export type ClsNode = { id: string; cls_level_id: string; parent_id: string | null; name: string; sort: number }
type Data = { levels: ClsLevel[]; nodes: ClsNode[] }

let cache: Data | null = null
const subs = new Set<(d: Data) => void>()
async function load() {
  const [lv, nd] = await Promise.all([
    supabase.from('dist_cls_levels').select('id, name, kind, sort, active').order('sort'),
    supabase.from('dist_nodes').select('id, cls_level_id, parent_id, name, sort').order('sort').order('name'),
  ])
  cache = { levels: (lv.data as ClsLevel[]) ?? [], nodes: (nd.data as ClsNode[]) ?? [] }
  subs.forEach(f => f(cache!))
}

/** Đọc khung phân loại; reload() tải lại cho mọi nơi đang dùng. */
export function useCls() {
  const [d, setD] = useState<Data>(cache ?? { levels: [], nodes: [] })
  useEffect(() => { subs.add(setD); if (!cache) load(); return () => { subs.delete(setD) } }, [])
  const active = d.levels.filter(l => l.active)
  const byId = new Map(d.nodes.map(n => [n.id, n]))
  const lvOf = (n: ClsNode) => d.levels.find(l => l.id === n.cls_level_id)
  /** Các mục từ gốc đến mục này, chỉ tính mục thuộc cấp đang bật */
  const path = (id: string | null | undefined) => {
    const out: ClsNode[] = []
    for (let n = id ? byId.get(id) : undefined; n; n = n.parent_id ? byId.get(n.parent_id) : undefined) if (lvOf(n)?.active) out.unshift(n)
    return out
  }
  return { ...d, ready: !!cache, active, byId, lvOf, path, reload: load }
}
