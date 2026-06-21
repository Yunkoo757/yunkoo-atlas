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

/** 裁决结果色系映射 */
export const OUTCOME_COLORS: Record<CaseOutcome, { dot: string; bg: string; label: string }> = {
  '正例': { dot: 'var(--pos)', bg: 'rgba(34,197,94,0.12)', label: '正例' },
  '反例': { dot: 'var(--neg)', bg: 'rgba(239,68,68,0.12)', label: '反例' },
  '误判': { dot: 'var(--warn)', bg: 'rgba(234,179,8,0.12)', label: '误判' },
  '模糊': { dot: 'var(--text-tertiary)', bg: 'rgba(255,255,255,0.04)', label: '模糊' },
  '待验证': { dot: 'var(--pending)', bg: 'rgba(96,165,250,0.12)', label: '待验证' },
}
