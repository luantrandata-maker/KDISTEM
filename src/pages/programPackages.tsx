import React, { useEffect, useState } from 'react'
import { FitScreen } from '../components/FitScreen'
import { supabase } from '../lib/supabase'
import { useStemTracks, type StemTrack, trackLabel } from '../lib/stemTracks'
import { fmtGrades, gradeName } from '../lib/eduLevels'
import { frameErr, loadFrame, loadPackages, slotTopics, type PackageItem, type PackageSkip, type ProgramModule, type ProgramPackage, type ProgramTopic } from '../lib/programFrame'
import { PROGRAM_COLOR } from './teacher/common'
import { HeadAction } from '../components/PageFrame'
import { ColFilter } from '../components/DataTable'
import { DetailHead } from '../components/DetailHead'
import { ElView } from '../components/ElView'
import { ActionBar, type Act } from '../components/ActionBar'
import { RowMenu } from '../components/ProTools'
import { Chip } from './dist/Editor'
import { MultiSelect } from '../components/MultiSelect'
import { Drawer } from '../components/Drawer'
import { TopicContents } from './topicContents'

// Gói STEM theo khung chương trình (148): mỗi gói gồm các loại chương trình; mỗi loại, mỗi khối chọn học phần ở từng vị trí
// (Học phần 1, Học phần 2…). Xem một gói, so sánh các gói (tô màu chỗ khác nhau). Chỉ KDI sửa.

const GRADES = Array.from({ length: 12 }, (_, i) => i + 1)
const chip = (code: string) => <span className="progchip" style={{ background: PROGRAM_COLOR[code], color: '#fff' }}>{trackLabel(code)}</span>
const DIFF = { background: '#dbeafe' }
// Màu từng gói, giống thẻ gói ở trang Gói STEM (xanh dương, tím, cam, đỏ)
const PKG_C = ['#2563eb', '#9333ea', '#ea580c', '#e11d48']
const pkgTh = (k: number) => ({ background: PKG_C[k % PKG_C.length], color: '#fff' })
const pkgTd = (k: number) => ({ background: `color-mix(in srgb, ${PKG_C[k % PKG_C.length]} 7%, transparent)` })
const keyOf = (t: string, g: number, s: number) => `${t}|${g}|${s}`
const MAXN = 4   // số học phần hiện sẵn trong một ô, còn lại bấm để mở

export function ProgramPackages() {
  const { tracks } = useStemTracks()
  const active = tracks.filter(t => t.active !== false)
  const [admin, setAdmin] = useState(false)
  const [packages, setPackages] = useState<ProgramPackage[]>([])
  const [items, setItems] = useState<PackageItem[]>([])
  const [skips, setSkips] = useState<PackageSkip[]>([])
  const [modules, setModules] = useState<ProgramModule[]>([])
  const [topics, setTopics] = useState<ProgramTopic[]>([])
  const [msg, setMsg] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [compare, setCompare] = useState(false)
  // Lọc theo cấp / khối, dùng chung cho Tổng quan gói và So sánh (tư vấn cho từng trường, trường liên cấp chọn nhiều cấp)
  const [lvs, setLvs] = useState<string[]>([])
  const [fGrade, setFGrade] = useState<number | null>(null)
  const sel = lvs.length ? LEVELS.filter(l => lvs.includes(l.k)) : [...LEVELS]
  const selGrades: number[] = fGrade ? [fGrade] : sel.flatMap(l => [...l.grades])
  const fName = fGrade ? gradeName(fGrade) : lvs.length ? sel.map(l => l.name).join(' + ') : 'Cả 12 khối'
  const filterBar = <LevelFilter lvs={lvs} grade={fGrade} onLevels={v => { setLvs(v); setFGrade(null) }} onGrade={setFGrade} />
  const [openRows, setOpenRows] = useState<string[]>([])   // hàng chương trình đang mở hết danh sách học phần
  const [editPkg, setEditPkg] = useState<(ProgramPackage & { copyFrom?: string; tab?: string }) | null>(null)
  const reload = () => Promise.all([loadPackages(), loadFrame()]).then(([p, f]) => {
    setPackages(p.packages); setItems(p.items); setSkips(p.skips); setModules(f.modules); setTopics(f.topics); setMsg(p.error || f.error)
  })
  useEffect(() => { supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data)); reload() }, [])

  const modName = (id: string) => modules.find(m => m.id === id)?.name ?? '?'
  const cell = (pkg: string, t: string, g: number, s: number) => items.find(i => i.package_id === pkg && i.track_code === t && i.grade === g && i.slot === s)
  // Vị trí (cột) có giá trị ở loại chương trình t, trong các gói đang xét
  const slotsOf = (t: string, pkgs: string[]) => {
    // Loại chia học phần luôn để sẵn 2 cột học phần (HP1, HP2)
    const n = Math.max(active.find(x => x.code === t)?.use_modules === false ? 0 : 2, ...items.filter(i => i.track_code === t && pkgs.includes(i.package_id)).map(i => i.slot))
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
    title={editPkg.id ? `Sửa gói · ${editPkg.name}` : editPkg.copyFrom ? 'Sao chép gói STEM' : 'Thêm gói STEM'}>
    <PackageForm p={editPkg} tracks={active} items={items} skips={skips} modules={modules} topics={topics} onCancel={() => setEditPkg(null)} onSaved={id => { setEditPkg(null); if (id) setOpenId(id); reload() }} />
  </ElView>

  if (compare) return <>
    <DetailHead back="Gói STEM" onBack={() => setCompare(false)} title="So sánh các gói STEM" />
    {msg && <p className="msg" role="status">{msg}</p>}
    <CompareView tracks={active} packages={live} items={items} topics={topics} skips={skips} modName={modName} grades={selGrades} levels={fGrade ? [] : sel} name={fName} filter={filterBar} />
  </>

  const cur = openId ? packages.find(p => p.id === openId) : undefined
  const topicsOfItem = (i: PackageItem) => slotTopics(topics, items, i)
  const statOf = (pkg: string, t?: string) => {
    const its = items.filter(i => i.package_id === pkg && (!t || i.track_code === t) && selGrades.includes(i.grade))
    return { its, mods: [...new Set(its.map(i => i.module_id))], topics: its.reduce((x, i) => x + topicsOfItem(i).length, 0),
      tracks: [...new Set(its.map(i => i.track_code))] }
  }
  const pkgMenu = (p: ProgramPackage) => [
    { label: 'Xem chi tiết', onClick: () => { setMsg(''); setOpenId(p.id) } }, { label: 'Sửa gói', onClick: () => setEditPkg(p) },
    { label: 'Sao chép thành gói mới', onClick: () => setEditPkg({ ...p, id: '', code: '', name: p.name + ' (bản sao)', sort: p.sort + 1, copyFrom: p.id }) },
    { label: 'Xoá', danger: true, onClick: () => delPkg(p) }]

  if (cur) return <PackageDetail pkg={cur} others={packages.filter(p => p.id !== cur.id)} tracks={active} admin={admin} items={items} modules={modules} topics={topics} msg={msg} setMsg={setMsg}
    diffKeys={diffKeys} diffTracks={diffTracks(cur.id)} slotsOf={slotsOf} topicsOfItem={topicsOfItem} onBack={() => { setOpenId(null); setMsg('') }}
    acts={admin ? pkgMenu(cur).slice(1).map((a, k) => ({ key: String(k), label: a.label, kind: a.danger ? 'danger' : undefined, onClick: a.onClick } as Act)) : []}
    onChanged={reload} filter={filterBar} onLevel={k => { setLvs([k]); setFGrade(null) }} inGrades={selGrades} onEdit={tab => setEditPkg({ ...cur, tab })} />

  const n = packages.length
  const cellS = { padding: '10px 12px', borderTop: '1px solid var(--line)', borderLeft: '1px solid var(--line)', minWidth: 0 } as const
  const labelS = { ...cellS, borderLeft: 0, background: 'color-mix(in srgb, var(--muted, #64748b) 14%, var(--card, #fff))' } as const
  const DIFFC = { background: '#dbeafe', boxShadow: 'inset 3px 0 0 #93c5fd' }
  const perGrade = (list: ProgramTopic[]) => { const g = new Set(list.map(t => t.grade)); return g.size ? Math.round(list.length / g.size) : 0 }
  return <>
    <HeadAction>
      <button type="button" onClick={() => setCompare(true)} disabled={live.length < 2}>So sánh các gói</button>
      {admin && <button type="button" className="primary ttadd" onClick={() => setEditPkg({ id: '', code: '', name: '', description: '', sort: packages.reduce((x, p) => Math.max(x, p.sort), 0) + 1, active: true })}>+ Thêm gói</button>}
    </HeadAction>
    {msg && <p className="msg" role="status">{msg}</p>}
    {filterBar}
    {!n ? <p className="sub">Chưa có gói STEM.</p> :
    <FitScreen><div className="panel pkgover" style={{ padding: 0, margin: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: `220px repeat(${n}, minmax(200px, 1fr))` }}>
        {/* Hàng 1: tên gói và số liệu */}
        <div className="pkgstick" style={{ ...labelS, borderTop: 0, display: 'flex', alignItems: 'flex-end' }}><b>Loại chương trình (CT)</b></div>
        {packages.map((p, k) => { const st = statOf(p.id); return <div key={p.id} className={'pkghead pkgopen ' + (['basic', 'advanced', 'premium'][k % 3])} role="button" tabIndex={0}
          title="Bấm để xem chi tiết gói" onClick={() => { setMsg(''); setOpenId(p.id) }} onKeyDown={e => { if (e.key === 'Enter') { setMsg(''); setOpenId(p.id) } }}
          style={{ padding: '12px', color: '#fff', display: 'grid', gap: 4, alignContent: 'start', cursor: 'pointer', borderLeft: '1px solid rgba(255,255,255,.25)', ...(k % 3 === 0 && k ? { filter: 'hue-rotate(140deg)' } : {}) }}>
          <div className="bar" style={{ margin: 0, gap: 6 }}><b style={{ fontSize: '1.15em' }}>{p.name} ›</b>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
              <span className={'pill ' + (p.active ? 'active' : 'inactive')}>{p.active ? 'Đang dùng' : 'Ngừng dùng'}</span>
              {admin && <RowMenu items={pkgMenu(p).slice(1)} label={p.name} />}</span></div>
          <small title={p.description} style={{ color: '#fff', opacity: .92, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.35 }}>{p.description || 'Chưa có mô tả.'}</small>
          <div className="pkgnums sm"><div><b>{st.tracks.length}</b><small><span className="full">chương trình</span><span className="short">CT</span></small></div><div><b>{st.mods.length}</b><small>học phần</small></div><div><b>{st.topics}</b><small>chủ đề</small></div></div>
        </div> })}
        {/* Mỗi loại chương trình một hàng */}
        {active.map(t => [
          <div key={t.code} style={{ ...labelS, boxShadow: `inset 4px 0 0 ${PROGRAM_COLOR[t.code] ?? 'var(--line)'}`, paddingLeft: 16 }}>{chip(t.code)}<br /><b>{t.name}</b><br /><small className="sub" style={{ color: 'var(--text, #0f172a)', opacity: .75 }}>{t.use_modules === false ? 'Chỉ có chủ đề theo khối' : 'Chia theo học phần'}</small></div>,
          ...packages.map(p => {
            const x = statOf(p.id, t.code)
            const diff = diffTracks(p.id).includes(t.code)
            const tl = x.its.flatMap(i => topicsOfItem(i))
            const gs = [...new Set(x.its.map(i => i.grade))].sort((a, b) => a - b)
            return <div key={t.code + p.id} style={{ ...cellS, ...(diff ? DIFFC : {}) }}>
              {!x.its.length ? <small className="sub">Không có trong gói</small>
                : t.use_modules === false ? <><b>{x.topics} chủ đề · <span style={{ whiteSpace: 'nowrap' }}>{fmtGrades(gs)}</span></b>{perGrade(tl) > 0 && <><br /><small className="sub">{perGrade(tl)} chủ đề / khối</small></>}</>
                : <><b>{x.mods.length === 1 ? '1 học phần' : `${x.mods.length} học phần khác nhau`}{x.topics ? ` (${x.topics} chủ đề)` : ''} · <span style={{ whiteSpace: 'nowrap' }}>{fmtGrades(gs)}</span></b>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>{(openRows.includes(t.code) ? x.mods : x.mods.slice(0, MAXN)).map(id => <li key={id}><small>{modName(id)}</small></li>)}</ul>
                  {x.mods.length > MAXN && <button type="button" className="namelink" style={{ fontSize: 12, marginTop: 4, color: "var(--primary)" }} onClick={() => setOpenRows(openRows.includes(t.code) ? openRows.filter(c => c !== t.code) : [...openRows, t.code])}>
                    {openRows.includes(t.code) ? 'Thu gọn' : `+ ${x.mods.length - MAXN} học phần`}</button>}</>}
            </div>
          })])}
      </div>
    </div></FitScreen>}
    <p className="sub" style={{ margin: '10px 0 0', fontSize: 13 }}>Cấu trúc: <b>Gói STEM</b> › <b>Loại chương trình</b> › <b>Học phần</b> (theo khối) › <b>Chủ đề</b>.
      {diffKeys.size ? ` Các gói có cùng nội dung, chỉ khác nhau ở ${[...new Set([...diffKeys].map(k => trackLabel(k.split('|')[0])))].join(', ')}; ô nền xanh nhạt là phần khác biệt giữa các gói.` : ''}</p>
    <p className="tablenote sub">Mỗi cột là một gói, mỗi hàng là một loại chương trình. Bấm vào tên gói để xem học phần, chủ đề theo từng khối.</p>
  </>
}

function PackageDetail({ pkg, onEdit, others, tracks, admin, items, modules, topics, msg, setMsg, diffKeys, diffTracks, slotsOf, topicsOfItem, onBack, acts, onChanged, filter, onLevel, inGrades }: {
  pkg: ProgramPackage; onEdit: (tab?: string) => void; others: ProgramPackage[]; tracks: StemTrack[]; admin: boolean; items: PackageItem[]; modules: ProgramModule[]; topics: ProgramTopic[]
  msg: string; setMsg: (m: string) => void; diffKeys: Set<string>; diffTracks: string[]; slotsOf: (t: string, pkgs: string[]) => number[]
  topicsOfItem: (i: PackageItem) => ProgramTopic[]; onBack: () => void; acts: Act[]; onChanged: () => void
  filter: React.ReactNode; onLevel: (k: string) => void; inGrades: number[]   // bộ lọc cấp / khối giữ nguyên từ trang Gói STEM
}) {
  const mine = items.filter(i => i.package_id === pkg.id && inGrades.includes(i.grade))
  const [code, setCode] = useState('')   // '' = xem tổng quan mọi loại chương trình
  const [sel, setSel] = useState<{ t: string; g: number; sl: number } | null>(null)
  const [openTopic, setOpenTopic] = useState<ProgramTopic | null>(null)
  const [gsel, setGsel] = useState<number | null>(null)   // dạng bảng: bấm khối xem mọi chủ đề của khối
  const [edit, setEdit] = useState(false)
  const [grade, setGrade] = useState<number | null>(null)
  const [flatPick, setFlatPick] = useState<StemTrack | null>(null)   // chọn khối cho loại chỉ có chủ đề (KDI1, KDI4)
  const [copySrc, setCopySrc] = useState('')
  const [tf, setTf] = useState<string[]>([])   // lọc loại CT ở Tổng quan (rỗng = tất cả)
  const tl = (t: StemTrack) => `${trackLabel(t.code)} · ${t.name}`
  const [pv, setPvS] = useState<'grid' | 'table'>(() => { try { return localStorage.getItem('pkg-view') === 'table' ? 'table' : 'grid' } catch { return 'grid' } })
  const setPv = (v: 'grid' | 'table') => { setSel(null); setGsel(null); setPvS(v); try { localStorage.setItem('pkg-view', v) } catch { /* bỏ qua */ } }
  const track = tracks.find(t => t.code === code)
  const its = mine.filter(i => i.track_code === track?.code)
  const grades = [...new Set(its.map(i => i.grade))].sort((a, b) => a - b)
  const mod = (id: string) => modules.find(m => m.id === id)
  const nTopics = (list: PackageItem[]) => list.reduce((x, i) => x + topicsOfItem(i).length, 0)
  const periods = (i: PackageItem) => mod(i.module_id)?.periods ?? topicsOfItem(i).reduce((x, t) => x + (t.periods || 0), 0)
  const allGrades = [...new Set(mine.map(i => i.grade))].sort((a, b) => a - b)
  const selTrack = sel ? tracks.find(t => t.code === sel.t) : undefined
  const selIts = sel ? mine.filter(i => i.track_code === sel.t && i.grade === sel.g && (sel.sl === 0 || i.slot === sel.sl)).sort((a, b) => a.slot - b.slot) : []
  const addTrack = (t: StemTrack) => { setSel(null); onEdit(t.code) }
  async function copyFrom() {
    if (!copySrc || !confirm('Chép toàn bộ học phần, chủ đề của gói đã chọn vào gói này?')) return
    const { data: src, error } = await supabase.from('program_package_items').select('track_code, grade, slot, module_id, note').eq('package_id', copySrc)
    if (error) return setMsg(frameErr(error.message + ' ' + (error.code ?? '')))
    if (!src?.length) return setMsg('Gói đã chọn chưa có học phần.')
    const r = await supabase.from('program_package_items').upsert(src.map(x => ({ ...x, package_id: pkg.id })))
    if (r.error) return setMsg(frameErr(r.error.message + ' ' + (r.error.code ?? '')))
    const sk = await supabase.from('program_package_topic_skips').select('topic_id').eq('package_id', copySrc)
    if (sk.data?.length) {
      const r2 = await supabase.from('program_package_topic_skips').upsert(sk.data.map(x => ({ package_id: pkg.id, topic_id: x.topic_id })))
      if (r2.error) return setMsg(frameErr(r2.error.message + ' ' + (r2.error.code ?? '')))
    }
    setMsg(''); onChanged()
  }
  const empty = !items.some(i => i.package_id === pkg.id)
  const guide = <div className="pkgguide">
    <b>Gói chưa có nội dung. Cách thêm:</b>
    <ol><li>Chủ đề, học phần soạn ở tab <b>Khung chương trình</b> (đã có thì bỏ qua).</li>
      <li>Bấm <b>Thêm vào gói</b> ở loại chương trình cần dùng, chọn khối và học phần.</li>
      <li>Hoặc nhanh hơn: <b>Sao chép từ gói khác</b> rồi sửa lại.</li></ol>
    <div className="pkgguidecards">{tracks.map(t => <div key={t.code} className="panel" style={{ margin: 0, borderTop: `3px solid ${PROGRAM_COLOR[t.code] ?? 'var(--line)'}` }}>
      {chip(t.code)} <b>{t.name}</b><div className="sub">{t.use_modules === false ? 'Chỉ có chủ đề · tick khối' : 'Chọn học phần theo khối'}</div>
      {admin && <button type="button" style={{ marginTop: 8 }} onClick={() => addTrack(t)}>+ Thêm vào gói</button>}</div>)}</div>
    {admin && others.length > 0 && <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
      <select value={copySrc} onChange={e => setCopySrc(e.target.value)} aria-label="Gói nguồn"><option value="">Sao chép từ gói khác…</option>
        {others.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
      <button type="button" disabled={!copySrc} onClick={copyFrom}>Sao chép</button></div>}
  </div>
  const Overview = () => empty ? guide : !allGrades.length ? <p className="sub">Gói chưa có học phần ở khối đang lọc.</p> : <>
    <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
      <div className="pkggrid" style={{ gridTemplateColumns: `180px 128px repeat(${allGrades.length}, minmax(92px, 1fr))` }}>
        <div className="hd lb"><b>Loại chương trình (CT)</b></div><div className="hd">Học phần / Chủ đề</div>
        {allGrades.map(g => <div key={g} className="hd">{gradeName(g)}</div>)}
        {tracks.filter(t => !tf.length || tf.includes(t.code)).map((t, ti) => { const c = PROGRAM_COLOR[t.code] ?? 'var(--line)'
          const band = ti % 2 ? ' alt' : ''
          const slots = t.use_modules === false ? [0] : slotsOf(t.code, [pkg.id])
          // Loại CT chưa có trong gói: một ô trải hết các khối, có nút thêm ngay tại đây
          if (!mine.some(i => i.track_code === t.code)) return [
            <div key={t.code} className={'lb grp' + band} style={{ boxShadow: `inset 4px 0 0 ${c}` }}>{chip(t.code)}<b>{t.name}</b></div>,
            <div key={t.code + '-none'} className={'hpl grp' + band} style={{ gridColumn: `span ${allGrades.length + 1}`, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="sub">Chưa có trong gói{inGrades.length < 12 ? ' (ở khối đang lọc)' : ''}</span>
              {admin && <button type="button" onClick={() => addTrack(t)}>+ Thêm vào gói</button>}</div>]
          return [
          <div key={t.code} className={'lb grp' + band} style={{ boxShadow: `inset 4px 0 0 ${c}`, gridRow: `span ${slots.length || 1}` }}>
            {chip(t.code)}<b>{t.name}</b></div>,
          ...slots.flatMap(sl => [<div key={t.code + sl + '-hp'} className={'hpl' + band + (sl === slots[0] ? ' grp' : '')}>{sl === 0 ? 'Chủ đề' : 'HP' + sl}</div>, ...allGrades.map(g => {
            const list = mine.filter(i => i.track_code === t.code && i.grade === g && (sl === 0 || i.slot === sl))
            const on = sel?.t === t.code && sel.g === g && sel.sl === sl
            return <button key={t.code + sl + '-' + g} type="button" className={'gc' + band + (sl === slots[0] ? ' grp' : '') + (on ? ' on' : '')} aria-pressed={on} disabled={!list.length}
              title={`${trackLabel(t.code)} · ${gradeName(g)}: bấm để xem chủ đề`} onClick={() => { setOpenTopic(null); setSel(on ? null : { t: t.code, g, sl }) }}>
              {!list.length ? <span className="sub">—</span>
                : sl === 0 ? <span className="num" title="Số chủ đề"><b>{nTopics(list)}</b></span>
                : <span className="hp">{mod(list[0].module_id)?.name ?? '?'}</span>}
            </button>
          })])] })}
      </div>
    </div>
  </>
  // Dạng bảng: phân bổ chương trình như sheet PhanBoCT, gộp một bảng (hàng = khối theo cấp, nhóm cột = loại CT)
  const PhanBo = () => { const ts = tracks.filter(t => !tf.length || tf.includes(t.code))
    const cols = ts.map(t => ({ t, slots: t.use_modules === false ? [0] : slotsOf(t.code, [pkg.id]), has: mine.some(i => i.track_code === t.code) }))
    const lvls = LEVELS.map(l => ({ ...l, gs: allGrades.filter(g => (l.grades as readonly number[]).includes(g)) })).filter(l => l.gs.length)
    if (!allGrades.length) return <p className="sub">Gói chưa có học phần ở khối đang lọc.</p>
    return <div className="panel pkgpb" style={{ padding: 0, overflowX: 'auto' }}><table>
      <thead><tr><th rowSpan={2}>Cấp</th><th rowSpan={2}>Khối / lớp</th>
        {cols.map(c => <th key={c.t.code} colSpan={c.slots.length} style={{ borderTop: `3px solid ${PROGRAM_COLOR[c.t.code] ?? 'var(--line)'}` }}>{chip(c.t.code)} {c.t.name}</th>)}</tr>
        <tr>{cols.flatMap(c => c.slots.map(sl => <th key={c.t.code + sl}>{sl === 0 ? 'Số chủ đề' : 'Học phần ' + sl}</th>))}</tr></thead>
      <tbody>{lvls.flatMap(l => l.gs.map((g, gi) => <tr key={g} className={gi === l.gs.length - 1 ? 'pblast' : undefined}>
        {gi === 0 && <td rowSpan={l.gs.length} className="pblv pbcell" role="button" tabIndex={0} title={`Chỉ xem ${l.name}`}
          onClick={() => { setSel(null); setGsel(null); onLevel(l.k) }} onKeyDown={e => { if (e.key === 'Enter') onLevel(l.k) }}>{l.name}</td>}
        <td className={'pbcell' + (gsel === g ? ' on' : '')} role="button" tabIndex={0} title={`Xem mọi chủ đề ${gradeName(g)}`}
          onClick={() => { setSel(null); setOpenTopic(null); setGsel(g) }} onKeyDown={e => { if (e.key === 'Enter') { setSel(null); setOpenTopic(null); setGsel(g) } }}><b>{gradeName(g)}</b></td>
        {cols.flatMap(c => c.slots.map(sl => {
          const list = mine.filter(i => i.track_code === c.t.code && i.grade === g && (sl === 0 || i.slot === sl))
          const on = sel?.t === c.t.code && sel.g === g && sel.sl === sl
          if (!list.length) return <td key={c.t.code + sl} className="pbnum"><span className="sub">—</span></td>
          return <td key={c.t.code + sl} className={(sl === 0 ? 'pbnum' : 'pbmod') + ' pbcell' + (on ? ' on' : '')} role="button" tabIndex={0}
            title={`${trackLabel(c.t.code)} · ${gradeName(g)}: bấm để xem chủ đề`} style={{ '--k': PROGRAM_COLOR[c.t.code] ?? 'var(--line)' } as React.CSSProperties}
            onClick={() => { setGsel(null); setOpenTopic(null); setSel(on ? null : { t: c.t.code, g, sl }) }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenTopic(null); setSel(on ? null : { t: c.t.code, g, sl }) } }}>
            {sl === 0 ? <><b>{nTopics(list)}</b> <small className="sub">chủ đề</small></> : mod(list[0].module_id)?.name ?? '?'}</td>
        }))}</tr>))}</tbody></table></div>
  }
  return <>
    <DetailHead back="Gói STEM" onBack={onBack} title={pkg.name}
      extra={<Chip tone={pkg.active ? 'good' : ''}>{pkg.active ? 'Đang dùng' : 'Ngừng dùng'}</Chip>} />
    <div className="bar"><small className="sub">{pkg.description || 'Chưa có mô tả.'}</small>
      {acts.length > 0 && <div className="tools"><ActionBar items={acts} /></div>}</div>
    {msg && <p className="msg" role="status">{msg}</p>}
    <div className="pkgkpi">
      {tracks.map(t => { const x = mine.filter(i => i.track_code === t.code); const on = tf.length === 1 && tf[0] === t.code
        return <div key={t.code} role="button" tabIndex={0} className={'kpibtn' + (on ? ' on' : '')} title="Bấm để chỉ xem loại này"
          onClick={() => { setSel(null); setEdit(false); setCode(''); setTf(on ? [] : [t.code]) }} style={{ '--k': PROGRAM_COLOR[t.code] ?? 'var(--line)', borderTop: `3px solid ${PROGRAM_COLOR[t.code] ?? 'var(--line)'}` } as React.CSSProperties}>
          <span className="ic" style={{ fontSize: 12, fontWeight: 700 }}>{trackLabel(t.code)}</span>
          <div><span>{t.name}</span><small>{t.use_modules === false ? '' : new Set(x.map(i => i.module_id)).size + ' học phần · '}{nTopics(x)} chủ đề</small></div></div> })}
    </div>
    {!edit && React.isValidElement(filter) ? React.cloneElement(filter as React.ReactElement<{ extra?: React.ReactNode }>, { extra: <span style={{ display: 'inline-flex', gap: 14, alignItems: 'center' }}>
      <span className="lvgrp"><span className="lvlab">Loại CT</span><ColFilter pin label={tf.length ? tf.map(trackLabel).join(', ') : 'Tất cả'} value={tracks.filter(t => tf.includes(t.code)).map(tl)}
        options={tracks.map(t => [tl(t), nTopics(mine.filter(i => i.track_code === t.code))] as [string, number])}
        onChange={v => { setSel(null); setTf(tracks.filter(t => v.includes(tl(t))).map(t => t.code)) }} /></span>
      <div className="seg frmode" role="group" aria-label="Kiểu xem">
        <button type="button" className={pv === 'grid' ? 'on' : ''} aria-pressed={pv === 'grid'} onClick={() => setPv('grid')}>▦ Tổng quan</button>
        <button type="button" className={pv === 'table' ? 'on' : ''} aria-pressed={pv === 'table'} onClick={() => setPv('table')}>☰ Dạng bảng</button></div>
      </span> }) : filter}
    {track && edit
      ? <TrackGrid pkg={pkg} track={track} admin={admin} items={items} modules={modules.filter(m => m.track_code === track.code)} topics={topics}
        slots={slotsOf(track.code, [pkg.id])} diffKeys={new Set<string>()} onChanged={onChanged} onErr={setMsg} startEdit onDone={() => { setEdit(false); setCode('') }} />
      : pv === 'grid' || empty ? <Overview />
      : <PhanBo />}
    {sel && selTrack && <Drawer closeOnOutside onClose={() => { setSel(null); setOpenTopic(null) }} onBack={openTopic ? () => setOpenTopic(null) : undefined}
      title={openTopic ? <>{chip(selTrack.code)} {openTopic.title}</> : <>{chip(selTrack.code)} {selTrack.name} · {gradeName(sel.g)}{sel.sl > 0 && selIts[0] ? ` · HP${sel.sl}` : ''}</>}>
      {openTopic ? <TopicView t={openTopic} admin={admin} mod={selTrack.use_modules === false ? undefined : mod(openTopic.module_id)?.name} sgk={selTrack.schedule_mode === 'subject'} />
        : <>{(() => { const all = selIts.flatMap(i => topicsOfItem(i)); return <p className="sub" style={{ marginTop: 0 }}>{all.length} chủ đề · {all.reduce((x, t) => x + (t.periods || 0), 0)} tiết · bấm vào chủ đề để xem nội dung</p> })()}
          {selIts.map(i => { const list = topicsOfItem(i); return <div key={i.slot} style={{ marginBottom: 14 }}>
            {selTrack.use_modules !== false && <h4 className="pnhead" style={{ margin: '4px 0 6px' }}>Học phần {i.slot}: {mod(i.module_id)?.name ?? '?'} <small className="sub">· {list.length} chủ đề · {periods(i) || '—'} tiết</small></h4>}
            {list.length ? <table className="table slt ttdense"><thead><tr><th className="c-no">TT</th><th>Chủ đề</th><th style={{ width: 70 }}>Số tiết</th><th>Môn chủ trì</th></tr></thead>
              <tbody>{list.map((t, k) => <tr key={t.id} className="clickrow" onClick={() => setOpenTopic(t)}><td>{k + 1}</td><td><b>{t.title}</b></td><td>{t.periods}</td><td>{t.main_subject || <small className="sub">—</small>}</td></tr>)}</tbody></table>
              : <p className="sub">Học phần chưa có chủ đề.</p>}
          </div> })}</>}
    </Drawer>}
    {gsel != null && (() => { const ts = tracks.filter(t => (!tf.length || tf.includes(t.code)) && mine.some(i => i.track_code === t.code && i.grade === gsel))
      const ot = openTopic && ts.find(t => mine.some(i => i.track_code === t.code && i.grade === gsel && topicsOfItem(i).some(x => x.id === openTopic.id)))
      const all = ts.flatMap(t => mine.filter(i => i.track_code === t.code && i.grade === gsel).flatMap(i => topicsOfItem(i)))
      return <Drawer closeOnOutside onClose={() => { setGsel(null); setOpenTopic(null) }} onBack={openTopic ? () => setOpenTopic(null) : undefined}
        title={openTopic && ot ? <>{chip(ot.code)} {openTopic.title}</> : <>{gradeName(gsel)} · mọi chủ đề trong gói</>}>
        {openTopic && ot ? <TopicView t={openTopic} admin={admin} mod={ot.use_modules === false ? undefined : mod(openTopic.module_id)?.name} sgk={ot.schedule_mode === 'subject'} />
          : <><p className="sub" style={{ marginTop: 0 }}>{all.length} chủ đề · {all.reduce((x, t) => x + (t.periods || 0), 0)} tiết · bấm vào chủ đề để xem nội dung</p>
            {ts.map(t => <div key={t.code} style={{ marginBottom: 16 }}>
              <h4 className="pnhead" style={{ margin: '4px 0 6px' }}>{chip(t.code)} {t.name}</h4>
              {mine.filter(i => i.track_code === t.code && i.grade === gsel).sort((a, b) => a.slot - b.slot).map(i => { const list = topicsOfItem(i); return <div key={i.slot} style={{ marginBottom: 8 }}>
                {t.use_modules !== false && <div className="sub" style={{ margin: '2px 0 4px' }}>Học phần {i.slot}: <b>{mod(i.module_id)?.name ?? '?'}</b> · {list.length} chủ đề</div>}
                {list.length ? <table className="table slt ttdense"><thead><tr><th className="c-no">TT</th><th>Chủ đề</th><th style={{ width: 70 }}>Số tiết</th></tr></thead>
                  <tbody>{list.map((x, k) => <tr key={x.id} className="clickrow" onClick={() => setOpenTopic(x)}><td>{k + 1}</td><td><b>{x.title}</b></td><td>{x.periods}</td></tr>)}</tbody></table>
                  : <p className="sub">Chưa có chủ đề.</p>}</div> })}</div>)}</>}
      </Drawer> })()}
    {flatPick && <Drawer onClose={() => setFlatPick(null)} title={<>{chip(flatPick.code)} {flatPick.name} · chọn khối</>}>
      <FlatGrades pkg={pkg} track={flatPick} items={items} modules={modules} topics={topics} onChanged={onChanged} onErr={setMsg} />
    </Drawer>}
    {!edit && <p className="sub" style={{ margin: '10px 0 0', fontSize: 13 }}>{pv === 'table' ? 'Mỗi hàng là một khối, mỗi nhóm cột là một loại chương trình. Bấm một ô để xem chủ đề; bấm tên khối để xem mọi chủ đề của khối; bấm tên cấp để chỉ xem cấp đó.' : 'Mỗi cột là một khối, mỗi hàng là một loại chương trình. Bấm vào một ô để xem chủ đề.'} Chủ đề soạn ở tab "Khung chương trình".</p>}
  </>
}

/** Danh sách chủ đề gọn trong một ô: hiện `max` chủ đề đầu, bấm để mở hết */
function TopicChips({ list, max }: { list: ProgramTopic[]; max: number }) {
  const [open, setOpen] = useState(false)
  if (!list.length) return <div><small className="sub">Chưa có chủ đề</small></div>
  const shown = open ? list : list.slice(0, max)
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
    {shown.map((t, k) => <span key={t.id} className="distchip2" title={`${t.title} · ${t.periods} tiết`}>{k + 1}. {t.title}</span>)}
    {list.length > max && <button type="button" className="namelink" style={{ fontSize: 12, color: "var(--primary)" }} onClick={() => setOpen(!open)}>{open ? 'Thu gọn' : `+ ${list.length - max} chủ đề`}</button>}
  </div>
}

/** Loại chỉ có chủ đề (KDI1, KDI4): tick khối đưa vào gói; chủ đề lấy theo khung chương trình của khối đó */
function FlatGrades({ pkg, track, items, modules, topics, onChanged, onErr }: {
  pkg: ProgramPackage; track: StemTrack; items: PackageItem[]; modules: ProgramModule[]; topics: ProgramTopic[]; onChanged: () => void; onErr: (m: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const mod = modules.filter(m => m.track_code === track.code).sort((a, b) => a.sort - b.sort)[0]
  const ts = topics.filter(t => t.module_id === mod?.id && t.active !== false)
  const gs = [...new Set(ts.map(t => t.grade))].sort((a, b) => a - b)
  const has = (g: number) => items.some(i => i.package_id === pkg.id && i.track_code === track.code && i.grade === g)
  async function flip(g: number) {
    if (!mod) return
    setBusy(true)
    const q = has(g)
      ? supabase.from('program_package_items').delete().match({ package_id: pkg.id, track_code: track.code, grade: g }).select('grade')
      : supabase.from('program_package_items').upsert({ package_id: pkg.id, track_code: track.code, grade: g, slot: 1, module_id: mod.id }).select('grade')
    const { data, error } = await q
    setBusy(false)
    if (error) return onErr(frameErr(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return onErr(frameErr('row-level'))
    onErr(''); onChanged()
  }
  if (!gs.length) return <p className="sub">Khung chương trình chưa có chủ đề nào của {trackLabel(track.code)}. Soạn chủ đề ở tab "Khung chương trình" trước.</p>
  return <>
    <p className="sub" style={{ marginTop: 0 }}>Tick khối để đưa vào gói. Chủ đề của khối lấy theo Khung chương trình.</p>
    <table className="table slt ttdense" style={{ width: '100%' }}><thead><tr><th style={{ width: 40 }} /><th>Khối</th><th>Số chủ đề</th><th>Số tiết</th></tr></thead>
      <tbody>{gs.map(g => { const l = ts.filter(t => t.grade === g)
        return <tr key={g} className="clickrow" onClick={() => !busy && flip(g)}><td><input type="checkbox" checked={has(g)} disabled={busy} readOnly aria-label={gradeName(g)} /></td>
          <td>{gradeName(g)}</td><td>{l.length}</td><td>{l.reduce((x, t) => x + (t.periods || 0), 0)}</td></tr> })}</tbody></table>
  </>
}

function TrackGrid({ pkg, track, admin, items, modules, topics, slots, diffKeys, onChanged, onErr, startEdit, onDone }: {
  pkg: ProgramPackage; track: StemTrack; admin: boolean; items: PackageItem[]; modules: ProgramModule[]; topics: ProgramTopic[]; slots: number[]
  diffKeys: Set<string>; onChanged: () => void; onErr: (m: string) => void; startEdit?: boolean; onDone?: () => void
}) {
  const [edit, setEdit] = useState(!!startEdit)
  const [extra, setExtra] = useState(0)
  const [open, setOpen] = useState<string | null>(null)   // "khối|vị trí" đang mở danh sách chủ đề
  const itemTopics = (it: PackageItem | undefined) => slotTopics(topics, items, it)
  const periodsOf = (it: PackageItem | undefined) => {
    const m = name(it?.module_id)
    if (!m) return 0
    return m.periods ?? itemTopics(it).reduce((x, t) => x + (t.periods || 0), 0)
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
  const total = (g: number) => cols.reduce((x, s) => x + periodsOf(get(g, s)), 0)
  const nTopics = mine.reduce((x, i) => x + itemTopics(i).length, 0)
  return <div className="panel pdcard" style={{ marginBottom: 12 }}>
    <div className="bar"><h4 style={{ margin: 0 }}>{chip(track.code)} {track.name} <small className="sub">· {new Set(mine.map(i => i.module_id)).size} học phần · {nTopics} chủ đề</small></h4>
      {admin && <div className="tools">
        {edit && <button type="button" onClick={() => setExtra(extra + 1)}>+ Cột học phần</button>}
        <button type="button" className={edit ? 'primary' : ''} onClick={() => { if (edit && onDone) return onDone(); setEdit(!edit); setExtra(0) }}>{edit ? 'Xong' : 'Sửa học phần'}</button></div>}</div>
    {!rows.length ? <small className="sub">Gói chưa có học phần của loại này.{admin ? ' Bấm "Sửa học phần".' : ''}</small>
      : <table className="table">
        <thead><tr><th>Khối</th>{cols.map(s => <th key={s}>Học phần {s} <small className="sub">(chủ đề)</small></th>)}<th>Tiết / năm</th></tr></thead>
        <tbody>{rows.flatMap(g => {
          const openSlot = open?.startsWith(g + '|') ? Number(open.split('|')[1]) : null
          const openMod = openSlot ? name(get(g, openSlot)?.module_id) : undefined
          const list = openSlot ? itemTopics(get(g, openSlot!)) : []
          return [<tr key={g}>
            <td>{gradeName(g)}</td>
            {cols.map(s => {
              const it = get(g, s), m = name(it?.module_id), n = itemTopics(it).length, k = g + '|' + s
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

// So sánh các gói (tư vấn cho từng trường): lọc theo cấp / khối, xem theo học phần hoặc theo khối.
const LEVELS = [{ k: 'th', name: 'Tiểu học', grades: [1, 2, 3, 4, 5] }, { k: 'thcs', name: 'THCS', grades: [6, 7, 8, 9] }, { k: 'thpt', name: 'THPT', grades: [10, 11, 12] }] as const
function Seg<T extends string | number | null>({ label, items, on, onPick }: { label: string; items: [T, string][]; on: (v: T) => boolean; onPick: (v: T) => void }) {
  return <div className="lvgrp"><span className="lvlab">{label}</span>
    <div className="seg" role="group" aria-label={label}>{items.map(([v, t]) =>
      <button key={String(v)} type="button" className={on(v) ? 'on' : ''} aria-pressed={on(v)} onClick={() => onPick(v)}>{t}</button>)}</div></div>
}
function LevelFilter({ lvs, grade, onLevels, onGrade, extra }: { lvs: string[]; grade: number | null; onLevels: (v: string[]) => void; onGrade: (g: number | null) => void; extra?: React.ReactNode }) {
  const sel = LEVELS.filter(l => lvs.includes(l.k))
  const toggle = (k: string) => onLevels(lvs.includes(k) ? lvs.filter(x => x !== k) : LEVELS.filter(l => [...lvs, k].includes(l.k)).map(l => l.k))
  return <div className="lvfilter">
    <Seg label="Cấp học" items={[['', 'Tất cả'], ...LEVELS.map(l => [l.k, l.name] as [string, string])]} on={v => v ? lvs.includes(v) : !lvs.length} onPick={v => v ? toggle(v) : onLevels([])} />
    {sel.length > 0 && <Seg label="Khối" items={[[null, 'Tất cả'], ...sel.flatMap(l => [...l.grades]).map(g => [g, String(g)] as [number, string])]} on={v => v === grade} onPick={onGrade} />}
    <small className="sub">{lvs.length ? `Đang xem ${grade ? 'khối ' + grade : sel.map(l => l.name).join(' + ')}` : 'Trường liên cấp: chọn nhiều cấp'}</small>
    {extra && <div style={{ marginLeft: 'auto' }}>{extra}</div>}
  </div>
}

function CompareView({ tracks, packages: allPkgs, items, topics, skips, modName, grades, name, filter }: {
  tracks: StemTrack[]; packages: ProgramPackage[]; items: PackageItem[]; topics: ProgramTopic[]; skips: PackageSkip[]; modName: (id: string) => string
  grades: number[]; levels: (typeof LEVELS)[number][]; name: string; filter: React.ReactNode
}) {
  // Chọn gói để so sánh: không chọn gói nào = so sánh tất cả. Màu mỗi gói giữ nguyên theo thứ tự gốc.
  const [pick, setPick] = useState<string[]>([])
  const packages = pick.length ? allPkgs.filter(p => pick.includes(p.id)) : allPkgs
  const ck = (k: number) => allPkgs.indexOf(packages[k])
  const [only, setOnly] = useState(true)
  const [by, setBy] = useState<'mod' | 'grade'>('mod')
  const its = items.filter(i => grades.includes(i.grade) && packages.some(p => p.id === i.package_id))
  const has = (p: string, m: string) => its.some(i => i.package_id === p && i.module_id === m)
  // Theo học phần: gói nào có học phần (trong các khối đang lọc) ghi "Có"
  const sections = tracks.map(t => {
    const mods = [...new Set(its.filter(i => i.track_code === t.code).map(i => i.module_id))]
      .sort((a, b) => {
        for (const p of packages) { const x = has(p.id, a), y = has(p.id, b); if (x !== y) return x ? -1 : 1 }
        return modName(a).localeCompare(modName(b), 'vi')
      })
    const rows = mods.map(m => ({ m, d: !packages.every(p => has(p.id, m) === has(packages[0].id, m)) }))
    return { t, rows: only ? rows.filter(r => r.d) : rows }
  }).filter(x => x.rows.length)
  // Theo khối: mỗi khối một dòng, ô ghi học phần của gói ở khối đó; học phần không phải gói nào cũng có thì tô xanh
  const modsAt = (p: string, t: string, g: number) => its.filter(i => i.package_id === p && i.track_code === t && i.grade === g).sort((a, b) => a.slot - b.slot).map(i => i.module_id)
  // Loại không chia học phần (chỉ có chủ đề theo khối): mỗi khối một dòng, ô ghi số chủ đề gói có ở khối đó
  const nTopics = (p: string, t: string, g: number) => { const ms = new Set(modsAt(p, t, g)); if (!ms.size) return 0
    return topics.filter(x => ms.has(x.module_id) && x.grade === g && x.active !== false && !skips.some(s => s.package_id === p && s.topic_id === x.id)).length }
  const gsections = tracks.map(t => {
    if (t.use_modules === false) {
      const rows = grades.map(g => { const cnt = packages.map(p => modsAt(p.id, t.code, g).length ? nTopics(p.id, t.code, g) : -1)
        return { g, per: [] as string[][], cnt, common: new Set<string>(), d: cnt.some(c => c !== cnt[0]) } }).filter(r => r.cnt.some(c => c >= 0))
      return { t, rows: only ? rows.filter(r => r.d) : rows }
    }
    const rows = grades.map(g => {
      const per = packages.map(p => modsAt(p.id, t.code, g))
      const common = new Set(per[0].filter(m => per.every(x => x.includes(m))))
      return { g, per, cnt: null as number[] | null, common, d: per.some(x => x.length !== common.size) }
    }).filter(r => r.per.some(x => x.length))
    return { t, rows: only ? rows.filter(r => r.d) : rows }
  }).filter(x => x.rows.length)
  // In: chỉ in bảng so sánh (trang có quy tắc in riêng cho giấy chứng nhận ẩn mọi thứ khác)
  const printCmp = () => { document.body.classList.add('cmpprinting'); window.print(); setTimeout(() => document.body.classList.remove('cmpprinting'), 500) }
  const same = tracks.filter(t => !(by === 'mod' ? sections : gsections).some(x => x.t.code === t.code)).map(t => trackLabel(t.code))
  return <>
    {filter}
    <div className="bar cmpbar">
      <Seg label="Xem theo" items={[['mod', 'Học phần'], ['grade', 'Khối']] as ['mod' | 'grade', string][]} on={v => v === by} onPick={setBy} />
      <label className="field inline"><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} /> Chỉ hiện chỗ các gói khác nhau</label>
      {only && same.length > 0 && <small className="sub">{same.join(', ')} giống nhau ở mọi gói.</small>}
      <span style={{ flex: 1 }} />
      <span className="lvlab">Gói</span>
      <div style={{ flex: '0 0 220px', width: 220 }}><MultiSelect compact value={pick} onChange={setPick} options={allPkgs.map(p => [p.id, p.name] as [string, string])}
        placeholder="Tất cả gói" ariaLabel="Chọn gói để so sánh" /></div>
      <button type="button" onClick={printCmp}>In / Xuất PDF</button>
    </div>
    <div className="cmpprint">
    <h3 className="printonly">So sánh các gói STEM · {name} · theo {by === 'mod' ? 'học phần' : 'khối'}</h3>
    <FitScreen className="fsbox">
      {by === 'mod' ? <table className="table cmptbl cmplined cmpmodt">
        <thead><tr><th>Học phần · {name}</th>{packages.map((p, k) => <th key={p.id} className="pkgth" style={pkgTh(ck(k))}>{p.name}</th>)}</tr></thead>
        {sections.map(({ t, rows }) => <tbody key={t.code}>
          <tr className="cmpgrp"><td colSpan={packages.length + 1}>{chip(t.code)} {t.name}</td></tr>
          {rows.map(({ m }) => <tr key={m}><td>{t.use_modules === false ? 'Chủ đề theo khối' : modName(m)}</td>
            {packages.map((p, k) => <td key={p.id} style={pkgTd(ck(k))}>{has(p.id, m) ? 'Có' : <span className="sub">—</span>}</td>)}</tr>)}
        </tbody>)}
      </table>
      : <table className="table cmptbl cmpgrade cmplined">
        <thead><tr><th>Khối</th><th>Học phần</th>{packages.map((p, k) => <th key={p.id} className="pkgth" style={pkgTh(ck(k))}>{p.name}</th>)}</tr></thead>
        {gsections.map(({ t, rows }) => <tbody key={t.code}>
          <tr className="cmpgrp"><td colSpan={packages.length + 2}>{chip(t.code)} {t.name}</td></tr>
          {rows.flatMap(({ g, per, cnt }) => { if (cnt) return [<tr key={g} className="cmpfirst"><td className="cmpg">{gradeName(g)}</td><td className="cmphp">Chủ đề</td>
              {cnt.map((c, k) => <td key={k} style={pkgTd(ck(k))}>{c >= 0 ? `${c} chủ đề` : <span className="sub">—</span>}</td>)}</tr>]
            const n = Math.max(1, ...per.map(x => x.length))
            return Array.from({ length: n }, (_, j) => <tr key={g + '-' + j} className={j ? 'cmpsub' : 'cmpfirst'}>
              {j === 0 && <td rowSpan={n} className="cmpg">{gradeName(g)}</td>}<td className="cmphp">HP{j + 1}</td>
              {per.map((ms, k) => <td key={k} style={pkgTd(ck(k))}>{ms[j] ? modName(ms[j]) : <span className="sub">—</span>}</td>)}</tr>) })}
        </tbody>)}
      </table>}
    </FitScreen>
    {by === 'grade' && <p className="sub framefoot">Mỗi khối chia theo học phần HP1, HP2 (loại không chia học phần ghi số chủ đề); đọc theo hàng ngang để thấy cùng một học phần ở mỗi gói là gì.</p>}
    </div>
  </>
}

type Draft = Record<string, string>   // `${track}|${khối}|${HP}` → học phần ('' = khối đã tick, chưa chọn học phần)
const dk = (t: string, g: number, sl: number) => `${t}|${g}|${sl}`
function PackageForm({ p, tracks, items, skips, modules, topics, onCancel, onSaved }: {
  p: ProgramPackage & { copyFrom?: string; tab?: string }; tracks: StemTrack[]; items: PackageItem[]; skips: PackageSkip[]; modules: ProgramModule[]; topics: ProgramTopic[]
  onCancel: () => void; onSaved: (id?: string) => void
}) {
  const [f, setF] = useState(p)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Nội dung gói: lấy từ gói đang sửa, hoặc gói gốc khi sao chép
  const srcId = p.id || p.copyFrom || ''
  const start = (): Draft => Object.fromEntries(items.filter(i => i.package_id === srcId).map(i => [dk(i.track_code, i.grade, i.slot), i.module_id]))
  const [draft, setDraft] = useState<Draft>(start)
  // Chủ đề bỏ khỏi gói (loại CT chỉ có chủ đề), mặc định chọn hết
  const [skip, setSkip] = useState<Set<string>>(() => new Set(skips.filter(s => s.package_id === srcId).map(s => s.topic_id)))
  const [pick, setPick] = useState<{ t: StemTrack; g: number } | null>(null)
  const [tab, setTab] = useState(p.tab && tracks.some(t => t.code === p.tab) ? p.tab : tracks[0]?.code ?? '')
  const tr = tracks.find(t => t.code === tab)
  const flat = (t?: StemTrack) => t?.use_modules === false
  const modsOf = (t: StemTrack) => modules.filter(m => m.track_code === t.code && m.active !== false).sort((a, b) => a.sort - b.sort)
  const flatMod = (t: StemTrack) => modules.filter(m => m.track_code === t.code).sort((a, b) => a.sort - b.sort)[0]
  const keysOf = (t: string, g?: number) => Object.keys(draft).filter(k => k.startsWith(t + '|') && (g == null || k.split('|')[1] === String(g)))
  const gradesOf = (t: string) => [...new Set(keysOf(t).map(k => Number(k.split('|')[1])))].sort((a, b) => a - b)
  const fake = (t: string, g: number, sl: number): PackageItem => ({ package_id: '_', track_code: t, grade: g, slot: sl, module_id: draft[dk(t, g, sl)], note: null } as unknown as PackageItem)
  const fakeAll = Object.keys(draft).filter(k => draft[k]).map(k => { const [t, g, sl] = k.split('|'); return fake(t, Number(g), Number(sl)) })
  const tps = (t: string, g: number, sl: number) => draft[dk(t, g, sl)] ? slotTopics(topics, fakeAll, fake(t, g, sl)) : []
  const flatTopics = (t: StemTrack, g: number) => topics.filter(x => x.module_id === flatMod(t)?.id && x.grade === g && x.active !== false).sort((a, b) => a.seq - b.seq)
  const flatOn = (t: StemTrack, g: number) => flatTopics(t, g).filter(x => !skip.has(x.id))
  const flipTopic = (id: string) => { const s = new Set(skip); if (s.has(id)) s.delete(id); else s.add(id); setSkip(s) }
  const setAll = (t: StemTrack, g: number, on: boolean) => { const s = new Set(skip); flatTopics(t, g).forEach(x => on ? s.delete(x.id) : s.add(x.id)); setSkip(s) }
  function flipGrade(t: StemTrack, g: number) {
    const d = { ...draft }
    if (keysOf(t.code, g).length) keysOf(t.code, g).forEach(k => delete d[k])
    else d[dk(t.code, g, 1)] = flat(t) ? flatMod(t)?.id ?? '' : ''
    setDraft(d)
  }
  const setMod = (t: string, g: number, sl: number, id: string) => {
    const d = { ...draft }
    if (id || sl === 1) d[dk(t, g, sl)] = id; else delete d[dk(t, g, sl)]
    setDraft(d)
  }
  async function save() {
    if (!f.name.trim()) return setErr('Nhập tên gói.')
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(f.code.trim())) return setErr('Mã gói gồm chữ, số, "-" hoặc "_" (tối đa 20 ký tự), VD: 5T.')
    const missT = tracks.filter(t => gradesOf(t.code).some(g => !keysOf(t.code, g).some(k => draft[k])))
    if (missT.length) {
      setTab(missT[0].code)
      return setErr(`Chưa chọn học phần: ${missT.flatMap(t => gradesOf(t.code).filter(g => !keysOf(t.code, g).some(k => draft[k])).map(g => `${trackLabel(t.code)} ${gradeName(g)}`)).join(', ')}. Chọn học phần hoặc bỏ tick khối.`)
    }
    const noTopic = tracks.filter(flat).flatMap(t => gradesOf(t.code).filter(g => flatTopics(t, g).length && !flatOn(t, g).length).map(g => ({ t, g })))
    if (noTopic.length) {
      setTab(noTopic[0].t.code)
      return setErr(`Chưa chọn chủ đề nào: ${noTopic.map(x => `${trackLabel(x.t.code)} ${gradeName(x.g)}`).join(', ')}. Chọn ít nhất một chủ đề hoặc bỏ tick khối.`)
    }
    setBusy(true); setErr('')
    const row = { code: f.code.trim(), name: f.name, description: f.description, sort: Number(f.sort) || 0, active: f.active }
    const { data, error } = f.id ? await supabase.from('program_packages').update(row).eq('id', f.id).select('id')
      : await supabase.from('program_packages').insert(row).select('id')
    if (error || !data?.length) { setBusy(false); return setErr(frameErr(error ? error.message + ' ' + (error.code ?? '') : 'row-level')) }
    const id = data[0].id as string
    // Lưu nội dung: xoá ô bỏ đi, thêm / đổi ô còn lại
    const old = new Map(items.filter(i => i.package_id === f.id && f.id).map(i => [dk(i.track_code, i.grade, i.slot), i.module_id]))
    const want = Object.entries(draft).filter(([, m]) => m)
    for (const k of old.keys()) if (!draft[k]) {
      const [t, g, sl] = k.split('|')
      const r = await supabase.from('program_package_items').delete().match({ package_id: id, track_code: t, grade: Number(g), slot: Number(sl) })
      if (r.error) { setBusy(false); return setErr(frameErr(r.error.message + ' ' + (r.error.code ?? ''))) }
    }
    const up = want.filter(([k, m]) => old.get(k) !== m).map(([k, m]) => { const [t, g, sl] = k.split('|'); return { package_id: id, track_code: t, grade: Number(g), slot: Number(sl), module_id: m } })
    if (up.length) {
      const r = await supabase.from('program_package_items').upsert(up)
      if (r.error) { setBusy(false); return setErr(frameErr(r.error.message + ' ' + (r.error.code ?? ''))) }
    }
    // Chủ đề bỏ: chỉ giữ chủ đề của khối còn tick; xoá chủ đề chọn lại, thêm chủ đề mới bỏ
    const wantSk = new Set(tracks.filter(flat).flatMap(t => gradesOf(t.code).flatMap(g => flatTopics(t, g).filter(x => skip.has(x.id)).map(x => x.id))))
    const oldSk = new Set(f.id ? skips.filter(s => s.package_id === f.id).map(s => s.topic_id) : [])
    const delSk = [...oldSk].filter(x => !wantSk.has(x)), addSk = [...wantSk].filter(x => !oldSk.has(x))
    if (delSk.length) {
      const r = await supabase.from('program_package_topic_skips').delete().eq('package_id', id).in('topic_id', delSk)
      if (r.error) { setBusy(false); return setErr(frameErr(r.error.message + ' ' + (r.error.code ?? ''))) }
    }
    if (addSk.length) {
      const r = await supabase.from('program_package_topic_skips').upsert(addSk.map(x => ({ package_id: id, topic_id: x })))
      if (r.error) { setBusy(false); return setErr(frameErr(r.error.message + ' ' + (r.error.code ?? ''))) }
    }
    setBusy(false)
    onSaved(id)
  }
  const nSl = (t: StemTrack) => Math.max(2, ...keysOf(t.code).map(k => Number(k.split('|')[2])))
  return <>
    <section className="panel">
      <h4 style={{ margin: '0 0 10px' }}>Thông tin gói</h4>
      <div className="formgrid">
        <label className="field"><span>Mã gói *</span><input value={f.code} maxLength={20} placeholder="VD: 5T" onChange={e => setF({ ...f, code: e.target.value })} /></label>
        <label className="field"><span>Tên gói *</span><input value={f.name} maxLength={120} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Thứ tự</span><input type="number" min={0} value={f.sort} onChange={e => setF({ ...f, sort: Number(e.target.value) })} /></label>
        <label className="field"><span>Trạng thái</span><select value={f.active ? 'on' : 'off'} onChange={e => setF({ ...f, active: e.target.value === 'on' })}>
          <option value="on">Đang dùng</option><option value="off">Ngừng dùng</option></select></label>
        <label className="field wide"><span>Mô tả (gói khác các gói khác ở đâu)</span><textarea rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
      </div>
    </section>
    <section className="panel" style={{ marginTop: 14 }}>
      <h4 style={{ margin: 0 }}>Nội dung gói <small className="sub" style={{ fontWeight: 400 }}>· chủ đề, học phần soạn ở tab Khung chương trình{f.copyFrom ? ' · đã lấy sẵn từ gói gốc' : ''}</small></h4>
      <div className="distfilter" role="tablist" style={{ margin: '12px 0' }}>{tracks.map(t => <button key={t.code} type="button" role="tab" aria-selected={tab === t.code}
        className={'distfchip' + (tab === t.code ? ' on' : '')} onClick={() => setTab(t.code)} title={`${trackLabel(t.code)} · ${t.name}`}>{t.name} <small style={{ opacity: .75 }}>· {gradesOf(t.code).length} khối</small></button>)}</div>
      {tr && <div className="pkfsec">
        <div className="pkfhead">{chip(tr.code)} <b>{tr.name}</b><span className="sub" style={{ marginLeft: 'auto' }}>{flat(tr) ? 'Tick khối đưa vào gói · chủ đề lấy theo Khung chương trình' : 'Tick khối, rồi chọn học phần HP1, HP2 cho từng khối'}</span></div>
        <div className="pkfgrades"><span className="sub">Khối áp dụng:</span>{GRADES.map(g => { const on = keysOf(tr.code, g).length > 0
          const none = flat(tr) && !flatTopics(tr, g).length
          return <label key={g} className={'pkfchk' + (on ? ' on' : '') + (none && !on ? ' off' : '')} title={none ? 'Khung chương trình chưa có chủ đề của khối này' : undefined}>
            <input type="checkbox" checked={on} disabled={none && !on} onChange={() => flipGrade(tr, g)} /> K{g}{flat(tr) && !none ? <small className="sub"> · {flatTopics(tr, g).length}</small> : null}</label> })}</div>
        {flat(tr)
          ? gradesOf(tr.code).length === 0 ? <p className="sub" style={{ margin: '8px 12px' }}>Chưa tick khối nào.</p>
          : <table className="table slt ttdense" style={{ width: '100%' }}>
            <thead><tr><th style={{ width: 120 }}>Khối</th><th style={{ width: 120 }}>Số chủ đề</th><th style={{ width: 110 }}>Tiết / năm</th><th /><th style={{ width: 90 }} /></tr></thead>
            <tbody>{gradesOf(tr.code).map(g => { const all = flatTopics(tr, g), on = flatOn(tr, g), cur = pick?.t.code === tr.code && pick.g === g
              return <tr key={g} className={cur ? 'pkfcur' : undefined}><td>{gradeName(g)}</td>
                <td className={on.length < all.length ? 'pkfwarn' : undefined}>{on.length} / {all.length}</td>
                <td>{on.reduce((x, t) => x + (t.periods || 0), 0) || <span className="sub">—</span>}</td>
                <td><button type="button" className={'pkfpick' + (cur ? ' on' : '')} disabled={!all.length} onClick={() => setPick({ t: tr, g })}>☰ Chọn chủ đề ›</button></td>
                <td><button type="button" className="linkbtn" onClick={() => flipGrade(tr, g)}>✕ bỏ khối</button></td></tr> })}</tbody></table>
          : gradesOf(tr.code).length === 0 ? <p className="sub" style={{ margin: '8px 12px' }}>Chưa tick khối nào.</p>
          : <table className="table slt ttdense" style={{ width: '100%' }}>
            <thead><tr><th style={{ width: 80 }}>Khối</th>{Array.from({ length: nSl(tr) }, (_, i) => <th key={i}>Học phần {i + 1}</th>)}<th style={{ width: 90 }}>Số chủ đề</th><th style={{ width: 90 }}>Tiết / năm</th><th style={{ width: 90 }} /></tr></thead>
            <tbody>{gradesOf(tr.code).map(g => { const all = Array.from({ length: nSl(tr) }, (_, i) => tps(tr.code, g, i + 1)).flat()
              return <tr key={g}><td>{gradeName(g)}</td>
                {Array.from({ length: nSl(tr) }, (_, i) => <td key={i}><select value={draft[dk(tr.code, g, i + 1)] ?? ''} onChange={e => setMod(tr.code, g, i + 1, e.target.value)} aria-label={`${gradeName(g)} · học phần ${i + 1}`}>
                  <option value="">{i === 0 ? 'Chọn học phần' : '—'}</option>{modsOf(tr).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></td>)}
                <td>{all.length || <span className="sub">—</span>}</td><td>{all.reduce((x, t) => x + (t.periods || 0), 0) || <span className="sub">—</span>}</td>
                <td><button type="button" className="linkbtn" onClick={() => flipGrade(tr, g)}>✕ bỏ khối</button></td></tr> })}</tbody></table>}
      </div>}
    </section>
    {pick && (() => { const all = flatTopics(pick.t, pick.g), on = flatOn(pick.t, pick.g)
      return <Drawer onClose={() => setPick(null)} title={<>{chip(pick.t.code)} Chủ đề {gradeName(pick.g)}</>}
        actions={<button className="primary" onClick={() => setPick(null)}>Xong</button>}>
        <div className="pkfbar"><span className="sub">Đang chọn</span><b className={on.length < all.length ? 'pkfwarn' : undefined}>{on.length} / {all.length}</b>
          <span className="sub">· {on.reduce((x, t) => x + (t.periods || 0), 0)} tiết</span>
          <span style={{ marginLeft: 'auto' }} /><button type="button" onClick={() => setAll(pick.t, pick.g, true)}>Chọn hết</button><button type="button" onClick={() => setAll(pick.t, pick.g, false)}>Bỏ hết</button></div>
        <div className="pkftopics">{all.map(x => <label key={x.id} className={'pkftp' + (skip.has(x.id) ? '' : ' on')}>
          <input type="checkbox" checked={!skip.has(x.id)} onChange={() => flipTopic(x.id)} /><span className="sub pkfseq">{x.seq}</span><span className="pkfname">{x.title}</span><span className="sub">{x.periods} tiết</span></label>)}</div>
        <p className="sub">Chủ đề bỏ tick sẽ không có trong gói. Bấm Lưu ở form để lưu.</p>
      </Drawer> })()}
    {err && <p className="warnline">{err}</p>}
    <div className="actions" style={{ marginTop: 12 }}>
      <button className="primary" onClick={save} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      <button onClick={onCancel} disabled={busy}>Huỷ</button>
    </div>
  </>
}

/** Nội dung một chủ đề (xem nhanh trong khung bên phải) */
function TopicView({ t, mod, sgk, admin }: { t: ProgramTopic; mod?: string; sgk?: boolean; admin: boolean }) {
  const v = (x: string | null | undefined) => x ? <span style={{ whiteSpace: 'pre-line' }}>{x}</span> : <span className="sub">—</span>
  return <>
    <p className="sub" style={{ marginTop: 0 }}>{gradeName(t.grade)} · Thứ tự {t.seq} · {t.periods} tiết{mod ? ' · Học phần ' + mod : ''}{t.part ? ` · HP${t.part}` : ''}</p>
    <dl className="kv">
      <dt>Mã chủ đề</dt><dd>{v(t.code)}</dd>
      <dt>Môn chủ trì</dt><dd>{v(t.main_subject)}</dd>
      <dt>Môn phối hợp</dt><dd>{v(t.subjects.join(', '))}</dd>
      <dt>Yêu cầu cần đạt</dt><dd>{v(t.objectives)}</dd>
      <dt>Sản phẩm</dt><dd>{v(t.product)}</dd>
      {sgk && <><dt>Bài SGK liên quan</dt><dd>{v(t.textbook_ref)}</dd></>}
    </dl>
    <TopicContents topic={t} admin={admin} />
  </>
}
