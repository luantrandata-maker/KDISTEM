import { useState } from 'react'

/** Ô chữ dài trong bảng sửa trực tiếp: bình thường hiện một dòng (cắt "…", rê chuột xem đủ);
 *  bấm / Tab / mũi tên vào thì mở ô nhập cao theo nội dung, Enter xuống dòng, rời ô thì lưu. */
export function LongCell({ value, gc, gr, placeholder, label, onSave }: {
  value: string; gc: string; gr: string; placeholder?: string; label: string; onSave: (v: string) => void
}) {
  const [ed, setEd] = useState(false)
  if (!ed) return <div className="slcell slone" tabIndex={0} role="textbox" aria-label={label} data-gc={gc} data-gr={gr} title={value || undefined}
    onFocus={() => setEd(true)}>{value ? value.replace(/\n+/g, ' · ') : <span className="slph">{placeholder}</span>}</div>
  return <textarea autoFocus className="slcell slgrow" data-gc={gc} data-gr={gr} defaultValue={value} placeholder={placeholder} aria-label={label}
    onFocus={e => { const n = e.target.value.length; e.target.setSelectionRange(n, n) }}
    onBlur={e => { setEd(false); if (e.target.value !== value) onSave(e.target.value) }} />
}

/** Chữ dài khi chỉ xem: một dòng, rê chuột xem đủ. */
export const OneLine = ({ text }: { text: string }) => text ? <span className="slonero" title={text}>{text.replace(/\n+/g, ' · ')}</span> : <>—</>
