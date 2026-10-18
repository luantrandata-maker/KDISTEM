import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadWorkbook } from '../../lib/sheet'
import { Tiles } from '../department/charts'

// Nghiệm thu & doanh thu (migration 046): đợt nghiệm thu / thanh toán theo hợp đồng, tổng hợp doanh thu theo năm.
type Row = { contract_id: string; code: string; org_id: string; org_name: string; plan_name: string; status: string; starts_on: string; ends_on: string | null
  value: number; planned: number; accepted: number; invoiced: number; paid: number; outstanding: number; milestones: number; overdue: number; next_due: string | null }
type M = { id: string; contract_id: string; seq: number; name: string; due_on: string | null; amount: number; status: string; accepted_on: string | null; acceptance_note: string | null
  invoice_no: string | null; invoiced_on: string | null; paid_on: string | null; paid_amount: number | null; note: string | null }
const MS: Record<string, [string, string]> = { planned: ['Kế hoạch', 'mute'], accepted: ['Đã nghiệm thu', 'info'], invoiced: ['Đã xuất HĐ', 'bad'], paid: ['Đã thu', 'ok'], cancelled: ['Huỷ', 'mute'] }
const C_STATUS: Record<string, string> = { draft: 'Nháp', active: 'Hiệu lực', suspended: 'Tạm dừng', ended: 'Kết thúc' }
const money = (n: number | null | undefined) => (n == null ? '—' : Math.round(Number(n)).toLocaleString('vi-VN') + ' đ')
const short = (n: number) => (n >= 1e9 ? (n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tỷ' : n >= 1e6 ? (n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr' : n.toLocaleString('vi-VN'))
const day = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('vi-VN') : '—')
const today = () => new Date().toISOString().slice(0, 10)
const addMonths = (d: string, n: number) => { const x = new Date(d + 'T00:00:00'); x.setMonth(x.getMonth() + n); return x.toISOString().slice(0, 10) }
const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 046 trên Supabase.' : /row-level|Chỉ quản trị/i.test(m) ? 'Chỉ quản trị nền tảng (KDI) xem và ghi được.' : m)

// Biểu đồ cột theo tháng: dự kiến thu (theo hạn) và đã thu (theo ngày thu)
function MonthBars({ year, ms }: { year: number; ms: M[] }) {
  const due = Array(12).fill(0), paid = Array(12).fill(0)
  ms.forEach(m => {
    if (m.status !== 'cancelled' && m.due_on?.startsWith(String(year))) due[+m.due_on.slice(5, 7) - 1] += Number(m.amount)
    if (m.status === 'paid' && m.paid_on?.startsWith(String(year))) paid[+m.paid_on.slice(5, 7) - 1] += Number(m.paid_amount ?? m.amount)
  })
  const max = Math.max(1, ...due, ...paid)
  return (
    <div className="panel">
      <h3 style={{ margin: 0 }}>Dòng tiền theo tháng · {year}</h3>
      <div className="mlegend" style={{ marginTop: 4 }}><i style={{ background: 'var(--accent)' }} /> Dự kiến thu (theo hạn) <i style={{ background: 'var(--ok)', marginLeft: 12 }} /> Đã thu</div>
      <div className="mbars" role="img" aria-label={`Dự kiến thu và đã thu theo tháng năm ${year}`}>
        {due.map((d, i) => (
          <div key={i} className="mcol" title={`Tháng ${i + 1}: dự kiến ${money(d)} · đã thu ${money(paid[i])}`}>
            <div className="mpair"><span style={{ height: (100 * d) / max + '%', background: 'var(--accent)' }} /><span style={{ height: (100 * paid[i]) / max + '%', background: 'var(--ok)' }} /></div>
            <small>T{i + 1}</small>
          </div>
        ))}
      </div>
    </div>
  )
}

// Lệ phí cuộc thi (051): tổng hợp theo cuộc thi có thu phí
function CompetitionFees({ year }: { year: number }) {
  const [rows, setRows] = useState<{ competition_id: string; title: string; organizer: string; fee: number; entries: number; paid: number; unpaid: number; waived: number; collected: number; outstanding: number }[]>([])
  useEffect(() => { supabase.rpc('competition_fees', { p_year: year }).then(({ data }) => setRows((data as any[]) ?? [])) }, [year])
  if (!rows.length) return null
  return (
    <div className="panel">
      <b>Lệ phí cuộc thi · {year}</b>
      <div className="wrap"><table><thead><tr><th>Cuộc thi</th><th>Đơn vị tổ chức</th><th>Lệ phí</th><th>Bài</th><th>Đã nộp</th><th>Chưa nộp</th><th>Miễn</th><th>Đã thu</th><th>Còn phải thu</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.competition_id}><td>{r.title}</td><td><small>{r.organizer}</small></td><td>{money(r.fee)}</td><td>{r.entries}</td><td>{r.paid}</td><td>{r.unpaid}</td><td>{r.waived}</td><td>{money(r.collected)}</td><td>{money(r.outstanding)}</td></tr>)}</tbody></table></div>
    </div>
  )
}

export function PlatformRevenue() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [rows, setRows] = useState<Row[]>([])
  const [ms, setMs] = useState<M[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [edit, setEdit] = useState<Partial<M> | null>(null)
  const [split, setSplit] = useState<{ contract: Row; n: number; first: string; every: number } | null>(null)
  const [filter, setFilter] = useState<'all' | 'due' | 'overdue'>('all')
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  async function load() {
    const [r, m] = await Promise.all([supabase.rpc('revenue_overview', { p_year: year }), supabase.from('contract_milestones').select('*').order('seq')])
    if (r.error) setMsg([errText(r.error.message), true])
    setRows((r.data as Row[]) ?? []); setMs((m.data as M[]) ?? [])
  }
  useEffect(() => { load() }, [year])
  const sum = (k: keyof Row) => rows.reduce((a, r) => a + Number(r[k] ?? 0), 0)
  const inYear = ms.filter(m => rows.some(r => r.contract_id === m.contract_id))
  const overdueAmt = inYear.filter(m => !['paid', 'cancelled'].includes(m.status) && m.due_on && m.due_on < today()).reduce((a, m) => a + Number(m.amount), 0)
  const shown = rows.filter(r => filter === 'all' || (filter === 'overdue' ? r.overdue > 0 : r.outstanding > 0))
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit?.contract_id || !edit.name?.trim()) return
    const row = { contract_id: edit.contract_id, seq: Number(edit.seq) || 1, name: edit.name.trim(), due_on: edit.due_on || null, amount: Number(edit.amount) || 0, status: edit.status ?? 'planned',
      accepted_on: edit.accepted_on || null, acceptance_note: edit.acceptance_note || null, invoice_no: edit.invoice_no || null, invoiced_on: edit.invoiced_on || null,
      paid_on: edit.paid_on || null, paid_amount: edit.paid_amount == null || (edit.paid_amount as any) === '' ? null : Number(edit.paid_amount), note: edit.note || null }
    const { error } = edit.id ? await supabase.from('contract_milestones').update(row).eq('id', edit.id) : await supabase.from('contract_milestones').insert(row)
    if (error) return setMsg([errText(error.message), true]); setEdit(null); setMsg(['Đã lưu đợt.', false]); load()
  }
  async function setStatus(m: M, status: string) {
    const { error } = await supabase.from('contract_milestones').update({ status }).eq('id', m.id)
    if (error) return setMsg([errText(error.message), true]); load()
  }
  async function remove(m: M) {
    if (!confirm(`Xoá "${m.name}"?`)) return
    const { error } = await supabase.from('contract_milestones').delete().eq('id', m.id)
    if (error) return setMsg([errText(error.message), true]); load()
  }
  async function doSplit(e: React.FormEvent) {
    e.preventDefault(); if (!split) return
    const n = Math.max(1, Math.min(24, split.n)), base = Math.floor(split.contract.value / n)
    const start = ms.filter(m => m.contract_id === split.contract.contract_id).reduce((a, m) => Math.max(a, m.seq), 0)
    const list = Array.from({ length: n }, (_, i) => ({ contract_id: split.contract.contract_id, seq: start + i + 1, name: `Đợt ${start + i + 1}`, due_on: addMonths(split.first, i * split.every),
      amount: i === n - 1 ? split.contract.value - base * (n - 1) : base }))
    const { error } = await supabase.from('contract_milestones').insert(list)
    if (error) return setMsg([errText(error.message), true]); setSplit(null); setOpen(split.contract.contract_id); setMsg([`Đã tạo ${n} đợt.`, false]); load()
  }
  function excel() {
    const name = (id: string) => rows.find(r => r.contract_id === id)
    downloadWorkbook(`doanh-thu-${year}`, [
      { name: 'Theo hợp đồng', columns: [{ key: 'c', label: 'Mã HĐ' }, { key: 'o', label: 'Khách hàng', width: 30 }, { key: 'p', label: 'Gói', width: 22 }, { key: 's', label: 'Trạng thái' }, { key: 'v', label: 'Giá trị HĐ', width: 16 },
        { key: 'a', label: 'Đã nghiệm thu', width: 16 }, { key: 'i', label: 'Đã xuất HĐ', width: 16 }, { key: 'd', label: 'Đã thu', width: 16 }, { key: 'r', label: 'Còn phải thu', width: 16 }, { key: 'q', label: 'Đợt quá hạn' }],
        rows: rows.map(r => [r.code, r.org_name, r.plan_name, C_STATUS[r.status] ?? r.status, Number(r.value), Number(r.accepted), Number(r.invoiced), Number(r.paid), Number(r.outstanding), r.overdue]) },
      { name: 'Các đợt', columns: [{ key: 'c', label: 'Mã HĐ' }, { key: 'o', label: 'Khách hàng', width: 30 }, { key: 'n', label: 'Đợt', width: 18 }, { key: 'h', label: 'Hạn' }, { key: 'a', label: 'Số tiền', width: 16 },
        { key: 's', label: 'Trạng thái' }, { key: 'nt', label: 'Ngày nghiệm thu' }, { key: 'bb', label: 'Biên bản', width: 24 }, { key: 'hd', label: 'Số hoá đơn' }, { key: 'pt', label: 'Ngày thu' }, { key: 'pa', label: 'Số đã thu', width: 16 }],
        rows: inYear.map(m => [name(m.contract_id)?.code, name(m.contract_id)?.org_name, m.name, day(m.due_on), Number(m.amount), MS[m.status]?.[0], day(m.accepted_on), m.acceptance_note, m.invoice_no, day(m.paid_on), m.paid_amount == null ? null : Number(m.paid_amount)]) },
    ])
  }
  const NEXT: Record<string, [string, string]> = { planned: ['accepted', 'Nghiệm thu'], accepted: ['invoiced', 'Xuất HĐ'], invoiced: ['paid', 'Đã thu'] }
  return (
    <>
      <div className="bar">
        <label className="tools"><span className="sub">Năm</span><select value={year} onChange={e => setYear(+e.target.value)}>{[0, 1, 2, 3].map(k => { const y = new Date().getFullYear() + 1 - k; return <option key={y} value={y}>{y}</option> })}</select></label>
        <span style={{ flex: 1 }} /><button onClick={excel}>Xuất Excel</button>
      </div>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      <Tiles items={[
        { label: 'Giá trị hợp đồng', value: short(sum('value')), sub: `${rows.length} hợp đồng hiệu lực trong năm` },
        { label: 'Đã nghiệm thu', value: short(sum('accepted')), sub: sum('value') ? Math.round((100 * sum('accepted')) / sum('value')) + '% giá trị' : undefined },
        { label: 'Đã xuất hoá đơn', value: short(sum('invoiced')) },
        { label: 'Đã thu', value: short(sum('paid')), tone: 'good', sub: sum('value') ? Math.round((100 * sum('paid')) / sum('value')) + '% giá trị' : undefined },
        { label: 'Còn phải thu', value: short(sum('outstanding')) },
        { label: 'Quá hạn', value: short(overdueAmt), tone: overdueAmt ? 'bad' : undefined, sub: `${rows.reduce((a, r) => a + r.overdue, 0)} đợt` },
      ]} />
      <MonthBars year={year} ms={inYear} />
      <CompetitionFees year={year} />
      {split && (
        <form className="panel formgrid" onSubmit={doSplit}>
          <h3 style={{ gridColumn: '1 / -1', margin: 0 }}>Chia đợt: {split.contract.code} · {money(split.contract.value)}</h3>
          <label className="field"><span>Số đợt</span><input type="number" min={1} max={24} value={split.n} onChange={e => setSplit({ ...split, n: +e.target.value })} /></label>
          <label className="field"><span>Hạn đợt đầu</span><input type="date" value={split.first} onChange={e => setSplit({ ...split, first: e.target.value })} /></label>
          <label className="field"><span>Cách nhau (tháng)</span><input type="number" min={1} max={12} value={split.every} onChange={e => setSplit({ ...split, every: +e.target.value })} /></label>
          <div className="formactions"><button className="primary" type="submit">Tạo đợt</button> <button type="button" onClick={() => setSplit(null)}>Huỷ</button></div>
        </form>
      )}
      {edit && (
        <form className="panel formgrid" onSubmit={save}>
          <h3 style={{ gridColumn: '1 / -1', margin: 0 }}>{edit.id ? 'Sửa đợt' : 'Thêm đợt'} · {rows.find(r => r.contract_id === edit.contract_id)?.code}</h3>
          <label className="field"><span>Tên đợt *</span><input required value={edit.name ?? ''} onChange={e => setEdit({ ...edit, name: e.target.value })} /></label>
          <label className="field"><span>Thứ tự</span><input type="number" min={1} value={edit.seq ?? 1} onChange={e => setEdit({ ...edit, seq: +e.target.value })} /></label>
          <label className="field"><span>Hạn</span><input type="date" value={edit.due_on ?? ''} onChange={e => setEdit({ ...edit, due_on: e.target.value })} /></label>
          <label className="field"><span>Số tiền (đ)</span><input type="number" min={0} value={edit.amount ?? 0} onChange={e => setEdit({ ...edit, amount: +e.target.value })} /></label>
          <label className="field"><span>Trạng thái</span><select value={edit.status ?? 'planned'} onChange={e => setEdit({ ...edit, status: e.target.value })}>{Object.entries(MS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></label>
          <label className="field"><span>Ngày nghiệm thu</span><input type="date" value={edit.accepted_on ?? ''} onChange={e => setEdit({ ...edit, accepted_on: e.target.value })} /></label>
          <label className="field"><span>Biên bản nghiệm thu</span><input value={edit.acceptance_note ?? ''} onChange={e => setEdit({ ...edit, acceptance_note: e.target.value })} placeholder="Số / ngày biên bản, nội dung" /></label>
          <label className="field"><span>Số hoá đơn</span><input value={edit.invoice_no ?? ''} onChange={e => setEdit({ ...edit, invoice_no: e.target.value })} /></label>
          <label className="field"><span>Ngày xuất HĐ</span><input type="date" value={edit.invoiced_on ?? ''} onChange={e => setEdit({ ...edit, invoiced_on: e.target.value })} /></label>
          <label className="field"><span>Ngày thu</span><input type="date" value={edit.paid_on ?? ''} onChange={e => setEdit({ ...edit, paid_on: e.target.value })} /></label>
          <label className="field"><span>Số đã thu (đ)</span><input type="number" min={0} value={edit.paid_amount ?? ''} onChange={e => setEdit({ ...edit, paid_amount: e.target.value === '' ? null : +e.target.value })} placeholder="trống = bằng số tiền đợt" /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Ghi chú</span><input value={edit.note ?? ''} onChange={e => setEdit({ ...edit, note: e.target.value })} /></label>
          <div className="formactions"><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setEdit(null)}>Huỷ</button></div>
        </form>
      )}
      <div className="bar" style={{ marginTop: 12 }}>
        <div className="segmented">{([['all', 'Tất cả'], ['due', 'Còn phải thu'], ['overdue', 'Có đợt quá hạn']] as const).map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}</div>
      </div>
      <div className="wrap"><table>
        <thead><tr><th>Hợp đồng</th><th>Khách hàng</th><th>Giá trị</th><th>Tiến độ thu</th><th>Còn phải thu</th><th>Đợt kế tiếp</th><th /></tr></thead>
        <tbody>{shown.map(r => {
          const list = ms.filter(m => m.contract_id === r.contract_id), pct = r.value ? Math.min(100, Math.round((100 * r.paid) / r.value)) : 0, pctA = r.value ? Math.min(100, Math.round((100 * r.accepted) / r.value)) : 0
          return [
            <tr key={r.contract_id}><td><b>{r.code}</b><br /><small>{r.plan_name} · {C_STATUS[r.status] ?? r.status}</small></td><td>{r.org_name}</td><td className="nowrap">{money(r.value)}</td>
              <td style={{ minWidth: 160 }}><div className="covtrack" title={`Nghiệm thu ${pctA}% · đã thu ${pct}%`} style={{ position: 'relative' }}><i style={{ width: pctA + '%', opacity: 0.35 }} /><i style={{ width: pct + '%', position: 'absolute', left: 0, top: 0, bottom: 0 }} /></div>
                <small>Thu {pct}% · nghiệm thu {pctA}%{r.planned && Math.abs(r.planned - r.value) > 1 ? ` · đợt cộng ${short(r.planned)}/${short(r.value)}` : ''}</small></td>
              <td className="nowrap">{money(r.outstanding)}{r.overdue > 0 && <><br /><span className="plbadge bad">{r.overdue} đợt quá hạn</span></>}</td>
              <td className="nowrap">{day(r.next_due)}</td>
              <td className="nowrap"><button onClick={() => setOpen(open === r.contract_id ? null : r.contract_id)}>{open === r.contract_id ? 'Đóng' : `Đợt (${list.length})`}</button></td></tr>,
            open === r.contract_id && <tr key={r.contract_id + 'd'}><td colSpan={7}>
              <div className="tools" style={{ marginBottom: 6 }}><button onClick={() => setEdit({ contract_id: r.contract_id, seq: list.length + 1, name: `Đợt ${list.length + 1}`, amount: Math.max(0, r.value - r.planned), status: 'planned' })}>+ Đợt</button>
                {!list.length && r.value > 0 && <button onClick={() => setSplit({ contract: r, n: 2, first: r.starts_on > today() ? r.starts_on : today(), every: 6 })}>Chia đều giá trị thành nhiều đợt</button>}</div>
              <table><thead><tr><th>Đợt</th><th>Hạn</th><th>Số tiền</th><th>Trạng thái</th><th>Nghiệm thu</th><th>Hoá đơn</th><th>Đã thu</th><th /></tr></thead>
                <tbody>{list.map(m => { const late = !['paid', 'cancelled'].includes(m.status) && m.due_on && m.due_on < today(); return (
                  <tr key={m.id}><td><b>{m.name}</b>{m.note && <><br /><small>{m.note}</small></>}</td><td className={late ? 'due bad' : ''}>{day(m.due_on)}{late ? ' · quá hạn' : ''}</td><td className="nowrap">{money(m.amount)}</td>
                    <td><span className={'plbadge ' + MS[m.status][1]}>{MS[m.status][0]}</span></td><td>{day(m.accepted_on)}{m.acceptance_note && <><br /><small>{m.acceptance_note}</small></>}</td>
                    <td>{m.invoice_no ?? '—'}{m.invoiced_on && <><br /><small>{day(m.invoiced_on)}</small></>}</td><td className="nowrap">{m.status === 'paid' ? <>{money(m.paid_amount)}<br /><small>{day(m.paid_on)}</small></> : '—'}</td>
                    <td className="nowrap">{NEXT[m.status] && <button className="primary" onClick={() => setStatus(m, NEXT[m.status][0])}>{NEXT[m.status][1]}</button>} <button onClick={() => setEdit(m)}>Sửa</button> <button onClick={() => remove(m)}>Xoá</button></td></tr>) })}
                  {!list.length && <tr><td colSpan={8}>Chưa có đợt nghiệm thu / thanh toán.</td></tr>}</tbody></table>
            </td></tr>,
          ]
        })}
          {!shown.length && <tr><td colSpan={7}>Không có hợp đồng nào trong năm {year}. Lập hợp đồng ở <i>Gói dịch vụ & hợp đồng</i>.</td></tr>}</tbody>
      </table></div>
    </>
  )
}
