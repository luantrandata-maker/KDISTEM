import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../../lib/supabase'
import { HEAT, LEVEL, nf, type SchoolStat } from './data'
import { rampColor } from './charts'

// Bản đồ độ phủ STEM (Dashboard toàn Sở): mỗi trường một chấm trên nền OpenStreetMap.
// Màu = chỉ số đang chọn (thang xanh của bản đồ nhiệt, đậm = tốt so với mục tiêu); kích thước = số học sinh.
// Trường chưa có toạ độ: Sở/KDI đặt bằng cách chọn trường rồi bấm lên bản đồ (set_school_location, migration 036).
// Nền OSM chỉ dùng cho demo; bán chính thức chuyển sang nhà cung cấp bản đồ Việt Nam.

type Loc = { id: string; lat: number | null; lng: number | null }
const short = (n: string) => n.replace(/^Trường\s+/, '').replace('Tiểu học', 'TH')
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
// Bán kính theo căn bậc hai số học sinh (diện tích tỉ lệ với số HS), 5–13 px: đủ thấy, ít che trường lân cận
const radius = (students: number, maxStudents: number) => 5 + 8 * Math.sqrt(Math.max(0, students) / Math.max(1, maxStudents))

export default function SchoolMap({ schools }: { schools: SchoolStat[] }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const [locs, setLocs] = useState<Record<string, Loc>>({})
  const [metric, setMetric] = useState('kpi')
  const [placing, setPlacing] = useState<string>('')        // trường đang chờ bấm lên bản đồ để đặt vị trí
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function loadLocs() {
    const ids = schools.map(s => s.school_id)
    if (!ids.length) return
    const { data, error } = await supabase.from('organizations').select('id, lat, lng').in('id', ids)
    if (error) return setErr(/lat|column/i.test(error.message) ? 'CSDL chưa có cột vị trí trường (migration 036).' : error.message)
    setLocs(Object.fromEntries((data as Loc[]).map(l => [l.id, l])))
  }
  useEffect(() => { loadLocs() }, [schools])

  const h = HEAT.find(x => x.key === metric)!
  const placed = useMemo(() => schools.filter(s => locs[s.school_id]?.lat != null), [schools, locs])
  const missing = useMemo(() => schools.filter(s => locs[s.school_id] && locs[s.school_id].lat == null), [schools, locs])
  const maxStudents = Math.max(1, ...schools.map(s => s.students))

  // Tạo bản đồ một lần
  useEffect(() => {
    if (!box.current || map.current) return
    const m = L.map(box.current, { zoomControl: true, scrollWheelZoom: false, attributionControl: true }).setView([20.8, 106.05], 10)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m)
    m.on('focus', () => m.scrollWheelZoom.enable()); m.on('blur', () => m.scrollWheelZoom.disable())
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    return () => { m.remove(); map.current = null }
  }, [])

  // Vẽ lại chấm khi đổi chỉ số / vị trí
  useEffect(() => {
    const m = map.current, g = layer.current
    if (!m || !g) return
    g.clearLayers()
    const pts: L.LatLngExpression[] = []
    // Trường lớn vẽ trước để trường nhỏ nằm trên, không bị che
    ;[...placed].sort((a, b) => b.students - a.students).forEach(s => {
      const l = locs[s.school_id]; const v = h.get(s); const t = Math.min(1, v / h.max)
      const ll: L.LatLngExpression = [l.lat!, l.lng!]; pts.push(ll)
      L.circleMarker(ll, { radius: radius(s.students, maxStudents), color: '#0b2a52', weight: 1.5, fillColor: rampColor(t), fillOpacity: 0.95 })
        .bindTooltip(`<b>${esc(short(s.name))}</b> <small>${esc(LEVEL[s.level ?? ''] ?? '')}</small><br/>`
          + `${esc(s.ward ?? 'Chưa cập nhật xã/phường')}<br/>`
          + `${esc(h.label)}: <b>${esc(h.fmt(v))}</b><br/>`
          + `<small>${metric === 'kpi' ? '' : `KPI ${s.kpi} · `}${nf(s.students)} HS · ${s.programs.length ? esc(s.programs.join(', ')) : 'chưa triển khai CT'}</small>`,
          { direction: 'top', offset: [0, -6], opacity: 1 })
        .addTo(g)
    })
    if (pts.length && !placing) m.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 12 })
  }, [placed, metric, locs])

  // Chế độ đặt vị trí: bấm lên bản đồ
  useEffect(() => {
    const m = map.current
    if (!m) return
    box.current?.classList.toggle('placing', !!placing)
    if (!placing) return
    const onClick = async (e: L.LeafletMouseEvent) => {
      const { error } = await supabase.rpc('set_school_location', { p_org: placing, p_lat: e.latlng.lat, p_lng: e.latlng.lng })
      if (error) { setMsg(error.code === '42501' ? 'Bạn không có quyền đặt vị trí trường này.' : error.message); return }
      const s = schools.find(x => x.school_id === placing)
      setMsg(`Đã đặt vị trí ${s ? short(s.name) : 'trường'}.`); setPlacing(''); loadLocs()
    }
    m.once('click', onClick)
    return () => { m.off('click', onClick) }
  }, [placing])

  return (
    <div className="panel">
      <div className="bar">
        <h3>Bản đồ độ phủ STEM</h3>
        <span className="tools"><small>Tô màu theo</small>
          <select value={metric} onChange={e => setMetric(e.target.value)} aria-label="Chỉ số tô màu trên bản đồ">
            {HEAT.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select></span>
      </div>
      <p className="sub" style={{ margin: '0 0 8px' }}>
        Mỗi chấm là một trường: màu càng đậm, {h.label} càng cao so với mục tiêu; chấm càng lớn, trường càng nhiều học sinh. Rê chuột vào chấm để xem chi tiết.
      </p>
      {err && <p className="sub">{err}</p>}
      <div ref={box} className="stemmap" role="region" aria-label={`Bản đồ ${placed.length} trường, tô màu theo ${h.label}`} tabIndex={0} />
      <div className="maplegend">
        <span className="heatlegend"><small>{h.label} thấp</small>{[0, 0.2, 0.4, 0.6, 0.8, 1].map(t => <i key={t} style={{ background: rampColor(t) }} />)}<small>cao</small></span>
        <span className="sizelegend" aria-label="Kích thước chấm theo số học sinh">
          {[0.15, 0.5, 1].map(f => { const r = radius(f * maxStudents, maxStudents); return <i key={f} style={{ width: 2 * r, height: 2 * r }} /> })}
          <small>số học sinh (đến {nf(maxStudents)})</small>
        </span>
        <small className="mapcount">{placed.length}/{schools.length} trường có vị trí</small>
      </div>
      {missing.length > 0 && (
        <div className="mapmissing">
          <small><b>{missing.length} trường chưa có vị trí</b> — chọn trường rồi bấm vào đúng chỗ trên bản đồ:</small>
          <select value={placing} onChange={e => { setPlacing(e.target.value); setMsg('') }} aria-label="Chọn trường cần đặt vị trí">
            <option value="">Chọn trường…</option>
            {missing.map(s => <option key={s.school_id} value={s.school_id}>{short(s.name)}{s.ward ? ` · ${s.ward}` : ''}</option>)}
          </select>
          {placing && <button type="button" onClick={() => setPlacing('')}>Huỷ</button>}
        </div>
      )}
      {placing && <p className="sub mapnote">Bấm vào vị trí của trường trên bản đồ.</p>}
      {msg && <p className="sub mapnote" role="status">{msg}</p>}
    </div>
  )
}
