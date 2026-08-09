import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle, Shield } from '@/icons/appIcons'
import { Topbar } from '@/components/Topbar'
import { ModalShell } from '@/components/ui/ModalShell'
import { Button } from '@/components/ui/Button'
import { buildCopiedCloseDateCandidates } from '@/lib/importDataHealth'
import { useStore } from '@/store/useStore'
import './LiveArchiveView.css'

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

  return (
    <>
      <Topbar title="导入数据健康" />
      <main className="la-scroll idh-page">
        <div className="la-detail-head">
          <Link className="la-back" to="/live-archive"><ArrowLeft size={15} />返回历史归档</Link>
          <span>只处理经你确认的历史 Notion 日期污染</span>
        </div>
        <section className="idh-intro" aria-labelledby="import-health-title">
          <div><h2 id="import-health-title">平仓日待核对</h2><p>高置信记录具备“来源未提供平仓日”的明确元数据；其余记录不会自动选中。</p></div>
          <Shield size={24} aria-hidden />
        </section>
        {notice ? <div className="idh-notice" role="status"><CheckCircle size={16} aria-hidden /><span>{notice}</span>{lastActionId ? <button data-health-undo type="button" disabled={busy} onClick={() => void undoCleanup()}>{busy ? '正在安全撤销…' : '撤销本次清理'}</button> : null}</div> : null}
        {error ? <p className="la-route-notice" role="alert">{error}</p> : null}
        {candidates.length === 0 ? (
          <section className="la-empty"><CheckCircle size={24} aria-hidden /><h2>当前没有待核对记录</h2><p>没有历史记录会被自动修改。</p></section>
        ) : (
          <>
            <div className="idh-list" aria-label="历史 Notion 日期候选">
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
                  <div className="idh-identity"><strong>{candidate.ref} · {candidate.symbol}</strong><span>来源 {candidate.source}</span></div>
                  <dl className="idh-facts">
                    <div><dt>开仓日</dt><dd>{candidate.openedAt}</dd></div>
                    <div><dt>当前平仓日</dt><dd>{candidate.closedAt}</dd></div>
                    <div><dt>结果</dt><dd>{candidate.result}</dd></div>
                  </dl>
                  <p>{candidate.evidence}</p>
                </article>
              ))}
            </div>
            <div className="idh-actions">
              <span>已选择 {selectedCount} / {candidates.length}</span>
              <Button data-health-cleanup variant="danger" disabled={selectedCount === 0 || busy} onClick={() => setConfirming(true)}>清空平仓日</Button>
            </div>
          </>
        )}
      </main>
      {confirming ? (
        <ModalShell
          title="确认清空平仓日？"
          description={`将清空 ${selectedCount} 条历史记录的平仓日；提交前会先进入现有备份与持久化边界。`}
          busy={busy}
          dismissible={!busy}
          onClose={() => setConfirming(false)}
          footer={<><Button data-health-cancel variant="bordered" disabled={busy} onClick={() => setConfirming(false)}>取消</Button><Button data-health-confirm variant="danger-solid" disabled={busy} onClick={() => void confirmCleanup()}>{busy ? '正在安全保存…' : '确认清空'}</Button></>}
        >
          <p>清理只修改已选择记录的 <code>closedAt</code> 与冻结平仓业务日，并生成可撤销 patch。人工核对项由你本次勾选确认。</p>
        </ModalShell>
      ) : null}
    </>
  )
}
