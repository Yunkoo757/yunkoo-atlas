import { useLocation, useNavigate } from 'react-router-dom'
import './TradeLogNavigation.css'

export type TradeLogSection = 'records' | 'stats' | 'reviews'

export function parseTradeLogSection(search: string): TradeLogSection {
  const section = new URLSearchParams(search).get('section')
  return section === 'stats' || section === 'reviews' ? section : 'records'
}

export function TradeLogNavigation({ section }: { section: TradeLogSection }) {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const params = new URLSearchParams(search)
  const recordScope = params.get('scope') === 'history'
    ? 'history'
    : params.get('source') === 'paper'
      ? 'paper'
      : params.get('filter') ?? 'current'

  const apply = (mutate: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(search)
    mutate(next)
    const query = next.toString()
    navigate({ pathname: pathname === '/board' ? '/board' : '/list', search: query ? `?${query}` : '' })
  }

  const selectSection = (nextSection: TradeLogSection) => apply((next) => {
    if (nextSection === 'records') next.delete('section')
    else next.set('section', nextSection)
  })
  const selectScope = (scope: string) => apply((next) => {
    next.delete('section')
    next.delete('scope')
    next.delete('source')
    next.delete('filter')
    next.delete('liveStage')
    if (scope === 'history') next.set('scope', 'history')
    else if (scope === 'paper') next.set('source', 'paper')
    else if (scope !== 'current') next.set('filter', scope)
  })

  return (
    <div className="trade-log-navigation">
      <div className="trade-log-sections" role="tablist" aria-label="交易日志栏目">
        {([
          ['records', '记录'],
          ['stats', '统计'],
          ['reviews', '周期复盘'],
        ] as const).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={section === value} className={section === value ? 'is-active' : ''} onClick={() => selectSection(value)}>{label}</button>
        ))}
      </div>
      {section === 'records' ? (
        <div className="trade-log-scopes" aria-label="记录范围">
          {([
            ['current', '当前实盘'],
            ['history', '历史阶段'],
            ['paper', '模拟盘'],
            ['active', '进行中'],
            ['starred', '星标'],
            ['missed', '错过机会'],
            ['incomplete', '待完善'],
          ] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={recordScope === value} className={recordScope === value ? 'is-active' : ''} onClick={() => selectScope(value)}>{label}</button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
