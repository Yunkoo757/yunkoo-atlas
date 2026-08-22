import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ANALYTICS_FIXTURE_SEED,
  checksumFixture,
  createAnalyticsSnapshot,
  createAnalyticsTrades,
  inspectAnalyticsFixture,
} from './analytics-trades.mjs'

test('同一 seed 与参数生成完全相同的交易 fixture', () => {
  const first = createAnalyticsTrades({ count: 1_000, seed: ANALYTICS_FIXTURE_SEED })
  const second = createAnalyticsTrades({ count: 1_000, seed: ANALYTICS_FIXTURE_SEED })

  assert.equal(first.length, 1_000)
  assert.deepEqual(second, first)
  assert.equal(checksumFixture(second), checksumFixture(first))
  assert.notEqual(
    checksumFixture(createAnalyticsTrades({ count: 1_000, seed: ANALYTICS_FIXTURE_SEED + 1 })),
    checksumFixture(first),
  )
})

test('fixture 明确覆盖统计可信度边界', () => {
  const coverage = inspectAnalyticsFixture(
    createAnalyticsTrades({ count: 1_000, seed: ANALYTICS_FIXTURE_SEED }),
  )

  for (const required of [
    'live',
    'paper',
    'case',
    'missed',
    'deleted',
    'nullResult',
    'breakeven',
    'resultConflict',
    'belowMinus3R',
    'above10R',
  ]) {
    assert.ok(coverage[required] > 0, `缺少 ${required} 样本`)
  }
})

test('2kb 笔记保持约定体积且图片只保存附件引用', () => {
  const trades = createAnalyticsTrades({
    count: 100,
    seed: ANALYTICS_FIXTURE_SEED,
    noteProfile: '2kb',
  })
  const sizes = trades.map((trade) => Buffer.byteLength(trade.note, 'utf8'))

  assert.ok(sizes.every((size) => size >= 2_000 && size <= 2_120))
  assert.ok(trades.some((trade) => trade.note.includes('journal-asset://fixture-asset-')))
  assert.ok(trades.every((trade) => !trade.note.includes('data:image/')))
})

test('10k 快照可作为隔离存储的完整输入', () => {
  const snapshot = createAnalyticsSnapshot({
    count: 10_000,
    seed: ANALYTICS_FIXTURE_SEED,
    noteProfile: 'short',
  })

  assert.equal(snapshot.trades.length, 10_000)
  assert.equal(snapshot.strategies.length, 4)
  assert.ok(Array.isArray(snapshot.starredIds))
  assert.ok(Array.isArray(snapshot.subscribedIds))
  assert.ok(Array.isArray(snapshot.pinnedStrategyIds))
  assert.ok(Array.isArray(snapshot.weeklyRiskPreparations))
  assert.ok(Array.isArray(snapshot.riskPolicyVersions))
  assert.ok(Array.isArray(snapshot.monthlyRiskLimits))
  assert.ok(Array.isArray(snapshot.riskOverrideEvents))
  assert.equal(snapshot.liveStages.length, 1, '基准快照必须携带原生阶段图')
  assert.equal(snapshot.liveStages[0].id, snapshot.currentLiveStageId, '基准快照的当前阶段指针必须有效')
  assert.equal(snapshot.scheduledStageRollover, null, '基准快照默认不得存在待执行切换')
  assert.ok(snapshot.trades.every((trade) => (
    trade.tradeKind === 'paper'
      ? !Object.prototype.hasOwnProperty.call(trade, 'liveStageId')
      : trade.liveStageId === snapshot.currentLiveStageId
  )), '基准快照必须为所有非纸面交易提供已知阶段归属')
  assert.equal(typeof snapshot.display, 'object')
  assert.equal(typeof snapshot.profile.displayName, 'string')
  assert.ok(snapshot.trades.every((trade) => (
    trade.tradeKind !== 'live' ||
    !['win', 'loss', 'breakeven'].includes(trade.status) ||
    trade.closedTradingDayKey === trade.closedAt.slice(0, 10)
  )), '可持久化的实盘终态 fixture 必须冻结平仓交易日')
})

test('基准 fixture 校验和被冻结，避免无意改写性能样本', () => {
  assert.equal(
    checksumFixture(createAnalyticsTrades({ count: 1_000, seed: ANALYTICS_FIXTURE_SEED })),
    'd28423578ac9cb4a507f17e3b2c12d0a0eab7f0e08be3c14d902557335e1bcf4',
  )
  assert.equal(
    checksumFixture(createAnalyticsTrades({ count: 10_000, seed: ANALYTICS_FIXTURE_SEED })),
    'b39ae9d28b816636ea5c6b1250fadd31416e8a36f21b47f108395a302b84d109',
  )
})
