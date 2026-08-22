function precisionFactor(digits: number): number {
  if (!Number.isInteger(digits) || digits < 0) throw new Error('精度必须是非负整数')
  const factor = 10 ** digits
  if (!Number.isFinite(factor) || !Number.isSafeInteger(factor)) {
    throw new Error('精度超出安全范围')
  }
  return factor
}

export function scaledIntegerFromDecimalNumber(value: number, digits: number): bigint {
  if (!Number.isFinite(value)) throw new Error('数值必须是有限数')
  precisionFactor(digits)
  const sign = value < 0 ? -1n : 1n
  const [coefficient, exponentText = '0'] = Math.abs(value).toString().toLowerCase().split('e')
  const [whole, fraction = ''] = coefficient!.split('.')
  const source = BigInt(`${whole}${fraction}`)
  const sourceScale = fraction.length - Number(exponentText)
  if (sourceScale <= digits) return sign * source * (10n ** BigInt(digits - sourceScale))
  const divisor = 10n ** BigInt(sourceScale - digits)
  const quotient = source / divisor
  const remainder = source % divisor
  const rounded = quotient + (remainder * 2n >= divisor ? 1n : 0n)
  return sign * rounded
}

export function toMoneyCents(value: number): number {
  const cents = scaledIntegerFromDecimalNumber(value, 2)
  const result = Number(cents)
  if (!Number.isSafeInteger(result)) throw new Error('金额超出安全范围')
  return result
}

export function quantizeDecimal(value: number, digits: number): number {
  const factor = precisionFactor(digits)
  const scaled = Number(scaledIntegerFromDecimalNumber(value, digits))
  if (!Number.isSafeInteger(scaled)) throw new Error('R 数值超出安全范围')
  return scaled / factor
}
