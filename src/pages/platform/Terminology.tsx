import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadWorkbook, norm } from '../../lib/sheet'
import { Tabs } from '../teacher/common'
import { useOrgs } from './SystemViews'
import { loadDictionary, MAPPINGS, MAP_STATUS, type Dictionary, type MapStatus, type Term } from './standards'

// Thuật ngữ chuẩn: Từ điển dữ liệu dùng chung ngành GDĐT (QĐ 2768/QĐ-BGDĐT), đối chiếu với dữ liệu của hệ thống,
// và xuất dữ liệu theo tên kỹ thuật của chuẩn để nộp / liên thông.

type Tab = 'dict' | 'tax' | 'map' | 'export'
const TYPE_VI: Record<string, string> = { String: 'Chuỗi ký tự', Integer: 'Số nguyên', Enumeration: 'Danh mục', Boolean: 'Đúng / sai', Date: 'Ngày tháng', Decimal: 'Số thập phân', Number: 'Số', Object: 'Đối tượng' }
const SHOW = 200

export default function TerminologyPage() {
  const [dict, setDict] = useState<Dictionary | null>(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>('dict')
  const [domain, setDomain] = useState('')
  useEffect(() => { loadDictionary().then(setDict).catch(e => setErr(e.message)) }, [])
  if (err) return <p className="msg">{err}</p>
  if (!dict) return <p className="sub">Đang tải từ điển…</p>
  const mapped = new Set(MAPPINGS.filter(m => m.term && m.status !== 'thieu').map(m => m.term))
  return (
    <>
      <div className="stdhead">
        <div>
          <b>{dict.decision.title}</b>
          <span>Quyết định {dict.decision.no} ngày {new Date(dict.decision.date).toLocaleDateString('vi-VN')} · {dict.domains.length} miền dữ liệu · {dict.terms.length} thuật ngữ</span>
        </div>
        <span className="pill active">Đang hiệu lực</span>
      </div>
      <Tabs value={tab} onChange={setTab} items={[['dict', 'Từ điển thuật ngữ', dict.terms.length], ['tax', 'Phân lớp dữ liệu', dict.domains.length], ['map', 'Đối chiếu hệ thống', MAPPINGS.length], ['export', 'Xuất dữ liệu theo chuẩn']]} />
      {tab === 'dict' && <TermList dict={dict} domain={domain} setDomain={setDomain} mapped={mapped} />}
      {tab === 'tax' && <Taxonomy dict={dict} open={d => { setDomain(d); setTab('dict') }} />}
      {tab === 'map' && <MappingView dict={dict} />}
      {tab === 'export' && <ExportView dict={dict} />}
    </>
  )
}

// ================= Từ điển =================
function TermList({ dict, domain, setDomain, mapped }: { dict: Dictionary; domain: string; setDomain: (d: string) => void; mapped: Set<string | null> }) {
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [only, setOnly] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const dom = useMemo(() => new Map(dict.domains.map(d => [d.code, d])), [dict])
  const needle = norm(q.trim().toLowerCase())
  const list = dict.terms.filter(t => (!domain || t.dom.includes(domain)) && (!type || t.type === type) && (!only || mapped.has(t.code))
    && (!needle || norm(`${t.code} ${t.name} ${t.tech} ${t.def}`.toLowerCase()).includes(needle)))
  async function excel() {
    await downloadWorkbook('tu-dien-du-lieu-QD2768', [{ name: 'Thuật ngữ', columns: [
      { key: 'a', label: 'Mã từ vựng', width: 12 }, { key: 'b', label: 'Tên nghiệp vụ', width: 36 }, { key: 'c', label: 'Định nghĩa', width: 60 },
      { key: 'd', label: 'Ngữ cảnh sử dụng', width: 50 }, { key: 'e', label: 'Miền dữ liệu', width: 16 }, { key: 'f', label: 'Tên miền', width: 36 },
      { key: 'g', label: 'Tên kỹ thuật', width: 28 }, { key: 'h', label: 'Loại dữ liệu', width: 14 }, { key: 'i', label: 'Độ dài', width: 8 }, { key: 'j', label: 'Mã từ vựng cốt lõi', width: 16 }],
      rows: list.map(t => [t.code, t.name, t.def, t.ctx, t.dom.join(', '), t.dom.map(d => dom.get(d)?.name).join('; '), t.tech, t.type, t.len, t.cde]) }])
  }
  return (
    <>
      <div className="bar">
        <span className="tools">
          <input className="search" style={{ margin: 0, minWidth: 260 }} type="search" placeholder="Tìm tên, mã BG_, tên kỹ thuật, định nghĩa…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm thuật ngữ" />
          <label className="pickfield"><span>Miền</span><select style={{ maxWidth: 380 }} value={domain} onChange={e => setDomain(e.target.value)} aria-label="Lọc theo miền dữ liệu">
            <option value="">Tất cả miền</option>
            {dict.domains.filter(d => d.level === 3).map(d => <option key={d.code} value={d.code}>{d.code} · {d.name}</option>)}
          </select></label>
          <label className="pickfield"><span>Kiểu</span><select value={type} onChange={e => setType(e.target.value)} aria-label="Lọc theo kiểu dữ liệu">
            <option value="">Mọi kiểu</option>{Object.entries(TYPE_VI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
          <label className="field inline"><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} /> Chỉ thuật ngữ hệ thống đang dùng</label>
        </span>
        <button onClick={excel} disabled={!list.length}>Xuất Excel ({list.length})</button>
      </div>
      <div className="wrap"><table className="systable termtable">
        <thead><tr><th>Mã</th><th>Tên nghiệp vụ</th><th>Tên kỹ thuật</th><th>Kiểu</th><th>Miền</th></tr></thead>
        <tbody>
          {list.slice(0, SHOW).map(t => <TermRow key={t.code} t={t} open={open === t.code} toggle={() => setOpen(open === t.code ? null : t.code)} dom={dom} used={mapped.has(t.code)} />)}
          {!list.length && <tr><td colSpan={5}>Không có thuật ngữ phù hợp.</td></tr>}
        </tbody>
      </table></div>
      {list.length > SHOW && <p className="sub">Hiện {SHOW}/{list.length} thuật ngữ — tìm hoặc lọc để thu hẹp, hoặc Xuất Excel để xem đủ.</p>}
    </>
  )
}

function TermRow({ t, open, toggle, dom, used }: { t: Term; open: boolean; toggle: () => void; dom: Map<string, Dictionary['domains'][number]>; used: boolean }) {
  return <>
    <tr className="clickrow" onClick={toggle} aria-expanded={open}>
      <td><code>{t.code}</code></td>
      <td><b>{t.name}</b>{used && <> <span className="pill active" title="Hệ thống đang lưu dữ liệu này">Đang dùng</span></>}</td>
      <td><code>{t.tech}</code></td>
      <td>{TYPE_VI[t.type] ?? t.type}{t.len ? <small> · {t.len}</small> : null}</td>
      <td><small>{t.dom.join(', ')}</small></td>
    </tr>
    {open && <tr className="termdetail"><td colSpan={5}><dl>
      <dt>Định nghĩa</dt><dd>{t.def}</dd>
      <dt>Ngữ cảnh sử dụng</dt><dd>{t.ctx}</dd>
      <dt>Miền dữ liệu</dt><dd>{t.dom.map(d => `${d} · ${dom.get(d)?.name ?? ''}`).join('; ')}</dd>
      <dt>Kiểu dữ liệu</dt><dd>{t.tvi} ({t.type}){t.len ? `, độ dài ${t.len}` : ''}</dd>
      {t.cde && <><dt>Mã từ vựng cốt lõi</dt><dd><code>{t.cde}</code> (theo Từ điển dữ liệu dùng chung quốc gia)</dd></>}
    </dl></td></tr>}
  </>
}

// ================= Phân lớp =================
function Taxonomy({ dict, open }: { dict: Dictionary; open: (d: string) => void }) {
  const count = useMemo(() => dict.terms.reduce((m, t) => { t.dom.forEach(d => m.set(d, (m.get(d) ?? 0) + 1)); return m }, new Map<string, number>()), [dict])
  const l2 = dict.domains.filter(d => d.level === 2)
  return (
    <div className="taxgrid">
      {l2.map(p => {
        const kids = dict.domains.filter(d => d.level === 3 && d.parent === p.name)
        const total = kids.reduce((s, k) => s + (count.get(k.code) ?? 0), 0)
        return <section key={p.code} className="panel taxcard">
          <header><span><code>{p.code}</code>{p.group && <small> · {p.group}</small>}</span><b>{p.name}</b><small>{p.desc}</small><em>{total} thuật ngữ</em></header>
          <ul>{kids.map(k => <li key={k.code}><button className="xbtn" onClick={() => open(k.code)} disabled={!count.get(k.code)} title={k.desc}>
            <code>{k.code}</code><span>{k.name}</span><b>{count.get(k.code) ?? 0}</b></button></li>)}</ul>
        </section>
      })}
      <p className="sub" style={{ gridColumn: '1 / -1' }}>Đơn vị quản lý và chủ sở hữu dữ liệu của mọi miền: {dict.domains[0]?.unit} — {dict.domains[0]?.owner}. Bấm một miền để xem thuật ngữ.</p>
    </div>
  )
}

// ================= Đối chiếu =================
function MappingView({ dict }: { dict: Dictionary }) {
  const [st, setSt] = useState<MapStatus | ''>('')
  const term = useMemo(() => new Map(dict.terms.map(t => [t.code, t])), [dict])
  const n = (s: MapStatus) => MAPPINGS.filter(m => m.status === s).length
  const withTerm = MAPPINGS.filter(m => m.term)
  const covered = withTerm.filter(m => m.status !== 'thieu').length
  const list = MAPPINGS.filter(m => !st || m.status === st)
  const entities = [...new Set(list.map(m => m.entity))]
  async function excel() {
    await downloadWorkbook('doi-chieu-QD2768-KSCHOOL', [{ name: 'Đối chiếu', columns: [
      { key: 'a', label: 'Nhóm', width: 22 }, { key: 'b', label: 'Dữ liệu trên hệ thống', width: 30 }, { key: 'c', label: 'Nguồn (bảng.cột)', width: 30 },
      { key: 'd', label: 'Mã từ vựng', width: 12 }, { key: 'e', label: 'Thuật ngữ QĐ 2768', width: 36 }, { key: 'f', label: 'Tên kỹ thuật', width: 26 },
      { key: 'g', label: 'Mức đáp ứng', width: 14 }, { key: 'h', label: 'Ghi chú', width: 60 }],
      rows: MAPPINGS.map(m => [m.entity, m.field, m.source, m.term, m.term ? term.get(m.term)?.name : '', m.term ? term.get(m.term)?.tech : '', MAP_STATUS[m.status][0], m.note]) }])
  }
  return (
    <>
      <div className="cards syscards">
        <div className="card"><strong>{covered}/{withTerm.length}</strong><span>Thuật ngữ liên quan hệ thống đã đáp ứng</span></div>
        {(Object.keys(MAP_STATUS) as MapStatus[]).map(s => <div key={s} className="card"><strong>{n(s)}</strong><span>{MAP_STATUS[s][0]}</span></div>)}
      </div>
      <div className="bar" style={{ marginTop: 14 }}>
        <span className="tools">
          <button className={'chipbtn' + (!st ? ' on' : '')} onClick={() => setSt('')}>Tất cả ({MAPPINGS.length})</button>
          {(Object.keys(MAP_STATUS) as MapStatus[]).map(s => <button key={s} className={'chipbtn' + (st === s ? ' on' : '')} onClick={() => setSt(s)}>{MAP_STATUS[s][0]} ({n(s)})</button>)}
        </span>
        <button onClick={excel}>Xuất Excel</button>
      </div>
      <p className="sub" style={{ margin: '0 0 10px' }}>
        <b>Khớp</b>: cùng nghĩa, cùng kiểu. <b>Tương đương</b>: cùng nghĩa, cần chuyển định dạng / danh mục khi trao đổi. <b>Tính được</b>: tổng hợp từ dữ liệu có sẵn.
        <b> Chưa lưu</b>: thuật ngữ của Bộ hệ thống chưa thu thập. <b>Riêng hệ thống</b>: dữ liệu STEM chưa có thuật ngữ trong từ điển.
      </p>
      <div className="wrap"><table className="systable">
        <thead><tr><th>Dữ liệu trên hệ thống</th><th>Nguồn</th><th>Thuật ngữ QĐ 2768</th><th>Mức đáp ứng</th><th>Ghi chú</th></tr></thead>
        <tbody>{entities.map(e => <Fragment key={e}>
          <tr className="grouprow"><td colSpan={5}>{e}</td></tr>
          {list.filter(m => m.entity === e).map(m => { const t = m.term ? term.get(m.term) : null
            return <tr key={e + m.field}>
              <td><b>{m.field}</b></td><td><code className="src">{m.source}</code></td>
              <td>{t ? <><code>{t.code}</code> {t.name}<br /><small><code>{t.tech}</code> · {TYPE_VI[t.type] ?? t.type}{t.len ? ` ${t.len}` : ''}</small></> : <small>—</small>}</td>
              <td><span className={'pill ' + MAP_STATUS[m.status][1]}>{MAP_STATUS[m.status][0]}</span></td>
              <td style={{ whiteSpace: 'normal', maxWidth: 380 }}><small>{m.note}</small></td>
            </tr> })}
        </Fragment>)}</tbody>
      </table></div>
    </>
  )
}

// ================= Xuất theo chuẩn =================
type Field = { term: string; get: (r: any) => string | number | null | undefined; source: string }
type Entity = { key: string; label: string; table: string; select: string; order: string; fields: Field[]; schoolOnly?: boolean; extra?: (rows: any[], ids: string[] | null) => Promise<void> }
const LEVEL: Record<string, string> = { mamnon: 'Mầm non', tieuhoc: 'Tiểu học', thcs: 'Trung học cơ sở', thpt: 'Trung học phổ thông' }
const S_ST: Record<string, string> = { studying: 'Đang học', transferred: 'Chuyển trường', graduated: 'Đã tốt nghiệp' }
const MODE: Record<string, string> = { online: 'Trực tuyến', offline: 'Trực tiếp', hybrid: 'Kết hợp' }

function entities(orgName: (id: string) => string, orgCode: (id: string) => string, region: (id: string) => string): Entity[] {
  const school: Field[] = [{ term: 'BG_00419', get: r => orgCode(r.org_id), source: 'organizations.code' }, { term: 'BG_00421', get: r => orgName(r.org_id), source: 'organizations.name' }]
  return [
    { key: 'school', label: 'Cơ sở giáo dục', table: 'organizations', select: 'id, name, code, level, ward, address, lat, lng, type', order: 'name', schoolOnly: true, fields: [
      { term: 'BG_00419', get: r => r.code, source: 'organizations.code' }, { term: 'BG_00421', get: r => r.name, source: 'organizations.name' },
      { term: 'BG_00422', get: r => LEVEL[r.level] ?? r.level, source: 'organizations.level' }, { term: 'BG_00417', get: r => region(r.id), source: 'Sở cha' },
      { term: 'BG_00427', get: r => r.ward, source: 'organizations.ward' }, { term: 'BG_00428', get: r => r.address, source: 'organizations.address' },
      { term: 'BG_00439', get: r => (r.lat != null ? `${r.lat},${r.lng}` : null), source: 'organizations.lat, lng' }] },
    { key: 'class', label: 'Lớp học', table: 'classes', select: 'id, org_id, name, grade, academic_years(name), teachers(full_name)', order: 'name', fields: [
      ...school, { term: 'BG_00821', get: r => r.academic_years?.name, source: 'academic_years.name' }, { term: 'BG_00505', get: r => r.name, source: 'classes.name' },
      { term: 'BG_00506', get: r => r.grade, source: 'classes.grade' }, { term: 'BG_00311', get: r => r.teachers?.full_name, source: 'classes.homeroom_teacher_id' }] },
    { key: 'student', label: 'Người học', table: 'students', select: 'id, org_id, full_name, status, classes(name, grade, academic_years(name))', order: 'full_name', fields: [
      ...school, { term: 'BG_00007', get: r => r.full_name, source: 'students.full_name' }, { term: 'BG_00821', get: r => r.classes?.academic_years?.name, source: 'academic_years.name' },
      { term: 'BG_00505', get: r => r.classes?.name, source: 'classes.name' }, { term: 'BG_00506', get: r => r.classes?.grade, source: 'classes.grade' },
      { term: 'BG_00090', get: r => S_ST[r.status] ?? r.status, source: 'students.status' },
      { term: 'BG_00106', get: r => r._excused ?? 0, source: 'lesson_attendance: excused' }, { term: 'BG_00107', get: r => r._absent ?? 0, source: 'lesson_attendance: absent' }],
      extra: async (rows, ids) => {
        const by = new Map(rows.map(r => [r.id, r]))
        for (let from = 0; from < 200000; from += 1000) {
          let q: any = supabase.from('lesson_attendance').select('student_id, status').in('status', ['absent', 'excused']).range(from, from + 999)
          if (ids) q = ids.length === 1 ? q.eq('org_id', ids[0]) : q.in('org_id', ids)
          const { data } = await q
          ;(data ?? []).forEach((a: any) => { const r = by.get(a.student_id); if (r) r[a.status === 'excused' ? '_excused' : '_absent'] = (r[a.status === 'excused' ? '_excused' : '_absent'] ?? 0) + 1 })
          if (!data || data.length < 1000) break
        }
      } },
    { key: 'teacher', label: 'Nhà giáo', table: 'teachers', select: 'id, org_id, full_name, email, subject, status', order: 'full_name', fields: [
      ...school, { term: 'BG_00238', get: r => r.full_name, source: 'teachers.full_name' }, { term: 'BG_00257', get: r => r.email, source: 'teachers.email' },
      { term: 'BG_00297', get: r => r.subject, source: 'teachers.subject' }, { term: 'BG_00256', get: r => (r.status === 'active' ? 'Đang làm việc' : 'Ngừng'), source: 'teachers.status' }] },
    { key: 'training', label: 'Tập huấn & chứng chỉ', table: 'certificates', select: 'id, org_id, code, issued_on, teachers(full_name), training_plans(name, provider, mode)', order: 'issued_on', fields: [
      ...school, { term: 'BG_00238', get: r => r.teachers?.full_name, source: 'teachers.full_name' }, { term: 'BG_00346', get: r => r.training_plans?.name, source: 'training_plans.name' },
      { term: 'BG_00347', get: r => r.training_plans?.provider, source: 'training_plans.provider' }, { term: 'BG_00335', get: r => MODE[r.training_plans?.mode] ?? r.training_plans?.mode, source: 'training_plans.mode' },
      { term: 'BG_00350', get: r => r.code, source: 'certificates.code' }, { term: 'BG_00351', get: r => r.issued_on, source: 'certificates.issued_on' }] },
  ]
}

function ExportView({ dict }: { dict: Dictionary }) {
  const { orgs, byId, regionOf, regions } = useOrgs()
  const [region, setRegion] = useState('')
  const [org, setOrg] = useState('')
  const [kind, setKind] = useState('student')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const term = useMemo(() => new Map(dict.terms.map(t => [t.code, t])), [dict])
  const schools = orgs.filter(o => o.type === 'school' && (!region || regionOf(o.id)?.id === region))
  const ents = entities(id => byId.get(id)?.name ?? '', id => byId.get(id)?.code ?? '', id => regionOf(id)?.name ?? '')
  const ent = ents.find(e => e.key === kind)!

  async function run() {
    setBusy(true); setMsg(null)
    try {
      const ids = org ? [org] : region ? schools.map(s => s.id) : null
      const rows: any[] = []
      if (ent.schoolOnly) {
        const want = new Set((ids ?? schools.map(s => s.id)))
        const { data, error } = await supabase.from('organizations').select(ent.select).eq('type', 'school').order('name')
        if (error) throw error
        rows.push(...((data as any[]) ?? []).filter(r => want.has(r.id)))
      } else {
        for (let from = 0; from < 100000; from += 1000) {
          let q: any = supabase.from(ent.table).select(ent.select).order(ent.order).range(from, from + 999)
          if (ids) q = ids.length === 1 ? q.eq('org_id', ids[0]) : q.in('org_id', ids)
          const { data, error } = await q
          if (error) throw error
          rows.push(...((data as any[]) ?? []))
          if (!data || data.length < 1000) break
        }
        if (ent.extra) await ent.extra(rows, ids)
      }
      if (!rows.length) { setMsg(['Không có dữ liệu trong phạm vi đã chọn.', true]); return }
      const scope = org ? byId.get(org)?.name : region ? byId.get(region)?.name : 'toan-he-thong'
      await downloadWorkbook(`QD2768_${ent.key}_${norm(scope ?? '').replace(/\s+/g, '-')}`, [
        { name: ent.label, columns: ent.fields.map(f => ({ key: f.term, label: term.get(f.term)?.tech ?? f.term, width: 22 })), rows: rows.map(r => ent.fields.map(f => f.get(r) ?? null)) },
        { name: 'Chú thích', columns: [{ key: 'a', label: 'Cột (tên kỹ thuật)', width: 26 }, { key: 'b', label: 'Mã từ vựng', width: 12 }, { key: 'c', label: 'Tên nghiệp vụ', width: 36 },
          { key: 'd', label: 'Kiểu dữ liệu chuẩn', width: 18 }, { key: 'e', label: 'Lấy từ', width: 30 }, { key: 'f', label: 'Định nghĩa', width: 70 }],
          rows: [...ent.fields.map(f => { const t = term.get(f.term); return [t?.tech, f.term, t?.name, t ? `${t.type}${t.len ? ' ' + t.len : ''}` : '', f.source, t?.def] }),
            [], [`Theo ${dict.decision.title}, QĐ ${dict.decision.no}. Xuất từ KSCHOOL STEM ngày ${new Date().toLocaleDateString('vi-VN')}.`]] },
      ])
      setMsg([`Đã xuất ${rows.length.toLocaleString('vi-VN')} dòng.`, false])
    } catch (e: any) { setMsg([e.message ?? String(e), true]) } finally { setBusy(false) }
  }

  return (
    <>
      <p className="sub" style={{ marginTop: 0 }}>Tệp Excel dùng <b>tên kỹ thuật</b> của QĐ 2768 làm tên cột (vd. <code>hoTenNh</code>, <code>tenLop</code>), kèm trang "Chú thích" ghi mã từ vựng, định nghĩa và nguồn dữ liệu — dùng để nộp báo cáo hoặc nạp vào hệ thống khác.</p>
      <div className="bar">
        <span className="tools">
          <label className="pickfield"><span>Dữ liệu</span><select value={kind} onChange={e => setKind(e.target.value)} aria-label="Chọn loại dữ liệu">
            {ents.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}</select></label>
          <label className="pickfield"><span>Sở / tỉnh</span><select value={region} onChange={e => { setRegion(e.target.value); setOrg('') }} aria-label="Chọn Sở">
            <option value="">Toàn hệ thống</option>{regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <label className="pickfield"><span>Trường</span><select value={org} onChange={e => setOrg(e.target.value)} aria-label="Chọn trường">
            <option value="">Tất cả ({schools.length})</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        </span>
        <button className="primary" onClick={run} disabled={busy}>{busy ? 'Đang xuất…' : 'Xuất Excel theo chuẩn'}</button>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      <div className="wrap"><table className="systable">
        <thead><tr><th>Cột trong tệp</th><th>Mã từ vựng</th><th>Tên nghiệp vụ</th><th>Kiểu chuẩn</th><th>Lấy từ</th></tr></thead>
        <tbody>{ent.fields.map(f => { const t = term.get(f.term); return <tr key={f.term + f.source}>
          <td><code>{t?.tech}</code></td><td><code>{f.term}</code></td><td>{t?.name}</td><td>{t ? (TYPE_VI[t.type] ?? t.type) + (t.len ? ` · ${t.len}` : '') : ''}</td><td><code className="src">{f.source}</code></td></tr> })}</tbody>
      </table></div>
      {kind === 'student' && <p className="sub">Số buổi nghỉ đếm từ điểm danh các buổi học STEM trên hệ thống, không thay thế sổ điểm danh ngày học của trường.</p>}
    </>
  )
}
