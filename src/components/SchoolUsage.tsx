// Một trường đang dùng gì: chương trình giáo dục (gán, PPCT, lớp, tiến độ) và đào tạo giáo viên (kế hoạch, chương trình đào tạo,
// số GV tham gia, chuyên cần, kết quả). Dùng ở Hồ sơ trường (trường tự xem), Trường & cơ sở triển khai (KDI) và Danh sách trường (Sở / Phòng).
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type EduRow = { program_id: string; code: string | null; title: string; version_no: number; status: string; owner: string | null
  assigned: boolean; via: string | null; grades: number[] | null; books: number; books_published: number; classes: number; lessons: number; done: number; missed: number }
type TrRow = { plan_id: string; plan_code: string | null; plan_name: string; plan_org: string | null; year_name: string | null; starts_on: string | null; ends_on: string | null
  org_id: string; quota: number | null; org_status: string; enrolled: number; sessions: number; sessions_closed: number; att_pct: number | null; passed: number; failed: number; certs: number }
const ORG_ST: Record<string, [string, string]> = { assigned: ['Chưa chọn giáo viên', 'warn'], submitted: ['Chờ duyệt danh sách', 'warn'], approved: ['Đã duyệt danh sách', 'good'], returned: ['Bị trả lại', 'bad'] }
const vn = (d: string | null) => (d ? new Date(d + 'T00:00').toLocaleDateString('vi-VN') : '')
const today = () => new Date().toISOString().slice(0, 10)
const phase = (r: TrRow) => r.starts_on && r.starts_on > today() ? 'Sắp diễn ra' : r.ends_on && r.ends_on < today() ? 'Đã kết thúc' : 'Đang diễn ra'

export function SchoolUsage({ orgId }: { orgId: string }) {
  const [edu, setEdu] = useState<EduRow[] | null>(null)
  const [tr, setTr] = useState<TrRow[] | null>(null)
  const [progs, setProgs] = useState<Map<string, string[]>>(new Map())
  const [err, setErr] = useState('')
  useEffect(() => {
    setEdu(null); setTr(null)
    supabase.rpc('school_program_usage', { p_org: orgId }).then(({ data, error }) => {
      if (error) setErr(/does not exist|schema cache/i.test(error.message) ? 'Cần chạy migration 136 trên cơ sở dữ liệu.' : error.message)
      setEdu((data as EduRow[]) ?? [])
    })
    supabase.rpc('training_monitor', { p_year: null }).then(async ({ data }) => {
      const rows = ((data as TrRow[]) ?? []).filter(r => r.org_id === orgId).sort((a, b) => (b.starts_on ?? '').localeCompare(a.starts_on ?? ''))
      setTr(rows)
      if (!rows.length) return
      const { data: it } = await supabase.from('training_plan_items').select('plan_id, training_programs(code, title)').in('plan_id', rows.map(r => r.plan_id))
      const m = new Map<string, string[]>()
      for (const x of (it ?? []) as unknown as { plan_id: string; training_programs: { code: string | null; title: string } | null }[])
        if (x.training_programs) m.set(x.plan_id, [...(m.get(x.plan_id) ?? []), (x.training_programs.code ? x.training_programs.code + ' · ' : '') + x.training_programs.title])
      setProgs(m)
    })
  }, [orgId])

  const trProgs = new Set([...progs.values()].flat())
  const teachers = (tr ?? []).reduce((s, r) => s + r.enrolled, 0)
  return <>
    <div className="cards">
      <div className="card"><strong>{edu?.length ?? '…'}</strong><span>Chương trình giáo dục đang dùng</span></div>
      <div className="card"><strong>{tr ? trProgs.size : '…'}</strong><span>Chương trình đào tạo tham gia</span></div>
      <div className="card"><strong>{tr?.length ?? '…'}</strong><span>Kế hoạch đào tạo</span></div>
      <div className="card"><strong>{tr ? teachers : '…'}</strong><span>Lượt giáo viên tham gia · {(tr ?? []).reduce((s, r) => s + r.passed, 0)} đạt</span></div>
    </div>
    {err && <p className="msg">{err}</p>}

    <section className="panel" style={{ display: 'grid', gap: 8 }}>
      <h3 style={{ margin: 0 }}>Chương trình giáo dục đang dùng</h3>
      <small className="sub">Chương trình được gán cho trường (trực tiếp hoặc qua Phòng / Sở cấp trên), hoặc trường đã có PPCT theo chương trình.</small>
      {!edu ? <p className="sub">Đang tải…</p> : !edu.length ? <p className="sub">Trường chưa được gán chương trình giáo dục nào.</p> :
        <div className="wrap"><table className="libtable">
          <thead><tr><th>Chương trình</th><th>Gán cho trường</th><th>Khối</th><th>PPCT</th><th>Lớp đang học</th><th>Tiến độ bài dạy</th></tr></thead>
          <tbody>{edu.map(r => <tr key={r.program_id}>
            <td><b>{r.title}</b><br /><small className="sub">{[r.code, `v${r.version_no}`, r.owner].filter(Boolean).join(' · ')}</small></td>
            <td>{!r.assigned ? <small className="sub">Chưa gán, trường tự có PPCT</small> : r.via ? <>Qua {r.via}</> : 'Gán trực tiếp'}</td>
            <td>{r.grades?.length ? r.grades.join(', ') : 'Tất cả'}</td>
            <td>{r.books ? `${r.books_published}/${r.books} đã ban hành` : <small className="warnline">Chưa có PPCT</small>}</td>
            <td>{r.classes || '—'}</td>
            <td>{r.lessons ? <>{r.done}/{r.lessons} bài{r.missed > 0 && <><br /><small className="warnline">{r.missed} bài trễ / bỏ</small></>}</> : '—'}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>

    <section className="panel" style={{ display: 'grid', gap: 8 }}>
      <h3 style={{ margin: 0 }}>Đào tạo giáo viên</h3>
      <small className="sub">Các kế hoạch đào tạo đã giao cho trường, chương trình đào tạo trong kế hoạch và mức tham gia của giáo viên trường.</small>
      {!tr ? <p className="sub">Đang tải…</p> : !tr.length ? <p className="sub">Trường chưa được giao kế hoạch đào tạo nào.</p> :
        <div className="wrap"><table className="libtable">
          <thead><tr><th>Kế hoạch đào tạo</th><th>Chương trình đào tạo</th><th>Thời gian</th><th>Danh sách GV</th><th>GV tham gia</th><th>Buổi học</th><th>Chuyên cần</th><th>Kết quả</th></tr></thead>
          <tbody>{tr.map(r => { const st = ORG_ST[r.org_status] ?? [r.org_status, '']
            return <tr key={r.plan_id}>
              <td><b>{r.plan_name}</b><br /><small className="sub">{[r.plan_code, r.plan_org, r.year_name && `Năm học ${r.year_name}`].filter(Boolean).join(' · ')}</small></td>
              <td style={{ whiteSpace: 'normal' }}><small>{(progs.get(r.plan_id) ?? []).join('; ') || '—'}</small></td>
              <td><small>{[vn(r.starts_on), vn(r.ends_on)].filter(Boolean).join(' → ') || '—'}</small><br /><small className="sub">{phase(r)}</small></td>
              <td><span className={'distchip2 ' + st[1]}>{st[0]}</span></td>
              <td>{r.enrolled}{r.quota != null ? `/${r.quota}` : ''}</td>
              <td>{r.sessions_closed}/{r.sessions}</td>
              <td>{r.att_pct != null ? `${String(r.att_pct).replace('.', ',')}%` : '—'}</td>
              <td>{r.passed} đạt{r.failed ? ` · ${r.failed} chưa đạt` : ''}{r.certs ? <><br /><small className="sub">{r.certs} chứng chỉ</small></> : null}</td>
            </tr> })}</tbody>
        </table></div>}
    </section>
  </>
}
