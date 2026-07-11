import { linearStaticIcons, type LinearIconName } from './generated'
import type { LinearStaticIconProps } from './types'

export interface LinearIconProps extends LinearStaticIconProps {
  name: LinearIconName
}

export function LinearIcon({ name, ...props }: LinearIconProps) {
  const Component = linearStaticIcons[name]
  if (!Component) {
    if (import.meta.env.DEV) console.error(`Unknown Linear icon: ${name}`)
    return null
  }
  return <Component {...props} />
}
