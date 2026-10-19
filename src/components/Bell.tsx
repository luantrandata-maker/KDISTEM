import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { RoleKey } from '../lib/nav'

type Note = { id: string; kind: string; ref_id?: string | null; title: string; body: string | null; page: string | null; portal: RoleKey | null; count: number; created_at: string; read_at: string | null }
type Counts = { stem_registrations: number; borrow_requests: number; warranty_tickets: number; to_grade: number; approvals?: number; unread: number }

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'vừa xong'
  if (m < 60) return `${m} phút trước`
  if (m < 1440) return `${Math.round(m / 60)} giờ trước`
  return `${Math.round(m / 1440)} ngày trước`
}
const ICON: Record<string, string> = { approval: '⏳', status: '🔄', submission: '📥', graded: '✅', assignment: '📝', invitation: '👤' }

// Chuông thông báo: thông báo cá nhân (trigger CSDL tạo) + việc đang chờ xử lý theo quyền. Làm mới mỗi 30 giây.
export default function Bell({ open: openPage, portals, orgId }: { open: (portal: RoleKey | null, page: string) => void; portals: RoleKey[]; orgId: string | null }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [counts, setCounts] = useState<Counts | null>(null)
  const [show, setShow] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  async function load() {
    const [n, c] = await Promise.all([
      // Chỉ thông báo của đơn vị đang làm việc (người dùng nhiều đơn vị: đổi đơn vị để xem thông báo bên đó)
      supabase.from('notifications').select('*').eq('org_id', orgId ?? '').order('created_at', { ascending: false }).limit(30),
      supabase.rpc('my_pending_counts'),
    ])
    setNotes((n.data as Note[]) ?? []); setCounts((c.data as Counts) ?? null)
  }
  useEffect(() => {
    load()
    window.addEventListener('notifications-changed', load)
    const h = setInterval(load, 30000)
    const f = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', f)
    return () => { clearInterval(h); document.removeEventListener('visibilitychange', f); window.removeEventListener('notifications-changed', load) }
  }, [])
  useEffect(() => {
    if (!show) return
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setShow(false) }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setShow(false)
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [show])

  const unread = notes.filter(n => !n.read_at).length
  type Pend = [number, string, RoleKey, string]
  // Hồ sơ chờ tôi duyệt (quy trình phê duyệt 022) mở ở Hộp phê duyệt của cổng phù hợp
  const inboxPortal: RoleKey = (['school_admin', 'department', 'teacher'] as RoleKey[]).find(p => portals.includes(p)) ?? 'school_admin'
  const all: Pend[] = counts ? [
    [counts.approvals ?? 0, 'Hồ sơ chờ bạn duyệt', inboxPortal, 'Hộp phê duyệt'],
    [counts.stem_registrations, 'Đăng ký dạy STEM chờ duyệt', 'school_admin', 'Duyệt đăng ký dạy STEM'],
    [counts.borrow_requests, 'Phiếu mượn chờ duyệt', 'school_admin', 'Quản lý Phòng STEM'],
    [counts.warranty_tickets, 'Ticket bảo hành đang mở', 'school_admin', 'Bảo hành thiết bị'],
    [counts.to_grade, 'Bài chờ chấm', 'teacher', 'Chấm bài'],
  ] : []
  const pending = all.filter(([n, , portal]) => n > 0 && portals.includes(portal))
  // Số trên chuông: thông báo chưa đọc + việc cần duyệt (ticket bảo hành, bài chờ chấm chỉ hiện trong danh sách)
  const badge = unread + pending.filter(([, , , page]) => page === 'Hộp phê duyệt').reduce((s, [n]) => s + n, 0)

  async function click(n: Note) {
    if (!n.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
      setNotes(notes.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
      window.dispatchEvent(new Event('notifications-changed'))
    }
    // KDI trả lời phiếu hỗ trợ của tôi → mở khung Trợ giúp (góc phải) tại đúng phiếu, mọi vai trò đều có
    if (n.kind === 'support' && n.page === 'Hỗ trợ từ KDI') {
      window.dispatchEvent(new CustomEvent('help-open', { detail: { ticket: n.ref_id ?? null } })); setShow(false); return
    }
    if (n.page) { openPage(n.portal, n.page); setShow(false) }
  }
  async function readAll() {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('org_id', orgId ?? '').is('read_at', null)
    load(); window.dispatchEvent(new Event('notifications-changed'))
  }

  return (
    <div className="bell" ref={box}>
      <button className="bellbtn" onClick={() => { setShow(!show); if (!show) load() }} aria-label={`Thông báo${badge ? `, ${badge} mục mới` : ''}`} aria-expanded={show}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
        {badge > 0 && <span className="bellcount">{badge > 99 ? '99+' : badge}</span>}
      </button>
      {show && (
        <div className="bellpanel" role="dialog" aria-label="Thông báo">
          {pending.length > 0 && (
            <div className="bellsec">
              <b>Việc chờ xử lý</b>
              {pending.map(([n, label, portal, page]) => (
                <button key={label} className="bellitem pend" onClick={() => { openPage(portal, page); setShow(false) }}>
                  <span>{label}</span><span className="n">{n}</span></button>
              ))}
            </div>
          )}
          <div className="bellsec">
            <div className="bellhead"><b>Thông báo</b>{unread > 0 && <button className="linkbtn" onClick={readAll}>Đánh dấu đã đọc tất cả</button>}</div>
            {notes.length === 0 && <small>Chưa có thông báo nào.</small>}
            {notes.map(n => (
              <button key={n.id} className={'bellitem' + (n.read_at ? '' : ' unread')} onClick={() => click(n)}>
                <span className="ico" aria-hidden="true">{ICON[n.kind] ?? '•'}</span>
                <span className="txt"><b>{n.title}{n.count > 1 ? ` (${n.count})` : ''}</b>{n.body && <small>{n.body}</small>}<small>{ago(n.created_at)}</small></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
