import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { MultiSelect } from '../components/MultiSelect'
import { supabase } from '../lib/supabase'
import { OrgFilter, OrgPick, useAllMode, useProvinceOf } from '../components/OrgScope'
import { useMultiFilters, MultiFilters, opts, type FilterDef } from '../components/MultiFilters'
import { downloadXlsx, importSummary, norm, type Column } from '../lib/sheet'
import ImportExcel from '../components/ImportExcel'
import { Tiles } from './department/charts'
import { uploadLearningFile, openFile } from '../lib/files'
import { GradePicker, SubjectPicker } from '../components/Pickers'
import { NameLink } from '../components/TableSel'
import { ElView } from '../components/ElView'

// Phân phối chương trình theo từng tiết + tiến độ dạy (migration 057; 058: học kỳ, liên kết chương trình chuẩn,
// gán lớp, gửi duyệt / công bố, nhật ký điều chỉnh, nội dung chưa hoàn thành, yêu cầu cần đạt, minh chứng).
//  • Trường: soạn / nhập Excel PPCT từng môn, sao chép mẫu của KDI hoặc cấp trên, xem tiến độ từng lớp.
//  • Sở / Phòng: soạn mẫu ban hành cho trường trực thuộc, xem tiến độ các trường.
//  • KDI: soạn mẫu dùng chung, xem tiến độ toàn hệ thống.
export type PpctMode = 'school' | 'authority' | 'platform'
export type Book = {
  id: string; org_id: string; grade: number; subject: string; title: string; total_periods: number | null; year_name: string | null
  periods_per_week: number | null; status: BookStatus; scope: 'own' | 'children'; source_id: string | null; note: string | null
  program_id?: string | null; organizations?: { name: string } | null; edu_programs?: { title: string; version_no: number } | null
}
export type BookStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'published'
type Lesson = {
  id: string; book_id: string; seq: number; week: number | null; term: number | null; title: string; kind: Kind; package_topic_id: string | null
  unit_id: string | null; note: string | null
}
type Unit = { id: string; parent_id: string | null; unit_type: 'topic' | 'lesson' | 'session'; seq: number; title: string }
type Kind = 'lesson' | 'stem' | 'practice' | 'review' | 'test'
type Topic = { id: string; title: string; program: string; stem_packages: { name: string } | null }
export type Progress = {
  org_id: string; school: string; class_id: string; class_name: string; grade: number; subject: string; book_id: string; book_title: string
  total: number; week: number | null; planned: number; reached: number; taught: number; last_title: string | null; last_date: string | null; gap: number
  area: string | null; missed: number; no_evidence: number; program_id: string | null
}
type LessonState = 'done' | 'before' | 'skipped' | 'late' | 'unrecorded' | 'due' | 'upcoming'
type LessonRow = {
  org_id: string; school: string; area: string | null; class_id: string; class_name: string; grade: number; subject: string; book_id: string; book_title: string
  lesson_id: string; seq: number; week: number | null; term: number | null; title: string; kind: Kind; unit_id: string | null; plan_week: number | null
  cur_week: number | null; state: LessonState; taught_on: string | null; teacher: string | null; evidence: number; needs_evidence: boolean
}
type Outcome = { book_id: string; outcome_id: string; code: string | null; content: string; competency_key: string | null; unit_title: string | null; lessons: number; done: number; state: 'done' | 'partial' | 'todo' | 'unplanned' }
type Evidence = { id: string; lesson_id: string; kind: string; url: string | null; path: string | null; file_name: string | null; note: string | null; created_at: string }
type Change = { id: number; seq: number | null; action: string; reason: string | null; reason_code: ReasonCode | null; before: any; after: any; changed_at: string }

export const KIND: Record<Kind, string> = { lesson: 'Bài học', stem: 'Chủ đề STEM', practice: 'Thực hành', review: 'Ôn tập', test: 'Kiểm tra' }
const KIND_PILL: Record<Kind, string> = { lesson: '', stem: 'good', practice: '', review: 'warn', test: 'bad' }
export const BOOK_STATUS: Record<BookStatus, [string, string]> = {
  draft: ['Nháp', ''], pending: ['Chờ duyệt', 'maintenance'], approved: ['Đã duyệt — chờ công bố', 'active'], rejected: ['Bị trả lại', 'inactive'], published: ['Đang dùng', 'active'],
}
const STATE: Record<LessonState, [string, string]> = {
  done: ['Đã dạy', 'good'], before: ['Trước khi ghi nhận', ''], skipped: ['Bị bỏ qua', 'bad'], late: ['Chậm kế hoạch', 'bad'], unrecorded: ['Chưa ghi nhận', ''], due: ['Tuần này', 'warn'], upcoming: ['Chưa đến', ''],
}
const termOf = (l: Pick<Lesson, 'term' | 'week'>) => l.term ?? (l.week ? (l.week <= 18 ? 1 : 2) : null)
const HK = (t: number | null) => (t === 1 ? 'HK I' : t === 2 ? 'HK II' : '—')
// Lý do điều chỉnh theo danh mục (074)
export type ReasonCode = 'holiday' | 'equipment' | 'reteach' | 'directive' | 'other'
export const REASONS: Record<ReasonCode, string> = {
  holiday: 'Nghỉ đột xuất (lễ, thời tiết, sự kiện)', equipment: 'Thiếu thiết bị / vật tư', reteach: 'Học sinh chưa đạt, cần dạy lại',
  directive: 'Theo chỉ đạo của cấp trên', other: 'Khác',
}
export type Reason = { code: ReasonCode; text: string }
// Hỏi lý do (mã + ghi chú). Trả về: undefined = PPCT chưa dùng, không cần lý do · null = huỷ · Reason
export function useReasonDialog() {
  const [st, setSt] = useState<{ what: string; code: ReasonCode; text: string; resolve: (r: Reason | null) => void } | null>(null)
  function ask(b: Pick<Book, 'status'>, what: string, always = false): Promise<Reason | null | undefined> {
    if (b.status !== 'published' && !always) return Promise.resolve(undefined)
    return new Promise(resolve => setSt({ what, code: 'other', text: '', resolve }))
  }
  const close = (r: Reason | null) => { st?.resolve(r); setSt(null) }
  const dialog = st && (
    <div className="modalbg" role="dialog" aria-modal="true" aria-label="Lý do điều chỉnh">
      <form className="modal" style={{ width: 'min(480px,100%)' }} onSubmit={e => { e.preventDefault(); close({ code: st.code, text: st.text.trim() }) }}>
        <div className="modalhead"><div><h3>Lý do {st.what}</h3><small>PPCT đang dùng — lý do được ghi vào nhật ký điều chỉnh.</small></div></div>
        <div className="modalbody">
          <label className="field"><span>Lý do</span><select value={st.code} onChange={e => setSt({ ...st, code: e.target.value as ReasonCode })} autoFocus>
            {(Object.keys(REASONS) as ReasonCode[]).map(k => <option key={k} value={k}>{REASONS[k]}</option>)}</select></label>
          <label className="field"><span>Ghi chú{st.code === 'other' ? ' *' : ''}</span><input value={st.text} required={st.code === 'other'} onChange={e => setSt({ ...st, text: e.target.value })} placeholder="VD: nghỉ 2 ngày do bão số 3" /></label>
        </div>
        <div className="modalfoot"><button type="button" onClick={() => close(null)}>Huỷ</button><button className="primary" type="submit">Ghi lý do</button></div>
      </form>
    </div>
  )
  return { ask, dialog }
}
const reasonText = (r: Reason) => r.text || REASONS[r.code]
export const errText = (m: string) => (/schema cache|does not exist|curriculum_lessons/i.test(m) && /exist|cache/i.test(m) ? 'Hãy chạy migration 057 trên Supabase.'
  : /row-level|42501/i.test(m) ? 'Bạn không có quyền sửa phân phối chương trình của đơn vị này.'
  : /duplicate|unique/i.test(m) ? 'Trùng số tiết — mỗi tiết trong một môn chỉ có một dòng.' : m)
const dmy = (d: string | null) => (d ? d.split('-').reverse().slice(0, 2).join('/') : '')
const numOrNull = (s: string) => { const n = Number(String(s).replace(',', '.')); return s.trim() && Number.isFinite(n) && n > 0 ? n : null }

// Có được sửa PPCT của đơn vị đang làm việc không
export function useCanEdit(mode: PpctMode) {
  const [ok, setOk] = useState(mode !== 'school')
  useEffect(() => {
    if (mode === 'school') Promise.all([supabase.rpc('has_perm', { p_module: 'curriculum', p_action: 'edit' }), supabase.rpc('is_platform_admin')])
      .then(([p, pa]) => setOk(!!p.data || !!pa.data))
  }, [mode])
  return ok
}

// ================= Danh sách môn / sách trong PPCT =================
export function CurriculumBooks({ orgId, mode = 'school', year, years }: { orgId: string | null; mode?: PpctMode; year?: { name: string } | null; years?: { name: string }[] }) {
  const yearNames = [...new Set((years ?? []).map(y => y.name))]
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
    let res = await supabase.from('curriculum_books').select('*, organizations(name), edu_programs(title, version_no)').order('grade').order('subject').order('title')
    if (res.error && /edu_programs|relationship/i.test(res.error.message)) res = await supabase.from('curriculum_books').select('*, organizations(name)').order('grade').order('subject').order('title')
    const { data, error } = res
    if (error) setMsg([errText(error.message), true])
    const all = (data as Book[]) ?? []
    setBooks(all); setLoaded(true)
    setOpen(o => (o ? all.find(b => b.id === o.id) ?? null : null))
  }
  useEffect(() => { load() }, [orgId])

  // Quản trị hệ thống: PPCT của mọi đơn vị trong một danh sách, sửa thẳng; thêm mới chọn đơn vị trong form
  const every = useAllMode()
  const [fo, setFo] = useState('')
  const own = every ? books.filter(b => !fo || b.org_id === fo) : books.filter(b => b.org_id === orgId)
  const templates = every ? [] : books.filter(b => b.org_id !== orgId && b.scope === 'children' && b.status === 'published')
  const grades = [...new Set(own.map(b => b.grade))].sort((a, b) => a - b)
  const subjects = [...new Set(own.map(b => b.subject))].sort((a, b) => a.localeCompare(b, 'vi'))
  const shown = own.filter(b => (!grade || b.grade === grade) && (!subject || b.subject === subject) && (!q || norm(b.title + ' ' + b.subject).includes(norm(q))))

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return
    const row = {
      org_id: form.org_id || orgId, grade: Number(form.grade), subject: (form.subject ?? '').trim(), title: (form.title ?? '').trim() || `${(form.subject ?? '').trim()} ${form.grade}`,
      year_name: form.year_name?.trim() || null, periods_per_week: form.periods_per_week ? Number(String(form.periods_per_week).replace(',', '.')) : null,
      status: form.status ?? 'published', scope: mode === 'school' ? 'own' : form.scope ?? 'children', note: form.note?.trim() || null,
      ...(form.id ? {} : { total_periods: form.total_periods ? Number(form.total_periods) : null }),
    }
    if (!row.subject || !row.grade) return setMsg(['Nhập khối và môn học.', true])
    const { error } = form.id ? await supabase.from('curriculum_books').update(row).eq('id', form.id) : await supabase.from('curriculum_books').insert(row)
    if (error) return setMsg([errText(error.message), true])
    setForm(null); setMsg([form.id ? 'Đã lưu thông tin môn.' : 'Đã thêm môn — bấm vào tên môn để soạn từng tiết.', false]); load()
  }
  async function remove(b: Book) {
    if (!confirm(`Xoá PPCT "${b.title}" và toàn bộ các tiết? Tiết dạy đã gắn với PPCT này sẽ bỏ liên kết.`)) return
    const { error } = await supabase.from('curriculum_books').delete().eq('id', b.id)
    if (error) return setMsg([errText(error.message), true])
    setOpen(null); setMsg(['Đã xoá.', false]); load()
  }
  async function setStatus(b: Book, status: BookStatus, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return
    const { error } = await supabase.from('curriculum_books').update({ status }).eq('id', b.id)
    if (error) return setMsg([errText(error.message), true])
    setMsg([status === 'pending' ? `Đã gửi duyệt "${b.title}" — người duyệt nhận được trong Hộp phê duyệt.` : status === 'published' ? `Đã công bố "${b.title}" — lớp bắt đầu theo dõi tiến độ theo PPCT này.` : 'Đã cập nhật.', false]); load()
  }
  async function decide(b: Book, decision: 'approve' | 'reject') {
    const note = decision === 'reject' ? prompt('Lý do trả lại (người soạn sẽ thấy):', '') : ''
    if (note === null) return
    const { error } = await supabase.rpc('approval_decide_ref', { p_table: 'curriculum_books', p_ref: b.id, p_decision: decision, p_note: note || null })
    if (error) return setMsg([errText(error.message), true])
    setMsg([decision === 'approve' ? `Đã duyệt "${b.title}". Bấm "Công bố" để áp dụng.` : `Đã trả lại "${b.title}".`, false]); load()
  }
  async function copy(t: Book) {
    const dup = own.find(b => b.grade === t.grade && norm(b.subject) === norm(t.subject) && (b.year_name ?? '') === (year?.name ?? t.year_name ?? ''))
    if (dup && !confirm(`Đơn vị đã có PPCT "${dup.title}" cùng khối, cùng môn. Vẫn sao chép thêm một bản?`)) return
    const { data, error } = await supabase.rpc('curriculum_copy', { p_book: t.id, p_year: mode === 'school' ? year?.name ?? null : null, p_org: orgId })
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

  const scopeLabel = mode === 'platform' ? 'Mẫu cho mọi trường' : 'Ban hành cho đơn vị trực thuộc'
  // Nút thao tác của một PPCT, đặt ở trang chi tiết (không tick chọn ở danh sách)
  const bookActions = (b: Book): ReactNode => canEdit && (b.org_id === orgId || !!every) ? <>
    {mode === 'school' && (b.status === 'draft' || b.status === 'rejected') && <button onClick={() => setStatus(b, 'pending')}>Gửi duyệt</button>}
    {b.status === 'pending' && <><button onClick={() => decide(b, 'approve')}>Duyệt</button><button onClick={() => decide(b, 'reject')}>Trả lại</button></>}
    {b.status === 'approved' && <button className="primary" onClick={() => setStatus(b, 'published', `Công bố "${b.title}"? Lớp cùng khối sẽ theo dõi tiến độ theo PPCT này.`)}>Công bố</button>}
    <button disabled={b.status === 'pending'} onClick={() => { setMsg(null); setForm(b) }}>Sửa thông tin PPCT</button>
    <button className="danger" disabled={b.status === 'pending'} onClick={() => remove(b)}>Xoá PPCT</button>
  </> : null

  // Thêm / sửa: trang riêng
  if (form) return <ElView back={open ? open.title : 'Danh sách môn'} onBack={() => setForm(null)} title={form.id ? `Sửa PPCT: ${form.title}` : 'Thêm môn vào phân phối chương trình'}>
    {msg && msg[1] && <p className="msg" role="status"><b>{msg[0]}</b></p>}
        <form className="panel formgrid" onSubmit={save} style={{ marginBottom: 12 }}>
          {!form.id && <OrgPick kind="any" value={form.org_id ?? orgId ?? ''} onChange={v => setForm({ ...form, org_id: v })} />}
          <label className="field"><span>Khối *</span><GradePicker value={form.grade} onChange={g => setForm({ ...form, grade: g ?? undefined })} emptyLabel="— Chọn khối —" /></label>
          <label className="field"><span>Môn học *</span><SubjectPicker required value={form.subject} onChange={v => setForm({ ...form, subject: v })} extra={subjects} /></label>
          <label className="field"><span>Tên PPCT</span><input value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Tin học 6 — Kết nối tri thức" /></label>
          {mode === 'school' && yearNames.length > 0
            ? <label className="field"><span>Năm học *</span><select value={form.year_name ?? ''} onChange={e => setForm({ ...form, year_name: e.target.value })}>
                {!yearNames.includes(form.year_name ?? '') && <option value={form.year_name ?? ''}>{form.year_name || '— Năm học hiện tại —'}</option>}
                {yearNames.map(n => <option key={n}>{n}</option>)}</select></label>
            : <label className="field"><span>Năm học</span><input value={form.year_name ?? ''} onChange={e => setForm({ ...form, year_name: e.target.value })} placeholder={mode === 'school' ? 'Để trống: năm học hiện tại' : 'Để trống: dùng mọi năm'} /></label>}
          <label className="field"><span>Số tiết / tuần</span><input inputMode="decimal" value={form.periods_per_week ?? ''} onChange={e => setForm({ ...form, periods_per_week: e.target.value as any })} placeholder="VD: 1 hoặc 1,5" /></label>
          {!form.id && <label className="field"><span>Tổng số tiết (dự kiến)</span><input type="number" min={0} value={form.total_periods ?? ''} onChange={e => setForm({ ...form, total_periods: Number(e.target.value) || null })} placeholder="Tự cập nhật khi soạn tiết" /></label>}
          {(!form.id || form.status === 'draft' || form.status === 'published') && <label className="field"><span>Trạng thái</span><select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as Book['status'] })}>
            <option value="published">{mode === 'school' ? 'Đang dùng (công bố ngay)' : 'Đã ban hành'}</option><option value="draft">Nháp{mode === 'school' ? ' (gửi duyệt sau)' : ''}</option></select></label>}
          {mode !== 'school' && <label className="field"><span>Phạm vi</span><select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value as Book['scope'] })}>
            <option value="children">{scopeLabel}</option><option value="own">Chỉ đơn vị mình</option></select></label>}
          <label className="field" style={{ gridColumn: '1/-1' }}><span>Ghi chú</span><input value={form.note ?? ''} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
          <div className="formactions"><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
  </ElView>
  // Xem chi tiết (soạn tiết) kèm nút Sửa / Xoá / duyệt
  if (open) return <>{msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    <LessonEditor book={open} canEdit={canEdit && (open.org_id === orgId || !!every)} mode={mode} actions={bookActions(open)} onClose={() => { setOpen(null); setMsg(null); load() }} onChanged={load} /></>

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
          <OrgFilter ids={books.map(b => b.org_id)} value={fo} onChange={setFo} />
        </div>
        <div className="tools">
          {canEdit && templates.length > 0 && <button onClick={() => setShowTpl(v => !v)}>{showTpl ? 'Ẩn mẫu' : `Dùng mẫu (${templates.length})`}</button>}
          {shown.length > 0 && <button onClick={exportList}>Xuất Excel</button>}
          {canEdit && <button className="primary" onClick={() => { setMsg(null); setForm({ grade: grade || undefined, subject, status: 'published', scope: mode === 'school' ? 'own' : 'children', year_name: mode === 'school' ? year?.name ?? '' : '' }) }}>Thêm môn</button>}
        </div>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}


      {showTpl && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <h3 style={{ margin: '0 0 8px' }}>Mẫu PPCT từ KDI và cấp trên</h3>
          <div className="wrap"><table>
            <thead><tr><th>Khối</th><th>Môn</th><th>Tên mẫu</th><th>Số tiết</th><th>Ban hành bởi</th><th></th></tr></thead>
            <tbody>{templates.map(t => (
              <tr key={t.id} className="clickrow" onClick={() => setOpen(t)}>
                <td>{t.grade}</td><td>{t.subject}</td><td><NameLink onClick={() => setOpen(t)}>{t.title}</NameLink>{t.note && <><br /><small>{t.note}</small></>}</td>
                <td>{t.total_periods ?? '—'}</td><td>{t.organizations?.name ?? '—'}</td>
                <td onClick={e => e.stopPropagation()}><button className="primary" onClick={() => copy(t)}>Sao chép</button></td></tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      {!loaded ? <p className="sub">Đang tải…</p> : own.length === 0 ? (
        <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có môn nào trong phân phối chương trình.
          {canEdit && (templates.length ? ' Bấm "Dùng mẫu" để sao chép PPCT mẫu, hoặc "Thêm môn" để tự soạn.' : ' Bấm "Thêm môn" để bắt đầu.')}</p></div>
      ) : (
        <><div className="wrap"><table>
          <thead><tr><th>Khối</th><th>Môn</th><th>Tên PPCT</th><th>Năm học</th><th>Số tiết</th><th>Tiết/tuần</th><th>Trạng thái</th></tr></thead>
          <tbody>{shown.map(b => (
            <tr key={b.id} className="clickrow" onClick={() => { setMsg(null); setOpen(b) }}>
              <td>{b.grade}</td><td>{b.subject}</td>
              <td><NameLink onClick={() => { setMsg(null); setOpen(b) }} title="Xem chi tiết">{b.title}</NameLink>{every && <><br /><small className="sub">{b.organizations?.name ?? '—'}</small></>}{b.edu_programs && <><br /><small>Theo chương trình: {b.edu_programs.title} (v{b.edu_programs.version_no})</small></>}
                {b.source_id && <><br /><small>Sao chép từ mẫu</small></>}{mode !== 'school' && b.scope === 'children' && <><br /><small>{scopeLabel}</small></>}</td>
              <td>{b.year_name ?? 'Mọi năm'}</td><td>{b.total_periods ?? '—'}</td><td>{b.periods_per_week ?? '—'}</td>
              <td><span className={'pill ' + BOOK_STATUS[b.status][1]}>{b.status === 'published' && mode !== 'school' ? 'Đã ban hành' : BOOK_STATUS[b.status][0]}</span></td>
            </tr>
          ))}</tbody>
        </table></div></>
      )}
    </>
  )
}

// ================= Soạn từng tiết của một môn =================
const IMPORT: Column[] = [
  { key: 'seq', label: 'Tiết', required: true, aliases: ['Tiết thứ', 'STT', 'Số tiết'] },
  { key: 'week', label: 'Tuần' },
  { key: 'term', label: 'Học kỳ', aliases: ['HK', 'Kỳ'] },
  { key: 'title', label: 'Tên bài / nội dung', required: true, aliases: ['Tên bài', 'Bài học', 'Nội dung', 'Tên bài học'], width: 44 },
  { key: 'kind', label: 'Loại tiết', aliases: ['Loại'], width: 14 },
  { key: 'unit', label: 'Bài trong chương trình', aliases: ['Bài trong CT', 'Học phần / bài', 'Chủ đề / bài'], width: 32 },
  { key: 'topic', label: 'Chủ đề STEM', aliases: ['Chủ đề'], width: 28 },
  { key: 'note', label: 'Ghi chú', width: 24 },
]
const kindOf = (s: string): Kind => {
  const n = norm(s)
  if (!n) return 'lesson'
  return (Object.keys(KIND) as Kind[]).find(k => norm(KIND[k]) === n || n.includes(norm(KIND[k]).split(' ')[0])) ?? (n.includes('stem') ? 'stem' : 'lesson')
}
const termIn = (s: string): number | null => { const n = norm(s); return !n ? null : /(^| )(2|ii)( |$)/.test(n) ? 2 : /(^| )(1|i)( |$)/.test(n) ? 1 : null }
const ACTION: Record<string, string> = { insert: 'Thêm tiết', update: 'Sửa tiết', delete: 'Xoá tiết', import: 'Nhập lại / sinh lại cả môn', reschedule: 'Xếp lại lịch',
  shift: 'Dời tiết', swap: 'Đổi chỗ hai tiết', makeup: 'Chèn tiết dạy bù', version: 'Lưu phiên bản', publish: 'Công bố' }

export function LessonEditor({ book, canEdit, mode, actions, onClose, onChanged }: { book: Book; canEdit: boolean; mode: PpctMode; actions?: ReactNode; onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<Lesson[] | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [weekStart, setWeekStart] = useState<Map<number, string>>(new Map())
  const [edit, setEdit] = useState<Partial<Lesson> | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<'' | 'classes' | 'log' | 'adjust' | 'versions'>('')
  const [term, setTerm] = useState(0)
  const { ask, dialog } = useReasonDialog()
  async function load() {
    const [l, t, u, y] = await Promise.all([
      supabase.from('curriculum_lessons').select('*').eq('book_id', book.id).order('seq'),
      canEdit ? supabase.from('package_topics').select('id, title, program, stem_packages(name)').eq('org_id', book.org_id).order('seq') : Promise.resolve({ data: [] }),
      book.program_id ? supabase.from('edu_program_units').select('id, parent_id, unit_type, seq, title').eq('program_id', book.program_id).order('seq') : Promise.resolve({ data: [] }),
      book.year_name ? supabase.rpc('curriculum_calendar', { p_org: book.org_id, p_year: book.year_name }) : Promise.resolve({ data: [] }),
    ])
    if ('error' in l && l.error) setMsg([errText(l.error.message), true])
    setRows((l.data as Lesson[]) ?? []); setTopics(((t as any).data as Topic[]) ?? []); setUnits(((u as any).data as Unit[]) ?? [])
    const cal = ((y as any).data as { week: number | null; starts_on: string }[]) ?? []
    setWeekStart(new Map(cal.filter(c => c.week != null).map(c => [c.week as number, c.starts_on])))
  }
  useEffect(() => { load() }, [book.id])
  const topicName = (id: string | null) => (id ? topics.find(t => t.id === id)?.title ?? 'Chủ đề STEM' : '')
  // Bài trong chương trình: tên kèm học phần cha để dễ chọn
  const unitLabel = useMemo(() => {
    const by = new Map(units.map(u => [u.id, u]))
    return (id: string | null) => {
      const u = id ? by.get(id) : undefined; if (!u) return ''
      const p = u.parent_id ? by.get(u.parent_id) : undefined
      return p && u.unit_type === 'session' ? `${p.title} · ${u.title}` : u.title
    }
  }, [units])
  const unitOptions = useMemo(() => {
    const out: [string, string][] = []
    const walk = (pid: string | null, depth: number) => units.filter(u => u.parent_id === pid).sort((a, b) => a.seq - b.seq)
      .forEach(u => { out.push([u.id, ' '.repeat(depth * 3) + u.title]); walk(u.id, depth + 1) })
    walk(null, 0); return out
  }, [units])
  const ppw = Number(book.periods_per_week) || 0
  // Tháng dự kiến của một tuần (theo lịch tuần học của năm học, đã bỏ tuần nghỉ)
  const monthOf = (week: number | null) => {
    const st = week ? weekStart.get(week) : undefined
    if (!st) return ''
    const d = new Date(st + 'T00:00:00'); d.setDate(d.getDate() + 2)
    return `T${d.getMonth() + 1}`
  }

  async function saveRow(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return
    const seq = Number(edit.seq)
    if (!seq || seq < 1) return setMsg(['Số tiết không hợp lệ.', true])
    const reason = await ask(book, edit.id ? 'sửa tiết' : 'thêm tiết')
    if (reason === null) return
    const row = { book_id: book.id, seq, week: edit.week ? Number(edit.week) : (ppw ? Math.ceil(seq / ppw) : null), term: edit.term || null, title: (edit.title ?? '').trim(),
      kind: edit.kind ?? 'lesson', package_topic_id: edit.package_topic_id || null, unit_id: edit.unit_id || null, note: edit.note?.trim() || null,
      ...(reason ? { change_reason: reasonText(reason), change_reason_code: reason.code } : {}) }
    if (!row.title) return setMsg(['Nhập tên bài / nội dung tiết.', true])
    const { error } = edit.id ? await supabase.from('curriculum_lessons').update(row).eq('id', edit.id) : await supabase.from('curriculum_lessons').insert(row)
    if (error) return setMsg([errText(error.message), true])
    setEdit(null); setMsg(null); await load(); onChanged()
  }
  async function del(l: Lesson) {
    if (!confirm(`Xoá tiết ${l.seq}: "${l.title}"?`)) return
    const reason = await ask(book, 'xoá tiết')
    if (reason === null) return
    if (reason) await supabase.from('curriculum_lessons').update({ change_reason: reasonText(reason), change_reason_code: reason.code }).eq('id', l.id)
    const { error } = await supabase.from('curriculum_lessons').delete().eq('id', l.id)
    if (error) return setMsg([errText(error.message), true])
    await load(); onChanged()
  }
  async function autoWeeks() {
    if (!ppw) return setMsg(['Nhập "Số tiết / tuần" của môn (nút Sửa ở danh sách) để tự chia tuần.', true])
    if (!confirm(`Đặt lại tuần cho mọi tiết theo ${ppw} tiết/tuần (tiết 1–${ppw} → tuần 1…)? Học kỳ tính lại theo tuần (tuần 1–18: HK I).`)) return
    const reason = await ask(book, 'chia lại tuần')
    if (reason === null) return
    setBusy(true)
    const list = rows ?? []
    const res = await Promise.all(list.map(l => supabase.from('curriculum_lessons').update({ week: Math.ceil(l.seq / ppw), ...(reason ? { change_reason: reasonText(reason), change_reason_code: reason.code } : {}) }).eq('id', l.id)))
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
      const un = r.unit.trim() ? units.find(u => norm(u.title) === norm(r.unit) || norm(unitLabel(u.id)) === norm(r.unit)) : undefined
      if (r.unit.trim() && !un) bad.push(`dòng ${r._line}: không có bài "${r.unit}" trong chương trình — bỏ qua cột này`)
      const week = numOrNull(r.week)
      return [{ seq, week: week ? Math.round(week) : (ppw ? Math.ceil(seq / ppw) : null), term: termIn(r.term), title: r.title.trim(),
        kind: tp ? 'stem' : kindOf(r.kind), package_topic_id: tp?.id ?? null, unit_id: un?.id ?? null, note: r.note.trim() || null }]
    })
    if (!data.length) return importSummary(0, 'tiết', bad)
    if ((rows?.length ?? 0) > 0 && !confirm(`Môn này đã có ${rows!.length} tiết. Thay toàn bộ bằng ${data.length} tiết trong file?\n(Tiết dạy đã gắn với tiết cũ sẽ bỏ liên kết.)`)) return 'Đã huỷ nhập.'
    const reason = await ask(book, 'nhập lại cả môn')
    if (reason === null) return 'Đã huỷ nhập.'
    const { error } = await supabase.rpc('curriculum_replace_lessons', { p_book: book.id, p_rows: data, p_reason: reason ? reasonText(reason) : null, p_reason_code: reason?.code ?? null })
    if (error) return errText(error.message)
    await load(); onChanged()
    return importSummary(data.length, 'tiết', bad)
  }
  function exportRows() {
    downloadXlsx(`PPCT ${book.title}`, IMPORT, (rows ?? []).map(l => [l.seq, l.week, HK(termOf(l)), l.title, KIND[l.kind], unitLabel(l.unit_id), topicName(l.package_topic_id), l.note]), book.title)
  }

  const counts = useMemo(() => (rows ?? []).reduce((m, l) => ({ ...m, [l.kind]: (m[l.kind] ?? 0) + 1 }), {} as Record<string, number>), [rows])
  const weeks = new Set((rows ?? []).map(l => l.week).filter(Boolean)).size
  const t1 = (rows ?? []).filter(l => termOf(l) === 1).length, t2 = (rows ?? []).filter(l => termOf(l) === 2).length
  const shownRows = (rows ?? []).filter(l => !term || termOf(l) === term)
  const hasUnits = units.length > 0
  const formRow = (
    <tr>
      <td><input type="number" min={1} required value={edit?.seq ?? ''} onChange={e => setEdit({ ...edit, seq: Number(e.target.value) })} aria-label="Tiết" style={{ width: 64 }} /></td>
      <td><input type="number" min={1} max={52} value={edit?.week ?? ''} onChange={e => setEdit({ ...edit, week: Number(e.target.value) || null })} aria-label="Tuần" style={{ width: 64 }} placeholder={ppw && edit?.seq ? String(Math.ceil(Number(edit.seq) / ppw)) : ''} /></td>
      <td><select value={edit?.term ?? ''} onChange={e => setEdit({ ...edit, term: Number(e.target.value) || null })} aria-label="Học kỳ">
        <option value="">Theo tuần</option><option value={1}>HK I</option><option value={2}>HK II</option></select></td>
      <td>{monthOf(edit?.week ?? (ppw && edit?.seq ? Math.ceil(Number(edit.seq) / ppw) : null))}</td>
      <td><input required value={edit?.title ?? ''} onChange={e => setEdit({ ...edit, title: e.target.value })} aria-label="Tên bài" placeholder="VD: Bài 3. Thông tin trong máy tính" autoFocus style={{ width: '100%', minWidth: 220 }} /></td>
      {hasUnits && <td><select value={edit?.unit_id ?? ''} onChange={e => setEdit({ ...edit, unit_id: e.target.value || null })} aria-label="Bài trong chương trình" style={{ maxWidth: 220 }}>
        <option value="">—</option>{unitOptions.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></td>}
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
          <button className="linkbtn" onClick={onClose}>← Danh sách môn</button>
          <h3 style={{ margin: '4px 0 0' }}>{book.title} <span className={'pill ' + BOOK_STATUS[book.status][1]}>{BOOK_STATUS[book.status][0]}</span></h3>
          <small className="sub">Khối {book.grade} · {book.subject} · {book.year_name ?? 'mọi năm học'}{ppw ? ` · ${ppw} tiết/tuần` : ''}
            {book.edu_programs ? ` · theo chương trình ${book.edu_programs.title} (v${book.edu_programs.version_no})` : ''}
            {!canEdit && book.scope === 'children' && book.organizations?.name && mode === 'school' ? ` · mẫu của ${book.organizations.name}` : ''}</small>
          {actions && <div className="tools" style={{ marginTop: 8 }}>{actions}</div>}
        </div>
        <div className="tools">
          {canEdit && <ImportExcel columns={IMPORT} template={`Mau-PPCT-${book.subject}-${book.grade}`}
            sample={[['1', '1', 'HK I', 'Bài 1. Thông tin và dữ liệu', 'Bài học', '', '', ''], ['2', '1', 'HK I', 'Bài 1. Thông tin và dữ liệu (tiếp)', 'Bài học', '', '', ''], ['9', '9', 'HK I', 'Kiểm tra giữa học kì I', 'Kiểm tra', '', '', '']]}
            onRecords={importRows} onMessage={(m, isErr) => setMsg([m, !!isErr])} />}
          {(rows?.length ?? 0) > 0 && <button onClick={exportRows}>Tải Excel</button>}
          {canEdit && (rows?.length ?? 0) > 0 && <button onClick={autoWeeks} disabled={busy}>Tự chia tuần</button>}
          {mode === 'school' && <button onClick={() => setPanel(panel === 'classes' ? '' : 'classes')}>Áp dụng cho lớp</button>}
          {canEdit && (rows?.length ?? 0) > 0 && <button onClick={() => setPanel(panel === 'adjust' ? '' : 'adjust')}>Điều chỉnh hàng loạt</button>}
          <button onClick={() => setPanel(panel === 'versions' ? '' : 'versions')}>Phiên bản</button>
          <button onClick={() => setPanel(panel === 'log' ? '' : 'log')}>Nhật ký điều chỉnh</button>
          {canEdit && <button className="primary" onClick={() => setEdit({ seq: (rows?.length ? rows[rows.length - 1].seq : 0) + 1, kind: 'lesson' })}>Thêm tiết</button>}
        </div>
      </div>
      {rows && rows.length > 0 && <Tiles items={[
        { label: 'Số tiết', value: rows.length, sub: weeks ? `${weeks} tuần` : 'chưa chia tuần' },
        { label: 'Học kỳ I · II', value: `${t1} · ${t2}`, sub: rows.length - t1 - t2 ? `${rows.length - t1 - t2} tiết chưa có tuần` : undefined },
        { label: 'Chủ đề STEM', value: counts.stem ?? 0, tone: counts.stem ? 'good' : undefined },
        { label: 'Ôn tập · Kiểm tra', value: `${counts.review ?? 0} · ${counts.test ?? 0}` },
      ]} />}
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {panel === 'classes' && <BookClasses book={book} canEdit={canEdit} onMsg={setMsg} />}
      {panel === 'log' && <ChangeLog bookId={book.id} />}
      {panel === 'adjust' && <AdjustPanel book={book} rows={rows ?? []} ask={ask} onDone={async m => { setMsg([m, false]); await load(); onChanged() }} onError={m => setMsg([m, true])} />}
      {panel === 'versions' && <Versions book={book} rows={rows ?? []} canEdit={canEdit} ask={ask} />}
      {dialog}
      {rows && rows.length > 0 && <div className="segmented" style={{ margin: '0 0 8px' }}>
        {[0, 1, 2].map(t => <button key={t} className={term === t ? 'on' : ''} onClick={() => setTerm(t)}>{t ? HK(t) : 'Cả năm'}</button>)}
      </div>}
      <form id="ppct-row" onSubmit={saveRow} />
      {!rows ? <p className="sub">Đang tải…</p> : rows.length === 0 && !edit ? (
        <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có tiết nào.{canEdit && ' Bấm "Thêm tiết", hoặc "Nhập Excel" (bấm "Tải file mẫu" để có file đúng cột).'}</p></div>
      ) : (
        <>
        <div className="wrap"><table>
          <thead><tr><th>Tiết</th><th>Tuần</th><th>HK</th><th>Tháng</th><th>Tên bài / nội dung</th>{hasUnits && <th>Bài trong chương trình</th>}<th>Loại</th><th>Chủ đề STEM</th><th>Ghi chú</th>{canEdit && <th></th>}</tr></thead>
          <tbody>
            {shownRows.map(l => edit?.id === l.id ? <Fragment key={l.id}>{formRow}</Fragment> : (
              <tr key={l.id}>
                <td><b>{l.seq}</b></td><td>{l.week ?? '—'}</td><td><small>{HK(termOf(l))}</small></td><td><small>{monthOf(l.week)}</small></td><td>{l.title}</td>
                {hasUnits && <td><small>{unitLabel(l.unit_id)}</small></td>}
                <td>{l.kind !== 'lesson' ? <span className={'gpill ' + KIND_PILL[l.kind]}>{KIND[l.kind]}</span> : <small>{KIND.lesson}</small>}</td>
                <td><small>{topicName(l.package_topic_id)}</small></td><td><small>{l.note}</small></td>{canEdit && <td className="tools" style={{ whiteSpace: 'nowrap' }}><button type="button" onClick={() => setEdit(l)}>Sửa</button><button type="button" className="danger" onClick={() => del(l)}>Xoá</button></td>}
              </tr>
            ))}
            {edit && !edit.id && formRow}
          </tbody>
        </table></div></>
      )}
    </>
  )
}

// PPCT áp dụng cho lớp nào (không chọn = mọi lớp cùng khối)
function BookClasses({ book, canEdit, onMsg }: { book: Book; canEdit: boolean; onMsg: (m: [string, boolean]) => void }) {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [sel, setSel] = useState<Set<string> | null>(null)
  async function load() {
    const [c, x] = await Promise.all([
      supabase.from('classes').select('id, name').eq('org_id', book.org_id).eq('grade', book.grade).order('name'),
      supabase.from('curriculum_book_classes').select('class_id').eq('book_id', book.id),
    ])
    setClasses((c.data as { id: string; name: string }[]) ?? []); setSel(new Set(((x.data as { class_id: string }[]) ?? []).map(r => r.class_id)))
  }
  useEffect(() => { load() }, [book.id])
  async function toggle(id: string, on: boolean) {
    const { error } = on ? await supabase.from('curriculum_book_classes').insert({ book_id: book.id, class_id: id })
      : await supabase.from('curriculum_book_classes').delete().eq('book_id', book.id).eq('class_id', id)
    if (error) return onMsg([errText(error.message), true])
    load()
  }
  if (!sel) return null
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <b>Áp dụng cho lớp</b> <small className="sub">{sel.size ? `${sel.size} lớp được chọn — các lớp khác dùng PPCT chung của khối (nếu có).` : `Mọi lớp khối ${book.grade} (chưa chọn lớp riêng).`}</small>
      <div style={{ marginTop: 8, maxWidth: 640 }}>
        <MultiSelect disabled={!canEdit} value={[...sel]} options={classes.map(c => [c.id, c.name])} placeholder={`Mọi lớp khối ${book.grade}`} ariaLabel="Áp dụng cho lớp"
          empty={`Trường chưa có lớp khối ${book.grade}.`}
          onChange={async v => { for (const id of v.filter(x => !sel.has(x))) await toggle(id, true); for (const id of [...sel].filter(x => !v.includes(x))) await toggle(id, false) }} />
      </div>
    </div>
  )
}

function ChangeLog({ bookId }: { bookId: string }) {
  const [rows, setRows] = useState<Change[] | null>(null)
  useEffect(() => {
    supabase.from('curriculum_changes').select('*').eq('book_id', bookId).order('changed_at', { ascending: false }).limit(200)
      .then(({ data }) => setRows((data as Change[]) ?? []))
  }, [bookId])
  if (!rows) return null
  const desc = (v: any) => (v ? `T${v.seq} · tuần ${v.week ?? '—'} · ${v.title}` : '')
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <b>Nhật ký điều chỉnh</b> <small className="sub">Ghi lại khi sửa PPCT đang dùng.</small>
      {rows.length === 0 ? <p className="sub" style={{ margin: '6px 0 0' }}>Chưa có điều chỉnh nào.</p> : (
        <div className="wrap" style={{ marginTop: 8 }}><table>
          <thead><tr><th>Thời gian</th><th>Thao tác</th><th>Trước</th><th>Sau</th><th>Lý do</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}><td><small>{new Date(r.changed_at).toLocaleString('vi-VN')}</small></td><td>{ACTION[r.action] ?? r.action}</td>
              <td><small>{['insert', 'update', 'delete'].includes(r.action) ? desc(r.before) : ''}</small></td>
              <td><small>{['insert', 'update', 'delete'].includes(r.action) ? desc(r.after) : r.after?.count != null ? `${r.after.count} tiết` : r.after?.version ? `v${r.after.version}` : ''}</small></td>
              <td>{r.reason_code && <span className="gpill">{REASONS[r.reason_code]}</span>} {r.reason ?? (!r.reason_code && <small className="sub">không ghi</small>)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
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
  const f = useMultiFilters(), provOf = useProvinceOf()
  const [progNames, setProgNames] = useState<Map<string, string>>(new Map())
  const [pickView, setView] = useState<'class' | 'school' | 'area'>(mode === 'school' ? 'class' : 'school')
  const [detail, setDetail] = useState<Progress | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.rpc('curriculum_progress', { p_org: null }).then(({ data, error }) => {
      if (error) setErr(errText(error.message))
      const rs = (data as Progress[]) ?? []
      setRows(rs)
      const ids = [...new Set(rs.map(r => r.program_id).filter(Boolean))] as string[]
      if (ids.length) supabase.from('edu_programs').select('id, title').in('id', ids).then(({ data: ps }) =>
        setProgNames(new Map(((ps ?? []) as { id: string; title: string }[]).map(p => [p.id, p.title]))))
    })
  }, [orgId])
  if (err) return <p className="msg">{err}</p>
  if (!rows) return <p className="sub">Đang tải…</p>
  if (detail) return <ClassDetail row={detail} mode={mode} onClose={() => setDetail(null)} />

  const schools = [...new Map(rows.map(r => [r.org_id, r.school])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'))
  const multi = schools.length > 1
  const view = multi ? pickView : 'class'
  const grades = [...new Set(rows.map(r => r.grade))].sort((a, b) => a - b)
  const subjects = [...new Set(rows.map(r => r.subject))].sort((a, b) => a.localeCompare(b, 'vi'))
  const fit = (r: Progress, skip?: string) => (skip === 'prov' || f.has('prov', provOf(r.org_id)?.id)) && (skip === 'school' || f.has('school', r.org_id))
    && f.has('prog', r.program_id) && f.has('grade', r.grade) && f.has('subj', r.subject)
  const base = rows.filter(r => fit(r))
  const states = f.get('state')
  const stateOk = (r: Progress) => !states.length || states.some(st => st === 'late' ? r.taught > 0 && r.gap >= GAP_WARN : st === 'ok' ? r.taught > 0 && r.gap < GAP_WARN
    : st === 'missed' ? r.missed > 0 : st === 'evidence' ? r.no_evidence > 0 : !r.taught)
  const provs = opts(rows.map(r => { const p = provOf(r.org_id); return [p?.id, p?.name] }))
  const defs: FilterDef[] = [
    { key: 'prov', label: 'Tỉnh', placeholder: 'Mọi tỉnh', options: provs, hidden: !multi || provs.length < 2 },
    { key: 'school', label: 'Trường', placeholder: `Mọi trường (${schools.length})`, options: opts(rows.filter(r => fit(r, 'school')).map(r => [r.org_id, r.school])), hidden: !multi,
      onPick: v => { if (v.length === 1) setView('class') } },
    { key: 'prog', label: 'Chương trình', placeholder: 'Mọi chương trình', options: opts(rows.map(r => [r.program_id, progNames.get(r.program_id ?? '') ?? 'Chương trình khác'])) },
    { key: 'subj', label: 'Môn', placeholder: 'Mọi môn', options: subjects.map(x => [x, x] as [string, string]) },
    { key: 'grade', label: 'Khối', placeholder: 'Mọi khối', options: grades.map(g => [String(g), `Khối ${g}`] as [string, string]) },
    { key: 'state', label: 'Tình trạng', placeholder: 'Mọi tình trạng', hidden: view !== 'class', options: [['late', 'Chậm tiến độ'], ['ok', 'Đúng / vượt tiến độ'],
      ['missed', 'Có nội dung chưa hoàn thành'], ['evidence', 'Thiếu minh chứng'], ['none', 'Chưa ghi nhận']] },
  ]
  const state = states.length === 1 ? states[0] : ''
  const tracked = base.filter(r => r.taught > 0 && r.total > 0)
  const late = tracked.filter(r => r.gap >= GAP_WARN)
  const shown = base.filter(stateOk)
    .sort((a, b) => (state === 'late' ? b.gap - a.gap : state === 'missed' ? b.missed - a.missed : state === 'evidence' ? b.no_evidence - a.no_evidence : 0))
  const week = rows.find(r => r.week)?.week
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
  const sum = (rs: Progress[], k: 'missed' | 'no_evidence') => rs.reduce((m, r) => m + (r[k] ?? 0), 0)

  const group = (key: (r: Progress) => string, label: (r: Progress) => string) => [...new Map(base.map(r => [key(r), label(r)])).entries()].map(([id, name]) => {
    const rs = base.filter(r => key(r) === id), tr = rs.filter(r => r.taught > 0 && r.total > 0)
    return { id, name, n: rs.length, schools: new Set(rs.map(r => r.org_id)).size, tracked: tr.length, ok: tr.filter(r => r.gap < GAP_WARN).length,
      late: tr.filter(r => r.gap >= GAP_WARN).length, worst: tr.reduce((m, r) => Math.max(m, r.gap), 0), missed: sum(rs, 'missed'), noev: sum(rs, 'no_evidence') }
  }).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  const bySchool = group(r => r.org_id, r => r.school)
  const byArea = group(r => r.area ?? '—', r => r.area ?? 'Chưa rõ địa bàn')

  function exportRows() {
    downloadXlsx('Tien-do-PPCT', [
      ...(multi ? [{ key: 'sc', label: 'Trường', width: 28 }, { key: 'ar', label: 'Địa bàn', width: 22 }] : []), { key: 'c', label: 'Lớp' }, { key: 's', label: 'Môn', width: 18 },
      { key: 'w', label: 'Tuần' }, { key: 'p', label: 'Kế hoạch đến tuần này' }, { key: 'r', label: 'Đã dạy tới tiết' }, { key: 'g', label: 'Chênh lệch' },
      { key: 'm', label: 'Nội dung chưa hoàn thành' }, { key: 'e', label: 'Tiết STEM thiếu minh chứng' },
      { key: 't', label: 'Tổng số tiết' }, { key: 'n', label: 'Số tiết đã ghi nhận' }, { key: 'l', label: 'Tiết gần nhất', width: 36 }, { key: 'st', label: 'Đánh giá', width: 20 },
    ], shown.map(r => [...(multi ? [r.school, r.area] : []), r.class_name, r.subject, r.week, r.planned, r.reached, r.gap, r.missed, r.no_evidence, r.total, r.taught,
      r.last_title ? `${r.last_title} (${dmy(r.last_date)})` : '', progressTone(r).label]))
  }
  async function exportMissed() {
    setBusy(true)
    const pickSchools = f.get('school')
    const { data, error } = await supabase.rpc('curriculum_lesson_status', { p_class: null, p_org: pickSchools.length === 1 ? pickSchools[0] : null, p_only_missed: true })
    setBusy(false)
    if (error) return setErr(errText(error.message))
    const keys = new Set(base.map(r => r.class_id + ':' + r.book_id))
    const list = ((data as LessonRow[]) ?? []).filter(r => keys.has(r.class_id + ':' + r.book_id))
    if (!list.length) return alert('Không có nội dung chưa hoàn thành.')
    downloadXlsx('Noi-dung-chua-hoan-thanh', [
      ...(multi ? [{ key: 'sc', label: 'Trường', width: 28 }] : []), { key: 'c', label: 'Lớp' }, { key: 's', label: 'Môn', width: 18 }, { key: 'q', label: 'Tiết' },
      { key: 'w', label: 'Tuần kế hoạch' }, { key: 'h', label: 'Học kỳ' }, { key: 't', label: 'Tên bài / nội dung', width: 40 }, { key: 'st', label: 'Tình trạng', width: 24 },
    ], list.map(r => [...(multi ? [r.school] : []), r.class_name, r.subject, r.seq, r.plan_week, HK(r.term), r.title,
      r.state === 'done' ? 'Đã dạy, thiếu minh chứng' : STATE[r.state][0]]))
  }

  return (
    <>
      <p className="sub">So sánh tiết đã dạy (gắn khi giáo viên điểm danh) với kế hoạch trong PPCT đến hết tuần {week ?? '—'} của năm học.
        Chậm từ {GAP_WARN} tiết trở lên được đánh dấu. Bấm một lớp để xem từng tiết, yêu cầu cần đạt và minh chứng.</p>
      <Tiles items={[
        { label: 'Lớp × môn có PPCT', value: base.length, sub: `${tracked.length} đã có tiết dạy ghi nhận` },
        { label: 'Đúng tiến độ', value: tracked.length - late.length, sub: `${pct(tracked.length - late.length, tracked.length)}%`, tone: 'good' },
        { label: `Chậm ≥ ${GAP_WARN} tiết`, value: late.length, sub: late.length ? `nhiều nhất ${Math.max(...late.map(r => r.gap))} tiết` : '', tone: late.length ? 'bad' : undefined },
        { label: 'Nội dung chưa hoàn thành', value: sum(base, 'missed'), sub: 'tiết bị bỏ qua hoặc quá tuần', tone: sum(base, 'missed') ? 'warn' : undefined },
        { label: 'Thiếu minh chứng', value: sum(base, 'no_evidence'), sub: 'tiết STEM / thực hành đã dạy', tone: sum(base, 'no_evidence') ? 'warn' : undefined },
      ]} />
      <div className="bar">
        <div className="tools">
          {multi && <div className="segmented" style={{ margin: 0 }}>
            <button className={view === 'area' ? 'on' : ''} onClick={() => setView('area')}>Theo địa bàn</button>
            <button className={view === 'school' ? 'on' : ''} onClick={() => setView('school')}>Theo trường</button>
            <button className={view === 'class' ? 'on' : ''} onClick={() => setView('class')}>Theo lớp</button>
          </div>}
          <MultiFilters defs={defs} f={f} />
        </div>
        <div className="tools">
          {base.length > 0 && <button onClick={exportMissed} disabled={busy}>{busy ? 'Đang xuất…' : 'Xuất nội dung chưa hoàn thành'}</button>}
          {view === 'class' && shown.length > 0 && <button onClick={exportRows}>Xuất Excel</button>}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="panel"><p className="sub" style={{ margin: 0 }}>Chưa có lớp nào có PPCT theo tiết. {mode === 'school' ? 'Soạn PPCT ở tab "Phân phối chương trình" (cùng khối, cùng tên môn với thời khoá biểu).' : 'Các trường cần soạn PPCT theo tiết.'}</p></div>
      ) : view !== 'class' ? (
        <div className="wrap"><table>
          <thead><tr><th>{view === 'area' ? 'Địa bàn' : 'Trường'}</th>{view === 'area' && <th>Số trường</th>}<th>Lớp × môn</th><th>Đã ghi nhận</th><th>Đúng tiến độ</th><th>Chậm ≥ {GAP_WARN} tiết</th><th>Chưa hoàn thành</th><th>Thiếu minh chứng</th></tr></thead>
          <tbody>{(view === 'area' ? byArea : bySchool).map(s => (
            <tr key={s.id}><td><NameLink onClick={() => view === 'school' ? (f.set('school', [s.id]), setView('class')) : setView('school')} title={view === 'school' ? 'Xem lớp' : 'Xem trường'}>{s.name}</NameLink></td>{view === 'area' && <td>{s.schools}</td>}<td>{s.n}</td><td>{s.tracked}</td>
              <td><div className="progress" style={{ width: 90, display: 'inline-block', verticalAlign: 'middle', marginRight: 6 }}><i style={{ width: pct(s.ok, s.tracked) + '%' }} /></div>{pct(s.ok, s.tracked)}%</td>
              <td>{s.late ? <span className="gpill bad">{s.late}</span> : 0}{s.worst >= GAP_WARN ? <small> · chậm nhất {s.worst} tiết</small> : null}</td>
              <td>{s.missed ? <span className="gpill warn">{s.missed} tiết</span> : 0}</td><td>{s.noev ? <span className="gpill warn">{s.noev} tiết</span> : 0}</td></tr>
          ))}</tbody>
        </table></div>
      ) : (
        <div className="wrap"><table>
          <thead><tr>{multi && <th>Trường</th>}<th>Lớp</th><th>Môn</th><th>Kế hoạch đến nay</th><th>Đã dạy tới</th><th>Tình trạng</th><th>Chưa hoàn thành</th><th>Tiết gần nhất</th></tr></thead>
          <tbody>{shown.map(r => {
            const t = progressTone(r)
            return (
              <tr key={r.class_id + r.book_id}>
                {multi && <td><small>{r.school}</small></td>}
                <td><NameLink onClick={() => setDetail(r)} title="Chi tiết">{r.class_name}</NameLink></td><td>{r.subject}<br /><small>{r.book_title}</small></td>
                <td>Tiết {r.planned}<small> / {r.total}</small></td>
                <td>{r.taught ? <>Tiết {r.reached}<div className="progress" style={{ width: 110, marginTop: 4 }}><i style={{ width: pct(r.reached, r.total) + '%', background: t.tone === 'bad' ? 'var(--bad)' : t.tone === 'warn' ? '#fab219' : undefined }} /></div></> : '—'}</td>
                <td>{t.tone ? <span className={'gpill ' + t.tone}>{t.label}</span> : <small>{t.label}</small>}</td>
                <td>{r.missed ? <span className="gpill warn">{r.missed} tiết</span> : <small>—</small>}{r.no_evidence ? <><br /><small>{r.no_evidence} tiết thiếu minh chứng</small></> : null}</td>
                <td>{r.last_title ? <><small>{r.last_title}</small><br /><small className="sub">{dmy(r.last_date)} · {r.taught} tiết đã ghi nhận</small></> : '—'}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
      )}
    </>
  )
}

// ================= Chi tiết một lớp × môn: từng tiết, yêu cầu cần đạt, minh chứng =================
const EV_KIND: Record<string, string> = { photo: 'Ảnh', file: 'Tệp', link: 'Liên kết', note: 'Ghi chú', product: 'Sản phẩm' }
const OUT_STATE: Record<Outcome['state'], [string, string]> = { done: ['Đạt', 'good'], partial: ['Đang thực hiện', 'warn'], todo: ['Chưa thực hiện', ''], unplanned: ['Chưa có tiết trong PPCT', 'bad'] }

function ClassDetail({ row, mode, onClose }: { row: Progress; mode: PpctMode; onClose: () => void }) {
  const [lessons, setLessons] = useState<LessonRow[] | null>(null)
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [filter, setFilter] = useState<'' | 'missed' | 'evidence'>('')
  const [tab, setTab] = useState<'lessons' | 'outcomes'>('lessons')
  const [add, setAdd] = useState<{ lesson: LessonRow; kind: string; url: string; note: string; file: File | null } | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [busy, setBusy] = useState(false)
  async function load() {
    const [l, o, e] = await Promise.all([
      supabase.rpc('curriculum_lesson_status', { p_class: row.class_id }),
      supabase.rpc('curriculum_outcome_status', { p_class: row.class_id }),
      supabase.from('curriculum_evidence').select('id, lesson_id, kind, url, path, file_name, note, created_at').eq('class_id', row.class_id).order('created_at'),
    ])
    if (l.error) setMsg([errText(l.error.message), true])
    setLessons(((l.data as LessonRow[]) ?? []).filter(x => x.book_id === row.book_id))
    setOutcomes(((o.data as Outcome[]) ?? []).filter(x => x.book_id === row.book_id))
    setEvidence((e.data as Evidence[]) ?? [])
  }
  useEffect(() => { load() }, [row.class_id, row.book_id])
  const evOf = (id: string) => evidence.filter(e => e.lesson_id === id)
  const list = (lessons ?? []).filter(l => !filter || (filter === 'missed' ? l.state === 'skipped' || l.state === 'late' : l.state === 'done' && l.needs_evidence && l.evidence === 0))
  const cnt = (st: LessonState[]) => (lessons ?? []).filter(l => st.includes(l.state)).length
  const canAdd = mode === 'school'

  async function saveEvidence(e: React.FormEvent) {
    e.preventDefault(); if (!add) return
    setBusy(true); setMsg(null)
    try {
      let path: string | null = null, file_name: string | null = null
      if (add.file) { const f = await uploadLearningFile(row.org_id, 'minh-chung', add.file); path = f.path; file_name = f.name }
      const url = add.url.trim() || null
      if (!path && !url && !add.note.trim()) throw new Error('Chọn tệp, nhập liên kết hoặc ghi chú.')
      const { error } = await supabase.from('curriculum_evidence').insert({ class_id: row.class_id, lesson_id: add.lesson.lesson_id,
        kind: add.file ? (add.file.type.startsWith('image/') ? 'photo' : add.kind === 'product' ? 'product' : 'file') : url ? (add.kind === 'product' ? 'product' : 'link') : 'note',
        url, path, file_name, note: add.note.trim() || null })
      if (error) throw new Error(errText(error.message))
      setAdd(null); setMsg(['Đã lưu minh chứng.', false]); load()
    } catch (err) { setMsg([err instanceof Error ? err.message : String(err), true]) } finally { setBusy(false) }
  }
  async function delEvidence(ev: Evidence) {
    if (!confirm('Xoá minh chứng này?')) return
    const { error } = await supabase.from('curriculum_evidence').delete().eq('id', ev.id)
    if (error) return setMsg([errText(error.message), true])
    load()
  }
  function exportList() {
    downloadXlsx(`Tien-do ${row.class_name} ${row.subject}`, [
      { key: 'q', label: 'Tiết' }, { key: 'w', label: 'Tuần kế hoạch' }, { key: 'h', label: 'Học kỳ' }, { key: 't', label: 'Tên bài / nội dung', width: 40 },
      { key: 's', label: 'Tình trạng', width: 18 }, { key: 'd', label: 'Ngày dạy' }, { key: 'g', label: 'Giáo viên', width: 22 }, { key: 'e', label: 'Minh chứng' },
    ], (lessons ?? []).map(l => [l.seq, l.plan_week, HK(l.term), l.title, STATE[l.state][0], dmy(l.taught_on), l.teacher, l.evidence]))
  }

  return (
    <>
      <div className="bar">
        <div>
          <button className="linkbtn" onClick={onClose}>← Tiến độ các lớp</button>
          <h3 style={{ margin: '4px 0 0' }}>{row.class_name} · {row.subject}</h3>
          <small className="sub">{row.school} · {row.book_title} · tuần {row.week ?? '—'}</small>
        </div>
        <div className="tools">{lessons && lessons.length > 0 && <button onClick={exportList}>Xuất Excel</button>}</div>
      </div>
      {lessons && <Tiles items={[
        { label: 'Đã dạy', value: cnt(['done']), sub: cnt(['before']) ? `+ ${cnt(['before'])} tiết trước khi ghi nhận` : `/ ${lessons.length} tiết` },
        { label: 'Chưa hoàn thành', value: cnt(['skipped', 'late']), sub: `${cnt(['skipped'])} bị bỏ qua · ${cnt(['late'])} chậm`, tone: cnt(['skipped', 'late']) ? 'bad' : undefined },
        { label: 'Thiếu minh chứng', value: lessons.filter(l => l.state === 'done' && l.needs_evidence && l.evidence === 0).length, tone: 'warn' },
        { label: 'Yêu cầu cần đạt', value: outcomes.length ? `${outcomes.filter(o => o.state === 'done').length}/${outcomes.length}` : '—', sub: outcomes.length ? 'đã đạt' : 'PPCT chưa gắn chương trình', tone: outcomes.length ? 'good' : undefined },
      ]} />}
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      <div className="bar">
        <div className="segmented" style={{ margin: 0 }}>
          <button className={tab === 'lessons' ? 'on' : ''} onClick={() => setTab('lessons')}>Từng tiết</button>
          <button className={tab === 'outcomes' ? 'on' : ''} onClick={() => setTab('outcomes')}>Yêu cầu cần đạt ({outcomes.length})</button>
        </div>
        {tab === 'lessons' && <select value={filter} onChange={e => setFilter(e.target.value as any)} aria-label="Lọc">
          <option value="">Mọi tiết</option><option value="missed">Chưa hoàn thành</option><option value="evidence">Thiếu minh chứng</option></select>}
      </div>
      {add && (
        <form className="panel formgrid" onSubmit={saveEvidence} style={{ marginBottom: 12 }}>
          <b style={{ gridColumn: '1/-1' }}>Minh chứng cho tiết {add.lesson.seq}: {add.lesson.title}</b>
          <label className="field"><span>Loại</span><select value={add.kind} onChange={e => setAdd({ ...add, kind: e.target.value })}>
            {Object.entries(EV_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="field"><span>Tệp / ảnh (tối đa 50 MB)</span><input type="file" onChange={e => setAdd({ ...add, file: e.target.files?.[0] ?? null })} /></label>
          <label className="field"><span>Hoặc liên kết</span><input value={add.url} onChange={e => setAdd({ ...add, url: e.target.value })} placeholder="https://…" /></label>
          <label className="field" style={{ gridColumn: '1/-1' }}><span>Ghi chú</span><input value={add.note} onChange={e => setAdd({ ...add, note: e.target.value })} placeholder="VD: Ảnh sản phẩm nhóm 2, phiếu đánh giá" /></label>
          <div className="formactions"><button className="primary" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu minh chứng'}</button> <button type="button" onClick={() => setAdd(null)}>Huỷ</button></div>
        </form>
      )}
      {!lessons ? <p className="sub">Đang tải…</p> : tab === 'lessons' ? (
        <div className="wrap"><table>
          <thead><tr><th>Tiết</th><th>Tuần KH</th><th>HK</th><th>Tên bài / nội dung</th><th>Tình trạng</th><th>Đã dạy</th><th>Minh chứng</th></tr></thead>
          <tbody>{list.map(l => (
            <tr key={l.lesson_id}>
              <td><b>{l.seq}</b></td><td>{l.plan_week ?? '—'}</td><td><small>{HK(l.term)}</small></td>
              <td>{l.title}{l.kind !== 'lesson' && <> <span className={'gpill ' + KIND_PILL[l.kind]}>{KIND[l.kind]}</span></>}</td>
              <td>{STATE[l.state][1] ? <span className={'gpill ' + STATE[l.state][1]}>{STATE[l.state][0]}</span> : <small>{STATE[l.state][0]}</small>}</td>
              <td>{l.taught_on ? <small>{dmy(l.taught_on)}{l.teacher ? ` · ${l.teacher}` : ''}</small> : '—'}</td>
              <td>
                {evOf(l.lesson_id).map(ev => (
                  <div key={ev.id}><small>
                    {ev.path ? <button className="linkbtn" onClick={() => openFile(ev.path!)}>{ev.file_name ?? EV_KIND[ev.kind]}</button>
                      : ev.url ? <a href={ev.url} target="_blank" rel="noreferrer">{EV_KIND[ev.kind]} ↗</a> : EV_KIND[ev.kind]}
                    {ev.note ? ` · ${ev.note}` : ''} {canAdd && <button className="x" aria-label="Xoá minh chứng" onClick={() => delEvidence(ev)}>×</button>}
                  </small></div>
                ))}
                {l.state === 'done' && l.needs_evidence && l.evidence === 0 && <span className="gpill warn">Thiếu</span>}
                {canAdd && (l.state === 'done' || l.state === 'before' || l.evidence > 0) && <button className="linkbtn" onClick={() => setAdd({ lesson: l, kind: 'photo', url: '', note: '', file: null })}>+ Thêm</button>}
              </td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={7}><small className="sub">Không có tiết phù hợp.</small></td></tr>}</tbody>
        </table></div>
      ) : outcomes.length === 0 ? (
        <div className="panel"><p className="sub" style={{ margin: 0 }}>PPCT này chưa gắn với chương trình giáo dục có yêu cầu cần đạt. Tạo PPCT từ "Chương trình giáo dục" hoặc chọn "Bài trong chương trình" cho từng tiết.</p></div>
      ) : (
        <div className="wrap"><table>
          <thead><tr><th>Mã</th><th>Yêu cầu cần đạt</th><th>Học phần / bài</th><th>Tiết đã dạy</th><th>Tình trạng</th></tr></thead>
          <tbody>{outcomes.map(o => (
            <tr key={o.outcome_id}><td><small>{o.code}</small></td><td>{o.content}</td><td><small>{o.unit_title ?? 'Cả chương trình'}</small></td>
              <td>{o.lessons ? <>{o.done}/{o.lessons}<div className="progress" style={{ width: 80, marginTop: 4 }}><i style={{ width: Math.round(o.done / o.lessons * 100) + '%' }} /></div></> : '—'}</td>
              <td>{OUT_STATE[o.state][1] ? <span className={'gpill ' + OUT_STATE[o.state][1]}>{OUT_STATE[o.state][0]}</span> : <small>{OUT_STATE[o.state][0]}</small>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  )
}

// ================= Điều chỉnh hàng loạt (074) =================
type Ask = (b: Pick<Book, 'status'>, what: string, always?: boolean) => Promise<Reason | null | undefined>
function AdjustPanel({ book, rows, ask, onDone, onError }: { book: Book; rows: Lesson[]; ask: Ask; onDone: (m: string) => void; onError: (m: string) => void }) {
  const last = rows.length ? rows[rows.length - 1].seq : 1
  const [shift, setShift] = useState({ from: 1, weeks: 1 })
  const [swap, setSwap] = useState({ a: 1, b: Math.min(2, last) })
  const [ins, setIns] = useState({ after: last, title: '', kind: 'lesson' as Kind, week: '' })
  const [busy, setBusy] = useState(false)
  const t = (seq: number) => rows.find(r => r.seq === seq)?.title ?? '—'
  async function run(what: string, fn: (r: Reason | undefined) => PromiseLike<{ data: any; error: { message: string } | null }>, ok: (d: any) => string) {
    const r = await ask(book, what)
    if (r === null) return
    setBusy(true)
    const { data, error } = await fn(r)
    setBusy(false)
    if (error) return onError(errText(error.message))
    onDone(ok(data))
  }
  const rc = (r: Reason | undefined) => ({ p_reason_code: r?.code ?? null, p_reason: r ? reasonText(r) : null })
  return (
    <div className="panel adjust" style={{ marginBottom: 12 }}>
      <b>Điều chỉnh hàng loạt</b> <small className="sub">{book.status === 'published' ? 'PPCT đang dùng: mỗi lần điều chỉnh hỏi lý do, ghi nhật ký và lưu một phiên bản.' : 'Áp dụng ngay cho PPCT nháp.'}</small>
      <div className="adjgrid">
        <form onSubmit={e => { e.preventDefault(); run('dời tiết', r => supabase.rpc('curriculum_shift', { p_book: book.id, p_from_seq: shift.from, p_weeks: shift.weeks, ...rc(r) }), d => `Đã dời ${d} tiết ${shift.weeks > 0 ? 'lùi' : 'tiến'} ${Math.abs(shift.weeks)} tuần.`) }}>
          <h4>Dời tiết</h4>
          <label className="field"><span>Từ tiết</span><input type="number" min={1} max={last} value={shift.from} onChange={e => setShift({ ...shift, from: Number(e.target.value) || 1 })} /></label>
          <small className="sub">{t(shift.from)}</small>
          <label className="field"><span>Số tuần (âm = dời lên sớm)</span><input type="number" min={-20} max={20} value={shift.weeks} onChange={e => setShift({ ...shift, weeks: Number(e.target.value) || 0 })} /></label>
          <button className="primary" disabled={busy || !shift.weeks}>Dời {shift.weeks >= 0 ? 'lùi' : 'lên'} {Math.abs(shift.weeks)} tuần</button>
        </form>
        <form onSubmit={e => { e.preventDefault(); run('đổi chỗ hai tiết', r => supabase.rpc('curriculum_swap', { p_book: book.id, p_a: swap.a, p_b: swap.b, ...rc(r) }), () => `Đã đổi chỗ tiết ${swap.a} và tiết ${swap.b}.`) }}>
          <h4>Đổi chỗ hai bài</h4>
          <label className="field"><span>Tiết</span><input type="number" min={1} max={last} value={swap.a} onChange={e => setSwap({ ...swap, a: Number(e.target.value) || 1 })} /></label>
          <small className="sub">{t(swap.a)}</small>
          <label className="field"><span>với tiết</span><input type="number" min={1} max={last} value={swap.b} onChange={e => setSwap({ ...swap, b: Number(e.target.value) || 1 })} /></label>
          <small className="sub">{t(swap.b)}</small>
          <button className="primary" disabled={busy || swap.a === swap.b}>Đổi chỗ</button>
        </form>
        <form onSubmit={e => { e.preventDefault(); run('chèn tiết', r => supabase.rpc('curriculum_insert_after', { p_book: book.id, p_after_seq: ins.after, p_title: ins.title, p_kind: ins.kind, p_week: Number(ins.week) || null, ...rc(r) }), d => `Đã chèn "${ins.title}" thành tiết ${d}; các tiết sau lùi một số.`) }}>
          <h4>Chèn tiết dạy bù / bổ sung</h4>
          <label className="field"><span>Sau tiết</span><input type="number" min={0} max={last} value={ins.after} onChange={e => setIns({ ...ins, after: Number(e.target.value) || 0 })} /></label>
          <label className="field"><span>Tên tiết *</span><input required value={ins.title} onChange={e => setIns({ ...ins, title: e.target.value })} placeholder="VD: Dạy bù bài 4" /></label>
          <div className="formgrid" style={{ gap: 8 }}>
            <label className="field"><span>Loại</span><select value={ins.kind} onChange={e => setIns({ ...ins, kind: e.target.value as Kind })}>{(Object.keys(KIND) as Kind[]).map(k => <option key={k} value={k}>{KIND[k]}</option>)}</select></label>
            <label className="field"><span>Tuần</span><input type="number" min={1} max={52} value={ins.week} onChange={e => setIns({ ...ins, week: e.target.value })} placeholder="như tiết trước" /></label>
          </div>
          <button className="primary" disabled={busy || !ins.title.trim()}>Chèn tiết</button>
        </form>
      </div>
    </div>
  )
}

// ================= Phiên bản PPCT: danh sách + so sánh (074) =================
type Version = { id: string; version_no: number; action: string; reason_code: ReasonCode | null; reason: string | null; lessons: { seq: number; week: number | null; term: number | null; title: string; kind: string }[]; created_at: string; profiles?: { full_name: string } | null }
function Versions({ book, rows, canEdit, ask }: { book: Book; rows: Lesson[]; canEdit: boolean; ask: Ask }) {
  const [list, setList] = useState<Version[] | null>(null)
  const [a, setA] = useState<string>('')
  const [b, setB] = useState<string>('current')
  const [msg, setMsg] = useState('')
  async function load() {
    const { data } = await supabase.from('curriculum_book_versions').select('*, profiles(full_name)').eq('book_id', book.id).order('version_no', { ascending: false })
    const vs = (data as Version[]) ?? []
    setList(vs); setA(cur => cur || vs[0]?.id || '')
  }
  useEffect(() => { load() }, [book.id])
  async function save() {
    const r = await ask(book, 'lưu phiên bản', true)
    if (r === null) return
    const { data, error } = await supabase.rpc('curriculum_snapshot', { p_book: book.id, p_reason_code: r?.code ?? null, p_reason: r ? reasonText(r) : null })
    setMsg(error ? errText(error.message) : `Đã lưu phiên bản v${data}.`); load()
  }
  const cur = rows.map(l => ({ seq: l.seq, week: l.week, term: l.term, title: l.title, kind: l.kind }))
  const pick = (id: string) => (id === 'current' ? cur : list?.find(v => v.id === id)?.lessons ?? [])
  const A = pick(a), B = pick(b)
  const seqs = [...new Set([...A.map(x => x.seq), ...B.map(x => x.seq)])].sort((x, y) => x - y)
  const diff = seqs.map(seq => {
    const x = A.find(l => l.seq === seq), y = B.find(l => l.seq === seq)
    const kind = !x ? 'add' : !y ? 'del' : x.title !== y.title ? 'title' : x.week !== y.week ? 'week' : ''
    return { seq, x, y, kind }
  }).filter(d => d.kind)
  const label = (v: Version) => `v${v.version_no} · ${ACTION[v.action] ?? v.action} · ${new Date(v.created_at).toLocaleDateString('vi-VN')}`
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="bar"><div><b>Phiên bản</b> <small className="sub">Tự lưu khi công bố và sau mỗi lần điều chỉnh hàng loạt PPCT đang dùng.</small></div>
        {canEdit && <button onClick={save}>Lưu phiên bản hiện tại</button>}</div>
      {msg && <p className="sub"><b>{msg}</b></p>}
      {!list ? <p className="sub">Đang tải…</p> : list.length === 0 ? <p className="sub" style={{ margin: 0 }}>Chưa có phiên bản nào.</p> : (
        <>
          <div className="wrap"><table>
            <thead><tr><th>Phiên bản</th><th>Thao tác</th><th>Số tiết</th><th>Lý do</th><th>Người lưu</th><th>Thời gian</th></tr></thead>
            <tbody>{list.map(v => (
              <tr key={v.id}><td><b>v{v.version_no}</b></td><td>{ACTION[v.action] ?? v.action}</td><td>{v.lessons.length}</td>
                <td>{v.reason_code && <span className="gpill">{REASONS[v.reason_code]}</span>} {v.reason}</td>
                <td><small>{v.profiles?.full_name ?? ''}</small></td><td><small>{new Date(v.created_at).toLocaleString('vi-VN')}</small></td></tr>
            ))}</tbody>
          </table></div>
          <div className="tools" style={{ margin: '12px 0 8px' }}>
            <b>So sánh</b>
            <select value={a} onChange={e => setA(e.target.value)} aria-label="Bản trước">{list.map(v => <option key={v.id} value={v.id}>{label(v)}</option>)}</select>
            <span>với</span>
            <select value={b} onChange={e => setB(e.target.value)} aria-label="Bản sau"><option value="current">Hiện tại</option>{list.map(v => <option key={v.id} value={v.id}>{label(v)}</option>)}</select>
          </div>
          {diff.length === 0 ? <p className="sub" style={{ margin: 0 }}>Hai bản giống nhau.</p> : (
            <div className="wrap"><table>
              <thead><tr><th>Tiết</th><th>Bản trước</th><th>Bản sau</th><th>Thay đổi</th></tr></thead>
              <tbody>{diff.map(d => (
                <tr key={d.seq} className={'diff ' + d.kind}><td><b>{d.seq}</b></td>
                  <td><small>{d.x ? `Tuần ${d.x.week ?? '—'} · ${d.x.title}` : '—'}</small></td>
                  <td><small>{d.y ? `Tuần ${d.y.week ?? '—'} · ${d.y.title}` : '—'}</small></td>
                  <td>{{ add: 'Thêm', del: 'Bỏ', title: 'Đổi nội dung', week: 'Đổi tuần' }[d.kind]}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
    </div>
  )
}
