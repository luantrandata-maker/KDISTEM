// Học liệu (Phân hệ 2) theo khung chương trình mới (Gói STEM):
// tab Học liệu theo chương trình (Loại CT › Học phần › Khối → chủ đề) | Danh mục học liệu (6 tab đúng 6 nội dung của chủ đề).
// Danh mục kiểu cũ (Bài học, Bài giảng, Tài liệu, Định mức vật tư, Kho hoạt động) và thẻ số liệu cũ đã ẩn; dữ liệu cũ vẫn giữ.
import { LibraryByPackage } from './ByPackage'

export function LibraryPage({ orgId }: { orgId: string | null; teacherId?: string | null; go?: (p: string) => void }) {
  // Gộp hai tab cũ (Học liệu theo chương trình | Danh mục học liệu) thành một màn: hàng nút "Theo chủ đề | Kế hoạch giảng dạy | …"
  return <LibraryByPackage orgId={orgId} />
}
