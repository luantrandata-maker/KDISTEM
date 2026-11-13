// Lịch tháng vừa một màn hình: khung lịch cao bằng phần còn lại của cửa sổ, các tuần chia đều chiều cao,
// mỗi ô hiện số buổi vừa chỗ, phần còn lại gom vào "+N".
import { useLayoutEffect, useRef, useState } from 'react'

/** Số tuần (hàng) cần cho tháng chứa ngày `d`, tuần bắt đầu thứ Hai */
export const weeksOf = (d: Date) => {
  const first = new Date(d.getFullYear(), d.getMonth(), 1), days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  return Math.ceil(((first.getDay() + 6) % 7 + days) / 7)
}

export function useFitMonth(on: boolean, weeks: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [h, setH] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!on) return
    const fit = () => {
      const el = ref.current; if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY
      setH(Math.round(window.innerHeight - top - 28))
    }
    fit(); window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [on, weeks])
  const fz = typeof document === 'undefined' ? 1 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fz')) || 1
  const chip = 39 * fz, minCell = 24 * fz + chip
  if (!on || h == null) return { ref, style: undefined, max: 3 }
  // Màn thấp quá thì giữ mỗi ô đủ một buổi, trang cuộn như cũ
  const height = Math.max(h, 30 + weeks * (minCell + 4))
  const cell = (height - 30) / weeks - 4
  return { ref, style: { height, gridTemplateRows: `auto repeat(${weeks}, minmax(0, 1fr))` }, // max theo cách gọi: quá max buổi thì hiện max − 1 buổi + dòng "+N" (cao ~18px)
    max: Math.max(2, Math.floor((cell - 40 * fz) / chip) + 1) }
}
