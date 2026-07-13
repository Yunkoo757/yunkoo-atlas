export function fmtMoney(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return (
    sign +
    n.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    })
  )
}

export function fmtR(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return (n > 0 ? '+' : '') + n.toFixed(1) + 'R'
}

export function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function fmtDate(iso: string): string {
  if (!iso) return '--'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '--'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function fmtDateTime(iso: string): string {
  if (!iso) return '--'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '--'
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
