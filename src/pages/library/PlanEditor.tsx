import { useState } from 'react'
import { useTemplates, phasesOf, totalMinutes, uid, type Step, type Template } from '../lessons/common'

// Giáo án soạn trong kho học liệu (066): như giáo án ở "Soạn bài giảng" — chọn mẫu giáo án, soạn các mục (mục tiêu,
// chuẩn bị…) và tiến trình dạy học theo bước. Lưu trong library_items.content của học liệu loại 'lesson_plan'.
export type PlanContent = { template_id: string | null; doc: Record<string, string>; steps: Step[]; periods: number | null }
export const EMPTY_PLAN: PlanContent = { template_id: null, doc: {}, steps: [], periods: null }
// Khi chưa chọn mẫu: các mục thường có của giáo án
const DEFAULT_SECTIONS = ['Mục tiêu', 'Thiết bị dạy học và học liệu', 'Tiến trình dạy học (ghi chú)', 'Đánh giá']

export const planOf = (c: { template_id?: string | null; doc?: Record<string, string>; steps?: Step[]; periods?: number | null }): PlanContent => ({
  template_id: c.template_id ?? null, doc: c.doc ?? {}, steps: c.steps ?? [], periods: c.periods ?? null,
})
export const planFilled = (p: PlanContent) => p.steps.some(s => s.title.trim()) || Object.values(p.doc).some(v => v.trim())

function sectionsOf(tpl: Template | undefined, doc: Record<string, string>) {
  const base = tpl?.sections ?? DEFAULT_SECTIONS.map(t => ({ key: t, title: t, hint: '', required: false }))
  return [...base, ...Object.keys(doc).filter(k => !base.some(s => s.key === k)).map(k => ({ key: k, title: k, hint: '', required: false }))]
}

export function PlanEditor({ value, onChange }: { value: PlanContent; onChange: (v: PlanContent) => void }) {
  const templates = useTemplates()
  const tpl = templates.find(t => t.id === value.template_id)
  const [extra, setExtra] = useState('')
  const set = (p: Partial<PlanContent>) => onChange({ ...value, ...p })
  const phases = phasesOf(tpl, value.steps)
  const total = totalMinutes(value.steps), budget = (value.periods ?? 0) * 45
  const setStep = (sid: string, patch: Partial<Step>) => set({ steps: value.steps.map(s => (s.id === sid ? { ...s, ...patch } : s)) })
  const addStep = (phase: string) => {
    const idx = value.steps.map(s => s.phase ?? '').lastIndexOf(phase)
    const s: Step = { id: uid(), phase: phase || undefined, title: '', minutes: 10 }
    set({ steps: idx < 0 ? [...value.steps, s] : [...value.steps.slice(0, idx + 1), s, ...value.steps.slice(idx + 1)] })
  }
  const move = (sid: string, d: -1 | 1) => {
    const i = value.steps.findIndex(s => s.id === sid), ph = value.steps[i].phase ?? ''
    let j = i + d; while (j >= 0 && j < value.steps.length && (value.steps[j].phase ?? '') !== ph) j += d
    if (j < 0 || j >= value.steps.length) return
    const n = [...value.steps];[n[i], n[j]] = [n[j], n[i]]; set({ steps: n })
  }
  return (
    <div className="libplan">
      <div className="formgrid">
        <label className="field" style={{ gridColumn: 'span 2' }}><span>Mẫu giáo án</span>
          <select value={value.template_id ?? ''} onChange={e => set({ template_id: e.target.value || null })} aria-label="Mẫu giáo án">
            <option value="">— Không theo mẫu —</option>{templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.owner_name ? ` · ${t.owner_name}` : ''}</option>)}</select></label>
        <label className="field"><span>Số tiết</span><input type="number" min={1} max={20} value={value.periods ?? ''} onChange={e => set({ periods: e.target.value ? Math.min(20, Math.max(1, Number(e.target.value))) : null })} /></label>
      </div>

      <h4 style={{ margin: '12px 0 4px' }}>Nội dung giáo án</h4>
      <div className="formgrid">
        {sectionsOf(tpl, value.doc).map(s => (
          <label className="field" key={s.key} style={{ gridColumn: '1 / -1' }}>
            <span>{s.title}{s.required && ' *'}{!tpl?.sections.some(x => x.key === s.key) && !DEFAULT_SECTIONS.includes(s.key) &&
              <button type="button" className="linkbtn" onClick={() => { const d = { ...value.doc }; delete d[s.key]; set({ doc: d }) }}> · bỏ mục</button>}</span>
            <textarea rows={3} value={value.doc[s.key] ?? ''} placeholder={s.hint || ''} onChange={e => set({ doc: { ...value.doc, [s.key]: e.target.value } })} />
          </label>
        ))}
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6 }}>
          <input value={extra} onChange={e => setExtra(e.target.value)} placeholder="Tên mục thêm (VD: Dặn dò, Rút kinh nghiệm)" aria-label="Tên mục thêm" />
          <button type="button" onClick={() => { const k = extra.trim(); if (k && !(k in value.doc)) set({ doc: { ...value.doc, [k]: '' } }); setExtra('') }}>+ Thêm mục</button>
        </div>
      </div>

      <div className="bar" style={{ marginTop: 12 }}><h4 style={{ margin: 0 }}>Tiến trình dạy học</h4>
        <span>Tổng: <b>{total} phút</b>{budget > 0 && <> / {value.periods} tiết × 45 = {budget} phút <span className={'gpill ' + (total > budget ? 'bad' : total < budget * 0.8 ? 'warn' : 'good')}>
          {total > budget ? `vượt ${total - budget} phút` : total < budget * 0.8 ? `còn ${budget - total} phút` : 'vừa đủ'}</span></>}</span></div>
      {phases.map(ph => {
        const st = value.steps.filter(s => (s.phase ?? '') === ph.key)
        if (!st.length && ph.key === '' && tpl?.phases.length) return <p key="_" className="sub"><button type="button" className="linkbtn" onClick={() => addStep('')}>+ Thêm bước ngoài các pha của mẫu</button></p>
        return (
          <section key={ph.key || '_'} style={{ marginBottom: 12 }}>
            <b>{ph.title}</b> <small className="sub">· {totalMinutes(st)} phút</small>
            {ph.hint && <p className="sub" style={{ margin: '2px 0' }}>{ph.hint}</p>}
            {st.map(s => { const k = value.steps.indexOf(s); return (
              <fieldset key={s.id} className="panel formgrid stepcard" style={{ marginTop: 6 }}>
                <label className="field" style={{ gridColumn: 'span 2' }}><span>Bước {k + 1} · tên hoạt động *</span>
                  <input value={s.title} onChange={e => setStep(s.id, { title: e.target.value })} placeholder="VD: Quan sát mô hình, đặt câu hỏi" /></label>
                <label className="field"><span>Thời gian (phút)</span><input type="number" min={0} max={300} value={s.minutes ?? ''} onChange={e => setStep(s.id, { minutes: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
                <span className="tools" style={{ alignSelf: 'end' }}>
                  <button type="button" onClick={() => move(s.id, -1)} aria-label="Đưa bước lên">↑</button>
                  <button type="button" onClick={() => move(s.id, 1)} aria-label="Đưa bước xuống">↓</button>
                  <button type="button" className="danger" onClick={() => set({ steps: value.steps.filter(x => x.id !== s.id) })}>Xoá</button></span>
                <label className="field" style={{ gridColumn: '1 / -1' }}><span>Mục tiêu</span><input value={s.goal ?? ''} onChange={e => setStep(s.id, { goal: e.target.value })} /></label>
                <label className="field" style={{ gridColumn: 'span 2' }}><span>Hoạt động của giáo viên</span><textarea rows={3} value={s.teacher ?? ''} onChange={e => setStep(s.id, { teacher: e.target.value })} /></label>
                <label className="field" style={{ gridColumn: 'span 2' }}><span>Hoạt động của học sinh</span><textarea rows={3} value={s.student ?? ''} onChange={e => setStep(s.id, { student: e.target.value })} /></label>
                <label className="field" style={{ gridColumn: '1 / -1' }}><span>Sản phẩm dự kiến</span><input value={s.product ?? ''} onChange={e => setStep(s.id, { product: e.target.value })} /></label>
              </fieldset>
            ) })}
            <button type="button" className="linkbtn" onClick={() => addStep(ph.key)}>+ Thêm bước vào “{ph.title}”</button>
          </section>
        )
      })}
    </div>
  )
}

/** Xem giáo án (chỉ đọc) */
export function PlanView({ plan }: { plan: PlanContent }) {
  const templates = useTemplates()
  const tpl = templates.find(t => t.id === plan.template_id)
  const phases = phasesOf(tpl, plan.steps)
  const secs = sectionsOf(tpl, plan.doc).filter(s => (plan.doc[s.key] ?? '').trim())
  if (!secs.length && !plan.steps.length) return null
  return (
    <div className="libplanview">
      {(tpl || plan.periods) && <p className="sub">{[tpl && `Mẫu: ${tpl.name}`, plan.periods && `${plan.periods} tiết`, plan.steps.length && `${totalMinutes(plan.steps)} phút`].filter(Boolean).join(' · ')}</p>}
      {secs.map(s => <div key={s.key} style={{ marginBottom: 8 }}><b>{s.title}</b><div style={{ whiteSpace: 'pre-wrap' }}>{plan.doc[s.key]}</div></div>)}
      {plan.steps.length > 0 && <>
        <b>Tiến trình dạy học</b>
        {phases.map(ph => {
          const st = plan.steps.filter(s => (s.phase ?? '') === ph.key)
          if (!st.length) return null
          return (
            <div key={ph.key || '_'} style={{ margin: '6px 0' }}><i>{ph.title}</i>
              <ol style={{ margin: '4px 0', paddingLeft: 20 }}>{st.map(s => (
                <li key={s.id}><b>{s.title}</b>{s.minutes ? <small className="sub"> · {s.minutes} phút</small> : null}
                  {s.goal && <div><small className="sub">Mục tiêu:</small> {s.goal}</div>}
                  {s.teacher && <div style={{ whiteSpace: 'pre-wrap' }}><small className="sub">GV:</small> {s.teacher}</div>}
                  {s.student && <div style={{ whiteSpace: 'pre-wrap' }}><small className="sub">HS:</small> {s.student}</div>}
                  {s.product && <div><small className="sub">Sản phẩm:</small> {s.product}</div>}</li>))}</ol>
            </div>
          )
        })}
      </>}
    </div>
  )
}
