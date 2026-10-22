import { useState } from 'react'

export type ViewMode = 'cards' | 'list'

/** Kiểu xem Thẻ / Danh sách, nhớ theo từng trang trên trình duyệt này. */
export function useViewMode(key: string, initial: ViewMode = 'cards') {
  const k = 'kdi-view-' + key
  const [v, setV] = useState<ViewMode>(() => {
    try { const s = localStorage.getItem(k); return s === 'cards' || s === 'list' ? s : initial } catch { return initial }
  })
  const set = (x: ViewMode) => { setV(x); try { localStorage.setItem(k, x) } catch { /* trình duyệt chặn lưu: chỉ đổi trong phiên */ } }
  return [v, set] as const
}

/** Công tắc "Thẻ | Danh sách" — đặt cạnh nút hành động chính của trang. */
export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <span className="segmented viewtoggle" role="group" aria-label="Kiểu xem">
      <button type="button" className={value === 'cards' ? 'on' : ''} aria-pressed={value === 'cards'} onClick={() => onChange('cards')}>Thẻ</button>
      <button type="button" className={value === 'list' ? 'on' : ''} aria-pressed={value === 'list'} onClick={() => onChange('list')}>Danh sách</button>
    </span>
  )
}
