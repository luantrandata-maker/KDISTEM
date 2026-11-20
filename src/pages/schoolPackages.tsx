import { useEffect, useMemo, useState } from 'react'
import { fetchAll, supabase } from '../lib/supabase'
import { useStemTracks, type StemTrack, trackLabel } from '../lib/stemTracks'
import { gradeName } from '../lib/eduLevels'
import { loadFrame, loadPackages, slotTopics, type PackageItem, type ProgramModule, type ProgramPackage, type ProgramTopic } from '../lib/programFrame'
import { ALL_GRADES, currentYear, fmtDay, gradesOfLevel, kRange, loadSchoolPkgs, shiftYear, spErr, spState, todayIso, yearLabel, type PkgSkip, type SchoolPkgRow } from '../lib/schoolPackages'
import { DataTable } from '../components/DataTable'
import { ElView } from '../components/ElView'
import { Drawer } from '../components/Drawer'

// Trường dùng gói (156, 158): danh sách trường (lọc tỉnh, gói) → chi tiết trường theo khối × loại chương trình → sửa phạm vi áp dụng
// (đủ gói hoặc bỏ tick phần trường không áp dụng). Trường dùng được nhiều gói, mỗi khối một gói; nâng cấp gói từ một ngày, lưu lịch sử. Chỉ KDI gán / sửa; Sở, Phòng, trường xem được trường thuộc mình.

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
  const ts: TopicState[] = slots.flatMap(i => slotTopics(c.topics, c.items, i)
    .map(x => ({ topic: x, on: !skip.has(keyM(t.code, g, i.slot)) && !skip.has(keyT(x.id)) })))
  return { slots: ss, topics: ts, mods: t.use_modules !== false }
}
const skipSetOf = (row: SchoolPkgRow, skips: PkgSkip[]) => new Set(row.full_package ? [] : skips.filter(s => s.school_package_id === row.sp_id)
  .map(s => s.topic_id ? keyT(s.topic_id) : keyM(s.track_code, s.grade, s.slot ?? 0)))

function Count({ on, all, unit }: { on: number; all: number; unit: string }) {
  if (!all) return <span className="sub">—</span>
  return on === all ? <span>{all} {unit}</span> : <span><b>{on}</b>/{all} {unit}</span>
}

// Màu từng gói theo thứ tự gói, giống thẻ gói ở trang Gói STEM (xanh dương, tím, cam, đỏ)
const PKG_C = ['#2563eb', '#9333ea', '#ea580c', '#e11d48']
type School = { org_id: string; name: string; code: string | null; level: string | null; province_id: string | null; province_name: string | null; sps: SchoolPkgRow[] }

/** Gom các dòng (mỗi bản gán một dòng) thành danh sách trường */
function groupSchools(rows: SchoolPkgRow[]): School[] {
  const m = new Map<string, School>()
  for (const r of rows) {
    let s = m.get(r.org_id)
    if (!s) { s = { org_id: r.org_id, name: r.name, code: r.code, level: r.level, province_id: r.province_id, province_name: r.province_name, sps: [] }; m.set(r.org_id, s) }
    if (r.sp_id) s.sps.push(r)
  }
  return [...m.values()]
}
const byGrade = (a: SchoolPkgRow, b: SchoolPkgRow) => (a.grades?.[0] ?? 0) - (b.grades?.[0] ?? 0)
/** Khối đã có gói (bản gán chưa kết thúc) của trường */
const takenGrades = (s: School | undefined, except?: string) => (s?.sps ?? []).filter(x => x.sp_id !== except && spState(x) !== 'ended').flatMap(x => x.grades ?? [])

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
  const [edit, setEdit] = useState<string | null>(null)        // bản gán đang sửa phạm vi
  const [assign, setAssign] = useState<string | boolean>(false) // true = gán mới; org_id = thêm gói cho khối khác của trường đó
  const [upgrade, setUpgrade] = useState<string | null>(null)  // bản gán đang nâng cấp
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
  const pkgColor = (id: string | null) => PKG_C[Math.max(0, packages.findIndex(p => p.id === id)) % PKG_C.length]
  const Pk = ({ id, k }: { id: string | null; k?: string }) => <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
    <span style={{ width: 10, height: 10, borderRadius: 3, flex: 'none', background: pkgColor(id) }} /><b>{pkgName(id)}</b>{k && <span style={{ fontWeight: 400, color: 'var(--muted)' }}>{k}</span>}</span>
  const schools = useMemo(() => groupSchools(rows), [rows])
  const byId = useMemo(() => new Map(rows.filter(r => r.sp_id).map(r => [r.sp_id!, r])), [rows])
  // Bản gán có từ nâng cấp (gói khác gói trước đó): trả về bản trước
  const upgradedFrom = (r: SchoolPkgRow) => { const p = r.prev_id ? byId.get(r.prev_id) : undefined; return p && p.package_id !== r.package_id ? p : undefined }
  const liveOf = (s: School) => s.sps.filter(x => spState(x) === 'live').sort(byGrade)
  const nextOf = (s: School) => s.sps.filter(x => spState(x) === 'next').sort(byGrade)
  const used = schools.filter(s => s.sps.some(x => spState(x) !== 'ended'))
  const provs = useMemo(() => [...new Set(used.map(r => r.province_name ?? 'Chưa rõ tỉnh'))].sort(), [rows])
  const shown = used.filter(r => (!prov || (r.province_name ?? 'Chưa rõ tỉnh') === prov) && (!fPkg || r.sps.some(x => spState(x) !== 'ended' && x.package_id === fPkg)))

  const summary = (sps: SchoolPkgRow[], t: StemTrack) => {
    let on = 0, all = 0, gOn = 0, gAll = 0
    for (const r of sps) {
      const skip = skipSetOf(r, skips)
      for (const g of r.grades ?? []) {
        const s = scopeAt(ctx, r.package_id!, t, g, skip)
        if (s.slots.length) { gAll++; if (s.slots.some(x => x.on)) gOn++ }
        if (s.mods) { all += s.slots.length; on += s.slots.filter(x => x.on).length } else { all += s.topics.length; on += s.topics.filter(x => x.on).length }
      }
    }
    // Loại chỉ có chủ đề mà khung chưa nhập chủ đề (VD CT4): đếm theo khối
    if (t.use_modules === false && !all) return { on: gOn, all: gAll, unit: 'khối' }
    return { on, all, unit: t.use_modules !== false ? 'HP' : 'chủ đề' }
  }

  const cur = openOrg ? schools.find(s => s.org_id === openOrg && s.sps.length) : undefined
  const yearSel = <select aria-label="Năm học" value={year} onChange={e => { setYear(e.target.value); setOpenOrg(null); setEdit(null) }}>
    {[-1, 0, 1].map(n => shiftYear(currentYear(), n)).map(y => <option key={y} value={y}>Năm học {yearLabel(y)}</option>)}</select>

  const assignDrawer = assign !== false && <Drawer title={typeof assign === 'string' ? 'Thêm gói cho khối khác' : 'Gán gói cho trường'} closeOnOutside={false} onClose={() => setAssign(false)}>
    <AssignForm year={year} schools={schools} preset={typeof assign === 'string' ? assign : ''} packages={packages.filter(p => p.active)} pkgColor={pkgColor} pkgName={pkgName}
      onCancel={() => setAssign(false)} onSaved={org => { setAssign(false); reloadSchools().then(() => { setOpenOrg(org); setEdit(null) }) }} />
  </Drawer>

  if (cur) {
    const live = liveOf(cur), next = nextOf(cur)
    const active = [...live, ...next]
    const grades = [...new Set(live.flatMap(x => x.grades ?? []))].sort((a, b) => a - b)
    const spAt = (g: number) => live.find(x => (x.grades ?? []).includes(g))
    const sub = <>{cur.province_name ?? 'Chưa rõ tỉnh'} · Năm học {yearLabel(year)} · {kRange(grades)} · {live.length > 1 ? `${live.length} gói` : live.length ? (live[0].full_package ? 'Áp dụng đủ gói' : 'Áp dụng một phần') : 'Chưa có gói đang dùng'}</>
    const ed = edit ? byId.get(edit) : undefined
    if (ed) return <ElView back={cur.name} onBack={() => setEdit(null)} title={<>Phạm vi áp dụng · {cur.name} · {pkgName(ed.package_id)}</>} sub={sub}>
      <ScopeEdit ctx={ctx} row={ed} skips={skips} packages={packages} modName={modName} allowed={ALL_GRADES.filter(g => !takenGrades(cur, ed.sp_id!).includes(g))}
        onCancel={() => setEdit(null)} onSaved={() => { setEdit(null); reloadSchools() }} />
    </ElView>
    const vt = view && tracks.find(t => t.code === view.t)
    const vsp = view && spAt(view.g)
    const vs = vt && view && vsp && scopeAt(ctx, vsp.package_id!, vt, view.g, skipSetOf(vsp, skips))
    async function unassign(r: SchoolPkgRow) {
      if (!cur || !confirm(`Bỏ gán ${pkgName(r.package_id)} (${kRange(r.grades ?? [])}) của ${cur.name} trong năm học ${yearLabel(year)}?`)) return
      const { data, error } = await supabase.from('school_packages').delete().eq('id', r.sp_id!).select('id')
      if (error || !data?.length) return setMsg(spErr(error ? error.message + ' ' + (error.code ?? '') : 'row-level'))
      if (cur.sps.length <= 1) setOpenOrg(null)
      reloadSchools()
    }
    const upSp = upgrade ? byId.get(upgrade) : undefined
    const hist = cur.sps.length > live.length
    return <ElView back="Danh sách trường" onBack={() => { setOpenOrg(null); setView(null) }} title={cur.name} sub={sub}
      actions={admin && <button type="button" className="primary" onClick={() => setAssign(cur.org_id)}>+ Thêm gói cho khối khác</button>}>
      {msg && <p className="msg" role="status">{msg}</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12, marginBottom: 14 }}>
        {active.map(r => { const from = upgradedFrom(r); const st = spState(r)
          return <section key={r.sp_id} className="panel" style={{ margin: 0, padding: 12, borderTop: `4px solid ${pkgColor(r.package_id)}` }}>
            <div className="bar" style={{ margin: 0 }}><Pk id={r.package_id} k={kRange(r.grades ?? [])} />
              <span className={'pill ' + (st === 'next' ? 'maintenance' : 'active')} style={{ marginLeft: 'auto' }}>{st === 'next' ? 'Sắp áp dụng' : r.full_package ? 'Đủ gói' : 'Một phần'}</span></div>
            <small className="sub" style={{ display: 'block', margin: '6px 0 8px' }}>{r.starts_on ? `Từ ${fmtDay(r.starts_on)}` : 'Từ đầu năm học'}{from ? ` · nâng cấp từ ${pkgName(from.package_id)}` : ''}{r.note ? ` · ${r.note}` : ''}</small>
            {admin && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setEdit(r.sp_id)}>Sửa phạm vi</button>
              {st === 'live' && <button type="button" onClick={() => setUpgrade(r.sp_id)}>Nâng cấp</button>}
              <button type="button" onClick={() => unassign(r)}>Bỏ gán</button></div>}
          </section> })}
      </div>
      {grades.length > 0 && <div className="tablewrap">
        <table className="table cmplined">
          <thead><tr><th style={{ width: 70 }}>Khối</th>{live.length > 1 && <th style={{ width: 110 }}>Gói</th>}{tracks.map(t => <th key={t.code}>{trackHead(t)}</th>)}</tr></thead>
          <tbody>{grades.map(g => { const r = spAt(g)!; const skip = skipSetOf(r, skips)
            return <tr key={g} style={live.length > 1 ? { boxShadow: `inset 3px 0 0 ${pkgColor(r.package_id)}` } : undefined}><td><b>K{g}</b></td>
            {live.length > 1 && <td><Pk id={r.package_id} /></td>}
            {tracks.map(t => {
            const s = scopeAt(ctx, r.package_id!, t, g, skip)
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
          })}</tr> })}</tbody>
        </table>
      </div>}
      <p className="sub framefoot">{live.length > 1 ? 'Mỗi khối dùng một gói. ' : ''}Phần gạch ngang có trong gói nhưng trường không áp dụng. Bấm vào ô để xem chủ đề.</p>
      {hist && <>
        <h4 style={{ margin: '16px 0 6px' }}>Lịch sử gói của trường</h4>
        <div className="tablewrap" style={{ maxWidth: 900 }}><table className="table cmplined">
          <thead><tr><th>Gói</th><th>Khối</th><th>Thời gian áp dụng</th><th>Ghi chú</th></tr></thead>
          <tbody>{[...cur.sps].sort((a, b) => (b.starts_on ?? '').localeCompare(a.starts_on ?? '') || byGrade(a, b)).map(r => { const st = spState(r); const from = upgradedFrom(r)
            return <tr key={r.sp_id}><td><span style={st === 'ended' ? { opacity: .6 } : undefined}><Pk id={r.package_id} /></span>{' '}
              {st !== 'ended' && <span className={'pill ' + (st === 'next' ? 'maintenance' : 'active')}>{st === 'next' ? 'Sắp áp dụng' : 'Đang dùng'}</span>}</td>
              <td>{kRange(r.grades ?? [])}</td>
              <td>{st === 'next' ? `Từ ${fmtDay(r.starts_on)}` : <>{r.starts_on ? fmtDay(r.starts_on) : 'Đầu năm học'} – {r.ends_on ? fmtDay(r.ends_on) : 'nay'}</>}</td>
              <td><small>{[from ? `Nâng cấp từ ${pkgName(from.package_id)}` : '', r.note ?? ''].filter(Boolean).join(' · ')}</small></td></tr> })}</tbody>
        </table></div></>}
      {vt && vs && view && <Drawer title={<>{trackHead(vt)} · {gradeName(view.g)}</>} onClose={() => setView(null)}>
        <ScopeView s={vs} modName={modName} />
      </Drawer>}
      {upSp && <Drawer title={<>Nâng cấp gói · {cur.name}</>} closeOnOutside={false} onClose={() => setUpgrade(null)}>
        <UpgradeForm row={upSp} ctx={ctx} packages={packages.filter(p => p.active && p.id !== upSp.package_id)} pkgName={pkgName} modName={modName}
          onCancel={() => setUpgrade(null)} onSaved={() => { setUpgrade(null); reloadSchools() }} />
      </Drawer>}
      {assignDrawer}
    </ElView>
  }

  return <>
    {msg && <p className="msg" role="status">{msg}</p>}
    <DataTable id="school-packages" rows={shown} rowKey={r => r.org_id} noun="trường" onRow={r => { setOpenOrg(r.org_id); setEdit(null) }}
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
        { key: 'grades', label: 'Khối', text: r => kRange(liveOf(r).flatMap(x => x.grades ?? [])), cell: r => kRange(liveOf(r).flatMap(x => x.grades ?? [])) },
        { key: 'pkg', label: 'Gói', text: r => liveOf(r).map(x => pkgName(x.package_id)).join(', '), cell: r => { const live = liveOf(r)
          return <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 14, rowGap: 2 }}>
            {live.map(x => { const from = upgradedFrom(x); return <span key={x.sp_id} style={{ whiteSpace: 'nowrap' }}><Pk id={x.package_id} k={live.length > 1 ? kRange(x.grades ?? []) : undefined} />
              {from && <small className="sub"> · nâng cấp từ {pkgName(from.package_id)}{x.starts_on ? ` · ${fmtDay(x.starts_on)}` : ''}</small>}</span> })}
            {nextOf(r).map(x => <small key={x.sp_id} className="sub" style={{ flexBasis: '100%' }}>→ {pkgName(x.package_id)} cho {kRange(x.grades ?? [])} từ {fmtDay(x.starts_on)}</small>)}</div> } },
        { key: 'scope', label: 'Phạm vi', text: r => liveOf(r).every(x => x.full_package) ? 'Đủ gói' : 'Một phần', cell: r => liveOf(r).every(x => x.full_package) ? 'Đủ gói' : 'Một phần' },
        ...tracks.map(t => ({ key: 't' + t.code, label: trackLabel(t.code), cell: (r: School) => <Count {...summary(liveOf(r), t)} /> })),
      ]} />
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

type Line = { pkg: string; grades: number[] }

type Pick = { org_id: string; name: string; code: string | null; level: string | null; taken: number[] }
type Prov = { province_id: string | null; province_name: string | null; schools: number }

function AssignForm({ year, schools, preset, packages, pkgColor, pkgName, onCancel, onSaved }: {
  year: string; schools: School[]; preset: string; packages: ProgramPackage[]; pkgColor: (id: string | null) => string; pkgName: (id: string | null) => string
  onCancel: () => void; onSaved: (org: string) => void
}) {
  const NOPROV = '__none'
  const pre = schools.find(s => s.org_id === preset)
  const preSchool: Pick | undefined = pre && { org_id: pre.org_id, name: pre.name, code: pre.code, level: pre.level, taken: takenGrades(pre) }
  // Chọn tỉnh / thành trước (danh sách tỉnh nhỏ), rồi mới tải trường của tỉnh đó
  const [provs, setProvs] = useState<Prov[] | null>(null)
  const [prov, setProv] = useState('')
  const [list, setList] = useState<Pick[] | null>(null)
  const [q, setQ] = useState('')
  const [org, setOrg] = useState(preset)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (preset) return
    supabase.rpc('school_package_provinces', { p_year: year }).then(({ data, error }) => {
      if (error) setErr(spErr(error.message + ' ' + (error.code ?? '')))
      setProvs((data ?? []) as Prov[])
    })
  }, [year, preset])
  useEffect(() => {
    setList(null)
    if (!prov) return
    let live = true
    fetchAll<Pick>(() => supabase.rpc('school_package_pick', { p_year: year, p_province: prov === NOPROV ? null : prov }) as any).then(({ data, error }) => {
      if (!live) return
      if (error) setErr(spErr(error.message))
      setList((data ?? []) as Pick[])
    })
    return () => { live = false }
  }, [prov, year])
  const picked = preSchool ?? list?.find(x => x.org_id === org)
  const free = (s: Pick | undefined) => ALL_GRADES.filter(g => !(s?.taken ?? []).includes(g))
  // Gợi ý khối theo cấp học của trường, bỏ khối đã có gói (vẫn chọn thêm / bỏ bớt được)
  const suggest = (s: Pick | undefined) => s?.level ? gradesOfLevel(s.level).filter(g => free(s).includes(g)) : []
  const [lines, setLines] = useState<Line[]>(() => [{ pkg: packages[0]?.id ?? '', grades: suggest(preSchool) }])
  const nq = q.trim().toLowerCase()
  const shown = useMemo(() => (list ?? []).filter(r => !nq || (r.name + ' ' + (r.code ?? '')).toLowerCase().includes(nq)), [list, nq])
  const has = (pre?.sps ?? []).filter(x => spState(x) !== 'ended').sort(byGrade)
  const pickOrg = (id: string) => { setOrg(id); setLines([{ pkg: packages[0]?.id ?? '', grades: suggest(list?.find(x => x.org_id === id)) }]) }
  const hint = !picked ? '' : picked.level === 'mamnon' ? ' · trường mầm non, gói chưa có khối mầm non' : picked.level ? ' · đã chọn sẵn theo cấp học của trường' : ' · trường chưa ghi cấp học, hãy chọn khối'
  const setLine = (i: number, v: Partial<Line>) => setLines(ls => ls.map((l, k) => k === i ? { ...l, ...v } : l))
  // Khối chọn được ở một dòng: chưa có gói, chưa chọn ở dòng khác
  const allowedAt = (i: number) => free(picked).filter(g => !lines.some((l, k) => k !== i && l.grades.includes(g)))
  const left = free(picked).filter(g => !lines.some(l => l.grades.includes(g)))
  const total = (provs ?? []).reduce((x, p) => x + p.schools, 0)
  async function save() {
    if (!org) return setErr('Chọn trường.')
    const ls = lines.filter(l => l.grades.length)
    if (!ls.length) return setErr('Chọn ít nhất một khối.')
    if (ls.some(l => !l.pkg)) return setErr('Chọn gói.')
    setBusy(true); setErr('')
    const { error } = await supabase.from('school_packages').insert(ls.map(l => ({ org_id: org, package_id: l.pkg, school_year: year, grades: l.grades, full_package: true })))
    setBusy(false)
    if (error) return setErr(spErr(error.message + ' ' + (error.code ?? '')))
    onSaved(org)
  }
  return <div style={{ display: 'grid', gap: 12 }}>
    {!preset && <label className="field"><span>Tỉnh / thành {provs ? `(${total.toLocaleString('vi-VN')} trường còn khối chưa có gói năm học ${yearLabel(year)})` : ''}</span>
      <select value={prov} disabled={!provs} onChange={e => { setProv(e.target.value); setOrg(''); setQ(''); setLines([{ pkg: packages[0]?.id ?? '', grades: [] }]) }} aria-label="Chọn tỉnh / thành">
        <option value="">{provs ? '— Chọn tỉnh / thành —' : 'Đang tải…'}</option>
        {(provs ?? []).map(p => <option key={p.province_id ?? NOPROV} value={p.province_id ?? NOPROV}>{p.province_name ?? 'Chưa thuộc tỉnh nào'} ({p.schools.toLocaleString('vi-VN')} trường)</option>)}</select></label>}
    {preset ? <div className="field"><span>Trường</span><b>{pre?.name}</b></div>
      : prov && <label className="field"><span>Trường</span>
      <input placeholder="Tìm theo tên trường…" value={q} onChange={e => setQ(e.target.value)} />
      {!list ? <small className="sub">Đang tải danh sách trường…</small> : <>
      <select size={8} value={org} onChange={e => pickOrg(e.target.value)} aria-label="Chọn trường">
        {shown.slice(0, 300).map(r => <option key={r.org_id} value={r.org_id}>{r.name}{r.taken.length ? ` · đã có gói ${kRange(r.taken)}` : ''}</option>)}</select>
      {shown.length > 300 && <small className="sub">Đang hiện 300 / {shown.length.toLocaleString('vi-VN')} trường, gõ tên để tìm.</small>}</>}</label>}
    {has.length > 0 && <div className="field"><span>Đã có</span><div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {has.map(x => <span key={x.sp_id}><b style={{ color: pkgColor(x.package_id) }}>■</b> {pkgName(x.package_id)} <span className="sub">{kRange(x.grades ?? [])}</span></span>)}</div></div>}
    {picked && <>
      {lines.map((l, i) => <section key={i} className="panel" style={{ margin: 0, padding: 10, borderLeft: `4px solid ${pkgColor(l.pkg)}` }}>
        <div className="bar" style={{ margin: '0 0 8px', gap: 8 }}>
          <label className="field" style={{ margin: 0, minWidth: 200 }}><select aria-label="Gói" value={l.pkg} onChange={e => setLine(i, { pkg: e.target.value })}>
            {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          {i === 0 && <small className="sub">Khối áp dụng{hint}</small>}
          {lines.length > 1 && <button type="button" className="x" style={{ marginLeft: 'auto' }} title="Bỏ dòng này" onClick={() => setLines(ls => ls.filter((_, k) => k !== i))}>✕</button>}</div>
        {allowedAt(i).length ? <GradePick value={l.grades} onChange={v => setLine(i, { grades: v })} allowed={allowedAt(i)} /> : <small className="sub">Các khối đều đã có gói.</small>}
      </section>)}
      {left.length > 0 && lines.every(l => l.grades.length) && <button type="button" style={{ justifySelf: 'start' }}
        onClick={() => setLines(ls => [...ls, { pkg: packages.find(p => !ls.some(l => l.pkg === p.id))?.id ?? packages[0]?.id ?? '', grades: [] }])}>+ Thêm gói cho khối khác</button>}
    </>}
    <small className="sub">Mỗi khối dùng một gói. Gán xong là áp dụng đủ gói. Trường áp dụng một phần thì mở trường, bấm "Sửa phạm vi" để bỏ tick phần không áp dụng.</small>
    {err && <p className="warnline">{err}</p>}
    <div className="actions"><button className="primary" onClick={save} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button><button onClick={onCancel} disabled={busy}>Huỷ</button></div>
  </div>
}

function UpgradeForm({ row, ctx, packages, pkgName, modName, onCancel, onSaved }: {
  row: SchoolPkgRow; ctx: Ctx; packages: ProgramPackage[]; pkgName: (id: string | null) => string; modName: (id: string) => string; onCancel: () => void; onSaved: () => void
}) {
  const [pkg, setPkg] = useState(packages[0]?.id ?? '')
  const [grades, setGrades] = useState<number[]>(row.grades ?? [])
  const [from, setFrom] = useState(todayIso())
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // Học phần / chủ đề thay đổi giữa gói cũ và gói mới ở các khối nâng cấp
  const diff = ctx.tracks.map(t => {
    const at = (p: string) => ctx.items.filter(i => i.package_id === p && i.track_code === t.code && grades.includes(i.grade))
    if (t.use_modules === false) {
      const n = (p: string) => at(p).reduce((x, i) => x + slotTopics(ctx.topics, ctx.items, i).length, 0)
      const a = n(row.package_id!), b = n(pkg)
      return { t, add: [] as string[], del: [] as string[], text: a === b ? '' : `${a} → ${b} chủ đề` }
    }
    const a = new Set(at(row.package_id!).map(i => i.module_id)), b = new Set(at(pkg).map(i => i.module_id))
    return { t, add: [...b].filter(x => !a.has(x)).map(modName), del: [...a].filter(x => !b.has(x)).map(modName), text: '' }
  })
  const changed = diff.filter(d => d.add.length || d.del.length || d.text)
  const same = diff.filter(d => !(d.add.length || d.del.length || d.text)).map(d => trackLabel(d.t.code))
  const prevDay = (d: string) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10) }
  async function save() {
    if (!pkg) return setErr('Chọn gói mới.')
    if (!grades.length) return setErr('Chọn ít nhất một khối.')
    if (!from) return setErr('Chọn ngày áp dụng.')
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('school_package_upgrade', { p_sp: row.sp_id, p_package: pkg, p_grades: grades, p_from: from, p_note: note.trim() })
    setBusy(false)
    if (error) return setErr(spErr(error.message + ' ' + (error.code ?? '')))
    onSaved()
  }
  if (!packages.length) return <p className="sub">Chưa có gói khác đang dùng để nâng cấp.</p>
  return <div style={{ display: 'grid', gap: 12 }}>
    <div className="field"><span>Gói đang dùng</span><b>{pkgName(row.package_id)} · {kRange(row.grades ?? [])} · {row.starts_on ? `từ ${fmtDay(row.starts_on)}` : 'từ đầu năm học'}</b></div>
    <label className="field"><span>Nâng cấp lên</span><select value={pkg} onChange={e => setPkg(e.target.value)}>
      {packages.map(p => <option key={p.id} value={p.id}>{p.name}{p.description ? ` · ${p.description}` : ''}</option>)}</select></label>
    {(row.grades ?? []).length > 1 && <div className="field"><span>Khối nâng cấp <small className="sub">· khối bỏ chọn giữ {pkgName(row.package_id)}</small></span>
      <GradePick value={grades} onChange={setGrades} allowed={row.grades ?? []} /></div>}
    <label className="field"><span>Áp dụng từ ngày</span><input type="date" value={from} min={row.starts_on ?? undefined} onChange={e => setFrom(e.target.value)} /></label>
    <section className="panel" style={{ margin: 0, padding: 10, background: 'var(--soft)' }}>
      <b>Thay đổi khi nâng cấp</b>
      <ul style={{ margin: '6px 0 0', paddingLeft: 18, display: 'grid', gap: 2 }}>
        {changed.map(d => <li key={d.t.code}><small>{trackLabel(d.t.code)}: {d.text}
          {d.add.length > 0 && <>thêm <b>{d.add.join(', ')}</b></>}{d.add.length > 0 && d.del.length > 0 && '; '}{d.del.length > 0 && <>bỏ <b>{d.del.join(', ')}</b></>}</small></li>)}
        {same.length > 0 && <li><small>{same.join(', ')} không đổi</small></li>}
        {from && <li><small>{pkgName(row.package_id)} kết thúc ngày {fmtDay(prevDay(from))} và được lưu vào lịch sử gói của trường</small></li>}
      </ul></section>
    <label className="field"><span>Ghi chú</span><input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="VD: theo phụ lục hợp đồng số…" /></label>
    {err && <p className="warnline">{err}</p>}
    <div className="actions"><button className="primary" onClick={save} disabled={busy}>{busy ? 'Đang lưu…' : 'Nâng cấp'}</button><button onClick={onCancel} disabled={busy}>Huỷ</button></div>
  </div>
}

function ScopeEdit({ ctx, row, skips, packages, modName, allowed, onCancel, onSaved }: {
  ctx: Ctx; row: SchoolPkgRow; skips: PkgSkip[]; packages: ProgramPackage[]; modName: (id: string) => string; allowed: number[]; onCancel: () => void; onSaved: () => void
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
      <div className="field"><span>Khối áp dụng</span><GradePick value={grades} allowed={allowed}
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
