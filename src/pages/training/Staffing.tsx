// Dự tính giáo viên theo chương trình giáo dục (137): chọn một trường, chọn các chương trình giáo dục trường đang dạy hoặc dự định dạy,
// nhập số lớp (tự điền nếu trường đã có lớp học theo chương trình) và số lớp tối đa mỗi GV dạy.
// Mỗi chương trình: GV cần = số lớp ÷ số lớp tối đa (làm tròn lên), GV đã đáp ứng (theo 124 / 132), còn thiếu.
// Lựa chọn chỉ lưu trên trình duyệt này (theo từng trường), không ghi vào cơ sở dữ liệu.
import { useEffect, useMemo, useState } from 'react'
import { supabase, fetchAll } from '../../lib/supabase'
import { SchoolPicker } from '../../components/SchoolPicker'
import { Chip } from '../dist/Editor'
import { downloadXlsx } from '../../lib/sheet'

type Prog = { id: string; family_id: string | null; version_no: number; code: string | null; title: string; status: string; ct_codes: string[] | null; organizations: { name: string } | null }
type Fam = { fam: string; id: string; code: string | null; title: string; cts: string[]; owner: string }
type Usage = { program_id: string; assigned: boolean; classes: number }
type Met = { edu_family: string; met: number; names: string[] }
type Saved = { fams: string[]; classes: Record<string, number> }

const KEY = 'kdi-du-tinh-gv-'
const load = (org: string): Saved | null => { try { const v = localStorage.getItem(KEY + org); return v ? JSON.parse(v) as Saved : null } catch { return null } }
const save = (org: string, s: Saved) => { try { localStorage.setItem(KEY + org, JSON.stringify(s)) } catch { /* chỉ giữ trong phiên */ } }

export function TeacherStaffingPage() {
  const [schools, setSchools] = useState<{ id: string; name: string }[] | null>(null)
  const [org, setOrg] = useState('')
  const [progs, setProgs] = useState<Prog[]>([])
  const [usage, setUsage] = useState<Usage[] | null>(null)
  const [met, setMet] = useState<Met[]>([])
  const [err, setErr] = useState('')
  const [maxPer, setMaxPer] = useState(6)
  const [fams, setFams] = useState<string[]>([])
  const [classes, setClasses] = useState<Record<string, number>>({})
  const [add, setAdd] = useState('')
  const [ready, setReady] = useState('')  // trường đã dựng xong lựa chọn (mới lưu)

  useEffect(() => {
    fetchAll(() => supabase.from('organizations').select('id, name').eq('type', 'school').order('name').order('id')).then(({ data }) => {
      const list = ((data ?? []) as { id: string; name: string }[])
      setSchools(list); if (list.length === 1) setOrg(list[0].id)
    })
    supabase.from('edu_programs').select('id, family_id, version_no, code, title, status, ct_codes, organizations(name)').in('status', ['published', 'superseded']).order('title')
      .then(({ data }) => setProgs((data ?? []) as unknown as Prog[]))
  }, [])

  // Họ chương trình: lấy bản đã ban hành mới nhất
  const famOf = useMemo(() => new Map(progs.map(p => [p.id, p.family_id ?? p.id])), [progs])
  const families = useMemo(() => {
    const m = new Map<string, Fam>()
    progs.filter(p => p.status === 'published').sort((a, b) => b.version_no - a.version_no).forEach(p => {
      const f = p.family_id ?? p.id
      if (!m.has(f)) m.set(f, { fam: f, id: p.id, code: p.code, title: p.title, cts: p.ct_codes ?? [], owner: p.organizations?.name ?? '' })
    })
    return [...m.values()].sort((a, b) => a.title.localeCompare(b.title, 'vi'))
  }, [progs])

  useEffect(() => {
    if (!org) return
    setUsage(null); setMet([]); setErr(''); setReady('')
    Promise.all([supabase.rpc('school_program_usage', { p_org: org }), supabase.rpc('school_edu_met', { p_org: org })]).then(([u, m]) => {
      const e = u.error ?? m.error
      if (e) setErr(/does not exist|schema cache|Could not find/i.test(e.message) ? 'Cần chạy migration 136 và 137 trên cơ sở dữ liệu.' : e.message)
      setUsage((u.data as Usage[]) ?? []); setMet((m.data as Met[]) ?? [])
    })
  }, [org])

  // Theo họ chương trình: đã gán cho trường chưa, số lớp đang học
  const used = useMemo(() => {
    const m = new Map<string, { assigned: boolean; classes: number }>()
    ;(usage ?? []).forEach(u => { const f = famOf.get(u.program_id) ?? u.program_id; const x = m.get(f) ?? { assigned: false, classes: 0 }
      m.set(f, { assigned: x.assigned || u.assigned, classes: x.classes + (u.classes || 0) }) })
    return m
  }, [usage, famOf])

  // Lần đầu mở một trường: chọn sẵn chương trình đã gán hoặc đang có lớp; lần sau lấy lại lựa chọn đã lưu
  useEffect(() => {
    if (!org || !usage || !progs.length) return
    const s = load(org)
    if (s) { setFams(s.fams); setClasses(s.classes) }
    else { setFams([...used.entries()].filter(([, v]) => v.assigned || v.classes > 0).map(([f]) => f).filter(f => families.some(x => x.fam === f))); setClasses({}) }
    setReady(org)
  }, [org, usage, families])
  useEffect(() => { if (org && ready === org) save(org, { fams, classes }) }, [fams, classes, ready])

  const metOf = useMemo(() => new Map(met.map(m => [m.edu_family, m])), [met])
  const rows = fams.map(f => families.find(x => x.fam === f)).filter(Boolean).map(p => {
    const auto = used.get(p!.fam)?.classes ?? 0
    const n = classes[p!.fam] ?? auto
    const need = n > 0 ? Math.ceil(n / Math.max(1, maxPer)) : 0
    const m = metOf.get(p!.fam)
    const have = m?.met ?? 0
    return { p: p!, auto, n, need, have, names: m?.names ?? [], gap: Math.max(0, need - have), assigned: !!used.get(p!.fam)?.assigned }
  })
  const tot = rows.reduce((a, r) => ({ n: a.n + r.n, need: a.need + r.need, gap: a.gap + r.gap }), { n: 0, need: 0, gap: 0 })
  const distinctMet = new Set(rows.flatMap(r => r.names)).size
  const others = families.filter(f => !fams.includes(f.fam))
  const school = schools?.find(s => s.id === org)

  function exportXlsx() {
    downloadXlsx(`Du-tinh-GV-${school?.name ?? 'truong'}.xlsx`,
      [{ key: 'p', label: 'Chương trình giáo dục', width: 40 }, { key: 's', label: 'Tình trạng', width: 14 }, { key: 'n', label: 'Số lớp', width: 8 },
       { key: 'c', label: 'GV cần', width: 8 }, { key: 'h', label: 'GV đã đáp ứng', width: 12 }, { key: 'g', label: 'Còn thiếu', width: 10 }, { key: 'l', label: 'GV đáp ứng', width: 40 }],
      rows.map(r => [(r.p.code ? r.p.code + ' · ' : '') + r.p.title, r.assigned ? 'Đã gán' : 'Dự định', r.n, r.need, r.have, r.gap, r.names.join('; ')]), 'Dự tính GV')
  }

  return <section className="panel" style={{ display: 'grid', gap: 12 }}>
    <div>
      <h3 style={{ margin: 0 }}>Dự tính giáo viên theo chương trình giáo dục</h3>
      <small className="sub">Chọn các chương trình trường đang dạy hoặc dự định dạy và số lớp mỗi chương trình. GV cần = số lớp ÷ số lớp tối đa một GV dạy (làm tròn lên).
        GV đã đáp ứng là GV của trường đã Đạt khoá đào tạo gắn với chương trình, hoặc có mức năng lực đủ yêu cầu của chương trình.</small>
    </div>
    <div className="bar" style={{ margin: 0 }}>
      <div className="tools" style={{ flex: 1, minWidth: 280 }}>
        {!schools ? <small className="sub">Đang tải danh sách trường…</small> : schools.length > 1
          ? <SchoolPicker single value={org ? [org] : []} onChange={v => setOrg(v[0] ?? '')} options={schools} placeholder="Gõ để tìm trường…" ariaLabel="Trường" style={{ minWidth: 320 }} />
          : <b>{school?.name ?? 'Chưa có trường'}</b>}
      </div>
      <div className="tools">
        <label className="tools">Số lớp tối đa / GV <input type="number" min={1} max={30} value={maxPer} onChange={e => setMaxPer(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} style={{ width: 70 }} aria-label="Số lớp tối đa mỗi GV" /></label>
        {rows.length > 0 && <button type="button" onClick={exportXlsx}>Xuất Excel</button>}
      </div>
    </div>
    {err && <p className="msg">{err}</p>}
    {!org ? <p className="sub">Chọn một trường để dự tính.</p> : !usage ? <p className="sub">Đang tải…</p> : <>
      <div className="cards">
        <div className="card"><strong>{rows.length}</strong><span>Chương trình đang chọn</span></div>
        <div className="card"><strong>{tot.need}</strong><span>GV cần · {tot.n} lớp</span></div>
        <div className="card"><strong>{distinctMet}</strong><span>GV đã đáp ứng (không trùng)</span></div>
        <div className="card"><strong style={{ color: tot.gap ? 'var(--bad)' : undefined }}>{tot.gap}</strong><span>Lượt GV còn thiếu</span></div>
      </div>
      <div className="wrap"><table className="libtable">
        <thead><tr><th>Chương trình giáo dục</th><th style={{ width: 110 }}>Số lớp</th><th>GV cần</th><th>GV đã đáp ứng</th><th>Còn thiếu</th><th></th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.p.fam}>
          <td style={{ whiteSpace: 'normal' }}><b>{r.p.title}</b> <Chip tone={r.assigned ? 'good' : 'warn'}>{r.assigned ? 'Đã gán' : 'Dự định'}</Chip><br />
            <small className="sub">{[r.p.code, r.p.cts.join(', '), r.p.owner].filter(Boolean).join(' · ')}</small></td>
          <td><input type="number" min={0} max={500} value={r.n} aria-label={`Số lớp ${r.p.title}`} style={{ width: 80 }}
            onChange={e => setClasses({ ...classes, [r.p.fam]: Math.max(0, Math.min(500, Number(e.target.value) || 0)) })} />
            {r.auto > 0 && <><br /><small className="sub">Đang có {r.auto} lớp</small></>}</td>
          <td><b>{r.need}</b></td>
          <td style={{ whiteSpace: 'normal' }}>{r.have}{r.names.length > 0 && <><br /><small className="sub">{r.names.join(', ')}</small></>}</td>
          <td>{r.need === 0 ? <small className="sub">Nhập số lớp</small> : r.gap ? <Chip tone="bad">Thiếu {r.gap}</Chip> : <Chip tone="good">Đủ</Chip>}</td>
          <td><button type="button" className="linkbtn" onClick={() => setFams(fams.filter(f => f !== r.p.fam))}>Bỏ</button></td>
        </tr>)}
          {!rows.length && <tr><td colSpan={6}><small className="sub">Chưa chọn chương trình nào. Thêm chương trình ở ô bên dưới.</small></td></tr>}</tbody>
      </table></div>
      <div className="tools">
        <select value={add} onChange={e => setAdd(e.target.value)} aria-label="Thêm chương trình giáo dục" style={{ minWidth: 320 }}>
          <option value="">— Chọn chương trình giáo dục để thêm —</option>
          {others.map(f => <option key={f.fam} value={f.fam}>{(f.code ? f.code + ' · ' : '') + f.title}{used.get(f.fam)?.assigned ? ' (đã gán)' : ''}</option>)}</select>
        <button type="button" className="primary" disabled={!add} onClick={() => { setFams([...fams, add]); setAdd('') }}>Thêm</button>
        <small className="sub">Một GV có thể đáp ứng nhiều chương trình, nên "lượt còn thiếu" là tổng theo từng chương trình.</small>
      </div>
    </>}
  </section>
}
