// Nội dung tập huấn: 5 phần như bài học — Nội dung · Bài giảng · Link tài liệu · Định mức vật tư · Kho hoạt động.
// Lưu trong training_program_units.detail (083). Chỉ sửa khi chương trình còn nháp.
import { useState } from 'react'
import { ElView } from '../../components/ElView'

type Row = Record<string, string>
export type Detail = { body?: { goal?: string; text?: string; reqs?: string[] }; lectures?: Row[]; docs?: Row[]; mats?: Row[]; acts?: Row[] }
type Col = { key: string; label: string; type?: 'text' | 'url' | 'number' | 'select'; options?: [string, string][]; width?: number; placeholder?: string }
type ListKey = 'lectures' | 'docs' | 'mats' | 'acts'

const LECT_KIND: [string, string][] = [['slide', 'Slide'], ['video', 'Video'], ['plan', 'Giáo án / kịch bản'], ['other', 'Khác']]
const DOC_KIND: [string, string][] = [['doc', 'Tài liệu đọc'], ['guide', 'Hướng dẫn'], ['form', 'Biểu mẫu'], ['ref', 'Tham khảo']]
const PER: [string, string][] = [['person', 'Mỗi người'], ['group', 'Mỗi nhóm'], ['class', 'Cả lớp']]
const ACT_KIND: [string, string][] = [['warmup', 'Khởi động'], ['explore', 'Khám phá'], ['practice', 'Thực hành'], ['discuss', 'Thảo luận'], ['present', 'Trình bày'], ['quiz', 'Trắc nghiệm'], ['reflect', 'Phản tư']]
const LISTS: Record<ListKey, { tab: string; empty: string; cols: Col[] }> = {
  lectures: { tab: 'Bài giảng', empty: 'Chưa có bài giảng.', cols: [{ key: 'title', label: 'Bài giảng', placeholder: 'VD: Slide quy trình thiết kế kỹ thuật' },
    { key: 'kind', label: 'Loại', type: 'select', options: LECT_KIND, width: 150 }, { key: 'url', label: 'Link', type: 'url', placeholder: 'https://…' },
    { key: 'minutes', label: 'Phút', type: 'number', width: 80 }] },
  docs: { tab: 'Link tài liệu', empty: 'Chưa có tài liệu.', cols: [{ key: 'title', label: 'Tài liệu', placeholder: 'VD: Công văn hướng dẫn STEM' },
    { key: 'kind', label: 'Loại', type: 'select', options: DOC_KIND, width: 150 }, { key: 'url', label: 'Link', type: 'url', placeholder: 'https://…' }, { key: 'note', label: 'Ghi chú' }] },
  mats: { tab: 'Định mức vật tư', empty: 'Chưa có vật tư.', cols: [{ key: 'name', label: 'Vật tư / thiết bị', placeholder: 'VD: Bộ kit Arduino' },
    { key: 'unit', label: 'Đơn vị', width: 100, placeholder: 'bộ' }, { key: 'qty', label: 'Số lượng', type: 'number', width: 100 },
    { key: 'per', label: 'Định mức cho', type: 'select', options: PER, width: 130 }, { key: 'note', label: 'Ghi chú' }] },
  acts: { tab: 'Kho hoạt động', empty: 'Chưa có hoạt động.', cols: [{ key: 'title', label: 'Hoạt động', placeholder: 'VD: Thiết kế cầu giấy chịu lực' },
    { key: 'kind', label: 'Loại', type: 'select', options: ACT_KIND, width: 140 }, { key: 'minutes', label: 'Phút', type: 'number', width: 80 }, { key: 'note', label: 'Mô tả ngắn' }] },
}
const lab = (opts: [string, string][] | undefined, v: string) => opts?.find(o => o[0] === v)?.[1] ?? v
export const detailCount = (d: Detail | null | undefined) => {
  const x = d ?? {}
  return [x.lectures?.length && `${x.lectures.length} bài giảng`, x.docs?.length && `${x.docs.length} tài liệu`, x.mats?.length && `${x.mats.length} vật tư`,
    x.acts?.length && `${x.acts.length} hoạt động`].filter(Boolean).join(' · ')
}

function ListEditor({ cols, rows, edit, empty, onChange }: { cols: Col[]; rows: Row[]; edit: boolean; empty: string; onChange: (r: Row[]) => void }) {
  const set = (i: number, k: string, v: string) => onChange(rows.map((r, j) => j === i ? { ...r, [k]: v } : r))
  return <div className="wrap"><table className="libtable">
    <thead><tr><th style={{ width: 40 }}>STT</th>{cols.map(c => <th key={c.key} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}{edit && <th style={{ width: 50 }}></th>}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>
      <td>{i + 1}</td>
      {cols.map(c => <td key={c.key} style={{ whiteSpace: 'normal' }}>{edit
        ? c.type === 'select' ? <select value={r[c.key] ?? ''} aria-label={c.label} onChange={e => set(i, c.key, e.target.value)}><option value="">—</option>{c.options!.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          : <input value={r[c.key] ?? ''} type={c.type === 'number' ? 'number' : c.type === 'url' ? 'url' : 'text'} min={c.type === 'number' ? 0 : undefined} placeholder={c.placeholder}
            aria-label={c.label} style={{ width: '100%' }} onChange={e => set(i, c.key, e.target.value)} />
        : c.type === 'url' ? (r[c.key] ? <a href={r[c.key]} target="_blank" rel="noreferrer">Mở link ↗</a> : '—')
          : c.type === 'select' ? lab(c.options, r[c.key] ?? '') || '—' : r[c.key] || '—'}</td>)}
      {edit && <td><button type="button" aria-label="Xoá dòng" onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button></td>}
    </tr>)}
      {!rows.length && <tr><td colSpan={cols.length + (edit ? 2 : 1)}><small className="sub">{empty}</small></td></tr>}</tbody>
  </table>
    {edit && <button type="button" style={{ marginTop: 8 }} onClick={() => onChange([...rows, {}])}>+ Thêm dòng</button>}</div>
}

type Tab = 'body' | ListKey
export function ContentDetail({ title, crumb, hours, detail, editable, onBack, onSave }: {
  title: string; crumb: string; hours: number; detail: Detail; editable: boolean; onBack: () => void; onSave: (d: Detail) => Promise<boolean>
}) {
  const [tab, setTab] = useState<Tab>('body')
  const [d, setD] = useState<Detail>(() => JSON.parse(JSON.stringify(detail ?? {})))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const up = (n: Detail) => { setD(n); setDirty(true); setMsg('') }
  const body = d.body ?? {}
  // Bỏ dòng trống trước khi lưu
  const clean = (x: Detail): Detail => ({ ...x, body: { ...x.body, reqs: (x.body?.reqs ?? []).map(s => s.trim()).filter(Boolean) },
    ...Object.fromEntries((Object.keys(LISTS) as ListKey[]).map(k => [k, (x[k] ?? []).filter(r => Object.values(r).some(v => String(v ?? '').trim()))])) })
  async function save() {
    setBusy(true)
    const ok = await onSave(clean(d))
    setBusy(false)
    if (ok) { setDirty(false); setD(clean(d)); setMsg('Đã lưu.') }
  }
  const tabs: [Tab, string, number | null][] = [['body', 'Nội dung', null], ...(Object.keys(LISTS) as ListKey[]).map(k => [k, LISTS[k].tab, d[k]?.length ?? 0] as [Tab, string, number])]
  return <ElView back="Môn & nội dung tập huấn" onBack={() => { if (!dirty || confirm('Bỏ các thay đổi chưa lưu?')) onBack() }} title={title}
    sub={`${crumb} · ${String(hours).replace('.', ',')} giờ`}
    actions={editable && <button type="button" className="primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu'}</button>}>
    {msg && <p className="sub" role="status"><b>{msg}</b></p>}
    {!editable && <p className="sub">Chương trình đã phát hành nên chỉ xem. Muốn sửa thì nhân bản chương trình.</p>}
    <div className="distpills" role="tablist">{tabs.map(([k, l, n]) =>
      <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{n ? ` (${n})` : ''}</button>)}</div>
    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      {tab === 'body' ? (editable ? <>
        <label className="field"><span>Mục tiêu</span><textarea rows={2} value={body.goal ?? ''} onChange={e => up({ ...d, body: { ...body, goal: e.target.value } })} placeholder="Sau nội dung này, giáo viên làm được gì" /></label>
        <label className="field"><span>Nội dung chi tiết</span><textarea rows={8} value={body.text ?? ''} onChange={e => up({ ...d, body: { ...body, text: e.target.value } })} placeholder="Các ý chính, tiến trình tập huấn" /></label>
        <label className="field"><span>Yêu cầu cần đạt (mỗi dòng một yêu cầu)</span><textarea rows={4} value={(body.reqs ?? []).join('\n')} onChange={e => up({ ...d, body: { ...body, reqs: e.target.value.split('\n') } })} /></label>
      </> : <dl className="tpkv">
        <dt>Mục tiêu</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{body.goal || '—'}</dd>
        <dt>Nội dung chi tiết</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{body.text || '—'}</dd>
        <dt>Yêu cầu cần đạt</dt><dd>{body.reqs?.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{body.reqs.map((r, i) => <li key={i}>{r}</li>)}</ul> : '—'}</dd>
      </dl>)
        : <ListEditor cols={LISTS[tab].cols} rows={d[tab] ?? []} edit={editable} empty={LISTS[tab].empty} onChange={r => up({ ...d, [tab]: r })} />}
    </section>
  </ElView>
}
