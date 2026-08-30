import type { BackupInfo } from '@/types/journal-bridge'

export type BackupListState = 'loading' | 'loaded' | 'error'

export type BackupHealthPresentation = Readonly<{
  tone: 'neutral' | 'positive' | 'warning' | 'danger'
  title: string
  detail: string
  action: 'none' | 'retry-load' | 'create' | 'verify-latest'
  latest?: BackupInfo
  lastVerified?: BackupInfo
}>

export function automaticVerificationTarget(
  state: BackupListState,
  backups: readonly BackupInfo[],
): BackupInfo | undefined {
  if (state !== 'loaded') return undefined
  const latest = [...backups].sort((left, right) => right.timestamp - left.timestamp)[0]
  return latest && !latest.verification ? latest : undefined
}

export function presentBackupHealth(
  state: BackupListState,
  backups: readonly BackupInfo[],
): BackupHealthPresentation {
  if (state === 'loading') return { tone: 'neutral', title: '正在读取备份', detail: '', action: 'none' }
  if (state === 'error') return { tone: 'danger', title: '无法读取备份', detail: '请重试。', action: 'retry-load' }
  const ordered = [...backups].sort((left, right) => right.timestamp - left.timestamp)
  const latest = ordered[0]
  if (!latest) return { tone: 'neutral', title: '尚未备份', detail: '可创建一份完整备份。', action: 'create' }
  const lastVerified = ordered.find((item) => item.verification?.status === 'verified')
  if (!latest.verification) return { tone: 'neutral', title: '最新备份 · 未验证', detail: '验证后可用于恢复。', action: 'verify-latest', latest, lastVerified }
  if (latest.verification.status === 'invalid') {
    return {
      tone: lastVerified ? 'warning' : 'danger',
      title: '最新备份不可用',
      detail: lastVerified ? '可使用更早的已验证备份。' : '请重新备份。',
      action: 'create',
      latest,
      lastVerified,
    }
  }
  return { tone: 'positive', title: '最新备份可用', detail: '', action: 'none', latest, lastVerified: latest }
}
