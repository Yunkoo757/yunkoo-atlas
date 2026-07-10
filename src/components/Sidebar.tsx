import { NavLink, useLocation } from 'react-router-dom'
import { PenSquare, Search, Settings2, Trash2 } from 'lucide-react'
import { UserAvatar } from '@/components/UserAvatar'
import { Tooltip } from '@/components/ui/Tooltip'
import type { CaseRecord, DisputeType } from '@/data/case'
import { deriveLifecycle, isDeleted } from '@/data/case'
import { PRIMARY_NAV, isSidebarNavActive, type PrimarySidebarNavId } from '@/lib/sidebarNav'
import { tradeInPeriod } from '@/lib/periods'
import { useStore } from '@/store/useStore'
import './Sidebar.css'

function Count({ value }: { value?: number }) {
  if (!value) return null
  return <span className="sb-item-count">{value}</span>
}

export function Sidebar({ onOpenSearch }: { onOpenSearch?: () => void }) {
  const { pathname: path, search } = useLocation()
  const openComposer = useStore((state) => state.openComposer)
  const setCaseModalOpen = useStore((state) => state.setCaseModalOpen)
  const trades = useStore((state) => state.trades)
  const cases = useStore((state) => state.cases)
  const disputeTypes = useStore((state) => state.disputeTypes)
  const profile = useStore((state) => state.profile)

  const activeTrades = trades.filter((trade) => !trade.deletedAt)
  const liveTrades = activeTrades.filter((trade) => trade.tradeKind === 'live')
  const reviewCaseTrades = activeTrades.filter((trade) => trade.tradeKind === 'case')
  const activeCases = cases.filter((item) => !isDeleted(item))
  const inReviewCases = path.startsWith('/review-cases')
  const inCaseLaw = path.startsWith('/cases') || path === '/trash'
  const isSettingsActive = path.startsWith('/settings')

  const counts = {
    today: liveTrades.filter((trade) => tradeInPeriod(trade, 'today')).length,
    trades: liveTrades.length,
    reviewCases: reviewCaseTrades.length,
    cases: activeCases.length,
  }

  const primaryCount = (id: PrimarySidebarNavId) => {
    if (id === 'today') return counts.today
    if (id === 'trades') return counts.trades
    if (id === 'reviewCases') return counts.reviewCases
    if (id === 'cases') return counts.cases
    return undefined
  }

  const createCaseLaw = inCaseLaw
  const createLabel = createCaseLaw
    ? '新建判例'
    : inReviewCases
      ? '新建案例记录'
      : '新建交易'
  const trashTarget = inCaseLaw ? '/trash' : '/trade-trash'

  return (
    <aside className="sidebar">
      <div className="sb-header">
        <NavLink to="/settings/profile" className="sb-ws">
          <UserAvatar className="sb-ws-avatar" />
          <span className="sb-ws-name">{profile.displayName}</span>
        </NavLink>
        <div className="sb-header-actions">
          <Tooltip content="搜索" label="搜索">
            <button
              type="button"
              className="sb-hbtn"
              aria-label="搜索 (Ctrl+K)"
              onClick={onOpenSearch}
            >
              <Search size={16} />
            </button>
          </Tooltip>
          <Tooltip content={createLabel} label={createLabel}>
            <button
              type="button"
              className="sb-hbtn"
              aria-label={createLabel}
              onClick={() => (createCaseLaw ? setCaseModalOpen(true) : openComposer())}
            >
              <PenSquare size={16} />
            </button>
          </Tooltip>
        </div>
      </div>

      <nav className="sb-section sb-primary" aria-label="主要导航">
        <div className="sb-section-label">工作台</div>
        {PRIMARY_NAV.map(({ id, to, label, icon: Icon }) => (
          <NavLink
            key={id}
            to={to}
            className={() => 'sb-item' + (isSidebarNavActive(path, to) ? ' is-active' : '')}
          >
            <Icon size={16} />
            <span>{label}</span>
            <Count value={primaryCount(id)} />
          </NavLink>
        ))}
      </nav>

      {inCaseLaw && (
        <CaseNav cases={cases} disputeTypes={disputeTypes} path={path} search={search} />
      )}

      <div className="sb-spacer" />

      <nav className="sb-section sb-utility" aria-label="辅助导航">
        <NavLink
          to={trashTarget}
          className={() =>
            'sb-item sb-trash' + (path === '/trash' || path === '/trade-trash' ? ' is-active' : '')
          }
        >
          <Trash2 size={16} />
          <span>回收站</span>
          <Count
            value={
              inCaseLaw
                ? cases.filter((item) => isDeleted(item)).length
                : trades.filter((trade) => Boolean(trade.deletedAt)).length
            }
          />
        </NavLink>
        <NavLink
          to="/settings"
          className={() => 'sb-item sb-settings' + (isSettingsActive ? ' is-active' : '')}
        >
          <Settings2 size={16} />
          <span>设置</span>
        </NavLink>
      </nav>
    </aside>
  )
}

function CaseNav({
  cases,
  disputeTypes,
  path,
  search,
}: {
  cases: CaseRecord[]
  disputeTypes: DisputeType[]
  path: string
  search: string
}) {
  const query = new URLSearchParams(search)
  const activeCases = cases.filter((item) => !isDeleted(item))
  const activeView = query.get('disputeType')
    ? `dispute:${query.get('disputeType')}`
    : query.get('lifecycle')
      ? `lifecycle:${query.get('lifecycle')}`
      : query.get('star') === 'true'
        ? 'star'
        : query.get('recheck') === 'true'
          ? 'recheck'
          : 'all'
  const lifecycleCounts = {
    pending: activeCases.filter((item) => deriveLifecycle(item) === '待验证').length,
    decided: activeCases.filter((item) => deriveLifecycle(item) === '已裁决').length,
    discarded: activeCases.filter((item) => deriveLifecycle(item) === '已废弃').length,
  }

  const items = [
    { to: '/cases', label: '全部', active: path === '/cases' && activeView === 'all', count: activeCases.length },
    {
      to: '/cases?lifecycle=待验证',
      label: '待验证',
      active: activeView === 'lifecycle:待验证',
      count: lifecycleCounts.pending,
    },
    {
      to: '/cases?lifecycle=已裁决',
      label: '已裁决',
      active: activeView === 'lifecycle:已裁决',
      count: lifecycleCounts.decided,
    },
    {
      to: '/cases?lifecycle=已废弃',
      label: '已废弃',
      active: activeView === 'lifecycle:已废弃',
      count: lifecycleCounts.discarded,
    },
    {
      to: '/cases?star=true',
      label: '典型案例',
      active: activeView === 'star',
      count: activeCases.filter((item) => item.star).length,
    },
    {
      to: '/cases?recheck=true',
      label: '需要复看',
      active: activeView === 'recheck',
      count: activeCases.filter((item) => item.recheck).length,
    },
  ]

  return (
    <nav className="sb-section sb-context" aria-label="判例视图">
      <div className="sb-section-label">判例视图</div>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={() => 'sb-item sb-subitem' + (item.active ? ' is-current' : '')}
        >
          <span>{item.label}</span>
          <Count value={item.count} />
        </NavLink>
      ))}
      {disputeTypes.slice(0, 4).map((disputeType) => {
        const count = activeCases.filter((item) => item.disputeTypeId === disputeType.id).length
        if (count === 0) return null
        const to = `/cases?disputeType=${disputeType.id}`
        return (
          <NavLink
            key={disputeType.id}
            to={to}
            className={() =>
              'sb-item sb-subitem' +
              (activeView === `dispute:${disputeType.id}` ? ' is-current' : '')
            }
          >
            <span>{disputeType.name}</span>
            <Count value={count} />
          </NavLink>
        )
      })}
    </nav>
  )
}
