import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import type { Slide } from '../teacher/Lessons'
import {
  KindChip, ProgChip, StatusChip, ItemPreview, SlidesEditor, SCOPE, MAT_TYPE, PROGRAMS, KIND, fmtDate, uid, type Item, type Unit,
} from './common'

type Org = { id: string; name: string; type: string; parent_id: string | null }
type Stat = { item_id: string; schools: number; copies: number; outdated: number }
type LP = { id: string; title: string; subject: string | null; grades: string | null; program: string | null; summary: string | null; slides: Slide[]; teachers: { full_name: string } | null; org_id: string }
type Form = {
  id?: string; kind: Item['kind']; title: string; summary: string; subject: string; grades: string; program: string; tags: string
  scope: Item['scope']; targets: string[]; slides: Slide[]; mtype: string; url: string; units: Unit[]
}
const EMPTY = (kind: Item['kind']): Form => ({
  kind, title: '', summary: '', subject: '', grades: '', program: '', tags: '', scope: 'children', targets: [],
  slides: kind === 'lesson' ? [{ id: uid(), kind: 'title', title: '', body: '' }] : [], mtype: 'video', url: '', units: kind === 'program' ? [{ title: 'Chủ đề 1', periods: 2, objectives: '', lesson_ids: [] }] : [],
})
type T = 'all' | 'published' | 'draft' | 'archived'

// Phát hành học liệu: Sở/Phòng/Tỉnh/Bộ, đơn vị cung cấp (KDI Education) hoặc trường soạn và phát hành tới đơn vị trực thuộc
export function LibraryManage({ orgId }: { orgId: string | null }) {
  const [items, setItems] = useState<Item[]>([])
  const [visible, setVisible] = useState<Item[]>([])
  const [stats, setStats] = useState<Map<string, Stat>>(new Map())
  const [targets, setTargets] = useState<Map<string, string[]>>(new Map())
  const [orgs, setOrgs] = useState<Org[]>([])
  const [me, setMe] = useState<Org | null>(null)
  const [lessons, setLessons] = useState<LP[]>([])
  const [form, setForm] = useState<Form | null>(null)
  const [tab, setTab] = useState<T>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState(''); const [info, setInfo] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!orgId) return
    const [i, s, t, o, l] = await Promise.all([
      supabase.from('library_items').select('*, owner_name, owner_type').order('updated_at', { ascending: false }),
      supabase.rpc('library_stats'),
      supabase.from('library_targets').select('item_id, org_id'),
      supabase.from('organizations').select('id, name, type, parent_id').order('name'),
      supabase.from('lesson_plans').select('id, title, subject, grades, program, summary, slides, org_id, teachers(full_name)').or('status.eq.published,is_template.eq.true').order('updated_at', { ascending: false }).limit(200),
    ])
    if (i.error) return setErr(/schema cache|does not exist|owner_name/i.test(i.error.message) ? 'Hãy chạy migration 023_shared_library.sql trên Supabase.' : i.error.message)
    const all = (i.data as Item[]) ?? []
    setItems(all.filter(x => x.owner_org_id === orgId)); setVisible(all)
    setStats(new Map(((s.data as Stat[]) ?? []).map(x => [x.item_id, x])))
    const tm = new Map<string, string[]>(); ((t.data as { item_id: string; org_id: string }[]) ?? []).forEach(x => tm.set(x.item_id, [...(tm.get(x.item_id) ?? []), x.org_id])); setTargets(tm)
    const os = (o.data as Org[]) ?? []; setOrgs(os); setMe(os.find(x => x.id === orgId) ?? null)
    setLessons((l.data as unknown as LP[]) ?? [])
  }
  useEffect(() => { load() }, [orgId])
  if (err) return <p className="msg">{err}</p>
  if (!me) return <p className="sub">Đang tải…</p>

  // Đơn vị cấp dưới (để chọn đơn vị nhận)
  const below: Org[] = []
  const walk = (id: string, depth: number) => orgs.filter(o => o.parent_id === id).forEach(o => { below.push({ ...o, name: '\u00a0'.repeat(depth * 3) + o.name }); walk(o.id, depth + 1) })
  walk(me.id, 0)
  const canPublic = me.type === 'provider'
  const lessonPool = visible.filter(x => x.kind === 'lesson' && (x.status === 'published' || x.owner_org_id === orgId))

  function edit(i: Item) {
    setMsg(''); setInfo('')
    setForm({
      id: i.id, kind: i.kind, title: i.title, summary: i.summary ?? '', subject: i.subject ?? '', grades: i.grades ?? '', program: i.program ?? '',
      tags: i.tags.join(', '), scope: i.scope, targets: targets.get(i.id) ?? [], slides: i.content.slides ?? [], mtype: i.content.type ?? 'video',
      url: i.content.url ?? '', units: i.content.units ?? [],
    })
  }
  function importLesson(id: string) {
    const l = lessons.find(x => x.id === id); if (!l || !form) return
    setForm({ ...form, title: form.title || l.title.replace(/^Mẫu:\s*/, ''), subject: form.subject || (l.subject ?? ''), grades: form.grades || (l.grades ?? ''),
      program: form.program || (l.program ?? ''), summary: form.summary || (l.summary ?? ''), slides: l.slides.map(s => ({ ...s, id: uid() })) })
  }
  async function save(e: React.FormEvent, publish: boolean) {
    e.preventDefault(); if (!form || !orgId) return
    if (form.scope === 'selected' && form.targets.length === 0) return setMsg('Chọn ít nhất một đơn vị nhận.')
    const content = form.kind === 'lesson' ? { slides: form.slides } : form.kind === 'material' ? { type: form.mtype, url: form.url.trim() } : { units: form.units }
    const row = {
      owner_org_id: orgId, kind: form.kind, title: form.title.trim(), summary: form.summary.trim() || null, subject: form.subject.trim() || null,
      grades: form.grades.trim() || null, program: form.program || null, tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      scope: form.scope, content,
    }
    setBusy(true)
    const res = form.id ? await supabase.from('library_items').update(row).eq('id', form.id).select('id').single()
      : await supabase.from('library_items').insert(row).select('id').single()
    if (res.error) { setBusy(false); return setMsg(res.error.message) }
    const id = (res.data as { id: string }).id
    await supabase.from('library_targets').delete().eq('item_id', id)
    if (form.scope === 'selected') {
      const t = await supabase.from('library_targets').insert(form.targets.map(org_id => ({ item_id: id, org_id })))
      if (t.error) { setBusy(false); return setMsg(t.error.message) }
    }
    if (publish) {
      const was = items.find(x => x.id === id)
      const note = was && was.version > 0 ? prompt('Ghi chú cho bản cập nhật (trường đã dùng sẽ thấy):', '') : null
      const p = await supabase.rpc('library_publish', { p_item: id, p_note: note })
      if (p.error) { setBusy(false); setMsg(p.error.message); setForm({ ...form, id }); return load() }
      setInfo(`Đã phát hành “${row.title}” (phiên bản ${p.data}).`)
    } else setInfo('Đã lưu nháp.')
    setBusy(false); setForm(null); load()
  }
  async function publish(i: Item) {
    const note = i.version > 0 ? prompt('Ghi chú cho bản cập nhật (trường đã dùng sẽ thấy):', '') : null
    if (note === null && i.version > 0) return
    const { data, error } = await supabase.rpc('library_publish', { p_item: i.id, p_note: note })
    if (error) setMsg(error.message); else { setMsg(''); setInfo(`Đã phát hành “${i.title}” (phiên bản ${data}).`); load() }
  }
  async function unpublish(i: Item) {
    if (!confirm(`Thu hồi “${i.title}”? Đơn vị nhận không thấy mục này nữa; bản các trường đã dùng vẫn giữ nguyên.`)) return
    const { error } = await supabase.rpc('library_unpublish', { p_item: i.id })
    if (error) setMsg(error.message); else { setInfo('Đã thu hồi.'); load() }
  }
  async function remove(i: Item) {
    if (!confirm(`Xoá “${i.title}”?`)) return
    const { error } = await supabase.from('library_items').delete().eq('id', i.id)
    if (error) setMsg(error.message); else { setInfo('Đã xoá.'); load() }
  }

  const shown = items.filter(i => tab === 'all' || i.status === tab)
  const setUnit = (k: number, p: Partial<Unit>) => form && setForm({ ...form, units: form.units.map((u, j) => j === k ? { ...u, ...p } : u) })

  return (
    <>
      <div className="bar">
        <Tabs items={[['all', 'Tất cả', items.length], ['published', 'Đã phát hành', items.filter(i => i.status === 'published').length],
          ['draft', 'Nháp', items.filter(i => i.status === 'draft').length], ['archived', 'Đã thu hồi', items.filter(i => i.status === 'archived').length]]} value={tab} onChange={setTab} />
        <div className="actions">
          {(Object.keys(KIND) as Item['kind'][]).map(k => <button key={k} type="button" className={k === 'lesson' ? 'primary' : ''} onClick={() => { setMsg(''); setInfo(''); setForm(EMPTY(k)) }}>+ {KIND[k][0]}</button>)}
        </div>
      </div>
      <p className="sub">Học liệu phát hành tới {me.type === 'provider' ? 'các đơn vị bạn chọn hoặc công khai toàn hệ thống' : `các đơn vị trực thuộc ${me.name}`}. Trường “dùng” sẽ có bản riêng để chỉnh sửa; khi bạn phát hành bản cập nhật, trường được báo nhưng bản của họ không bị ghi đè.</p>
      {msg && <p className="msg">{msg}</p>}
      {info && <p className="sub"><b>{info}</b></p>}

      {form && (
        <form className="panel libform" onSubmit={e => save(e, false)}>
          <h3>{form.id ? 'Sửa' : 'Thêm'} {KIND[form.kind][0].toLowerCase()}</h3>
          <div className="formgrid">
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Tên *</span><input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Mô tả ngắn</span><textarea rows={2} value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} /></label>
            <label className="field"><span>Môn</span><input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="VD: Công nghệ" /></label>
            <label className="field"><span>Khối</span><input value={form.grades} onChange={e => setForm({ ...form, grades: e.target.value })} placeholder="VD: 8,9" /></label>
            <label className="field"><span>Chương trình</span><select value={form.program} onChange={e => setForm({ ...form, program: e.target.value })}><option value="">—</option>{PROGRAMS.map(p => <option key={p}>{p}</option>)}</select></label>
            <label className="field"><span>Từ khoá</span><input value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="robot, cảm biến" /></label>
            <label className="field"><span>Phát hành tới</span>
              <select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value as Item['scope'] })}>
                {me.type !== 'provider' && <option value="children">{SCOPE.children}</option>}
                <option value="selected">{SCOPE.selected}</option>
                {canPublic && <option value="public">{SCOPE.public}</option>}
              </select></label>
          </div>
          {form.scope === 'selected' && (
            <fieldset className="libtargets"><legend>Đơn vị nhận (gồm cả đơn vị trực thuộc của đơn vị được chọn)</legend>
              {below.length === 0 && <p className="sub">Đơn vị chưa có cấp dưới.</p>}
              {below.map(o => (
                <label key={o.id}><input type="checkbox" checked={form.targets.includes(o.id)}
                  onChange={e => setForm({ ...form, targets: e.target.checked ? [...form.targets, o.id] : form.targets.filter(x => x !== o.id) })} /> {o.name}</label>
              ))}
            </fieldset>
          )}

          {form.kind === 'lesson' && (
            <>
              <div className="bar small"><b>Slide bài giảng</b>
                <select value="" onChange={e => importLesson(e.target.value)} aria-label="Sao chép từ bài giảng có sẵn">
                  <option value="">Sao chép từ bài giảng có sẵn…</option>
                  {lessons.map(l => <option key={l.id} value={l.id}>{l.title}{l.teachers ? ` — ${l.teachers.full_name}` : ''}</option>)}
                </select></div>
              <SlidesEditor slides={form.slides} onChange={slides => setForm({ ...form, slides })} />
            </>
          )}
          {form.kind === 'material' && (
            <div className="formgrid">
              <label className="field"><span>Loại</span><select value={form.mtype} onChange={e => setForm({ ...form, mtype: e.target.value })}>{Object.entries(MAT_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="field" style={{ gridColumn: 'span 3' }}><span>Đường dẫn *</span><input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://…" /></label>
            </div>
          )}
          {form.kind === 'program' && (
            <div className="libunitedit">
              <b>Các chủ đề</b>
              {form.units.map((u, k) => (
                <div className="unitrow" key={k}>
                  <b className="no">{k + 1}</b>
                  <input value={u.title} onChange={e => setUnit(k, { title: e.target.value })} placeholder="Tên chủ đề" aria-label={`Tên chủ đề ${k + 1}`} />
                  <input type="number" min={0} value={u.periods ?? 0} onChange={e => setUnit(k, { periods: Number(e.target.value) })} aria-label="Số tiết" title="Số tiết" />
                  <input value={u.objectives ?? ''} onChange={e => setUnit(k, { objectives: e.target.value })} placeholder="Mục tiêu" aria-label="Mục tiêu" />
                  <select value="" onChange={e => e.target.value && setUnit(k, { lesson_ids: [...(u.lesson_ids ?? []), e.target.value] })} aria-label="Gắn bài giảng">
                    <option value="">+ Gắn bài giảng trong kho…</option>
                    {lessonPool.filter(x => !(u.lesson_ids ?? []).includes(x.id)).map(x => <option key={x.id} value={x.id}>{x.title} · {x.owner_name}</option>)}
                  </select>
                  <button type="button" onClick={() => setForm({ ...form, units: form.units.filter((_, j) => j !== k) })} aria-label="Xoá chủ đề">×</button>
                  {(u.lesson_ids ?? []).length > 0 && <div className="unitlessons">{(u.lesson_ids ?? []).map(id => (
                    <span className="chip" key={id}>{visible.find(x => x.id === id)?.title ?? 'bài giảng'}<button type="button" className="x" aria-label="Bỏ bài giảng" onClick={() => setUnit(k, { lesson_ids: (u.lesson_ids ?? []).filter(x => x !== id) })}>×</button></span>))}</div>}
                </div>
              ))}
              <button type="button" className="linkbtn" onClick={() => setForm({ ...form, units: [...form.units, { title: `Chủ đề ${form.units.length + 1}`, periods: 2, objectives: '', lesson_ids: [] }] })}>+ Thêm chủ đề</button>
            </div>
          )}
          <div className="formactions">
            <button type="button" className="primary" disabled={busy} onClick={e => save(e as unknown as React.FormEvent, true)}>Lưu & phát hành</button>
            <button type="submit" disabled={busy}>Lưu nháp</button>
            <button type="button" onClick={() => setForm(null)}>Huỷ</button>
          </div>
        </form>
      )}

      <div className="wrap">
        <table>
          <thead><tr><th>Học liệu</th><th>Phát hành tới</th><th>Trạng thái</th><th>Trường đã dùng</th><th></th></tr></thead>
          <tbody>
            {shown.map(i => {
              const s = stats.get(i.id)
              return (<Fragment key={i.id}>
                <tr>
                  <td><KindChip kind={i.kind} /> <ProgChip p={i.program} /><br /><b>{i.title}</b><br /><small className="sub">{[i.subject, i.grades && `Khối ${i.grades}`, `cập nhật ${fmtDate(i.updated_at)}`].filter(Boolean).join(' · ')}</small></td>
                  <td>{SCOPE[i.scope]}{i.scope === 'selected' && <><br /><small className="sub">{(targets.get(i.id) ?? []).map(id => orgs.find(o => o.id === id)?.name).filter(Boolean).join(', ')}</small></>}</td>
                  <td><StatusChip s={i.status} />{i.version > 0 && <small className="sub"> v{i.version}</small>}</td>
                  <td>{s ? <>{s.schools} trường{s.outdated ? <><br /><small className="sub">{s.outdated} bản dùng phiên bản cũ</small></> : null}</> : <small className="sub">Chưa có</small>}</td>
                  <td className="actions">
                    <button type="button" onClick={() => setOpen(open === i.id ? null : i.id)}>{open === i.id ? 'Thu gọn' : 'Xem'}</button>
                    <button type="button" onClick={() => edit(i)}>Sửa</button>
                    <button type="button" className={i.status !== 'published' ? 'primary' : ''} onClick={() => publish(i)}>{i.status === 'published' ? 'Phát hành bản cập nhật' : 'Phát hành'}</button>
                    {i.status === 'published' && <button type="button" onClick={() => unpublish(i)}>Thu hồi</button>}
                    {i.status !== 'published' && !s && <button type="button" className="danger" onClick={() => remove(i)}>Xoá</button>}
                  </td>
                </tr>
                {open === i.id && <tr><td colSpan={5}><ItemPreview item={i} all={visible} /></td></tr>}
              </Fragment>)
            })}
            {shown.length === 0 && <tr><td colSpan={5}>Chưa có học liệu. Bấm “+ Bài giảng”, “+ Học liệu” hoặc “+ Chương trình” để bắt đầu.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
