import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { myOrgId } from '../lib/org'

type Floor = { id: string; name: string }
type Building = { id: string; name: string; note: string | null; floors: Floor[] }

export default function Buildings() {
  const [rows, setRows] = useState<Building[]>([])
  const [bform, setBform] = useState<{ name: string; note: string } | null>(null)
  const [floorName, setFloorName] = useState<Record<string, string>>({})
  const [err, setErr] = useState('')

  async function load() {
    const { data } = await supabase.from('buildings').select('id, name, note, floors(id, name)').order('name')
    setRows((data as unknown as Building[]) ?? [])
  }
  useEffect(() => { load() }, [])

  async function addBuilding(e: React.FormEvent) {
    e.preventDefault(); if (!bform) return
    const { error } = await supabase.from('buildings').insert({ org_id: await myOrgId(), name: bform.name, note: bform.note || null })
    if (error) return setErr(error.message)
    setBform(null); setErr(''); load()
  }
  async function addFloor(b: Building) {
    const name = (floorName[b.id] ?? '').trim(); if (!name) return
    await supabase.from('floors').insert({ building_id: b.id, name })
    setFloorName({ ...floorName, [b.id]: '' }); load()
  }
  async function delFloor(id: string) { await supabase.from('floors').delete().eq('id', id); load() }
  async function delBuilding(b: Building) {
    if (!confirm(`Xoá ${b.name} và các tầng của tòa nhà?`)) return
    const { error } = await supabase.from('buildings').delete().eq('id', b.id)
    if (error) alert(error.message); else load()
  }

  const floors = rows.reduce((n, b) => n + b.floors.length, 0)
  return (
    <>
      <div className="cards">
        <div className="card"><strong>{rows.length}</strong><span>Tòa nhà</span></div>
        <div className="card"><strong>{floors}</strong><span>Tầng khai báo</span></div>
      </div>
      <div className="bar" style={{ marginTop: 16 }}>
        <p className="sub">Danh sách tòa nhà và tầng dùng khi đăng ký phòng STEM</p>
        <button className="primary" onClick={() => setBform({ name: '', note: '' })}>Thêm tòa nhà</button>
      </div>
      {bform && (
        <form className="panel formgrid" onSubmit={addBuilding}>
          <input required placeholder="Tên tòa nhà" value={bform.name} onChange={e => setBform({ ...bform, name: e.target.value })} />
          <input placeholder="Ghi chú" value={bform.note} onChange={e => setBform({ ...bform, note: e.target.value })} />
          <div><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setBform(null)}>Huỷ</button></div>
          {err && <p className="msg">{err}</p>}
        </form>
      )}
      {rows.map(b => (
        <div className="panel" key={b.id}>
          <div className="bar"><div><h3 style={{ margin: 0 }}>{b.name}</h3><small>{b.note}</small></div>
            <button onClick={() => delBuilding(b)}>Xoá tòa nhà</button></div>
          <div style={{ margin: '10px 0' }}>
            {b.floors.map(f => <span className="chip" key={f.id}>{f.name}<button className="x" onClick={() => delFloor(f.id)} aria-label={`Xoá ${f.name}`}>×</button></span>)}
            {b.floors.length === 0 && <small>Chưa có tầng.</small>}
          </div>
          <div className="addrow">
            <input placeholder="Tên tầng (VD: Tầng 1, Tầng trệt…)" value={floorName[b.id] ?? ''}
              onChange={e => setFloorName({ ...floorName, [b.id]: e.target.value })} />
            <button className="primary" onClick={() => addFloor(b)}>Thêm tầng</button>
          </div>
        </div>
      ))}
    </>
  )
}
