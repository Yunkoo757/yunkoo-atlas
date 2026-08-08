import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  appendLivePerformanceCycle,
  undoLatestLivePerformanceCycle,
  type LivePerformanceCycle,
} from '@/lib/livePerformanceCycles'
import { isValidLiveCycleDayKey } from '@/lib/liveCycle'
import { toast } from '@/lib/toast'
import {
  clearSessionUiAfterLibrarySwitch,
  applySnapshotToStore,
  resetEmptyLibraryIntoStore,
} from '@/lib/importExport'
import {
  discardPendingAndResumePersist,
  flushPersistNow,
  resumePersist,
  suspendPersist,
} from '@/storage/persist'
import { getStorage } from '@/storage/provider'
import { isRevisionedStorageAdapter, StorageRevisionConflictError } from '@/storage/adapter'
import { discardAllNoteDrafts } from '@/storage/noteDrafts'
import { waitForPendingStorageOperations } from '@/storage/pendingOperations'
import { clearWebWriteConflictAfterReload } from '@/storage/webWriteGuard'
import { buildLivePerformanceRestartPreview, useStore } from '@/store/useStore'
import { DatePicker } from '@/components/ui/DatePicker'
import { ModalShell } from '@/components/ui/ModalShell'
import './LivePerformanceCycleManager.css'

type ManagerMode = 'manage' | 'create' | 'undo'
type FocusSource = 'create' | 'undo' | null

type LivePerformanceCycleManagerProps = {
  currentTradingDayKey: string
  onClose: () => void
  onCreated: (cycles: readonly LivePerformanceCycle[]) => void
}

function stableCycleName(startTradingDayKey: string): string {
  return `统计周期 ${startTradingDayKey}`
}

export function LivePerformanceCycleManager({ currentTradingDayKey, onClose, onCreated }: LivePerformanceCycleManagerProps) {
  const cycles = useStore((state) => state.livePerformanceCycles)
  const trades = useStore((state) => state.trades)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const replaceLivePerformanceCycles = useStore((state) => state.replaceLivePerformanceCycles)
  const [mode, setMode] = useState<ManagerMode>(() => cycles.length === 0 ? 'create' : 'manage')
  const [startTradingDayKey, setStartTradingDayKey] = useState(currentTradingDayKey)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const createTriggerRef = useRef<HTMLButtonElement>(null)
  const undoTriggerRef = useRef<HTMLButtonElement>(null)
  const undoConfirmRef = useRef<HTMLButtonElement>(null)
  const focusSourceRef = useRef<FocusSource>(null)
  const summaryId = useId()

  const latest = cycles.at(-1) ?? null
  const startReason = mode !== 'create'
    ? null
    : !isValidLiveCycleDayKey(startTradingDayKey)
      ? '请选择有效的统计周期开始日期'
      : startTradingDayKey > currentTradingDayKey
        ? '开始日期不能晚于当前交易日'
        : latest && startTradingDayKey <= latest.startTradingDayKey
          ? '开始日期必须晚于当前统计周期的开始日期'
          : null
  const preview = useMemo(() => mode === 'create' && !startReason
    ? buildLivePerformanceRestartPreview(trades, cycles, startTradingDayKey, tradingDayStartHour)
    : null, [cycles, mode, startReason, startTradingDayKey, trades, tradingDayStartHour])

  useEffect(() => {
    if (mode === 'create') {
      document.querySelector<HTMLButtonElement>('button[aria-label="统计周期开始日期"]')?.focus()
      return
    }
    if (mode === 'undo') {
      undoConfirmRef.current?.focus()
      return
    }
    const source = focusSourceRef.current
    focusSourceRef.current = null
    if (source === 'create') createTriggerRef.current?.focus()
    if (source === 'undo') undoTriggerRef.current?.focus()
  }, [mode])

  async function commitCycles(next: LivePerformanceCycle[], successMessage: string): Promise<boolean> {
    if (busyRef.current) return false
    const previous = useStore.getState().livePerformanceCycles
    busyRef.current = true
    setBusy(true)
    replaceLivePerformanceCycles(next)
    try {
      await flushPersistNow()
      toast(successMessage)
      return true
    } catch (error) {
      replaceLivePerformanceCycles(previous)
      if (error instanceof StorageRevisionConflictError) {
        suspendPersist()
        try {
          await waitForPendingStorageOperations()
          const storage = getStorage()
          const envelope = isRevisionedStorageAdapter(storage)
            ? await storage.loadSnapshotEnvelope()
            : { revision: null, snapshot: await storage.loadSnapshot() }
          discardAllNoteDrafts()
          if (envelope.snapshot) applySnapshotToStore(envelope.snapshot)
          else resetEmptyLibraryIntoStore()
          clearSessionUiAfterLibrarySwitch()
          discardPendingAndResumePersist()
          if (envelope.revision !== null) clearWebWriteConflictAfterReload(envelope.revision)
          toast('统计周期已被其他客户端更新，请重新打开核对')
        } catch {
          resumePersist({ flushNow: false })
          toast('统计周期提交冲突，请重新打开应用核对当前设置')
        }
        return false
      }
      try {
        await flushPersistNow()
        toast('统计周期保存失败，原设置已保留')
      } catch {
        toast('统计周期保存与回滚均失败，请重新打开应用核对当前设置')
      }
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const beginCreate = () => {
    focusSourceRef.current = 'create'
    setStartTradingDayKey(currentTradingDayKey)
    setMode('create')
  }
  const beginUndo = () => {
    focusSourceRef.current = 'undo'
    setMode('undo')
  }
  const leaveForm = () => cycles.length === 0 ? onClose() : setMode('manage')

  const confirmCreate = async () => {
    if (startReason || busyRef.current) return
    const cycle: LivePerformanceCycle = {
      id: globalThis.crypto.randomUUID(),
      name: stableCycleName(startTradingDayKey),
      startTradingDayKey,
      createdAt: new Date().toISOString(),
    }
    const next = appendLivePerformanceCycle(cycles, cycle, currentTradingDayKey)
    if (await commitCycles(next, '已重新开始当前实盘统计')) {
      onClose()
      onCreated(next)
    }
  }
  const confirmUndo = async () => {
    if (!latest || busyRef.current) return
    const next = undoLatestLivePerformanceCycle(cycles)
    if (await commitCycles(next, '已撤销最新统计周期')) onClose()
  }

  const title = mode === 'manage' ? '管理统计周期' : mode === 'create' ? '重新开始当前实盘统计' : '撤销最新统计周期'
  const description = mode === 'create'
    ? '这只会建立统计边界，不会复制、移动或删除交易、案例、图片、正文，也不会改变风险核算起点。'
    : mode === 'undo'
      ? '仅撤销最新一次统计边界，交易、案例和复盘均保持不变。'
      : '统计周期只调整绩效统计边界；旧名称仅作为内部记录保留。'
  const footer = mode === 'manage' ? <button type="button" className="ui-btn ui-btn-bordered" onClick={onClose}>完成</button>
    : <>
      <button type="button" className="ui-btn ui-btn-bordered" disabled={busy} onClick={leaveForm}>取消</button>
      <button ref={mode === 'undo' ? undoConfirmRef : undefined} type="button" className={mode === 'undo' ? 'ui-btn ui-btn-danger-solid' : 'ui-btn ui-btn-primary'} disabled={busy || (mode === 'create' && Boolean(startReason)) || (mode === 'undo' && !latest)} onClick={() => void (mode === 'create' ? confirmCreate() : confirmUndo())}>
        {busy ? '正在保存…' : mode === 'undo' ? '确认撤销' : '确认重新开始'}
      </button>
    </>

  return <ModalShell title={title} description={description} describedById={preview ? summaryId : undefined} busy={busy} onClose={onClose} footer={footer}>
    <div className="live-performance-cycle-manager" data-cycle-manager>
      {mode === 'manage' ? <>
        <div className="live-performance-cycle-manager-actions">
          <button ref={createTriggerRef} type="button" className="ui-btn ui-btn-primary" onClick={beginCreate}>重新开始统计</button>
          <button ref={undoTriggerRef} type="button" className="ui-btn ui-btn-danger" onClick={beginUndo}>撤销最新周期</button>
        </div>
        <div className="live-performance-cycle-list" aria-label="统计周期列表">
          {[...cycles].reverse().map((cycle) => <div className="live-performance-cycle-row" data-cycle-id={cycle.id} key={cycle.id}>
            <div><strong>{cycle.startTradingDayKey}{cycle.id === latest?.id ? ' · 当前' : ''}</strong><span>{cycle.name}</span></div>
          </div>)}
        </div>
      </> : null}
      {mode === 'create' ? <div className="live-performance-cycle-form">
        <label className="live-performance-cycle-field"><span>开始日期</span><DatePicker value={startTradingDayKey} onValueChange={setStartTradingDayKey} ariaLabel="统计周期开始日期" disabled={busy} required /></label>
        {startReason ? <p className="live-performance-cycle-validation" data-cycle-validation role="status">{startReason}</p> : null}
        {preview ? <div className="live-performance-cycle-counts" id={summaryId} aria-label="重新开始统计确认摘要">
          <div><strong>归档有效已平仓 {preview.archivedClosedCount} 笔</strong><span>起点前记录进入历史</span></div>
          <div><strong>当前有效已平仓 {preview.currentClosedCount} 笔</strong><span>含起点当天已平仓</span></div>
          <div><strong>进行中 {preview.activeCount} 笔</strong><span>继续留在当前工作区</span></div>
          <div><strong>待整理 {preview.pendingCount} 笔</strong><span>计划中交易继续留在当前工作区</span></div>
          <div><strong>关联案例 {preview.associatedCaseCount} 个</strong><span>案例内容不会移动或复制</span></div>
          <div><strong>风险核算起点不变</strong><span>只新增统计边界</span></div>
        </div> : null}
      </div> : null}
      {mode === 'undo' && latest ? <div className="live-performance-cycle-undo" role="alert"><strong>将撤销 {latest.startTradingDayKey} 的统计边界</strong><p>{cycles.length === 1 ? '撤销后将恢复全部历史为当前；交易、案例和复盘不会改变。' : '撤销后上一统计边界将成为当前；交易、案例和复盘不会改变。'}</p></div> : null}
    </div>
  </ModalShell>
}
