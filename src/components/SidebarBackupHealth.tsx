import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { BackupInfo } from '@/types/journal-bridge'
import {
  presentBackupHealth,
  shouldSurfaceBackupHealth,
  type BackupListState,
} from '@/lib/backupHealthPresentation'
import { getJournalBridge, isElectron } from '@/storage/runtime'

export function SidebarBackupHealth() {
  const electron = isElectron()
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [state, setState] = useState<BackupListState>(electron ? 'loading' : 'loaded')

  useEffect(() => {
    if (!electron) return
    let cancelled = false
    const load = async () => {
      try {
        const list = await getJournalBridge()?.listBackups()
        if (cancelled) return
        setBackups(list ?? [])
        setState('loaded')
      } catch {
        if (cancelled) return
        setState('error')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [electron])

  const presentation = useMemo(() => presentBackupHealth(state, backups), [state, backups])
  if (!electron || !shouldSurfaceBackupHealth(presentation)) return null

  return (
    <Link
      className={`sb-backup-health is-${presentation.tone}`}
      data-sidebar-backup-health
      to="/settings/data"
    >
      <strong>{presentation.title}</strong>
      {presentation.detail ? <span>{presentation.detail}</span> : null}
    </Link>
  )
}
