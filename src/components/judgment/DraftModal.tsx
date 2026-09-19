import { useState, type ComponentProps } from 'react'
import { ModalShell } from '@/components/ui/ModalShell'
import { Button } from '@/components/ui/Button'

/** Only protects explicitly saved editors; successful saves call the original onClose. */
export function DraftModal({ dirty, onClose, footer, ...props }: ComponentProps<typeof ModalShell> & { dirty: boolean }) {
  const [confirm, setConfirm] = useState(false)
  const requestClose = () => dirty ? setConfirm(true) : onClose()
  return <>
    <ModalShell {...props} onClose={requestClose} footer={<><Button onClick={requestClose}>取消</Button>{footer}</>} />
    {confirm && <ModalShell title="放弃未保存的修改？" size="compact" onClose={() => setConfirm(false)} footer={<>
      <Button onClick={() => setConfirm(false)}>继续编辑</Button>
      <Button variant="danger-solid" onClick={onClose}>放弃修改</Button>
    </>} />}
  </>
}
