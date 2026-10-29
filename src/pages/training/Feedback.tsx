// Phiếu đánh giá sau khoá tập huấn (migration 114): giáo viên chấm khoá học và giảng viên; tổng hợp và góp ý cho đơn vị quản lý.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtDate } from '../../lib/time'

export const FB_CRIT = [
  ['content', 'Nội dung thiết thực, phù hợp'], ['method', 'Phương pháp tập huấn'], ['organize', 'Tổ chức, thời gian, địa điểm'],
  ['materials', 'Tài liệu, thiết bị thực hành'], ['applicable', 'Áp dụng được vào giờ dạy'], ['overall', 'Mức hài lòng chung'],
] as const
export const TR_CRIT = [['expertise', 'Chuyên môn'], ['delivery', 'Truyền đạt dễ hiểu'], ['interaction', 'Tương tác, hỗ trợ học viên']] as const
type FbKey = typeof FB_CRIT[number][0]
type TrKey = typeof TR_CRIT[number][0]
type TrMine = Partial<Record<TrKey, number>> & { comment?: string | null }
type Form = { open: boolean; mine: (Partial<Record<FbKey, number>> & { comment: string | null; updated_at: string }) | null
  trainers: { id: string; name: string; title: string | null; workplace: string | null; mine: TrMine | null }[] }

export const score = (n: number | null | undefined) => n == null ? '—' : Number(n).toFixed(1).replace('.', ',')
// Màu theo điểm trung bình 1–5
export const scoreTone = (n: number | null | undefined) => n == null ? '' : n >= 4 ? 'active' : n >= 3 ? 'maintenance' : 'inactive'

function Stars({ value, onChange, label }: { value: number | undefined; onChange: (n: number) => void; label: string }) {
  return <span className="stars" role="radiogroup" aria-label={label}>
    {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} điểm`}
      className={value != null && n <= value ? 'on' : ''} onClick={() => onChange(n)}>★</button>)}
  </span>
}

export function FeedbackPanel({ planId }: { planId: string }) {
  const [f, setF] = useState<Form | null>(null)
  const [sc, setSc] = useState<Partial<Record<FbKey, number>>>({})
  const [comment, setComment] = useState('')
  const [tr, setTr] = useState<Record<string, TrMine>>({})
  const [edit, setEdit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const load = () => supabase.rpc('training_feedback_form', { p_plan: planId }).then(({ data, error }) => {
    if (error) return setF(null)
    const d = data as Form
    setF(d)
    setSc(d.mine ? Object.fromEntries(FB_CRIT.map(([k]) => [k, d.mine![k]])) : {})
    setComment(d.mine?.comment ?? '')
    setTr(Object.fromEntries(d.trainers.map(t => [t.id, t.mine ?? {}])))
    setEdit(!d.mine)
  })
  useEffect(() => { load() }, [planId])
  if (!f) return null
  const ready = FB_CRIT.every(([k]) => sc[k]) && f.trainers.every(t => TR_CRIT.every(([k]) => tr[t.id]?.[k]))
  async function send() {
    setBusy(true); setMsg('')
    const { error } = await supabase.rpc('training_feedback_submit', { p_plan: planId, p_scores: sc, p_comment: comment,
      p_trainers: f!.trainers.map(t => ({ id: t.id, ...tr[t.id] })) })
    setBusy(false)
    if (error) return setMsg(error.message)
    setMsg('Đã gửi phiếu đánh giá. Cảm ơn thầy/cô!'); load()
  }
  return <section className="panel" style={{ display: 'grid', gap: 10 }} aria-label="Phiếu đánh giá khoá tập huấn">
    <div className="bar" style={{ margin: 0 }}><b>⭐ Đánh giá khoá tập huấn</b>
      {f.mine ? <span className="pill active">Đã gửi {fmtDate(f.mine.updated_at)}</span> : f.open ? <span className="pill maintenance">Chưa đánh giá</span> : null}</div>
    {!f.open ? <small className="sub">Phiếu mở khi khoá tập huấn kết thúc hoặc khi thầy/cô đã có kết quả.</small> : <>
      <small className="sub">Chấm 1–5 sao. Phiếu không ghi tên người đánh giá khi đơn vị tổng hợp.</small>
      <div className="fbgrid">
        {FB_CRIT.map(([k, l]) => <div key={k} className="fbrow"><span>{l}</span>
          {edit ? <Stars label={l} value={sc[k]} onChange={n => setSc(s => ({ ...s, [k]: n }))} /> : <b>{sc[k] ?? '—'}/5</b>}</div>)}
      </div>
      {edit ? <label className="field"><span>Góp ý cho khoá học (không bắt buộc)</span>
        <textarea rows={3} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} placeholder="Điều thầy/cô thấy hữu ích, điều cần cải thiện…" /></label>
        : f.mine?.comment && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}><small className="sub">Góp ý:</small><br />{f.mine.comment}</p>}
      {f.trainers.map(t => <div key={t.id} className="fbtrainer">
        <b>Giảng viên: {[t.title, t.name].filter(Boolean).join(' ')}</b>{t.workplace && <small className="sub"> · {t.workplace}</small>}
        <div className="fbgrid">
          {TR_CRIT.map(([k, l]) => <div key={k} className="fbrow"><span>{l}</span>
            {edit ? <Stars label={`${l} — ${t.name}`} value={tr[t.id]?.[k]} onChange={n => setTr(s => ({ ...s, [t.id]: { ...s[t.id], [k]: n } }))} />
              : <b>{tr[t.id]?.[k] ?? '—'}/5</b>}</div>)}
        </div>
        {edit && <input aria-label={`Góp ý cho giảng viên ${t.name}`} maxLength={1000} value={tr[t.id]?.comment ?? ''} placeholder="Góp ý cho giảng viên (không bắt buộc)"
          onChange={e => setTr(s => ({ ...s, [t.id]: { ...s[t.id], comment: e.target.value } }))} />}
      </div>)}
      <div className="tools">{edit ? <>
        <button type="button" className="primary" disabled={busy || !ready} onClick={send}>{busy ? 'Đang gửi…' : f.mine ? 'Gửi lại' : 'Gửi đánh giá'}</button>
        {f.mine && <button type="button" onClick={() => { setEdit(false); load() }}>Huỷ</button>}
        {!ready && <small className="sub">Chấm đủ các tiêu chí để gửi.</small>}
      </> : <button type="button" onClick={() => setEdit(true)}>Sửa đánh giá</button>}</div>
    </>}
    {msg && <small role="status">{msg}</small>}
  </section>
}

// Góp ý ẩn danh của một kế hoạch (lọc theo trường nếu có)
type Cmt = { org_name: string; kind: 'course' | 'trainer'; trainer_name: string | null; score: number; comment: string; at: string }
export function FeedbackComments({ planId, orgId, showOrg }: { planId: string; orgId?: string | null; showOrg?: boolean }) {
  const [rows, setRows] = useState<Cmt[] | null>(null)
  useEffect(() => {
    supabase.rpc('training_feedback_comments', { p_plan: planId, p_org: orgId ?? null }).then(({ data, error }) => setRows(error ? [] : data as Cmt[]))
  }, [planId, orgId])
  if (!rows) return <small className="sub">Đang tải góp ý…</small>
  if (!rows.length) return <small className="sub">Chưa có góp ý.</small>
  return <ul className="fbcomments">{rows.map((r, i) => <li key={i}>
    <span className={`pill ${scoreTone(r.score)}`}>{score(r.score)}★</span>
    <span>{r.comment}<br /><small className="sub">{r.kind === 'trainer' ? `Về giảng viên ${r.trainer_name}` : 'Về khoá học'}{showOrg ? ` · ${r.org_name}` : ''} · {fmtDate(r.at)}</small></span>
  </li>)}</ul>
}
