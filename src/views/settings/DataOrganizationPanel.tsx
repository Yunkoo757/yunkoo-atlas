import { useState } from 'react'
import { useStore } from '@/store/useStore'
import { getStorage } from '@/storage'
import { isElectron } from '@/storage/runtime'
import { Button } from '@/components/ui/Button'
import { ModalShell } from '@/components/ui/ModalShell'
import { captureOrganizationSnapshot, organizeLibrary } from '@/lib/dataOrganizationService'
import { prepareDataOrganization } from '@/lib/dataOrganization'
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
  const live = trades.filter(trade => trade.tradeKind === 'live')
  const request = { migrateLive: migrate, resetStages: reset, deleteWeeklyIds: weekly }
  const resetPreview = () => { setPreview(null); setResult('') }
  const showPreview = async () => {
    try {
      const manifest = await getStorage().getManifest()
      const snapshot = captureOrganizationSnapshot()
      prepareDataOrganization(snapshot, request, day, new Date().toISOString(), crypto.randomUUID())
      setPreview({ snapshot: JSON.stringify(snapshot), libraryId: manifest.libraryId }); setResult('')
    } catch (error) { setResult(userFacingErrorMessage(error, '数据整理未完成，请检查资料库状态后重试。')) }
  }
  const execute = async () => {
    if (!preview || busy) return
    setBusy(true)
    try {
      const backup = await organizeLibrary(preview.snapshot, request, day, preview.libraryId)
      setResult(`整理完成。恢复备份：${backup}。可在下方「备份」恢复。`)
      setPreview(null); setMigrate(false); setReset(false); setWeekly([])
      onCompleted()
    } catch (error) { setResult(userFacingErrorMessage(error, '数据整理未完成，请检查资料库状态后重试。')); setPreview(null) }
    finally { setBusy(false) }
  }
  if (!isElectron()) return null
  return <section className="settings-page-section data-organization-section">
    <h2 className="settings-section-title">数据整理</h2>
    <p className="data-organization-muted">迁移实盘日志、重新开始实盘记录，或删除周复盘。执行前自动备份并验证，案例和附件保留。</p>
    <Button variant="bordered" onClick={() => { setOpen(true); resetPreview() }}>整理数据</Button>
    {open && <ModalShell title="数据整理" size="wide" panelClassName="data-organization-modal" busy={busy} onClose={() => { if (!busy) setOpen(false) }}
      footer={<><Button disabled={busy} onClick={() => setOpen(false)}>关闭</Button>{preview
        ? <Button variant="danger" busy={busy} onClick={() => void execute()}>备份并执行整理</Button>
        : <Button variant="bordered" disabled={busy || (!migrate && !reset && !weekly.length)} onClick={showPreview}>预览影响</Button>}</>}>
      <div className="data-organization-options">
        <Button className="data-organization-shortcut" variant="ghost" disabled={busy} onClick={() => { setMigrate(true); setReset(true); resetPreview() }}>重新开始实盘记录</Button>
        <div className="data-organization-group"><label><input type="checkbox" checked={migrate} disabled={busy} onChange={e => { setMigrate(e.target.checked); resetPreview() }} />实盘日志全部移至模拟盘（{live.length} 条）</label>
        <p className="data-organization-muted">直接进入模拟盘默认列表，保留代号、正文、截图、标签和策略，不归档。回收站中的 {live.filter(t => t.deletedAt).length} 条记录也会转换类型，并继续保留在回收站。</p></div>
        <div className="data-organization-group"><label><input type="checkbox" checked={reset} disabled={busy} onChange={e => { setReset(e.target.checked); resetPreview() }} />清空旧实盘阶段（{stages.length} 个），建立空白当前阶段</label>
        <p className="data-organization-muted">同时清空阶段风险准备、规则版本、月度限额和风险例外记录。案例不迁移，仅解除旧阶段关联。未删除的周复盘保留正文与冻结证据，并解除旧阶段关联。</p></div>
        <div className="data-organization-group"><div className="data-organization-weekly-head"><h3>删除周复盘（已选 {weekly.length} / {reviews.length}）</h3>
          <Button size="sm" disabled={busy} onClick={() => { setWeekly(weekly.length === reviews.length ? [] : reviews.map(r => r.id)); resetPreview() }}>{weekly.length === reviews.length && reviews.length ? '取消全选' : '全选'}</Button></div>
        <div className="data-organization-weeks">{reviews.map(review => <label key={review.id}><input type="checkbox" checked={weekly.includes(review.id)} disabled={busy} onChange={e => { setWeekly(e.target.checked ? [...weekly, review.id] : weekly.filter(id => id !== review.id)); resetPreview() }} />{review.weekStart} — {review.weekEnd}</label>)}{!reviews.length && <span className="data-organization-muted">暂无周复盘</span>}</div></div>
        {preview && <div className="data-organization-preview" role="status">将迁移 {migrate ? live.length : 0} 条实盘日志，{reset ? `清空 ${stages.length} 个旧阶段及其风险记录` : '保留现有阶段'}，删除 {weekly.length} 篇周复盘。案例 {trades.filter(t => t.tradeKind === 'case').length} 条全部保留。迁移会解除未具备冻结证据的周复盘直接交易引用。策略、标签预置、随记和截图文件均保留。可通过整理前备份恢复整个资料库。</div>}
        {busy && <p role="status">正在验证备份并保存，请勿关闭软件…</p>}
        {result && <p role="status">{result}</p>}
      </div>
    </ModalShell>}
  </section>
}
