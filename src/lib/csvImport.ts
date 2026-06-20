import type { Trade, TradeStatus, TradeSide, Conviction, TradeKind } from '@/data/trades'
import type { Strategy } from '@/data/strategies'

export interface CsvParseResult {
  headers: string[]
  rows: string[][]
  delimiter: string
  totalRows: number
  /** 被跳过的空行数 */
  skippedEmpty: number
}

export interface FieldMapping {
  /** CSV 列索引 → Trade 字段名 */
  [csvColIndex: number]: TradeField
}

export interface ImportPreview {
  trade: Partial<Trade>
  errors: string[]
  rowIndex: number
}

export type TradeField =
  | 'symbol' | 'side' | 'status' | 'conviction' | 'strategyId'
  | 'tags' | 'tradeKind' | 'entry' | 'exit' | 'size' | 'pnl'
  | 'rMultiple' | 'openedAt' | 'closedAt' | 'note' | 'stopLoss' | 'missReason'

const TRADE_FIELDS: { key: TradeField; label: string; required: boolean; type: string }[] = [
  { key: 'symbol', label: '标的', required: true, type: 'string' },
  { key: 'side', label: '方向', required: true, type: 'side' },
  { key: 'status', label: '状态', required: true, type: 'status' },
  { key: 'conviction', label: '信心度', required: false, type: 'conviction' },
  { key: 'strategyId', label: '策略', required: true, type: 'strategy' },
  { key: 'tags', label: '标签', required: false, type: 'tags' },
  { key: 'tradeKind', label: '类型', required: false, type: 'tradeKind' },
  { key: 'entry', label: '入场价', required: true, type: 'number' },
  { key: 'exit', label: '出场价', required: false, type: 'number' },
  { key: 'size', label: '仓位', required: true, type: 'number' },
  { key: 'pnl', label: '盈亏金额', required: false, type: 'number' },
  { key: 'rMultiple', label: 'R倍数', required: false, type: 'number' },
  { key: 'openedAt', label: '开仓日期', required: true, type: 'date' },
  { key: 'closedAt', label: '平仓日期', required: false, type: 'date' },
  { key: 'note', label: '备注', required: false, type: 'string' },
  { key: 'stopLoss', label: '止损价', required: false, type: 'number' },
  { key: 'missReason', label: '错过原因', required: false, type: 'missReason' },
]

export const TRADE_FIELD_LIST = TRADE_FIELDS

/** 检测分隔符：优先检测 tab、分号、逗号，取第一行出现最多的 */
function detectDelimiter(text: string): string {
  const firstLine = text.split('\n')[0] ?? ''
  const candidates = ['\t', ';', ',']
  let best = ','
  let bestCount = 0
  for (const c of candidates) {
    const count = (firstLine.match(new RegExp(c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
    if (count > bestCount) {
      bestCount = count
      best = c
    }
  }
  return best
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === delimiter) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
  }
  result.push(current.trim())
  return result
}

/** 解析 CSV 文本，自动检测分隔符 */
export function parseCsv(text: string): CsvParseResult {
  const delimiter = detectDelimiter(text)
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) return { headers: [], rows: [], delimiter, totalRows: 0, skippedEmpty: 0 }

  let skippedEmpty = 0
  const nonEmpty: string[] = []
  for (const l of lines) {
    if (l.trim() === '') { skippedEmpty++; continue }
    nonEmpty.push(l)
  }

  const headers = parseCsvLine(nonEmpty[0] ?? '', delimiter)
  const rows = nonEmpty.slice(1).map((l) => parseCsvLine(l, delimiter))
  return { headers, rows, delimiter, totalRows: rows.length, skippedEmpty }
}

/** 自动推测 CSV 列到 Trade 字段的映射 */
export function autoMapFields(headers: string[]): FieldMapping {
  const mapping: FieldMapping = {}
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim())

  const patterns: [RegExp, TradeField][] = [
    [/^(标的|symbol|ticker|pair|instrument|code|name|coin|stock)$/i, 'symbol'],
    [/^(方向|side|direction|type|position)$/i, 'side'],
    [/^(状态|status|result|outcome|state)$/i, 'status'],
    [/^(信心|conviction|confidence|priority|评级)$/i, 'conviction'],
    [/^(策略|strategy|setup|system|plan|method)$/i, 'strategyId'],
    [/^(标签|tags?|labels?|categories)$/i, 'tags'],
    [/^(类型|kind|mode|account|实盘\/模拟)$/i, 'tradeKind'],
    [/^(入场|entry|入场价|进场|开仓价|buy)/i, 'entry'],
    [/^(出场|exit|出场价|离场|平仓价|sell)/i, 'exit'],
    [/^(仓位|size|quantity|qty|volume|lots|amount|手数)/i, 'size'],
    [/^(盈亏|pnl|p\/l|profit|pl|gain|net|盈亏金额)/i, 'pnl'],
    [/^(r倍数|r multiple|r-multiple|r\/r|rr|风险倍数)/i, 'rMultiple'],
    [/^(开仓|日期|date|time|open date|开仓日|opened|created)/i, 'openedAt'],
    [/^(平仓|closed|close date|平仓日|end date|结束)/i, 'closedAt'],
    [/^(备注|note|notes?|comment|remark|memo|说明)/i, 'note'],
    [/^(止损|stop|stoploss|sl|止损价)/i, 'stopLoss'],
    [/^(错过|miss|missreason|miss_reason|错过原因)/i, 'missReason'],
  ]

  for (let i = 0; i < headers.length; i++) {
    const h = lowerHeaders[i] ?? ''
    for (const [re, field] of patterns) {
      if (re.test(h) && !Object.values(mapping).includes(field)) {
        mapping[i] = field
        break
      }
    }
  }

  return mapping
}

function parseSide(val: string): TradeSide | null {
  const v = val.toLowerCase().trim()
  if (['long', 'l', '多', '买', '买入', '做多', '多头'].includes(v)) return 'long'
  if (['short', 's', '空', '卖', '卖出', '做空', '空头'].includes(v)) return 'short'
  return null
}

function parseStatus(val: string): TradeStatus | null {
  const v = val.toLowerCase().trim()
  if (['win', 'w', '盈', '盈利', '胜', 'winner', 'profit'].includes(v)) return 'win'
  if (['loss', 'l', '亏', '亏损', '败', 'loser'].includes(v)) return 'loss'
  if (['breakeven', 'be', '保本', '平', 'flat'].includes(v)) return 'breakeven'
  if (['open', 'o', '持仓', '持有', 'active'].includes(v)) return 'open'
  if (['planned', 'p', '计划', 'plan', 'pending'].includes(v)) return 'planned'
  if (['missed', 'm', '错过', '错过机会', 'miss'].includes(v)) return 'missed'
  return null
}

function parseConviction(val: string): Conviction | null {
  const v = val.toLowerCase().trim()
  if (['low', 'l', '低', '弱'].includes(v)) return 'low'
  if (['medium', 'm', 'med', '中', '中等'].includes(v)) return 'medium'
  if (['high', 'h', '高', '强'].includes(v)) return 'high'
  if (['urgent', 'u', '紧急', '极高'].includes(v)) return 'urgent'
  return null
}

function parseTradeKind(val: string): TradeKind | null {
  const v = val.toLowerCase().trim()
  if (['live', '实盘', '真实', 'real'].includes(v)) return 'live'
  if (['paper', '模拟', '练习', 'demo', 'practice'].includes(v)) return 'paper'
  return null
}

function parseMissReason(val: string): string | null {
  const v = val.toLowerCase().trim()
  if (['hesitation', '犹豫', '迟疑'].includes(v)) return 'hesitation'
  if (['missed_setup', '错过入场', '没看到信号'].includes(v)) return 'missed_setup'
  if (['no_alert', '无提醒', '没设警报'].includes(v)) return 'no_alert'
  if (['rule_break', '违反规则', '破规'].includes(v)) return 'rule_break'
  if (['other', '其他', '其它'].includes(v)) return 'other'
  return null
}

function parseDate(val: string): string | null {
  const v = val.trim()
  if (!v) return null
  // 尝试多种日期格式
  const formats = [
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,     // 2026-6-10
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,     // 2026/6/10
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,     // 6/10/2026
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/,       // 6-10-2026
    /^(\d{4})年(\d{1,2})月(\d{1,2})日$/,   // 2026年6月10日
  ]
  for (const fmt of formats) {
    const m = v.match(fmt)
    if (m) {
      const y = parseInt(m[1] ?? '', 10)
      const mo = parseInt(m[2] ?? '', 10)
      const d = parseInt(m[3] ?? '', 10)
      if (y > 1990 && y < 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      }
    }
  }
  // 尝试原生 Date 解析（ISO 8601 等）
  const d = new Date(v)
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10)
  }
  return null
}

function parseTags(val: string): string[] {
  return val
    .split(/[,;，；、]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function parseNumber(val: string): number | null {
  const v = val.trim()
  if (!v) return null
  // 去除货币符号/逗号/空格
  const cleaned = v.replace(/[$¥€£￥,\s%]/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

/** 将 CSV 行按映射转换为 Trade 数据，返回预览结果 */
export function mapRowToTrade(
  row: string[],
  mapping: FieldMapping,
  rowIndex: number,
  strategies: Strategy[],
): ImportPreview {
  const trade: Partial<Trade> = {}
  const errors: string[] = []

  for (const [colIdx, field] of Object.entries(mapping)) {
    const ci = parseInt(colIdx, 10)
    const raw = row[ci] ?? ''
    const info = TRADE_FIELDS.find((f) => f.key === field)

    switch (field) {
      case 'symbol':
        trade.symbol = raw.trim()
        if (!trade.symbol && info?.required) errors.push(`标的为空`)
        break
      case 'side': {
        const s = parseSide(raw)
        if (s) trade.side = s
        else errors.push(`方向无效: "${raw}"（应为 long/short/多/空）`)
        break
      }
      case 'status': {
        const s = parseStatus(raw)
        if (s) trade.status = s
        else errors.push(`状态无效: "${raw}"（应为 win/loss/open 等）`)
        break
      }
      case 'conviction':
        trade.conviction = parseConviction(raw) ?? 'medium'
        break
      case 'strategyId': {
        const name = raw.trim()
        const found = strategies.find(
          (s) => s.name.toLowerCase() === name.toLowerCase(),
        )
        if (found) {
          trade.strategyId = found.id
        } else {
          errors.push(`策略不存在: "${name}"`)
        }
        break
      }
      case 'tags':
        trade.tags = parseTags(raw)
        break
      case 'tradeKind':
        trade.tradeKind = parseTradeKind(raw) ?? 'live'
        break
      case 'entry': {
        const n = parseNumber(raw)
        if (n !== null) trade.entry = n
        else errors.push(`入场价无效: "${raw}"`)
        break
      }
      case 'exit': {
        const n = parseNumber(raw)
        if (n !== null) trade.exit = n
        break
      }
      case 'size': {
        const n = parseNumber(raw)
        if (n !== null) trade.size = n
        else errors.push(`仓位无效: "${raw}"`)
        break
      }
      case 'pnl': {
        const n = parseNumber(raw)
        if (n !== null) trade.pnl = n
        break
      }
      case 'rMultiple': {
        const n = parseNumber(raw)
        if (n !== null) trade.rMultiple = n
        break
      }
      case 'stopLoss': {
        const n = parseNumber(raw)
        if (n !== null) trade.stopLoss = n
        break
      }
      case 'openedAt': {
        const d = parseDate(raw)
        if (d) trade.openedAt = d
        else errors.push(`开仓日期无效: "${raw}"`)
        break
      }
      case 'closedAt': {
        if (raw.trim()) {
          const d = parseDate(raw)
          if (d) trade.closedAt = d
          else errors.push(`平仓日期无效: "${raw}"`)
        }
        break
      }
      case 'note':
        trade.note = raw.trim() ? `<p>${raw.trim()}</p>` : ''
        break
      case 'missReason': {
        const r = parseMissReason(raw)
        if (r) trade.missReason = r as Trade['missReason']
        else if (raw.trim()) errors.push(`错过原因无效: "${raw}"`)
        break
      }
    }
  }

  // 全自动计算 pnl 和 rMultiple（如果未提供但有 entry/exit/size）
  if (trade.entry && trade.exit && trade.size) {
    if (trade.pnl === undefined) {
      trade.pnl = (trade.exit - trade.entry) * trade.size
      if (trade.side === 'short') trade.pnl = -trade.pnl
    }
    if (trade.rMultiple === undefined && trade.pnl !== undefined && trade.entry && trade.size) {
      const risk = Math.abs(trade.entry - trade.size) // approximate
      trade.rMultiple = risk > 0 ? trade.pnl / risk : 0
    }
  }

  return { trade, errors, rowIndex }
}

/** 检查必填字段并补充默认值，返回完整的 Trade 对象 */
export function finalizeTrade(
  partial: Partial<Trade>,
  strategies: Strategy[],
  nextRef: string,
  nextId: string,
): Trade | null {
  if (!partial.symbol || !partial.side || !partial.status || !partial.entry || !partial.size || !partial.openedAt || !partial.strategyId) {
    return null
  }

  const now = new Date().toISOString().slice(0, 10)

  return {
    id: nextId,
    ref: nextRef,
    symbol: partial.symbol,
    side: partial.side,
    status: partial.status,
    conviction: partial.conviction ?? 'medium',
    strategyId: partial.strategyId,
    tags: partial.tags ?? [],
    tradeKind: partial.tradeKind ?? 'live',
    entry: partial.entry,
    exit: partial.exit ?? null,
    stopLoss: partial.stopLoss ?? null,
    size: partial.size,
    pnl: partial.pnl ?? 0,
    rMultiple: partial.rMultiple ?? 0,
    openedAt: partial.openedAt,
    closedAt: partial.closedAt ?? null,
    missReason: partial.missReason,
    note: partial.note ?? '',
  }
}
