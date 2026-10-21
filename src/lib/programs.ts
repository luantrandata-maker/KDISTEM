import { trackColor } from './stemTracks'

type ProgTone = { bg: string; fg: string; label: string }
const PROG_BASE: Record<string, ProgTone> = {
  CT1: { bg: '#eef1f6', fg: '#475569', label: 'Tích hợp nội môn' },
  CT2: { bg: '#e3f4f8', fg: '#0f7490', label: 'Liên môn' },
  CT3: { bg: '#f1e8fb', fg: '#7a3fc4', label: 'Đổi mới sáng tạo' },
  CT4: { bg: '#fde8ea', fg: '#c0324a', label: 'Robotics / AI' },
  CT5: { bg: '#e3f5ea', fg: '#23824f', label: 'Nghiên cứu khoa học' },
}
// Loại chương trình thêm sau (064): nền nhạt + chữ theo màu của loại
export const PROG: Record<string, ProgTone> = new Proxy(PROG_BASE, {
  get: (t, k) => (typeof k !== 'string' ? undefined : t[k] ?? { bg: trackColor(k) + '1f', fg: trackColor(k), label: k }),
})
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const mondayOf = (d: Date) => { const x = new Date(d); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); x.setHours(0, 0, 0, 0); return x }
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
