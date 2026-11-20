import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { loadFrame, type ProgramModule, type ProgramTopic } from '../../lib/programFrame'
import { useStemTracks, trackLabel } from '../../lib/stemTracks'
import { gradeName } from '../../lib/eduLevels'
import { PROGRAM_COLOR } from '../teacher/common'
import { Drawer } from '../../components/Drawer'
import { TopicContents } from '../topicContents'

// Học liệu theo chương trình (khung mới, thay tab cũ theo Chương trình giáo dục): Loại CT › Học phần › Khối → chủ đề,
// mỗi chủ đề có 6 nội dung (164–165). Cột cho biết chủ đề đã có kế hoạch giảng dạy, bài giảng chưa và số phiếu, bài kiểm tra, vật tư, học liệu.
// KDI thấy mọi chủ đề và sửa được; trường chỉ thấy chủ đề thuộc gói đã gán cho trường (năm học hiện tại), chỉ xem.

type Count = Record<'plan' | 'lecture' | 'worksheet' | 'test' | 'material' | 'resource', number>
type Status = '' | 'empty' | 'noplan' | 'nolecture' | 'full'
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
  const [q, setQ] = useState('')
  const [grade, setGrade] = useState(0)
  const [status, setStatus] = useState<Status>('')
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
  const qq = q.trim().toLowerCase()
  const shown = usable.filter(t => {
    const c = cnt(t), m = modOf.get(t.module_id)!
    if (!inSel(t) || (grade && t.grade !== grade)) return false
    if (qq && !`${t.title} ${t.code ?? ''} ${m.name}`.toLowerCase().includes(qq)) return false
    return status === '' || (status === 'empty' ? isEmpty(c) : status === 'noplan' ? !c.plan : status === 'nolecture' ? !c.lecture : c.plan > 0 && c.lecture > 0)
  }).sort((a, b) => {
    const ma = modOf.get(a.module_id)!, mb = modOf.get(b.module_id)!
    const ta = tracks.findIndex(x => x.code === ma.track_code), tb = tracks.findIndex(x => x.code === mb.track_code)
    return ta - tb || ma.sort - mb.sort || ma.name.localeCompare(mb.name) || a.grade - b.grade || a.seq - b.seq
  })
  const grades = [...new Set(usable.map(t => t.grade))].sort((a, b) => a - b)
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

  return <>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm chủ đề, học phần…" style={{ minWidth: 240 }} />
      <select value={grade} onChange={e => setGrade(Number(e.target.value))}><option value={0}>Khối: Tất cả</option>{grades.map(g => <option key={g} value={g}>{gradeName(g)}</option>)}</select>
      <select value={status} onChange={e => setStatus(e.target.value as Status)}>
        <option value="">Tình trạng: Tất cả</option><option value="noplan">Chưa có kế hoạch giảng dạy</option><option value="nolecture">Chưa có bài giảng</option>
        <option value="empty">Chưa có nội dung</option><option value="full">Đã có kế hoạch giảng dạy và bài giảng</option></select>
      <span className="sub" style={{ alignSelf: 'center' }}>{shown.length} chủ đề{allowed ? ' · theo gói trường đang dùng' : ''}</span>
    </div>
    {msg && <p className="msg">{msg}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 250px) 1fr', gap: 12, alignItems: 'start' }}>
      <nav className="panel gtree" style={{ padding: 8 }} aria-label="Loại CT › Học phần › Khối">
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
      </nav>
      <div className="wrap" style={{ overflowX: 'auto' }}>
        <table className="slt ttdense" style={{ width: '100%' }}>
          <thead><tr><th>Chủ đề</th><th>Học phần · Khối</th><th>Tiết</th><th>Kế hoạch giảng dạy</th><th>Bài giảng</th><th>Phiếu</th><th>Kiểm tra</th><th>Vật tư</th><th>Kho HL</th></tr></thead>
          <tbody>{shown.map(t => { const m = modOf.get(t.module_id)!, c = cnt(t)
            return <tr key={t.id} onClick={() => setOpen(t)} style={{ cursor: 'pointer' }}>
              <td>{chip(m.track_code)} <b>{t.title}</b>{t.code && <small className="sub"> · {t.code}</small>}</td>
              <td><small>{m.name} · {gradeName(t.grade)}</small></td><td>{t.periods}</td>
              <td>{yes(c.plan)}</td><td>{yes(c.lecture)}</td><td>{n(c.worksheet)}</td><td>{n(c.test)}</td><td>{n(c.material)}</td><td>{n(c.resource)}</td>
            </tr> })}
            {loaded && !shown.length && <tr><td colSpan={9} className="sub">{allowed && !allowed.size ? 'Trường chưa được gán Gói STEM cho năm học hiện tại.' : 'Không có chủ đề phù hợp.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
    {open && (() => { const m = modOf.get(open.module_id)
      return <Drawer onClose={() => { setOpen(null); loadCounts() }} title={<>{m && chip(m.track_code)} {open.title}</>}>
        <p className="sub" style={{ marginTop: 0 }}>{m ? m.name + ' · ' : ''}{gradeName(open.grade)} · {open.periods} tiết</p>
        <TopicContents topic={open} admin={admin} />
      </Drawer> })()}
  </>
}
