import { useState } from 'react'
import { SlideView, KIND as SLIDE_KIND, type Slide, type SlideKind } from '../teacher/Lessons'
import { PROGRAM_COLOR } from '../teacher/common'

export type Unit = { title: string; periods?: number; objectives?: string; lesson_ids?: string[] }
export type Item = {
  id: string; owner_org_id: string; kind: 'program' | 'lesson' | 'material'; title: string; summary: string | null
  subject: string | null; grades: string | null; program: string | null; tags: string[]
  content: { slides?: Slide[]; type?: string; url?: string; units?: Unit[] }
  scope: 'children' | 'selected' | 'public'; status: 'draft' | 'published' | 'archived'; version: number
  published_at: string | null; change_note: string | null; updated_at: string
  owner_name?: string | null; owner_type?: string | null
}
export type Copy = { item_id: string; adopted_version: number; lesson_plan_id: string | null; created_at: string; adopted_by: string | null }

export const KIND: Record<Item['kind'], [string, string]> = {
  program: ['Chương trình', '▤'], lesson: ['Bài giảng', '▶'], material: ['Học liệu', '◆'],
}
export const MAT_TYPE: Record<string, string> = { video: 'Video', document: 'Tài liệu', link: 'Đường dẫn', image: 'Hình ảnh' }
export const SCOPE: Record<Item['scope'], string> = {
  children: 'Mọi đơn vị trực thuộc', selected: 'Đơn vị được chọn', public: 'Công khai toàn hệ thống',
}
export const STATUS: Record<Item['status'], [string, string, string]> = {
  draft: ['✎', 'Nháp', ''], published: ['✓', 'Đã phát hành', 'good'], archived: ['−', 'Đã thu hồi', 'warn'],
}
export const PROGRAMS = ['CT1', 'CT2', 'CT3', 'CT4', 'CT5']
export const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : '—'
export const uid = () => Math.random().toString(36).slice(2, 9)

export function KindChip({ kind }: { kind: Item['kind'] }) {
  const [label, icon] = KIND[kind]
  return <span className={'libkind k-' + kind}><i aria-hidden="true">{icon}</i>{label}</span>
}
export function ProgChip({ p }: { p: string | null }) {
  return p ? <span className="progchip" style={{ background: PROGRAM_COLOR[p] }}>{p}</span> : null
}
export function StatusChip({ s }: { s: Item['status'] }) {
  const [icon, label, tone] = STATUS[s]
  return <span className={'gpill ' + tone}><i aria-hidden="true">{icon}</i>{label}</span>
}

// Xem trước nội dung một mục kho
export function ItemPreview({ item, all }: { item: Item; all: Item[] }) {
  const [i, setI] = useState(0)
  if (item.kind === 'lesson') {
    const slides = item.content.slides ?? []
    return (
      <div className="libpreview">
        <SlideView slide={slides[i]} reveal />
        {slides.length > 1 && (
          <div className="bar small">
            <button type="button" disabled={i === 0} onClick={() => setI(i - 1)}>← Trước</button>
            <small>Slide {i + 1}/{slides.length}</small>
            <button type="button" disabled={i >= slides.length - 1} onClick={() => setI(i + 1)}>Sau →</button>
          </div>
        )}
      </div>
    )
  }
  if (item.kind === 'material') {
    return (
      <div className="libpreview">
        <p><b>{MAT_TYPE[item.content.type ?? 'link'] ?? 'Đường dẫn'}:</b> {item.content.url
          ? <a href={item.content.url} target="_blank" rel="noreferrer">{item.content.url}</a> : <i>chưa có đường dẫn</i>}</p>
      </div>
    )
  }
  const units = item.content.units ?? []
  return (
    <ol className="libunits">
      {units.map((u, k) => (
        <li key={k}>
          <b>{u.title}</b>{u.periods ? <small> · {u.periods} tiết</small> : null}
          {u.objectives && <p className="sub">{u.objectives}</p>}
          {(u.lesson_ids ?? []).length > 0 && <p className="sub">Bài giảng: {(u.lesson_ids ?? []).map(id => all.find(x => x.id === id)?.title ?? 'bài giảng không còn trong kho').join(' · ')}</p>}
        </li>
      ))}
      {units.length === 0 && <li className="sub">Chưa có chủ đề nào.</li>}
    </ol>
  )
}

// Soạn slide gọn cho bài giảng trong kho (cùng định dạng với trình soạn bài giảng của giáo viên)
export function SlidesEditor({ slides, onChange }: { slides: Slide[]; onChange: (s: Slide[]) => void }) {
  const [sel, setSel] = useState(0)
  const cur = slides[sel]
  const set = (p: Partial<Slide>) => onChange(slides.map((s, k) => k === sel ? { ...s, ...p } : s))
  const add = (kind: SlideKind) => {
    const s: Slide = { id: uid(), kind, title: '', body: '', ...(kind === 'question' ? { options: ['', ''], answer: 0 } : {}), ...(kind === 'task' ? { minutes: 10 } : {}), ...(kind === 'media' ? { url: '' } : {}) }
    onChange([...slides, s]); setSel(slides.length)
  }
  return (
    <div className="sleditor">
      <ol className="slthumbs">
        {slides.map((s, k) => (
          <li key={s.id}><button type="button" className={k === sel ? 'on' : ''} onClick={() => setSel(k)}>
            <small>{k + 1} · {SLIDE_KIND[s.kind]}</small><span>{s.title || 'Chưa có tiêu đề'}</span></button></li>
        ))}
        <li className="sladd">{(Object.keys(SLIDE_KIND) as SlideKind[]).map(k => <button type="button" key={k} onClick={() => add(k)}>+ {SLIDE_KIND[k]}</button>)}</li>
      </ol>
      {cur ? (
        <div className="slform">
          <label className="field"><span>Tiêu đề</span><input value={cur.title} onChange={e => set({ title: e.target.value })} /></label>
          {cur.kind !== 'media' && <label className="field"><span>Nội dung</span><textarea rows={4} value={cur.body ?? ''} onChange={e => set({ body: e.target.value })} /></label>}
          {cur.kind === 'media' && <label className="field"><span>Đường dẫn video / hình</span><input value={cur.url ?? ''} onChange={e => set({ url: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" /></label>}
          {cur.kind === 'task' && <label className="field"><span>Thời gian (phút)</span><input type="number" min={1} value={cur.minutes ?? 10} onChange={e => set({ minutes: Number(e.target.value) })} /></label>}
          {cur.kind === 'question' && (
            <div className="field"><span>Phương án (chọn đáp án đúng)</span>
              {(cur.options ?? []).map((o, k) => (
                <div className="optrow" key={k}>
                  <input type="radio" name={'ans' + cur.id} checked={cur.answer === k} onChange={() => set({ answer: k })} aria-label={`Đáp án ${String.fromCharCode(65 + k)} đúng`} />
                  <input value={o} onChange={e => set({ options: (cur.options ?? []).map((x, j) => j === k ? e.target.value : x) })} placeholder={`Phương án ${String.fromCharCode(65 + k)}`} />
                </div>
              ))}
              {(cur.options ?? []).length < 6 && <button type="button" className="linkbtn" onClick={() => set({ options: [...(cur.options ?? []), ''] })}>+ Thêm phương án</button>}
            </div>
          )}
          <div className="actions">
            <button type="button" disabled={sel === 0} onClick={() => { const s = [...slides]; [s[sel - 1], s[sel]] = [s[sel], s[sel - 1]]; onChange(s); setSel(sel - 1) }}>↑ Lên</button>
            <button type="button" disabled={sel >= slides.length - 1} onClick={() => { const s = [...slides]; [s[sel + 1], s[sel]] = [s[sel], s[sel + 1]]; onChange(s); setSel(sel + 1) }}>↓ Xuống</button>
            <button type="button" className="danger" onClick={() => { onChange(slides.filter((_, k) => k !== sel)); setSel(Math.max(0, sel - 1)) }}>Xoá slide</button>
          </div>
          <SlideView slide={cur} reveal />
        </div>
      ) : <p className="sub">Thêm slide đầu tiên ở cột bên trái.</p>}
    </div>
  )
}
