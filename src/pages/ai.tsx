import { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { supabase } from '../lib/supabase'
import { Tabs } from './teacher/common'

// Trợ lý AI (migration 052, hàm máy chủ ai-assistant). Nội dung câu hỏi / trả lời không lưu trên hệ thống.
export type QuizItem = { q: string; options: string[]; answer: number; explain: string; level: string }
type Status = { enabled: boolean; allowed: boolean; model: string; provider?: 'anthropic' | 'openai' | 'gemini'; org_quota: number; org_used: number; user_quota: number; user_used: number; reason: string | null }
type Task = 'lesson' | 'quiz' | 'comment' | 'document' | 'chat'
type Msg = { role: 'user' | 'assistant'; content: string }

const TASKS: [Task, string][] = [['lesson', 'Soạn kế hoạch bài dạy'], ['quiz', 'Câu hỏi trắc nghiệm'], ['comment', 'Nhận xét năng lực'], ['document', 'Văn bản hành chính'], ['chat', 'Hỏi đáp']]
const USAGE_TASKS: [string, string][] = [...TASKS, ['help', 'Nút Trợ giúp']]
const COMPS = ['Tự chủ và tự học', 'Giao tiếp và hợp tác', 'Giải quyết vấn đề và sáng tạo', 'Toán học', 'Khoa học tự nhiên', 'Công nghệ', 'Tin học']
const DOC_KINDS = ['Kế hoạch', 'Thông báo', 'Báo cáo', 'Công văn', 'Tờ trình', 'Quyết định']

export const md = (s: string) => DOMPurify.sanitize(marked.parse(s, { async: false }) as string)

export async function callAI(task: Task, input: Record<string, unknown>): Promise<{ text: string; items?: QuizItem[] | null }> {
  const { data, error } = await supabase.functions.invoke('ai-assistant', { body: { task, input } })
  if (!error) return data
  let msg = error.message
  try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error } catch { /* giữ thông báo gốc */ }
  if (/Failed to send a request|not found/i.test(msg)) msg = 'Chưa kết nối được hàm Trợ lý AI trên máy chủ (hàm ai-assistant).'
  throw new Error(msg)
}

function useStatus() {
  const [st, setSt] = useState<Status | null>(null)
  const [err, setErr] = useState('')
  const load = () => supabase.rpc('ai_status').then(({ data, error }) => {
    if (error) setErr(/does not exist|schema cache/i.test(error.message) ? 'Hãy chạy migration 052 trên Supabase.' : error.message); else setSt(data as Status)
  })
  useEffect(() => { load() }, [])
  return { st, err, reload: load }
}

function downloadDoc(title: string, markdown: string) {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:'Times New Roman',serif;font-size:13pt;line-height:1.4}table{border-collapse:collapse}td,th{border:1px solid #444;padding:4px 6px}</style></head><body>${md(markdown)}</body></html>`
  const url = URL.createObjectURL(new Blob(['﻿', html], { type: 'application/msword' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) + '.doc' })
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function Answer({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="panel aianswer">
      <div className="bar"><b>Kết quả</b><span className="tools">
        <button onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}>{copied ? 'Đã chép' : 'Chép'}</button>
        <button onClick={() => downloadDoc(title, text)}>Tải về Word</button>
      </span></div>
      <div className="mdbody" dangerouslySetInnerHTML={{ __html: md(text) }} />
      <p className="sub aifoot">Nội dung do AI tạo — giáo viên kiểm tra, chỉnh sửa trước khi dùng.</p>
    </div>
  )
}

export function QuizResult({ items, onSave }: { items: QuizItem[]; onSave?: (items: QuizItem[]) => Promise<string> }) {
  const [pick, setPick] = useState(() => new Set(items.map((_, i) => i)))
  const [msg, setMsg] = useState('')
  return (
    <div className="panel aianswer">
      <div className="bar"><b>{items.length} câu hỏi</b>{onSave && <button className="primary" disabled={!pick.size}
        onClick={async () => { try { setMsg(await onSave(items.filter((_, i) => pick.has(i)))) } catch (e: any) { setMsg(e.message) } }}>Lưu {pick.size} câu vào ngân hàng câu hỏi</button>}</div>
      {msg && <p className="sub" role="status"><b>{msg}</b></p>}
      <ol className="quizlist">{items.map((it, i) => (
        <li key={i}><label className="qhead"><input type="checkbox" checked={pick.has(i)} onChange={e => { const s = new Set(pick); e.target.checked ? s.add(i) : s.delete(i); setPick(s) }} /> <b>{it.q}</b>{it.level && <small className="pill">{it.level}</small>}</label>
          <ul>{it.options.map((o, k) => <li key={k} className={k === it.answer ? 'right' : ''}>{String.fromCharCode(65 + k)}. {o}</li>)}</ul>
          {it.explain && <small className="sub">Giải thích: {it.explain}</small>}</li>))}</ol>
    </div>
  )
}

export default function AssistantPage({ onSaveQuiz }: { onSaveQuiz?: (items: QuizItem[], meta: { subject: string; grade: string; topic: string }) => Promise<string> }) {
  const { st, err, reload } = useStatus()
  const [task, setTask] = useState<Task>('lesson')
  const [f, setF] = useState<Record<string, string>>({ periods: '2', count: '10', kind: 'Kế hoạch' })
  const [levels, setLevels] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [out, setOut] = useState<{ text: string; items?: QuizItem[] | null } | null>(null)
  const [chat, setChat] = useState<Msg[]>([])
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const left = st ? Math.min(st.org_quota - st.org_used, st.user_quota - st.user_used) : 0

  async function run(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg('')
    try {
      if (task === 'chat') {
        const next = [...chat, { role: 'user' as const, content: f.ask ?? '' }]
        setChat(next); setF({ ...f, ask: '' })
        const r = await callAI('chat', { messages: next })
        setChat([...next, { role: 'assistant', content: r.text }])
      } else {
        const input: Record<string, unknown> = { ...f }
        if (task === 'comment') input.competencies = Object.entries(levels).filter(([, v]) => v).map(([name, level]) => ({ name, level }))
        setOut(null)
        const r = await callAI(task, input)
        if (task === 'quiz' && !r.items?.length) setMsg('AI chưa trả về đúng định dạng câu hỏi — hiển thị bản chữ bên dưới.')
        setOut(r)
      }
    } catch (e: any) { setMsg(e.message) } finally { setBusy(false); reload() }
  }

  if (err) return <p className="msg">{err}</p>
  if (!st) return <p className="sub">Đang tải…</p>
  const off = !st.enabled || !st.allowed
  return (
    <>
      <div className="aistatus">
        <span className={'pill ' + (off ? 'inactive' : left > 0 ? 'active' : 'maintenance')}>{off ? 'Chưa dùng được' : left > 0 ? 'Sẵn sàng' : 'Hết lượt'}</span>
        {!off && <span>Hôm nay còn <b>{Math.max(0, st.user_quota - st.user_used)}</b>/{st.user_quota} lượt · đơn vị còn <b>{Math.max(0, st.org_quota - st.org_used)}</b>/{st.org_quota} lượt tháng này</span>}
        {!off && st.provider && <span className="sub">· {PROVIDERS[st.provider]?.name}</span>}
        {st.reason && <span className="sub">{st.reason}</span>}
      </div>
      <p className="sub aiprivacy">Không nhập họ tên, ngày sinh, số điện thoại… của học sinh. Hệ thống không lưu câu hỏi và câu trả lời — hãy chép hoặc tải về nếu cần giữ.</p>
      <Tabs value={task} onChange={t => { setTask(t); setOut(null); setMsg('') }} items={TASKS} />
      {task !== 'chat' && <form className="panel formgrid aiform" onSubmit={run}>
        {task === 'lesson' && <>
          <label className="field wide"><span>Chủ đề bài học *</span><input required value={f.topic ?? ''} onChange={set('topic')} placeholder="VD: Chế tạo máy lọc nước mini từ vật liệu tái chế" /></label>
          <label className="field"><span>Môn / lĩnh vực</span><input value={f.subject ?? ''} onChange={set('subject')} placeholder="Khoa học tự nhiên, Công nghệ…" /></label>
          <label className="field"><span>Khối lớp</span><input value={f.grade ?? ''} onChange={set('grade')} placeholder="VD: 7" /></label>
          <label className="field"><span>Số tiết</span><input type="number" min={1} max={10} value={f.periods ?? '2'} onChange={set('periods')} /></label>
          <label className="field"><span>Chương trình / gói STEM</span><input value={f.program ?? ''} onChange={set('program')} placeholder="Không bắt buộc" /></label>
          <label className="field wide"><span>Thiết bị, vật tư sẵn có</span><input value={f.equipment ?? ''} onChange={set('equipment')} placeholder="VD: bộ Arduino, cảm biến độ ẩm, chai nhựa, sỏi, cát…" /></label>
          <label className="field wide"><span>Yêu cầu thêm</span><textarea rows={2} value={f.notes ?? ''} onChange={set('notes')} /></label>
        </>}
        {task === 'quiz' && <>
          <label className="field wide"><span>Chủ đề *</span><input required value={f.topic ?? ''} onChange={set('topic')} placeholder="VD: Mạch điện đơn giản, điện trở, định luật Ôm" /></label>
          <label className="field"><span>Môn</span><input value={f.subject ?? ''} onChange={set('subject')} /></label>
          <label className="field"><span>Khối lớp</span><input value={f.grade ?? ''} onChange={set('grade')} /></label>
          <label className="field"><span>Số câu</span><input type="number" min={1} max={20} value={f.count ?? '10'} onChange={set('count')} /></label>
          <label className="field"><span>Mức độ</span><select value={f.level ?? ''} onChange={set('level')}><option value="">Hỗn hợp</option><option>nhận biết</option><option>thông hiểu</option><option>vận dụng</option></select></label>
        </>}
        {task === 'comment' && <>
          <div className="field wide"><span>Mức đạt từng năng lực (bỏ trống nếu không nhận xét)</span>
            <div className="complevels">{COMPS.map(c => <label key={c}><span>{c}</span><select value={levels[c] ?? ''} onChange={e => setLevels({ ...levels, [c]: e.target.value })}>
              <option value="">—</option>{['M1', 'M2', 'M3', 'M4'].map(m => <option key={m}>{m}</option>)}</select></label>)}</div></div>
          <label className="field wide"><span>Điểm nổi bật quan sát được</span><input value={f.strengths ?? ''} onChange={set('strengths')} placeholder="VD: chủ động đề xuất ý tưởng, lắp ráp cẩn thận, còn ngại thuyết trình" /></label>
          <label className="field"><span>Giọng văn</span><select value={f.tone ?? ''} onChange={set('tone')}><option value="">Động viên, cụ thể</option><option>trang trọng, ngắn gọn</option><option>thân thiện, gửi phụ huynh</option></select></label>
        </>}
        {task === 'document' && <>
          <label className="field"><span>Loại văn bản</span><select value={f.kind} onChange={set('kind')}>{DOC_KINDS.map(k => <option key={k}>{k}</option>)}</select></label>
          <label className="field"><span>Đơn vị ban hành</span><input value={f.unit ?? ''} onChange={set('unit')} placeholder="VD: Trường THCS Phố Hiến" /></label>
          <label className="field wide"><span>Trích yếu *</span><input required value={f.subject ?? ''} onChange={set('subject')} placeholder="VD: Tổ chức Ngày hội STEM năm học 2026–2027" /></label>
          <label className="field wide"><span>Các ý chính</span><textarea rows={4} value={f.points ?? ''} onChange={set('points')} placeholder="Thời gian, địa điểm, thành phần, phân công, kinh phí…" /></label>
        </>}
        <div className="actions wide"><button className="primary" disabled={busy || off || left <= 0}>{busy ? 'AI đang viết…' : 'Tạo bằng AI'}</button></div>
      </form>}
      {task === 'chat' && <div className="panel aichat">
        {chat.length === 0 && <p className="sub">Hỏi bất cứ điều gì về dạy học STEM, tổ chức hoạt động, đánh giá năng lực, hoặc cách dùng hệ thống.</p>}
        {chat.map((m, i) => <div key={i} className={'aimsg ' + m.role}>{m.role === 'user' ? m.content : <div className="mdbody" dangerouslySetInnerHTML={{ __html: md(m.content) }} />}</div>)}
        {busy && <div className="aimsg assistant"><span className="sub">AI đang trả lời…</span></div>}
        <form className="aiask" onSubmit={run}>
          <textarea rows={2} value={f.ask ?? ''} onChange={set('ask')} placeholder="Nhập câu hỏi…" aria-label="Câu hỏi"
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit() } }} />
          <span className="tools"><button type="button" onClick={() => setChat([])} disabled={!chat.length || busy}>Hội thoại mới</button>
            <button className="primary" disabled={busy || off || left <= 0 || !(f.ask ?? '').trim()}>Gửi</button></span>
        </form>
      </div>}
      {msg && <p className="msg">{msg}</p>}
      {out && task === 'quiz' && out.items?.length ? <QuizResult items={out.items} onSave={onSaveQuiz ? items => onSaveQuiz(items, { subject: f.subject ?? '', grade: f.grade ?? '', topic: f.topic ?? '' }) : undefined} />
        : out && <Answer text={out.text} title={(f.topic || f.subject || TASKS.find(t => t[0] === task)![1])} />}
    </>
  )
}

// ================= Cổng KDI: cấu hình, hạn mức, mức sử dụng =================
type Prov = 'anthropic' | 'openai' | 'gemini'
type Settings = { enabled: boolean; provider: Prov; model: string; fallback_provider: Prov | null; fallback_model: string | null; prices: Record<string, [number, number]>
  org_monthly_quota: number; user_daily_quota: number; portals: string[]; help_all_roles?: boolean; updated_at: string }
type Usage = { org_id: string | null; user_id: string | null; task: string; provider: string | null; model: string | null; input_tokens: number; output_tokens: number; ok: boolean; created_at: string; error: string | null }
type Limit = { org_id: string; enabled: boolean; monthly_quota: number | null; note: string | null }
// Nhà cung cấp (054). Tên mô hình lấy từ API của chính nhà cung cấp (nút "Lấy danh sách") — không cố định trong mã.
export const PROVIDERS: Record<Prov, { name: string; secret: string; console: string; note: string; suggest: string[] }> = {
  anthropic: { name: 'Claude (Anthropic)', secret: 'ANTHROPIC_API_KEY', console: 'console.anthropic.com', note: 'Trả phí theo token. Dữ liệu qua API không dùng để huấn luyện mô hình.', suggest: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'] },
  openai: { name: 'ChatGPT (OpenAI)', secret: 'OPENAI_API_KEY', console: 'platform.openai.com', note: 'API trả phí theo token (khác gói ChatGPT miễn phí trên web); cần nạp tín dụng trước.', suggest: [] },
  gemini: { name: 'Gemini (Google)', secret: 'GEMINI_API_KEY', console: 'aistudio.google.com', note: 'Có gói miễn phí (giới hạn số lượt / phút / ngày, dòng Flash và Flash-Lite). Ở gói miễn phí, Google có thể dùng nội dung để cải thiện sản phẩm và người duyệt có thể đọc — không nhập thông tin cá nhân.', suggest: [] },
}
const PORTALS: [string, string][] = [['teacher', 'Giáo viên'], ['school_admin', 'Quản trị trường'], ['department', 'Sở / Phòng'], ['platform', 'KDI']]
const TASK_LABEL: Record<string, string> = Object.fromEntries(TASKS)

export function PlatformAI() {
  const [tab, setTab] = useState<'use' | 'cfg' | 'usage'>('usage')
  return <><Tabs value={tab} onChange={setTab} items={[['usage', 'Mức sử dụng'], ['cfg', 'Cấu hình & hạn mức'], ['use', 'Dùng trợ lý']]} />
    {tab === 'use' ? <AssistantPage /> : tab === 'cfg' ? <AISettings /> : <AIUsage />}</>
}

function ModelPicker({ provider, value, onChange, label }: { provider: Prov; value: string; onChange: (v: string) => void; label: string }) {
  const [list, setList] = useState<string[] | null>(null)
  const [err, setErr] = useState('')
  async function fetchModels() {
    setErr('')
    const { data, error } = await supabase.functions.invoke('ai-assistant', { body: { action: 'models', provider } })
    if (error) { let m = error.message; try { const j = await (error as any).context?.json(); if (j?.error) m = j.error } catch { /* giữ */ } return setErr(m) }
    if (!data.configured) return setErr(`Chưa đặt secret ${PROVIDERS[provider].secret} — chưa lấy được danh sách.`)
    setList(data.models)
  }
  const id = 'models-' + label.replace(/\W/g, '')
  return <label className="field modelfield"><span>{label}</span>
    <span className="modelpick"><input required list={id} value={value} onChange={e => onChange(e.target.value.trim())} placeholder="Tên mô hình" />
      <button type="button" onClick={fetchModels}>Lấy danh sách</button></span>
    <datalist id={id}>{[...new Set([...(list ?? []), ...PROVIDERS[provider].suggest])].map(m => <option key={m} value={m} />)}</datalist>
    {list && <small className="sub">{list.length} mô hình dùng được với khoá hiện tại — gõ để lọc.</small>}
    {err && <small className="msg">{err}</small>}
  </label>
}

function AISettings() {
  const [s, setS] = useState<Settings | null>(null)
  const [keys, setKeys] = useState<Record<Prov, boolean> | null>(null)
  const [limits, setLimits] = useState<Limit[]>([])
  const [orgs, setOrgs] = useState<{ id: string; name: string; type: string }[]>([])
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [add, setAdd] = useState({ org: '', quota: '', enabled: true })
  const [test, setTest] = useState('')
  async function load() {
    const [a, b, c] = await Promise.all([supabase.from('ai_settings').select('*').eq('id', 1).maybeSingle(), supabase.from('ai_org_limits').select('*'),
      supabase.from('organizations').select('id, name, type').neq('type', 'provider').order('name')])
    if (a.error) setMsg([/does not exist|schema cache/i.test(a.error.message) ? 'Hãy chạy migration 052 trên Supabase.' : a.error.message, true])
    setS(a.data ? { provider: 'anthropic', fallback_provider: null, fallback_model: null, prices: {}, ...(a.data as any) } : null); setLimits((b.data as Limit[]) ?? []); setOrgs((c.data as any[]) ?? [])
    supabase.functions.invoke('ai-assistant', { body: { action: 'keys' } }).then(({ data }) => data && !data.error && setKeys(data))
  }
  useEffect(() => { load() }, [])
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!s) return
    const { error } = await supabase.from('ai_settings').update({ enabled: s.enabled, provider: s.provider, model: s.model, fallback_provider: s.fallback_provider,
      fallback_model: s.fallback_provider ? s.fallback_model : null, prices: s.prices, ...(s.help_all_roles === undefined ? {} : { help_all_roles: s.help_all_roles }), org_monthly_quota: s.org_monthly_quota, user_daily_quota: s.user_daily_quota, portals: s.portals }).eq('id', 1)
    setMsg(error ? [/provider|column/i.test(error.message) ? 'Hãy chạy migration 054 trên Supabase.' : error.message, true] : ['Đã lưu cấu hình.', false]); load()
  }
  async function upsertLimit() {
    if (!add.org) return
    const { error } = await supabase.from('ai_org_limits').upsert({ org_id: add.org, enabled: add.enabled, monthly_quota: add.quota ? Number(add.quota) : null, updated_at: new Date().toISOString() })
    setMsg(error ? [error.message, true] : ['Đã lưu hạn mức riêng.', false]); setAdd({ org: '', quota: '', enabled: true }); load()
  }
  async function tryIt() {
    setTest('Đang thử…')
    try { const r = await callAI('chat', { messages: [{ role: 'user', content: 'Chào bạn, trả lời đúng một câu: bạn là trợ lý nào?' }] }); setTest('✓ ' + r.text.slice(0, 200)) } catch (e: any) { setTest('✗ ' + e.message) }
  }
  const name = (id: string) => orgs.find(o => o.id === id)?.name ?? id
  if (!s) return msg ? <p className="msg">{msg[0]}</p> : <p className="sub">Đang tải…</p>
  const models = [s.model, s.fallback_provider ? s.fallback_model : null].filter(Boolean) as string[]
  return (
    <>
      <div className="provgrid">{(Object.keys(PROVIDERS) as Prov[]).map(p => <div key={p} className={'panel provcard' + (s.provider === p ? ' on' : s.fallback_provider === p ? ' fb' : '')}>
        <div className="bar"><b>{PROVIDERS[p].name}</b>{s.provider === p ? <span className="pill active">Đang dùng</span> : s.fallback_provider === p ? <span className="pill maintenance">Dự phòng</span> : null}</div>
        <small className="sub">{PROVIDERS[p].note}</small>
        <small>Khoá: <code>{PROVIDERS[p].secret}</code> {keys ? (keys[p] ? <span className="pill active">Đã đặt</span> : <span className="pill inactive">Chưa đặt</span>) : null}</small>
        <small className="sub">Lấy khoá tại {PROVIDERS[p].console}</small>
      </div>)}</div>
      <form className="panel formgrid" onSubmit={save}>
        <label className="field inline wide"><input type="checkbox" checked={s.enabled} onChange={e => setS({ ...s, enabled: e.target.checked })} /> <b>Bật Trợ lý AI cho toàn hệ thống</b></label>
        <label className="field"><span>Nhà cung cấp chính</span><select value={s.provider} onChange={e => { const p = e.target.value as Prov; setS({ ...s, provider: p, model: PROVIDERS[p].suggest[0] ?? '' }) }}>
          {(Object.keys(PROVIDERS) as Prov[]).map(p => <option key={p} value={p}>{PROVIDERS[p].name}</option>)}</select></label>
        <ModelPicker provider={s.provider} value={s.model} onChange={v => setS({ ...s, model: v })} label="Mô hình chính" />
        <label className="field"><span>Dự phòng khi nhà cung cấp chính lỗi / hết hạn mức</span><select value={s.fallback_provider ?? ''} onChange={e => { const p = (e.target.value || null) as Prov | null; setS({ ...s, fallback_provider: p, fallback_model: p ? PROVIDERS[p].suggest[0] ?? '' : null }) }}>
          <option value="">Không dùng</option>{(Object.keys(PROVIDERS) as Prov[]).filter(p => p !== s.provider).map(p => <option key={p} value={p}>{PROVIDERS[p].name}</option>)}</select></label>
        {s.fallback_provider && <ModelPicker provider={s.fallback_provider} value={s.fallback_model ?? ''} onChange={v => setS({ ...s, fallback_model: v })} label="Mô hình dự phòng" />}
        <label className="field"><span>Lượt / đơn vị / tháng</span><input type="number" min={0} value={s.org_monthly_quota} onChange={e => setS({ ...s, org_monthly_quota: Number(e.target.value) })} /></label>
        <label className="field"><span>Lượt / người / ngày</span><input type="number" min={0} value={s.user_daily_quota} onChange={e => setS({ ...s, user_daily_quota: Number(e.target.value) })} /></label>
        <div className="field wide"><span>Ai được dùng</span><div className="tools">{PORTALS.map(([k, l]) => <label key={k} className="field inline"><input type="checkbox" checked={s.portals.includes(k)}
          onChange={e => setS({ ...s, portals: e.target.checked ? [...s.portals, k] : s.portals.filter(x => x !== k) })} /> {l}</label>)}</div>
          <small className="sub">Học sinh, phụ huynh và giám khảo không dùng trợ lý.</small></div>
        {s.help_all_roles !== undefined && <label className="field inline wide"><input type="checkbox" checked={s.help_all_roles} onChange={e => setS({ ...s, help_all_roles: e.target.checked })} />
          Nút <b>Trợ giúp</b> (góc phải) trả lời bằng AI cho mọi người dùng, kể cả học sinh, phụ huynh — chỉ hỏi cách dùng hệ thống, tính chung hạn mức</label>}
        <div className="field wide"><span>Đơn giá để ước tính chi phí (USD / 1 triệu token: vào · ra) — xem bảng giá của nhà cung cấp; gói miễn phí để 0</span>
          <div className="tools">{models.map(m => <label key={m} className="field inline"><code>{m}</code>
            <input type="number" min={0} step="0.01" style={{ width: 80 }} value={s.prices[m]?.[0] ?? ''} onChange={e => setS({ ...s, prices: { ...s.prices, [m]: [Number(e.target.value), s.prices[m]?.[1] ?? 0] } })} aria-label={'Giá vào ' + m} />
            <input type="number" min={0} step="0.01" style={{ width: 80 }} value={s.prices[m]?.[1] ?? ''} onChange={e => setS({ ...s, prices: { ...s.prices, [m]: [s.prices[m]?.[0] ?? 0, Number(e.target.value)] } })} aria-label={'Giá ra ' + m} /></label>)}</div></div>
        <div className="actions wide"><button className="primary">Lưu cấu hình</button><button type="button" onClick={tryIt} disabled={!s.enabled}>Thử kết nối</button>{test && <span className="sub">{test}</span>}</div>
      </form>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      <div className="panel">
        <h3>Khoá API</h3>
        <p className="sub">Khoá đặt ở Supabase › Edge Functions › Secrets với đúng tên ở trên — không nhập khoá ở trang này. Có thể đặt cả ba để chuyển qua lại. Hệ thống không lưu nội dung câu hỏi và câu trả lời; chỉ lưu tác vụ, nhà cung cấp, mô hình và số token để tính hạn mức.</p>
      </div>
      <div className="panel">
        <h3>Hạn mức riêng theo đơn vị</h3>
        <p className="sub">Ghi đè hạn mức chung (theo gói dịch vụ / hợp đồng) hoặc tắt trợ lý cho một đơn vị.</p>
        <div className="tools" style={{ margin: '8px 0' }}>
          <select value={add.org} onChange={e => setAdd({ ...add, org: e.target.value })} aria-label="Đơn vị"><option value="">Chọn đơn vị…</option>{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
          <input type="number" min={0} placeholder="Lượt / tháng (trống = chung)" value={add.quota} onChange={e => setAdd({ ...add, quota: e.target.value })} aria-label="Lượt mỗi tháng" />
          <label className="field inline"><input type="checkbox" checked={add.enabled} onChange={e => setAdd({ ...add, enabled: e.target.checked })} /> Được dùng</label>
          <button onClick={upsertLimit} disabled={!add.org}>Lưu</button>
        </div>
        <div className="wrap"><table className="systable"><thead><tr><th>Đơn vị</th><th>Trạng thái</th><th className="num">Lượt / tháng</th><th /></tr></thead><tbody>
          {limits.map(l => <tr key={l.org_id}><td>{name(l.org_id)}</td><td><span className={'pill ' + (l.enabled ? 'active' : 'inactive')}>{l.enabled ? 'Được dùng' : 'Tắt'}</span></td>
            <td className="num">{l.monthly_quota ?? <small>chung ({s.org_monthly_quota})</small>}</td>
            <td><button className="xbtn" onClick={async () => { await supabase.from('ai_org_limits').delete().eq('org_id', l.org_id); load() }}>Bỏ</button></td></tr>)}
          {!limits.length && <tr><td colSpan={4}>Chưa có đơn vị nào dùng hạn mức riêng.</td></tr>}
        </tbody></table></div>
      </div>
    </>
  )
}

function AIUsage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [rows, setRows] = useState<Usage[]>([])
  const [orgs, setOrgs] = useState<Map<string, string>>(new Map())
  const [err, setErr] = useState('')
  const [prices, setPrices] = useState<Record<string, [number, number]>>({})
  useEffect(() => { supabase.from('ai_settings').select('prices').eq('id', 1).maybeSingle().then(({ data }) => setPrices((data as any)?.prices ?? {})) }, [])
  useEffect(() => {
    const from = new Date(month + '-01T00:00:00'), to = new Date(from); to.setMonth(to.getMonth() + 1)
    Promise.all([supabase.from('ai_usage').select('org_id, user_id, task, provider, model, input_tokens, output_tokens, ok, created_at, error').gte('created_at', from.toISOString()).lt('created_at', to.toISOString()).limit(20000),
      supabase.from('organizations').select('id, name')]).then(([u, o]) => {
      if (u.error) setErr(/does not exist|schema cache/i.test(u.error.message) ? 'Hãy chạy migration 052 trên Supabase.' : u.error.message)
      setRows((u.data as Usage[]) ?? []); setOrgs(new Map(((o.data as any[]) ?? []).map(x => [x.id, x.name])))
    })
  }, [month])
  const cost = (r: Usage) => { const p = prices[r.model ?? ''] ?? [0, 0]; return (r.input_tokens * p[0] + r.output_tokens * p[1]) / 1e6 }
  const ok = rows.filter(r => r.ok)
  const byOrg = useMemo(() => [...ok.reduce((m, r) => { const k = r.org_id ?? '—'; const v = m.get(k) ?? { n: 0, users: new Set<string>(), tin: 0, tout: 0, usd: 0 }
    v.n++; if (r.user_id) v.users.add(r.user_id); v.tin += r.input_tokens; v.tout += r.output_tokens; v.usd += cost(r); return m.set(k, v) }, new Map<string, { n: number; users: Set<string>; tin: number; tout: number; usd: number }>())]
    .sort((a, b) => b[1].n - a[1].n), [rows, prices])
  const byTask = USAGE_TASKS.map(([k, l]) => [l, ok.filter(r => r.task === k).length] as [string, number])
  const usd = ok.reduce((s, r) => s + cost(r), 0)
  const fmt = (n: number) => n.toLocaleString('vi-VN')
  if (err) return <p className="msg">{err}</p>
  return (
    <>
      <div className="bar"><label className="pickfield"><span>Tháng</span><input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label></div>
      <div className="cards syscards">
        <div className="card"><strong>{fmt(ok.length)}</strong><span>Lượt dùng thành công</span></div>
        <div className="card"><strong>{fmt(new Set(ok.map(r => r.user_id)).size)}</strong><span>Người dùng</span></div>
        <div className="card"><strong>{fmt(ok.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0))}</strong><span>Token (vào + ra)</span></div>
        <div className="card"><strong>${usd.toFixed(2)}</strong><span>Chi phí ước tính (USD)</span></div>
        <div className="card"><strong>{fmt(rows.length - ok.length)}</strong><span>Lượt lỗi</span></div>
      </div>
      <div className="tools" style={{ margin: '14px 0' }}>{byTask.map(([l, n]) => <span key={l} className="chipbtn">{l}: <b>{n}</b></span>)}
        {(Object.keys(PROVIDERS) as Prov[]).map(p => { const n = ok.filter(r => (r.provider ?? 'anthropic') === p).length; return n ? <span key={p} className="chipbtn">{PROVIDERS[p].name}: <b>{n}</b></span> : null })}</div>
      <div className="wrap"><table className="systable"><thead><tr><th>Đơn vị</th><th className="num">Lượt</th><th className="num">Người dùng</th><th className="num">Token vào</th><th className="num">Token ra</th><th className="num">Ước tính (USD)</th></tr></thead><tbody>
        {byOrg.map(([id, v]) => <tr key={id}><td>{orgs.get(id) ?? '—'}</td><td className="num"><b>{fmt(v.n)}</b></td><td className="num">{v.users.size}</td><td className="num">{fmt(v.tin)}</td><td className="num">{fmt(v.tout)}</td><td className="num">{v.usd.toFixed(2)}</td></tr>)}
        {!byOrg.length && <tr><td colSpan={6}>Chưa có lượt dùng trong tháng.</td></tr>}
      </tbody></table></div>
      <p className="sub">Chi phí ước tính theo đơn giá KDI nhập ở Cấu hình (gói miễn phí = 0); số tiền thực tế xem trên trang thanh toán của từng nhà cung cấp.</p>
    </>
  )
}
