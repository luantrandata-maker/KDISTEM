import type { ReactNode } from 'react'
import { MoreMenu } from './MoreMenu'
import { Icon } from './Icon'

/** Một thao tác ở thanh nút đầu trang. rank nhỏ = quan trọng hơn (mặc định: primary 1, thường 2, danger 3).
 *  icon: nằm ngoài thì chỉ hiện biểu tượng (vd 'pencil' sửa, 'trash' xoá), tên thao tác ở chú thích; trong "⋯" hiện biểu tượng + tên. */
export type Act = { key: string; label: ReactNode; icon?: string; onClick: () => void; kind?: 'primary' | 'danger'; disabled?: boolean; title?: string; rank?: number }

/**
 * Thanh nút thao tác: hiện tất cả thao tác ra ngoài (không gom vào "⋯").
 * Nút chỉ có biểu tượng luôn nằm cuối bên phải: bút (sửa) rồi thùng rác (xoá).
 * `max`: chỉ đặt khi muốn giới hạn số nút bên ngoài, phần dư vào "⋯" theo rank.
 * `menuExtra`: nội dung luôn nằm trong "⋯" (vd ô ghi chú), không tính là thao tác.
 */
export function ActionBar({ items, max = Infinity, menuExtra }: { items: (Act | false | null | undefined)[]; max?: number; menuExtra?: ReactNode }) {
  const ICON_ORDER: Record<string, number> = { pencil: 1, trash: 2 }
  const iconRank = (a: Act) => a.icon ? ICON_ORDER[a.icon] ?? 0.5 : 0
  const list = items.filter((a): a is Act => !!a).map((a, i) => [a, i] as const)
    .sort((x, y) => iconRank(x[0]) - iconRank(y[0]) || x[1] - y[1]).map(x => x[0])
  const rankOf = (a: Act) => a.rank ?? (a.kind === 'primary' ? 1 : a.kind === 'danger' ? 3 : 2)
  const out = new Set(list.length <= max ? list.map(a => a.key)
    : list.map((a, i) => [a, i] as const).sort((x, y) => rankOf(x[0]) - rankOf(y[0]) || x[1] - y[1]).slice(0, max).map(x => x[0].key))
  const btn = (a: Act, inMenu = false) => {
    const only = !!a.icon && !inMenu
    const name = typeof a.label === 'string' ? a.label : undefined
    const cls = [a.kind === 'danger' && !inMenu ? 'danger abdanger' : a.kind, only && 'iconbtn'].filter(Boolean).join(' ') || undefined
    return <button key={a.key} type="button" className={cls} disabled={a.disabled} title={a.title ?? (only ? name : undefined)} aria-label={only ? name : undefined} onClick={a.onClick}>
      {a.icon && <Icon n={a.icon} size={only ? 17 : 15} />}{!only && (a.icon ? <> {a.label}</> : a.label)}</button>
  }
  const rest = list.filter(a => !out.has(a.key))
  return <>
    {list.filter(a => out.has(a.key)).map(a => btn(a))}
    {(rest.length > 0 || menuExtra) && <MoreMenu>{menuExtra}{rest.map(a => btn(a, true))}</MoreMenu>}
  </>
}
