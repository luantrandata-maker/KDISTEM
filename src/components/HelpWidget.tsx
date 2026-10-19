import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { FAQ, searchFaq, type Faq } from '../lib/helpkb'
import type { RoleKey } from '../lib/nav'
import { md } from '../pages/ai'
import { CATEGORY, PRIORITY, STATUS } from '../pages/support/Support'

// Nút trợ giúp góc phải (055): hỏi đáp cách dùng hệ thống (AI nếu KDI đã bật, nếu không thì tra câu hỏi thường gặp),
// câu hỏi thường gặp, gửi yêu cầu hỗ trợ cho KDI và theo dõi / trả lời phiếu của mình.
type Msg = { role: 'user' | 'assistant'; content: string; faq?: Faq[] }
type Ticket = { id: string; code: string; subject: string; status: string; created_at: string; category: string }
type Note = { id: string; body: string; author: string | null; created_at: string }
type Tab = 'chat' | 'faq' | 'ticket'
const KEY = 'help.chat'
const STAFF = new Set<RoleKey>(['school_admin', 'teacher', 'department', 'platform'])

type Brand = { name?: string | null; support?: string | null }
// Câu "Liên hệ" kèm thông tin hỗ trợ đơn vị tự công bố (Giao diện & thương hiệu)
const withBrand = (f: Faq, b?: Brand): Faq => (f.id === 'contact' && b?.support ? { ...f, a: f.a + '\n\n**Thông tin hỗ trợ của đơn vị:** ' + b.support } : f)
export default function HelpWidget({ role, page, menu, go, brand }: { role: RoleKey; page: string; menu: string[]; go?: (p: string) => void; brand?: Brand }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('chat')
  const [draft, setDraft] = useState<{ subject: string; description: string } | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [unread, setUnread] = useState<Map<string, string[]>>(new Map())
  const panel = useRef<HTMLDivElement>(null)
  // Phản hồi chưa đọc của KDI cho phiếu của tôi (thông báo kind 'support' trỏ tới "Hỗ trợ từ KDI") → số trên nút chat
  async function loadUnread() {
    const { data } = await supabase.from('notifications').select('id, ref_id').eq('kind', 'support').eq('page', 'Hỗ trợ từ KDI').is('read_at', null).limit(100)
    const m = new Map<string, string[]>()
    ;((data as { id: string; ref_id: string | null }[]) ?? []).forEach(n => { const k = n.ref_id ?? ''; m.set(k, [...(m.get(k) ?? []), n.id]) })
    setUnread(m)
  }
  async function markRead(ticket: string) {
    const ids = unread.get(ticket); if (!ids?.length) return
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
    loadUnread(); window.dispatchEvent(new Event('notifications-changed'))
  }
  useEffect(() => {
    loadUnread()
    const h = setInterval(loadUnread, 30000)
    const vis = () => document.visibilityState === 'visible' && loadUnread()
    // Bấm thông báo "KDI đã trả lời phiếu…" ở chuông → mở khung trợ giúp tại đúng phiếu
    const go = (e: Event) => { const t = (e as CustomEvent<{ ticket?: string }>).detail?.ticket ?? null; setOpen(true); setTab('ticket'); setFocus(t); loadUnread() }
    document.addEventListener('visibilitychange', vis); window.addEventListener('help-open', go); window.addEventListener('notifications-changed', loadUnread)
    return () => { clearInterval(h); document.removeEventListener('visibilitychange', vis); window.removeEventListener('help-open', go); window.removeEventListener('notifications-changed', loadUnread) }
  }, [])
  const unreadCount = [...unread.values()].reduce((n, x) => n + x.length, 0)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) setOpen(false) }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [open])
  useEffect(() => { if (open) panel.current?.querySelector<HTMLElement>('textarea, input')?.focus() }, [open, tab])
  const toTicket = (subject: string, description: string) => { setDraft({ subject, description }); setTab('ticket') }
  return (
    <>
      {open && <div className="helppanel" ref={panel} role="dialog" aria-label="Trợ giúp">
        <header>
          <div><b>Trợ giúp KSCHOOL STEM</b><small>Hỏi cách dùng, lỗi thường gặp, gửi yêu cầu cho KDI</small></div>
          <button className="xbtn" onClick={() => setOpen(false)} aria-label="Đóng trợ giúp">✕</button>
        </header>
        <nav className="helptabs" role="tablist">
          {([['chat', 'Hỏi đáp'], ['faq', 'Câu hỏi thường gặp'], ['ticket', 'Yêu cầu hỗ trợ']] as [Tab, string][]).map(([k, l]) =>
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{k === 'ticket' && unreadCount > 0 && <span className="tabdot">{unreadCount}</span>}</button>)}
        </nav>
        <div className="helpbody">
          {tab === 'chat' ? <Chat role={role} page={page} menu={menu} toTicket={toTicket} brand={brand} />
            : tab === 'faq' ? <FaqList role={role} toTicket={toTicket} brand={brand} />
            : <Tickets role={role} page={page} draft={draft} clearDraft={() => setDraft(null)} go={go} focus={focus} unread={unread} markRead={markRead} />}
        </div>
      </div>}
      <button className={'helpfab' + (open ? ' on' : '')} onClick={() => { if (!open && unreadCount) setTab('ticket'); setOpen(!open) }} aria-expanded={open}
        aria-label={open ? 'Đóng trợ giúp' : unreadCount ? `Mở trợ giúp — ${unreadCount} phản hồi mới từ KDI` : 'Mở trợ giúp'}>
        {!open && unreadCount > 0 && <span className="fabcount" aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</span>}
        {open ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          : <><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.2M12 16.5h.01" /></svg><span>Trợ giúp</span></>}
      </button>
    </>
  )
}

// ================= Hỏi đáp =================
function Chat({ role, page, menu, toTicket, brand }: { role: RoleKey; page: string; menu: string[]; toTicket: (s: string, d: string) => void; brand?: Brand }) {
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? '[]') } catch { return [] } })
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [ai, setAi] = useState<{ on: boolean; reason: string | null } | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    supabase.rpc('ai_help_status').then(({ data, error }) => setAi(error || !data ? { on: false, reason: null } : { on: !!data.enabled && !!data.allowed && !data.reason, reason: data.reason ?? null }))
  }, [])
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))) } catch { /* bỏ qua */ } end.current?.scrollIntoView({ block: 'end' }) }, [msgs, busy])

  async function ask(text: string) {
    const t = text.trim(); if (!t || busy) return
    const faq = searchFaq(t, role, 4)
    const next: Msg[] = [...msgs, { role: 'user', content: t }]
    setMsgs(next); setQ('')
    if (!ai?.on) {
      const off = role === 'platform'
        ? 'Trợ lý AI chưa bật nên mình chỉ tra được câu hỏi thường gặp. Để trả lời được mọi câu hỏi: đặt khoá API (ví dụ `GEMINI_API_KEY` miễn phí) rồi bật ở **"Trợ lý AI"** › Cấu hình.'
        : 'Trợ lý AI chưa được KDI bật nên hiện mình chỉ tra được câu hỏi thường gặp về cách dùng hệ thống.'
      setMsgs([...next, { role: 'assistant', content: faq.length ? 'Các hướng dẫn có thể giúp bạn:' : off + '\n\nMình chưa có câu trả lời sẵn cho câu này — bạn có thể bấm **Gửi yêu cầu hỗ trợ** để KDI trả lời trực tiếp.', faq }])
      return
    }
    setBusy(true)
    try {
      const ctxFaq = searchFaq(t + ' ' + page, role, 8)
      const { data, error } = await supabase.functions.invoke('ai-assistant', { body: { task: 'help', input: {
        messages: next.slice(-10).map(m => ({ role: m.role, content: m.content })),
        context: { portal: role, page, menu, brand: brand?.name ?? null, support: brand?.support ?? null, faq: ctxFaq.map(f => ({ q: f.q, a: f.a })) } } } })
      if (error) { let m = error.message; try { const j = await (error as any).context?.json(); if (j?.error) m = j.error } catch { /* giữ */ } throw new Error(m) }
      setMsgs([...next, { role: 'assistant', content: data.text }])
    } catch (e: any) {
      setMsgs([...next, { role: 'assistant', content: `Trợ lý AI đang không trả lời được (${e.message}). Các hướng dẫn liên quan:`, faq }])
    } finally { setBusy(false) }
  }
  const lastQ = [...msgs].reverse().find(m => m.role === 'user')?.content ?? ''
  const transcript = () => msgs.slice(-8).map(m => (m.role === 'user' ? 'Tôi hỏi: ' : 'Trợ lý: ') + m.content.replace(/\*\*/g, '').replace(/\s+/g, ' ').slice(0, 400)).join('\n')
  const starters = searchFaq('', role, 30).filter(f => ['login', 'attendance', 'student-exam', 'parent-link', 'import', 'elearning', 'slow', 'portal'].includes(f.id)).slice(0, 4)
  return (
    <div className="helpchat">
      <div className="helpmsgs">
        {!msgs.length && <div className="helpwelcome">
          <p>Xin chào! Bạn cần giúp gì khi dùng hệ thống?</p>
          {ai && (ai.on ? <small className="sub">Hỏi bất cứ điều gì — cách dùng hệ thống, dạy học STEM, kiến thức chung.</small>
            : <small className="sub">Trợ lý AI chưa bật — hiện chỉ tra được câu hỏi thường gặp.</small>)}
          <div className="helpchips">{starters.map(f => <button key={f.id} onClick={() => ask(f.q)}>{f.q}</button>)}</div>
        </div>}
        {msgs.map((m, i) => <div key={i} className={'hmsg ' + m.role}>
          {m.role === 'user' ? m.content : <div className="mdbody" dangerouslySetInnerHTML={{ __html: md(m.content) }} />}
          {m.faq?.map(f => withBrand(f, brand)).map(f => <details key={f.id} className="hfaq" open={m.faq!.length === 1}><summary>{f.q}</summary><div className="mdbody" dangerouslySetInnerHTML={{ __html: md(f.a) }} /></details>)}
        </div>)}
        {busy && <div className="hmsg assistant"><span className="dots" aria-label="Đang trả lời"><i /><i /><i /></span></div>}
        {msgs.length > 0 && !busy && <div className="helpafter">
          <button onClick={() => toTicket(lastQ.slice(0, 120), transcript())}>Vẫn chưa được? Gửi yêu cầu hỗ trợ</button>
          <button className="xbtn" onClick={() => setMsgs([])}>Hội thoại mới</button>
        </div>}
        <div ref={end} />
      </div>
      <form className="helpask" onSubmit={e => { e.preventDefault(); ask(q) }}>
        <textarea rows={2} value={q} onChange={e => setQ(e.target.value)} placeholder="Nhập câu hỏi, ví dụ: điểm danh bù thế nào?" aria-label="Câu hỏi"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q) } }} />
        <button className="primary" disabled={busy || !q.trim()} aria-label="Gửi">➤</button>
      </form>
      <small className="helpnote">{ai?.on ? 'Trả lời bởi AI — có thể chưa chính xác. ' : ''}Không nhập mật khẩu hay thông tin cá nhân.</small>
    </div>
  )
}

// ================= Câu hỏi thường gặp =================
function FaqList({ role, toTicket, brand }: { role: RoleKey; toTicket: (s: string, d: string) => void; brand?: Brand }) {
  const [q, setQ] = useState('')
  const list = (q.trim() ? searchFaq(q, role, 20) : FAQ.filter(f => !f.portals || f.portals.includes(role))).map(f => withBrand(f, brand))
  const cats = [...new Set(list.map(f => f.cat))]
  return (
    <div className="helpfaq">
      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Tìm: điểm danh, mật khẩu, Excel…" aria-label="Tìm câu hỏi thường gặp" />
      {cats.map(c => <section key={c}><h4>{c}</h4>
        {list.filter(f => f.cat === c).map(f => <details key={f.id} className="hfaq"><summary>{f.q}</summary><div className="mdbody" dangerouslySetInnerHTML={{ __html: md(f.a) }} /></details>)}
      </section>)}
      {!list.length && <p className="sub">Không thấy câu hỏi phù hợp.</p>}
      <button className="linkish" onClick={() => toTicket(q.trim(), '')}>Không thấy câu trả lời? Gửi yêu cầu hỗ trợ →</button>
    </div>
  )
}

// ================= Yêu cầu hỗ trợ =================
function Tickets({ role, page, draft, clearDraft, go, focus, unread, markRead }: { role: RoleKey; page: string; draft: { subject: string; description: string } | null; clearDraft: () => void; go?: (p: string) => void
  focus: string | null; unread: Map<string, string[]>; markRead: (ticket: string) => void }) {
  const staff = STAFF.has(role)
  const [mine, setMine] = useState<Ticket[] | null>(null)
  const [me, setMe] = useState<string | null>(null)
  const [f, setF] = useState({ category: 'technical', priority: 'normal', subject: draft?.subject ?? '', description: draft?.description ?? '' })
  const [form, setForm] = useState(!!draft)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(focus)
  useEffect(() => { if (focus) setOpen(focus) }, [focus])
  // Mở phiếu → đánh dấu đã đọc các phản hồi của phiếu đó
  useEffect(() => { if (open && unread.get(open)?.length) markRead(open) }, [open, unread])
  async function load() {
    const { data: u } = await supabase.auth.getUser(); const uid = u.user?.id ?? null; setMe(uid)
    if (!uid) return setMine([])
    const { data } = await supabase.from('support_tickets').select('id, code, subject, status, created_at, category').eq('reported_by', uid).order('created_at', { ascending: false }).limit(20)
    setMine((data as Ticket[]) ?? [])
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (draft) { setF(x => ({ ...x, subject: draft.subject, description: draft.description })); setForm(true); clearDraft() } }, [draft])
  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null)
    const ctx = `\n\n— Gửi từ nút Trợ giúp · cổng: ${role} · trang: ${page} · ${navigator.userAgent.slice(0, 160)} · ${new Date().toLocaleString('vi-VN')}`
    const { data, error } = await supabase.rpc('help_ticket', { p_subject: f.subject, p_description: (f.description.trim() + ctx).slice(0, 8000), p_category: f.category, p_priority: f.priority })
    setBusy(false)
    if (error) return setMsg([/does not exist|schema cache/i.test(error.message) ? 'Chức năng đang cập nhật — vui lòng thử lại sau.' : error.message, true])
    setMsg([`Đã gửi yêu cầu ${(data as any).code}. KDI sẽ phản hồi tại đây và qua chuông thông báo.`, false])
    setF({ category: 'technical', priority: 'normal', subject: '', description: '' }); setForm(false); load()
  }
  return (
    <div className="helptickets">
      {msg && <p className={msg[1] ? 'msg' : 'helpok'} role="status">{msg[0]}</p>}
      {!form ? <button className="primary wide" onClick={() => setForm(true)}>+ Gửi yêu cầu hỗ trợ mới</button> : <form className="helpform" onSubmit={send}>
        {!staff && <small className="sub">Câu hỏi về bài học, điểm số, lớp học: hỏi thầy cô hoặc nhà trường trước. Yêu cầu này gửi tới đội hỗ trợ kỹ thuật KDI.</small>}
        <label><span>Loại yêu cầu</span><select value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>
          {Object.entries(CATEGORY).filter(([k]) => staff || !['billing', 'equipment'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {staff && <label><span>Mức độ</span><select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>}
        <label><span>Tiêu đề *</span><input required minLength={3} maxLength={200} value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} placeholder="VD: Không lưu được điểm danh lớp 7A" /></label>
        <label><span>Mô tả (thao tác, thông báo lỗi…)</span><textarea rows={5} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
        <small className="sub">Hệ thống tự gửi kèm trang đang mở và trình duyệt để KDI dễ kiểm tra. Không ghi mật khẩu.</small>
        <div className="row"><button className="primary" disabled={busy}>{busy ? 'Đang gửi…' : 'Gửi yêu cầu'}</button><button type="button" onClick={() => setForm(false)}>Huỷ</button></div>
      </form>}
      <h4>Yêu cầu của tôi</h4>
      {!mine ? <p className="sub">Đang tải…</p> : !mine.length ? <p className="sub">Bạn chưa gửi yêu cầu nào.</p> : <ul className="tlist">{mine.map(t => <li key={t.id}>
        <button onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
          <span>{unread.get(t.id)?.length ? <i className="newdot" aria-label="Có phản hồi mới" /> : null}<b>{t.code}</b> {t.subject}<small>{CATEGORY[t.category]} · {new Date(t.created_at).toLocaleDateString('vi-VN')}</small></span>
          <span className={'pill ' + (t.status === 'resolved' || t.status === 'closed' ? 'active' : t.status === 'waiting_customer' ? 'inactive' : 'maintenance')}>{STATUS[t.status] ?? t.status}</span>
        </button>
        {open === t.id && <Thread key={t.id + ':' + (unread.get(t.id)?.length ?? 0)} ticket={t} me={me} onChange={load} />}
      </li>)}</ul>}
      {staff && go && <button className="linkish" onClick={() => go('Hỗ trợ từ KDI')}>Xem tất cả phiếu của đơn vị ở "Hỗ trợ từ KDI" →</button>}
    </div>
  )
}

function Thread({ ticket, me, onChange }: { ticket: Ticket; me: string | null; onChange: () => void }) {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [body, setBody] = useState('')
  const load = () => supabase.from('support_messages').select('id, body, author, created_at').eq('ticket_id', ticket.id).order('created_at').then(({ data }) => setNotes((data as Note[]) ?? []))
  useEffect(() => { load() }, [ticket.id])
  async function reply(e: React.FormEvent) {
    e.preventDefault(); if (!body.trim()) return
    const { error } = await supabase.from('support_messages').insert({ ticket_id: ticket.id, body: body.trim() })
    if (!error) { setBody(''); load(); onChange() }
  }
  const done = ticket.status === 'closed'
  return (
    <div className="thread">
      {notes?.map(n => <div key={n.id} className={'tnote' + (n.author === me ? ' mine' : '')}><small>{n.author === me ? 'Bạn' : 'KDI'} · {new Date(n.created_at).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</small><p>{n.body}</p></div>)}
      {notes && !notes.length && <small className="sub">Chưa có phản hồi. Hạn xử lý theo mức độ; KDI trả lời tại đây.</small>}
      {!done && <form onSubmit={reply} className="row"><input value={body} onChange={e => setBody(e.target.value)} placeholder="Bổ sung thông tin / trả lời…" aria-label="Trả lời" /><button disabled={!body.trim()}>Gửi</button></form>}
      {!done && <button className="xbtn" onClick={async () => { await supabase.from('support_tickets').update({ status: 'closed' }).eq('id', ticket.id); onChange() }}>Đã xong — đóng yêu cầu</button>}
    </div>
  )
}
