import { useEffect, useState } from 'react'
import { toLocalDateKey } from '@/lib/tradeWorkflow'

/** 保持长时间打开的页面在本地午夜后自动切换到新的一天。 */
export function useLocalDateKey(): string {
  const [dateKey, setDateKey] = useState(() => toLocalDateKey())

  useEffect(() => {
    let timer: number | null = null

    const scheduleNextDay = () => {
      if (timer != null) window.clearTimeout(timer)
      const now = new Date()
      const nextDay = new Date(now)
      nextDay.setHours(24, 0, 0, 25)
      timer = window.setTimeout(refresh, Math.max(1_000, nextDay.getTime() - now.getTime()))
    }
    const refresh = () => {
      setDateKey(toLocalDateKey())
      scheduleNextDay()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    scheduleNextDay()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      if (timer != null) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return dateKey
}
