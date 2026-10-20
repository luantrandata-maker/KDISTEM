import { useState } from 'react'

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

// Soạn slide trình chiếu (dùng trong trình soạn giáo án)
export function SlideStudio({ slides, onChange, readOnly }: { slides: Slide[]; onChange: (s: Slide[]) => void; readOnly?: boolean }) {
  const [sel, setSel] = useState(0)
  const cur = slides[sel]
  const upd = (patch: { slides: Slide[] }) => onChange(patch.slides)
  const setSlide = (patch: Partial<Slide>) => upd({ slides: slides.map((s, i) => i === sel ? { ...s, ...patch } : s) })
  const add = (kind: SlideKind) => { const next = [...slides.slice(0, sel + 1), newSlide(kind), ...slides.slice(sel + 1)]; upd({ slides: next }); setSel(slides.length ? sel + 1 : 0) }
  const move = (d: -1 | 1) => {
    const j = sel + d; if (j < 0 || j >= slides.length) return
    const next = [...slides]; [next[sel], next[j]] = [next[j], next[sel]]; upd({ slides: next }); setSel(j)
  }
  const del = () => { if (slides.length <= 1) return; upd({ slides: slides.filter((_, i) => i !== sel) }); setSel(Math.max(0, sel - 1)) }
  if (readOnly) return (
    <div className="studio">
      <div className="panel slidelist">
        {slides.map((s, i) => (
          <button key={s.id} className={i === sel ? 'on' : ''} onClick={() => setSel(i)}>
            <small>{i + 1} · {KIND[s.kind]}</small><span>{s.title || <i>Chưa có tiêu đề</i>}</span>
          </button>
        ))}
      </div>
      <div><SlideView slide={cur} reveal /></div>
    </div>
  )
  return (
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
  )
}
