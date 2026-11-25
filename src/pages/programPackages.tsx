import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { FitScreen } from '../components/FitScreen'
import { supabase } from '../lib/supabase'
import { EDU_ACTIVITY_NAME, useStemTracks, type StemTrack, trackLabel } from '../lib/stemTracks'
import { BLANK_TRACK, TrackForm, trackErr } from './stemTracks'
import { fmtGrades, gradeName } from '../lib/eduLevels'
import { frameErr, loadFrame, loadPackages, slotTopics, type PackageItem, type PackageSkip, type ProgramModule, type ProgramPackage, type ProgramTopic } from '../lib/programFrame'
import { PROGRAM_COLOR } from './teacher/common'
import { HeadAction } from '../components/PageFrame'
import { ColFilter } from '../components/DataTable'
import { DetailHead } from '../components/DetailHead'
import { ElView } from '../components/ElView'
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
/** Màu gói: màu KDI chọn khi sửa gói (169), chưa chọn thì theo thứ tự gói */
const pkgColor = (p: ProgramPackage | undefined, k: number) => p?.color || PKG_C[k % PKG_C.length]
const pkgTh = (c: string) => ({ background: c, color: '#fff' })
const pkgTd = (c: string) => ({ background: `color-mix(in srgb, ${c} 7%, transparent)` })
// Bảng màu gợi ý khi chọn màu gói
const SWATCH = ['#2563eb', '#9333ea', '#ea580c', '#e11d48', '#059669', '#0891b2', '#ca8a04', '#475569']
const tick = () => <span className="pkgtick" style={{ background: '#cfe3fb', color: '#2f6fd6' }} aria-hidden="true">✓</span>
const hasCard = (p: ProgramPackage) => !!(p.card_tagline?.trim() || p.card_highlights?.some(x => x.trim()) || p.card_footer?.trim())

/** Thẻ gói: đầu thẻ theo màu gói; thân thẻ giống nhau ở mọi gói. KDI đã soạn thẻ (169) thì hiện câu giới thiệu, các dòng nổi bật, dòng cuối;
 *  chưa soạn thì hiện nội dung tự động (`auto`). Dùng ở trang Gói STEM và phần xem trước khi sửa gói. */
function PkgCard({ p, color, auto, selected, onOpen, menu }: {
  p: ProgramPackage; color: string; auto: React.ReactNode; selected?: boolean; onOpen?: () => void; menu?: React.ReactNode
}) {
  const card = hasCard(p)
  return <div className={'pkgc' + (selected ? ' on' : '') + (onOpen ? '' : ' still')} style={{ '--c': color } as React.CSSProperties}
    role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} aria-pressed={onOpen ? !!selected : undefined}
    title={onOpen ? (selected ? 'Bấm để ẩn chi tiết gói' : 'Bấm để xem chi tiết gói ở bên dưới') : undefined}
    onClick={onOpen} onKeyDown={e => { if (onOpen && e.key === 'Enter' && e.target === e.currentTarget) onOpen() }}>
    <div className="pkgc-head" style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${color} 82%, #000), ${color})` }}>
      <div className="bar" style={{ margin: 0, gap: 6 }}><b className="pkgc-name">{p.name || 'Gói mới'}</b>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
          <span className={'pill ' + (p.active ? 'active' : 'inactive')}>{p.active ? 'Đang dùng' : 'Ngừng dùng'}</span>{menu}</span></div>
      <small title={p.description} className="pkgc-desc">{p.description || 'Chưa có mô tả.'}</small>
    </div>
    <div className="pkgc-body">
      {card ? <>
        {p.card_tagline?.trim() && <div className="pkgc-tg">{p.card_tagline}</div>}
        {(p.card_highlights ?? []).filter(x => x.trim()).map((h, k) => <div key={k} className="pkgc-row">{tick()}<div>{h}</div></div>)}
      </> : auto}
      <div className="pkgc-foot"><b>{card ? p.card_footer : ''}</b><span className="pkgc-more">{selected ? '▲ Đang xem' : 'Xem chi tiết ▾'}</span></div>
    </div>
  </div>
}
const keyOf = (t: string, g: number, s: number) => `${t}|${g}|${s}`

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
  const [trackOpen, setTrackOpen] = useState(false)   // ngăn bên phải: các loại chương trình
  const [formSlot, setFormSlot] = useState<HTMLElement | null>(null)   // chỗ đặt nút Lưu / Huỷ trên hàng tiêu đề khi sửa gói
  const [by, setBy] = useState<'grade' | 'mod'>('mod')   // So sánh: xem theo học phần (mặc định) hoặc theo khối
  // Lọc theo cấp / khối, dùng chung cho Tổng quan gói và So sánh (tư vấn cho từng trường, trường liên cấp chọn nhiều cấp)
  const [lvs, setLvs] = useState<string[]>([])
  const [fGrade, setFGrade] = useState<number | null>(null)
  const sel = lvs.length ? LEVELS.filter(l => lvs.includes(l.k)) : [...LEVELS]
  const selGrades: number[] = fGrade ? [fGrade] : sel.flatMap(l => [...l.grades])
  const fName = fGrade ? gradeName(fGrade) : lvs.length ? sel.map(l => l.name).join(' + ') : 'Cả 12 khối'
  const filterBar = <LevelFilter lvs={lvs} grade={fGrade} onLevels={v => { setLvs(v); setFGrade(null) }} onGrade={setFGrade} />
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

  // Gói đang xem chi tiết ở dưới thẻ: mặc định gói đầu tiên; bấm lại thẻ đang xem để ẩn ('' = không xem gói nào)
  const curId = openId === null ? (live[0] ?? packages[0])?.id : openId
  const cur = curId ? packages.find(p => p.id === curId) : undefined
  const topicsOfItem = (i: PackageItem) => slotTopics(topics, items, i)
  const statOf = (pkg: string, t?: string) => {
    const its = items.filter(i => i.package_id === pkg && (!t || i.track_code === t) && selGrades.includes(i.grade))
    return { its, mods: [...new Set(its.map(i => i.module_id))], topics: its.reduce((x, i) => x + topicsOfItem(i).length, 0),
      tracks: [...new Set(its.map(i => i.track_code))] }
  }
  const pkgMenu = (p: ProgramPackage) => [
    { label: 'Sửa gói', onClick: () => setEditPkg(p) },
    { label: 'Sao chép thành gói mới', onClick: () => setEditPkg({ ...p, id: '', code: '', name: p.name + ' (bản sao)', sort: p.sort + 1, copyFrom: p.id }) },
    ...(live.length > 1 ? [{ label: 'So sánh với gói khác', onClick: () => setCompare(true) }] : []),
    { label: 'Xoá', danger: true, onClick: () => delPkg(p) }]

  const n = packages.length
  // Tóm tắt một loại chương trình trong một gói: khối có học, số học phần (hoặc chủ đề) mỗi khối
  const sumOf = (pkg: string, t: StemTrack) => {
    const x = statOf(pkg, t.code)
    const gs = [...new Set(x.its.map(i => i.grade))].sort((a, b) => a - b)
    const tl = x.its.flatMap(i => topicsOfItem(i))
    const per = t.use_modules === false ? `${perGrade(tl)} chủ đề/khối` : `${Math.max(0, ...gs.map(g => x.its.filter(i => i.grade === g).length))} học phần/khối`
    return { x, gs, text: gs.length ? `${fmtGrades(gs)} · ${per}` : '' }
  }
  const perGrade = (list: ProgramTopic[]) => { const g = new Set(list.map(t => t.grade)); return g.size ? Math.round(list.length / g.size) : 0 }
  const ctick = (bg: string, fg: string) => <span className="pkgtick" style={{ background: bg, color: fg }} aria-hidden="true">✓</span>
  const openPkg = (id: string) => { setMsg(''); setOpenId(curId === id ? '' : id) }
  // Thẻ gói chưa được KDI soạn: hiện nội dung tự động như trước (phần chung, điểm riêng của gói)
  const autoBody = (p: ProgramPackage, c: string) => {
    const diff = diffTracks(p.id)
    const common = active.map(t => ({ t, ...sumOf(p.id, t) })).filter(r => r.x.its.length && !diff.includes(r.t.code))
    const own = active.filter(t => diff.includes(t.code)).map(t => ({ t, ...sumOf(p.id, t) })).filter(r => r.x.its.length)
    return <>
      {common.map(r => <div key={r.t.code} className="pkgc-row">{tick()}
        <div><span className="pkgc-code">{trackLabel(r.t.code)}</span> {r.t.name}<small>{r.t.use_modules === false ? fmtGrades(r.gs) : r.text}</small></div></div>)}
      {own.length > 0 && <>
        <div className="pkgc-sep"><span>Điểm riêng của gói</span></div>
        {own.map(r => <div key={r.t.code}>
          <div className="pkgc-cap"><span className="pkgc-code">{trackLabel(r.t.code)}</span> {r.t.name}</div>
          {r.t.use_modules === false
            ? <div className="pkgc-row">{ctick(c, '#fff')}<div>{r.text}</div></div>
            : r.x.mods.map(id => <div key={id} className="pkgc-row">{ctick(c, '#fff')}
              <div>{modName(id)}<small>{fmtGrades([...new Set(r.x.its.filter(i => i.module_id === id).map(i => i.grade))].sort((a, b) => a - b))}</small></div></div>)}
        </div>)}
      </>}
      {!common.length && !own.length && <small className="sub">Chưa có học phần{selGrades.length < 12 ? ` ở ${fName}` : ''}.</small>}
    </>
  }
  const curK = cur ? packages.indexOf(cur) : 0
  if (editPkg) return <ElView back="Gói STEM" onBack={() => setEditPkg(null)}
    title={editPkg.id ? `Sửa gói · ${editPkg.name}` : editPkg.copyFrom ? 'Sao chép gói STEM' : 'Thêm gói STEM'}
    actions={<span ref={setFormSlot} className="pkfacts" />}>
    <PackageForm slot={formSlot} p={editPkg} defColor={pkgColor(undefined, editPkg.id ? Math.max(0, packages.findIndex(x => x.id === editPkg.id)) : packages.length)} auto={(p, c) => p.id ? autoBody(p, c) : <small className="sub">Chưa soạn thẻ: trang hiện nội dung tự động của gói.</small>} tracks={active} items={items} skips={skips} modules={modules} topics={topics} onCancel={() => setEditPkg(null)} onSaved={id => { setEditPkg(null); if (id) setOpenId(id); reload() }} />
  </ElView>

  if (compare) return <>
    <DetailHead back="Gói STEM" onBack={() => setCompare(false)} title="So sánh các gói STEM" />
    {msg && <p className="msg" role="status">{msg}</p>}
    <CompareView tracks={active} packages={live} items={items} topics={topics} skips={skips} modName={modName} grades={selGrades} levels={fGrade ? [] : sel} name={fName} by={by}
      filter={extra => <LevelFilter lvs={lvs} grade={fGrade} onLevels={v => { setLvs(v); setFGrade(null) }} onGrade={setFGrade} hint={false}
        extra={<>{extra}<Seg label="" items={[['grade', 'Khối'], ['mod', 'Học phần']] as ['grade' | 'mod', string][]} on={v => v === by} onPick={setBy} /></>} />} />
  </>

  return <>
    <HeadAction>
      <button type="button" onClick={() => setTrackOpen(true)}>☰ Các loại chương trình</button>
      <button type="button" onClick={() => setCompare(true)} disabled={live.length < 2}>So sánh các gói</button>
      {admin && <button type="button" className="primary ttadd" onClick={() => setEditPkg({ id: '', code: '', name: '', description: '', sort: packages.reduce((x, p) => Math.max(x, p.sort), 0) + 1, active: true })}>+ Thêm gói</button>}
    </HeadAction>
    {msg && !cur && <p className="msg" role="status">{msg}</p>}
    {!cur && filterBar}
    {!n ? <p className="sub">Chưa có gói STEM.</p> : <>
      <div className="pkgcards">
        {packages.map((p, k) => { const c = pkgColor(p, k)
          return <PkgCard key={p.id} p={p} color={c} auto={autoBody(p, c)} selected={p.id === curId} onOpen={() => openPkg(p.id)}
            menu={admin ? <RowMenu items={pkgMenu(p)} label={p.name} /> : undefined} />
        })}
      </div>
      {cur && <PackageDetail key={cur.id} pkg={cur} color={pkgColor(cur, curK)} others={packages.filter(p => p.id !== cur.id)} tracks={active} admin={admin} items={items} modules={modules} topics={topics} msg={msg} setMsg={setMsg}
        slotsOf={slotsOf} topicsOfItem={topicsOfItem} menu={admin ? pkgMenu(cur) : []}
        onChanged={reload} onLevel={k => { setLvs([k]); setFGrade(null) }} inGrades={selGrades} levelFilter={<LevelFilter lvs={lvs} grade={fGrade} onLevels={v => { setLvs(v); setFGrade(null) }} onGrade={setFGrade} hint={false} bare />} onEdit={tab => setEditPkg({ ...cur, tab })} />}
    </>}
    {trackOpen && <TrackTable onClose={() => setTrackOpen(false)} tracks={[...active, ...tracks.filter(t => t.active === false)]} packages={live} has={(pkg, t) => items.some(i => i.package_id === pkg && i.track_code === t)}
      differs={t => [...diffKeys].some(k => k.startsWith(t + '|'))} summary={t => {
        const its = items.filter(i => i.track_code === t.code && live.some(p => p.id === i.package_id))
        const gs = [...new Set(its.map(i => i.grade))].sort((a, b) => a - b)
        if (!gs.length) return ''
        if (t.use_modules === false) { const p0 = live.find(p => its.some(i => i.package_id === p.id)); return p0 ? sumOf(p0.id, t).text || fmtGrades(gs) : fmtGrades(gs) }
        return `${fmtGrades(gs)} · ${slotsOf(t.code, live.map(p => p.id)).length} học phần/khối`
      }} admin={admin} />}
  </>
}

// Ngăn bên phải "Các loại chương trình" (mở từ nút trên trang Gói STEM): thông tin chung của loại và gói nào có loại đó;
// KDI thêm, sửa, ngừng dùng, xoá loại ngay trong ngăn. Bấm một dòng để xem đủ thông tin; nút ⋮ cuối dòng để sửa (chỉ KDI).
function TrackTable({ tracks, packages, has, differs, summary, admin, onClose }: {
  tracks: StemTrack[]; packages: ProgramPackage[]; has: (pkg: string, t: string) => boolean; differs: (t: string) => boolean
  summary: (t: StemTrack) => string; admin: boolean; onClose: () => void
}) {
  const { reload } = useStemTracks()
  const [view, setView] = useState<string | null>(null)
  const [edit, setEdit] = useState<string | null>(null)   // '' = thêm loại mới
  const [err, setErr] = useState('')
  // Ngừng dùng / dùng lại; xoá chỉ được khi loại chưa được chương trình, bài giảng, học liệu hay lớp nào dùng
  async function setActive(t: StemTrack, on: boolean) {
    const { error } = await supabase.from('stem_tracks').update({ active: on }).eq('code', t.code)
    if (error) return setErr(trackErr(error.message + ' ' + (error.code ?? '')))
    setErr(''); reload()
  }
  async function remove(t: StemTrack) {
    if (!confirm(`Xoá loại chương trình ${trackLabel(t.code)} · ${t.name}?\n\nChỉ xoá được khi chưa có chương trình, bài giảng, học liệu hay lớp nào dùng. Đã dùng thì chọn "Ngừng dùng".`)) return
    const { data, error } = await supabase.from('stem_tracks').delete().eq('code', t.code).select('code')
    if (error) return setErr(trackErr(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return setErr(trackErr('row-level'))
    setErr(''); setView(null); reload()
  }
  const inPkgs = (t: StemTrack) => {
    const ps = packages.filter(p => has(p.id, t.code))
    if (!ps.length) return <small className="sub">Chưa có gói nào</small>
    const base = ps.length === packages.length && packages.length > 1 ? `Cả ${ps.length} gói` : ps.map(p => p.name).join(', ')
    return differs(t.code) ? <><span>{base}</span>, <b style={{ color: 'var(--primary)' }}>mỗi gói học phần khác nhau</b></> : base
  }
  const et = edit ? tracks.find(t => t.code === edit) : undefined
  const vt = view ? tracks.find(t => t.code === view) : undefined
  const back = () => { if (edit !== null) setEdit(null); else setView(null) }
  const title = edit === '' ? 'Thêm loại chương trình'
    : et ? <>{chip(et.code)} Sửa loại chương trình</>
    : vt ? <>{chip(vt.code)} {vt.title || vt.name}</> : 'Các loại chương trình'
  return <Drawer title={title} onClose={onClose} onBack={edit !== null || vt ? back : undefined} closeOnOutside={edit === null}
    actions={edit !== null ? undefined : vt ? (admin ? <button type="button" onClick={() => { setErr(''); setEdit(vt.code) }}>Sửa</button> : undefined)
      : admin ? <button type="button" className="primary" onClick={() => { setErr(''); setEdit('') }}>+ Thêm loại chương trình</button> : undefined}>
    {err && <p className="msg" role="status">{err}</p>}
    {edit === '' ? <TrackForm t={{ ...BLANK_TRACK, sort: tracks.reduce((m, x) => Math.max(m, x.sort ?? 0), 0) + 1 }} isNew onCancel={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />
    : et ? <TrackForm key={et.code} t={et} onCancel={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />
    : vt ? <>
      <p style={{ marginTop: 0 }}>{vt.description || 'Chưa có mô tả.'}</p>
      <dl className="kv">
        <dt>Hình thức</dt><dd>{vt.form || '—'}</dd>
        <dt>Hoạt động giáo dục</dt><dd>{vt.edu_activity ? EDU_ACTIVITY_NAME[vt.edu_activity] : '—'}</dd>
        <dt>Giáo viên dạy</dt><dd>{vt.teachers || '—'}</dd>
        <dt>Đối tượng học sinh</dt><dd>{vt.audience || '—'}</dd>
        <dt>Thời lượng</dt><dd>{vt.duration || '—'}</dd>
        <dt>Nội dung</dt><dd>{summary(vt) || '—'}</dd>
        <dt>Trong gói</dt><dd>{inPkgs(vt)}</dd>
      </dl>
      {vt.notes && <><h5 style={{ margin: '10px 0 4px' }}>Ghi chú, căn cứ</h5><p style={{ margin: 0, whiteSpace: 'pre-line' }}>{vt.notes}</p></>}
    </>
    : <div className="panel" style={{ padding: 0, overflowX: 'auto', margin: 0 }}>
      <table className="pkgtracks">
        <thead><tr><th>Mã</th><th>Tên chương trình</th><th>Hoạt động</th><th>Đối tượng</th><th>Thời lượng</th><th>Nội dung</th><th>Trong gói</th>{admin && <th aria-label="Thao tác" />}</tr></thead>
        <tbody>{tracks.map(t => <tr key={t.code} className={t.active === false ? 'trkoff' : undefined} tabIndex={0} title="Bấm để xem chi tiết" onClick={() => setView(t.code)} onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) setView(t.code) }}>
          <td>{PROGRAM_COLOR[t.code] ? chip(t.code) : <span className="pkgc-code">{trackLabel(t.code)}</span>}</td>
          <td><b>{t.name}</b>{t.active === false && <> <span className="pill inactive">Ngừng dùng</span></>}</td>
          <td>{t.edu_activity ? EDU_ACTIVITY_NAME[t.edu_activity] : '—'}</td>
          <td className="clamp"><span title={t.audience}>{t.audience || '—'}</span></td>
          <td className="clamp"><span title={t.duration}>{t.duration || '—'}</span></td>
          <td className="trkw">{summary(t) || '—'}</td>
          <td className="trkw">{inPkgs(t)}</td>
          {admin && <td onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}><RowMenu items={[{ label: 'Xem chi tiết', onClick: () => setView(t.code) }, { label: 'Sửa', onClick: () => { setErr(''); setEdit(t.code) } },
            t.active === false ? { label: 'Dùng lại', onClick: () => setActive(t, true) } : { label: 'Ngừng dùng', onClick: () => setActive(t, false) },
            { label: 'Xoá', danger: true, onClick: () => remove(t) }]} label={t.name} /></td>}
        </tr>)}</tbody>
      </table>
    </div>}
  </Drawer>
}

/** Chi tiết gói hiện ngay dưới thẻ gói: vừa một màn hình, bảng cuộn bên trong khung. Lọc cấp / khối dùng thanh lọc trên trang;
 *  ở đây chỉ lọc loại CT và đổi kiểu xem. Thao tác gói nằm trong nút ⋮. */
function PackageDetail({ pkg, color, onEdit, others, tracks, admin, items, modules, topics, msg, setMsg, slotsOf, topicsOfItem, menu, onChanged, onLevel, inGrades, levelFilter }: {
  pkg: ProgramPackage; color: string; onEdit: (tab?: string) => void; others: ProgramPackage[]; tracks: StemTrack[]; admin: boolean; items: PackageItem[]; modules: ProgramModule[]; topics: ProgramTopic[]
  msg: string; setMsg: (m: string) => void; slotsOf: (t: string, pkgs: string[]) => number[]
  topicsOfItem: (i: PackageItem) => ProgramTopic[]; menu: { label: string; onClick: () => void; danger?: boolean }[]; onChanged: () => void
  onLevel: (k: string) => void; inGrades: number[]; levelFilter: React.ReactNode   // lọc cấp / khối nằm trên hàng tiêu đề khung chi tiết
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
      <div className="pkggrid" style={{ gridTemplateColumns: `170px 96px repeat(${allGrades.length}, minmax(76px, 1fr))` }}>
        <div className="hd lb"><b>Loại chương trình (CT)</b></div><div className="hd" title="Học phần / Chủ đề">Phần</div>
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
  // Xem theo khối: phân bổ chương trình như sheet PhanBoCT, gộp một bảng (hàng = khối theo cấp, nhóm cột = loại CT)
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
    <section className="pkgdet" style={{ '--c': color } as React.CSSProperties} aria-label={'Chi tiết ' + pkg.name}>
    <div className="pkgdet-h">
      <h3>{pkg.name}</h3>
      {!edit && <span className="pkgdet-lv">{levelFilter}</span>}
      <span style={{ flex: 1 }} />
      {!edit && !empty && <span className="pkgdet-tools">
        <span className="lvgrp"><span className="lvlab">Loại CT</span><ColFilter pin label={tf.length ? tf.map(trackLabel).join(', ') : 'Tất cả'} value={tracks.filter(t => tf.includes(t.code)).map(tl)}
          options={tracks.map(t => [tl(t), nTopics(mine.filter(i => i.track_code === t.code))] as [string, number])}
          onChange={v => { setSel(null); setTf(tracks.filter(t => v.includes(tl(t))).map(t => t.code)) }} /></span>
        <div className="seg frmode" role="group" aria-label="Kiểu xem">
          <button type="button" className={pv === 'grid' ? 'on' : ''} aria-pressed={pv === 'grid'} onClick={() => setPv('grid')}>▦ Tổng quan</button>
          <button type="button" className={pv === 'table' ? 'on' : ''} aria-pressed={pv === 'table'} onClick={() => setPv('table')}>☰ Xem theo khối</button></div>
      </span>}
      {menu.length > 0 && <span className="pkgdet-menu"><RowMenu items={menu} label={pkg.name} /></span>}
    </div>
    {msg && <p className="msg" role="status">{msg}</p>}
    {track && edit
      ? <TrackGrid pkg={pkg} track={track} admin={admin} items={items} modules={modules.filter(m => m.track_code === track.code)} topics={topics}
        slots={slotsOf(track.code, [pkg.id])} diffKeys={new Set<string>()} onChanged={onChanged} onErr={setMsg} startEdit onDone={() => { setEdit(false); setCode('') }} />
      : <div className="pkgfit">{pv === 'grid' || empty ? <Overview /> : <PhanBo />}</div>}
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
    {!edit && !empty && <p className="sub pkgdet-foot">{pv === 'table' ? 'Mỗi hàng là một khối, mỗi nhóm cột là một loại chương trình. Bấm một ô để xem chủ đề; bấm tên khối để xem mọi chủ đề của khối; bấm tên cấp để chỉ xem cấp đó.' : 'Mỗi cột là một khối, mỗi hàng là một loại chương trình. Bấm vào một ô để xem chủ đề.'} Chủ đề soạn ở tab "Khung chương trình".</p>}
    </section>
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
  return <div className="lvgrp">{label && <span className="lvlab">{label}</span>}
    <div className="seg" role="group" aria-label={label}>{items.map(([v, t]) =>
      <button key={String(v)} type="button" className={on(v) ? 'on' : ''} aria-pressed={on(v)} onClick={() => onPick(v)}>{t}</button>)}</div></div>
}
function LevelFilter({ lvs, grade, onLevels, onGrade, extra, hint = true, bare = false }: { lvs: string[]; grade: number | null; onLevels: (v: string[]) => void; onGrade: (g: number | null) => void; extra?: React.ReactNode; hint?: boolean; bare?: boolean }) {
  const sel = LEVELS.filter(l => lvs.includes(l.k))
  const toggle = (k: string) => onLevels(lvs.includes(k) ? lvs.filter(x => x !== k) : LEVELS.filter(l => [...lvs, k].includes(l.k)).map(l => l.k))
  return <div className="lvfilter">
    <Seg label={bare ? '' : 'Cấp học'} items={[['', 'Tất cả'], ...LEVELS.map(l => [l.k, l.name] as [string, string])]} on={v => v ? lvs.includes(v) : !lvs.length} onPick={v => v ? toggle(v) : onLevels([])} />
    {sel.length > 0 && <Seg label="Khối" items={[[null, 'Tất cả'], ...sel.flatMap(l => [...l.grades]).map(g => [g, String(g)] as [number, string])]} on={v => v === grade} onPick={onGrade} />}
    {hint && lvs.length > 0 && <small className="sub">{lvs.length ? `Đang xem ${grade ? 'khối ' + grade : sel.map(l => l.name).join(' + ')}` : ''}</small>}
    {extra && <div className="lvextra">{extra}</div>}
  </div>
}

function CompareView({ tracks, packages: allPkgs, items, topics, skips, modName, grades, name, filter, by }: {
  tracks: StemTrack[]; packages: ProgramPackage[]; items: PackageItem[]; topics: ProgramTopic[]; skips: PackageSkip[]; modName: (id: string) => string
  grades: number[]; levels: (typeof LEVELS)[number][]; name: string; filter: (extra: React.ReactNode) => React.ReactNode; by: 'grade' | 'mod'
}) {
  // Chọn gói để so sánh: không chọn gói nào = so sánh tất cả. Màu mỗi gói giữ nguyên theo thứ tự gốc.
  const [pick, setPick] = useState<string[]>([])
  const packages = pick.length ? allPkgs.filter(p => pick.includes(p.id)) : allPkgs
  const ck = (k: number) => allPkgs.indexOf(packages[k])
  const [only, setOnly] = useState(true)
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
  // Theo khối (giống So sánh trường): nhóm theo loại CT, trong mỗi loại là các khối, mỗi phần (chủ đề / HP1, HP2…) một hàng; mỗi gói một cột.
  // Hàng cả các gói giống nhau: chữ xám; ô khác gói đầu: tô vàng.
  const modAt = (p: string, t: string, g: number, s: number) => its.find(i => i.package_id === p && i.track_code === t && i.grade === g && i.slot === s)?.module_id ?? ''
  const nTopics = (p: string, t: string, g: number) => { const ms = new Set(its.filter(i => i.package_id === p && i.track_code === t && i.grade === g).map(i => i.module_id))
    if (!ms.size) return -1
    return topics.filter(x => ms.has(x.module_id) && x.grade === g && x.active !== false && !skips.some(s => s.package_id === p && s.topic_id === x.id)).length }
  const groups = tracks.map(t => {
    const mine = its.filter(i => i.track_code === t.code)
    const val = (p: string, g: number, s: number) => s ? modAt(p, t.code, g, s) : String(nTopics(p, t.code, g))
    const gs = grades.filter(g => mine.some(i => i.grade === g)).map(g => {
      const slots = t.use_modules === false ? [0] : [...new Set(mine.filter(i => i.grade === g).map(i => i.slot))].sort((x, y) => x - y)
      const rows = slots.map(s => { const vs = packages.map(p => val(p.id, g, s)); return { s, vs, same: vs.every(v => v === vs[0]) } })
        .filter(r => !only || !r.same)
      return { g, rows }
    }).filter(x => x.rows.length)
    return { t, gs, n: gs.reduce((x, y) => x + y.rows.length, 0) }
  }).filter(x => x.n)
  const cellTxt = (v: string, s: number) => s ? (v ? modName(v) : <span className="sub">—</span>) : v === '-1' ? <span className="sub">—</span> : `${v} chủ đề`
  // In: chỉ in bảng so sánh (trang có quy tắc in riêng cho giấy chứng nhận ẩn mọi thứ khác)
  const printCmp = () => { document.body.classList.add('cmpprinting'); window.print(); setTimeout(() => document.body.classList.remove('cmpprinting'), 500) }
  return <>
    {filter(<>
      <label className="field inline"><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} /> Chỉ hiện điểm khác nhau</label>
      <span className="lvlab">Gói</span>
      <div style={{ flex: '0 0 220px', width: 220 }}><MultiSelect compact value={pick} onChange={setPick} options={allPkgs.map(p => [p.id, p.name] as [string, string])}
        placeholder="Tất cả gói" ariaLabel="Chọn gói để so sánh" /></div>
      <button type="button" onClick={printCmp}>In / Xuất PDF</button>
    </>)}
    <div className="cmpprint">
    <h3 className="printonly">So sánh các gói STEM · {name} · theo {by === 'mod' ? 'học phần' : 'khối'}</h3>
    <FitScreen className="fsbox">
      {by === 'mod' ? <table className="table cmptbl cmplined cmpmodt">
        <thead><tr><th>Học phần · {name}</th>{packages.map((p, k) => <th key={p.id} className="pkgth" style={pkgTh(pkgColor(p, ck(k)))}>{p.name}</th>)}</tr></thead>
        {sections.map(({ t, rows }) => <tbody key={t.code}>
          <tr className="cmpgrp"><td colSpan={packages.length + 1}>{chip(t.code)} {t.name}</td></tr>
          {rows.map(({ m }) => <tr key={m}><td>{t.use_modules === false ? 'Chủ đề theo khối' : modName(m)}</td>
            {packages.map((p, k) => <td key={p.id} style={pkgTd(pkgColor(p, ck(k)))}>{has(p.id, m) ? 'Có' : <span className="sub">—</span>}</td>)}</tr>)}
        </tbody>)}
      </table>
      : !groups.length ? <p className="sub">{only ? 'Các gói đang chọn giống nhau ở các khối này.' : 'Chưa có học phần nào ở các khối này.'}</p>
      : <table className="table cmptbl cmpk2">
        <thead><tr><th>Loại CT</th><th>Khối</th><th>Phần</th>{packages.map((p, k) => <th key={p.id} className="pkgth" style={pkgTh(pkgColor(p, ck(k)))} title={p.description || undefined}>{p.name}</th>)}</tr></thead>
        {groups.map(({ t, gs, n }) => <tbody key={t.code}>{gs.flatMap(({ g, rows }, gi) => rows.map((r, ri) => <tr key={g + '-' + r.s} className={(r.same ? 'same' : '') + (ri === 0 && gi > 0 ? ' k2g' : '')}>
          {gi === 0 && ri === 0 && <td rowSpan={n} className="k2t">{chip(t.code)}<b>{t.name}</b></td>}
          {ri === 0 && <td rowSpan={rows.length} className="k2k">{gradeName(g)}</td>}
          <td className="k2p">{r.s ? 'HP' + r.s : 'Chủ đề'}</td>
          {r.vs.map((v, k) => <td key={k} className={'k2v' + (!r.same && v !== r.vs[0] ? ' k2d' : '')}>{cellTxt(v, r.s)}</td>)}
        </tr>))}</tbody>)}
      </table>}
    </FitScreen>
    {by === 'grade' && groups.length > 0 && <p className="sub framefoot cmplegend"><span className="cmpnote"><span className="k2sw" /> Khác {packages[0]?.name}. Chữ xám: các gói giống nhau.</span></p>}
    </div>
  </>
}

type Draft = Record<string, string>   // `${track}|${khối}|${HP}` → học phần ('' = khối đã tick, chưa chọn học phần)
const dk = (t: string, g: number, sl: number) => `${t}|${g}|${sl}`
function PackageForm({ p, tracks, items, skips, modules, topics, onCancel, onSaved, slot, defColor, auto }: {
  slot?: HTMLElement | null; defColor: string; auto: (p: ProgramPackage, color: string) => React.ReactNode; p: ProgramPackage & { copyFrom?: string; tab?: string }; tracks: StemTrack[]; items: PackageItem[]; skips: PackageSkip[]; modules: ProgramModule[]; topics: ProgramTopic[]
  onCancel: () => void; onSaved: (id?: string) => void
}) {
  const [f, setF] = useState({ ...p, card_tagline: p.card_tagline ?? '', card_highlights: p.card_highlights?.length ? [...p.card_highlights] : [], card_footer: p.card_footer ?? '' })
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)
  const [sugOpen, setSugOpen] = useState(false)   // danh sách gợi ý dòng nổi bật   // dòng nổi bật đang kéo để đổi thứ tự
  const color = f.color || defColor
  const hl = f.card_highlights
  const setHl = (v: string[]) => setF({ ...f, card_highlights: v })
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
    const row = { code: f.code.trim(), name: f.name, description: f.description, sort: Number(f.sort) || 0, active: f.active,
      color: f.color || null, card_tagline: f.card_tagline.trim(), card_highlights: hl.map(x => x.trim()).filter(Boolean), card_footer: f.card_footer.trim() }
    const { data, error } = f.id ? await supabase.from('program_packages').update(row).eq('id', f.id).select('id')
      : await supabase.from('program_packages').insert(row).select('id')
    if (error && /card_|'color'/.test(error.message)) { setBusy(false); return setErr('Hãy chạy migration 169 trên Supabase để lưu thẻ giới thiệu và màu gói.') }
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
  // Gợi ý dòng nổi bật từ nội dung gói đang sửa: loại chỉ có chủ đề thì tên loại + khối; loại chia học phần thì từng học phần + khối
  const sugg = tracks.flatMap(t => {
    const gs = gradesOf(t.code)
    if (!gs.length) return []
    if (flat(t)) return [`${t.name} ${fmtGrades(gs, 'khối ')}`]
    const ids = [...new Set(keysOf(t.code).map(k => draft[k]).filter(Boolean))]
    return ids.map(id => `${modules.find(m => m.id === id)?.name ?? '?'} ${fmtGrades([...new Set(keysOf(t.code).filter(k => draft[k] === id).map(k => Number(k.split('|')[1])))].sort((a, b) => a - b), 'khối ')}`)
  }).filter(x => !hl.includes(x))
  const moveHl = (from: number, to: number) => { if (from === to) return; const v = [...hl]; const [x] = v.splice(from, 1); v.splice(to, 0, x); setHl(v) }
  return <>
    {err && <p className="warnline" role="alert">{err}</p>}
    {/* Thông tin gói và Thẻ giới thiệu bên trái; màu hiển thị và xem trước thẻ ở cột phải, ngang cả hai khung */}
    <section className="panel pkfpanel pkftop"><div className="pkfleft">
    <div>
      <h4 style={{ margin: '0 0 10px' }}>Thông tin gói</h4>
      <div className="formgrid">
        <label className="field"><span>Mã gói *</span><input value={f.code} maxLength={20} placeholder="VD: 5T" onChange={e => setF({ ...f, code: e.target.value })} /></label>
        <label className="field"><span>Tên gói *</span><input value={f.name} maxLength={120} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Thứ tự</span><input type="number" min={0} value={f.sort} onChange={e => setF({ ...f, sort: Number(e.target.value) })} /></label>
        <label className="field"><span>Trạng thái</span><select value={f.active ? 'on' : 'off'} onChange={e => setF({ ...f, active: e.target.value === 'on' })}>
          <option value="on">Đang dùng</option><option value="off">Ngừng dùng</option></select></label>
        <label className="field wide"><span>Mô tả (gói khác các gói khác ở đâu)</span><textarea rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
      </div>
    </div>
    <div className="pkfsep">
      <h4 style={{ margin: '0 0 8px' }}>Thẻ giới thiệu <small className="sub" style={{ fontWeight: 400 }}>· hiện trên trang Gói STEM; KDI tự viết, để trống cả ba mục thì thẻ hiện nội dung tự động</small></h4>
      <div className="pkfcard">
          <label className="field"><span>Câu giới thiệu ngắn</span><input value={f.card_tagline} maxLength={300} placeholder="VD: Đa dạng học phần trải nghiệm" onChange={e => setF({ ...f, card_tagline: e.target.value })} /></label>
          <div className="field" style={{ marginTop: 10 }}><span>Các dòng nổi bật <small className="sub" style={{ fontWeight: 400 }}>(mỗi dòng một ý, kéo ⠿ để đổi thứ tự, tối đa 8 dòng)</small></span>
            {hl.map((h, k) => <div key={k} className={'pkfhl' + (drag === k ? ' drag' : '')} onDragOver={e => { if (drag !== null) { e.preventDefault(); if (drag !== k) { moveHl(drag, k); setDrag(k) } } }}>
              <span className="pkfgrip" draggable onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDrag(k) }} onDragEnd={() => setDrag(null)} title="Kéo để đổi thứ tự" aria-hidden="true">⠿</span>
              <input value={h} maxLength={160} aria-label={`Dòng nổi bật ${k + 1}`} onChange={e => setHl(hl.map((x, i) => i === k ? e.target.value : x))} />
              <button type="button" className="linkbtn" aria-label={`Xoá dòng ${k + 1}`} onClick={() => setHl(hl.filter((_, i) => i !== k))}>×</button></div>)}
            {hl.length < 8 && <div className="pkfadd">
              <button type="button" className="linkbtn" onClick={() => setHl([...hl, ''])}>+ Thêm dòng</button>
              {sugg.length > 0 && <span className="pkfsugg" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSugOpen(false) }}>
                <button type="button" className="linkbtn" aria-expanded={sugOpen} onClick={() => setSugOpen(!sugOpen)}>+ Chọn từ nội dung gói ▾</button>
                {sugOpen && <span className="pkfsugl" role="listbox">{sugg.map(x => <button key={x} type="button" role="option" aria-selected={false}
                  onClick={() => { setHl([...hl, x]); setSugOpen(false) }}>{x}</button>)}</span>}</span>}
            </div>}
          </div>
          <label className="field" style={{ marginTop: 10 }}><span>Dòng cuối thẻ <small className="sub" style={{ fontWeight: 400 }}>(giá, ghi chú…; để trống thì ẩn)</small></span>
            <input value={f.card_footer} maxLength={200} placeholder="VD: Từ 180.000đ/HS/năm" onChange={e => setF({ ...f, card_footer: e.target.value })} /></label>
      </div>
    </div>
    </div>
    <aside className="pkfaside">
          <div className="pkfpvl">Màu hiển thị</div>
          <div className="pkfsws" role="radiogroup" aria-label="Màu hiển thị" title="Màu đầu thẻ, cột gói khi so sánh, viền chi tiết">
            {SWATCH.map(c => <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} className={'pkfsw' + (color === c ? ' on' : '')} style={{ background: c }} onClick={() => setF({ ...f, color: c })} />)}
            <label className={'pkfswc' + (!SWATCH.includes(color) ? ' on' : '')}>{!SWATCH.includes(color) && <i style={{ background: color }} />}Màu khác…
              <input type="color" value={color} onChange={e => setF({ ...f, color: e.target.value })} /></label>
            {f.color && <button type="button" className="linkbtn" onClick={() => setF({ ...f, color: null })}>Màu mặc định</button>}
          </div>
          <div className="pkfpvl" style={{ marginTop: 12 }}>Xem trước thẻ</div>
          <PkgCard p={f} color={color} auto={auto(f, color)} />
    </aside>
    </section>
    <section className="panel pkfpanel">
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
    {(() => { const btns = <>
      <button type="button" className="primary" onClick={save} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      <button type="button" onClick={onCancel} disabled={busy}>Huỷ</button></>
      return slot ? createPortal(btns, slot) : <div className="actions" style={{ marginTop: 12 }}>{btns}</div> })()}
  </>
}

/** Nội dung một chủ đề (xem nhanh trong khung bên phải): Thông tin chung và 6 mục nằm trong TopicContents */
function TopicView({ t, admin }: { t: ProgramTopic; mod?: string; sgk?: boolean; admin: boolean }) {
  return <TopicContents topic={t} admin={admin} />
}
