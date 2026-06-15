// 交易日志数据模型 —— 借用 Linear "issue" 的结构思路，但语义换成交易复盘。

export type TradeStatus =
  | 'planned' // 计划中（像 Backlog）
  | 'open' // 持仓中（像 In Progress）
  | 'win' // 已平 - 盈利（像 Done）
  | 'loss' // 已平 - 亏损（像 Canceled）
  | 'breakeven' // 已平 - 保本

export type TradeSide = 'long' | 'short'

export type Conviction = 'low' | 'medium' | 'high' | 'urgent' // 信心度，沿用优先级视觉

export interface Trade {
  id: string
  ref: string // 形如 TRD-128
  symbol: string // 标的，如 BTC/AAPL
  side: TradeSide
  status: TradeStatus
  conviction: Conviction
  strategy: string // 策略归类（像 Project）
  tags: string[]
  entry: number
  exit: number | null
  size: number // 仓位
  pnl: number // 盈亏金额
  rMultiple: number // R 倍数
  openedAt: string // ISO date
  closedAt: string | null
  note: string // 富文本（TipTap JSON 序列化后的 HTML，简化为 HTML 字符串）
}

export const STRATEGIES = [
  'Breakout',
  'Mean Reversion',
  'Trend Following',
  'News Catalyst',
  'Scalp',
] as const

export const STATUS_META: Record<
  TradeStatus,
  { label: string; order: number }
> = {
  planned: { label: '计划中', order: 0 },
  open: { label: '持仓中', order: 1 },
  win: { label: '盈利', order: 2 },
  breakeven: { label: '保本', order: 3 },
  loss: { label: '亏损', order: 4 },
}

export const CONVICTION_META: Record<Conviction, { label: string }> = {
  urgent: { label: '极高' },
  high: { label: '高' },
  medium: { label: '中' },
  low: { label: '低' },
}

// —— 种子数据 ——
export const SEED_TRADES: Trade[] = [
  {
    id: '1',
    ref: 'TRD-142',
    symbol: 'BTC/USDT',
    side: 'long',
    status: 'win',
    conviction: 'high',
    strategy: 'Breakout',
    tags: ['日内', '突破'],
    entry: 61200,
    exit: 64850,
    size: 0.5,
    pnl: 1825,
    rMultiple: 2.4,
    openedAt: '2026-06-10',
    closedAt: '2026-06-11',
    note: '<p>日线级别三角形末端突破，放量确认后顺势进场。</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true">等待 4H 收线确认</li><li data-type="taskItem" data-checked="true">止损放在前低下方</li></ul><blockquote>复盘：进场点偏晚，可在突破当根更早介入。</blockquote>',
  },
  {
    id: '2',
    ref: 'TRD-141',
    symbol: 'AAPL',
    side: 'short',
    status: 'loss',
    conviction: 'medium',
    strategy: 'Mean Reversion',
    tags: ['财报', '逆势'],
    entry: 214.5,
    exit: 219.2,
    size: 100,
    pnl: -470,
    rMultiple: -1.0,
    openedAt: '2026-06-08',
    closedAt: '2026-06-09',
    note: '<p>财报前博弈回调，但市场情绪过强，止损出局。</p><blockquote>教训：财报前不逆势。</blockquote>',
  },
  {
    id: '3',
    ref: 'TRD-140',
    symbol: 'ETH/USDT',
    side: 'long',
    status: 'open',
    conviction: 'high',
    strategy: 'Trend Following',
    tags: ['波段'],
    entry: 3380,
    exit: null,
    size: 4,
    pnl: 520,
    rMultiple: 1.3,
    openedAt: '2026-06-13',
    closedAt: null,
    note: '<p>跟随上升趋势，回踩 EMA20 进场，持仓中。</p>',
  },
  {
    id: '4',
    ref: 'TRD-139',
    symbol: 'NVDA',
    side: 'long',
    status: 'planned',
    conviction: 'urgent',
    strategy: 'News Catalyst',
    tags: ['催化', '关注'],
    entry: 0,
    exit: null,
    size: 50,
    pnl: 0,
    rMultiple: 0,
    openedAt: '2026-06-15',
    closedAt: null,
    note: '<p>等待发布会催化，计划在 130 上方突破时进场。</p>',
  },
  {
    id: '5',
    ref: 'TRD-138',
    symbol: 'SOL/USDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategy: 'Scalp',
    tags: ['日内', '剥头皮'],
    entry: 148.2,
    exit: 151.0,
    size: 20,
    pnl: 56,
    rMultiple: 0.8,
    openedAt: '2026-06-12',
    closedAt: '2026-06-12',
    note: '<p>5 分钟级别快进快出。</p>',
  },
  {
    id: '6',
    ref: 'TRD-137',
    symbol: 'TSLA',
    side: 'short',
    status: 'breakeven',
    conviction: 'low',
    strategy: 'Mean Reversion',
    tags: ['试探'],
    entry: 248,
    exit: 248.3,
    size: 30,
    pnl: -9,
    rMultiple: 0.0,
    openedAt: '2026-06-07',
    closedAt: '2026-06-07',
    note: '<p>试探性逆势，无明显机会，保本离场。</p>',
  },
  {
    id: '7',
    ref: 'TRD-136',
    symbol: 'BTC/USDT',
    side: 'short',
    status: 'win',
    conviction: 'high',
    strategy: 'Trend Following',
    tags: ['波段', '顶背离'],
    entry: 66800,
    exit: 63200,
    size: 0.3,
    pnl: 1080,
    rMultiple: 3.1,
    openedAt: '2026-06-02',
    closedAt: '2026-06-05',
    note: '<p>顶背离 + 跌破颈线，顺势做空。教科书级别的一笔。</p>',
  },
  {
    id: '8',
    ref: 'TRD-135',
    symbol: 'MSFT',
    side: 'long',
    status: 'loss',
    conviction: 'medium',
    strategy: 'Breakout',
    tags: ['假突破'],
    entry: 452,
    exit: 446.5,
    size: 40,
    pnl: -220,
    rMultiple: -1.0,
    openedAt: '2026-06-03',
    closedAt: '2026-06-04',
    note: '<p>假突破被套，纪律止损。</p>',
  },
]
