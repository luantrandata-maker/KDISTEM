// Hoạt động tương tác (migration 030): kiểu dữ liệu, 8 mẫu, trình soạn, trình chơi.
// Trình chơi (ActivityPlayer) dùng chung cho giáo viên (chơi thử / trình chiếu) và học sinh (Học trước & tự học).
// Học sinh nhận đề đã bỏ đáp án từ self_study_open(); chấm luôn nằm ở CSDL (activity_grade).
import { useState } from 'react'
import { SlideView, type Slide } from './Lessons'

export type ActKind = 'quiz' | 'truefalse' | 'match' | 'order' | 'fill' | 'group' | 'flashcard' | 'worksheet'
export type Activity = {
  id: string; org_id: string; teacher_id: string | null; kind: ActKind; title: string; instructions: string | null
  subject: string | null; grades: string | null; program: string | null; content: any; is_template: boolean
  status: 'draft' | 'published'; source_id: string | null; updated_at: string; teachers?: { full_name: string } | null
}
export type Grade = { correct: number; total: number; results: boolean[]; by_item?: Record<string, boolean> }

export const ACT: Record<ActKind, { label: string; icon: string; desc: string; graded: boolean }> = {
  quiz: { label: 'Trắc nghiệm', icon: '◉', desc: 'Câu hỏi nhiều lựa chọn, một đáp án đúng', graded: true },
  truefalse: { label: 'Đúng / Sai', icon: '⇄', desc: 'Nhận định để học sinh chọn Đúng hoặc Sai', graded: true },
  match: { label: 'Ghép đôi', icon: '⟷', desc: 'Nối khái niệm với định nghĩa, linh kiện với chức năng', graded: true },
  order: { label: 'Sắp xếp thứ tự', icon: '↕', desc: 'Xếp các bước của quy trình về đúng thứ tự', graded: true },
  fill: { label: 'Điền khuyết', icon: '▢', desc: 'Đoạn văn có chỗ trống, chấp nhận nhiều cách viết', graded: true },
  group: { label: 'Phân loại', icon: '▦', desc: 'Xếp thẻ vào đúng nhóm', graded: true },
  flashcard: { label: 'Thẻ ghi nhớ', icon: '◧', desc: 'Lật thẻ để ôn thuật ngữ, công thức (không chấm)', graded: false },
  worksheet: { label: 'Phiếu học tập', icon: '☰', desc: 'Phiếu ghi kết quả thí nghiệm, câu trả lời mở — thầy cô nhận xét', graded: false },
}
export const ACT_KINDS = Object.keys(ACT) as ActKind[]

// Nội dung mở đầu cho từng mẫu — có sẵn ví dụ để giáo viên sửa
export const STARTER: Record<ActKind, any> = {
  quiz: { items: [{ q: 'Dụng cụ nào dùng để đo cường độ dòng điện?', options: ['Vôn kế', 'Ampe kế', 'Nhiệt kế', 'Lực kế'], answer: 1 }] },
  truefalse: { items: [{ q: 'Nước sôi ở 100 °C ở áp suất thường.', answer: true }, { q: 'Nhựa là vật dẫn điện tốt.', answer: false }] },
  match: { pairs: [{ left: 'Điện trở', right: 'Hạn chế dòng điện' }, { left: 'Tụ điện', right: 'Tích và phóng điện' }, { left: 'Công tắc', right: 'Đóng ngắt mạch' }] },
  order: { steps: ['Xác định vấn đề', 'Đề xuất giải pháp', 'Chế tạo mẫu thử', 'Thử nghiệm và cải tiến'] },
  fill: { text: 'Nước sôi ở [100|một trăm] °C và đóng băng ở [0|không] °C.' },
  group: { groups: [{ name: 'Dẫn điện', items: ['Đồng', 'Nhôm'] }, { name: 'Cách điện', items: ['Nhựa', 'Gỗ khô'] }] },
  flashcard: { cards: [{ front: 'Định luật Ôm', back: 'I = U / R' }, { front: 'Công suất điện', back: 'P = U × I' }] },
  worksheet: { intro: 'Ghi lại kết quả thí nghiệm của nhóm.', fields: [{ label: 'Kết quả đo lần 1', type: 'text' }, { label: 'Em rút ra kết luận gì?', type: 'long' }] },
}

export function countItems(kind: ActKind, c: any): number {
  if (!c) return 0
  switch (kind) {
    case 'quiz': case 'truefalse': return c.items?.length ?? 0
    case 'match': return c.pairs?.length ?? 0
    case 'order': return c.steps?.length ?? 0
    case 'fill': return (String(c.text ?? '').match(/\[[^\]]*\]/g) ?? []).length
    case 'group': return (c.groups ?? []).reduce((n: number, g: any) => n + (g.items?.length ?? 0), 0)
    case 'flashcard': return c.cards?.length ?? 0
    case 'worksheet': return c.fields?.length ?? 0
  }
}
export const unitOf = (k: ActKind) => ({ quiz: 'câu', truefalse: 'nhận định', match: 'cặp', order: 'bước', fill: 'chỗ trống', group: 'thẻ', flashcard: 'thẻ', worksheet: 'mục' }[k])

// ---- Đề chơi thử cho giáo viên (học sinh nhận đề từ CSDL) ----
const shuffle = <T,>(arr: T[]): T[] => {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  if (a.length > 1 && a.every((x, i) => x === arr[i])) a.reverse()
  return a
}
export function toPlayable(kind: ActKind | 'lesson', c: any): any {
  switch (kind) {
    case 'quiz': return { items: (c.items ?? []).map((x: any) => ({ q: x.q, options: x.options })) }
    case 'truefalse': return { items: (c.items ?? []).map((x: any) => ({ q: x.q })) }
    case 'match': return { left: (c.pairs ?? []).map((p: any) => p.left), right: shuffle((c.pairs ?? []).map((p: any) => p.right)) }
    case 'order': return { steps: shuffle(c.steps ?? []) }
    case 'fill': return { pieces: String(c.text ?? '').split(/\[[^\]]*\]/) }
    case 'group': return { groups: (c.groups ?? []).map((g: any) => g.name), items: shuffle((c.groups ?? []).flatMap((g: any) => g.items ?? [])) }
    case 'lesson': return { slides: (c.slides ?? []).map((s: any) => { const { answer: _a, ...rest } = s; return rest }) }
    default: return c
  }
}
export function emptyAnswers(kind: ActKind | 'lesson', p: any): any {
  switch (kind) {
    case 'quiz': case 'truefalse': return (p.items ?? []).map(() => null)
    case 'match': return (p.left ?? []).map(() => null)
    case 'order': return [...(p.steps ?? [])]
    case 'fill': return (p.pieces ?? []).slice(1).map(() => '')
    case 'group': return {}
    case 'worksheet': return (p.fields ?? []).map(() => '')
    default: return null
  }
}
export function answered(kind: ActKind | 'lesson', a: any, p: any): { done: number; total: number } {
  switch (kind) {
    case 'quiz': case 'truefalse': case 'match': return { done: (a ?? []).filter((x: any) => x !== null && x !== '').length, total: (a ?? []).length }
    case 'fill': case 'worksheet': return { done: (a ?? []).filter((x: string) => String(x ?? '').trim()).length, total: (a ?? []).length }
    case 'group': return { done: Object.keys(a ?? {}).filter(k => a[k]).length, total: (p.items ?? []).length }
    default: return { done: 1, total: 1 }
  }
}
const firstAlt = (s: string) => s.split('|')[0].trim()
const blanksOf = (text: string) => [...String(text ?? '').matchAll(/\[([^\]]*)\]/g)].map(m => m[1])

const Mark = ({ ok }: { ok: boolean | undefined }) => ok === undefined ? null
  : <span className={'actmark ' + (ok ? 'ok' : 'bad')} aria-label={ok ? 'Đúng' : 'Sai'}>{ok ? '✓' : '✗'}</span>

// ================= Trình chơi =================
export function ActivityPlayer({ kind, data, answers, onChange, grade, solution, disabled, big }: {
  kind: ActKind | 'lesson'; data: any; answers: any; onChange: (a: any) => void
  grade?: Grade | null; solution?: any | null; disabled?: boolean; big?: boolean
}) {
  const r = grade?.results
  const set = (i: number, v: any) => { const n = [...(answers ?? [])]; n[i] = v; onChange(n) }
  const cls = 'actplay' + (big ? ' big' : '')

  if (kind === 'quiz') return (
    <ol className={cls}>
      {(data.items ?? []).map((it: any, i: number) => (
        <li key={i} className="actq"><div className="actqhead"><b>{it.q}</b><Mark ok={r?.[i]} /></div>
          <div className="actopts">
            {(it.options ?? []).map((o: string, j: number) => {
              const right = solution && solution.items?.[i]?.answer === j
              return <button type="button" key={j} disabled={disabled} aria-pressed={answers?.[i] === j}
                className={'actopt' + (answers?.[i] === j ? ' on' : '') + (right ? ' right' : '')} onClick={() => set(i, j)}>
                <b>{String.fromCharCode(65 + j)}</b> {o}</button>
            })}
          </div></li>
      ))}
    </ol>
  )
  if (kind === 'truefalse') return (
    <ol className={cls}>
      {(data.items ?? []).map((it: any, i: number) => (
        <li key={i} className="actq"><div className="actqhead"><b>{it.q}</b><Mark ok={r?.[i]} /></div>
          <div className="actopts two">
            {[true, false].map(v => (
              <button type="button" key={String(v)} disabled={disabled} aria-pressed={answers?.[i] === v}
                className={'actopt' + (answers?.[i] === v ? ' on' : '') + (solution && solution.items?.[i]?.answer === v ? ' right' : '')}
                onClick={() => set(i, v)}>{v ? 'Đúng' : 'Sai'}</button>
            ))}
          </div></li>
      ))}
    </ol>
  )
  if (kind === 'match') return (
    <div className={cls}>
      {(data.left ?? []).map((l: string, i: number) => (
        <div className="actmatch" key={i}>
          <span className="actcard">{l}</span><span aria-hidden="true">⟶</span>
          <select value={answers?.[i] ?? ''} disabled={disabled} onChange={e => set(i, e.target.value || null)} aria-label={`Ghép với ${l}`}>
            <option value="">— Chọn —</option>
            {(data.right ?? []).map((x: string) => <option key={x} value={x}>{x}</option>)}
          </select>
          <Mark ok={r?.[i]} />
          {solution && <small className="actsol">Đáp án: {solution.pairs?.[i]?.right}</small>}
        </div>
      ))}
    </div>
  )
  if (kind === 'order') {
    const list: string[] = answers ?? []
    const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= list.length) return; const n = [...list]; [n[i], n[j]] = [n[j], n[i]]; onChange(n) }
    return (
      <div className={cls}>
        <ol className="actorder">
          {list.map((s, i) => (
            <li key={s}><span className="actcard">{s}</span>
              <span className="tools">
                <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={`Đưa “${s}” lên`}>↑</button>
                <button type="button" disabled={disabled || i === list.length - 1} onClick={() => move(i, 1)} aria-label={`Đưa “${s}” xuống`}>↓</button>
              </span><Mark ok={r?.[i]} /></li>
          ))}
        </ol>
        {solution && <p className="actsol">Thứ tự đúng: {(solution.steps ?? []).join(' → ')}</p>}
      </div>
    )
  }
  if (kind === 'fill') {
    const pieces: string[] = data.pieces ?? []
    const sol = solution ? blanksOf(solution.text) : null
    return (
      <div className={cls}><p className="actfill">
        {pieces.map((p, i) => (
          <span key={i}>{p}{i < pieces.length - 1 && <>
            <input value={answers?.[i] ?? ''} disabled={disabled} onChange={e => set(i, e.target.value)} aria-label={`Chỗ trống ${i + 1}`}
              className={r ? (r[i] ? 'ok' : 'bad') : ''} size={Math.max(6, (answers?.[i] ?? '').length + 2)} />
            {sol && !r?.[i] && <small className="actsol"> ({firstAlt(sol[i] ?? '')})</small>}</>}
          </span>
        ))}
      </p></div>
    )
  }
  if (kind === 'group') {
    const groups: string[] = data.groups ?? []
    const correctOf = (item: string) => solution?.groups?.find((g: any) => (g.items ?? []).includes(item))?.name
    return (
      <div className={cls}>
        <div className="actgroups">
          {(data.items ?? []).map((it: string) => (
            <div className="actgroupitem" key={it}>
              <span className="actcard">{it}</span>
              <span className="tools">{groups.map(g => (
                <button type="button" key={g} disabled={disabled} className={'chipbtn' + (answers?.[it] === g ? ' on' : '')} aria-pressed={answers?.[it] === g}
                  onClick={() => onChange({ ...(answers ?? {}), [it]: g })}>{g}</button>
              ))}</span>
              <Mark ok={grade?.by_item?.[it]} />
              {solution && grade?.by_item?.[it] === false && <small className="actsol">→ {correctOf(it)}</small>}
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (kind === 'flashcard') return <Flashcards cards={data.cards ?? []} big={big} />
  if (kind === 'worksheet') return (
    <div className={cls}>
      {data.intro && <p className="sub">{data.intro}</p>}
      <div className="formgrid">
        {(data.fields ?? []).map((f: any, i: number) => (
          <label className="field" key={i} style={{ gridColumn: '1 / -1' }}><span>{f.label}</span>
            {f.type === 'long'
              ? <textarea rows={3} value={answers?.[i] ?? ''} disabled={disabled} onChange={e => set(i, e.target.value)} />
              : <input type={f.type === 'number' ? 'number' : 'text'} value={answers?.[i] ?? ''} disabled={disabled} onChange={e => set(i, e.target.value)} />}
          </label>
        ))}
      </div>
    </div>
  )
  if (kind === 'lesson') return <SlidesPager slides={data.slides ?? []} reveal={!!solution} />
  return null
}

function Flashcards({ cards, big }: { cards: { front: string; back: string }[]; big?: boolean }) {
  const [i, setI] = useState(0)
  const [flip, setFlip] = useState(false)
  const c = cards[i]
  if (!c) return <p className="sub">Chưa có thẻ.</p>
  const go = (d: number) => { setFlip(false); setI(Math.min(cards.length - 1, Math.max(0, i + d))) }
  return (
    <div className={'actflash' + (big ? ' big' : '')}>
      <button type="button" className={'flashcard' + (flip ? ' back' : '')} onClick={() => setFlip(!flip)} aria-label="Lật thẻ">
        <small>{flip ? 'Mặt sau' : 'Mặt trước'} · bấm để lật</small><span>{flip ? c.back : c.front}</span>
      </button>
      <div className="tools"><button type="button" onClick={() => go(-1)} disabled={i === 0}>‹ Trước</button>
        <span>{i + 1}/{cards.length}</span>
        <button type="button" onClick={() => go(1)} disabled={i === cards.length - 1}>Sau ›</button></div>
    </div>
  )
}

function SlidesPager({ slides, reveal }: { slides: Slide[]; reveal: boolean }) {
  const [i, setI] = useState(0)
  return (
    <div className="presenter">
      <div className="tools"><button type="button" onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0}>‹ Trước</button>
        <span>{i + 1}/{slides.length || 1}</span>
        <button type="button" onClick={() => setI(Math.min(slides.length - 1, i + 1))} disabled={i >= slides.length - 1}>Sau ›</button></div>
      <SlideView slide={slides[i]} reveal={reveal} />
    </div>
  )
}

// ================= Trình soạn nội dung theo loại =================
export function ContentEditor({ kind, value, onChange }: { kind: ActKind; value: any; onChange: (v: any) => void }) {
  const c = value ?? {}
  const list = (key: string): any[] => c[key] ?? []
  const setList = (key: string, arr: any[]) => onChange({ ...c, [key]: arr })
  const upd = (key: string, i: number, patch: any) => setList(key, list(key).map((x, j) => j === i ? (typeof x === 'object' ? { ...x, ...patch } : patch) : x))
  const del = (key: string, i: number) => setList(key, list(key).filter((_, j) => j !== i))
  const move = (key: string, i: number, d: number) => {
    const a = [...list(key)], j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setList(key, a)
  }
  const Rm = ({ k, i, min = 1 }: { k: string; i: number; min?: number }) =>
    <button type="button" className="x" onClick={() => del(k, i)} disabled={list(k).length <= min} aria-label="Xoá dòng">×</button>

  switch (kind) {
    case 'quiz': return (
      <div className="acted">
        {list('items').map((it, i) => (
          <div className="panel" key={i}>
            <div className="bar"><b>Câu {i + 1}</b><Rm k="items" i={i} /></div>
            <label className="field"><span>Câu hỏi</span><textarea rows={2} value={it.q ?? ''} onChange={e => upd('items', i, { q: e.target.value })} /></label>
            <div className="field"><span>Phương án — chọn đáp án đúng</span>
              {(it.options ?? []).map((o: string, j: number) => (
                <div className="addrow" key={j}>
                  <input type="radio" name={'ans' + i} checked={it.answer === j} onChange={() => upd('items', i, { answer: j })} aria-label={`Đáp án ${String.fromCharCode(65 + j)} đúng`} />
                  <input value={o} placeholder={`Phương án ${String.fromCharCode(65 + j)}`}
                    onChange={e => upd('items', i, { options: it.options.map((x: string, k: number) => k === j ? e.target.value : x) })} />
                  <button type="button" className="x" disabled={(it.options ?? []).length <= 2} aria-label="Xoá phương án"
                    onClick={() => upd('items', i, { options: it.options.filter((_: string, k: number) => k !== j), answer: it.answer === j ? 0 : it.answer > j ? it.answer - 1 : it.answer })}>×</button>
                </div>
              ))}
              {(it.options ?? []).length < 6 && <button type="button" onClick={() => upd('items', i, { options: [...(it.options ?? []), ''] })}>+ Phương án</button>}
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setList('items', [...list('items'), { q: '', options: ['', ''], answer: 0 }])}>+ Thêm câu hỏi</button>
      </div>
    )
    case 'truefalse': return (
      <div className="acted">
        {list('items').map((it, i) => (
          <div className="addrow" key={i}>
            <input value={it.q ?? ''} placeholder={`Nhận định ${i + 1}`} onChange={e => upd('items', i, { q: e.target.value })} />
            <select value={it.answer === false ? 'f' : it.answer === true ? 't' : ''} onChange={e => upd('items', i, { answer: e.target.value === 't' })} aria-label="Đáp án">
              <option value="" disabled>Đáp án…</option><option value="t">Đúng</option><option value="f">Sai</option></select>
            <Rm k="items" i={i} />
          </div>
        ))}
        <button type="button" onClick={() => setList('items', [...list('items'), { q: '', answer: true }])}>+ Thêm nhận định</button>
      </div>
    )
    case 'match': return (
      <div className="acted">
        <small className="sub">Vế trái hiện theo thứ tự; vế phải được xáo trộn cho học sinh ghép.</small>
        {list('pairs').map((p, i) => (
          <div className="addrow" key={i}>
            <input value={p.left ?? ''} placeholder="Vế trái" onChange={e => upd('pairs', i, { left: e.target.value })} />
            <span aria-hidden="true">⟷</span>
            <input value={p.right ?? ''} placeholder="Vế phải" onChange={e => upd('pairs', i, { right: e.target.value })} />
            <Rm k="pairs" i={i} min={2} />
          </div>
        ))}
        {list('pairs').length < 20 && <button type="button" onClick={() => setList('pairs', [...list('pairs'), { left: '', right: '' }])}>+ Thêm cặp</button>}
      </div>
    )
    case 'order': return (
      <div className="acted">
        <small className="sub">Nhập các bước theo <b>đúng thứ tự</b>; học sinh sẽ thấy thứ tự bị xáo trộn.</small>
        {list('steps').map((s, i) => (
          <div className="addrow" key={i}>
            <b>{i + 1}.</b>
            <input value={s ?? ''} placeholder={`Bước ${i + 1}`} onChange={e => upd('steps', i, e.target.value)} />
            <button type="button" onClick={() => move('steps', i, -1)} disabled={i === 0} aria-label="Đưa lên">↑</button>
            <button type="button" onClick={() => move('steps', i, 1)} disabled={i === list('steps').length - 1} aria-label="Đưa xuống">↓</button>
            <Rm k="steps" i={i} min={2} />
          </div>
        ))}
        {list('steps').length < 20 && <button type="button" onClick={() => setList('steps', [...list('steps'), ''])}>+ Thêm bước</button>}
      </div>
    )
    case 'fill': {
      const blanks = blanksOf(c.text)
      return (
        <div className="acted">
          <label className="field"><span>Đoạn văn — đặt đáp án trong ngoặc vuông, nhiều cách viết cách nhau bằng dấu |</span>
            <textarea rows={5} value={c.text ?? ''} onChange={e => onChange({ ...c, text: e.target.value })} placeholder="Nước sôi ở [100|một trăm] °C" /></label>
          <small>{blanks.length ? `${blanks.length} chỗ trống: ${blanks.map(firstAlt).join(' · ')}` : 'Chưa có chỗ trống nào.'}</small>
        </div>
      )
    }
    case 'group': return (
      <div className="acted twocol">
        {list('groups').map((g, i) => (
          <div className="panel" key={i}>
            <div className="addrow"><input value={g.name ?? ''} placeholder={`Tên nhóm ${i + 1}`} onChange={e => upd('groups', i, { name: e.target.value })} /><Rm k="groups" i={i} min={2} /></div>
            <label className="field"><span>Các thẻ thuộc nhóm (mỗi dòng một thẻ)</span>
              <textarea rows={4} value={(g.items ?? []).join('\n')} onChange={e => upd('groups', i, { items: e.target.value.split('\n') })}
                onBlur={e => upd('groups', i, { items: e.target.value.split('\n').map(x => x.trim()).filter(Boolean) })} /></label>
          </div>
        ))}
        {list('groups').length < 6 && <button type="button" onClick={() => setList('groups', [...list('groups'), { name: '', items: [] }])}>+ Thêm nhóm</button>}
      </div>
    )
    case 'flashcard': return (
      <div className="acted">
        {list('cards').map((x, i) => (
          <div className="addrow" key={i}>
            <input value={x.front ?? ''} placeholder="Mặt trước" onChange={e => upd('cards', i, { front: e.target.value })} />
            <input value={x.back ?? ''} placeholder="Mặt sau" onChange={e => upd('cards', i, { back: e.target.value })} />
            <Rm k="cards" i={i} />
          </div>
        ))}
        <button type="button" onClick={() => setList('cards', [...list('cards'), { front: '', back: '' }])}>+ Thêm thẻ</button>
      </div>
    )
    case 'worksheet': return (
      <div className="acted">
        <label className="field"><span>Hướng dẫn / bối cảnh</span><textarea rows={2} value={c.intro ?? ''} onChange={e => onChange({ ...c, intro: e.target.value })} /></label>
        {list('fields').map((f, i) => (
          <div className="addrow" key={i}>
            <input value={f.label ?? ''} placeholder={`Mục ${i + 1}`} onChange={e => upd('fields', i, { label: e.target.value })} />
            <select value={f.type ?? 'text'} onChange={e => upd('fields', i, { type: e.target.value })} aria-label="Kiểu trả lời">
              <option value="text">Một dòng</option><option value="long">Đoạn văn</option><option value="number">Số</option></select>
            <Rm k="fields" i={i} />
          </div>
        ))}
        <button type="button" onClick={() => setList('fields', [...list('fields'), { label: '', type: 'text' }])}>+ Thêm mục</button>
      </div>
    )
  }
}

// Câu trả lời của học sinh dạng đọc được (giáo viên xem trong Học trước & tự học)
export function AnswerText({ kind, content, answers }: { kind: string; content: any; answers: any }) {
  if (answers == null) return <small>—</small>
  if (kind === 'worksheet') return (
    <div className="answer">{(content?.fields ?? []).map((f: any, i: number) => <p key={i}><b>{f.label}:</b> {answers?.[i] || <i>(bỏ trống)</i>}</p>)}</div>
  )
  if (kind === 'quiz') return <small>{(answers as any[]).map((a, i) => `${i + 1}${a == null ? '—' : String.fromCharCode(65 + a)}`).join(' · ')}</small>
  if (kind === 'truefalse') return <small>{(answers as any[]).map((a, i) => `${i + 1}${a == null ? '—' : a ? 'Đ' : 'S'}`).join(' · ')}</small>
  if (kind === 'group') return <small>{Object.entries(answers).map(([k, v]) => `${k} → ${v}`).join(' · ')}</small>
  if (Array.isArray(answers)) return <small>{answers.map(a => a ?? '—').join(' · ')}</small>
  return <small>{JSON.stringify(answers)}</small>
}
