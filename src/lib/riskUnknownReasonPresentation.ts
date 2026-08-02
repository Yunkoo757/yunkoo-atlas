import type { RiskPartialReason, RiskUnknownReason } from '@/data/riskManagement'

export const RISK_UNKNOWN_REASON_COPY: Readonly<Record<RiskUnknownReason, string>> = {
  'missing-loss-pnl': '亏损交易缺少金额',
  'result-conflict': '交易结果存在冲突',
  'missing-policy': '历史亏损缺少适用规则',
  'missing-close-date': '亏损交易缺少平仓日期',
  'invalid-close-date': '平仓日期无效',
  'future-loss-close-date': '亏损平仓日期晚于当前交易日',
  'invalid-live-cycle-start': '风险核算起点晚于当前交易日',
}

export const RISK_PARTIAL_REASON_COPY: Readonly<Record<RiskPartialReason, string>> = {
  'partial-missing-pnl': '缺少可用于风险核算的盈亏金额',
  'partial-missing-close-date': '缺少平仓日期',
  'partial-invalid-close-date': '平仓日期无效',
  'partial-future-close-date': '平仓日期晚于当前交易日',
  'partial-missing-policy': '该平仓日没有生效的风险规则',
}
