import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { TProps, NoTeacher, useMyClasses } from './common'
import { isStem } from '../../lib/rooms'

type EqType = { id: string; name: string; brand: string | null; category: string | null }
type Period = { id: string; name: string; starts_at: string; ends_at: string }
type Room = { id: string; name: string; status: string }
type Item = { type_id: string; name: string; qty: number }
type Req = {
  id: string; title: string; items: string | null; item_list: Item[]; on_date: string; mode: string; status: string
  classes: { name: string } | null; stem_rooms: { name: string } | null; period_configs: { name: string } | null
}
const ST: Record<string, [string, string]> = {
  pending: ['Chờ duyệt', 'maintenance'], approved: ['Đã duyệt', 'active'], lent: ['Đã nhận thiết bị', 'active'],
  returned: ['Đã trả', ''], rejected: ['Từ chối', 'inactive'],
}
const hm = (t: string) => t.slice(0, 5)
const localDate = (plus = 0) => { const d = new Date(Date.now() + plus * 86400000); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10) }

// Phiếu mượn thiết bị của giáo viên → quản trị duyệt ở Quản lý Phòng STEM → Mượn – Trả
export function TeacherBorrow({ teacherId, orgId }: TProps) {
  const classes = useMyClasses(teacherId)
  const [types, setTypes] = useState<EqType[]>([])
  const [avail, setAvail] = useState<Record<string, number>>({})
  const [periods, setPeriods] = useState<Period[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [mine, setMine] = useState<Req[]>([])
  const [f, setF] = useState({ title: '', class_id: '', on_date: localDate(1), period_id: '', mode: 'take_to_class', room_id: '' })
  const [items, setItems] = useState<Item[]>([])
  const [free, setFree] = useState<Record<string, number> | null>(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  async function load() {
    if (!teacherId) return
    const [t, u, p, r, m] = await Promise.all([
      supabase.from('equipment_types').select('id, name, brand, category').order('name'),
      supabase.from('equipment_units').select('type_id, status'),
      supabase.from('period_configs').select('id, name, starts_at, ends_at').order('starts_at'),
      supabase.from('stem_rooms').select('*').order('name'),
      supabase.from('borrow_requests').select('id, title, items, item_list, on_date, mode, status, classes(name), stem_rooms(name), period_configs(name)')
        .eq('teacher_id', teacherId).order('on_date', { ascending: false }),
    ])
    setTypes((t.data as EqType[]) ?? [])
    const a: Record<string, number> = {}; ((u.data as { type_id: string; status: string }[]) ?? []).forEach(x => { if (x.status === 'available') a[x.type_id] = (a[x.type_id] ?? 0) + 1 }); setAvail(a)
    setPeriods((p.data as Period[]) ?? []); setRooms(((r.data as Room[]) ?? []).filter(x => x.status === 'active' && isStem(x as { room_kind?: string })))
    setMine((m.data as unknown as Req[]) ?? [])
  }
  useEffect(() => { load() }, [teacherId])
  // Còn trống theo đúng ngày, tiết đã chọn: trừ thiết bị của các phiếu đã duyệt / đang mượn chồng giờ (migration 029)
  useEffect(() => {
    if (!teacherId || !f.on_date) return
    supabase.rpc('equipment_availability', { p_day: f.on_date, p_period: f.period_id || null }).then(({ data, error }) => {
      if (error) return setFree(null)
      const m: Record<string, number> = {}; ((data as { type_id: string; free: number }[]) ?? []).forEach(x => { m[x.type_id] = x.free }); setFree(m)
    })
  }, [teacherId, f.on_date, f.period_id, mine.length])
  const left = (typeId: string) => (free ? free[typeId] ?? 0 : avail[typeId] ?? 0)
  const leftLabel = free ? 'còn trống tiết này' : 'sẵn sàng'
  useEffect(() => { if (!f.class_id && classes[0]) setF(v => ({ ...v, class_id: classes[0].id })) }, [classes.length])

  const addItem = (type_id: string) => {
    const t = types.find(x => x.id === type_id); if (!t || items.some(i => i.type_id === type_id)) return
    setItems([...items, { type_id, name: t.name, qty: 1 }])
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setOk('')
    if (!items.length) return setErr('Chọn ít nhất một thiết bị.')
    const over = items.filter(i => i.qty > left(i.type_id))
    const summary = items.map(i => `${i.name} × ${i.qty}`).join('; ')
    const { error } = await supabase.from('borrow_requests').insert({
      org_id: orgId, teacher_id: teacherId, class_id: f.class_id || null, title: f.title.trim() || `Mượn thiết bị cho ${classes.find(c => c.id === f.class_id)?.name ?? 'tiết học'}`,
      on_date: f.on_date, period_id: f.period_id || null, mode: f.mode, room_id: f.mode === 'in_room' ? f.room_id || null : null,
      items: summary, item_list: items,
    })
    if (error) return setErr('Không gửi được: ' + error.message)
    setErr(''); setItems([]); setF({ ...f, title: '' })
    setOk('Đã gửi phiếu mượn, chờ quản trị duyệt.' + (over.length ? ` Lưu ý: ${over.map(o => o.name).join(', ')} không còn đủ trong khung giờ này — phiếu chỉ được duyệt khi có thiết bị trả về.` : ''))
    load()
  }
  async function cancel(r: Req) {
    if (!confirm(`Huỷ phiếu “${r.title}”?`)) return
    const { error } = await supabase.from('borrow_requests').delete().eq('id', r.id)
    if (error) setErr(error.message); load()
  }

  if (!teacherId) return <NoTeacher />
  return (
    <>
      <form className="panel formgrid" onSubmit={submit}>
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Mục đích / nội dung tiết dạy</span>
          <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="VD: Thực hành lập trình robot tránh vật cản" /></label>
        <label className="field"><span>Lớp</span>
          <select value={f.class_id} onChange={e => setF({ ...f, class_id: e.target.value })}>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field"><span>Ngày dùng *</span>
          <input type="date" required min={localDate()} value={f.on_date} onChange={e => setF({ ...f, on_date: e.target.value })} /></label>
        <label className="field"><span>Tiết</span>
          <select value={f.period_id} onChange={e => setF({ ...f, period_id: e.target.value })}>
            <option value="">Cả buổi</option>{periods.map(p => <option key={p.id} value={p.id}>{p.name} ({hm(p.starts_at)}–{hm(p.ends_at)})</option>)}</select></label>
        <label className="field"><span>Hình thức</span>
          <select value={f.mode} onChange={e => setF({ ...f, mode: e.target.value })}>
            <option value="take_to_class">Mang về lớp học</option><option value="in_room">Dùng tại phòng STEM</option></select></label>
        {f.mode === 'in_room' && <label className="field"><span>Phòng STEM</span>
          <select value={f.room_id} onChange={e => setF({ ...f, room_id: e.target.value })}><option value="">—</option>{rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
        <div className="field" style={{ gridColumn: '1 / -1' }}><span>Thiết bị cần mượn *</span>
          {items.map((it, i) => (
            <div className="addrow" key={it.type_id}>
              <span style={{ flex: 1, alignSelf: 'center' }}><b>{it.name}</b> <small>· {leftLabel} {left(it.type_id)}</small>{it.qty > left(it.type_id) && <small style={{ color: 'var(--bad)' }}> · thiếu {it.qty - left(it.type_id)}</small>}</span>
              <input type="number" min={1} max={99} value={it.qty} style={{ flex: '0 0 90px' }} aria-label={`Số lượng ${it.name}`}
                onChange={e => setItems(items.map((x, j) => j === i ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x))} />
              <button type="button" className="x" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={`Bỏ ${it.name}`}>×</button>
            </div>
          ))}
          <select value="" onChange={e => addItem(e.target.value)} aria-label="Thêm thiết bị">
            <option value="">+ Thêm thiết bị…</option>
            {types.filter(t => !items.some(i => i.type_id === t.id)).map(t => <option key={t.id} value={t.id}>{t.name}{t.brand ? ` · ${t.brand}` : ''} — {leftLabel} {left(t.id)}</option>)}
          </select>
        </div>
        <div className="formactions"><button className="primary" type="submit" disabled={!items.length}>Gửi phiếu mượn</button></div>
        {err && <p className="msg">{err}</p>}
        {ok && <p className="sub" style={{ gridColumn: '1 / -1', margin: 0 }}><b>{ok}</b></p>}
      </form>
      <div className="wrap">
        <table>
          <thead><tr><th>Phiếu mượn</th><th>Thiết bị</th><th>Ngày · Tiết</th><th>Hình thức</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>
            {mine.map(r => (
              <tr key={r.id}>
                <td><b>{r.title}</b>{r.classes && <><br /><small>{r.classes.name}</small></>}</td>
                <td>{r.item_list?.length ? r.item_list.map(x => `${x.name} × ${x.qty}`).join(', ') : r.items ?? '—'}</td>
                <td>{new Date(r.on_date).toLocaleDateString('vi-VN')}{r.period_configs ? ` · ${r.period_configs.name}` : ''}</td>
                <td>{r.mode === 'in_room' ? `Tại ${r.stem_rooms?.name ?? 'phòng STEM'}` : 'Mang về lớp'}</td>
                <td><span className={'pill ' + (ST[r.status]?.[1] ?? '')}>{ST[r.status]?.[0] ?? r.status}</span></td>
                <td>{r.status === 'pending' && <button onClick={() => cancel(r)}>Huỷ</button>}</td>
              </tr>
            ))}
            {mine.length === 0 && <tr><td colSpan={6}>Bạn chưa gửi phiếu mượn nào.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
