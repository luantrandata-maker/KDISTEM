import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../../lib/supabase'
import { LEVEL, nf, pct, sum, type SchoolStat } from './data'

// Bản đồ độ phủ STEM.
//   · Sở (mặc định): xã/phường của tỉnh có trường → bấm xã/phường xem từng trường.
//   · Cả nước (nation, Quản trị nền tảng): 34 tỉnh/thành → bấm tỉnh xem xã/phường → bấm xã/phường xem từng trường.
// Ranh giới sau sáp nhập 2025 (public/geo: provinces.json, <mã tỉnh>.json, index.json; scripts/build-geo.mjs; nguồn
// sapnhap.bando.com.vn qua vietnamese-provinces-database, MIT). Bản đồ cả nước có Đặc khu Hoàng Sa (TP Đà Nẵng) và
// Đặc khu Trường Sa (tỉnh Khánh Hòa). Trường được xếp vào đơn vị theo toạ độ (migration 036) nằm trong ranh giới nào;
// chưa có toạ độ thì khớp theo tên xã/phường. Không dùng nền bản đồ ngoài.

type Feat = { type: 'Feature'; properties: { code: string; name: string; fullName: string }; geometry: { type: string; coordinates: any } }
type Geo = { type: 'FeatureCollection'; features: Feat[] }
type ProvIdx = { code: string; name: string; fullName?: string; wards: number; bbox: [number, number, number, number] }
type Loc = { id: string; lat: number | null; lng: number | null }
type Lv = 3 | 2 | 1 | 0 | -1             // 3/2/1 = mức, 0 = chưa xếp, -1 = chưa có trường
type Mode = 'level' | 'cov' | 'gv'
type UnitAgg = { code: string; name: string; fullName: string; schools: SchoolStat[]; cov: number; gv: number; stu: number; rooms: number; level: Lv }

const LV: Record<Lv, { label: string; color: string; ink: string }> = {
  3: { label: 'Mức 3', color: '#2c965d', ink: '#fff' },
  2: { label: 'Mức 2', color: '#d4930f', ink: '#fff' },
  1: { label: 'Mức 1', color: '#d64545', ink: '#fff' },
  0: { label: 'Chưa xếp', color: '#9aa5b1', ink: '#fff' },
  [-1]: { label: 'Chưa có trường', color: '#e6ebf1', ink: '#4a5568' },
} as Record<Lv, { label: string; color: string; ink: string }>
const RULE: Record<Mode, { label: string; rules: string[] }> = {
  level: { label: 'Mức STEM', rules: ['Bao phủ STEM ≥ 75% và GV tập huấn ≥ 80%', 'Bao phủ STEM ≥ 50% và GV tập huấn ≥ 50%', 'Bao phủ STEM ≥ 20%', 'Bao phủ STEM < 20%'] },
  cov: { label: 'Bao phủ STEM', rules: ['≥ 75% trường triển khai STEM', '≥ 50%', '≥ 20%', '< 20%'] },
  gv: { label: 'GV tập huấn', rules: ['≥ 80% giáo viên đã tập huấn', '≥ 50%', '≥ 20%', '< 20%'] },
}
const KHOI: [string, string][] = [['', 'Tất cả khối'], ['mamnon', 'Mầm non'], ['tieuhoc', 'Tiểu học'], ['thcs', 'THCS'], ['thpt', 'THPT']]
// Nhãn quần đảo trên bản đồ cả nước
const ISLANDS: { at: [number, number]; text: string }[] = [
  { at: [16.5, 112.0], text: 'QĐ. Hoàng Sa<br/><small>(TP Đà Nẵng)</small>' },
  { at: [9.6, 114.2], text: 'QĐ. Trường Sa<br/><small>(tỉnh Khánh Hòa)</small>' },
]
const short = (n: string) => n.replace(/^Trường\s+/, '').replace('Tiểu học', 'TH')
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/^(xã|phường|thị trấn|đặc khu)\s+/, '').trim()

function levelOf(mode: Mode, cov: number, gv: number, n: number): Lv {
  if (!n) return -1
  if (mode === 'cov') return cov >= 75 ? 3 : cov >= 50 ? 2 : cov >= 20 ? 1 : 0
  if (mode === 'gv') return gv >= 80 ? 3 : gv >= 50 ? 2 : gv >= 20 ? 1 : 0
  return cov >= 75 && gv >= 80 ? 3 : cov >= 50 && gv >= 50 ? 2 : cov >= 20 ? 1 : 0
}
// Điểm (lng, lat) trong đa giác (ray casting), hỗ trợ Polygon/MultiPolygon có lỗ
function inRing(x: number, y: number, r: number[][]) {
  let ins = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins
  }
  return ins
}
function inGeom(x: number, y: number, g: { type: string; coordinates: any }) {
  const polys: number[][][][] = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
  return polys.some(p => inRing(x, y, p[0]) && !p.slice(1).some(h => inRing(x, y, h)))
}
function aggregate(geo: Geo | null, list: SchoolStat[], unitOf: Record<string, string | null>, mode: Mode): UnitAgg[] {
  if (!geo) return []
  return geo.features.map(f => {
    const xs = list.filter(s => unitOf[s.school_id] === f.properties.code)
    const cov = pct(xs.filter(s => s.programs.length > 0).length, xs.length)
    const gv = pct(sum(xs.map(s => s.training_done)), sum(xs.map(s => s.teachers)))
    return { ...f.properties, schools: xs, cov, gv, stu: pct(sum(xs.map(s => s.stem_students)), sum(xs.map(s => s.students))),
      rooms: sum(xs.map(s => s.rooms_active)), level: levelOf(mode, cov, gv, xs.length) }
  })
}

export default function CoverageMap({ schools, nation = false }: { schools: SchoolStat[]; nation?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const unitLayer = useRef<L.GeoJSON | null>(null)
  const dotLayer = useRef<L.LayerGroup | null>(null)
  const labelLayer = useRef<L.LayerGroup | null>(null)
  const [index, setIndex] = useState<ProvIdx[]>([])
  const [provGeo, setProvGeo] = useState<Geo | null>(null)     // 34 tỉnh (chỉ ở chế độ cả nước)
  const [geo, setGeo] = useState<Geo | null>(null)             // xã/phường của tỉnh đang xem
  const [prov, setProv] = useState<ProvIdx | null>(null)
  const [locs, setLocs] = useState<Record<string, Loc>>({})
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const [mode, setMode] = useState<Mode>('level')
  const [khoi, setKhoi] = useState('')
  const [view, setView] = useState<'map' | 'list'>('map')
  const [tab, setTab] = useState<'overview' | 'rank' | 'alert'>('overview')
  const [sel, setSel] = useState<string | null>(null)           // mã xã/phường đang xem
  const [placing, setPlacing] = useState('')
  const placingRef = useRef('')                                 // đọc trong handler của lớp bản đồ (tránh giá trị cũ)
  useEffect(() => { placingRef.current = placing }, [placing])
  const [msg, setMsg] = useState('')
  const atNation = nation && !prov                             // đang xem cấp cả nước

  async function loadLocs() {
    const ids = schools.map(s => s.school_id)
    if (!ids.length) return {}
    const { data, error } = await supabase.from('organizations').select('id, lat, lng').in('id', ids)
    if (error) { setErr(/lat|column/i.test(error.message) ? 'CSDL chưa có cột vị trí trường (migration 036).' : error.message); return {} }
    const m = Object.fromEntries((data as Loc[]).map(l => [l.id, l])); setLocs(m); return m
  }
  async function openProvince(p: ProvIdx) {
    const g = await fetch(`/geo/${p.code}.json`).then(r => r.ok ? r.json() : null).catch(() => null)
    if (!g) { setNote(`Chưa tải được ranh giới xã/phường của ${p.name}.`); return }
    setNote(''); setSel(null); setTab('overview'); setGeo(g); setProv(p)
  }
  function backToNation() { setSel(null); setProv(null); setGeo(null); setTab('overview') }

  useEffect(() => {
    (async () => {
      const m = await loadLocs()
      const idx: ProvIdx[] = await fetch('/geo/index.json').then(r => r.ok ? r.json() : []).catch(() => [])
      setIndex(idx)
      if (nation) {
        const pg = await fetch('/geo/provinces.json').then(r => r.ok ? r.json() : null).catch(() => null)
        if (!pg) { setErr('Không tải được ranh giới tỉnh/thành.'); return }
        setProvGeo(pg); return
      }
      // Sở: tỉnh có nhiều trường nằm trong khung nhất
      const pts = Object.values(m).filter(l => l.lat != null) as { lat: number; lng: number }[]
      const score = (p: ProvIdx) => pts.filter(l => l.lng >= p.bbox[0] && l.lng <= p.bbox[2] && l.lat >= p.bbox[1] && l.lat <= p.bbox[3]).length
      const best = [...idx].sort((a, b) => score(b) - score(a))[0]
      if (!best || !score(best)) { setErr('Chưa có dữ liệu ranh giới xã/phường cho địa bàn này (hoặc các trường chưa có vị trí).'); return }
      const g = await fetch(`/geo/${best.code}.json`).then(r => r.json()).catch(() => null)
      if (!g) { setErr('Không tải được ranh giới xã/phường.'); return }
      setProv(best); setGeo(g)
    })()
  }, [schools, nation])

  // Trường → tỉnh (cả nước) và trường → xã/phường (tỉnh đang xem): theo toạ độ, xã/phường không có toạ độ thì theo tên
  const provOf = useMemo(() => {
    const out: Record<string, string | null> = {}
    if (!provGeo) return out
    schools.forEach(s => {
      const l = locs[s.school_id]
      out[s.school_id] = l?.lat != null ? provGeo.features.find(f => inGeom(l.lng!, l.lat!, f.geometry))?.properties.code ?? null : null
    })
    return out
  }, [provGeo, schools, locs])
  const wardOf = useMemo(() => {
    const out: Record<string, string | null> = {}
    if (!geo) return out
    const byName = new Map(geo.features.map(f => [norm(f.properties.name), f.properties.code]))
    schools.forEach(s => {
      if (nation && prov && provOf[s.school_id] && provOf[s.school_id] !== prov.code) { out[s.school_id] = null; return }
      const l = locs[s.school_id]
      const hit = l?.lat != null ? geo.features.find(f => inGeom(l.lng!, l.lat!, f.geometry)) : undefined
      out[s.school_id] = hit?.properties.code ?? (l?.lat == null && s.ward ? byName.get(norm(s.ward)) ?? null : null)
    })
    return out
  }, [geo, schools, locs, nation, prov, provOf])

  const shown = useMemo(() => schools.filter(s => !khoi || s.level === khoi), [schools, khoi])
  // Phạm vi đang xem: cả nước = mọi trường; một tỉnh (chế độ cả nước) = trường nằm trong tỉnh; Sở = mọi trường của Sở
  const inScope = useMemo(() => !nation ? shown : atNation ? shown
    : shown.filter(s => provOf[s.school_id] === prov!.code || (!provOf[s.school_id] && wardOf[s.school_id])), [shown, nation, atNation, prov, provOf, wardOf])
  const unitGeo = atNation ? provGeo : geo
  const units = useMemo(() => aggregate(unitGeo, inScope, atNation ? provOf : wardOf, mode), [unitGeo, inScope, atNation, provOf, wardOf, mode])
  const umap = useMemo(() => new Map(units.map(w => [w.code, w])), [units])
  const unitOf = atNation ? provOf : wardOf
  const unplaced = inScope.filter(s => !unitOf[s.school_id])
  const missingLoc = schools.filter(s => locs[s.school_id] && locs[s.school_id].lat == null)
  const noun = atNation ? 'tỉnh/thành' : 'xã/phường'

  // Đặt khung nhìn và nhớ lại để vẽ lại đúng chỗ khi khung bản đồ đổi kích thước
  const fitRef = useRef<{ b: L.LatLngBounds, o: L.FitBoundsOptions } | null>(null)
  const fit = (m: L.Map, b: L.LatLngBounds, unit: boolean) => {
    const o: L.FitBoundsOptions = unit ? { padding: [30, 30], maxZoom: 13 } : { padding: [6, 6] }
    fitRef.current = { b, o }; m.fitBounds(b, o)
  }
  // Bản đồ: tạo một lần (tạo lại khi đổi Danh sách → Bản đồ)
  useEffect(() => {
    if (!box.current || map.current || view !== 'map') return
    const m = L.map(box.current, { zoomSnap: 0.25, scrollWheelZoom: false, attributionControl: true, zoomControl: true })
    m.attributionControl.setPrefix(false).addAttribution('Ranh giới: <a href="https://sapnhap.bando.com.vn" target="_blank" rel="noreferrer">sapnhap.bando.com.vn</a>')
    m.on('focus', () => m.scrollWheelZoom.enable()); m.on('blur', () => m.scrollWheelZoom.disable())
    dotLayer.current = L.layerGroup().addTo(m)
    labelLayer.current = L.layerGroup().addTo(m)
    map.current = m
    // Khung bản đồ giãn theo cột bên phải: đổi kích thước thì vẽ lại và giữ khung nhìn đang xem
    let t = 0
    const ro = new ResizeObserver(() => { clearTimeout(t); t = window.setTimeout(() => {
      m.invalidateSize(); if (fitRef.current) m.fitBounds(fitRef.current.b, fitRef.current.o) }, 60) })
    ro.observe(box.current)
    return () => { ro.disconnect(); clearTimeout(t); m.remove(); map.current = null; unitLayer.current = null }
  }, [view])

  // Vẽ / tô lại đơn vị (tỉnh hoặc xã/phường)
  useEffect(() => {
    const m = map.current
    if (!m || !unitGeo) return
    unitLayer.current?.remove()
    const layer = L.geoJSON(unitGeo as any, {
      style: f => {
        const w = umap.get(f!.properties.code); const lv = w?.level ?? -1
        return { color: '#ffffff', weight: atNation ? 0.8 : 1, fillColor: LV[lv].color, fillOpacity: sel && sel !== f!.properties.code ? 0.35 : 0.92 }
      },
      onEachFeature: (f, lyr) => {
        const w = umap.get(f.properties.code)!
        lyr.bindTooltip(() => `<b>${esc(w.fullName)}</b><br/>`
          + (w.schools.length ? `${w.schools.length} trường · ${LV[w.level].label}<br/>Bao phủ STEM <b>${w.cov}%</b> · GV tập huấn <b>${w.gv}%</b><br/><small>HS học STEM ${w.stu}% · ${w.rooms} phòng STEM</small>`
            : 'Chưa có trường trong hệ thống') + (atNation ? '<br/><small>Bấm để xem xã/phường</small>' : ''), { sticky: true, opacity: 1 })
        lyr.on({
          mouseover: e => (e.target as L.Path).setStyle({ weight: 2.5, color: '#0b2a52' }),
          mouseout: e => layer.resetStyle(e.target),
          click: e => {
            if (placingRef.current) return
            if (atNation) { const p = index.find(x => x.code === f.properties.code); if (p) openProvince(p); else setNote(`Chưa có ranh giới xã/phường của ${f.properties.name}.`); return }
            setSel(f.properties.code); setTab('overview'); fit(m, (e.target as L.Polygon).getBounds(), true)
          },
        })
      },
    }).addTo(m)
    unitLayer.current = layer
    // Nhãn quần đảo ở cấp cả nước
    labelLayer.current?.clearLayers()
    if (atNation) ISLANDS.forEach(i => L.marker(i.at, { interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'islandlabel', html: i.text, iconSize: [120, 34], iconAnchor: [60, -6] }) }).addTo(labelLayer.current!))
    // Luôn đặt khung nhìn (bản đồ vừa tạo lại chưa có khung nhìn thì không vẽ gì)
    let target: L.LatLngBounds | null = null
    if (sel) layer.eachLayer(l => { if ((l as any).feature?.properties.code === sel) target = (l as L.Polygon).getBounds() })
    fit(m, target ?? layer.getBounds(), !!target)
  }, [unitGeo, umap, sel, view, atNation, index])

  // Chấm trường của xã/phường đang chọn
  useEffect(() => {
    const g = dotLayer.current
    if (!g) return
    g.clearLayers()
    if (!sel || atNation) return
    umap.get(sel)?.schools.forEach(s => {
      const l = locs[s.school_id]; if (l?.lat == null) return
      const ok = s.programs.length > 0
      L.circleMarker([l.lat, l.lng!], { radius: 7, color: '#0b2a52', weight: 1.5, fillColor: ok ? '#ffffff' : '#9aa5b1', fillOpacity: 1 })
        .bindTooltip(`<b>${esc(short(s.name))}</b> <small>${esc(LEVEL[s.level ?? ''] ?? '')}</small><br/>KPI ${s.kpi} · ${s.programs.length ? esc(s.programs.join(', ')) : 'chưa triển khai CT'}<br/><small>${nf(s.students)} HS · GV tập huấn ${pct(s.training_done, s.teachers)}%</small>`, { direction: 'top', opacity: 1 })
        .addTo(g)
    })
  }, [sel, umap, locs, view, atNation])

  // Đặt vị trí trường chưa có toạ độ: bấm lên bản đồ
  useEffect(() => {
    const m = map.current
    if (!m || !placing) return
    box.current?.classList.add('placing')
    const onClick = async (e: L.LeafletMouseEvent) => {
      const { error } = await supabase.rpc('set_school_location', { p_org: placing, p_lat: e.latlng.lat, p_lng: e.latlng.lng })
      if (error) setMsg(error.code === '42501' ? 'Bạn không có quyền đặt vị trí trường này.' : error.message)
      else { const s = schools.find(x => x.school_id === placing); setMsg(`Đã đặt vị trí ${s ? short(s.name) : 'trường'}.`); await loadLocs() }
      setPlacing('')
    }
    m.once('click', onClick)
    return () => { m.off('click', onClick); box.current?.classList.remove('placing') }
  }, [placing])

  const withSchools = units.filter(w => w.schools.length)
  const dist = ([3, 2, 1, 0] as Lv[]).map(l => ({ l, n: withSchools.filter(w => w.level === l).length }))
  const cur = sel ? umap.get(sel) ?? null : null
  const scope = cur ? cur.schools : inScope
  const tiles = [
    { label: 'Tổng số trường', value: nf(scope.length), sub: cur ? cur.fullName : `${withSchools.length}/${units.length} ${noun} có trường` },
    { label: 'Bao phủ STEM', value: pct(scope.filter(s => s.programs.length > 0).length, scope.length) + '%', sub: 'trường đã triển khai STEM' },
    { label: 'GV đã tập huấn', value: pct(sum(scope.map(s => s.training_done)), sum(scope.map(s => s.teachers))) + '%', sub: `${nf(sum(scope.map(s => s.training_done)))}/${nf(sum(scope.map(s => s.teachers)))} giáo viên` },
    { label: 'Phòng STEM', value: nf(sum(scope.map(s => s.rooms_active))), sub: `đang hoạt động / ${nf(sum(scope.map(s => s.rooms)))} phòng` },
  ]
  const byLevel = Object.entries(LEVEL).map(([k, v]) => ({ k, v, n: scope.filter(s => s.level === k).length }))
  const rank = [...withSchools].sort((a, b) => b.level - a.level || b.cov - a.cov || b.gv - a.gv)
  const alerts = [
    ...withSchools.filter(w => w.level <= 1).map(w => ({ key: 'u' + w.code, unit: w.code, text: w.fullName, sub: `${LV[w.level].label} · bao phủ ${w.cov}% · GV tập huấn ${w.gv}%`, lv: w.level })),
    ...scope.filter(s => s.programs.length === 0).map(s => ({ key: 's' + s.school_id, unit: unitOf[s.school_id], text: short(s.name), sub: 'Chưa triển khai chương trình STEM nào', lv: 0 as Lv })),
  ]
  const myAlerts = alerts.filter(a => !cur || a.unit === cur.code)
  const pick = (code: string | null) => {
    if (atNation) { const p = code ? index.find(x => x.code === code) : null; if (p) openProvince(p); return }
    setSel(code)
    const m = map.current, lyr = unitLayer.current
    if (!m || !lyr) return
    if (!code) return fit(m, lyr.getBounds(), false)
    lyr.eachLayer(l => { if ((l as any).feature?.properties.code === code) fit(m, (l as L.Polygon).getBounds(), true) })
  }
  // Tên đầy đủ lấy từ dữ liệu ranh giới (Tỉnh/Thành phố), không ghi cứng — từ 20/9/2026 có 9 TP trực thuộc TW
  const title = atNation ? 'Tổng quan cả nước' : prov ? `Tổng quan ${(prov.fullName ?? prov.name).replace(/^Tỉnh /, 'tỉnh ').replace(/^Thành phố /, 'TP ')}` : 'Tổng quan'

  return (
    <div className="covwrap">
      <div className="covbar">
        <span className="covgrp"><small>Màu theo</small>
          <span className="segmented">{(Object.keys(RULE) as Mode[]).map(k => <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)} aria-pressed={mode === k}>{RULE[k].label}</button>)}</span></span>
        <span className="covgrp"><small>Khối</small>
          <span className="segmented">{KHOI.map(([k, v]) => <button key={k} className={khoi === k ? 'on' : ''} onClick={() => setKhoi(k)} aria-pressed={khoi === k}>{v}</button>)}</span></span>
        <span className="segmented covview">
          <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')} aria-pressed={view === 'map'}>Bản đồ</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => { setView('list'); setPlacing('') }} aria-pressed={view === 'list'}>Danh sách</button>
        </span>
      </div>
      {err && <div className="panel"><p className="sub" style={{ margin: 0 }}>{err}</p></div>}
      {!err && <div className="covgrid">
        <div className="panel covmain">
          {nation && <div className="covcrumb">
            {prov ? <><button className="linkbtn" onClick={backToNation}>Cả nước</button><span aria-hidden="true">›</span>
              {sel ? <><button className="linkbtn" onClick={() => pick(null)}>{prov.name}</button><span aria-hidden="true">›</span><b>{cur?.fullName}</b></> : <b>{prov.name}</b>}</>
              : <b>Cả nước · 34 tỉnh/thành</b>}
          </div>}
          <div className="covlegend">
            {([3, 2, 1, 0, -1] as Lv[]).map(l => <span key={l}><i style={{ background: LV[l].color, borderColor: l === -1 ? '#c5ced8' : LV[l].color }} />{LV[l].label}</span>)}
            <small className="covcount">{nf(inScope.length)} trường · {units.length} {noun}{prov && !nation ? ` · ${prov.name}` : ''}</small>
          </div>
          {view === 'map' ? <>
            <div ref={box} className={'covmap' + (atNation ? ' nation' : '')} role="region" tabIndex={0}
              aria-label={`Bản đồ ${units.length} ${noun}${prov ? ' ' + prov.name : ''}, tô màu theo ${RULE[mode].label}. Xem bảng Danh sách để đọc số liệu.`} />
            <p className="sub covhint">{atNation ? 'Bấm vào tỉnh/thành để xem từng xã/phường' : 'Bấm vào xã/phường để phóng to và xem từng trường'} · bấm vào bản đồ rồi cuộn để phóng to/thu nhỏ
              {sel && <> · <button className="linkbtn" onClick={() => pick(null)}>← Xem toàn tỉnh</button></>}</p>
            {note && <p className="sub covhint" role="status">{note}</p>}
          </> : (
            <div className="wrap"><table className="covtable">
              <thead><tr><th>{atNation ? 'Tỉnh/thành' : 'Xã/phường'}</th><th>Trường</th><th>Bao phủ STEM</th><th>GV tập huấn</th><th>HS học STEM</th><th>Phòng STEM</th><th>{RULE[mode].label}</th></tr></thead>
              <tbody>{rank.map(w => (
                <tr key={w.code}><td><b>{w.fullName}</b></td><td>{w.schools.length}</td><td>{w.cov}%</td><td>{w.gv}%</td><td>{w.stu}%</td><td>{w.rooms}</td>
                  <td><span className="lvpill" style={{ background: LV[w.level].color, color: LV[w.level].ink }}>{LV[w.level].label}</span></td></tr>))}</tbody>
            </table><p className="sub covhint">{units.length - withSchools.length} {noun} chưa có trường trong hệ thống không hiện trong bảng.</p></div>
          )}
          {(unplaced.length > 0 || missingLoc.length > 0) && view === 'map' && (
            <div className="mapmissing">
              {unplaced.length > 0 && <small><b>{unplaced.length} trường chưa xác định được {noun}</b> {atNation ? '(chưa có vị trí)' : '(chưa có vị trí và tên xã/phường không khớp danh mục mới)'}</small>}
              {missingLoc.length > 0 && <>
                <small>Đặt vị trí:</small>
                <select value={placing} onChange={e => { setPlacing(e.target.value); setMsg('') }} aria-label="Chọn trường cần đặt vị trí">
                  <option value="">Chọn trường chưa có vị trí…</option>
                  {missingLoc.map(s => <option key={s.school_id} value={s.school_id}>{short(s.name)}{s.ward ? ` · ${s.ward}` : ''}</option>)}
                </select>
                {placing && <><small>rồi bấm vào vị trí trường trên bản đồ</small><button type="button" onClick={() => setPlacing('')}>Huỷ</button></>}
              </>}
              {msg && <small role="status">{msg}</small>}
            </div>
          )}
        </div>

        <aside className="panel covside">
          {cur ? <>
            <button className="linkbtn" onClick={() => pick(null)}>← {title}</button>
            <h3>{cur.fullName}</h3>
            <p className="sub">{cur.schools.length ? <><span className="lvpill" style={{ background: LV[cur.level].color, color: LV[cur.level].ink }}>{LV[cur.level].label}</span> theo {RULE[mode].label}</> : 'Chưa có trường trong hệ thống'}</p>
          </> : <>
            {nation && prov && <button className="linkbtn" onClick={backToNation}>← Tổng quan cả nước</button>}
            <h3>{title}</h3>
            <p className="sub">{nf(inScope.length)} trường · {units.length} {noun}</p>
          </>}
          <div className="segmented covtabs">
            <button className={tab === 'overview' ? 'on' : ''} onClick={() => setTab('overview')}>Tổng quan</button>
            <button className={tab === 'rank' ? 'on' : ''} onClick={() => setTab('rank')}>{cur ? 'Trường' : 'Xếp hạng'}</button>
            <button className={tab === 'alert' ? 'on' : ''} onClick={() => setTab('alert')}>Cảnh báo {myAlerts.length > 0 && <b className="covbadge">{myAlerts.length}</b>}</button>
          </div>
          {tab === 'overview' && <>
            <div className="covtiles">{tiles.map(t => <div key={t.label}><small>{t.label}</small><b>{t.value}</b><small>{t.sub}</small></div>)}</div>
            <h4>Số trường theo cấp học</h4>
            {byLevel.map(r => <div className="covrow" key={r.k}><span>{r.v}</span><span className="covtrack"><i style={{ width: pct(r.n, scope.length) + '%' }} /></span><small>{r.n} · {pct(r.n, scope.length)}%</small></div>)}
            {!cur && <>
              <h4>Phân bổ {noun} theo {mode === 'level' ? 'mức STEM' : RULE[mode].label}</h4>
              {dist.map(d => <div className="covrow" key={d.l}><span>{LV[d.l].label}</span><span className="covtrack"><i style={{ width: pct(d.n, withSchools.length) + '%', background: LV[d.l].color }} /></span><small>{d.n}</small></div>)}
            </>}
            <h4>Cách xếp mức</h4>
            {([3, 2, 1, 0] as Lv[]).map((l, i) => <div className="covrule" key={l}><span><i style={{ background: LV[l].color }} />{LV[l].label}</span><small>{RULE[mode].rules[i]}</small></div>)}
          </>}
          {tab === 'rank' && (cur
            ? <div className="covlist">{[...cur.schools].sort((a, b) => b.kpi - a.kpi).map(s => (
                <div key={s.school_id}><span><b>{short(s.name)}</b><br /><small>{LEVEL[s.level ?? '']} · {s.programs.length ? s.programs.join(', ') : 'chưa triển khai CT'}</small></span><small>KPI <b>{s.kpi}</b></small></div>))}
                {!cur.schools.length && <p className="sub">Chưa có trường.</p>}</div>
            : <div className="covlist">{rank.map((w, i) => (
                <button key={w.code} onClick={() => { setView('map'); pick(w.code) }}><span><small>{i + 1}.</small> <b>{w.fullName}</b><br /><small>{w.schools.length} trường · bao phủ {w.cov}% · GV {w.gv}%</small></span>
                  <span className="lvpill" style={{ background: LV[w.level].color, color: LV[w.level].ink }}>{LV[w.level].label}</span></button>))}
                {!rank.length && <p className="sub">Chưa có {noun} nào có trường.</p>}</div>)}
          {tab === 'alert' && <div className="covlist">
            {myAlerts.map(a => (
              <button key={a.key} onClick={() => { if (a.unit) { setView('map'); pick(a.unit) } }}><span><b>{a.text}</b><br /><small>{a.sub}</small></span>
                <span className="lvpill" style={{ background: LV[a.lv].color, color: LV[a.lv].ink }}>{a.key[0] === 'u' ? LV[a.lv].label : 'Trường'}</span></button>))}
            {!myAlerts.length && <p className="sub">Không có cảnh báo.</p>}
          </div>}
        </aside>
      </div>}
    </div>
  )
}
