import { useEffect, useState } from 'react'
import {
  getTradingDayKey,
  msUntilNextTradingDayBoundary,
  DEFAULT_TRADING_DAY_START_HOUR,
} from '@/lib/periods'
import { useStore } from '@/store/useStore'

/** 当前交易日 YYYY-MM-DD；在交易日边界到达后自动刷新。 */
export function useLocalDateKey(): string {
  const tradingDayStartHour = useStore(
    (state) => state.display.tradingDayStartHour ?? DEFAULT_TRADING_DAY_START_HOUR,
  )
  const [dateKey, setDateKey] = useState(() =>
    getTradingDayKey(new Date(), tradingDayStartHour),
  )

  useEffect(() => {
    let timer: number | null = null

    const scheduleNextBoundary = () => {
      if (timer != null) window.clearTimeout(timer)
      const now = new Date()
      timer = window.setTimeout(
        refresh,
        msUntilNextTradingDayBoundary(now, tradingDayStartHour),
      )
    }
    const refresh = () => {
      setDateKey(getTradingDayKey(new Date(), tradingDayStartHour))
      scheduleNextBoundary()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    refresh()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      if (timer != null) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [tradingDayStartHour])

  return dateKey
}
