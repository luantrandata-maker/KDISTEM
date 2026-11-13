// Phân hệ 2 — Chương trình đào tạo (083, 131): mẫu khoá đào tạo do KDI, Sở, Phòng, Trường soạn, dùng lại cho các kế hoạch đào tạo.
import { CompetencySetupLink } from '../../components/CompetencySetup'
import { DetailHead } from '../../components/DetailHead'
import { HeadAction } from '../../components/PageFrame'
// Cấu trúc 3 cấp: Chương trình đào tạo → Môn → Nội dung đào tạo. Cách làm giống Phân hệ 2: hướng dẫn các bước,
// thẻ số liệu, danh sách có lọc; thêm / sửa / xem chi tiết mở view riêng; Nháp → Đã phát hành → Ngừng dùng, nhân bản để sửa.
import { MultiSelect } from '../../components/MultiSelect'
import { ChipMulti } from '../../components/Pickers'
import { Icon } from '../../components/Icon'
import { ActionBar, type Act } from '../../components/ActionBar'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useOrgFilter } from '../../components/OrgFilters'
import { useEduLevels } from '../../lib/eduLevels'
import { useStemTracks } from '../../lib/stemTracks'
import { useSubjects } from '../subjects'
import { useCompetencies, LV_NAME } from '../competency'
import { ElView } from '../../components/ElView'
import { Chip } from '../dist/Editor'
import { ContentDetail, detailCount, type Detail } from './Content'
import { TrainingUnits } from './Units'
import { StatCards } from '../../components/StatCards'
import { DataTable, type Col } from '../../components/DataTable'
import { ProgramExams, ProgramEvalFrame, type FinalExam, type Frame } from './ExamFrame'
import { useAllOrgs } from '../../components/OrgScope'

type Mode = 'online' | 'offline' | 'hybrid'
export type TProgram = {
  id: string; org_id: string; code: string; title: string; ct_code: string | null; level: string | null; ct_codes: string[]; levels: string[]; audience: string | null; mode: Mode
  description: string | null; objectives?: string | null; entry_conditions?: string | null; outcomes?: string | null; prereq_families?: string[]
  competencies: string[]; target_level: number; competency_levels?: Record<string, number> | null; pass_attendance: number; pass_score: number | null; need_product: boolean
  status: Status; version_no: number; source_id: string | null; updated_at: string; published_at: string | null; family_id: string; note: string | null
  final_exam?: FinalExam | null; eval_frame?: Frame | null
  scope?: 'all' | 'selected'; effective_from?: string | null; effective_to?: string | null; builder?: string | null
}
// 093: phiên bản & duyệt
export type Status = 'draft' | 'pending' | 'approved' | 'rejected' | 'published' | 'superseded' | 'archived'
/** Nhóm trạng thái cho thẻ tổng hợp: Đã phát hành · Nháp (gồm chờ duyệt, đã duyệt, bị trả lại) · Ngừng dùng */
const GROUP: Record<string, Status[]> = { published: ['published'], draft: ['draft', 'pending', 'approved', 'rejected'], off: ['superseded', 'archived'] }
export const STATUS: Record<Status, [string, string]> = {
  draft: ['Nháp', 'warn'], pending: ['Chờ duyệt', 'warn'], approved: ['Đã duyệt', 'good'], rejected: ['Bị trả lại', 'bad'],
  published: ['Đã phát hành', 'good'], superseded: ['Đã thay thế', 'off'], archived: ['Ngừng dùng', 'off'],
}
const EDITABLE: Status[] = ['draft', 'rejected']
type Unit = { id: string; program_id: string; parent_id: string | null; kind: 'subject' | 'content'; seq: number; title: string; hours: number; mode: 'online' | 'offline' | null; has_test: boolean; note: string | null; detail: Detail }
const MODE: Record<Mode, string> = { online: 'Trực tuyến', offline: 'Trực tiếp', hybrid: 'Kết hợp' }
const SEL = 'id, org_id, code, title, ct_code, level, ct_codes, levels, audience, mode, description, competencies, target_level, competency_levels, pass_attendance, pass_score, need_product, status, version_no, source_id, updated_at, published_at, family_id, note, objectives, entry_conditions, outcomes, prereq_families, scope, effective_from, effective_to, builder'
const SEL_X = SEL + ', final_exam, eval_frame'
const errText = (m: string) => /schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 083 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Chỉ đơn vị soạn chương trình (hoặc KDI) mới sửa được chương trình đào tạo này.' : m
const num = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')
type Stat = { subjects: number; contents: number; hours: number }

export function TrainingProgramsPage({ go }: { go?: (page: string) => void } = {}) {
  const [list, setList] = useState<TProgram[] | null>(null)
  const [stats, setStats] = useState<Map<string, Stat>>(new Map())
  const [targets, setTargets] = useState<Map<string, number>>(new Map())
  const [admin, setAdmin] = useState(false)
  const [rk, setRk] = useState(0)
  const [view, setView] = useState<{ kind: 'new' } | { kind: 'open'; id: string } | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [q, setQ] = useState('')
  const [card, setCard] = useState<string | null>(null)
  // Đơn vị tạo chương trình (KDI, Sở, Phòng, Trường): tên theo org_id
  const [owners, setOwners] = useState<Map<string, string>>(new Map())
  const { name: levelName } = useEduLevels()
  const reload = () => setRk(k => k + 1)
  // Đơn vị có quyền đào tạo (KDI, Sở, Phòng, Trường) tự soạn chương trình của mình (131)
  useEffect(() => { supabase.rpc('training_program_can_create').then(({ data }) => setAdmin(!!data)) }, [])
  useEffect(() => {
    (async () => {
      const [p, u, t] = await Promise.all([
        supabase.from('training_programs').select(SEL).order('code'),
        supabase.from('training_program_units').select('program_id, kind, hours'),
        supabase.from('training_program_targets').select('program_id'),
      ])
      const tc = new Map<string, number>()
      for (const r of (t.data ?? []) as { program_id: string }[]) tc.set(r.program_id, (tc.get(r.program_id) ?? 0) + 1)
      setTargets(tc)
      if (p.error) { setMsg([errText(p.error.message), true]); setList([]); return }
      const m = new Map<string, Stat>()
      for (const r of (u.data ?? []) as { program_id: string; kind: string; hours: number }[]) {
        let x = m.get(r.program_id); if (!x) m.set(r.program_id, x = { subjects: 0, contents: 0, hours: 0 })
        if (r.kind === 'subject') x.subjects++; else { x.contents++; x.hours += Number(r.hours) || 0 }
      }
      setList((p.data as TProgram[]) ?? []); setStats(m)
      const ids = [...new Set(((p.data ?? []) as TProgram[]).map(x => x.org_id).filter(Boolean))]
      if (ids.length) { const { data: o } = await supabase.from('organizations').select('id, name').in('id', ids)
        setOwners(new Map(((o ?? []) as { id: string; name: string }[]).map(x => [x.id, x.name]))) }
    })()
  }, [rk])

  // Lọc theo loại, đơn vị tạo, trạng thái: dùng bộ lọc theo cột của bảng
  const found = useMemo(() => (list ?? []).filter(p => !q || `${p.code} ${p.title} ${p.audience ?? ''}`.toLowerCase().includes(q.toLowerCase())), [list, q])
  const shown = useMemo(() => found.filter(p => !card || GROUP[card].includes(p.status)), [found, card])

  if (view?.kind === 'new') return <ProgramForm admin={admin} onBack={() => setView(null)} onSaved={id => { reload(); setView({ kind: 'open', id }) }} />
  if (view?.kind === 'open') return <ProgramDetail key={view.id + ':' + rk} id={view.id} admin={admin} go={go} onBack={() => { setView(null); reload() }}
    onOpen={id => { reload(); setView({ kind: 'open', id }) }} onMsg={m => { setMsg(m); reload() }} />

  const baseStats = shown.map(p => stats.get(p.id)).filter(Boolean) as Stat[]
  const totalContents = baseStats.reduce((a, x) => a + x.contents, 0)
  const scopeText = (p: TProgram) => p.scope === 'selected' ? `${targets.get(p.id) ?? 0} đơn vị được chọn` : 'Tất cả đơn vị'
  const kindText = (p: TProgram) => [ctsOf(p).join(', '), lvsOf(p).map(levelName).join(', ')].filter(Boolean).join(' · ')
  const progCols: Col<TProgram>[] = [
    { key: 'name', label: 'Chương trình đào tạo', fixed: true, values: p => [p.title], text: p => `${p.title} ${p.code} ${p.builder ?? ''}`,
      cell: p => <><button type="button" className="namelink" onClick={() => { setMsg(null); setView({ kind: 'open', id: p.id }) }}>{p.title}</button><br /><small className="sub">{p.code} · v{p.version_no}{p.builder ? ` · XD: ${p.builder}` : ''}</small></> },
    { key: 'kind', label: 'Loại · cấp học', text: kindText, values: p => [...ctsOf(p), ...lvsOf(p).map(levelName)], cell: p => kindText(p) || '—' },
    { key: 'aud', label: 'Đối tượng', text: p => p.audience ?? '', cell: p => p.audience || '—' },
    { key: 'scope', label: 'Phạm vi áp dụng', text: scopeText, cell: p => <>{scopeText(p)}{effNote(p) && <><br /><small className="sub">{effNote(p)}</small></>}</> },
    { key: 'owner', label: 'Đơn vị tạo', text: p => owners.get(p.org_id) ?? '', cell: p => owners.get(p.org_id) ?? '—' },
    { key: 'size', label: 'Môn · nội dung · giờ', cell: p => { const s = stats.get(p.id); return `${s?.subjects ?? 0} môn · ${s?.contents ?? 0} nội dung · ${num(s?.hours ?? 0)} giờ` } },
    { key: 'mode', label: 'Hình thức', text: p => MODE[p.mode], cell: p => MODE[p.mode] },
    { key: 'status', label: 'Trạng thái', text: p => STATUS[p.status][0], cell: p => <Chip tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Chip> },
    { key: 'code', label: 'Mã · phiên bản', off: true, text: p => `${p.code} v${p.version_no}`, cell: p => <small>{p.code} · v{p.version_no}</small> },
    { key: 'builder', label: 'Đơn vị xây dựng', off: true, text: p => p.builder ?? '', cell: p => p.builder || <small className="sub">—</small> },
    { key: 'pass', label: 'Điều kiện đạt', off: true, text: p => `${p.pass_attendance}%`, cell: p => <small>Chuyên cần ≥ {p.pass_attendance}%{p.pass_score != null ? ` · điểm ≥ ${p.pass_score}` : ''}{p.need_product ? ' · có sản phẩm' : ''}</small> },
    { key: 'comp', label: 'Năng lực hướng tới', off: true, text: p => `${p.competencies.length} năng lực`, cell: p => <small>{p.competencies.length ? `${p.competencies.length} năng lực · mức ${p.target_level}` : '—'}</small> },
    { key: 'pub', label: 'Ngày phát hành', off: true, text: p => p.published_at ? new Date(p.published_at).toLocaleDateString('vi-VN') : '', cell: p => <small>{p.published_at ? new Date(p.published_at).toLocaleDateString('vi-VN') : '—'}</small> },
    { key: 'upd', label: 'Cập nhật', cell: p => <small>{new Date(p.updated_at).toLocaleDateString('vi-VN')}</small> },
  ]
  return (
    <>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {list && <StatCards active={card} onPick={setCard} items={[
        { icon: 'book', value: found.filter(p => !GROUP.off.includes(p.status)).length, label: 'Chương trình',
          sub: `${found.reduce((a, p) => a + (stats.get(p.id)?.contents ?? 0), 0)} nội dung · ${num(found.reduce((a, p) => a + (stats.get(p.id)?.hours ?? 0), 0))} giờ` },
        { k: 'published', icon: 'checkCircle', tone: 'good', value: found.filter(p => GROUP.published.includes(p.status)).length, label: 'Đã phát hành' },
        { k: 'draft', icon: 'edit', tone: found.some(p => p.status === 'pending') ? 'warn' : '', value: found.filter(p => GROUP.draft.includes(p.status)).length, label: 'Nháp',
          sub: found.some(p => p.status === 'pending') ? `${found.filter(p => p.status === 'pending').length} chờ duyệt` : undefined },
        { k: 'off', icon: 'pause', value: found.filter(p => GROUP.off.includes(p.status)).length, label: 'Ngừng dùng' },
      ]} />}
      {!list ? <p className="sub">Đang tải…</p> : <DataTable id="training-programs" rows={shown} rowKey={p => p.id} cols={progCols}
        empty={admin ? 'Chưa có chương trình đào tạo nào. Bấm "+ Thêm chương trình".' : 'Chưa có chương trình đào tạo nào được phát hành cho đơn vị.'}
        left={<>
          <input placeholder="Tìm mã, tên, đối tượng…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
          <small className="sub">{shown.length}/{list.length} chương trình · {baseStats.reduce((a, x) => a + x.subjects, 0)} môn · {totalContents} nội dung</small></>}
        right={admin && <HeadAction><button type="button" className="primary ttadd" onClick={() => { setMsg(null); setView({ kind: 'new' }) }}>+ Thêm chương trình</button></HeadAction>} />}
    </>
  )
}

// ===== Thêm / sửa thông tin chương trình =====
const BLANK = { title: '', ct_codes: [] as string[], levels: [] as string[], audience: '', mode: 'hybrid' as Mode, description: '', competencies: [] as string[], target_level: 3, competency_levels: {} as Record<string, number>, pass_attendance: 80, pass_score: null as number | null, need_product: false,
  objectives: '', entry_conditions: '', outcomes: '', prereq_families: [] as string[], builder: '' }
type Info = typeof BLANK
/** Mức cần đạt của một năng lực đích: mức riêng (142), không có thì mức chung target_level */
const lvOf = (f: { competency_levels?: Record<string, number> | null; target_level: number }, k: string) => f.competency_levels?.[k] ?? f.target_level
/** Khi lưu: ghi đủ mức cho mọi năng lực đích, mức chung = mức cao nhất */
const withLv = (f: Info) => {
  const m = Object.fromEntries(f.competencies.map(k => [k, lvOf(f, k)]))
  return { competency_levels: m, target_level: f.competencies.length ? Math.max(...Object.values(m)) : f.target_level }
}
const lvRange = (f: { competencies: string[]; competency_levels?: Record<string, number> | null; target_level: number }) => {
  const ls = f.competencies.map(k => lvOf(f, k)); const a = Math.min(...ls), b = Math.max(...ls)
  return a === b ? `Mức ${a}` : `Mức ${a}–${b}`
}
// Loại chương trình / cấp học: mảng mới (090), dữ liệu cũ chỉ có cột đơn
const ctsOf = (p: { ct_codes?: string[] | null; ct_code: string | null }) => p.ct_codes?.length ? p.ct_codes : p.ct_code ? [p.ct_code] : []
const lvsOf = (p: { levels?: string[] | null; level: string | null }) => p.levels?.length ? p.levels : p.level ? [p.level] : []

/** Các chương trình đào tạo khác (theo họ phiên bản) để chọn làm tiên quyết */
function useFamilies(self?: string | null) {
  const [list, setList] = useState<[string, string][]>([])
  useEffect(() => {
    supabase.from('training_programs').select('family_id, code, title, version_no').neq('status', 'archived').order('version_no', { ascending: false }).then(({ data }) => {
      const m = new Map<string, string>()
      for (const r of (data ?? []) as { family_id: string; code: string; title: string }[]) if (r.family_id !== self && !m.has(r.family_id)) m.set(r.family_id, `${r.code} · ${r.title}`)
      setList([...m].sort((a, b) => a[1].localeCompare(b[1], 'vi')))
    })
  }, [self])
  return list
}

function PrereqNames({ ids }: { ids: string[] }) {
  const fams = useFamilies(null)
  return <>{ids.map(id => fams.find(f => f[0] === id)?.[1] ?? '…').join('; ')}</>
}

/** Nút chọn một trong vài giá trị (giống form chương trình giáo dục) */
function Seg<T extends string>({ value, opts, onPick, off }: { value: T; opts: [T, string][]; onPick: (v: T) => void; off?: boolean }) {
  return <div className="pfseg" role="radiogroup">{opts.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={value === k} className={value === k ? 'on' : ''} disabled={off} onClick={() => onPick(k)}>{l}</button>)}</div>
}

/** Form thêm / sửa chương trình đào tạo: mục lục bên trái, các thẻ đánh số ở giữa, Xem nhanh + nút Lưu bên phải (như chương trình giáo dục).
 *  edit: sửa được nội dung; scopeEdit: sửa được đơn vị xây dựng, phạm vi, hiệu lực, chương trình giáo dục đáp ứng (cả khi đã phát hành). */
function TForm({ f, set, x, setX, isNew, edit, scopeEdit, family, owner, busy, note, onSave, onCancel, onDelete }: {
  f: Info; set: (f: Info) => void; x: Extra; setX: (x: Extra) => void; isNew?: boolean; edit: boolean; scopeEdit: boolean; family?: string | null; owner?: string | null
  busy?: boolean; note?: React.ReactNode; onSave: () => void; onCancel: () => void; onDelete?: () => void
}) {
  const fams = useFamilies(family)
  const { codes, byCode: tracks } = useStemTracks()
  const { levels, name: levelName } = useEduLevels()
  const comps = useCompetencies('teacher')
  const orgs = useAllOrgs()
  const eduOpts0 = useEduOpts()
  const builders = useMemo(() => [...new Set(['KDI Education', ...(orgs ?? []).filter(o => o.type !== 'school').map(o => o.name)])].sort((a, b) => a.localeCompare(b, 'vi')), [orgs])
  const byId = useMemo(() => new Map((orgs ?? []).map(o => [o.id, o])), [orgs])
  const orgLabel = (id: string) => { const o = byId.get(id); if (!o) return 'Đơn vị'
    const par = o.parent_id ? byId.get(o.parent_id) : undefined
    return `${o.name} · ${OTYPE[o.type] ?? o.type}${par && o.type === 'school' ? ` (${par.name})` : ''}` }
  const orgOpts = useMemo(() => (orgs ?? []).filter(o => !o.is_platform && o.id !== owner && o.type !== 'provider')
    .sort((a, b) => (a.type === 'school' ? 1 : 0) - (b.type === 'school' ? 1 : 0) || a.name.localeCompare(b.name, 'vi'))
    .map(o => [o.id, orgLabel(o.id)] as [string, string]), [orgs, byId, owner])
  const eduOpts = (eduOpts0 ?? []).map(o => [famOf(o), eduLabel(o)] as [string, string])
  const eduName = (fam: string) => eduOpts.find(o => o[0] === fam)?.[1] ?? 'Chương trình giáo dục'
  const dis = !edit, sdis = !scopeEdit
  const S = (n: number) => ({ gridColumn: `span ${n}` })
  const bad = extraBad(x)
  const missing = [!f.title.trim() && 'Tên chương trình'].filter(Boolean) as string[]
  const secs: [string, string, boolean][] = [
    ['tf-1', 'Thông tin cơ bản', !missing.length],
    ['tf-2', 'Mục tiêu & đầu ra', !!(f.objectives?.trim() || f.outcomes?.trim())],
    ['tf-3', 'Năng lực đích & điều kiện đạt', f.competencies.length > 0],
    ['tf-4', 'Điều kiện tham gia', !!(f.entry_conditions?.trim() || f.prereq_families.length)],
    ['tf-5', 'Đơn vị, phạm vi & hiệu lực', !!f.builder?.trim() && !bad],
  ]
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const canSave = edit || scopeEdit
  const pass = [`chuyên cần ≥ ${f.pass_attendance}%`, f.pass_score != null && `điểm test ≥ ${num(Number(f.pass_score))}`, f.need_product && 'sản phẩm cuối khoá'].filter(Boolean).join(' · ')
  return <form className="pform pfwrap" onSubmit={e => { e.preventDefault(); if (canSave && !bad && f.title.trim()) onSave() }}>
    <nav className="panel pfnav" aria-label="Các phần của form">
      {secs.map(([id, t, ok], i) => <button key={id} type="button" className={ok ? 'ok' : ''} onClick={() => go(id)}><i>{ok ? '✓' : i + 1}</i>{t}</button>)}
    </nav>
    <div className="pfmain">
      {note && <p className="sub" style={{ margin: 0 }}>{note}</p>}

      <section id="tf-1" className="panel pfcard">
        <h4><i>1</i>Thông tin cơ bản</h4><p className="pfhint">Mục chọn đầu tiên là mục chính.</p>
        <div className="pgrid">
          <label className="field" style={S(12)}><span>Tên chương trình đào tạo *</span><input required disabled={dis} maxLength={200} value={f.title} onChange={e => set({ ...f, title: e.target.value })} placeholder="VD: Đào tạo dạy học STEM tích hợp cho nhà giáo THCS" /></label>
          <div className="field" style={S(6)}><span>Loại chương trình</span>
            <ChipMulti disabled={dis} value={f.ct_codes} onChange={v => set({ ...f, ct_codes: v })} options={codes.map(c => [c, `${c}${tracks[c] ? ' · ' + tracks[c]!.name : ''}`])} ariaLabel="Loại chương trình" firstHint="Loại chính" placeholder="Không chọn" /></div>
          <div className="field" style={S(6)}><span>Cấp học</span>
            <ChipMulti disabled={dis} value={f.levels} onChange={v => set({ ...f, levels: v })} options={levels.map(l => [l.code, l.name])} ariaLabel="Cấp học" placeholder="Tất cả cấp học" /></div>
          <div className="field" style={S(6)}><span>Hình thức</span><Seg value={f.mode} off={dis} onPick={m => set({ ...f, mode: m })} opts={(Object.keys(MODE) as Mode[]).map(m => [m, MODE[m]])} /></div>
          <label className="field" style={S(6)}><span>Đối tượng</span><input disabled={dis} maxLength={200} value={f.audience ?? ''} onChange={e => set({ ...f, audience: e.target.value })} placeholder="VD: Nhà giáo mới dạy STEM" /></label>
          <label className="field" style={S(12)}><span>Mô tả</span><textarea disabled={dis} rows={2} maxLength={4000} value={f.description ?? ''} onChange={e => set({ ...f, description: e.target.value })} /></label>
        </div>
      </section>

      <section id="tf-2" className="panel pfcard">
        <h4><i>2</i>Mục tiêu & yêu cầu đầu ra</h4><p className="pfhint">Không bắt buộc. Có thể bổ sung sau.</p>
        <div className="pgrid">
          <label className="field" style={S(12)}><span>Mục tiêu</span><textarea disabled={dis} rows={2} maxLength={4000} value={f.objectives ?? ''} onChange={e => set({ ...f, objectives: e.target.value })} placeholder="Sau đào tạo, nhà giáo…" /></label>
          <label className="field" style={S(12)}><span>Yêu cầu đầu ra</span><textarea disabled={dis} rows={2} maxLength={4000} value={f.outcomes ?? ''} onChange={e => set({ ...f, outcomes: e.target.value })}
            placeholder="VD: Thiết kế được 1 kế hoạch bài dạy STEM; lắp ráp và lập trình được robot cơ bản" /></label>
        </div>
      </section>

      <section id="tf-3" className="panel pfcard">
        <h4><i>3</i>Năng lực đích & điều kiện đạt</h4><p className="pfhint">Điều kiện đạt dùng khi đánh giá kết quả và cấp chứng chỉ.</p>
        <div className="pgrid">
          <div className="field" style={S(12)}><span>Năng lực đích (khung năng lực nhà giáo) {edit && <CompetencySetupLink audience="teacher" />}</span>
            <MultiSelect disabled={dis} value={f.competencies} onChange={v => set({ ...f, competencies: v })} options={comps.map(c => [c.key, c.name])} placeholder="Chọn năng lực đích…" ariaLabel="Năng lực đích" empty="Chưa có khung năng lực nhà giáo." /></div>
          {f.competencies.length > 0 && <div className="field pfcomplv" style={S(12)}><span>Mức cần đạt sau đào tạo · chọn riêng cho từng năng lực</span>
            {f.competencies.map(k => { const cur = lvOf(f, k); return <div key={k} className="pfcomprow">
              <b>{comps.find(c => c.key === k)?.name ?? k}</b>
              <div className="pflv" role="radiogroup" aria-label={'Mức cần đạt: ' + (comps.find(c => c.key === k)?.name ?? k)}>{[1, 2, 3, 4].map(l => <button key={l} type="button" role="radio" aria-checked={cur === l} disabled={dis}
                className={cur === l ? 'on' : cur > l ? 'in' : ''} title={`Mức ${l} · ${LV_NAME[l - 1]}`} onClick={() => set({ ...f, competency_levels: { ...(f.competency_levels ?? {}), [k]: l } })}>{l}</button>)}
                <small className="sub">{LV_NAME[cur - 1]}</small></div></div> })}</div>}
          <label className="field" style={S(3)}><span>Chuyên cần tối thiểu (%)</span><input type="number" disabled={dis} min={0} max={100} value={f.pass_attendance} onChange={e => set({ ...f, pass_attendance: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></label>
          <label className="field" style={S(3)}><span>Điểm test tối thiểu (thang 10)</span><input type="number" disabled={dis} min={0} max={10} step={0.5} value={f.pass_score ?? ''} placeholder="Trống = không xét"
            onChange={e => set({ ...f, pass_score: e.target.value === '' ? null : Math.max(0, Math.min(10, Number(e.target.value))) })} /></label>
          <div className="field" style={S(6)}><span>Sản phẩm cuối khoá</span><Seg value={f.need_product ? 'y' : 'n'} off={dis} onPick={v => set({ ...f, need_product: v === 'y' })} opts={[['n', 'Không bắt buộc'], ['y', 'Bắt buộc, giảng viên chấm đạt']]} /></div>
        </div>
      </section>

      <section id="tf-4" className="panel pfcard">
        <h4><i>4</i>Điều kiện tham gia</h4><p className="pfhint">Không bắt buộc.</p>
        <div className="pgrid">
          <label className="field" style={S(12)}><span>Điều kiện tham gia</span><textarea disabled={dis} rows={2} maxLength={2000} value={f.entry_conditions ?? ''} onChange={e => set({ ...f, entry_conditions: e.target.value })}
            placeholder="VD: Nhà giáo đang dạy Khoa học tự nhiên hoặc Công nghệ, có máy tính cá nhân" /></label>
          <div className="field" style={S(12)}><span>Chương trình tiên quyết (phải đạt trước)</span>
            <MultiSelect disabled={dis} value={f.prereq_families} onChange={v => set({ ...f, prereq_families: v })} options={fams} placeholder="Không có" ariaLabel="Chương trình tiên quyết" empty="Chưa có chương trình đào tạo khác." /></div>
        </div>
      </section>

      <section id="tf-5" className="panel pfcard">
        <h4><i>5</i>Đơn vị, phạm vi & hiệu lực</h4><p className="pfhint">Vẫn sửa được sau khi phát hành. Đơn vị trong phạm vi (và đơn vị trực thuộc) mới thấy và chọn được chương trình khi lập kế hoạch.</p>
        <div className="pgrid">
          <label className="field" style={S(6)}><span>Đơn vị xây dựng <small className="sub">(nơi biên soạn nội dung)</small></span>
            <input disabled={dis} maxLength={200} list="tp-builders" value={f.builder ?? ''} onChange={e => set({ ...f, builder: e.target.value })} placeholder="KDI Education, Sở GD&ĐT…, Trường ĐHSP…" />
            <datalist id="tp-builders">{builders.map(n => <option key={n} value={n} />)}</datalist></label>
          <div className="field" style={S(6)}><span>Áp dụng cho</span><Seg value={x.scope} off={sdis} onPick={v => setX({ ...x, scope: v })} opts={[['all', 'Tất cả đơn vị trực thuộc'], ['selected', 'Chỉ đơn vị được chọn']]} /></div>
          {x.scope === 'selected' && <div className="field" style={S(12)}><span>Đơn vị áp dụng * <small className="sub">(chọn Sở / Phòng là áp dụng cho tất cả trường trực thuộc)</small></span>
            <MultiSelect disabled={sdis} value={x.targets} onChange={v => setX({ ...x, targets: v })} options={[...orgOpts, ...x.targets.filter(id => !orgOpts.some(o => o[0] === id)).map(id => [id, orgLabel(id)] as [string, string])]}
              placeholder="Chọn Sở, Phòng hoặc trường…" ariaLabel="Đơn vị áp dụng" empty="Chưa có đơn vị nào." /></div>}
          <label className="field" style={S(4)}><span>Hiệu lực từ</span><input type="date" disabled={sdis} value={x.effective_from} onChange={e => setX({ ...x, effective_from: e.target.value })} /></label>
          <label className="field" style={S(4)}><span>Hiệu lực đến <small className="sub">(trống = không hạn)</small></span><input type="date" disabled={sdis} value={x.effective_to} min={x.effective_from || undefined} onChange={e => setX({ ...x, effective_to: e.target.value })} /></label>
          <div className="field" style={S(12)}><span>Chương trình giáo dục đáp ứng <small className="sub">(nhà giáo Đạt khoá này được tính đáp ứng các chương trình giáo dục đã chọn)</small></span>
            <MultiSelect disabled={sdis} value={x.edu} onChange={v => setX({ ...x, edu: v })} options={[...eduOpts, ...x.edu.filter(fm => !eduOpts.some(o => o[0] === fm)).map(fm => [fm, 'Chương trình giáo dục'] as [string, string])]}
              placeholder={eduOpts0 ? 'Chọn chương trình giáo dục…' : 'Đang tải…'} ariaLabel="Chương trình giáo dục đáp ứng" empty="Chưa có chương trình giáo dục nào." /></div>
        </div>
        {bad && <small className="warnline">{bad}</small>}
      </section>
    </div>

    <aside className="pfside">
      <div className="panel pdcard">
        <h4>Xem nhanh</h4>
        <dl className="pddl sm">
          <dt>Tên</dt><dd><b>{f.title.trim() || '—'}</b></dd>
          <dt>Loại</dt><dd>{f.ct_codes.join(', ') || '—'}</dd>
          <dt>Cấp học</dt><dd>{f.levels.length ? f.levels.map(levelName).join(', ') : 'Tất cả cấp học'}</dd>
          <dt>Hình thức</dt><dd>{MODE[f.mode]}</dd>
          <dt>Đối tượng</dt><dd>{f.audience?.trim() || '—'}</dd>
          <dt>Năng lực đích</dt><dd>{f.competencies.length ? `${f.competencies.length} năng lực · ${lvRange(f)}` : '—'}</dd>
          <dt>Điều kiện đạt</dt><dd>{pass}</dd>
          <dt>Áp dụng</dt><dd>{x.scope === 'selected' ? `${x.targets.length} đơn vị được chọn` : 'Tất cả đơn vị trực thuộc'}</dd>
          {x.edu.length > 0 && <><dt>CT giáo dục</dt><dd>{x.edu.map(eduName).join('; ')}</dd></>}
        </dl>
        {edit && (missing.length ? <p className="pfmiss">Còn thiếu: {missing.join(', ')}</p> : <p className="pfok">✓ Đã đủ thông tin bắt buộc</p>)}
        <div className="pfsidebtn">
          {canSave && <button className="primary" type="submit" disabled={busy || !f.title.trim() || !!bad}>{busy ? 'Đang lưu…' : isNew ? 'Tạo bản nháp' : 'Lưu thay đổi'}</button>}
          <button type="button" onClick={onCancel}>Huỷ</button>
          {onDelete && <button type="button" className="danger" onClick={onDelete} title="Xoá bản nháp">Xoá</button>}
        </div>
      </div>
    </aside>
  </form>
}

function ProgramForm({ admin, onBack, onSaved }: { admin: boolean; onBack: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState<Info>(BLANK)
  const [x, setX] = useState<Extra>(EXTRA_BLANK)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!admin) return
    const bad = extraBad(x); if (bad) return setErr(bad)
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('training_programs').insert({ ...f, ...withLv(f), title: f.title.trim(), audience: f.audience?.trim() || null, description: f.description?.trim() || null, builder: f.builder?.trim() || null,
      scope: x.scope, effective_from: x.effective_from || null, effective_to: x.effective_to || null }).select('id').single()
    if (error) { setBusy(false); return setErr(errText(error.message)) }
    const id = (data as { id: string }).id
    const e2 = await saveExtra(id, x, { ...EXTRA_BLANK, scope: x.scope })
    setBusy(false)
    if (e2) return setErr(`Đã tạo bản nháp nhưng chưa lưu được phạm vi / chương trình giáo dục: ${e2}`)
    onSaved(id)
  }
  return <>
    <DetailHead back="Chương trình đào tạo" onBack={onBack} title="Thêm chương trình đào tạo" />
    <div className="bar"><div>
      <small className="sub">Lưu xong thì thêm các môn và nội dung đào tạo.</small></div></div>
    {err && <p className="msg" role="status"><b>{err}</b></p>}
    <TForm f={f} set={setF} x={x} setX={setX} isNew edit={admin} scopeEdit={admin} busy={busy} onSave={save} onCancel={onBack} />
  </>
}

// ===== Chi tiết: thông tin + môn & nội dung đào tạo =====
// 3 tab như Chương trình giáo dục; tên tab cũ (units, exam, eval, versions) vẫn nhận để mở từ trang khác
export type PTab = 'info' | 'setup' | 'assign' | 'units' | 'exam' | 'eval' | 'versions'
/** initialTab / initialContent: mở sẵn một tab hoặc một nội dung (VD: từ mục Kiểm tra & luyện tập); startFinal: mở sẵn form đề cuối khoá; back: nhãn nút quay lại */
export function ProgramDetail({ id, admin: _admin, go, onBack, onOpen, onMsg, initialTab, initialContent, startFinal, back = 'Chương trình đào tạo' }: { id: string; admin: boolean; go?: (page: string) => void; onBack: () => void; onOpen: (id: string) => void; onMsg: (m: [string, boolean]) => void
  initialTab?: PTab; initialContent?: string | null; startFinal?: boolean; back?: string }) {
  // Cột thông tin bên phải thu/mở được (dùng chung lựa chọn với chương trình giáo dục)
  const [side, setSide] = useState(() => { try { const v = localStorage.getItem('pd-side'); if (v) return v === '1' } catch { /* bỏ qua */ } return true })
  const toggleSide = () => setSide(v => { try { localStorage.setItem('pd-side', v ? '0' : '1') } catch { /* bỏ qua */ } return !v })
  const [p, setP] = useState<TProgram | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [f, setF] = useState<Info | null>(null)
  const [x, setX] = useState<Extra | null>(null)
  const [x0, setX0] = useState<Extra | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [openC, setOpenC] = useState<string | null>(initialContent ?? null)
  const [tab, setTab] = useState<PTab>(initialTab ?? 'info')
  const [editInfo, setEditInfo] = useState(false)
  const [busy, setBusy] = useState(false)
  const eduOpts = useEduOpts()
  const { subjects } = useSubjects()
  const { byCode: tracks } = useStemTracks()
  const { name: levelName } = useEduLevels()
  const comps = useCompetencies('teacher')
  // Quyền sửa theo đơn vị soạn chương trình (131): KDI hoặc chính đơn vị đó
  const [admin, setAdmin] = useState(false)
  useEffect(() => { supabase.rpc('training_program_can_edit', { p_program: id }).then(({ data }) => setAdmin(!!data)) }, [id])
  async function load() {
    const [a, b] = await Promise.all([
      supabase.from('training_programs').select(SEL_X).eq('id', id).single(),
      supabase.from('training_program_units').select('*').eq('program_id', id).order('seq'),
    ])
    if (a.error) return setMsg([errText(a.error.message), true])
    const x = a.data as unknown as TProgram
    setP(x); setUnits((b.data as Unit[]) ?? [])
    setF({ title: x.title, ct_codes: ctsOf(x), levels: lvsOf(x), audience: x.audience ?? '', mode: x.mode, description: x.description ?? '', competencies: x.competencies ?? [],
      target_level: x.target_level, competency_levels: x.competency_levels ?? {}, pass_attendance: x.pass_attendance, pass_score: x.pass_score, need_product: x.need_product,
      objectives: x.objectives ?? '', entry_conditions: x.entry_conditions ?? '', outcomes: x.outcomes ?? '', prereq_families: x.prereq_families ?? [], builder: x.builder ?? '' })
    const ex = await loadExtra(x); setX(ex); setX0(ex)
  }
  useEffect(() => { load() }, [id])
  if (!p || !f) return <ElView back={back} onBack={onBack} title="Đang tải…">{msg && <p className="msg">{msg[0]}</p>}</ElView>

  const edit = admin && EDITABLE.includes(p.status)
  const subjs = units.filter(u => u.kind === 'subject').sort((a, b) => a.seq - b.seq)
  const kids = (sid: string) => units.filter(u => u.parent_id === sid).sort((a, b) => a.seq - b.seq)
  const contents = units.filter(u => u.kind === 'content')
  const hours = contents.reduce((a, u) => a + (Number(u.hours) || 0), 0)
  const suggest = [...new Set([...subjects.map(s => s.name), ...ctsOf(p).flatMap(c => tracks[c]?.subjects ?? [])])].sort((a, b) => a.localeCompare(b, 'vi'))
  const run = async (q: PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    const { error } = await q
    if (error) setMsg([errText(error.message), true]); else if (ok) setMsg([ok, false])
    await load()
    return !error
  }
  async function saveInfo() {
    if (!f || !x || !x0) return
    const bad = extraBad(x); if (bad) return setMsg([bad, true])
    setBusy(true)
    if (admin && EDITABLE.includes(p!.status)) {
      const { error } = await supabase.from('training_programs').update({ ...f, ...withLv(f), title: f.title.trim(), audience: f.audience?.trim() || null, description: f.description?.trim() || null, builder: f.builder?.trim() || null }).eq('id', p!.id)
      if (error) { setBusy(false); setMsg([errText(error.message), true]); return load() }
    }
    const e2 = await saveExtra(p!.id, x, x0)
    setBusy(false)
    setMsg(e2 ? [`Đã lưu thông tin nhưng chưa lưu được phạm vi / chương trình giáo dục: ${e2}`, true] : ['Đã lưu chương trình đào tạo.', false])
    if (!e2) setEditInfo(false)
    await load()
  }
  async function del() {
    if (!confirm(`Xoá bản nháp "${p!.title}"?`)) return
    const { error } = await supabase.from('training_programs').delete().eq('id', p!.id)
    if (error) return setMsg([errText(error.message), true])
    onMsg(['Đã xoá bản nháp.', false]); onBack()
  }
  const oc = openC ? units.find(u => u.id === openC) : undefined
  if (oc) {
    const sj = units.find(u => u.id === oc.parent_id)
    return <ContentDetail key={oc.id} title={oc.title} crumb={`${p.title} › ${sj?.title ?? ''}`} hours={Number(oc.hours)} detail={oc.detail ?? {}} editable={edit} hasTest={oc.has_test} passScore={p.pass_score}
      initialTab={initialContent === oc.id ? 'test' : undefined} onBack={() => setOpenC(null)} onSave={dd => run(supabase.from('training_program_units').update({ detail: dd }).eq('id', oc.id))} />
  }
  const warn = [!contents.length && 'chưa có nội dung đào tạo nào', p.pass_score != null && !contents.some(u => u.has_test) && 'có điều kiện điểm bài test nhưng chưa nội dung nào có bài test',
    subjs.some(s => !kids(s.id).length) && 'có môn chưa có nội dung'].filter(Boolean) as string[]

  const t: 'info' | 'assign' = tab === 'assign' ? 'assign' : 'info'
  const saveP = (patch: Record<string, unknown>, ok?: string) => run(supabase.from('training_programs').update(patch).eq('id', p.id), ok)
  const onVer = (m: string, e?: boolean) => { setMsg([m, !!e]); if (!e) load() }
  const scopeEdit = admin && p.status !== 'archived'
  const none = <span className="sub">Chưa có</span>
  const chips = (xs: string[]) => xs.length ? <span className="pvchips">{xs.map(v => <span key={v} className="pill">{v}</span>)}</span> : none
  const note = effNote(p)
  const tests = contents.filter(u => u.has_test).length
  const eduNames = (x0?.edu ?? []).map(fm => { const o = (eduOpts ?? []).find(e => famOf(e) === fm); return o ? eduLabel(o) : 'Chương trình giáo dục' })

  return <>
    <div className="bar">
      <div>
        <DetailHead back={back} onBack={onBack} title={p.title} extra={<><small className="pdver">v{p.version_no}</small><Chip tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Chip></>} />
        <small className="sub">{[p.code, ctsOf(p).join(', '), lvsOf(p).length ? lvsOf(p).map(levelName).join(', ') : 'Mọi cấp học', MODE[p.mode], `${num(hours)} giờ`].filter(Boolean).join(' · ')}</small>
      </div>
      <div className="tools">
        {!editInfo && <TrainingVersionActions lead={[t === 'info' && edit && { key: 'edit', label: 'Sửa thông tin', icon: 'pencil', rank: 1, onClick: () => setEditInfo(true) }]} p={p} admin={admin} warn={warn} onOpen={onOpen} onChanged={onVer} onDelete={admin && p.status === 'draft' ? del : undefined} />}
      </div>
    </div>
    <div className="segmented pdtabs">
      {([['info', 'Chương trình'], ['assign', 'Gán & triển khai']] as [PTab, string][]).map(([k, l]) => <button key={k} type="button" className={t === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
    </div>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {t === 'info' && edit && warn.length > 0 && !editInfo && <p className="warnline">Chưa phát hành được: {warn.join('; ')}.</p>}

    {t === 'info' && editInfo && x && <TForm f={f} set={setF} x={x} setX={setX} edit={edit} scopeEdit={scopeEdit} family={p.family_id} owner={p.org_id} busy={busy}
      note={!edit ? 'Chương trình đã gửi duyệt hoặc phát hành: nội dung không sửa được (bấm "Tạo phiên bản mới" ở đầu trang). Đơn vị, phạm vi, hiệu lực và chương trình giáo dục đáp ứng vẫn sửa được.' : undefined}
      onSave={saveInfo} onCancel={() => { load(); setEditInfo(false) }} onDelete={admin && p.status === 'draft' ? del : undefined} />}

    {t === 'info' && !editInfo && <div className={'pdgrid' + (side ? '' : ' pdnoside')}>
      <div className="pdmain">
        <div className="pdstats">
          <div><b>{subjs.length}</b><span>môn</span></div>
          <div><b>{contents.length}</b><span>nội dung</span></div>
          <div><b>{num(hours)}</b><span>giờ</span></div>
          <div><b>{tests}</b><span>bài test</span></div>
          <div><b>{MODE[p.mode]}</b><span>hình thức</span></div>
          {!side && <button type="button" className="pdsidetg" onClick={toggleSide} title="Mở cột thông tin chương trình">‹ Thông tin</button>}
        </div>
        <div className="panel pdcard pdsl">
          <TrainingUnits programId={p.id} programTitle={p.title} programMode={p.mode} units={units} editable={edit} catalog={suggest}
            onReload={load} onMessage={(m, e) => setMsg([errText(m), !!e])} onOpen={setOpenC} />
        </div>
        <ProgramExams p={p} units={units} edit={edit} onOpen={setOpenC} autoStart={startFinal} save={saveP} />
        <ProgramEvalFrame key={p.id + (p.eval_frame ? '1' : '0') + (edit ? 'e' : 'v')} p={p} edit={edit} hasFinal={!!p.final_exam} hasTests={tests > 0} save={saveP} />
      </div>
      {side && <div className="pdside">
        <div className="panel pdcard"><h4 className="pdcardh">Thông tin chung<button type="button" className="pdsidetg incard" onClick={toggleSide} title="Thu cột thông tin để bảng rộng hơn">Thu gọn ›</button></h4>
          <dl className="pddl sm">
            <dt>Mã</dt><dd>{p.code || none}</dd>
            <dt>Loại</dt><dd>{ctsOf(p).map(c => c + (tracks[c] ? ' · ' + tracks[c]!.name : '')).join(', ') || '—'}</dd>
            <dt>Cấp học</dt><dd>{lvsOf(p).length ? lvsOf(p).map(levelName).join(', ') : 'Tất cả cấp học'}</dd>
            <dt>Hình thức</dt><dd>{MODE[p.mode]}</dd>
            <dt>Đối tượng</dt><dd>{p.audience || '—'}</dd>
            <dt>Xây dựng</dt><dd>{p.builder || '—'}</dd>
          </dl>
        </div>
        <div className="panel pdcard"><h4>Mục tiêu & đầu ra</h4>
          <dl className="pddl sm">
            <dt>Mục tiêu</dt><dd style={{ whiteSpace: 'pre-line' }}>{p.objectives || <span className="sub">Chưa nhập{edit ? ' · bấm “Sửa thông tin” để thêm' : ''}</span>}</dd>
            <dt>Yêu cầu đầu ra</dt><dd style={{ whiteSpace: 'pre-line' }}>{p.outcomes || none}</dd>
            {p.description && <><dt>Mô tả</dt><dd style={{ whiteSpace: 'pre-line' }}>{p.description}</dd></>}
          </dl>
        </div>
        <div className="panel pdcard"><h4>Năng lực đích & điều kiện đạt</h4>
          <dl className="pddl sm">
            <dt>Năng lực đích · mức cần đạt</dt><dd>{p.competencies.length ? chips(p.competencies.map(k => `${comps.find(c => c.key === k)?.name ?? k} · Mức ${lvOf(p, k)} ${LV_NAME[lvOf(p, k) - 1]}`)) : '—'}</dd>
            <dt>Điều kiện đạt</dt><dd>{[`chuyên cần ≥ ${p.pass_attendance}%`, p.pass_score != null && `điểm test ≥ ${num(Number(p.pass_score))}`, p.need_product && 'sản phẩm cuối khoá đạt'].filter(Boolean).join(' · ')}</dd>
          </dl>
        </div>
        {(p.entry_conditions || !!p.prereq_families?.length) && <div className="panel pdcard"><h4>Điều kiện tham gia</h4>
          <dl className="pddl sm">
            {p.entry_conditions && <><dt>Điều kiện</dt><dd style={{ whiteSpace: 'pre-line' }}>{p.entry_conditions}</dd></>}
            {!!p.prereq_families?.length && <><dt>Tiên quyết</dt><dd><PrereqNames ids={p.prereq_families} /></dd></>}
          </dl>
        </div>}
        <div className="panel pdcard"><h4>Phạm vi & hiệu lực {note && <span className={'pill ' + (note.startsWith('Hết') ? 'bad' : 'warn')}>{note}</span>}
          {!edit && scopeEdit && <button type="button" className="linkbtn" onClick={() => setEditInfo(true)}>Điều chỉnh ›</button>}</h4>
          <dl className="pddl sm">
            <dt>Áp dụng</dt><dd>{p.scope === 'selected' ? `${x0?.targets.length ?? '…'} đơn vị được chọn` : 'Tất cả đơn vị trực thuộc'}</dd>
            <dt>Hiệu lực</dt><dd>{[p.effective_from && `Từ ${vnDay(p.effective_from)}`, p.effective_to && `đến ${vnDay(p.effective_to)}`].filter(Boolean).join(' ') || 'Không giới hạn'}</dd>
            <dt>CT giáo dục</dt><dd>{eduNames.length ? chips(eduNames) : <span className="sub">Chưa gắn</span>}</dd>
          </dl>
        </div>
        <div className="panel pdcard"><h4>Phiên bản</h4><TrainingVersions p={p} onOpen={onOpen} /></div>
      </div>}
    </div>}
    {t === 'assign' && <TrainingDeploy p={p} go={go} />}
  </>
}

// ===== Phiên bản & duyệt (093) =====
type TLog = { id: number; from_status: string | null; to_status: string; note: string | null; at: string }
type TVer = Pick<TProgram, 'id' | 'version_no' | 'status' | 'published_at' | 'updated_at' | 'note'>
/** Nút gửi duyệt / duyệt / phát hành / tạo phiên bản mới / ngừng dùng — hiện trên thẻ thông tin */
function TrainingVersionActions({ p, admin, warn, onOpen, onChanged, onDelete, lead }: {
  lead?: (Act | false | null | undefined)[]
  p: TProgram; admin: boolean; warn: string[]; onOpen: (id: string) => void; onChanged: (m: string, err?: boolean) => void; onDelete?: () => void
}) {
  const [busy, setBusy] = useState(false)
  async function setStatus(s: Status, ask?: string, required?: boolean) {
    let note: string | null = ''
    if (ask) { note = prompt(ask, ''); if (note === null) return; if (required && !note.trim()) return onChanged('Nhập lý do trả lại.', true) }
    setBusy(true)
    const { error } = await supabase.rpc('training_program_set_status', { p_program: p.id, p_status: s, p_note: note?.trim() || null })
    setBusy(false)
    if (error) return onChanged(errText(error.message), true)
    onChanged({ pending: 'Đã gửi duyệt.', approved: 'Đã duyệt.', rejected: 'Đã trả lại để sửa.', published: `Đã phát hành ${p.code} v${p.version_no}.`,
      draft: 'Đã mở lại thành bản nháp.', archived: 'Đã ngừng dùng.', superseded: '' }[s])
  }
  async function newVersion() {
    if (!confirm('Tạo phiên bản mới (bản nháp chép từ phiên bản này)? Phiên bản đang phát hành vẫn dùng đến khi bản mới được phát hành.')) return
    setBusy(true)
    const { data, error } = await supabase.rpc('training_program_new_version', { p_program: p.id })
    setBusy(false)
    if (error) return onChanged(errText(error.message), true)
    onOpen(data as string)
  }
  const s = p.status
  const ready = !warn.length
  if (!admin) return lead?.some(Boolean) ? <ActionBar items={lead} /> : null
  const why = ready ? undefined : `Chưa gửi duyệt / phát hành được: ${warn.join('; ')}.`
  return <ActionBar items={[
    ...(lead ?? []),
    (s === 'draft' || s === 'rejected') && { key: 'send', label: 'Gửi duyệt', rank: 1, disabled: busy || !ready, title: why, onClick: () => setStatus('pending', 'Ghi chú gửi người duyệt (không bắt buộc):') },
    s === 'draft' && { key: 'pub', label: 'Phát hành', kind: 'primary', disabled: busy || !ready, title: why, onClick: () => { if (confirm('Phát hành ngay phiên bản này? Phiên bản đang phát hành (nếu có) sẽ được thay thế.')) setStatus('published') } },
    s === 'pending' && { key: 'ok', label: 'Duyệt', kind: 'primary', disabled: busy, onClick: () => setStatus('approved', 'Ghi chú khi duyệt (không bắt buộc):') },
    s === 'pending' && { key: 'back', label: 'Trả lại', kind: 'danger', rank: 1, disabled: busy, onClick: () => setStatus('rejected', 'Lý do trả lại:', true) },
    s === 'approved' && { key: 'pub2', label: 'Phát hành', kind: 'primary', disabled: busy, onClick: () => setStatus('published', 'Ghi chú phát hành (không bắt buộc):') },
    s === 'approved' && { key: 'reopen', label: 'Mở lại để sửa', disabled: busy, onClick: () => setStatus('draft') },
    (s === 'published' || s === 'superseded') && { key: 'ver', label: 'Tạo phiên bản mới', kind: 'primary', disabled: busy, onClick: newVersion },
    onDelete && { key: 'del', label: 'Xoá bản nháp', icon: 'trash', kind: 'danger', disabled: busy, onClick: onDelete },
    ['published', 'superseded', 'approved', 'rejected', 'draft'].includes(s) && { key: 'arch', label: 'Ngừng dùng', kind: 'danger', rank: 4, disabled: busy,
      onClick: () => { if (confirm('Ngừng dùng phiên bản này? Kế hoạch đã có vẫn giữ nguyên.')) setStatus('archived', 'Lý do ngừng dùng (không bắt buộc):') } },
    s === 'archived' && { key: 'reuse', label: 'Dùng lại', disabled: busy, onClick: () => setStatus('published', 'Ghi chú (không bắt buộc):') },
  ]} />
}

function TrainingVersions({ p, onOpen }: { p: TProgram; onOpen: (id: string) => void }) {
  const [vers, setVers] = useState<TVer[]>([])
  const [log, setLog] = useState<TLog[]>([])
  useEffect(() => {
    Promise.all([
      supabase.from('training_programs').select('id, version_no, status, published_at, updated_at, note').eq('family_id', p.family_id).order('version_no', { ascending: false }),
      supabase.from('training_program_log').select('id, from_status, to_status, note, at').eq('program_id', p.id).order('at', { ascending: false }),
    ]).then(([v, l]) => { setVers((v.data as TVer[]) ?? []); setLog((l.data as TLog[]) ?? []) })
  }, [p.id, p.status])
  const stName = (s: string) => STATUS[s as Status]?.[0] ?? s
  return <>
    <ul className="pdvers">{vers.map(v => <li key={v.id} className={v.id === p.id ? 'on' : ''}>
      {v.id === p.id ? <b>v{v.version_no}</b> : <button type="button" className="namelink" onClick={() => onOpen(v.id)}>v{v.version_no}</button>}
      {v.id === p.id && <small className="sub">đang xem</small>}<span style={{ flex: 1 }} /><Chip tone={STATUS[v.status][1]}>{STATUS[v.status][0]}</Chip>
      <small className="sub">{v.published_at ? new Date(v.published_at).toLocaleDateString('vi-VN') : ''}</small></li>)}</ul>
    {log.length > 0 && <details className="pdlog"><summary>Lịch sử trạng thái ({log.length})</summary><ul className="sub">
      {log.map(l => <li key={l.id}>{new Date(l.at).toLocaleString('vi-VN')} · {l.from_status ? `${stName(l.from_status)} → ` : ''}<b>{stName(l.to_status)}</b>{l.note ? ` — ${l.note}` : ''}</li>)}</ul></details>}
  </>
}

// ===== Gán & triển khai: chương trình đến đơn vị qua Kế hoạch đào tạo =====
type DPlan = { plan_id: string; program_id: string; quota: number | null
  training_plans: { id: string; plan_code: string | null; name: string; year_name: string | null; starts_on: string | null; ends_on: string | null; pub_status: string; organizations: { name: string } | null } | null }
type DRowM = { plan_id: string; org_id: string; org_name: string; quota: number | null; org_status: string; enrolled: number; att_pct: number | null; passed: number; failed: number; certs: number }
const PLAN_ST: Record<string, [string, string]> = { draft: ['Nháp', 'warn'], published: ['Đã ban hành', 'good'], archived: ['Đã đóng', 'off'] }
function TrainingDeploy({ p, go }: { p: TProgram; go?: (page: string) => void }) {
  const [plans, setPlans] = useState<DPlan[] | null>(null)
  const [rows, setRows] = useState<DRowM[]>([])
  const [vers, setVers] = useState<Map<string, number>>(new Map())
  const orgF = useOrgFilter()
  useEffect(() => {
    (async () => {
      const v = await supabase.from('training_programs').select('id, version_no').eq('family_id', p.family_id)
      const vs = (v.data as { id: string; version_no: number }[]) ?? []
      setVers(new Map(vs.map(x => [x.id, x.version_no])))
      const ids = vs.length ? vs.map(x => x.id) : [p.id]
      const [a, m] = await Promise.all([
        supabase.from('training_plan_items').select('plan_id, program_id, quota, training_plans(id, plan_code, name, year_name, starts_on, ends_on, pub_status, organizations(name))').in('program_id', ids),
        supabase.rpc('training_monitor', { p_year: null }),
      ])
      const ps = ((a.data as unknown as DPlan[]) ?? []).filter(x => x.training_plans)
      setPlans(ps)
      const pids = new Set(ps.map(x => x.plan_id))
      setRows(((m.data as DRowM[]) ?? []).filter(r => pids.has(r.plan_id)))
    })()
  }, [p.family_id, p.id])
  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : ''
  const sum = (k: 'enrolled' | 'passed' | 'certs') => rows.reduce((a, r) => a + (r[k] || 0), 0)
  const orgs = new Set(rows.map(r => r.org_id)).size
  const planName = (id: string) => plans?.find(x => x.plan_id === id)?.training_plans?.name ?? ''
  return <section className="panel" style={{ display: 'grid', gap: 12 }}>
    <div className="bar"><h3 style={{ margin: 0 }}>Kế hoạch đào tạo dùng chương trình ({plans?.length ?? '…'})</h3>
      {go && p.status === 'published' && <button type="button" className="primary" onClick={() => go('Kế hoạch & lịch đào tạo')}>Lập kế hoạch đào tạo</button>}</div>
    <p className="sub" style={{ margin: 0 }}>Chương trình đào tạo đến trường / nhà giáo qua Kế hoạch đào tạo: chọn chương trình đã phát hành, gán đơn vị tham gia và chỉ tiêu. Bảng dưới tính trên tất cả phiên bản của chương trình.</p>
    {p.status !== 'published' && <p className="sub" style={{ margin: 0 }}>Phiên bản này chưa phát hành nên chưa chọn được trong kế hoạch mới.</p>}
    {!plans ? <p className="sub">Đang tải…</p> : plans.length === 0 ? <p className="sub" style={{ margin: 0 }}>Chưa có kế hoạch đào tạo nào dùng chương trình này.</p> : <>
      <StatCards items={[
        { icon: 'layers', value: plans.length, label: 'Kế hoạch' },
        { icon: 'school', value: orgs, label: 'Đơn vị tham gia' },
        { icon: 'users', value: sum('enrolled'), label: 'Nhà giáo đăng ký' },
        { icon: 'checkCircle', tone: 'good', value: sum('passed'), label: 'Đạt', sub: `${sum('certs')} chứng chỉ đã cấp` },
      ]} />
      <div className="wrap"><table>
        <thead><tr><th>Kế hoạch</th><th>Đơn vị lập</th><th>Năm học</th><th>Thời gian</th><th>Phiên bản</th><th>Chỉ tiêu</th><th>Trạng thái</th></tr></thead>
        <tbody>{plans.map(x => { const k = x.training_plans!; const st = PLAN_ST[k.pub_status] ?? [k.pub_status, ''] ; return <tr key={x.plan_id + x.program_id}>
          <td><b>{k.name}</b><br /><small className="sub">{k.plan_code}</small></td><td>{k.organizations?.name ?? '—'}</td><td>{k.year_name ?? '—'}</td>
          <td><small>{[fmt(k.starts_on), fmt(k.ends_on)].filter(Boolean).join(' → ') || '—'}</small></td>
          <td>v{vers.get(x.program_id) ?? '?'}</td><td>{x.quota ?? '—'}</td><td><Chip tone={st[1]}>{st[0]}</Chip></td></tr> })}</tbody>
      </table></div>
      <h3 style={{ margin: '8px 0 0' }}>Mức độ triển khai theo đơn vị</h3>
      {rows.length > 1 && <div className="distfilter">{orgF.node(rows.map(r => r.org_id))}</div>}
      {rows.length === 0 ? <p className="sub" style={{ margin: 0 }}>Chưa có đơn vị nào được gán trong các kế hoạch đã ban hành.</p> : <div className="wrap"><table>
        <thead><tr><th>Đơn vị</th><th>Kế hoạch</th><th>Chỉ tiêu</th><th>GV đăng ký</th><th>Chuyên cần</th><th>Đạt</th><th>Chưa đạt</th><th>Chứng chỉ</th></tr></thead>
        <tbody>{rows.filter(r => orgF.fit(r.org_id)).map(r => <tr key={r.plan_id + r.org_id}>
          <td><b>{r.org_name}</b></td><td><small>{planName(r.plan_id)}</small></td><td>{r.quota ?? '—'}</td><td>{r.enrolled}</td>
          <td>{r.att_pct != null ? `${String(r.att_pct).replace('.', ',')}%` : '—'}</td><td>{r.passed}</td><td>{r.failed || 0}</td><td>{r.certs}</td></tr>)}</tbody>
      </table></div>}
    </>}
  </section>
}

// ===== Phạm vi áp dụng & hiệu lực (117): như chương trình giáo dục =====
const todayStr = () => { const d = new Date(); return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
const vnDay = (d: string) => new Date(d + 'T00:00').toLocaleDateString('vi-VN')
/** Ghi chú hiệu lực ngắn: chưa đến ngày / đã hết / có hạn */
function effNote(p: Pick<TProgram, 'effective_from' | 'effective_to'>) {
  const t = todayStr()
  if (p.effective_to && p.effective_to < t) return `Hết hiệu lực từ ${vnDay(p.effective_to)}`
  if (p.effective_from && p.effective_from > t) return `Hiệu lực từ ${vnDay(p.effective_from)}`
  if (p.effective_to) return `Hiệu lực đến ${vnDay(p.effective_to)}`
  return ''
}
const OTYPE: Record<string, string> = { ministry: 'Bộ', province: 'Tỉnh', department: 'Sở', district: 'Phòng', school: 'Trường', provider: 'Đơn vị' }
// Chương trình giáo dục đáp ứng (124): nhà giáo Đạt khoá dùng chương trình đào tạo này thì được tính đáp ứng các chương trình giáo dục đã gắn (theo họ phiên bản).
type EduOpt = { id: string; family_id: string | null; code: string | null; title: string; version_no: number; status: string }
const EDU_ST: Record<string, string> = { draft: 'nháp', pending: 'chờ duyệt', approved: 'đã duyệt', rejected: 'bị trả lại', superseded: 'bản cũ', archived: 'lưu trữ' }
// ===== Trong form: phạm vi áp dụng & hiệu lực + chương trình giáo dục đáp ứng (lưu cùng nút Lưu của form) =====
type Extra = { scope: 'all' | 'selected'; effective_from: string; effective_to: string; targets: string[]; edu: string[] }
const EXTRA_BLANK: Extra = { scope: 'all', effective_from: '', effective_to: '', targets: [], edu: [] }
const extraBad = (x: Extra) => x.scope === 'selected' && !x.targets.length ? 'Chọn ít nhất một đơn vị áp dụng.'
  : x.effective_from && x.effective_to && x.effective_to < x.effective_from ? 'Ngày hết hiệu lực phải sau ngày bắt đầu.' : ''

/** Chương trình giáo dục, mỗi họ phiên bản một dòng (bản đang ban hành, chưa có thì bản mới nhất). */
let eduCache: Promise<EduOpt[]> | null = null
function loadEduOpts() {
  eduCache ??= Promise.resolve(supabase.from('edu_programs').select('id, family_id, code, title, version_no, status').neq('status', 'archived').order('version_no', { ascending: false })
    .then(({ data }) => {
      const m = new Map<string, EduOpt>()
      for (const r of (data ?? []) as EduOpt[]) { const k = r.family_id ?? r.id, cur = m.get(k)
        if (!cur || (r.status === 'published' && cur.status !== 'published')) m.set(k, r) }
      return [...m.values()].sort((a, b) => a.title.localeCompare(b.title, 'vi'))
    }))
  return eduCache
}
function useEduOpts() {
  const [opts, setOpts] = useState<EduOpt[] | null>(null)
  useEffect(() => { loadEduOpts().then(setOpts) }, [])
  return opts
}
const famOf = (o: EduOpt) => o.family_id ?? o.id
const eduLabel = (o: EduOpt) => `${o.code ? o.code + ' · ' : ''}${o.title}${o.status !== 'published' ? ` (${EDU_ST[o.status] ?? o.status})` : ''}`

/** Đọc phạm vi + chương trình giáo dục đã lưu của một chương trình đào tạo. */
async function loadExtra(p: TProgram): Promise<Extra> {
  const [t, e] = await Promise.all([
    supabase.from('training_program_targets').select('org_id').eq('program_id', p.id),
    supabase.from('training_program_edu').select('edu_family').eq('training_family', p.family_id),
  ])
  return { scope: p.scope ?? 'all', effective_from: p.effective_from ?? '', effective_to: p.effective_to ?? '',
    targets: ((t.data ?? []) as { org_id: string }[]).map(r => r.org_id), edu: ((e.data ?? []) as { edu_family: string }[]).map(r => r.edu_family) }
}
/** Lưu phạm vi + chương trình giáo dục; prev = bản đã lưu trước đó. Trả về lỗi (nếu có). */
async function saveExtra(id: string, x: Extra, prev: Extra): Promise<string | null> {
  const add = x.targets.filter(o => !prev.targets.includes(o)), del = prev.targets.filter(o => !x.targets.includes(o))
  if (add.length) { const r = await supabase.from('training_program_targets').insert(add.map(org_id => ({ program_id: id, org_id }))); if (r.error) return errText(r.error.message) }
  if (del.length) { const r = await supabase.from('training_program_targets').delete().eq('program_id', id).in('org_id', del); if (r.error) return errText(r.error.message) }
  const u = await supabase.from('training_programs').update({ scope: x.scope, effective_from: x.effective_from || null, effective_to: x.effective_to || null }).eq('id', id)
  if (u.error) return errText(u.error.message)
  const same = x.edu.length === prev.edu.length && x.edu.every(f => prev.edu.includes(f))
  if (!same) {
    const opts = await loadEduOpts()
    const ids = x.edu.map(f => opts.find(o => famOf(o) === f)?.id ?? f)
    const { error } = await supabase.rpc('training_program_set_edu', { p_program: id, p_edu: ids })
    if (error) return /schema cache|does not exist|not find/i.test(error.message) ? 'Hãy chạy migration 124 trên Supabase.' : errText(error.message)
  }
  return null
}
