import React, { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStemTracks, SCHEDULE_MODE_NAME, type StemTrack, trackLabel } from '../lib/stemTracks'
import { fmtGrades, gradeName, useEduLevels } from '../lib/eduLevels'
import { frameErr, loadFrame, type MaterialGroup, type ProgramModule, type ProgramTopic } from '../lib/programFrame'
import { PROGRAM_COLOR } from './teacher/common'
import { DataTable, SideSplit, type Col } from '../components/DataTable'
import { GroupTree, inGroup, useGroupSel } from '../components/GroupTree'
import { TreeHead } from '../components/TreeHead'
import { HeadAction } from '../components/PageFrame'
import { DetailHead } from '../components/DetailHead'
import { ElView } from '../components/ElView'
import { ActionBar, type Act } from '../components/ActionBar'
import { SubjectMulti, SubjectPicker } from '../components/Pickers'
import { Chip } from './dist/Editor'
import { OneLine } from '../components/LongCell'
import { FitScreen } from '../components/FitScreen'
import { Drawer } from '../components/Drawer'

// Khung chương trình (147): KDI chọn loại chương trình → danh sách học phần → chủ đề theo từng khối.
// Học phần dùng chung giữa các gói và các khối (CT1, CT4 có một học phần "CHUNG"); mỗi chủ đề thuộc một khối, có thứ tự cố định
// (trường không đổi được thứ tự). Xem theo khối: toàn bộ chủ đề của một khối, theo thứ tự học phần → chủ đề, kèm tổng số tiết.

const chip = (code: string) => <span className="progchip" style={{ background: PROGRAM_COLOR[code], color: '#fff' }}>{trackLabel(code)}</span>
const pill = (on: boolean) => <Chip tone={on ? 'good' : ''}>{on ? 'Đang dùng' : 'Ngừng dùng'}</Chip>
const sum = (ts: ProgramTopic[]) => ts.reduce((s, t) => s + (t.periods || 0), 0)

type TopicDraft = Omit<ProgramTopic, 'id'> & { id?: string }

export function ProgramFrame() {
  const { tracks } = useStemTracks()
  const active = tracks.filter(t => t.active !== false)
  const [admin, setAdmin] = useState(false)
  const [code, setCode] = useState('')
  const [modules, setModules] = useState<ProgramModule[]>([])
  const [topics, setTopics] = useState<ProgramTopic[]>([])
  const [msg, setMsg] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [editMod, setEditMod] = useState<ProgramModule | null>(null)
  const [editTopic, setEditTopic] = useState<TopicDraft | null>(null)
  const [viewId, setViewId] = useState<string | null>(null)
  const [treeSel, setTreeSel] = useState<Record<string, string>>({})
  const reload = () => loadFrame().then(r => { setModules(r.modules); setTopics(r.topics); setMsg(r.error) })
  useEffect(() => { supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data)); reload() }, [])
  const track = code === '*' ? undefined : tracks.find(t => t.code === code) ?? active[0]
  const mods = modules.filter(m => m.track_code === track?.code)
  const topicsOf = (id: string) => topics.filter(t => t.module_id === id).sort((a, b) => a.grade - b.grade || a.seq - b.seq)
  const trackTopics = topics.filter(t => mods.some(m => m.id === t.module_id))
  const grades = [...new Set(trackTopics.map(t => t.grade))].sort((a, b) => a - b)

  async function delModule(m: ProgramModule) {
    if (!confirm(`Xoá học phần "${m.name}"? Chỉ xoá được khi học phần chưa có chủ đề.`)) return
    const { data, error } = await supabase.from('program_modules').delete().eq('id', m.id).select('id')
    if (error) return setMsg(frameErr(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return setMsg(frameErr('row-level'))
    setOpenId(null); setMsg(''); reload()
  }
  async function delTopic(t: ProgramTopic) {
    if (!confirm(`Xoá chủ đề "${t.title}" (${gradeName(t.grade)})?`)) return
    const { data, error } = await supabase.from('program_topics').delete().eq('id', t.id).select('id')
    if (error) return setMsg(frameErr(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return setMsg(frameErr('row-level'))
    setViewId(null); setMsg(''); reload()
  }
  // Kéo thả đổi thứ tự: học phần (sort) trong một loại, chủ đề (seq) trong một khối
  async function reorder(table: 'program_modules' | 'program_topics', col: 'sort' | 'seq', list: { id: string }[], from: string, to: string, cur: (x: any) => number) {
    const ids = list.map(x => x.id), i = ids.indexOf(from), j = ids.indexOf(to)
    if (i < 0 || j < 0 || i === j) return
    const next = [...list]; const [x] = next.splice(i, 1); next.splice(j, 0, x)
    const res = await Promise.all(next.map((r, k) => cur(r) === k + 1 ? null : supabase.from(table).update({ [col]: k + 1 }).eq('id', r.id)))
    const e = res.find(r => r?.error)?.error
    if (e) setMsg(frameErr(e.message + ' ' + (e.code ?? '')))
    reload()
  }
  const moveTopic = (list: ProgramTopic[]) => (from: string, to: string) => reorder('program_topics', 'seq', list, from, to, (t: ProgramTopic) => t.seq)
  const flat = track?.use_modules === false
  // Loại không chia học phần: chủ đề nằm trong học phần ẩn (học phần đầu tiên của loại; chưa có thì tạo "CHUNG")
  async function hiddenModule(): Promise<string | null> {
    if (mods[0]) return mods[0].id
    const { data, error } = await supabase.from('program_modules').insert({ track_code: track!.code, name: 'CHUNG', sort: 1 }).select('id')
    if (error || !data?.length) { setMsg(frameErr(error ? error.message + ' ' + (error.code ?? '') : 'row-level')); return null }
    reload(); return data[0].id
  }
  async function addFlatTopic(g: number) {
    const id = await hiddenModule(); if (!id) return
    const inG = trackTopics.filter(t => t.grade === g)
    setEditTopic({ module_id: id, grade: g, seq: inG.reduce((x, t) => Math.max(x, t.seq), 0) + 1, code: '', title: '', periods: 1, objectives: '', product: '', main_subject: null, subjects: [], textbook_ref: '', active: true, part: null })
  }


  // ----- Sửa học phần / chủ đề -----
  // ----- Chi tiết chủ đề, form sửa: mở bên phải cạnh bảng (split view), không chiếm cả trang -----
  const vt = viewId ? topics.find(t => t.id === viewId) : undefined
  const v = (x: string | null | undefined) => x ? <span style={{ whiteSpace: 'pre-line' }}>{x}</span> : <span className="sub">—</span>
  let drawer: React.ReactNode = null
  if (editMod) {
    drawer = <Drawer closeOnOutside={false} onClose={() => setEditMod(null)}
      title={<>{chip(editMod.track_code)} {editMod.id ? 'Sửa học phần' : 'Thêm học phần'}</>}>
      <ModuleForm m={editMod} onCancel={() => setEditMod(null)} onSaved={() => { setEditMod(null); reload() }} />
    </Drawer>
  } else if (editTopic) {
    const m = modules.find(x => x.id === editTopic.module_id)
    drawer = <Drawer closeOnOutside={false} onClose={() => setEditTopic(null)} onBack={editTopic.id && viewId ? () => setEditTopic(null) : undefined}
      title={<>{m && chip(m.track_code)} {editTopic.id ? 'Sửa chủ đề' : 'Thêm chủ đề'}</>}>
      <TopicForm t={editTopic} track={track} onCancel={() => setEditTopic(null)} onSaved={() => { setEditTopic(null); reload() }} />
    </Drawer>
  } else if (vt) {
    const m = modules.find(x => x.id === vt.module_id)
    const tr = tracks.find(t => t.code === m?.track_code)
    const acts: Act[] = admin ? [
      { key: 'edit', label: 'Sửa', icon: 'pencil', kind: 'primary', onClick: () => setEditTopic(vt) },
      { key: 'del', label: 'Xoá', icon: 'trash', kind: 'danger', onClick: () => delTopic(vt) },
    ] : []
    drawer = <Drawer onClose={() => setViewId(null)} title={<>{m && chip(m.track_code)} {vt.title} {pill(vt.active)}</>}
      actions={acts.length ? <ActionBar items={acts} /> : undefined}>
      <p className="sub" style={{ marginTop: 0 }}>{gradeName(vt.grade)} · Thứ tự {vt.seq} · {vt.periods} tiết{m && tr?.use_modules !== false ? ' · Học phần ' + m.name : ''}</p>
      <dl className="kv">
        <dt>Mã chủ đề</dt><dd>{v(vt.code)}</dd>
        <dt>Môn chủ trì</dt><dd>{v(vt.main_subject)}</dd>
        <dt>Môn phối hợp</dt><dd>{v(vt.subjects.join(', '))}</dd>
        <dt>Yêu cầu cần đạt</dt><dd>{v(vt.objectives)}</dd>
        <dt>Sản phẩm</dt><dd>{v(vt.product)}</dd>
        {tr?.schedule_mode === 'subject' && <><dt>Bài SGK liên quan</dt><dd>{v(vt.textbook_ref)}</dd></>}
      </dl>
    </Drawer>
  }

  // ----- Chi tiết học phần: chủ đề theo khối -----
  const cur = openId ? modules.find(m => m.id === openId) : undefined
  if (cur) {
    const ts = topicsOf(cur.id)
    const gs = [...new Set(ts.map(t => t.grade))]
    const nextSeq = (g: number) => ts.filter(t => t.grade === g).reduce((x, t) => Math.max(x, t.seq), 0) + 1
    const blank = (g: number): TopicDraft => ({ module_id: cur.id, grade: g, seq: nextSeq(g), code: '', title: '', periods: 1, objectives: '', product: '', main_subject: null, subjects: [], textbook_ref: '', active: true, part: null })
    const acts: Act[] = admin ? [
      { key: 'add', label: '+ Thêm chủ đề', kind: 'primary', onClick: () => setEditTopic(blank(gs[gs.length - 1] ?? 1)) },
      { key: 'edit', label: 'Sửa học phần', icon: 'pencil', onClick: () => setEditMod(cur) },
      { key: 'del', label: 'Xoá', icon: 'trash', kind: 'danger', onClick: () => delModule(cur) },
    ] : []
    return <>
      <DetailHead back="Khung chương trình" onBack={() => { setOpenId(null); setMsg('') }} title={<>{chip(cur.track_code)} {cur.name}</>} extra={pill(cur.active)} />
      <div className="bar"><small className="sub">{ts.length} chủ đề · {sum(ts)} tiết · {gs.length ? fmtGrades(gs) : 'chưa có khối'}{cur.description ? ' · ' + cur.description : ''}</small>
        {acts.length > 0 && <div className="tools"><ActionBar items={acts} /></div>}</div>
      {msg && <p className="msg" role="status">{msg}</p>}
      {!gs.length && <p className="sub">Học phần chưa có chủ đề.{admin ? ' Bấm "+ Thêm chủ đề".' : ''}</p>}
      {gs.length > 0 && <ModuleTopicTable ts={ts} grades={gs.sort((a, b) => a - b)} admin={admin} onOpen={t => { setMsg(''); setViewId(t.id) }}
        moveTopic={moveTopic} />}
      {drawer}
    </>
  }

  // ----- Danh sách: cây bên trái (Khối · Học phần › Khối · Loại CT › Học phần › Khối), bảng chủ đề bên phải, vừa một màn hình -----
  const all = code === '*'
  const sel = treeSel[all ? '*' : track?.code ?? ''] ?? (all ? active[0]?.code ?? '' : track?.code ?? '')
  const setSel = (k: string) => setTreeSel({ ...treeSel, [all ? '*' : track?.code ?? '']: k })
  const selGrade = (() => { const m = /\/(\d+)$/.exec(sel); return flat && m ? Number(m[1]) : null })()
  return <>
    {admin && track && !all && <HeadAction>{flat
      ? <button type="button" className="primary ttadd" onClick={() => addFlatTopic(selGrade ?? 1)}>+ Thêm chủ đề{selGrade ? ' ' + gradeName(selGrade) : ''}</button>
      : <button type="button" className="primary ttadd"
        onClick={() => setEditMod({ id: '', track_code: track.code, name: '', description: '', periods: null, sort: mods.reduce((x, m) => Math.max(x, m.sort), 0) + 1, active: true })}>+ Thêm học phần</button>}</HeadAction>}
    <div className="distfilter" role="group" aria-label="Loại chương trình">
      <button type="button" className={'distfchip' + (all ? ' on' : '')} aria-pressed={all} onClick={() => setCode('*')}>Tất cả loại CT</button>
      {active.map(t => { const n = t.use_modules === false
          ? topics.filter(x => modules.some(m => m.id === x.module_id && m.track_code === t.code)).length : modules.filter(m => m.track_code === t.code).length
        const on = !all && t.code === track?.code
        return <button key={t.code} type="button" className={'distfchip' + (on ? ' on' : '')} aria-pressed={on}
          title={t.use_modules === false ? n + ' chủ đề' : n + ' học phần'} onClick={() => setCode(t.code)}>{trackLabel(t.code)} · {t.name} <b>{n}</b></button> })}
    </div>
    {msg && <p className="msg" role="status">{msg}</p>}
    <FrameTree tracks={all ? active : track ? [track] : []} all={all} modules={modules} topics={topics} sel={sel} onSel={setSel}
      onOpenModule={id => { setMsg(''); setOpenId(id) }} onOpen={t => { setMsg(''); setViewId(t.id) }} />
    {track && !all && <p className="sub framefoot" title="Đổi thiết lập ở Danh mục → Loại chương trình">
      {flat ? 'Chương trình không chia học phần, chỉ có chủ đề theo khối' : 'Chương trình chia theo học phần'} · {track.school_pick_topics ? 'trường tự chọn chủ đề sẽ dạy' : 'trường học đủ các chủ đề'} · {track.school_arrange_ppct !== false ? 'trường tự xếp PPCT theo tuần' : 'PPCT theo mẫu KDI / Sở'} · {SCHEDULE_MODE_NAME[track.schedule_mode ?? 'timetable']}.</p>}
    {drawer}
  </>
}

type FNode = { key: string; label: React.ReactNode; sub?: string; count: number; dim?: boolean; kids?: FNode[] }
const keyOfTopic = (t: ProgramTopic, m: ProgramModule | undefined, flat: boolean) => flat ? `${m?.track_code}/${t.grade}` : `${m?.track_code}/${t.module_id}/${t.grade}`
const under = (k: string, sel: string) => k === sel || k.startsWith(sel + '/')

/** Khung chương trình dạng cây: trái là cây (đếm số chủ đề, dòng nhỏ là số tiết), phải là bảng chủ đề của mục đang chọn.
 *  Cả khung vừa một màn hình; cây và bảng cuộn riêng bên trong. */
function FrameTree({ tracks, all, modules, topics, sel, onSel, onOpenModule, onOpen }: {
  tracks: StemTrack[]; all: boolean; modules: ProgramModule[]; topics: ProgramTopic[]; sel: string; onSel: (k: string) => void
  onOpenModule: (id: string) => void; onOpen: (t: ProgramTopic) => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const modOf = useMemo(() => new Map(modules.map(m => [m.id, m])), [modules])
  const trOf = (code?: string) => tracks.find(t => t.code === code)
  const isFlat = (code?: string) => trOf(code)?.use_modules === false
  const ts = useMemo(() => topics.filter(t => t.active !== false && tracks.some(tr => tr.code === modOf.get(t.module_id)?.track_code)).map(t => {
    const m = modOf.get(t.module_id)!
    return { t, m, key: keyOfTopic(t, m, isFlat(m.track_code)) }
  }), [topics, tracks, modOf])
  const tiet = (l: { t: ProgramTopic }[]) => l.reduce((x, r) => x + (r.t.periods || 0), 0)
  const gradeNodes = (pre: string, l: typeof ts): FNode[] => [...new Set(l.map(r => r.t.grade))].sort((a, b) => a - b).map(g => {
    const x = l.filter(r => r.t.grade === g); return { key: `${pre}/${g}`, label: gradeName(g), sub: `${tiet(x)} tiết`, count: x.length } })
  const trackKids = (tr: StemTrack): FNode[] => {
    const l = ts.filter(r => r.m.track_code === tr.code)
    if (tr.use_modules === false) return gradeNodes(tr.code, l)
    return modules.filter(m => m.track_code === tr.code && m.active !== false).sort((a, b) => a.sort - b.sort).map(m => {
      const x = l.filter(r => r.m.id === m.id), gs = [...new Set(x.map(r => r.t.grade))].sort((a, b) => a - b)
      return { key: `${tr.code}/${m.id}`, label: m.name, sub: x.length ? `${fmtGrades(gs)} · ${tiet(x)} tiết` : 'chưa có chủ đề', count: x.length, dim: !x.length, kids: gradeNodes(`${tr.code}/${m.id}`, x) }
    })
  }
  const roots: FNode[] = all
    ? tracks.map(tr => { const l = ts.filter(r => r.m.track_code === tr.code); const nm = modules.filter(m => m.track_code === tr.code && m.active !== false).length
        return { key: tr.code, label: <>{chip(tr.code)} {tr.name}</>, sub: tr.use_modules === false ? `chỉ có chủ đề · ${tiet(l)} tiết` : `${nm} học phần · ${tiet(l)} tiết`, count: l.length, kids: trackKids(tr) } })
    : tracks[0] ? [{ key: tracks[0].code, label: 'Tất cả', sub: `${tiet(ts)} tiết`, count: ts.length }, ...trackKids(tracks[0])] : []
  const item = (n: FNode, depth: number): React.ReactNode => {
    const inside = sel !== n.key && sel.startsWith(n.key + '/'), isOpen = open[n.key] ?? inside
    const btn = <button type="button" className={'gtitem' + (sel === n.key ? ' on' : '') + (n.dim ? ' gtnone' : '')} aria-pressed={sel === n.key}
      title={`${n.count} chủ đề`} onClick={() => { onSel(n.key); if (n.kids?.length) setOpen({ ...open, [n.key]: true }) }}>
      <span className="gtlbl">{n.label}{n.sub && <small className="gtsubl">{n.sub}</small>}</span><span className="gtcnt" title={`${n.count} chủ đề`}>{n.count}</span></button>
    if (!n.kids?.length) return <div key={n.key} className="gtrow">{depth > 0 || all ? <span className="gtcaret" aria-hidden /> : null}{btn}</div>
    return <div key={n.key} className="gtlv">
      <div className="gtrow"><button type="button" className="gtcaret" aria-expanded={isOpen} aria-label={isOpen ? 'Thu gọn' : 'Mở'}
        onClick={() => setOpen({ ...open, [n.key]: !isOpen })}>{isOpen ? '▾' : '▸'}</button>{btn}</div>
      {isOpen && <div className="gtsub">{n.kids.map(k => item(k, depth + 1))}</div>}
    </div>
  }
  // Bảng: chủ đề thuộc mục đang chọn, nhóm theo các cấp nằm dưới mục chọn (Loại CT › Học phần › Khối › HP1/HP2)
  const order = (r: typeof ts[number]) => [tracks.findIndex(t => t.code === r.m.track_code), r.m.sort, r.t.grade, r.t.part || 3, r.t.seq]
  const rows = ts.filter(r => under(r.key, sel)).sort((a, b) => { const x = order(a), y = order(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0 })
  const split = new Set(ts.filter(r => r.t.part).map(r => r.key))
  const levels = (r: typeof ts[number]) => {
    const fl = isFlat(r.m.track_code)
    return [
      { k: r.m.track_code, lbl: <>{chip(r.m.track_code)} <b>{trOf(r.m.track_code)?.name}</b></>, mod: '' },
      fl ? null : { k: `${r.m.track_code}/${r.m.id}`, lbl: <b>{r.m.name}</b>, mod: r.m.id },
      { k: r.key, lbl: <b>{gradeName(r.t.grade)}</b>, mod: '' },
      split.has(r.key) ? { k: r.key + '#' + (r.t.part ?? 0), lbl: <span style={{ paddingLeft: 8, borderLeft: `4px solid ${r.t.part ? PART_C[r.t.part - 1] : 'var(--line)'}` }}><b>{r.t.part ? `Học phần ${r.t.part} (HP${r.t.part})` : 'Dùng chung'}</b></span>, mod: '' } : null,
    ]
  }
  const groupOf = (k: string) => rows.filter(r => r.key === k.split('#')[0] ? (k.includes('#') ? k === r.key + '#' + (r.t.part ?? 0) : true) : under(r.key, k))
  const N = 6, dash = <small className="sub">—</small>
  const body: React.ReactNode[] = []
  const last: (string | null)[] = []
  rows.forEach(r => {
    levels(r).forEach((lv, i) => {
      if (!lv || under(sel, lv.k.split('#')[0]) && !lv.k.includes('#') || last[i] === lv.k) return
      last[i] = lv.k; for (let j = i + 1; j < 4; j++) last[j] = null
      const g = groupOf(lv.k)
      body.push(<tr key={'h' + lv.k} className={i < 2 ? 'grouprow' : 'partrow'}><td colSpan={N} style={{ paddingLeft: 12 + 14 * i }}>
        {lv.lbl} <span style={MUTED}>· {g.length} chủ đề · {tiet(g)} tiết</span>
        {lv.mod && <button type="button" className="linkbtn" style={{ marginLeft: 10 }} onClick={() => onOpenModule(lv.mod)}>Mở học phần ›</button>}</td></tr>)
    })
    body.push(<tr key={r.t.id} className="clickrow" onClick={() => onOpen(r.t)}>
      <td>{r.t.seq}</td><td><b>{r.t.title}</b></td><td>{r.t.periods}</td><td>{r.t.main_subject || dash}</td><td><OneLine text={r.t.objectives} /></td><td><OneLine text={r.t.product ?? ''} /></td></tr>)
  })
  const selMod = /^[^/]+\/([0-9a-f-]{36})$/.exec(sel)?.[1]
  const crumb = (() => { const p = sel.split('/'); const out: string[] = []
    if (p[0]) out.push(all ? `${trackLabel(p[0])} · ${trOf(p[0])?.name ?? ''}` : 'Tất cả')
    if (p.length === 2 && !isFlat(p[0])) out.push(modOf.get(p[1])?.name ?? '')
    if (p.length === 3) out.push(modOf.get(p[1])?.name ?? '', gradeName(Number(p[2])))
    if (p.length === 2 && isFlat(p[0])) out.push(gradeName(Number(p[1])))
    return (all ? out : out.slice(p.length > 1 ? 1 : 0)).join(' › ') })()
  return <FitScreen className="fwfit">
    <SideSplit aside={<nav className="gtree" aria-label={all ? 'Loại CT › Học phần › Khối' : flatTitle(tracks[0])}>
      <TreeHead title={all ? 'Loại CT › Học phần › Khối' : flatTitle(tracks[0])}>Số = số chủ đề, dòng nhỏ = tổng số tiết.<br />Bấm tên: lọc bảng và mở.<br />Bấm ▸: chỉ mở / đóng.</TreeHead>
      <div className="gtcolhead">Số chủ đề</div>
      {roots.map(n => item(n, 0))}
    </nav>}>
      <div className="fwmain">
        <div className="fwcap"><b>{crumb}</b> <span style={MUTED}>· {rows.length} chủ đề · {tiet(rows)} tiết</span>
          {selMod && <button type="button" className="linkbtn" style={{ marginLeft: 10 }} onClick={() => onOpenModule(selMod)}>Mở học phần ›</button>}</div>
        <div className="fwscroll">{rows.length ? <table className="table slt ttdense fwtable">
          <thead><tr><th className="c-no">TT</th><th className="c-ttl">Chủ đề</th><th style={{ width: 80 }}>Số tiết</th><th>Môn chủ trì</th><th>Yêu cầu cần đạt</th><th>Sản phẩm</th></tr></thead>
          <tbody>{body}</tbody></table>
          : <p className="sub" style={{ padding: '12px 14px' }}>Chưa có chủ đề.{selMod ? ' Bấm "Mở học phần" để thêm chủ đề.' : ''}</p>}</div>
      </div>
    </SideSplit>
  </FitScreen>
}
const flatTitle = (t?: StemTrack) => t?.use_modules === false ? 'Khối' : 'Học phần › Khối'

/** Chủ đề của một học phần trong một bảng: nhóm theo khối, trong khối nhóm theo phần HP1 / HP2 (160); chủ đề không ghi phần là "Dùng chung" */
function ModuleTopicTable({ ts, grades, admin, onOpen, moveTopic }: {
  ts: ProgramTopic[]; grades: number[]; admin: boolean; onOpen: (t: ProgramTopic) => void
  moveTopic: (list: ProgramTopic[]) => (from: string, to: string) => void
}) {
  const groups = grades.map(g => {
    const list = ts.filter(t => t.grade === g).sort((a, b) => a.seq - b.seq)
    const split = list.some(t => t.part)
    const parts = split ? [1, 2, 0].map(k => ({ k, list: list.filter(t => (t.part ?? 0) === k) })).filter(x => x.list.length) : [{ k: -1, list }]
    return { g, list, parts }
  })
  // Kéo thả chỉ đổi thứ tự trong cùng nhóm (cùng khối, cùng phần)
  const groupOf = (id: string) => groups.flatMap(x => x.parts).find(x => x.list.some(t => t.id === id))?.list ?? []
  const dnd = useRowDrag((from, to) => { const l = groupOf(from); if (l.some(t => t.id === to)) moveTopic(l)(from, to) })
  const dash = <small className="sub">—</small>
  const N = 7
  // Cây bên trái: Khối › Học phần (giống cây Cấp › Khối); bấm để lọc bảng
  const [sel, setSel] = useGroupSel('mtt')
  const partName = (k: number) => k > 0 ? `Học phần ${k}` : k === 0 ? 'Dùng chung' : ''
  const lbl = (name: string, l: ProgramTopic[]) => <>{name}<br /><small style={MUTED}>{sum(l)} tiết</small></>
  const nodes = groups.map(({ g, list, parts }) => ({ key: String(g), label: lbl(gradeName(g), list), count: list.length,
    kids: parts.some(x => x.k >= 0) ? parts.map(x => ({ key: String(x.k), label: lbl(partName(x.k), x.list), count: x.list.length })) : undefined }))
  const known = sel === 'all' || nodes.some(n => sel === 'a:' + n.key || (n.kids ?? []).some(c => sel === `b:${n.key}|${c.key}`))
  const cur = known ? sel : 'all'
  const shown = groups.map(x => ({ ...x, parts: x.parts.filter(p => inGroup(cur, String(x.g), String(p.k)) || inGroup(cur, String(x.g))) })).filter(x => x.parts.length)
  return <SideSplit aside={<GroupTree nodes={nodes} total={ts.length} sel={cur} onSel={setSel} label="Khối › Học phần" unit="chủ đề" />}>
    <div className="tablewrap"><table className="table slt ttdense">
    <thead><tr><th className="c-no">TT</th><th className="c-ttl">Chủ đề</th><th style={{ width: 80 }}>Số tiết</th><th>Môn chủ trì</th><th>Môn phối hợp</th><th>Yêu cầu cần đạt</th><th>Sản phẩm</th></tr></thead>
    <tbody>{shown.map(({ g, list, parts }) => <Fragment key={g}>
      <tr className="grouprow"><td colSpan={N}><b>{gradeName(g)}</b> <span style={MUTED}>· {list.length} chủ đề · {sum(list)} tiết</span></td></tr>
      {parts.map(({ k, list: pl }) => <Fragment key={k}>
        {k >= 0 && <tr className="partrow"><td colSpan={N} style={{ paddingLeft: 14 }}>
          <span style={{ paddingLeft: 8, borderLeft: `4px solid ${k ? PART_C[k - 1] : 'var(--line)'}` }}>
            <b>{k ? `Học phần ${k} (HP${k})` : 'Dùng chung'}</b> <span style={MUTED}>· {pl.length} chủ đề · {sum(pl)} tiết{k ? '' : ' · gói dùng học phần ở vị trí nào cũng học'}</span></span></td></tr>}
        {pl.map(t => <tr key={t.id} {...(admin ? dnd.row(t.id) : { className: 'clickrow' })} onClick={() => onOpen(t)}>
          <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>{admin && dnd.handle(t.id, t.title)}{t.seq}</span></td>
          <td><b>{t.title}</b></td><td>{t.periods}</td><td>{t.main_subject || dash}</td><td>{t.subjects.join(', ') || dash}</td>
          <td><OneLine text={t.objectives} /></td><td><OneLine text={t.product ?? ''} /></td></tr>)}
      </Fragment>)}
    </Fragment>)}</tbody>
  </table></div></SideSplit>
}

/** Kéo thả dòng bảng để đổi thứ tự: tay cầm ⠿ ở ô đầu dòng (giống bảng bài học của chương trình giáo dục) */
function useRowDrag(onMove: (from: string, to: string) => void) {
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  return {
    handle: (id: string, label: string) => <span className="slact"><span className="sldrag" draggable title="Kéo để đổi vị trí" aria-label={`Kéo ${label} để đổi vị trí`}
      onDragStart={e => { setDrag(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); const tr = (e.target as HTMLElement).closest('tr'); if (tr) e.dataTransfer.setDragImage(tr, 20, 20) }}
      onDragEnd={() => { setDrag(null); setOver(null) }}>⠿</span></span>,
    row: (id: string) => ({ className: 'clickrow' + (drag === id ? ' sldragging' : over === id && drag ? ' slover' : ''),
      onDragOver: (e: React.DragEvent) => { if (!drag) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== id) setOver(id) },
      onDrop: (e: React.DragEvent) => { e.preventDefault(); const f = drag; setDrag(null); setOver(null); if (f && f !== id) onMove(f, id) } }),
  }
}

// Màu phần HP1 / HP2 của chủ đề trong học phần
const PART_C = ['#2563eb', '#0d9488']
const MUTED = { color: 'var(--muted)', fontWeight: 400 }

function TopicTable({ list, track, admin, showGrade, weeks, hidePart, onOpen, onMove }: { list: ProgramTopic[]; track?: StemTrack; admin: boolean; showGrade?: boolean; weeks?: boolean; hidePart?: boolean; onOpen: (t: ProgramTopic) => void; onMove?: (from: string, to: string) => void }) {
  const sgk = track?.schedule_mode === 'subject'
  const dnd = useRowDrag(onMove ?? (() => {}))
  // Tuần học: mỗi tuần 1 tiết, chủ đề nhiều tiết kéo dài nhiều tuần (VD: Tuần 1–2)
  const wk = new Map<string, string>(); let at = 1
  for (const t of list) { const n = Math.max(1, t.periods || 1); wk.set(t.id, n > 1 ? `${at}–${at + n - 1}` : String(at)); at += n }
  const dash = <small className="sub">—</small>
  const cols: Col<ProgramTopic>[] = [
    { key: 'seq', label: weeks ? 'Tuần' : 'TT', fixed: true, thClass: 'c-no', text: t => weeks ? wk.get(t.id) ?? '' : String(t.seq),
      cell: t => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>{admin && onMove && dnd.handle(t.id, t.title)}{weeks ? wk.get(t.id) : t.seq}</span> },
    ...(showGrade ? [{ key: 'g', label: 'Khối', text: (t: ProgramTopic) => gradeName(t.grade), values: (t: ProgramTopic) => [gradeName(t.grade)], cell: (t: ProgramTopic) => gradeName(t.grade) }] : []),
    { key: 'code', label: 'Mã', off: true, text: t => t.code ?? '', cell: t => t.code || dash },
    { key: 'title', label: 'Chủ đề', fixed: true, thClass: 'c-ttl', text: t => t.title,
      cell: t => <b>{t.title}</b> },
    { key: 'p', label: 'Số tiết', text: t => String(t.periods), cell: t => t.periods },
    ...(track?.use_modules !== false && !hidePart ? [{ key: 'part', label: 'Phần', text: (t: ProgramTopic) => t.part ? 'HP' + t.part : 'Chung', values: (t: ProgramTopic) => [t.part ? 'HP' + t.part : 'Chung'],
      cell: (t: ProgramTopic) => t.part ? <span className="pill" style={{ background: PART_C[t.part - 1], color: '#fff' }}>HP{t.part}</span> : <span style={{ color: 'var(--muted)' }}>Chung</span> }] : []),
    { key: 'main', label: 'Môn chủ trì', text: t => t.main_subject ?? '', cell: t => t.main_subject || dash },
    { key: 'subs', label: 'Môn phối hợp', text: t => t.subjects.join(', '), values: t => t.subjects, cell: t => t.subjects.join(', ') || dash },
    { key: 'obj', label: 'Yêu cầu cần đạt', text: t => t.objectives, cell: t => <OneLine text={t.objectives} /> },
    { key: 'prod', label: 'Sản phẩm', text: t => t.product ?? '', cell: t => <OneLine text={t.product ?? ''} /> },
    ...(sgk ? [{ key: 'sgk', label: 'Bài SGK liên quan', off: true, text: (t: ProgramTopic) => t.textbook_ref, cell: (t: ProgramTopic) => t.textbook_ref || dash }] : []),
    { key: 'st', label: 'Trạng thái', off: true, text: t => t.active ? 'Đang dùng' : 'Ngừng dùng', cell: t => pill(t.active) },
  ]
  return <DataTable id="program-topics" className="slt ttdense" rowProps={admin && onMove ? t => dnd.row(t.id) : undefined} rows={list} rowKey={t => t.id} cols={cols} simple noTools noun="chủ đề"
    onRow={onOpen} empty="Chưa có chủ đề." />
}

function ModuleForm({ m, onCancel, onSaved }: { m: ProgramModule; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState(m)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    if (!f.name.trim()) return setErr('Nhập tên học phần.')
    setBusy(true); setErr('')
    const row = { track_code: f.track_code, name: f.name, description: f.description, sort: Number(f.sort) || 0, active: f.active,
      periods: f.periods == null || (f.periods as unknown) === '' ? null : Number(f.periods) }
    const { data, error } = f.id ? await supabase.from('program_modules').update(row).eq('id', f.id).select('id')
      : await supabase.from('program_modules').insert(row).select('id')
    setBusy(false)
    if (error) return setErr(frameErr(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return setErr(frameErr('row-level'))
    onSaved()
  }
  return <section className="panel">
    <div className="formgrid">
      <label className="field wide"><span>Tên học phần *</span><input value={f.name} maxLength={120} onChange={e => setF({ ...f, name: e.target.value })} /></label>
      <label className="field"><span>Thứ tự</span><input type="number" min={0} value={f.sort} onChange={e => setF({ ...f, sort: Number(e.target.value) })} /></label>
      <label className="field"><span>Số tiết / khối</span><input type="number" min={0} max={200} value={f.periods ?? ''} placeholder="VD: 16"
        onChange={e => setF({ ...f, periods: e.target.value === '' ? null : Number(e.target.value) })} /></label>
      <label className="field"><span>Trạng thái</span><select value={f.active ? 'on' : 'off'} onChange={e => setF({ ...f, active: e.target.value === 'on' })}>
        <option value="on">Đang dùng</option><option value="off">Ngừng dùng</option></select></label>
      <label className="field wide"><span>Mô tả</span><textarea rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
    </div>
    {err && <p className="warnline">{err}</p>}
    <div className="actions" style={{ marginTop: 12 }}>
      <button className="primary" onClick={save} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      <button onClick={onCancel} disabled={busy}>Huỷ</button>
    </div>
  </section>
}

function TopicForm({ t, track, onCancel, onSaved }: { t: TopicDraft; track?: StemTrack; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState<TopicDraft>({ ...t, subjects: [...t.subjects] })
  const { grades } = useEduLevels()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const gradeList = useMemo(() => [...new Set([...grades, f.grade])].sort((a, b) => a - b), [grades, f.grade])
  async function save() {
    if (!f.title.trim()) return setErr('Nhập tên chủ đề.')
    setBusy(true); setErr('')
    const row = { module_id: f.module_id, grade: f.grade, seq: Number(f.seq) || 1, code: f.code, title: f.title, periods: Number(f.periods) || 0,
      objectives: f.objectives, product: f.product ?? '', main_subject: f.main_subject, subjects: f.subjects, textbook_ref: f.textbook_ref, active: f.active, part: track?.use_modules === false ? null : (f.part ?? null) }
    const { data, error } = f.id ? await supabase.from('program_topics').update(row).eq('id', f.id).select('id')
      : await supabase.from('program_topics').insert(row).select('id')
    setBusy(false)
    if (error) return setErr(frameErr(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return setErr(frameErr('row-level'))
    onSaved()
  }
  return <section className="panel">
    <div className="formgrid">
      <label className="field"><span>Khối *</span><select value={f.grade} onChange={e => setF({ ...f, grade: Number(e.target.value) })}>
        {gradeList.map(g => <option key={g} value={g}>{gradeName(g)}</option>)}</select></label>
      <label className="field"><span>Thứ tự trong khối</span><input type="number" min={1} max={999} value={f.seq} onChange={e => setF({ ...f, seq: Number(e.target.value) })} /></label>
      <label className="field"><span>Mã chủ đề</span><input value={f.code ?? ''} maxLength={40} placeholder="VD: G1-01" onChange={e => setF({ ...f, code: e.target.value })} /></label>
      <label className="field"><span>Số tiết</span><input type="number" min={0} max={200} value={f.periods} onChange={e => setF({ ...f, periods: Number(e.target.value) })} /></label>
      <label className="field wide"><span>Tên chủ đề *</span><input value={f.title} maxLength={200} onChange={e => setF({ ...f, title: e.target.value })} /></label>
      <label className="field"><span>Môn chủ trì</span><SubjectPicker value={f.main_subject} onChange={v => setF({ ...f, main_subject: v || null })} emptyLabel="— Không —" /></label>
      {track?.use_modules !== false && <label className="field"><span>Phần</span><select value={f.part ?? ''} onChange={e => setF({ ...f, part: e.target.value ? Number(e.target.value) : null })}>
        <option value="">Dùng chung (cả HP1 và HP2)</option><option value="1">Học phần 1 (HP1)</option><option value="2">Học phần 2 (HP2)</option></select></label>}
      <label className="field"><span>Trạng thái</span><select value={f.active ? 'on' : 'off'} onChange={e => setF({ ...f, active: e.target.value === 'on' })}>
        <option value="on">Đang dùng</option><option value="off">Ngừng dùng</option></select></label>
      {track?.schedule_mode === 'subject' && <label className="field wide"><span>Bài SGK liên quan / được thay</span>
        <input value={f.textbook_ref} onChange={e => setF({ ...f, textbook_ref: e.target.value })} placeholder="VD: Toán 1 – Bài 12: Hình vuông, hình tròn" /></label>}
      <label className="field wide"><span>Mục tiêu, yêu cầu cần đạt</span><textarea rows={3} value={f.objectives} onChange={e => setF({ ...f, objectives: e.target.value })} /></label>
      <label className="field wide"><span>Sản phẩm</span><input value={f.product ?? ''} maxLength={300} placeholder="VD: Mô hình ngôi nhà mơ ước bằng bìa giấy" onChange={e => setF({ ...f, product: e.target.value })} /></label>
    </div>
    <div className="field" style={{ marginTop: 12 }}><span className="sub">Môn phối hợp</span>
      <SubjectMulti value={f.subjects} onChange={v => setF({ ...f, subjects: v })} exclude={f.main_subject ? [f.main_subject] : []} ariaLabel="Môn phối hợp" /></div>
    {err && <p className="warnline">{err}</p>}
    <div className="actions" style={{ marginTop: 12 }}>
      <button className="primary" onClick={save} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      <button onClick={onCancel} disabled={busy}>Huỷ</button>
    </div>
  </section>
}

// ===== Danh mục nhóm vật tư (147): KDI thêm, sửa, xếp thứ tự; vật tư của chủ đề sẽ gắn vào các nhóm này =====
export function MaterialGroupsCatalog() {
  const [admin, setAdmin] = useState(false)
  const [rows, setRows] = useState<MaterialGroup[]>([])
  const [edit, setEdit] = useState<MaterialGroup | null>(null)
  const [msg, setMsg] = useState('')
  const load = () => supabase.from('material_groups').select('*').order('sort').order('name')
    .then(({ data, error }) => { setRows((data ?? []) as MaterialGroup[]); setMsg(error ? frameErr(error.message + ' ' + (error.code ?? '')) : '') })
  useEffect(() => { supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data)); load() }, [])
  async function remove(g: MaterialGroup) {
    if (!confirm(`Xoá nhóm vật tư "${g.name}"?`)) return
    const { data, error } = await supabase.from('material_groups').delete().eq('id', g.id).select('id')
    if (error) return setMsg(frameErr(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return setMsg(frameErr('row-level'))
    setEdit(null); load()
  }
  if (edit) return <ElView back="Nhóm vật tư" onBack={() => setEdit(null)} title={edit.id ? 'Sửa nhóm vật tư' : 'Thêm nhóm vật tư'}>
    <GroupForm g={edit} onCancel={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} onDelete={edit.id ? () => remove(edit) : undefined} />
  </ElView>
  const cols: Col<MaterialGroup>[] = [
    { key: 'sort', label: 'TT', fixed: true, thClass: 'c-no', text: g => String(g.sort), cell: g => g.sort },
    { key: 'name', label: 'Nhóm vật tư', fixed: true, thClass: 'c-ttl', text: g => g.name,
      cell: g => admin ? <button type="button" className="namelink" onClick={() => setEdit(g)}>{g.name}</button> : <b>{g.name}</b> },
    { key: 'desc', label: 'Mô tả', text: g => g.description, cell: g => g.description || <small className="sub">—</small> },
    { key: 'st', label: 'Trạng thái', text: g => g.active ? 'Đang dùng' : 'Ngừng dùng', cell: g => pill(g.active) },
  ]
  return <>
    {admin && <HeadAction><button type="button" className="primary ttadd"
      onClick={() => setEdit({ id: '', name: '', description: '', sort: rows.reduce((x, g) => Math.max(x, g.sort), 0) + 1, active: true })}>+ Thêm nhóm vật tư</button></HeadAction>}
    {msg && <p className="msg" role="status">{msg}</p>}
    <DataTable fit id="material-groups" rows={rows} rowKey={g => g.id} cols={cols} noun="nhóm"
      rowMenu={admin ? g => [{ label: 'Sửa', onClick: () => setEdit(g) }, { label: 'Xoá', danger: true, onClick: () => remove(g) }] : undefined} empty="Chưa có nhóm vật tư." />
    <p className="tablenote sub">Nhóm vật tư dùng để chia vật tư, thiết bị của mỗi chủ đề (VD: Nhóm 1, Nhóm 2, Nhóm 3 hoặc theo loại). {admin ? 'Bấm tên nhóm để sửa; nút ⋮ cuối dòng để xoá.' : 'Chỉ quản trị nền tảng KDI sửa được danh mục này.'}</p>
  </>
}

function GroupForm({ g, onCancel, onSaved, onDelete }: { g: MaterialGroup; onCancel: () => void; onSaved: () => void; onDelete?: () => void }) {
  const [f, setF] = useState(g)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function save() {
    if (!f.name.trim()) return setErr('Nhập tên nhóm.')
    setBusy(true); setErr('')
    const row = { name: f.name, description: f.description, sort: Number(f.sort) || 0, active: f.active }
    const { data, error } = f.id ? await supabase.from('material_groups').update(row).eq('id', f.id).select('id')
      : await supabase.from('material_groups').insert(row).select('id')
    setBusy(false)
    if (error) return setErr(frameErr(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return setErr(frameErr('row-level'))
    onSaved()
  }
  return <section className="panel">
    <div className="formgrid">
      <label className="field"><span>Tên nhóm *</span><input value={f.name} maxLength={80} onChange={e => setF({ ...f, name: e.target.value })} /></label>
      <label className="field"><span>Thứ tự</span><input type="number" min={0} value={f.sort} onChange={e => setF({ ...f, sort: Number(e.target.value) })} /></label>
      <label className="field"><span>Trạng thái</span><select value={f.active ? 'on' : 'off'} onChange={e => setF({ ...f, active: e.target.value === 'on' })}>
        <option value="on">Đang dùng</option><option value="off">Ngừng dùng</option></select></label>
      <label className="field wide"><span>Mô tả</span><textarea rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
    </div>
    {err && <p className="warnline">{err}</p>}
    <div className="actions" style={{ marginTop: 12 }}>
      <button className="primary" onClick={save} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
      <button onClick={onCancel} disabled={busy}>Huỷ</button>
      {onDelete && <button className="danger" onClick={onDelete} disabled={busy}>Xoá</button>}
    </div>
  </section>
}
