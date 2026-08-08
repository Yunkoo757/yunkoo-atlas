import { useId, useMemo, useRef, useState } from 'react'
import {
  appendLivePerformanceCycle,
  filterTradesByLivePerformanceCycle,
  renameLivePerformanceCycle,
  undoLatestLivePerformanceCycle,
  type LivePerformanceCycle,
  type LivePerformanceCycleBounds,
  type ResolvedLivePerformanceCycle,
} from '@/lib/livePerformanceCycles'
import { isValidLiveCycleDayKey } from '@/lib/liveCycle'
import { formatYmd, parseLocalDate } from '@/lib/periods'
import { toast } from '@/lib/toast'
import { flushPersistNow } from '@/storage/persist'
import { useStore } from '@/store/useStore'
import { DatePicker } from '@/components/ui/DatePicker'
import { ModalShell } from '@/components/ui/ModalShell'
import './LivePerformanceCycleManager.css'

type ManagerMode = 'manage' | 'create' | 'rename' | 'undo'

type LivePerformanceCycleManagerProps = {
  currentTradingDayKey: string
  onClose: () => void
  onCreated: (cycles: readonly LivePerformanceCycle[]) => void
}

function previousDay(dayKey: string): string {
  const date = parseLocalDate(dayKey)
  date.setDate(date.getDate() - 1)
  return formatYmd(date)
}

function resolvedPreview(bounds: LivePerformanceCycleBounds): ResolvedLivePerformanceCycle {
  return {
    key: 'preview',
    cycleId: null,
    label: '预览',
    bounds,
    isCurrent: false,
    requestedKey: null,
    wasFallback: false,
  }
}

function createNameReason(name: string, cycles: readonly LivePerformanceCycle[], excludeId?: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return '请输入统计周期名称'
  if (trimmed.length > 40) return '统计周期名称不能超过 40 个字符'
  if (cycles.some((cycle) => cycle.id !== excludeId && cycle.name === trimmed)) return '统计周期名称已存在'
  return null
}

export function LivePerformanceCycleManager({
  currentTradingDayKey,
  onClose,
  onCreated,
}: LivePerformanceCycleManagerProps) {
  const cycles = useStore((state) => state.livePerformanceCycles)
  const trades = useStore((state) => state.trades)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const replaceLivePerformanceCycles = useStore((state) => state.replaceLivePerformanceCycles)
  const [mode, setMode] = useState<ManagerMode>(() => cycles.length === 0 ? 'create' : 'manage')
  const [name, setName] = useState('')
  const [startTradingDayKey, setStartTradingDayKey] = useState(currentTradingDayKey)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const nameId = useId()

  const latest = cycles.at(-1) ?? null
  const renameTarget = cycles.find((cycle) => cycle.id === renameId) ?? null
  const nameReason = createNameReason(name, cycles, mode === 'rename' ? renameId ?? undefined : undefined)
  const startReason = mode !== 'create'
    ? null
    : !isValidLiveCycleDayKey(startTradingDayKey)
      ? '请选择有效的统计周期开始日期'
      : startTradingDayKey > currentTradingDayKey
        ? '开始日期不能晚于当前交易日'
        : latest && startTradingDayKey <= latest.startTradingDayKey
          ? '开始日期必须晚于当前统计周期的开始日期'
          : null
  const renameUnchanged = mode === 'rename' && renameTarget?.name === name.trim()
  const validationReason = nameReason ?? startReason ?? (renameUnchanged ? '统计周期名称没有变化' : null)

  const firstCycleCounts = useMemo(() => {
    if (mode !== 'create' || latest || !isValidLiveCycleDayKey(startTradingDayKey)) return null
    const preCycle = filterTradesByLivePerformanceCycle(
      trades,
      resolvedPreview({ startInclusive: null, endExclusive: startTradingDayKey }),
      tradingDayStartHour,
    ).length
    const current = filterTradesByLivePerformanceCycle(
      trades,
      resolvedPreview({ startInclusive: startTradingDayKey, endExclusive: null }),
      tradingDayStartHour,
    ).length
    return { preCycle, current }
  }, [latest, mode, startTradingDayKey, trades, tradingDayStartHour])

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
    } catch {
      replaceLivePerformanceCycles(previous)
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
    setName('')
    setStartTradingDayKey(currentTradingDayKey)
    setRenameId(null)
    setMode('create')
  }

  const beginRename = (cycle: LivePerformanceCycle) => {
    setName(cycle.name)
    setRenameId(cycle.id)
    setMode('rename')
  }

  const leaveForm = () => {
    if (cycles.length === 0) onClose()
    else setMode('manage')
  }

  const confirmCreate = async () => {
    if (validationReason || busyRef.current) return
    const cycle: LivePerformanceCycle = {
      id: globalThis.crypto.randomUUID(),
      name: name.trim(),
      startTradingDayKey,
      createdAt: new Date().toISOString(),
    }
    const next = appendLivePerformanceCycle(cycles, cycle, currentTradingDayKey)
    if (await commitCycles(next, `已开始统计周期「${cycle.name}」`)) {
      onClose()
      onCreated(next)
    }
  }

  const confirmRename = async () => {
    if (validationReason || !renameTarget || busyRef.current) return
    const next = renameLivePerformanceCycle(cycles, renameTarget.id, name.trim())
    if (await commitCycles(next, '统计周期已重命名')) onClose()
  }

  const confirmUndo = async () => {
    if (!latest || busyRef.current) return
    const next = undoLatestLivePerformanceCycle(cycles)
    if (await commitCycles(next, '已撤销最新统计周期')) onClose()
  }

  const title = mode === 'manage'
    ? '管理统计周期'
    : mode === 'create'
      ? cycles.length === 0 ? '开始统计周期' : '开始下一统计周期'
      : mode === 'rename'
        ? '重命名统计周期'
        : '撤销最新统计周期'

  const description = mode === 'manage'
    ? '统计周期只调整绩效统计边界，不会改动交易、案例或复盘。'
    : mode === 'create'
      ? '新周期按交易的平仓日划分，既有记录会保留。'
      : mode === 'rename'
        ? '只修改显示名称，周期日期和全部记录保持不变。'
        : '仅撤销最新一次周期划分，全部记录仍会保留。'

  const footer = mode === 'manage' ? (
    <button type="button" className="ui-btn ui-btn-bordered" onClick={onClose}>完成</button>
  ) : mode === 'create' ? (
    <>
      <button type="button" className="ui-btn ui-btn-bordered" disabled={busy} onClick={leaveForm}>取消</button>
      <button
        type="button"
        className="ui-btn ui-btn-primary"
        disabled={busy || Boolean(validationReason)}
        onClick={() => void confirmCreate()}
      >
        {busy ? '正在保存…' : '确认开始'}
      </button>
    </>
  ) : mode === 'rename' ? (
    <>
      <button type="button" className="ui-btn ui-btn-bordered" disabled={busy} onClick={leaveForm}>取消</button>
      <button
        type="button"
        className="ui-btn ui-btn-primary"
        disabled={busy || Boolean(validationReason)}
        onClick={() => void confirmRename()}
      >
        {busy ? '正在保存…' : '确认重命名'}
      </button>
    </>
  ) : (
    <>
      <button type="button" className="ui-btn ui-btn-bordered" disabled={busy} onClick={leaveForm}>取消</button>
      <button
        type="button"
        className="ui-btn ui-btn-danger-solid"
        disabled={busy || !latest}
        onClick={() => void confirmUndo()}
      >
        {busy ? '正在保存…' : '确认撤销'}
      </button>
    </>
  )

  return (
    <ModalShell
      title={title}
      description={description}
      busy={busy}
      onClose={onClose}
      footer={footer}
    >
      <div className="live-performance-cycle-manager" data-cycle-manager>
        {mode === 'manage' ? (
          <>
            <div className="live-performance-cycle-manager-actions">
              <button type="button" className="ui-btn ui-btn-primary" onClick={beginCreate}>开始下一统计周期</button>
              <button type="button" className="ui-btn ui-btn-danger" onClick={() => setMode('undo')}>撤销最新周期</button>
            </div>
            <div className="live-performance-cycle-list" aria-label="统计周期列表">
              {[...cycles].reverse().map((cycle) => (
                <div className="live-performance-cycle-row" data-cycle-id={cycle.id} key={cycle.id}>
                  <div>
                    <strong>{cycle.name}</strong>
                    <span>从 {cycle.startTradingDayKey} 开始{cycle.id === latest?.id ? ' · 当前' : ''}</span>
                  </div>
                  <button type="button" className="ui-btn ui-btn-ghost" onClick={() => beginRename(cycle)}>重命名</button>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {mode === 'create' || mode === 'rename' ? (
          <div className="live-performance-cycle-form">
            <label className="live-performance-cycle-field" htmlFor={nameId}>
              <span>统计周期名称</span>
              <input
                id={nameId}
                type="text"
                value={name}
                aria-label="统计周期名称"
                maxLength={80}
                disabled={busy}
                data-autofocus
                onChange={(event) => setName(event.target.value)}
              />
              <small>{name.trim().length}/40 个字符</small>
            </label>
            {mode === 'create' ? (
              <label className="live-performance-cycle-field">
                <span>开始日期</span>
                <DatePicker
                  value={startTradingDayKey}
                  onValueChange={setStartTradingDayKey}
                  ariaLabel="统计周期开始日期"
                  disabled={busy}
                  required
                />
              </label>
            ) : null}
            {validationReason ? (
              <p className="live-performance-cycle-validation" data-cycle-validation role="status">
                {validationReason}
              </p>
            ) : null}
            {mode === 'create' && !startReason ? (
              latest ? (
                <p className="live-performance-cycle-preview">
                  上一统计周期将于 <strong>{previousDay(startTradingDayKey)}</strong> 结束；新周期从平仓日 {startTradingDayKey} 起统计。
                </p>
              ) : firstCycleCounts ? (
                <div className="live-performance-cycle-counts" aria-label="第一期统计预览">
                  <div><strong>统计起点前实盘 {firstCycleCounts.preCycle} 笔</strong><span>仍可在全部历史中查看</span></div>
                  <div><strong>本周期实盘 {firstCycleCounts.current} 笔</strong><span>按平仓日计入第一期</span></div>
                </div>
              ) : null
            ) : null}
          </div>
        ) : null}

        {mode === 'undo' && latest ? (
          <div className="live-performance-cycle-undo" role="alert">
            <strong>将撤销「{latest.name}」的周期划分</strong>
            <p>{cycles.length === 1
              ? '撤销后将恢复全部历史统计；交易、案例和复盘不会改变。'
              : '撤销后，上一期将成为当前统计周期；交易、案例和复盘不会改变。'}</p>
          </div>
        ) : null}
      </div>
    </ModalShell>
  )
}
