import { useCallback, useEffect, useRef, useState } from 'react'
import { AsyncGeneration } from '@/lib/asyncGeneration'
import { STORAGE_RECOVERY_REQUIRED_EVENT } from '@/lib/storageRecovery'
import { runStartupTrashCleanup } from '@/lib/trashCleanup'
import { bootstrapStorage, stopStorageForRecovery } from '@/storage/bootstrap'
import { getJournalBridge } from '@/storage/runtime'
import type { JournalBridge } from '@/types/journalBridge'

type StartupScreen =
  | { kind: 'loading' | 'ready' }
  | { kind: 'welcome'; bridge: JournalBridge }
  | { kind: 'error'; message: string }
  | { kind: 'recovery'; message: string; reopening: boolean }

function storageBootstrapErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'VersionError') {
    return '本地数据版本不兼容，请刷新页面或更新应用后重试。'
  }
  if (error instanceof Error && /invalid display|sidebar|snapshot/i.test(error.message)) {
    return '本地显示配置无法识别（可能来自旧版侧栏项），请重试；若仍失败请从备份恢复。'
  }
  return '本地资料库暂时无法打开，请重试。'
}

async function waitForUiFonts(): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    await Promise.race([
      document.fonts.ready,
      new Promise((resolve) => window.setTimeout(resolve, 1200)),
    ])
  }
}

export function useWorkspaceStartup(checkDueStage: () => Promise<unknown>) {
  const [screen, setScreen] = useState<StartupScreen>({ kind: 'loading' })
  const attempts = useRef(new AsyncGeneration())
  const reloadAuthorized = useRef(false)

  const start = useCallback(async (from: 'location' | 'selection') => {
    const attempt = attempts.current.begin()
    const current = () => attempts.current.isCurrent(attempt)
    setScreen({ kind: 'loading' })
    try {
      const bridge = getJournalBridge()
      if (from === 'location' && bridge) {
        const status = await bridge.getLibraryStatus()
        if (!current()) return
        if (status.kind === 'unset') {
          setScreen({ kind: 'welcome', bridge })
          return
        }
        if (status.kind !== 'ready') {
          setScreen({ kind: 'error', message: `${status.reason}（${status.configuredPath}）` })
          return
        }
      }
      await bootstrapStorage()
      if (!current()) return
      await checkDueStage()
      if (!current()) return
      await runStartupTrashCleanup()
      if (!current()) return
      await waitForUiFonts()
      if (current()) setScreen({ kind: 'ready' })
    } catch (error) {
      if (!current()) return
      console.error('Storage bootstrap failed', error)
      setScreen({ kind: 'error', message: storageBootstrapErrorMessage(error) })
    }
  }, [checkDueStage])

  useEffect(() => {
    const requireRecovery = (message: string) => {
      attempts.current.invalidate()
      stopStorageForRecovery(message)
      setScreen({ kind: 'recovery', message, reopening: reloadAuthorized.current })
    }
    const onRecovery = (event: Event) => requireRecovery(
      event instanceof CustomEvent && typeof event.detail === 'string'
        ? event.detail : '阶段切换结果无法安全确认，已停止继续保存。',
    )
    const unsubscribe = getJournalBridge()?.onStorageRecoveryRequired?.(state => requireRecovery(state.message))
    window.addEventListener(STORAGE_RECOVERY_REQUIRED_EVENT, onRecovery)
    void start('location')
    return () => {
      attempts.current.invalidate()
      window.removeEventListener(STORAGE_RECOVERY_REQUIRED_EVENT, onRecovery)
      unsubscribe?.()
    }
  }, [start])

  useEffect(() => {
    const root = document.documentElement
    if (screen.kind === 'loading') {
      root.removeAttribute('data-ui-settled')
    } else if (screen.kind === 'ready') {
      let frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => { root.dataset.uiSettled = '1' })
      })
      return () => cancelAnimationFrame(frame)
    } else if (screen.kind === 'error' || screen.kind === 'recovery') {
      root.dataset.uiSettled = '1'
    }
  }, [screen.kind])

  const recover = async () => {
    if (screen.kind !== 'recovery' || reloadAuthorized.current) return
    const bridge = getJournalBridge()
    if (!bridge?.recoverStorage) {
      setScreen({ kind: 'recovery', message: '当前桌面运行时无法启动资料库恢复', reopening: false })
      return
    }
    reloadAuthorized.current = true
    setScreen({ ...screen, reopening: true })
    let message: string
    try {
      const result = await bridge.recoverStorage()
      if (result.ok) return // 主进程已接管，并从磁盘重新建立文档。
      message = result.message
    } catch (error) {
      message = storageBootstrapErrorMessage(error)
    }
    reloadAuthorized.current = false
    setScreen({ kind: 'recovery', message, reopening: false })
  }

  function selectAnotherLibrary(bridge: JournalBridge) {
    attempts.current.invalidate()
    setScreen({ kind: 'welcome', bridge })
  }

  return { screen, start, selectAnotherLibrary, recover, reloadAuthorized }
}
