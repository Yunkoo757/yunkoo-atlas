import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useBusinessDateAnchor } from '@/hooks/useLocalDateKey'
import {
  loadReviewSession,
  reconcileReviewSession,
  remainingReviewSessionCount,
} from '@/lib/reviewSession'
import { getStorage } from '@/storage/bootstrap'
import { useStore } from '@/store/useStore'

export function useReviewSessionRemaining(): number {
  const [remaining, setRemaining] = useState(0)
  const location = useLocation()
  const trades = useStore((state) => state.trades)
  const starredIds = useStore((state) => state.starredIds)
  const liveStages = useStore((state) => state.liveStages)
  const currentLiveStageId = useStore((state) => state.currentLiveStageId)
  const tradingDayStartHour = useStore((state) => state.display.tradingDayStartHour)
  const businessDateAnchor = useBusinessDateAnchor()

  useEffect(() => {
    let cancelled = false
    void getStorage().getManifest().then((manifest) => {
      const stored = loadReviewSession(manifest.libraryId)
      if (!stored) {
        if (!cancelled) setRemaining(0)
        return
      }
      const restored = reconcileReviewSession(
        stored,
        trades,
        new Set(starredIds),
        businessDateAnchor.currentTradingDayKey,
        tradingDayStartHour,
        { liveStages, currentLiveStageId },
      )
      if (!cancelled) setRemaining(remainingReviewSessionCount(restored))
    }).catch(() => {
      if (!cancelled) setRemaining(0)
    })
    return () => {
      cancelled = true
    }
  }, [
    businessDateAnchor.currentTradingDayKey,
    currentLiveStageId,
    liveStages,
    location.pathname,
    starredIds,
    trades,
    tradingDayStartHour,
  ])

  return remaining
}
