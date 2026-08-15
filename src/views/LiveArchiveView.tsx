import { useEffect } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { ReviewCaseScope } from '@/lib/tradeFilters'
import { TradesPage } from '@/views/TradesPage'

const REVIEW_CASE_SCOPES: ReviewCaseScope[] = [
  'all',
  'focus',
  'mistakes',
  'unreviewed',
  'reviewed',
]

export function LiveArchiveView() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const showsCases = searchParams.get('view') === 'cases'
  const requestedScope = searchParams.get('caseScope') as ReviewCaseScope | null
  const reviewCaseScope = requestedScope && REVIEW_CASE_SCOPES.includes(requestedScope)
    ? requestedScope
    : 'all'

  useEffect(() => {
    if (!location.pathname.startsWith('/live-archive')) return
    const requestedKey = location.pathname.split('/')[2]
    if (!requestedKey) return
    const next = new URLSearchParams(location.search)
    next.set('archiveReason', 'missing')
    next.set('requestedKey', requestedKey)
    navigate({ pathname: '/live-history', search: next.toString() }, { replace: true })
  }, [location.pathname, location.search, navigate])

  const requestedKey = searchParams.get('requestedKey')
  const routeNotice = searchParams.get('archiveReason') === 'missing' && requestedKey
    ? `原历史范围“${requestedKey}”已合并到历史实盘。`
    : null

  return (
    <TradesPage
      title="历史实盘"
      listPath="/live-history"
      filter={showsCases
        ? {
            type: 'all',
            tradeKind: 'case',
            reviewCaseScope,
            historicalLiveScope: 'cases',
          }
        : {
            type: 'all',
            tradeKind: 'live',
            historicalLiveScope: 'trades',
          }}
      header={routeNotice ? (
        <div className="list-context-notice" role="status" aria-live="polite">
          {routeNotice}
        </div>
      ) : undefined}
    />
  )
}
