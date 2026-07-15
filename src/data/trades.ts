// 交易日志数据模型 —— 借用 Linear "issue" 的结构思路，但语义换成交易复盘。

export type TradeStatus =
  | 'planned' // 计划中（像 Backlog）
  | 'open' // 持仓中（像 In Progress）
  | 'missed' // 错过机会（假设盈亏，不计入实盘 KPI）
  | 'win' // 已平 - 盈利（像 Done）
  | 'loss' // 已平 - 亏损（像 Canceled）
  | 'breakeven' // 已平 - 保本

export type TradeKind = 'live' | 'paper' | 'case'

export type MissReason =
  | 'hesitation'
  | 'missed_setup'
  | 'no_alert'
  | 'rule_break'
  | 'other'

export type TradeSide = 'long' | 'short'

/** 平仓结果依据。`imported` 为兼容旧数据保留，也表示金额与 R 已共同确认。 */
export type TradeResultSource = 'pnl' | 'r' | 'price' | 'imported'

export type Conviction = 'low' | 'medium' | 'high' | 'urgent' // 信心度，沿用优先级视觉

export type ReviewStatus = 'unreviewed' | 'reviewed' | 'focus'

export type ReviewCategory = 'normal' | 'mistake' | 'focus' | 'ambiguous' | 'recheck' | 'mastered'

export type CaseType = 'exemplar' | 'mistake' | 'ambiguous' | 'missed'

export type MasteryState = 'new' | 'recheck' | 'mastered'

export interface TradeComment {
  id: string
  text: string
  createdAt: string
}

export type ActivityKind =
  | 'create'
  | 'status'
  | 'strategy'
  | 'tag'
  | 'comment'
  | 'note'
  | 'tradeKind'

export interface ActivityEvent {
  id: string
  kind: ActivityKind
  timestamp: string
  status?: TradeStatus
  strategyId?: string
  fromStrategyId?: string
  tag?: string
  tagAction?: 'add' | 'remove'
  commentId?: string
  text?: string
  fromTradeKind?: TradeKind
  toTradeKind?: TradeKind
}

export interface Trade {
  id: string
  ref: string // 形如 TRD-128
  symbol: string // 标的，如 BTC/AAPL
  side: TradeSide
  status: TradeStatus
  conviction: Conviction
  strategyId: string // 策略 ID，关联 Strategy 实体
  session?: string // 交易时段，如 London Open / Asia / New York
  /** 参与波段级别，如 15M / 1H / 4H */
  timeframe?: string
  /** 市场叙事，如 Bullish / Bearish（Notion Narrative） */
  narrative?: string
  /** 心理状态，如 Neutral / FOMO（Notion Psychology） */
  psychology?: string
  tags: string[]
  mistakeTags: string[]
  reviewStatus: ReviewStatus
  /** 最近一次完成复盘的时间；用于今日闭环，不以开/平仓日期代替。 */
  reviewedAt?: string | null
  reviewCategory: ReviewCategory
  tradeKind: TradeKind
  /** 案例来源交易；仅案例记录使用，保证知识条目可追溯。 */
  sourceTradeId?: string
  caseType?: CaseType
  masteryState?: MasteryState
  nextReviewAt?: string | null
  entry: number | null
  exit: number | null
  stopLoss?: number | null
  initialStopLoss?: number | null // 首次按价格平仓时冻结，避免后续移动止损改写历史 R
  size: number | null // 仓位
  pnl: number | null // 盈亏金额；null 表示尚未填写，0 表示真实保本
  rMultiple: number | null // R 倍数；null 表示尚未填写，0 表示真实保本
  resultSource?: TradeResultSource // 用户确认的结果依据；旧数据在载入时推断
  openedAt: string // ISO date
  recordedAt?: string // 记录收录时间；案例排序不受来源交易日期影响
  closedAt: string | null
  missReason?: MissReason
  note: string // 富文本（TipTap JSON 序列化后的 HTML，简化为 HTML 字符串）
  comments?: TradeComment[]
  activities?: ActivityEvent[]
  deletedAt?: string // 删除时间（ISO 格式），undefined 表示未删除
  deletedBy?: string // 删除操作来源（可选，用于审计）
}

export const STATUS_META: Record<
  TradeStatus,
  { label: string; order: number }
> = {
  planned: { label: '计划中', order: 0 },
  open: { label: '持仓中', order: 1 },
  missed: { label: '错过', order: 2 },
  win: { label: '盈利', order: 3 },
  breakeven: { label: '保本', order: 4 },
  loss: { label: '亏损', order: 5 },
}

export const TRADE_KIND_META: Record<TradeKind, { label: string }> = {
  live: { label: '实盘' },
  paper: { label: '模拟' },
  case: { label: '案例' },
}

export const REVIEW_CATEGORY_META: Record<ReviewCategory, { label: string }> = {
  normal: { label: '普通' },
  mistake: { label: '错题' },
  focus: { label: '重点' },
  ambiguous: { label: '模糊' },
  recheck: { label: '待复看' },
  mastered: { label: '已掌握' },
}

export const CASE_TYPE_META: Record<CaseType, { label: string }> = {
  exemplar: { label: '优秀范例' },
  mistake: { label: '错误案例' },
  ambiguous: { label: '模糊决策' },
  missed: { label: '错过机会' },
}

export const MASTERY_STATE_META: Record<MasteryState, { label: string }> = {
  new: { label: '新案例' },
  recheck: { label: '待复看' },
  mastered: { label: '已掌握' },
}

export const MISS_REASON_META: Record<MissReason, { label: string }> = {
  hesitation: { label: '犹豫未进' },
  missed_setup: { label: '错过形态' },
  no_alert: { label: '未设提醒' },
  rule_break: { label: '违反规则' },
  other: { label: '其他' },
}

export const CONVICTION_META: Record<Conviction, { label: string }> = {
  urgent: { label: '极高' },
  high: { label: '高' },
  medium: { label: '中' },
  low: { label: '低' },
}

/** 新建/编辑时可选的波段级别预设 */
export const TIMEFRAME_PRESETS = [
  '1M',
  '5M',
  '15M',
  '30M',
  '1H',
  '2H',
  '4H',
  '1D',
  '1W',
] as const

export type TimeframePreset = (typeof TIMEFRAME_PRESETS)[number]

/** 显式选择 4H 时使用的预设值；缺失值不再自动回填 */
export const DEFAULT_TIMEFRAME: TimeframePreset = '4H'

/** 规范化波段级别：对齐 TIMEFRAME_PRESETS，兼容 Notion/中英文别名 */
export function normalizeTimeframe(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  let raw = value.trim().toUpperCase().replace(/\s+/g, '')
  if (!raw) return undefined

  raw = raw
    .replace(/小时/g, 'H')
    .replace(/分钟/g, 'M')
    .replace(/日线/g, 'D')
    .replace(/天|日/g, 'D')
    .replace(/周线?/g, 'W')
    .replace(/MINUTES?/g, 'M')
    .replace(/MINS?/g, 'M')
    .replace(/HOURS?/g, 'H')
    .replace(/HRS?/g, 'H')
    .replace(/DAILY/g, '1D')
    .replace(/DAYS?/g, 'D')
    .replace(/WEEKLY/g, '1W')
    .replace(/WEEKS?/g, 'W')

  const hPrefix = /^H(\d+)$/.exec(raw)
  if (hPrefix) raw = `${hPrefix[1]}H`
  const mPrefix = /^M(\d+)$/.exec(raw)
  if (mPrefix) raw = `${mPrefix[1]}M`
  const dPrefix = /^D(\d+)$/.exec(raw)
  if (dPrefix) raw = dPrefix[1] === '1' ? '1D' : `${dPrefix[1]}D`
  const wPrefix = /^W(\d+)$/.exec(raw)
  if (wPrefix) raw = wPrefix[1] === '1' ? '1W' : `${wPrefix[1]}W`

  const compact = /^(\d+)(M|H|D|W)$/.exec(raw)
  if (compact) {
    const amount = compact[1]!
    const unit = compact[2]! as 'M' | 'H' | 'D' | 'W'
    if (unit === 'D' && amount === '1') return '1D'
    if (unit === 'W' && amount === '1') return '1W'
    return `${amount}${unit}`
  }

  if ((TIMEFRAME_PRESETS as readonly string[]).includes(raw)) return raw
  return raw
}

/** 解析波段级别；空值保持未设置，避免制造并不存在的交易事实 */
export function resolveTimeframe(value: string | null | undefined): string {
  return normalizeTimeframe(value) ?? ''
}

export type TimeframeTone = 'minute' | 'hour' | 'day' | 'other'

/** 波段级别色调：分钟 / 小时 / 日线，便于胶囊分色 */
export function getTimeframeTone(value: string | null | undefined): TimeframeTone {
  const key = normalizeTimeframe(value)
  if (!key) return 'other'
  if (/^\d+M$/.test(key)) return 'minute'
  if (/^\d+H$/.test(key)) return 'hour'
  if (/^\d+[DW]$/.test(key)) return 'day'
  return 'other'
}

/** 判断交易是否已删除（软删除） */
export function isTradeDeleted(trade: Trade): boolean {
  return trade.deletedAt !== undefined
}

/** 判断交易是否已过期（剩余天数 ≤ 0，与回收站 UI 同一边界） */
export function isTradeExpired(trade: Trade): boolean {
  if (!trade.deletedAt) return false
  return getTradeRemainingDays(trade) <= 0
}

/** 计算剩余天数（用于回收站显示） */
export function getTradeRemainingDays(trade: Trade): number {
  if (!trade.deletedAt) return -1
  const deletedTime = new Date(trade.deletedAt).getTime()
  if (!Number.isFinite(deletedTime)) return -1
  const now = Date.now()
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  const remainingMs = thirtyDaysMs - (now - deletedTime)
  return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)))
}

// —— 种子数据 ——
export const SEED_TRADES: Trade[] = []
