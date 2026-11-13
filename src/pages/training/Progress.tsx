// Phân hệ 1 — Tiến độ học của nhà giáo trong một kế hoạch đào tạo (086): học liệu trên hệ thống, bài kiểm tra, chuyên cần, sản phẩm.
// Chỉ hiện cột học liệu / bài kiểm tra khi kế hoạch có; kế hoạch chỉ học trực tiếp thì xếp Chưa học / Đang học / Đã học xong theo chuyên cần.
// Đơn vị lập kế hoạch: xem tất cả GV, nhận / trả lại sản phẩm. Trường: xem GV của trường mình.
import { useEffect, useState } from 'react'
import { supabase, fetchAll } from '../../lib/supabase'
import { useOrgTree } from '../../components/OrgTree'
import { Chip } from '../dist/Editor'

type Row = { teacher_id: string; teacher_name: string; org_name: string | null; units: number; done: number; tests: number; tests_passed: number
  avg_score: number | null; present: number; sessions: number; product_status: 'submitted' | 'accepted' | 'returned' | null
  product_url: string | null; product_note: string | null; product_feedback: string | null; last_at: string | null }
type F = 'all' | 'none' | 'doing' | 'done' | 'product'
const PST: Record<string, [string, string]> = { submitted: ['Chờ nhận xét', 'warn'], accepted: ['Đã nhận', 'good'], returned: ['Trả lại', 'bad'] }
const pct = (a: number, b: number) => b ? Math.round(a * 100 / b) : 0
type Unit = { id: string; program_id: string; detail: { lectures?: unknown[]; docs?: unknown[]; test?: unknown } | null }
/** Nội dung có học liệu (bài giảng, tài liệu) hoặc bài kiểm tra trên hệ thống: phần học trực tuyến */
const online = (u: Unit) => !!(u.detail?.lectures?.length || u.detail?.docs?.length || u.detail?.test)

export function PlanProgress({ planId, manage }: { planId: string; manage: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')
  const [f, setF] = useState<F>('all')
  const [busy, setBusy] = useState('')
  // Lọc Tỉnh / Sở và trường: trường của từng nhà giáo ghi danh
  const [orgOf, setOrgOf] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    fetchAll(() => supabase.from('training_enrollments').select('teacher_id, teachers(org_id)').eq('plan_id', planId).order('teacher_id'))
      .then(({ data }) => setOrgOf(new Map(((data ?? []) as unknown as { teacher_id: string; teachers: { org_id: string } | null }[]).map(e => [e.teacher_id, e.teachers?.org_id ?? '']))))
  }, [planId])
  const load = () => supabase.rpc('training_plan_progress', { p_plan: planId }).then(({ data, error }) => {
    if (error) setErr(/does not exist|schema cache/i.test(error.message) ? 'Hãy chạy migration 086 trên Supabase.' : error.message)
    else { setErr(''); setRows((data as Row[]) ?? []) }
  })
  useEffect(() => { load() }, [planId])
  // Số nội dung học trực tuyến của kế hoạch; nội dung không có học liệu, bài kiểm tra được hệ thống tính sẵn là "đã học" nên trừ ra
  const [nOnline, setNOnline] = useState<number | null>(null)
  useEffect(() => {
    (async () => {
      const { data: it } = await supabase.from('training_plan_items').select('program_id, units').eq('plan_id', planId)
      const items = (it ?? []) as { program_id: string; units: string[] | null }[]
      if (!items.length) return setNOnline(0)
      const { data: us } = await fetchAll(() => supabase.from('training_program_units').select('id, program_id, detail').eq('kind', 'content').in('program_id', items.map(i => i.program_id)).order('id'))
      const pick = ((us ?? []) as Unit[]).filter(u => { const i = items.find(x => x.program_id === u.program_id); return !i?.units || i.units.includes(u.id) })
      setNOnline(pick.filter(online).length)
    })()
  }, [planId])
  // Cây Tỉnh / Sở → Trường bên trái (một Tỉnh / Sở thì chỉ hiện các trường)
  const tree = useOrgTree((rows ?? []).map(r => orgOf.get(r.teacher_id)))

  async function review(r: Row, accept: boolean) {
    const fb = accept ? prompt(`Nhận xét cho sản phẩm của ${r.teacher_name} (không bắt buộc):`, r.product_feedback ?? '') : prompt(`Lý do trả lại sản phẩm của ${r.teacher_name}:`)
    if (fb === null || (!accept && !fb.trim())) return
    setBusy(r.teacher_id)
    const { error } = await supabase.rpc('training_product_review', { p_plan: planId, p_teacher: r.teacher_id, p_accept: accept, p_feedback: fb })
    setBusy('')
    if (error) setErr(error.message); else load()
  }

  if (!rows || nOnline == null) return <section className="panel">{err ? <p className="sub" role="alert">{err}</p> : <p className="sub">Đang tải tiến độ…</p>}</section>
  const hasOnline = nOnline > 0, hasTests = rows.some(r => r.tests > 0)
  const learned = (r: Row) => Math.max(0, r.done - (r.units - nOnline))
  const stOf = (r: Row): Exclude<F, 'all' | 'product'> => hasOnline
    ? (learned(r) === 0 && !r.last_at ? 'none' : learned(r) >= nOnline ? 'done' : 'doing')
    : (!r.present ? 'none' : r.sessions && r.present >= r.sessions ? 'done' : 'doing')
  const nCols = 3 + (hasOnline ? 1 : 0) + (hasTests ? 1 : 0) + (manage ? 1 : 0)
  const mine = rows.filter(r => tree.fit(orgOf.get(r.teacher_id)))
  const n = (k: F) => k === 'all' ? mine.length : k === 'product' ? mine.filter(r => r.product_status === 'submitted').length : mine.filter(r => stOf(r) === k).length
  const shown = mine.filter(r => f === 'all' || (f === 'product' ? r.product_status === 'submitted' : stOf(r) === f))
    .sort((a, b) => (a.org_name ?? '').localeCompare(b.org_name ?? '', 'vi') || a.teacher_name.localeCompare(b.teacher_name, 'vi'))
  // Nhóm theo trường khi danh sách có nhiều trường
  const multi = new Set(shown.map(r => r.org_name)).size > 1
  const perOrg = new Map<string, number>(); shown.forEach(r => perOrg.set(r.org_name ?? '', (perOrg.get(r.org_name ?? '') ?? 0) + 1))
  const chips: [F, string][] = [['all', 'Tất cả'], ['none', 'Chưa học'], ['doing', 'Đang học'], ['done', 'Đã học xong'], ['product', 'Sản phẩm chờ nhận xét']]
  return <section className="panel" style={{ display: 'grid', gap: 12 }}>
    <div className="bar" style={{ margin: 0 }}><h3 style={{ margin: 0 }}>Tiến độ học</h3>
      <small className="sub">{rows.length} nhà giáo · {n('done')} đã học xong · {rows.filter(r => r.product_status).length} đã nộp sản phẩm</small></div>
    {err && <p className="sub" role="alert" style={{ color: 'var(--bad)' }}>{err}</p>}
    <div className="distfilter">{chips.map(([k, l]) => <button key={k} type="button" className={`distfchip${f === k ? ' on' : ''}`} onClick={() => setF(k)}>{l} ({n(k)})</button>)}</div>
    <div className="treelayout">{tree.side}
    <div className="wrap"><table className="libtable">
      <thead><tr><th>Nhà giáo</th>{hasOnline && <th style={{ width: 170 }}>Học trực tuyến</th>}{hasTests && <th>Bài kiểm tra</th>}<th>Chuyên cần</th><th>Sản phẩm</th>{manage && <th></th>}</tr></thead>
      <tbody>{shown.map((r, i) => [multi && (i === 0 || shown[i - 1].org_name !== r.org_name) &&
        <tr key={'g' + r.teacher_id} className="grouprow"><td colSpan={nCols}><b>{r.org_name ?? 'Chưa rõ trường'}</b> <small className="sub">{perOrg.get(r.org_name ?? '')} nhà giáo</small></td></tr>,
        <tr key={r.teacher_id}>
        <td><b>{r.teacher_name}</b><br /><small className="sub">{r.org_name ?? '—'}{r.last_at ? ` · học gần nhất ${new Date(r.last_at).toLocaleDateString('vi-VN')}` : ''}</small></td>
        {hasOnline && <td><div className="progress"><i style={{ width: `${pct(learned(r), nOnline)}%` }} /></div><small className="sub">{learned(r)}/{nOnline} nội dung · {pct(learned(r), nOnline)}%</small></td>}
        {hasTests && <td>{r.tests ? <>{r.tests_passed}/{r.tests} đạt<br /><small className="sub">Điểm TB {r.avg_score == null ? '—' : String(r.avg_score).replace('.', ',')}</small></> : <small className="sub">Không có</small>}</td>}
        <td>{r.sessions ? <>{pct(r.present, r.sessions)}%<br /><small className="sub">{r.present}/{r.sessions} buổi</small></> : <small className="sub">Chưa có buổi</small>}</td>
        <td style={{ whiteSpace: 'normal', maxWidth: 260 }}>{r.product_status ? <>
          <Chip tone={PST[r.product_status][1]}>{PST[r.product_status][0]}</Chip>
          {r.product_url && <><br /><a href={r.product_url} target="_blank" rel="noreferrer">Mở sản phẩm ↗</a></>}
          {r.product_note && <><br /><small className="sub">{r.product_note}</small></>}
          {r.product_feedback && <><br /><small>Nhận xét: {r.product_feedback}</small></>}
        </> : <small className="sub">Chưa nộp</small>}</td>
        {manage && <td><div className="tools">{r.product_status && r.product_status !== 'accepted' && <>
          <button type="button" className="primary" disabled={busy === r.teacher_id} onClick={() => review(r, true)}>Nhận</button>
          <button type="button" disabled={busy === r.teacher_id} onClick={() => review(r, false)}>Trả lại</button></>}
          {r.product_status === 'accepted' && <button type="button" disabled={busy === r.teacher_id} onClick={() => review(r, false)}>Trả lại</button>}</div></td>}
      </tr>])}
        {!shown.length && <tr><td colSpan={nCols}><small className="sub">{rows.length ? 'Không có nhà giáo nào khớp bộ lọc.' : 'Chưa có nhà giáo ghi danh.'}</small></td></tr>}</tbody>
    </table></div></div>
  </section>
}
