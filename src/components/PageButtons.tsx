// Thiết lập chung › Nút (096): ẩn nút có sẵn trên trang, thêm nút mới (liên kết, chuyển trang, xuất CSV bảng đang xem, thông báo).
import { createContext, useContext, useState } from 'react'
import { buttonsOf, catalogOf, useSettings, type CustomButton } from '../lib/settings'

/** Nút có sẵn có thể ẩn, theo trang (mã trang trong menu). */
export const BUILTIN: Record<string, [string, string][]> = {
  'Học liệu': [['add', 'Thêm học liệu / bài học'], ['import', 'Nhập từ file…']],
  'Phát hành học liệu': [['add', 'Thêm học liệu / bài học'], ['import', 'Nhập từ file…']],
  'Chương trình giáo dục': [['add', 'Thêm chương trình'], ['ppct', 'Tạo PPCT từ chương trình'], ['version', 'Tạo phiên bản mới'], ['export', 'Xuất Excel']],
  'Phân phối chương trình': [['create', '+ Tạo bản phân phối'], ['tier', '+ Thêm cấp']],
  'Soạn bài giảng & kho hoạt động': [['new', '+ Tạo giáo án'], ['publish', 'Xuất bản']],
  'Giáo án & bài giảng': [['new', '+ Tạo giáo án'], ['publish', 'Xuất bản']],
  'Soạn bài giảng': [['new', '+ Tạo giáo án'], ['publish', 'Xuất bản']],
}
export const ACTIONS: [CustomButton['action'], string][] = [['link', 'Mở liên kết'], ['page', 'Chuyển trang'], ['csv', 'Xuất CSV bảng đang xem'], ['notify', 'Hiện thông báo']]

export const PageCtx = createContext<string>('')
/** true nếu nút có sẵn `id` của trang đang mở bị ẩn trong Thiết lập chung. */
export function useHiddenBtn() {
  const page = useContext(PageCtx)
  const s = useSettings()
  const { hidden } = buttonsOf(s, page)
  return (id: string) => hidden.has(id)
}

function exportCsv(title: string) {
  const t = document.querySelector('main.main table') as HTMLTableElement | null
  if (!t) return alert('Trang này không có bảng để xuất.')
  const rows = Array.from(t.rows).map(r => Array.from(r.cells).map(c => '"' + (c.innerText ?? '').replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"').join(','))
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  a.download = (title || 'du-lieu') + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** Nút thêm mới của trang (hiện cạnh tiêu đề trang). */
export function PageButtons({ page, title, go }: { page: string; title: string; go: (p: string) => void }) {
  const s = useSettings()
  const { extra } = buttonsOf(s, page)
  const [note, setNote] = useState<string | null>(null)
  if (!extra.length) return null
  const run = (b: CustomButton) => {
    if (b.action === 'link' && b.target && /^https?:\/\//i.test(b.target)) window.open(b.target, '_blank', 'noopener')
    else if (b.action === 'page' && b.target) go(b.target)
    else if (b.action === 'csv') exportCsv(title)
    else if (b.action === 'notify') setNote(b.target || b.label)
  }
  return <>
    <span className="pagebtns">{extra.map(b => <button type="button" key={b.id} className={b.primary ? 'primary' : ''} onClick={() => run(b)}>{b.label}</button>)}</span>
    {note && <p className="pagenote" role="status">{note} <button type="button" className="linkbtn" onClick={() => setNote(null)}>Đóng</button></p>}
  </>
}

export const UNIT_BASE = ['Bộ', 'Chiếc', 'Cái', 'Gói', 'Hộp', 'Lọ', 'Cuộn', 'Tờ', 'Miếng', 'Sợi', 'Quyển', 'm', 'Cm']
export const SUPPLY_CAT_BASE = ['Vật tư tiêu hao', 'Công cụ', 'Linh kiện điện tử', 'Hóa chất', 'Văn phòng phẩm']
/** Gợi ý theo Danh mục (Thiết lập chung) cho mọi ô nhập: list="cat-units", list="cat-supply_category". */
export function CatalogLists() {
  const s = useSettings()
  return <>
    <datalist id="cat-units">{catalogOf(s, 'units', UNIT_BASE).map(u => <option key={u} value={u} />)}</datalist>
    <datalist id="cat-supply_category">{catalogOf(s, 'supply_category', SUPPLY_CAT_BASE).map(u => <option key={u} value={u} />)}</datalist>
  </>
}
