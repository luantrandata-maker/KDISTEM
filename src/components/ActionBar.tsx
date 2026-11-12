import type { ReactNode } from 'react'
import { MoreMenu } from './MoreMenu'

/** Một thao tác ở thanh nút đầu trang. rank nhỏ = quan trọng hơn (mặc định: primary 1, thường 2, danger 3). */
export type Act = { key: string; label: ReactNode; onClick: () => void; kind?: 'primary' | 'danger'; disabled?: boolean; title?: string; rank?: number }

/**
 * Thanh nút thao tác theo quy tắc chung:
 * - Từ 3 thao tác trở xuống: hiện hết ra ngoài, không có nút "⋯".
 * - Nhiều hơn 3: 3 thao tác quan trọng nhất nằm ngoài, phần còn lại vào "⋯".
 * `menuExtra`: nội dung luôn nằm trong "⋯" (vd ô ghi chú), không tính là thao tác.
 */
export function ActionBar({ items, max = 3, menuExtra }: { items: (Act | false | null | undefined)[]; max?: number; menuExtra?: ReactNode }) {
  const list = items.filter((a): a is Act => !!a)
  const rankOf = (a: Act) => a.rank ?? (a.kind === 'primary' ? 1 : a.kind === 'danger' ? 3 : 2)
  const out = new Set(list.length <= max ? list.map(a => a.key)
    : list.map((a, i) => [a, i] as const).sort((x, y) => rankOf(x[0]) - rankOf(y[0]) || x[1] - y[1]).slice(0, max).map(x => x[0].key))
  const btn = (a: Act, inMenu = false) => <button key={a.key} type="button" className={a.kind === 'danger' && !inMenu ? 'danger abdanger' : a.kind} disabled={a.disabled} title={a.title} onClick={a.onClick}>{a.label}</button>
  const rest = list.filter(a => !out.has(a.key))
  return <>
    {list.filter(a => out.has(a.key)).map(a => btn(a))}
    {(rest.length > 0 || menuExtra) && <MoreMenu>{menuExtra}{rest.map(a => btn(a, true))}</MoreMenu>}
  </>
}
