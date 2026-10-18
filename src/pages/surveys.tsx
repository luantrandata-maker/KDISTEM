import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadXlsx } from '../lib/sheet'

// Khảo sát (migration 043). Sở/Phòng, trường, KDI tạo khảo sát; GV/HS/cán bộ trả lời; đơn vị tạo xem kết quả tổng hợp.
type QType = 'single' | 'multi' | 'scale' | 'text'
type Q = { id: string; type: QType; text: string; options?: string[]; required?: boolean }
type Survey = { id: string; org_id: string; title: string; description: string | null; audience: 'teacher' | 'student' | 'staff' | 'parent'; questions: Q[]; anonymous: boolean;
  status: 'draft' | 'open' | 'closed'; opens_at: string | null; closes_at: string | null; created_at: string; organizations?: { name: string } | null }
type Mine = { id: string; title: string; description: string | null; questions: Q[]; anonymous: boolean; closes_at: string | null; from_org: string; answered: boolean; my_answers: Record<string, unknown> | null }
type Res = { responses: number; by_org: { org: string | null; n: number }[]; questions: { id: string; counts?: number[]; avg?: number | null; texts?: { text: string; who: string | null; org: string | null }[] }[];
  rows: { who: string; org: string | null; at: string; answers: Record<string, unknown> }[] | null }

const QTYPE: Record<QType, string> = { single: 'Một lựa chọn', multi: 'Nhiều lựa chọn', scale: 'Thang 1–5', text: 'Trả lời ngắn' }
const AUD = { teacher: 'Giáo viên', student: 'Học sinh', parent: 'Phụ huynh', staff: 'Mọi cán bộ, giáo viên' } as const
const STATUS = { draft: 'Nháp', open: 'Đang mở', closed: 'Đã đóng' } as const
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN') : '—')
const toLocal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
const qid = () => 'q' + Math.random().toString(36).slice(2, 8)
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 043 trên Supabase.' : m)

// ---------- Trả lời ----------
function AnswerForm({ s, onDone }: { s: Mine; onDone: () => void }) {
  const [ans, setAns] = useState<Record<string, unknown>>(s.my_answers ?? {})
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true)
    const { error } = await supabase.rpc('survey_submit', { p_survey: s.id, p_answers: ans })
    setBusy(false)
    if (error) return setMsg([error.message, true])
    setMsg(['Đã gửi. Cảm ơn bạn!', false]); onDone()
  }
  const set = (k: string, v: unknown) => setAns({ ...ans, [k]: v })
  return (
    <form className="panel survey" onSubmit={submit}>
      <h3 style={{ margin: 0 }}>{s.title}</h3>
      <small className="sub">{s.from_org}{s.closes_at ? ` · hạn ${day(s.closes_at)}` : ''} · {s.anonymous ? 'Ẩn danh — đơn vị tạo không thấy tên bạn' : 'Không ẩn danh'}</small>
      {s.description && <p>{s.description}</p>}
      {s.questions.map((q, i) => (
        <fieldset key={q.id} className="sq">
          <legend>{i + 1}. {q.text}{q.required && <b className="due bad"> *</b>}</legend>
          {q.type === 'single' && q.options!.map((o, k) => <label key={k} className="field inline"><input type="radio" name={q.id} checked={ans[q.id] === k} onChange={() => set(q.id, k)} /> {o}</label>)}
          {q.type === 'multi' && q.options!.map((o, k) => { const cur = (ans[q.id] as number[] | undefined) ?? []; return (
            <label key={k} className="field inline"><input type="checkbox" checked={cur.includes(k)} onChange={e => set(q.id, e.target.checked ? [...cur, k] : cur.filter(x => x !== k))} /> {o}</label>) })}
          {q.type === 'scale' && <div className="scale5">{[1, 2, 3, 4, 5].map(v => <button type="button" key={v} className={ans[q.id] === v ? 'on' : ''} aria-pressed={ans[q.id] === v} onClick={() => set(q.id, v)}>{v}</button>)}
            <small className="sub">1 = rất không đồng ý / rất kém · 5 = rất đồng ý / rất tốt</small></div>}
          {q.type === 'text' && <textarea rows={3} maxLength={4000} value={(ans[q.id] as string) ?? ''} onChange={e => set(q.id, e.target.value)} />}
        </fieldset>
      ))}
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      <div className="formactions"><button className="primary" type="submit" disabled={busy}>{s.answered ? 'Gửi lại câu trả lời' : 'Gửi'}</button></div>
    </form>
  )
}

export function MySurveys({ compact = false }: { compact?: boolean }) {
  const [list, setList] = useState<Mine[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [err, setErr] = useState('')
  async function load() { const { data, error } = await supabase.rpc('my_surveys'); if (error) setErr(errText(error.message)); setList((data as Mine[]) ?? []) }
  useEffect(() => { load() }, [])
  if (err && !compact) return <p className="msg">{err}</p>
  if (!list) return null
  if (!list.length) return compact ? null : <p className="sub">Hiện không có khảo sát nào dành cho bạn.</p>
  const cur = list.find(s => s.id === open)
  return (
    <div className="mysurveys">
      {compact && <h3>Khảo sát dành cho bạn</h3>}
      <div className="wrap"><table>
        <thead><tr><th>Khảo sát</th><th>Đơn vị</th><th>Hạn</th><th>Trạng thái</th><th /></tr></thead>
        <tbody>{list.map(s => <tr key={s.id}><td><b>{s.title}</b></td><td>{s.from_org}</td><td>{day(s.closes_at)}</td>
          <td>{s.answered ? <span className="plbadge ok">Đã trả lời</span> : <span className="plbadge mute">Chưa trả lời</span>}</td>
          <td><button className={s.answered ? '' : 'primary'} onClick={() => setOpen(open === s.id ? null : s.id)}>{s.answered ? 'Xem / sửa' : 'Trả lời'}</button></td></tr>)}</tbody>
      </table></div>
      {cur && <AnswerForm key={cur.id} s={cur} onDone={load} />}
    </div>
  )
}

// ---------- Tạo & quản lý ----------
function Builder({ value, onChange }: { value: Q[]; onChange: (q: Q[]) => void }) {
  const set = (i: number, p: Partial<Q>) => onChange(value.map((q, j) => (j === i ? { ...q, ...p } : q)))
  const move = (i: number, d: number) => { const a = [...value]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x); onChange(a) }
  return (
    <div className="sbuilder">
      {value.map((q, i) => (
        <div key={q.id} className="sbq">
          <div className="tools">
            <b>{i + 1}.</b>
            <select value={q.type} onChange={e => { const t = e.target.value as QType; set(i, { type: t, options: t === 'single' || t === 'multi' ? (q.options?.length ? q.options : ['', '']) : undefined }) }} aria-label="Loại câu hỏi">
              {(Object.keys(QTYPE) as QType[]).map(t => <option key={t} value={t}>{QTYPE[t]}</option>)}</select>
            <label className="field inline"><input type="checkbox" checked={!!q.required} onChange={e => set(i, { required: e.target.checked })} /> Bắt buộc</label>
            <span style={{ flex: 1 }} />
            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Lên">↑</button>
            <button type="button" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="Xuống">↓</button>
            <button type="button" className="x" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Xoá câu hỏi">×</button>
          </div>
          <input value={q.text} onChange={e => set(i, { text: e.target.value })} placeholder="Nội dung câu hỏi" aria-label={`Câu hỏi ${i + 1}`} />
          {(q.type === 'single' || q.type === 'multi') && (
            <textarea rows={Math.max(2, q.options?.length ?? 2)} value={(q.options ?? []).join('\n')} onChange={e => set(i, { options: e.target.value.split('\n') })}
              placeholder="Mỗi dòng một lựa chọn" aria-label="Các lựa chọn" />)}
        </div>
      ))}
      <div className="tools">{(Object.keys(QTYPE) as QType[]).map(t => <button type="button" key={t}
        onClick={() => onChange([...value, { id: qid(), type: t, text: '', options: t === 'single' || t === 'multi' ? ['', ''] : undefined, required: false }])}>+ {QTYPE[t]}</button>)}</div>
    </div>
  )
}

function Results({ s }: { s: Survey }) {
  const [r, setR] = useState<Res | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { supabase.rpc('survey_results', { p_survey: s.id }).then(({ data, error }) => { if (error) setErr(error.message); setR(data as Res) }) }, [s.id])
  if (err) return <p className="msg">{err}</p>
  if (!r) return <p className="sub">Đang tải…</p>
  function excel() {
    const cols = s.questions.map(q => ({ key: q.id, label: q.text, width: 24 }))
    if (r!.rows) {
      const fmt = (q: Q, v: unknown) => v == null ? '' : q.type === 'single' ? q.options![v as number] : q.type === 'multi' ? (v as number[]).map(k => q.options![k]).join('; ') : String(v)
      downloadXlsx(`khao-sat-${s.title}`, [{ key: 'w', label: 'Người trả lời', width: 22 }, { key: 'o', label: 'Đơn vị', width: 26 }, { key: 'a', label: 'Thời gian', width: 18 }, ...cols],
        r!.rows.map(x => [x.who, x.org, new Date(x.at).toLocaleString('vi-VN'), ...s.questions.map(q => fmt(q, x.answers[q.id]))]), 'Câu trả lời')
    } else {
      const lines: string[][] = []
      s.questions.forEach((q, i) => { const a = r!.questions[i]
        if (a?.counts) (q.type === 'scale' ? ['1', '2', '3', '4', '5'] : q.options!).forEach((o, k) => lines.push([q.text, o, String(a.counts![k] ?? 0)]))
        if (a?.texts) a.texts.forEach(t => lines.push([q.text, t.text, t.org ?? ''])) })
      downloadXlsx(`khao-sat-${s.title}`, [{ key: 'q', label: 'Câu hỏi', width: 40 }, { key: 'o', label: 'Lựa chọn / câu trả lời', width: 40 }, { key: 'n', label: 'Số phiếu / đơn vị', width: 18 }], lines, 'Tổng hợp')
    }
  }
  return (
    <div className="sresults">
      <div className="bar"><b>{r.responses} phiếu trả lời</b>{r.by_org.length > 1 && <small className="sub">{r.by_org.length} đơn vị</small>}<span style={{ flex: 1 }} /><button onClick={excel} disabled={!r.responses}>Xuất Excel</button></div>
      {s.questions.map((q, i) => { const a = r.questions[i]; const tot = a?.counts ? Math.max(1, a.counts.reduce((x, y) => x + y, 0)) : 1; return (
        <div key={q.id} className="sqres">
          <b>{i + 1}. {q.text}</b> <small className="sub">{QTYPE[q.type]}{q.type === 'scale' && a?.avg != null ? ` · trung bình ${a.avg}/5` : ''}</small>
          {a?.counts && (q.type === 'scale' ? ['1', '2', '3', '4', '5'] : q.options!).map((o, k) => (
            <div key={k} className="covrow"><span title={o}>{o}</span><span className="covtrack"><i style={{ width: Math.round(100 * (a.counts![k] ?? 0) / (q.type === 'multi' ? Math.max(1, r.responses) : tot)) + '%' }} /></span>
              <small>{a.counts![k] ?? 0} · {Math.round(100 * (a.counts![k] ?? 0) / (q.type === 'multi' ? Math.max(1, r.responses) : tot))}%</small></div>))}
          {a?.texts && (a.texts.length ? <ul className="stexts">{a.texts.slice(0, 50).map((t, k) => <li key={k}>{t.text} <small className="sub">{[t.who, t.org].filter(Boolean).join(' · ')}</small></li>)}
            {a.texts.length > 50 && <li><small>… và {a.texts.length - 50} ý kiến khác (xem file Excel)</small></li>}</ul> : <p className="sub">Chưa có ý kiến.</p>)}
        </div>) })}
      {r.by_org.length > 1 && <details><summary>Số phiếu theo đơn vị</summary><ul>{r.by_org.map((o, k) => <li key={k}>{o.org ?? '—'}: {o.n}</li>)}</ul></details>}
    </div>
  )
}

export function SurveyManager() {
  const [list, setList] = useState<Survey[]>([])
  const [me, setMe] = useState<string | null>(null)
  const [platform, setPlatform] = useState(false)
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState<Partial<Survey> | null>(null)
  const [view, setView] = useState<string | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  async function load() {
    const [s, o, p] = await Promise.all([
      supabase.from('surveys').select('*, organizations(name)').order('created_at', { ascending: false }),
      supabase.rpc('my_org_id'), supabase.rpc('is_platform_admin'),
    ])
    if (s.error) setMsg([errText(s.error.message), true])
    setList((s.data as Survey[]) ?? []); setMe(o.data as string | null); setPlatform(!!p.data)
    if (p.data) supabase.from('organizations').select('id, name').in('type', ['province', 'department', 'district']).order('name').then(({ data }) => setOrgs((data as any[]) ?? []))
  }
  useEffect(() => { load() }, [])
  async function save(status?: Survey['status']) {
    if (!form?.title?.trim()) return setMsg(['Nhập tên khảo sát.', true])
    const qs = (form.questions ?? []).map(q => ({ ...q, text: q.text.trim(), options: q.options?.map(o => o.trim()).filter(Boolean) }))
    const row = { org_id: form.org_id ?? me, title: form.title.trim(), description: form.description?.trim() || null, audience: form.audience ?? 'teacher',
      questions: qs, anonymous: form.anonymous ?? true, opens_at: form.opens_at || null, closes_at: form.closes_at || null, status: status ?? form.status ?? 'draft' }
    const { error } = form.id ? await supabase.from('surveys').update(row).eq('id', form.id) : await supabase.from('surveys').insert(row)
    if (error) return setMsg([error.message, true])
    setMsg([status === 'open' ? 'Đã mở khảo sát. Người thuộc đối tượng sẽ thấy ở mục Khảo sát.' : 'Đã lưu.', false]); setForm(null); load()
  }
  async function setStatus(s: Survey, status: Survey['status']) {
    if (status === 'closed' && !confirm(`Đóng khảo sát "${s.title}"? Sau khi đóng không nhận thêm câu trả lời.`)) return
    const { error } = await supabase.from('surveys').update({ status }).eq('id', s.id)
    if (error) return setMsg([error.message, true]); load()
  }
  async function remove(s: Survey) {
    if (!confirm(`Xoá khảo sát "${s.title}" và mọi câu trả lời?`)) return
    const { error } = await supabase.from('surveys').delete().eq('id', s.id)
    if (error) return setMsg([error.message, true]); load()
  }
  const mine = (s: Survey) => platform || s.org_id === me
  const cur = list.find(s => s.id === view)
  return (
    <>
      <MySurveys compact />
      <div className="bar">
        <h3 style={{ margin: 0 }}>Khảo sát của đơn vị</h3>
        <button className="primary" onClick={() => { setView(null); setForm({ audience: 'teacher', anonymous: true, questions: [{ id: qid(), type: 'scale', text: '', required: true }], org_id: platform ? orgs[0]?.id : undefined }) }}>+ Tạo khảo sát</button>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}
      {form && (
        <form className="panel formgrid" onSubmit={e => { e.preventDefault(); save() }}>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên khảo sát *</span><input required value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="VD: Khảo sát nhu cầu tập huấn STEM HK2" /></label>
          {platform && <label className="field"><span>Đơn vị phát hành</span><select value={form.org_id ?? ''} onChange={e => setForm({ ...form, org_id: e.target.value })}>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
          <label className="field"><span>Đối tượng</span><select value={form.audience} onChange={e => setForm({ ...form, audience: e.target.value as Survey['audience'] })}>
            {Object.entries(AUD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span>Mở từ</span><input type="datetime-local" value={toLocal(form.opens_at ?? null)} onChange={e => setForm({ ...form, opens_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
          <label className="field"><span>Hạn trả lời</span><input type="datetime-local" value={toLocal(form.closes_at ?? null)} onChange={e => setForm({ ...form, closes_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
          <label className="field inline"><input type="checkbox" checked={!!form.anonymous} onChange={e => setForm({ ...form, anonymous: e.target.checked })} /> Ẩn danh (không xem được ai trả lời gì)</label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Lời dẫn</span><textarea rows={2} value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          <div style={{ gridColumn: '1 / -1' }}><Builder value={form.questions ?? []} onChange={q => setForm({ ...form, questions: q })} /></div>
          <p className="sub" style={{ gridColumn: '1 / -1', margin: 0 }}>Người nhận: {AUD[form.audience ?? 'teacher'].toLowerCase()} thuộc đơn vị phát hành và các đơn vị trực thuộc. Đã có người trả lời thì không sửa được câu hỏi.</p>
          <div className="formactions"><button type="submit">Lưu nháp</button> <button type="button" className="primary" onClick={() => save('open')}>Lưu và mở khảo sát</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button></div>
        </form>
      )}
      <div className="wrap"><table>
        <thead><tr><th>Khảo sát</th><th>Đối tượng</th><th>Thời gian</th><th>Trạng thái</th><th /></tr></thead>
        <tbody>{list.map(s => (
          <tr key={s.id}><td><b>{s.title}</b><br /><small>{s.organizations?.name}{s.anonymous ? ' · ẩn danh' : ''} · {s.questions.length} câu</small></td>
            <td>{AUD[s.audience]}</td><td><small>{day(s.opens_at ?? s.created_at)} → {day(s.closes_at)}</small></td>
            <td><span className={'plbadge ' + (s.status === 'open' ? 'ok' : 'mute')}>{STATUS[s.status]}</span></td>
            <td className="nowrap"><button onClick={() => setView(view === s.id ? null : s.id)}>Kết quả</button>{mine(s) && <>
              {' '}<button onClick={() => { setView(null); setForm(s) }}>Sửa</button>
              {' '}{s.status === 'open' ? <button onClick={() => setStatus(s, 'closed')}>Đóng</button> : <button onClick={() => setStatus(s, 'open')}>{s.status === 'draft' ? 'Mở' : 'Mở lại'}</button>}
              {' '}<button className="x" onClick={() => remove(s)} aria-label={`Xoá ${s.title}`}>×</button></>}</td></tr>))}
          {!list.length && <tr><td colSpan={5}>Chưa có khảo sát. Bấm "Tạo khảo sát".</td></tr>}</tbody>
      </table></div>
      {cur && <div className="panel"><div className="bar"><h3 style={{ margin: 0 }}>Kết quả: {cur.title}</h3><button onClick={() => setView(null)}>Đóng</button></div><Results s={cur} /></div>}
    </>
  )
}
