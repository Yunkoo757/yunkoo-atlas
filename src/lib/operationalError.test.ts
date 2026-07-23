import { OPERATIONAL_ERROR_CODES, OperationalError } from '@/lib/operationalError'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testOperationalErrorCatalogMatchesSpecV2(): void {
  assert(OPERATIONAL_ERROR_CODES.length === 14, 'Spec v2 必须保留 14 个稳定错误类别')
  assert(new Set(OPERATIONAL_ERROR_CODES).size === 14, '稳定错误类别不得重复')
  const error = new OperationalError('library-location-invalid', '可本地化消息')
  assert(error.code === 'library-location-invalid', '调用方必须依赖稳定 code，而不是消息文本')
}

export function testRecoveryErrorCodesHaveProductionCallSites(): void {
  const sources = [
    fs.readFileSync('src/storage/indexedDbAdapter.ts', 'utf8'),
    fs.readFileSync('electron/library/storage.ts', 'utf8'),
    fs.readFileSync('src/lib/tradeUndo.ts', 'utf8'),
    fs.readFileSync('src/lib/tradeKind.ts', 'utf8'),
    fs.readFileSync('electron/quitCoordinator.ts', 'utf8'),
  ].join('\n')
  for (const code of [
    'asset-reference-missing',
    'asset-gc-stale-revision',
    'undo-conflict',
    'trade-kind-transition-forbidden',
    'quit-commit-failed',
  ]) {
    assert(sources.includes(`'${code}'`), `${code} 必须接入生产失败结果，不能只存在于目录声明`)
  }
}
import fs from 'node:fs'
