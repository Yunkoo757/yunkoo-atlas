export function fmtMoney(n: number): string {
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

export function fmtR(n: number): string {
  return (n > 0 ? '+' : '') + n.toFixed(1) + 'R'
}

export function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function fmtDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
