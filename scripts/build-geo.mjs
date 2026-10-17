// Dựng ranh giới xã/phường (sau sáp nhập 2025) cho bản đồ độ phủ STEM của Sở.
// Nguồn: thanglequoc/vietnamese-provinces-database (MIT), json/geojson/<mã>_<tên>/wards/*.geojson —
// xây dựng từ Bản đồ tra cứu đơn vị hành chính Việt Nam (sapnhap.bando.com.vn, NXB Tài nguyên – Môi trường và Bản đồ VN).
//
// Dùng:  node scripts/build-geo.mjs <thư mục json/geojson của bộ dữ liệu> <mã tỉnh>... | all
//   vd   node scripts/build-geo.mjs ../vietnamese-provinces-database/json/geojson 33 24
//        node scripts/build-geo.mjs ../vietnamese-provinces-database/json/geojson all
// Kết quả: public/geo/<mã tỉnh>.json (xã/phường đã rút gọn: code, name, fullName)
//          public/geo/index.json (danh sách tỉnh đã có ranh giới xã/phường: code, name, bbox) — cập nhật, không xoá tỉnh cũ
//          public/geo/provinces.json (ranh giới các tỉnh/thành trong thư mục nguồn, cho bản đồ cả nước; giữ cả
//          đảo nhỏ — Đặc khu Hoàng Sa thuộc Đà Nẵng, Đặc khu Trường Sa thuộc Khánh Hòa)
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import mapshaper from 'mapshaper'

const [src, ...args] = process.argv.slice(2)
const all = () => readdirSync(src).filter(d => /^\d+_/.test(d)).map(d => d.split('_')[0])
const codes = args.includes('all') ? all() : args
if (!src || !codes.length) { console.error('Dùng: node scripts/build-geo.mjs <json/geojson> <mã tỉnh>...'); process.exit(1) }
const out = 'public/geo'
// Rút gọn đất liền/đảo lớn (giữ đường biên chung giữa các đơn vị), giữ NGUYÊN đảo nhỏ < 20 km² rồi ghép lại theo mã:
// rút gọn thường làm mất đảo nhỏ (Hoàng Sa, Trường Sa, Cô Tô, Bạch Long Vĩ…) dù có keep-shapes.
async function simplifyKeepIslands(fc, pct) {
  // Tách mảnh; rút gọn phần lớn (topology chung giữa các đơn vị); phần nhỏ giữ nguyên; ghép lại theo mã bằng JS
  // (không dùng -dissolve: dựng lại topology giữa mảnh đã và chưa rút gọn đôi khi làm mất cả đơn vị).
  const res = await mapshaper.applyCommands(
    `-i in.json name=all -explode -each "small = this.area < 2e7" `
    + `-filter "!small" + name=big -filter "small" target=all + name=isl `
    + `-simplify ${pct} weighted keep-shapes target=big `
    + `-o big.json target=big precision=0.00001 format=geojson -o isl.json target=isl precision=0.00001 format=geojson`,
    { 'in.json': JSON.stringify(fc) })
  const byCode = new Map(fc.features.map(f => [f.properties.code, { type: 'Feature', properties: { ...f.properties }, geometry: { type: 'MultiPolygon', coordinates: [] } }]))
  for (const k of ['big.json', 'isl.json']) for (const f of (JSON.parse(res[k]).features ?? [])) {   // lớp rỗng → GeometryCollection không có features
    if (!f.geometry) continue
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    byCode.get(f.properties.code).geometry.coordinates.push(...polys)
  }
  return { type: 'FeatureCollection', features: [...byCode.values()].map(f => f.geometry.coordinates.length === 1
    ? { ...f, geometry: { type: 'Polygon', coordinates: f.geometry.coordinates[0] } } : f) }
}
// Khung bao từng đơn vị: mất một vùng lớn thì khung co > 0,02° (~2 km). Đảo nhỏ < 20 km² không qua bước rút gọn
// nên luôn còn; mảnh vụn diện tích 0 trong dữ liệu gốc và mũi nhọn hẹp bị cắt khi rút gọn thì không tính.
const bboxes = fc => Object.fromEntries(fc.features.filter(f => f.geometry).map(f => {
  let b = [180, 90, -180, -90]
  const w = c => typeof c[0] === 'number' ? (b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])]) : c.forEach(w)
  w(f.geometry.coordinates); return [f.properties.code, b]
}))
const shrunk = (a, b) => Object.keys(a).filter(k => !b[k] || b[k][0] > a[k][0] + 0.02 || b[k][1] > a[k][1] + 0.02 || b[k][2] < a[k][2] - 0.02 || b[k][3] < a[k][3] - 0.02)
mkdirSync(out, { recursive: true })
const idxPath = join(out, 'index.json')
const index = existsSync(idxPath) ? JSON.parse(readFileSync(idxPath, 'utf8')) : []

for (const code of codes) {
  const dir = readdirSync(src).find(d => d.startsWith(code + '_'))
  if (!dir) { console.error(`Không thấy tỉnh ${code} trong ${src}`); process.exit(1) }
  const prov = JSON.parse(readFileSync(join(src, dir, dir + '.geojson'), 'utf8'))
  const pp = (prov.features?.[0] ?? prov).properties
  const features = readdirSync(join(src, dir, 'wards')).filter(f => f.endsWith('.geojson')).map(f => {
    const d = JSON.parse(readFileSync(join(src, dir, 'wards', f), 'utf8'))
    const ft = d.features?.[0] ?? d
    const p = ft.properties
    return { type: 'Feature', properties: { code: p.code, name: p.name, fullName: p.fullName }, geometry: ft.geometry }
  })
  const raw = { type: 'FeatureCollection', features }
  const gj = await simplifyKeepIslands(raw, '6%')
  // Kiểm tra: không xã/phường nào mất vùng (đảo) — khung bao không co
  const empty = gj.features.filter(f => !f.geometry).map(f => f.properties.code)
  if (empty.length) console.error(`${code}: mất hình học: ${empty.join(', ')}`)
  const lost = shrunk(bboxes(raw), bboxes(gj))
  if (gj.features.length !== features.length || lost.length) { console.error(`${code}: mất đơn vị/vùng: ${lost.join(', ')}`); process.exit(1) }
  writeFileSync(join(out, code + '.json'), JSON.stringify(gj))
  let [x0, y0, x1, y1] = [180, 90, -180, -90]
  const walk = c => typeof c[0] === 'number' ? ([x0, y0, x1, y1] = [Math.min(x0, c[0]), Math.min(y0, c[1]), Math.max(x1, c[0]), Math.max(y1, c[1])]) : c.forEach(walk)
  gj.features.forEach(f => walk(f.geometry.coordinates))
  const entry = { code, name: pp.name ?? pp.fullName ?? dir, fullName: pp.fullName ?? pp.name ?? dir, wards: gj.features.length, bbox: [x0, y0, x1, y1].map(v => +v.toFixed(4)) }
  const i = index.findIndex(e => e.code === code); if (i >= 0) index[i] = entry; else index.push(entry)
  console.log(`${code} ${entry.name}: ${entry.wards} xã/phường, ${(JSON.stringify(gj).length / 1024).toFixed(0)} KB`)
}
index.sort((a, b) => a.code.localeCompare(b.code))
writeFileSync(idxPath, JSON.stringify(index, null, 1))

// Ranh giới tỉnh/thành cho bản đồ cả nước (rút gọn mạnh hơn, giữ mọi đảo)
const provs = readdirSync(src).filter(d => /^\d+_/.test(d)).map(dir => {
  const d = JSON.parse(readFileSync(join(src, dir, dir + '.geojson'), 'utf8'))
  const ft = d.features?.[0] ?? d
  const p = ft.properties
  return { type: 'Feature', properties: { code: dir.split('_')[0], name: p.name, fullName: p.fullName ?? p.name }, geometry: ft.geometry }
})
const praw = { type: 'FeatureCollection', features: provs }
const pg = await simplifyKeepIslands(praw, '15%')
const plost = shrunk(bboxes(praw), bboxes(pg))
if (pg.features.length !== provs.length || plost.length) { console.error(`provinces: mất vùng ở ${plost.join(', ')}`); process.exit(1) }
const pr = { 'out.json': JSON.stringify(pg) }
writeFileSync(join(out, 'provinces.json'), pr['out.json'])
console.log(`provinces.json: ${provs.length} tỉnh/thành, ${(pr['out.json'].length / 1024).toFixed(0)} KB`)
