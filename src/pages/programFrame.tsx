import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useStemTracks, SCHEDULE_MODE_NAME, type StemTrack } from '../lib/stemTracks'
import { fmtGrades, gradeName, useEduLevels } from '../lib/eduLevels'
import { frameErr, loadFrame, type MaterialGroup, type ProgramModule, type ProgramTopic } from '../lib/programFrame'
import { PROGRAM_COLOR } from './teacher/common'
import { DataTable, type Col } from '../components/DataTable'
import { HeadAction } from '../components/PageFrame'
import { DetailHead } from '../components/DetailHead'
import { ElView } from '../components/ElView'
import { ActionBar, type Act } from '../components/ActionBar'
import { SubjectMulti, SubjectPicker } from '../components/Pickers'

// Khung chương trình (147): KDI chọn loại chương trình → danh sách học phần → chủ đề theo từng khối.
// Học phần dùng chung giữa các gói và các khối (CT1, CT4 có một học phần "CHUNG"); mỗi chủ đề thuộc một khối, có thứ tự cố định
// (trường không đổi được thứ tự). Xem theo khối: toàn bộ chủ đề của một khối, theo thứ tự học phần → chủ đề, kèm tổng số tiết.

const chip = (code: string) => <span className="progchip" style={{ background: PROGRAM_COLOR[code], color: '#fff' }}>{code}</span>
const pill = (on: boolean) => <span className={'pill ' + (on ? 'good' : 'inactive')}>{on ? 'Đang dùng' : 'Ngừng dùng'}</span>
const sum = (ts: ProgramTopic[]) => ts.reduce((s, t) => s + (t.periods || 0), 0)

type TopicDraft = Omit<ProgramTopic, 'id'> & { id?: string }

export function ProgramFrame() {
  const { tracks } = useStemTracks()
  const active = tracks.filter(t => t.active !== false)
  const [admin, setAdmin] = useState(false)
  const [code, setCode] = useState('')
  const [view, setView] = useState<'modules' | 'grade'>('modules')
  const [modules, setModules] = useState<ProgramModule[]>([])
  const [topics, setTopics] = useState<ProgramTopic[]>([])
  const [msg, setMsg] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [editMod, setEditMod] = useState<ProgramModule | null>(null)
  const [editTopic, setEditTopic] = useState<TopicDraft | null>(null)
  const [grade, setGrade] = useState<number | null>(null)
  const reload = () => loadFrame().then(r => { setModules(r.modules); setTopics(r.topics); setMsg(r.error) })
  useEffect(() => { supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data)); reload() }, [])
  const track = tracks.find(t => t.code === code) ?? active[0]
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
    setMsg(''); reload()
  }
  async function move(m: ProgramModule, dir: -1 | 1) {
    const list = [...mods]
    const i = list.findIndex(x => x.id === m.id), j = i + dir
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    const res = await Promise.all(list.map((x, k) => x.sort === k + 1 ? null : supabase.from('program_modules').update({ sort: k + 1 }).eq('id', x.id)))
    const e = res.find(r => r?.error)?.error
    if (e) setMsg(frameErr(e.message + ' ' + (e.code ?? '')))
    reload()
  }

  // ----- Sửa học phần / chủ đề -----
  if (editMod) {
    const done = () => { setEditMod(null); reload() }
    return <ElView back={openId ? 'Học phần' : 'Khung chương trình'} onBack={() => setEditMod(null)}
      title={<>{chip(editMod.track_code)} {editMod.id ? 'Sửa học phần' : 'Thêm học phần'}</>}>
      <ModuleForm m={editMod} onCancel={() => setEditMod(null)} onSaved={done} />
    </ElView>
  }
  if (editTopic) {
    const m = modules.find(x => x.id === editTopic.module_id)
    const done = () => { setEditTopic(null); reload() }
    return <ElView back={m?.name ?? 'Học phần'} onBack={() => setEditTopic(null)}
      title={<>{m && chip(m.track_code)} {editTopic.id ? 'Sửa chủ đề' : 'Thêm chủ đề'}</>} sub={m ? `Học phần: ${m.name}` : undefined}>
      <TopicForm t={editTopic} track={track} onCancel={() => setEditTopic(null)} onSaved={done} />
    </ElView>
  }

  // ----- Chi tiết học phần: chủ đề theo khối -----
  const cur = openId ? modules.find(m => m.id === openId) : undefined
  if (cur) {
    const ts = topicsOf(cur.id)
    const gs = [...new Set(ts.map(t => t.grade))]
    const nextSeq = (g: number) => ts.filter(t => t.grade === g).reduce((x, t) => Math.max(x, t.seq), 0) + 1
    const blank = (g: number): TopicDraft => ({ module_id: cur.id, grade: g, seq: nextSeq(g), code: '', title: '', periods: 1, objectives: '', main_subject: null, subjects: [], textbook_ref: '', active: true })
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
      {gs.map(g => {
        const list = ts.filter(t => t.grade === g)
        return <div key={g} className="panel pdcard" style={{ marginBottom: 12 }}>
          <div className="bar"><h4 style={{ margin: 0 }}>{gradeName(g)} <small className="sub">· {list.length} chủ đề · {sum(list)} tiết</small></h4>
            {admin && <div className="tools"><button type="button" onClick={() => setEditTopic(blank(g))}>+ Chủ đề {gradeName(g)}</button></div>}</div>
          <TopicTable list={list} track={track} admin={admin} onEdit={t => setEditTopic(t)} onDel={delTopic} />
        </div>
      })}
    </>
  }

  // ----- Danh sách -----
  const cols: Col<ProgramModule>[] = [
    { key: 'sort', label: 'TT', fixed: true, thClass: 'c-no', text: m => String(m.sort), cell: m => m.sort },
    { key: 'name', label: 'Học phần', fixed: true, thClass: 'c-ttl', text: m => m.name, cell: m => <><b>{m.name}</b>{m.description && <div className="sub">{m.description}</div>}</> },
    { key: 'grades', label: 'Khối', text: m => fmtGrades([...new Set(topicsOf(m.id).map(t => t.grade))]),
      values: m => [...new Set(topicsOf(m.id).map(t => gradeName(t.grade)))],
      cell: m => { const g = [...new Set(topicsOf(m.id).map(t => t.grade))]; return g.length ? fmtGrades(g) : <small className="sub">Chưa có</small> } },
    { key: 'n', label: 'Số chủ đề', text: m => String(topicsOf(m.id).length), cell: m => topicsOf(m.id).length },
    { key: 'hp', label: 'Tiết / khối', text: m => m.periods == null ? '' : String(m.periods), cell: m => m.periods ?? <small className="sub">—</small> },
    { key: 'p', label: 'Tổng tiết chủ đề', text: m => String(sum(topicsOf(m.id))), cell: m => sum(topicsOf(m.id)) },
    { key: 'st', label: 'Trạng thái', text: m => m.active ? 'Đang dùng' : 'Ngừng dùng', cell: m => pill(m.active) },
    ...(admin ? [{ key: 'mv', label: 'Thứ tự', fixed: true, cell: (m: ProgramModule) => <span onClick={e => e.stopPropagation()}>
      <button type="button" className="ghostbtn" title="Lên" aria-label="Lên" onClick={() => move(m, -1)}>↑</button>
      <button type="button" className="ghostbtn" title="Xuống" aria-label="Xuống" onClick={() => move(m, 1)}>↓</button></span> }] : []),
  ]
  const g = grade ?? grades[0] ?? null
  return <>
    {admin && track && <HeadAction><button type="button" className="primary ttadd"
      onClick={() => setEditMod({ id: '', track_code: track.code, name: '', description: '', periods: null, sort: mods.reduce((x, m) => Math.max(x, m.sort), 0) + 1, active: true })}>+ Thêm học phần</button></HeadAction>}
    <div className="bar">
      <div className="segmented" role="tablist" aria-label="Loại chương trình">
        {active.map(t => <button key={t.code} type="button" className={t.code === track?.code ? 'on' : ''} onClick={() => { setCode(t.code); setGrade(null) }}>{t.code} · {t.name}</button>)}
      </div>
      <div className="segmented" aria-label="Cách xem">
        <button type="button" className={view === 'modules' ? 'on' : ''} onClick={() => setView('modules')}>Theo học phần</button>
        <button type="button" className={view === 'grade' ? 'on' : ''} onClick={() => setView('grade')}>Theo khối</button>
      </div>
    </div>
    {track && <p className="sub" style={{ margin: '4px 0 10px' }}>
      {track.school_pick_topics ? 'Trường tự chọn chủ đề sẽ dạy' : 'Trường học đủ các chủ đề'} · {track.school_arrange_ppct !== false ? 'trường tự xếp PPCT theo tuần' : 'PPCT theo mẫu KDI / Sở'} · {SCHEDULE_MODE_NAME[track.schedule_mode ?? 'timetable']}.
      {' '}Thứ tự học phần và chủ đề do KDI quy định. Đổi thiết lập ở Danh mục → Loại chương trình.</p>}
    {msg && <p className="msg" role="status">{msg}</p>}
    {view === 'modules'
      ? <DataTable id="program-modules" rows={mods} rowKey={m => m.id} cols={cols} simple onRow={m => { setMsg(''); setOpenId(m.id) }}
        empty={`Loại ${track?.code ?? ''} chưa có học phần.`} />
      : <>
        <div className="bar"><label className="field inline"><span>Khối</span>
          <select value={g ?? ''} onChange={e => setGrade(Number(e.target.value))} aria-label="Khối">
            {!grades.length && <option value="">Chưa có chủ đề</option>}
            {grades.map(x => <option key={x} value={x}>{gradeName(x)}</option>)}</select></label>
          {g !== null && <small className="sub">{trackTopics.filter(t => t.grade === g).length} chủ đề · {sum(trackTopics.filter(t => t.grade === g))} tiết</small>}</div>
        {g !== null && mods.map(m => {
          const list = topicsOf(m.id).filter(t => t.grade === g)
          if (!list.length) return null
          return <div key={m.id} className="panel pdcard" style={{ marginBottom: 12 }}>
            <h4 style={{ marginTop: 0 }}>{m.sort}. {m.name} <small className="sub">· {list.length} chủ đề · {sum(list)} tiết</small></h4>
            <TopicTable list={list} track={track} admin={admin} onEdit={t => setEditTopic(t)} onDel={delTopic} />
          </div>
        })}
      </>}
    <p className="tablenote sub">Học phần dùng chung cho các gói STEM và các khối; gói nào dùng học phần nào chọn ở tab Gói STEM. Nội dung của từng chủ đề (kế hoạch giảng dạy, bài giảng, phiếu học tập, bài kiểm tra, vật tư, kho học liệu) và phiên bản làm ở bước tiếp theo.</p>
  </>
}

function TopicTable({ list, track, admin, onEdit, onDel }: { list: ProgramTopic[]; track?: StemTrack; admin: boolean; onEdit: (t: ProgramTopic) => void; onDel: (t: ProgramTopic) => void }) {
  const sgk = track?.schedule_mode === 'subject'
  return <table className="table">
    <thead><tr><th className="c-no">TT</th><th>Mã</th><th>Chủ đề</th><th>Số tiết</th><th>Môn chủ trì</th><th>Môn phối hợp</th>{sgk && <th>Bài SGK liên quan</th>}<th>Trạng thái</th>{admin && <th />}</tr></thead>
    <tbody>{list.map(t => <tr key={t.id}>
      <td>{t.seq}</td><td>{t.code || '—'}</td>
      <td><b>{t.title}</b>{t.objectives && <div className="sub" style={{ whiteSpace: 'pre-line' }}>{t.objectives}</div>}</td>
      <td>{t.periods}</td><td>{t.main_subject || '—'}</td><td>{t.subjects.join(', ') || '—'}</td>{sgk && <td>{t.textbook_ref || '—'}</td>}
      <td>{pill(t.active)}</td>
      {admin && <td style={{ whiteSpace: 'nowrap' }}><button type="button" className="ghostbtn" onClick={() => onEdit(t)}>Sửa</button>
        <button type="button" className="ghostbtn" onClick={() => onDel(t)}>Xoá</button></td>}
    </tr>)}</tbody>
  </table>
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
      objectives: f.objectives, main_subject: f.main_subject, subjects: f.subjects, textbook_ref: f.textbook_ref, active: f.active }
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
      <label className="field"><span>Trạng thái</span><select value={f.active ? 'on' : 'off'} onChange={e => setF({ ...f, active: e.target.value === 'on' })}>
        <option value="on">Đang dùng</option><option value="off">Ngừng dùng</option></select></label>
      {track?.schedule_mode === 'subject' && <label className="field wide"><span>Bài SGK liên quan / được thay</span>
        <input value={f.textbook_ref} onChange={e => setF({ ...f, textbook_ref: e.target.value })} placeholder="VD: Toán 1 – Bài 12: Hình vuông, hình tròn" /></label>}
      <label className="field wide"><span>Mục tiêu, yêu cầu cần đạt</span><textarea rows={3} value={f.objectives} onChange={e => setF({ ...f, objectives: e.target.value })} /></label>
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
    { key: 'name', label: 'Nhóm vật tư', fixed: true, thClass: 'c-ttl', text: g => g.name, cell: g => <b>{g.name}</b> },
    { key: 'desc', label: 'Mô tả', text: g => g.description, cell: g => g.description || <small className="sub">—</small> },
    { key: 'st', label: 'Trạng thái', text: g => g.active ? 'Đang dùng' : 'Ngừng dùng', cell: g => pill(g.active) },
  ]
  return <>
    {admin && <HeadAction><button type="button" className="primary ttadd"
      onClick={() => setEdit({ id: '', name: '', description: '', sort: rows.reduce((x, g) => Math.max(x, g.sort), 0) + 1, active: true })}>+ Thêm nhóm vật tư</button></HeadAction>}
    {msg && <p className="msg" role="status">{msg}</p>}
    <DataTable id="material-groups" rows={rows} rowKey={g => g.id} cols={cols} simple onRow={admin ? g => setEdit(g) : undefined} empty="Chưa có nhóm vật tư." />
    <p className="tablenote sub">Nhóm vật tư dùng để chia vật tư, thiết bị của mỗi chủ đề (VD: Nhóm 1, Nhóm 2, Nhóm 3 hoặc theo loại). {admin ? 'Bấm một dòng để sửa.' : 'Chỉ quản trị nền tảng KDI sửa được danh mục này.'}</p>
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
