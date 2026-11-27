import { Button } from './ui/Button'
import { InlineStatus } from './ui/InlineStatus'

export function NoteLoadRecovery({ missingImages, onRetry }: { missingImages: boolean; onRetry: () => void }) {
  return (
    <InlineStatus
      compact
      tone={missingImages ? 'warning' : 'error'}
      title={missingImages ? '部分图片未载入，正文暂为只读' : '正文载入失败'}
      action={<Button size="sm" onClick={onRetry}>重新载入</Button>}
    />
  )
}
