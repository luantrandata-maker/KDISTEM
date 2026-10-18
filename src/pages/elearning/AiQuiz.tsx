import { useState } from 'react'
import { callAI, QuizResult, type QuizItem } from '../ai'
import { saveQuizToBank } from './common'

// Tạo câu hỏi trắc nghiệm bằng Trợ lý AI ngay trong ngân hàng câu hỏi, lưu thẳng vào ngân hàng (trạng thái Nháp)
export default function AssistantQuiz({ orgId, onSaved }: { orgId: string | null; onSaved: () => void }) {
  const [f, setF] = useState({ topic: '', subject: '', grade: '', count: '10', level: '' })
  const [items, setItems] = useState<QuizItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function run(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(''); setItems(null)
    try {
      const r = await callAI('quiz', f)
      if (!r.items?.length) setErr('AI chưa trả về đúng định dạng — thử lại hoặc giảm số câu.'); else setItems(r.items)
    } catch (x: any) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <>
      <form className="formgrid" onSubmit={run}>
        <label className="field wide"><span>Chủ đề *</span><input required value={f.topic} onChange={e => setF({ ...f, topic: e.target.value })} placeholder="VD: Năng lượng tái tạo, pin mặt trời" /></label>
        <label className="field"><span>Môn *</span><input required value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} /></label>
        <label className="field"><span>Khối</span><input value={f.grade} onChange={e => setF({ ...f, grade: e.target.value })} /></label>
        <label className="field"><span>Số câu</span><input type="number" min={1} max={20} value={f.count} onChange={e => setF({ ...f, count: e.target.value })} /></label>
        <label className="field"><span>Mức độ</span><select value={f.level} onChange={e => setF({ ...f, level: e.target.value })}><option value="">Hỗn hợp</option><option>nhận biết</option><option>thông hiểu</option><option>vận dụng</option></select></label>
        <div className="actions wide"><button className="primary" disabled={busy}>{busy ? 'AI đang soạn…' : 'Tạo câu hỏi bằng AI'}</button></div>
      </form>
      {err && <p className="msg">{err}</p>}
      {items && <QuizResult items={items} onSave={async picked => { const m = await saveQuizToBank(orgId, picked, f); onSaved(); return m }} />}
    </>
  )
}
