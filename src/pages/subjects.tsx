import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { norm } from '../lib/sheet'
import { useStemTracks, TRACK_COLOR } from '../lib/stemTracks'
import { useEduLevels } from '../lib/eduLevels'

// Danh mục môn học (MonHoc, migration 064): KDI, Sở, Phòng, trường đều có danh mục riêng; môn "dùng chung" của KDI /
// cấp trên hiện ở đơn vị trực thuộc. Học phần của chương trình giáo dục gắn với môn trong danh mục (edu_unit_subjects).
export type Subject = {
  id: string; org_id: string; code: string | null; name: string; domain: string | null; description: string | null
  levels: string[]; ct_codes: string[]; scope: 'own' | 'children'; active: boolean; sort: number; owner_name?: string | null
}
export type SubjectMode = 'school' | 'authority' | 'platform'
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 064 trên Supabase.'
  : /row-level|42501/i.test(m) ? 'Bạn không có quyền sửa danh mục môn học của đơn vị.'
  : /23503|foreign key/i.test(m) ? 'Môn đang được học phần của chương trình dùng — hãy chuyển sang "Ngừng dùng".'
  : /23505|duplicate/i.test(m) ? 'Đơn vị đã có môn trùng tên hoặc trùng mã.' : m)

// Dùng chung trong phiên (nhiều ô chọn môn trên một màn chỉ tải một lần); `reload()` sau khi sửa danh mục.
let cache: Subject[] | null = null
let cacheErr = ''
let pending: Promise<void> | null = null
const subs = new Set<() => void>()
function fetchSubjects(force = false): Promise<void> {
  if (cache && !force) return Promise.resolve()
  if (!pending || force) {
    pending = Promise.resolve(supabase.from('subjects').select('*, owner_name').order('sort').order('name')).then(({ data, error }) => {
      cacheErr = error ? errText(error.message) : ''
      cache = (data as Subject[]) ?? []
      pending = null
      subs.forEach(f => f())
    })
  }
  return pending
}

/** Môn học nhìn thấy được (của đơn vị + dùng chung từ KDI / cấp trên), sắp theo thứ tự và tên. */
export function useSubjects() {
  const [, tick] = useState(0)
  useEffect(() => {
    const f = () => tick(n => n + 1)
    subs.add(f)
    fetchSubjects().then(f)
    return () => { subs.delete(f) }
  }, [])
  return { subjects: cache ?? [], loaded: cache !== null, err: cacheErr, reload: () => fetchSubjects(true) }
}

export function SubjectsCatalog({ orgId, mode = 'school' }: { orgId: string | null; mode?: SubjectMode }) {
  const { subjects, loaded, err, reload } = useSubjects()
  const { codes: ctCodes, allCodes } = useStemTracks()
  const { levels: lvList, name: levelName } = useEduLevels()
  const LEVELS = lvList.map(l => [l.code, l.name] as [string, string])
  const [canEdit, setCanEdit] = useState(mode !== 'school')
  const [form, setForm] = useState<Partial<Subject> | null>(null)
  const [q, setQ] = useState('')
  const [lv, setLv] = useState('')
  const [old, setOld] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  useEffect(() => {
    if (mode === 'school') supabase.rpc('has_perm', { p_module: 'curriculum', p_action: 'edit' }).then(({ data }) => setCanEdit(!!data))
  }, [mode])

  const shown = useMemo(() => subjects.filter(s => (old || s.active) && (!lv || s.levels.includes(lv) || !s.levels.length)
    && (!q || norm([s.code, s.name, s.domain].join(' ')).includes(norm(q)))), [subjects, q, lv, old])
  const own = shown.filter(s => s.org_id === orgId)
  const shared = shown.filter(s => s.org_id !== orgId)

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form || !orgId) return
    const row = {
      code: form.code?.trim() || null, name: (form.name ?? '').trim(), domain: form.domain?.trim() || null,
      description: form.description?.trim() || null, levels: form.levels ?? [], ct_codes: form.ct_codes ?? [],
      scope: mode === 'school' ? 'own' : form.scope ?? 'children', active: form.active !== false, sort: Number(form.sort) || 0,
    }
    if (!row.name) return setMsg(['Nhập tên môn học.', true])
    const { data, error } = form.id
      ? await supabase.from('subjects').update(row).eq('id', form.id).select('id')
      : await supabase.from('subjects').insert({ ...row, org_id: orgId }).select('id')
    if (error) return setMsg([errText(error.message + ' ' + (error.code ?? '')), true])
    if (!data?.length) return setMsg([errText('row-level'), true])
    setForm(null); setMsg([form.id ? 'Đã lưu môn học.' : 'Đã thêm môn học.', false]); reload()
  }
  async function setActive(s: Subject, active: boolean) {
    const { error } = await supabase.from('subjects').update({ active }).eq('id', s.id)
    if (error) return setMsg([errText(error.message), true])
    reload()
  }
  async function remove(s: Subject) {
    if (!confirm(`Xoá môn "${s.name}"? Môn đang được học phần dùng thì không xoá được, hãy ngừng dùng.`)) return
    const { data, error } = await supabase.from('subjects').delete().eq('id', s.id).select('id')
    if (error) return setMsg([errText(error.message + ' ' + (error.code ?? '')), true])
    if (!data?.length) return setMsg([errText('row-level'), true])
    setMsg(null); reload()
  }
  const toggle = (k: 'levels' | 'ct_codes', v: string) => {
    if (!form) return
    const cur = form[k] ?? []
    setForm({ ...form, [k]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] })
  }

  const row = (s: Subject, mine: boolean) => (
    <tr key={s.id} style={s.active ? undefined : { opacity: 0.6 }}>
      <td>{s.code && <small className="sub">{s.code}<br /></small>}<b>{s.name}</b>{!s.active && <> <span className="pill">Ngừng dùng</span></>}
        {s.description && <><br /><small className="sub">{s.description}</small></>}</td>
      <td>{s.domain ?? '—'}</td>
      <td>{s.levels.length ? s.levels.map(levelName).join(', ') : <small className="sub">Mọi cấp</small>}</td>
      <td>{s.ct_codes.map(c => <span key={c} className="progchip" style={{ background: TRACK_COLOR[c], color: '#fff', marginRight: 4 }}>{c}</span>)}</td>
      <td>{mine ? (s.scope === 'children' ? 'Dùng chung cho đơn vị trực thuộc' : 'Chỉ đơn vị mình') : <small className="sub">{s.owner_name ?? '—'}</small>}</td>
      <td className="tools">{mine && canEdit && <>
        <button onClick={() => { setMsg(null); setForm(s) }}>Sửa</button>
        <button onClick={() => setActive(s, !s.active)}>{s.active ? 'Ngừng dùng' : 'Dùng lại'}</button>
        <button className="danger" onClick={() => remove(s)}>Xoá</button>
      </>}</td>
    </tr>
  )
  const table = (rows: Subject[], mine: boolean) => (
    <div className="wrap"><table>
      <thead><tr><th>Môn học</th><th>Lĩnh vực</th><th>Cấp học</th><th>Loại chương trình</th><th>{mine ? 'Phạm vi' : 'Đơn vị'}</th><th></th></tr></thead>
      <tbody>{rows.map(s => row(s, mine))}</tbody>
    </table></div>
  )
  const domains = [...new Set(subjects.map(s => s.domain).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'vi'))

  return (
    <>
      <p className="sub">Danh mục môn học / lĩnh vực kiến thức dùng khi soạn chương trình: mỗi học phần gắn một hay nhiều môn.
        {mode === 'platform' ? ' Môn "dùng chung" của KDI hiện ở mọi đơn vị.' : mode === 'authority' ? ' Môn "dùng chung" hiện ở các trường trực thuộc.' : ' Trường dùng môn của KDI, Sở, Phòng và thêm môn riêng.'}</p>
      <div className="bar">
        <div className="tools">
          <select value={lv} onChange={e => setLv(e.target.value)} aria-label="Cấp học"><option value="">Mọi cấp học</option>{LEVELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input placeholder="Tìm mã, tên, lĩnh vực…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
          <label><input type="checkbox" checked={old} onChange={e => setOld(e.target.checked)} /> Hiện môn ngừng dùng</label>
        </div>
        {canEdit && orgId && <button className="primary" onClick={() => { setMsg(null); setForm({ levels: [], ct_codes: [], scope: mode === 'school' ? 'own' : 'children', active: true }) }}>Thêm môn học</button>}
      </div>
      {(msg || err) && <p className={msg && !msg[1] ? 'sub' : 'msg'} role="status"><b>{msg?.[0] ?? err}</b></p>}
      {form && (
        <form className="panel formgrid" onSubmit={save} style={{ marginBottom: 12 }}>
          <label className="field"><span>Tên môn học *</span><input required value={form.name ?? ''} maxLength={120} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="VD: Lập trình và Điều khiển" /></label>
          <label className="field"><span>Mã</span><input value={form.code ?? ''} maxLength={40} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="VD: LTDK" /></label>
          <label className="field"><span>Lĩnh vực kiến thức</span><input list="subject-domains" value={form.domain ?? ''} onChange={e => setForm({ ...form, domain: e.target.value })} placeholder="VD: Công nghệ – Kĩ thuật" /></label>
          <datalist id="subject-domains">{domains.map(d => <option key={d} value={d} />)}</datalist>
          <label className="field"><span>Thứ tự</span><input type="number" min={0} value={form.sort ?? 0} onChange={e => setForm({ ...form, sort: Number(e.target.value) })} /></label>
          {mode !== 'school' && <label className="field"><span>Phạm vi</span><select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value as Subject['scope'] })}>
            <option value="children">Dùng chung cho đơn vị trực thuộc</option><option value="own">Chỉ đơn vị mình</option></select></label>}
          <label className="field wide" style={{ gridColumn: '1/-1' }}><span>Mô tả</span><textarea rows={2} value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          <fieldset className="field" style={{ border: 0, padding: 0 }}><legend className="sub">Cấp học (để trống = mọi cấp)</legend>
            {LEVELS.map(([k, l]) => <label key={k} style={{ marginRight: 12 }}><input type="checkbox" checked={(form.levels ?? []).includes(k)} onChange={() => toggle('levels', k)} /> {l}</label>)}</fieldset>
          <fieldset className="field" style={{ border: 0, padding: 0 }}><legend className="sub">Thuộc loại chương trình</legend>
            {[...ctCodes, ...(form.ct_codes ?? []).filter(c => !ctCodes.includes(c) && allCodes.includes(c))].map(c => (
              <label key={c} style={{ marginRight: 12 }}><input type="checkbox" checked={(form.ct_codes ?? []).includes(c)} onChange={() => toggle('ct_codes', c)} /> {c}</label>))}</fieldset>
          <div className="formactions"><button className="primary" type="submit">{form.id ? 'Lưu' : 'Thêm'}</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}
      {!loaded ? <p className="sub">Đang tải…</p> : (
        <>
          <h3>Của đơn vị ({own.length})</h3>
          {own.length ? table(own, true) : <div className="panel"><p className="sub" style={{ margin: 0 }}>Đơn vị chưa có môn riêng.{canEdit && ' Bấm "Thêm môn học".'}</p></div>}
          <h3>Dùng chung từ KDI / cấp trên ({shared.length})</h3>
          {shared.length ? table(shared, false) : <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có môn dùng chung.</p></div>}
        </>
      )}
    </>
  )
}
