import { useRef } from 'react'
import { useTradeReturnAnchor } from './useTradeReturnAnchor'

const prefix = 'result-repair:'

export function resultRepairAnchor(id: string): string {
  return prefix + id
}

export function useResultRepairReturn() {
  const entry = useRef<{ reopen: (id?: string) => void }>(null)
  useTradeReturnAnchor({
    onRestoreStart(anchor) {
      if (anchor.startsWith(prefix)) entry.current?.reopen(anchor.slice(prefix.length))
    },
  })
  return entry
}
