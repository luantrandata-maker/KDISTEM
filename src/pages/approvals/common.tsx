import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export type Step = { no: number; name: string; approver: 'perm' | 'role'; role_id: string | null; role_name: string | null; org_id: string; org_name: string }
export type Req = {
  id: string; org_id: string; kind: string; ref_table: string; ref_id: string; title: string; summary: string | null
  requested_by: string | null; steps: Step[]; current_step: number; status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  created_at: string; decided_at: string | null; organizations?: { name: string } | null
}
export type Action = { id: string; request_id: string; step_no: number; actor: string | null; decision: string; note: string | null; at: string }

export const KINDS: [string, string][] = [
  ['stem_registration', 'Đăng ký dạy STEM'], ['borrow_request', 'Phiếu mượn thiết bị'], ['package_purchase', 'Đề xuất mua gói STEM'],
  ['edu_plan', 'Kế hoạch giáo dục'], ['project', 'Dự án STEM'], ['supply_purchase', 'Đề xuất mua vật tư'], ['stock_transfer', 'Phiếu vận chuyển'],
]
export const KIND_LABEL = Object.fromEntries(KINDS) as Record<string, string>
export const STATUS: Record<string, [string, string, string]> = {
  pending: ['⏳', 'Chờ duyệt', 'warn'], approved: ['✓', 'Đã duyệt', 'good'], rejected: ['✕', 'Từ chối', 'bad'], cancelled: ['−', 'Đã rút', ''],
  draft: ['✎', 'Nháp', ''],
}
export const fmt = (d: string) => new Date(d).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })

export function StatusPill({ status }: { status: string }) {
  const [icon, label, tone] = STATUS[status] ?? ['', status, '']
  return <span className={'gpill ' + tone}><i aria-hidden="true">{icon}</i>{label}</span>
}

// Các bước của hồ sơ: ✓ đã qua · ⏳ đang chờ · ✕ bị từ chối ở bước này · ○ chưa tới
export function StepTrail({ req }: { req: Pick<Req, 'steps' | 'current_step' | 'status'> }) {
  return (
    <ol className="trail" aria-label="Tiến trình duyệt">
      {req.steps.map(s => {
        const st = req.status === 'approved' || s.no < req.current_step ? 'done'
          : s.no === req.current_step ? (req.status === 'pending' ? 'now' : req.status === 'rejected' ? 'bad' : 'idle') : 'idle'
        const icon = { done: '✓', now: '⏳', bad: '✕', idle: String(s.no) }[st]
        return (
          <li key={s.no} className={st}>
            <span className="dot" aria-hidden="true">{icon}</span>
            <span><b>{s.name}</b><small>{s.approver === 'role' ? s.role_name : 'Người có quyền duyệt'} · {s.org_name}</small></span>
            <span className="sr">{{ done: 'đã duyệt', now: 'đang chờ', bad: 'bị từ chối', idle: 'chưa tới' }[st]}</span>
          </li>
        )
      })}
    </ol>
  )
}

// Hồ sơ mới nhất của từng bản ghi gốc (để hiện tiến trình ngay trên màn nghiệp vụ)
export function useLatestRequests(refTable: string, ids: string[]) {
  const [map, setMap] = useState<Map<string, Req>>(new Map())
  const key = ids.slice().sort().join(',')
  async function load() {
    if (!ids.length) return setMap(new Map())
    const { data } = await supabase.from('approval_requests').select('*').eq('ref_table', refTable).in('ref_id', ids).order('created_at')
    const m = new Map<string, Req>(); ((data as Req[]) ?? []).forEach(r => m.set(r.ref_id, r)); setMap(m)
  }
  useEffect(() => { load() }, [key])
  return { map, reload: load }
}

// Kết quả sau khi duyệt một bước → câu thông báo cho người dùng
export function decideText(res: { status: string; step: number; steps: number; next?: string; next_org?: string } | null) {
  if (!res) return ''
  if (res.status === 'pending') return `Đã duyệt bước ${res.step - 1}/${res.steps}. Chuyển tiếp: ${res.next}${res.next_org ? ' — ' + res.next_org : ''}.`
  return res.status === 'approved' ? 'Đã duyệt xong.' : 'Đã từ chối.'
}
export const approvalError = (m: string) =>
  /không phải người duyệt/i.test(m) ? m.replace(/^.*?Bạn/, 'Bạn')
    : /đã được xử lý/i.test(m) ? 'Hồ sơ đã được người khác xử lý. Hãy tải lại.'
    : /phải được gửi duyệt/i.test(m) ? 'Bản ghi này cần gửi duyệt và đi qua quy trình phê duyệt.' : m
