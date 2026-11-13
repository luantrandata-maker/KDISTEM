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
import { STEM_LEVELS, STEM_LEVEL_NAME, useStemTracks, type StemLevel, type StemTrack } from '../lib/stemTracks'

// Danh mục loại chương trình (migration 062, 064): CT1–CT5 ban đầu; KDI thêm loại mới, sửa tên, mô tả, môn học,
// cấp học áp dụng, ngừng dùng hoặc xoá loại chưa được dùng; đơn vị khác xem. Kèm các chương trình giáo dục đang ban hành của từng loại.
type Prog = { id: string; code: string | null; title: string; ct_code: string; level: string; version_no: number }
const errText = (m: string) => (/schema cache|does not exist|column .*(sort|active)/i.test(m) ? 'Hãy chạy migration 064 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Chỉ quản trị nền tảng KDI sửa được danh mục này.'
  : /23503|foreign key/i.test(m) ? 'Loại này đang được chương trình, bài giảng, học liệu hoặc lớp dùng — hãy chuyển sang "Ngừng dùng".'
  : /23505|duplicate/i.test(m) ? 'Mã loại đã có.'
  : /stem_tracks_code_check/i.test(m) ? 'Mã gồm 2–12 ký tự: chữ in hoa, số, "-" hoặc "_", bắt đầu bằng chữ (vd. CT6).' : m)
const BLANK: StemTrack = { code: '', name: '', title: '', description: '', subjects: [], levels: [], sort: 0, active: true }

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
    if (error) return setMsg(errText(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return setMsg(errText('row-level'))
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
    return <ElView back={open ? 'Chi tiết nhóm chương trình' : 'Nhóm chương trình'} onBack={() => setEdit(null)}
      title={t ? <><span className="progchip" style={{ background: PROGRAM_COLOR[t.code], color: '#fff' }}>{t.code}</span> Sửa loại chương trình</> : 'Thêm loại chương trình'}>
      {t ? <TrackForm key={t.code} t={t} onCancel={() => setEdit(null)} onSaved={done} />
        : <TrackForm t={{ ...BLANK, sort: tracks.reduce((m, x) => Math.max(m, x.sort ?? 0), 0) + 1 }} isNew onCancel={() => setEdit(null)} onSaved={done} />}
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
      <DetailHead back="Nhóm chương trình" onBack={() => { setOpen(null); setMsg('') }}
        title={<><span className="progchip" style={{ background: PROGRAM_COLOR[cur.code], color: '#fff' }}>{cur.code}</span> {cur.title}</>}
        extra={<span className={'pill ' + (cur.active === false ? 'inactive' : 'good')}>{cur.active === false ? 'Ngừng dùng' : 'Đang dùng'}</span>} />
      <div className="bar"><small className="sub">{cur.name}</small>{acts.length > 0 && <div className="tools"><ActionBar items={acts} /></div>}</div>
      {msg && <p className="msg" role="status">{msg}</p>}
      <div className="pdsub pdgrid">
        <div className="pdmain">
          <div className="panel pdcard"><h4>Chương trình giáo dục đang ban hành ({list.length})</h4>
            {list.length ? <table className="table"><thead><tr><th>Chương trình</th><th>Mã</th><th>Cấp học</th><th>Phiên bản</th></tr></thead>
              <tbody>{list.map(p => <tr key={p.id}><td>{p.title}</td><td>{p.code ?? '—'}</td><td>{levelName(p.level)}</td><td>v{p.version_no}</td></tr>)}</tbody></table>
              : <small className="sub">Chưa có. Tạo ở tab "Chương trình", chọn nhóm {cur.code}.</small>}
          </div>
        </div>
        <div className="pdside">
          <div className="panel pdcard"><h4>Thông tin chung</h4>
            <dl className="pddl sm">
              <dt>Mã</dt><dd>{cur.code}</dd>
              <dt>Tên ngắn</dt><dd>{cur.name || '—'}</dd>
              <dt>Thứ tự</dt><dd>{cur.sort ?? 0}</dd>
              <dt>Cấp học</dt><dd>{cur.levels.length ? cur.levels.map(l => STEM_LEVEL_NAME[l]).join(', ') : 'Chưa chọn'}</dd>
            </dl>
          </div>
          <div className="panel pdcard"><h4>Mô tả</h4>{cur.description ? <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{cur.description}</p> : <small className="sub">Chưa có</small>}</div>
          <div className="panel pdcard"><h4>Môn học ({cur.subjects.length})</h4>
            <div>{cur.subjects.length ? cur.subjects.map(x => <span key={x} className="chip" style={{ paddingRight: 12 }}>{x}</span>) : <small className="sub">Chưa có</small>}</div></div>
        </div>
      </div>
    </>
  }
  const cols: Col<StemTrack>[] = [
    { key: 'code', label: 'Mã', fixed: true, thClass: 'c-no c-code', text: t => t.code, cell: t => <span className="progchip" style={{ background: PROGRAM_COLOR[t.code], color: '#fff' }}>{t.code}</span> },
    { key: 'title', label: 'Loại chương trình', fixed: true, thClass: 'c-ttl', text: t => t.title + ' ' + t.name, cell: t => <><b>{t.title}</b><div className="sub">{t.name}</div></> },
    { key: 'desc', label: 'Mô tả', off: true, text: t => t.description ?? '', cell: t => t.description || <small className="sub">—</small> },
    { key: 'subj', label: 'Môn học', text: t => t.subjects.join(', '), values: t => t.subjects, cell: t => t.subjects.length ? t.subjects.join(', ') : <small className="sub">Chưa có</small> },
    { key: 'lv', label: 'Cấp học', text: t => t.levels.map(l => STEM_LEVEL_NAME[l]).join(', '), values: t => t.levels.map(l => STEM_LEVEL_NAME[l]),
      cell: t => t.levels.length ? t.levels.map(l => STEM_LEVEL_NAME[l]).join(', ') : <small className="sub">Chưa chọn</small> },
    { key: 'progs', label: 'CT đang ban hành', text: t => String(progs.filter(p => p.ct_code === t.code).length), cell: t => {
      const list = progs.filter(p => p.ct_code === t.code)
      return list.length ? <span title={list.map(p => `${p.title} · ${levelName(p.level)} · v${p.version_no}`).join('\n')}>{list.length} chương trình</span> : <small className="sub">Chưa có</small> } },
    { key: 'st', label: 'Trạng thái', text: t => t.active === false ? 'Ngừng dùng' : 'Đang dùng', values: t => [t.active === false ? 'Ngừng dùng' : 'Đang dùng'],
      cell: t => <span className={'pill ' + (t.active === false ? 'inactive' : 'good')}>{t.active === false ? 'Ngừng dùng' : 'Đang dùng'}</span> },
  ]
  return (
    <>
      {admin && <HeadAction><button type="button" className="primary ttadd" onClick={() => { setMsg(''); setEdit('') }}>+ Thêm loại chương trình</button></HeadAction>}
      {msg && <p className="msg" role="status">{msg}</p>}
      <DataTable id="stem-tracks" className="trktbl" rows={tracks} rowKey={t => t.code} cols={cols} simple
        onRow={t => { setMsg(''); setOpen(t.code) }}
        empty="Chưa có loại chương trình nào." />
      <p className="tablenote sub">{admin ? 'Bấm một dòng để xem chi tiết, sửa hoặc xoá. Loại đã được dùng thì không xoá được, chỉ chuyển sang "Ngừng dùng".' : 'Chỉ quản trị nền tảng KDI sửa được danh mục này.'} Học phần và yêu cầu cần đạt nằm trong từng chương trình giáo dục.</p>
    </>
  )
}

function TrackForm({ t, isNew = false, onCancel, onSaved }: { t: StemTrack; isNew?: boolean; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState<StemTrack>({ ...t, subjects: [...t.subjects], levels: [...t.levels] })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const toggle = (l: StemLevel) => setF({ ...f, levels: f.levels.includes(l) ? f.levels.filter(x => x !== l) : [...f.levels, l] })
  async function save() {
    if (!f.name.trim() || !f.title.trim()) return setErr('Nhập tên và tên đầy đủ.')
    const code = f.code.trim().toUpperCase()
    if (isNew && !/^[A-Z][A-Z0-9_-]{1,11}$/.test(code)) return setErr(errText('stem_tracks_code_check'))
    setBusy(true); setErr('')
    const row = { name: f.name, title: f.title, description: f.description, subjects: f.subjects, levels: f.levels, sort: Number(f.sort) || 0, active: f.active !== false }
    const { data, error } = isNew
      ? await supabase.from('stem_tracks').insert({ ...row, code }).select('code')
      : await supabase.from('stem_tracks').update(row).eq('code', t.code).select('code')
    setBusy(false)
    if (error) return setErr(errText(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return setErr(errText('row-level'))
    onSaved()
  }
  return (
    <section className="panel">
      <div className="formgrid">
        {isNew && <label className="field"><span>Mã loại *</span><input value={f.code} maxLength={12} placeholder="VD: CT6" onChange={e => setF({ ...f, code: e.target.value.toUpperCase() })} /></label>}
        <label className="field"><span>Thứ tự hiển thị</span><input type="number" min={0} value={f.sort ?? 0} onChange={e => setF({ ...f, sort: Number(e.target.value) })} /></label>
        <label className="field"><span>Trạng thái</span><select value={f.active === false ? 'off' : 'on'} onChange={e => setF({ ...f, active: e.target.value === 'on' })}>
          <option value="on">Đang dùng</option><option value="off">Ngừng dùng (không chọn được khi soạn mới)</option></select></label>
        <label className="field"><span>Tên ngắn (hiện trên thẻ)</span><input value={f.name} maxLength={80} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="field"><span>Tên đầy đủ</span><input value={f.title} maxLength={160} onChange={e => setF({ ...f, title: e.target.value })} /></label>
        <label className="field wide"><span>Mô tả</span><textarea rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
      </div>
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
