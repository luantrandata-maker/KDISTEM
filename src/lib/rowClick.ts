// Bấm vào bất kỳ chỗ nào trên một dòng bảng = bấm vào tên (nút / liên kết .namelink) của dòng đó.
// Áp cho tất cả bảng: dòng có nút data-rowopen hoặc tên .namelink và chưa tự xử lý bấm dòng (tr.clickrow).
// Bỏ qua khi bấm vào ô chọn, nút, liên kết, ô nhập… hoặc khi đang bôi đen chữ để sao chép.
const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="button"], [role="checkbox"], [contenteditable="true"], td.sel, .norow'

export function installRowClick() {
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0) return
    const t = e.target as Element | null
    if (!t || t.closest(INTERACTIVE)) return
    const tr = t.closest('tbody tr')
    if (!tr || tr.classList.contains('clickrow')) return
    if (window.getSelection()?.toString()) return
    // Nút mở chi tiết ghi rõ bằng data-rowopen (vd "Xem", "Sửa") được ưu tiên; nếu không có thì lấy tên .namelink đầu tiên
    const link = tr.querySelector<HTMLElement>('[data-rowopen]') ?? tr.querySelector<HTMLElement>('button.namelink, a.namelink')
    if (!link) return   // nhiều tên trên một dòng: lấy tên đầu tiên (cột tên chính)
    if ((link as HTMLButtonElement).disabled) return
    link.click()
  })
}
