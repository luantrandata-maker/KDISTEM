// Điểm bài test của kế hoạch tập huấn (105): mỗi giáo viên một dòng, mỗi bài test một cột.
// Người tổ chức gõ điểm (thang 10) hoặc nhập từ file Excel / CSV (file mẫu tải về, hoặc bảng kết quả xuất từ Google Forms, Azota… có cột email).
// Điểm đọc từ file chỉ điền vào bảng để kiểm tra; bấm "Lưu điểm bài test" mới ghi. Ô để trống = bỏ điểm nhập tay.
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadXlsx, norm, readRows } from '../../lib/sheet'

type TUnit = { id: string; ord: number; subject: string; title: string; kind: 'bank' | 'link'; pass: number; url: string | null }
type Cell = { score: number | null; manual: boolean; opened: string | null; attempts: number }
type TRow = { teacher_id: string; teacher_name: string; email: string | null; org_name: string | null; units: string[]; scores: Record<string, Cell> }

const num = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','))
const key = (t: string, u: string) => `${t}|${u}`
// "8", "7,5", "8 / 10" (Google Forms), "16/20" → thang 10
export function parseScore(raw: string): number | null | undefined {
  const s = raw.trim().replace(',', '.')
  if (!s) return null
  const m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/)
  const v = m ? (Number(m[2]) > 0 ? (Number(m[1]) * 10) / Number(m[2]) : NaN) : Number(s)
  if (!Number.isFinite(v) || v < 0 || v > 10) return undefined
  return Math.round(v * 10) / 10
}

export function TestScores({ planId, planCode, can, only, onSaved }: { planId: string; planCode: string; can: boolean; only: Set<string>; onSaved: () => void }) {
  const [d, setD] = useState<{ units: TUnit[]; rows: TRow[] } | null>(null)
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  function load() {
    supabase.rpc('training_plan_test_scores', { p_plan: planId }).then(({ data, error }) => {
      if (error) { setMsg([/schema cache|does not exist/i.test(error.message) ? 'Hãy chạy migration 105 trên Supabase.' : error.message, true]); setD({ units: [], rows: [] }) }
      else { setD(data as { units: TUnit[]; rows: TRow[] }); setEdit({}) }
    })
  }
  useEffect(load, [planId])
  const units = d?.units ?? []
  const rows = useMemo(() => (d?.rows ?? []).filter(r => only.has(r.teacher_id)), [d, only])
  const cur = (r: TRow, u: TUnit) => r.scores[u.id]?.score ?? null
  const val = (r: TRow, u: TUnit) => edit[key(r.teacher_id, u.id)] ?? num(cur(r, u))
  const dirty = (d?.rows ?? []).flatMap(r => units.filter(u => r.units.includes(u.id)).map(u => [r, u] as [TRow, TUnit]))
    .filter(([r, u]) => { const e = edit[key(r.teacher_id, u.id)]; return e !== undefined && parseScore(e) !== cur(r, u) })
  const label = (u: TUnit) => `${u.ord}. ${u.title}`

  async function save() {
    const bad = dirty.find(([r, u]) => parseScore(edit[key(r.teacher_id, u.id)]) === undefined)
    if (bad) return setMsg([`Điểm của ${bad[0].teacher_name} (${bad[1].title}) không hợp lệ: nhập số từ 0 đến 10.`, true])
    setBusy(true)
    const { data, error } = await supabase.rpc('training_test_scores_set', { p_plan: planId,
      p_rows: dirty.map(([r, u]) => ({ teacher_id: r.teacher_id, unit_id: u.id, score: parseScore(edit[key(r.teacher_id, u.id)]) })) })
    setBusy(false)
    if (error) return setMsg([error.message, true])
    setMsg([`Đã lưu ${data} điểm bài test.`, false]); load(); onSaved()
  }

  function template() {
    downloadXlsx(`Diem-bai-test-${planCode}.xlsx`,
      [{ key: 'n', label: 'Giáo viên', width: 26 }, { key: 'e', label: 'Email', width: 28 }, { key: 'o', label: 'Trường', width: 26 },
       ...units.map(u => ({ key: u.id, label: label(u), width: Math.min(40, Math.max(14, label(u).length + 2)) })), { key: 'id', label: 'Mã hệ thống (không sửa)', width: 38 }],
      (d?.rows ?? []).map(r => [r.teacher_name, r.email, r.org_name, ...units.map(u => (r.units.includes(u.id) ? cur(r, u) : 'không học')), r.teacher_id]), 'Điểm bài test')
  }

  async function importFile(f: File) {
    setMsg(null)
    let data: string[][]
    try { data = await readRows(f) } catch (e) { return setMsg([(e as Error).message, true]) }
    const hi = data.findIndex(r => r.some(h => /email|giao vien|ho ten|ho va ten|ma he thong/.test(norm(h))))
    if (hi < 0) return setMsg(['Không thấy cột Email hoặc Giáo viên trong file.', true])
    const head = data[hi].map(norm)
    const col = (re: RegExp) => head.findIndex(h => re.test(h))
    const cId = col(/^ma he thong/), cEmail = col(/email|dia chi email/), cName = col(/^(giao vien|ho ten|ho va ten|ten)$/)
    // Cột điểm: tiêu đề trùng tên bài test; nếu kế hoạch chỉ có một bài test thì nhận cả cột "Điểm" / "Score" / "Tổng điểm"
    const cols = new Map<string, number>()
    units.forEach(u => { const i = head.findIndex(h => h === norm(label(u)) || h === norm(u.title)); if (i >= 0) cols.set(u.id, i) })
    if (!cols.size && units.length === 1) { const i = col(/^(diem|score|total score|tong diem|diem so|ket qua)$/); if (i >= 0) cols.set(units[0].id, i) }
    if (!cols.size) return setMsg([`Không thấy cột điểm. Đặt tiêu đề cột trùng tên bài test (${units.map(label).join('; ')}) hoặc dùng file mẫu.`, true])
    const all = d?.rows ?? []
    const byEmail = new Map(all.filter(r => r.email).map(r => [r.email!.trim().toLowerCase(), r]))
    const byName = new Map<string, TRow | null>()
    all.forEach(r => { const k = norm(r.teacher_name); byName.set(k, byName.has(k) ? null : r) })
    const next = { ...edit }; let n = 0; const miss: string[] = []; const bad: string[] = []
    data.slice(hi + 1).forEach((line, i) => {
      const id = cId >= 0 ? line[cId]?.trim() : ''
      const em = cEmail >= 0 ? line[cEmail]?.trim().toLowerCase() : ''
      const nm = cName >= 0 ? norm(line[cName] ?? '') : ''
      const r = all.find(x => x.teacher_id === id) ?? (em ? byEmail.get(em) : undefined) ?? (nm ? byName.get(nm) ?? undefined : undefined)
      if (!r) { miss.push(`dòng ${hi + i + 2}${em ? ` (${em})` : nm ? ` (${line[cName]})` : ''}`); return }
      cols.forEach((ci, uid) => {
        const raw = line[ci] ?? ''
        if (!r.units.includes(uid) || norm(raw) === 'khong hoc') return
        const v = parseScore(raw)
        if (v === undefined) { bad.push(`${r.teacher_name}: "${raw}"`); return }
        if (v === null) return
        next[key(r.teacher_id, uid)] = String(v).replace('.', ','); n++
      })
    })
    setEdit(next)
    setMsg([`Đã đọc ${n} điểm từ file, kiểm tra rồi bấm "Lưu điểm bài test".`
      + (miss.length ? ` Không khớp giáo viên ${miss.length} dòng: ${miss.slice(0, 4).join('; ')}${miss.length > 4 ? '…' : ''}.` : '')
      + (bad.length ? ` Bỏ qua ${bad.length} điểm không hợp lệ: ${bad.slice(0, 3).join('; ')}.` : ''), miss.length + bad.length > 0])
  }

  if (!d) return <p className="sub">Đang tải…</p>
  if (!units.length) return <p className="sub">Kế hoạch chưa có bài test. Bật "Có bài test" cho nội dung ở Chương trình tập huấn, chọn làm trong hệ thống hoặc làm qua link.</p>
  return <div style={{ display: 'grid', gap: 10 }}>
    <div className="tools" style={{ flexWrap: 'wrap' }}>
      <button type="button" onClick={template}>Tải file mẫu (Excel)</button>
      {can && <><button type="button" onClick={() => file.current?.click()}>Nhập điểm từ file…</button>
        <input ref={file} type="file" accept=".xlsx,.csv" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f) }} />
        <button type="button" className="primary" disabled={!dirty.length || busy} onClick={save}>{busy ? 'Đang lưu…' : `Lưu điểm bài test${dirty.length ? ` (${dirty.length})` : ''}`}</button>
        {dirty.length > 0 && <button type="button" onClick={() => { setEdit({}); setMsg(null) }}>Huỷ thay đổi</button>}</>}
    </div>
    {msg && <p className={msg[1] ? 'warnline' : 'sub'} role="status"><b>{msg[0]}</b></p>}
    <div className="wrap"><table className="libtable trtesttable">
      <thead><tr><th>Giáo viên</th>{units.map(u => <th key={u.id} title={u.subject}>{label(u)}<br />
        <small className="sub">{u.kind === 'link' ? <>qua link{u.url && <> · <a href={u.url} target="_blank" rel="noreferrer">mở ↗</a></>}</> : 'trong hệ thống'} · đạt ≥ {num(u.pass)}</small></th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.teacher_id}>
        <td><b>{r.teacher_name}</b><br /><small className="sub">{[r.org_name, r.email].filter(Boolean).join(' · ') || '—'}</small></td>
        {units.map(u => { const c = r.scores[u.id], v = val(r, u), p = parseScore(v)
          if (!r.units.includes(u.id)) return <td key={u.id}><small className="sub">Không học</small></td>
          return <td key={u.id}>
            {can ? <input className={'trscore' + (p === undefined ? ' bad' : '')} inputMode="decimal" placeholder="0–10" value={v} aria-label={`Điểm ${u.title} của ${r.teacher_name}`}
              onChange={e => setEdit(x => ({ ...x, [key(r.teacher_id, u.id)]: e.target.value }))} /> : <b>{num(c?.score) || '—'}</b>}
            {p != null && p !== undefined && <span className={p >= u.pass ? 'tlok' : 'warnline'}> {p >= u.pass ? '✓' : '✗'}</span>}
            <br /><small className="sub">{c?.manual ? 'nhập tay' : c?.attempts ? `tự làm ${c.attempts} lượt` : u.kind === 'link' ? (c?.opened ? 'đã mở bài' : 'chưa mở bài') : 'chưa làm'}</small>
          </td> })}
      </tr>)}
        {!rows.length && <tr><td colSpan={units.length + 1}><small className="sub">Không có giáo viên nào khớp.</small></td></tr>}</tbody>
    </table></div>
    <small className="sub">Thang 10, nhận cả dạng "8/10" của Google Forms. Ô để trống rồi lưu thì bỏ điểm nhập tay (bài làm trong hệ thống quay về điểm cao nhất giáo viên tự làm).
      Nhập từ file: khớp giáo viên theo cột Email (hoặc Giáo viên), cột điểm đặt tên trùng tên bài test.</small>
  </div>
}
