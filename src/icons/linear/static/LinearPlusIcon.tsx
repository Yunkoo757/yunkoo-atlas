import { StaticLinearSvg } from '../StaticLinearSvg'
import type { LinearStaticIconProps } from '../types'

const body = '<path d="M8 4v8M4 8h8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>'

export function LinearPlusIcon(props: LinearStaticIconProps) {
  return <StaticLinearSvg {...props} body={body} viewBox="0 0 16 16" />
}
