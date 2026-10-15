import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ProgChips } from '../components/Chips'

type Entry = { id: string; weekday: number; subject: string; teacher_id: string | null; class_id: string; period_configs: { name: string } | null; classes: { name: string } | null; teachers: { full_name: string } | null }
type Teacher = { id: string; full_name: string; subject: string | null }
const PROGRAMS = ['CT1', 'CT2', 'CT3', 'CT4', 'CT5']

export default function StemAssign({ orgId }: { orgId: string }) {
  const [tab, setTab] = useState<'slots' | 'programs'>('slots')
  const [entries, setEntries] = useState<Entry[]>([])
  const [teachers, setTeachers] = useState<Teacher[]>([])
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [links, setLinks] = useState<{ teacher_id: string; program: string }[]>([])
  const [cls, setCls] = useState(''); const [slot, setSlot] = useState<string | null>(null); const [pick, setPick] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const [e, t, c, l] = await Promise.all([
      supabase.from('timetable_entries').select('id, weekday, subject, teacher_id, class_id, period_configs(name), classes(name), teachers(full_name)').eq('kind', 'stem'),
      supabase.from('teachers').select('id, full_name, subject').order('full_name'),
      supabase.from('classes').select('id, name').order('name'),
      supabase.from('stem_teacher_programs').select('teacher_id, program'),
    ])
    setEntries((e.data as unknown as Entry[]) ?? []); setTeachers((t.data as Teacher[]) ?? []); setClasses((c.data as any) ?? []); setLinks((l.data as any) ?? [])
  }
  useEffect(() => { load() }, [])

  const shown = entries.filter(e => !cls || e.class_id === cls)
  async function assign() {
    if (!slot) return
    const { error } = await supabase.from('timetable_entries').update({ teacher_id: pick || null }).eq('id', slot)
    if (error) return setErr(error.message.includes('teacher_id_weekday') ? 'Giáo viên này đã có tiết khác ở cùng khung giờ.' : error.message)
    setErr(''); setSlot(null); setPick(''); load()
  }
  const has = (id: string, p: string) => links.some(l => l.teacher_id === id && l.program === p)
  async function toggle(id: string, p: string) {
    if (has(id, p)) { setLinks(links.filter(l => !(l.teacher_id === id && l.program === p))); await supabase.from('stem_teacher_programs').delete().eq('teacher_id', id).eq('program', p) }
    else { setLinks([...links, { teacher_id: id, program: p }]); await supabase.from('stem_teacher_programs').insert({ org_id: orgId, teacher_id: id, program: p }) }
  }
  const none = teachers.filter(t => !links.some(l => l.teacher_id === t.id))

  return (
    <>
      <div className="bar"><div className="segmented"><button className={tab === 'slots' ? 'on' : ''} onClick={() => setTab('slots')}>Gán vào tiết STEM</button><button className={tab === 'programs' ? 'on' : ''} onClick={() => setTab('programs')}>Theo chương trình CT1–CT5</button></div>
        {tab === 'slots' && <select value={cls} onChange={e => setCls(e.target.value)} aria-label="Lớp"><option value="">Tất cả lớp</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</div>
      <p className="sub">{tab === 'slots' ? 'Chọn lớp, chọn tiết STEM rồi phân công giáo viên phụ trách.' : 'Chọn chương trình mỗi giáo viên đảm nhận.'}</p>
      {tab === 'slots' ? (
        <div className="twocol">
          <div className="panel"><h3>Chọn tiết STEM</h3>
            {shown.length === 0 && <small>Chưa có tiết STEM nào. Hãy xếp tiết STEM ở Thời khóa biểu trước.</small>}
            {shown.map(e => <button key={e.id} className={'todo' + (slot === e.id ? ' hi' : '')} onClick={() => { setSlot(e.id); setPick(e.teacher_id ?? '') }}>
              <span><b>{e.classes?.name}</b> · Thứ {e.weekday} · {e.period_configs?.name}<br /><small>{e.subject} — {e.teachers?.full_name ?? 'Chưa gán giáo viên'}</small></span></button>)}</div>
          <div className="panel"><div className="bar"><h3>Giáo viên ({teachers.length})</h3><button className="primary" onClick={assign} disabled={!slot}>Gán</button></div>
            {err && <p className="msg">{err}</p>}
            {!slot && <small>Chọn một tiết STEM ở bên trái.</small>}
            {slot && teachers.map(t => <label className="roomrow" key={t.id}><span><b>{t.full_name}</b><br /><small>{t.subject}</small></span><input type="radio" name="t" checked={pick === t.id} onChange={() => setPick(t.id)} /></label>)}
            {slot && <label className="roomrow"><span><small>Bỏ gán giáo viên</small></span><input type="radio" name="t" checked={pick === ''} onChange={() => setPick('')} /></label>}</div>
        </div>
      ) : (<>
        {none.length > 0 && <div className="panel warnbox">{none.length} giáo viên chưa đảm nhận chương trình nào: {none.map(t => t.full_name).join(', ')}</div>}
        <table><thead><tr><th>Giáo viên</th>{PROGRAMS.map(p => <th key={p}><ProgChips programs={p} /></th>)}</tr></thead><tbody>
          {teachers.map(t => <tr key={t.id}><td><b>{t.full_name}</b><br /><small>{t.subject}</small></td>
            {PROGRAMS.map(p => <td key={p}><input type="checkbox" checked={has(t.id, p)} onChange={() => toggle(t.id, p)} aria-label={`${t.full_name} dạy ${p}`} /></td>)}</tr>)}</tbody></table>
      </>)}
    </>
  )
}
