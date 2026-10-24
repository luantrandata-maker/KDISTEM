// Ghi bộ học liệu (library_items kind 'unit', content.kit — 080) và các mục kho đi kèm.
import { supabase } from '../../../lib/supabase'
import { uploadLearningFile, MAX_FILE_MB, fmtSize } from '../../../lib/files'
import { readKitFile, type KitDraft } from '../../../lib/kitImport'
import { norm as normText } from '../../../lib/sheet'
import { saveUnitNorm, loadUnitNorm } from '../UnitNorm'
import type { KitCard } from '../common'
import { kitFromDraft, kitOf, mergeKit, planFromKit, key, emptyKit, ACT_STARTER, type KitData, type KDoc, type KMat, type ParseResult } from './model'

export type KitRow = {
  id: string; owner_org_id: string; title: string; subject: string | null; grades: string | null; program: string | null
  program_id: string | null; unit_id: string | null; status: 'draft' | 'published' | 'archived'; version: number; updated_at: string
  scope: string; usage_rights: string | null
  content: { objectives?: string | null; periods?: number | null; plan_ids?: string[]; lesson_ids?: string[]; norm_ids?: string[]; material_ids?: string[]; checked?: KitCard[]; kit?: unknown }
}
export const KIT_SEL = 'id, owner_org_id, title, subject, grades, program, program_id, unit_id, status, version, updated_at, scope, usage_rights, content'
export const errMsg = (m: string) => (/schema cache|does not exist|column .* of relation/i.test(m) ? 'Hãy chạy migration 080 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Bạn không có quyền sửa học liệu của đơn vị này.' : m)

/** Đọc một file (giáo án .docx, bài giảng .pptx, file mẫu .xlsx) thành phần 5 thẻ + bản nháp gốc */
export async function parseFile(f: File): Promise<{ draft: KitDraft; res: ParseResult }> {
  const draft = await readKitFile(f)
  return { draft, res: kitFromDraft(draft, f.name) }
}

/** Dòng thẻ 03 cho tệp gốc (giáo án Word / bài giảng PowerPoint); đính kèm nếu không quá giới hạn tải lên */
export async function fileDoc(orgId: string, f: File, d: KitDraft): Promise<KDoc> {
  const isDeck = d.source === 'pptx'
  const meta = isDeck && d.deck
    ? [`${d.deck.slides} slide`, d.deck.outline.length && `${d.deck.outline.length} mốc dàn ý`, d.deck.notes && `${d.deck.notes} slide có lời dẫn`].filter(Boolean).join(' · ')
    : fmtSize(f.size)
  const doc: KDoc = { key: key(), title: isDeck ? 'Bài giảng PowerPoint' : 'Giáo án Word', type: isDeck ? 'slides' : 'plan', url: '', file: null,
    file_name: f.name, size: f.size, meta, outline: isDeck ? d.deck?.outline : undefined, item_id: null }
  if (f.size <= MAX_FILE_MB * 1024 * 1024) {
    const up = await uploadLearningFile(orgId, 'hoc-lieu', f)
    doc.file = { path: up.path, file_name: up.name, size: up.size, mime: up.mime }
  }
  return doc
}

export const fullContent = (row: KitRow, kit: KitData, patch: Partial<KitRow['content']> = {}) => ({
  objectives: row.content.objectives ?? null, periods: row.content.periods ?? null,
  plan_ids: row.content.plan_ids ?? [], lesson_ids: row.content.lesson_ids ?? [], norm_ids: row.content.norm_ids ?? [], material_ids: row.content.material_ids ?? [],
  checked: row.content.checked ?? [], ...patch, kit,
})

export type NewKit = {
  orgId: string; program: { id: string; ct_code: string | null } | null; progSubject: string
  title: string; unitId?: string | null; parsed?: ParseResult[]; docs?: KDoc[]
  /** Bộ đang có cùng tên trong môn: cập nhật thay vì tạo bản trùng */
  existing?: KitRow | null
}
/** Tạo bài học mới (hoặc cập nhật bài cùng tên) từ các phần đọc được */
export async function saveNewKit(o: NewKit): Promise<{ id?: string; error?: string }> {
  let kit = o.existing ? kitOf(o.existing.content.kit) : emptyKit()
  let subject: string | null = o.existing?.subject ?? null, grades = o.existing?.grades ?? null
  let periods = o.existing?.content.periods ?? null
  const touched = new Set<KitCard>()
  // Giáo án Word / file mẫu đi trước bài giảng: số tiết, môn, khối lấy theo giáo án (tên file bài giảng có thể ghi khác)
  const ps = [...(o.parsed ?? [])].sort((a, b) => Number(!!a.kit.source.pptx) - Number(!!b.kit.source.pptx))
  for (const p of ps) {
    kit = mergeKit(kit, p.kit, p.touched)
    p.touched.forEach(t => touched.add(t))
  }
  const first = <T,>(f: (p: ParseResult) => T | undefined) => ps.map(f).find(Boolean)
  subject = first(p => p.subject) || subject; grades = first(p => p.grades) || grades; periods = first(p => p.periods) || periods
  if (o.docs?.length) { kit = { ...kit, docs: [...kit.docs.filter(d => !o.docs!.some(x => x.type === d.type && (d.type === 'plan' || d.type === 'slides') && !d.item_id)), ...o.docs] }; touched.add('links') }
  kit.info = { ...kit.info, prog_subject: o.progSubject || kit.info.prog_subject }
  const objectives = kit.info.reqs.join('\n') || o.existing?.content.objectives || null
  if (o.existing) {
    const checked = (o.existing.content.checked ?? []).filter(c => !touched.has(c))
    const r = await supabase.from('library_items').update({ subject, grades, content: fullContent(o.existing, kit, { periods, objectives, checked }) }).eq('id', o.existing.id)
    return r.error ? { error: errMsg(r.error.message) } : { id: o.existing.id }
  }
  const row = {
    owner_org_id: o.orgId, kind: 'unit', title: o.title.trim(), subject: subject || o.progSubject || null, grades,
    program_id: o.program?.id ?? null, unit_id: o.program && o.unitId ? o.unitId : null, program: o.program?.ct_code ?? null,
    scope: 'children', usage_rights: 'adapt', tags: [] as string[],
    content: { objectives, periods, plan_ids: [], lesson_ids: [], norm_ids: [], material_ids: [], checked: [], kit },
  }
  const r = await supabase.from('library_items').insert(row).select('id').single()
  return r.error ? { error: errMsg(r.error.message) } : { id: (r.data as { id: string }).id }
}

/** Sao chép một bài học đã có thành bài mới (nháp, chưa chốt thẻ nào) để chỉnh sửa riêng.
 *  Tài liệu ở thẻ 03 được tạo lại khi chốt (không dùng chung mục của bài gốc); hoạt động thẻ 05 và vật tư vẫn trỏ tới kho chung. */
export async function copyKit(o: { orgId: string; src: KitRow; title: string; program: { id: string; ct_code: string | null } | null; progSubject: string }): Promise<{ id?: string; error?: string }> {
  const k = kitOf(o.src.content.kit)
  const kit: KitData = { ...k, docs: k.docs.map(d => ({ ...d, item_id: null })), info: { ...k.info, prog_subject: o.progSubject || k.info.prog_subject }, issues: [] }
  const row = {
    owner_org_id: o.orgId, kind: 'unit', title: o.title.trim(), subject: o.src.subject, grades: o.src.grades,
    program_id: o.program?.id ?? null, unit_id: null, program: o.program?.ct_code ?? o.src.program,
    scope: 'children', usage_rights: 'adapt', tags: [] as string[],
    content: { objectives: o.src.content.objectives ?? null, periods: o.src.content.periods ?? null, plan_ids: [], lesson_ids: [], norm_ids: [], material_ids: [], checked: [], kit },
  }
  const r = await supabase.from('library_items').insert(row).select('id').single()
  return r.error ? { error: errMsg(r.error.message) } : { id: (r.data as { id: string }).id }
}

// ---------- Chốt từng thẻ: tạo các mục trong danh mục ----------
type Ctx = { orgId: string; row: KitRow; kit: KitData }
const baseItem = (c: Ctx) => ({
  owner_org_id: c.orgId, subject: c.row.subject, grades: c.row.grades, program: c.row.program, program_id: c.row.program_id,
  unit_id: c.row.program_id ? c.row.unit_id : null, usage_rights: c.row.usage_rights ?? 'adapt', scope: c.row.scope === 'selected' ? 'children' : c.row.scope, tags: [] as string[],
})
async function insertItem(c: Ctx, row: Record<string, unknown>) {
  const r = await supabase.from('library_items').insert({ ...baseItem(c), ...row }).select('id').single()
  if (r.error) throw new Error(r.error.message)
  return (r.data as { id: string }).id
}
const fileAtt = (d: KDoc) => (d.file ? { url: '', ...d.file } : { url: d.url.trim() })

/** Thẻ 02: giáo án (mục kho "Giáo án") dựng từ các buổi, hoạt động; có thì cập nhật */
async function chotContent(c: Ctx, content: KitRow['content']) {
  const plan = planFromKit(c.kit, c.row.content.periods ?? null)
  const doc = c.kit.docs.find(d => d.type === 'plan')
  const mine = (content.plan_ids ?? [])[0]
  if (mine) {
    const cur = await supabase.from('library_items').select('id, owner_org_id, content').eq('id', mine).maybeSingle()
    const it = cur.data as { id: string; owner_org_id: string; content: Record<string, unknown> } | null
    if (it && it.owner_org_id === c.orgId) {
      const u = await supabase.from('library_items').update({ content: { ...it.content, ...plan, type: 'lesson_plan' } }).eq('id', it.id)
      if (u.error) throw new Error(u.error.message)
      if (doc && !doc.item_id) doc.item_id = it.id
      return content
    }
  }
  const id = await insertItem(c, { kind: 'material', title: `Giáo án: ${c.row.title}`, content: { type: 'lesson_plan', ...(doc ? fileAtt(doc) : { url: '' }), ...plan } })
  if (doc && !doc.item_id) doc.item_id = id
  return { ...content, plan_ids: [id, ...(content.plan_ids ?? [])] }
}
/** Thẻ 03: mỗi dòng chưa có trong danh mục thành một học liệu (giáo án, bài giảng, tài liệu…) */
async function chotLinks(c: Ctx, content: KitRow['content']) {
  const out = { ...content, plan_ids: [...(content.plan_ids ?? [])], lesson_ids: [...(content.lesson_ids ?? [])], material_ids: [...(content.material_ids ?? [])] }
  for (const d of c.kit.docs) {
    if (d.item_id || !d.title.trim()) continue
    if (d.type === 'plan') {
      if (out.plan_ids[0]) { d.item_id = out.plan_ids[0]; continue }
      d.item_id = await insertItem(c, { kind: 'material', title: `Giáo án: ${c.row.title}`, content: { type: 'lesson_plan', ...fileAtt(d), ...planFromKit(c.kit, c.row.content.periods ?? null) } })
      out.plan_ids.push(d.item_id)
    } else if (d.type === 'slides') {
      d.item_id = await insertItem(c, { kind: 'lesson', title: `Bài giảng: ${c.row.title}`, content: { mode: 'slides', slides: [], ...(d.file ? { url: '', ...d.file } : d.url.trim() ? { url: d.url.trim() } : {}) } })
      out.lesson_ids.push(d.item_id)
    } else {
      d.item_id = await insertItem(c, { kind: 'material', title: d.title.trim(), content: { type: d.type === 'link' ? 'link' : d.type, ...fileAtt(d) } })
      out.material_ids.push(d.item_id)
    }
  }
  return out
}
type Cat = { id: string; name: string; unit: string; kind: KMat['kind']; reusable: boolean }
export async function loadCatalog(): Promise<Cat[]> {
  const { data } = await supabase.from('material_catalog').select('id, name, unit, kind, reusable').eq('active', true).order('name')
  return (data as Cat[]) ?? []
}
export type BankAct = { id: string; title: string; kind: string; status: string; is_template: boolean; org_id: string }
/** Hoạt động trong Kho hoạt động (bảng activities) của đơn vị và bản mẫu dùng chung */
export async function loadActivities(orgId?: string): Promise<BankAct[]> {
  let q = supabase.from('activities').select('id, title, kind, status, is_template, org_id')
  if (orgId) q = q.or(`org_id.eq.${orgId},is_template.eq.true`)
  const { data } = await q.order('title').limit(500)
  return (data as BankAct[]) ?? []
}
/** Thẻ 05: hoạt động chưa có trong kho được tạo thành bản mẫu nháp ở Kho hoạt động (giáo viên thấy, sao chép và soạn tiếp) */
async function chotBank(c: Ctx) {
  const have = new Set((await loadActivities(c.orgId)).map(a => a.id))
  for (const b of c.kit.bank) {
    if (!b.title.trim() || (b.activity_id && have.has(b.activity_id))) continue
    const r = await supabase.from('activities').insert({
      org_id: c.orgId, teacher_id: null, kind: b.kind in ACT_STARTER ? b.kind : 'quiz', title: b.title.trim().slice(0, 200),
      instructions: [b.act && `Dùng ở: ${b.act}`, b.note, `Bài học: ${c.row.title}`].filter(Boolean).join('\n'),
      subject: c.row.subject, grades: c.row.grades, program: c.row.program, content: ACT_STARTER[b.kind] ?? ACT_STARTER.quiz,
      is_template: true, status: 'draft',
    }).select('id').single()
    if (r.error) throw new Error('Chưa tạo được hoạt động “' + b.title + '” trong Kho hoạt động: ' + r.error.message)
    b.activity_id = (r.data as { id: string }).id
  }
}
/** Thẻ 04: vật tư chưa có trong danh mục được thêm vào danh mục; lưu định mức của bài (material_norms) */
async function chotNorms(c: Ctx, content: KitRow['content']) {
  const cat = await loadCatalog()
  for (const m of [...c.kit.mats.product, ...c.kit.mats.group]) {
    if (!m.name.trim()) continue
    const hit = cat.find(x => x.id === m.catalog_id) ?? cat.find(x => normText(x.name) === normText(m.name))
    if (hit) { m.catalog_id = hit.id; continue }
    const r = await supabase.from('material_catalog').insert({ org_id: c.orgId, name: m.name.trim(), unit: m.unit.trim() || 'cái', kind: m.kind, reusable: m.kind !== 'supply' })
      .select('id').single()
    if (r.error) throw new Error(r.error.message)
    m.catalog_id = (r.data as { id: string }).id
  }
  // Định mức của bài: một sản phẩm cho mỗi nhóm, nên 2 bảng gộp thành định mức theo nhóm
  const cur = await loadUnitNorm(c.row.id, c.orgId)
  const rows = [...c.kit.mats.product, ...c.kit.mats.group].filter(m => m.name.trim() && Number(m.qty.replace(',', '.')) > 0)
    .map(m => ({ key: m.key, catalog_id: m.catalog_id, name: m.name.trim(), unit: m.unit.trim() || 'cái', kind: m.kind, qty: m.qty, reusable: m.kind !== 'supply' }))
  const g = (c.row.grades ?? '').split(',').map(Number).filter(Boolean)
  const r = await saveUnitNorm({ ...cur, basis: 'group', rows, dirty: true }, { itemId: c.row.id, orgId: c.orgId, title: c.row.title, subject: c.row.subject, grade: g.length === 1 ? g[0] : null, publish: false })
  if (r.error) throw new Error(r.error)
  return { ...content, norm_ids: [...(r.id ? [r.id] : []), ...(content.norm_ids ?? []).filter(x => x !== r.id && x !== cur.id)] }
}

/** Chốt một thẻ: tạo các mục danh mục của thẻ rồi ghi trạng thái chốt */
export async function chotCard(orgId: string, row: KitRow, kit0: KitData, card: KitCard): Promise<{ error?: string }> {
  const kit: KitData = JSON.parse(JSON.stringify(kit0))
  const c: Ctx = { orgId, row, kit }
  let content: KitRow['content'] = { ...row.content }
  try {
    if (card === 'content') content = await chotContent(c, content)
    if (card === 'links') content = await chotLinks(c, content)
    if (card === 'norms') content = await chotNorms(c, content)
    if (card === 'bank') await chotBank(c)
  } catch (e) { return { error: errMsg(e instanceof Error ? e.message : String(e)) } }
  const checked = [...new Set([...(row.content.checked ?? []), card])]
  const r = await supabase.from('library_items').update({ content: fullContent({ ...row, content }, kit, { checked }) }).eq('id', row.id)
  return r.error ? { error: errMsg(r.error.message) } : {}
}

/** Phát hành bộ học liệu: phát hành luôn giáo án, bài giảng, học liệu nháp và định mức của bài */
export async function publishKit(orgId: string, row: KitRow, note: string | null): Promise<{ version?: number; error?: string }> {
  const ids = [...(row.content.plan_ids ?? []), ...(row.content.lesson_ids ?? []), ...(row.content.material_ids ?? [])]
  if (ids.length) {
    const { data } = await supabase.from('library_items').select('id, title, status, owner_org_id').in('id', ids)
    for (const x of ((data ?? []) as { id: string; title: string; status: string; owner_org_id: string }[]).filter(x => x.owner_org_id === orgId && x.status === 'draft')) {
      const p = await supabase.rpc('library_publish', { p_item: x.id, p_note: null })
      if (p.error) return { error: `“${x.title}”: ${p.error.message}` }
    }
  }
  const n = await saveUnitNorm(await loadUnitNorm(row.id, orgId), { itemId: row.id, orgId, title: row.title, subject: row.subject, grade: null, publish: true })
  if (n.error) return { error: 'Chưa ban hành được định mức vật tư: ' + n.error }
  const p = await supabase.rpc('library_publish', { p_item: row.id, p_note: note })
  return p.error ? { error: errMsg(p.error.message) } : { version: p.data as number }
}
