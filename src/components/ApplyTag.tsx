// Nhãn áp dụng dùng chung (label="": chỉ dấu ✓ — bảng so sánh: có là ✓, không có là —) cho các bảng so sánh và bảng chủ đề của trường: ✓ Áp dụng (xanh) / ✕ Không áp dụng (đỏ).
export function ApplyTag({ on, label }: { on: boolean; label?: string }) {
  const text = label ?? (on ? 'Áp dụng' : 'Không áp dụng')
  return <span className={'applytag ' + (on ? 'on' : 'off') + (text ? '' : ' only')} title={text || 'Có'}>{on ? '✓' : '✕'}{text && ' ' + text}</span>
}
