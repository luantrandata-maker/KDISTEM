import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Tiles } from '../department/charts'
import { fmtTime } from './data'

// Điều khoản & dữ liệu cá nhân (migration 039): soạn/công bố Điều khoản sử dụng và Chính sách quyền riêng tư theo phiên bản,
// bắt buộc đồng ý của cha mẹ trước khi tạo tài khoản học sinh, tổng hợp đồng ý theo trường.
type Doc = { id: string; kind: 'terms' | 'privacy'; version: number; title: string; body: string; published_at: string | null; created_at: string }
type Sum = { school_id: string; school_name: string; students: number; consented: number }
const KIND = { terms: 'Điều khoản sử dụng', privacy: 'Chính sách quyền riêng tư' } as const

// Bản nháp khởi đầu — PHẢI được luật sư rà soát trước khi công bố
const DRAFT: Record<Doc['kind'], string> = {
  terms: `[BẢN NHÁP — cần luật sư rà soát trước khi công bố]

1. Phạm vi
Hệ thống Quản trị STEM do Công ty KDI Education (sau đây gọi là "KDI") cung cấp cho cơ quan quản lý giáo dục và nhà trường để tổ chức, quản lý và đánh giá hoạt động giáo dục STEM.

2. Tài khoản
- Tài khoản do nhà trường hoặc cơ quan quản lý cấp. Người dùng giữ bí mật mật khẩu và không cho người khác dùng tài khoản.
- Tài khoản học sinh được cấp theo đề nghị của nhà trường, với sự đồng ý của cha mẹ hoặc người giám hộ.

3. Sử dụng hợp lệ
Không tải lên nội dung vi phạm pháp luật, không truy cập dữ liệu ngoài phạm vi được phân quyền, không làm gián đoạn hệ thống.

4. Dữ liệu
Dữ liệu do nhà trường nhập thuộc quyền quản lý của nhà trường. KDI xử lý dữ liệu theo Chính sách quyền riêng tư.

5. Liên hệ
Mọi thắc mắc gửi về: [email hỗ trợ], [số điện thoại].`,
  privacy: `[BẢN NHÁP — cần luật sư rà soát trước khi công bố]

1. Bên kiểm soát và bên xử lý dữ liệu
Nhà trường / cơ quan quản lý giáo dục quyết định mục đích xử lý dữ liệu của học sinh và giáo viên. KDI Education xử lý dữ liệu theo yêu cầu của nhà trường để vận hành hệ thống.

2. Dữ liệu được xử lý
- Học sinh: họ tên, lớp, mã học sinh, điểm danh, bài làm, kết quả học tập, tiến độ tự học.
- Giáo viên, cán bộ: họ tên, email/tên đăng nhập, đơn vị, vai trò, hoạt động giảng dạy và tập huấn.
- Nhật ký truy cập phục vụ bảo mật.

3. Mục đích
Tổ chức dạy học và đánh giá giáo dục STEM; báo cáo cho cơ quan quản lý theo phân cấp; bảo đảm an toàn hệ thống. Không dùng cho quảng cáo, không bán dữ liệu.

4. Đồng ý của cha mẹ
Dữ liệu học sinh chỉ được xử lý khi có đồng ý của cha mẹ hoặc người giám hộ, do nhà trường thu thập và lưu bằng chứng.

5. Nơi lưu trữ và thời gian lưu
[Nêu nơi đặt máy chủ]. Dữ liệu được lưu trong thời gian học sinh học tại trường và [x] năm sau đó, trừ khi có yêu cầu xoá.

6. Quyền của chủ thể dữ liệu
Được biết, xem, nhận bản sao, yêu cầu sửa, xoá dữ liệu, rút lại đồng ý — liên hệ nhà trường hoặc [email hỗ trợ].

7. Bảo mật
Phân quyền theo đơn vị và vai trò, mã hoá đường truyền, xác thực hai lớp cho quản trị, ghi nhật ký thao tác.

8. Liên hệ người phụ trách bảo vệ dữ liệu cá nhân
[Họ tên], [email], [điện thoại].`,
}

export function PlatformLegal() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [acc, setAcc] = useState<Record<string, number>>({})
  const [sum, setSum] = useState<Sum[]>([])
  const [req, setReq] = useState(false)
  const [edit, setEdit] = useState<Partial<Doc> | null>(null)
  const [msg, setMsg] = useState<[string, boolean] | null>(null)

  async function load() {
    const [d, a, s, st] = await Promise.all([
      supabase.from('legal_documents').select('*').order('kind').order('version', { ascending: false }),
      supabase.from('legal_acceptances').select('document_id'),
      supabase.rpc('consent_summary'),
      supabase.from('security_settings').select('require_student_consent').eq('id', 1).single(),
    ])
    if (d.error) return setMsg([/schema cache|does not exist/i.test(d.error.message) ? 'Hãy chạy migration 039 trên Supabase.' : d.error.message, true])
    setDocs((d.data as Doc[]) ?? [])
    const m: Record<string, number> = {}; ((a.data ?? []) as { document_id: string }[]).forEach(x => { m[x.document_id] = (m[x.document_id] ?? 0) + 1 }); setAcc(m)
    setSum((s.data as Sum[]) ?? []); setReq(!!(st.data as { require_student_consent: boolean } | null)?.require_student_consent)
  }
  useEffect(() => { load() }, [])

  function newVersion(kind: Doc['kind']) {
    const last = docs.find(d => d.kind === kind)
    setEdit({ kind, version: (last?.version ?? 0) + 1, title: KIND[kind], body: last?.body ?? DRAFT[kind] })
  }
  async function save(publish: boolean) {
    if (!edit?.kind || !edit.body?.trim() || !edit.title?.trim()) return
    if (publish && !confirm(`Công bố ${edit.title} phiên bản ${edit.version}? Mọi người dùng phải đọc và đồng ý lại ở lần đăng nhập tiếp theo. Bản đã công bố không sửa được.`)) return
    const row = { kind: edit.kind, version: edit.version, title: edit.title.trim(), body: edit.body, published_at: publish ? new Date().toISOString() : null }
    const { error } = edit.id ? await supabase.from('legal_documents').update(row).eq('id', edit.id) : await supabase.from('legal_documents').insert(row)
    if (error) return setMsg([error.message, true])
    setMsg([publish ? 'Đã công bố. Người dùng sẽ được yêu cầu đồng ý khi vào hệ thống.' : 'Đã lưu bản nháp.', false]); setEdit(null); load()
  }
  async function remove(d: Doc) {
    if (!confirm(`Xoá bản nháp ${d.title} phiên bản ${d.version}?`)) return
    const { error } = await supabase.from('legal_documents').delete().eq('id', d.id)
    if (error) return setMsg([error.message, true]); load()
  }
  async function toggleReq(v: boolean) {
    if (v && !confirm('Bật: trường KHÔNG tạo được tài khoản cho học sinh chưa có đồng ý của cha mẹ. Tài khoản đã có không bị ảnh hưởng.')) return
    const { error } = await supabase.from('security_settings').update({ require_student_consent: v, updated_at: new Date().toISOString() }).eq('id', 1)
    if (error) return setMsg([error.message, true]); setReq(v)
  }

  const total = sum.reduce((a, s) => a + s.students, 0), ok = sum.reduce((a, s) => a + s.consented, 0)
  const current = (k: Doc['kind']) => docs.find(d => d.kind === k && d.published_at)
  return (
    <>
      <Tiles items={[
        { label: 'Điều khoản sử dụng', value: current('terms') ? `v${current('terms')!.version}` : 'Chưa công bố', sub: current('terms') ? `${acc[current('terms')!.id] ?? 0} người đã đồng ý` : 'người dùng chưa phải đồng ý', tone: current('terms') ? 'good' : 'warn' },
        { label: 'Chính sách quyền riêng tư', value: current('privacy') ? `v${current('privacy')!.version}` : 'Chưa công bố', sub: current('privacy') ? `${acc[current('privacy')!.id] ?? 0} người đã đồng ý` : '', tone: current('privacy') ? 'good' : 'warn' },
        { label: 'HS có đồng ý của cha mẹ', value: total ? `${Math.round(ok * 100 / total)}%` : '—', sub: `${ok}/${total} học sinh đang học`, tone: total && ok === total ? 'good' : 'warn' },
        { label: 'Bắt buộc đồng ý khi tạo TK HS', value: req ? 'Bật' : 'Tắt', tone: req ? 'good' : '' },
      ]} />
      {msg && <p className={msg[1] ? 'msg' : 'sub'}><b>{msg[0]}</b></p>}

      <div className="panel">
        <h3>Đồng ý của cha mẹ / người giám hộ</h3>
        <label className="field inline"><input type="checkbox" checked={req} onChange={e => toggleReq(e.target.checked)} /> Bắt buộc có đồng ý của cha mẹ trước khi trường tạo tài khoản đăng nhập cho học sinh</label>
        <p className="sub">Trường ghi nhận đồng ý ở mục <i>Học sinh</i> (từng em, hoặc nhập Excel; có mẫu giấy in theo lớp). Phụ huynh yêu cầu thì trường xuất hoặc xoá dữ liệu của học sinh ở cùng chỗ.</p>
        <div className="wrap"><table>
          <thead><tr><th>Trường</th><th>HS đang học</th><th>Đã có đồng ý</th><th>Tỉ lệ</th></tr></thead>
          <tbody>{sum.filter(s => s.students > 0).map(s => <tr key={s.school_id}><td>{s.school_name}</td><td>{s.students}</td><td>{s.consented}</td>
            <td>{Math.round(s.consented * 100 / s.students)}%</td></tr>)}
            {!sum.some(s => s.students > 0) && <tr><td colSpan={4}>Chưa có học sinh.</td></tr>}</tbody>
        </table></div>
      </div>

      {(['terms', 'privacy'] as const).map(k => (
        <div className="panel" key={k}>
          <div className="bar"><h3>{KIND[k]}</h3><button className="primary" onClick={() => newVersion(k)}>+ Phiên bản mới</button></div>
          <div className="wrap"><table>
            <thead><tr><th>Phiên bản</th><th>Tiêu đề</th><th>Trạng thái</th><th>Đã đồng ý</th><th></th></tr></thead>
            <tbody>{docs.filter(d => d.kind === k).map(d => (
              <tr key={d.id}><td>v{d.version}</td><td>{d.title}</td>
                <td>{d.published_at ? <span className="plbadge ok">Công bố {fmtTime(d.published_at)}</span> : <span className="plbadge mute">Bản nháp</span>}</td>
                <td>{d.published_at ? acc[d.id] ?? 0 : '—'}</td>
                <td className="nowrap">{d.published_at ? <button onClick={() => setEdit({ ...d, id: undefined, version: (docs.find(x => x.kind === k)?.version ?? d.version) + 1, published_at: null })}>Sao thành bản mới</button>
                  : <><button onClick={() => setEdit(d)}>Sửa</button> <button onClick={() => remove(d)}>Xoá</button></>}</td></tr>))}
              {!docs.some(d => d.kind === k) && <tr><td colSpan={5}>Chưa có. Bấm “Phiên bản mới” — nội dung khởi đầu là bản nháp mẫu, cần luật sư rà soát.</td></tr>}</tbody>
          </table></div>
        </div>
      ))}

      {edit && (
        <form className="panel formgrid" onSubmit={e => { e.preventDefault(); save(false) }}>
          <label className="field"><span>Tiêu đề</span><input required value={edit.title ?? ''} onChange={e => setEdit({ ...edit, title: e.target.value })} /></label>
          <label className="field"><span>Phiên bản</span><input type="number" min={1} required value={edit.version ?? 1} onChange={e => setEdit({ ...edit, version: Number(e.target.value) })} /></label>
          <label className="field" style={{ gridColumn: '1 / -1' }}><span>Nội dung (văn bản thường, giữ xuống dòng)</span>
            <textarea rows={18} required value={edit.body ?? ''} onChange={e => setEdit({ ...edit, body: e.target.value })} /></label>
          <div className="formactions">
            <button type="submit">Lưu bản nháp</button> <button type="button" className="primary" onClick={() => save(true)}>Công bố</button> <button type="button" onClick={() => setEdit(null)}>Huỷ</button>
          </div>
        </form>
      )}
    </>
  )
}
