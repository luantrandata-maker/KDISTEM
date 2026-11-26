import { useLayoutEffect, useRef, useState } from 'react'

// Kéo mép phải tiêu đề cột để đổi độ rộng (bảng thường, không dùng DataTable: vd các bảng so sánh).
// Nhấp đúp mép cột để trả về độ rộng tự động. "Thu gọn": bảng vừa chiều ngang màn hình, chữ dài tự xuống dòng.
// Độ rộng và chế độ thu gọn nhớ theo từng bảng trên trình duyệt này; số cột đổi (thêm / bớt gói, trường) thì độ rộng về tự động.
type Saved = { n: number; w: number[]; fit: boolean }
const KEY = (id: string) => 'colrs:' + id
const load = (id: string): Saved => {
  try { const v = JSON.parse(localStorage.getItem(KEY(id)) ?? ''); if (Array.isArray(v?.w)) return { n: Number(v.n) || 0, w: v.w, fit: !!v.fit } } catch { /* mặc định */ }
  return { n: 0, w: [], fit: false }
}

export function useColResize(id: string) {
  const ref = useRef<HTMLTableElement>(null)
  const [s, setS] = useState<Saved>(() => load(id))
  const save = (v: Saved) => { setS(v); try { localStorage.setItem(KEY(id), JSON.stringify(v)) } catch { /* bỏ qua */ } }
  const heads = () => Array.from(ref.current?.querySelectorAll(':scope > thead > tr:first-child > th') ?? []) as HTMLElement[]

  // Đặt độ rộng đã lưu lên các ô tiêu đề sau mỗi lần vẽ
  useLayoutEffect(() => {
    const t = ref.current; if (!t) return
    const ths = heads()
    const on = !s.fit && s.w.length > 0 && s.n === ths.length
    t.classList.add('colrs'); t.classList.toggle('colfit', s.fit); t.classList.toggle('colfixed', on)
    t.style.width = on ? s.w.reduce((a, x) => a + x, 0) + 'px' : ''
    ths.forEach((th, i) => { const w = on ? s.w[i] + 'px' : ''; th.style.width = w; th.style.minWidth = w; th.style.maxWidth = w })
  })

  const onMouseDown = (e: React.MouseEvent) => {
    const th = (e.target as HTMLElement).closest('th') as HTMLElement | null
    const ths = heads(); const i = th ? ths.indexOf(th) : -1
    if (i < 0 || e.button !== 0 || e.clientX < th!.getBoundingClientRect().right - 8) return
    e.preventDefault(); e.stopPropagation()
    const snap = ths.map(x => Math.round(x.getBoundingClientRect().width)), x0 = e.clientX
    let cur = snap
    const mv = (ev: MouseEvent) => { cur = snap.map((w, j) => j === i ? Math.max(56, Math.round(w + ev.clientX - x0)) : w); setS({ n: ths.length, w: cur, fit: false }) }
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); save({ n: ths.length, w: cur, fit: false }) }
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up)
  }
  const onDoubleClick = (e: React.MouseEvent) => {
    const th = (e.target as HTMLElement).closest('th') as HTMLElement | null
    if (th && e.clientX >= th.getBoundingClientRect().right - 8) save({ n: 0, w: [], fit: s.fit })
  }
  const fitBtn = <button type="button" className={'colfitbtn' + (s.fit ? ' on' : '')} aria-pressed={s.fit} onClick={() => save({ n: 0, w: [], fit: !s.fit })}
    title={s.fit ? 'Bỏ thu gọn cột' : 'Thu bảng vừa chiều ngang màn hình, chữ dài tự xuống dòng'}>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5v14M21 5v14M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3" /></svg>Thu gọn</button>
  return { tableProps: { ref, onMouseDown, onDoubleClick }, fitBtn, fit: s.fit }
}
