import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx, type Column } from '../../lib/sheet'
import { Tabs } from '../teacher/common'
import { useDeptStats, byWard, grade, pct, LEVEL, type SchoolStat } from './data'
import { Tiles } from './charts'

type Template = { key: string; code: string; title: string; note: string; columns: Column[]; row: (s: SchoolStat) => (string | number | null)[] }
const short = (n: string) => n.replace(/^Trường\s+/, '')

// Mẫu báo cáo theo văn bản của Bộ GD&ĐT; số liệu lấy trực tiếp từ dữ liệu các trường
export const TEMPLATES: Template[] = [
  { key: 'TT38', code: 'TT38/2023', title: 'Báo cáo thiết bị dạy học', note: 'Thống kê phòng học bộ môn STEM và thiết bị theo trường.',
    columns: [{ key: 'a', label: 'Trường', width: 34 }, { key: 'b', label: 'Xã/phường', width: 14 }, { key: 'c', label: 'Cấp học' }, { key: 'd', label: 'Phòng STEM hoạt động' },
      { key: 'e', label: 'Tổng phòng STEM' }, { key: 'f', label: 'Tổng thiết bị' }, { key: 'g', label: 'Sẵn sàng' }, { key: 'h', label: 'Đang bảo trì' }, { key: 'i', label: 'Hỏng' }, { key: 'j', label: 'Tỉ lệ hỏng (%)' }],
    row: s => [short(s.name), s.ward, LEVEL[s.level ?? ''], s.rooms_active, s.rooms, s.units, s.units_available, s.units_maintenance, s.units_broken, pct(s.units_broken, s.units)] },
  { key: 'TT32', code: 'TT32/2020', title: 'Quy mô trường lớp – Chương trình GDPT', note: 'Lớp, học sinh, giáo viên theo trường.',
    columns: [{ key: 'a', label: 'Trường', width: 34 }, { key: 'b', label: 'Xã/phường', width: 14 }, { key: 'c', label: 'Cấp học' }, { key: 'd', label: 'Số lớp' }, { key: 'e', label: 'Học sinh' },
      { key: 'f', label: 'Giáo viên' }, { key: 'g', label: 'HS / GV' }],
    row: s => [short(s.name), s.ward, LEVEL[s.level ?? ''], s.classes, s.students, s.teachers, s.teachers ? Math.round((s.students / s.teachers) * 10) / 10 : null] },
  { key: 'CV3014', code: 'CV 3014', title: 'Triển khai giáo dục STEM', note: 'Chương trình, lớp, học sinh, giáo viên, tiết STEM, giáo án, dự án.',
    columns: [{ key: 'a', label: 'Trường', width: 34 }, { key: 'b', label: 'Chương trình đang dạy', width: 22 }, { key: 'c', label: 'Lớp STEM' }, { key: 'd', label: 'HS học STEM' },
      { key: 'e', label: 'GV dạy STEM' }, { key: 'f', label: 'Tiết STEM / tuần' }, { key: 'g', label: 'Giáo án GV tự soạn' }, { key: 'h', label: 'Dự án đã giao' }],
    row: s => [short(s.name), s.programs.join(', ') || 'Chưa triển khai', s.stem_classes, s.stem_students, s.stem_teachers, s.stem_periods, s.lesson_plans, s.products] },
  { key: 'TT26', code: 'TT26/2020', title: 'Đánh giá học sinh trong hoạt động STEM', note: 'Bài đánh giá đã chấm và điểm trung bình quy về thang 10.',
    columns: [{ key: 'a', label: 'Trường', width: 34 }, { key: 'b', label: 'Cấp học' }, { key: 'c', label: 'HS học STEM' }, { key: 'd', label: 'Bài đã chấm' }, { key: 'e', label: 'Điểm TB (thang 10)' }],
    row: s => [short(s.name), LEVEL[s.level ?? ''], s.stem_students, s.graded, s.avg_score] },
  { key: 'QUY', code: 'Báo cáo quý', title: 'Báo cáo triển khai STEM theo quý', note: 'KPI tổng hợp và xếp loại từng trường.',
    columns: [{ key: 'a', label: 'Trường', width: 34 }, { key: 'b', label: 'Xã/phường', width: 14 }, { key: 'c', label: 'KPI' }, { key: 'd', label: 'Xếp loại' }, { key: 'e', label: 'Số CT' },
      { key: 'f', label: 'Phòng STEM' }, { key: 'g', label: 'Tiết STEM / lớp' }, { key: 'h', label: 'GV hoàn thành tập huấn (%)' }],
    row: s => [short(s.name), s.ward, s.kpi, grade(s.kpi).label, s.programs.length, s.rooms_active, s.classes ? Math.round((s.stem_periods / s.classes) * 10) / 10 : 0, pct(s.training_done, s.teachers)] },
]
const FORMAT: Record<string, string> = { xlsx: 'Excel', pdf: 'PDF', doc: 'Word' }
const periods = () => {
  const y = new Date().getFullYear(), q = Math.floor(new Date().getMonth() / 3) + 1
  return [`Q${q}/${y}`, `Q${q === 1 ? 4 : q - 1}/${q === 1 ? y - 1 : y}`, `HK I ${y}-${y + 1}`, `Năm học ${y}-${y + 1}`]
}
type Export = { id: string; template: string; title: string; scope: string; period: string; format: string; rows: number; created_at: string }
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

function reportHtml(t: Template, rows: (string | number | null)[][], scope: string, period: string, orgName: string, forWord: boolean) {
  const today = new Date().toLocaleDateString('vi-VN')
  return `<!doctype html><html lang="vi"${forWord ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"' : ''}><head><meta charset="utf-8"><title>${esc(t.title)}</title>
<style>body{font-family:"Times New Roman",serif;font-size:13pt;margin:24px}.hd{display:flex;justify-content:space-between;text-align:center}
.hd div{width:48%}h1{text-align:center;font-size:15pt;margin:18px 0 4px}p.c{text-align:center;margin:2px 0}
table{border-collapse:collapse;width:100%;margin-top:14px;font-size:11pt}th,td{border:1px solid #000;padding:4px 6px}th{background:#e6eef8}
td.n{text-align:right}.sig{margin-top:30px;text-align:right;padding-right:40px}@media print{body{margin:0}}</style></head><body>
<div class="hd"><div><b>${esc(orgName.toUpperCase())}</b></div><div><b>CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM</b><br><u>Độc lập – Tự do – Hạnh phúc</u></div></div>
<h1>${esc(t.title.toUpperCase())}</h1><p class="c">(Theo ${esc(t.code)}) · Kỳ báo cáo: ${esc(period)} · Phạm vi: ${esc(scope)}</p>
<table><thead><tr><th>STT</th>${t.columns.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
${rows.map((r, i) => `<tr><td class="n">${i + 1}</td>${r.map(v => `<td${typeof v === 'number' ? ' class="n"' : ''}>${esc(v ?? '')}</td>`).join('')}</tr>`).join('')}
</tbody></table><p class="sig"><i>Hưng Yên, ngày ${today}</i><br><b>NGƯỜI LẬP BÁO CÁO</b></p></body></html>`
}

export function DeptReports({ orgId }: { orgId: string | null }) {
  const { schools, loading, err } = useDeptStats()
  const [tpl, setTpl] = useState(TEMPLATES[0].key)
  const [scope, setScope] = useState('Toàn tỉnh')
  const [period, setPeriod] = useState(periods()[0])
  const [format, setFormat] = useState<'xlsx' | 'pdf' | 'doc'>('xlsx')
  const [history, setHistory] = useState<Export[]>([])
  const [orgName, setOrgName] = useState('Sở GD&ĐT')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function loadHistory() {
    const { data } = await supabase.from('report_exports').select('*').order('created_at', { ascending: false }).limit(30)
    setHistory((data as Export[]) ?? [])
  }
  useEffect(() => {
    loadHistory()
    if (orgId) supabase.from('organizations').select('name').eq('id', orgId).maybeSingle().then(({ data }) => data && setOrgName(data.name))
  }, [orgId])
  if (loading || err) return <p className="sub">{err || 'Đang tổng hợp số liệu…'}</p>

  const t = TEMPLATES.find(x => x.key === tpl)!
  const wards = byWard(schools).map(w => w.ward).sort((a, b) => a.localeCompare(b, 'vi'))
  async function generate(e?: React.FormEvent, again?: Export) {
    e?.preventDefault()
    const T = again ? TEMPLATES.find(x => x.key === again.template)! : t
    const sc = again?.scope ?? scope, pe = again?.period ?? period, fm = (again?.format ?? format) as 'xlsx' | 'pdf' | 'doc'
    const rows = schools.filter(s => sc === 'Toàn tỉnh' || s.ward === sc).map(T.row)
    const file = `${T.key}-${pe}-${sc}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^\w-]+/g, '-')
    setBusy(true); setMsg('')
    try {
      if (fm === 'xlsx') await downloadXlsx(file, T.columns, rows, T.code.slice(0, 30))
      else if (fm === 'doc') {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob(['﻿' + reportHtml(T, rows, sc, pe, orgName, true)], { type: 'application/msword' }))
        a.download = file + '.doc'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      } else {
        const w = window.open('', '_blank')
        if (!w) { setBusy(false); return setMsg('Trình duyệt chặn cửa sổ mới. Hãy cho phép cửa sổ bật lên để in / lưu PDF.') }
        w.document.write(reportHtml(T, rows, sc, pe, orgName, false)); w.document.close(); w.focus(); setTimeout(() => w.print(), 400)
      }
      if (!again && orgId) {
        const { data: u } = await supabase.auth.getUser()
        await supabase.from('report_exports').insert({ org_id: orgId, template: T.key, title: T.title, scope: sc, period: pe, format: fm, rows: rows.length, created_by: u.user?.id })
        loadHistory()
      }
      setMsg(`Đã tạo “${T.title}” (${rows.length} trường, ${FORMAT[fm]}).${fm === 'pdf' ? ' Chọn “Lưu thành PDF” trong hộp thoại in.' : ''}`)
    } finally { setBusy(false) }
  }

  return (
    <>
      <Tiles items={[
        { label: 'Mẫu báo cáo', value: TEMPLATES.length, sub: 'theo văn bản của Bộ' },
        { label: 'Báo cáo đã xuất', value: history.length, sub: 'gần nhất' },
        { label: 'Trường trong phạm vi', value: schools.filter(s => scope === 'Toàn tỉnh' || s.ward === scope).length, sub: scope },
        { label: 'Kỳ báo cáo', value: period, sub: 'đang chọn' },
      ]} />
      <div className="twocol">
        <form className="panel reportform" onSubmit={generate}>
          <h3>Tạo báo cáo mới</h3>
          <fieldset><legend>Mẫu theo thông tư *</legend>
            {TEMPLATES.map(x => (
              <label key={x.key} className={'tplrow' + (tpl === x.key ? ' on' : '')}>
                <input type="radio" name="tpl" checked={tpl === x.key} onChange={() => setTpl(x.key)} />
                <span><b>{x.code} — {x.title}</b><br /><small>{x.note}</small></span>
              </label>
            ))}
          </fieldset>
          <div className="formgrid">
            <label className="field"><span>Phạm vi</span>
              <select value={scope} onChange={e => setScope(e.target.value)}><option>Toàn tỉnh</option>{wards.map(w => <option key={w}>{w}</option>)}</select></label>
            <label className="field"><span>Kỳ báo cáo</span>
              <select value={period} onChange={e => setPeriod(e.target.value)}>{periods().map(p => <option key={p}>{p}</option>)}</select></label>
          </div>
          <span className="field"><span>Định dạng xuất</span>
            <Tabs value={format} onChange={setFormat} items={[['xlsx', 'Excel'], ['pdf', 'PDF'], ['doc', 'Word']]} /></span>
          <button className="primary" type="submit" disabled={busy}>{busy ? 'Đang tạo…' : '⬇ Tạo & tải báo cáo'}</button>
          {msg && <p className="sub" style={{ margin: 0 }}><b>{msg}</b></p>}
        </form>
        <div className="panel">
          <h3>Báo cáo đã xuất</h3>
          {history.map(h => (
            <div className="roomrow" key={h.id}>
              <span><b>{h.title}</b><br /><small>{TEMPLATES.find(x => x.key === h.template)?.code} · {h.period} · {h.scope} · {h.rows} trường · {new Date(h.created_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</small></span>
              <button onClick={() => generate(undefined, h)} title="Tạo lại với số liệu hiện tại">⬇ {FORMAT[h.format]}</button>
            </div>
          ))}
          {history.length === 0 && <small>Chưa xuất báo cáo nào.</small>}
        </div>
      </div>
      <p className="sub" style={{ marginTop: 10 }}><small>Số liệu lấy trực tiếp từ dữ liệu các trường tại thời điểm tạo. Tải lại một báo cáo cũ sẽ dùng số liệu hiện tại.</small></p>
    </>
  )
}
