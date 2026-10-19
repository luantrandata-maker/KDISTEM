import { supabase } from './supabase'

// Loại phòng (migration 056): cùng bảng stem_rooms. Chỉ phòng STEM xếp được TKB / đăng ký dạy / mượn tại phòng.
export type RoomKind = 'stem' | 'classroom' | 'storage'
export const ROOM_KIND: Record<RoomKind, string> = { stem: 'Phòng STEM', classroom: 'Phòng học', storage: 'Kho' }
/** Phòng loại STEM (bản ghi chưa có cột room_kind — CSDL trước 056 — coi là STEM) */
export const isStem = (x: { room_kind?: string | null }) => (x.room_kind ?? 'stem') === 'stem'
export const ROOM_KINDS = Object.keys(ROOM_KIND) as RoomKind[]
export const ROOM_STATUS: Record<string, string> = { active: 'Hoạt động', maintenance: 'Bảo trì', inactive: 'Ngừng' }
export const ROOM_TIER: Record<string, string> = { advanced: 'Nâng cao', basic: 'Cơ bản', minimal: 'Tối thiểu' }
// Trạng thái thiết bị mặc định khi chuyển tới một loại phòng
export const unitStatusAt = (kind: RoomKind | null, cur: string) =>
  kind === 'storage' || kind === null ? (cur === 'available' || cur === 'in_use' ? 'in_stock' : cur) : (cur === 'in_stock' ? 'available' : cur)

export type RoomLite = { id: string; name: string; code: string | null; room_kind: RoomKind; status: string }
export type RoomUnit = { id: string; type_id: string; serial: string | null; status: string; room_id: string | null; warranty_until: string | null
  equipment_types: { name: string; brand: string | null; sku: string | null } | null }
export type RoomStock = { id: string; supply_id: string; room_id: string | null; qty: number
  supplies: { name: string; sku: string | null; unit: string; category: string | null; min_qty: number } | null }

/** Phòng của trường (mọi loại), sắp theo loại rồi mã/tên. Lỗi "room_kind" = CSDL chưa có migration 056 → coi mọi phòng là STEM. */
export async function loadRooms(kind?: RoomKind): Promise<RoomLite[]> {
  let q = supabase.from('stem_rooms').select('id, name, code, room_kind, status')
  if (kind) q = q.eq('room_kind', kind)
  let { data, error } = await q
  if (error && /room_kind/.test(error.message)) {
    if (kind && kind !== 'stem') return []
    ;({ data } = await supabase.from('stem_rooms').select('id, name, code, status') as any)
    data = (data ?? []).map((r: any) => ({ ...r, room_kind: 'stem' }))
  }
  return sortRooms((data as RoomLite[]) ?? [])
}
export const sortRooms = <T extends { room_kind: RoomKind; code: string | null; name: string }>(rs: T[]) =>
  [...rs].sort((a, b) => ROOM_KINDS.indexOf(a.room_kind) - ROOM_KINDS.indexOf(b.room_kind) || (a.code ?? a.name).localeCompare(b.code ?? b.name, 'vi', { numeric: true }))

/** Nhãn phòng cho ô chọn: "Phòng STEM 1 · Kho" (ghi loại khi không phải phòng STEM) */
export const roomLabel = (r: RoomLite) => r.room_kind === 'stem' ? r.name : `${r.name} · ${ROOM_KIND[r.room_kind]}`

/** Thiết bị và tồn vật tư theo phòng của đơn vị đang làm việc */
export async function loadRoomContents() {
  const [u, s] = await Promise.all([
    supabase.from('equipment_units').select('id, type_id, serial, status, room_id, warranty_until, equipment_types(name, brand, sku)').order('serial'),
    supabase.from('supply_stocks').select('id, supply_id, room_id, qty, supplies(name, sku, unit, category, min_qty)'),
  ])
  return { units: (u.data as unknown as RoomUnit[]) ?? [], stocks: s.error ? [] : ((s.data as unknown as RoomStock[]) ?? []) }
}

/** Lỗi CSDL → câu dễ hiểu */
export function roomError(m: string) {
  if (/foreign key/i.test(m)) return 'Phòng đã có lịch sử sử dụng (mượn trả, đăng ký, kiểm kê…) nên không xoá được — hãy chuyển trạng thái sang "Ngừng".'
  if (/schema cache|column .*room_kind|supply_stocks.* does not exist/i.test(m)) return 'CSDL chưa có migration 056 (loại phòng). Hãy merge PR để CI chạy migration.'
  if (/row-level|permission denied/i.test(m)) return 'Bạn không có quyền với phòng của đơn vị này.'
  return m
}

/** Chuyển một thiết bị sang phòng / kho khác (hoặc "chưa xếp phòng"), ghi lịch sử thiết bị */
export async function moveUnitTo(orgId: string, u: { id: string; status: string; room_id: string | null }, rooms: RoomLite[], roomId: string) {
  const from = rooms.find(r => r.id === u.room_id); const to = rooms.find(r => r.id === roomId) ?? null
  const status = unitStatusAt(to?.room_kind ?? null, u.status)
  const { error } = await supabase.from('equipment_units').update({ room_id: to?.id ?? null, status }).eq('id', u.id)
  if (error) return error.message
  await supabase.from('equipment_events').insert({ org_id: orgId, unit_id: u.id, kind: 'transfer', title: 'Chuyển phòng',
    note: `${from?.name ?? 'Chưa xếp phòng'} → ${to?.name ?? 'Chưa xếp phòng'}` })
  return null
}
