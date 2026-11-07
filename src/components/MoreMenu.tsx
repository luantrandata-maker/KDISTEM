import { useRef, type ReactNode } from 'react'

/** Nút "…" (hoặc nhãn tuỳ chọn) mở danh sách thao tác phụ; bấm một nút trong menu thì menu tự đóng. */
export function MoreMenu({ children, label }: { children: ReactNode; label?: string }) {
  const ref = useRef<HTMLDetailsElement>(null)
  return <details ref={ref} className="distmore" onClick={e => { if ((e.target as HTMLElement).closest('button')) ref.current?.removeAttribute('open') }}>
    <summary aria-label={label ?? 'Thao tác khác'}>{label ?? '···'}</summary><div className="distmenu">{children}</div></details>
}
