// Hàng chip lọc trạng thái kèm số (thay cho thẻ số trùng nội dung). Chip có số 0 tự ẩn, trừ chip đầu (Tất cả) và chip đang chọn.
export type ChipItem<K extends string> = [key: K, label: string, count: number, tone?: 'warn']

export function FilterChips<K extends string>({ items, value, onPick }: { items: ChipItem<K>[]; value: K; onPick: (k: K) => void }) {
  return <div className="distfilter">
    {items.filter(([k, , c], i) => i === 0 || c > 0 || k === value).map(([k, l, c, tone]) =>
      <button key={k || l} type="button" className={'distfchip' + (value === k ? ' on' : '') + (tone && c > 0 ? ' ' + tone : '')} aria-pressed={value === k} onClick={() => onPick(k)}>{l} <b>{c}</b></button>)}
  </div>
}
