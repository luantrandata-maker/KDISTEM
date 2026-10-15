import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tabs } from '../teacher/common'
import { Tiles } from '../department/charts'
import { useDeptStats } from '../department/data'
import { fmtTime } from './data'

// Tích hợp & dữ liệu (migration 025): trạng thái các kết nối + độ đầy đủ dữ liệu của từng trường

type I = { key: string; name: string; purpose: string | null; direction: string | null; status: string; endpoint: string | null; owner: string | null
  note: string | null; last_sync_at: string | null; last_error: string | null; records: number | null; updated_at: string }
const STATUS: Record<string, [string, string]> = { active: ['Đang chạy', 'ok'], error: ['Lỗi', 'bad'], paused: ['Tạm dừng', 'warn'], not_configured: ['Chưa kết nối', 'mute'] }
const daysAgo = (iso: string | null) => iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : Infinity
type T = 'links' | 'data'

export function PlatformIntegrations() {
  const [rows, setRows] = useState<I[]>([])
  const [t, setT] = useState<T>('links')
  const [edit, setEdit] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const st = useDeptStats()
  const load = () => supabase.from('integrations').select('*').order('name').then(({ data, error }) => error
    ? setMsg(/schema cache|does not exist|relation/i.test(error.message) ? 'Hãy chạy migration 025_platform_wave2_rollout_catalog_broadcast.sql trên Supabase.' : error.message)
    : setRows((data as I[]) ?? []))
  useEffect(() => { load() }, [])

  async function save(e: React.FormEvent<HTMLFormElement>, key: string) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const v = (k: string) => String(fd.get(k) ?? '').trim() || null
    const { data: u } = await supabase.auth.getUser()
    const { error } = await supabase.from('integrations').update({ status: v('status'), endpoint: v('endpoint'), owner: v('owner'), note: v('note'),
      last_error: v('last_error'), last_sync_at: v('last_sync_at') ? new Date(v('last_sync_at')!).toISOString() : null,
      records: v('records') ? Number(v('records')) : null, updated_at: new Date().toISOString(), updated_by: u.user?.id }).eq('key', key)
    if (error) return setMsg(error.message)
    setMsg(''); setEdit(null); load()
  }

  const schools = st.schools
  const flags = (s: typeof schools[number]) => [
    s.teachers === 0 && 'Chưa có giáo viên', s.students === 0 && 'Chưa có học sinh', s.classes === 0 && 'Chưa có lớp',
    !s.has_year && 'Chưa có năm học', s.activated && daysAgo(s.last_activity) > 30 && 'Không cập nhật > 30 ngày',
  ].filter(Boolean) as string[]
  const missing = schools.filter(s => flags(s).length)

  return (
    <>
      <Tiles items={[
        { label: 'Kết nối đang chạy', value: rows.filter(r => r.status === 'active').length, sub: `/ ${rows.length} kết nối`, tone: 'good' },
        { label: 'Kết nối lỗi', value: rows.filter(r => r.status === 'error').length, tone: rows.some(r => r.status === 'error') ? 'bad' : '' },
        { label: 'Trường đồng bộ K12', value: schools.filter(s => s.k12_synced).length, sub: `/ ${schools.length} trường` },
        { label: 'Trường thiếu dữ liệu', value: missing.length, tone: missing.length ? 'warn' : 'good' },
      ]} />
      <Tabs items={[['links', 'Kết nối', rows.length], ['data', 'Dữ liệu theo trường', missing.length]]} value={t} onChange={setT} />
      {msg && <p className="msg">{msg}</p>}

      {t === 'links' && <>
        <p className="sub">Khoá truy cập, mật khẩu của đối tác <b>không</b> lưu ở đây: đặt trong Supabase → Project Settings → Secrets (hoặc Edge Functions secrets).</p>
        <div className="wrap"><table>
          <thead><tr><th>Kết nối</th><th>Chiều</th><th>Trạng thái</th><th>Đồng bộ gần nhất</th><th>Ghi chú</th><th aria-label="Thao tác" /></tr></thead>
          <tbody>
            {rows.map(r => edit === r.key ? (
              <tr key={r.key}><td colSpan={6}>
                <form className="formgrid" onSubmit={e => save(e, r.key)}>
                  <p className="spanall"><b>{r.name}</b> · {r.purpose}</p>
                  <label className="field"><span>Trạng thái</span><select name="status" defaultValue={r.status}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></label>
                  <label className="field"><span>Địa chỉ API</span><input name="endpoint" defaultValue={r.endpoint ?? ''} placeholder="https://…" /></label>
                  <label className="field"><span>Đầu mối phía đối tác</span><input name="owner" defaultValue={r.owner ?? ''} /></label>
                  <label className="field"><span>Đồng bộ gần nhất</span><input name="last_sync_at" type="datetime-local" defaultValue={r.last_sync_at ? r.last_sync_at.slice(0, 16) : ''} /></label>
                  <label className="field"><span>Số bản ghi</span><input name="records" type="number" min={0} defaultValue={r.records ?? ''} /></label>
                  <label className="field spanall"><span>Lỗi gần nhất</span><input name="last_error" defaultValue={r.last_error ?? ''} /></label>
                  <label className="field spanall"><span>Ghi chú</span><textarea name="note" rows={2} defaultValue={r.note ?? ''} /></label>
                  <div className="formactions"><button className="primary" type="submit">Lưu</button> <button type="button" onClick={() => setEdit(null)}>Huỷ</button></div>
                </form>
              </td></tr>
            ) : (
              <tr key={r.key}>
                <td><b>{r.name}</b><br /><small>{r.purpose}</small></td>
                <td>{r.direction ?? '—'}</td>
                <td><span className={'plbadge ' + STATUS[r.status][1]}>{STATUS[r.status][0]}</span>{r.last_error && <><br /><small className="late">{r.last_error}</small></>}</td>
                <td>{r.last_sync_at ? fmtTime(r.last_sync_at) : '—'}{r.records != null && <><br /><small>{r.records.toLocaleString('vi-VN')} bản ghi</small></>}</td>
                <td><small>{r.note ?? '—'}</small></td>
                <td><button type="button" onClick={() => setEdit(r.key)}>Sửa</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </>}

      {t === 'data' && (st.loading ? <p className="sub">Đang tải…</p> : st.err ? <p className="msg">{st.err}</p> : (
        <div className="wrap"><table>
          <thead><tr><th>Trường</th><th>Giáo viên</th><th>Học sinh</th><th>Lớp</th><th>K12</th><th>Cập nhật gần nhất</th><th>Cần bổ sung</th></tr></thead>
          <tbody>
            {[...schools].sort((a, b) => flags(b).length - flags(a).length || a.name.localeCompare(b.name, 'vi')).map(s => (
              <tr key={s.school_id}>
                <td><b>{s.name}</b><br /><small>{s.code}</small></td>
                <td>{s.teachers}</td><td>{s.students.toLocaleString('vi-VN')}</td><td>{s.classes}</td>
                <td><span className={'plbadge ' + (s.k12_synced ? 'ok' : 'mute')}>{s.k12_synced ? 'Đã đồng bộ' : 'Nhập tay / Excel'}</span></td>
                <td className={s.activated && daysAgo(s.last_activity) > 30 ? 'late' : ''}>{s.last_activity ? fmtTime(s.last_activity) : '—'}</td>
                <td>{flags(s).map(x => <span key={x} className="plbadge warn misschip">{x}</span>)}{flags(s).length === 0 && <span className="plbadge ok">Đủ</span>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      ))}
    </>
  )
}
