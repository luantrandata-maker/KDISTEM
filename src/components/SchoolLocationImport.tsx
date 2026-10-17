import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import ImportExcel from './ImportExcel'
import type { Column } from '../lib/sheet'

// Nhập toạ độ trường hàng loạt (migration 038) — Sở/Phòng: trường trực thuộc; quản trị nền tảng: mọi trường.
// "Tải file mẫu" = danh sách trường trong phạm vi kèm toạ độ hiện có, điền tiếp rồi nhập lại.
const COLS: Column[] = [
  { key: 'code', label: 'Mã trường', required: true, aliases: ['ma', 'ma truong'], width: 14 },
  { key: 'name', label: 'Tên trường', aliases: ['ten truong'], width: 34 },
  { key: 'ward', label: 'Xã/phường', aliases: ['xa', 'phuong'], width: 20 },
  { key: 'lat', label: 'Vĩ độ', aliases: ['vi do', 'lat', 'latitude'], width: 12 },
  { key: 'lng', label: 'Kinh độ', aliases: ['kinh do', 'lng', 'lon', 'longitude'], width: 12 },
  { key: 'coord', label: 'Toạ độ (dán từ Google Maps)', aliases: ['toa do', 'tọa độ', 'coordinates'], width: 26 },
]
type Org = { code: string | null; name: string; ward: string | null; lat: number | null; lng: number | null }

export default function SchoolLocationImport({ onDone, onMessage }: { onDone?: () => void; onMessage: (msg: string, isError?: boolean) => void }) {
  const [orgs, setOrgs] = useState<Org[]>([])
  async function load() {
    const { data } = await supabase.from('organizations').select('code, name, ward, lat, lng').eq('type', 'school').order('name')
    setOrgs((data as Org[]) ?? [])
  }
  useEffect(() => { load() }, [])
  async function importRows(recs: (Record<string, string> & { _line: number })[]) {
    const { data, error } = await supabase.rpc('import_school_locations', { p_rows: recs.map(r => ({ ...r, line: r._line })) })
    if (error) throw new Error(/function|schema cache/i.test(error.message) ? 'Hãy chạy migration 038 trên Supabase.' : error.message)
    const d = data as { updated: number; blank: number; skipped: { line: number; code: string; reason: string }[] }
    await load(); onDone?.()
    return `Đã cập nhật vị trí ${d.updated} trường.` + (d.blank ? ` ${d.blank} dòng chưa có toạ độ.` : '')
      + (d.skipped.length ? ` Bỏ qua ${d.skipped.length} dòng: ${d.skipped.slice(0, 4).map(s => `dòng ${s.line} (${s.reason})`).join('; ')}${d.skipped.length > 4 ? '…' : ''}` : '')
  }
  const has = orgs.filter(o => o.lat != null).length
  return (
    <span className="tools" title="Vị trí trường dùng cho bản đồ độ phủ STEM">
      <small>{has}/{orgs.length} trường có vị trí</small>
      <ImportExcel label="Nhập toạ độ từ Excel" columns={COLS} template="toa-do-truong"
        sample={orgs.map(o => [o.code ?? '', o.name, o.ward ?? '', o.lat != null ? o.lat.toFixed(6) : '', o.lng != null ? o.lng.toFixed(6) : '', ''])}
        onRecords={importRows} onMessage={onMessage} />
    </span>
  )
}
