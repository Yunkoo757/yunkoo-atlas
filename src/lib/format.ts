import { normalizeCashCurrency } from '@/data/trades'

export function fmtMoney(
  n: number | null | undefined,
  currency: string | null,
  masked = false,
): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  if (masked) return '****'
  const displayValue = Math.abs(n) < 0.005 ? 0 : n
  const sign = displayValue > 0 ? '+' : ''
  const hasFraction = !Number.isInteger(n)
  const options: Intl.NumberFormatOptions = {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }
  const normalizedCurrency = normalizeCashCurrency(currency)
  if (normalizedCurrency === null) {
    // 未知/非法币种只展示数值，不附加「币种未知」噪音标签；USD 总计排除仍由资格解析负责。
    return `${sign}${displayValue.toLocaleString('en-US', options)}`
  }
  return sign + displayValue.toLocaleString('en-US', {
    ...options,
    style: 'currency',
    currency: normalizedCurrency,
  })
}

export function fmtR(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return (n > 0 ? '+' : '') + n.toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }) + 'R'
}

export function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 })
}

export function fmtDate(iso: string): string {
  if (!iso) return '—'
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (dateOnly) {
    const [, year, month, day] = dateOnly
    const candidate = new Date(Number(year), Number(month) - 1, Number(day))
    if (
      candidate.getFullYear() !== Number(year) ||
      candidate.getMonth() !== Number(month) - 1 ||
      candidate.getDate() !== Number(day)
    ) return '—'
    return `${Number(month)}月${Number(day)}日`
  }
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function fmtDateTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
