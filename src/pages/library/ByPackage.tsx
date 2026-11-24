import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { loadFrame, type ProgramModule, type ProgramTopic } from '../../lib/programFrame'
import { useStemTracks, trackLabel } from '../../lib/stemTracks'
import { gradeName } from '../../lib/eduLevels'
import { PROGRAM_COLOR } from '../teacher/common'
import { Drawer } from '../../components/Drawer'
import { TopicContents } from '../topicContents'
import { DataTable, type Col } from '../../components/DataTable'

// Học liệu theo chương trình (khung mới, thay tab cũ theo Chương trình giáo dục): Loại CT › Học phần › Khối → chủ đề,
// mỗi chủ đề có 6 nội dung (164–165). Cột cho biết chủ đề đã có kế hoạch giảng dạy, bài giảng chưa và số phiếu, bài kiểm tra, vật tư, học liệu.
// KDI thấy mọi chủ đề và sửa được; trường chỉ thấy chủ đề thuộc gói đã gán cho trường (năm học hiện tại), chỉ xem.

type Count = Record<'plan' | 'lecture' | 'worksheet' | 'test' | 'material' | 'resource', number>
const ZERO: Count = { plan: 0, lecture: 0, worksheet: 0, test: 0, material: 0, resource: 0 }
const chip = (code: string) => <span className="progchip" style={{ background: PROGRAM_COLOR[code], color: '#fff' }}>{trackLabel(code)}</span>

/** Khung + quyền xem dùng chung cho 2 tab Học liệu: KDI thấy mọi chủ đề, trường chỉ chủ đề thuộc gói năm học hiện tại */
export function useLibFrame(orgId: string | null) {
  const [admin, setAdmin] = useState(false)
  const [modules, setModules] = useState<ProgramModule[]>([])
  const [topics, setTopics] = useState<ProgramTopic[]>([])
  const [allowed, setAllowed] = useState<Set<string> | null>(null)   // null = thấy tất cả
  const [msg, setMsg] = useState('')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    (async () => {
      const [{ data: adm }, fr] = await Promise.all([supabase.rpc('is_platform_admin'), loadFrame()])
      setAdmin(!!adm); setModules(fr.modules); setTopics(fr.topics.filter(t => t.active)); setMsg(fr.error)
      if (!adm && orgId) {
        const { data: o } = await supabase.from('organizations').select('type').eq('id', orgId).maybeSingle()
        if ((o as { type?: string } | null)?.type === 'school') {
          const { data: y } = await supabase.from('academic_years').select('name').eq('org_id', orgId).eq('is_current', true).maybeSingle()
          const { data: ts } = y ? await supabase.rpc('school_package_topic_list', { p_org: orgId, p_year: (y as { name: string }).name }) : { data: [] }
          setAllowed(new Set(((ts ?? []) as { topic_id: string }[]).map(x => x.topic_id)))
        }
      }
      setLoaded(true)
    })()
  }, [orgId])
  const modOf = useMemo(() => new Map(modules.map(m => [m.id, m])), [modules])
  const usable = useMemo(() => topics.filter(t => modOf.has(t.module_id) && (!allowed || allowed.has(t.id))), [topics, modOf, allowed])
  return { admin, modules, modOf, usable, allowed, msg, loaded }
}

export function LibraryByPackage({ orgId }: { orgId: string | null }) {
  const { tracks } = useStemTracks()
  const { admin, modules, modOf, usable, allowed, msg, loaded } = useLibFrame(orgId)
  const [counts, setCounts] = useState<Map<string, Count>>(new Map())
  const [sel, setSel] = useState('')            // '' | 't:CT1' | 'm:<id>' | 'g:<module>:<grade>'
  const [open, setOpen] = useState<ProgramTopic | null>(null)
  const [fold, setFold] = useState<Record<string, boolean>>({})   // nhánh cây đang mở

  const loadCounts = () => supabase.from('program_topic_items').select('topic_id, kind').then(({ data }) => {
    const m = new Map<string, Count>()
    for (const r of (data ?? []) as { topic_id: string; kind: keyof Count }[]) { const c = m.get(r.topic_id) ?? { ...ZERO }; c[r.kind]++; m.set(r.topic_id, c) }
    setCounts(m)
  })
  useEffect(() => { loadCounts() }, [])

  const cnt = (t: ProgramTopic) => counts.get(t.id) ?? ZERO
  const isEmpty = (c: Count) => Object.values(c).every(n => n === 0)
  const inSel = (t: ProgramTopic) => {
    const m = modOf.get(t.module_id)!
    if (!sel) return true
    const [k, a, b] = sel.split(':')
    return k === 't' ? m.track_code === a : k === 'm' ? m.id === a : m.id === a && t.grade === Number(b)
  }
  const shown = usable.filter(inSel).sort((a, b) => {
    const ma = modOf.get(a.module_id)!, mb = modOf.get(b.module_id)!
    const ta = tracks.findIndex(x => x.code === ma.track_code), tb = tracks.findIndex(x => x.code === mb.track_code)
    return ta - tb || ma.sort - mb.sort || ma.name.localeCompare(mb.name) || a.grade - b.grade || a.seq - b.seq
  })
  const n = (v: number) => (v ? v : <span className="sub">—</span>)
  const yes = (v: number) => (v ? <span style={{ color: 'var(--good, #1c7a43)', fontWeight: 600 }}>✓{v > 1 ? ' ' + v : ''}</span> : <span style={{ color: 'var(--bad, #c0392b)' }}>Chưa có</span>)

  // Cây: Loại CT › Học phần › Khối (chỉ những nhánh có chủ đề)
  const tree = tracks.filter(tr => usable.some(t => modOf.get(t.module_id)?.track_code === tr.code)).map(tr => {
    const mods = modules.filter(m => m.track_code === tr.code && usable.some(t => t.module_id === m.id))
    return { tr, mods: mods.map(m => ({ m, gs: [...new Set(usable.filter(t => t.module_id === m.id).map(t => t.grade))].sort((a, b) => a - b) })) }
  })
  // Nhánh mở khi bấm ▸ hoặc khi đang chọn mục bên trong
  const isOpen = (key: string, inside: boolean) => fold[key] ?? inside
  const node = (key: string, label: ReactNode, count: number, caret: 'none' | 'open' | 'shut' | 'leaf') =>
    <div key={key} className="gtrow">
      {caret === 'none' ? null : caret === 'leaf' ? <span className="gtcaret" aria-hidden /> :
        <button type="button" className="gtcaret" aria-expanded={caret === 'open'} aria-label={caret === 'open' ? 'Thu gọn' : 'Mở'}
          onClick={() => setFold({ ...fold, [key]: caret !== 'open' })}>{caret === 'open' ? '▾' : '▸'}</button>}
      <button type="button" className={'gtitem' + (sel === key ? ' on' : '')} aria-pressed={sel === key}
        onClick={() => { setSel(key); if (caret === 'shut') setFold({ ...fold, [key]: true }) }}>
        <span className="gtlbl">{label}</span><span className="gtcnt">{count}</span></button></div>
  const selMod = sel.startsWith('m:') ? sel.slice(2) : sel.startsWith('g:') ? sel.split(':')[1] : ''
  const selTr = sel.startsWith('t:') ? sel.slice(2) : selMod ? modOf.get(selMod)?.track_code : ''

  const has = (v: number) => (v ? 'Đã có' : 'Chưa có')
  const num = (k: keyof Count, label: string): Col<ProgramTopic> => ({ key: k, label, text: t => (cnt(t)[k] ? 'Có' : 'Không có'), cell: t => n(cnt(t)[k]) })
  const cols: Col<ProgramTopic>[] = [
    { key: 'title', label: 'Chủ đề', fixed: true, text: t => `${t.title} ${t.code ?? ''}`, cell: t => <>{chip(modOf.get(t.module_id)!.track_code)} <b>{t.title}</b>{t.code && <small className="sub"> · {t.code}</small>}</> },
    { key: 'track', label: 'Loại CT', off: true, text: t => trackLabel(modOf.get(t.module_id)!.track_code), cell: t => chip(modOf.get(t.module_id)!.track_code) },
    { key: 'mod', label: 'Học phần', text: t => modOf.get(t.module_id)!.name, cell: t => <small>{modOf.get(t.module_id)!.name}</small> },
    { key: 'grade', label: 'Khối', text: t => gradeName(t.grade), cell: t => gradeName(t.grade) },
    { key: 'periods', label: 'Tiết', text: t => String(t.periods), cell: t => t.periods },
    { key: 'plan', label: 'Kế hoạch giảng dạy', text: t => has(cnt(t).plan), cell: t => yes(cnt(t).plan) },
    { key: 'lecture', label: 'Bài giảng', text: t => has(cnt(t).lecture), cell: t => yes(cnt(t).lecture) },
    num('worksheet', 'Phiếu'), num('test', 'Kiểm tra'), num('material', 'Vật tư'), num('resource', 'Kho HL'),
    { key: 'state', label: 'Tình trạng', off: true, text: t => { const c = cnt(t); return isEmpty(c) ? 'Chưa có nội dung' : c.plan && c.lecture ? 'Đủ kế hoạch và bài giảng' : 'Còn thiếu' }, cell: t => { const c = cnt(t); return isEmpty(c) ? 'Chưa có nội dung' : c.plan && c.lecture ? 'Đủ' : 'Còn thiếu' } },
  ]
  const crumb = !sel ? 'Tất cả' : sel.startsWith('t:') ? `${trackLabel(selTr!)} · ${tracks.find(x => x.code === selTr)?.name ?? ''}`
    : sel.startsWith('m:') ? modOf.get(selMod)?.name : `${modOf.get(selMod)?.name} › ${gradeName(Number(sel.split(':')[2]))}`

  return <>
    {msg && <p className="msg">{msg}</p>}
    <div className="fwtree"><DataTable id="lib-topics" pro rows={shown} rowKey={t => t.id} cols={cols} noun="chủ đề" onRow={setOpen} className="slt"
      left={<span className="fwcap"><b>{crumb}</b>{allowed ? <span className="sub"> · theo gói trường đang dùng</span> : null}</span>}
      empty={<span className="sub">{!loaded ? 'Đang tải…' : allowed && !allowed.size ? 'Trường chưa được gán Gói STEM cho năm học hiện tại.' : 'Không có chủ đề phù hợp.'}</span>}
      aside={<nav className="gtree" aria-label="Loại CT › Học phần › Khối">
        {node('', 'Tất cả', usable.length, 'none')}
        {tree.map(({ tr, mods }) => { const tk = 't:' + tr.code, to = isOpen(tk, selTr === tr.code && sel !== tk), withMod = tr.use_modules !== false
          return <div key={tr.code} className="gtlv">
            {node(tk, <>{chip(tr.code)} {tr.name}</>, usable.filter(t => modOf.get(t.module_id)?.track_code === tr.code).length, to ? 'open' : 'shut')}
            {to && <div className="gtsub">{mods.map(({ m, gs }) => {
              const grades = gs.map(g => node(`g:${m.id}:${g}`, gradeName(g), usable.filter(t => t.module_id === m.id && t.grade === g).length, 'leaf'))
              if (!withMod) return <div key={m.id}>{grades}</div>
              const mk = 'm:' + m.id, mo = isOpen(mk, selMod === m.id && sel !== mk)
              return <div key={m.id} className="gtlv">{node(mk, m.name, usable.filter(t => t.module_id === m.id).length, mo ? 'open' : 'shut')}
                {mo && <div className="gtsub">{grades}</div>}</div>
            })}</div>}
          </div> })}
      </nav>} /></div>
    {open && (() => { const m = modOf.get(open.module_id)
      return <Drawer onClose={() => { setOpen(null); loadCounts() }} title={<>{m && chip(m.track_code)} {open.title}</>}>
        <TopicContents topic={open} admin={admin} module={m} />
      </Drawer> })()}
  </>
}
