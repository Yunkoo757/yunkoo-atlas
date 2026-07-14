import { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AppFrame } from './ui/AppFrame'
import { DelayedRouteFallback, RouteErrorBoundary, RouteNotFound } from './RouteState'

declare global {
  interface Window {
    __routeStateTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function waitForFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitForText(text: string): Promise<HTMLElement> {
  const deadline = performance.now() + 1000
  while (performance.now() < deadline) {
    const match = [...document.querySelectorAll<HTMLElement>('body *')]
      .find((element) => element.textContent?.trim() === text)
    if (match) return match
    await waitForFrame()
  }
  throw new Error(`未找到文本：${text}`)
}

function BrokenPage(): never {
  throw new Error('route render failed')
}

function ErrorBoundaryFixture() {
  const location = useLocation()
  return (
    <AppFrame sidebar={<nav>工作区导航</nav>} mobileNavigation={null}>
      <RouteErrorBoundary resetKey={location.pathname}>
        <Routes>
          <Route path="/broken" element={<BrokenPage />} />
          <Route path="/list" element={<div>交易日志已恢复</div>} />
        </Routes>
      </RouteErrorBoundary>
    </AppFrame>
  )
}

const NeverResolves = lazy(() => new Promise<never>(() => {}))

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  assert(rootElement, '缺少测试挂载节点')
  const root = createRoot(rootElement)

  const originalConsoleError = console.error
  console.error = () => {}
  try {
    root.render(
      <MemoryRouter initialEntries={['/broken']}>
        <ErrorBoundaryFixture />
      </MemoryRouter>,
    )

    await waitForText('页面暂时无法显示')
    assert(document.body.textContent?.includes('工作区导航'), '路由异常不应卸载应用导航')
    const backLink = document.querySelector<HTMLAnchorElement>('a[href="/list"]')
    assert(backLink, '异常页应提供返回交易日志动作')
    assert(backLink.textContent?.includes('返回交易日志'), '返回动作应使用明确文案')
    backLink.click()
    await waitForText('交易日志已恢复')
  } finally {
    console.error = originalConsoleError
  }

  root.render(
    <MemoryRouter key="not-found" initialEntries={['/unknown-path']}>
      <Routes>
        <Route path="/list" element={<div>交易日志已恢复</div>} />
        <Route path="*" element={<RouteNotFound />} />
      </Routes>
    </MemoryRouter>,
  )
  await waitForText('找不到这个页面')
  assert(document.body.textContent?.includes('404'), '未知路由应明确说明 404')
  const notFoundLink = document.querySelector<HTMLAnchorElement>('a[href="/list"]')
  assert(notFoundLink, '404 页面应提供返回交易日志动作')
  notFoundLink.click()
  await waitForText('交易日志已恢复')

  root.render(
    <Suspense fallback={<DelayedRouteFallback delayMs={60} />}>
      <NeverResolves />
    </Suspense>,
  )
  await waitForFrame()
  assert(!document.querySelector('[role="status"]'), '短暂加载不应立即闪出占位')
  await new Promise((resolve) => window.setTimeout(resolve, 90))
  assert(document.querySelector('[role="status"]'), '持续加载后应显示页面加载反馈')

  root.unmount()
}

window.__routeStateTest = run()
