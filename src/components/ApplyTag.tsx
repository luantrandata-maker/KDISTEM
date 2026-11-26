// Nhãn áp dụng dùng chung cho các bảng so sánh và bảng chủ đề của trường: ✓ Áp dụng (xanh) / ✕ Không áp dụng (đỏ).
export function ApplyTag({ on, label }: { on: boolean; label?: string }) {
  return <span className={'applytag ' + (on ? 'on' : 'off')}>{on ? '✓' : '✕'} {label ?? (on ? 'Áp dụng' : 'Không áp dụng')}</span>
}
