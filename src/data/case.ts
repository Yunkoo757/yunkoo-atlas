// ===== 判例类型 =====

export interface DisputeType {
  id: string
  name: string
  options: string[]
  positiveOption: string
  builtin: boolean
}

export interface CaseImage {
  fileId: string
  label?: string
  order: number
}

export interface CaseComment {
  id: string
  body: string
  createdAt: string
}

export type CaseLifecycle = '待验证' | '已裁决' | '已废弃'
export type CaseOutcome = '正例' | '反例' | '误判' | '模糊' | '待验证'
export type CaseNextActionTone = 'pending' | 'warn' | 'done'

export interface CaseRecord {
  id: string
  /** 纠纷类型 ID，引用 DisputeType.id */
  disputeTypeId: string
  /** 初始裁决 */
  initialVerdict: string
  /** 信心度 */
  confidence: 30 | 50 | 70 | 90
  /** 截图 */
  images: CaseImage[]
  /** 最终裁决（复盘补充） */
  finalVerdict?: string
  /** 笔记 */
  note?: string
  /** 标签 */
  tags?: string[]
  /** 典型案例 */
  star?: boolean
  /** 需要复看 */
  recheck?: boolean
  /** 关联交易 ID */
  linkedTradeIds?: string[]
  /** 评论 */
  comments?: CaseComment[]
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
  /** 删除时间（ISO 字符串），undefined 表示未删除 */
  deletedAt?: string
  /** 删除操作来源（可选，用于审计） */
  deletedBy?: string
}

/** 9 个内置纠纷类型 */
export const BUILTIN_DISPUTE_TYPES: DisputeType[] = [
  { id: 'dt_ibos_4h', name: '4H iBOS 是否成立', options: ['是', '不是'], positiveOption: '是', builtin: true },
  { id: 'dt_ibos_1h', name: '1H iBOS 是否成立', options: ['是', '不是'], positiveOption: '是', builtin: true },
  { id: 'dt_ibos_15m', name: '15m iBOS 是否成立', options: ['是', '不是'], positiveOption: '是', builtin: true },
  { id: 'dt_rev_liq', name: '结构反转 vs 流动性猎取', options: ['结构反转', '流动性猎取'], positiveOption: '结构反转', builtin: true },
  { id: 'dt_cx_sx', name: '复杂回调 vs 简单回调', options: ['复杂回调', '简单回调'], positiveOption: '复杂回调', builtin: true },
  { id: 'dt_bos', name: 'BOS 是否有效', options: ['有效', '无效'], positiveOption: '有效', builtin: true },
  { id: 'dt_idm', name: 'IDM 是否标准', options: ['标准', '不标准'], positiveOption: '标准', builtin: true },
  { id: 'dt_bos_below', name: '是否破 BOS 下方流动性', options: ['破', '未破'], positiveOption: '破', builtin: true },
  { id: 'dt_other', name: '其他纠纷', options: ['是', '否'], positiveOption: '是', builtin: true },
]

export function getDisputeType(id: string, types: DisputeType[]): DisputeType | undefined {
  return types.find((d) => d.id === id)
}

/** 生命周期推导 */
export function deriveLifecycle(rec: CaseRecord): CaseLifecycle {
  if (rec.finalVerdict === '废弃') return '已废弃'
  if (rec.finalVerdict) return '已裁决'
  return '待验证'
}

/** 裁决结果推导 */
export function deriveOutcome(rec: CaseRecord, dt?: DisputeType): CaseOutcome {
  if (!rec.finalVerdict) return '待验证'
  if (rec.finalVerdict === '仍无法裁决') return '模糊'
  if (rec.finalVerdict === '废弃') return '待验证'

  const positive = dt?.positiveOption ?? '是'

  const initPositive = rec.initialVerdict === positive || rec.initialVerdict === '暂不确定'
  const finalPositive = rec.finalVerdict === positive

  if (initPositive && finalPositive) return '正例'
  if (!initPositive && finalPositive) return '正例'
  if (initPositive && !finalPositive) return '误判'
  return '反例'
}

/** 简化 ID 用于列表展示（UUID 前 3 位大写） */
export function formatCaseId(id: string): string {
  const base = id.replace(/-/g, '')
  return `CAS-${base.slice(0, 3).toUpperCase()}`
}

export function getCaseNextAction(rec: CaseRecord): {
  label: string
  tone: CaseNextActionTone
} {
  if (!rec.linkedTradeIds?.length) return { label: '补来源交易', tone: 'warn' }
  if (rec.images.length === 0) return { label: '补截图证据', tone: 'warn' }
  if (!rec.note?.trim()) return { label: '写判断依据', tone: 'pending' }
  if (!rec.finalVerdict) return { label: '设置最终裁决', tone: 'pending' }
  if (rec.recheck) return { label: '安排复看', tone: 'pending' }
  if (rec.finalVerdict === '废弃') return { label: '已废弃归档', tone: 'done' }
  return { label: '可沉淀复用', tone: 'done' }
}

/** 判断案例是否已删除（软删除） */
export function isDeleted(rec: CaseRecord): boolean {
  return rec.deletedAt !== undefined
}

/** 判断案例是否已过期（超过 30 天） */
export function isExpired(rec: CaseRecord): boolean {
  if (!rec.deletedAt) return false
  const deletedTime = new Date(rec.deletedAt).getTime()
  const now = Date.now()
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  return (now - deletedTime) > thirtyDaysMs
}

/** 计算剩余天数（用于回收站显示） */
export function getRemainingDays(rec: CaseRecord): number {
  if (!rec.deletedAt) return -1
  const deletedTime = new Date(rec.deletedAt).getTime()
  const now = Date.now()
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  const remainingMs = thirtyDaysMs - (now - deletedTime)
  return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)))
}

/** 裁决结果色系映射 */
export const OUTCOME_COLORS: Record<CaseOutcome, { dot: string; bg: string; label: string }> = {
  '正例': { dot: 'var(--pos)', bg: 'var(--pos-bg)', label: '正例' },
  '反例': { dot: 'var(--neg)', bg: 'var(--neg-bg)', label: '反例' },
  '误判': { dot: 'var(--warn)', bg: 'var(--warn-bg)', label: '误判' },
  '模糊': { dot: 'var(--text-tertiary)', bg: 'var(--faint-bg)', label: '模糊' },
  '待验证': { dot: 'var(--pending)', bg: 'var(--pending-bg)', label: '待验证' },
}
