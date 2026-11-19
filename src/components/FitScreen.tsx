import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Giữ phần nội dung (bảng) vừa trong một màn hình: cao tối đa = phần còn lại của cửa sổ dưới vị trí của nó,
 *  dư thì cuộn bên trong khung, tiêu đề bảng đứng yên; trang không phải kéo lên xuống. */
export function FitScreen({ children, bottom = 96 }: { children: ReactNode; bottom?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [h, setH] = useState<number | undefined>()
  useLayoutEffect(() => {
    const fit = () => { const el = ref.current; if (!el) return; const top = el.getBoundingClientRect().top + window.scrollY; setH(Math.max(240, window.innerHeight - top - bottom)) }
    fit(); window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [bottom])
  return <div ref={ref} className="fitscreen" style={{ maxHeight: h }}>{children}</div>
}
