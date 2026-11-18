import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStemTracks, type StemTrack } from '../lib/stemTracks'
import { fmtGrades, gradeName } from '../lib/eduLevels'
import { frameErr, loadFrame, loadPackages, type PackageItem, type ProgramModule, type ProgramPackage, type ProgramTopic } from '../lib/programFrame'
import { PROGRAM_COLOR } from './teacher/common'
import { HeadAction } from '../components/PageFrame'
import { DataTable, type Col } from '../components/DataTable'
import { DetailHead } from '../components/DetailHead'
import { ElView } from '../components/ElView'
import { ActionBar, type Act } from '../components/ActionBar'
import { RowMenu } from '../components/ProTools'
import { Chip } from './dist/Editor'

// Gói STEM theo khung chương trình (148): mỗi gói gồm các loại chương trình; mỗi loại, mỗi khối chọn học phần ở từng vị trí
// (Học phần 1, Học phần 2…). Xem một gói, so sánh các gói (tô màu chỗ khác nhau). Chỉ KDI sửa.

const GRADES = Array.from({ length: 12 }, (_, i) => i + 1)
const chip = (code: string) => <span className="progchip" style={{ background: PROGRAM_COLOR[code], color: '#fff' }}>{code}</span>
const DIFF = { background: 'color-mix(in srgb, #f59e0b 18%, transparent)' }
const keyOf = (t: string, g: number, s: number) => `${t}|${g}|${s}`
const MAXN = 4   // số học phần hiện sẵn trong một ô, còn lại bấm để mở

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
  const [openRows, setOpenRows] = useState<string[]>([])   // hàng chương trình đang mở hết danh sách học phần
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
  const topicsIn = (moduleId: string, g: number) => topics.filter(t => t.module_id === moduleId && t.grade === g && t.active).sort((a, b) => a.seq - b.seq)
  const statOf = (pkg: string, t?: string) => {
    const its = items.filter(i => i.package_id === pkg && (!t || i.track_code === t))
    return { its, mods: [...new Set(its.map(i => i.module_id))], topics: its.reduce((x, i) => x + topicsIn(i.module_id, i.grade).length, 0),
      tracks: [...new Set(its.map(i => i.track_code))] }
  }
  const pkgMenu = (p: ProgramPackage) => [
    { label: 'Xem chi tiết', onClick: () => { setMsg(''); setOpenId(p.id) } }, { label: 'Sửa thông tin', onClick: () => setEditPkg(p) },
    { label: 'Sao chép thành gói mới', onClick: () => setEditPkg({ ...p, id: '', code: '', name: p.name + ' (bản sao)', sort: p.sort + 1, copyFrom: p.id }) },
    { label: 'Xoá', danger: true, onClick: () => delPkg(p) }]

  if (cur) return <PackageDetail pkg={cur} tracks={active} admin={admin} items={items} modules={modules} topics={topics} msg={msg} setMsg={setMsg}
    diffKeys={diffKeys} diffTracks={diffTracks(cur.id)} slotsOf={slotsOf} topicsIn={topicsIn} onBack={() => { setOpenId(null); setMsg('') }}
    acts={admin ? pkgMenu(cur).slice(1).map((a, k) => ({ key: String(k), label: a.label, kind: a.danger ? 'danger' : undefined, onClick: a.onClick } as Act)) : []}
    onChanged={reload} />

  const allMods = new Set(items.filter(i => live.some(p => p.id === i.package_id)).map(i => i.module_id))
  const allTopics = topics.filter(t => t.active && allMods.has(t.module_id)).length
  const n = packages.length
  const cellS = { padding: '10px 12px', borderTop: '1px solid var(--line)', borderLeft: '1px solid var(--line)', minWidth: 0 } as const
  const labelS = { ...cellS, borderLeft: 0, background: 'var(--card, #fff)' } as const
  const DIFFC = { background: '#fff8ea', boxShadow: 'inset 3px 0 0 #f2c97d' }
  const perGrade = (list: ProgramTopic[]) => { const g = new Set(list.map(t => t.grade)); return g.size ? Math.round(list.length / g.size) : 0 }
  return <>
    <HeadAction>
      <button type="button" onClick={() => setCompare(true)} disabled={live.length < 2}>So sánh các gói</button>
      {admin && <button type="button" className="primary ttadd" onClick={() => setEditPkg({ id: '', code: '', name: '', description: '', sort: packages.reduce((x, p) => Math.max(x, p.sort), 0) + 1, active: true })}>+ Thêm gói</button>}
    </HeadAction>
    {msg && <p className="msg" role="status">{msg}</p>}
    <div className="pkgkpi">
      {([['▣', live.length, 'Gói STEM', 'đang dùng', 'var(--navy)'], ['◆', active.length, 'Loại chương trình', 'CT1–CT' + active.length, 'var(--navy)'],
        ['▤', allMods.size, 'Học phần', 'dùng trong các gói', 'var(--navy)'], ['●', allTopics, 'Chủ đề', 'trong các học phần', 'var(--navy)']] as const).map(([ic, v, l, sub, c]) =>
        <div key={l} style={{ '--k': c } as React.CSSProperties}><span className="ic">{ic}</span><div><b>{v}</b><span>{l}</span><small>{sub}</small></div></div>)}
    </div>
    {!n ? <p className="sub">Chưa có gói STEM.</p> :
    <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `220px repeat(${n}, minmax(200px, 1fr))` }}>
        {/* Hàng 1: tên gói và số liệu */}
        <div style={{ ...labelS, borderTop: 0, display: 'flex', alignItems: 'flex-end' }}><b>Loại chương trình (CT)</b></div>
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
          <div key={t.code} style={{ ...labelS, boxShadow: `inset 4px 0 0 ${PROGRAM_COLOR[t.code] ?? 'var(--line)'}`, paddingLeft: 16 }}>{chip(t.code)}<br /><b>{t.name}</b><br /><small className="sub">{t.use_modules === false ? 'Chỉ có chủ đề theo khối' : 'Chia theo học phần'}</small></div>,
          ...packages.map(p => {
            const x = statOf(p.id, t.code)
            const diff = diffTracks(p.id).includes(t.code)
            const tl = x.its.flatMap(i => topicsIn(i.module_id, i.grade))
            const gs = [...new Set(x.its.map(i => i.grade))].sort((a, b) => a - b)
            return <div key={t.code + p.id} style={{ ...cellS, ...(diff ? DIFFC : {}) }}>
              {!x.its.length ? <small className="sub">Không có trong gói</small>
                : t.use_modules === false ? <><b>{x.topics} chủ đề</b><br /><small className="sub">{perGrade(tl) ? `${perGrade(tl)} chủ đề / khối · ` : ''}{fmtGrades(gs)}</small></>
                : <><b>{x.mods.length} học phần · {x.topics} chủ đề</b>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>{(openRows.includes(t.code) ? x.mods : x.mods.slice(0, MAXN)).map(id => <li key={id}><small>{modName(id)}</small></li>)}</ul>
                  {x.mods.length > MAXN && <button type="button" className="namelink" style={{ fontSize: 12, marginTop: 4, color: "var(--primary)" }} onClick={() => setOpenRows(openRows.includes(t.code) ? openRows.filter(c => c !== t.code) : [...openRows, t.code])}>
                    {openRows.includes(t.code) ? 'Thu gọn' : `+ ${x.mods.length - MAXN} học phần`}</button>}</>}
            </div>
          })])}
      </div>
    </div>}
    <p className="sub" style={{ margin: '10px 0 0', fontSize: 13 }}>Cấu trúc: <b>Gói STEM</b> › <b>Loại chương trình</b> › <b>Học phần</b> (theo khối) › <b>Chủ đề</b>.
      {diffKeys.size ? ` Các gói có cùng nội dung, chỉ khác nhau ở ${[...new Set([...diffKeys].map(k => k.split('|')[0]))].join(', ')}; ô nền vàng nhạt là phần khác biệt giữa các gói.` : ''}</p>
    <p className="tablenote sub">Mỗi cột là một gói, mỗi hàng là một loại chương trình. Bấm vào tên gói để xem học phần, chủ đề theo từng khối.</p>
  </>
}

function PackageDetail({ pkg, tracks, admin, items, modules, topics, msg, setMsg, diffKeys, diffTracks, slotsOf, topicsIn, onBack, acts, onChanged }: {
  pkg: ProgramPackage; tracks: StemTrack[]; admin: boolean; items: PackageItem[]; modules: ProgramModule[]; topics: ProgramTopic[]
  msg: string; setMsg: (m: string) => void; diffKeys: Set<string>; diffTracks: string[]; slotsOf: (t: string, pkgs: string[]) => number[]
  topicsIn: (moduleId: string, g: number) => ProgramTopic[]; onBack: () => void; acts: Act[]; onChanged: () => void
}) {
  const mine = items.filter(i => i.package_id === pkg.id)
  const [code, setCode] = useState('')   // '' = xem tổng quan mọi loại chương trình
  const [sel, setSel] = useState<{ t: string; g: number } | null>(null)
  const [edit, setEdit] = useState(false)
  const [grade, setGrade] = useState<number | null>(null)
  const track = tracks.find(t => t.code === code)
  const its = mine.filter(i => i.track_code === track?.code)
  const grades = [...new Set(its.map(i => i.grade))].sort((a, b) => a - b)
  const mod = (id: string) => modules.find(m => m.id === id)
  const nTopics = (list: PackageItem[]) => list.reduce((x, i) => x + topicsIn(i.module_id, i.grade).length, 0)
  const periods = (i: PackageItem) => mod(i.module_id)?.periods ?? topicsIn(i.module_id, i.grade).reduce((x, t) => x + (t.periods || 0), 0)
  const allGrades = [...new Set(mine.map(i => i.grade))].sort((a, b) => a - b)
  const selTrack = sel ? tracks.find(t => t.code === sel.t) : undefined
  const selIts = sel ? mine.filter(i => i.track_code === sel.t && i.grade === sel.g).sort((a, b) => a.slot - b.slot) : []
  const Overview = () => !allGrades.length ? <p className="sub">Gói chưa có học phần.</p> : <>
    <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
      <div className="pkggrid" style={{ gridTemplateColumns: `180px repeat(${allGrades.length}, minmax(92px, 1fr))` }}>
        <div className="hd lb"><b>Loại chương trình (CT)</b></div>
        {allGrades.map(g => <div key={g} className="hd">{gradeName(g)}</div>)}
        {tracks.map(t => { const c = PROGRAM_COLOR[t.code] ?? 'var(--line)'
          const slots = t.use_modules === false ? [0] : slotsOf(t.code, [pkg.id])
          return [
          <div key={t.code} className="lb" style={{ boxShadow: `inset 4px 0 0 ${c}`, gridRow: `span ${slots.length || 1}` }}>
            {chip(t.code)}<b>{t.name}</b></div>,
          ...slots.flatMap(sl => allGrades.map(g => {
            const list = mine.filter(i => i.track_code === t.code && i.grade === g && (sl === 0 || i.slot === sl))
            const on = sel?.t === t.code && sel.g === g
            return <button key={t.code + sl + '-' + g} type="button" className={'gc' + (on ? ' on' : '')} aria-pressed={on} disabled={!list.length}
              title={`${t.code} · ${gradeName(g)}: bấm để xem chủ đề`} onClick={() => setSel(on ? null : { t: t.code, g })}>
              {!list.length ? <span className="sub">—</span>
                : sl === 0 ? <span className="num"><b>{nTopics(list)}</b> chủ đề</span>
                : <span className="hp">{mod(list[0].module_id)?.name ?? '?'} <i>(HP{sl})</i></span>}
            </button>
          }))] })}
      </div>
    </div>
    {sel && selTrack && <div className="panel" style={{ marginTop: 10, padding: '10px 12px' }}>
      <div className="bar" style={{ margin: '0 0 6px' }}><b>{chip(selTrack.code)} {selTrack.name} · {gradeName(sel.g)}</b>
        <button type="button" className="namelink" style={{ fontSize: 12 }} onClick={() => setSel(null)}>Đóng</button></div>
      {selTrack.use_modules === false
        ? <TopicChips list={selIts.flatMap(i => topicsIn(i.module_id, sel.g))} max={99} />
        : selIts.map(i => <div key={i.slot} style={{ marginTop: 4 }}><b>Học phần {i.slot}: {mod(i.module_id)?.name ?? '?'}</b> <small className="sub">· {periods(i) || '—'} tiết</small>
          <TopicChips list={topicsIn(i.module_id, sel.g)} max={99} /></div>)}
    </div>}
  </>
  return <>
    <DetailHead back="Gói STEM" onBack={onBack} title={pkg.name}
      extra={<Chip tone={pkg.active ? 'good' : ''}>{pkg.active ? 'Đang dùng' : 'Ngừng dùng'}</Chip>} />
    <div className="bar"><small className="sub">{pkg.description || 'Chưa có mô tả.'}</small>
      {acts.length > 0 && <div className="tools"><ActionBar items={acts} /></div>}</div>
    {msg && <p className="msg" role="status">{msg}</p>}
    <div className="pkgkpi">
      {tracks.map(t => { const x = mine.filter(i => i.track_code === t.code)
        return <div key={t.code} role="button" tabIndex={0} className={'kpibtn' + (code === t.code ? ' on' : '')} onClick={() => { setCode(code === t.code ? '' : t.code); setGrade(null); setEdit(false) }} style={{ '--k': PROGRAM_COLOR[t.code] ?? 'var(--line)', borderTop: `3px solid ${PROGRAM_COLOR[t.code] ?? 'var(--line)'}` } as React.CSSProperties}>
          <span className="ic" style={{ fontSize: 12, fontWeight: 700 }}>{t.code}</span>
          <div><span>{t.name}</span><small>{t.use_modules === false ? '' : new Set(x.map(i => i.module_id)).size + ' học phần · '}{nTopics(x)} chủ đề</small></div></div> })}
    </div>
    <div className="distfilter" role="group" aria-label="Loại chương trình">
      <button type="button" className={'distfchip' + (!track ? ' on' : '')} aria-pressed={!track} onClick={() => { setCode(''); setEdit(false) }}>Tổng quan</button>
      {tracks.map(t => <button key={t.code} type="button" className={'distfchip' + (t.code === track?.code ? ' on' : '')}
        aria-pressed={t.code === track?.code} onClick={() => { setCode(t.code); setGrade(null) }}>{t.code} · {t.name}</button>)}
      {admin && track && track.use_modules !== false && <button type="button" className={'distfchip' + (edit ? ' on' : '')} aria-pressed={edit} onClick={() => setEdit(!edit)}>{edit ? 'Xong sửa' : 'Sửa học phần'}</button>}
    </div>
    {!track ? <Overview /> : (edit
      ? <TrackGrid pkg={pkg} track={track} admin={admin} items={items} modules={modules.filter(m => m.track_code === track.code)} topics={topics}
        slots={slotsOf(track.code, [pkg.id])} diffKeys={new Set<string>()} onChanged={onChanged} onErr={setMsg} />
      : <>
        <div className="distfilter" role="group" aria-label="Khối">
          <button type="button" className={'distfchip' + (grade === null ? ' on' : '')} onClick={() => setGrade(null)}>Tất cả khối <b>{grades.length}</b></button>
          {grades.map(g => <button key={g} type="button" className={'distfchip' + (grade === g ? ' on' : '')} aria-pressed={grade === g} onClick={() => setGrade(g)}>{gradeName(g)}</button>)}
        </div>
        {!grades.length ? <p className="sub">Gói chưa có học phần của {track.code}.{admin ? ' Bấm "Sửa học phần".' : ''}</p>
          : <DataTable id={'pkg-grades-' + (track.use_modules === false ? 'flat' : 'mods')} className={grade === null ? 'slt ttdense' : 'slt'} simple noTools rows={grades.filter(g => grade === null || g === grade)} rowKey={g => String(g)} noun="khối"
            cols={[
              { key: 'g', label: 'Khối', fixed: true, thClass: 'c-no', text: g => gradeName(g), cell: g => <button type="button" className="namelink" title="Xem chủ đề của khối" onClick={() => setGrade(grade === g ? null : g)}>{gradeName(g)}</button> },
              ...(track.use_modules === false
                ? [{ key: 'tp', label: 'Chủ đề', fixed: true, cell: (g: number) => { const tl = its.filter(i => i.grade === g).flatMap(i => topicsIn(i.module_id, g))
                  return grade === null ? <span className="oneline" style={{ color: "var(--muted)" }} title={tl.map(t => t.title).join(', ')}>{tl.length ? tl.map(t => t.title).join(', ') : 'Chưa có chủ đề'}</span> : <TopicChips list={tl} max={99} /> } }]
                : slotsOf(track.code, [pkg.id]).map(sl => ({ key: 's' + sl, label: 'Học phần ' + sl, fixed: true, cell: (g: number) => {
                  const i = its.find(x => x.grade === g && x.slot === sl)
                  if (!i) return <small className="sub">—</small>
                  const tl = topicsIn(i.module_id, g)
                  return grade === null
                    ? <span className="oneline"><b>{mod(i.module_id)?.name ?? '?'}</b> <small className="sub">· {periods(i) || '—'} tiết · {tl.length} chủ đề</small></span>
                    : <div><b>{mod(i.module_id)?.name ?? '?'}</b> <small className="sub">· {periods(i) || '—'} tiết</small><TopicChips list={tl} max={99} /></div> } }))),
              { key: 'n', label: 'Số chủ đề', text: g => String(nTopics(its.filter(i => i.grade === g))), cell: g => nTopics(its.filter(i => i.grade === g)) },
              { key: 'p', label: 'Tiết / năm', text: g => String(its.filter(i => i.grade === g).reduce((x, i) => x + periods(i), 0)), cell: g => its.filter(i => i.grade === g).reduce((x, i) => x + periods(i), 0) || <small className="sub">—</small> },
            ] as Col<number>[]} />}
      </>)}
    <p className="sub" style={{ margin: '10px 0 0', fontSize: 13 }}>{track ? 'Bấm vào tên khối để xem đầy đủ chủ đề của khối đó.' : 'Mỗi cột là một khối, mỗi hàng là một loại chương trình. Bấm vào một ô để xem chủ đề; chọn một loại chương trình để xem dạng bảng.'} Chủ đề soạn ở tab "Khung chương trình".</p>
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
        <option value="on">Đang dùng</option><option value="off">Ngừng dùng</option></select></label>
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
