// Đầu trang gọn: ô tìm chức năng (Ctrl K) và menu tài khoản (chế độ xem, đơn vị đang làm việc, xem với tư cách, đổi mật khẩu, đăng xuất)
import { useEffect, useMemo, useRef, useState } from 'react'
import { switchOrg, type MyOrg } from '../lib/auth'
import { norm } from '../lib/sheet'

// ================= Tìm chức năng trong menu =================
export function MenuSearch({ entries, onGo }: { entries: { item: string; label: string; group: string }[]; onGo: (item: string) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); setOpen(true) } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])
  const hits = useMemo(() => {
    const n = norm(q)
    const seen = new Set<string>()
    return entries.filter(e => (!n || norm(e.label + ' ' + e.item + ' ' + e.group).includes(n)) && !seen.has(e.item) && seen.add(e.item)).slice(0, 12)
  }, [q, entries])
  const go = (i: string) => { onGo(i); setQ(''); setOpen(false); ref.current?.blur() }
  return (
    <div className="topsearch" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false) }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input ref={ref} value={q} placeholder="Tìm chức năng…" aria-label="Tìm chức năng" role="combobox" aria-expanded={open} aria-controls="topsearch-list"
        onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setSel(0); setOpen(true) }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(hits.length - 1, s + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)) }
          else if (e.key === 'Enter' && hits[sel]) go(hits[sel].item)
          else if (e.key === 'Escape') { setOpen(false); ref.current?.blur() }
        }} />
      <kbd>Ctrl K</kbd>
      {open && (
        <div className="toppanel topsearchlist" id="topsearch-list" role="listbox">
          {hits.map((h, i) => (
            <button type="button" role="option" aria-selected={i === sel} key={h.item} className={i === sel ? 'on' : ''}
              onMouseEnter={() => setSel(i)} onMouseDown={e => e.preventDefault()} onClick={() => go(h.item)}>
              <span>{h.label}</span><small>{h.group}</small>
            </button>
          ))}
          {hits.length === 0 && <p className="sub" style={{ margin: 8 }}>Không có chức năng phù hợp.</p>}
        </div>
      )}
    </div>
  )
}

// ================= Menu tài khoản =================
type View = { key: string; label: string }
export function UserMenu({ name, email, roleLabel, orgs, views, view, onView, acting, onPassword, onSignOut }: {
  name: string; email: string; roleLabel: string; orgs: MyOrg[]
  views: View[]; view: string; onView: (k: string) => void
  acting?: { label: string; value: string; options: { id: string; label: string }[]; onChange: (id: string) => void } | null
  onPassword: () => void; onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', out); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', out); document.removeEventListener('keydown', esc) }
  }, [open])
  const active = orgs.find(o => o.active)
  const initial = (name || email).trim().split(/\s+/).pop()?.charAt(0).toUpperCase() ?? '?'
  const Icon = ({ d }: { d: string }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  const USER = 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10'
  const ORG = 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6'

  return (
    <div className="usermenu" ref={box}>
      <button type="button" className="userbtn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <span className="avatar">{initial}</span>
        <span className="who"><b>{name || email}</b><small>{roleLabel}</small></span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="toppanel userpanel" role="menu">
          <div className="userhead">
            <b>{name || email}</b>
            <small>{roleLabel}{active ? ` · ${active.name}` : ''}</small>
            <small>{email}</small>
          </div>
          {views.length > 1 && <div className="usersec">
            <small className="ushead">Chế độ xem</small>
            {views.map(v => (
              <button type="button" role="menuitemradio" aria-checked={v.key === view} key={v.key} className={v.key === view ? 'on' : ''}
                onClick={() => { onView(v.key); setOpen(false) }}><Icon d={USER} />{v.label}</button>
            ))}
          </div>}
          {orgs.length > 1 && <div className="usersec">
            <small className="ushead">Đang làm việc tại</small>
            {orgs.map(o => (
              <button type="button" role="menuitemradio" aria-checked={o.active} key={o.org_id} className={o.active ? 'on' : ''}
                onClick={async () => { if (!o.active) setErr((await switchOrg(o.org_id)) ?? '') }}>
                <Icon d={ORG} /><span>{o.name}<br /><small>{o.roles.join(', ')}</small></span></button>
            ))}
            {err && <p className="msg" style={{ padding: '0 10px' }}>{err}</p>}
          </div>}
          {acting && acting.options.length > 0 && <div className="usersec">
            <small className="ushead">{acting.label}</small>
            <select value={acting.value} onChange={e => acting.onChange(e.target.value)} aria-label={acting.label}>
              {acting.options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>}
          <div className="usersec">
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onPassword() }}><Icon d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4" />Đổi mật khẩu</button>
            <button type="button" role="menuitem" onClick={onSignOut}><Icon d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />Đăng xuất</button>
          </div>
        </div>
      )}
    </div>
  )
}
