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
  assert.equal(typeof snapshot.display, 'object')
  assert.equal(typeof snapshot.profile.displayName, 'string')
})

test('基准 fixture 校验和被冻结，避免无意改写性能样本', () => {
  assert.equal(
    checksumFixture(createAnalyticsTrades({ count: 1_000, seed: ANALYTICS_FIXTURE_SEED })),
    'f1b088de56fdcfa7bd52be20abbfc7c81d6460b0fb365b60e0b0eb9a7a42aa7f',
  )
  assert.equal(
    checksumFixture(createAnalyticsTrades({ count: 10_000, seed: ANALYTICS_FIXTURE_SEED })),
    '6a5298725967e53921e3076a27f8f2891428f5c1f1cde6850a0c77df834812b7',
  )
})
