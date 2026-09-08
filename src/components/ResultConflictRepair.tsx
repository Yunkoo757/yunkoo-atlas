import { useState } from 'react'
import type { Trade } from '@/data/trades'
import { Button } from '@/components/ui/Button'
import { ModalShell } from '@/components/ui/ModalShell'
import { captureOrganizationSnapshot, repairLibraryResults } from '@/lib/dataOrganizationService'
import { resolveTradeTruth } from '@/lib/tradeTruth'
import { resultRepairCandidate } from '@/lib/resultConflictRepair'
import { getStorage } from '@/storage'
import { isElectron } from '@/storage/runtime'
import { userFacingErrorMessage } from '@/lib/userFacingError'
import './ResultConflictRepair.css'

const labels = { win: '盈利', loss: '亏损', breakeven: '保本', closed: '已平仓', planned: '计划', open: '持仓', missed: '错过' }
export function ResultConflictRepair({ ids, onOpenTrade }: { ids: readonly string[]; onOpenTrade: (id: string) => void }) {
  const [preview, setPreview] = useState<{ snapshot: string; libraryId: string; rows: Trade[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [feedback, setFeedback] = useState('')
  const show = async () => {
    if (busy) return
    setBusy(true)
    try {
      const manifest = await getStorage().getManifest()
      const snapshot = captureOrganizationSnapshot()
      setPreview({ snapshot: JSON.stringify(snapshot), libraryId: manifest.libraryId, rows: snapshot.trades.filter(t => ids.includes(t.id)) })
      setConfirmed(false); setFeedback('')
    } catch (error) { setFeedback(userFacingErrorMessage(error, '无法读取冲突记录。')) }
    finally { setBusy(false) }
  }
  const eligible = preview?.rows.filter(t => resultRepairCandidate(t)) ?? []
  const execute = async () => {
    if (!preview || busy || !confirmed || !eligible.length) return
    setBusy(true)
    try {
      const backup = await repairLibraryResults(preview.snapshot, eligible.map(t => t.id), preview.libraryId)
      setPreview(null); setFeedback(`已修正 ${eligible.length} 笔。备份：${backup}，可在数据设置中恢复。`)
    } catch (error) { setFeedback(userFacingErrorMessage(error, '修正未完成，请重新预览。')); setConfirmed(false) }
    finally { setBusy(false) }
  }
  if (!isElectron()) return null
  return <div className="result-repair">
    <Button variant="ghost" size="sm" busy={busy} onClick={() => void show()}>查看并修正</Button>
    {feedback && <span role="status">{feedback}</span>}
    {preview && <ModalShell title="核对交易结果" size="wide" busy={busy} onClose={() => { if (!busy) setPreview(null) }} footer={<><Button disabled={busy} onClick={() => setPreview(null)}>关闭</Button>{eligible.length > 0 && <Button variant="bordered" disabled={!confirmed} busy={busy} onClick={() => void execute()}>备份并修正 {eligible.length} 笔</Button>}</>}>
      <div className="result-repair-content">
        <p>{eligible.length ? '按实际 R 修正状态，并清除占位现金 0。已有周复盘冻结快照保持原样。' : '以下记录需要补充或核对实际结果，请打开详情填写。不会自动推算现金盈亏或 R。'}</p>
        <div className="result-repair-table"><table><thead><tr><th>交易</th><th>当前结果</th><th>处理方式</th></tr></thead><tbody>{preview.rows.map(t => {
          const candidate = resultRepairCandidate(t)
          return <tr key={t.id}><td>{t.ref} · {t.symbol}</td><td>{labels[t.status]} · 现金 {t.pnl ?? '未填写'} · {t.rMultiple ?? '—'}R</td><td>{candidate ? `${labels[candidate.status]} · 现金未填写 · ${candidate.rMultiple}R` : <>{resolveTradeTruth(t).hasConflict ? '结果冲突，需核对' : '待补实际结果'}<Button variant="ghost" size="sm" disabled={busy} onClick={() => { setPreview(null); onOpenTrade(t.id) }}>打开详情</Button></>}</td></tr>
        })}</tbody></table></div>
        {eligible.length > 0 && <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />确认以上可修正记录的 R 为实际结果，现金 0 是未填写的占位值。</label>}
        {!preview.rows.length && <p>当前范围没有待处理记录。</p>}
        {eligible.length > 0 && <p>可修正 {eligible.length} 笔，其余 {preview.rows.length - eligible.length} 笔需手动核对。执行前自动创建并校验备份。</p>}
        {feedback && <p role="status">{feedback}</p>}
      </div>
    </ModalShell>}
  </div>
}
