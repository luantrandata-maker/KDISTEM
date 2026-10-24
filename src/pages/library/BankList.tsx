import { useState } from 'react'
import { ACT_LABEL } from '../../lib/kitImport'
import { norm as normText } from '../../lib/sheet'
import type { Item } from './common'

type Bank = { key: string; activity_id: string | null; title: string; kind: string; act: string; note: string }

/** Kho hoạt động: gom thẻ 05 "Kho hoạt động" của các bài học (content.kit.bank) thành một danh sách tra cứu */
export function BankList({ items, onOpen, note }: { items: Item[]; onOpen?: (id: string) => void; note?: string }) {
  const [q, setQ] = useState(''); const [kind, setKind] = useState(''); const [subj, setSubj] = useState('')
  const rows = items.filter(i => i.kind === 'unit').flatMap(i => (((i.content as any)?.kit?.bank ?? []) as Bank[])
    .filter(b => b.title?.trim()).map(b => ({ b, i })))
  const kinds = [...new Set(rows.map(r => r.b.kind))]
  const subjects = [...new Set(rows.map(r => r.i.subject).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'vi'))
  const shown = rows.filter(({ b, i }) => (!kind || b.kind === kind) && (!subj || i.subject === subj)
    && (!q || normText([b.title, b.act, b.note, i.title].join(' ')).includes(normText(q))))
  return <>
    <div className="bar">
      <div className="tools">
        <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Loại hoạt động"><option value="">Mọi loại</option>{kinds.map(k => <option key={k} value={k}>{ACT_LABEL[k] ?? k}</option>)}</select>
        <select value={subj} onChange={e => setSubj(e.target.value)} aria-label="Môn"><option value="">Mọi môn</option>{subjects.map(x => <option key={x}>{x}</option>)}</select>
        <input placeholder="Tìm hoạt động, bài học…" value={q} onChange={e => setQ(e.target.value)} aria-label="Tìm hoạt động" />
      </div>
    </div>
    {note && <p className="sub">{note}</p>}
    <div className="wrap"><table className="systable">
      <thead><tr><th>Hoạt động</th><th>Loại</th><th>Dùng ở</th><th>Bài học</th><th>Môn · khối</th><th>Trạng thái</th></tr></thead>
      <tbody>
        {shown.map(({ b, i }) => <tr key={i.id + b.key} className={onOpen ? 'clickrow' : ''} onClick={onOpen ? () => onOpen(i.id) : undefined}>
          <td style={{ whiteSpace: 'normal' }}><b>{b.title}</b>{b.note && <><br /><small className="sub">{b.note}</small></>}</td>
          <td>{ACT_LABEL[b.kind] ?? b.kind}</td>
          <td><small>{b.act || '—'}</small></td>
          <td style={{ whiteSpace: 'normal' }}>{i.title}</td>
          <td>{[i.subject, i.grades && 'Khối ' + i.grades].filter(Boolean).join(' · ') || '—'}</td>
          <td>{b.activity_id ? <span className="pill active">Đã vào kho</span> : <span className="pill inactive">Chưa chốt</span>}</td>
        </tr>)}
        {!shown.length && <tr><td colSpan={6}>{rows.length ? 'Không có hoạt động khớp bộ lọc.' : 'Chưa có hoạt động nào. Hoạt động được thêm ở thẻ 05 “Kho hoạt động” của từng bài học.'}</td></tr>}
      </tbody>
    </table></div>
  </>
}
