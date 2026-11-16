import type { ReactNode } from 'react'

/** Nút nhỏ "ⓘ Hướng dẫn": rê chuột hoặc bấm (Tab) để xem nội dung, thay cho các dòng hướng dẫn / cách tính / ghi chú dài. */
export function InfoTip({ label = 'Hướng dẫn', children, left, up }: { label?: string; children: ReactNode; left?: boolean; up?: boolean }) {
  return <span className={'infotip infotipx' + (left ? ' l' : '') + (up ? ' up' : '')} tabIndex={0} role="button" aria-label={label}>
    ⓘ {label}<span className="infotippop" role="tooltip">{children}</span>
  </span>
}
