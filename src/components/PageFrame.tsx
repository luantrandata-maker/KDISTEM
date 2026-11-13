// Đầu trang dạng "một khung" (phương án L): đường dẫn nhỏ phía trên; một khung trắng chứa
// tiêu đề, tab mục con, nút thao tác ở hàng đầu và nội dung (thanh công cụ, bảng) bên dưới.
// Khi mở chi tiết (nút ✕ .pdclose ở tiêu đề trang) khung tự trở về dạng thường (xem index.css).
import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Tabs } from '../pages/teacher/common'

export function PageFrame({ title, tabs, value, onTab, actions, children }: {
  title?: string; tabs?: string[]; value?: number; onTab?: (i: number) => void; actions?: ReactNode; children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [head, setHead] = useState<{ h1: string; group: string }>({ h1: '', group: '' })
  useLayoutEffect(() => {
    const ph = ref.current?.closest('main')?.querySelector(':scope > .pagehead')
    setHead({ h1: ph?.querySelector(':scope > h1')?.textContent ?? '', group: ph?.getAttribute('data-group') ?? '' })
  }, [])
  const name = head.h1
  return <>
    <div className="pfcrumb">
      {head.group && <span>{head.group}</span>}
      {title && <span>{name}</span>}
      <h1>{title || name}</h1>
    </div>
    <div className="pframe" ref={ref}>
      <div className="pfhead">
        {tabs && tabs.length > 1 && <Tabs value={String(value ?? 0)} onChange={v => onTab?.(Number(v))} items={tabs.map((l, k) => [String(k), l] as [string, string])} />}
        <div className="pfact">{actions}</div>
      </div>
      <div className="pfbody">{children}</div>
    </div>
  </>
}

/** Các mục con của trang dưới dạng tab trong khung (thay TabbedPages). */
export function FramedTabs({ tabs, actions, ...props }: { tabs: [string, ComponentType<any>][]; actions?: ReactNode } & Record<string, any>) {
  const [i, setI] = useState(0)
  const Page = tabs[i]?.[1]
  const goTab = (label: string) => { const k = tabs.findIndex(t => t[0] === label); if (k >= 0) setI(k) }
  return <PageFrame tabs={tabs.map(t => t[0])} value={i} onTab={setI} actions={actions}>
    {Page && <Page key={i} {...props} name={tabs[i][0]} goTab={goTab} />}
  </PageFrame>
}

/** Nút thao tác chính của màn con: nằm ở hàng tiêu đề của khung nếu có, không thì hiện tại chỗ. */
export function HeadAction({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [box, setBox] = useState<Element | null>(null)
  useLayoutEffect(() => { setBox(anchor.current?.closest('.pframe')?.querySelector(':scope > .pfhead > .pfact') ?? null) }, [])
  return <><span ref={anchor} hidden />{box ? createPortal(children, box) : children}</>
}
