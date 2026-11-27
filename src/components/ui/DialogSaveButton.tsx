import { Button, type ButtonProps } from './Button'
import { Kbd } from './Kbd'
import { Tooltip } from './Tooltip'
import { formatChordKey } from '@/shortcuts/format'

/** Only an explicitly marked save action can be invoked from a dialog field. */
export function DialogSaveButton({ children, ...props }: Omit<ButtonProps, 'children' | 'variant' | 'size'> & { children: string }) {
  return (
    <Tooltip asChild label={children} content={<Kbd>{formatChordKey('mod+enter')}</Kbd>}>
      <Button {...props} variant="primary" size="lg" data-dialog-save aria-keyshortcuts="Meta+Enter Control+Enter">
        {children}
      </Button>
    </Tooltip>
  )
}
