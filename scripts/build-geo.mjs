// Dựng ranh giới xã/phường (sau sáp nhập 2025) cho bản đồ độ phủ STEM của Sở.
// Nguồn: thanglequoc/vietnamese-provinces-database (MIT), json/geojson/<mã>_<tên>/wards/*.geojson —
// xây dựng từ Bản đồ tra cứu đơn vị hành chính Việt Nam (sapnhap.bando.com.vn, NXB Tài nguyên – Môi trường và Bản đồ VN).
//
// Dùng:  node scripts/build-geo.mjs <thư mục json/geojson của bộ dữ liệu> <mã tỉnh>...
//   vd   node scripts/build-geo.mjs ../vietnamese-provinces-database/json/geojson 33 24
// Kết quả: public/geo/<mã tỉnh>.json (GeoJSON đã rút gọn, mỗi xã/phường: code, name, fullName)
//          public/geo/index.json (danh sách tỉnh đã có: code, name, bbox) — cập nhật, không xoá tỉnh cũ.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import mapshaper from 'mapshaper'

const [src, ...codes] = process.argv.slice(2)
if (!src || !codes.length) { console.error('Dùng: node scripts/build-geo.mjs <json/geojson> <mã tỉnh>...'); process.exit(1) }
const out = 'public/geo'
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
  // Rút gọn giữ hình dạng (Visvalingam, giữ 6% điểm, không để vùng nhỏ biến mất), toạ độ 5 chữ số thập phân (~1 m)
  const res = await mapshaper.applyCommands(
    '-i in.json -simplify 6% weighted keep-shapes -clean -o out.json precision=0.00001 format=geojson',
    { 'in.json': JSON.stringify({ type: 'FeatureCollection', features }) })
  const gj = JSON.parse(res['out.json'])
  writeFileSync(join(out, code + '.json'), JSON.stringify(gj))
  let [x0, y0, x1, y1] = [180, 90, -180, -90]
  const walk = c => typeof c[0] === 'number' ? ([x0, y0, x1, y1] = [Math.min(x0, c[0]), Math.min(y0, c[1]), Math.max(x1, c[0]), Math.max(y1, c[1])]) : c.forEach(walk)
  gj.features.forEach(f => walk(f.geometry.coordinates))
  const entry = { code, name: pp.name ?? pp.fullName ?? dir, wards: gj.features.length, bbox: [x0, y0, x1, y1].map(v => +v.toFixed(4)) }
  const i = index.findIndex(e => e.code === code); if (i >= 0) index[i] = entry; else index.push(entry)
  console.log(`${code} ${entry.name}: ${entry.wards} xã/phường, ${(JSON.stringify(gj).length / 1024).toFixed(0)} KB`)
}
index.sort((a, b) => a.code.localeCompare(b.code))
writeFileSync(idxPath, JSON.stringify(index, null, 1))
