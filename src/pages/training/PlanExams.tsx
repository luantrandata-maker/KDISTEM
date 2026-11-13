// Kế hoạch đào tạo › Đề kiểm tra của kế hoạch (140).
// Mỗi chương trình trong kế hoạch dùng đề của chương trình (mặc định) hoặc đề riêng của kế hoạch, đổi được cả khi đang học
// (VD lộ đề). Bài đã nộp giữ nguyên điểm. Chỉ đơn vị lập kế hoạch được đổi. Đã có người nộp đề cuối khoá thì giữ điểm đạt, số lượt.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { listGrades, listSubjects, matrixTotal, cleanMatrix } from '../../components/ExamMatrix'
import { TryButton } from '../../components/ExamTryout'
import { Chip } from '../dist/Editor'
import { FinalExamForm, finalSpec, type FinalExam } from './ExamFrame'
import { TestEditor, type TestCfg } from './Content'

type PE = { plan_id: string; program_id: string; final: FinalExam | null; tests: Record<string, TestCfg>; reason: string | null; updated_at: string }
type G = { id: string; org_id: string; code: string; title: string; pass_score: number | null; final_exam: FinalExam | null }
type U = { id: string; program_id: string; parent_id: string | null; seq: number; title: string; has_test: boolean; detail: { test?: TestCfg } | null }
type Log = { id: number; program_id: string; op: string; reason: string | null; at: string; final: FinalExam | null; tests: Record<string, TestCfg> | null }

const num = (n: number | null | undefined) => n == null ? '—' : String(n).replace('.', ',')
const finalText = (f: FinalExam) => [`${matrixTotal(f.matrix ?? []) + (f.qids?.length ?? 0)} câu`, f.minutes ? `${f.minutes} phút` : 'không giới hạn thời gian',
  f.attempts ? `${f.attempts} lượt` : 'không giới hạn lượt', `điểm đạt ${f.pass != null ? num(f.pass) : 'không xét'}`].join(' · ')
const testText = (t: TestCfg | undefined) => !t ? '—' : t.kind === 'link' ? (t.url || 'chưa có link')
  : `${t.qids?.length ?? 0} câu${t.count && t.qids && t.count < t.qids.length ? `, rút ${t.count} câu mỗi lượt` : ''}${t.minutes ? ` · ${t.minutes} phút` : ''}`

export function PlanExams({ planId, planOrg, items, can }: { planId: string; planOrg: string; items: { program_id: string; units?: string[] | null }[]; can: boolean }) {
  const [pe, setPe] = useState<PE[]>([])
  const [progs, setProgs] = useState<G[]>([])
  const [units, setUnits] = useState<U[]>([])
  const [done, setDone] = useState<Set<string>>(new Set())
  const [log, setLog] = useState<Log[]>([])
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [ef, setEf] = useState<{ program: string; f: FinalExam } | null>(null)
  const [et, setEt] = useState<{ program: string; unit: string; t: TestCfg } | null>(null)
  const ids = items.map(i => i.program_id)
  async function load() {
    if (!ids.length) return
    const [a, b, c, d, e] = await Promise.all([
      supabase.from('training_plan_exams').select('plan_id, program_id, final, tests, reason, updated_at').eq('plan_id', planId),
      supabase.from('training_programs').select('id, org_id, code, title, pass_score, final_exam').in('id', ids),
      supabase.from('training_program_units').select('id, program_id, parent_id, seq, title, has_test, detail, kind').in('program_id', ids).order('seq'),
      supabase.rpc('training_plan_final_scores', { p_plan: planId }),
      supabase.from('training_plan_exam_log').select('id, program_id, op, reason, at, final, tests').eq('plan_id', planId).order('at', { ascending: false }).limit(30),
    ])
    setPe((a.data as PE[]) ?? []); setProgs((b.data as G[]) ?? []); setUnits((c.data as U[]) ?? [])
    setDone(new Set(((d.data ?? []) as { program_id: string }[]).map(x => x.program_id))); setLog((e.data as Log[]) ?? [])
  }
  useEffect(() => { load() }, [planId, ids.join(',')])
  if (!items.length) return null

  const row = (g: string) => pe.find(x => x.program_id === g)
  const ask = () => { const r = prompt('Lý do đổi đề (không bắt buộc), VD: lộ đề:', ''); return r === null ? null : r.trim() }
  async function put(g: string, patch: { final?: FinalExam | null; tests?: Record<string, TestCfg> }, ok: string) {
    const reason = ask(); if (reason === null) return false
    const cur = row(g), next = { final: cur?.final ?? null, tests: cur?.tests ?? {}, ...patch }
    const q = !next.final && !Object.keys(next.tests).length
      ? supabase.from('training_plan_exams').delete().eq('plan_id', planId).eq('program_id', g)
      : supabase.from('training_plan_exams').upsert({ plan_id: planId, program_id: g, final: next.final, tests: next.tests, reason: reason || null })
    const { error } = await q
    if (error) { setMsg([/row-level|42501/.test(error.message) ? 'Chỉ đơn vị lập kế hoạch được đổi đề.' : error.message, true]); return false }
    setMsg([ok, false]); await load(); return true
  }
  async function saveFinal() {
    if (!ef) return
    const f = ef.f, subs = listSubjects(f), grs = listGrades(f), total = matrixTotal(f.matrix ?? []) + (f.qids?.length ?? 0)
    if (!subs.length) return alert('Chọn môn của đề.')
    if (total < 1) return alert('Ma trận cần ít nhất 1 câu.')
    const clean: FinalExam = { ...f, title: f.title?.trim() || undefined, subjects: subs, grades: grs, subject: subs[0], grade: grs[0] ?? null,
      matrix: cleanMatrix(f.matrix ?? []).map(r => (r.subject && !subs.includes(r.subject) ? { ...r, subject: undefined } : r)) }
    if (await put(ef.program, { final: clean }, 'Đã lưu đề cuối khoá riêng của kế hoạch. Lượt làm mới dùng đề này, bài đã nộp giữ nguyên điểm.')) setEf(null)
  }
  async function saveTest() {
    if (!et) return
    const t = et.t, link = t.kind === 'link'
    if (link && !/^https?:\/\//i.test(t.url?.trim() ?? '')) return alert('Nhập link bắt đầu bằng http:// hoặc https://')
    if (!link && !t.qids?.length) return alert('Chọn ít nhất 1 câu hỏi.')
    if (!link && t.count && t.qids && t.count > t.qids.length) return alert(`Số câu mỗi lượt (${t.count}) nhiều hơn số câu đã chọn (${t.qids.length}).`)
    const v: TestCfg = link ? { url: t.url!.trim(), note: t.note?.trim() || undefined, due: t.due || null } : { qids: t.qids, count: t.count ?? null, minutes: t.minutes ?? null }
    if (await put(et.program, { tests: { ...(row(et.program)?.tests ?? {}), [et.unit]: v } }, 'Đã lưu bài kiểm tra riêng của kế hoạch.')) setEt(null)
  }
  const resetTest = (g: string, u: string) => { const t = { ...(row(g)?.tests ?? {}) }; delete t[u]; put(g, { tests: t }, 'Đã dùng lại bài kiểm tra của chương trình.') }
  const pTitle = (g: string) => { const x = progs.find(p => p.id === g); return x ? `${x.code} · ${x.title}` : '' }

  // Đang soạn đề cuối khoá
  if (ef) { const g = progs.find(p => p.id === ef.program)!
    return <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <div><h3 style={{ margin: 0 }}>Đề cuối khoá riêng của kế hoạch</h3><p className="sub" style={{ margin: '4px 0 0' }}>{pTitle(g.id)} · rút câu từ ngân hàng câu hỏi của đơn vị lập kế hoạch. Chương trình giữ nguyên.</p></div>
      <FinalExamForm org={planOrg} f={ef.f} setF={f => setEf({ ...ef, f })} total={matrixTotal(ef.f.matrix ?? []) + (ef.f.qids?.length ?? 0)} lock={done.has(g.id)} onSave={saveFinal} onCancel={() => setEf(null)} />
    </section> }
  // Đang soạn bài kiểm tra nội dung
  if (et) { const u = units.find(x => x.id === et.unit)!, g = progs.find(p => p.id === et.program)
    return <section className="panel" style={{ display: 'grid', gap: 12 }}>
      <div className="bar" style={{ margin: 0 }}><div><h3 style={{ margin: 0 }}>Bài kiểm tra riêng của kế hoạch: {u.title}</h3>
        <p className="sub" style={{ margin: '4px 0 0' }}>{pTitle(et.program)} · chỉ đổi {et.t.kind === 'link' ? 'link' : 'câu hỏi, số câu mỗi lượt, thời gian'}; cách làm, điểm đạt, số lượt theo chương trình.</p></div>
        <span className="tools"><button type="button" className="primary" onClick={saveTest}>Lưu</button><button type="button" onClick={() => setEt(null)}>Huỷ</button></span></div>
      <TestEditor t={et.t} edit limited hasTest passScore={u.detail?.test?.pass ?? g?.pass_score ?? null} onChange={t => setEt({ ...et, t })} />
    </section> }

  const edit = can
  return <section className="panel" style={{ display: 'grid', gap: 12 }}>
    <div><h3 style={{ margin: 0 }}>Đề kiểm tra của kế hoạch</h3></div>
    {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    {items.map(i => { const g = progs.find(p => p.id === i.program_id); if (!g) return null
      const r = row(g.id), own = r?.final ?? null, fe = own ?? g.final_exam
      const tests = units.filter(u => u.program_id === g.id && u.has_test && (!i.units || i.units.includes(u.id)) && (u.detail?.test?.kind === 'link' ? u.detail.test.url : u.detail?.test?.qids?.length))
        .sort((a, b) => (units.find(x => x.id === a.parent_id)?.seq ?? 0) - (units.find(x => x.id === b.parent_id)?.seq ?? 0) || a.seq - b.seq)
      return <div key={g.id} className="tpexam">
        <b>{g.code} · {g.title}</b>
        <div className="wrap"><table className="libtable">
          <thead><tr><th>Đề</th><th style={{ width: 170 }}>Đang dùng</th><th>Cấu hình</th>{edit && <th style={{ width: 1 }}></th>}</tr></thead>
          <tbody>
            <tr><td><b>Đề cuối khoá</b>{done.has(g.id) && <><br /><small className="sub">đã có người nộp bài</small></>}</td>
              <td>{own ? <Chip tone="warn">Đề riêng của kế hoạch</Chip> : g.final_exam ? <Chip>Đề của chương trình</Chip> : <small className="sub">Chưa có đề</small>}</td>
              <td style={{ whiteSpace: 'normal' }}>{fe ? <>{fe.title || 'Đề cuối khoá'}<br /><small className="sub">{finalText(fe)}</small></> : '—'}</td>
              {edit && <td><span className="tools" style={{ flexWrap: 'nowrap' }}>
                {fe && <TryButton orgId={own ? planOrg : g.org_id} spec={finalSpec(fe)} title={fe.title || 'Đề cuối khoá'} minutes={fe.minutes} pass={fe.pass} />}
                {own ? <><button type="button" onClick={() => setEf({ program: g.id, f: { ...own, matrix: [...(own.matrix ?? [])] } })}>Sửa đề</button>
                  <button type="button" onClick={() => confirm('Dùng lại đề cuối khoá của chương trình cho kế hoạch này?') && put(g.id, { final: null }, 'Đã dùng lại đề của chương trình.')}>Dùng đề chương trình</button></>
                  : <button type="button" onClick={() => setEf({ program: g.id, f: g.final_exam ? { ...g.final_exam, subjects: listSubjects(g.final_exam), grades: listGrades(g.final_exam), matrix: [...(g.final_exam.matrix ?? [])] }
                      : { title: '', subjects: [], grades: [], matrix: [], minutes: 30, attempts: 2, pass: 5, shuffle: true } })}>{g.final_exam ? 'Dùng đề riêng' : '+ Thêm đề'}</button>}
              </span></td>}</tr>
            {tests.map(u => { const base = u.detail?.test, o = r?.tests?.[u.id], t = o ? { ...base, ...o } : base
              return <tr key={u.id}><td style={{ whiteSpace: 'normal' }}>Bài kiểm tra: {u.title}</td>
                <td>{o ? <Chip tone="warn">Riêng của kế hoạch</Chip> : <Chip>Của chương trình</Chip>}</td>
                <td style={{ whiteSpace: 'normal' }}><small>{t?.kind === 'link' ? 'Qua link: ' : ''}{testText(t)}</small></td>
                {edit && <td><span className="tools" style={{ flexWrap: 'nowrap' }}>
                  <button type="button" onClick={() => setEt({ program: g.id, unit: u.id, t: { ...t, kind: base?.kind } })}>{base?.kind === 'link' ? 'Đổi link' : 'Đổi câu hỏi'}</button>
                  {o && <button type="button" onClick={() => confirm('Dùng lại bài kiểm tra của chương trình?') && resetTest(g.id, u.id)}>Dùng của chương trình</button>}
                </span></td>}</tr> })}
          </tbody>
        </table></div>
      </div> })}
    {log.length > 0 && <details><summary><b>Lịch sử đổi đề</b> <small className="sub">({log.length} lần)</small></summary>
      <ul className="tpexamlog">{log.map(l => <li key={l.id}><small className="sub">{new Date(l.at).toLocaleString('vi-VN')}</small> · {pTitle(l.program_id)} ·{' '}
        {l.op === 'reset' ? 'dùng lại đề của chương trình' : [l.final ? 'đề cuối khoá riêng' : '', l.tests && Object.keys(l.tests).length ? `${Object.keys(l.tests).length} bài kiểm tra riêng` : ''].filter(Boolean).join(', ') || 'dùng lại đề của chương trình'}
        {l.reason && <> · <i>{l.reason}</i></>}</li>)}</ul></details>}
  </section>
}
