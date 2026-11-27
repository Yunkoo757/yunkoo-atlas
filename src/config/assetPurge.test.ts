import { isAssetPurgeCommitEnabled } from './assetPurge'

export function testAssetPurgeBuildFlagPreservesReleasedValues(): void {
  for (const flag of [undefined, '', 'true', 'TRUE', 'FALSE', '0', ' false ']) {
    if (!isAssetPurgeCommitEnabled(flag)) throw new Error(`Unexpected disabled value: ${flag}`)
  }
  if (isAssetPurgeCommitEnabled('false')) throw new Error('Explicit rollback must disable permanent deletion')
}
