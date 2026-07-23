import { createHash } from 'node:crypto'
import { DEFAULT_DISPLAY } from '../../src/lib/tradeFilters'
import type { PersistedSnapshot } from '../../src/storage/types'
import { runElectronPersistenceBenchmark } from './persistenceBenchmark'

function checksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function testElectronPersistenceBenchmarkComparesCanonicalDurableSnapshot(): Promise<void> {
  const snapshot: PersistedSnapshot = {
    trades: [],
    strategies: [],
    starredIds: [],
    subscribedIds: [],
    pinnedStrategyIds: [],
    display: DEFAULT_DISPLAY,
  }

  const result = await runElectronPersistenceBenchmark({
    label: '10k',
    snapshot,
    assets: [],
    expectedHash: checksum(snapshot),
    warmups: 0,
    samples: 1,
  })

  if (result.checksum !== checksum(snapshot)) {
    throw new Error('基准报告必须保留原始 fixture checksum 作为来源证明')
  }
}
