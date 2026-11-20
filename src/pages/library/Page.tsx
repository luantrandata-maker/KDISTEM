// Học liệu (Phân hệ 2) theo khung chương trình mới (Gói STEM):
// tab Học liệu theo chương trình (Loại CT › Học phần › Khối → chủ đề) | Danh mục học liệu (6 tab đúng 6 nội dung của chủ đề).
// Danh mục kiểu cũ (Bài học, Bài giảng, Tài liệu, Định mức vật tư, Kho hoạt động) và thẻ số liệu cũ đã ẩn; dữ liệu cũ vẫn giữ.
import { useState } from 'react'
import { HeadTabs } from '../../components/PageFrame'
import { LibraryByPackage } from './ByPackage'
import { LibraryCatalog } from './Catalog'

type Tab = 'pkg' | 'catalog'

export function LibraryPage({ orgId }: { orgId: string | null; teacherId?: string | null; go?: (p: string) => void }) {
  const [tab, setTab] = useState<Tab>('pkg')
  return (
    <>
      <HeadTabs><div className="distpills" role="tablist">
        {([['pkg', 'Học liệu theo chương trình'], ['catalog', 'Danh mục học liệu']] as [Tab, string][]).map(([t, l]) =>
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>)}
      </div></HeadTabs>
      {tab === 'pkg' && <LibraryByPackage orgId={orgId} />}
      {tab === 'catalog' && <LibraryCatalog orgId={orgId} />}
    </>
  )
}
