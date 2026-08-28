import { CASE_TYPE_META, REVIEW_CATEGORY_META, STATUS_META, type Trade } from '@/data/trades'
import { formatTradeCashPnl } from '@/lib/cashCurrency'
import { fmtR } from '@/lib/format'
import { getTradeSessionMeta } from '@/lib/tradeView'
import {
  isTradeResultAuthorityConsistent,
  resolveTradeResultSource,
  resolveTradeTruth,
} from '@/lib/tradeTruth'
import type { LegacyCashCurrencyAssumption } from '@/storage/types'

export type TradeRowContextKind = 'mistake' | 'review' | 'session' | 'tag'

export type TradeRowContextItem = {
  key: string
  kind: TradeRowContextKind
  label: string
  detail?: string
}

export type TradeRowValueState =
  | 'not-applicable'
  | 'not-collected'
  | 'missed'
  | 'missing'
  | 'zero'
  | 'masked'
  | 'value'
  | 'conflict'

export type TradeRowResultSource =
  | 'pnl'
  | 'r'
  | 'price'
  | 'imported'
  | 'inferred-pnl'
  | 'inferred-r'
  | 'inferred-imported'
  | 'none'
  | 'invalid'

export type TradeRowResultPresentation = {
  cash: { text: string; state: TradeRowValueState }
  r: { text: string; state: TradeRowValueState }
  source: TradeRowResultSource
  integrity: 'complete' | 'incomplete' | 'conflict'
  accessibleSummary: string
}

function unique(items: TradeRowContextItem[]): TradeRowContextItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const identity = `${item.kind}:${item.label}`
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

export function buildTradeRowContext(trade: Trade): TradeRowContextItem[] {
  const session = getTradeSessionMeta(trade)
  const reviewLabel =
    trade.status === 'missed'
      ? null
      : trade.tradeKind === 'case' && trade.caseType
        ? CASE_TYPE_META[trade.caseType].label
        : trade.reviewCategory !== 'normal'
          ? REVIEW_CATEGORY_META[trade.reviewCategory].label
          : null
  const sessionTagLabels = new Set(session ? [session.raw, session.label] : [])

  return unique([
    ...trade.mistakeTags.map((label, index) => ({
      key: `mistake-${index}-${label}`,
      kind: 'mistake' as const,
      label,
    })),
    ...(reviewLabel ? [{
      key: `review-${trade.caseType ?? trade.reviewCategory}`,
      kind: 'review' as const,
      label: reviewLabel,
    }] : []),
    ...(session ? [{
      key: `session-${session.raw}`,
      kind: 'session' as const,
      label: session.label,
      ...(session.raw !== session.label ? { detail: session.raw } : {}),
    }] : []),
    ...trade.tags
      .filter((label) => !sessionTagLabels.has(label))
      .map((label, index) => ({
        key: `tag-${index}-${label}`,
        kind: 'tag' as const,
        label,
      })),
  ])
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function metricState(value: number, masked = false): TradeRowValueState {
  if (masked) return 'masked'
  return value === 0 ? 'zero' : 'value'
}

function sourceFor(trade: Trade): TradeRowResultSource {
  const rawSource = trade.resultSource
  const resolved = resolveTradeResultSource(trade)
  if (rawSource !== undefined && resolved === undefined) return 'invalid'
  if (rawSource !== undefined) return rawSource
  if (resolved === 'pnl') return 'inferred-pnl'
  if (resolved === 'r') return 'inferred-r'
  if (resolved === 'imported') return 'inferred-imported'
  return 'none'
}

export function resolveTradeRowResultPresentation(
  trade: Trade,
  legacyCashCurrencyAssumption: LegacyCashCurrencyAssumption | null,
  privacyMode: boolean,
): TradeRowResultPresentation {
  const truth = resolveTradeTruth(trade)
  const source = sourceFor(trade)
  const cashValue = finite(trade.pnl) ? trade.pnl : null
  const rValue = finite(trade.rMultiple) ? trade.rMultiple : null
  const hasCash = cashValue !== null
  const hasR = rValue !== null
  const conflict = truth.hasConflict || !isTradeResultAuthorityConsistent(trade) || source === 'invalid'

  if (truth.executionState === 'planned' || truth.executionState === 'open') {
    return {
      cash: { text: '—', state: 'not-applicable' },
      r: { text: '—', state: 'not-applicable' },
      source,
      integrity: 'incomplete',
      accessibleSummary: '尚未产生交易结果',
    }
  }

  if (truth.executionState === 'missed') {
    return {
      cash: { text: '未成交', state: 'missed' },
      r: rValue !== null
        ? { text: fmtR(rValue), state: metricState(rValue) }
        : { text: '—', state: 'not-applicable' },
      source,
      integrity: 'incomplete',
      accessibleSummary: rValue !== null
        ? `错过机会，未成交，潜在 ${fmtR(rValue)}`
        : '错过机会，未成交',
    }
  }

  if (conflict) {
    const cashText = hasCash
      ? formatTradeCashPnl(trade, legacyCashCurrencyAssumption, privacyMode)
      : ''
    const rText = hasR ? fmtR(trade.rMultiple) : '待补'
    return {
      cash: { text: cashText, state: hasCash ? (privacyMode ? 'masked' : 'conflict') : 'missing' },
      r: { text: rText, state: hasR ? 'conflict' : 'missing' },
      source,
      integrity: 'conflict',
      accessibleSummary: `结果冲突，现金${privacyMode && hasCash ? '已隐藏' : cashText || '缺失'}，R ${rText || '缺失'}`,
    }
  }

  const resolvedSource = resolveTradeResultSource(trade)
  const expectsCash = resolvedSource === 'pnl' || resolvedSource === 'imported'
  const expectsR = resolvedSource === 'r' || resolvedSource === 'price' || resolvedSource === 'imported'

  if (!resolvedSource) {
    return {
      cash: { text: '待补', state: 'missing' },
      r: { text: '待补', state: 'missing' },
      source,
      integrity: 'incomplete',
      accessibleSummary: '已结束，结果数据待补充',
    }
  }

  const cashText = expectsCash && hasCash
    ? formatTradeCashPnl(trade, legacyCashCurrencyAssumption, privacyMode)
    : '—'
  const rText = expectsR && hasR ? fmtR(trade.rMultiple) : '—'
  const cash = expectsCash
    ? cashValue !== null
      ? { text: cashText, state: metricState(cashValue, privacyMode) }
      : { text: '待补', state: 'missing' as const }
      : { text: '—', state: 'not-collected' as const }
  const r = expectsR
    ? rValue !== null
      ? { text: rText, state: metricState(rValue) }
      : { text: '待补', state: 'missing' as const }
    : { text: '—', state: 'not-collected' as const }
  const complete = cash.state !== 'missing' && r.state !== 'missing'
  const cashSummary = cash.state === 'masked'
    ? '现金结果已隐藏'
    : cash.text
      ? `现金 ${cash.text}`
      : '未采集现金结果'
  const rSummary = r.text ? `R ${r.text}` : '未采集 R 倍数'

  return {
    cash,
    r,
    source,
    integrity: complete ? 'complete' : 'incomplete',
    accessibleSummary: `${cashSummary}，${rSummary}`,
  }
}

export function buildTradeRowAccessibleLabel(
  trade: Trade,
  strategyLabel: string,
  context: TradeRowContextItem[],
  result: TradeRowResultPresentation,
  timeframe: string,
  date: string,
  starred: boolean,
): string {
  const contextText = context.length > 0 ? context.map((item) => item.label).join('、') : '无其他标签'
  return [
    STATUS_META[trade.status].label,
    trade.ref,
    `${trade.symbol}${trade.side === 'long' ? '做多' : '做空'}`,
    `策略 ${strategyLabel}`,
    contextText,
    `周期 ${timeframe}`,
    result.accessibleSummary,
    date,
    starred ? '已星标' : '未星标',
  ].join('，')
}
