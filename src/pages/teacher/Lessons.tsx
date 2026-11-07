import { useEffect, useState } from 'react'

export type SlideKind = 'title' | 'content' | 'question' | 'task' | 'media'
export type Slide = { id: string; kind: SlideKind; title: string; body?: string; options?: string[]; answer?: number; url?: string; minutes?: number }
export type Plan = {
  id: string; org_id: string; teacher_id: string | null; title: string; subject: string | null; grades: string | null; program: string | null
  from_package: boolean; is_template: boolean; status: 'draft' | 'editing' | 'pending' | 'approved' | 'rejected' | 'published' | 'archived'; summary: string | null; slides: Slide[]; updated_at: string
  library_item_id?: string | null; library_version?: number | null
  teachers?: { full_name: string } | null
}

export const KIND: Record<SlideKind, string> = { title: 'Trang bìa', content: 'Nội dung', question: 'Câu hỏi', task: 'Nhiệm vụ', media: 'Video / hình' }
const uid = () => Math.random().toString(36).slice(2, 9)
export const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 60) return `${Math.max(1, m)} phút trước`
  if (m < 1440) return `${Math.round(m / 60)} giờ trước`
  return `${Math.round(m / 1440)} ngày trước`
}
export const newSlide = (kind: SlideKind): Slide => ({
  id: uid(), kind, title: kind === 'title' ? 'Tên bài học' : '', body: '',
  ...(kind === 'question' ? { options: ['', ''], answer: 0 } : {}), ...(kind === 'task' ? { minutes: 10 } : {}), ...(kind === 'media' ? { url: '' } : {}),
})

// Chuyển link YouTube thường thành link nhúng
function embedUrl(url: string) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/)
  return m ? `https://www.youtube.com/embed/${m[1]}` : url
}
const isImage = (url: string) => /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(url)

// Hiển thị một slide (dùng cho xem thử, trình chiếu trên lớp, và về sau màn học sinh).
// Có onEdit: gõ thẳng tiêu đề, nội dung, phương án trên slide.
export function SlideView({ slide, reveal, hideOptions, onEdit }: { slide: Slide | undefined; reveal?: boolean; hideOptions?: boolean; onEdit?: (p: Partial<Slide>) => void }) {
  if (!slide) return <div className="slide empty">Bài giảng chưa có slide.</div>
  const ed = !!onEdit
  const opts = slide.options ?? []
  return (
    <div className={'slide ' + slide.kind + (ed ? ' editing' : '')}>
      <span className="slidekind">{KIND[slide.kind]}{slide.kind === 'task' && slide.minutes ? ` · ${slide.minutes} phút` : ''}</span>
      {ed ? <textarea className="sledit h2" rows={1} value={slide.title} placeholder="Bấm để nhập tiêu đề" aria-label="Tiêu đề slide"
          onChange={e => onEdit!({ title: e.target.value.replace(/\n/g, ' ') })} />
        : <h2>{slide.title || <i>Chưa có tiêu đề</i>}</h2>}
      {ed ? (slide.kind !== 'media' || slide.body) && <textarea className="sledit slidebody" rows={Math.max(2, (slide.body ?? '').split('\n').length)} value={slide.body ?? ''}
          placeholder={slide.kind === 'question' ? 'Bấm để nhập câu hỏi' : 'Bấm để nhập nội dung, mỗi dòng một ý'} aria-label="Nội dung slide" onChange={e => onEdit!({ body: e.target.value })} />
        : slide.body && <div className="slidebody">{slide.body.split('\n').map((l, i) => <p key={i}>{l}</p>)}</div>}
      {slide.kind === 'question' && !hideOptions && (
        <ol className="opts">
          {opts.map((o, i) => (
            <li key={i} className={reveal && slide.answer === i ? 'right' : ''}>
              {ed ? <>
                <button type="button" className="optkey" title="Đặt làm đáp án đúng" aria-label={`Đáp án ${String.fromCharCode(65 + i)} đúng`} aria-pressed={slide.answer === i} onClick={() => onEdit!({ answer: i })}>{String.fromCharCode(65 + i)}</button>
                <input className="sledit" value={o} placeholder={`Phương án ${String.fromCharCode(65 + i)}`} onChange={e => onEdit!({ options: opts.map((x, j) => j === i ? e.target.value : x) })} />
                {opts.length > 2 && <button type="button" className="x" aria-label="Xoá phương án" onClick={() => onEdit!({ options: opts.filter((_, j) => j !== i), answer: slide.answer === i ? 0 : (slide.answer ?? 0) > i ? (slide.answer ?? 0) - 1 : slide.answer })}>×</button>}
              </> : <><b>{String.fromCharCode(65 + i)}</b> {o}</>}
            </li>
          ))}
          {ed && opts.length < 6 && <li className="optadd"><button type="button" className="linkbtn" onClick={() => onEdit!({ options: [...opts, ''] })}>+ Phương án</button></li>}
        </ol>
      )}
      {slide.kind === 'question' && ed && <small className="slhint">Bấm chữ cái A, B, C… để chọn đáp án đúng.</small>}
      {slide.kind === 'media' && ed && <input className="sledit url" type="url" value={slide.url ?? ''} placeholder="Dán đường dẫn video YouTube hoặc ảnh" aria-label="Đường dẫn video hoặc ảnh" onChange={e => onEdit!({ url: e.target.value })} />}
      {slide.kind === 'media' && slide.url && (
        isImage(slide.url) ? <img src={slide.url} alt={slide.title} />
          : <iframe src={embedUrl(slide.url)} title={slide.title || 'Video'} allow="autoplay; encrypted-media; fullscreen" allowFullScreen />
      )}
    </div>
  )
}

// Trình chiếu toàn màn hình cho danh sách slide (← → để chuyển, Esc để thoát)
export function SlideShow({ slides, start = 0, title, onClose }: { slides: Slide[]; start?: number; title?: string; onClose: () => void }) {
  const [i, setI] = useState(Math.min(start, Math.max(0, slides.length - 1)))
  const [reveal, setReveal] = useState(false)
  const go = (d: number) => { setI(x => Math.max(0, Math.min(slides.length - 1, x + d))); setReveal(false) }
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(1) } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1); else if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [slides.length])
  const cur = slides[i]
  return (
    <div className="overlay show" role="dialog" aria-modal="true" aria-label={'Trình chiếu' + (title ? ': ' + title : '')}>
      <div className="showtop">{title && <b>{title}</b>}<span style={{ marginLeft: 'auto' }}>Slide {i + 1}/{slides.length || 1}</span>
        {cur?.kind === 'question' && <button type="button" onClick={() => setReveal(r => !r)}>{reveal ? 'Ẩn đáp án' : 'Hiện đáp án'}</button>}
        <button type="button" onClick={() => document.querySelector('.overlay.show')?.requestFullscreen?.()}>Toàn màn hình</button>
        <button type="button" className="x" onClick={onClose} aria-label="Thoát trình chiếu">×</button></div>
      <div className="showstage"><div className="showslide"><SlideView slide={cur} reveal={reveal} /></div></div>
      <div className="showbot">
        <button type="button" onClick={() => go(-1)} disabled={i === 0}>‹ Trước</button>
        <span className="dots">{slides.map((_, k) => <i key={k} className={k === i ? 'on' : ''} onClick={() => { setI(k); setReveal(false) }} />)}</span>
        <button type="button" onClick={() => go(1)} disabled={i >= slides.length - 1}>Sau ›</button>
      </div>
    </div>
  )
}

// Soạn slide trình chiếu (dùng trong trình soạn giáo án): sửa trực tiếp trên slide, có nút Trình chiếu
export function SlideStudio({ slides, onChange, readOnly }: { slides: Slide[]; onChange: (s: Slide[]) => void; readOnly?: boolean }) {
  const [sel, setSel] = useState(0)
  const [show, setShow] = useState(false)
  const cur = slides[sel]
  const setSlide = (patch: Partial<Slide>) => onChange(slides.map((s, i) => i === sel ? { ...s, ...patch } : s))
  const add = (kind: SlideKind) => { onChange([...slides.slice(0, sel + 1), newSlide(kind), ...slides.slice(sel + 1)]); setSel(slides.length ? sel + 1 : 0) }
  const move = (d: -1 | 1) => {
    const j = sel + d; if (j < 0 || j >= slides.length) return
    const next = [...slides]; [next[sel], next[j]] = [next[j], next[sel]]; onChange(next); setSel(j)
  }
  const del = () => { if (slides.length <= 1) return; onChange(slides.filter((_, i) => i !== sel)); setSel(Math.max(0, sel - 1)) }
  return (
    <div className="studio">
      <div className="panel slidelist">
        {slides.map((s, i) => (
          <button key={s.id} className={i === sel ? 'on' : ''} onClick={() => setSel(i)}>
            <small>{i + 1} · {KIND[s.kind]}</small><span>{s.title || <i>Chưa có tiêu đề</i>}</span>
          </button>
        ))}
        {!readOnly && <div className="addslide">
          <small>Thêm slide sau slide đang chọn</small>
          {(Object.keys(KIND) as SlideKind[]).map(k => <button key={k} onClick={() => add(k)}>+ {KIND[k]}</button>)}
        </div>}
      </div>
      <div>
        <div className="sltools">
          {!readOnly && cur && <>
            <select value={cur.kind} aria-label="Loại slide" onChange={e => setSlide({ ...newSlide(e.target.value as SlideKind), id: cur.id, title: cur.title, body: cur.body })}>
              {(Object.keys(KIND) as SlideKind[]).map(k => <option key={k} value={k}>{KIND[k]}</option>)}</select>
            {cur.kind === 'task' && <label className="inl">Thời gian <input type="number" min={1} max={90} value={cur.minutes ?? 10} onChange={e => setSlide({ minutes: Number(e.target.value) || 1 })} style={{ width: 64 }} /> phút</label>}
            <button onClick={() => move(-1)} disabled={sel === 0} aria-label="Đưa lên">↑</button>
            <button onClick={() => move(1)} disabled={sel === slides.length - 1} aria-label="Đưa xuống">↓</button>
            <button onClick={del} disabled={slides.length <= 1}>Xoá slide</button>
          </>}
          <button className="primary" style={{ marginLeft: 'auto' }} disabled={!slides.length} onClick={() => setShow(true)}>▶ Trình chiếu</button>
        </div>
        <SlideView slide={cur} reveal onEdit={readOnly ? undefined : setSlide} />
        {!readOnly && cur && <small className="sub">Bấm vào tiêu đề, nội dung hoặc phương án trên slide để sửa trực tiếp.</small>}
      </div>
      {show && <SlideShow slides={slides} start={sel} onClose={() => setShow(false)} />}
    </div>
  )
}
