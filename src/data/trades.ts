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

export type Conviction = 'low' | 'medium' | 'high' | 'urgent' // 信心度，沿用优先级视觉

export type ReviewStatus = 'unreviewed' | 'reviewed' | 'focus'

export type ReviewCategory = 'normal' | 'mistake' | 'focus' | 'ambiguous' | 'recheck' | 'mastered'

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
  tags: string[]
  mistakeTags: string[]
  reviewStatus: ReviewStatus
  reviewCategory: ReviewCategory
  tradeKind: TradeKind
  entry: number
  exit: number | null
  stopLoss?: number | null
  size: number // 仓位
  pnl: number // 盈亏金额
  rMultiple: number // R 倍数
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

/** 判断交易是否已删除（软删除） */
export function isTradeDeleted(trade: Trade): boolean {
  return trade.deletedAt !== undefined
}

/** 判断交易是否已过期（超过 30 天） */
export function isTradeExpired(trade: Trade): boolean {
  if (!trade.deletedAt) return false
  const deletedTime = new Date(trade.deletedAt).getTime()
  const now = Date.now()
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  return (now - deletedTime) > thirtyDaysMs
}

/** 计算剩余天数（用于回收站显示） */
export function getTradeRemainingDays(trade: Trade): number {
  if (!trade.deletedAt) return -1
  const deletedTime = new Date(trade.deletedAt).getTime()
  const now = Date.now()
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  const remainingMs = thirtyDaysMs - (now - deletedTime)
  return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)))
}

// —— 种子数据 ——
export const SEED_TRADES: Trade[] = []
