import { useEffect, useState } from 'react'
import { MultiSelect } from '../components/MultiSelect'
import { SubjectMulti } from '../components/Pickers'
import { supabase } from '../lib/supabase'
import { PROGRAM_COLOR } from './teacher/common'
import { useEduLevels } from '../lib/eduLevels'
import { ElView } from '../components/ElView'
import { DataTable, type Col } from '../components/DataTable'
import { HeadAction } from '../components/PageFrame'
import { DetailHead } from '../components/DetailHead'
import { ActionBar, type Act } from '../components/ActionBar'
import { EDU_ACTIVITIES, EDU_ACTIVITY_NAME, SCHEDULE_MODES, SCHEDULE_MODE_NAME, STEM_LEVELS, STEM_LEVEL_NAME, useStemTracks, type EduActivity, type ScheduleMode, type StemLevel, type StemTrack, trackLabel } from '../lib/stemTracks'

// Danh mục loại chương trình (migration 062, 064, 147): CT1–CT4; KDI thêm loại mới, sửa tên, mô tả, môn học,
// cấp học áp dụng, ngừng dùng hoặc xoá loại chưa được dùng; đơn vị khác xem. Kèm các chương trình giáo dục đang ban hành của từng loại.
type Prog = { id: string; code: string | null; title: string; ct_code: string; level: string; version_no: number }
export const trackErr = (m: string) => (/stem_tracks_label_uq|duplicate key.*label/i.test(m) ? 'Mã hiển thị này đã có loại chương trình khác dùng.'
  : /stem_tracks_label_check/i.test(m) ? 'Mã hiển thị tối đa 12 ký tự.'
  : /schema cache|does not exist|column .*(sort|active|form|schedule_mode|school_|label)/i.test(m) ? 'Hãy chạy migration 147–155 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Chỉ quản trị nền tảng KDI sửa được danh mục này.'
  : /23503|foreign key/i.test(m) ? 'Loại này đang được chương trình, bài giảng, học liệu hoặc lớp dùng — hãy chuyển sang "Ngừng dùng".'
  : /23505|duplicate/i.test(m) ? 'Mã loại đã có.'
  : /stem_tracks_code_check/i.test(m) ? 'Mã gồm 2–12 ký tự: chữ in hoa, số, "-" hoặc "_", bắt đầu bằng chữ (vd. CT5).' : m)
export const BLANK_TRACK: StemTrack = { code: '', name: '', title: '', description: '', subjects: [], levels: [], sort: 0, active: true,
  form: '', edu_activity: '', teachers: '', audience: '', duration: '', notes: '', school_pick_topics: false, school_arrange_ppct: true, schedule_mode: 'timetable', use_modules: true }
const yesNo = (v: boolean | undefined) => v ? 'Được' : 'Không'
/** Thiết lập KDI cấu hình cho trường (147) — dùng chung ở chi tiết và danh sách */
const settingsOf = (t: StemTrack) => [
  t.use_modules === false ? 'Chỉ có chủ đề' : 'Chia học phần',
  t.school_pick_topics ? 'Trường tự chọn chủ đề' : 'Học đủ chủ đề',
  t.school_arrange_ppct !== false ? 'Trường tự xếp PPCT' : 'PPCT theo KDI / Sở',
  SCHEDULE_MODE_NAME[t.schedule_mode ?? 'timetable'],
]

export function StemTracksCatalog() {
  const { tracks, reload } = useStemTracks()
  const { name: levelName } = useEduLevels()
  const [admin, setAdmin] = useState(false)
  const [progs, setProgs] = useState<Prog[]>([])
  const [edit, setEdit] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  async function remove(t: StemTrack) {
    if (!confirm(`Xoá loại chương trình ${t.code} · ${t.name}? Chỉ xoá được khi chưa có chương trình, bài giảng, học liệu hay lớp nào dùng.`)) return
    const { data, error } = await supabase.from('stem_tracks').delete().eq('code', t.code).select('code')
    if (error) return setMsg(trackErr(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return setMsg(trackErr('row-level'))
    setMsg(''); setOpen(null); reload()
  }
  useEffect(() => {
    supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data))
    supabase.from('edu_programs').select('id, code, title, ct_code, level, version_no').eq('kind', 'stem').eq('status', 'published').order('code')
      .then(({ data }) => setProgs((data ?? []) as Prog[]))
  }, [])
  if (edit !== null) {
    const t = tracks.find(x => x.code === edit)
    const done = () => { setEdit(null); reload() }
    return <ElView back={open ? 'Chi tiết loại chương trình' : 'Loại chương trình'} onBack={() => setEdit(null)}
      title={t ? <><span className="progchip" style={{ background: PROGRAM_COLOR[t.code], color: '#fff' }}>{trackLabel(t.code)}</span> Sửa loại chương trình</> : 'Thêm loại chương trình'}>
      {t ? <TrackForm key={t.code} t={t} onCancel={() => setEdit(null)} onSaved={done} />
        : <TrackForm t={{ ...BLANK_TRACK, sort: tracks.reduce((m, x) => Math.max(m, x.sort ?? 0), 0) + 1 }} isNew onCancel={() => setEdit(null)} onSaved={done} />}
    </ElView>
  }
  const cur = open ? tracks.find(x => x.code === open) : undefined
  if (cur) {
    const list = progs.filter(p => p.ct_code === cur.code)
    const acts: Act[] = admin ? [
      { key: 'edit', label: 'Sửa', icon: 'pencil', onClick: () => { setMsg(''); setEdit(cur.code) } },
      { key: 'del', label: 'Xoá', icon: 'trash', kind: 'danger', onClick: () => remove(cur) },
    ] : []
    return <>
      <DetailHead back="Loại chương trình" onBack={() => { setOpen(null); setMsg('') }}
        title={<><span className="progchip" style={{ background: PROGRAM_COLOR[cur.code], color: '#fff' }}>{trackLabel(cur.code)}</span> {cur.title}</>}
        extra={<span className={'pill ' + (cur.active === false ? 'inactive' : 'good')}>{cur.active === false ? 'Ngừng dùng' : 'Đang dùng'}</span>} />
      <div className="bar"><small className="sub">{cur.name}</small>{acts.length > 0 && <div className="tools"><ActionBar items={acts} /></div>}</div>
      {msg && <p className="msg" role="status">{msg}</p>}
      <div className="pdsub pdgrid">
        <div className="pdmain">
          <div className="panel pdcard"><h4>Thông tin triển khai</h4>
            <dl className="pddl">
              <dt>Giáo viên dạy</dt><dd>{cur.teachers || '—'}</dd>
              <dt>Đối tượng học sinh</dt><dd>{cur.audience || '—'}</dd>
              <dt>Thời lượng</dt><dd>{cur.duration || '—'}</dd>
            </dl>
            {cur.notes && <><h5 style={{ margin: '10px 0 4px' }}>Ghi chú, căn cứ</h5><p style={{ margin: 0, whiteSpace: 'pre-line' }}>{cur.notes}</p></>}
          </div>
          <div className="panel pdcard"><h4>Chương trình giáo dục đang ban hành ({list.length})</h4>
            {list.length ? <table className="table"><thead><tr><th>Chương trình</th><th>Mã</th><th>Cấp học</th><th>Phiên bản</th></tr></thead>
              <tbody>{list.map(p => <tr key={p.id}><td>{p.title}</td><td>{p.code ?? '—'}</td><td>{levelName(p.level)}</td><td>v{p.version_no}</td></tr>)}</tbody></table>
              : <small className="sub">Chưa có. Tạo ở tab "Chương trình", chọn loại {cur.code}.</small>}
          </div>
        </div>
        <div className="pdside">
          <div className="panel pdcard"><h4>Thông tin chung</h4>
            <dl className="pddl sm">
              <dt>Mã hiển thị</dt><dd>{trackLabel(cur.code)}{cur.label?.trim() ? <small className="sub"> · mã gốc {cur.code}</small> : null}</dd>
              <dt>Tên ngắn</dt><dd>{cur.name || '—'}</dd>
              <dt>Thứ tự</dt><dd>{cur.sort ?? 0}</dd>
              <dt>Cấp học</dt><dd>{cur.levels.length ? cur.levels.map(l => STEM_LEVEL_NAME[l]).join(', ') : 'Chưa chọn'}</dd>
              <dt>Hình thức</dt><dd>{cur.form || '—'}</dd>
              <dt>Hoạt động giáo dục</dt><dd>{cur.edu_activity ? EDU_ACTIVITY_NAME[cur.edu_activity] : '—'}</dd>
            </dl>
          </div>
          <div className="panel pdcard"><h4>Thiết lập cho trường</h4>
            <dl className="pddl sm">
              <dt>Chia theo học phần</dt><dd>{cur.use_modules === false ? 'Không (chỉ có chủ đề)' : 'Có'}</dd>
              <dt>Trường tự chọn chủ đề</dt><dd>{yesNo(cur.school_pick_topics)}</dd>
              <dt>Trường tự xếp PPCT</dt><dd>{yesNo(cur.school_arrange_ppct !== false)}</dd>
              <dt>Cách xếp lịch</dt><dd>{SCHEDULE_MODE_NAME[cur.schedule_mode ?? 'timetable']}</dd>
            </dl>
            <small className="sub">Thứ tự học phần và chủ đề do KDI quy định, trường không đổi được.</small>
          </div>
          <div className="panel pdcard"><h4>Mô tả</h4>{cur.description ? <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{cur.description}</p> : <small className="sub">Chưa có</small>}</div>
          <div className="panel pdcard"><h4>Môn học ({cur.subjects.length})</h4>
            <div>{cur.subjects.length ? cur.subjects.map(x => <span key={x} className="chip" style={{ paddingRight: 12 }}>{x}</span>) : <small className="sub">Chưa có</small>}</div></div>
        </div>
      </div>
    </>
  }
  const cols: Col<StemTrack>[] = [
    { key: 'code', label: 'Mã', fixed: true, thClass: 'c-no c-code', text: t => trackLabel(t.code), cell: t => <span className="progchip" style={{ background: PROGRAM_COLOR[t.code], color: '#fff' }}>{trackLabel(t.code)}</span> },
    { key: 'title', label: 'Loại chương trình', fixed: true, thClass: 'c-ttl', text: t => t.title + ' ' + t.name, cell: t => <><b>{t.title}</b>{t.name && t.name.trim() !== t.title.trim() && <span className="sub"> · {t.name}</span>}</> },
    { key: 'desc', label: 'Mô tả', off: true, text: t => t.description ?? '', cell: t => t.description || <small className="sub">—</small> },
    { key: 'subj', label: 'Môn học', text: t => t.subjects.join(', '), values: t => t.subjects, cell: t => t.subjects.length ? t.subjects.join(', ') : <small className="sub">Chưa có</small> },
    { key: 'lv', label: 'Cấp học', text: t => t.levels.map(l => STEM_LEVEL_NAME[l]).join(', '), values: t => t.levels.map(l => STEM_LEVEL_NAME[l]),
      cell: t => t.levels.length ? t.levels.map(l => STEM_LEVEL_NAME[l]).join(', ') : <small className="sub">Chưa chọn</small> },
    { key: 'act', label: 'Hoạt động GD', text: t => t.edu_activity ? EDU_ACTIVITY_NAME[t.edu_activity] : '', values: t => [t.edu_activity ? EDU_ACTIVITY_NAME[t.edu_activity] : 'Chưa chọn'],
      cell: t => t.edu_activity ? EDU_ACTIVITY_NAME[t.edu_activity] : <small className="sub">—</small> },
    { key: 'set', label: 'Thiết lập cho trường', text: t => settingsOf(t).join(', '), cell: t => <small>{settingsOf(t).join(' · ')}</small> },
    { key: 'progs', label: 'CT đang ban hành', off: true, text: t => String(progs.filter(p => p.ct_code === t.code).length), cell: t => {
      const list = progs.filter(p => p.ct_code === t.code)
      return list.length ? <span title={list.map(p => `${p.title} · ${levelName(p.level)} · v${p.version_no}`).join('\n')}>{list.length} chương trình</span> : <small className="sub">Chưa có</small> } },
    { key: 'st', label: 'Trạng thái', text: t => t.active === false ? 'Ngừng dùng' : 'Đang dùng', values: t => [t.active === false ? 'Ngừng dùng' : 'Đang dùng'],
      cell: t => <span className={'pill ' + (t.active === false ? 'inactive' : 'good')}>{t.active === false ? 'Ngừng dùng' : 'Đang dùng'}</span> },
  ]
  return (
    <>
      {admin && <HeadAction><button type="button" className="primary ttadd" onClick={() => { setMsg(''); setEdit('') }}>+ Thêm loại chương trình</button></HeadAction>}
      {msg && <p className="msg" role="status">{msg}</p>}
      <DataTable fit id="stem-tracks" className="trktbl" rows={tracks} rowKey={t => t.code} cols={cols} simple
        onRow={t => { setMsg(''); setOpen(t.code) }}
        empty="Chưa có loại chương trình nào." />
      <p className="tablenote sub">{admin ? 'Bấm một dòng để xem chi tiết, sửa hoặc xoá. Loại đã được dùng thì không xoá được, chỉ chuyển sang "Ngừng dùng".' : 'Chỉ quản trị nền tảng KDI sửa được danh mục này.'} Học phần và chủ đề của từng loại soạn ở tab "Khung chương trình".</p>
    </>
  )
}

export function TrackForm({ t, isNew = false, onCancel, onSaved }: { t: StemTrack; isNew?: boolean; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState<StemTrack>({ ...t, subjects: [...t.subjects], levels: [...t.levels] })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const toggle = (l: StemLevel) => setF({ ...f, levels: f.levels.includes(l) ? f.levels.filter(x => x !== l) : [...f.levels, l] })
  async function save() {
    if (!f.name.trim() || !f.title.trim()) return setErr('Nhập tên và tên đầy đủ.')
    const code = f.code.trim().toUpperCase()
    if (isNew && !/^[A-Z][A-Z0-9_-]{1,11}$/.test(code)) return setErr(trackErr('stem_tracks_code_check'))
    setBusy(true); setErr('')
    const row = { label: (f.label ?? '').trim(), name: f.name, title: f.title, description: f.description, subjects: f.subjects, levels: f.levels, sort: Number(f.sort) || 0, active: f.active !== false,
      form: f.form ?? '', edu_activity: f.edu_activity ?? '', teachers: f.teachers ?? '', audience: f.audience ?? '', duration: f.duration ?? '', notes: f.notes ?? '',
      use_modules: f.use_modules !== false, school_pick_topics: !!f.school_pick_topics, school_arrange_ppct: f.school_arrange_ppct !== false, schedule_mode: f.schedule_mode ?? 'timetable' }
    const { data, error } = isNew
      ? await supabase.from('stem_tracks').insert({ ...row, code }).select('code')
      : await supabase.from('stem_tracks').update(row).eq('code', t.code).select('code')
    setBusy(false)
    if (error) return setErr(trackErr(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return setErr(trackErr('row-level'))
    onSaved()
  }
  return (
    <section className="panel">
      <div className="formgrid">
        {isNew && <label className="field"><span>Mã loại *</span><input value={f.code} maxLength={12} placeholder="VD: CT6" onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} /></label>}
        <label className="field"><span>Mã hiển thị</span><input value={f.label ?? ''} maxLength={12} placeholder={isNew ? 'Để trống = dùng mã loại' : `Để trống = ${t.code}`}
          title={'Mã hiện trên mọi màn hình.' + (isNew ? '' : ` Mã gốc ${t.code} giữ nguyên để nối dữ liệu.`)}
          onChange={e => setF({ ...f, label: e.target.value })} /></label>
        <label className="field"><span>Thứ tự hiển thị</span><input type="number" min={0} value={f.sort ?? 0} onChange={e => setF({ ...f, sort: Number(e.target.value) })} /></label>
        <label className="field"><span>Trạng thái</span><select value={f.active === false ? 'off' : 'on'} onChange={e => setF({ ...f, active: e.target.value === 'on' })}>
          <option value="on">Đang dùng</option><option value="off">Ngừng dùng (không chọn được khi soạn mới)</option></select></label>
        <label className="field"><span>Tên ngắn (hiện trên thẻ)</span><input value={f.name} maxLength={80} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Tên đầy đủ</span><input value={f.title} maxLength={160} onChange={e => setF({ ...f, title: e.target.value })} /></label>
        <label className="field wide"><span>Mô tả</span><textarea rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
        <label className="field"><span>Hình thức</span><input value={f.form ?? ''} maxLength={120} placeholder="VD: Trải nghiệm STEM" onChange={e => setF({ ...f, form: e.target.value })} /></label>
        <label className="field"><span>Hoạt động giáo dục</span><select value={f.edu_activity ?? ''} onChange={e => setF({ ...f, edu_activity: e.target.value as EduActivity })}>
          {EDU_ACTIVITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field wide"><span>Giáo viên dạy</span><input value={f.teachers ?? ''} onChange={e => setF({ ...f, teachers: e.target.value })} /></label>
        <label className="field wide"><span>Đối tượng học sinh</span><input value={f.audience ?? ''} onChange={e => setF({ ...f, audience: e.target.value })} /></label>
        <label className="field wide"><span>Thời lượng</span><textarea rows={2} value={f.duration ?? ''} onChange={e => setF({ ...f, duration: e.target.value })} /></label>
        <label className="field wide"><span>Ghi chú, căn cứ</span><textarea rows={3} value={f.notes ?? ''} onChange={e => setF({ ...f, notes: e.target.value })} /></label>
      </div>
      <fieldset className="panel" style={{ marginTop: 12 }}><legend>Cấu trúc</legend>
        <label className="field inline"><input type="checkbox" checked={f.use_modules !== false} onChange={e => setF({ ...f, use_modules: e.target.checked })} /> Chương trình chia theo học phần (tắt: chỉ có chủ đề theo khối, không hiện học phần)</label>
      </fieldset>
      <fieldset className="panel" style={{ marginTop: 12 }}><legend>Thiết lập cho trường</legend>
        <label className="field inline"><input type="checkbox" checked={!!f.school_pick_topics} onChange={e => setF({ ...f, school_pick_topics: e.target.checked })} /> Trường được tự chọn chủ đề sẽ dạy (KDI chỉ tư vấn)</label>
        <label className="field inline"><input type="checkbox" checked={f.school_arrange_ppct !== false} onChange={e => setF({ ...f, school_arrange_ppct: e.target.checked })} /> Trường được tự xếp phân phối chương trình (theo tuần)</label>
        <label className="field" style={{ maxWidth: 420 }}><span>Cách xếp lịch</span><select value={f.schedule_mode ?? 'timetable'} onChange={e => setF({ ...f, schedule_mode: e.target.value as ScheduleMode })}>
          {SCHEDULE_MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <small className="sub">Dù bật hay tắt, trường không đổi được thứ tự học phần và chủ đề.</small>
      </fieldset>
      <div className="field" style={{ marginTop: 12 }}><span className="sub">Các môn học trong chương trình</span>
        <SubjectMulti value={f.subjects} onChange={v => setF({ ...f, subjects: v })} placeholder="Chọn môn từ danh mục Môn học…" ariaLabel="Các môn học trong chương trình" /></div>
      <div className="field" style={{ marginTop: 12, maxWidth: 560 }}><span className="sub">Cấp học áp dụng</span>
        <MultiSelect value={f.levels} onChange={v => setF({ ...f, levels: v as StemLevel[] })} options={STEM_LEVELS.map(([k, l]) => [k, l])} placeholder="Chọn cấp học…" ariaLabel="Cấp học áp dụng" /></div>
      {err && <p className="warnline">{err}</p>}
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="primary" onClick={save} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
        <button onClick={onCancel} disabled={busy}>Huỷ</button>
      </div>
    </section>
  )
}
