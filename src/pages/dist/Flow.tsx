// Sơ đồ 8 bước của bản phân phối (đầu trang Phân phối chương trình): KDI soạn (1–5), gán cho trường (6),
// trường lên kế hoạch và dạy (7–8, ở cổng trường). Bước đang làm được tô sáng; bước làm được ngay tại trang thì bấm được.
import { useState } from 'react'

export const FLOW_STEPS: [string, string][] = [
  ['Khung chương trình', 'Gói STEM, chủ đề'],
  ['Tạo bản phân phối', 'tên, phân loại'],
  ['Chọn chương trình', 'và môn học'],
  ['Xếp lịch dạy', 'nhịp tiết, chọn bài'],
  ['Phát hành', 'chốt bản phân phối'],
  ['Gán cho trường', 'theo năm học'],
  ['Trường lên kế hoạch', 'phân bổ tiết, lịch'],
  ['Dạy và theo dõi', 'tiến độ thực tế'],
]
// Cổng trường: trường tự tạo bản (hoặc nhân bản bản KDI đã phát hành) rồi áp dụng cho lớp của mình
export const SCHOOL_STEPS: [string, string][] = [
  ['Gói STEM của trường', 'chương trình được áp dụng'],
  ['Tạo bản phân phối', 'tự tạo hoặc nhân bản bản KDI'],
  ['Chọn chương trình', 'và môn học'],
  ['Xếp lịch dạy', 'nhịp tiết, chọn bài'],
  ['Phát hành', 'chốt bản phân phối'],
  ['Áp dụng cho lớp', 'theo năm học'],
  ['Lên kế hoạch', 'phân bổ tiết, lịch'],
  ['Dạy và theo dõi', 'tiến độ thực tế'],
]
const KEY = 'ppct-flow-hidden'
const read = () => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }

/** cur: các bước đang làm (1–8); go: bấm bước n (trả về undefined nếu bước đó không bấm được ở đây). */
export function DistFlow({ cur, go, school }: { cur: number[]; go: (n: number) => (() => void) | undefined; school?: boolean }) {
  const steps = school ? SCHOOL_STEPS : FLOW_STEPS
  const [hid, setHid] = useState(read)
  const toggle = () => { const v = !hid; setHid(v); try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* bỏ qua */ } }
  if (hid) return <div className="ppflow min"><button type="button" className="linkbtn" onClick={toggle}>▸ Hiện các bước phân phối chương trình</button></div>
  return <div className="ppflow">
    <div className="ppflowhd">{school
      ? <><span className="ppgrp k">Trường tự soạn, hoặc nhận bản KDI gán</span><span className="ppgrp g">Áp dụng</span><span className="ppgrp s">Thực hiện</span></>
      : <><span className="ppgrp k">KDI soạn và phát hành</span><span className="ppgrp g">Gán</span><span className="ppgrp s">Trường thực hiện (cổng trường)</span></>}
      <button type="button" className="linkbtn" onClick={toggle} title="Ẩn sơ đồ, lần sau mở trang vẫn ẩn">Ẩn</button></div>
    <ol>{steps.map(([name, sub], i) => {
      const n = i + 1, on = cur.includes(n), fn = go(n)
      const cls = (on ? 'on ' : '') + (n <= 5 ? 'k' : n === 6 ? 'g' : 's')
      const body = <><b className="ppn">{n}</b><span className="ppname">{name}</span></>
      return <li key={n} className={cls} title={`${n}. ${name}: ${sub}`}>{fn ? <button type="button" onClick={fn} title={`Đi tới: ${name}`}>{body}</button> : <div>{body}</div>}</li>
    })}</ol>
    <p className="ppnote">{school ? 'Bản KDI đã phát hành cũng nằm trong danh sách: dùng luôn, hoặc nhân bản để sửa thành bản riêng của trường.'
      : 'Trường cũng tự tạo được bản phân phối ở cổng trường (Phân phối chương trình › Bản phân phối), không cần chờ KDI gán.'}</p>
  </div>
}
