// Đọc bảng tính .xlsx / .csv và xuất .xlsx (dùng read-excel-file, write-excel-file — chạy hoàn toàn trên trình duyệt)
import { readSheet } from 'read-excel-file/browser'
import writeXlsxFile from 'write-excel-file/browser'

export type Column = { key: string; label: string; aliases?: string[]; required?: boolean; width?: number }

// Bỏ dấu tiếng Việt, khoảng trắng, chữ hoa để so khớp tiêu đề cột
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const cellText = (v: unknown): string => {
  if (v == null) return ''
  if (v instanceof Date) return `${String(v.getDate()).padStart(2, '0')}/${String(v.getMonth() + 1).padStart(2, '0')}/${v.getFullYear()}`
  return String(v).trim()
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false
  const sep = (text.split(/\r?\n/)[0].match(/;/g)?.length ?? 0) > (text.split(/\r?\n/)[0].match(/,/g)?.length ?? 0) ? ';' : text.includes('\t') && !text.includes(',') ? '\t' : ','
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else if (c === '"') q = true
    else if (c === sep) { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = '' }
    else cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows.map(r => r.map(x => x.trim()))
}

// Đọc file thành mảng dòng (mỗi dòng là mảng chuỗi), bỏ dòng trống
export async function readRows(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase()
  let rows: string[][]
  if (name.endsWith('.csv') || name.endsWith('.txt')) rows = parseCsv((await file.text()).replace(/^﻿/, ''))
  else if (name.endsWith('.xlsx')) rows = (await readSheet(file)).map(r => r.map(cellText))
  else throw new Error('Chỉ hỗ trợ file .xlsx hoặc .csv (Excel: Lưu thành → Excel Workbook).')
  return rows.filter(r => r.some(c => c !== ''))
}

// Ánh xạ theo tiêu đề cột (không phụ thuộc thứ tự cột). Dòng tiêu đề là dòng đầu tiên khớp được ≥ 1 cột bắt buộc.
export function mapRows(rows: string[][], columns: Column[]): { records: (Record<string, string> & { _line: number })[]; missing: string[] } {
  const want = columns.map(c => ({ ...c, names: [c.label, ...(c.aliases ?? [])].map(norm) }))
  const hi = rows.findIndex(r => want.filter(c => c.required).every(c => r.some(h => c.names.includes(norm(h)))))
  if (hi < 0) return { records: [], missing: columns.filter(c => c.required).map(c => c.label) }
  const header = rows[hi].map(norm)
  const idx = Object.fromEntries(want.map(c => [c.key, header.findIndex(h => c.names.includes(h))]))
  const records = rows.slice(hi + 1).map((r, i) => ({
    ...Object.fromEntries(columns.map(c => [c.key, idx[c.key] >= 0 ? (r[idx[c.key]] ?? '').trim() : ''])),
    _line: hi + i + 2,
  })) as (Record<string, string> & { _line: number })[]
  return { records, missing: [] }
}

// Xuất bảng ra .xlsx (dòng tiêu đề in đậm, cố định)
export async function downloadXlsx(fileName: string, columns: Column[], rows: (string | number | null | undefined)[][], sheet = 'Dữ liệu') {
  const data = [
    columns.map(c => ({ value: c.label + (c.required ? ' *' : ''), fontWeight: 'bold' as const, backgroundColor: '#E6F1FD' })),
    ...rows.map(r => r.map(v => (v == null || v === '' ? null : typeof v === 'number' ? { value: v, type: Number } : { value: String(v), type: String }))),
  ]
  await writeXlsxFile(data as any, { columns: columns.map(c => ({ width: c.width ?? Math.max(12, c.label.length + 4) })), sheet: sheet.replace(/[[\]\/\\:*?]/g, '-').slice(0, 31), stickyRowsCount: 1 } as any)
    .toFile(fileName.endsWith('.xlsx') ? fileName : fileName + '.xlsx')
}

// Tóm tắt kết quả nhập để hiện cho người dùng
export function importSummary(ok: number, noun: string, bad: string[]) {
  return `Đã nhập ${ok} ${noun}.` + (bad.length ? ` Bỏ qua ${bad.length} dòng: ${bad.slice(0, 4).join('; ')}${bad.length > 4 ? '…' : '.'}` : '')
}

// Nhiều trang tính trong một file (sao lưu / xuất dữ liệu)
export async function downloadWorkbook(fileName: string, sheets: { name: string; columns: Column[]; rows: (string | number | null | undefined)[][] }[]) {
  const used = new Set<string>()
  const books = sheets.map(s => {
    let name = s.name.replace(/[[\]\/\\:*?]/g, '-').slice(0, 31), k = 2
    while (used.has(name)) name = s.name.slice(0, 28) + ' ' + k++
    used.add(name)
    return {
      data: [s.columns.map(c => ({ value: c.label, fontWeight: 'bold' as const, backgroundColor: '#E6F1FD' })),
        ...s.rows.map(r => r.map(v => (v == null || v === '' ? null : typeof v === 'number' ? { value: v, type: Number } : { value: String(v), type: String })))],
      sheet: name, columns: s.columns.map(c => ({ width: c.width ?? Math.min(40, Math.max(12, c.label.length + 4)) })), stickyRowsCount: 1,
    }
  })
  await writeXlsxFile(books as any).toFile(fileName.endsWith('.xlsx') ? fileName : fileName + '.xlsx')
}
