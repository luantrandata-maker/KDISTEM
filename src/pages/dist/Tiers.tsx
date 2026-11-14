import { useEffect, useState } from 'react'
import { DataTable, type Col } from '../../components/DataTable'
import { supabase } from '../../lib/supabase'
import { NameLink } from '../../components/TableSel'
import { ElView } from '../../components/ElView'

// Danh mục mức độ của bản phân phối (078): Cơ bản, Tiêu chuẩn, Nâng cao… KDI thêm / đổi tên / ngừng dùng; đơn vị khác chỉ xem.
export type Tier = { code: string; name: string; sort: number; active: boolean }

let cache: Tier[] | null = null
export function useTiers() {
  const [all, setAll] = useState<Tier[]>(cache ?? [])
  const reload = () => supabase.from('dist_tiers').select('code, name, sort, active').order('sort').order('name')
    .then(({ data }) => { cache = (data as Tier[]) ?? []; setAll(cache) })
  useEffect(() => { reload() }, [])
  const name = (code: string | null | undefined) => (code ? all.find(t => t.code === code)?.name ?? code : 'Chưa chọn mức độ')
  return { all, tiers: all.filter(t => t.active), name, reload }
}

const errText = (m: string) => (/schema cache|does not exist/i.test(m) ? 'Hãy chạy migration 078 trên Supabase.'
  : /row-level|42501|permission/i.test(m) ? 'Chỉ quản trị nền tảng KDI sửa được danh mục này.'
  : /23503|foreign key/i.test(m) ? 'Mức độ đang được bản phân phối dùng — hãy chuyển sang "Ngừng dùng".'
  : /23505|duplicate/i.test(m) ? 'Mã mức độ đã có.'
  : /dist_tiers_code_check/i.test(m) ? 'Mã gồm 2–20 ký tự thường không dấu, số hoặc "_", bắt đầu bằng chữ (vd. nang_cao).' : m)

export function DistTiersCatalog() {
  const { all, reload } = useTiers()
  const [admin, setAdmin] = useState(false)
  const [used, setUsed] = useState<Record<string, number>>({})
  const [form, setForm] = useState<(Tier & { isNew?: boolean }) | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)
  useEffect(() => {
    supabase.rpc('is_platform_admin').then(({ data }) => setAdmin(!!data))
    supabase.from('dist_plans').select('tier').then(({ data }) => {
      const n: Record<string, number> = {}
      for (const r of (data ?? []) as { tier: string | null }[]) if (r.tier) n[r.tier] = (n[r.tier] ?? 0) + 1
      setUsed(n)
    })
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!form) return
    const row = { name: form.name.trim(), sort: Number(form.sort) || 0, active: form.active !== false }
    if (!row.name) return setMsg(['Nhập tên mức độ.', true])
    const { data, error } = form.isNew
      ? await supabase.from('dist_tiers').insert({ ...row, code: form.code.trim().toLowerCase() }).select('code')
      : await supabase.from('dist_tiers').update(row).eq('code', form.code).select('code')
    if (error) return setMsg([errText(error.message + ' ' + (error.code ?? '')), true])
    if (!data?.length) return setMsg([errText('row-level'), true])
    setForm(null); setMsg([form.isNew ? 'Đã thêm mức độ.' : 'Đã lưu mức độ.', false]); reload()
  }
  async function setActive(t: Tier, active: boolean) {
    const { error } = await supabase.from('dist_tiers').update({ active }).eq('code', t.code)
    if (error) return setMsg([errText(error.message), true])
    setForm(null); setMsg([active ? `Đã dùng lại mức độ "${t.name}".` : `Đã ngừng dùng mức độ "${t.name}".`, false]); reload()
  }
  async function remove(t: Tier) {
    if (!confirm(`Xoá mức độ "${t.name}"? Mức độ đang có bản phân phối dùng thì không xoá được, hãy ngừng dùng.`)) return
    const { data, error } = await supabase.from('dist_tiers').delete().eq('code', t.code).select('code')
    if (error) return setMsg([errText(error.message + ' ' + (error.code ?? '')), true])
    if (!data?.length) return setMsg([errText('row-level'), true])
    setForm(null); setMsg([`Đã xoá mức độ "${t.name}".`, false]); reload()
  }

  if (form) return (
    <ElView back="Mức độ phân phối" onBack={() => setForm(null)} title={form.isNew ? 'Thêm mức độ' : 'Sửa mức độ'}>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
        <form className="panel formgrid" onSubmit={save} style={{ marginBottom: 12 }}>
          <label className="field"><span>Tên mức độ *</span><input required maxLength={60} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="VD: Nâng cao" /></label>
          <label className="field"><span>Mã {form.isNew ? '*' : '(không đổi được)'}</span><input required disabled={!form.isNew} maxLength={20} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="VD: nang_cao" /></label>
          <label className="field"><span>Thứ tự</span><input type="number" min={0} value={form.sort} onChange={e => setForm({ ...form, sort: Number(e.target.value) })} /></label>
          <div className="formactions tools"><button className="primary" type="submit">{form.isNew ? 'Thêm' : 'Lưu'}</button> <button type="button" onClick={() => setForm(null)}>Huỷ</button>
            {!form.isNew && <><button type="button" onClick={() => setActive(form, !form.active)}>{form.active ? 'Ngừng dùng' : 'Dùng lại'}</button>
              <button type="button" className="danger" onClick={() => remove(form)}>Xoá</button></>}</div>
        </form>
    </ElView>
  )
  return (
    <>
      {msg && <p className={msg[1] ? 'msg' : 'sub'} role="status"><b>{msg[0]}</b></p>}
      <DataTable id="cat-dist-tiers" rows={all} rowKey={t => t.code} cols={[
        { key: 'name', label: 'Mức độ', fixed: true, text: t => t.name, cell: t => <>{admin ? <NameLink onClick={() => { setMsg(null); setForm({ ...t }) }}><b>{t.name}</b></NameLink> : <b>{t.name}</b>}{!t.active && <> <span className="pill">Ngừng dùng</span></>}</> },
        { key: 'code', label: 'Mã', text: t => t.code, cell: t => <small className="sub">{t.code}</small> },
        { key: 'sort', label: 'Thứ tự', cell: t => t.sort },
        { key: 'used', label: 'Bản phân phối', cell: t => used[t.code] ?? 0 },
      ] as Col<(typeof all)[number]>[]}
        empty={<small className="sub">Chưa có mức độ nào.</small>}
        left={<span className="infotip" tabIndex={0} title={`Mức độ là tầng cuối của khung phân loại bản phân phối (Cấp học › Khối › Mức độ).${admin ? '' : ' Chỉ quản trị nền tảng KDI sửa được.'}`} aria-label="Giải thích">ⓘ Giải thích</span>}
        right={admin && <button type="button" className="primary" onClick={() => { setMsg(null); setForm({ code: '', name: '', sort: all.reduce((m, x) => Math.max(m, x.sort), 0) + 1, active: true, isNew: true }) }}>+ Thêm mức độ</button>} />
    </>
  )
}
