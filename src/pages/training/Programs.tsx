// Phân hệ 1 — Chương trình tập huấn (083): mẫu khoá tập huấn chuẩn của KDI, dùng lại cho các kế hoạch tập huấn.
import { CompetencySetupLink } from '../../components/CompetencySetup'
// Cấu trúc 3 cấp: Chương trình tập huấn → Môn → Nội dung tập huấn. Cách làm giống Phân hệ 2: hướng dẫn các bước,
// thẻ số liệu, danh sách có lọc; thêm / sửa / xem chi tiết mở view riêng; Nháp → Đã phát hành → Ngừng dùng, nhân bản để sửa.
import { MultiSelect } from '../../components/MultiSelect'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useEduLevels } from '../../lib/eduLevels'
import { useStemTracks } from '../../lib/stemTracks'
import { useSubjects } from '../subjects'
import { useCompetencies, LV_NAME } from '../competency'
import { ElView } from '../../components/ElView'
import { Chip } from '../dist/Editor'
import { ContentDetail, detailCount, type Detail } from './Content'
import { TrainingUnits } from './Units'
import { FlowGuide } from '../../components/FlowGuide'
import { ProgramExams, ProgramEvalFrame, type FinalExam, type Frame } from './ExamFrame'
import { useAllOrgs } from '../../components/OrgScope'

type Mode = 'online' | 'offline' | 'hybrid'
export type TProgram = {
  id: string; org_id: string; code: string; title: string; ct_code: string | null; level: string | null; ct_codes: string[]; levels: string[]; audience: string | null; mode: Mode
  description: string | null; objectives?: string | null; entry_conditions?: string | null; outcomes?: string | null; prereq_families?: string[]
  competencies: string[]; target_level: number; pass_attendance: number; pass_score: number | null; need_product: boolean
  status: Status; version_no: number; source_id: string | null; updated_at: string; published_at: string | null; family_id: string; note: string | null
  final_exam?: FinalExam | null; eval_frame?: Frame | null
  scope?: 'all' | 'selected'; effective_from?: string | null; effective_to?: string | null; builder?: string | null
}
// 093: phiên bản & duyệt
export type Status = 'draft' | 'pending' | 'approved' | 'rejected' | 'published' | 'superseded' | 'archived'
export const STATUS: Record<Status, [string, string]> = {
  draft: ['Nháp', 'warn'], pending: ['Chờ duyệt', 'warn'], approved: ['Đã duyệt', 'good'], rejected: ['Bị trả lại', 'bad'],
  published: ['Đã phát hành', 'good'], superseded: ['Đã thay thế', 'off'], archived: ['Ngừng dùng', 'off'],
}
const EDITABLE: Status[] = ['draft', 'rejected']
type Unit = { id: string; program_id: string; parent_id: string | null; kind: 'subject' | 'content'; seq: number; title: string; hours: number; mode: 'online' | 'offline' | null; has_test: boolean; note: string | null; detail: Detail }
const MODE: Record<Mode, string> = { online: 'Trực tuyến', offline: 'Trực tiếp', hybrid: 'Kết hợp' }
const SEL = 'id, org_id, code, title, ct_code, level, ct_codes, levels, audience, mode, description, competencies, target_level, pass_attendance, pass_score, need_product, status, version_no, source_id, updated_at, published_at, family_id, note, objectives, entry_conditions, outcomes, prereq_families, scope, effective_from, effective_to, builder'
const SEL_X = SEL + ', final_exam, eval_frame'
const errText = (m: string) => /schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 083 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Chỉ quản trị nền tảng KDI soạn được chương trình tập huấn.' : m
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
  const [fs, setFs] = useState<Status | ''>('')
  const [q, setQ] = useState('')
  const [ct, setCt] = useState('')
  const { codes, byCode: tracks } = useStemTracks()
  const { name: levelName } = useEduLevels()
  const reload = () => setRk(k => k + 1)
  useEffect(() => { supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data)) }, [])
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
    })()
  }, [rk])

  const inGroup = (p: TProgram, f: Status | '') => !f || p.status === f || (f === 'draft' && p.status === 'rejected') || (f === 'pending' && p.status === 'approved') || (f === 'archived' && p.status === 'superseded')
  const shown = useMemo(() => (list ?? []).filter(p => inGroup(p, fs) && (!ct || ctsOf(p).includes(ct))
    && (!q || `${p.code} ${p.title} ${p.audience ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [list, fs, ct, q])

  if (view?.kind === 'new') return <ProgramForm admin={admin} onBack={() => setView(null)} onSaved={id => { reload(); setView({ kind: 'open', id }) }} />
  if (view?.kind === 'open') return <ProgramDetail key={view.id + ':' + rk} id={view.id} admin={admin} go={go} onBack={() => { setView(null); reload() }}
    onOpen={id => { reload(); setView({ kind: 'open', id }) }} onMsg={m => { setMsg(m); reload() }} />

  const n = (s: Status) => (list ?? []).filter(p => inGroup(p, s)).length
  const totalContents = [...stats.values()].reduce((a, x) => a + x.contents, 0)
  const steps: [string, string][] = [
    ['Soạn chương trình', 'Nhập thông tin, năng lực đích và điều kiện đạt; thêm các môn và nội dung tập huấn kèm số giờ.'],
    ['Duyệt & phát hành', 'Gửi duyệt hoặc phát hành thẳng. Bản đã phát hành không sửa được, muốn sửa thì tạo phiên bản mới.'],
    ['Dùng trong kế hoạch', 'Chọn chương trình đã phát hành khi lập Kế hoạch & lịch tập huấn cho trường, giáo viên.']]
  return (
    <>
      <FlowGuide id="training-programs">
        <ol className="distguide">{steps.map(([h, d], k) => <li key={h}><button type="button" onClick={() => setFs(k === 0 ? 'draft' : k === 1 ? 'published' : '')}>
          <i>{k + 1}</i><span><b>{h}</b><small>{d}</small></span></button></li>)}</ol>
        <p className="sub" style={{ margin: 0 }}>Chương trình tập huấn là mẫu khoá học chuẩn của KDI, gồm các môn, mỗi môn có các nội dung tập huấn. Một chương trình dùng lại được cho nhiều kế hoạch tập huấn.</p>
      </FlowGuide>
      <div className="diststatcards">
        <div className="panel"><i aria-hidden="true">≋</i><span><b>{list?.length ?? '…'}</b><small>Chương trình tập huấn</small><small>{n('published')} đã phát hành · {n('draft')} nháp</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{list ? n('published') : '…'}</b><small>Dùng được trong kế hoạch</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">▦</i><span><b>{totalContents}</b><small>Nội dung tập huấn</small><small>{[...stats.values()].reduce((a, x) => a + x.subjects, 0)} môn</small></span></div>
      </div>
      <div className="distfilter">
        {([['', 'Tất cả', list?.length ?? 0], ['draft', 'Nháp', n('draft')], ['pending', 'Chờ duyệt', n('pending')], ['published', 'Đã phát hành', n('published')], ['archived', 'Ngừng dùng', n('archived')]] as [Status | '', string, number][]).map(([s, l, c]) =>
          <button key={l} type="button" className={'distfchip' + (fs === s ? ' on' : '')} aria-pressed={fs === s} onClick={() => setFs(s)}>{l} <b>{c}</b></button>)}
      </div>
      <div className="bar">
        <div className="tools">
          <input placeholder="Tìm mã, tên, đối tượng…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
          <select value={ct} onChange={e => setCt(e.target.value)} aria-label="Loại chương trình"><option value="">Mọi loại chương trình</option>
            {codes.map(c => <option key={c} value={c}>{c}{tracks[c] ? ` · ${tracks[c]!.name}` : ''}</option>)}</select>
          <small className="sub">{shown.length}/{list?.length ?? 0} chương trình</small>
        </div>
        {admin && <div className="tools"><button type="button" className="primary" onClick={() => { setMsg(null); setView({ kind: 'new' }) }}>Thêm chương trình tập huấn</button></div>}
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {!list ? <p className="sub">Đang tải…</p> : <div className="wrap"><table className="libtable">
        <thead><tr><th>Chương trình tập huấn</th><th>Loại · cấp học</th><th>Đối tượng</th><th>Phạm vi áp dụng</th><th>Môn · nội dung · giờ</th><th>Hình thức</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead>
        <tbody>{shown.map(p => { const s = stats.get(p.id); return <tr key={p.id}>
          <td><button type="button" className="namelink" onClick={() => { setMsg(null); setView({ kind: 'open', id: p.id }) }}>{p.title}</button><br /><small className="sub">{p.code} · v{p.version_no}{p.builder ? ` · XD: ${p.builder}` : ''}</small></td>
          <td>{[ctsOf(p).join(', '), lvsOf(p).map(levelName).join(', ')].filter(Boolean).join(' · ') || '—'}</td>
          <td style={{ whiteSpace: 'normal' }}>{p.audience || '—'}</td>
          <td>{p.scope === 'selected' ? `${targets.get(p.id) ?? 0} đơn vị được chọn` : 'Mọi đơn vị'}{effNote(p) && <><br /><small className="sub">{effNote(p)}</small></>}</td>
          <td>{s?.subjects ?? 0} môn · {s?.contents ?? 0} nội dung · {num(s?.hours ?? 0)} giờ</td>
          <td>{MODE[p.mode]}</td>
          <td><Chip tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Chip></td>
          <td><small>{new Date(p.updated_at).toLocaleDateString('vi-VN')}</small></td>
        </tr> })}
          {shown.length === 0 && <tr><td colSpan={8}>{list.length ? 'Không có chương trình nào khớp bộ lọc.' : admin ? 'Chưa có chương trình tập huấn nào. Bấm "Thêm chương trình tập huấn".' : 'Chưa có chương trình tập huấn nào được KDI phát hành.'}</td></tr>}</tbody>
      </table></div>}
    </>
  )
}

// ===== Thêm / sửa thông tin chương trình =====
const BLANK = { title: '', ct_codes: [] as string[], levels: [] as string[], audience: '', mode: 'hybrid' as Mode, description: '', competencies: [] as string[], target_level: 3, pass_attendance: 80, pass_score: null as number | null, need_product: false,
  objectives: '', entry_conditions: '', outcomes: '', prereq_families: [] as string[], builder: '' }
type Info = typeof BLANK
// Loại chương trình / cấp học: mảng mới (090), dữ liệu cũ chỉ có cột đơn
const ctsOf = (p: { ct_codes?: string[] | null; ct_code: string | null }) => p.ct_codes?.length ? p.ct_codes : p.ct_code ? [p.ct_code] : []
const lvsOf = (p: { levels?: string[] | null; level: string | null }) => p.levels?.length ? p.levels : p.level ? [p.level] : []

/** Các chương trình tập huấn khác (theo họ phiên bản) để chọn làm tiên quyết */
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

function InfoFields({ f, set, disabled, family }: { f: Info; set: (f: Info) => void; disabled?: boolean; family?: string | null }) {
  const fams = useFamilies(family)
  const { codes, byCode: tracks } = useStemTracks()
  const { levels } = useEduLevels()
  const comps = useCompetencies('teacher')
  // Gợi ý đơn vị xây dựng: KDI và các cơ quan quản lý (Sở, Phòng…); gõ tự do được (VD: trường đại học, viện)
  const orgs = useAllOrgs()
  const builders = useMemo(() => [...new Set((orgs ?? []).filter(o => o.type !== 'school').map(o => o.name))].sort((a, b) => a.localeCompare(b, 'vi')), [orgs])
  return <>
    <div className="formgrid" style={{ alignItems: 'start' }}>
      <label className="field" style={{ gridColumn: '1/-1' }}><span>Tên chương trình tập huấn *</span><input required disabled={disabled} maxLength={200} value={f.title} onChange={e => set({ ...f, title: e.target.value })} placeholder="VD: Tập huấn dạy học STEM tích hợp cho giáo viên THCS" /></label>
      <div className="field" style={{ gridColumn: 'span 2' }}><span>Loại chương trình</span>
        <MultiSelect disabled={disabled} value={f.ct_codes} onChange={v => set({ ...f, ct_codes: v })} options={codes.map(c => [c, `${c}${tracks[c] ? ' · ' + tracks[c]!.name : ''}`])}
          placeholder="Không chọn" ariaLabel="Loại chương trình" /></div>
      <div className="field" style={{ gridColumn: 'span 2' }}><span>Cấp học</span>
        <MultiSelect disabled={disabled} value={f.levels} onChange={v => set({ ...f, levels: v })} options={levels.map(l => [l.code, l.name])} placeholder="Mọi cấp học" ariaLabel="Cấp học" /></div>
      <label className="field"><span>Hình thức</span><select disabled={disabled} value={f.mode} onChange={e => set({ ...f, mode: e.target.value as Mode })}>
        {(Object.keys(MODE) as Mode[]).map(m => <option key={m} value={m}>{MODE[m]}</option>)}</select></label>
      <label className="field"><span>Đối tượng</span><input disabled={disabled} maxLength={200} value={f.audience ?? ''} onChange={e => set({ ...f, audience: e.target.value })} placeholder="VD: Giáo viên mới dạy STEM" /></label>
      <label className="field" style={{ gridColumn: 'span 2' }}><span>Đơn vị xây dựng <small className="sub">(không bắt buộc)</small></span>
        <input disabled={disabled} maxLength={200} list="tp-builders" value={f.builder ?? ''} onChange={e => set({ ...f, builder: e.target.value })} placeholder="Chọn hoặc gõ: KDI Education, Sở GD&ĐT…, Trường ĐHSP…" />
        <datalist id="tp-builders">{builders.map(n => <option key={n} value={n} />)}</datalist></label>
      <label className="field" style={{ gridColumn: '1/-1' }}><span>Mô tả</span><textarea disabled={disabled} rows={2} maxLength={4000} value={f.description ?? ''} onChange={e => set({ ...f, description: e.target.value })} /></label>
      <label className="field" style={{ gridColumn: '1/-1' }}><span>Mục tiêu</span><textarea disabled={disabled} rows={3} maxLength={4000} value={f.objectives ?? ''} onChange={e => set({ ...f, objectives: e.target.value })}
        placeholder="Sau tập huấn, giáo viên…" /></label>
      <label className="field" style={{ gridColumn: '1/-1' }}><span>Yêu cầu đầu ra</span><textarea disabled={disabled} rows={3} maxLength={4000} value={f.outcomes ?? ''} onChange={e => set({ ...f, outcomes: e.target.value })}
        placeholder="VD: Thiết kế được 1 kế hoạch bài dạy STEM; lắp ráp và lập trình được robot cơ bản" /></label>
    </div>
    <fieldset className="libtargets wide"><legend>Điều kiện tham gia</legend>
      <div className="formgrid" style={{ alignItems: 'start' }}>
        <label className="field" style={{ gridColumn: '1/-1' }}><span>Điều kiện tham gia</span><textarea disabled={disabled} rows={2} maxLength={2000} value={f.entry_conditions ?? ''} onChange={e => set({ ...f, entry_conditions: e.target.value })}
          placeholder="VD: Giáo viên đang dạy Khoa học tự nhiên hoặc Công nghệ, có máy tính cá nhân" /></label>
        <div className="field" style={{ gridColumn: '1/-1' }}><span>Chương trình tiên quyết (phải đạt trước)</span>
          <MultiSelect disabled={disabled} value={f.prereq_families} onChange={v => set({ ...f, prereq_families: v })} options={fams} placeholder="Không có"
            ariaLabel="Chương trình tiên quyết" empty="Chưa có chương trình tập huấn khác." /></div>
      </div>
    </fieldset>
    <fieldset className="libtargets wide"><legend>Năng lực đích (khung năng lực giáo viên)</legend>
      <div className="formgrid" style={{ alignItems: 'start' }}>
        <div className="field" style={{ gridColumn: 'span 3' }}><span>Năng lực đích</span><MultiSelect disabled={disabled} value={f.competencies} onChange={v => set({ ...f, competencies: v })}
          options={comps.map(c => [c.key, c.name])} placeholder="Chọn năng lực đích…" ariaLabel="Năng lực đích" empty="Chưa có khung năng lực giáo viên." /><CompetencySetupLink audience="teacher" /></div>
        <label className="field"><span>Mức cần đạt sau tập huấn</span><select disabled={disabled} value={f.target_level} onChange={e => set({ ...f, target_level: Number(e.target.value) })}>
          {[1, 2, 3, 4].map(l => <option key={l} value={l}>Mức {l} · {LV_NAME[l - 1]}</option>)}</select></label>
      </div>
    </fieldset>
    <fieldset className="libtargets wide"><legend>Điều kiện đạt (dùng khi đánh giá kết quả và cấp chứng chỉ)</legend>
      <div className="formgrid">
        <label className="field"><span>Chuyên cần tối thiểu (%)</span><input type="number" disabled={disabled} min={0} max={100} value={f.pass_attendance} onChange={e => set({ ...f, pass_attendance: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></label>
        <label className="field"><span>Điểm bài test tối thiểu (thang 10)</span><input type="number" disabled={disabled} min={0} max={10} step={0.5} value={f.pass_score ?? ''} placeholder="Để trống = không xét điểm"
          onChange={e => set({ ...f, pass_score: e.target.value === '' ? null : Math.max(0, Math.min(10, Number(e.target.value))) })} /></label>
        <label className="field"><span>Sản phẩm cuối khoá</span><select disabled={disabled} value={f.need_product ? 'y' : 'n'} onChange={e => set({ ...f, need_product: e.target.value === 'y' })}>
          <option value="n">Không bắt buộc</option><option value="y">Bắt buộc, giảng viên chấm đạt</option></select></label>
      </div>
    </fieldset>
  </>
}

function PrereqNames({ ids }: { ids: string[] }) {
  const fams = useFamilies(null)
  return <>{ids.map(id => fams.find(f => f[0] === id)?.[1] ?? '…').join('; ')}</>
}

function ProgramForm({ admin, onBack, onSaved }: { admin: boolean; onBack: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState<Info>(BLANK)
  const [x, setX] = useState<Extra>(EXTRA_BLANK)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!admin) return
    const bad = extraBad(x); if (bad) return setErr(bad)
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('training_programs').insert({ ...f, title: f.title.trim(), audience: f.audience?.trim() || null, description: f.description?.trim() || null, builder: f.builder?.trim() || null,
      scope: x.scope, effective_from: x.effective_from || null, effective_to: x.effective_to || null }).select('id').single()
    if (error) { setBusy(false); return setErr(errText(error.message)) }
    const id = (data as { id: string }).id
    const e2 = await saveExtra(id, x, { ...EXTRA_BLANK, scope: x.scope })
    setBusy(false)
    if (e2) return setErr(`Đã tạo bản nháp nhưng chưa lưu được phạm vi / chương trình giáo dục: ${e2}`)
    onSaved(id)
  }
  return <ElView back="Chương trình tập huấn" onBack={onBack} title="Thêm chương trình tập huấn" sub="Lưu xong thì thêm các môn và nội dung tập huấn.">
    <form className="panel" onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <InfoFields f={f} set={setF} />
      <ScopeEduFields x={x} set={setX} />
      {err && <p className="msg">{err}</p>}
      <div className="formactions"><button type="submit" className="primary" disabled={busy || !f.title.trim()}>Tạo bản nháp</button> <button type="button" onClick={onBack}>Huỷ</button></div>
    </form>
  </ElView>
}

// ===== Chi tiết: thông tin + môn & nội dung tập huấn =====
export type PTab = 'info' | 'units' | 'exam' | 'eval' | 'versions' | 'assign'
/** initialTab / initialContent: mở sẵn một tab hoặc một nội dung (VD: từ mục Kiểm tra & luyện tập); startFinal: mở sẵn form đề cuối khoá; back: nhãn nút quay lại */
export function ProgramDetail({ id, admin, go, onBack, onOpen, onMsg, initialTab, initialContent, startFinal, back = 'Chương trình tập huấn' }: { id: string; admin: boolean; go?: (page: string) => void; onBack: () => void; onOpen: (id: string) => void; onMsg: (m: [string, boolean]) => void
  initialTab?: PTab; initialContent?: string | null; startFinal?: boolean; back?: string }) {
  const [p, setP] = useState<TProgram | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [f, setF] = useState<Info | null>(null)
  const [x, setX] = useState<Extra | null>(null)
  const [x0, setX0] = useState<Extra | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [openC, setOpenC] = useState<string | null>(initialContent ?? null)
  const [tab, setTab] = useState<PTab>(initialTab ?? 'info')
  const { subjects } = useSubjects()
  const { byCode: tracks } = useStemTracks()
  const { name: levelName } = useEduLevels()
  const comps = useCompetencies('teacher')
  async function load() {
    const [a, b] = await Promise.all([
      supabase.from('training_programs').select(SEL_X).eq('id', id).single(),
      supabase.from('training_program_units').select('*').eq('program_id', id).order('seq'),
    ])
    if (a.error) return setMsg([errText(a.error.message), true])
    const x = a.data as unknown as TProgram
    setP(x); setUnits((b.data as Unit[]) ?? [])
    setF({ title: x.title, ct_codes: ctsOf(x), levels: lvsOf(x), audience: x.audience ?? '', mode: x.mode, description: x.description ?? '', competencies: x.competencies ?? [],
      target_level: x.target_level, pass_attendance: x.pass_attendance, pass_score: x.pass_score, need_product: x.need_product,
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
    const { error } = await supabase.from('training_programs').update({ ...f, title: f.title.trim(), audience: f.audience?.trim() || null, description: f.description?.trim() || null, builder: f.builder?.trim() || null }).eq('id', p!.id)
    if (error) { setMsg([errText(error.message), true]); return load() }
    const e2 = await saveExtra(p!.id, x, x0)
    setMsg(e2 ? [`Đã lưu thông tin nhưng chưa lưu được phạm vi / chương trình giáo dục: ${e2}`, true] : ['Đã lưu thông tin, phạm vi áp dụng và chương trình giáo dục đáp ứng.', false])
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
  const warn = [!contents.length && 'chưa có nội dung tập huấn nào', p.pass_score != null && !contents.some(u => u.has_test) && 'có điều kiện điểm bài test nhưng chưa nội dung nào có bài test',
    subjs.some(s => !kids(s.id).length) && 'có môn chưa có nội dung'].filter(Boolean) as string[]

  return <ElView back={back} onBack={onBack} title={p.title}
    sub={<>{p.code} · v{p.version_no} · <Chip tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Chip> · {subjs.length} môn · {contents.length} nội dung · {num(hours)} giờ</>}
    actions={admin && <>
      {p.status !== 'published' && p.status !== 'superseded' && <button type="button" onClick={() => setTab('versions')}>Duyệt & phát hành</button>}
      {p.status === 'published' && <button type="button" onClick={() => setTab('versions')}>Tạo phiên bản mới</button>}
      {p.status === 'draft' && <button type="button" className="danger" onClick={del}>Xoá</button>}
    </>}>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {edit && warn.length > 0 && <p className="warnline">Chưa phát hành được: {warn.join('; ')}.</p>}
    {!edit && admin && <p className="sub">Phiên bản {STATUS[p.status][0].toLowerCase()} không sửa được nội dung. Muốn điều chỉnh thì {p.status === 'pending' || p.status === 'approved' ? 'trả lại / mở lại ở tab "Phiên bản & duyệt"' : 'tạo phiên bản mới ở tab "Phiên bản & duyệt"'}.</p>}

    <div className="segmented" style={{ marginBottom: 12 }}>
      {([['info', 'Thông tin & điều kiện đạt'], ['units', 'Cấu trúc & yêu cầu cần đạt'], ['exam', 'Đề kiểm tra'], ['eval', 'Khung đánh giá'], ['versions', 'Phiên bản & duyệt'], ['assign', 'Gán & triển khai']] as const).map(([k, l]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
    </div>
    {tab === 'info' &&     <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>Thông tin & điều kiện đạt</h3>
      {edit ? <>
        <InfoFields f={f} set={setF} family={p.family_id} />
        {x && <ScopeEduFields x={x} set={setX} owner={p.org_id} />}
        <div className="formactions"><button type="button" className="primary" disabled={!f.title.trim()} onClick={saveInfo}>Lưu thông tin</button></div>
      </> : <dl className="tpkv">
        <dt>Loại · cấp học</dt><dd>{[ctsOf(p).map(c => `${c}${tracks[c] ? ' · ' + tracks[c]!.name : ''}`).join(', '), lvsOf(p).length ? lvsOf(p).map(levelName).join(', ') : 'Mọi cấp học'].filter(Boolean).join(' · ')}</dd>
        <dt>Đối tượng</dt><dd>{p.audience || '—'}</dd>
        <dt>Đơn vị xây dựng</dt><dd>{p.builder || '—'}</dd>
        <dt>Hình thức</dt><dd>{MODE[p.mode]}</dd>
        {p.description && <><dt>Mô tả</dt><dd>{p.description}</dd></>}
        {p.objectives && <><dt>Mục tiêu</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{p.objectives}</dd></>}
        {p.outcomes && <><dt>Yêu cầu đầu ra</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{p.outcomes}</dd></>}
        {p.entry_conditions && <><dt>Điều kiện tham gia</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{p.entry_conditions}</dd></>}
        {!!p.prereq_families?.length && <><dt>Tiên quyết</dt><dd><PrereqNames ids={p.prereq_families} /></dd></>}
        <dt>Năng lực đích</dt><dd>{p.competencies.length ? p.competencies.map(k => comps.find(c => c.key === k)?.name ?? k).join(', ') + ` (mức ${p.target_level})` : '—'}</dd>
        <dt>Điều kiện đạt</dt><dd>{[`chuyên cần ≥ ${p.pass_attendance}%`, p.pass_score != null && `điểm bài test ≥ ${num(Number(p.pass_score))}`, p.need_product && 'sản phẩm cuối khoá đạt'].filter(Boolean).join(' · ')}</dd>
      </dl>}
    </section>}

    {/* Bản nháp sửa trong form ở trên; bản đã phát hành vẫn sửa riêng phạm vi và chương trình giáo dục ở đây */}
    {tab === 'info' && !edit && <ProgramScope p={p} admin={admin} onMsg={(m, e) => { setMsg([m, !!e]); if (!e) load() }} />}
    {tab === 'info' && !edit && <ProgramEduLinks p={p} admin={admin} onMsg={(m, e) => setMsg([m, !!e])} />}

    {tab === 'units' && <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <TrainingUnits programId={p.id} programTitle={p.title} programMode={p.mode} units={units} editable={edit} catalog={suggest}
        onReload={load} onMessage={(m, e) => setMsg([errText(m), !!e])} onOpen={setOpenC} />
    </section>}
    {tab === 'exam' && <ProgramExams p={p} units={units} edit={edit} onOpen={setOpenC} autoStart={startFinal}
      save={(patch, ok) => run(supabase.from('training_programs').update(patch).eq('id', p.id), ok)} />}
    {tab === 'eval' && <ProgramEvalFrame key={p.id + (p.eval_frame ? '1' : '0')} p={p} edit={edit} hasFinal={!!p.final_exam} hasTests={contents.some(u => u.has_test)}
      save={(patch, ok) => run(supabase.from('training_programs').update(patch).eq('id', p.id), ok)} />}
    {tab === 'versions' && <TrainingVersions p={p} admin={admin} warn={warn} onOpen={onOpen} onChanged={(m, e) => { setMsg([m, !!e]); if (!e) load() }} />}
    {tab === 'assign' && <TrainingDeploy p={p} go={go} />}
  </ElView>
}

// ===== Phiên bản & duyệt (093) =====
type TLog = { id: number; from_status: string | null; to_status: string; note: string | null; at: string }
type TVer = Pick<TProgram, 'id' | 'version_no' | 'status' | 'published_at' | 'updated_at' | 'note'>
function TrainingVersions({ p, admin, warn, onOpen, onChanged }: {
  p: TProgram; admin: boolean; warn: string[]; onOpen: (id: string) => void; onChanged: (m: string, err?: boolean) => void
}) {
  const [vers, setVers] = useState<TVer[]>([])
  const [log, setLog] = useState<TLog[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    Promise.all([
      supabase.from('training_programs').select('id, version_no, status, published_at, updated_at, note').eq('family_id', p.family_id).order('version_no', { ascending: false }),
      supabase.from('training_program_log').select('id, from_status, to_status, note, at').eq('program_id', p.id).order('at', { ascending: false }),
    ]).then(([v, l]) => { setVers((v.data as TVer[]) ?? []); setLog((l.data as TLog[]) ?? []) })
  }, [p.id, p.status])
  const stName = (s: string) => STATUS[s as Status]?.[0] ?? s
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
  return <section className="panel" style={{ display: 'grid', gap: 12 }}>
    <h3 style={{ margin: 0 }}>Phiên bản & duyệt</h3>
    <p className="sub" style={{ margin: 0 }}>Nháp → Chờ duyệt → Đã duyệt → Đã phát hành. Phát hành phiên bản mới thì phiên bản cũ chuyển sang "Đã thay thế"; kế hoạch tập huấn đã dùng bản cũ vẫn giữ nguyên.</p>
    {admin ? <div className="tools">
      {(s === 'draft' || s === 'rejected') && <button type="button" disabled={busy || !ready} onClick={() => setStatus('pending', 'Ghi chú gửi người duyệt (không bắt buộc):')}>Gửi duyệt</button>}
      {s === 'draft' && <button type="button" className="primary" disabled={busy || !ready} onClick={() => confirm('Phát hành ngay phiên bản này? Phiên bản đang phát hành (nếu có) sẽ được thay thế.') && setStatus('published')}>Phát hành</button>}
      {s === 'pending' && <><button type="button" className="primary" disabled={busy} onClick={() => setStatus('approved', 'Ghi chú khi duyệt (không bắt buộc):')}>Duyệt</button>
        <button type="button" className="danger" disabled={busy} onClick={() => setStatus('rejected', 'Lý do trả lại:', true)}>Trả lại</button></>}
      {s === 'approved' && <><button type="button" className="primary" disabled={busy} onClick={() => setStatus('published', 'Ghi chú phát hành (không bắt buộc):')}>Phát hành</button>
        <button type="button" disabled={busy} onClick={() => setStatus('draft')}>Mở lại để sửa</button></>}
      {(s === 'published' || s === 'superseded') && <button type="button" className="primary" disabled={busy} onClick={newVersion}>Tạo phiên bản mới</button>}
      {['published', 'superseded', 'approved', 'rejected', 'draft'].includes(s) && <button type="button" disabled={busy} onClick={() => confirm('Ngừng dùng phiên bản này? Kế hoạch đã có vẫn giữ nguyên.') && setStatus('archived', 'Lý do ngừng dùng (không bắt buộc):')}>Ngừng dùng</button>}
      {s === 'archived' && <button type="button" disabled={busy} onClick={() => setStatus('published', 'Ghi chú (không bắt buộc):')}>Dùng lại</button>}
      {!ready && (s === 'draft' || s === 'rejected') && <small className="sub">Chưa gửi duyệt / phát hành được: {warn.join('; ')}.</small>}
    </div> : <p className="sub" style={{ margin: 0 }}>Chỉ quản trị nền tảng KDI duyệt và phát hành chương trình tập huấn.</p>}
    <h3 style={{ margin: '8px 0 0' }}>Các phiên bản</h3>
    <div className="wrap"><table>
      <thead><tr><th>Phiên bản</th><th>Trạng thái</th><th>Phát hành</th><th>Cập nhật</th></tr></thead>
      <tbody>{vers.map(v => <tr key={v.id} style={v.id === p.id ? { background: 'var(--soft)' } : undefined}>
        <td>{v.id === p.id ? <><b>v{v.version_no}</b> <small className="sub">đang xem</small></> : <button type="button" className="namelink" onClick={() => onOpen(v.id)}>v{v.version_no}</button>}</td>
        <td><Chip tone={STATUS[v.status][1]}>{STATUS[v.status][0]}</Chip></td>
        <td>{v.published_at ? new Date(v.published_at).toLocaleDateString('vi-VN') : '—'}</td>
        <td><small>{new Date(v.updated_at).toLocaleDateString('vi-VN')}</small></td>
      </tr>)}</tbody>
    </table></div>
    <h3 style={{ margin: '8px 0 0' }}>Lịch sử trạng thái</h3>
    {log.length === 0 ? <p className="sub" style={{ margin: 0 }}>Chưa có.</p> : <ul className="sub" style={{ paddingLeft: 18, margin: 0 }}>
      {log.map(l => <li key={l.id}>{new Date(l.at).toLocaleString('vi-VN')} · {l.from_status ? `${stName(l.from_status)} → ` : ''}<b>{stName(l.to_status)}</b>{l.note ? ` — ${l.note}` : ''}</li>)}
    </ul>}
  </section>
}

// ===== Gán & triển khai: chương trình đến đơn vị qua Kế hoạch tập huấn =====
type DPlan = { plan_id: string; program_id: string; quota: number | null
  training_plans: { id: string; plan_code: string | null; name: string; year_name: string | null; starts_on: string | null; ends_on: string | null; pub_status: string; organizations: { name: string } | null } | null }
type DRowM = { plan_id: string; org_id: string; org_name: string; quota: number | null; org_status: string; enrolled: number; att_pct: number | null; passed: number; failed: number; certs: number }
const PLAN_ST: Record<string, [string, string]> = { draft: ['Nháp', 'warn'], published: ['Đã ban hành', 'good'], archived: ['Đã đóng', 'off'] }
function TrainingDeploy({ p, go }: { p: TProgram; go?: (page: string) => void }) {
  const [plans, setPlans] = useState<DPlan[] | null>(null)
  const [rows, setRows] = useState<DRowM[]>([])
  const [vers, setVers] = useState<Map<string, number>>(new Map())
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
    <div className="bar"><h3 style={{ margin: 0 }}>Kế hoạch tập huấn dùng chương trình ({plans?.length ?? '…'})</h3>
      {go && p.status === 'published' && <button type="button" className="primary" onClick={() => go('Kế hoạch & lịch tập huấn')}>Lập kế hoạch tập huấn</button>}</div>
    <p className="sub" style={{ margin: 0 }}>Chương trình tập huấn đến trường / giáo viên qua Kế hoạch tập huấn: chọn chương trình đã phát hành, gán đơn vị tham gia và chỉ tiêu. Bảng dưới tính trên mọi phiên bản của chương trình.</p>
    {p.status !== 'published' && <p className="sub" style={{ margin: 0 }}>Phiên bản này chưa phát hành nên chưa chọn được trong kế hoạch mới.</p>}
    {!plans ? <p className="sub">Đang tải…</p> : plans.length === 0 ? <p className="sub" style={{ margin: 0 }}>Chưa có kế hoạch tập huấn nào dùng chương trình này.</p> : <>
      <div className="diststatcards">
        <div className="panel"><i aria-hidden="true">≋</i><span><b>{plans.length}</b><small>Kế hoạch</small></span></div>
        <div className="panel"><i aria-hidden="true">⌂</i><span><b>{orgs}</b><small>Đơn vị tham gia</small></span></div>
        <div className="panel"><i aria-hidden="true">☺</i><span><b>{sum('enrolled')}</b><small>Giáo viên đăng ký</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{sum('passed')}</b><small>Đạt</small><small>{sum('certs')} chứng chỉ đã cấp</small></span></div>
      </div>
      <div className="wrap"><table>
        <thead><tr><th>Kế hoạch</th><th>Đơn vị lập</th><th>Năm học</th><th>Thời gian</th><th>Phiên bản</th><th>Chỉ tiêu</th><th>Trạng thái</th></tr></thead>
        <tbody>{plans.map(x => { const k = x.training_plans!; const st = PLAN_ST[k.pub_status] ?? [k.pub_status, ''] ; return <tr key={x.plan_id + x.program_id}>
          <td><b>{k.name}</b><br /><small className="sub">{k.plan_code}</small></td><td>{k.organizations?.name ?? '—'}</td><td>{k.year_name ?? '—'}</td>
          <td><small>{[fmt(k.starts_on), fmt(k.ends_on)].filter(Boolean).join(' → ') || '—'}</small></td>
          <td>v{vers.get(x.program_id) ?? '?'}</td><td>{x.quota ?? '—'}</td><td><Chip tone={st[1]}>{st[0]}</Chip></td></tr> })}</tbody>
      </table></div>
      <h3 style={{ margin: '8px 0 0' }}>Mức độ triển khai theo đơn vị</h3>
      {rows.length === 0 ? <p className="sub" style={{ margin: 0 }}>Chưa có đơn vị nào được gán trong các kế hoạch đã ban hành.</p> : <div className="wrap"><table>
        <thead><tr><th>Đơn vị</th><th>Kế hoạch</th><th>Chỉ tiêu</th><th>GV đăng ký</th><th>Chuyên cần</th><th>Đạt</th><th>Chưa đạt</th><th>Chứng chỉ</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.plan_id + r.org_id}>
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
// Chương trình giáo dục đáp ứng (124): giáo viên Đạt khoá dùng chương trình tập huấn này thì được tính đáp ứng các chương trình giáo dục đã gắn.
// Gắn theo họ phiên bản ở cả hai phía; sửa được cả khi chương trình đã phát hành.
type EduOpt = { id: string; family_id: string | null; code: string | null; title: string; version_no: number; status: string }
const EDU_ST: Record<string, string> = { draft: 'nháp', pending: 'chờ duyệt', approved: 'đã duyệt', rejected: 'bị trả lại', superseded: 'bản cũ', archived: 'lưu trữ' }
function ProgramEduLinks({ p, admin, onMsg }: { p: TProgram; admin: boolean; onMsg: (m: string, err?: boolean) => void }) {
  const [opts, setOpts] = useState<EduOpt[] | null>(null)
  const [saved, setSaved] = useState<string[] | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.from('edu_programs').select('id, family_id, code, title, version_no, status').neq('status', 'archived').order('version_no', { ascending: false })
      .then(({ data }) => {
        // Mỗi họ một dòng: bản đang ban hành, chưa có thì bản mới nhất
        const m = new Map<string, EduOpt>()
        for (const r of (data ?? []) as EduOpt[]) { const k = r.family_id ?? r.id, cur = m.get(k)
          if (!cur || (r.status === 'published' && cur.status !== 'published')) m.set(k, r) }
        setOpts([...m.values()].sort((a, b) => a.title.localeCompare(b.title, 'vi')))
      })
    supabase.from('training_program_edu').select('edu_family').eq('training_family', p.family_id).then(({ data }) => {
      const ids = ((data ?? []) as { edu_family: string }[]).map(r => r.edu_family); setSaved(ids); setSel(ids)
    })
  }, [p.family_id])
  const famOf = (o: EduOpt) => o.family_id ?? o.id
  const label = (o: EduOpt) => `${o.code ? o.code + ' · ' : ''}${o.title}${o.status !== 'published' ? ` (${EDU_ST[o.status] ?? o.status})` : ''}`
  const options = (opts ?? []).map(o => [famOf(o), label(o)] as [string, string])
  const nameOf = (f: string) => { const o = (opts ?? []).find(x => famOf(x) === f); return o ? label(o) : 'Chương trình giáo dục' }
  const dirty = saved != null && (sel.length !== saved.length || sel.some(x => !saved.includes(x)))
  async function save() {
    setBusy(true)
    const ids = sel.map(f => (opts ?? []).find(o => famOf(o) === f)?.id ?? f)
    const { error } = await supabase.rpc('training_program_set_edu', { p_program: p.id, p_edu: ids })
    setBusy(false)
    if (error) return onMsg(/schema cache|does not exist|not find/i.test(error.message) ? 'Hãy chạy migration 124 trên Supabase.' : errText(error.message), true)
    setSaved(sel); onMsg(sel.length ? `Đã lưu: giáo viên Đạt khoá này được tính đáp ứng ${sel.length} chương trình giáo dục.` : 'Đã bỏ gắn chương trình giáo dục.')
  }
  return <section className="panel" style={{ display: 'grid', gap: 12 }}>
    <h3 style={{ margin: 0 }}>Chương trình giáo dục đáp ứng</h3>
    <p className="sub" style={{ margin: 0 }}>Giáo viên Đạt một khoá tập huấn dùng chương trình này được tính là đáp ứng các chương trình giáo dục dưới đây, kèm năng lực đích của khoá.
      Kết quả hiện ở hồ sơ năng lực giáo viên và bảng Đáp ứng chương trình giáo dục của trường, Sở. Phiên bản mới của hai bên vẫn giữ liên kết.</p>
    {admin && p.status !== 'archived' ? <>
      <div className="field"><span>Chương trình giáo dục</span>
        <MultiSelect value={sel} onChange={setSel} options={[...options, ...sel.filter(f => !options.some(o => o[0] === f)).map(f => [f, nameOf(f)] as [string, string])]}
          placeholder={opts ? 'Chọn chương trình giáo dục…' : 'Đang tải…'} ariaLabel="Chương trình giáo dục đáp ứng" empty="Chưa có chương trình giáo dục nào." /></div>
      <div className="formactions"><button type="button" className="primary" disabled={!dirty || busy} onClick={save}>Lưu chương trình giáo dục</button></div>
    </> : <p style={{ margin: 0 }}>{saved == null ? '…' : saved.length ? saved.map(nameOf).join('; ') : <small className="sub">Chưa gắn chương trình giáo dục.</small>}</p>}
  </section>
}

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

/** Đọc phạm vi + chương trình giáo dục đã lưu của một chương trình tập huấn. */
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

function ScopeEduFields({ x, set, owner, disabled }: { x: Extra; set: (x: Extra) => void; owner?: string | null; disabled?: boolean }) {
  const orgs = useAllOrgs()
  const opts = useEduOpts()
  const byId = useMemo(() => new Map((orgs ?? []).map(o => [o.id, o])), [orgs])
  const label = (id: string) => { const o = byId.get(id); if (!o) return 'Đơn vị'
    const par = o.parent_id ? byId.get(o.parent_id) : undefined
    return `${o.name} · ${OTYPE[o.type] ?? o.type}${par && o.type === 'school' ? ` (${par.name})` : ''}` }
  const orgOpts = useMemo(() => (orgs ?? []).filter(o => !o.is_platform && o.id !== owner && o.type !== 'provider')
    .sort((a, b) => (a.type === 'school' ? 1 : 0) - (b.type === 'school' ? 1 : 0) || a.name.localeCompare(b.name, 'vi'))
    .map(o => [o.id, label(o.id)] as [string, string]), [orgs, byId, owner])
  const eduOpts = (opts ?? []).map(o => [famOf(o), eduLabel(o)] as [string, string])
  const bad = extraBad(x)
  return <>
    <fieldset className="libtargets wide"><legend>Phạm vi áp dụng & hiệu lực</legend>
      <p className="sub" style={{ margin: '0 0 8px' }}>Đơn vị trong phạm vi (và đơn vị trực thuộc) mới thấy chương trình, chọn được khi lập kế hoạch và được gán kế hoạch dùng chương trình này.</p>
      <div className="formgrid" style={{ alignItems: 'start' }}>
        <label className="field"><span>Phạm vi áp dụng</span><select disabled={disabled} value={x.scope} onChange={e => set({ ...x, scope: e.target.value as Extra['scope'] })}>
          <option value="all">Mọi đơn vị</option><option value="selected">Chỉ đơn vị được chọn</option></select></label>
        <label className="field"><span>Hiệu lực từ</span><input type="date" disabled={disabled} value={x.effective_from} onChange={e => set({ ...x, effective_from: e.target.value })} /></label>
        <label className="field"><span>Hiệu lực đến</span><input type="date" disabled={disabled} value={x.effective_to} min={x.effective_from || undefined} onChange={e => set({ ...x, effective_to: e.target.value })} /></label>
        {x.scope === 'selected' && <div className="field" style={{ gridColumn: '1/-1' }}><span>Đơn vị áp dụng * <small className="sub">(chọn Sở / Phòng là áp dụng cho mọi trường trực thuộc)</small></span>
          <MultiSelect disabled={disabled} value={x.targets} onChange={v => set({ ...x, targets: v })} options={[...orgOpts, ...x.targets.filter(id => !orgOpts.some(o => o[0] === id)).map(id => [id, label(id)] as [string, string])]}
            placeholder="Chọn Sở, Phòng hoặc trường…" ariaLabel="Đơn vị áp dụng" empty="Chưa có đơn vị nào." /></div>}
      </div>
      {bad && <small className="warnline">{bad}</small>}
    </fieldset>
    <fieldset className="libtargets wide"><legend>Chương trình giáo dục đáp ứng</legend>
      <p className="sub" style={{ margin: '0 0 8px' }}>Giáo viên Đạt một khoá tập huấn dùng chương trình này được tính là đáp ứng các chương trình giáo dục dưới đây, kèm năng lực đích của khoá.</p>
      <div className="field"><span>Chương trình giáo dục</span>
        <MultiSelect disabled={disabled} value={x.edu} onChange={v => set({ ...x, edu: v })}
          options={[...eduOpts, ...x.edu.filter(f => !eduOpts.some(o => o[0] === f)).map(f => [f, 'Chương trình giáo dục'] as [string, string])]}
          placeholder={opts ? 'Chọn chương trình giáo dục…' : 'Đang tải…'} ariaLabel="Chương trình giáo dục đáp ứng" empty="Chưa có chương trình giáo dục nào." /></div>
    </fieldset>
  </>
}

function ProgramScope({ p, admin, onMsg }: { p: TProgram; admin: boolean; onMsg: (m: string, err?: boolean) => void }) {
  const orgs = useAllOrgs()
  const [saved, setSaved] = useState<string[] | null>(null)
  const [sel, setSel] = useState<string[]>([])
  const [scope, setScope] = useState<'all' | 'selected'>(p.scope ?? 'all')
  const [from, setFrom] = useState(p.effective_from ?? '')
  const [to, setTo] = useState(p.effective_to ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.from('training_program_targets').select('org_id').eq('program_id', p.id).then(({ data }) => {
      const ids = ((data ?? []) as { org_id: string }[]).map(r => r.org_id); setSaved(ids); setSel(ids)
    })
  }, [p.id])
  useEffect(() => { setScope(p.scope ?? 'all'); setFrom(p.effective_from ?? ''); setTo(p.effective_to ?? '') }, [p.scope, p.effective_from, p.effective_to])
  const byId = useMemo(() => new Map((orgs ?? []).map(o => [o.id, o])), [orgs])
  const label = (id: string) => { const o = byId.get(id); if (!o) return 'Đơn vị'
    const par = o.parent_id ? byId.get(o.parent_id) : undefined
    return `${o.name} · ${OTYPE[o.type] ?? o.type}${par && o.type === 'school' ? ` (${par.name})` : ''}` }
  const options = useMemo(() => (orgs ?? []).filter(o => !o.is_platform && o.id !== p.org_id && o.type !== 'provider')
    .sort((a, b) => (a.type === 'school' ? 1 : 0) - (b.type === 'school' ? 1 : 0) || a.name.localeCompare(b.name, 'vi'))
    .map(o => [o.id, label(o.id)] as [string, string]), [orgs, byId])
  const edit = admin && p.status !== 'archived'
  const same = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))
  const dirty = saved != null && (scope !== (p.scope ?? 'all') || (from || null) !== (p.effective_from ?? null) || (to || null) !== (p.effective_to ?? null) || !same(sel, saved))
  const bad = scope === 'selected' && !sel.length ? 'Chọn ít nhất một đơn vị áp dụng.' : from && to && to < from ? 'Ngày hết hiệu lực phải sau ngày bắt đầu.' : ''
  async function save() {
    if (!saved || bad) return
    setBusy(true)
    const add = sel.filter(x => !saved.includes(x)), del = saved.filter(x => !sel.includes(x))
    const r1 = add.length ? await supabase.from('training_program_targets').insert(add.map(org_id => ({ program_id: p.id, org_id }))) : { error: null }
    const r2 = !r1.error && del.length ? await supabase.from('training_program_targets').delete().eq('program_id', p.id).in('org_id', del) : { error: null }
    const r3 = !r1.error && !r2.error ? await supabase.from('training_programs').update({ scope, effective_from: from || null, effective_to: to || null }).eq('id', p.id) : { error: null }
    setBusy(false)
    const err = r1.error ?? r2.error ?? r3.error
    if (err) return onMsg(errText(err.message), true)
    setSaved(sel)
    onMsg(scope === 'all' ? 'Đã lưu: chương trình áp dụng cho mọi đơn vị.' : `Đã lưu phạm vi áp dụng: ${sel.length} đơn vị và các đơn vị trực thuộc.`)
  }
  const note = effNote(p)
  return <section className="panel" style={{ display: 'grid', gap: 12 }}>
    <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Phạm vi áp dụng & hiệu lực</h3>
      {note && <Chip tone={note.startsWith('Hết') ? 'bad' : 'warn'}>{note}</Chip>}</div>
    <p className="sub" style={{ margin: 0 }}>Đơn vị trong phạm vi (và đơn vị trực thuộc) mới thấy chương trình, chọn được khi lập kế hoạch và được gán kế hoạch dùng chương trình này.
      Sửa được cả khi chương trình đã phát hành; phiên bản mới giữ nguyên phạm vi.</p>
    {edit ? <>
      <div className="formgrid" style={{ alignItems: 'start' }}>
        <label className="field"><span>Phạm vi áp dụng</span><select value={scope} onChange={e => setScope(e.target.value as 'all' | 'selected')}>
          <option value="all">Mọi đơn vị</option><option value="selected">Chỉ đơn vị được chọn</option></select></label>
        <label className="field"><span>Hiệu lực từ</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="field"><span>Hiệu lực đến</span><input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
        {scope === 'selected' && <div className="field" style={{ gridColumn: '1/-1' }}><span>Đơn vị áp dụng * <small className="sub">(chọn Sở / Phòng là áp dụng cho mọi trường trực thuộc)</small></span>
          <MultiSelect value={sel} onChange={setSel} options={[...options, ...sel.filter(id => !options.some(o => o[0] === id)).map(id => [id, label(id)] as [string, string])]}
            placeholder="Chọn Sở, Phòng hoặc trường…" ariaLabel="Đơn vị áp dụng" empty="Chưa có đơn vị nào." /></div>}
      </div>
      {bad && dirty && <small className="warnline">{bad}</small>}
      <div className="formactions"><button type="button" className="primary" disabled={!dirty || !!bad || busy} onClick={save}>Lưu phạm vi áp dụng</button></div>
    </> : <dl className="tpkv">
      <dt>Phạm vi</dt><dd>{p.scope === 'selected' ? (saved ? saved.map(label).join('; ') || '—' : '…') : 'Mọi đơn vị'}</dd>
      <dt>Hiệu lực</dt><dd>{[p.effective_from && `từ ${vnDay(p.effective_from)}`, p.effective_to && `đến ${vnDay(p.effective_to)}`].filter(Boolean).join(' ') || 'Không giới hạn'}</dd>
    </dl>}
  </section>
}
