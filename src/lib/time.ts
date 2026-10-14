export type SessionState = 'upcoming' | 'live' | 'done'
export function sessionState(starts: string, ends: string, now = new Date()): SessionState {
  const s = new Date(starts), e = new Date(ends)
  return now < s ? 'upcoming' : now <= e ? 'live' : 'done'
}
export const STATE_LABEL: Record<SessionState, string> = { upcoming: 'Chưa diễn ra', live: 'Đang diễn ra', done: 'Đã kết thúc' }
export const fmtDate = (d: string) => new Date(d).toLocaleDateString('vi-VN')
export const fmtTime = (d: string) => new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
