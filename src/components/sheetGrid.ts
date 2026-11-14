// Lưới nhập kiểu Excel cho các bảng sửa trực tiếp (bài học, nội dung đào tạo).
// Ô nhập mang data-gc (khoá cột) và data-gr (id dòng; dòng thêm mới không có data-gr).
import type React from 'react'

const rowsOf = (el: Element) => Array.from(el.closest('table')?.querySelectorAll('tbody>tr, tfoot>tr') ?? []).filter(r => r.querySelector('[data-gc]'))
const focusCell = (tr: Element | undefined, col: string) => {
  const t = tr?.querySelector(`[data-gc="${col}"]`) as HTMLInputElement | null
  if (!t) return false
  t.focus(); t.select?.(); return true
}

/** Phím: Enter hoặc ↑↓ sang dòng (cùng cột), ←→ ở đầu/cuối ô sang cột, Esc huỷ sửa, Alt+Enter xuống dòng trong ô nhiều dòng. */
export const gridKey = (order: readonly string[]) => (e: React.KeyboardEvent) => {
  const el = e.target as HTMLInputElement | HTMLTextAreaElement, col = el.dataset?.gc
  if (!col || e.ctrlKey || e.metaKey) return
  const tr = el.closest('tr')!, rows = rowsOf(el), ri = rows.indexOf(tr), isNew = !el.dataset.gr
  const ta = el.tagName === 'TEXTAREA', len = el.value.length
  const atStart = el.selectionStart === 0 && el.selectionEnd === 0, atEnd = el.selectionStart === len && el.selectionEnd === len
  const cols = order.filter(k => tr.querySelector(`[data-gc="${k}"]`)), ci = cols.indexOf(col)
  const go = (r: number) => { if (focusCell(rows[r], col) || focusCell(rows[r], order[0])) e.preventDefault() }
  if (e.key === 'Escape' && !isNew) { el.value = el.defaultValue; el.blur(); e.preventDefault(); return }
  if (e.key === 'Enter' && ta && (e.altKey || e.shiftKey)) { if (e.altKey) { e.preventDefault(); el.setRangeText('\n', el.selectionStart ?? len, el.selectionEnd ?? len, 'end') } return }
  if (e.key === 'Enter' && !isNew && !e.shiftKey) return go(ri + 1)
  if (e.key === 'ArrowDown' && !e.shiftKey && (!ta || atEnd)) return go(ri + 1)
  if (e.key === 'ArrowUp' && !e.shiftKey && (!ta || atStart) && ri > 0) return go(ri - 1)
  if (e.key === 'ArrowRight' && !e.shiftKey && atEnd && ci < cols.length - 1) { e.preventDefault(); focusCell(tr, cols[ci + 1]) }
  if (e.key === 'ArrowLeft' && !e.shiftKey && atStart && ci > 0) { e.preventDefault(); focusCell(tr, cols[ci - 1]) }
}

/** Dán một vùng ô từ Excel vào ô của dòng có sẵn. Trả về từng dòng dán: id dòng đích (undefined nếu vượt quá bảng) và giá trị theo khoá cột.
 *  Trả null khi chỉ là dán bình thường vào một ô (để trình duyệt tự dán). */
export function gridPaste(e: React.ClipboardEvent, order: readonly string[], multiline: readonly string[] = []) {
  const el = e.target as HTMLInputElement | HTMLTextAreaElement, col = el.dataset?.gc, id = el.dataset?.gr
  if (!col || !id) return null
  const t = e.clipboardData.getData('text').replace(/\r/g, '').replace(/\n+$/, '')
  if (!t.includes('\t') && (multiline.includes(col) || !t.includes('\n'))) return null
  e.preventDefault()
  const rows = rowsOf(el), ri = rows.findIndex(r => r.querySelector(`[data-gr="${id}"]`)), c0 = order.indexOf(col)
  return t.split('\n').map((line, i) => {
    const rid = (rows[ri + i]?.querySelector('[data-gr]') as HTMLElement | null)?.dataset.gr
    const vals: Record<string, string> = {}
    line.split('\t').forEach((v, j) => { const k = order[c0 + j]; if (k) vals[k] = v.trim() })
    return { id: rid, vals, fromFirst: c0 === 0 }
  })
}
