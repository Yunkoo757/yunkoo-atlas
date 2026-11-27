import type { Trade } from '@/data/trades'
import type { ActivePersistedSnapshotKey } from '@/storage/persistedKeys'
import type { PortableSnapshotState } from '@/storage/snapshotProjection'
import type { ExportAssetRecord, PersistedSnapshot } from '@/storage/types'

type StageField = 'liveStages' | 'currentLiveStageId' | 'scheduledStageRollover'

/** 解析器会补全阶段；合并时按本机阶段归属处理手工构造的历史载荷。 */
export type ExportPayload = Pick<PersistedSnapshot, Exclude<ActivePersistedSnapshotKey, 'trades' | StageField>>
  & Partial<Pick<PersistedSnapshot, StageField>>
  & {
    version: number
    trades: (Trade & { strategy?: string })[]
    assets?: ExportAssetRecord[]
  }

/** 随机重编号附件前保留的、已经通过结构校验的交易身份来源。 */
export interface ImportIdentityPayload {
  trades: ExportPayload['trades']
}

export type PersistedSlice = Omit<PortableSnapshotState, 'profile' | 'shortcuts'>
