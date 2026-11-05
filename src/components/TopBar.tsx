// Đầu trang gọn: ô tìm chức năng (Ctrl K) và menu tài khoản (chế độ xem, đơn vị đang làm việc, xem với tư cách, đổi mật khẩu, đăng xuất)
import { useEffect, useMemo, useRef, useState } from 'react'
import { enterSchool, switchOrg, type MyOrg } from '../lib/auth'
import { supabase, fetchAll } from '../lib/supabase'
import { norm } from '../lib/sheet'

type School = { org_id: string; name: string; parent_name: string | null; k?: string }
let allCache: School[] | null = null

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
  const schools = orgs.filter(o => o.type === 'school'), others = orgs.filter(o => o.type !== 'school')
  const pick = async (o: MyOrg) => { if (!o.active) setErr((await switchOrg(o.org_id)) ?? '') }
  // Quản trị KDI: chọn được tất cả trường trong hệ thống (người khác nhận danh sách rỗng)
  // Lúc tải trang chỉ hỏi số trường; danh sách đầy đủ chỉ tải khi mở menu (một lần mỗi phiên)
  const [total, setTotal] = useState(allCache?.length ?? 0)
  const [all, setAll] = useState<School[]>(allCache ?? [])
  useEffect(() => {
    if (allCache) return
    supabase.rpc('platform_school_list', {}, { head: true, count: 'exact' }).then(({ count, error }) => error ? loadAll() : setTotal(count ?? 0))
  }, [])
  useEffect(() => { if (open && total && !allCache) loadAll() }, [open, total])
  function loadAll() {
    fetchAll<School>(() => supabase.rpc('platform_school_list')).then(({ data }) => {
      if (!data) return
      allCache = data.map(x => ({ ...x, k: norm(`${x.name} ${x.parent_name ?? ''}`) })); setAll(allCache); setTotal(allCache.length)
    })
  }
  // Tìm theo tên / Sở (không dấu), chọn một trường rồi bấm Xác nhận mới vào
  const [sq, setSq] = useState('')
  const [chosen, setChosen] = useState('')
  const [going, setGoing] = useState(false)
  const roleAt = useMemo(() => new Map(schools.map(o => [o.org_id, o.roles.join(', ')])), [schools])
  const list: School[] = all.length ? all : schools.map(o => ({ org_id: o.org_id, name: o.name, parent_name: null, k: norm(o.name) }))
  const hits = useMemo(() => {
    const q = norm(sq.trim())
    return q ? list.filter(x => x.k!.includes(q)) : list
  }, [list, sq]) // eslint-disable-line react-hooks/exhaustive-deps
  const SHOWN = 50
  const pickSchool = async (id: string) => {
    if (!id || id === active?.org_id) return
    setGoing(true); setErr('')
    const e = roleAt.has(id) ? await switchOrg(id) : await enterSchool(id)
    if (e) { setErr(e); setGoing(false) }
  }
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
          {(orgs.length > 1 || total > 0) && <div className="usersec">
            <small className="ushead">Đang làm việc tại</small>
            {others.map(o => (
              <button type="button" role="menuitemradio" aria-checked={o.active} key={o.org_id} className={o.active ? 'on' : ''}
                onClick={() => pick(o)}>
                <Icon d={ORG} /><span>{o.name}<br /><small>{o.roles.join(', ')}</small></span></button>
            ))}
            {/* Ô chọn trường giống ô chọn trong form: gõ để tìm, bấm chọn một trường, Xác nhận để vào */}
            {(schools.length > 0 || total > 0) && <>
              {others.length > 0 && <small className="ushead">Trường{total ? ` (${total.toLocaleString('vi-VN')})` : ''}</small>}
              <div className="schoolpick">
                {list.length > 8 && <input type="search" placeholder="Gõ tên trường hoặc Sở…" aria-label="Tìm trường" value={sq} autoFocus
                  onChange={e => { setSq(e.target.value); setChosen('') }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (chosen) pickSchool(chosen); else if (hits[0]) setChosen(hits[0].org_id) } }} />}
                <div className="schoolpicklist" role="listbox" aria-label="Chọn trường">
                  {total > 0 && !all.length ? <small className="sub">Đang tải danh sách trường…</small>
                    : !hits.length ? <small className="sub">Không có trường nào khớp “{sq}”.</small>
                    : hits.slice(0, SHOWN).map(o => {
                      const cur = o.org_id === active?.org_id, on = o.org_id === chosen
                      return <button type="button" role="option" aria-selected={on} key={o.org_id} className={(on ? 'on' : '') + (cur ? ' cur' : '')}
                        onClick={() => setChosen(o.org_id)} onDoubleClick={() => pickSchool(o.org_id)}>
                        <span>{o.name}{cur && <em> · đang ở đây</em>}<br /><small>{[o.parent_name, roleAt.get(o.org_id)].filter(Boolean).join(' · ')}</small></span></button>
                    })}
                  {hits.length > SHOWN && <small className="sub">Còn {hits.length - SHOWN} trường, gõ thêm để thu hẹp.</small>}
                </div>
                <button type="button" className="primary" disabled={!chosen || going || chosen === active?.org_id} onClick={() => pickSchool(chosen)}>
                  {going ? 'Đang vào trường…' : 'Xác nhận vào trường'}</button>
              </div>
              {total > 0 && <small className="sub" style={{ padding: '0 10px' }}>Vào trường chưa có vai trò: hệ thống gán Hiệu trưởng cho tài khoản này và ghi nhật ký.</small>}
            </>}
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
