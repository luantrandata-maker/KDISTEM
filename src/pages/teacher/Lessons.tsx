import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { TProps, NoTeacher, PROGRAM_COLOR, Tabs } from './common'

export type SlideKind = 'title' | 'content' | 'question' | 'task' | 'media'
export type Slide = { id: string; kind: SlideKind; title: string; body?: string; options?: string[]; answer?: number; url?: string; minutes?: number }
export type Plan = {
  id: string; org_id: string; teacher_id: string | null; title: string; subject: string | null; grades: string | null; program: string | null
  from_package: boolean; is_template: boolean; status: 'draft' | 'editing' | 'published'; summary: string | null; slides: Slide[]; updated_at: string
  library_item_id?: string | null; library_version?: number | null
  teachers?: { full_name: string } | null
}

export const KIND: Record<SlideKind, string> = { title: 'Trang bìa', content: 'Nội dung', question: 'Câu hỏi', task: 'Nhiệm vụ', media: 'Video / hình' }
const STATUS: Record<Plan['status'], string> = { published: 'Đã xuất bản', editing: 'Đang soạn', draft: 'Nháp' }
const uid = () => Math.random().toString(36).slice(2, 9)
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${Math.max(1, m)} phút trước`
  if (m < 1440) return `${Math.round(m / 60)} giờ trước`
  return `${Math.round(m / 1440)} ngày trước`
}
const newSlide = (kind: SlideKind): Slide => ({
  id: uid(), kind, title: kind === 'title' ? 'Tên bài học' : '', body: '',
  ...(kind === 'question' ? { options: ['', ''], answer: 0 } : {}), ...(kind === 'task' ? { minutes: 10 } : {}), ...(kind === 'media' ? { url: '' } : {}),
})

// Chuyển link YouTube thường thành link nhúng
function embedUrl(url: string) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/)
  return m ? `https://www.youtube.com/embed/${m[1]}` : url
}
const isImage = (url: string) => /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)

// Hiển thị một slide (dùng cho xem thử, trình chiếu trên lớp, và về sau màn học sinh)
export function SlideView({ slide, reveal, hideOptions }: { slide: Slide | undefined; reveal?: boolean; hideOptions?: boolean }) {
  if (!slide) return <div className="slide empty">Bài giảng chưa có slide.</div>
  return (
    <div className={'slide ' + slide.kind}>
      <span className="slidekind">{KIND[slide.kind]}{slide.kind === 'task' && slide.minutes ? ` · ${slide.minutes} phút` : ''}</span>
      <h2>{slide.title || <i>Chưa có tiêu đề</i>}</h2>
      {slide.body && <div className="slidebody">{slide.body.split('\n').map((l, i) => <p key={i}>{l}</p>)}</div>}
      {slide.kind === 'question' && !hideOptions && (
        <ol className="opts">
          {(slide.options ?? []).map((o, i) => (
            <li key={i} className={reveal && slide.answer === i ? 'right' : ''}><b>{String.fromCharCode(65 + i)}</b> {o}</li>
          ))}
        </ol>
      )}
      {slide.kind === 'media' && slide.url && (
        isImage(slide.url) ? <img src={slide.url} alt={slide.title} />
          : <iframe src={embedUrl(slide.url)} title={slide.title || 'Video'} allow="autoplay; encrypted-media; fullscreen" allowFullScreen />
      )}
    </div>
  )
}

type View = { mode: 'list' } | { mode: 'edit'; plan: Plan } | { mode: 'preview'; plan: Plan; i: number }
type LTab = 'all' | 'published' | 'editing' | 'draft'

export function TeacherLessonStudio({ teacherId, orgId, go }: TProps) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [view, setView] = useState<View>({ mode: 'list' })
  const [tab, setTab] = useState<LTab>('all')
  const [library, setLibrary] = useState(false)
  const [q, setQ] = useState('')
  const [program, setProgram] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const { data, error } = await supabase.from('lesson_plans').select('*, teachers(full_name)').order('updated_at', { ascending: false })
    if (error) setErr(error.message)
    setPlans((data as Plan[]) ?? [])
  }
  useEffect(() => { load() }, [teacherId])

  const mine = plans.filter(p => p.teacher_id === teacherId && !p.is_template)
  const shared = plans.filter(p => p.is_template || (p.teacher_id !== teacherId && p.status === 'published'))
  const src = library ? shared : mine
  const filtered = src.filter(p => (!program || p.program === program) && (!q || p.title.toLowerCase().includes(q.toLowerCase())))
  const shown = library || tab === 'all' ? filtered : filtered.filter(p => p.status === tab)

  async function create(from?: Plan) {
    if (!orgId || !teacherId) return
    const body = from
      ? { title: from.is_template ? from.title.replace(/^Mẫu:\s*/, '') : from.title, subject: from.subject, grades: from.grades, program: from.program,
          from_package: from.from_package, summary: from.summary, slides: from.slides.map(s => ({ ...s, id: uid() })), source_id: from.id }
      : { title: 'Bài giảng mới', slides: [newSlide('title'), newSlide('content')] }
    const { data, error } = await supabase.from('lesson_plans').insert({ ...body, org_id: orgId, teacher_id: teacherId, status: 'draft' }).select('*').single()
    if (error || !data) return setErr('Không tạo được bài giảng: ' + (error?.message ?? ''))
    setLibrary(false); await load(); setView({ mode: 'edit', plan: data as Plan })
  }
  async function remove(p: Plan) {
    if (!confirm(`Xoá bài giảng “${p.title}”?`)) return
    const { error } = await supabase.from('lesson_plans').delete().eq('id', p.id)
    if (error) setErr(error.message); load()
  }

  if (!teacherId) return <NoTeacher />
  if (view.mode === 'edit') return <Editor plan={view.plan} onClose={() => { setView({ mode: 'list' }); load() }} onPreview={p => setView({ mode: 'preview', plan: p, i: 0 })} />
  if (view.mode === 'preview') {
    const { plan, i } = view
    return (
      <div className="presenter">
        <div className="bar"><b>{plan.title}</b><span className="tools">
          <button onClick={() => setView({ ...view, i: Math.max(0, i - 1) })} disabled={i === 0}>‹ Trước</button>
          <span>{i + 1}/{plan.slides.length || 1}</span>
          <button onClick={() => setView({ ...view, i: Math.min(plan.slides.length - 1, i + 1) })} disabled={i >= plan.slides.length - 1}>Sau ›</button>
          <button onClick={() => setView({ mode: 'edit', plan })}>Quay lại soạn</button></span></div>
        <SlideView slide={plan.slides[i]} reveal />
      </div>
    )
  }
  return (
    <>
      <div className="bar">
        {library
          ? <p className="sub" style={{ margin: 0 }}><b>Kho bài giảng mẫu</b> · bài mẫu của trường và bài đồng nghiệp đã xuất bản. Bấm “Dùng bài này” để tạo bản của bạn.</p>
          : <Tabs<LTab> value={tab} onChange={setTab} items={[['all', 'Tất cả', filtered.length], ['published', 'Đã xuất bản', filtered.filter(p => p.status === 'published').length],
              ['editing', 'Đang soạn', filtered.filter(p => p.status === 'editing').length], ['draft', 'Nháp', filtered.filter(p => p.status === 'draft').length]]} />}
        <span className="tools">
          <button onClick={() => setLibrary(!library)}>{library ? '← Bài giảng của tôi' : 'Kho bài giảng mẫu'}</button>
          {go && <button onClick={() => go('Thư viện STEM')} title="Học liệu do Sở, Phòng, KDI Education phát hành">Thư viện STEM (Sở · KDI)</button>}
          <button className="primary" onClick={() => create()}>+ Soạn bài mới</button>
        </span>
      </div>
      <div className="tools" style={{ marginBottom: 12 }}>
        <input className="search" style={{ margin: 0 }} placeholder="Tìm theo tên bài…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm bài giảng" />
        <select value={program} onChange={e => setProgram(e.target.value)} aria-label="Lọc chương trình">
          <option value="">Tất cả chương trình</option>{['CT1', 'CT2', 'CT3', 'CT4', 'CT5'].map(c => <option key={c}>{c}</option>)}</select>
      </div>
      {err && <p className="msg">{err}</p>}
      <div className="lessongrid">
        {shown.map(p => (
          <div className="panel lessoncard" key={p.id}>
            <div className="lessoncover">
              {p.program && <span className="progchip" style={{ background: PROGRAM_COLOR[p.program], color: '#fff' }}>{p.program}</span>}
              {p.from_package && <span className="progchip pkgchip">Gói STEM</span>}
              {p.is_template && <span className="progchip pkgchip">Mẫu</span>}
              {p.library_item_id && <span className="progchip pkgchip" title={`Từ kho học liệu dùng chung, phiên bản ${p.library_version ?? '?'}`}>Từ kho v{p.library_version}</span>}
              <span className="slidecount">{p.slides.length} slide</span>
            </div>
            <b>{p.title}</b>
            <small>{[p.subject, p.grades && `Khối ${p.grades}`].filter(Boolean).join(' · ')}{library && p.teachers ? ` · ${p.teachers.full_name}` : ''}</small>
            <div className="lessonfoot">
              <span className={'pill ' + (p.status === 'published' ? 'active' : p.status === 'editing' ? 'maintenance' : '')}>{STATUS[p.status]}</span>
              <small>{ago(p.updated_at)}</small>
            </div>
            <div className="tools">
              {library ? <>
                <button className="primary" onClick={() => create(p)}>Dùng bài này</button>
                <button onClick={() => setView({ mode: 'preview', plan: p, i: 0 })}>Xem</button>
              </> : <>
                <button className="primary" onClick={() => setView({ mode: 'edit', plan: p })}>Soạn</button>
                <button onClick={() => setView({ mode: 'preview', plan: p, i: 0 })}>Trình chiếu thử</button>
                <button onClick={() => create(p)}>Nhân bản</button>
                <button className="x" onClick={() => remove(p)} aria-label={`Xoá ${p.title}`}>×</button>
              </>}
            </div>
          </div>
        ))}
        {shown.length === 0 && <p className="sub">{library ? 'Kho chưa có bài nào.' : 'Chưa có bài giảng nào. Bấm “Soạn bài mới” hoặc lấy từ Kho bài giảng mẫu.'}</p>}
      </div>
    </>
  )
}

function Editor({ plan, onClose, onPreview }: { plan: Plan; onClose: () => void; onPreview: (p: Plan) => void }) {
  const [p, setP] = useState<Plan>(plan)
  const [sel, setSel] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const upd = (patch: Partial<Plan>) => { setP({ ...p, ...patch }); setDirty(true) }
  const slides = p.slides
  const cur = slides[sel]
  const setSlide = (patch: Partial<Slide>) => upd({ slides: slides.map((s, i) => i === sel ? { ...s, ...patch } : s) })
  const add = (kind: SlideKind) => { const next = [...slides.slice(0, sel + 1), newSlide(kind), ...slides.slice(sel + 1)]; upd({ slides: next }); setSel(sel + 1) }
  const move = (d: -1 | 1) => {
    const j = sel + d; if (j < 0 || j >= slides.length) return
    const next = [...slides]; [next[sel], next[j]] = [next[j], next[sel]]; upd({ slides: next }); setSel(j)
  }
  const del = () => { if (slides.length <= 1) return; upd({ slides: slides.filter((_, i) => i !== sel) }); setSel(Math.max(0, sel - 1)) }

  async function save(status?: Plan['status']) {
    setBusy(true)
    const body = {
      title: p.title.trim() || 'Bài giảng chưa đặt tên', subject: p.subject || null, grades: p.grades || null, program: p.program || null,
      from_package: p.from_package, summary: p.summary || null, slides: p.slides,
      status: status ?? (p.status === 'draft' ? 'editing' : p.status),
    }
    const { data, error } = await supabase.from('lesson_plans').update(body).eq('id', p.id).select('*').single()
    setBusy(false)
    if (error || !data) return setMsg('Không lưu được: ' + (error?.message ?? ''))
    setP(data as Plan); setDirty(false); setMsg(status === 'published' ? 'Đã xuất bản — đồng nghiệp thấy bài này trong Kho bài giảng mẫu.' : 'Đã lưu.')
  }
  const close = () => { if (!dirty || confirm('Có thay đổi chưa lưu. Thoát không lưu?')) onClose() }

  return (
    <>
      <div className="bar">
        <span className="tools"><button onClick={close}>← Danh sách</button>
          <span className={'pill ' + (p.status === 'published' ? 'active' : p.status === 'editing' ? 'maintenance' : '')}>{STATUS[p.status]}</span>
          {dirty && <small>Chưa lưu</small>}{msg && !dirty && <small>{msg}</small>}</span>
        <span className="tools">
          <button onClick={() => onPreview(p)}>Trình chiếu thử</button>
          <button onClick={() => save()} disabled={busy}>Lưu</button>
          {p.status === 'published'
            ? <button onClick={() => save('editing')} disabled={busy}>Thu hồi xuất bản</button>
            : <button className="primary" onClick={() => save('published')} disabled={busy}>Xuất bản</button>}
        </span>
      </div>
      <div className="panel formgrid">
        <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên bài giảng *</span>
          <input value={p.title} onChange={e => upd({ title: e.target.value })} maxLength={200} /></label>
        <label className="field"><span>Môn</span><input value={p.subject ?? ''} onChange={e => upd({ subject: e.target.value })} /></label>
        <label className="field"><span>Khối</span><input value={p.grades ?? ''} onChange={e => upd({ grades: e.target.value })} placeholder="VD: 8 hoặc 6,7" /></label>
        <label className="field"><span>Chương trình</span>
          <select value={p.program ?? ''} onChange={e => upd({ program: e.target.value || null })}><option value="">—</option>{['CT1', 'CT2', 'CT3', 'CT4', 'CT5'].map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="field"><span>Nội dung Gói STEM</span>
          <span><input type="checkbox" checked={p.from_package} onChange={e => upd({ from_package: e.target.checked })} /> Thuộc gói STEM của trường</span></label>
      </div>
      <div className="studio">
        <div className="panel slidelist">
          {slides.map((s, i) => (
            <button key={s.id} className={i === sel ? 'on' : ''} onClick={() => setSel(i)}>
              <small>{i + 1} · {KIND[s.kind]}</small><span>{s.title || <i>Chưa có tiêu đề</i>}</span>
            </button>
          ))}
          <div className="addslide">
            <small>Thêm slide sau slide đang chọn</small>
            {(Object.keys(KIND) as SlideKind[]).map(k => <button key={k} onClick={() => add(k)}>+ {KIND[k]}</button>)}
          </div>
        </div>
        <div>
          {cur && (
            <div className="panel formgrid">
              <label className="field"><span>Loại slide</span>
                <select value={cur.kind} onChange={e => setSlide({ ...newSlide(e.target.value as SlideKind), id: cur.id, title: cur.title, body: cur.body })}>
                  {(Object.keys(KIND) as SlideKind[]).map(k => <option key={k} value={k}>{KIND[k]}</option>)}</select></label>
              {cur.kind === 'task' && <label className="field"><span>Thời gian (phút)</span>
                <input type="number" min={1} max={90} value={cur.minutes ?? 10} onChange={e => setSlide({ minutes: Number(e.target.value) || 1 })} /></label>}
              <span className="tools" style={{ alignSelf: 'end' }}>
                <button onClick={() => move(-1)} disabled={sel === 0} aria-label="Đưa lên">↑</button>
                <button onClick={() => move(1)} disabled={sel === slides.length - 1} aria-label="Đưa xuống">↓</button>
                <button onClick={del} disabled={slides.length <= 1}>Xoá slide</button>
              </span>
              <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tiêu đề</span>
                <input value={cur.title} onChange={e => setSlide({ title: e.target.value })} /></label>
              <label className="field" style={{ gridColumn: '1 / -1' }}><span>{cur.kind === 'question' ? 'Câu hỏi' : 'Nội dung'} <small>(mỗi dòng một ý)</small></span>
                <textarea rows={4} value={cur.body ?? ''} onChange={e => setSlide({ body: e.target.value })} /></label>
              {cur.kind === 'question' && (
                <div className="field" style={{ gridColumn: '1 / -1' }}><span>Phương án — chọn đáp án đúng</span>
                  {(cur.options ?? []).map((o, i) => (
                    <div className="addrow" key={i}>
                      <input type="radio" name="answer" checked={cur.answer === i} onChange={() => setSlide({ answer: i })} aria-label={`Đáp án ${String.fromCharCode(65 + i)} đúng`} />
                      <input value={o} placeholder={`Phương án ${String.fromCharCode(65 + i)}`} onChange={e => setSlide({ options: (cur.options ?? []).map((x, j) => j === i ? e.target.value : x) })} />
                      <button className="x" onClick={() => setSlide({ options: (cur.options ?? []).filter((_, j) => j !== i), answer: 0 })} disabled={(cur.options ?? []).length <= 2} aria-label="Xoá phương án">×</button>
                    </div>
                  ))}
                  {(cur.options ?? []).length < 6 && <button onClick={() => setSlide({ options: [...(cur.options ?? []), ''] })}>+ Phương án</button>}
                </div>
              )}
              {cur.kind === 'media' && <label className="field" style={{ gridColumn: '1 / -1' }}><span>Đường dẫn video (YouTube) hoặc ảnh</span>
                <input type="url" value={cur.url ?? ''} onChange={e => setSlide({ url: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" /></label>}
            </div>
          )}
          <SlideView slide={cur} reveal />
        </div>
      </div>
    </>
  )
}
