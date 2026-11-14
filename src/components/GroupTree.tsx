// Cây nhóm hai cấp đặt bên trái bảng / lịch (DataTable `aside` hoặc SideSplit), cùng kiểu với cây Cấp → Khối:
// cấp 1 (vd. năm học) có thể mở ra cấp 2 (vd. kế hoạch). Đếm số dòng mỗi mục, bấm để lọc.
// Khoá chọn: 'all' · 'a:<nhóm>' · 'b:<nhóm>|<mục con>'.
import { useState, type ReactNode } from 'react'

export type GroupSel = string
export type TreeNode = { key: string; label: ReactNode; count: number; kids?: { key: string; label: ReactNode; count: number }[] }

/** Dựng các nút cây từ danh sách dòng: `path` trả [nhóm, mục con?]; nhóm rỗng xếp cuối với nhãn `none` */
export function groupNodes<T>(rows: T[], path: (r: T) => [string, string?], o: { label1?: (k: string) => ReactNode; label2?: (k: string) => ReactNode; sort2?: (k: string) => string; desc?: boolean; none?: string } = {}): TreeNode[] {
  const m = new Map<string, Map<string, number>>(), c1 = new Map<string, number>()
  for (const r of rows) {
    const [a, b] = path(r)
    c1.set(a, (c1.get(a) ?? 0) + 1)
    if (b != null) { const s = m.get(a) ?? new Map<string, number>(); s.set(b, (s.get(b) ?? 0) + 1); m.set(a, s) }
  }
  const keys = [...c1.keys()].sort((x, y) => !x ? 1 : !y ? -1 : (o.desc ? y.localeCompare(x, 'vi', { numeric: true }) : x.localeCompare(y, 'vi', { numeric: true })))
  return keys.map(k => ({ key: k, label: k ? (o.label1?.(k) ?? k) : (o.none ?? 'Chưa rõ'), count: c1.get(k)!,
    kids: m.get(k) ? [...m.get(k)!.entries()].map(([kk, n]) => ({ key: kk, label: o.label2?.(kk) ?? kk, count: n }))
      .sort((x, y) => (o.sort2?.(x.key) ?? x.key).localeCompare(o.sort2?.(y.key) ?? y.key, 'vi', { numeric: true })) : undefined }))
}

/** Dòng có thuộc mục đang chọn không */
export const inGroup = (sel: GroupSel, a: string, b?: string) =>
  sel === 'all' || (sel.startsWith('a:') ? sel.slice(2) === a : sel === `b:${a}|${b ?? ''}`)

/** Trạng thái chọn, nhớ theo `id` trên trình duyệt */
export function useGroupSel(id: string) {
  const key = 'grt:' + id
  const [sel, setS] = useState<GroupSel>(() => { try { return localStorage.getItem(key) ?? 'all' } catch { return 'all' } })
  const set = (k: GroupSel) => { setS(k); try { localStorage.setItem(key, k) } catch { /* chỉ trong phiên */ } }
  return [sel, set] as const
}

export function GroupTree({ nodes, total, sel, onSel, label }: { nodes: TreeNode[]; total: number; sel: GroupSel; onSel: (k: GroupSel) => void; label: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const item = (k: GroupSel, text: ReactNode, n: number, cls = '') => <button type="button" key={k} className={'gtitem ' + cls + (sel === k ? ' on' : '')}
    aria-pressed={sel === k} onClick={() => onSel(k)}><span className="gtlbl">{text}</span><span className="gtcnt">{n}</span></button>
  return <nav className="gtree" aria-label={label}>
    {item('all', 'Tất cả', total)}
    {nodes.map(g => {
      const a = 'a:' + g.key, inside = sel === a || sel.startsWith(`b:${g.key}|`), isOpen = open[g.key] ?? inside
      if (!g.kids?.length) return item(a, g.label, g.count, g.key ? '' : 'gtnone')
      return <div key={g.key} className="gtlv">
        <div className="gtrow">
          <button type="button" className="gtcaret" aria-expanded={isOpen} aria-label={isOpen ? 'Thu gọn' : 'Mở'}
            onClick={() => setOpen({ ...open, [g.key]: !isOpen })}>{isOpen ? '▾' : '▸'}</button>
          {item(a, g.label, g.count, g.key ? '' : 'gtnone')}
        </div>
        {isOpen && <div className="gtsub">{g.kids.map(c => item(`b:${g.key}|${c.key}`, c.label, c.count))}</div>}
      </div>
    })}
  </nav>
}
