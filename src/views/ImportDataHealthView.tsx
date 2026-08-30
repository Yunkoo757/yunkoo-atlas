import { ICON_SM } from '@/icons/iconSize'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from '@/icons/appIcons'
import { EmptyState } from '@/components/EmptyState'
import { Topbar } from '@/components/Topbar'
import { ModalShell } from '@/components/ui/ModalShell'
import { Button } from '@/components/ui/Button'
import { buildCopiedCloseDateCandidates } from '@/lib/importDataHealth'
import { useStore } from '@/store/useStore'
import './ImportDataHealthView.css'
import './ListView.css'

export function ImportDataHealthView() {
  const trades = useStore((state) => state.trades)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const cleanupCopiedCloseDates = useStore((state) => state.cleanupCopiedCloseDates)
  const undoCopiedCloseDateCleanup = useStore((state) => state.undoCopiedCloseDateCleanup)
  const candidates = useMemo(
    () => buildCopiedCloseDateCandidates(trades, tradingDayStartHour),
    [trades, tradingDayStartHour],
  )
  const candidateKey = candidates.map((candidate) => `${candidate.tradeId}:${candidate.confidence}`).join('|')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastActionId, setLastActionId] = useState<string | null>(null)

  useEffect(() => {
    setSelected(new Set(candidates.filter((candidate) => candidate.selectedByDefault).map((candidate) => candidate.tradeId)))
  }, [candidateKey])

  const selectedCount = selected.size
  const confirmCleanup = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await cleanupCopiedCloseDates([...selected])
      if (result.kind === 'stale-selection') {
        setError('候选事实已变化，请重新核对后再操作。')
        return
      }
      setLastActionId(result.actionId ?? null)
      setNotice(`已清空 ${result.after.length} 条记录的平仓日。`)
      setConfirming(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '持久化失败，原记录未修改。')
    } finally {
      setBusy(false)
    }
  }

  const undoCleanup = async () => {
    if (!lastActionId) return
    setBusy(true)
    setError(null)
    try {
      const result = await undoCopiedCloseDateCleanup(lastActionId)
      if (result.kind === 'stale-action') {
        setError('记录已发生其他修改，无法安全撤销。')
        return
      }
      setLastActionId(null)
      setNotice('已安全保存并恢复本次清理前的平仓日字段。')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '撤销持久化失败，当前清理状态保持不变。')
    } finally {
      setBusy(false)
    }
  }

  const toggleAllHigh = () => {
    const highIds = candidates.filter((item) => item.confidence === 'high').map((item) => item.tradeId)
    setSelected((current) => {
      const allHighSelected = highIds.every((id) => current.has(id))
      const next = new Set(current)
      for (const id of highIds) {
        if (allHighSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  return (
    <>
      <Topbar
        title="导入数据健康"
        subtitle="核对历史导入日期"
        showDisplay={false}
      />
      <main className="idh-view">
        <div className="list-pending-entry idh-toolbar">
          <Link className="list-pending-link" to="/live-history">
            <ArrowLeft size={ICON_SM} aria-hidden />
            返回历史实盘
          </Link>
          <p className="idh-toolbar-meta" id="import-health-title">
            平仓日待核对 <span>{candidates.length}</span>
          </p>
          {candidates.length > 0 ? (
            <button type="button" className="ui-btn ui-btn-ghost idh-toolbar-action" onClick={toggleAllHigh}>
              切换高置信选中
            </button>
          ) : null}
        </div>

        {notice ? (
          <div className="idh-banner is-success" role="status">
            <span>{notice}</span>
            {lastActionId ? (
              <button
                data-health-undo
                type="button"
                className="ui-btn ui-btn-ghost"
                disabled={busy}
                onClick={() => void undoCleanup()}
              >
                {busy ? '正在安全撤销…' : '撤销本次清理'}
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div className="idh-banner is-danger" role="alert">{error}</div>
        ) : null}

        <section className="list-scroll idh-content" aria-label="平仓日待核对">
          {candidates.length === 0 ? (
            <EmptyState
              title="当前没有待核对记录"
              hint="暂无需要处理的记录"
              action={(
                <Link className="ui-btn ui-btn-bordered" to="/live-history">
                  返回历史实盘
                </Link>
              )}
            />
          ) : (
            <div className="idh-list" aria-label="历史 Notion 日期候选">
              <p className="idh-list-hint">
                已自动选中高置信记录，其余项目请按需核对。
              </p>
              {candidates.map((candidate) => (
                <article data-health-candidate key={candidate.tradeId} className="idh-row">
                  <label className="idh-select">
                    <input
                      data-health-select={candidate.tradeId}
                      type="checkbox"
                      checked={selected.has(candidate.tradeId)}
                      onChange={(event) => setSelected((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(candidate.tradeId)
                        else next.delete(candidate.tradeId)
                        return next
                      })}
                    />
                    <span className={candidate.confidence === 'high' ? 'is-high' : 'is-review'}>
                      {candidate.confidence === 'high' ? '高置信' : '需人工核对'}
                    </span>
                  </label>
                  <div className="idh-identity">
                    <strong>{candidate.ref} · {candidate.symbol}</strong>
                    <span>来源 {candidate.source}</span>
                  </div>
                  <dl className="idh-facts">
                    <div><dt>开仓日</dt><dd>{candidate.openedAt}</dd></div>
                    <div><dt>当前平仓日</dt><dd>{candidate.closedAt}</dd></div>
                    <div><dt>结果</dt><dd>{candidate.result}</dd></div>
                  </dl>
                  <p className="idh-evidence">{candidate.evidence}</p>
                </article>
              ))}
            </div>
          )}
        </section>

        {candidates.length > 0 ? (
          <div className="idh-actions">
            <span>已选择 {selectedCount} / {candidates.length}</span>
            <Button
              data-health-cleanup
              variant="danger"
              disabled={selectedCount === 0 || busy}
              onClick={() => setConfirming(true)}
            >
              清空平仓日
            </Button>
          </div>
        ) : null}
      </main>

      {confirming ? (
        <ModalShell
          title="确认清空平仓日？"
          description={`将清空 ${selectedCount} 条历史实盘记录的平仓日。`}
          busy={busy}
          dismissible={!busy}
          onClose={() => setConfirming(false)}
          footer={(
            <>
              <Button data-health-cancel variant="bordered" disabled={busy} onClick={() => setConfirming(false)}>
                取消
              </Button>
              <Button data-health-confirm variant="danger-solid" disabled={busy} onClick={() => void confirmCleanup()}>
                {busy ? '正在安全保存…' : '确认清空'}
              </Button>
            </>
          )}
        >
          <p>完成后可撤销本次操作。</p>
        </ModalShell>
      ) : null}
    </>
  )
}
