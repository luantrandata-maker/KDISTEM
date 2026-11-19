import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStemTracks, type StemTrack, trackLabel } from '../lib/stemTracks'
import { gradeName } from '../lib/eduLevels'
import { loadFrame, loadPackages, type PackageItem, type ProgramModule, type ProgramPackage, type ProgramTopic } from '../lib/programFrame'
import { ALL_GRADES, currentYear, gradesOfLevel, kRange, loadSchoolPkgs, shiftYear, spErr, yearLabel, type PkgSkip, type SchoolPkgRow } from '../lib/schoolPackages'
import { DataTable } from '../components/DataTable'
import { ElView } from '../components/ElView'
import { Drawer } from '../components/Drawer'

// Trường dùng gói (156): danh sách trường (lọc tỉnh, gói) → chi tiết trường theo khối × loại chương trình → sửa phạm vi áp dụng
// (đủ gói hoặc bỏ tick phần trường không áp dụng). Chỉ KDI gán / sửa; Sở, Phòng, trường xem được trường thuộc mình.

const OFF = { textDecoration: 'line-through', color: 'var(--muted)' }
const trackHead = (t: StemTrack) => `${trackLabel(t.code)} · ${t.name}`
const keyM = (t: string, g: number, s: number) => `m|${t}|${g}|${s}`
const keyT = (topic: string) => `t|${topic}`

type Ctx = { tracks: StemTrack[]; items: PackageItem[]; modules: ProgramModule[]; topics: ProgramTopic[] }
type SlotState = { slot: number; module_id: string; on: boolean }
type TopicState = { topic: ProgramTopic; on: boolean }

/** Phần trường áp dụng ở loại t, khối g, theo gói và danh sách phần không áp dụng (skip: tập khoá keyM / keyT) */
function scopeAt(c: Ctx, pkg: string, t: StemTrack, g: number, skip: Set<string>) {
  const slots = c.items.filter(i => i.package_id === pkg && i.track_code === t.code && i.grade === g).sort((a, b) => a.slot - b.slot)
  const ss: SlotState[] = slots.map(i => ({ slot: i.slot, module_id: i.module_id, on: !skip.has(keyM(t.code, g, i.slot)) }))
  const ts: TopicState[] = slots.flatMap(i => c.topics.filter(x => x.module_id === i.module_id && x.grade === g && x.active).sort((a, b) => a.seq - b.seq)
    .map(x => ({ topic: x, on: !skip.has(keyM(t.code, g, i.slot)) && !skip.has(keyT(x.id)) })))
  return { slots: ss, topics: ts, mods: t.use_modules !== false }
}
const skipSetOf = (row: SchoolPkgRow, skips: PkgSkip[]) => new Set(row.full_package ? [] : skips.filter(s => s.school_package_id === row.sp_id)
  .map(s => s.topic_id ? keyT(s.topic_id) : keyM(s.track_code, s.grade, s.slot ?? 0)))

function Count({ on, all, unit }: { on: number; all: number; unit: string }) {
  if (!all) return <span className="sub">—</span>
  return on === all ? <span>{all} {unit}</span> : <span><b>{on}</b>/{all} {unit}</span>
}

export function SchoolPackages() {
  const { tracks: allTracks } = useStemTracks()
  const tracks = allTracks.filter(t => t.active !== false && t.code !== 'DX' && t.code !== 'KDI-SC')
  const [year, setYear] = useState(currentYear)
  const [rows, setRows] = useState<SchoolPkgRow[]>([])
  const [skips, setSkips] = useState<PkgSkip[]>([])
  const [packages, setPackages] = useState<ProgramPackage[]>([])
  const [items, setItems] = useState<PackageItem[]>([])
  const [modules, setModules] = useState<ProgramModule[]>([])
  const [topics, setTopics] = useState<ProgramTopic[]>([])
  const [admin, setAdmin] = useState(false)
  const [msg, setMsg] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [prov, setProv] = useState('')
  const [fPkg, setFPkg] = useState('')
  const [openOrg, setOpenOrg] = useState<string | null>(null)
  const [edit, setEdit] = useState(false)
  const [assign, setAssign] = useState(false)
  const [view, setView] = useState<{ t: string; g: number } | null>(null)

  const reloadSchools = (y = year) => loadSchoolPkgs(y).then(r => { setRows(r.rows); setSkips(r.skips); setMsg(r.error); setLoaded(true) })
  useEffect(() => {
    supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data))
    Promise.all([loadPackages(), loadFrame()]).then(([p, f]) => { setPackages(p.packages); setItems(p.items); setModules(f.modules); setTopics(f.topics); if (p.error || f.error) setMsg(p.error || f.error) })
  }, [])
  useEffect(() => { setLoaded(false); reloadSchools(year) }, [year])

  const ctx: Ctx = { tracks, items, modules, topics }
  const modName = (id: string) => modules.find(m => m.id === id)?.name ?? '?'
  const pkgName = (id: string | null) => packages.find(p => p.id === id)?.name ?? '—'
  const used = rows.filter(r => r.sp_id)
  const provs = useMemo(() => [...new Set(used.map(r => r.province_name ?? 'Chưa rõ tỉnh'))].sort(), [rows])
  const shown = used.filter(r => (!prov || (r.province_name ?? 'Chưa rõ tỉnh') === prov) && (!fPkg || r.package_id === fPkg))

  const summary = (r: SchoolPkgRow, t: StemTrack) => {
    const skip = skipSetOf(r, skips); let on = 0, all = 0, gOn = 0, gAll = 0
    for (const g of r.grades ?? []) {
      const s = scopeAt(ctx, r.package_id!, t, g, skip)
      if (s.slots.length) { gAll++; if (s.slots.some(x => x.on)) gOn++ }
      if (s.mods) { all += s.slots.length; on += s.slots.filter(x => x.on).length } else { all += s.topics.length; on += s.topics.filter(x => x.on).length }
    }
    // Loại chỉ có chủ đề mà khung chưa nhập chủ đề (VD CT4): đếm theo khối
    if (t.use_modules === false && !all) return { on: gOn, all: gAll, unit: 'khối' }
    return { on, all, unit: t.use_modules !== false ? 'HP' : 'chủ đề' }
  }

  const cur = openOrg ? rows.find(r => r.org_id === openOrg && r.sp_id) : undefined
  const yearSel = <select aria-label="Năm học" value={year} onChange={e => { setYear(e.target.value); setOpenOrg(null); setEdit(false) }}>
    {[-1, 0, 1].map(n => shiftYear(currentYear(), n)).map(y => <option key={y} value={y}>Năm học {yearLabel(y)}</option>)}</select>

  const assignDrawer = assign && <Drawer title="Gán gói cho trường" closeOnOutside={false} onClose={() => setAssign(false)}>
    <AssignForm year={year} rows={rows} packages={packages.filter(p => p.active)} onCancel={() => setAssign(false)}
      onSaved={org => { setAssign(false); reloadSchools().then(() => { setOpenOrg(org); setEdit(false) }) }} />
  </Drawer>

  if (cur) {
    const skip = skipSetOf(cur, skips)
    const grades = cur.grades ?? []
    const sub = <>{cur.province_name ?? 'Chưa rõ tỉnh'} · Năm học {yearLabel(year)} · {kRange(grades)} · {cur.full_package ? 'Áp dụng đủ gói' : 'Áp dụng một phần'}</>
    if (edit) return <ElView back={cur.name} onBack={() => setEdit(false)} title={<>Phạm vi áp dụng · {cur.name}</>} sub={sub}>
      <ScopeEdit ctx={ctx} row={cur} skips={skips} packages={packages} modName={modName} onCancel={() => setEdit(false)}
        onSaved={() => { setEdit(false); reloadSchools() }} />
    </ElView>
    const vt = view && tracks.find(t => t.code === view.t)
    const vs = vt && view && scopeAt(ctx, cur.package_id!, vt, view.g, skip)
    async function unassign() {
      if (!cur || !confirm(`Bỏ gán ${pkgName(cur.package_id)} của ${cur.name} trong năm học ${yearLabel(year)}?`)) return
      const { data, error } = await supabase.from('school_packages').delete().eq('id', cur.sp_id!).select('id')
      if (error || !data?.length) return setMsg(spErr(error ? error.message + ' ' + (error.code ?? '') : 'row-level'))
      setOpenOrg(null); reloadSchools()
    }
    return <ElView back="Danh sách trường" onBack={() => { setOpenOrg(null); setView(null) }}
      title={<>{cur.name} · {pkgName(cur.package_id)}</>} sub={sub}
      actions={admin && <><button type="button" onClick={() => setEdit(true)}>Sửa phạm vi</button><button type="button" className="danger" onClick={unassign}>Bỏ gán gói</button></>}>
      {msg && <p className="msg" role="status">{msg}</p>}
      <div className="tablewrap">
        <table className="table cmplined">
          <thead><tr><th style={{ width: 70 }}>Khối</th>{tracks.map(t => <th key={t.code}>{trackHead(t)}</th>)}</tr></thead>
          <tbody>{grades.map(g => <tr key={g}><td><b>K{g}</b></td>{tracks.map(t => {
            const s = scopeAt(ctx, cur.package_id!, t, g, skip)
            const open = () => setView({ t: t.code, g })
            if (!s.slots.length) return <td key={t.code}><span className="sub">—</span></td>
            if (!s.mods) {
              const on = s.topics.filter(x => x.on).length
              const allOff = s.slots.every(x => !x.on)
              return <td key={t.code}><button type="button" className="cellbtn" onClick={open} title="Xem chủ đề">
                {allOff ? <span style={OFF}>Không áp dụng</span> : !s.topics.length ? <span className="sub">Có trong gói, chưa nhập chủ đề</span>
                  : on === s.topics.length ? <>Đủ {on} chủ đề</> : <><b>{on}</b>/{s.topics.length} chủ đề</>}</button></td>
            }
            return <td key={t.code}><div style={{ display: 'grid', gap: 2 }}>{s.slots.map(x => <button key={x.slot} type="button" className="cellbtn" style={x.on ? undefined : OFF}
              onClick={open} title="Xem học phần và chủ đề">HP{x.slot} {modName(x.module_id)}</button>)}</div></td>
          })}</tr>)}</tbody>
        </table>
      </div>
      <p className="sub framefoot">Phần gạch ngang có trong gói nhưng trường không áp dụng. Bấm vào ô để xem chủ đề.</p>
      {vt && vs && view && <Drawer title={<>{trackHead(vt)} · {gradeName(view.g)}</>} onClose={() => setView(null)}>
        <ScopeView s={vs} modName={modName} />
      </Drawer>}
      {assignDrawer}
    </ElView>
  }

  return <>
    {msg && <p className="msg" role="status">{msg}</p>}
    <DataTable id="school-packages" rows={shown} rowKey={r => r.org_id} noun="trường" onRow={r => { setOpenOrg(r.org_id); setEdit(false) }}
      empty={loaded ? (used.length ? 'Không có trường nào khớp bộ lọc.' : `Chưa có trường nào được gán gói trong năm học ${yearLabel(year)}.`) : 'Đang tải…'}
      left={<>{yearSel}
        <select aria-label="Tỉnh" value={prov} onChange={e => setProv(e.target.value)}><option value="">Tất cả tỉnh ({used.length})</option>
          {provs.map(p => <option key={p} value={p}>{p} ({used.filter(r => (r.province_name ?? 'Chưa rõ tỉnh') === p).length})</option>)}</select>
        <select aria-label="Gói" value={fPkg} onChange={e => setFPkg(e.target.value)}><option value="">Tất cả gói</option>
          {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></>}
      right={admin && <button type="button" className="primary" onClick={() => setAssign(true)}>+ Gán gói cho trường</button>}
      cols={[
        { key: 'name', label: 'Trường', fixed: true, text: r => r.name, cell: r => <button type="button" className="namelink" style={{ fontWeight: 600 }}>{r.name}</button> },
        { key: 'prov', label: 'Tỉnh', text: r => r.province_name ?? '', cell: r => r.province_name ?? <span className="sub">—</span> },
        { key: 'grades', label: 'Khối', text: r => kRange(r.grades ?? []), cell: r => kRange(r.grades ?? []) },
        { key: 'pkg', label: 'Gói', text: r => pkgName(r.package_id), cell: r => pkgName(r.package_id) },
        { key: 'scope', label: 'Phạm vi', text: r => r.full_package ? 'Đủ gói' : 'Một phần', cell: r => r.full_package ? 'Đủ gói' : 'Một phần' },
        ...tracks.map(t => ({ key: 't' + t.code, label: trackLabel(t.code), cell: (r: SchoolPkgRow) => <Count {...summary(r, t)} /> })),
      ]} />
    <p className="sub framefoot">Bấm vào trường để xem chi tiết từng khối. Số in đậm là trường áp dụng một phần, ví dụ 49/56 chủ đề.</p>
    {assignDrawer}
  </>
}

function ScopeView({ s, modName }: { s: ReturnType<typeof scopeAt>; modName: (id: string) => string }) {
  const tag = (on: boolean) => on ? <small className="sub">Áp dụng</small> : <small style={{ color: 'var(--danger, #b42318)' }}>Không áp dụng</small>
  if (!s.mods) return s.topics.length
    ? <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>{s.topics.map(({ topic, on }) => <li key={topic.id}>
      <span style={on ? undefined : OFF}>{topic.title}</span> <small className="sub">· {topic.periods} tiết</small> · {tag(on)}</li>)}</ol>
    : <p className="sub">Có trong gói, khung chương trình chưa có chủ đề ở khối này.</p>
  return <div style={{ display: 'grid', gap: 14 }}>{s.slots.map(x => {
    const ts = s.topics.filter(y => y.topic.module_id === x.module_id)
    return <section key={x.slot}>
      <h4 style={{ margin: '0 0 6px' }}><span style={x.on ? undefined : OFF}>HP{x.slot} · {modName(x.module_id)}</span> · {tag(x.on)}</h4>
      {ts.length ? <ol style={{ margin: 0, paddingLeft: 20 }}>{ts.map(({ topic }) => <li key={topic.id}>{topic.title} <small className="sub">· {topic.periods} tiết</small></li>)}</ol>
        : <p className="sub" style={{ margin: 0 }}>Học phần chưa có chủ đề ở khối này.</p>}
    </section>
  })}</div>
}

function GradePick({ value, onChange, allowed = ALL_GRADES }: { value: number[]; onChange: (v: number[]) => void; allowed?: number[] }) {
  return <div className="distfilter" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
    {allowed.length > 1 && <button type="button" className={'distfchip' + (allowed.every(g => value.includes(g)) ? ' on' : '')}
      onClick={() => onChange(allowed.every(g => value.includes(g)) ? [] : [...allowed])}>Tất cả</button>}
    {allowed.map(g => <button key={g} type="button" className={'distfchip' + (value.includes(g) ? ' on' : '')} aria-pressed={value.includes(g)}
      onClick={() => onChange(value.includes(g) ? value.filter(x => x !== g) : [...value, g].sort((a, b) => a - b))}>K{g}</button>)}
  </div>
}

function AssignForm({ year, rows, packages, onCancel, onSaved }: { year: string; rows: SchoolPkgRow[]; packages: ProgramPackage[]; onCancel: () => void; onSaved: (org: string) => void }) {
  const free = rows.filter(r => !r.sp_id)
  const [q, setQ] = useState('')
  const [prov, setProv] = useState('')   // chọn tỉnh / thành (theo cây tổ chức) trước, rồi chọn trường
  const [org, setOrg] = useState('')
  const [pkg, setPkg] = useState(packages[0]?.id ?? '')
  const [grades, setGrades] = useState<number[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nq = q.trim().toLowerCase()
  const NOPROV = '__none'
  const provKey = (r: SchoolPkgRow) => r.province_id ?? NOPROV
  const provs = [...new Map(free.map(r => [provKey(r), r.province_name ?? 'Chưa thuộc tỉnh nào'])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'))
  const all = free.filter(r => prov && provKey(r) === prov).filter(r => !nq || (r.name + ' ' + (r.province_name ?? '') + ' ' + (r.code ?? '')).toLowerCase().includes(nq))
  const matched = all.length
  const list = all.slice(0, 300)
  const picked = free.find(x => x.org_id === org)
  // Gợi ý khối theo cấp học của trường (vẫn chọn thêm / bỏ bớt được)
  const pickOrg = (id: string) => { setOrg(id); const r = free.find(x => x.org_id === id); setGrades(r?.level ? gradesOfLevel(r.level) : []) }
  const hint = !picked ? '' : picked.level === 'mamnon' ? ' · trường mầm non, gói chưa có khối mầm non' : picked.level ? ' · đã chọn sẵn theo cấp học của trường' : ' · trường chưa ghi cấp học, hãy chọn khối'
  async function save() {
    if (!org) return setErr('Chọn trường.')
    if (!pkg) return setErr('Chọn gói.')
    if (!grades.length) return setErr('Chọn ít nhất một khối.')
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('school_packages').insert({ org_id: org, package_id: pkg, school_year: year, grades, full_package: true }).select('id')
    setBusy(false)
    if (error || !data?.length) return setErr(spErr(error ? error.message + ' ' + (error.code ?? '') : 'row-level'))
    onSaved(org)
  }
  return <div style={{ display: 'grid', gap: 12 }}>
    <label className="field"><span>Tỉnh / thành ({free.length.toLocaleString('vi-VN')} trường chưa có gói năm học {yearLabel(year)})</span>
      <select value={prov} onChange={e => { setProv(e.target.value); setOrg(''); setGrades([]) }} aria-label="Chọn tỉnh / thành">
        <option value="">— Chọn tỉnh / thành —</option>
        {provs.map(([k, n]) => <option key={k} value={k}>{n} ({free.filter(r => provKey(r) === k).length.toLocaleString('vi-VN')} trường)</option>)}</select></label>
    {prov && <label className="field"><span>Trường</span>
      <input placeholder="Tìm theo tên trường…" value={q} onChange={e => setQ(e.target.value)} />
      <select size={8} value={org} onChange={e => pickOrg(e.target.value)} aria-label="Chọn trường">
        {list.map(r => <option key={r.org_id} value={r.org_id}>{r.name}</option>)}</select>
      {matched > list.length && <small className="sub">Đang hiện {list.length} / {matched.toLocaleString('vi-VN')} trường, gõ tên để tìm.</small>}</label>}
    <label className="field"><span>Gói</span><select value={pkg} onChange={e => setPkg(e.target.value)}>
      {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <div className="field"><span>Khối áp dụng<small className="sub">{hint}</small></span><GradePick value={grades} onChange={setGrades} /></div>
    <small className="sub">Gán xong là áp dụng đủ gói. Trường áp dụng một phần thì mở trường, bấm "Sửa phạm vi" để bỏ tick phần không áp dụng.</small>
    {err && <p className="warnline">{err}</p>}
    <div className="actions"><button className="primary" onClick={save} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button><button onClick={onCancel} disabled={busy}>Huỷ</button></div>
  </div>
}

function ScopeEdit({ ctx, row, skips, packages, modName, onCancel, onSaved }: {
  ctx: Ctx; row: SchoolPkgRow; skips: PkgSkip[]; packages: ProgramPackage[]; modName: (id: string) => string; onCancel: () => void; onSaved: () => void
}) {
  const [pkg, setPkg] = useState(row.package_id!)
  const [grades, setGrades] = useState<number[]>(row.grades ?? [])
  const [full, setFull] = useState(!!row.full_package)
  const [skip, setSkip] = useState<Set<string>>(() => skipSetOf({ ...row, full_package: false }, skips))
  const [g, setG] = useState(0)   // 0 = tất cả khối
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const flip = (keys: string[], on: boolean) => setSkip(s => { const n = new Set(s); for (const k of keys) { if (on) n.delete(k); else n.add(k) } return n })
  // Khoá của mọi mục (học phần / chủ đề) ở loại t, khối gg — dùng cho ô "chọn cả khối"
  const keysAt = (t: StemTrack, gg: number) => { const s = scopeAt(ctx, pkg, t, gg, skip); return s.mods ? s.slots.map(x => keyM(t.code, gg, x.slot)) : [...s.slots.map(x => keyM(t.code, gg, x.slot)), ...s.topics.map(x => keyT(x.topic.id))] }
  // Chưa có chủ đề (VD CT4): tick theo cả khối (vị trí học phần)
  const onAt = (t: StemTrack, gg: number) => { const s = scopeAt(ctx, pkg, t, gg, skip); return s.mods || !s.topics.length ? [s.slots.filter(x => x.on).length, s.slots.length] : [s.topics.filter(x => x.on).length, s.topics.length] }
  const gs = g ? [g] : grades
  // Bật một chủ đề khi cả khối đang bị bỏ (bỏ theo vị trí): chuyển sang bỏ từng chủ đề, chỉ bật chủ đề này
  const topicOn = (t: StemTrack, gg: number, id: string, v: boolean) => setSkip(cur => {
    const n = new Set(cur)
    if (!v) { n.add(keyT(id)); return n }
    const s = scopeAt(ctx, pkg, t, gg, cur)
    for (const y of s.slots) if (n.has(keyM(t.code, gg, y.slot))) {
      n.delete(keyM(t.code, gg, y.slot))
      for (const x of s.topics) if (x.topic.module_id === y.module_id) n.add(keyT(x.topic.id))
    }
    n.delete(keyT(id)); return n
  })

  async function save() {
    if (!grades.length) return setErr('Chọn ít nhất một khối.')
    setBusy(true); setErr('')
    const { error } = await supabase.from('school_packages').update({ package_id: pkg, grades, full_package: full }).eq('id', row.sp_id!)
    if (error) { setBusy(false); return setErr(spErr(error.message + ' ' + (error.code ?? ''))) }
    // Lưu lại danh sách phần không áp dụng: chỉ giữ khoá còn đúng với gói, khối đang chọn
    const rowsOut: PkgSkip[] = []
    if (!full) for (const t of ctx.tracks) for (const gg of grades) {
      const s = scopeAt(ctx, pkg, t, gg, skip)
      for (const x of s.slots) if (!x.on) rowsOut.push({ school_package_id: row.sp_id!, track_code: t.code, grade: gg, slot: x.slot, topic_id: null })
      if (!s.mods) for (const x of s.topics) if (skip.has(keyT(x.topic.id)) && s.slots.find(y => y.module_id === x.topic.module_id)?.on)
        rowsOut.push({ school_package_id: row.sp_id!, track_code: t.code, grade: gg, slot: null, topic_id: x.topic.id })
    }
    const d = await supabase.from('school_package_skips').delete().eq('school_package_id', row.sp_id!)
    if (d.error) { setBusy(false); return setErr(spErr(d.error.message + ' ' + (d.error.code ?? ''))) }
    if (rowsOut.length) {
      const i = await supabase.from('school_package_skips').insert(rowsOut)
      if (i.error) { setBusy(false); return setErr(spErr(i.error.message + ' ' + (i.error.code ?? ''))) }
    }
    setBusy(false); onSaved()
  }

  const box = (checked: boolean, onChange: (v: boolean) => void, label: React.ReactNode, bold = false, indent = 0, disabled = false) =>
    <label className="field inline" style={{ marginLeft: indent, fontWeight: bold ? 600 : undefined, alignItems: 'flex-start' }}>
      <input type="checkbox" style={{ flexShrink: 0 }} checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /> <span>{label}</span></label>

  return <section className="panel" style={{ padding: 14 }}>
    <div className="formgrid" style={{ gridTemplateColumns: 'minmax(0,220px) minmax(0,1fr)' }}>
      <label className="field"><span>Gói</span><select value={pkg} onChange={e => setPkg(e.target.value)}>
        {packages.filter(p => p.active || p.id === row.package_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <div className="field"><span>Khối áp dụng</span><GradePick value={grades}
        onChange={v => { setGrades(v); if (g && !v.includes(g)) setG(0) }} /></div>
    </div>
    <div style={{ display: 'flex', gap: 18, margin: '12px 0' }}>
      <label className="field inline"><input type="radio" checked={full} onChange={() => setFull(true)} /> Áp dụng đủ gói</label>
      <label className="field inline"><input type="radio" checked={!full} onChange={() => setFull(false)} /> Chọn một phần (bỏ tick phần trường không áp dụng)</label>
    </div>
    {!full && <>
      <div className="distfilter scopegrades" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <span className="lvlab">Xem khối</span>
        <button type="button" className={'distfchip' + (g === 0 ? ' on' : '')} aria-pressed={g === 0} onClick={() => setG(0)}>Tất cả khối</button>
        {grades.map(x => <button key={x} type="button" className={'distfchip' + (x === g ? ' on' : '')} aria-pressed={x === g} onClick={() => setG(x)}>K{x}</button>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, ctx.tracks.length)}, minmax(0,1fr))`, gap: 12 }}>
        {ctx.tracks.map(t => {
          const tot = gs.reduce((a, gg) => { const [o, n] = onAt(t, gg); return [a[0] + o, a[1] + n] }, [0, 0])
          const allKeys = gs.flatMap(gg => keysAt(t, gg))
          const unit = t.use_modules !== false ? 'Học phần' : gs.some(gg => scopeAt(ctx, pkg, t, gg, skip).topics.length) ? 'Chủ đề' : 'Khối'
          return <fieldset key={t.code} className="panel" style={{ margin: 0, padding: 10, minWidth: 0 }}>
            <legend>{trackHead(t)}</legend>
            {box(!!tot[1] && tot[0] === tot[1], v => flip(allKeys, v), <>{g ? unit : 'Chọn tất cả khối'} ({tot[0]}/{tot[1]})</>, true, 0, !tot[1])}
            {gs.map(gg => {
              const s = scopeAt(ctx, pkg, t, gg, skip)
              const [o, n] = onAt(t, gg)
              const head = !g && box(!!n && o === n, v => flip(keysAt(t, gg), v), <><b>K{gg}</b> <small className="sub">
                {!s.slots.length ? 'không có trong gói' : s.mods ? '' : !s.topics.length ? 'chưa có chủ đề, tick theo cả khối' : `${o}/${n} chủ đề`}</small></>, false, 18, !n)
              const ind = g ? 18 : 40
              const list = s.mods
                ? s.slots.map(x => <div key={x.slot}>{box(x.on, v => flip([keyM(t.code, gg, x.slot)], v), <>HP{x.slot} {modName(x.module_id)}</>, false, ind)}</div>)
                : g ? s.topics.map(x => <div key={x.topic.id}>{box(x.on, v => topicOn(t, gg, x.topic.id, v),
                  <>{x.topic.seq}. {x.topic.title}</>, false, ind)}</div>) : null
              return <div key={gg}>{head}{list}
                {g > 0 && !s.mods && !s.topics.length && (s.slots.length
                  ? box(o === n, v => flip(keysAt(t, gg), v), <>Cả khối <small className="sub">chưa có chủ đề trong khung</small></>, false, 18)
                  : <p className="sub" style={{ margin: '4px 0 0 18px' }}>Gói không có ở khối này</p>)}</div>
            })}
          </fieldset>
        })}
      </div>
      <small className="sub" style={{ display: 'block', marginTop: 8 }}>Bấm K1, K2… để bỏ tick từng chủ đề của Bài học STEM.</small>
    </>}
    {err && <p className="warnline">{err}</p>}
    <div className="actions" style={{ marginTop: 12 }}>
      <button className="primary" onClick={save} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      <button onClick={onCancel} disabled={busy}>Huỷ</button>
    </div>
  </section>
}
