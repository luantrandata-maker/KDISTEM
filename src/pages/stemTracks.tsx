import { useEffect, useState } from 'react'
import { MultiSelect } from '../components/MultiSelect'
import { supabase } from '../lib/supabase'
import { PROGRAM_COLOR } from './teacher/common'
import { useEduLevels } from '../lib/eduLevels'
import { ElView } from '../components/ElView'
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
  const [msg, setMsg] = useState('')
  async function remove(t: StemTrack) {
    if (!confirm(`Xoá loại chương trình ${t.code} · ${t.name}? Chỉ xoá được khi chưa có chương trình, bài giảng, học liệu hay lớp nào dùng.`)) return
    const { data, error } = await supabase.from('stem_tracks').delete().eq('code', t.code).select('code')
    if (error) return setMsg(errText(error.message + ' ' + (error.code ?? '')))
    if (!data?.length) return setMsg(errText('row-level'))
    setMsg(''); reload()
  }
  useEffect(() => {
    supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data))
    supabase.from('edu_programs').select('id, code, title, ct_code, level, version_no').eq('kind', 'stem').eq('status', 'published').order('code')
      .then(({ data }) => setProgs((data ?? []) as Prog[]))
  }, [])
  if (edit !== null) {
    const t = tracks.find(x => x.code === edit)
    const done = () => { setEdit(null); reload() }
    return <ElView back="Nhóm chương trình" onBack={() => setEdit(null)}
      title={t ? <><span className="progchip" style={{ background: PROGRAM_COLOR[t.code], color: '#fff' }}>{t.code}</span> Sửa loại chương trình</> : 'Thêm loại chương trình'}>
      {t ? <TrackForm key={t.code} t={t} onCancel={() => setEdit(null)} onSaved={done} />
        : <TrackForm t={{ ...BLANK, sort: tracks.reduce((m, x) => Math.max(m, x.sort ?? 0), 0) + 1 }} isNew onCancel={() => setEdit(null)} onSaved={done} />}
    </ElView>
  }
  return (
    <>
      <div className="bar">
        <p className="sub" style={{ margin: 0 }}>Loại chương trình STEM của KDI (CT1–CT5 và các loại thêm sau): tên, mô tả, môn học và cấp học áp dụng. {admin
          ? 'Bấm "Sửa" để điều chỉnh; thay đổi hiện ngay ở mọi màn chọn loại chương trình. Loại đã được dùng thì không xoá, chỉ ngừng dùng.'
          : 'Chỉ quản trị nền tảng KDI sửa được danh mục này.'} Nội dung chi tiết (học phần, yêu cầu cần đạt) nằm trong từng chương trình giáo dục bên dưới mỗi loại.</p>
        {admin && <button className="primary" onClick={() => { setMsg(''); setEdit('') }}>Thêm loại chương trình</button>}
      </div>
      {msg && <p className="msg" role="status">{msg}</p>}
      {tracks.map(t => {
        const list = progs.filter(p => p.ct_code === t.code)
        return (
            <section key={t.code} className="panel">
              <div className="bar" style={{ margin: 0 }}>
                <h3 style={{ margin: 0 }}><span className="progchip" style={{ background: PROGRAM_COLOR[t.code], color: '#fff' }}>{t.code}</span> {t.title}
                  <small className="sub" style={{ marginLeft: 8 }}>{t.name}</small>{t.active === false && <span className="pill" style={{ marginLeft: 8 }}>Ngừng dùng</span>}</h3>
                {admin && <div className="tools">
                  <button onClick={() => { setMsg(''); setEdit(t.code) }}>Sửa</button>
                  <button className="danger" onClick={() => remove(t)}>Xoá</button>
                </div>}
              </div>
              {t.description && <p style={{ margin: '6px 0 10px' }}>{t.description}</p>}
              <div className="sub" style={{ margin: '0 0 4px' }}>Các môn học trong chương trình</div>
              <div>{t.subjects.length ? t.subjects.map(s => <span key={s} className="chip" style={{ paddingRight: 12 }}>{s}</span>) : <small className="sub">Chưa có</small>}</div>
              <div className="sub" style={{ margin: '10px 0 4px' }}>Cấp học áp dụng</div>
              <div>{t.levels.length ? t.levels.map(l => <span key={l} className="pill" style={{ marginRight: 6 }}>{STEM_LEVEL_NAME[l]}</span>) : <small className="sub">Chưa chọn</small>}</div>
              <div className="sub" style={{ margin: '10px 0 4px' }}>Chương trình giáo dục đang ban hành ({list.length})</div>
              <div>{list.length ? list.map(p => <span key={p.id} className="chip" style={{ paddingRight: 12 }}>{p.title} · {levelName(p.level)} · v{p.version_no}</span>)
                : <small className="sub">Chưa có — tạo ở tab "Chương trình giáo dục", chọn kiểu "Chương trình STEM" và loại {t.code}.</small>}</div>
            </section>
          )
      })}
    </>
  )
}

function TrackForm({ t, isNew = false, onCancel, onSaved }: { t: StemTrack; isNew?: boolean; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState<StemTrack>({ ...t, subjects: [...t.subjects], levels: [...t.levels] })
  const [add, setAdd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const addSubject = () => {
    const parts = add.split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
    const next = [...f.subjects]
    for (const p of parts) if (!next.some(x => x.toLowerCase() === p.toLowerCase())) next.push(p)
    setF({ ...f, subjects: next }); setAdd('')
  }
  const move = (i: number, d: number) => {
    const s = [...f.subjects]; const j = i + d
    if (j < 0 || j >= s.length) return
    ;[s[i], s[j]] = [s[j], s[i]]; setF({ ...f, subjects: s })
  }
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
      <div className="sub" style={{ margin: '12px 0 4px' }}>Các môn học trong chương trình</div>
      <div>{f.subjects.map((s, i) => (
        <span key={s} className="chip">{s}
          <button type="button" className="x" aria-label={`Đưa ${s} lên trước`} disabled={i === 0} onClick={() => move(i, -1)}>‹</button>
          <button type="button" className="x" aria-label={`Đưa ${s} ra sau`} disabled={i === f.subjects.length - 1} onClick={() => move(i, 1)}>›</button>
          <button type="button" className="x" aria-label={`Bỏ ${s}`} onClick={() => setF({ ...f, subjects: f.subjects.filter(x => x !== s) })}>×</button>
        </span>
      ))}</div>
      <div className="actions" style={{ marginTop: 6 }}>
        <input value={add} placeholder="Thêm môn, ví dụ: Toán STEM (nhiều môn cách nhau dấu phẩy)" aria-label="Thêm môn học" style={{ flex: 1, minWidth: 220 }}
          onChange={e => setAdd(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubject() } }} />
        <button type="button" onClick={addSubject} disabled={!add.trim()}>Thêm môn</button>
      </div>
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
