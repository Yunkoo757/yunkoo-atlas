import { isCalendarDay } from '@/lib/calendarDay'

const ISO_INSTANT_PATTERN =
  /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/

export function isCanonicalIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = ISO_INSTANT_PATTERN.exec(value)
  if (!match || !Number.isFinite(new Date(value).getTime())) return false
  return isCalendarDay(match[1])
}
