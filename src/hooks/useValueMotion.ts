import { useLayoutEffect, useRef } from 'react'
import { playMotion } from '@/lib/motion'

/** Show the new, exact value immediately. Only a change to an already visible value gets feedback. */
export function useValueMotion<T extends HTMLElement>(value: string) {
  const target = useRef<T>(null)
  const previous = useRef(value)
  useLayoutEffect(() => {
    if (previous.current === value) return
    previous.current = value
    if (!target.current) return
    const animation = playMotion(target.current, [{ opacity: 0.72 }, { opacity: 1 }], '--motion-state', 'atlas-value')
    return () => animation?.cancel()
  }, [value])
  return target
}
