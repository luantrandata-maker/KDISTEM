// Đáp ứng chương trình giáo dục (migration 124): mỗi trường × chương trình giáo dục (được gán cho trường, hoặc đã có GV đáp ứng)
// có bao nhiêu giáo viên đáp ứng. GV đáp ứng khi đã Đạt một khoá tập huấn có chương trình tập huấn gắn với chương trình giáo dục đó.
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Chip } from '../dist/Editor'
import { downloadXlsx } from '../../lib/sheet'
import { MultiFilters, useMultiFilters } from '../../components/MultiFilters'
import { useOrgFilters } from '../../components/OrgFilters'

type Met = { id: string; name: string; via: string | null; date: string | null }
type Sug = { id: string; code: string | null; title: string }
type Row = { org_id: string; org_name: string; org_level: string | null; edu_family: string; code: string | null; title: string; kind: string; ct_code: string | null
  assigned: boolean; teachers: number; met: number; met_list: Met[]; suggest: Sug[] }
const errText = (m: string) => /schema cache|does not exist|Could not find/i.test(m) ? 'Hãy chạy migration 124 trên Supabase để xem đáp ứng chương trình giáo dục.' : m

export function EduReadinessPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [gap, setGap] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [view, setView] = useState<'program' | 'school'>('program')
  const mf = useMultiFilters()
  const of = useOrgFilters(rows ?? [], mf)
  useEffect(() => {
    supabase.rpc('edu_program_readiness').then(({ data, error }) => { if (error) setErr(errText(error.message)); setRows((data as Row[]) ?? []) })
  }, [])
  if (err) return <p className="msg">{err}</p>
  if (!rows) return <p className="sub">Đang tải…</p>
  const needle = q.trim().toLowerCase()
  // Lọc Tỉnh / Sở, trường bằng ô chọn nhiều; ô tìm chỉ tìm chương trình
  const scope = rows.filter(r => of.fit(r.org_id))
  const shown = scope.filter(r => (!gap || (r.assigned && !r.met)) && (!needle || `${r.title} ${r.code ?? ''}`.toLowerCase().includes(needle)))
  const assigned = scope.filter(r => r.assigned)
  const missing = assigned.filter(r => !r.met)
  const schools = new Set(scope.map(r => r.org_id)).size
  // Tổng hợp theo trường: chương trình được gán, đã có GV đáp ứng, chưa có (mỗi chương trình chưa có cần tập huấn ít nhất 1 GV)
  const bySchool = [...assigned.reduce((m, r) => { const x = m.get(r.org_id) ?? { id: r.org_id, name: r.org_name, teachers: r.teachers, rows: [] as Row[] }; x.rows.push(r); return m.set(r.org_id, x) },
    new Map<string, { id: string; name: string; teachers: number; rows: Row[] }>()).values()]
    .map(x => ({ ...x, met: x.rows.filter(r => r.met).length, metT: new Set(x.rows.flatMap(r => r.met_list.map(t => t.id))).size, miss: x.rows.filter(r => !r.met) }))
    .sort((a, b) => b.miss.length - a.miss.length || a.name.localeCompare(b.name, 'vi'))
  const key = (r: Row) => r.org_id + r.edu_family
  function excel() {
    downloadXlsx('dap-ung-chuong-trinh-giao-duc', [{ key: 's', label: 'Trường', width: 30 }, { key: 'c', label: 'Mã', width: 12 }, { key: 'p', label: 'Chương trình giáo dục', width: 40 },
      { key: 'a', label: 'Được gán cho trường' }, { key: 'm', label: 'GV đáp ứng' }, { key: 't', label: 'Tổng GV' }, { key: 'l', label: 'Giáo viên đáp ứng', width: 50 }, { key: 'g', label: 'Khoá tập huấn gợi ý', width: 40 }],
      shown.map(r => [r.org_name, r.code ?? '', r.title, r.assigned ? 'Có' : 'Không', r.met, r.teachers, r.met_list.map(t => t.name).join('; '), r.suggest.map(g => g.title).join('; ')]), 'Đáp ứng CTGD')
  }
  return <>
    <div className="cards syscards">
      <div className="card"><strong>{schools}</strong><span>Trường</span></div>
      <div className="card"><strong>{assigned.length}</strong><span>Chương trình được gán cho trường</span></div>
      <div className="card"><strong>{assigned.length - missing.length}/{assigned.length}</strong><span>Đã có GV đáp ứng</span></div>
      <div className="card"><strong style={{ color: missing.length ? 'var(--bad, #dc2626)' : undefined }}>{missing.length}</strong><span>Chưa có GV đáp ứng</span></div>
    </div>
    <p className="sub">Giáo viên đáp ứng một chương trình giáo dục khi đã Đạt một khoá tập huấn có chương trình tập huấn gắn với chương trình đó (KDI gắn trong Chương trình tập huấn › Thông tin).</p>
    <div className="tools" style={{ marginBottom: 12 }}>
      <MultiFilters defs={of.defs} f={mf} />
      <input className="search" style={{ margin: 0 }} placeholder="Tìm chương trình…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm chương trình" />
      {view === 'program' && <label className="inl"><input type="checkbox" checked={gap} onChange={e => setGap(e.target.checked)} /> Chỉ chương trình đã gán mà chưa có GV đáp ứng</label>}
      <span style={{ flex: 1 }} />
      {([['program', 'Theo chương trình'], ['school', 'Tổng hợp theo trường']] as const).map(([k, l]) =>
        <button key={k} type="button" className={`distfchip${view === k ? ' on' : ''}`} aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}<button type="button" onClick={excel} disabled={!shown.length}>Xuất Excel</button>
    </div>
    {view === 'school' ? <><p className="sub">Mỗi dòng là một trường: số chương trình giáo dục được gán cho trường, số chương trình đã có GV đáp ứng và các chương trình chưa có. Mỗi chương trình chưa có GV đáp ứng cần tập huấn ít nhất 1 GV qua khoá gợi ý.</p>
    <div className="wrap"><table className="libtable">
      <thead><tr><th>Trường</th><th>CTGD được gán</th><th>Đã có GV đáp ứng</th><th>GV đáp ứng / tổng GV</th><th>Chưa có GV đáp ứng (cần tập huấn tối thiểu)</th></tr></thead>
      <tbody>{bySchool.map(x => <tr key={x.id} className="clickrow" onClick={() => { mf.set('school', [x.id]); setView('program') }} title="Xem từng chương trình của trường">
        <td><b>{x.name}</b></td><td>{x.rows.length}</td>
        <td><Chip tone={x.met === x.rows.length ? 'good' : 'warn'}>{x.met}/{x.rows.length}</Chip></td>
        <td>{x.metT}/{x.teachers} GV</td>
        <td>{x.miss.length ? <><b>{x.miss.length} chương trình · ít nhất {x.miss.length} GV</b><br /><small className="sub">{x.miss.map(r => r.code || r.title).join(', ')}</small></> : <small className="sub">Đủ</small>}</td></tr>)}
        {!bySchool.length && <tr><td colSpan={5}><small className="sub">Không có trường nào được gán chương trình giáo dục trong bộ lọc.</small></td></tr>}</tbody>
    </table></div></> : <><div className="wrap"><table className="libtable">
      <thead><tr><th>Trường</th><th>Chương trình giáo dục</th><th>Gán cho trường</th><th>GV đáp ứng</th><th>Khoá tập huấn gợi ý</th></tr></thead>
      <tbody>{shown.map(r => { const k = key(r); return <tr key={k}>
        <td>{r.org_name}</td>
        <td><b>{r.title}</b>{r.code && <><br /><small className="sub">{r.code}</small></>}</td>
        <td>{r.assigned ? 'Có' : <small className="sub">Không</small>}</td>
        <td>{r.met ? <Chip tone="good">{r.met}/{r.teachers} GV</Chip> : r.assigned ? <Chip tone="bad">Chưa có GV</Chip> : <small className="sub">0</small>}
          {r.met > 0 && <> <button type="button" className="linkbtn" onClick={() => setOpen(open === k ? null : k)}>{open === k ? 'Ẩn' : 'Xem'}</button></>}
          {open === k && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{r.met_list.map(t => <li key={t.id}><small><b>{t.name}</b>{t.via ? ` · ${t.via}` : ''}{t.date ? ` · ${new Date(t.date).toLocaleDateString('vi-VN')}` : ''}</small></li>)}</ul>}</td>
        <td><small>{r.suggest.length ? r.suggest.map(g => g.title).join('; ') : <span className="sub">Chưa gắn khoá nào</span>}</small></td>
      </tr> })}</tbody>
    </table></div>
    {!shown.length && <p className="sub">{rows.length ? 'Không có dòng nào khớp bộ lọc.' : 'Chưa có dữ liệu: chưa có chương trình giáo dục gán cho trường hoặc chưa có giáo viên đáp ứng.'}</p>}</>}
  </>
}
