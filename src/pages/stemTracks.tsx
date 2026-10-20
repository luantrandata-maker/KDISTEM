import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PROGRAM_COLOR } from './teacher/common'
import { STEM_LEVELS, STEM_LEVEL_NAME, useStemTracks, type StemLevel, type StemTrack } from '../lib/stemTracks'

// Danh mục chương trình STEM CT1–CT5 (migration 062): KDI sửa tên, mô tả, môn học, cấp học áp dụng;
// đơn vị khác xem. Kèm các chương trình giáo dục đang ban hành của từng CT.
type Prog = { id: string; code: string | null; title: string; ct_code: string; level: string; version_no: number }
const LV: Record<string, string> = { tieuhoc: 'Tiểu học', thcs: 'THCS', thpt: 'THPT' }
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 062 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Chỉ quản trị nền tảng KDI sửa được danh mục này.' : m)

export function StemTracksCatalog() {
  const { tracks, reload } = useStemTracks()
  const [admin, setAdmin] = useState(false)
  const [progs, setProgs] = useState<Prog[]>([])
  const [edit, setEdit] = useState<string | null>(null)
  useEffect(() => {
    supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data))
    supabase.from('edu_programs').select('id, code, title, ct_code, level, version_no').eq('kind', 'stem').eq('status', 'published').order('code')
      .then(({ data }) => setProgs((data ?? []) as Prog[]))
  }, [])
  return (
    <>
      <p className="sub">Năm chương trình STEM của KDI: tên, mô tả, môn học trong chương trình và cấp học áp dụng. {admin
        ? 'Bấm "Sửa" để điều chỉnh; thay đổi hiện ngay ở mọi màn dùng CT1–CT5.'
        : 'Chỉ quản trị nền tảng KDI sửa được danh mục này.'} Nội dung chi tiết (chủ đề, yêu cầu cần đạt) nằm trong từng chương trình giáo dục bên dưới mỗi CT.</p>
      {tracks.map(t => {
        const list = progs.filter(p => p.ct_code === t.code)
        return edit === t.code
          ? <TrackForm key={t.code} t={t} onCancel={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />
          : (
            <section key={t.code} className="panel">
              <div className="bar" style={{ margin: 0 }}>
                <h3 style={{ margin: 0 }}><span className="progchip" style={{ background: PROGRAM_COLOR[t.code], color: '#fff' }}>{t.code}</span> {t.title}
                  <small className="sub" style={{ marginLeft: 8 }}>{t.name}</small></h3>
                {admin && <button onClick={() => setEdit(t.code)}>Sửa</button>}
              </div>
              {t.description && <p style={{ margin: '6px 0 10px' }}>{t.description}</p>}
              <div className="sub" style={{ margin: '0 0 4px' }}>Các môn học trong chương trình</div>
              <div>{t.subjects.length ? t.subjects.map(s => <span key={s} className="chip" style={{ paddingRight: 12 }}>{s}</span>) : <small className="sub">Chưa có</small>}</div>
              <div className="sub" style={{ margin: '10px 0 4px' }}>Cấp học áp dụng</div>
              <div>{t.levels.length ? t.levels.map(l => <span key={l} className="pill" style={{ marginRight: 6 }}>{STEM_LEVEL_NAME[l]}</span>) : <small className="sub">Chưa chọn</small>}</div>
              <div className="sub" style={{ margin: '10px 0 4px' }}>Chương trình giáo dục đang ban hành ({list.length})</div>
              <div>{list.length ? list.map(p => <span key={p.id} className="chip" style={{ paddingRight: 12 }}>{p.title} · {LV[p.level] ?? p.level} · v{p.version_no}</span>)
                : <small className="sub">Chưa có — tạo ở tab "Chương trình giáo dục", chọn loại "Chương trình STEM" và {t.code}.</small>}</div>
            </section>
          )
      })}
    </>
  )
}

function TrackForm({ t, onCancel, onSaved }: { t: StemTrack; onCancel: () => void; onSaved: () => void }) {
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
    setBusy(true); setErr('')
    const { data, error } = await supabase.from('stem_tracks')
      .update({ name: f.name, title: f.title, description: f.description, subjects: f.subjects, levels: f.levels })
      .eq('code', t.code).select('code')
    setBusy(false)
    if (error) return setErr(errText(error.message))
    if (!data?.length) return setErr(errText('row-level'))
    onSaved()
  }
  return (
    <section className="panel">
      <h3><span className="progchip" style={{ background: PROGRAM_COLOR[t.code], color: '#fff' }}>{t.code}</span> Sửa danh mục</h3>
      <div className="formgrid">
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
      <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
        <legend className="sub" style={{ marginBottom: 4 }}>Cấp học áp dụng</legend>
        {STEM_LEVELS.map(([k, label]) => (
          <label key={k} style={{ marginRight: 14, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={f.levels.includes(k)} onChange={() => toggle(k)} /> {label}
          </label>
        ))}
      </fieldset>
      {err && <p className="warnline">{err}</p>}
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="primary" onClick={save} disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu'}</button>
        <button onClick={onCancel} disabled={busy}>Huỷ</button>
      </div>
    </section>
  )
}
