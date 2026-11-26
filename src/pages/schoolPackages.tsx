import React, { useEffect, useMemo, useRef, useState } from 'react'
import { fetchAll, supabase } from '../lib/supabase'
import { TreeHead } from '../components/TreeHead'
import { useStemTracks, type StemTrack, trackLabel, TRACK_COLOR } from '../lib/stemTracks'
import { gradeName } from '../lib/eduLevels'
import { loadFrame, loadPackages, slotTopics, type PackageItem, type ProgramModule, type ProgramPackage, type ProgramTopic } from '../lib/programFrame'
import { ALL_GRADES, currentYear, fmtDay, gradesOfLevel, kRange, loadSchoolPkgs, shiftYear, spErr, spState, todayIso, yearLabel, type PkgSkip, type SchoolPkgRow } from '../lib/schoolPackages'
import { ColFilter, DataTable } from '../components/DataTable'
import { ElView } from '../components/ElView'
import { HeadAction } from '../components/PageFrame'
import { useColResize } from '../components/ColResize'
import { Drawer } from '../components/Drawer'
import { MultiSelect } from '../components/MultiSelect'
import { FitScreen } from '../components/FitScreen'
import { TopicContents } from './topicContents'

// Trường dùng gói (156, 158): danh sách trường (lọc tỉnh, gói) → chi tiết trường theo khối × loại chương trình → sửa phạm vi áp dụng
// (đủ gói hoặc bỏ tick phần trường không áp dụng). Trường dùng được nhiều gói, mỗi khối một gói; nâng cấp gói từ một ngày, lưu lịch sử. Chỉ KDI gán / sửa; Sở, Phòng, trường xem được trường thuộc mình.

const OFF = { textDecoration: 'line-through', color: 'var(--muted)' }
const tchip = (code: string) => <span className="progchip" style={{ background: TRACK_COLOR[code], color: '#fff' }}>{trackLabel(code)}</span>
const trackHead = (t: StemTrack) => `${trackLabel(t.code)} · ${t.name}`
// Tiêu đề cột loại CT: chip màu + tên; GAP: khe dọc tách các loại CT trong bảng gói của trường
const trackTh = (t: StemTrack) => <><span className="progchip" style={{ background: TRACK_COLOR[t.code], color: '#fff', marginRight: 8 }}>{trackLabel(t.code)}</span>{t.name}</>
const GAP = { borderLeft: '3px solid #e9eef5' }
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
const NO_SKIP = new Set<string>()
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
  const [view, setView] = useState<{ t: string; g: number; sl?: number } | null>(null)
  const [openTopic, setOpenTopic] = useState<ProgramTopic | null>(null)
  const [cmp, setCmp] = useState<string[] | null>(null)       // so sánh trường với gói: trường chọn sẵn

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

  const assignDrawer = assign !== false && <Drawer title={typeof assign === 'string' ? 'Thêm gói' : 'Gán gói cho trường'} closeOnOutside={false} onClose={() => setAssign(false)}>
    <AssignForm year={year} schools={schools} preset={typeof assign === 'string' ? assign : ''} packages={packages.filter(p => p.active)} pkgColor={pkgColor} pkgName={pkgName}
      onCancel={() => setAssign(false)} onSaved={org => { setAssign(false); reloadSchools().then(() => { setOpenOrg(org); setEdit(null) }) }} />
  </Drawer>

  if (cmp) return <ElView back={cur ? cur.name : 'Danh sách trường'} onBack={() => setCmp(null)} title={<>So sánh trường với gói <small className="sub" style={{ fontWeight: 400, fontSize: '0.6em', marginLeft: 6 }}>Năm học {yearLabel(year)}</small></>}>
    <SchoolCompare ctx={ctx} schools={used} skips={skips} packages={packages} preset={cmp} year={year} modName={modName} pkgName={pkgName} pkgColor={pkgColor} liveOf={liveOf} />
  </ElView>

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
      actions={<><button type="button" onClick={() => setCmp([cur.org_id])}>⇄ So sánh với gói</button>
        {admin && <button type="button" className="primary" onClick={() => setAssign(cur.org_id)}>+ Thêm gói</button>}</>}>
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
      {grades.length > 0 && (() => {
        // Mỗi loại CT có học phần tách thành cột con HP1, HP2…; ẩn loại CT không có trong gói của trường
        const scopes = new Map(grades.flatMap(g => { const r = spAt(g)!; const skip = skipSetOf(r, skips)
          return tracks.map(t => [t.code + '|' + g, scopeAt(ctx, r.package_id!, t, g, skip)] as const) }))
        const sc = (t: StemTrack, g: number) => scopes.get(t.code + '|' + g)!
        const shownT = tracks.filter(t => grades.some(g => sc(t, g).slots.length))
        const nSl = (t: StemTrack) => t.use_modules === false ? 0 : Math.max(0, ...grades.flatMap(g => sc(t, g).slots.map(x => x.slot)))
        const two = shownT.some(t => nSl(t) > 0)
        const rs = two ? 2 : 1
        return <div className="tablewrap">
        <table className="table cmplined">
          <thead><tr><th rowSpan={rs} style={{ width: 70 }}>Khối</th>{live.length > 1 && <th rowSpan={rs} style={{ width: 110 }}>Gói</th>}
            {shownT.map(t => nSl(t) > 0
              ? <th key={t.code} colSpan={nSl(t)} style={{ ...GAP, borderTop: `3px solid ${TRACK_COLOR[t.code]}` }}>{trackTh(t)}</th>
              : <th key={t.code} rowSpan={rs} style={{ ...GAP, borderTop: `3px solid ${TRACK_COLOR[t.code]}` }}>{trackTh(t)}</th>)}</tr>
            {two && <tr>{shownT.flatMap(t => Array.from({ length: nSl(t) }, (_, i) => <th key={t.code + i} style={i ? undefined : GAP}>HP{i + 1}</th>))}</tr>}</thead>
          <tbody>{grades.map(g => { const r = spAt(g)!
            return <tr key={g} style={live.length > 1 ? { boxShadow: `inset 3px 0 0 ${pkgColor(r.package_id)}` } : undefined}><td><b>K{g}</b></td>
            {live.length > 1 && <td><Pk id={r.package_id} /></td>}
            {shownT.flatMap(t => {
            const s = sc(t, g)
            const open = () => setView({ t: t.code, g })
            if (!s.mods) {
              if (!s.slots.length) return [<td key={t.code} style={GAP}><span className="sub">—</span></td>]
              const on = s.topics.filter(x => x.on).length
              const allOff = s.slots.every(x => !x.on)
              return [<td key={t.code} style={GAP}><button type="button" className="cellbtn" onClick={open} title="Xem chủ đề">
                {allOff ? <span style={OFF}>Không áp dụng</span> : !s.topics.length ? <span className="sub">Chưa nhập chủ đề</span>
                  : on === s.topics.length ? <>Đủ {on} chủ đề</> : <><b>{on}</b>/{s.topics.length} chủ đề</>}</button></td>]
            }
            return Array.from({ length: nSl(t) }, (_, i) => { const x = s.slots.find(y => y.slot === i + 1)
              return <td key={t.code + i} style={i ? undefined : GAP}>{x ? <button type="button" className="cellbtn" style={x.on ? undefined : OFF} onClick={() => setView({ t: t.code, g, sl: x.slot })} title="Xem học phần và chủ đề">{modName(x.module_id)}</button> : <span className="sub">—</span>}</td> })
          })}</tr> })}</tbody>
        </table>
      </div> })()}
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
      {vt && vs && view && <Drawer closeOnOutside onClose={() => { setView(null); setOpenTopic(null) }} onBack={openTopic ? () => setOpenTopic(null) : undefined}
        title={openTopic ? <>{tchip(vt.code)} {openTopic.title}</> : <>{tchip(vt.code)} {view.sl ? <>{modName(vs.slots.find(x => x.slot === view.sl)?.module_id ?? '')} · {gradeName(view.g)} · Học phần {view.sl}</> : <>{vt.name} · {gradeName(view.g)}</>}</>}>
        {openTopic ? <TopicContents topic={openTopic} admin={false} /> : <ScopeView s={vs} sl={view.sl} track={vt.name} modName={modName} onTopic={setOpenTopic} />}
      </Drawer>}
      {upSp && <Drawer title={<>Nâng cấp gói · {cur.name}</>} closeOnOutside={false} onClose={() => setUpgrade(null)}>
        <UpgradeForm row={upSp} ctx={ctx} packages={packages.filter(p => p.active && p.id !== upSp.package_id)} pkgName={pkgName} modName={modName}
          onCancel={() => setUpgrade(null)} onSaved={() => { setUpgrade(null); reloadSchools() }} />
      </Drawer>}
      {assignDrawer}
    </ElView>
  }

  // Cây Tỉnh / Thành phố (một lớp) bên trái bảng: bấm để lọc theo tỉnh, số = số trường
  const nProv = (p: string) => used.filter(r => (r.province_name ?? 'Chưa rõ tỉnh') === p).length
  const provItem = (k: string, label: string, c: number) => <button type="button" key={k || 'all'} className={'gtitem' + (prov === k ? ' on' : '')} aria-pressed={prov === k}
    onClick={() => setProv(k)}><span className="gtlbl">{label}</span><span className="gtcnt">{c}</span></button>
  const provTree = <nav className="gtree" aria-label="Lọc theo tỉnh / thành phố">
    <TreeHead title="Tỉnh / Thành phố">Số = số trường đang áp dụng gói.<br />Bấm tên tỉnh để lọc bảng.</TreeHead>
    {provItem('', 'Tất cả', used.length)}
    {provs.map(p => provItem(p, p, nProv(p)))}
  </nav>

  return <>
    {msg && <p className="msg" role="status">{msg}</p>}
    <DataTable id="school-packages-v2" className="spfit" aside={provTree} rows={shown} rowKey={r => r.org_id} noun="trường" onRow={r => { setOpenOrg(r.org_id); setEdit(null) }}
      empty={loaded ? (used.length ? 'Không có trường nào khớp bộ lọc.' : `Chưa có trường nào được gán gói trong năm học ${yearLabel(year)}.`) : 'Đang tải…'}
      left={<>{yearSel}
        <select aria-label="Gói" value={fPkg} onChange={e => setFPkg(e.target.value)}><option value="">Tất cả gói</option>
          {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></>}
      right={<><HeadAction><button type="button" style={{ order: -1 }} onClick={() => setCmp([])}>⇄ So sánh trường với gói</button></HeadAction>
        {admin && <button type="button" className="primary" onClick={() => setAssign(true)}>+ Gán gói cho trường</button>}</>}
      cols={[
        { key: 'name', label: 'Trường', fixed: true, text: r => r.name, cell: r => <button type="button" className="namelink" style={{ fontWeight: 600 }}>{r.name}</button> },
        { key: 'prov', label: 'Tỉnh / Thành phố', off: true, text: r => r.province_name ?? '', cell: r => r.province_name ?? <span className="sub">—</span> },
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

// So sánh trường với gói (v104): chọn gói (không bắt buộc) và 1–3 trường. Có gói: cột gói làm chuẩn, ô trường khác gói tô vàng.
// Không chọn gói: so thẳng các trường với nhau. Loại tính theo chủ đề (VD KDI1) bấm ▸ mở danh sách chủ đề; loại có học phần chỉ so tên học phần.
type CmpVal = { kind: 'none' } | { kind: 'mod'; module_id: string; on: boolean } | { kind: 'topics'; on: string[]; all: string[]; slot: boolean; slotOn: boolean }
const sigOf = (v: CmpVal) => v.kind === 'none' ? '' : v.kind === 'mod' ? `${v.module_id}|${v.on}` : v.all.length ? v.on.join(',') : `${v.slot}|${v.slotOn}`
const DIFF = { background: '#fffbeb' }
const CHK = { color: '#16a34a' }

const COLS_KEY = 'schoolCmpCols'
const COL_DEFAULT = ['track', 'grade', 'pkg', 's0', 's1', 's2']
type ColCfg = { order: string[]; hidden: string[] }
const loadColCfg = (): ColCfg => { try { const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? ''); if (Array.isArray(v?.order) && Array.isArray(v?.hidden)) return v } catch { /* mặc định */ } return { order: [], hidden: [] } }

/** Menu "Cột": tick để ẩn / hiện, kéo thả ⋮⋮ để đổi thứ tự, Mặc định để trả về như cũ */
function ColMenu({ order, hidden, label, onChange }: { order: string[]; hidden: string[]; label: (k: string) => string; onChange: (c: ColCfg) => void }) {
  const [open, setOpen] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [open])
  const drop = (to: number) => {
    if (drag === null) return
    const o = [...order]; const [m] = o.splice(drag, 1); o.splice(to > drag ? to - 1 : to, 0, m)
    onChange({ order: o, hidden }); setDrag(null); setOver(null)
  }
  const toggle = (k: string) => { const h = hidden.includes(k) ? hidden.filter(x => x !== k) : [...hidden, k]
    if (order.every(x => h.includes(x))) return
    onChange({ order, hidden: h }) }
  return <div ref={box} style={{ position: 'relative' }}>
    <button type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(o => !o)}>▥ Cột ▾</button>
    {open && <div role="dialog" aria-label="Ẩn hiện và sắp xếp cột" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 30, width: 280, background: 'var(--surface, #fff)',
      border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 10px 30px rgba(15,23,42,.15)', padding: '8px 0' }}>
      <small className="sub" style={{ display: 'block', padding: '2px 14px 6px' }}>Tick để hiện · kéo ⋮⋮ để đổi thứ tự</small>
      {order.map((k, i) => <div key={k} draggable onDragStart={e => { setDrag(i); e.dataTransfer.effectAllowed = 'move' }}
        onDragOver={e => { e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setOver(e.clientY > r.top + r.height / 2 ? i + 1 : i) }}
        onDrop={e => { e.preventDefault(); drop(over ?? i) }} onDragEnd={() => { setDrag(null); setOver(null) }}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', cursor: 'grab', opacity: drag === i ? .4 : 1,
          boxShadow: over === i ? 'inset 0 3px 0 var(--primary, #2563eb)' : over === i + 1 && i === order.length - 1 ? 'inset 0 -3px 0 var(--primary, #2563eb)' : undefined }}>
        <span aria-hidden style={{ color: '#94a3b8', letterSpacing: -2 }}>⋮⋮</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, cursor: 'pointer', margin: 0 }}>
          <input type="checkbox" checked={!hidden.includes(k)} onChange={() => toggle(k)} />
          <span style={hidden.includes(k) ? { color: 'var(--muted)' } : undefined}>{label(k)}</span></label></div>)}
      <div style={{ borderTop: '1px solid var(--line)', marginTop: 6, padding: '8px 14px 2px', textAlign: 'right' }}>
        <button type="button" className="linkbtn" style={{ background: 'none', border: 0, padding: 0, color: 'var(--primary, #2563eb)', cursor: 'pointer' }} onClick={() => onChange({ order: [], hidden: [] })}>Mặc định</button></div>
    </div>}
  </div>
}

function SchoolCompare({ ctx, schools, skips, packages, preset, modName, pkgName, pkgColor, liveOf, year }: {
  ctx: Ctx; schools: School[]; skips: PkgSkip[]; packages: ProgramPackage[]; preset: string[]; year: string
  modName: (id: string) => string; pkgName: (id: string | null) => string; pkgColor: (id: string | null) => string; liveOf: (s: School) => SchoolPkgRow[]
}) {
  const rs = useColResize('schoolcmp')   // kéo mép tiêu đề đổi độ rộng cột, nút Thu gọn
  const firstPkg = (orgs: string[]) => { const s = schools.find(x => x.org_id === orgs[0]); return s ? liveOf(s)[0]?.package_id ?? '' : '' }
  const [orgs, setOrgs] = useState<string[]>(preset.slice(0, 3))
  const [pkg, setPkg] = useState(() => firstPkg(preset))
  const [only, setOnly] = useState(true)
  const [tf, setTf] = useState<string[]>([])   // lọc loại CT (rỗng = tất cả)
  const tl = (t: StemTrack) => `${trackLabel(t.code)} · ${t.name}`
  const [colCfg, setColCfg] = useState<ColCfg>(loadColCfg)
  useEffect(() => { try { localStorage.setItem(COLS_KEY, JSON.stringify(colCfg)) } catch { /* bỏ qua */ } }, [colCfg])
  const [open, setOpen] = useState<Record<string, boolean>>({})   // dòng loại tính theo chủ đề đang mở → true = chỉ chủ đề khác nhau
  const sel = orgs.map(o => schools.find(s => s.org_id === o)).filter(Boolean) as School[]
  const usingOf = (s: School) => { const live = liveOf(s); return live.map(x => pkgName(x.package_id) + (live.length > 1 ? ` (${kRange(x.grades ?? [])})` : '')).join(', ') || 'chưa có gói' }
  const pickOrgs = (v: string[]) => { const n = v.slice(0, 3); if (!orgs.length && !pkg) setPkg(firstPkg(n)); setOrgs(n) }
  // Loại tính theo chủ đề lên trước (giống trang So sánh gói)
  const tracks = [...ctx.tracks].sort((a, b) => Number(a.use_modules !== false) - Number(b.use_modules !== false))
  const spAt = (s: School, g: number) => liveOf(s).find(x => (x.grades ?? []).includes(g))
  const valOf = (sc: ReturnType<typeof scopeAt> | null, t: StemTrack, slot: number): CmpVal => {
    if (!sc || !sc.slots.length) return { kind: 'none' }
    if (t.use_modules === false) return { kind: 'topics', on: sc.topics.filter(x => x.on).map(x => x.topic.id), all: sc.topics.map(x => x.topic.id), slot: true, slotOn: sc.slots.some(x => x.on) }
    const x = sc.slots.find(y => y.slot === slot)
    return x ? { kind: 'mod', module_id: x.module_id, on: x.on } : { kind: 'none' }
  }
  const grades = [...new Set(sel.flatMap(s => liveOf(s).flatMap(x => x.grades ?? [])))].sort((a, b) => a - b)
  type Row = { key: string; g: number; t: StemTrack; slot: number; p: CmpVal | null; ss: (CmpVal | null)[]; pSc: ReturnType<typeof scopeAt> | null; sSc: (ReturnType<typeof scopeAt> | null)[] }
  const rows: Row[] = []
  for (const g of grades) for (const t of tracks) {
    const pSc = pkg ? scopeAt(ctx, pkg, t, g, new Set()) : null
    const sSc = sel.map(s => { const r = spAt(s, g); return r ? scopeAt(ctx, r.package_id!, t, g, skipSetOf(r, skips)) : null })
    const all = [pSc, ...sSc]
    const slots = t.use_modules === false ? [0] : [...new Set(all.flatMap(x => x?.slots.map(y => y.slot) ?? []))].sort((a, b) => a - b)
    for (const slot of slots) {
      const p = pkg ? valOf(pSc, t, slot) : null
      const ss = sSc.map((x, i) => spAt(sel[i], g) ? valOf(x, t, slot) : null)
      if (p?.kind === 'none' && ss.every(x => !x || x.kind === 'none')) continue
      if (!pkg && ss.every(x => !x || x.kind === 'none')) continue
      rows.push({ key: `${g}|${t.code}|${slot}`, g, t, slot, p, ss, pSc, sSc })
    }
  }
  // Ô trường khác: có gói thì so với gói, không có gói thì so với các trường còn lại
  const diffAt = (r: Row, i: number) => { const v = r.ss[i]; if (!v) return false
    if (r.p) return sigOf(v) !== sigOf(r.p)
    return r.ss.some((w, j) => j !== i && w && sigOf(w) !== sigOf(v)) }
  const rowDiff = (r: Row) => r.ss.some((_, i) => diffAt(r, i))
  const base = only ? rows.filter(rowDiff) : rows
  const shown = tf.length ? base.filter(r => tf.includes(r.t.code)) : base
  const stat = (i: number) => { const rs = rows.filter(r => r.ss[i]); const d = rs.filter(r => diffAt(r, i)).length; return { n: rs.length, d } }
  const both = rows.filter(r => r.ss.filter(Boolean).length > 1)
  const bothD = both.filter(rowDiff).length
  const pct = (n: number, d: number) => n ? Math.round((n - d) / n * 100) : 100

  const txt = (v: CmpVal | null, sc: ReturnType<typeof scopeAt> | null, t: StemTrack) => {
    if (!v) return <span className="sub">Khối không dùng gói</span>
    if (v.kind === 'none') return <span className="sub">—</span>
    if (v.kind === 'mod') return v.on ? modName(v.module_id) : <><span style={{ textDecoration: 'line-through', color: '#b42318' }}>{modName(v.module_id)}</span> không áp dụng</>
    if (!v.all.length) return v.slotOn ? 'Có' : <span style={{ color: '#b42318' }}>Không áp dụng</span>
    return v.on.length === v.all.length ? `${v.all.length} chủ đề` : `${v.on.length}/${v.all.length} chủ đề`
  }
  // Cột của bảng: thứ tự và ẩn / hiện chỉnh trong menu "Cột", nhớ trên máy. Trường đánh số theo vị trí chọn (s0, s1, s2)
  const present = (k: string) => k === 'pkg' ? !!pkg : k.startsWith('s') && k !== 'slot' && /^s\d$/.test(k) ? Number(k.slice(1)) < sel.length : true
  const order = [...colCfg.order.filter(k => COL_DEFAULT.includes(k)), ...COL_DEFAULT.filter(k => !colCfg.order.includes(k))].filter(present)
  const vis = order.filter(k => !colCfg.hidden.includes(k))
  const colLabel = (k: string) => k === 'track' ? 'Loại CT' : k === 'grade' ? 'Khối - Phần' : k === 'pkg' ? `${pkgName(pkg)} có` : sel[Number(k.slice(1))]?.name ?? k
  const isKey = (k: string) => k === 'track' || k === 'grade'
  // Nhóm dòng theo cột Loại CT hoặc Khối, cột nào đứng trước
  const gk = vis.find(k => k === 'track' || k === 'grade') ?? 'grade'
  const tIdx = (t: StemTrack) => tracks.findIndex(x => x.code === t.code)
  const sorted = gk === 'track' ? [...shown].sort((a, b) => tIdx(a.t) - tIdx(b.t) || a.g - b.g || a.slot - b.slot) : shown
  const gOf = (r: Row) => gk === 'track' ? r.t.code : String(r.g)
  const spanCol = vis.includes(gk) ? gk : ''
  const topical = (r: Row) => r.t.use_modules === false && !!(r.pSc?.topics.length || r.sSc.some(x => x?.topics.length))
  const topicData = (r: Row) => {
    const scs = [...(pkg ? [r.pSc] : []), ...r.sSc]
    const ids: ProgramTopic[] = []; const seen = new Set<string>()
    for (const sc of scs) for (const x of sc?.topics ?? []) if (!seen.has(x.topic.id)) { seen.add(x.topic.id); ids.push(x.topic) }
    const st = (sc: ReturnType<typeof scopeAt> | null, id: string) => { const x = sc?.topics.find(y => y.topic.id === id); return !x ? 0 : x.on ? 1 : 2 }
    const list = ids.map(tp => { const p = pkg ? st(r.pSc, tp.id) : null; const ss = r.sSc.map((sc, i) => r.ss[i] ? st(sc, tp.id) : null)
      const d = ss.map((v, i) => v !== null && (p !== null ? v !== p : ss.some((w, j) => j !== i && w !== null && w !== v)))
      return { tp, p, ss, d } })
    const dl = list.filter(x => x.d.some(Boolean))
    return { n: ids.length, nd: dl.length, list: open[r.key] ? dl : list }
  }
  type Line = { r: Row; kind: 'main' } | { r: Row; kind: 'head'; n: number } | { r: Row; kind: 'topic'; x: ReturnType<typeof topicData>['list'][number]; k: number }
  const lines: Line[] = sorted.flatMap(r => {
    const out: Line[] = [{ r, kind: 'main' }]
    if (topical(r) && open[r.key] !== undefined) { const d = topicData(r); out.push(...d.list.map((x, k) => ({ r, kind: 'topic' as const, x, k }))) }
    return out
  })
  const mark = (v: number | null) => v === null ? <span className="sub">—</span> : v === 1 ? <span style={CHK}>✓</span> : v === 2 ? <span style={{ color: '#b42318' }}>✕ không áp dụng</span> : <span className="sub">—</span>
  const chipOf = (t: StemTrack) => <span className="progchip" style={{ background: TRACK_COLOR[t.code], color: '#fff', marginRight: 6 }}>{trackLabel(t.code)}</span>
  const renderLine = (ln: Line, li: number) => {
    const r = ln.r
    const first = li === 0 || gOf(lines[li - 1].r) !== gOf(r)
    const span = first ? lines.slice(li).findIndex(x => gOf(x.r) !== gOf(r)) : 0
    const cols = vis.filter(k => k !== spanCol || first)
    const cells: React.ReactNode[] = []
    const tint = { borderLeft: `4px solid ${TRACK_COLOR[r.t.code]}`, background: TRACK_COLOR[r.t.code] + '14' }
    const spanCell = (k: string) => <td key={k} rowSpan={span < 0 ? lines.length - li : span} style={{ verticalAlign: 'top', ...(k === 'track' ? tint : {}) }}>
      {k === 'track' ? <span style={{ fontWeight: 600 }}>{chipOf(r.t)}{r.t.name}</span> : <b>{gradeName(r.g)}</b>}</td>
    if (ln.kind === 'main') {
      const isOpen = topical(r) && open[r.key] !== undefined
      // Phần (học phần / chủ đề) ghép vào ô Khối, hoặc ô Loại CT khi cột Khối đang gộp nhóm hay bị ẩn
      // Loại tính theo chủ đề: nút "Xem N chủ đề" rõ ràng; khi mở thì nút lọc Khác nhau / Tất cả nằm ngay dưới
      const td = topical(r) ? topicData(r) : null; const nT = td?.n ?? 0
      const part = topical(r) ? <><button type="button" className={'cmpxbtn' + (isOpen ? ' on' : '')} aria-expanded={isOpen}
          onClick={() => setOpen(o => { const n = { ...o }; if (isOpen) delete n[r.key]; else n[r.key] = false; return n })}>
          <span className="ar">{isOpen ? '▾' : '▸'}</span>{isOpen ? 'Đóng' : 'Xem'} {nT} chủ đề</button>
        {isOpen && <span className="seg cmpseg" role="group" aria-label="Lọc chủ đề">
          <button type="button" className={open[r.key] ? 'on' : ''} aria-pressed={!!open[r.key]} onClick={() => setOpen(o => ({ ...o, [r.key]: true }))}>Khác nhau <small>({td?.nd})</small></button>
          <button type="button" className={open[r.key] ? '' : 'on'} aria-pressed={!open[r.key]} onClick={() => setOpen(o => ({ ...o, [r.key]: false }))}>Tất cả <small>({nT})</small></button></span>}</>
        : <>{r.t.use_modules === false ? 'Chủ đề' : `Học phần ${r.slot}`}</>
      for (const k of cols) {
        if (k === spanCol) cells.push(spanCell(k))
        else if (k === 'track') cells.push(<td key={k} style={tint}>{chipOf(r.t)}{r.t.name}{spanCol === 'grade' || !vis.includes('grade') ? <> - {part}</> : null}</td>)
        else if (k === 'grade') cells.push(<td key={k} style={topical(r) ? { whiteSpace: 'nowrap' } : undefined}><b>{gradeName(r.g)}</b> - {part}{!vis.includes('track') && <> · {chipOf(r.t)}</>}</td>)
        else if (k === 'pkg') cells.push(<td key={k}>{pkg ? txt(r.p, r.pSc, r.t) : <span className="sub">—</span>}</td>)
        else { const i = Number(k.slice(1)); const v = r.ss[i]; const d = diffAt(r, i)
          cells.push(<td key={k} style={d ? DIFF : undefined}>{/* Giống gói: tên chữ xám; khác gói: chữ đậm trên nền vàng */}<span style={d ? { fontWeight: 600 } : pkg && v ? { color: '#94a3b8' } : undefined}>{txt(v, r.sSc[i], r.t)}</span></td>) }
      }
      return <tr key={r.key}>{cells}</tr>
    }
    const bgBase = { padding: '4px 12px', height: 'auto', fontSize: 13.5 }
    if (ln.kind === 'head') {
      // Một ô trải các cột còn lại (tách đôi nếu cột nhóm nằm giữa)
      let run: string[] = []; let firstRun = true
      const flush = (key: string) => { if (!run.length) return; const n = run.length; run = []
        cells.push(<td key={key} colSpan={n} style={{ background: '#fbfcfe', padding: '6px 12px' }}>{firstRun && <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <small className="sub">{ln.n} chủ đề {trackLabel(r.t.code)} · {gradeName(r.g)}</small>
          <span className="seg" style={{ marginLeft: 'auto' }}>
            <button type="button" className={open[r.key] ? 'on' : ''} onClick={() => setOpen(o => ({ ...o, [r.key]: true }))}>Chỉ chủ đề khác nhau</button>
            <button type="button" className={open[r.key] ? '' : 'on'} onClick={() => setOpen(o => ({ ...o, [r.key]: false }))}>Tất cả {ln.n}</button></span></span>}</td>); firstRun = false }
      for (const k of cols) { if (k === spanCol) { flush('a'); cells.push(spanCell(k)) } else run.push(k) }
      flush('b')
      return <tr key={r.key + 'h'}>{cells}</tr>
    }
    const x = ln.x; const bg = { ...(x.d.some(Boolean) ? DIFF : { background: '#fbfcfe' }), ...bgBase }
    let lab = 0; let titled = false
    const flushLab = (key: string) => { if (!lab) return; cells.push(<td key={key} colSpan={lab} style={bg}>{!titled && <><span className="sub" style={{ display: 'inline-block', width: 26 }}>{ln.k + 1}</span>{x.tp.title}</>}</td>); titled = true; lab = 0 }
    for (const k of cols) {
      if (k === spanCol) { flushLab('l' + k); cells.push(spanCell(k)) }
      else if (isKey(k)) lab++
      else { flushLab('l' + k); cells.push(<td key={k} style={bg}>{k === 'pkg' ? (pkg ? mark(x.p) : <span className="sub">—</span>) : mark(x.ss[Number(k.slice(1))])}</td>) }
    }
    flushLab('lend')
    return <tr key={r.key + x.tp.id}>{cells}</tr>
  }
  const schoolOpts = (keep?: string) => schools.filter(x => x.org_id === keep || !orgs.includes(x.org_id))
  const schoolSel = (i: number) => <select className="cmphsel" aria-label={`Trường ${i + 1}`} value={orgs[i]} onChange={e => setOrgs(orgs.map((o, j) => j === i ? e.target.value : o))}>
    {schoolOpts(orgs[i]).map(x => <option key={x.org_id} value={x.org_id}>{x.name}</option>)}</select>
  const addSchool = orgs.length < 3 && schoolOpts().length > 0 ? <select className="cmphadd" aria-label="Thêm trường để so sánh" value="" onChange={e => e.target.value && pickOrgs([...orgs, e.target.value])}>
    <option value="">+ Thêm trường</option>{schoolOpts().map(x => <option key={x.org_id} value={x.org_id}>{x.name} · {usingOf(x)}</option>)}</select> : null
  const addPkg = !pkg ? <select className="cmphadd" aria-label="Chọn gói để so sánh" value="" onChange={e => setPkg(e.target.value)}>
    <option value="">+ Chọn gói</option>{packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select> : null
  const adds = <span className="cmphadds">{addPkg}{addSchool}</span>
  const printCmp = () => { document.body.classList.add('cmpprinting'); window.print(); setTimeout(() => document.body.classList.remove('cmpprinting'), 500) }
  return <>
    <div className="lvfilter cmpfilter">
      <div className="lvextra">
        <label className="field inline"><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} /> Chỉ hiện điểm khác nhau</label>
      <span className="lvgrp"><span className="lvlab">Loại CT</span><ColFilter pin label={tf.length ? tf.map(trackLabel).join(', ') : 'Tất cả'} value={tracks.filter(t => tf.includes(t.code)).map(tl)}
        options={tracks.map(t => [tl(t), base.filter(r => r.t.code === t.code).length] as [string, number])}
        onChange={v => setTf(tracks.filter(t => v.includes(tl(t))).map(t => t.code))} /></span>
        {rs.fitBtn}
        <ColMenu order={order} hidden={colCfg.hidden} label={colLabel} onChange={setColCfg} />
        <button type="button" onClick={printCmp}>In / Xuất PDF</button></div>
    </div>
    {<div className="cmpprint">
      <h3 className="printonly">So sánh trường với gói · {pkg ? pkgName(pkg) : 'không chọn gói'} · Năm học {yearLabel(year)}</h3>
      {!pkg && sel.length > 1 && <p className="sub" style={{ margin: '0 0 8px' }}>Các trường giống nhau <b style={{ color: 'var(--text, #0f172a)' }}>{pct(both.length, bothD)}%</b> · {bothD} điểm khác</p>}
      {!pkg && sel.length === 1 && <p className="sub" style={{ margin: '0 0 8px' }}>Chọn gói hoặc thêm trường để so sánh.</p>}
      <FitScreen className="fsbox"><table className="table cmptbl cmplined sctbl" {...rs.tableProps}>
        <thead><tr>{vis.map(k => k === 'pkg'
          ? <th key={k}><span className="cmphead">{pkg && <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: pkgColor(pkg), flex: 'none' }} />}
              <select className="cmphsel" aria-label="Gói để so sánh" value={pkg} onChange={e => setPkg(e.target.value)}>
                {packages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><span>có</span>
              <button type="button" className="cmphx" title="Bỏ gói, so các trường với nhau" aria-label="Bỏ gói" onClick={() => setPkg('')}>×</button></span></th>
          : /^s\d$/.test(k) ? <th key={k}><span className="cmphead">{schoolSel(Number(k.slice(1)))}
              <button type="button" className="cmphx" title="Bỏ trường này" aria-label="Bỏ trường này" onClick={() => setOrgs(orgs.filter((_, j) => j !== Number(k.slice(1))))}>×</button>
              {Number(k.slice(1)) === sel.length - 1 && adds}</span><small style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 400, flexWrap: 'wrap' }}>Đang dùng {usingOf(sel[Number(k.slice(1))])}
            {pkg && (() => { const { n, d } = stat(Number(k.slice(1))); const p = pct(n, d)
              return <><span>·</span><b title={`${d} điểm khác`}>{p}% giống gói</b><span style={{ width: 56, height: 5, borderRadius: 3, background: '#e2e8f0', overflow: 'hidden', display: 'inline-block' }}><span style={{ display: 'block', width: p + '%', height: 5, background: '#94a3b8' }} /></span></> })()}</small></th>
          : <th key={k} style={{ width: k === 'grade' ? 170 : 230 }}>{colLabel(k)}</th>)}{!sel.length && <th><span className="cmphead">{adds}</span></th>}</tr></thead>
        <tbody>{!sel.length ? <tr><td colSpan={vis.length + 1} className="sub">Chọn trường ngay trên tiêu đề bảng để so sánh{pkg ? ` với ${pkgName(pkg)}` : ''}.</td></tr> : !lines.length ? <tr><td colSpan={vis.length || 1} className="sub">{!pkg && sel.length === 1 ? 'Bấm “+ Chọn gói” hoặc “+ Thêm trường” ở tiêu đề bảng để so sánh.' : only ? (pkg ? 'Các trường giống gói ở mọi khối.' : 'Các trường giống nhau ở mọi khối.') : 'Không có dữ liệu.'}</td></tr>
          : lines.map(renderLine)}</tbody>
      </table></FitScreen>
    </div>}
  </>
}

/** Chủ đề trường áp dụng ở một loại CT × khối (hoặc một học phần): cùng kiểu bảng như khi xem từ gói, thêm cột Áp dụng */
function ScopeView({ s, sl, track, modName, onTopic }: { s: ReturnType<typeof scopeAt>; sl?: number; track: string; modName: (id: string) => string; onTopic: (t: ProgramTopic) => void }) {
  const tag = (on: boolean) => on ? <span style={{ color: 'var(--ok, #15803d)', fontWeight: 600, whiteSpace: 'nowrap' }}>✓ Áp dụng</span> : <span style={{ color: 'var(--danger, #b42318)', fontWeight: 600, whiteSpace: 'nowrap' }}>✕ Không áp dụng</span>
  const tbl = (list: TopicState[]) => list.length
    ? <table className="table slt ttdense"><thead><tr><th className="c-no">TT</th><th>Chủ đề</th><th style={{ width: 70 }}>Số tiết</th><th>Môn chủ trì</th><th style={{ width: 150 }}>Áp dụng</th></tr></thead>
      <tbody>{list.map(({ topic, on }, k) => <tr key={topic.id} className="clickrow" onClick={() => onTopic(topic)} style={on ? undefined : { background: 'var(--soft, #f8fafc)' }}>
        <td style={on ? undefined : { color: 'var(--muted)' }}>{k + 1}</td>
        <td>{on ? <b>{topic.title}</b> : <span style={{ ...OFF, textDecorationColor: 'var(--danger, #b42318)' }}>{topic.title}</span>}</td>
        <td style={on ? undefined : { color: 'var(--muted)' }}>{topic.periods}</td><td style={on ? undefined : { color: 'var(--muted)' }}>{topic.main_subject || <small className="sub">—</small>}</td><td>{tag(on)}</td></tr>)}</tbody></table>
    : null
  const sum = (list: TopicState[]) => { const on = list.filter(x => x.on).length
    return <>{list.length} chủ đề · {list.reduce((x, y) => x + (y.topic.periods || 0), 0)} tiết{list.length ? <> · <b>trường áp dụng {on === list.length ? 'đủ' : `${on}/${list.length}`}</b></> : ''}</> }
  if (!s.mods) return s.topics.length
    ? <><p className="sub" style={{ marginTop: 0 }}>{sum(s.topics)} · bấm vào chủ đề để xem nội dung</p>{tbl(s.topics)}</>
    : <p className="sub">Có trong gói, khung chương trình chưa có chủ đề ở khối này.</p>
  const slots = s.slots.filter(x => !sl || x.slot === sl)
  const n1 = sl && slots[0] ? s.topics.filter(y => y.topic.module_id === slots[0].module_id) : []
  return <>{sl && slots[0] && <p className="sub" style={{ marginTop: 0 }}>{track}{n1.length ? <> · {sum(n1)}</> : null} ·{' '}
    {slots[0].on ? <b style={{ color: 'var(--ok, #15803d)' }}>trường áp dụng học phần này</b> : <b style={{ color: 'var(--danger, #b42318)' }}>trường không áp dụng học phần này</b>}</p>}
    {!sl && <p className="sub" style={{ marginTop: 0 }}>{sum(s.topics)} · bấm vào chủ đề để xem nội dung</p>}
    {slots.map(x => { const ts = s.topics.filter(y => y.topic.module_id === x.module_id)
      return <div key={x.slot} style={{ marginBottom: 14 }}>
        {!sl && <h4 className="pnhead" style={{ margin: '4px 0 6px' }}><span style={x.on ? undefined : OFF}>Học phần {x.slot}: {modName(x.module_id)}</span> · {tag(x.on)}</h4>}
        {tbl(ts) ?? <p className="sub" style={{ margin: 0 }}>Học phần chưa có chủ đề ở khối này.</p>}
      </div> })}</>
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
  const [exp, setExp] = useState<Set<string>>(new Set())   // khối đang mở danh sách chủ đề: `${loại}|${khối}`
  const eff = full ? NO_SKIP : skip   // Áp dụng đủ gói: hiện như tick hết
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const flip = (keys: string[], on: boolean) => setSkip(s => { const n = new Set(s); for (const k of keys) { if (on) n.delete(k); else n.add(k) } return n })
  // Khoá của mọi mục (học phần / chủ đề) ở loại t, khối gg — dùng cho ô "chọn cả khối"
  const keysAt = (t: StemTrack, gg: number) => { const s = scopeAt(ctx, pkg, t, gg, skip); return s.mods ? s.slots.map(x => keyM(t.code, gg, x.slot)) : [...s.slots.map(x => keyM(t.code, gg, x.slot)), ...s.topics.map(x => keyT(x.topic.id))] }
  // Chưa có chủ đề (VD CT4): tick theo cả khối (vị trí học phần)
  const onAt = (t: StemTrack, gg: number) => { const s = scopeAt(ctx, pkg, t, gg, eff); return s.mods || !s.topics.length ? [s.slots.filter(x => x.on).length, s.slots.length] : [s.topics.filter(x => x.on).length, s.topics.length] }
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
    {full && <p className="scopelock">🔒 Đang áp dụng đủ gói nên tất cả được chọn sẵn. Bấm số chủ đề để xem; muốn bỏ bớt, chọn "Chọn một phần".</p>}
    <>
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
            <legend>{tchip(t.code)} {t.name}</legend>
            {box(!!tot[1] && tot[0] === tot[1], v => flip(allKeys, v), <>{g ? unit : 'Chọn tất cả khối'} ({tot[0]}/{tot[1]})</>, true, 0, full || !tot[1])}
            {gs.map(gg => {
              const s = scopeAt(ctx, pkg, t, gg, eff)
              const [o, n] = onAt(t, gg)
              const ek = `${t.code}|${gg}`, isOpen = exp.has(ek)
              const tog = () => setExp(cur => { const x = new Set(cur); if (x.has(ek)) x.delete(ek); else x.add(ek); return x })
              const cnt = !s.mods && s.topics.length > 0
              const head = !g && <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                {box(!!n && o === n, v => flip(keysAt(t, gg), v), <><b>K{gg}</b>{(!s.slots.length || (!s.mods && !s.topics.length)) && <> <small className="sub">
                  {!s.slots.length ? 'không có trong gói' : 'chưa có chủ đề, tick theo cả khối'}</small></>}</>, false, 18, full || !n)}
                {cnt && <button type="button" className={'scopecnt' + (isOpen ? ' on' : '')} aria-expanded={isOpen} onClick={tog}
                  title={isOpen ? 'Đóng danh sách chủ đề' : full ? 'Xem chủ đề' : 'Chọn từng chủ đề'}>{o}/{n} chủ đề {isOpen ? '▴' : '▾'}</button>}</div>
              const ind = g ? 18 : 40
              const tlist = s.topics.map(x => <div key={x.topic.id}>{box(x.on, v => topicOn(t, gg, x.topic.id, v),
                <>{x.topic.seq}. {x.topic.title}</>, false, g ? ind : 0, full)}</div>)
              const list = s.mods
                ? s.slots.map(x => <div key={x.slot}>{box(x.on, v => flip([keyM(t.code, gg, x.slot)], v), <>HP{x.slot} {modName(x.module_id)}</>, false, ind, full)}</div>)
                : g ? tlist
                : isOpen && cnt ? <div className="scopepop"><div className="scopepoph"><span>Chủ đề K{gg} · {full ? 'chỉ xem' : 'tick là áp dụng'}</span>
                  {!full && <button type="button" className="linkbtn" onClick={() => flip(keysAt(t, gg), o !== n)}>{o === n ? 'Bỏ hết' : 'Chọn hết'}</button>}</div>{tlist}</div> : null
              return <div key={gg}>{head}{list}
                {g > 0 && !s.mods && !s.topics.length && (s.slots.length
                  ? box(o === n, v => flip(keysAt(t, gg), v), <>Cả khối <small className="sub">chưa có chủ đề trong khung</small></>, false, 18, full)
                  : <p className="sub" style={{ margin: '4px 0 0 18px' }}>Gói không có ở khối này</p>)}</div>
            })}
          </fieldset>
        })}
      </div>
      {!full && <small className="sub" style={{ display: 'block', marginTop: 8 }}>Bấm vào số chủ đề (VD "8/16 chủ đề") để tick từng chủ đề.</small>}
    </>
    {err && <p className="warnline">{err}</p>}
    <div className="actions" style={{ marginTop: 12 }}>
      <button className="primary" onClick={save} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      <button onClick={onCancel} disabled={busy}>Huỷ</button>
    </div>
  </section>
}
