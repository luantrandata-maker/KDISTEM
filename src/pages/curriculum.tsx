import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadXlsx, importSummary, norm, type Column } from '../lib/sheet'
import ImportExcel from '../components/ImportExcel'
import { Tiles } from './department/charts'

// Phân phối chương trình theo từng tiết + tiến độ dạy (migration 057).
//  • Trường: soạn / nhập Excel PPCT từng môn, sao chép mẫu của KDI hoặc cấp trên, xem tiến độ từng lớp.
//  • Sở / Phòng: soạn mẫu ban hành cho trường trực thuộc, xem tiến độ các trường.
//  • KDI: soạn mẫu dùng chung, xem tiến độ toàn hệ thống.
export type PpctMode = 'school' | 'authority' | 'platform'
type Book = {
  id: string; org_id: string; grade: number; subject: string; title: string; total_periods: number | null; year_name: string | null
  periods_per_week: number | null; status: 'draft' | 'published'; scope: 'own' | 'children'; source_id: string | null; note: string | null
  organizations?: { name: string } | null
}
type Lesson = { id: string; book_id: string; seq: number; week: number | null; title: string; kind: Kind; package_topic_id: string | null; note: string | null }
type Kind = 'lesson' | 'stem' | 'practice' | 'review' | 'test'
type Topic = { id: string; title: string; program: string; stem_packages: { name: string } | null }
export type Progress = {
  org_id: string; school: string; class_id: string; class_name: string; grade: number; subject: string; book_id: string; book_title: string
  total: number; week: number | null; planned: number; reached: number; taught: number; last_title: string | null; last_date: string | null; gap: number
}

export const KIND: Record<Kind, string> = { lesson: 'Bài học', stem: 'Chủ đề STEM', practice: 'Thực hành', review: 'Ôn tập', test: 'Kiểm tra' }
const KIND_PILL: Record<Kind, string> = { lesson: '', stem: 'good', practice: '', review: 'warn', test: 'bad' }
const errText = (m: string) => (/schema cache|does not exist|curriculum_lessons/i.test(m) && /exist|cache/i.test(m) ? 'Hãy chạy migration 057 trên Supabase.'
  : /row-level|42501/i.test(m) ? 'Bạn không có quyền sửa phân phối chương trình của đơn vị này.'
  : /duplicate|unique/i.test(m) ? 'Trùng số tiết — mỗi tiết trong một môn chỉ có một dòng.' : m)
const dmy = (d: string | null) => (d ? d.split('-').reverse().slice(0, 2).join('/') : '')
const numOrNull = (s: string) => { const n = Number(String(s).replace(',', '.')); return s.trim() && Number.isFinite(n) && n > 0 ? n : null }

// Có được sửa PPCT của đơn vị đang làm việc không
function useCanEdit(mode: PpctMode) {
  const [ok, setOk] = useState(mode !== 'school')
  useEffect(() => {
    if (mode === 'school') supabase.rpc('has_perm', { p_module: 'curriculum', p_action: 'edit' }).then(({ data }) => setOk(!!data))
  }, [mode])
  return ok
}

// ================= Danh sách môn / sách trong PPCT =================
export function CurriculumBooks({ orgId, mode = 'school', year }: { orgId: string | null; mode?: PpctMode; year?: { name: string } | null }) {
  const canEdit = useCanEdit(mode)
  const [books, setBooks] = useState<Book[]>([])
  const [loaded, setLoaded] = useState(false)
  const [grade, setGrade] = useState(0)
  const [subject, setSubject] = useState('')
  const [q, setQ] = useState('')
  const [form, setForm] = useState<Partial<Book> | null>(null)
  const [open, setOpen] = useState<Book | null>(null)
  const [showTpl, setShowTpl] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)

  async function load() {
    const { data, error } = await supabase.from('curriculum_books').select('*, organizations(name)').order('grade').order('subject').order('title')
    if (error) setMsg([errText(error.message), true])
    const all = (data as Book[]) ?? []
    setBooks(all); setLoaded(true)
    setOpen(o => (o ? all.find(b => b.id === o.id) ?? null : null))
  }
  useEffect(() => { load() }, [orgId])

  const own = books.filter(b => b.org_id === orgId)
  const templates = books.filter(b => b.org_id !== orgId && b.scope === 'children' && b.status === 'published')
  const grades = [...new Set(own.map(b => b.grade))].sort((a, b) => a - b)
  const subjects = [...new Set(own.map(b => b.subject))].sort((a, b) => a.localeCompare(b, 'vi'))
  const shown = own.filter(b => (!grade || b.grade === grade) && (!subject || b.subject === subject) && (!q || norm(b.title + ' ' + b.subject).includes(norm(q))))

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return
    const row = {
      org_id: orgId, grade: Number(form.grade), subject: (form.subject ?? '').trim(), title: (form.title ?? '').trim() || `${(form.subject ?? '').trim()} ${form.grade}`,
      year_name: form.year_name?.trim() || null, periods_per_week: form.periods_per_week ? Number(String(form.periods_per_week).replace(',', '.')) : null,
      status: form.status ?? 'published', scope: mode === 'school' ? 'own' : form.scope ?? 'children', note: form.note?.trim() || null,
      ...(form.id ? {} : { total_periods: form.total_periods ? Number(form.total_periods) : null }),
    }
    if (!row.subject || !row.grade) return setMsg(['Nhập khối và môn học.', true])
    const { error } = form.id ? await supabase.from('curriculum_books').update(row).eq('id', form.id) : await supabase.from('curriculum_books').insert(row)
    if (error) return setMsg([errText(error.message), true])
    setForm(null); setMsg([form.id ? 'Đã lưu thông tin môn.' : 'Đã thêm môn — bấm "Mở" để soạn từng tiết.', false]); load()
  }
  async function remove(b: Book) {
    if (!confirm(`Xoá PPCT "${b.title}" và toàn bộ các tiết? Tiết dạy đã gắn với PPCT này sẽ bỏ liên kết.`)) return
    const { error } = await supabase.from('curriculum_books').delete().eq('id', b.id)
    if (error) return setMsg([errText(error.message), true])
    setMsg(['Đã xoá.', false]); load()
  }
  async function copy(t: Book) {
    const dup = own.find(b => b.grade === t.grade && norm(b.subject) === norm(t.subject) && (b.year_name ?? '') === (year?.name ?? t.year_name ?? ''))
    if (dup && !confirm(`Đơn vị đã có PPCT "${dup.title}" cùng khối, cùng môn. Vẫn sao chép thêm một bản?`)) return
    const { data, error } = await supabase.rpc('curriculum_copy', { p_book: t.id, p_year: mode === 'school' ? year?.name ?? null : null })
    if (error) return setMsg([errText(error.message), true])
    setMsg([`Đã sao chép "${t.title}" — chỉnh lại theo kế hoạch của đơn vị nếu cần.`, false]); setShowTpl(false)
    await load(); const nb = (await supabase.from('curriculum_books').select('*, organizations(name)').eq('id', data as string).single()).data as Book | null
    if (nb) setOpen(nb)
  }
  function exportList() {
    downloadXlsx('Phan-phoi-chuong-trinh', [
      { key: 'g', label: 'Khối' }, { key: 's', label: 'Môn học', width: 20 }, { key: 't', label: 'Tên PPCT', width: 36 }, { key: 'y', label: 'Năm học' },
      { key: 'n', label: 'Số tiết' }, { key: 'w', label: 'Tiết/tuần' }, { key: 'st', label: 'Trạng thái' },
    ], shown.map(b => [b.grade, b.subject, b.title, b.year_name, b.total_periods, b.periods_per_week, b.status === 'draft' ? 'Nháp' : 'Đã ban hành']))
  }

  if (open) return <LessonEditor book={open} canEdit={canEdit && open.org_id === orgId} mode={mode} onClose={() => { setOpen(null); load() }} onChanged={load} />

  const scopeLabel = mode === 'platform' ? 'Mẫu cho mọi trường' : 'Ban hành cho đơn vị trực thuộc'
  return (
    <>
      <p className="sub">
        {mode === 'school' ? 'Phân phối chương trình theo từng tiết của từng môn, khối. Khi giáo viên điểm danh, tiết dạy được gắn với tiết kế tiếp trong PPCT để theo dõi tiến độ (xem tab Tiến độ dạy).'
          : mode === 'platform' ? 'Mẫu PPCT của KDI: trường sao chép về rồi điều chỉnh theo kế hoạch của tổ chuyên môn. Bản nháp chưa hiện với trường.'
          : 'PPCT của đơn vị. Bật "Ban hành cho đơn vị trực thuộc" để các trường thấy và sao chép làm mẫu.'}
      </p>
      <div className="bar">
        <div className="tools">
          {grades.length > 1 && <div className="segmented" style={{ margin: 0 }}>
            {[0, ...grades].map(g => <button key={g} className={grade === g ? 'on' : ''} onClick={() => setGrade(g)}>{g ? `Khối ${g}` : 'Tất cả'}</button>)}
          </div>}
          {subjects.length > 1 && <select value={subject} onChange={e => setSubject(e.target.value)} aria-label="Môn học"><option value="">Mọi môn</option>{subjects.map(s => <option key={s}>{s}</option>)}</select>}
          <input placeholder="Tìm môn, tên PPCT…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm" />
        </div>
        <div className="tools">
          {canEdit && templates.length > 0 && <button onClick={() => setShowTpl(v => !v)}>{showTpl ? 'Ẩn mẫu' : `Dùng mẫu (${templates.length})`}</button>}
          {shown.length > 0 && <button onClick={exportList}>Xuất Excel</button>}
          {canEdit && <button className="primary" onClick={() => setForm({ grade: grade || undefined, subject, status: 'published', scope: mode === 'school' ? 'own' : 'children', year_name: mode === 'school' ? year?.name ?? '' : '' })}>Thêm môn</button>}
        </div>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}

      {form && (
        <form className="panel formgrid" onSubmit={save} style={{ marginBottom: 12 }}>
          <label className="field"><span>Khối *</span><input type="number" min={1} max={12} required value={form.grade ?? ''} onChange={e => setForm({ ...form, grade: Number(e.target.value) || undefined })} /></label>
          <label className="field"><span>Môn học *</span><input required list="ppct-subjects" value={form.subject ?? ''} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="VD: Tin học" /></label>
          <datalist id="ppct-subjects">{[...new Set([...subjects, 'Toán', 'Khoa học tự nhiên', 'Tin học', 'Công nghệ', 'Khoa học', 'Hoạt động trải nghiệm'])].map(s => <option key={s} value={s} />)}</datalist>
          <label className="field"><span>Tên PPCT</span><input value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Tin học 6 — Kết nối tri thức" /></label>
          <label className="field"><span>Năm học</span><input value={form.year_name ?? ''} onChange={e => setForm({ ...form, year_name: e.target.value })} placeholder="Để trống: dùng mọi năm" /></label>
          <label className="field"><span>Số tiết / tuần</span><input inputMode="decimal" value={form.periods_per_week ?? ''} onChange={e => setForm({ ...form, periods_per_week: e.target.value as any })} placeholder="VD: 1 hoặc 1,5" /></label>
          {!form.id && <label className="field"><span>Tổng số tiết (dự kiến)</span><input type="number" min={0} value={form.total_periods ?? ''} onChange={e => setForm({ ...form, total_periods: Number(e.target.value) || null })} placeholder="Tự cập nhật khi soạn tiết" /></label>}
          <label className="field"><span>Trạng thái</span><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Book['status'] })}>
            <option value="published">{mode === 'school' ? 'Đang dùng' : 'Đã ban hành'}</option><option value="draft">Nháp</option></select></label>
          {mode !== 'school' && <label className="field"><span>Phạm vi</span><select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value as Book['scope'] })}>
            <option value="children">{scopeLabel}</option><option value="own">Chỉ đơn vị mình</option></select></label>}
          <label className="field" style={{ gridColumn: '1/-1' }}><span>Ghi chú</span><input value={form.note ?? ''} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
          <div className="formactions"><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}

      {showTpl && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Mẫu PPCT từ KDI và cấp trên</h3>
          <div className="wrap"><table>
            <thead><tr><th>Khối</th><th>Môn</th><th>Tên mẫu</th><th>Số tiết</th><th>Ban hành bởi</th><th></th></tr></thead>
            <tbody>{templates.map(t => (
              <tr key={t.id}><td>{t.grade}</td><td>{t.subject}</td><td><b>{t.title}</b>{t.note && <><br /><small>{t.note}</small></>}</td>
                <td>{t.total_periods ?? '—'}</td><td>{t.organizations?.name ?? '—'}</td>
                <td className="tools"><button onClick={() => setOpen(t)}>Xem</button><button className="primary" onClick={() => copy(t)}>Sao chép</button></td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      {!loaded ? <p className="sub">Đang tải…</p> : own.length === 0 ? (
        <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có môn nào trong phân phối chương trình.
          {canEdit && (templates.length ? ' Bấm "Dùng mẫu" để sao chép PPCT mẫu, hoặc "Thêm môn" để tự soạn.' : ' Bấm "Thêm môn" để bắt đầu.')}</p></div>
      ) : (
        <div className="wrap"><table>
          <thead><tr><th>Khối</th><th>Môn</th><th>Tên PPCT</th><th>Năm học</th><th>Số tiết</th><th>Tiết/tuần</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>{shown.map(b => (
            <tr key={b.id}>
              <td>{b.grade}</td><td>{b.subject}</td>
              <td><b>{b.title}</b>{b.source_id && <><br /><small>Sao chép từ mẫu</small></>}{mode !== 'school' && b.scope === 'children' && <><br /><small>{scopeLabel}</small></>}</td>
              <td>{b.year_name ?? 'Mọi năm'}</td><td>{b.total_periods ?? '—'}</td><td>{b.periods_per_week ?? '—'}</td>
              <td><span className={'pill ' + (b.status === 'draft' ? '' : 'active')}>{b.status === 'draft' ? 'Nháp' : mode === 'school' ? 'Đang dùng' : 'Đã ban hành'}</span></td>
              <td className="tools">
                <button className="primary" onClick={() => setOpen(b)}>{canEdit ? 'Soạn tiết' : 'Xem'}</button>
                {canEdit && <><button onClick={() => setForm(b)}>Sửa</button><button className="danger" onClick={() => remove(b)}>Xoá</button></>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  )
}

// ================= Soạn từng tiết của một môn =================
const IMPORT: Column[] = [
  { key: 'seq', label: 'Tiết', required: true, aliases: ['Tiết thứ', 'STT', 'Số tiết'] },
  { key: 'week', label: 'Tuần' },
  { key: 'title', label: 'Tên bài / nội dung', required: true, aliases: ['Tên bài', 'Bài học', 'Nội dung', 'Tên bài học'], width: 44 },
  { key: 'kind', label: 'Loại tiết', aliases: ['Loại'], width: 14 },
  { key: 'topic', label: 'Chủ đề STEM', aliases: ['Chủ đề'], width: 28 },
  { key: 'note', label: 'Ghi chú', width: 24 },
]
const kindOf = (s: string): Kind => {
  const n = norm(s)
  if (!n) return 'lesson'
  return (Object.keys(KIND) as Kind[]).find(k => norm(KIND[k]) === n || n.includes(norm(KIND[k]).split(' ')[0])) ?? (n.includes('stem') ? 'stem' : 'lesson')
}

function LessonEditor({ book, canEdit, mode, onClose, onChanged }: { book: Book; canEdit: boolean; mode: PpctMode; onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<Lesson[] | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [edit, setEdit] = useState<Partial<Lesson> | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [busy, setBusy] = useState(false)
  async function load() {
    const [l, t] = await Promise.all([
      supabase.from('curriculum_lessons').select('*').eq('book_id', book.id).order('seq'),
      canEdit ? supabase.from('package_topics').select('id, title, program, stem_packages(name)').eq('org_id', book.org_id).order('seq') : Promise.resolve({ data: [] }),
    ])
    if ('error' in l && l.error) setMsg([errText(l.error.message), true])
    setRows((l.data as Lesson[]) ?? []); setTopics(((t as any).data as Topic[]) ?? [])
  }
  useEffect(() => { load() }, [book.id])
  const topicName = (id: string | null) => (id ? topics.find(t => t.id === id)?.title ?? 'Chủ đề STEM' : '')
  const ppw = Number(book.periods_per_week) || 0

  async function saveRow(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return
    const seq = Number(edit.seq)
    if (!seq || seq < 1) return setMsg(['Số tiết không hợp lệ.', true])
    const row = { book_id: book.id, seq, week: edit.week ? Number(edit.week) : (ppw ? Math.ceil(seq / ppw) : null), title: (edit.title ?? '').trim(),
      kind: edit.kind ?? 'lesson', package_topic_id: edit.package_topic_id || null, note: edit.note?.trim() || null }
    if (!row.title) return setMsg(['Nhập tên bài / nội dung tiết.', true])
    const { error } = edit.id ? await supabase.from('curriculum_lessons').update(row).eq('id', edit.id) : await supabase.from('curriculum_lessons').insert(row)
    if (error) return setMsg([errText(error.message), true])
    setEdit(null); setMsg(null); await load(); onChanged()
  }
  async function del(l: Lesson) {
    if (!confirm(`Xoá tiết ${l.seq}: "${l.title}"?`)) return
    const { error } = await supabase.from('curriculum_lessons').delete().eq('id', l.id)
    if (error) return setMsg([errText(error.message), true])
    await load(); onChanged()
  }
  async function autoWeeks() {
    if (!ppw) return setMsg(['Nhập "Số tiết / tuần" của môn (nút Sửa ở danh sách) để tự chia tuần.', true])
    if (!confirm(`Đặt lại tuần cho mọi tiết theo ${ppw} tiết/tuần (tiết 1–${ppw} → tuần 1…)?`)) return
    setBusy(true)
    const list = rows ?? []
    const res = await Promise.all(list.map(l => supabase.from('curriculum_lessons').update({ week: Math.ceil(l.seq / ppw) }).eq('id', l.id)))
    setBusy(false)
    const bad = res.find(r => r.error)
    setMsg(bad ? [errText(bad.error!.message), true] : [`Đã chia ${list.length} tiết vào ${Math.ceil(list.length / ppw)} tuần.`, false]); load()
  }
  async function importRows(recs: (Record<string, string> & { _line: number })[]) {
    const bad: string[] = []; const seen = new Set<number>()
    const data = recs.flatMap(r => {
      const seq = Number(r.seq.replace(/\D+/g, ''))
      if (!seq) { bad.push(`dòng ${r._line}: thiếu số tiết`); return [] }
      if (!r.title.trim()) { bad.push(`dòng ${r._line}: thiếu tên bài`); return [] }
      if (seen.has(seq)) { bad.push(`dòng ${r._line}: trùng tiết ${seq}`); return [] }
      seen.add(seq)
      const tp = r.topic.trim() ? topics.find(t => norm(t.title) === norm(r.topic)) : undefined
      if (r.topic.trim() && !tp) bad.push(`dòng ${r._line}: không có chủ đề STEM "${r.topic}" trong gói của đơn vị — bỏ qua cột này`)
      const week = numOrNull(r.week)
      return [{ book_id: book.id, seq, week: week ? Math.round(week) : (ppw ? Math.ceil(seq / ppw) : null), title: r.title.trim(),
        kind: tp ? 'stem' : kindOf(r.kind), package_topic_id: tp?.id ?? null, note: r.note.trim() || null }]
    })
    if (!data.length) return importSummary(0, 'tiết', bad)
    if ((rows?.length ?? 0) > 0 && !confirm(`Môn này đã có ${rows!.length} tiết. Thay toàn bộ bằng ${data.length} tiết trong file?\n(Tiết dạy đã gắn với tiết cũ sẽ bỏ liên kết.)`)) return 'Đã huỷ nhập.'
    if (rows?.length) {
      const { error } = await supabase.from('curriculum_lessons').delete().eq('book_id', book.id)
      if (error) return errText(error.message)
    }
    const { error } = await supabase.from('curriculum_lessons').insert(data)
    if (error) return errText(error.message)
    await load(); onChanged()
    return importSummary(data.length, 'tiết', bad)
  }
  function exportRows() {
    downloadXlsx(`PPCT ${book.title}`, IMPORT, (rows ?? []).map(l => [l.seq, l.week, l.title, KIND[l.kind], topicName(l.package_topic_id), l.note]), book.title)
  }

  const counts = useMemo(() => (rows ?? []).reduce((m, l) => ({ ...m, [l.kind]: (m[l.kind] ?? 0) + 1 }), {} as Record<string, number>), [rows])
  const weeks = new Set((rows ?? []).map(l => l.week).filter(Boolean)).size
  const formRow = (
    <tr>
      <td><input type="number" min={1} required value={edit?.seq ?? ''} onChange={e => setEdit({ ...edit, seq: Number(e.target.value) })} aria-label="Tiết" style={{ width: 64 }} /></td>
      <td><input type="number" min={1} max={52} value={edit?.week ?? ''} onChange={e => setEdit({ ...edit, week: Number(e.target.value) || null })} aria-label="Tuần" style={{ width: 64 }} placeholder={ppw && edit?.seq ? String(Math.ceil(Number(edit.seq) / ppw)) : ''} /></td>
      <td><input required value={edit?.title ?? ''} onChange={e => setEdit({ ...edit, title: e.target.value })} aria-label="Tên bài" placeholder="VD: Bài 3. Thông tin trong máy tính" autoFocus style={{ width: '100%', minWidth: 220 }} /></td>
      <td><select value={edit?.kind ?? 'lesson'} onChange={e => setEdit({ ...edit, kind: e.target.value as Kind })} aria-label="Loại tiết">
        {(Object.keys(KIND) as Kind[]).map(k => <option key={k} value={k}>{KIND[k]}</option>)}</select></td>
      <td><select value={edit?.package_topic_id ?? ''} onChange={e => setEdit({ ...edit, package_topic_id: e.target.value || null, kind: e.target.value ? 'stem' : edit?.kind })} aria-label="Chủ đề STEM" style={{ maxWidth: 220 }}>
        <option value="">—</option>{topics.map(t => <option key={t.id} value={t.id}>{t.program} · {t.title}{t.stem_packages ? ` (${t.stem_packages.name})` : ''}</option>)}</select></td>
      <td><input value={edit?.note ?? ''} onChange={e => setEdit({ ...edit, note: e.target.value })} aria-label="Ghi chú" style={{ width: 120 }} /></td>
      <td className="tools"><button className="primary" type="submit" form="ppct-row">Lưu</button><button type="button" onClick={() => setEdit(null)}>Huỷ</button></td>
    </tr>
  )
  return (
    <>
      <div className="bar">
        <div>
          <button className="linkbtn" onClick={onClose}>‹ Danh sách môn</button>
          <h3 style={{ margin: '4px 0 0' }}>{book.title}</h3>
          <small className="sub">Khối {book.grade} · {book.subject} · {book.year_name ?? 'mọi năm học'}{ppw ? ` · ${ppw} tiết/tuần` : ''}
            {!canEdit && book.scope === 'children' && book.organizations?.name && mode === 'school' ? ` · mẫu của ${book.organizations.name}` : ''}</small>
        </div>
        <div className="tools">
          {canEdit && <ImportExcel columns={IMPORT} template={`Mau-PPCT-${book.subject}-${book.grade}`}
            sample={[['1', '1', 'Bài 1. Thông tin và dữ liệu', 'Bài học', '', ''], ['2', '1', 'Bài 1. Thông tin và dữ liệu (tiếp)', 'Bài học', '', ''], ['9', '9', 'Kiểm tra giữa học kì I', 'Kiểm tra', '', '']]}
            onRecords={importRows} onMessage={(m, isErr) => setMsg([m, !!isErr])} />}
          {(rows?.length ?? 0) > 0 && <button onClick={exportRows}>Tải Excel</button>}
          {canEdit && (rows?.length ?? 0) > 0 && <button onClick={autoWeeks} disabled={busy}>Tự chia tuần</button>}
          {canEdit && <button className="primary" onClick={() => setEdit({ seq: (rows?.length ? rows[rows.length - 1].seq : 0) + 1, kind: 'lesson' })}>Thêm tiết</button>}
        </div>
      </div>
      {rows && rows.length > 0 && <Tiles items={[
        { label: 'Số tiết', value: rows.length, sub: weeks ? `${weeks} tuần` : 'chưa chia tuần' },
        { label: 'Chủ đề STEM', value: counts.stem ?? 0, tone: counts.stem ? 'good' : undefined },
        { label: 'Thực hành', value: counts.practice ?? 0 },
        { label: 'Ôn tập · Kiểm tra', value: `${counts.review ?? 0} · ${counts.test ?? 0}` },
      ]} />}
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      <form id="ppct-row" onSubmit={saveRow} />
      {!rows ? <p className="sub">Đang tải…</p> : rows.length === 0 && !edit ? (
        <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có tiết nào.{canEdit && ' Bấm "Thêm tiết", hoặc "Nhập Excel" (bấm "Tải file mẫu" để có file đúng cột).'}</p></div>
      ) : (
        <div className="wrap"><table>
          <thead><tr><th>Tiết</th><th>Tuần</th><th>Tên bài / nội dung</th><th>Loại</th><th>Chủ đề STEM</th><th>Ghi chú</th><th></th></tr></thead>
          <tbody>
            {rows.map(l => edit?.id === l.id ? <Fragment key={l.id}>{formRow}</Fragment> : (
              <tr key={l.id}>
                <td><b>{l.seq}</b></td><td>{l.week ?? '—'}</td><td>{l.title}</td>
                <td>{l.kind !== 'lesson' ? <span className={'gpill ' + KIND_PILL[l.kind]}>{KIND[l.kind]}</span> : <small>{KIND.lesson}</small>}</td>
                <td><small>{topicName(l.package_topic_id)}</small></td><td><small>{l.note}</small></td>
                <td className="tools">{canEdit && <><button onClick={() => setEdit(l)}>Sửa</button><button className="danger" onClick={() => del(l)}>Xoá</button></>}</td>
              </tr>
            ))}
            {edit && !edit.id && formRow}
          </tbody>
        </table></div>
      )}
    </>
  )
}

// ================= Tiến độ dạy theo PPCT =================
const GAP_WARN = 3, GAP_BAD = 6
export function progressTone(p: Pick<Progress, 'taught' | 'gap' | 'total'>): { label: string; tone: '' | 'good' | 'warn' | 'bad' } {
  if (!p.total) return { label: 'Chưa soạn tiết', tone: '' }
  if (!p.taught) return { label: 'Chưa ghi nhận tiết dạy', tone: '' }
  if (p.gap >= GAP_BAD) return { label: `Chậm ${p.gap} tiết`, tone: 'bad' }
  if (p.gap >= GAP_WARN) return { label: `Chậm ${p.gap} tiết`, tone: 'warn' }
  if (p.gap < 0) return { label: `Vượt ${-p.gap} tiết`, tone: 'good' }
  return { label: 'Đúng tiến độ', tone: 'good' }
}

export function CurriculumProgress({ orgId, mode = 'school' }: { orgId: string | null; mode?: PpctMode }) {
  const [rows, setRows] = useState<Progress[] | null>(null)
  const [err, setErr] = useState('')
  const [school, setSchool] = useState('')
  const [grade, setGrade] = useState(0)
  const [subject, setSubject] = useState('')
  const [state, setState] = useState<'' | 'late' | 'ok' | 'none'>('')
  const [pickView, setView] = useState<'class' | 'school'>(mode === 'school' ? 'class' : 'school')
  useEffect(() => {
    supabase.rpc('curriculum_progress', { p_org: null }).then(({ data, error }) => {
      if (error) setErr(errText(error.message))
      setRows((data as Progress[]) ?? [])
    })
  }, [orgId])
  if (err) return <p className="msg">{err}</p>
  if (!rows) return <p className="sub">Đang tải…</p>

  const schools = [...new Map(rows.map(r => [r.org_id, r.school])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'))
  const multi = schools.length > 1
  const view = multi ? pickView : 'class'
  const grades = [...new Set(rows.map(r => r.grade))].sort((a, b) => a - b)
  const subjects = [...new Set(rows.map(r => r.subject))].sort((a, b) => a.localeCompare(b, 'vi'))
  const base = rows.filter(r => (!school || r.org_id === school) && (!grade || r.grade === grade) && (!subject || r.subject === subject))
  const tracked = base.filter(r => r.taught > 0 && r.total > 0)
  const late = tracked.filter(r => r.gap >= GAP_WARN)
  const shown = base.filter(r => !state || (state === 'late' ? r.taught > 0 && r.gap >= GAP_WARN : state === 'ok' ? r.taught > 0 && r.gap < GAP_WARN : !r.taught))
    .sort((a, b) => (state === 'late' ? b.gap - a.gap : 0))
  const week = rows.find(r => r.week)?.week
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

  const bySchool = schools.map(([id, name]) => {
    const rs = base.filter(r => r.org_id === id), tr = rs.filter(r => r.taught > 0 && r.total > 0)
    return { id, name, n: rs.length, tracked: tr.length, ok: tr.filter(r => r.gap < GAP_WARN).length, late: tr.filter(r => r.gap >= GAP_WARN).length,
      worst: tr.reduce((m, r) => Math.max(m, r.gap), 0) }
  }).filter(s => s.n)

  function exportRows() {
    downloadXlsx('Tien-do-PPCT', [
      ...(multi ? [{ key: 'sc', label: 'Trường', width: 28 }] : []), { key: 'c', label: 'Lớp' }, { key: 's', label: 'Môn', width: 18 },
      { key: 'w', label: 'Tuần' }, { key: 'p', label: 'Kế hoạch đến tuần này' }, { key: 'r', label: 'Đã dạy tới tiết' }, { key: 'g', label: 'Chênh lệch' },
      { key: 't', label: 'Tổng số tiết' }, { key: 'n', label: 'Số tiết đã ghi nhận' }, { key: 'l', label: 'Tiết gần nhất', width: 36 }, { key: 'st', label: 'Đánh giá', width: 20 },
    ], shown.map(r => [...(multi ? [r.school] : []), r.class_name, r.subject, r.week, r.planned, r.reached, r.gap, r.total, r.taught,
      r.last_title ? `${r.last_title} (${dmy(r.last_date)})` : '', progressTone(r).label]))
  }

  return (
    <>
      <p className="sub">So sánh tiết đã dạy (gắn khi giáo viên điểm danh) với kế hoạch trong PPCT đến hết tuần {week ?? '—'} của năm học.
        Chậm từ {GAP_WARN} tiết trở lên được đánh dấu.</p>
      <Tiles items={[
        { label: 'Lớp × môn có PPCT', value: base.length, sub: `${tracked.length} đã có tiết dạy ghi nhận` },
        { label: 'Đúng tiến độ', value: tracked.length - late.length, sub: `${pct(tracked.length - late.length, tracked.length)}%`, tone: 'good' },
        { label: `Chậm ≥ ${GAP_WARN} tiết`, value: late.length, sub: late.length ? `nhiều nhất ${Math.max(...late.map(r => r.gap))} tiết` : '', tone: late.length ? 'bad' : undefined },
        { label: 'Chưa ghi nhận', value: base.length - tracked.length, sub: 'chưa điểm danh tiết nào', tone: base.length - tracked.length ? 'warn' : undefined },
      ]} />
      <div className="bar">
        <div className="tools">
          {multi && <div className="segmented" style={{ margin: 0 }}>
            <button className={view === 'school' ? 'on' : ''} onClick={() => setView('school')}>Theo trường</button>
            <button className={view === 'class' ? 'on' : ''} onClick={() => setView('class')}>Theo lớp</button>
          </div>}
          {multi && <select value={school} onChange={e => { setSchool(e.target.value); if (e.target.value) setView('class') }} aria-label="Trường">
            <option value="">Mọi trường ({schools.length})</option>{schools.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>}
          <select value={grade} onChange={e => setGrade(Number(e.target.value))} aria-label="Khối"><option value={0}>Mọi khối</option>{grades.map(g => <option key={g} value={g}>Khối {g}</option>)}</select>
          <select value={subject} onChange={e => setSubject(e.target.value)} aria-label="Môn"><option value="">Mọi môn</option>{subjects.map(s => <option key={s}>{s}</option>)}</select>
          {view === 'class' && <select value={state} onChange={e => setState(e.target.value as any)} aria-label="Tình trạng">
            <option value="">Mọi tình trạng</option><option value="late">Chậm tiến độ</option><option value="ok">Đúng / vượt tiến độ</option><option value="none">Chưa ghi nhận</option></select>}
        </div>
        {view === 'class' && shown.length > 0 && <button onClick={exportRows}>Xuất Excel</button>}
      </div>
      {rows.length === 0 ? (
        <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có lớp nào có PPCT theo tiết. {mode === 'school' ? 'Soạn PPCT ở tab "Phân phối chương trình" (cùng khối, cùng tên môn với thời khoá biểu).' : 'Các trường cần soạn PPCT theo tiết.'}</p></div>
      ) : view === 'school' ? (
        <div className="wrap"><table>
          <thead><tr><th>Trường</th><th>Lớp × môn</th><th>Đã ghi nhận</th><th>Đúng tiến độ</th><th>Chậm ≥ {GAP_WARN} tiết</th><th>Chậm nhất</th><th></th></tr></thead>
          <tbody>{bySchool.map(s => (
            <tr key={s.id}><td><b>{s.name}</b></td><td>{s.n}</td><td>{s.tracked}</td>
              <td><div className="progress" style={{ width: 90, display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}><i style={{ width: pct(s.ok, s.tracked) + '%' }} /></div>{pct(s.ok, s.tracked)}%</td>
              <td>{s.late ? <span className="gpill bad">{s.late}</span> : 0}</td><td>{s.worst >= GAP_WARN ? `${s.worst} tiết` : '—'}</td>
              <td><button onClick={() => { setSchool(s.id); setView('class') }}>Xem lớp</button></td></tr>
          ))}</tbody>
        </table></div>
      ) : (
        <div className="wrap"><table>
          <thead><tr>{multi && <th>Trường</th>}<th>Lớp</th><th>Môn</th><th>Kế hoạch đến nay</th><th>Đã dạy tới</th><th>Tình trạng</th><th>Tiết gần nhất</th></tr></thead>
          <tbody>{shown.map(r => {
            const t = progressTone(r)
            return (
              <tr key={r.class_id + r.book_id}>
                {multi && <td><small>{r.school}</small></td>}
                <td><b>{r.class_name}</b></td><td>{r.subject}<br /><small>{r.book_title}</small></td>
                <td>Tiết {r.planned}<small> / {r.total}</small></td>
                <td>{r.taught ? <>Tiết {r.reached}<div className="progress" style={{ width: 110, marginTop: 4 }}><i style={{ width: pct(r.reached, r.total) + '%', background: t.tone === 'bad' ? 'var(--bad)' : t.tone === 'warn' ? '#fab219' : undefined }} /></div></> : '—'}</td>
                <td>{t.tone ? <span className={'gpill ' + t.tone}>{t.label}</span> : <small>{t.label}</small>}</td>
                <td>{r.last_title ? <><small>{r.last_title}</small><br /><small className="sub">{dmy(r.last_date)} · {r.taught} tiết đã ghi nhận</small></> : '—'}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
      )}
    </>
  )
}
