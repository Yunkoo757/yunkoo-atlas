import { useMemo, useState } from 'react'
import { useStore } from '@/store/useStore'
import { prepareAutomaticStageOwnership } from '@/lib/stageOwnershipRepair'
import { captureOrganizationSnapshot, repairLibraryStageOwnership } from '@/lib/dataOrganizationService'
import { getStorage } from '@/storage'
import { isElectron } from '@/storage/runtime'
import { userFacingErrorMessage } from '@/lib/userFacingError'
import { Button } from '@/components/ui/Button'
import './StageOwnershipAutoRepair.css'

export function StageOwnershipAutoRepair() {
  const state = useStore()
  const count = useMemo(() => prepareAutomaticStageOwnership(state).count, [state])
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const repair = async () => {
    if (busy) return
    setBusy(true)
    try {
      const manifest = await getStorage().getManifest()
      const expected = JSON.stringify(captureOrganizationSnapshot())
      await repairLibraryStageOwnership(expected, manifest.libraryId)
      setFeedback('已修复明确归属的记录，操作前备份已保留。')
    } catch (error) { setFeedback(userFacingErrorMessage(error, '自动修复未完成，请重试。')) }
    finally { setBusy(false) }
  }
  if (!isElectron() || (!count && !feedback)) return null
  return <div className="stage-ownership-auto">
    {count > 0 && <><Button variant="bordered" busy={busy} onClick={() => void repair()}>一键修复 {count} 项</Button><span>自动备份后，按明确日期与现有阶段修复；不修改阶段边界。</span></>}
    {feedback && <span role="status">{feedback}</span>}
  </div>
}
