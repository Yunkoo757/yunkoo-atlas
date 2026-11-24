import { useMemo, useState } from 'react'
import { useStore } from '@/store/useStore'
import { getStorage } from '@/storage'
import { isElectron } from '@/storage/runtime'
import { Button } from '@/components/ui/Button'
import { ModalShell } from '@/components/ui/ModalShell'
import { DisclosureSummary } from '@/components/ui/DisclosureSummary'
import { InlineStatus } from '@/components/ui/InlineStatus'
import { captureOrganizationSnapshot, organizeLibrary } from '@/lib/dataOrganizationService'
import { extraDuplicateWeeklyReviewIds, findDuplicateWeeklyReviewWeeks, prepareDataOrganization } from '@/lib/dataOrganization'
import { userFacingErrorMessage } from '@/lib/userFacingError'
import './DataOrganizationPanel.css'

export function DataOrganizationPanel({ day, onCompleted }: { day: string; onCompleted: () => void }) {
  const trades = useStore(state => state.trades)
  const reviews = useStore(state => state.weeklyReviews)
  const stages = useStore(state => state.liveStages)
  const [open, setOpen] = useState(false)
  const [migrate, setMigrate] = useState(false)
  const [reset, setReset] = useState(false)
  const [weekly, setWeekly] = useState<string[]>([])
  const [preview, setPreview] = useState<{ snapshot: string; libraryId: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [completedBackup, setCompletedBackup] = useState<string | null>(null)
  const live = trades.filter(trade => trade.tradeKind === 'live')
  const duplicateWeeks = useMemo(() => findDuplicateWeeklyReviewWeeks(reviews), [reviews])
  const extraDuplicateIds = useMemo(() => extraDuplicateWeeklyReviewIds(reviews), [reviews])
  const request = { migrateLive: migrate, resetStages: reset, deleteWeeklyIds: weekly }
  const resetPreview = () => { setPreview(null); setResult('') }
  const showPreview = async () => {
    if (busy) return
    setBusy(true)
    try {
      const manifest = await getStorage().getManifest()
      const snapshot = captureOrganizationSnapshot()
      prepareDataOrganization(snapshot, request, day, new Date().toISOString(), crypto.randomUUID())
      setPreview({ snapshot: JSON.stringify(snapshot), libraryId: manifest.libraryId }); setResult('')
    } catch (error) { setResult(userFacingErrorMessage(error, '无法生成预览，请重试。')) }
    finally { setBusy(false) }
  }
  const execute = async () => {
    if (!preview || busy) return
    setBusy(true)
    try {
      const backup = await organizeLibrary(preview.snapshot, request, day, preview.libraryId)
      setCompletedBackup(backup); setResult('')
      setPreview(null); setMigrate(false); setReset(false); setWeekly([])
      onCompleted()
    } catch (error) { setResult(userFacingErrorMessage(error, '数据整理未完成，请检查资料库状态后重试。')); setPreview(null) }
    finally { setBusy(false) }
  }
  if (!isElectron()) return null
  return <section className="settings-page-section data-organization-section">
    <h2 className="settings-section-title">数据整理</h2>
    <p className="data-organization-muted">迁移实盘日志、重新开始实盘记录，或删除周复盘。执行前自动备份并验证，案例和附件保留。</p>
    <Button variant="bordered" onClick={() => { setMigrate(false); setReset(false); setWeekly([]); setOpen(true); setCompletedBackup(null); resetPreview() }}>整理数据</Button>
    {open && <ModalShell title={completedBackup ? '整理完成' : preview ? '确认整理范围' : '数据整理'} size={completedBackup ? 'compact' : 'default'} busy={busy} onClose={() => { if (!busy) setOpen(false) }}
      footer={completedBackup ? <Button variant="bordered" onClick={() => setOpen(false)}>关闭</Button> : preview ? <>
        <Button variant="bordered" disabled={busy} onClick={resetPreview}>返回调整</Button>
        <Button variant="danger-solid" busy={busy} onClick={() => void execute()}>备份并执行整理</Button>
      </> : <Button variant="primary" busy={busy} disabled={!migrate && !reset && !weekly.length} onClick={() => void showPreview()}>预览影响</Button>}>
      <div className="data-organization-options">
        {completedBackup ? <section className="data-organization-complete">
          <p role="status">整理完成。整理前备份已验证，可在「自动备份」中恢复。</p>
          <details><DisclosureSummary>查看恢复备份位置</DisclosureSummary><p>{completedBackup}</p></details>
        </section> : !preview ? <>
        <Button className="data-organization-shortcut" size="sm" variant="bordered" disabled={busy} onClick={() => { setMigrate(true); setReset(true); resetPreview() }}>重新开始实盘记录</Button>
        <div className="data-organization-group"><label><input type="checkbox" checked={migrate} disabled={busy} onChange={e => { setMigrate(e.target.checked); resetPreview() }} />实盘日志全部移至模拟盘（{live.length} 条）</label>
        <p className="data-organization-muted">保留原代号、正文、截图、标签和策略。{live.some(t => t.deletedAt) && '回收站中的实盘记录也会转换类型。'}</p></div>
        <div className="data-organization-group"><label><input type="checkbox" checked={reset} disabled={busy} onChange={e => { setReset(e.target.checked); resetPreview() }} />清空旧实盘阶段（{stages.length} 个），建立空白当前阶段</label>
        <p className="data-organization-muted">同步清空旧阶段的风控记录。保留的案例和周复盘将解除旧阶段关联。</p>
        {reset && duplicateWeeks.length > 0 ? (
          <div className="data-organization-duplicates" data-duplicate-weekly-weeks>
            <p>有 {duplicateWeeks.length} 周在多个阶段各有复盘。合并阶段前，每周只能保留一篇。</p>
            <Button size="sm" variant="bordered" disabled={busy || extraDuplicateIds.every(id => weekly.includes(id))} onClick={() => {
              setWeekly(current => [...new Set([...current, ...extraDuplicateIds])])
              resetPreview()
            }}>选择重复篇（{extraDuplicateIds.length}）</Button>
          </div>
        ) : null}</div>
        {reviews.length > 0 && <details className="data-organization-weekly">
          <DisclosureSummary>删除周复盘{weekly.length ? ` · 已选 ${weekly.length} / ${reviews.length} 篇` : ` · ${reviews.length} 篇`}</DisclosureSummary>
          <div className="data-organization-weekly-head">
          <Button size="sm" disabled={busy} onClick={() => { setWeekly(weekly.length === reviews.length ? [] : reviews.map(r => r.id)); resetPreview() }}>{weekly.length === reviews.length && reviews.length ? '取消全选' : '全选'}</Button></div>
        <div className="data-organization-weeks">{reviews.map(review => <label key={review.id}><input type="checkbox" checked={weekly.includes(review.id)} disabled={busy} onChange={e => { setWeekly(e.target.checked ? [...weekly, review.id] : weekly.filter(id => id !== review.id)); resetPreview() }} />{review.weekStart} — {review.weekEnd}{review.liveStageId ? ` · ${stages.find(stage => stage.id === review.liveStageId)?.name ?? '历史阶段'}` : ''}</label>)}</div></details>}
        </> : <section className="data-organization-preview" aria-label="整理影响预览">
          <dl>
            {migrate ? <><dt>移至模拟盘</dt><dd>{live.length} 条实盘日志；保留代号、正文、截图、标签和策略，不归档。{live.some(t => t.deletedAt) ? `其中 ${live.filter(t => t.deletedAt).length} 条仍保留在回收站。` : ''}</dd></> : null}
            {reset && <><dt>实盘阶段</dt><dd>清空 {stages.length} 个旧阶段及风险准备、规则版本、月度限额和风险例外，建立空白当前阶段。</dd></>}
            <dt>周复盘</dt><dd>{weekly.length ? `删除 ${weekly.length} 篇周复盘。` : '全部保留。'}{reset ? '保留篇目的正文与冻结证据不变，解除旧阶段关联。' : ''}{migrate ? '解除未具备冻结证据的直接交易引用。' : ''}</dd>
            <dt>案例</dt><dd>{trades.filter(t => t.tradeKind === 'case').length} 条全部保留{reset ? '，解除旧阶段关联' : ''}。</dd>
            <dt>其他资料</dt><dd>策略、标签预置、随记和截图文件保留。</dd>
          </dl>
          <p>执行前会创建并验证整库备份，可在「自动备份」中恢复。</p>
        </section>}
        {busy && <InlineStatus compact tone="progress" title={preview ? '正在验证备份并保存…' : '正在检查所选记录…'} />}
        {result && <InlineStatus compact tone="error" title={result} />}
      </div>
    </ModalShell>}
  </section>
}
