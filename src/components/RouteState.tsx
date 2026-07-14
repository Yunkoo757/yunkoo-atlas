import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  LinearExclamationMarkIcon,
  LinearGridLoaderIcon,
  LinearHomeIcon,
  LinearRefreshIcon,
} from '@/icons/linear'
import { ICON_LG, ICON_XL } from '@/icons/iconSize'
import './RouteState.css'

type RouteErrorBoundaryProps = {
  children: ReactNode
  resetKey: string
}

type RouteErrorBoundaryState = {
  error: Error | null
}

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Route render failed', error, info)
  }

  componentDidUpdate(previousProps: RouteErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <RouteFailure
        error={this.state.error}
        onReturn={() => this.setState({ error: null })}
        onRetry={() => window.location.reload()}
      />
    )
  }
}

function RouteFailure({
  error,
  onReturn,
  onRetry,
}: {
  error: Error
  onReturn: () => void
  onRetry: () => void
}) {
  return (
    <section className="app-route-state app-route-error" role="alert" aria-live="assertive">
      <div className="app-route-state-icon" aria-hidden>
        <LinearExclamationMarkIcon size={ICON_LG} />
      </div>
      <span className="app-route-state-code">页面异常</span>
      <h1>页面暂时无法显示</h1>
      <p>交易数据仍保留在本地。你可以返回交易日志，或重新加载后再试。</p>
      <div className="app-route-state-actions">
        <Link className="ui-btn ui-btn-primary" to="/list" onClick={onReturn}>
          <LinearHomeIcon size={ICON_LG} aria-hidden />
          返回交易日志
        </Link>
        <button className="ui-btn ui-btn-bordered" type="button" onClick={onRetry}>
          <LinearRefreshIcon size={ICON_LG} aria-hidden />
          重新加载
        </button>
      </div>
      <small className="app-route-error-detail">{error.message}</small>
    </section>
  )
}

export function RouteNotFound() {
  const navigate = useNavigate()
  return (
    <section className="app-route-state" aria-labelledby="route-not-found-title">
      <span className="app-route-state-code">404</span>
      <h1 id="route-not-found-title">找不到这个页面</h1>
      <p>地址可能已失效，或者页面已经移动。</p>
      <div className="app-route-state-actions">
        <Link className="ui-btn ui-btn-primary" to="/list">
          <LinearHomeIcon size={ICON_LG} aria-hidden />
          返回交易日志
        </Link>
        <button className="ui-btn ui-btn-bordered" type="button" onClick={() => navigate(-1)}>
          返回上一页
        </button>
      </div>
    </section>
  )
}

export function DelayedRouteFallback({ delayMs = 180 }: { delayMs?: number }) {
  const [visible, setVisible] = useState(delayMs <= 0)

  useEffect(() => {
    if (visible) return
    const timer = window.setTimeout(() => setVisible(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, visible])

  if (!visible) return null

  return (
    <div className="app-route-loading" role="status" aria-live="polite">
      <LinearGridLoaderIcon variant="scope" size={ICON_XL} aria-hidden />
      <span>加载页面…</span>
    </div>
  )
}
