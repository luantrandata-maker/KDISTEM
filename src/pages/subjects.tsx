import { MultiSelect } from '../components/MultiSelect'
import { HeadAction } from '../components/PageFrame'
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DataTable, type Col } from '../components/DataTable'
import { supabase } from '../lib/supabase'
import { OrgPick, useAllMode } from '../components/OrgScope'
import { norm } from '../lib/sheet'
import { useStemTracks, TRACK_COLOR } from '../lib/stemTracks'
import { useEduLevels } from '../lib/eduLevels'
import { ElView } from '../components/ElView'
// Đề kiểm tra của môn (109): dùng màn đề luyện E-learning, lọc theo môn
const SubjectExams = lazy(() => import('./elearning/Manage').then(m => ({ default: m.SubjectExams })))

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
  const { codes: ctCodes, allCodes, byCode } = useStemTracks()
  const { levels: lvList, name: levelName } = useEduLevels()
  const LEVELS = lvList.map(l => [l.code, l.name] as [string, string])
  const [canEdit, setCanEdit] = useState(mode !== 'school')
  const [form, setForm] = useState<Partial<Subject> | null>(null)
  const [view, setView] = useState<Subject | null>(null)
  const [vtab, setVtab] = useState<'info' | 'exam'>('info')
  const [q, setQ] = useState('')
  const [old, setOld] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  useEffect(() => {
    if (mode === 'school') supabase.rpc('has_perm', { p_module: 'curriculum', p_action: 'edit' }).then(({ data }) => setCanEdit(!!data))
  }, [mode])

  const shown = useMemo(() => subjects.filter(s => (old || s.active)
    && (!q || norm([s.code, s.name, s.domain].join(' ')).includes(norm(q)))), [subjects, q, old])
  // Quản trị hệ thống: môn học của tất cả đơn vị trong một danh sách, sửa thẳng
  const every = useAllMode()
  const own = every ? shown : shown.filter(s => s.org_id === orgId)
  const shared = every ? [] : shown.filter(s => s.org_id !== orgId)

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
      : await supabase.from('subjects').insert({ ...row, org_id: form.org_id || orgId }).select('id')
    if (error) return setMsg([errText(error.message + ' ' + (error.code ?? '')), true])
    if (!data?.length) return setMsg([errText('row-level'), true])
    setForm(null); setMsg([form.id ? 'Đã lưu môn học.' : 'Đã thêm môn học.', false]); reload()
  }
  async function setActive(s: Subject, active: boolean) {
    const { error } = await supabase.from('subjects').update({ active }).eq('id', s.id)
    if (error) return setMsg([errText(error.message), true])
    setMsg([active ? 'Đã dùng lại môn học.' : 'Đã ngừng dùng môn học.', false])
    setView(v => v && v.id === s.id ? { ...v, active } : v); reload()
  }
  async function remove(s: Subject) {
    if (!confirm(`Xoá môn "${s.name}"? Môn đang được học phần dùng thì không xoá được, hãy ngừng dùng.`)) return
    const { data, error } = await supabase.from('subjects').delete().eq('id', s.id).select('id')
    if (error) return setMsg([errText(error.message + ' ' + (error.code ?? '')), true])
    if (!data?.length) return setMsg([errText('row-level'), true])
    setMsg([`Đã xoá môn "${s.name}".`, false]); setView(null); reload()
  }
  const toggle = (k: 'levels' | 'ct_codes', v: string) => {
    if (!form) return
    const cur = form[k] ?? []
    setForm({ ...form, [k]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] })
  }

  const subjCols = (mine: boolean): Col<Subject>[] => [
    { key: 'name', label: 'Môn học', fixed: true, values: s => [s.name], text: s => [s.code, s.name, s.description].join(' '),
      cell: s => <>{s.code && <small className="sub">{s.code}<br /></small>}<button type="button" className="namelink" onClick={() => { setVtab('info'); setMsg(null); setView(s) }}><b>{s.name}</b></button>{!s.active && <> <span className="pill">Ngừng dùng</span></>}
        {s.description && <><br /><small className="sub">{s.description}</small></>}</> },
    { key: 'domain', label: 'Lĩnh vực', text: s => s.domain ?? '', cell: s => s.domain ?? '—' },
    { key: 'levels', label: 'Cấp học', values: s => s.levels.length ? s.levels.map(levelName) : ['Tất cả cấp'], text: s => s.levels.map(levelName).join(', ') || 'Tất cả cấp',
      cell: s => s.levels.length ? s.levels.map(levelName).join(', ') : <small className="sub">Tất cả cấp</small> },
    { key: 'code', label: 'Mã môn', off: true, text: s => s.code ?? '', cell: s => s.code || <small className="sub">—</small> },
    { key: 'desc', label: 'Mô tả', off: true, text: s => s.description ?? '', cell: s => s.description ? <small>{s.description}</small> : <small className="sub">—</small> },
    { key: 'active', label: 'Trạng thái', off: true, text: s => s.active ? 'Đang dùng' : 'Ngừng dùng', cell: s => s.active ? 'Đang dùng' : <span className="pill">Ngừng dùng</span> },
    { key: 'ct', label: 'Loại chương trình', values: s => s.ct_codes, text: s => s.ct_codes.join(' '),
      cell: s => s.ct_codes.map(c => <span key={c} className="progchip" style={{ background: TRACK_COLOR[c], color: '#fff', marginRight: 4 }}>{c}</span>) },
    { key: 'scope', label: mine ? 'Phạm vi' : 'Đơn vị', text: s => mine ? (s.scope === 'children' ? 'Dùng chung cho đơn vị trực thuộc' : 'Chỉ đơn vị mình') + ' ' + (s.owner_name ?? '') : s.owner_name ?? '',
      cell: s => <>{mine ? (s.scope === 'children' ? 'Dùng chung cho đơn vị trực thuộc' : 'Chỉ đơn vị mình') : <small className="sub">{s.owner_name ?? '—'}</small>}
        {mine && every && <><br /><small className="sub">{s.owner_name ?? '—'}</small></>}</> },
  ]
  const table = (rows: Subject[], mine: boolean, empty: ReactNode, left?: ReactNode, right?: ReactNode) => (
    <DataTable id={mine ? 'subjects' : 'subjects-shared'} rows={rows} rowKey={s => s.id} cols={subjCols(mine)} empty={empty} left={left} right={right} />
  )
  const domains = [...new Set(subjects.map(s => s.domain).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'vi'))

  if (view && !form) return (
    <ElView back="Môn học" onBack={() => { setMsg(null); setView(null) }} title={view.name} sub={[view.code, view.domain, view.owner_name].filter(Boolean).join(' · ')}>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      <div className="segmented" style={{ marginBottom: 12 }}>
        {([['info', 'Thông tin'], ['exam', 'Đề kiểm tra']] as const).map(([k, l]) => <button key={k} type="button" className={vtab === k ? 'on' : ''} onClick={() => setVtab(k)}>{l}</button>)}
      </div>
      {vtab === 'info' ? <section className="panel"><dl className="tpkv">
        <dt>Lĩnh vực</dt><dd>{view.domain ?? '—'}</dd>
        <dt>Cấp học</dt><dd>{view.levels.length ? view.levels.map(levelName).join(', ') : 'Tất cả cấp'}</dd>
        <dt>Loại chương trình</dt><dd>{view.ct_codes.join(', ') || '—'}</dd>
        <dt>Mô tả</dt><dd>{view.description || '—'}</dd>
      </dl>{canEdit && (every || view.org_id === orgId) && <div className="formactions tools">
        <button type="button" onClick={() => { setMsg(null); setForm(view) }}>Sửa môn học</button>
        <button type="button" onClick={() => setActive(view, !view.active)}>{view.active ? 'Ngừng dùng' : 'Dùng lại'}</button>
        <button type="button" className="danger" onClick={() => remove(view)}>Xoá</button></div>}</section>
      : <Suspense fallback={<p className="sub">Đang tải…</p>}>
        <p className="sub">Đề kiểm tra của môn {view.name}: rút câu từ Ngân hàng câu hỏi theo ma trận chủ đề × mức độ, đặt số câu, thời gian, số lượt, trộn câu. Đề hiện cùng ở mục E-learning & luyện thi.</p>
        <SubjectExams orgId={orgId} subject={view.name} /></Suspense>}
    </ElView>
  )
  if (form) return (
    <ElView back="Môn học" onBack={() => setForm(null)} title={form.id ? 'Sửa môn học' : 'Thêm môn học'}>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
        <form className="panel formgrid" onSubmit={save} style={{ marginBottom: 12 }}>
          {!form.id && <OrgPick kind="any" value={form.org_id ?? orgId ?? ''} onChange={v => setForm({ ...form, org_id: v })} />}
          <label className="field"><span>Tên môn học *</span><input required value={form.name ?? ''} maxLength={120} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="VD: Lập trình và Điều khiển" /></label>
          <label className="field"><span>Mã</span><input value={form.code ?? ''} maxLength={40} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="VD: LTDK" /></label>
          <label className="field"><span>Lĩnh vực kiến thức</span><input list="subject-domains" value={form.domain ?? ''} onChange={e => setForm({ ...form, domain: e.target.value })} placeholder="VD: Công nghệ – Kĩ thuật" /></label>
          <datalist id="subject-domains">{domains.map(d => <option key={d} value={d} />)}</datalist>
          <label className="field"><span>Thứ tự</span><input type="number" min={0} value={form.sort ?? 0} onChange={e => setForm({ ...form, sort: Number(e.target.value) })} /></label>
          {mode !== 'school' && <label className="field"><span>Phạm vi</span><select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value as Subject['scope'] })}>
            <option value="children">Dùng chung cho đơn vị trực thuộc</option><option value="own">Chỉ đơn vị mình</option></select></label>}
          <label className="field wide" style={{ gridColumn: '1/-1' }}><span>Mô tả</span><textarea rows={2} value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          <div className="field" style={{ gridColumn: 'span 2' }}><span>Cấp học (để trống = tất cả cấp)</span>
            <MultiSelect value={form.levels ?? []} onChange={v => setForm({ ...form, levels: v })} options={LEVELS} placeholder="Tất cả cấp học" ariaLabel="Cấp học" /></div>
          <div className="field" style={{ gridColumn: 'span 2' }}><span>Thuộc loại chương trình</span>
            <MultiSelect value={form.ct_codes ?? []} onChange={v => setForm({ ...form, ct_codes: v })} placeholder="Chọn loại chương trình…" ariaLabel="Loại chương trình"
              options={[...ctCodes, ...(form.ct_codes ?? []).filter(c => !ctCodes.includes(c) && allCodes.includes(c))].map(c => [c, `${c}${byCode[c] ? ' · ' + byCode[c]!.name : ''}`])} /></div>
          <div className="formactions" style={{ gridColumn: '1/-1' }}><button className="primary" type="submit">{form.id ? 'Lưu' : 'Thêm'}</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
    </ElView>
  )
  return (
    <>
      {(msg || err) && <p className={msg && !msg[1] ? 'sub' : 'msg'} role="status"><b>{msg?.[0] ?? err}</b></p>}
      {!loaded ? <p className="sub">Đang tải…</p> : (
        <>
          {!every && <h3>Của đơn vị ({own.length})</h3>}
          {table(own, true, <small className="sub">Đơn vị chưa có môn riêng.{canEdit && ' Bấm "Thêm môn học".'}</small>, <>
            <input placeholder="Tìm mã, tên, lĩnh vực…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
            <label className="chk"><input type="checkbox" checked={old} onChange={e => setOld(e.target.checked)} /> Hiện môn ngừng dùng</label>
            <small className="sub">{own.length} môn</small>
          </>, canEdit && orgId && <HeadAction><button type="button" className="primary ttadd" onClick={() => { setMsg(null); setForm({ levels: [], ct_codes: [], scope: mode === 'school' ? 'own' : 'children', active: true }) }}>+ Thêm môn học</button></HeadAction>)}
          {!every && <><h3>Dùng chung từ KDI / cấp trên ({shared.length})</h3>
          {table(shared, false, <small className="sub">Chưa có môn dùng chung.</small>)}</>}
        </>
      )}
    </>
  )
}
