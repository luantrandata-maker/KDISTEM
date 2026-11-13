// Nút góc phải của trang: đặt vào hàng tiêu đề (.pagehead) để cùng dàn hàng với tiêu đề và số tổng hợp,
// màn hình hẹp hay phóng to thì tự xuống dòng, không đè lên tiêu đề.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function PageCorner({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [head, setHead] = useState<Element | null>(null)
  // Trang trong khung (PageFrame): nút góc nằm ở hàng tab + nút của khung
  useLayoutEffect(() => { const m = anchor.current?.closest('main'); setHead(m?.querySelector(':scope > .pfcrumb > .pfact, :scope > .pframe > .pfhead > .pfact') ?? m?.querySelector(':scope > .pagehead') ?? null) }, [])
  const box = <div className="pagecorner">{children}</div>
  return <><span ref={anchor} hidden />{head ? createPortal(box, head) : box}</>
}

/** Đường dẫn nhỏ đặt ngay sau tiêu đề trang (cùng hàng với h1), vd "Danh sách chương trình › CT-TN". */
export function PageCrumb({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [head, setHead] = useState<Element | null>(null)
  useLayoutEffect(() => { setHead(anchor.current?.closest('main')?.querySelector(':scope > .pagehead') ?? null) }, [])
  const box = <div className="pagecrumb">{children}</div>
  return <><span ref={anchor} hidden />{head ? createPortal(box, head) : box}</>
}
