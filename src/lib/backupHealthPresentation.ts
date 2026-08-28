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

export function presentBackupHealth(
  state: BackupListState,
  backups: readonly BackupInfo[],
): BackupHealthPresentation {
  if (state === 'loading') return { tone: 'neutral', title: '正在读取备份', detail: '正在检查本地备份记录与验证状态。', action: 'none' }
  if (state === 'error') return { tone: 'danger', title: '备份列表读取失败', detail: '当前不能判断备份是否可用，请重试读取。', action: 'retry-load' }
  const ordered = [...backups].sort((left, right) => right.timestamp - left.timestamp)
  const latest = ordered[0]
  if (!latest) return { tone: 'warning', title: '尚无可恢复备份', detail: '立即创建并验证第一份完整备份。', action: 'create' }
  const lastVerified = ordered.find((item) => item.verification?.status === 'verified')
  if (!latest.verification) return { tone: 'warning', title: '最新备份尚未验证', detail: '验证通过后才能用于恢复。', action: 'verify-latest', latest, lastVerified }
  if (latest.verification.status === 'invalid') {
    return {
      tone: lastVerified ? 'warning' : 'danger',
      title: '最新备份验证失败',
      detail: lastVerified ? '仍有更早的已验证备份可回退；建议立即重新备份并验证。' : '当前没有已验证的回退备份，请立即重新备份并验证。',
      action: 'create',
      latest,
      lastVerified,
    }
  }
  return { tone: 'positive', title: '最新备份已验证', detail: '需要恢复时可使用这份完整备份。', action: 'none', latest, lastVerified: latest }
}
