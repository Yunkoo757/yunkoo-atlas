import { useEffect, useId, useMemo, useRef, useState } from 'react'
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

type LivePerformanceCycleManagerProps = {
  currentTradingDayKey: string
  onClose: () => void
  onCreated: () => void
}

export function LivePerformanceCycleManager({ currentTradingDayKey, onClose, onCreated }: LivePerformanceCycleManagerProps) {
  const cycles = useStore((state) => state.livePerformanceCycles)
  const trades = useStore((state) => state.trades)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const resetLiveStatistics = useStore((state) => state.resetLiveStatistics)
  const replaceLivePerformanceCycles = useStore((state) => state.replaceLivePerformanceCycles)
  const setLiveStatsStartTradingDayKey = useStore((state) => state.setLiveStatsStartTradingDayKey)
  const [startTradingDayKey, setStartTradingDayKey] = useState(currentTradingDayKey)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const summaryId = useId()

  const startReason = !isValidLiveCycleDayKey(startTradingDayKey)
    ? '请选择有效的开始日期'
    : startTradingDayKey > currentTradingDayKey
      ? '开始日期不能晚于当前交易日'
      : null
  const preview = useMemo(() => !startReason
    ? buildLivePerformanceRestartPreview(trades, cycles, startTradingDayKey, tradingDayStartHour)
    : null, [cycles, startReason, startTradingDayKey, trades, tradingDayStartHour])

  useEffect(() => {
    document.querySelector<HTMLButtonElement>('button[aria-label="开始日期"]')?.focus()
  }, [])

  async function commitReset(): Promise<boolean> {
    if (busyRef.current || startReason) return false
    const previous = {
      cycles: useStore.getState().livePerformanceCycles,
      riskStart: useStore.getState().liveStatsStartTradingDayKey,
      weeklyRiskPreparations: useStore.getState().weeklyRiskPreparations,
      riskPolicyVersions: useStore.getState().riskPolicyVersions,
      monthlyRiskLimits: useStore.getState().monthlyRiskLimits,
      riskOverrideEvents: useStore.getState().riskOverrideEvents,
    }
    busyRef.current = true
    setBusy(true)
    resetLiveStatistics(startTradingDayKey, currentTradingDayKey)
    try {
      await flushPersistNow()
      toast('已重置实盘统计与风险设置')
      return true
    } catch (error) {
      replaceLivePerformanceCycles(previous.cycles)
      setLiveStatsStartTradingDayKey(previous.riskStart)
      useStore.setState({
        weeklyRiskPreparations: previous.weeklyRiskPreparations,
        riskPolicyVersions: previous.riskPolicyVersions,
        monthlyRiskLimits: previous.monthlyRiskLimits,
        riskOverrideEvents: previous.riskOverrideEvents,
      })
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
          toast('当前实盘已被其他客户端更新，请重新打开核对')
        } catch {
          discardPendingAndResumePersist()
          toast('实盘统计提交冲突，请重新打开应用核对当前设置')
        }
        return false
      }
      try {
        await flushPersistNow()
        toast('实盘统计保存失败，原设置已保留')
      } catch {
        toast('实盘统计保存与回滚均失败，请重新打开应用核对当前设置')
      }
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const confirmReset = async () => {
    if (await commitReset()) {
      onClose()
      onCreated()
    }
  }

  return (
    <ModalShell
      title="重置实盘统计"
      description="在保留交易、案例、图片与复盘内容的前提下，清空当前绩效与风险计算，并恢复默认风险设置。重置前的已结束与进行中实盘会离开今日工作台和当前交易日志，可在历史记录中回看。"
      describedById={preview ? summaryId : undefined}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-btn ui-btn-bordered" disabled={busy} onClick={onClose}>取消</button>
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            disabled={busy || Boolean(startReason)}
            onClick={() => void confirmReset()}
          >
            {busy ? '正在保存…' : '确认重置'}
          </button>
        </>
      }
    >
      <div className="live-performance-cycle-manager" data-cycle-manager>
        <div className="live-performance-cycle-form">
          <label className="live-performance-cycle-field">
            <span>重置起点</span>
            <DatePicker
              value={startTradingDayKey}
              onValueChange={setStartTradingDayKey}
              ariaLabel="开始日期"
              disabled={busy}
              required
            />
          </label>
          {startReason ? <p className="live-performance-cycle-validation" data-cycle-validation role="status">{startReason}</p> : null}
          {preview ? (
            <div className="live-performance-cycle-counts" id={summaryId} aria-label="重置实盘统计确认摘要">
              <div><strong>重置前记录 {preview.archivedClosedCount} 笔</strong><span>起点前已结束实盘进入统一历史</span></div>
              <div><strong>当前已结束 {preview.currentClosedCount} 笔</strong><span>含起点当天已结束记录</span></div>
              <div><strong>进行中 {preview.activeCount} 笔</strong><span>仅开仓日在起点后的计划/持仓留在当前；更早的进入历史</span></div>
              <div><strong>待整理 {preview.pendingCount} 笔</strong><span>缺有效日期或暂无法归属</span></div>
              <div><strong>关联案例 {preview.associatedCaseCount} 个</strong><span>案例内容不会移动或删除</span></div>
              <div><strong>风险设置恢复默认</strong><span>限额、政策版本与覆盖记录一并清空</span></div>
            </div>
          ) : null}
        </div>
      </div>
    </ModalShell>
  )
}
