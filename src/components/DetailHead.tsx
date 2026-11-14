// Đầu trang chi tiết dùng chung (theo mẫu Chương trình giáo dục): nút ← nhỏ cạnh tiêu đề lớn (kèm phiên bản,
// trạng thái…), nút thao tác cùng hàng, tóm tắt ngay dưới; Esc hoặc bấm tên trang trên đường dẫn để quay lại.
// Nút quay lại mang class .pdclose: khi có nó, trang ẩn tab mục và khung danh sách (xem index.css).
import { useContext, useEffect, type ReactNode } from 'react'
import { ProDefault } from './ProTools'
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

export function DetailHead({ back, onBack, title, extra, actions, sub }: {
  back: string; onBack: () => void; title?: ReactNode; extra?: ReactNode; actions?: ReactNode; sub?: ReactNode
}) {
  useEscBack(onBack)
  const pro = useContext(ProDefault)
  const tip = `Quay lại: ${back} (Esc)`
  // Có tiêu đề: nút ← nhỏ nằm ngay cạnh tiêu đề (không còn dòng "← <trang trước>" riêng); nút thao tác cùng hàng, tóm tắt ngay dưới
  const back1 = <button type="button" className="pdicon pdclose pdinline" onClick={onBack} title={tip} aria-label={tip}>
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg></button>
  // Phân hệ 1, 2: trang tự vẽ tiêu đề (tên sửa được, chip trạng thái…) → nút ← nhỏ nằm ngay tại chỗ, cạnh tiêu đề
  if (title == null && pro) return back1
  if (title == null) return <PageCrumb><div className="pdhead">
    <button type="button" className="pdback pdclose" onClick={onBack} title={tip}><span aria-hidden="true">←</span> {back}</button>
  </div></PageCrumb>
  return <PageCrumb><div className="pdhead pdhead1">
    <div className="pdtitle">
      <button type="button" className="pdicon pdclose" onClick={onBack} title={tip} aria-label={tip}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg></button>
      <h1 className="pdh1" title={typeof title === 'string' ? title : undefined}>{title}</h1>{extra}
      {actions && <div className="pdacts">{actions}</div>}
    </div>
    {sub && <div className="pdsub">{sub}</div>}
  </div></PageCrumb>
}
