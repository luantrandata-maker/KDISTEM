import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { uploadSlideImage } from '../../lib/files'

export type SlideKind = 'title' | 'content' | 'question' | 'task' | 'media' | 'activity'
/** Hoạt động lấy từ Kho hoạt động gắn vào slide: lưu mã (id) để mở / cập nhật theo Kho và bản chụp nội dung để học sinh chơi được ngay */
export type KhoAct = { id: string; kind: string; label?: string; title: string; content: any; instructions?: string | null; updated_at?: string; status?: string }
// Phần chơi hoạt động trên slide (tải khi cần, tránh vòng import với trình chơi hoạt động)
const ActSlide = lazy(() => import('./ActSlide'))
const ActivityPicker = lazy(() => import('./ActivityPicker').then(m => ({ default: m.ActivityPicker })))
/** Hướng dẫn của hoạt động, bỏ dòng "Bài học: …" do hệ thống ghi khi chốt bài */
export const actNote = (s?: string | null) => (s ?? '').split('\n').filter(l => !/^\s*Bài học:/.test(l)).join(' ').trim()
export type SlideLayout = 'text' | 'center' | 'img-right' | 'img-left' | 'two'
/** Định dạng (tuỳ chọn, slide cũ không có vẫn hiển thị như trước): chủ đề màu, bố cục, ảnh, kiểu chữ */
export type SlideStyle = { theme?: string; bg?: string; layout?: SlideLayout; image?: string; body2?: string
  size?: 's' | 'm' | 'l' | 'xl'; color?: string; bold?: boolean; italic?: boolean; align?: 'left' | 'center'; bullets?: boolean
  /** Sắp xếp các ô: thứ tự tiêu đề / nội dung / phần thêm (ảnh, phương án, video), vị trí theo chiều dọc, độ rộng cột ảnh (%) */
  order?: SlideBlock[]; valign?: 'top' | 'middle' | 'bottom'; split?: number
  /** Kiểu trình bày nội dung: mỗi dòng thành thẻ đánh số / bước quy trình / ô lưới */
  deco?: SlideDeco
  /** Kiểu ảnh: vừa khung (không cắt), phủ kín khung, làm nền cả slide */
  fit?: 'contain' | 'cover' | 'bg'
  /** Bộ nhận diện của cả bài (lưu ở mọi slide để đi theo bài khi phát hành / nhân bản) */
  brand?: Brand }
export type SlideDeco = 'cards' | 'steps' | 'grid'
/** Bộ nhận diện: thanh tiêu đề (logo, nhãn, tên bài), số trang ở chân, màu thanh */
export type Brand = { bar?: boolean; title?: string; label?: string; mark?: string; logo?: string; num?: boolean; color?: string }
export const BRAND_COLORS = ['#0f3a76', '#1f5bb8', '#16a34a', '#7c3aed', '#0ea5e9', '#c2410c', '#be185d', '#0b1220']
export const DECOS: Record<SlideDeco | '', string> = { '': 'Đoạn chữ', cards: 'Thẻ đánh số', steps: 'Các bước (ngang)', grid: 'Lưới ô' }
export type SlideBlock = 'title' | 'body' | 'extra'
const ORDER: SlideBlock[] = ['title', 'body', 'extra']
const VALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const
export type Slide = { id: string; kind: SlideKind; title: string; body?: string; options?: string[]; answer?: number; url?: string; minutes?: number; act?: KhoAct } & SlideStyle
export type Plan = {
  id: string; org_id: string; teacher_id: string | null; title: string; subject: string | null; grades: string | null; program: string | null
  from_package: boolean; is_template: boolean; status: 'draft' | 'editing' | 'pending' | 'approved' | 'rejected' | 'published' | 'archived'; summary: string | null; slides: Slide[]; updated_at: string
  library_item_id?: string | null; library_version?: number | null
  teachers?: { full_name: string } | null
}

export const KIND: Record<SlideKind, string> = { title: 'Trang bìa', content: 'Nội dung', question: 'Câu hỏi', task: 'Nhiệm vụ', media: 'Video / hình', activity: 'Hoạt động' }
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
// Có onImage: kéo thả ảnh vào slide hoặc bấm ô ảnh để chọn ảnh từ máy. n / total: số trang ở chân (khi bật trong bộ nhận diện).
// thumb: ô thu nhỏ (danh sách slide, dải slide) — slide hoạt động chỉ hiện ô tím thay vì nạp trình chơi
export function SlideView({ slide, reveal, hideOptions, onEdit, onImage, imgBusy, n, total, thumb }: { slide: Slide | undefined; reveal?: boolean; hideOptions?: boolean
  onEdit?: (p: Partial<Slide>) => void; onImage?: (f: File) => void; imgBusy?: boolean; n?: number; total?: number; thumb?: boolean }) {
  const [drag, setDrag] = useState(false)
  if (!slide) return <div className="slide empty">Bài giảng chưa có slide.</div>
  if (slide.kind === 'activity') return <ActivitySlide slide={slide} n={n} total={total} thumb={thumb} />
  const ed = !!onEdit
  const opts = slide.options ?? []
  const th = slide.theme ? THEMES[slide.theme] : undefined
  const lay = slide.layout ?? 'text'
  const asBg = slide.fit === 'bg' && !!slide.image && slide.kind !== 'media'
  const withImg = (lay === 'img-right' || lay === 'img-left') && slide.kind !== 'media' && !asBg
  const box: React.CSSProperties & Record<string, string | number> = {
    ...(th ? { background: th[1], color: th[2], '--sl-accent': th[3] } : {}), ...(slide.bg ? { background: slide.bg } : {}),
    '--slz': SIZES[slide.size ?? 'm'], ...(slide.color ? { color: slide.color } : {}), ...(slide.align ? { textAlign: slide.align } : {}),
    ...(asBg ? { background: `linear-gradient(rgba(10,20,40,.55),rgba(10,20,40,.55)), url("${slide.image}") center/cover no-repeat`, color: slide.color ?? '#fff', '--sl-accent': '#fde68a' } : {}),
  }
  const ord = slide.order?.length === 3 ? slide.order : ORDER
  const at = (k: SlideBlock): React.CSSProperties => ({ order: ord.indexOf(k) + 1 })
  if (slide.valign) box.justifyContent = VALIGN[slide.valign]
  const bodyCls = 'slidebody' + (slide.bold ? ' b' : '') + (slide.italic ? ' i' : '')
  const deco = slide.deco && slide.kind !== 'media' && slide.kind !== 'question' && lay !== 'two' ? slide.deco : undefined
  // Mỗi dòng nội dung thành một thẻ / bước / ô; khi sửa thì mỗi ý là một ô nhập
  const decoView = (d: SlideDeco) => {
    const raw = (slide.body ?? '').split('\n'), list = ed ? raw : lines(slide.body ?? '')
    const put = (a: string[]) => onEdit!({ body: a.join('\n') })
    return <div className={'sldeco d-' + d + ' ' + bodyCls} style={at('body')}>
      {list.map((l, i) => <div key={i} className="sldc">{d !== 'grid' && <b className="sldn">{i + 1}</b>}
        {ed ? <textarea className="sledit" rows={1} value={l} placeholder={d === 'grid' ? 'Tên vật liệu / ý' : `Ý ${i + 1}`} aria-label={`Ý ${i + 1}`}
            onChange={e => put(raw.map((x, j) => j === i ? e.target.value.replace(/\n/g, ' ') : x))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); put([...raw.slice(0, i + 1), '', ...raw.slice(i + 1)])
              requestAnimationFrame(() => ((e.target as HTMLElement).closest('.sldeco')?.querySelectorAll('textarea')[i + 1] as HTMLTextAreaElement | undefined)?.focus()) } }} />
          : <span>{l}</span>}
        {ed && raw.length > 1 && <button type="button" className="x" aria-label={`Xoá ý ${i + 1}`} onClick={() => put(raw.filter((_, j) => j !== i))}>×</button>}</div>)}
      {ed && raw.length < 9 && <button type="button" className="linkbtn sldadd" onClick={() => put([...raw, ''])}>+ Thêm ý</button>}
    </div>
  }
  const bodyView = (t: string | undefined) => t ? (slide.bullets
    ? <ul className={bodyCls} style={at('body')}>{lines(t).map((l, i) => <li key={i}>{l}</li>)}</ul>
    : <div className={bodyCls} style={at('body')}>{t.split('\n').map((l, i) => <p key={i}>{l}</p>)}</div>) : null
  const bodyEdit = (k: 'body' | 'body2', ph: string) => <textarea className={'sledit ' + bodyCls + (slide.bullets ? ' bul' : '')} rows={Math.max(2, (slide[k] ?? '').split('\n').length)} value={slide[k] ?? ''} style={at('body')}
    placeholder={ph} aria-label={k === 'body' ? 'Nội dung slide' : 'Nội dung cột 2'} onChange={e => onEdit!({ [k]: e.target.value })} />
  const title = ed ? <textarea className="sledit h2" rows={1} value={slide.title} style={at('title')} placeholder="Bấm để nhập tiêu đề" aria-label="Tiêu đề slide"
      onChange={e => onEdit!({ title: e.target.value.replace(/\n/g, ' ') })} />
    : <h2 style={at('title')}>{slide.title || <i>Chưa có tiêu đề</i>}</h2>
  const body = deco ? decoView(deco)
    : ed ? (slide.kind !== 'media' || slide.body) && bodyEdit('body', slide.kind === 'question' ? 'Bấm để nhập câu hỏi' : 'Bấm để nhập nội dung, mỗi dòng một ý')
    : bodyView(slide.body)
  const text = lay === 'two' && slide.kind !== 'media'
    ? <>{title}<div className={'sltwo' + (slide.deco ? ' boxed' : '')} style={at('body')}><div>{body}</div><div>{ed ? bodyEdit('body2', 'Bấm để nhập nội dung cột 2') : bodyView(slide.body2)}</div></div></>
    : <>{title}{body}</>
  const pick = onImage && <input type="file" accept="image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onImage(f); e.target.value = '' }} />
  const img = slide.image ? <img src={slide.image} alt={slide.title} className={slide.fit === 'contain' ? 'contain' : ''} />
    : imgBusy ? <div className="slimgph">Đang tải ảnh lên…</div>
    : onImage ? <label className="slimgph up">🖼 Kéo thả ảnh vào đây, dán bằng Ctrl+V<br />hoặc <u>chọn ảnh từ máy</u>{pick}</label>
    : ed ? <div className="slimgph">Dán đường dẫn ảnh ở ô "Ảnh" trên thanh định dạng</div> : null
  // Bộ nhận diện: thanh trên cùng (trừ trang bìa: chỉ logo ở góc), số trang ở chân
  const br = slide.brand
  const logo = br?.logo ? <img className="sllogo" src={br.logo} alt="Logo" /> : br?.mark ? <b className="slmark">{br.mark}</b> : null
  const bar = !!br?.bar && slide.kind !== 'title'
  const num = !!br?.num && n != null
  const drop = onImage ? {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true) } },
    onDragLeave: () => setDrag(false),
    onDrop: (e: React.DragEvent) => { const f = Array.from(e.dataTransfer.files).find(x => x.type.startsWith('image/')); setDrag(false); if (f) { e.preventDefault(); onImage(f) } },
  } : {}
  return (
    <div className={'slide ' + slide.kind + ' lay-' + lay + (th || slide.bg || asBg ? ' themed' : '') + (asBg ? ' imgbg' : '') + (ed ? ' editing' : '') + (bar ? ' hasbar' : logo ? ' haslogo' : '') + (num ? ' hasnum' : '') + (drag ? ' dragon' : '')}
      style={box} {...drop}>
      {bar ? <div className="slbrand" style={br!.color ? { background: br!.color } : undefined}>{logo}{br!.label && <span>{br!.label}</span>}{br!.title && <span className="slbt">{br!.title}</span>}</div>
        : logo && <div className="slcorner">{logo}</div>}
      {num && <span className="slnum">{n}{total ? ` / ${total}` : ''}</span>}
      {slide.kind === 'task' && slide.minutes ? <span className="sltimer" aria-label={`Thời gian ${slide.minutes} phút`}>⏱ {slide.minutes}'</span> : null}
      <span className="slidekind">{KIND[slide.kind]}</span>
      {withImg ? <div className={'slcols' + (lay === 'img-left' ? ' rev' : '')} style={{ order: Math.min(ord.indexOf('title'), ord.indexOf('body')) + 1, ...(slide.split ? { gridTemplateColumns: lay === 'img-left'
          ? `minmax(0,${slide.split}fr) minmax(0,${100 - slide.split}fr)` : `minmax(0,${100 - slide.split}fr) minmax(0,${slide.split}fr)` } : {}) }}>
        <div className="sltext" style={slide.valign ? { justifyContent: VALIGN[slide.valign], alignSelf: 'stretch' } : undefined}>{text}</div>{img && <div className="slimg">{img}</div>}</div> : text}
      {!withImg && !asBg && lay !== 'two' && slide.image && slide.kind !== 'media' && <img className={'slpic' + (slide.fit === 'cover' ? ' cover' : '')} src={slide.image} alt={slide.title} style={at('extra')} />}
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

/** Slide hoạt động từ Kho: nhãn loại, tên, khung chơi (học sinh làm ngay trên slide khi trình chiếu), hướng dẫn */
function ActivitySlide({ slide, n, total, thumb }: { slide: Slide; n?: number; total?: number; thumb?: boolean }) {
  const a = slide.act
  const br = slide.brand
  const logo = br?.logo ? <img className="sllogo" src={br.logo} alt="Logo" /> : br?.mark ? <b className="slmark">{br.mark}</b> : null
  const note = actNote(a?.instructions)
  return <div className={'slide activity' + (br?.bar ? ' hasbar' : '') + (br?.num && n != null ? ' hasnum' : '') + (thumb ? ' thumb' : '')}>
    {br?.bar && <div className="slbrand" style={br.color ? { background: br.color } : undefined}>{logo}{br.label && <span>{br.label}</span>}{br.title && <span className="slbt">{br.title}</span>}</div>}
    {br?.num && n != null && <span className="slnum">{n}{total ? ` / ${total}` : ''}</span>}
    <span className="slidekind">🧪 Hoạt động{a?.label ? ' · ' + a.label : ''}</span>
    <h2>{slide.title || a?.title || <i>Chưa chọn hoạt động</i>}</h2>
    {!a ? <div className="slactph">Chưa chọn hoạt động. Bấm “Đổi hoạt động” để chọn từ Kho hoạt động.</div>
      : thumb ? <div className="slactph" aria-hidden>🧪</div>
      : <div className="slactbody"><Suspense fallback={<p className="sub">Đang tải hoạt động…</p>}><ActSlide act={a} /></Suspense></div>}
    {!thumb && note && <small className="slactnote">📝 {note}</small>}
  </div>
}

/** Thanh định dạng slide (kiểu Canva / PowerPoint): chủ đề màu, bố cục, ảnh, kiểu chữ. onAll: áp chủ đề cho mọi slide */
export function SlideFormat({ slide, onEdit, onAll, onDup, onImage, imgBusy }: { slide: Slide; onEdit: (p: Partial<Slide>) => void; onAll?: (p: Partial<Slide>) => void; onDup?: () => void
  onImage?: (f: File) => void; imgBusy?: boolean }) {
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
      {slide.kind !== 'media' && slide.kind !== 'question' && <select value={slide.deco ?? ''} aria-label="Kiểu trình bày nội dung" onChange={e => onEdit({ deco: (e.target.value || undefined) as SlideDeco | undefined })}>
        {Object.entries(DECOS).map(([k, v]) => <option key={k} value={k}>Nội dung: {v}</option>)}</select>}
      {onDup && <button type="button" onClick={onDup} title="Nhân bản slide">⧉ Nhân bản</button>}
    </div>
    {slide.kind !== 'media' && <div className="slfrow"><small>Ảnh</small>
      {onImage && <label className={'filebtn' + (imgBusy ? ' busy' : '')}>{imgBusy ? 'Đang tải…' : slide.image ? '🖼 Đổi ảnh' : '🖼 Tải ảnh lên'}
        <input type="file" accept="image/*" hidden disabled={imgBusy} onChange={e => { const f = e.target.files?.[0]; if (f) onImage(f); e.target.value = '' }} /></label>}
      <input type="url" className="slurl" value={slide.image ?? ''} placeholder={onImage ? 'hoặc dán đường dẫn ảnh https://…' : 'Ảnh: dán đường dẫn https://…'} aria-label="Đường dẫn ảnh" onChange={e => onEdit({ image: e.target.value || undefined })} />
      {slide.image && <select value={slide.fit ?? ''} aria-label="Kiểu ảnh" onChange={e => onEdit({ fit: (e.target.value || undefined) as Slide['fit'] })}>
        <option value="">Kiểu ảnh: tự động</option><option value="contain">Vừa khung (không cắt)</option><option value="cover">Phủ kín khung</option><option value="bg">Làm nền cả slide</option></select>}
      {slide.image && <button type="button" className="linkbtn" onClick={() => onEdit({ image: undefined, fit: undefined })}>Bỏ ảnh</button>}
    </div>}
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
  const extra = slide.kind === 'question' ? 'Phương án' : slide.kind === 'media' ? 'Video / ảnh' : !withImg && lay !== 'two' && slide.image && slide.fit !== 'bg' ? 'Ảnh' : null
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

// ===== Ảnh slide: tải lên kho ảnh, gắn vào slide =====
export function useSlideImage(orgId?: string | null) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const upload = async (f: File): Promise<string | null> => {
    if (!orgId) { setErr('Chưa xác định được đơn vị để lưu ảnh.'); return null }
    setBusy(true); setErr('')
    try { return await uploadSlideImage(orgId, f) } catch (e) { setErr((e as Error).message); return null } finally { setBusy(false) }
  }
  return { busy, err, upload, clear: () => setErr('') }
}
/** Gắn ảnh vào slide: slide video/hình → đường dẫn; bố cục chữ → ảnh bên phải; căn giữa / hai cột → ảnh làm nền */
export const withImage = (s: Slide, url: string): Partial<Slide> => s.kind === 'media' ? { url }
  : { image: url, ...(s.fit === 'bg' || s.layout === 'img-right' || s.layout === 'img-left' ? {} : s.layout === 'center' || s.layout === 'two' ? { fit: 'bg' as const } : { layout: 'img-right' as const }) }
/** Ảnh trong clipboard (dán bằng Ctrl+V) */
export const clipImage = (e: React.ClipboardEvent) => Array.from(e.clipboardData.files).find(f => f.type.startsWith('image/'))

// ===== Mẫu slide theo tiến trình một bài STEM =====
export const TEMPLATES: { key: string; name: string; make: () => Omit<Slide, 'id'> }[] = [
  { key: 'cover', name: 'Bìa có ảnh', make: () => ({ kind: 'title', title: 'Tên bài học', body: 'Môn · Khối · Chương trình', layout: 'img-right', split: 42, valign: 'middle' }) },
  { key: 'goals', name: 'Mục tiêu 3 thẻ', make: () => ({ kind: 'content', title: 'Mục tiêu bài học', body: 'Nêu được …\nLắp được …\nTrình bày được …', deco: 'cards', layout: 'img-right', split: 36 }) },
  { key: 'warm', name: 'Khởi động: câu hỏi lớn', make: () => ({ kind: 'content', title: 'Vì sao …?', body: 'Quan sát hình và đoán xem', layout: 'center', theme: 'bien', size: 'l' }) },
  { key: 'compare', name: 'So sánh 2 cột', make: () => ({ kind: 'content', title: 'So sánh', layout: 'two', deco: 'cards', body: 'Giống nhau\n…', body2: 'Khác nhau\n…' }) },
  { key: 'steps', name: 'Quy trình 4 bước', make: () => ({ kind: 'content', title: 'Các bước thực hiện', body: 'Quan sát\nThiết kế\nLắp ráp\nThử và sửa', deco: 'steps' }) },
  { key: 'mats', name: 'Lưới vật liệu', make: () => ({ kind: 'content', title: 'Vật liệu và dụng cụ', body: '🧩 Bộ lắp ghép\n✂️ Kéo\n📏 Thước kẻ\n🖍️ Bút màu\n📄 Giấy bìa\n🔩 Trục xoay', deco: 'grid' }) },
  { key: 'task', name: 'Nhiệm vụ nhóm + đồng hồ', make: () => ({ kind: 'task', title: 'Nhiệm vụ nhóm', body: 'Chia vai trong nhóm\nLắp mô hình theo hình mẫu\nThử và ghi lại kết quả', minutes: 10, theme: 'giay', deco: 'cards' }) },
  { key: 'sum', name: 'Tổng kết', make: () => ({ kind: 'content', title: '★ Tổng kết', body: 'Hôm nay em đã học được …\nĐiều em thích nhất là …', layout: 'center', theme: 'toi' }) },
]

/** Loại slide trống tự soạn (slide hoạt động thêm qua bảng chọn Kho hoạt động) */
export const BLANK_KINDS = (Object.keys(KIND) as SlideKind[]).filter(k => k !== 'activity')
/** Nút "+ Thêm slide": mở bảng mẫu (xem trước thu nhỏ) và slide trống theo loại */
export function SlideAdd({ onAdd, onAct }: { onAdd: (s: Omit<Slide, 'id'>) => void; onAct?: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc) }
  }, [open])
  const pick = (s: Omit<Slide, 'id'>) => { onAdd(s); setOpen(false) }
  return <div className="sladd" ref={ref}>
    <button type="button" className="sladdbtn" aria-expanded={open} onClick={() => setOpen(!open)}>+ Thêm slide {open ? '▴' : '▾'}</button>
    {open && <div className="slgal" role="dialog" aria-label="Chọn mẫu slide" ref={el => el?.scrollIntoView({ block: 'nearest' })}>
      <h5>Mẫu slide theo tiến trình bài STEM</h5>
      <div className="slgalg">{TEMPLATES.map(t => <button key={t.key} type="button" onClick={() => pick(t.make())}>
        <div className="slmini" aria-hidden><SlideView slide={{ id: t.key, ...t.make() }} /></div><small>{t.name}</small></button>)}</div>
      <h5>Slide trống</h5>
      <div className="slgalk">{BLANK_KINDS.map(k => <button key={k} type="button" onClick={() => { const { id: _, ...s } = newSlide(k); pick(s) }}>+ {KIND[k]}</button>)}</div>
      {onAct && <><h5>Hoạt động</h5>
        <div className="slgalk"><button type="button" className="slgalact" onClick={() => { setOpen(false); onAct() }}>🧪 Hoạt động từ Kho…</button></div></>}
    </div>}
  </div>
}

/** Bộ nhận diện cho cả bài: logo, thanh tiêu đề bài, số trang, màu thanh. Lưu vào mọi slide. */
export function BrandPanel({ slides, deckTitle, onChange, upload, busy }: { slides: Slide[]; deckTitle?: string; onChange: (s: Slide[]) => void
  upload?: (f: File) => Promise<string | null>; busy?: boolean }) {
  const b: Brand | undefined = slides.find(s => s.brand)?.brand
  const apply = (nb: Brand | undefined) => onChange(slides.map(({ brand: _, ...s }) => nb ? { ...s, brand: nb } : s))
  const set = (p: Partial<Brand>) => apply({ ...(b ?? {}), ...p })
  if (!b) return <div className="slformat slbrandp"><div className="slfrow"><small>Nhận diện</small>
    <span className="sub">Chưa bật. Thêm logo, thanh tên bài ở đầu mỗi slide và số trang ở chân.</span>
    <button type="button" className="primary" onClick={() => apply({ bar: true, num: true, mark: 'KDI', title: deckTitle || undefined, color: BRAND_COLORS[0] })}>Bật bộ nhận diện</button></div></div>
  return <div className="slformat slbrandp">
    <div className="slfrow"><small>Thanh</small>
      <label className="inl"><input type="checkbox" checked={!!b.bar} onChange={e => set({ bar: e.target.checked })} /> Thanh tiêu đề bài</label>
      <input value={b.label ?? ''} placeholder="Nhãn, VD: Tink · Khối 1" aria-label="Nhãn trên thanh" onChange={e => set({ label: e.target.value || undefined })} style={{ width: 170 }} />
      <input value={b.title ?? ''} placeholder="Tên bài trên thanh" aria-label="Tên bài trên thanh" onChange={e => set({ title: e.target.value || undefined })} style={{ flex: 1, minWidth: 160 }} />
      {deckTitle && b.title !== deckTitle && <button type="button" className="linkbtn" onClick={() => set({ title: deckTitle })}>Lấy tên bài giảng</button>}
    </div>
    <div className="slfrow"><small>Logo</small>
      <input value={b.mark ?? ''} placeholder="Chữ logo, VD: KDI" aria-label="Chữ logo" onChange={e => set({ mark: e.target.value || undefined })} style={{ width: 120 }} />
      {b.logo ? <><img className="slbrandlogo" src={b.logo} alt="Logo" /><button type="button" className="linkbtn" onClick={() => set({ logo: undefined })}>Bỏ ảnh logo</button></>
        : upload && <label className={'filebtn' + (busy ? ' busy' : '')}>{busy ? 'Đang tải…' : 'Tải ảnh logo trường (thay chữ logo)'}
          <input type="file" accept="image/*" hidden disabled={busy} onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { const u = await upload(f); if (u) set({ logo: u }) } }} /></label>}
    </div>
    <div className="slfrow"><small>Màu</small>
      {BRAND_COLORS.map(c => <button key={c} type="button" className={'slsw' + ((b.color ?? BRAND_COLORS[0]) === c ? ' on' : '')} style={{ background: c }} aria-label={'Màu thanh ' + c} onClick={() => set({ color: c })} />)}
      <label className="slcolor">Khác <input type="color" value={b.color ?? BRAND_COLORS[0]} onChange={e => set({ color: e.target.value })} aria-label="Màu thanh tự chọn" /></label>
      <label className="inl"><input type="checkbox" checked={!!b.num} onChange={e => set({ num: e.target.checked })} /> Số trang ở chân</label>
      <button type="button" className="linkbtn" style={{ marginLeft: 'auto' }} onClick={() => apply(undefined)}>Tắt bộ nhận diện</button>
    </div>
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
  // Đồng hồ đếm ngược cho slide nhiệm vụ (bấm "Bắt đầu"); đổi slide thì dừng
  const [end, setEnd] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { setEnd(null) }, [i])
  useEffect(() => { if (!end) return; const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t) }, [end])
  const left = end ? Math.max(0, Math.round((end - now) / 1000)) : 0
  return (
    <div className="overlay show" role="dialog" aria-modal="true" aria-label={'Trình chiếu' + (title ? ': ' + title : '')}>
      <div className="showtop">{title && <b>{title}</b>}<span style={{ marginLeft: 'auto' }}>Slide {i + 1}/{slides.length || 1}</span>
        {cur?.kind === 'task' && !!cur.minutes && (end
          ? <button type="button" className={'showtimer' + (left === 0 ? ' done' : '')} onClick={() => setEnd(null)} title="Bấm để dừng">⏱ {left === 0 ? 'Hết giờ' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</button>
          : <button type="button" onClick={() => { setNow(Date.now()); setEnd(Date.now() + cur.minutes! * 60000) }}>⏱ Bắt đầu {cur.minutes} phút</button>)}
        {cur?.kind === 'question' && <button type="button" onClick={() => setReveal(r => !r)}>{reveal ? 'Ẩn đáp án' : 'Hiện đáp án'}</button>}
        <button type="button" onClick={() => document.querySelector('.overlay.show')?.requestFullscreen?.()}>Toàn màn hình</button>
        <button type="button" className="x" onClick={onClose} aria-label="Thoát trình chiếu">×</button></div>
      <div className="showstage"><div className="showslide"><SlideView slide={cur} reveal={reveal} n={i + 1} total={slides.length} /></div></div>
      <div className="showbot">
        <button type="button" onClick={() => go(-1)} disabled={i === 0}>‹ Trước</button>
        <span className="dots">{slides.map((_, k) => <i key={k} className={k === i ? 'on' : ''} onClick={() => { setI(k); setReveal(false) }} />)}</span>
        <button type="button" onClick={() => go(1)} disabled={i >= slides.length - 1}>Sau ›</button>
      </div>
    </div>
  )
}

// Soạn slide trình chiếu (dùng trong trình soạn giáo án): sửa trực tiếp trên slide, có nút Trình chiếu
export function SlideStudio({ slides, onChange, readOnly, orgId, title }: { slides: Slide[]; onChange: (s: Slide[]) => void; readOnly?: boolean; orgId?: string | null; title?: string }) {
  const [sel, setSel] = useState(0)
  const [show, setShow] = useState(false)
  const [brandOpen, setBrandOpen] = useState(false)
  const [picker, setPicker] = useState<'add' | 'swap' | null>(null)
  const img = useSlideImage(orgId)
  const cur = slides[sel]
  const setSlide = (patch: Partial<Slide>) => onChange(slides.map((s, i) => i === sel ? { ...s, ...patch } : s))
  const add = (s: Omit<Slide, 'id'>) => { onChange([...slides.slice(0, sel + 1), { ...s, id: uid(), ...(cur?.brand ? { brand: cur.brand } : {}) }, ...slides.slice(sel + 1)]); setSel(slides.length ? sel + 1 : 0) }
  const move = (d: -1 | 1) => {
    const j = sel + d; if (j < 0 || j >= slides.length) return
    const next = [...slides]; [next[sel], next[j]] = [next[j], next[sel]]; onChange(next); setSel(j)
  }
  const del = () => { if (slides.length <= 1) return; onChange(slides.filter((_, i) => i !== sel)); setSel(Math.max(0, sel - 1)) }
  const dup = () => { if (!cur) return; onChange([...slides.slice(0, sel + 1), { ...JSON.parse(JSON.stringify(cur)), id: uid() }, ...slides.slice(sel + 1)]); setSel(sel + 1) }
  // Ảnh tải lên gắn vào slide đang chọn (lấy lại slide theo id vì danh sách có thể đổi trong lúc tải)
  const putImage = async (f: File) => { const id = cur?.id; const url = await img.upload(f); if (!url || !id) return
    onChange(slides.map(s => s.id === id ? { ...s, ...withImage(s, url) } : s)) }
  const canImg = !readOnly && !!orgId
  return (
    <div className="studio" onPaste={canImg ? e => { const f = clipImage(e); if (f) { e.preventDefault(); putImage(f) } } : undefined}>
      <div className="panel slidelist">
        {slides.map((s, i) => (
          <button key={s.id} className={i === sel ? 'on' : ''} onClick={() => setSel(i)}>
            <small>{i + 1} · {KIND[s.kind]}</small><span>{s.title || <i>Chưa có tiêu đề</i>}</span>
          </button>
        ))}
        {!readOnly && <div className="addslide"><SlideAdd onAdd={add} onAct={() => setPicker('add')} /></div>}
      </div>
      <div>
        <div className="sltools">
          {!readOnly && cur && <>
            {cur.kind === 'activity' ? <button type="button" onClick={() => setPicker('swap')}>🔁 Đổi hoạt động</button>
              : <select value={cur.kind} aria-label="Loại slide" onChange={e => { const { id, kind: _k, title, body, options: _o, answer: _a, url: _u, minutes: _m, ...style } = cur; setSlide({ ...newSlide(e.target.value as SlideKind), ...style, id, title, body }) }}>
              {BLANK_KINDS.map(k => <option key={k} value={k}>{KIND[k]}</option>)}</select>}
            {cur.kind === 'task' && <label className="inl">Thời gian <input type="number" min={1} max={90} value={cur.minutes ?? 10} onChange={e => setSlide({ minutes: Number(e.target.value) || 1 })} style={{ width: 64 }} /> phút</label>}
            <button onClick={() => move(-1)} disabled={sel === 0} aria-label="Đưa lên">↑</button>
            <button onClick={() => move(1)} disabled={sel === slides.length - 1} aria-label="Đưa xuống">↓</button>
            <button onClick={del} disabled={slides.length <= 1}>Xoá slide</button>
            <button type="button" className={brandOpen ? 'on' : ''} aria-pressed={brandOpen} onClick={() => setBrandOpen(!brandOpen)}>🎨 Nhận diện</button>
          </>}
          <button className="primary" style={{ marginLeft: 'auto' }} disabled={!slides.length} onClick={() => setShow(true)}>▶ Trình chiếu</button>
        </div>
        {img.err && <p className="err" role="alert">{img.err} <button type="button" className="linkbtn" onClick={img.clear}>Đóng</button></p>}
        {!readOnly && brandOpen && <BrandPanel slides={slides} deckTitle={title} onChange={onChange} upload={orgId ? img.upload : undefined} busy={img.busy} />}
        {!readOnly && cur && cur.kind !== 'activity' && <SlideFormat slide={cur} onEdit={setSlide} onDup={dup} onImage={canImg ? putImage : undefined} imgBusy={img.busy}
          onAll={p => onChange(slides.map(x => ({ ...x, ...p })))} />}
        <SlideView slide={cur} reveal onEdit={readOnly ? undefined : setSlide} onImage={canImg ? putImage : undefined} imgBusy={img.busy} n={sel + 1} total={slides.length} />
        {!readOnly && cur && <small className="sub">Bấm vào tiêu đề, nội dung hoặc phương án trên slide để sửa trực tiếp. Kéo thả hoặc dán (Ctrl+V) ảnh vào slide để chèn ảnh.</small>}
      </div>
      {show && <SlideShow slides={slides} start={sel} title={title} onClose={() => setShow(false)} />}
      {picker && <Suspense fallback={null}><ActivityPicker lesson={[title]} current={picker === 'swap' ? cur?.act?.id : undefined}
        action={picker === 'swap' ? `Đổi hoạt động slide ${sel + 1}` : slides.length ? `Chèn vào sau slide ${sel + 1}` : 'Chèn slide hoạt động'}
        onPick={a => { if (picker === 'swap') setSlide({ act: a, title: a.title }); else add({ kind: 'activity', title: a.title, act: a }); setPicker(null) }} onClose={() => setPicker(null)} /></Suspense>}
    </div>
  )
}
