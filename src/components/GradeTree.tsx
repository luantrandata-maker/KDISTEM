// Cây nhóm theo Cấp → Khối đặt bên trái bảng (DataTable `aside`): đếm số dòng, bấm một mục để lọc bảng.
// Dòng dạy từ 2 khối trở lên trong cùng một cấp vào "Liên khối"; trải nhiều cấp vào "Liên cấp"; chưa có khối vào "Chưa rõ khối".
import { useState, type ReactNode } from 'react'
import { useEduLevels, gradeName, type EduLevel } from '../lib/eduLevels'
import { TreeHead } from './TreeHead'

const levelOf = (lv: EduLevel[], g: number) => lv.find(l => g >= l.grade_from && g <= l.grade_to)?.code ?? null

/** Nhóm của một dòng: ['lv', khoá]. Khoá: g:6 · multi:thcs · cross · none */
function bucket(lv: EduLevel[], gs: number[]): [string | null, string] {
  const u = [...new Set(gs)]
  if (!u.length) return [null, 'none']
  const ls = [...new Set(u.map(g => levelOf(lv, g)))]
  if (ls.length > 1 || !ls[0]) return [null, u.length === 1 ? 'none' : 'cross']
  return [ls[0], u.length === 1 ? 'g:' + u[0] : 'multi:' + ls[0]]
}

export type GradeSel = ReturnType<typeof useGradeSel>
/** Trạng thái cây (mục đang chọn, cấp đang mở): gọi ở đầu component, trước các lệnh return sớm */
export function useGradeSel(id: string) {
  const { all } = useEduLevels()
  const key = 'gt:' + id
  const [sel, setSelS] = useState(() => { try { return localStorage.getItem(key) ?? 'all' } catch { return 'all' } })
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const setSel = (k: string) => { setSelS(k); try { localStorage.setItem(key, k) } catch { /* chỉ trong phiên */ } }
  return { all, sel, setSel, open, setOpen }
}

/** Cây nhóm theo khối cho một bảng. `filter` lọc dòng theo mục đang chọn; `tree` đặt vào `aside` của DataTable. */
export function useGradeTree<T>(id: string, rows: T[], gradesOf: (r: T) => number[], unit?: string) {
  return gradeTree(useGradeSel(id), rows, gradesOf, unit)
}

/** Dựng cây từ trạng thái `useGradeSel` (dùng khi danh sách dòng chỉ có sau các lệnh return sớm) */
export function gradeTree<T>(st: GradeSel, rows: T[], gradesOf: (r: T) => number[], unit = 'mục'): { tree: ReactNode; filter: (rs: T[]) => T[]; sel: string } {
  const { all, sel, setSel, open, setOpen } = st

  const b = (r: T) => bucket(all, gradesOf(r))
  const cnt = new Map<string, number>()
  const add = (k: string) => cnt.set(k, (cnt.get(k) ?? 0) + 1)
  rows.forEach(r => { const [l, k] = b(r); add(k); if (l) add('lv:' + l) })
  const n = (k: string) => cnt.get(k) ?? 0

  const match = (r: T) => {
    if (sel === 'all') return true
    const [l, k] = b(r)
    return sel.startsWith('lv:') ? 'lv:' + l === sel : k === sel
  }
  // Mục đang chọn không còn dòng nào (dữ liệu đổi) thì coi như Tất cả
  const live = sel === 'all' || n(sel) > 0
  const filter = (rs: T[]) => live ? rs.filter(match) : rs
  const cur = live ? sel : 'all'

  const lvName = (c: string) => all.find(l => l.code === c)?.name ?? c
  const gPath = (g: number) => { const lc = levelOf(all, g); return (lc ? lvName(lc) + ' › ' : '') + gradeName(g) }
  /** Đường dẫn của một mục, để hiện "đang xem" và chú thích khi rê chuột */
  const pathOf = (k: string): string => k === 'all' ? 'Tất cả' : k.startsWith('lv:') ? lvName(k.slice(3))
    : k.startsWith('g:') ? gPath(Number(k.slice(2)))
    : k.startsWith('multi:') ? lvName(k.slice(6)) + ' › Liên khối' : k === 'cross' ? 'Liên cấp' : 'Chưa rõ khối'
  const item = (k: string, label: ReactNode, cls = '', onPick?: () => void) => {
    const c = k === 'all' ? rows.length : n(k)
    return <button type="button" key={k} className={'gtitem ' + cls + (cur === k ? ' on' : '')} title={`${pathOf(k)}: ${c} ${unit}`}
      aria-pressed={cur === k} onClick={() => { setSel(k); onPick?.() }}><span className="gtlbl">{label}</span><span className="gtcnt">{c}</span></button>
  }

  const lvs = all.filter(l => n('lv:' + l.code) > 0)
  const tree = <nav className="gtree" aria-label="Nhóm theo khối">
    <TreeHead title="Cấp › Khối">Nhóm theo <b>Cấp → Khối</b>.<br />Số = số {unit}.<br />Bấm tên: lọc và mở.<br />Bấm ▸: chỉ mở / đóng.</TreeHead>
    {item('all', 'Tất cả')}
    {lvs.map(l => {
      const k = 'lv:' + l.code
      const inside = cur === k || cur.endsWith(':' + l.code) || (cur.startsWith('g:') && levelOf(all, Number(cur.slice(2))) === l.code)
      const isOpen = open[l.code] ?? inside
      const gs: number[] = []
      for (let g = l.grade_from; g <= l.grade_to; g++) if (g !== 0 && n('g:' + g)) gs.push(g)
      return <div key={l.code} className="gtlv">
        <div className="gtrow">
          <button type="button" className="gtcaret" aria-expanded={isOpen} aria-label={(isOpen ? 'Thu gọn ' : 'Mở ') + l.name}
            onClick={() => setOpen({ ...open, [l.code]: !isOpen })}>{isOpen ? '▾' : '▸'}</button>
          {item(k, l.name, '', () => setOpen({ ...open, [l.code]: true }))}
        </div>
        {isOpen && <div className="gtsub">
          {gs.map(g => item('g:' + g, gradeName(g)))}
          {n('multi:' + l.code) > 0 && item('multi:' + l.code, 'Liên khối')}
        </div>}
      </div>
    })}
    {n('cross') > 0 && item('cross', 'Liên cấp')}
    {n('none') > 0 && item('none', 'Chưa rõ khối', 'gtnone')}
  </nav>
  return { tree, filter, sel: cur }
}
