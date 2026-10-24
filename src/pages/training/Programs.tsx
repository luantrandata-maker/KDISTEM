// Phân hệ 1 — Chương trình tập huấn (083): mẫu khoá tập huấn chuẩn của KDI, dùng lại cho các kế hoạch tập huấn.
// Cấu trúc 3 cấp: Chương trình tập huấn → Môn → Nội dung tập huấn. Cách làm giống Phân hệ 2: hướng dẫn các bước,
// thẻ số liệu, danh sách có lọc; thêm / sửa / xem chi tiết mở view riêng; Nháp → Đã phát hành → Ngừng dùng, nhân bản để sửa.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useEduLevels } from '../../lib/eduLevels'
import { useStemTracks } from '../../lib/stemTracks'
import { useSubjects } from '../subjects'
import { useCompetencies } from '../competency'
import { ElView } from '../../components/ElView'
import { Chip, STATUS } from '../dist/Editor'
import type { Status } from '../dist/sched'
import { ContentDetail, detailCount, type Detail } from './Content'

type Mode = 'online' | 'offline' | 'hybrid'
export type TProgram = {
  id: string; org_id: string; code: string; title: string; ct_code: string | null; level: string | null; audience: string | null; mode: Mode
  description: string | null; competencies: string[]; target_level: number; pass_attendance: number; pass_score: number | null; need_product: boolean
  status: Status; version_no: number; source_id: string | null; updated_at: string; published_at: string | null
}
type Unit = { id: string; program_id: string; parent_id: string | null; kind: 'subject' | 'content'; seq: number; title: string; hours: number; mode: 'online' | 'offline' | null; has_test: boolean; note: string | null; detail: Detail }
const MODE: Record<Mode, string> = { online: 'Trực tuyến', offline: 'Trực tiếp', hybrid: 'Kết hợp' }
const SEL = 'id, org_id, code, title, ct_code, level, audience, mode, description, competencies, target_level, pass_attendance, pass_score, need_product, status, version_no, source_id, updated_at, published_at'
const errText = (m: string) => /schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 083 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Chỉ quản trị nền tảng KDI soạn được chương trình tập huấn.' : m
const num = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')
type Stat = { subjects: number; contents: number; hours: number }

export function TrainingProgramsPage() {
  const [list, setList] = useState<TProgram[] | null>(null)
  const [stats, setStats] = useState<Map<string, Stat>>(new Map())
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
      const [p, u] = await Promise.all([
        supabase.from('training_programs').select(SEL).order('code'),
        supabase.from('training_program_units').select('program_id, kind, hours'),
      ])
      if (p.error) { setMsg([errText(p.error.message), true]); setList([]); return }
      const m = new Map<string, Stat>()
      for (const r of (u.data ?? []) as { program_id: string; kind: string; hours: number }[]) {
        let x = m.get(r.program_id); if (!x) m.set(r.program_id, x = { subjects: 0, contents: 0, hours: 0 })
        if (r.kind === 'subject') x.subjects++; else { x.contents++; x.hours += Number(r.hours) || 0 }
      }
      setList((p.data as TProgram[]) ?? []); setStats(m)
    })()
  }, [rk])

  const shown = useMemo(() => (list ?? []).filter(p => (!fs || p.status === fs) && (!ct || p.ct_code === ct)
    && (!q || `${p.code} ${p.title} ${p.audience ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [list, fs, ct, q])

  if (view?.kind === 'new') return <ProgramForm admin={admin} onBack={() => setView(null)} onSaved={id => { reload(); setView({ kind: 'open', id }) }} />
  if (view?.kind === 'open') return <ProgramDetail key={view.id + ':' + rk} id={view.id} admin={admin} onBack={() => { setView(null); reload() }}
    onOpen={id => { reload(); setView({ kind: 'open', id }) }} onMsg={m => { setMsg(m); reload() }} />

  const n = (s: Status) => (list ?? []).filter(p => p.status === s).length
  const totalContents = [...stats.values()].reduce((a, x) => a + x.contents, 0)
  const steps: [string, string][] = [
    ['Soạn chương trình', 'Nhập thông tin, năng lực đích và điều kiện đạt; thêm các môn và nội dung tập huấn kèm số giờ.'],
    ['Phát hành', 'Kiểm tra đủ nội dung rồi phát hành. Bản đã phát hành không sửa được, muốn sửa thì nhân bản.'],
    ['Dùng trong kế hoạch', 'Chọn chương trình đã phát hành khi lập Kế hoạch & lịch tập huấn cho trường, giáo viên.']]
  return (
    <>
      <div className="panel distintro">
        <ol className="distguide">{steps.map(([h, d], k) => <li key={h}><button type="button" onClick={() => setFs(k === 0 ? 'draft' : k === 1 ? 'published' : '')}>
          <i>{k + 1}</i><span><b>{h}</b><small>{d}</small></span></button></li>)}</ol>
        <p className="sub" style={{ margin: 0 }}>Chương trình tập huấn là mẫu khoá học chuẩn của KDI, gồm các môn, mỗi môn có các nội dung tập huấn. Một chương trình dùng lại được cho nhiều kế hoạch tập huấn.</p>
      </div>
      <div className="diststatcards">
        <div className="panel"><i aria-hidden="true">≋</i><span><b>{list?.length ?? '…'}</b><small>Chương trình tập huấn</small><small>{n('published')} đã phát hành · {n('draft')} nháp</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">✓</i><span><b>{list ? n('published') : '…'}</b><small>Dùng được trong kế hoạch</small></span></div>
        <div className="panel"><i aria-hidden="true" className="good">▦</i><span><b>{totalContents}</b><small>Nội dung tập huấn</small><small>{[...stats.values()].reduce((a, x) => a + x.subjects, 0)} môn</small></span></div>
      </div>
      <div className="distfilter">
        {([['', 'Tất cả', list?.length ?? 0], ['draft', 'Nháp', n('draft')], ['published', 'Đã phát hành', n('published')], ['archived', 'Ngừng dùng', n('archived')]] as [Status | '', string, number][]).map(([s, l, c]) =>
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
        <thead><tr><th>Chương trình tập huấn</th><th>Loại · cấp học</th><th>Đối tượng</th><th>Môn · nội dung · giờ</th><th>Hình thức</th><th>Trạng thái</th><th>Cập nhật</th></tr></thead>
        <tbody>{shown.map(p => { const s = stats.get(p.id); return <tr key={p.id}>
          <td><button type="button" className="namelink" onClick={() => { setMsg(null); setView({ kind: 'open', id: p.id }) }}>{p.title}</button><br /><small className="sub">{p.code} · v{p.version_no}</small></td>
          <td>{[p.ct_code, p.level && levelName(p.level)].filter(Boolean).join(' · ') || '—'}</td>
          <td style={{ whiteSpace: 'normal' }}>{p.audience || '—'}</td>
          <td>{s?.subjects ?? 0} môn · {s?.contents ?? 0} nội dung · {num(s?.hours ?? 0)} giờ</td>
          <td>{MODE[p.mode]}</td>
          <td><Chip tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Chip></td>
          <td><small>{new Date(p.updated_at).toLocaleDateString('vi-VN')}</small></td>
        </tr> })}
          {shown.length === 0 && <tr><td colSpan={7}>{list.length ? 'Không có chương trình nào khớp bộ lọc.' : admin ? 'Chưa có chương trình tập huấn nào. Bấm "Thêm chương trình tập huấn".' : 'Chưa có chương trình tập huấn nào được KDI phát hành.'}</td></tr>}</tbody>
      </table></div>}
    </>
  )
}

// ===== Thêm / sửa thông tin chương trình =====
const BLANK = { title: '', ct_code: null as string | null, level: null as string | null, audience: '', mode: 'hybrid' as Mode, description: '', competencies: [] as string[], target_level: 3, pass_attendance: 80, pass_score: null as number | null, need_product: false }
type Info = typeof BLANK

function InfoFields({ f, set, disabled }: { f: Info; set: (f: Info) => void; disabled?: boolean }) {
  const { codes, byCode: tracks } = useStemTracks()
  const { levels } = useEduLevels()
  const comps = useCompetencies('teacher')
  return <>
    <div className="formgrid">
      <label className="field" style={{ gridColumn: '1/-1' }}><span>Tên chương trình tập huấn *</span><input required disabled={disabled} maxLength={200} value={f.title} onChange={e => set({ ...f, title: e.target.value })} placeholder="VD: Tập huấn dạy học STEM tích hợp cho giáo viên THCS" /></label>
      <label className="field"><span>Loại chương trình</span><select disabled={disabled} value={f.ct_code ?? ''} onChange={e => set({ ...f, ct_code: e.target.value || null })}><option value="">— Không chọn —</option>
        {codes.map(c => <option key={c} value={c}>{c}{tracks[c] ? ` · ${tracks[c]!.name}` : ''}</option>)}</select></label>
      <label className="field"><span>Cấp học</span><select disabled={disabled} value={f.level ?? ''} onChange={e => set({ ...f, level: e.target.value || null })}><option value="">Mọi cấp học</option>
        {levels.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}</select></label>
      <label className="field"><span>Hình thức</span><select disabled={disabled} value={f.mode} onChange={e => set({ ...f, mode: e.target.value as Mode })}>
        {(Object.keys(MODE) as Mode[]).map(m => <option key={m} value={m}>{MODE[m]}</option>)}</select></label>
      <label className="field"><span>Đối tượng</span><input disabled={disabled} maxLength={200} value={f.audience ?? ''} onChange={e => set({ ...f, audience: e.target.value })} placeholder="VD: Giáo viên mới dạy STEM" /></label>
      <label className="field" style={{ gridColumn: '1/-1' }}><span>Mô tả</span><textarea disabled={disabled} rows={2} maxLength={4000} value={f.description ?? ''} onChange={e => set({ ...f, description: e.target.value })} /></label>
    </div>
    <fieldset className="libtargets"><legend>Năng lực đích (khung năng lực giáo viên)</legend>
      {comps.map(c => <label key={c.key}><input type="checkbox" disabled={disabled} checked={f.competencies.includes(c.key)}
        onChange={e => set({ ...f, competencies: e.target.checked ? [...f.competencies, c.key] : f.competencies.filter(x => x !== c.key) })} /> {c.name}</label>)}
      {comps.length === 0 && <small className="sub">Chưa có khung năng lực giáo viên.</small>}
      <label className="field" style={{ maxWidth: 260 }}><span>Mức cần đạt sau tập huấn</span><select disabled={disabled} value={f.target_level} onChange={e => set({ ...f, target_level: Number(e.target.value) })}>
        {[1, 2, 3, 4].map(l => <option key={l} value={l}>Mức {l}</option>)}</select></label>
    </fieldset>
    <fieldset className="libtargets"><legend>Điều kiện đạt (dùng khi đánh giá kết quả và cấp chứng chỉ)</legend>
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

function ProgramForm({ admin, onBack, onSaved }: { admin: boolean; onBack: () => void; onSaved: (id: string) => void }) {
  const [f, setF] = useState<Info>(BLANK)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!admin) return
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('training_programs').insert({ ...f, title: f.title.trim(), audience: f.audience?.trim() || null, description: f.description?.trim() || null }).select('id').single()
    setBusy(false)
    if (error) return setErr(errText(error.message))
    onSaved((data as { id: string }).id)
  }
  return <ElView back="Chương trình tập huấn" onBack={onBack} title="Thêm chương trình tập huấn" sub="Lưu xong thì thêm các môn và nội dung tập huấn.">
    <form className="panel" onSubmit={save} style={{ display: 'grid', gap: 12 }}>
      <InfoFields f={f} set={setF} />
      {err && <p className="msg">{err}</p>}
      <div className="formactions"><button type="submit" className="primary" disabled={busy || !f.title.trim()}>Tạo bản nháp</button> <button type="button" onClick={onBack}>Huỷ</button></div>
    </form>
  </ElView>
}

// ===== Chi tiết: thông tin + môn & nội dung tập huấn =====
function ProgramDetail({ id, admin, onBack, onOpen, onMsg }: { id: string; admin: boolean; onBack: () => void; onOpen: (id: string) => void; onMsg: (m: [string, boolean]) => void }) {
  const [p, setP] = useState<TProgram | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [f, setF] = useState<Info | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [newSubj, setNewSubj] = useState('')
  const [openC, setOpenC] = useState<string | null>(null)
  const { subjects } = useSubjects()
  const { byCode: tracks } = useStemTracks()
  const { name: levelName } = useEduLevels()
  const comps = useCompetencies('teacher')
  async function load() {
    const [a, b] = await Promise.all([
      supabase.from('training_programs').select(SEL).eq('id', id).single(),
      supabase.from('training_program_units').select('*').eq('program_id', id).order('seq'),
    ])
    if (a.error) return setMsg([errText(a.error.message), true])
    const x = a.data as TProgram
    setP(x); setUnits((b.data as Unit[]) ?? [])
    setF({ title: x.title, ct_code: x.ct_code, level: x.level, audience: x.audience ?? '', mode: x.mode, description: x.description ?? '', competencies: x.competencies ?? [],
      target_level: x.target_level, pass_attendance: x.pass_attendance, pass_score: x.pass_score, need_product: x.need_product })
  }
  useEffect(() => { load() }, [id])
  if (!p || !f) return <ElView back="Chương trình tập huấn" onBack={onBack} title="Đang tải…">{msg && <p className="msg">{msg[0]}</p>}</ElView>

  const edit = admin && p.status === 'draft'
  const subjs = units.filter(u => u.kind === 'subject').sort((a, b) => a.seq - b.seq)
  const kids = (sid: string) => units.filter(u => u.parent_id === sid).sort((a, b) => a.seq - b.seq)
  const contents = units.filter(u => u.kind === 'content')
  const hours = contents.reduce((a, u) => a + (Number(u.hours) || 0), 0)
  const suggest = [...new Set([...subjects.map(s => s.name), ...(p.ct_code ? tracks[p.ct_code]?.subjects ?? [] : [])])].sort((a, b) => a.localeCompare(b, 'vi'))
  const run = async (q: PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    const { error } = await q
    if (error) setMsg([errText(error.message), true]); else if (ok) setMsg([ok, false])
    await load()
    return !error
  }
  async function saveInfo() {
    if (!f) return
    await run(supabase.from('training_programs').update({ ...f, title: f.title.trim(), audience: f.audience?.trim() || null, description: f.description?.trim() || null }).eq('id', p!.id), 'Đã lưu thông tin.')
  }
  async function addSubject() {
    const t = newSubj.trim(); if (!t) return
    if (await run(supabase.from('training_program_units').insert({ program_id: p!.id, kind: 'subject', title: t, seq: subjs.reduce((m, s) => Math.max(m, s.seq), 0) + 1 }))) setNewSubj('')
  }
  const addContent = (s: Unit) => run(supabase.from('training_program_units').insert({ program_id: p!.id, parent_id: s.id, kind: 'content', title: 'Nội dung mới', hours: 1,
    seq: kids(s.id).reduce((m, u) => Math.max(m, u.seq), 0) + 1 }))
  const patch = (u: Unit, v: Partial<Unit>) => run(supabase.from('training_program_units').update(v).eq('id', u.id))
  const remove = (u: Unit) => {
    if (!confirm(u.kind === 'subject' ? `Xoá môn "${u.title}" và ${kids(u.id).length} nội dung bên trong?` : `Xoá nội dung "${u.title}"?`)) return
    run(supabase.from('training_program_units').delete().eq('id', u.id))
  }
  /** Đổi chỗ với mục kề trong cùng cấp */
  async function move(list: Unit[], i: number, d: -1 | 1) {
    const a = list[i], b = list[i + d]; if (!b) return
    await supabase.from('training_program_units').update({ seq: b.seq }).eq('id', a.id)
    await run(supabase.from('training_program_units').update({ seq: a.seq }).eq('id', b.id))
  }
  async function setStatus(s: Status, ok: string) {
    if (await run(supabase.from('training_programs').update({ status: s }).eq('id', p!.id), ok)) onMsg([ok, false])
  }
  async function copy() {
    const { data, error } = await supabase.rpc('training_program_copy', { p_program: p!.id })
    if (error) return setMsg([errText(error.message), true])
    onMsg([`Đã nhân bản ${p!.code} thành bản nháp mới.`, false]); onOpen(data as string)
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
      onBack={() => setOpenC(null)} onSave={dd => run(supabase.from('training_program_units').update({ detail: dd }).eq('id', oc.id))} />
  }
  const warn = [!contents.length && 'chưa có nội dung tập huấn nào', p.pass_score != null && !contents.some(u => u.has_test) && 'có điều kiện điểm bài test nhưng chưa nội dung nào có bài test',
    subjs.some(s => !kids(s.id).length) && 'có môn chưa có nội dung'].filter(Boolean) as string[]

  return <ElView back="Chương trình tập huấn" onBack={onBack} title={p.title}
    sub={<>{p.code} · v{p.version_no} · <Chip tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Chip> · {subjs.length} môn · {contents.length} nội dung · {num(hours)} giờ</>}
    actions={admin && <>
      {p.status === 'draft' && <button type="button" className="primary" disabled={warn.length > 0 && !contents.length} onClick={() => setStatus('published', `Đã phát hành ${p.code}.`)}>Phát hành</button>}
      {p.status !== 'draft' && <button type="button" onClick={copy}>Nhân bản để sửa</button>}
      {p.status === 'published' && <button type="button" onClick={() => confirm('Ngừng dùng chương trình này? Kế hoạch đã có vẫn giữ nguyên.') && setStatus('archived', 'Đã chuyển sang Ngừng dùng.')}>Ngừng dùng</button>}
      {p.status === 'archived' && <button type="button" onClick={() => setStatus('published', 'Đã dùng lại chương trình.')}>Dùng lại</button>}
      {p.status === 'draft' && <button type="button" className="danger" onClick={del}>Xoá</button>}
    </>}>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {edit && warn.length > 0 && <p className="warnline">Chưa phát hành được: {warn.join('; ')}.</p>}
    {!edit && p.status !== 'draft' && admin && <p className="sub">Bản đã phát hành không sửa được. Bấm "Nhân bản để sửa" để tạo bản nháp mới.</p>}

    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0 }}>Thông tin & điều kiện đạt</h3>
      {edit ? <>
        <InfoFields f={f} set={setF} />
        <div className="formactions"><button type="button" className="primary" disabled={!f.title.trim()} onClick={saveInfo}>Lưu thông tin</button></div>
      </> : <dl className="tpkv">
        <dt>Loại · cấp học</dt><dd>{[p.ct_code && `${p.ct_code}${tracks[p.ct_code] ? ' · ' + tracks[p.ct_code]!.name : ''}`, p.level ? levelName(p.level) : 'Mọi cấp học'].filter(Boolean).join(' · ')}</dd>
        <dt>Đối tượng</dt><dd>{p.audience || '—'}</dd>
        <dt>Hình thức</dt><dd>{MODE[p.mode]}</dd>
        {p.description && <><dt>Mô tả</dt><dd>{p.description}</dd></>}
        <dt>Năng lực đích</dt><dd>{p.competencies.length ? p.competencies.map(k => comps.find(c => c.key === k)?.name ?? k).join(', ') + ` (mức ${p.target_level})` : '—'}</dd>
        <dt>Điều kiện đạt</dt><dd>{[`chuyên cần ≥ ${p.pass_attendance}%`, p.pass_score != null && `điểm bài test ≥ ${num(Number(p.pass_score))}`, p.need_product && 'sản phẩm cuối khoá đạt'].filter(Boolean).join(' · ')}</dd>
      </dl>}
    </section>

    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Môn & nội dung tập huấn</h3><small className="sub">{subjs.length} môn · {contents.length} nội dung · {num(hours)} giờ</small></div>
      {subjs.map((s, i) => { const ks = kids(s.id), sh = ks.reduce((a, u) => a + (Number(u.hours) || 0), 0)
        return <div key={s.id} className="tpsubj">
          <div className="bar" style={{ margin: 0 }}>
            {edit ? <input className="tpsubjname" defaultValue={s.title} aria-label="Tên môn" maxLength={200} list="tp-subjects"
              onBlur={e => { const v = e.target.value.trim(); if (v && v !== s.title) patch(s, { title: v }); else e.target.value = s.title }} />
              : <b>Môn {i + 1}. {s.title}</b>}
            <span className="tools"><small className="sub">{ks.length} nội dung · {num(sh)} giờ</small>
              {edit && <><button type="button" aria-label="Chuyển môn lên" disabled={!i} onClick={() => move(subjs, i, -1)}>↑</button>
                <button type="button" aria-label="Chuyển môn xuống" disabled={i === subjs.length - 1} onClick={() => move(subjs, i, 1)}>↓</button>
                <button type="button" onClick={() => addContent(s)}>+ Thêm nội dung</button>
                <button type="button" onClick={() => remove(s)}>Xoá môn</button></>}</span>
          </div>
          <div className="wrap"><table className="libtable">
            <thead><tr><th style={{ width: 40 }}>STT</th><th>Nội dung tập huấn</th><th style={{ width: 90 }}>Số giờ</th><th style={{ width: 130 }}>Hình thức</th><th style={{ width: 80 }}>Bài test</th><th>Chi tiết</th>{edit && <th style={{ width: 120 }}></th>}</tr></thead>
            <tbody>{ks.map((u, j) => <tr key={u.id}>
              <td>{j + 1}</td>
              <td>{edit ? <input defaultValue={u.title} aria-label="Nội dung tập huấn" maxLength={200} style={{ width: '100%' }}
                onBlur={e => { const v = e.target.value.trim(); if (v && v !== u.title) patch(u, { title: v }); else e.target.value = u.title }} /> : <button type="button" className="namelink" onClick={() => setOpenC(u.id)}>{u.title}</button>}</td>
              <td>{edit ? <input type="number" min={0} max={500} step={0.5} defaultValue={u.hours} aria-label="Số giờ" style={{ width: 70 }}
                onBlur={e => { const v = Number(e.target.value); if (v !== Number(u.hours) && v >= 0) patch(u, { hours: v }) }} /> : num(Number(u.hours))}</td>
              <td>{edit ? <select value={u.mode ?? ''} aria-label="Hình thức" onChange={e => patch(u, { mode: (e.target.value || null) as Unit['mode'] })}>
                <option value="">Theo chương trình</option><option value="online">Trực tuyến</option><option value="offline">Trực tiếp</option></select> : u.mode ? MODE[u.mode] : MODE[p.mode]}</td>
              <td>{edit ? <input type="checkbox" checked={u.has_test} aria-label="Có bài test" onChange={e => patch(u, { has_test: e.target.checked })} /> : u.has_test ? 'Có' : '—'}</td>
              <td><button type="button" className="linkbtn" onClick={() => setOpenC(u.id)}>{edit ? 'Soạn' : 'Xem'} 5 phần</button><br /><small className="sub">{detailCount(u.detail) || 'Chưa có'}</small></td>
              {edit && <td className="tools"><button type="button" aria-label="Chuyển lên" disabled={!j} onClick={() => move(ks, j, -1)}>↑</button>
                <button type="button" aria-label="Chuyển xuống" disabled={j === ks.length - 1} onClick={() => move(ks, j, 1)}>↓</button>
                <button type="button" aria-label="Xoá nội dung" onClick={() => remove(u)}>×</button></td>}
            </tr>)}
              {!ks.length && <tr><td colSpan={edit ? 7 : 6}><small className="sub">Chưa có nội dung.{edit && ' Bấm "+ Thêm nội dung".'}</small></td></tr>}</tbody>
          </table></div>
        </div> })}
      {!subjs.length && <p className="sub">Chưa có môn nào.{edit && ' Nhập tên môn bên dưới rồi bấm "+ Thêm môn".'}</p>}
      {edit && <div className="actions">
        <input value={newSubj} onChange={e => setNewSubj(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addSubject() }} list="tp-subjects" maxLength={200}
          placeholder="Tên môn, ví dụ: Phương pháp dạy học STEM" aria-label="Tên môn mới" style={{ flex: 1, minWidth: 240 }} />
        <button type="button" disabled={!newSubj.trim()} onClick={addSubject}>+ Thêm môn</button>
        <datalist id="tp-subjects">{suggest.map(s => <option key={s} value={s} />)}</datalist>
      </div>}
    </section>
  </ElView>
}
