import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx } from '../../lib/sheet'
import { Tabs } from '../teacher/common'
import { TEMPLATES, LEVEL, ORG_LEVEL, esc, words, type Doc, type Crit } from './templates'

// Cuộc thi (migration 051): đơn vị nào cũng tổ chức được; trường nộp dự án; ban giám khảo chấm; chuyển vòng; trao giải.
type C = { id: string; org_id: string; title: string; template: string; description: string | null; fields: string[]; grades: string[]; max_members: number; max_per_school: number | null
  required_docs: Doc[]; criteria: Crit[]; abstract_words: number | null; anonymous: boolean; fee: number | null; rounds: string[]; current_round: number
  submit_from: string | null; submit_until: string | null; status: 'draft' | 'open' | 'judging' | 'finished' | 'cancelled'; created_at: string; organizations: { name: string; type: string } | null }
type R = { entry_id: string; code: string; field: string | null; title: string; school: string; members: string | null; status: string; round: number; judges: number; scored: number
  avg_total: number | null; spread: number | null; rank_in_field: number | null; award: string | null; fee_status: string; docs: Record<string, string>; project_id: string }
type J = { id: string; full_name: string; email: string | null; profile_id: string | null; fields: string[] }
type E = { id: string; competition_id: string; project_id: string; field: string | null; code: string; docs: Record<string, string>; status: string; round: number; award: string | null; score: number | null; rank: number | null; fee_status: string; student_projects: { title: string } | null }
const ST: Record<string, [string, string]> = { draft: ['Nháp', 'mute'], open: ['Đang nhận bài', 'ok'], judging: ['Đang chấm', 'bad'], finished: ['Đã kết thúc', 'mute'], cancelled: ['Đã huỷ', 'mute'] }
const ES: Record<string, string> = { submitted: 'Đã nộp', withdrawn: 'Đã rút', eliminated: 'Dừng ở vòng trước', awarded: 'Đạt giải' }
const FEE: Record<string, string> = { none: '—', unpaid: 'Chưa nộp', paid: 'Đã nộp', waived: 'Miễn' }
const AWARDS = ['Giải Nhất', 'Giải Nhì', 'Giải Ba', 'Giải Khuyến khích', 'Giải Triển vọng']
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('vi-VN') : '—')
const local = (d: string | null) => (d ? new Date(new Date(d).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '')
const val = (d: string | null | undefined) => (!d ? '' : /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(d) ? d : local(d))
const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null)
const money = (n: number | null) => (n ? Math.round(n).toLocaleString('vi-VN') + ' đ' : 'Miễn phí')
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 051 trên Supabase.' : /row-level/i.test(m) ? 'Chỉ đơn vị tổ chức sửa được cuộc thi.' : m)

async function callAccounts(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('school-accounts', { body })
  if (!error) return data
  let msg = error.message
  try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error } catch { /* giữ thông báo gốc */ }
  throw new Error(msg)
}

function printCertificates(c: C, rows: R[]) {
  const w = window.open('', '_blank'); if (!w) return false
  const org = c.organizations?.name ?? ''
  w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Giấy chứng nhận</title><style>
    @page{size:A4 landscape;margin:0}body{margin:0;font-family:"Times New Roman",serif}
    .c{width:297mm;height:210mm;box-sizing:border-box;padding:18mm 22mm;page-break-after:always;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border:6mm double #b8860b}
    .o{font-size:16pt;text-transform:uppercase;font-weight:bold}.t{font-size:40pt;color:#9b1c1c;margin:10mm 0 4mm;font-weight:bold;letter-spacing:2px}
    .n{font-size:20pt;font-weight:bold;margin:4mm 0}.p{font-size:15pt;margin:2mm 0}.a{font-size:28pt;color:#9b1c1c;font-weight:bold;margin:6mm 0}.s{margin-top:12mm;font-size:13pt;font-style:italic}</style></head><body>
    ${rows.map(r => `<div class="c"><div class="o">${esc(org)}</div><div class="t">GIẤY CHỨNG NHẬN</div><div class="p">Chứng nhận các em</div><div class="n">${esc(r.members ?? '')}</div>
      <div class="p">${esc(r.school)}</div><div class="p">với dự án <b>“${esc(r.title)}”</b>${r.field ? ` — lĩnh vực ${esc(r.field)}` : ''}</div><div class="p">đã đạt</div><div class="a">${esc(r.award ?? '')}</div>
      <div class="p">${esc(c.title)}</div><div class="s">${esc(org)}, ngày ${new Date().getDate()} tháng ${new Date().getMonth() + 1} năm ${new Date().getFullYear()}</div></div>`).join('')}
    <script>window.onload=()=>window.print()<\/script></body></html>`)
  w.document.close(); return true
}

function Editor({ c, orgId, onDone }: { c: Partial<C>; orgId: string; onDone: (m?: string) => void }) {
  const [f, setF] = useState<Partial<C>>(c)
  const [fields, setFields] = useState((c.fields ?? []).join('\n'))
  const [rounds, setRounds] = useState((c.rounds ?? ['Vòng chung kết']).join(', '))
  const [err, setErr] = useState('')
  const apply = (k: string) => { const t = TEMPLATES[k]; setF({ ...f, template: t.key, required_docs: t.docs, criteria: t.criteria, max_members: t.max_members, abstract_words: t.abstract_words, grades: t.grades }); setFields(t.fields.join('\n')) }
  const total = (f.criteria ?? []).reduce((a, x) => a + Number(x.max || 0), 0)
  async function save(open: boolean) {
    if (!f.title?.trim() || f.title.trim().length < 5) return setErr('Cần tên cuộc thi (≥ 5 ký tự).')
    if (!(f.criteria ?? []).length) return setErr('Cần ít nhất một tiêu chí chấm.')
    const crit = (f.criteria ?? []).map((x, i) => ({ key: x.key || 'c' + (i + 1), label: x.label.trim(), max: Number(x.max) })), docs = (f.required_docs ?? []).filter(d => d.label.trim()).map((d, i) => ({ key: d.key || 'd' + (i + 1), label: d.label.trim(), required: !!d.required }))
    const row = { org_id: orgId, title: f.title.trim(), template: f.template ?? 'custom', description: f.description?.trim() || null, fields: fields.split('\n').map(x => x.trim()).filter(Boolean),
      grades: f.grades ?? [], max_members: Number(f.max_members) || 2, max_per_school: f.max_per_school ? Number(f.max_per_school) : null, required_docs: docs, criteria: crit,
      abstract_words: f.abstract_words ? Number(f.abstract_words) : null, anonymous: !!f.anonymous, fee: f.fee ? Number(f.fee) : null,
      rounds: rounds.split(',').map(x => x.trim()).filter(Boolean).slice(0, 5), submit_from: iso(f.submit_from), submit_until: iso(f.submit_until),
      ...(open ? { status: 'open' } : {}) }
    if (!row.rounds.length) row.rounds = ['Vòng chung kết']
    const { error } = f.id ? await supabase.from('competitions').update(row).eq('id', f.id) : await supabase.from('competitions').insert(row)
    if (error) return setErr(errText(error.message)); onDone(open ? 'Đã mở nhận bài.' : 'Đã lưu.')
  }
  const setCrit = (i: number, p: Partial<Crit>) => setF({ ...f, criteria: f.criteria!.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  const setDoc = (i: number, p: Partial<Doc>) => setF({ ...f, required_docs: f.required_docs!.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  return (
    <form className="panel formgrid" onSubmit={e => { e.preventDefault(); save(false) }}>
      {!f.id && <label className="field" style={{ gridColumn: '1 / -1' }}><span>Mẫu</span><select value={f.template ?? ''} onChange={e => apply(e.target.value)}>
        <option value="">— chọn mẫu —</option>{Object.values(TEMPLATES).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>}
      {f.template === 'khkt' && <p className="sub" style={{ gridColumn: '1 / -1', margin: 0 }}>Mẫu KHKT điền sẵn 22 lĩnh vực, hồ sơ và tiêu chí theo hướng dẫn của Bộ GD&ĐT — đối chiếu và chỉnh theo văn bản hướng dẫn của năm học hiện hành.</p>}
      <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên cuộc thi *</span><input value={f.title ?? ''} onChange={e => setF({ ...f, title: e.target.value })} placeholder="VD: Cuộc thi KHKT dành cho học sinh trung học cấp tỉnh năm học 2026–2027" /></label>
      <label className="field" style={{ gridColumn: '1 / -1' }}><span>Thể lệ, mô tả</span><textarea rows={3} value={f.description ?? ''} onChange={e => setF({ ...f, description: e.target.value })} /></label>
      <label className="field"><span>Nhận bài từ</span><input type="datetime-local" value={val(f.submit_from)} onChange={e => setF({ ...f, submit_from: e.target.value })} /></label>
      <label className="field"><span>Hạn nộp bài</span><input type="datetime-local" value={val(f.submit_until)} onChange={e => setF({ ...f, submit_until: e.target.value })} /></label>
      <label className="field"><span>Số HS tối đa / dự án</span><input type="number" min={1} max={10} value={f.max_members ?? 2} onChange={e => setF({ ...f, max_members: +e.target.value })} /></label>
      <label className="field"><span>Số dự án tối đa / trường</span><input type="number" min={1} value={f.max_per_school ?? ''} onChange={e => setF({ ...f, max_per_school: e.target.value ? +e.target.value : null })} placeholder="không giới hạn" /></label>
      <label className="field"><span>Tóm tắt tối đa (từ)</span><input type="number" min={1} value={f.abstract_words ?? ''} onChange={e => setF({ ...f, abstract_words: e.target.value ? +e.target.value : null })} placeholder="không giới hạn" /></label>
      <label className="field"><span>Lệ phí / dự án (đ)</span><input type="number" min={0} value={f.fee ?? ''} onChange={e => setF({ ...f, fee: e.target.value ? +e.target.value : null })} placeholder="miễn phí" /></label>
      <label className="field"><span>Các vòng (cách nhau dấu phẩy)</span><input value={rounds} onChange={e => setRounds(e.target.value)} placeholder="Vòng sơ khảo, Vòng chung kết" /></label>
      <div className="field"><span>Cấp học dự thi</span><span className="tools">{Object.entries(LEVEL).map(([k, v]) => <label key={k}><input type="checkbox" checked={(f.grades ?? []).includes(k)} onChange={e => setF({ ...f, grades: e.target.checked ? [...(f.grades ?? []), k] : (f.grades ?? []).filter(x => x !== k) })} /> {v}</label>)}</span><small className="sub">không chọn = mọi cấp</small></div>
      <label style={{ gridColumn: '1 / -1' }}><input type="checkbox" checked={!!f.anonymous} onChange={e => setF({ ...f, anonymous: e.target.checked })} /> Chấm ẩn danh (giám khảo chỉ thấy mã bài, không thấy tên trường, học sinh)</label>
      <label className="field" style={{ gridColumn: '1 / -1' }}><span>Lĩnh vực (mỗi dòng một lĩnh vực; trống = không chia lĩnh vực)</span><textarea rows={4} value={fields} onChange={e => setFields(e.target.value)} /></label>
      <div className="field" style={{ gridColumn: '1 / -1' }}><span>Hồ sơ nộp (đường link)</span>
        {(f.required_docs ?? []).map((d, i) => <span key={i} className="tools"><input value={d.label} onChange={e => setDoc(i, { label: e.target.value })} style={{ flex: 1 }} aria-label="Tên hồ sơ" />
          <label><input type="checkbox" checked={d.required} onChange={e => setDoc(i, { required: e.target.checked })} /> bắt buộc</label>
          <button type="button" onClick={() => setF({ ...f, required_docs: f.required_docs!.filter((_, j) => j !== i) })} aria-label="Bỏ">✕</button></span>)}
        <button type="button" onClick={() => setF({ ...f, required_docs: [...(f.required_docs ?? []), { key: '', label: '', required: true }] })}>+ Hồ sơ</button></div>
      <div className="field" style={{ gridColumn: '1 / -1' }}><span>Tiêu chí chấm (tổng {total} điểm){f.id && ' — đã có điểm thì không đổi được'}</span>
        {(f.criteria ?? []).map((x, i) => <span key={i} className="tools"><input value={x.label} onChange={e => setCrit(i, { label: e.target.value })} style={{ flex: 1 }} aria-label="Tiêu chí" />
          <input type="number" min={1} value={x.max} onChange={e => setCrit(i, { max: +e.target.value })} style={{ width: 80 }} aria-label="Điểm tối đa" /> điểm
          <button type="button" onClick={() => setF({ ...f, criteria: f.criteria!.filter((_, j) => j !== i) })} aria-label="Bỏ">✕</button></span>)}
        <button type="button" onClick={() => setF({ ...f, criteria: [...(f.criteria ?? []), { key: '', label: '', max: 10 }] })}>+ Tiêu chí</button></div>
      {err && <p className="msg" style={{ gridColumn: '1 / -1' }}>{err}</p>}
      <div className="formactions"><button type="submit">Lưu nháp</button> {(!f.status || f.status === 'draft') && <button type="button" className="primary" onClick={() => save(true)}>Lưu & mở nhận bài</button>} <button type="button" onClick={() => onDone()}>Huỷ</button></div>
    </form>
  )
}

function Manage({ c, reload }: { c: C; reload: () => void }) {
  const [tab, setTab] = useState<'entries' | 'judges'>('entries')
  const [rows, setRows] = useState<R[]>([])
  const [judges, setJudges] = useState<J[]>([])
  const [jf, setJf] = useState({ name: '', email: '', fields: [] as string[] })
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [awards, setAwards] = useState<Record<string, string>>({})
  const [acc, setAcc] = useState<{ full_name: string; login: string | null; password?: string; status: string }[] | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  async function load() {
    const [r, j] = await Promise.all([supabase.rpc('competition_results', { p_comp: c.id }), supabase.from('competition_judges').select('*').eq('competition_id', c.id).order('created_at')])
    if (r.error) setMsg([errText(r.error.message), true])
    const list = (r.data as R[]) ?? []; setRows(list); setJudges((j.data as J[]) ?? [])
    setAwards(Object.fromEntries(list.filter(x => x.award).map(x => [x.entry_id, x.award!])))
  }
  useEffect(() => { load() }, [c.id, c.current_round, c.status])
  const run = async (p: PromiseLike<{ error: { message: string } | null; data?: unknown }>, ok: string) => { const { error } = await p; if (error) return setMsg([errText(error.message), true]); setMsg([ok, false]); load(); reload() }
  const cur = rows.filter(r => r.round === c.current_round && r.status !== 'withdrawn')
  const last = c.current_round >= c.rounds.length
  async function addJudge(e: React.FormEvent) {
    e.preventDefault(); if (!jf.name.trim()) return
    await run(supabase.rpc('competition_add_judge', { p_comp: c.id, p_name: jf.name.trim(), p_email: jf.email.trim() || null, p_fields: jf.fields }), jf.email ? 'Đã thêm giám khảo (nếu email đã có tài khoản thì gắn ngay).' : 'Đã thêm — bấm "Cấp tài khoản" để tạo tài khoản đăng nhập.')
    setJf({ name: '', email: '', fields: [] })
  }
  async function accounts() {
    const ids = judges.filter(j => !j.profile_id).map(j => j.id); if (!ids.length) return
    try { const r = await callAccounts({ action: 'create', kind: 'judge', ids }); setAcc(r.results); load() } catch (e) { setMsg([(e as Error).message, true]) }
  }
  function printSlips() {
    const w = window.open('', '_blank'); if (!w || !acc) return
    w.document.write(`<!doctype html><meta charset="utf-8"><title>Tài khoản giám khảo</title><style>body{font-family:system-ui,Arial;margin:12mm}.s{border:1px dashed #888;padding:10px;margin:0 0 8px;break-inside:avoid}code{font-size:15px}</style>
      ${acc.filter(a => a.password).map(a => `<div class="s"><b>${esc(c.title)}</b><br>Giám khảo: <b>${esc(a.full_name)}</b><br>Địa chỉ: ${esc(location.origin)}<br>Tên đăng nhập: <code>${esc(a.login ?? '')}</code><br>Mật khẩu: <code>${esc(a.password ?? '')}</code><br><small>Lần đầu đăng nhập phải đổi mật khẩu. Vào mục “Chấm thi”.</small></div>`).join('')}
      <script>window.onload=()=>print()<\/script>`); w.document.close()
  }
  function excel() {
    downloadXlsx(`ket-qua-${c.title}`, [{ key: 'c', label: 'Mã bài' }, { key: 'f', label: 'Lĩnh vực', width: 22 }, { key: 't', label: 'Dự án', width: 34 }, { key: 's', label: 'Trường', width: 26 }, { key: 'm', label: 'Học sinh', width: 30 },
      { key: 'v', label: 'Vòng' }, { key: 'j', label: 'Đã chấm' }, { key: 'a', label: 'Điểm TB' }, { key: 'r', label: 'Hạng' }, { key: 'g', label: 'Giải', width: 18 }, { key: 'p', label: 'Lệ phí' }],
      rows.map(r => [r.code, r.field, r.title, r.school, r.members, c.rounds[r.round - 1], `${r.scored}/${r.judges}`, r.avg_total, r.rank_in_field, r.award, FEE[r.fee_status]]), 'Kết quả')
  }
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  return (
    <div className="panel">
      <div className="bar"><b>{c.rounds[c.current_round - 1]} · {cur.length} bài</b>
        <span className="tools">
          {c.status === 'draft' && <button className="primary" onClick={() => run(supabase.from('competitions').update({ status: 'open' }).eq('id', c.id), 'Đã mở nhận bài.')}>Mở nhận bài</button>}
          {c.status === 'open' && <button className="primary" onClick={() => confirm('Đóng nhận bài và bắt đầu chấm?') && run(supabase.from('competitions').update({ status: 'judging' }).eq('id', c.id), 'Đã chuyển sang chấm.')}>Bắt đầu chấm</button>}
          {c.status === 'judging' && <button onClick={() => run(supabase.rpc('competition_auto_assign', { p_comp: c.id, p_per: 2 }), 'Đã phân công (mỗi bài 2 giám khảo cùng lĩnh vực).')}>Phân công tự động</button>}
          {c.status === 'judging' && !last && <button className="primary" disabled={!sel.size} onClick={() => confirm(`Chọn ${sel.size} bài vào ${c.rounds[c.current_round]}? Các bài còn lại dừng ở vòng này.`) && run(supabase.rpc('competition_advance', { p_comp: c.id, p_entries: [...sel] }), 'Đã chuyển vòng.')}>Vào vòng sau ({sel.size})</button>}
          {c.status === 'judging' && last && <button className="primary" onClick={() => confirm('Ghi giải và kết thúc cuộc thi? Học sinh, GV hướng dẫn nhận thông báo.') && run(supabase.rpc('competition_finish', { p_comp: c.id, p_awards: awards }), 'Đã trao giải và kết thúc.')}>Trao giải & kết thúc</button>}
          {c.status === 'finished' && <button onClick={() => printCertificates(c, rows.filter(r => r.award)) || setMsg(['Trình duyệt chặn cửa sổ in.', true])}>In giấy chứng nhận</button>}
          <button onClick={excel}>Xuất Excel</button>
        </span></div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      <Tabs<'entries' | 'judges'> value={tab} onChange={setTab} items={[['entries', 'Bài dự thi', rows.length], ['judges', 'Ban giám khảo', judges.length]]} />
      {tab === 'entries' ? (
        <div className="wrap"><table>
          <thead><tr>{c.status === 'judging' && !last && <th />}<th>Mã</th><th>Dự án</th><th>Trường · học sinh</th><th>Chấm</th><th>Điểm TB</th><th>Hạng</th>{c.status === 'judging' && last && <th>Giải</th>}<th>Lệ phí</th><th>Hồ sơ</th></tr></thead>
          <tbody>{rows.map(r => <tr key={r.entry_id} className={r.status === 'withdrawn' || r.status === 'eliminated' ? 'muted' : ''}>
            {c.status === 'judging' && !last && <td>{r.round === c.current_round && r.status === 'submitted' && <input type="checkbox" checked={sel.has(r.entry_id)} onChange={() => toggle(r.entry_id)} aria-label={'Chọn ' + r.code} />}</td>}
            <td><code>{r.code}</code></td><td><b>{r.title}</b><br /><small>{r.field}{r.status !== 'submitted' ? ' · ' + ES[r.status] : ''}</small></td><td><small>{r.school}<br />{r.members}</small></td>
            <td>{r.scored}/{r.judges}{r.spread != null && r.spread >= 15 && <><br /><span className="plbadge bad" title="Điểm các giám khảo chênh nhau ≥ 15">chênh {r.spread}</span></>}</td>
            <td><b>{r.avg_total ?? '—'}</b></td><td>{r.rank_in_field ?? '—'}</td>
            {c.status === 'judging' && last && <td>{r.status === 'submitted' && <select value={awards[r.entry_id] ?? ''} onChange={e => setAwards({ ...awards, [r.entry_id]: e.target.value })} aria-label="Giải"><option value="">—</option>{AWARDS.map(a => <option key={a}>{a}</option>)}</select>}</td>}
            <td>{r.fee_status === 'none' ? '—' : <select value={r.fee_status} onChange={e => run(supabase.from('competition_entries').update({ fee_status: e.target.value }).eq('id', r.entry_id), 'Đã cập nhật lệ phí.')} aria-label="Lệ phí">
              {['unpaid', 'paid', 'waived'].map(k => <option key={k} value={k}>{FEE[k]}</option>)}</select>}</td>
            <td><small>{Object.entries(r.docs).filter(([, u]) => u).map(([k, u]) => <a key={k} href={u} target="_blank" rel="noreferrer noopener" style={{ display: 'block' }}>🔗 {c.required_docs.find(d => d.key === k)?.label ?? k}</a>)}</small></td></tr>)}
            {!rows.length && <tr><td colSpan={10}>Chưa có bài dự thi.</td></tr>}</tbody>
        </table></div>
      ) : (<>
        <form className="formgrid" onSubmit={addJudge} style={{ marginTop: 8 }}>
          <label className="field"><span>Họ tên giám khảo</span><input value={jf.name} onChange={e => setJf({ ...jf, name: e.target.value })} /></label>
          <label className="field"><span>Email (nếu đã có tài khoản trên hệ thống)</span><input type="email" value={jf.email} onChange={e => setJf({ ...jf, email: e.target.value })} placeholder="trống = chuyên gia ngoài, cấp tài khoản mã" /></label>
          {c.fields.length > 0 && <label className="field"><span>Chấm lĩnh vực</span><select multiple value={jf.fields} onChange={e => setJf({ ...jf, fields: Array.from(e.target.selectedOptions, o => o.value) })} style={{ minHeight: 80 }}>{c.fields.map(x => <option key={x}>{x}</option>)}</select><small className="sub">không chọn = mọi lĩnh vực</small></label>}
          <div className="formactions"><button className="primary" type="submit">+ Thêm giám khảo</button>{judges.some(j => !j.profile_id) && <button type="button" onClick={accounts}>Cấp tài khoản cho giám khảo chưa có ({judges.filter(j => !j.profile_id).length})</button>}</div>
        </form>
        {acc && <div className="panel"><div className="bar"><b>Tài khoản giám khảo — mật khẩu chỉ hiện lần này</b><span className="tools">{acc.some(a => a.password) && <button className="primary" onClick={printSlips}>In phiếu</button>}<button onClick={() => setAcc(null)}>Đóng</button></span></div>
          <table><tbody>{acc.map((a, i) => <tr key={i}><td>{a.full_name}</td><td><code>{a.login}</code></td><td><code>{a.password ?? ''}</code></td><td><small>{a.status}</small></td></tr>)}</tbody></table></div>}
        <div className="wrap"><table><thead><tr><th>Giám khảo</th><th>Lĩnh vực</th><th>Tài khoản</th><th /></tr></thead>
          <tbody>{judges.map(j => <tr key={j.id}><td><b>{j.full_name}</b>{j.email && <><br /><small>{j.email}</small></>}</td><td><small>{j.fields.length ? j.fields.join(', ') : 'Mọi lĩnh vực'}</small></td>
            <td>{j.profile_id ? <span className="plbadge ok">Đã có</span> : <span className="plbadge mute">Chưa</span>}</td>
            <td><button onClick={() => confirm(`Bỏ giám khảo ${j.full_name}?`) && run(supabase.from('competition_judges').delete().eq('id', j.id), 'Đã bỏ giám khảo.')}>Bỏ</button></td></tr>)}
            {!judges.length && <tr><td colSpan={4}>Chưa có giám khảo.</td></tr>}</tbody></table></div>
      </>)}
    </div>
  )
}

function Submit({ c, orgId, teacherId }: { c: C; orgId: string; teacherId?: string | null }) {
  const [projects, setProjects] = useState<{ id: string; title: string; field: string | null; abstract: string | null; links: { label: string; url: string }[]; mentor_teacher_id: string | null; project_members: { student_id: string }[] }[]>([])
  const [mine, setMine] = useState<E[]>([])
  const [f, setF] = useState<{ project: string; field: string; docs: Record<string, string> }>({ project: '', field: '', docs: {} })
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  async function load() {
    const [p, e] = await Promise.all([
      supabase.from('student_projects').select('id, title, field, abstract, links, mentor_teacher_id, project_members(student_id)').eq('org_id', orgId).in('status', ['approved', 'completed']).order('title'),
      supabase.from('competition_entries').select('*, student_projects(title)').eq('competition_id', c.id).eq('school_id', orgId),
    ])
    setProjects((p.data as any[]) ?? []); setMine((e.data as unknown as E[]) ?? [])
  }
  useEffect(() => { load() }, [c.id])
  const p = projects.find(x => x.id === f.project)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (!p) return
    const { error } = await supabase.rpc('competition_submit', { p_comp: c.id, p_project: p.id, p_field: f.field || null, p_docs: f.docs })
    if (error) return setMsg([errText(error.message), true]); setMsg(['Đã nộp bài dự thi.' + (c.fee ? ` Lệ phí ${money(c.fee)} — nộp theo hướng dẫn của ban tổ chức.` : ''), false]); setF({ project: '', field: '', docs: {} }); load()
  }
  async function withdraw(x: E) {
    if (!confirm('Rút bài dự thi này?')) return
    const { error } = await supabase.rpc('competition_withdraw', { p_entry: x.id })
    if (error) return setMsg([errText(error.message), true]); load()
  }
  const editable = (x: E) => c.status === 'open' && x.status === 'submitted'
  return (
    <div className="panel">
      <b>Bài dự thi của trường</b>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      <div className="wrap"><table><tbody>{mine.map(x => <tr key={x.id}><td><code>{x.code}</code></td><td><b>{x.student_projects?.title}</b><br /><small>{x.field}</small></td>
        <td>{x.award ? <b className="good">🏆 {x.award}</b> : ES[x.status]}{x.round > 1 ? ` · ${c.rounds[x.round - 1]}` : ''}</td><td>{x.fee_status !== 'none' && <small>Lệ phí: {FEE[x.fee_status]}</small>}</td>
        <td className="nowrap">{editable(x) && <><button onClick={() => { const pr = projects.find(y => y.id === x.project_id); setF({ project: x.project_id, field: x.field ?? '', docs: x.docs }); if (!pr) setMsg(['Dự án không còn ở trạng thái đã duyệt.', true]) }}>Sửa hồ sơ</button> <button onClick={() => withdraw(x)}>Rút</button></>}</td></tr>)}
        {!mine.length && <tr><td>Trường chưa nộp bài.</td></tr>}</tbody></table></div>
      {c.status === 'open' && (
        <form className="formgrid" onSubmit={submit} style={{ marginTop: 10 }}>
          <label className="field"><span>Dự án (đã được trường duyệt)</span><select value={f.project} onChange={e => { const x = projects.find(y => y.id === e.target.value); setF({ project: e.target.value, field: c.fields.includes(x?.field ?? '') ? x!.field! : '', docs: f.docs }) }}>
            <option value="">— chọn dự án —</option>{projects.map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label>
          {c.fields.length > 0 && <label className="field"><span>Lĩnh vực dự thi</span><select value={f.field} onChange={e => setF({ ...f, field: e.target.value })}><option value="">—</option>{c.fields.map(x => <option key={x}>{x}</option>)}</select></label>}
          {p && <p className="sub" style={{ gridColumn: '1 / -1', margin: 0 }}>{p.project_members.length} học sinh (tối đa {c.max_members}) · tóm tắt {words(p.abstract)} từ{c.abstract_words ? ` (tối đa ${c.abstract_words})` : ''}
            {p.links.length > 0 && <> · tài liệu dự án: {p.links.map((l, i) => <a key={i} href={l.url} target="_blank" rel="noreferrer noopener" style={{ marginLeft: 6 }}>{l.label}</a>)}</>}</p>}
          {c.required_docs.map(d => <label key={d.key} className="field" style={{ gridColumn: '1 / -1' }}><span>{d.label}{d.required ? ' *' : ''}</span>
            <input value={f.docs[d.key] ?? ''} onChange={e => setF({ ...f, docs: { ...f.docs, [d.key]: e.target.value } })} placeholder="https://drive.google.com/… hoặc https://youtu.be/…" /></label>)}
          <div className="formactions"><button className="primary" type="submit" disabled={!p}>Nộp bài dự thi</button></div>
        </form>
      )}
    </div>
  )
}

export function CompetitionsPage({ orgId, teacherId, platform = false }: { orgId: string | null; teacherId?: string | null; platform?: boolean }) {
  const [rows, setRows] = useState<C[]>([])
  const [form, setForm] = useState<Partial<C> | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [orgType, setOrgType] = useState('')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [tab, setTab] = useState<'now' | 'done'>('now')
  async function load() {
    const [c, o, e] = await Promise.all([
      supabase.from('competitions').select('*, organizations(name, type)').order('created_at', { ascending: false }),
      orgId ? supabase.from('organizations').select('type').eq('id', orgId).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from('competition_entries').select('competition_id').neq('status', 'withdrawn'),
    ])
    if (c.error) setMsg([errText(c.error.message), true])
    setRows((c.data as C[]) ?? []); setOrgType(((o as any).data?.type as string) ?? '')
    const m: Record<string, number> = {}; (((e as any).data as { competition_id: string }[]) ?? []).forEach(x => (m[x.competition_id] = (m[x.competition_id] ?? 0) + 1)); setCounts(m)
  }
  useEffect(() => { load() }, [])
  const manageable = (c: C) => platform || c.org_id === orgId
  const shown = rows.filter(c => (tab === 'now' ? !['finished', 'cancelled'].includes(c.status) : ['finished', 'cancelled'].includes(c.status)))
  const cur = rows.find(c => c.id === open)
  return (
    <>
      <div className="bar">
        <Tabs<'now' | 'done'> value={tab} onChange={setTab} items={[['now', 'Đang diễn ra', rows.filter(c => !['finished', 'cancelled'].includes(c.status)).length], ['done', 'Đã kết thúc', rows.filter(c => ['finished', 'cancelled'].includes(c.status)).length]]} />
        {orgId && <button className="primary" onClick={() => { setOpen(null); setForm({ template: 'khkt', ...{ fields: TEMPLATES.khkt.fields, required_docs: TEMPLATES.khkt.docs, criteria: TEMPLATES.khkt.criteria, max_members: 2, abstract_words: 250, grades: ['thcs', 'thpt'] } }) }}>+ Tổ chức cuộc thi</button>}
      </div>
      <p className="sub">Đơn vị tổ chức quyết định cấp cuộc thi ({ORG_LEVEL[orgType] ?? 'theo đơn vị'}). Trường nộp dự án đã duyệt ở mục <i>Dự án STEM</i>; hồ sơ nộp dạng đường link.</p>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      {form && orgId && <Editor c={form} orgId={orgId} onDone={m => { setForm(null); if (m) setMsg([m, false]); load() }} />}
      <div className="wrap"><table>
        <thead><tr><th>Cuộc thi</th><th>Đơn vị tổ chức</th><th>Hạn nộp</th><th>Bài</th><th>Trạng thái</th><th /></tr></thead>
        <tbody>{shown.map(c => <tr key={c.id} className={c.id === open ? 'on' : ''}><td><b>{c.title}</b><br /><small>{TEMPLATES[c.template]?.label ?? c.template} · {c.rounds.length} vòng · {money(c.fee)}{c.anonymous ? ' · chấm ẩn danh' : ''}</small></td>
          <td><small>{c.organizations?.name}<br />{ORG_LEVEL[c.organizations?.type ?? ''] ?? ''}</small></td><td className="nowrap">{day(c.submit_until)}</td><td>{counts[c.id] ?? 0}</td>
          <td><span className={'plbadge ' + ST[c.status][1]}>{ST[c.status][0]}</span>{c.status === 'judging' && <><br /><small>{c.rounds[c.current_round - 1]}</small></>}</td>
          <td className="nowrap"><button onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'Đóng' : manageable(c) ? 'Quản lý' : 'Xem / nộp bài'}</button>
            {manageable(c) && ['draft', 'open'].includes(c.status) && <> <button onClick={() => { setOpen(null); setForm(c) }}>Sửa</button></>}</td></tr>)}
          {!shown.length && <tr><td colSpan={6}>Chưa có cuộc thi.</td></tr>}</tbody>
      </table></div>
      {cur && <>
        <div className="panel"><h3 style={{ marginTop: 0 }}>{cur.title}</h3>{cur.description && <p style={{ whiteSpace: 'pre-line' }}>{cur.description}</p>}
          <p className="sub" style={{ margin: 0 }}>Nhận bài {day(cur.submit_from)} → {day(cur.submit_until)} · tối đa {cur.max_members} HS/dự án{cur.max_per_school ? ` · ${cur.max_per_school} dự án/trường` : ''} · {cur.grades.length ? cur.grades.map(g => LEVEL[g]).join(', ') : 'mọi cấp học'}
            · Vòng: {cur.rounds.join(' → ')} · Tiêu chí: {cur.criteria.map(x => `${x.label} (${x.max})`).join('; ')}</p></div>
        {manageable(cur) && <Manage c={cur} reload={load} />}{orgType === 'school' && orgId && !platform && <Submit c={cur} orgId={orgId} teacherId={teacherId} />}
      </>}
    </>
  )
}
