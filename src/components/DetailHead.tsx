// Đầu trang chi tiết dùng chung (theo mẫu Chương trình giáo dục): nút "← <trang trước>" phía trên,
// tiêu đề lớn (kèm phiên bản, trạng thái…) ở hàng tiêu đề trang; Esc để quay lại.
// Nút quay lại mang class .pdclose: khi có nó, trang ẩn tab mục và khung danh sách (xem index.css).
import { useEffect, type ReactNode } from 'react'
import { PageCrumb } from './PageCorner'

/** Esc: quay lại (trừ khi đang gõ, đang mở hộp thoại / ngăn kéo / menu). */
export function useEscBack(onBack: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t?.closest('input, textarea, select, [contenteditable], dialog, [role=dialog], .drawerwrap, .menu, details[open]')) return
      if (document.querySelector('dialog[open], [role=dialog], .drawerwrap')) return
      onBack()
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [onBack, enabled])
}

export function DetailHead({ back, onBack, title, extra }: { back: string; onBack: () => void; title?: ReactNode; extra?: ReactNode }) {
  useEscBack(onBack)
  return <PageCrumb><div className="pdhead">
    <button type="button" className="pdback pdclose" onClick={onBack} title={`Quay lại: ${back} (Esc)`}><span aria-hidden="true">←</span> {back}</button>
    {title != null && <div className="pdtitle"><h1 className="pdh1" title={typeof title === 'string' ? title : undefined}>{title}</h1>{extra}</div>}
  </div></PageCrumb>
}
