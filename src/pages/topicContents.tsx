import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { openFile, uploadLearningFile } from '../lib/files'
import type { MaterialGroup } from '../lib/programFrame'

// 6 nội dung của chủ đề (164): mỗi tab là danh sách mục (tên, mô tả, link hoặc tệp). Vật tư có nhóm, số lượng, đơn vị, tính theo.
// KDI (quản trị nền tảng) thêm, sửa, xoá; mọi người khác chỉ xem.

export const TOPIC_KINDS = [
  { key: 'plan', label: 'Kế hoạch giảng dạy' },
  { key: 'lecture', label: 'Bài giảng' },
  { key: 'worksheet', label: 'Phiếu học tập' },
  { key: 'test', label: 'Bài kiểm tra' },
  { key: 'material', label: 'Vật tư' },
  { key: 'resource', label: 'Kho học liệu' },
] as const
type Kind = typeof TOPIC_KINDS[number]['key']
const PER: Record<string, string> = { student: 'Học sinh', group: 'Nhóm', class: 'Lớp' }

export type TopicItem = {
  id: string; topic_id: string; kind: Kind; seq: number; title: string; detail: string; url: string | null
  file_path: string | null; file_name: string | null; material_group_id: string | null; qty: number | null; unit: string | null; per: string | null
}
type Draft = Omit<TopicItem, 'id'> & { id?: string }

const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 164 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Chỉ KDI sửa được nội dung chủ đề.' : m)

export function TopicContents({ topicId, admin }: { topicId: string; admin: boolean }) {
  const [items, setItems] = useState<TopicItem[]>([])
  const [groups, setGroups] = useState<MaterialGroup[]>([])
  const [kind, setKind] = useState<Kind>('plan')
  const [edit, setEdit] = useState<Draft | null>(null)
  const [msg, setMsg] = useState('')
  const reload = () => supabase.from('program_topic_items').select('*').eq('topic_id', topicId).order('seq')
    .then(({ data, error }) => { setItems((data ?? []) as TopicItem[]); setMsg(error ? errText(error.message) : '') })
  useEffect(() => { setEdit(null); reload() }, [topicId])
  useEffect(() => { supabase.from('material_groups').select('*').eq('active', true).order('sort').then(({ data }) => setGroups((data ?? []) as MaterialGroup[])) }, [])

  const list = items.filter(i => i.kind === kind)
  const gName = (id: string | null) => groups.find(g => g.id === id)?.name ?? ''
  const blank = (): Draft => ({ topic_id: topicId, kind, seq: list.reduce((s, i) => Math.max(s, i.seq), 0) + 1, title: '', detail: '', url: null,
    file_path: null, file_name: null, material_group_id: null, qty: null, unit: null, per: kind === 'material' ? 'group' : null })

  async function del(i: TopicItem) {
    if (!confirm(`Xoá "${i.title}"?`)) return
    const { error } = await supabase.from('program_topic_items').delete().eq('id', i.id)
    if (error) return setMsg(errText(error.message)); reload()
  }
  const open = (i: TopicItem) => (i.file_path ? openFile(i.file_path) : i.url ? window.open(i.url, '_blank', 'noopener') : undefined)
  const openLabel = (i: TopicItem) => (i.file_path ? 'Mở tệp' : i.url ? 'Mở link' : '')

  return <div style={{ marginTop: 16 }}>
    <div className="tabsrow">
      {TOPIC_KINDS.map(k => {
        const n = items.filter(i => i.kind === k.key).length
        return <button key={k.key} className={'roomtab' + (kind === k.key ? ' on' : '')} onClick={() => { setKind(k.key); setEdit(null) }}>
          {k.label}{n ? ` (${n})` : ''}</button>
      })}
    </div>
    {msg && <p className="msg">{msg}</p>}
    {edit ? <ItemForm d={edit} groups={groups} onCancel={() => setEdit(null)} onSaved={() => { setEdit(null); reload() }} />
      : <>
        {kind === 'material' && list.length > 0 ? <table className="slt ttdense" style={{ width: '100%' }}>
          <thead><tr><th>Vật tư</th><th>Nhóm vật tư</th><th>Số lượng</th><th>Tính theo</th>{admin && <th />}</tr></thead>
          <tbody>{list.map(i => <tr key={i.id}>
            <td><b>{i.title}</b>{i.detail && <div className="sub">{i.detail}</div>}</td>
            <td>{gName(i.material_group_id)}</td>
            <td>{i.qty != null ? `${Number(i.qty)} ${i.unit ?? ''}` : ''}</td>
            <td>{i.per ? PER[i.per] : ''}</td>
            {admin && <td style={{ whiteSpace: 'nowrap' }}><button onClick={() => setEdit(i)}>Sửa</button> <button className="danger" onClick={() => del(i)}>Xoá</button></td>}
          </tr>)}</tbody>
        </table>
          : list.map(i => <div key={i.id} className="panel" style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{i.title}</b>
                {(i.file_name || i.url) && <div className="sub">{i.file_name ?? i.url}</div>}
                {i.detail && <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{i.detail}</p>}
              </div>
              {openLabel(i) && <button onClick={() => open(i)}>{openLabel(i)}</button>}
              {admin && <><button onClick={() => setEdit(i)}>Sửa</button><button className="danger" onClick={() => del(i)}>Xoá</button></>}
            </div>
          </div>)}
        {!list.length && <p className="sub">Chưa có {TOPIC_KINDS.find(k => k.key === kind)!.label.toLowerCase()}.</p>}
        {admin && <button className="primary" onClick={() => setEdit(blank())}>+ Thêm {TOPIC_KINDS.find(k => k.key === kind)!.label.toLowerCase()}</button>}
      </>}
  </div>
}

function ItemForm({ d, groups, onCancel, onSaved }: { d: Draft; groups: MaterialGroup[]; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Draft>(d)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const set = (p: Partial<Draft>) => setF(x => ({ ...x, ...p }))
  const mat = f.kind === 'material'

  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true); setMsg('')
    try {
      const { data: org } = await supabase.rpc('platform_org_id')
      const r = await uploadLearningFile(org as string, 'program-topics', file)
      set({ file_path: r.path, file_name: r.name })
    } catch (e) { setMsg((e as Error).message) }
    setBusy(false)
  }
  async function save() {
    if (!f.title.trim()) return setMsg('Nhập tên.')
    setBusy(true)
    const { id, ...row } = f
    const { error } = id ? await supabase.from('program_topic_items').update(row).eq('id', id) : await supabase.from('program_topic_items').insert(row)
    setBusy(false)
    if (error) return setMsg(errText(error.message)); onSaved()
  }

  return <div className="panel">
    <label>Tên<input value={f.title} maxLength={200} onChange={e => set({ title: e.target.value })} placeholder={mat ? 'Ví dụ: Giấy màu A4' : 'Ví dụ: Giáo án Chong chóng giấy'} /></label>
    <label>{mat ? 'Ghi chú' : 'Mô tả'}<textarea rows={mat ? 2 : 5} value={f.detail} maxLength={4000} onChange={e => set({ detail: e.target.value })} /></label>
    {mat ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
      <label>Nhóm vật tư<select value={f.material_group_id ?? ''} onChange={e => set({ material_group_id: e.target.value || null })}>
        <option value="">—</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <label>Số lượng<input type="number" min={0} step="any" value={f.qty ?? ''} onChange={e => set({ qty: e.target.value === '' ? null : Number(e.target.value) })} /></label>
      <label>Đơn vị<input value={f.unit ?? ''} onChange={e => set({ unit: e.target.value })} placeholder="tờ, cái, bộ…" /></label>
      <label>Tính theo<select value={f.per ?? ''} onChange={e => set({ per: e.target.value || null })}>
        <option value="">—</option>{Object.entries(PER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    </div> : <>
      <label>Đường link<input value={f.url ?? ''} onChange={e => set({ url: e.target.value })} placeholder="https://…" /></label>
      <label>Tệp {f.file_name && <span className="sub">· {f.file_name} <button type="button" onClick={() => set({ file_path: null, file_name: null })}>Bỏ tệp</button></span>}
        <input type="file" disabled={busy} onChange={e => upload(e.target.files?.[0])} /></label>
    </>}
    {msg && <p className="msg">{msg}</p>}
    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
      <button className="primary" disabled={busy} onClick={save}>Lưu</button>
      <button onClick={onCancel}>Huỷ</button>
    </div>
  </div>
}
