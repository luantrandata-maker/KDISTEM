import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStemTracks, type StemTrack } from '../lib/stemTracks'
import { gradeName } from '../lib/eduLevels'
import { frameErr, loadFrame, loadPackages, type PackageItem, type ProgramModule, type ProgramPackage, type ProgramTopic } from '../lib/programFrame'
import { PROGRAM_COLOR } from './teacher/common'
import { HeadAction } from '../components/PageFrame'
import { DetailHead } from '../components/DetailHead'
import { ElView } from '../components/ElView'
import { ActionBar, type Act } from '../components/ActionBar'

// Gói STEM theo khung chương trình (148): mỗi gói gồm các loại chương trình; mỗi loại, mỗi khối chọn học phần ở từng vị trí
// (Học phần 1, Học phần 2…). Xem một gói, so sánh các gói (tô màu chỗ khác nhau). Chỉ KDI sửa.

const GRADES = Array.from({ length: 12 }, (_, i) => i + 1)
const chip = (code: string) => <span className="progchip" style={{ background: PROGRAM_COLOR[code], color: '#fff' }}>{code}</span>
const DIFF = { background: 'color-mix(in srgb, #f59e0b 18%, transparent)' }
const keyOf = (t: string, g: number, s: number) => `${t}|${g}|${s}`

export function ProgramPackages() {
  const { tracks } = useStemTracks()
  const active = tracks.filter(t => t.active !== false)
  const [admin, setAdmin] = useState(false)
  const [packages, setPackages] = useState<ProgramPackage[]>([])
  const [items, setItems] = useState<PackageItem[]>([])
  const [modules, setModules] = useState<ProgramModule[]>([])
  const [topics, setTopics] = useState<ProgramTopic[]>([])
  const [msg, setMsg] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [compare, setCompare] = useState(false)
  const [editPkg, setEditPkg] = useState<(ProgramPackage & { copyFrom?: string }) | null>(null)
  const reload = () => Promise.all([loadPackages(), loadFrame()]).then(([p, f]) => {
    setPackages(p.packages); setItems(p.items); setModules(f.modules); setTopics(f.topics); setMsg(p.error || f.error)
  })
  useEffect(() => { supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data)); reload() }, [])

  const modName = (id: string) => modules.find(m => m.id === id)?.name ?? '?'
  const cell = (pkg: string, t: string, g: number, s: number) => items.find(i => i.package_id === pkg && i.track_code === t && i.grade === g && i.slot === s)
  // Vị trí (cột) có giá trị ở loại chương trình t, trong các gói đang xét
  const slotsOf = (t: string, pkgs: string[]) => {
    const n = Math.max(0, ...items.filter(i => i.track_code === t && pkgs.includes(i.package_id)).map(i => i.slot))
    return Array.from({ length: n }, (_, i) => i + 1)
  }
  // Ô nào khác nhau giữa các gói đang dùng
  const live = packages.filter(p => p.active)
  const diffKeys = new Set<string>()
  for (const t of active) for (const g of GRADES) for (const s of slotsOf(t.code, live.map(p => p.id))) {
    const v = new Set(live.map(p => cell(p.id, t.code, g, s)?.module_id ?? ''))
    if (v.size > 1) diffKeys.add(keyOf(t.code, g, s))
  }
  const diffTracks = (pkg: string) => active.filter(t => GRADES.some(g => slotsOf(t.code, [pkg]).some(s => diffKeys.has(keyOf(t.code, g, s))))).map(t => t.code)

  async function delPkg(p: ProgramPackage) {
    if (!confirm(`Xoá ${p.name}? Học phần của gói cũng bị xoá theo.`)) return
    const { data, error } = await supabase.from('program_packages').delete().eq('id', p.id).select('id')
    if (error) return setMsg(frameErr(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return setMsg(frameErr('row-level'))
    setOpenId(null); setMsg(''); reload()
  }

  if (editPkg) return <ElView back={openId ? 'Gói STEM' : 'Danh sách gói'} onBack={() => setEditPkg(null)}
    title={editPkg.id ? 'Sửa gói STEM' : editPkg.copyFrom ? 'Sao chép gói STEM' : 'Thêm gói STEM'}>
    <PackageForm p={editPkg} onCancel={() => setEditPkg(null)} onSaved={id => { setEditPkg(null); if (id) setOpenId(id); reload() }} />
  </ElView>

  if (compare) return <>
    <DetailHead back="Gói STEM" onBack={() => setCompare(false)} title="So sánh các gói STEM" />
    {msg && <p className="msg" role="status">{msg}</p>}
    <CompareView tracks={active} packages={live} cell={cell} slotsOf={slotsOf} modName={modName} diffKeys={diffKeys} />
  </>

  const cur = openId ? packages.find(p => p.id === openId) : undefined
  if (cur) {
    const acts: Act[] = admin ? [
      { key: 'edit', label: 'Sửa thông tin', icon: 'pencil', onClick: () => setEditPkg(cur) },
      { key: 'copy', label: 'Sao chép thành gói mới', onClick: () => setEditPkg({ ...cur, id: '', code: '', name: cur.name + ' (bản sao)', sort: cur.sort + 1, copyFrom: cur.id }) },
      { key: 'del', label: 'Xoá', icon: 'trash', kind: 'danger', onClick: () => delPkg(cur) },
    ] : []
    const dt = diffTracks(cur.id)
    return <>
      <DetailHead back="Gói STEM" onBack={() => { setOpenId(null); setMsg('') }} title={cur.name}
        extra={<span className={'pill ' + (cur.active ? 'good' : 'inactive')}>{cur.active ? 'Đang bán' : 'Ngừng bán'}</span>} />
      <div className="bar"><small className="sub">{cur.description || 'Chưa có mô tả.'}{dt.length ? ` Khác các gói khác ở: ${dt.join(', ')} (ô tô màu).` : ''}</small>
        {acts.length > 0 && <div className="tools"><ActionBar items={acts} /></div>}</div>
      {msg && <p className="msg" role="status">{msg}</p>}
      {active.map(t => <TrackGrid key={t.code} pkg={cur} track={t} admin={admin} items={items} modules={modules.filter(m => m.track_code === t.code)} topics={topics}
        slots={slotsOf(t.code, [cur.id])} diffKeys={diffKeys} onChanged={reload} onErr={setMsg} />)}
    </>
  }

  return <>
    <HeadAction>
      <button type="button" onClick={() => setCompare(true)} disabled={live.length < 2}>So sánh các gói</button>
      {admin && <button type="button" className="primary ttadd" onClick={() => setEditPkg({ id: '', code: '', name: '', description: '', sort: packages.reduce((x, p) => Math.max(x, p.sort), 0) + 1, active: true })}>+ Thêm gói</button>}
    </HeadAction>
    {msg && <p className="msg" role="status">{msg}</p>}
    <table className="table">
      <thead><tr><th>Gói</th><th>Mô tả</th>{active.map(t => <th key={t.code}>{chip(t.code)} {t.name}</th>)}<th>Khác các gói khác ở</th><th>Trạng thái</th></tr></thead>
      <tbody>{packages.map(p => {
        const dt = diffTracks(p.id)
        return <tr key={p.id} className="rowlink" style={{ cursor: 'pointer' }} onClick={() => { setMsg(''); setOpenId(p.id) }}>
          <td><b>{p.name}</b></td><td><small>{p.description || '—'}</small></td>
          {active.map(t => {
            const its = items.filter(i => i.package_id === p.id && i.track_code === t.code)
            const mods = [...new Set(its.map(i => i.module_id))]
            const nt = its.reduce((x, i) => x + topics.filter(tp => tp.module_id === i.module_id && tp.grade === i.grade && tp.active).length, 0)
            return <td key={t.code} title={mods.map(modName).join('\n')}>{mods.length ? <>{mods.length} học phần<div className="sub"><small>{nt ? `${nt} chủ đề` : 'chưa có chủ đề'}</small></div></> : <small className="sub">Không có</small>}</td>
          })}
          <td>{dt.length ? dt.join(', ') : <small className="sub">—</small>}</td>
          <td><span className={'pill ' + (p.active ? 'good' : 'inactive')}>{p.active ? 'Đang bán' : 'Ngừng bán'}</span></td>
        </tr>
      })}
      {!packages.length && <tr><td colSpan={4 + active.length}><small className="sub">Chưa có gói STEM.</small></td></tr>}</tbody>
    </table>
    <p className="tablenote sub">Gói STEM → loại chương trình → học phần (theo khối) → chủ đề. Mỗi gói gồm các loại chương trình; với mỗi loại, mỗi khối, gói chọn học phần nào học trong năm; mỗi học phần gồm các chủ đề. Bấm một gói để xem chi tiết{admin ? ', sửa học phần' : ''}; "So sánh các gói" để xem các gói khác nhau ở đâu.</p>
  </>
}

function TrackGrid({ pkg, track, admin, items, modules, topics, slots, diffKeys, onChanged, onErr }: {
  pkg: ProgramPackage; track: StemTrack; admin: boolean; items: PackageItem[]; modules: ProgramModule[]; topics: ProgramTopic[]; slots: number[]
  diffKeys: Set<string>; onChanged: () => void; onErr: (m: string) => void
}) {
  const [edit, setEdit] = useState(false)
  const [extra, setExtra] = useState(0)
  const [open, setOpen] = useState<string | null>(null)   // "khối|vị trí" đang mở danh sách chủ đề
  const topicsIn = (moduleId: string | undefined, g: number) => moduleId ? topics.filter(t => t.module_id === moduleId && t.grade === g && t.active).sort((a, b) => a.seq - b.seq) : []
  const periodsOf = (moduleId: string | undefined, g: number) => {
    const m = name(moduleId)
    if (!m) return 0
    return m.periods ?? topicsIn(moduleId, g).reduce((x, t) => x + (t.periods || 0), 0)
  }
  const cols = Array.from({ length: Math.max(slots.length, 1) + extra }, (_, i) => i + 1)
  const mine = items.filter(i => i.package_id === pkg.id && i.track_code === track.code)
  const get = (g: number, s: number) => mine.find(i => i.grade === g && i.slot === s)
  const name = (id?: string) => modules.find(m => m.id === id)
  const rows = edit ? GRADES : GRADES.filter(g => mine.some(i => i.grade === g))
  async function set(g: number, s: number, moduleId: string) {
    const q = moduleId
      ? supabase.from('program_package_items').upsert({ package_id: pkg.id, track_code: track.code, grade: g, slot: s, module_id: moduleId }).select('grade')
      : supabase.from('program_package_items').delete().match({ package_id: pkg.id, track_code: track.code, grade: g, slot: s }).select('grade')
    const { data, error } = await q
    if (error) return onErr(frameErr(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return onErr(frameErr('row-level'))
    onErr(''); onChanged()
  }
  const total = (g: number) => cols.reduce((x, s) => x + periodsOf(get(g, s)?.module_id, g), 0)
  const nTopics = mine.reduce((x, i) => x + topicsIn(i.module_id, i.grade).length, 0)
  return <div className="panel pdcard" style={{ marginBottom: 12 }}>
    <div className="bar"><h4 style={{ margin: 0 }}>{chip(track.code)} {track.name} <small className="sub">· {new Set(mine.map(i => i.module_id)).size} học phần · {nTopics} chủ đề</small></h4>
      {admin && <div className="tools">
        {edit && <button type="button" onClick={() => setExtra(extra + 1)}>+ Cột học phần</button>}
        <button type="button" className={edit ? 'primary' : ''} onClick={() => { setEdit(!edit); setExtra(0) }}>{edit ? 'Xong' : 'Sửa học phần'}</button></div>}</div>
    {!rows.length ? <small className="sub">Gói chưa có học phần của loại này.{admin ? ' Bấm "Sửa học phần".' : ''}</small>
      : <table className="table">
        <thead><tr><th>Khối</th>{cols.map(s => <th key={s}>Học phần {s} <small className="sub">(chủ đề)</small></th>)}<th>Tiết / năm</th></tr></thead>
        <tbody>{rows.flatMap(g => {
          const openSlot = open?.startsWith(g + '|') ? Number(open.split('|')[1]) : null
          const openMod = openSlot ? name(get(g, openSlot)?.module_id) : undefined
          const list = openSlot ? topicsIn(get(g, openSlot)?.module_id, g) : []
          return [<tr key={g}>
            <td>{gradeName(g)}</td>
            {cols.map(s => {
              const it = get(g, s), m = name(it?.module_id), n = topicsIn(it?.module_id, g).length, k = g + '|' + s
              return <td key={s} style={diffKeys.has(keyOf(track.code, g, s)) ? DIFF : undefined}>
                {edit ? <select value={it?.module_id ?? ''} onChange={e => set(g, s, e.target.value)} aria-label={`${gradeName(g)} – Học phần ${s}`}>
                  <option value="">—</option>{modules.filter(x => x.active || x.id === it?.module_id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                  : m ? <>{m.name}{' '}
                    <button type="button" className="ghostbtn" aria-expanded={open === k} title="Xem các chủ đề trong học phần"
                      onClick={() => setOpen(open === k ? null : k)}>{open === k ? '▾' : '▸'} {n ? `${n} chủ đề` : 'chưa có chủ đề'}</button></>
                  : <small className="sub">—</small>}
              </td>
            })}
            <td>{total(g) || <small className="sub">—</small>}</td>
          </tr>,
          openSlot && openMod ? <tr key={g + '-topics'}><td />
            <td colSpan={cols.length + 1}>
              <div className="sub" style={{ marginBottom: 4 }}><b>{openMod.name}</b> · {gradeName(g)} · {list.length} chủ đề</div>
              {list.length ? <ol style={{ margin: 0, paddingLeft: 20 }}>{list.map(t => <li key={t.id}>{t.title} <small className="sub">· {t.periods} tiết{t.main_subject ? ' · ' + t.main_subject : ''}</small></li>)}</ol>
                : <small className="sub">Học phần chưa có chủ đề ở khối này. Thêm chủ đề ở tab "Khung chương trình".</small>}
            </td></tr> : null]
        })}</tbody>
      </table>}
  </div>
}

function CompareView({ tracks, packages, cell, slotsOf, modName, diffKeys }: {
  tracks: StemTrack[]; packages: ProgramPackage[]; cell: (p: string, t: string, g: number, s: number) => PackageItem | undefined
  slotsOf: (t: string, pkgs: string[]) => number[]; modName: (id: string) => string; diffKeys: Set<string>
}) {
  const [only, setOnly] = useState(true)
  const ids = packages.map(p => p.id)
  const shown = tracks.filter(t => !only || [...diffKeys].some(k => k.startsWith(t.code + '|')))
  return <>
    <div className="bar"><label className="field inline"><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} /> Chỉ hiện chỗ các gói khác nhau</label>
      <small className="sub">{tracks.filter(t => !shown.includes(t)).map(t => t.code).join(', ')}{only && shown.length < tracks.length ? ' giống nhau ở mọi gói.' : ''}</small></div>
    {shown.map(t => {
      const slots = slotsOf(t.code, ids)
      const rows = GRADES.flatMap(g => slots.map(s => [g, s] as const)).filter(([g, s]) => only ? diffKeys.has(keyOf(t.code, g, s)) : packages.some(p => cell(p.id, t.code, g, s)))
      return <div key={t.code} className="panel pdcard" style={{ marginBottom: 12 }}>
        <h4 style={{ marginTop: 0 }}>{chip(t.code)} {t.name}</h4>
        <table className="table">
          <thead><tr><th>Khối</th><th>Vị trí</th>{packages.map(p => <th key={p.id}>{p.name}</th>)}</tr></thead>
          <tbody>{rows.map(([g, s]) => {
            const d = diffKeys.has(keyOf(t.code, g, s))
            return <tr key={g + '-' + s}><td>{gradeName(g)}</td><td>Học phần {s}</td>
              {packages.map(p => { const it = cell(p.id, t.code, g, s); return <td key={p.id} style={d ? DIFF : undefined}>{it ? modName(it.module_id) : <small className="sub">—</small>}</td> })}</tr>
          })}</tbody>
        </table>
      </div>
    })}
    {!shown.length && <p className="sub">Các gói giống nhau hoàn toàn.</p>}
  </>
}

function PackageForm({ p, onCancel, onSaved }: { p: ProgramPackage & { copyFrom?: string }; onCancel: () => void; onSaved: (id?: string) => void }) {
  const [f, setF] = useState(p)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    if (!f.name.trim()) return setErr('Nhập tên gói.')
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(f.code.trim())) return setErr('Mã gói gồm chữ, số, "-" hoặc "_" (tối đa 20 ký tự), VD: 5T.')
    setBusy(true); setErr('')
    const row = { code: f.code.trim(), name: f.name, description: f.description, sort: Number(f.sort) || 0, active: f.active }
    const { data, error } = f.id ? await supabase.from('program_packages').update(row).eq('id', f.id).select('id')
      : await supabase.from('program_packages').insert(row).select('id')
    if (error || !data?.length) { setBusy(false); return setErr(frameErr(error ? error.message + ' ' + (error.code ?? '') : 'row-level')) }
    if (f.copyFrom) {
      const { data: src } = await supabase.from('program_package_items').select('track_code, grade, slot, module_id, note').eq('package_id', f.copyFrom)
      if (src?.length) {
        const { error: e2 } = await supabase.from('program_package_items').insert(src.map(x => ({ ...x, package_id: data[0].id })))
        if (e2) { setBusy(false); return setErr(frameErr(e2.message + ' ' + (e2.code ?? ''))) }
      }
    }
    setBusy(false)
    onSaved(data[0].id)
  }
  return <section className="panel">
    <div className="formgrid">
      <label className="field"><span>Mã gói *</span><input value={f.code} maxLength={20} placeholder="VD: 5T" onChange={e => setF({ ...f, code: e.target.value })} /></label>
      <label className="field"><span>Tên gói *</span><input value={f.name} maxLength={120} onChange={e => setF({ ...f, name: e.target.value })} /></label>
      <label className="field"><span>Thứ tự</span><input type="number" min={0} value={f.sort} onChange={e => setF({ ...f, sort: Number(e.target.value) })} /></label>
      <label className="field"><span>Trạng thái</span><select value={f.active ? 'on' : 'off'} onChange={e => setF({ ...f, active: e.target.value === 'on' })}>
        <option value="on">Đang bán</option><option value="off">Ngừng bán</option></select></label>
      <label className="field wide"><span>Mô tả (gói khác các gói khác ở đâu)</span><textarea rows={3} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
    </div>
    {f.copyFrom && <p className="sub">Gói mới sẽ có sẵn toàn bộ học phần của gói gốc; sửa lại chỗ khác nhau sau khi lưu.</p>}
    {err && <p className="warnline">{err}</p>}
    <div className="actions" style={{ marginTop: 12 }}>
      <button className="primary" onClick={save} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      <button onClick={onCancel} disabled={busy}>Huỷ</button>
    </div>
  </section>
}
