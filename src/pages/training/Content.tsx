// Nội dung đào tạo: 5 phần như bài học — Nội dung · Bài giảng · Link tài liệu · Định mức vật tư · Kho hoạt động.
// Lưu trong training_program_units.detail (083). Chỉ sửa khi chương trình còn nháp.
import { LEVEL as ELEVEL } from '../elearning/common'
import { QuestionPicker } from '../../components/QuestionPicker'
import { TryButton } from '../../components/ExamTryout'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { ElView } from '../../components/ElView'
import { openFile } from '../../lib/files'

type Row = Record<string, string>
// test: bài kiểm tra (086) — câu hỏi từ Ngân hàng câu hỏi E-learning; count = số câu rút ngẫu nhiên mỗi lượt
// kind 'link' (105): làm bài qua link ngoài (Google Forms, Azota…), người tổ chức nhập điểm ở Kết quả đào tạo
export type TestCfg = { kind?: 'bank' | 'link'; qids?: string[]; count?: number | null; minutes?: number | null; attempts?: number | null; pass?: number | null
  url?: string | null; due?: string | null; note?: string | null; mode?: 'self' | 'trainer' }
export type Detail = { body?: { goal?: string; text?: string; reqs?: string[] }; lectures?: Row[]; docs?: Row[]; mats?: Row[]; acts?: Row[]; test?: TestCfg }
/** Cách làm bài (129): học viên tự làm, hoặc giảng viên mở đề trong / sau buổi dạy */
export function ExamModePick({ value, edit, onChange }: { value?: 'self' | 'trainer'; edit: boolean; onChange: (v: 'self' | 'trainer') => void }) {
  const v = value === 'trainer' ? 'trainer' : 'self'
  return <div className="field"><span>Ai mở đề</span>
    <div className="distpills" role="radiogroup" aria-label="Ai mở đề" style={{ margin: 0 }}>
      {([['self', 'Học viên tự làm khi học xong'], ['trainer', 'Giảng viên mở đề']] as ['self' | 'trainer', string][]).map(([k, l]) =>
        <button key={k} type="button" role="radio" aria-checked={v === k} className={v === k ? 'on' : ''} disabled={!edit} onClick={() => onChange(k)}>{l}</button>)}</div>
    <small className="sub">{v === 'trainer' ? 'Nhà giáo chỉ vào làm khi giảng viên bấm "Mở đề" ở buổi học (trong hoặc sau khi dạy). Kế hoạch đào tạo có thể đặt chung cho cả khoá.'
      : 'Nhà giáo tự học nội dung rồi làm bài, nộp bài lúc nào cũng được. Kế hoạch đào tạo có thể đặt chung cho cả khoá.'}</small></div>
}
type Col = { key: string; label: string; type?: 'text' | 'url' | 'number' | 'select'; options?: [string, string][]; width?: number; placeholder?: string }
export type ListKey = 'lectures' | 'docs' | 'mats' | 'acts'

const LECT_KIND: [string, string][] = [['slide', 'Slide'], ['video', 'Video'], ['plan', 'Giáo án / kịch bản'], ['other', 'Khác']]
const DOC_KIND: [string, string][] = [['doc', 'Tài liệu đọc'], ['guide', 'Hướng dẫn'], ['form', 'Biểu mẫu'], ['ref', 'Tham khảo']]
const PER: [string, string][] = [['person', 'Mỗi người'], ['group', 'Mỗi nhóm'], ['class', 'Cả lớp']]
const ACT_KIND: [string, string][] = [['warmup', 'Khởi động'], ['explore', 'Khám phá'], ['practice', 'Thực hành'], ['discuss', 'Thảo luận'], ['present', 'Trình bày'], ['quiz', 'Trắc nghiệm'], ['reflect', 'Phản tư']]
export const LISTS: Record<ListKey, { tab: string; empty: string; cols: Col[] }> = {
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
export const lab = (opts: [string, string][] | undefined, v: string) => opts?.find(o => o[0] === v)?.[1] ?? v
export const detailCount = (d: Detail | null | undefined) => {
  const x = d ?? {}
  return [x.lectures?.length && `${x.lectures.length} bài giảng`, x.docs?.length && `${x.docs.length} tài liệu`, x.mats?.length && `${x.mats.length} vật tư`,
    x.acts?.length && `${x.acts.length} hoạt động`, x.test?.kind === 'link' ? x.test.url && 'bài kiểm tra qua link' : x.test?.qids?.length && `${x.test.qids.length} câu kiểm tra`].filter(Boolean).join(' · ')
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
        : c.type === 'url' ? (r[c.key] ? <a href={r[c.key]} target="_blank" rel="noreferrer">Mở link ↗</a> : r.file ? <button type="button" className="linkbtn" onClick={() => openFile(r.file)}>{r.file_name || 'Mở tệp'}</button> : '—')
          : c.type === 'select' ? lab(c.options, r[c.key] ?? '') || '—' : r[c.key] || '—'}</td>)}
      {edit && <td><button type="button" aria-label="Xoá dòng" onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button></td>}
    </tr>)}
      {!rows.length && <tr><td colSpan={cols.length + (edit ? 2 : 1)}><small className="sub">{empty}</small></td></tr>}</tbody>
  </table>
    {edit && <button type="button" style={{ marginTop: 8 }} onClick={() => onChange([...rows, {}])}>+ Thêm dòng</button>}</div>
}

type Tab = 'body' | ListKey | 'test'
export function ContentDetail({ title, crumb, hours, detail, editable, hasTest, passScore, onBack, onSave, notice, extra, initialTab, backLabel = 'Môn & nội dung đào tạo' }: {
  title: string; crumb: string; hours: number; detail: Detail; editable: boolean; hasTest?: boolean; passScore?: number | null; onBack: () => void; onSave: (d: Detail) => Promise<boolean>
  /** Ghi chú khi chỉ xem và nút thêm (VD: tạo phiên bản mới để sửa) */
  notice?: React.ReactNode; extra?: React.ReactNode; initialTab?: 'test'; backLabel?: string
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'body')
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
    const t = d.test
    if (t?.kind === 'link' && t.url?.trim() && !/^https?:\/\/\S+$/i.test(t.url.trim())) return setMsg('Link bài kiểm tra phải bắt đầu bằng http:// hoặc https://')
    if (t?.qids?.length && t.count && t.count > t.qids.length) return setMsg(`Số câu mỗi lượt (${t.count}) nhiều hơn số câu đã chọn (${t.qids.length}).`)
    setBusy(true)
    const ok = await onSave(clean(d))
    setBusy(false)
    if (ok) { setDirty(false); setD(clean(d)); setMsg('Đã lưu.') }
  }
  const tabs: [Tab, string, number | null][] = [['body', 'Nội dung', null], ...(Object.keys(LISTS) as ListKey[]).map(k => [k, LISTS[k].tab, d[k]?.length ?? 0] as [Tab, string, number]),
    ...(hasTest || d.test?.qids?.length || d.test?.url ? [['test', 'Bài kiểm tra', d.test?.kind === 'link' ? 0 : d.test?.qids?.length ?? 0] as [Tab, string, number]] : [])]
  return <ElView back={backLabel} onBack={() => { if (!dirty || confirm('Bỏ các thay đổi chưa lưu?')) onBack() }} title={title}
    sub={`${crumb} · ${String(hours).replace('.', ',')} giờ`}
    actions={editable ? <button type="button" className="primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu'}</button> : extra}>
    {msg && <p className="sub" role="status"><b>{msg}</b></p>}
    {!editable && <p className="sub">{notice ?? 'Chương trình đã phát hành nên chỉ xem. Muốn sửa thì tạo phiên bản mới của chương trình.'}</p>}
    <div className="distpills" role="tablist">{tabs.map(([k, l, n]) =>
      <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{n ? ` (${n})` : ''}</button>)}</div>
    <section className="panel" style={{ display: 'grid', gap: 12 }}>
      {tab === 'body' ? (editable ? <>
        <label className="field"><span>Mục tiêu</span><textarea rows={2} value={body.goal ?? ''} onChange={e => up({ ...d, body: { ...body, goal: e.target.value } })} placeholder="Sau nội dung này, nhà giáo làm được gì" /></label>
        <label className="field"><span>Nội dung chi tiết</span><textarea rows={8} value={body.text ?? ''} onChange={e => up({ ...d, body: { ...body, text: e.target.value } })} placeholder="Các ý chính, tiến trình đào tạo" /></label>
        <label className="field"><span>Yêu cầu cần đạt (mỗi dòng một yêu cầu)</span><textarea rows={4} value={(body.reqs ?? []).join('\n')} onChange={e => up({ ...d, body: { ...body, reqs: e.target.value.split('\n') } })} /></label>
      </> : <dl className="tpkv">
        <dt>Mục tiêu</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{body.goal || '—'}</dd>
        <dt>Nội dung chi tiết</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{body.text || '—'}</dd>
        <dt>Yêu cầu cần đạt</dt><dd>{body.reqs?.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{body.reqs.map((r, i) => <li key={i}>{r}</li>)}</ul> : '—'}</dd>
      </dl>)
        : tab === 'test' ? <TestEditor topic={title} t={d.test ?? {}} edit={editable} passScore={passScore ?? null} hasTest={!!hasTest} onChange={t => up({ ...d, test: t })} />
        : <ListEditor cols={LISTS[tab].cols} rows={d[tab] ?? []} edit={editable} empty={LISTS[tab].empty} onChange={r => up({ ...d, [tab]: r })} />}
    </section>
  </ElView>
}

// ===== Bài kiểm tra: chọn câu hỏi từ ngân hàng, đặt số câu, thời gian, số lượt, điểm đạt =====
type BankQ = { id: string; subject: string; grade: number | null; grades?: number[]; topic: string | null; level: string; kind: string; stem: string; shared: boolean }
const LEVEL: Record<string, string> = ELEVEL
const KIND: Record<string, string> = { single: 'Một đáp án', multi: 'Nhiều đáp án', truefalse: 'Đúng / sai' }

/** limited: chỉ đổi câu hỏi / link (đề riêng của kế hoạch); cách làm, điểm đạt, số lượt theo chương trình */
export function TestEditor({ t, edit, passScore, hasTest, onChange, limited = false, topic = '', subjects }: { t: TestCfg; edit: boolean; passScore: number | null; hasTest: boolean; onChange: (t: TestCfg) => void; limited?: boolean; topic?: string; subjects?: string[] }) {
  const setNum = (k: 'count' | 'minutes' | 'attempts' | 'pass', v: string) => onChange({ ...t, [k]: v === '' ? null : Number(v) })
  const n = t.qids?.length ?? 0
  const link = t.kind === 'link'
  const kindPick = <div className="distpills" role="radiogroup" aria-label="Cách làm bài" style={{ margin: 0 }}>
    {([['bank', 'Làm trong hệ thống (chấm tự động)'], ['link', 'Làm qua link (Google Forms, Azota…)']] as ['bank' | 'link', string][]).map(([k, l]) =>
      <button key={k} type="button" role="radio" aria-checked={(t.kind ?? 'bank') === k} className={(t.kind ?? 'bank') === k ? 'on' : ''} disabled={!edit}
        onClick={() => onChange({ ...t, kind: k })}>{l}</button>)}</div>
  if (link) return <div style={{ display: 'grid', gap: 12 }}>
    {!hasTest && <p className="warnline">Nội dung này đang không bật "Có bài test". Bật ở bảng nội dung để nhà giáo làm bài.</p>}
    {!limited && kindPick}
    {!limited && <ExamModePick value={t.mode} edit={edit} onChange={m => onChange({ ...t, mode: m })} />}
    <p className="sub" style={{ margin: 0 }}>Nhà giáo mở hết bài giảng, tài liệu rồi bấm "Làm bài" để mở link. Mở link là học tiếp được nội dung sau.
      Điểm do người tổ chức nhập ở Đánh giá kết quả đào tạo › Chấm điểm › Điểm bài test (gõ tay hoặc nhập file Excel), đủ điểm đạt mới tính bài test đạt.</p>
    <label className="field"><span>Link bài kiểm tra</span><input type="url" disabled={!edit} value={t.url ?? ''} placeholder="https://forms.gle/…"
      onChange={e => onChange({ ...t, url: e.target.value })} /></label>
    <div className="formgrid">
      {!limited && <label className="field"><span>Điểm đạt (thang 10)</span><input type="number" min={0} max={10} step={0.5} disabled={!edit} value={t.pass ?? ''} placeholder={passScore != null ? `Theo chương trình: ${passScore}` : '5'} onChange={e => setNum('pass', e.target.value)} /></label>}
      <label className="field"><span>Hạn làm bài</span><input type="date" disabled={!edit} value={t.due ?? ''} onChange={e => onChange({ ...t, due: e.target.value || null })} /></label>
    </div>
    <label className="field"><span>Hướng dẫn cho nhà giáo</span><textarea rows={2} maxLength={500} disabled={!edit} value={t.note ?? ''} placeholder="VD: Đăng nhập bằng email đã đăng ký với hệ thống để điểm khớp tên."
      onChange={e => onChange({ ...t, note: e.target.value })} /></label>
    {t.url && /^https?:\/\//i.test(t.url) && <a className="linkbtn" href={t.url} target="_blank" rel="noreferrer">Mở thử link ↗</a>}
  </div>
  return <div style={{ display: 'grid', gap: 12 }}>
    {!hasTest && <p className="warnline">Nội dung này đang không bật "Có bài test". Bật ở bảng nội dung để nhà giáo làm bài.</p>}
    {!limited && kindPick}
    {!limited && <ExamModePick value={t.mode} edit={edit} onChange={m => onChange({ ...t, mode: m })} />}
    <p className="sub" style={{ margin: 0 }}>Nhà giáo làm bài sau khi mở hết bài giảng và tài liệu của nội dung. Đạt điểm đạt thì nội dung được tính hoàn thành và mở nội dung tiếp theo.</p>
    <div className="formgrid">
      <label className="field"><span>Số câu mỗi lượt</span><input type="number" min={1} max={Math.max(n, 1)} disabled={!edit} value={t.count ?? ''} placeholder={`Tất cả (${n})`} onChange={e => setNum('count', e.target.value)} /></label>
      <label className="field"><span>Thời gian (phút)</span><input type="number" min={1} max={300} disabled={!edit} value={t.minutes ?? ''} placeholder="Không giới hạn" onChange={e => setNum('minutes', e.target.value)} /></label>
      {!limited && <label className="field"><span>Số lượt làm</span><input type="number" min={0} max={50} disabled={!edit} value={t.attempts ?? ''} placeholder="Không giới hạn" onChange={e => setNum('attempts', e.target.value)} /></label>}
      {!limited && <label className="field"><span>Điểm đạt (thang 10)</span><input type="number" min={0} max={10} step={0.5} disabled={!edit} value={t.pass ?? ''} placeholder={passScore != null ? `Theo chương trình: ${passScore}` : '5'} onChange={e => setNum('pass', e.target.value)} /></label>}
    </div>
    <div className="bar" style={{ margin: 0 }}>
      <span className="tools"><b>{t.count && t.count < n ? `Rút ngẫu nhiên ${t.count}/${n} câu mỗi lượt` : `${n} câu mỗi lượt`}</b>
        <TryButton spec={{ kind: 'sample', qids: t.qids ?? [], count: t.count }} title="Bài kiểm tra của nội dung" minutes={t.minutes} pass={t.pass ?? passScore} /></span>
    </div>
    <QuestionPicker value={t.qids ?? []} onChange={ids => onChange({ ...t, qids: ids })} edit={edit} topic={topic} subjects={subjects ?? []} title="Câu hỏi của bài kiểm tra" />
  </div>
}
