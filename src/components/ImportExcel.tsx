import { useState } from 'react'
import { type Column, readRows, mapRows, downloadXlsx } from '../lib/sheet'

type Rec = Record<string, string> & { _line: number }

// Nút "Nhập Excel" + "Tải file mẫu". Cột được nhận theo tiêu đề (không cần đúng thứ tự), chấp nhận .xlsx và .csv.
export default function ImportExcel({ label = 'Nhập Excel', templateLabel = 'Tải file mẫu', columns, template, sample = [], onRecords, onMessage }: {
  label?: string; templateLabel?: string; columns: Column[]; template: string; sample?: string[][]
  onRecords: (rows: Rec[]) => Promise<string>; onMessage: (msg: string, isError?: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  async function pick(file: File) {
    setBusy(true)
    try {
      const { records, missing } = mapRows(await readRows(file), columns)
      if (missing.length) return onMessage(`Không tìm thấy cột: ${missing.join(', ')}. Hãy dùng “Tải file mẫu”.`, true)
      const rows = records.filter(r => columns.some(c => r[c.key]))
      if (!rows.length) return onMessage('File không có dòng dữ liệu nào.', true)
      onMessage(await onRecords(rows))
    } catch (e) {
      onMessage('Không đọc được file: ' + (e instanceof Error ? e.message : String(e)), true)
    } finally { setBusy(false) }
  }
  return (
    <>
      <label className={'filebtn' + (busy ? ' busy' : '')}>{busy ? 'Đang nhập…' : label}
        <input type="file" hidden accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" disabled={busy}
          onChange={e => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = '' }} />
      </label>
      <button type="button" onClick={() => downloadXlsx(template, columns, sample)}>{templateLabel}</button>
    </>
  )
}
