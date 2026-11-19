import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Giữ phần nội dung (bảng) vừa đúng một màn hình như bảng "Chương trình": khung trang chạm sát lề dưới,
 *  dư thì cuộn bên trong khung, tiêu đề bảng đứng yên; trang không phải kéo lên xuống.
 *  Đo phần nằm dưới bảng (chân bảng, ghi chú, viền khung, lề dưới trang) để chừa đúng chỗ. */
export function FitScreen({ children, bottom = 24, className }: { children: ReactNode; bottom?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [h, setH] = useState<number | undefined>()
  const fit = useRef(() => {})
  fit.current = () => {
    const el = ref.current; if (!el) return
    if (window.innerWidth < 900) return setH(undefined)
    // Bảng dạng mới đã tự kéo kín màn hình (ttfill) thì không đo thêm lần nữa
    if ((el.closest('.ttfill') as HTMLElement | null)?.style.height) return setH(undefined)
    const r = el.getBoundingClientRect()
    const main = el.closest('main') as HTMLElement | null
    const frame = main?.querySelector(':scope > .pframe') as HTMLElement | null
    let below = bottom
    if (frame && main) {
      const fr = frame.getBoundingClientRect()
      // Khung trong suốt (trang con có nút quay lại) thì không tính viền, chỉ giữ lề dưới như bảng thường
      below = Math.max(0, fr.bottom - r.bottom) + parseFloat(getComputedStyle(main).paddingBottom || '0')
    }
    const next = Math.max(240, Math.round(window.innerHeight - (r.top + window.scrollY) - below))
    setH(o => (o === next ? o : next))
  }
  // Đo lại sau mỗi lần vẽ (thanh lọc, ghi chú hiện / ẩn làm bảng dịch xuống)
  useLayoutEffect(() => fit.current())
  useLayoutEffect(() => {
    const f = () => fit.current()
    window.addEventListener('resize', f)
    return () => window.removeEventListener('resize', f)
  }, [])
  return <div ref={ref} className={'fitscreen' + (className ? ' ' + className : '')} style={{ height: h }}>{children}</div>
}
