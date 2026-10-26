// Cổng giáo viên › Đăng ký tập huấn (098). GV xem kế hoạch đang mở đăng ký của trường, chọn nội dung muốn học,
// đề nghị miễn nội dung đã đạt ở kế hoạch trước. Hệ thống kiểm tra hạn, tiên quyết, chỉ tiêu, trùng lịch trước khi gửi.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ElView } from '../../components/ElView'
import { Chip } from '../dist/Editor'
import { NoTeacher, type TProps } from './common'

type Row = { plan_id: string; plan_code: string | null; name: string; org_name: string | null; year_name: string | null; starts_on: string | null; ends_on: string | null
  mode: string; provider: string | null; register_until: string | null; programs: string | null; hours: number | null; quota: number | null; taken: number
  list_status: string; reg_status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | null; reg_reason: string | null; reg_units: string[] | null
  reg_exempt: string[] | null; reg_warnings: string[] | null; reg_at: string | null; enrolled: boolean }
type U = { unit_id: string; ord: number; program_title: string; subject: string; title: string; hours: number; mode: string | null; passed: boolean; trainer: string | null }
type Check = { errors: string[]; warnings: string[] }
const MODE: Record<string, string> = { online: 'Trực tuyến', offline: 'Trực tiếp', hybrid: 'Kết hợp' }
const day = (d: string | null) => d ? new Date(d + 'T00:00').toLocaleDateString('vi-VN') : ''
const num = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')
const today = () => { const d = new Date(); return new Date(+d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) }
const errText = (m: string) => /schema cache|does not exist|function .* not found/i.test(m) ? 'Hãy chạy migration 098 trên Supabase.' : m

function status(r: Row): [string, string] {
  if (r.enrolled) return r.list_status === 'approved' ? ['Được duyệt tham gia', 'good'] : ['Có tên trong danh sách trường', 'good']
  if (r.reg_status === 'pending') return ['Chờ trường xét', 'warn']
  if (r.reg_status === 'rejected') return ['Không được nhận', 'bad']
  if (r.reg_status === 'cancelled') return ['Đã huỷ đăng ký', '']
  return ['Chưa đăng ký', '']
}
const isOpen = (r: Row) => (!r.register_until || r.register_until >= today()) && (r.list_status === 'assigned' || r.list_status === 'returned')

export function TeacherTrainingRegister({ teacherId }: TProps) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const load = () => supabase.rpc('training_open_plans').then(({ data, error }) => {
    if (error) { setErr(errText(error.message)); setRows([]) } else setRows((data as Row[]) ?? [])
  })
  useEffect(() => { if (teacherId) load() }, [teacherId])
  if (!teacherId) return <NoTeacher />
  const cur = open ? rows?.find(r => r.plan_id === open) : undefined
  if (cur) return <RegisterView r={cur} onBack={() => setOpen(null)} onDone={m => { setOpen(null); setOk(m); load() }} />
  if (!rows) return err ? <p className="msg">{err}</p> : <p className="sub">Đang tải…</p>
  const n = (f: (r: Row) => boolean) => rows.filter(f).length
  async function cancel(r: Row) {
    if (!confirm(`Huỷ đăng ký "${r.name}"?`)) return
    const { error } = await supabase.rpc('training_register_cancel', { p_plan: r.plan_id })
    if (error) setErr(errText(error.message)); else { setErr(''); setOk('Đã huỷ đăng ký.') }
    load()
  }
  return <>
    <div className="cards">
      <div className="card"><strong>{n(r => isOpen(r) && !r.enrolled && r.reg_status !== 'pending')}</strong><span>Đang mở, chưa đăng ký</span></div>
      <div className="card"><strong>{n(r => r.reg_status === 'pending')}</strong><span>Chờ trường xét</span></div>
      <div className="card"><strong>{n(r => r.enrolled)}</strong><span>Có tên tham gia</span></div>
    </div>
    {ok && <p className="sub" role="status"><b>{ok}</b></p>}
    {err && <p className="msg" role="alert">{err}</p>}
    <div className="wrap" style={{ marginTop: 14 }}><table>
      <thead><tr><th>Kế hoạch tập huấn</th><th>Thời gian</th><th>Hạn đăng ký</th><th>Chỉ tiêu trường</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody>{rows.map(r => { const [st, tone] = status(r), can = isOpen(r) && !r.enrolled
        return <tr key={r.plan_id}>
          <td style={{ whiteSpace: 'normal' }}><b>{r.name}</b><br /><small>{[r.plan_code, r.org_name, r.programs].filter(Boolean).join(' · ')}</small>
            {r.hours ? <><br /><small className="sub">{num(Number(r.hours))} giờ · {MODE[r.mode] ?? r.mode}</small></> : null}</td>
          <td>{[day(r.starts_on), day(r.ends_on)].filter(Boolean).join(' – ') || '—'}</td>
          <td>{r.register_until ? day(r.register_until) : '—'}{r.register_until && r.register_until < today() && <><br /><small className="sub">Đã hết hạn</small></>}</td>
          <td>{r.quota != null ? `${r.taken}/${r.quota}` : `${r.taken} GV`}</td>
          <td><Chip tone={tone}>{st}</Chip>{r.reg_status === 'rejected' && r.reg_reason && !r.enrolled && <><br /><small className="sub">Lý do: {r.reg_reason}</small></>}</td>
          <td style={{ whiteSpace: 'nowrap' }}>
            {can && r.reg_status !== 'pending' && <button type="button" className="primary" onClick={() => { setOk(''); setOpen(r.plan_id) }}>{r.reg_status ? 'Đăng ký lại' : 'Đăng ký'}</button>}
            {can && r.reg_status === 'pending' && <><button type="button" onClick={() => { setOk(''); setOpen(r.plan_id) }}>Sửa</button> <button type="button" onClick={() => cancel(r)}>Huỷ</button></>}
            {!can && !r.enrolled && <small className="sub">{r.list_status === 'submitted' || r.list_status === 'approved' ? 'Trường đã gửi danh sách' : 'Hết hạn đăng ký'}</small>}
          </td>
        </tr> })}
        {!rows.length && <tr><td colSpan={6}>Chưa có kế hoạch tập huấn nào mở cho giáo viên tự đăng ký.</td></tr>}</tbody>
    </table></div>
    <p className="sub" style={{ marginTop: 10 }}>Chọn nội dung muốn học rồi gửi đăng ký. Trường xét và nhận hoặc từ chối (kèm lý do), bạn nhận thông báo ở chuông. Danh sách của trường sau đó được gửi lên đơn vị tổ chức duyệt.</p>
  </>
}

function RegisterView({ r, onBack, onDone }: { r: Row; onBack: () => void; onDone: (m: string) => void }) {
  const [units, setUnits] = useState<U[] | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [ex, setEx] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [chk, setChk] = useState<Check | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.rpc('training_register_units', { p_plan: r.plan_id }).then(({ data, error }) => {
      if (error) return setErr(errText(error.message))
      const us = (data as U[]) ?? []; setUnits(us)
      const pend = r.reg_status === 'pending'
      setSel(new Set(pend && r.reg_units ? r.reg_units : us.map(u => u.unit_id)))
      // Mặc định đề nghị miễn nội dung đã đạt
      setEx(new Set(pend ? r.reg_exempt ?? [] : us.filter(u => u.passed).map(u => u.unit_id)))
    })
  }, [r.plan_id])
  const pick = useMemo(() => units ? units.filter(u => sel.has(u.unit_id)).map(u => u.unit_id) : [], [units, sel])
  const exempt = pick.filter(id => ex.has(id))
  const learn = units?.filter(u => sel.has(u.unit_id) && !ex.has(u.unit_id)) ?? []
  const all = units && pick.length === units.length
  // Kiểm tra lại mỗi khi đổi lựa chọn
  useEffect(() => {
    if (!units) return
    const t = setTimeout(() => supabase.rpc('training_register_check', { p_plan: r.plan_id, p_units: all ? null : pick, p_exempt: exempt })
      .then(({ data, error }) => { if (error) setErr(errText(error.message)); else setChk(data as Check) }), 250)
    return () => clearTimeout(t)
  }, [units, pick.join(','), exempt.join(',')])
  async function send() {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('training_register', { p_plan: r.plan_id, p_units: all ? null : pick, p_exempt: exempt, p_note: note.trim() || null })
    setBusy(false)
    if (error) return setErr(errText(error.message))
    onDone(`Đã gửi đăng ký "${r.name}" (${learn.length} nội dung). Trường sẽ xét và báo lại cho bạn.`)
  }
  const groups = useMemo(() => { const m = new Map<string, U[]>(); (units ?? []).forEach(u => { const k = u.program_title + ' › ' + u.subject; m.set(k, [...(m.get(k) ?? []), u]) }); return [...m] }, [units])
  const hours = learn.reduce((a, u) => a + Number(u.hours || 0), 0)
  const blocked = !chk || chk.errors.length > 0 || !learn.length
  return <ElView back="Đăng ký tập huấn" onBack={onBack} title={r.name}
    sub={<>{[r.plan_code, r.org_name, [day(r.starts_on), day(r.ends_on)].filter(Boolean).join(' – '), r.register_until && `hạn đăng ký ${day(r.register_until)}`].filter(Boolean).join(' · ')}</>}
    actions={<button type="button" className="primary" disabled={busy || blocked} onClick={send}>{r.reg_status === 'pending' ? 'Lưu đăng ký' : 'Gửi đăng ký'}</button>}>
    {err && <p className="msg">{err}</p>}
    {chk && chk.errors.length > 0 && <div className="panel" role="alert" style={{ display: 'grid', gap: 4 }}><b>Chưa đăng ký được</b>
      {chk.errors.map((e, k) => <span key={k} className="warnline">{e}</span>)}</div>}
    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Nội dung muốn học</h3>
        <small className="sub">{learn.length}/{units?.length ?? 0} nội dung · {num(hours)} giờ{exempt.length ? ` · đề nghị miễn ${exempt.length}` : ''}</small></div>
      {!units ? <p className="sub">Đang tải…</p> : <div className="tpunittree">
        {groups.map(([g, us]) => <fieldset key={g}>
          <legend><b>{g}</b></legend>
          {us.map(u => <div key={u.unit_id} className="tpunit regunit">
            <label><input type="checkbox" checked={sel.has(u.unit_id)} onChange={e => setSel(o => { const x = new Set(o); if (e.target.checked) x.add(u.unit_id); else x.delete(u.unit_id); return x })} />
              <span>{u.title}</span></label>
            <small className="sub">{num(Number(u.hours))} giờ{u.trainer ? ` · ${u.trainer}` : ''}</small>
            {u.passed && <label className="regex"><input type="checkbox" disabled={!sel.has(u.unit_id)} checked={ex.has(u.unit_id)}
              onChange={e => setEx(o => { const x = new Set(o); if (e.target.checked) x.add(u.unit_id); else x.delete(u.unit_id); return x })} /> Đã đạt trước đây · đề nghị miễn</label>}
          </div>)}
        </fieldset>)}
        {!units.length && <small className="sub">Kế hoạch chưa có nội dung.</small>}
      </div>}
      {chk && chk.warnings.length > 0 && <div style={{ display: 'grid', gap: 2 }}><b>Lưu ý trùng lịch</b>
        {chk.warnings.map((w, k) => <small key={k} className="warnline">{w}</small>)}
        <small className="sub">Vẫn gửi được; trường sẽ thấy các lưu ý này khi xét.</small></div>}
      <label className="field"><span>Ghi chú cho trường</span><textarea rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="VD: Em muốn học phần Robotics để dạy CLB" /></label>
    </section>
  </ElView>
}
