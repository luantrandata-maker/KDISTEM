import { useState, type ComponentType } from 'react'
import { Tabs } from '../pages/teacher/common'
import { SubActSlot } from './PageFrame'

// Một mục menu gộp nhiều màn có sẵn thành các tab (vd: "Học liệu" = Phát hành + Kho dùng chung)
// actsInRow: nút "+ Thêm …" (HeadAction) của màn con nằm cuối hàng tab con, thay vì hàng tab trên cùng.
export function TabbedPages({ tabs, actsInRow, ...props }: { tabs: [string, ComponentType<any>][]; actsInRow?: boolean } & Record<string, any>) {
  const [i, setI] = useState('0')
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  const Page = tabs[Number(i)]?.[1]
  // Màn con chuyển sang tab khác theo tên tab (vd. bước "Môn học" của thanh quy trình)
  const goTab = (label: string) => { const k = tabs.findIndex(t => t[0] === label); if (k >= 0) setI(String(k)) }
  const tabRow = <Tabs value={i} onChange={setI} items={tabs.map(([label], k) => [String(k), label] as [string, string])} />
  const page = Page && <Page key={i} {...props} name={tabs[Number(i)][0]} goTab={goTab} />
  if (!actsInRow) return <>{tabRow}{page}</>
  return (
    <>
      <div className="subtabsrow">{tabRow}<div className="subact" ref={setSlot} /></div>
      <SubActSlot.Provider value={slot}>{page}</SubActSlot.Provider>
    </>
  )
}
