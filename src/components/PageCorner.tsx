// Nút góc phải của trang: đặt vào hàng tiêu đề (.pagehead) để cùng dàn hàng với tiêu đề và số tổng hợp,
// màn hình hẹp hay phóng to thì tự xuống dòng, không đè lên tiêu đề.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function PageCorner({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [head, setHead] = useState<Element | null>(null)
  useLayoutEffect(() => { setHead(anchor.current?.closest('main')?.querySelector(':scope > .pagehead') ?? null) }, [])
  const box = <div className="pagecorner">{children}</div>
  return <><span ref={anchor} hidden />{head ? createPortal(box, head) : box}</>
}
