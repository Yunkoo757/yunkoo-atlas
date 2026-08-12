import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from '@/icons/appIcons'
import './CrumbsNav.css'

type Crumb = { label: string; active?: boolean }

type CrumbsNavProps = {
  backLabel: string
  crumbs: Crumb[]
  context?: ReactNode
  actions?: ReactNode
  /** 按钮返回；与 to 二选一 */
  onBack?: () => void
  to?: string
  linkState?: unknown
}

/** 详情 / 回收站共用：Chevron + 面包屑（回收站为独立页，不挂在交易日志下） */
export function CrumbsNav({
  backLabel,
  crumbs,
  context,
  actions,
  onBack,
  to,
  linkState,
}: CrumbsNavProps) {
  const backClass = 'crumbs-back'
  const back = to ? (
    <Link to={to} state={linkState} className={backClass} aria-label={backLabel}>
      <ChevronLeft size={ICON_MD} />
    </Link>
  ) : (
    <button type="button" className={backClass} aria-label={backLabel} onClick={onBack}>
      <ChevronLeft size={ICON_MD} />
    </button>
  )

  return (
    <header className="crumbs-nav">
      <div className="crumbs-nav-left">
        {back}
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.label}-${index}`} className="crumbs-nav-item">
            {index > 0 ? (
              <ChevronRight size={ICON_SM} className="crumbs-sep" aria-hidden="true" />
            ) : null}
            {crumb.active ? (
              <h1 className="crumbs-label is-active">{crumb.label}</h1>
            ) : (
              <span className="crumbs-label">{crumb.label}</span>
            )}
          </span>
        ))}
        {context ? (
          <>
            <span className="crumbs-divider" aria-hidden="true" />
            <span className="crumbs-context">{context}</span>
          </>
        ) : null}
      </div>
      {actions ? <div className="crumbs-nav-right">{actions}</div> : null}
    </header>
  )
}
