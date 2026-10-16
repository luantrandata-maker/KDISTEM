import { useState, type ComponentType } from 'react'
import { Tabs } from '../pages/teacher/common'

// Một mục menu gộp nhiều màn có sẵn thành các tab (vd: "Học liệu" = Phát hành + Kho dùng chung)
export function TabbedPages({ tabs, ...props }: { tabs: [string, ComponentType<any>][] } & Record<string, any>) {
  const [i, setI] = useState('0')
  const Page = tabs[Number(i)]?.[1]
  return (
    <>
      <Tabs value={i} onChange={setI} items={tabs.map(([label], k) => [String(k), label] as [string, string])} />
      {Page && <Page key={i} {...props} name={tabs[Number(i)][0]} />}
    </>
  )
}
