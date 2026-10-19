import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import FormPanel from '../components/FormPanel'
import ImportExcel from '../components/ImportExcel'
import { norm, importSummary, type Column } from '../lib/sheet'
import { StatusPill, StepTrail, useLatestRequests, approvalError } from './approvals/common'

const COLS: Column[] = [
  { key: 'teacher', label: 'Giáo viên', aliases: ['Họ tên', 'Họ tên giáo viên'], required: true, width: 26 },
  { key: 'subject', label: 'Môn', aliases: ['Môn học', 'Bộ môn'], required: true },
  { key: 'grade', label: 'Khối', required: true },
  { key: 'periods', label: 'Số tiết STEM', aliases: ['Tiết STEM'] },
]

type Plan = { id: string; teacher_id: string; subject: string; grade: number; stem_periods: number; status: string; teachers: { full_name: string } | null }
type Reg = { status: string; teacher_id: string; classes: { grade: number } | null; topic: string; on_date: string }

export default function EduPlan({ orgId }: { orgId: string }) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [regs, setRegs] = useState<Reg[]>([])
  const [teachers, setTeachers] = useState<{ id: string; full_name: string; subject: string | null }[]>([])
  const [filter, setFilter] = useState('')
  const [form, setForm] = useState<Plan | 'new' | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  async function load() {
    const [p, r, t] = await Promise.all([
      supabase.from('education_plans').select('id, teacher_id, subject, grade, stem_periods, status, teachers(full_name)').order('grade'),
      supabase.from('stem_registrations').select('status, teacher_id, topic, on_date, classes(grade)'),
      supabase.from('teachers').select('id, full_name, subject').order('full_name'),
    ])
    setPlans((p.data as unknown as Plan[]) ?? []); setRegs((r.data as unknown as Reg[]) ?? []); setTeachers((t.data as any) ?? [])
  }
  useEffect(() => { load() }, [])

  const { map: reqs, reload: reloadReqs } = useLatestRequests('education_plans', plans.map(p => p.id))
  async function submit(list: Plan[]) {
    const ids = list.filter(p => p.status === 'draft' || p.status === 'rejected').map(p => p.id)
    if (!ids.length) return
    const { error } = await supabase.from('education_plans').update({ status: 'pending' }).in('id', ids)
    setMsg(error ? approvalError(error.message) : `Đã gửi duyệt ${ids.length} kế hoạch. Theo dõi ở cột Trạng thái hoặc Hộp phê duyệt.`)
    await load(); reloadReqs()
  }
  const pend = (p: Plan) => regs.filter(r => r.teacher_id === p.teacher_id && r.classes?.grade === p.grade && r.status === 'pending')
  async function save(v: Record<string, string>) {
    const body = { teacher_id: v.teacher_id, subject: v.subject, grade: Number(v.grade), stem_periods: Number(v.stem_periods || 0) }
    const { error } = form && form !== 'new' ? await supabase.from('education_plans').update(body).eq('id', form.id) : await supabase.from('education_plans').insert({ ...body, org_id: orgId })
    if (error) return error.message
    setForm(null); load()
  }
  async function remove(p: Plan) { if (confirm(`Xoá kế hoạch của ${p.teachers?.full_name} (${p.subject} · Khối ${p.grade})?`)) { await supabase.from('education_plans').delete().eq('id', p.id); load() } }
  async function importRecords(recs: (Record<string, string> & { _line: number })[]) {
    const byName = new Map(teachers.map(t => [norm(t.full_name), t.id])); const bad: string[] = []
    const list = recs.flatMap(r => {
      const tid = byName.get(norm(r.teacher)); const grade = Number(r.grade.replace(/\D/g, ''))
      if (!tid) { bad.push(`dòng ${r._line}: không có GV "${r.teacher}"`); return [] }
      if (!r.subject || !grade) { bad.push(`dòng ${r._line}: thiếu môn hoặc khối`); return [] }
      return [{ org_id: orgId, teacher_id: tid, subject: r.subject, grade, stem_periods: Number(r.periods) || 0 }]
    })
    if (list.length) { const { error } = await supabase.from('education_plans').insert(list); if (error) return 'Không nhập được: ' + error.message }
    load(); return importSummary(list.length, 'kế hoạch', bad)
  }

  const shown = plans.filter(p => !filter || p.teacher_id === filter)
  const tIds = new Set(plans.map(p => p.teacher_id))
  return (
    <>
      <div className="cards">
        <div className="card"><strong>{tIds.size}</strong><span>Giáo viên</span></div>
        <div className="card"><strong>{plans.length}</strong><span>Bản kế hoạch</span></div>
        <div className="card"><strong>{regs.filter(r => r.status === 'pending').length}</strong><span>Đăng ký chờ duyệt</span></div>
        <div className="card"><strong>{regs.filter(r => r.status === 'approved').length}</strong><span>Đăng ký đã duyệt</span></div>
      </div>
      <div className="bar" style={{ margin: '16px 0' }}>
        <div className="tools"><small style={{ alignSelf: 'center' }}>Giáo viên:</small>
          <select value={filter} onChange={e => setFilter(e.target.value)}><option value="">Tất cả ({tIds.size})</option>{teachers.filter(t => tIds.has(t.id)).map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></div>
        <div className="tools"><ImportExcel columns={COLS} template="mau-ke-hoach-giao-duc" sample={[[teachers[0]?.full_name ?? 'Nguyễn Văn A', 'Toán', '9', '4']]} onRecords={importRecords} onMessage={setMsg} />
          {shown.some(p => p.status === 'draft') && <button onClick={() => submit(shown)}>Gửi duyệt {shown.filter(p => p.status === 'draft').length} bản nháp</button>}
          <button className="primary" onClick={() => setForm('new')}>Lập kế hoạch cho GV</button></div>
      </div>
      {msg && <p className="sub"><b>{msg}</b></p>}
      {form && <FormPanel fields={[
        { key: 'teacher_id', label: 'Giáo viên', type: 'select', required: true, options: teachers.map(t => ({ value: t.id, label: t.full_name })) },
        { key: 'subject', label: 'Môn', required: true }, { key: 'grade', label: 'Khối', type: 'number', required: true }, { key: 'stem_periods', label: 'Số tiết STEM', type: 'number' },
      ]} initial={form === 'new' ? undefined : { teacher_id: form.teacher_id, subject: form.subject, grade: String(form.grade), stem_periods: String(form.stem_periods) }} onSubmit={save} onCancel={() => setForm(null)} />}
      <table>
        <thead><tr><th>Giáo viên</th><th>Môn · Khối</th><th>Số tiết STEM</th><th>Trạng thái</th><th>Đăng ký chờ duyệt</th><th></th></tr></thead>
        <tbody>
          {shown.map(p => (<Fragment key={p.id}>
            <tr key={p.id}><td><b>{p.teachers?.full_name}</b></td><td>{p.subject} · Khối {p.grade}</td><td style={{ color: p.stem_periods ? 'var(--ok)' : undefined }}>{p.stem_periods}</td><td><StatusPill status={p.status} />{p.status === 'pending' && reqs.get(p.id) && <small className="sub"> bước {reqs.get(p.id)!.current_step}/{reqs.get(p.id)!.steps.length}</small>}</td>
              <td style={{ color: pend(p).length ? 'var(--orange)' : undefined }}>{pend(p).length}</td>
              <td>{(p.status === 'draft' || p.status === 'rejected') && <><button className="primary" onClick={() => submit([p])}>{p.status === 'rejected' ? 'Gửi lại' : 'Gửi duyệt'}</button> </>}<button onClick={() => setOpen(open === p.id ? null : p.id)}>Xem</button> <button onClick={() => setForm(p)}>Sửa</button> <button onClick={() => remove(p)}>Xoá</button></td></tr>
            {open === p.id && <tr key={p.id + 'o'}><td colSpan={6}>{reqs.get(p.id) && <StepTrail req={reqs.get(p.id)!} />}{pend(p).length ? pend(p).map((r, i) => <div key={i}>• {r.topic} · {new Date(r.on_date).toLocaleDateString('vi-VN')}</div>) : <small>Không có đăng ký chờ duyệt cho khối này.</small>}</td></tr>}
          </Fragment>))}
          {shown.length === 0 && <tr><td colSpan={6}>Chưa có kế hoạch nào.</td></tr>}
        </tbody>
      </table>
    </>
  )
}
