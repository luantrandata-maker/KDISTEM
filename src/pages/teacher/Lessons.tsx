import { useEffect, useState } from 'react'

export type SlideKind = 'title' | 'content' | 'question' | 'task' | 'media'
export type SlideLayout = 'text' | 'center' | 'img-right' | 'img-left' | 'two'
/** Định dạng (tuỳ chọn, slide cũ không có vẫn hiển thị như trước): chủ đề màu, bố cục, ảnh, kiểu chữ */
export type SlideStyle = { theme?: string; bg?: string; layout?: SlideLayout; image?: string; body2?: string
  size?: 's' | 'm' | 'l' | 'xl'; color?: string; bold?: boolean; italic?: boolean; align?: 'left' | 'center'; bullets?: boolean
  /** Sắp xếp các ô: thứ tự tiêu đề / nội dung / phần thêm (ảnh, phương án, video), vị trí theo chiều dọc, độ rộng cột ảnh (%) */
  order?: SlideBlock[]; valign?: 'top' | 'middle' | 'bottom'; split?: number }
export type SlideBlock = 'title' | 'body' | 'extra'
const ORDER: SlideBlock[] = ['title', 'body', 'extra']
const VALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const
export type Slide = { id: string; kind: SlideKind; title: string; body?: string; options?: string[]; answer?: number; url?: string; minutes?: number } & SlideStyle
export type Plan = {
  id: string; org_id: string; teacher_id: string | null; title: string; subject: string | null; grades: string | null; program: string | null
  from_package: boolean; is_template: boolean; status: 'draft' | 'editing' | 'pending' | 'approved' | 'rejected' | 'published' | 'archived'; summary: string | null; slides: Slide[]; updated_at: string
  library_item_id?: string | null; library_version?: number | null
  teachers?: { full_name: string } | null
}

export const KIND: Record<SlideKind, string> = { title: 'Trang bìa', content: 'Nội dung', question: 'Câu hỏi', task: 'Nhiệm vụ', media: 'Video / hình' }
/** Chủ đề màu: [tên, nền, màu chữ, màu nhấn] */
export const THEMES: Record<string, [string, string, string, string]> = {
  trang: ['Trắng', '#ffffff', '#0f172a', '#2563eb'],
  giay: ['Giấy kem', '#fdf6e3', '#3f2d16', '#b45309'],
  navy: ['Xanh đậm', '#16325c', '#ffffff', '#93c5fd'],
  bien: ['Biển', 'linear-gradient(135deg,#0ea5e9,#2563eb)', '#ffffff', '#e0f2fe'],
  la: ['Lá non', 'linear-gradient(135deg,#dcfce7,#86efac)', '#14532d', '#15803d'],
  nang: ['Nắng', 'linear-gradient(135deg,#fef3c7,#fdba74)', '#431407', '#c2410c'],
  tim: ['Tím', 'linear-gradient(135deg,#a78bfa,#6d28d9)', '#ffffff', '#ede9fe'],
  hong: ['Hồng', 'linear-gradient(135deg,#fce7f3,#f9a8d4)', '#500724', '#be185d'],
  toi: ['Tối', '#0b1220', '#f8fafc', '#fbbf24'],
}
export const LAYOUTS: Record<SlideLayout, string> = { text: 'Tiêu đề + nội dung', center: 'Căn giữa (trang lớn)', 'img-right': 'Nội dung + ảnh bên phải', 'img-left': 'Ảnh bên trái + nội dung', two: 'Hai cột chữ' }
const SIZES = { s: 0.85, m: 1, l: 1.2, xl: 1.45 }
const lines = (t: string) => t.split('\n').map(x => x.trim()).filter(Boolean)
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
  const th = slide.theme ? THEMES[slide.theme] : undefined
  const lay = slide.layout ?? 'text'
  const withImg = (lay === 'img-right' || lay === 'img-left') && slide.kind !== 'media'
  const box: React.CSSProperties & Record<string, string | number> = {
    ...(th ? { background: th[1], color: th[2], '--sl-accent': th[3] } : {}), ...(slide.bg ? { background: slide.bg } : {}),
    '--slz': SIZES[slide.size ?? 'm'], ...(slide.color ? { color: slide.color } : {}), ...(slide.align ? { textAlign: slide.align } : {}),
  }
  const ord = slide.order?.length === 3 ? slide.order : ORDER
  const at = (k: SlideBlock): React.CSSProperties => ({ order: ord.indexOf(k) + 1 })
  if (slide.valign) box.justifyContent = VALIGN[slide.valign]
  const bodyCls = 'slidebody' + (slide.bold ? ' b' : '') + (slide.italic ? ' i' : '')
  const bodyView = (t: string | undefined) => t ? (slide.bullets
    ? <ul className={bodyCls} style={at('body')}>{lines(t).map((l, i) => <li key={i}>{l}</li>)}</ul>
    : <div className={bodyCls} style={at('body')}>{t.split('\n').map((l, i) => <p key={i}>{l}</p>)}</div>) : null
  const bodyEdit = (k: 'body' | 'body2', ph: string) => <textarea className={'sledit ' + bodyCls + (slide.bullets ? ' bul' : '')} rows={Math.max(2, (slide[k] ?? '').split('\n').length)} value={slide[k] ?? ''} style={at('body')}
    placeholder={ph} aria-label={k === 'body' ? 'Nội dung slide' : 'Nội dung cột 2'} onChange={e => onEdit!({ [k]: e.target.value })} />
  const title = ed ? <textarea className="sledit h2" rows={1} value={slide.title} style={at('title')} placeholder="Bấm để nhập tiêu đề" aria-label="Tiêu đề slide"
      onChange={e => onEdit!({ title: e.target.value.replace(/\n/g, ' ') })} />
    : <h2 style={at('title')}>{slide.title || <i>Chưa có tiêu đề</i>}</h2>
  const body = ed ? (slide.kind !== 'media' || slide.body) && bodyEdit('body', slide.kind === 'question' ? 'Bấm để nhập câu hỏi' : 'Bấm để nhập nội dung, mỗi dòng một ý')
    : bodyView(slide.body)
  const text = lay === 'two' && slide.kind !== 'media'
    ? <>{title}<div className="sltwo" style={at('body')}><div>{body}</div><div>{ed ? bodyEdit('body2', 'Bấm để nhập nội dung cột 2') : bodyView(slide.body2)}</div></div></>
    : <>{title}{body}</>
  const img = slide.image ? <img src={slide.image} alt={slide.title} /> : ed ? <div className="slimgph">Dán đường dẫn ảnh ở ô "Ảnh" trên thanh định dạng</div> : null
  return (
    <div className={'slide ' + slide.kind + ' lay-' + lay + (th || slide.bg ? ' themed' : '') + (ed ? ' editing' : '')} style={box}>
      <span className="slidekind">{KIND[slide.kind]}{slide.kind === 'task' && slide.minutes ? ` · ${slide.minutes} phút` : ''}</span>
      {withImg ? <div className={'slcols' + (lay === 'img-left' ? ' rev' : '')} style={{ order: Math.min(ord.indexOf('title'), ord.indexOf('body')) + 1, ...(slide.split ? { gridTemplateColumns: lay === 'img-left'
          ? `minmax(0,${slide.split}fr) minmax(0,${100 - slide.split}fr)` : `minmax(0,${100 - slide.split}fr) minmax(0,${slide.split}fr)` } : {}) }}>
        <div className="sltext" style={slide.valign ? { justifyContent: VALIGN[slide.valign], alignSelf: 'stretch' } : undefined}>{text}</div>{img && <div className="slimg">{img}</div>}</div> : text}
      {!withImg && lay !== 'two' && slide.image && slide.kind !== 'media' && <img className="slpic" src={slide.image} alt={slide.title} style={at('extra')} />}
      {slide.kind === 'question' && !hideOptions && (
        <ol className="opts" style={at('extra')}>
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
      {slide.kind === 'question' && ed && <small className="slhint" style={at('extra')}>Bấm chữ cái A, B, C… để chọn đáp án đúng.</small>}
      {slide.kind === 'media' && ed && <input className="sledit url" type="url" style={at('extra')} value={slide.url ?? ''} placeholder="Dán đường dẫn video YouTube hoặc ảnh" aria-label="Đường dẫn video hoặc ảnh" onChange={e => onEdit!({ url: e.target.value })} />}
      {slide.kind === 'media' && slide.url && (
        isImage(slide.url) ? <img src={slide.url} alt={slide.title} style={at('extra')} />
          : <iframe style={at('extra')} src={embedUrl(slide.url)} title={slide.title || 'Video'} allow="autoplay; encrypted-media; fullscreen" allowFullScreen />
      )}
    </div>
  )
}

/** Thanh định dạng slide (kiểu Canva / PowerPoint): chủ đề màu, bố cục, ảnh, kiểu chữ. onAll: áp chủ đề cho mọi slide */
export function SlideFormat({ slide, onEdit, onAll, onDup }: { slide: Slide; onEdit: (p: Partial<Slide>) => void; onAll?: (p: Partial<Slide>) => void; onDup?: () => void }) {
  const tog = (k: 'bold' | 'italic' | 'bullets') => onEdit({ [k]: !slide[k] })
  return <div className="slformat">
    <div className="slfrow"><small>Chủ đề</small>
      <button type="button" className={'slsw auto' + (!slide.theme && !slide.bg ? ' on' : '')} title="Mặc định" aria-label="Chủ đề mặc định" onClick={() => onEdit({ theme: undefined, bg: undefined })}>A</button>
      {Object.entries(THEMES).map(([k, t]) => <button key={k} type="button" className={'slsw' + (slide.theme === k && !slide.bg ? ' on' : '')} title={t[0]} aria-label={'Chủ đề ' + t[0]}
        style={{ background: t[1], color: t[2] }} onClick={() => onEdit({ theme: k, bg: undefined })}>A</button>)}
      <label className="slcolor" title="Màu nền tự chọn">Nền <input type="color" value={slide.bg && slide.bg.startsWith('#') ? slide.bg : '#ffffff'} onChange={e => onEdit({ bg: e.target.value })} aria-label="Màu nền" /></label>
      {onAll && <button type="button" className="linkbtn" onClick={() => onAll({ theme: slide.theme, bg: slide.bg })}>Áp dụng cho mọi slide</button>}
    </div>
    <div className="slfrow"><small>Bố cục</small>
      <select value={slide.layout ?? 'text'} aria-label="Bố cục slide" onChange={e => onEdit({ layout: e.target.value as SlideLayout })}>
        {(Object.keys(LAYOUTS) as SlideLayout[]).map(k => <option key={k} value={k}>{LAYOUTS[k]}</option>)}</select>
      {slide.kind !== 'media' && <input type="url" className="slurl" value={slide.image ?? ''} placeholder="Ảnh: dán đường dẫn https://…" aria-label="Đường dẫn ảnh" onChange={e => onEdit({ image: e.target.value || undefined })} />}
      {onDup && <button type="button" onClick={onDup} title="Nhân bản slide">⧉ Nhân bản</button>}
    </div>
    <SlideArrange slide={slide} onEdit={onEdit} />
    <div className="slfrow"><small>Chữ</small>
      <button type="button" className={slide.bold ? 'on' : ''} aria-pressed={!!slide.bold} aria-label="Chữ đậm" onClick={() => tog('bold')}><b>B</b></button>
      <button type="button" className={slide.italic ? 'on' : ''} aria-pressed={!!slide.italic} aria-label="Chữ nghiêng" onClick={() => tog('italic')}><i>I</i></button>
      <button type="button" className={slide.bullets ? 'on' : ''} aria-pressed={!!slide.bullets} aria-label="Gạch đầu dòng" onClick={() => tog('bullets')}>• Danh sách</button>
      <select value={slide.size ?? 'm'} aria-label="Cỡ chữ" onChange={e => onEdit({ size: e.target.value as Slide['size'] })}>
        <option value="s">Chữ nhỏ</option><option value="m">Chữ vừa</option><option value="l">Chữ lớn</option><option value="xl">Chữ rất lớn</option></select>
      <button type="button" className={(slide.align ?? 'left') === 'left' ? 'on' : ''} aria-label="Căn trái" onClick={() => onEdit({ align: 'left' })}>⯇ Trái</button>
      <button type="button" className={slide.align === 'center' ? 'on' : ''} aria-label="Căn giữa" onClick={() => onEdit({ align: 'center' })}>≡ Giữa</button>
      <label className="slcolor" title="Màu chữ">Màu chữ <input type="color" value={slide.color ?? '#0f172a'} onChange={e => onEdit({ color: e.target.value })} aria-label="Màu chữ" /></label>
      {slide.color && <button type="button" className="linkbtn" onClick={() => onEdit({ color: undefined })}>Bỏ màu</button>}
    </div>
  </div>
}

/** Sắp xếp các ô trên slide: đổi thứ tự (↑ ↓), đặt vị trí trên / giữa / dưới, chỉnh độ rộng cột ảnh */
function SlideArrange({ slide, onEdit }: { slide: Slide; onEdit: (p: Partial<Slide>) => void }) {
  const ord = slide.order?.length === 3 ? slide.order : ORDER
  const lay = slide.layout ?? 'text', withImg = (lay === 'img-right' || lay === 'img-left') && slide.kind !== 'media'
  const extra = slide.kind === 'question' ? 'Phương án' : slide.kind === 'media' ? 'Video / ảnh' : !withImg && lay !== 'two' && slide.image ? 'Ảnh' : null
  const name: Record<SlideBlock, string | null> = { title: 'Tiêu đề', body: lay === 'two' ? 'Hai cột chữ' : 'Nội dung', extra }
  const shown = ord.filter(k => name[k])
  const move = (k: SlideBlock, d: number) => { const i = shown.indexOf(k), j = i + d; if (j < 0 || j >= shown.length) return
    const a = [...shown]; [a[i], a[j]] = [a[j], a[i]]; onEdit({ order: [...a, ...ORDER.filter(x => !a.includes(x))] }) }
  const changed = !!(slide.order || slide.valign || slide.split)
  return <div className="slfrow"><small>Sắp xếp</small>
    {shown.map((k, i) => <span key={k} className="slblk">{i + 1}. {name[k]}
      <button type="button" disabled={!i} aria-label={'Đưa ' + name[k] + ' lên trước'} onClick={() => move(k, -1)}>↑</button>
      <button type="button" disabled={i === shown.length - 1} aria-label={'Đưa ' + name[k] + ' xuống sau'} onClick={() => move(k, 1)}>↓</button></span>)}
    <select value={slide.valign ?? ''} aria-label="Vị trí nội dung theo chiều dọc" onChange={e => onEdit({ valign: (e.target.value || undefined) as Slide['valign'] })}>
      <option value="">Vị trí: mặc định</option><option value="top">Đặt ở trên</option><option value="middle">Đặt ở giữa</option><option value="bottom">Đặt ở dưới</option></select>
    {withImg && <label className="slcolor" title="Độ rộng cột ảnh">Cột ảnh <input type="range" min={25} max={70} step={5} value={slide.split ?? 46} aria-label="Độ rộng cột ảnh"
      onChange={e => onEdit({ split: Number(e.target.value) })} /> {slide.split ?? 46}%</label>}
    {changed && <button type="button" className="linkbtn" onClick={() => onEdit({ order: undefined, valign: undefined, split: undefined })}>Đặt lại</button>}
  </div>
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
  const dup = () => { if (!cur) return; onChange([...slides.slice(0, sel + 1), { ...JSON.parse(JSON.stringify(cur)), id: uid() }, ...slides.slice(sel + 1)]); setSel(sel + 1) }
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
            <select value={cur.kind} aria-label="Loại slide" onChange={e => { const { id, kind: _k, title, body, options: _o, answer: _a, url: _u, minutes: _m, ...style } = cur; setSlide({ ...newSlide(e.target.value as SlideKind), ...style, id, title, body }) }}>
              {(Object.keys(KIND) as SlideKind[]).map(k => <option key={k} value={k}>{KIND[k]}</option>)}</select>
            {cur.kind === 'task' && <label className="inl">Thời gian <input type="number" min={1} max={90} value={cur.minutes ?? 10} onChange={e => setSlide({ minutes: Number(e.target.value) || 1 })} style={{ width: 64 }} /> phút</label>}
            <button onClick={() => move(-1)} disabled={sel === 0} aria-label="Đưa lên">↑</button>
            <button onClick={() => move(1)} disabled={sel === slides.length - 1} aria-label="Đưa xuống">↓</button>
            <button onClick={del} disabled={slides.length <= 1}>Xoá slide</button>
          </>}
          <button className="primary" style={{ marginLeft: 'auto' }} disabled={!slides.length} onClick={() => setShow(true)}>▶ Trình chiếu</button>
        </div>
        {!readOnly && cur && <SlideFormat slide={cur} onEdit={setSlide} onDup={dup}
          onAll={p => onChange(slides.map(x => ({ ...x, ...p })))} />}
        <SlideView slide={cur} reveal onEdit={readOnly ? undefined : setSlide} />
        {!readOnly && cur && <small className="sub">Bấm vào tiêu đề, nội dung hoặc phương án trên slide để sửa trực tiếp.</small>}
      </div>
      {show && <SlideShow slides={slides} start={sel} onClose={() => setShow(false)} />}
    </div>
  )
}
