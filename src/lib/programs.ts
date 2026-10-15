export const PROG: Record<string, { bg: string; fg: string; label: string }> = {
  CT1: { bg: '#eef1f6', fg: '#475569', label: 'Tích hợp nội môn' },
  CT2: { bg: '#e3f4f8', fg: '#0f7490', label: 'Liên môn' },
  CT3: { bg: '#f1e8fb', fg: '#7a3fc4', label: 'Đổi mới sáng tạo' },
  CT4: { bg: '#fde8ea', fg: '#c0324a', label: 'Robotics / AI' },
  CT5: { bg: '#e3f5ea', fg: '#23824f', label: 'Nghiên cứu khoa học' },
}
export const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const mondayOf = (d: Date) => { const x = new Date(d); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); x.setHours(0, 0, 0, 0); return x }
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
