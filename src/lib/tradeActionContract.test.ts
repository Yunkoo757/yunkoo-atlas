import type { Trade } from '@/data/trades'
import {
  buildRecordActionDescriptors,
  getBatchCopyActionLabel,
} from '@/lib/tradeActionContract'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const liveTrade = {
  id: 'live-action-contract',
  ref: 'TRD-1',
  tradeKind: 'live',
} as Trade

const caseTrade = {
  id: 'case-action-contract',
  ref: 'CAS-1',
  tradeKind: 'case',
} as Trade

export function testLiveRecordActionsUseTheCanonicalOrderAndLabels(): void {
  const actions = buildRecordActionDescriptors(liveTrade, { starred: false })

  assert(
    actions.map((action) => action.id).join(',') === 'edit,copy,extract-case,star,delete',
    '实盘记录的业务动作必须遵循编辑、复制、提炼、星标、删除的固定顺序',
  )
  assert(
    actions.map((action) => action.label).join(',') ===
      '编辑交易,复制为新计划,提炼为案例,加入星标,删除交易',
    '实盘记录必须使用统一且具体的动作名称',
  )
}

export function testCaseRecordActionsUseTheCanonicalSubsetAndLabels(): void {
  const actions = buildRecordActionDescriptors(caseTrade, { starred: true })

  assert(
    actions.map((action) => action.id).join(',') === 'edit,copy,star,delete',
    '案例记录不得出现“提炼为案例”',
  )
  assert(
    actions.map((action) => action.label).join(',') ===
      '编辑案例记录,复制案例,取消星标,删除案例记录',
    '案例记录必须使用统一且具体的动作名称',
  )
}

export function testBatchCopyUsesCanonicalLabelsForHomogeneousAndMixedSelections(): void {
  assert(getBatchCopyActionLabel([liveTrade]) === '复制为新计划', '交易批量复制名称必须与单条动作一致')
  assert(getBatchCopyActionLabel([caseTrade]) === '复制案例', '案例批量复制名称必须与单条动作一致')
  assert(
    getBatchCopyActionLabel([liveTrade, caseTrade]) === '复制所选记录',
    '混合批量复制必须描述选择对象，而不是暴露实现术语',
  )
}

