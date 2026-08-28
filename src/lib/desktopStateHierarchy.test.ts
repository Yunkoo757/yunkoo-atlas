import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(file: string): string {
  return readFileSync(path.resolve(file), 'utf8').replace(/\r\n?/g, '\n')
}

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))
  if (!match) throw new Error(`缺少状态样式：${selector}`)
  return match[1] ?? ''
}

export function testDesktopStatesUseCanonicalTypographyRoles(): void {
  const empty = read('src/components/EmptyState.css')
  const inline = read('src/components/ui/InlineStatus.css')
  const route = read('src/components/RouteState.css')
  const review = read('src/views/ReviewSessionView.css')
  const detail = read('src/views/DetailView.css')

  if (!rule(empty, '.empty-title').includes('font-size: var(--type-section-title-size)')) {
    throw new Error('区块空状态标题必须使用 section title 角色')
  }
  if (!rule(empty, '.empty-hint').includes('font-size: var(--type-body-size)')) {
    throw new Error('首次使用空状态说明必须使用 body 角色')
  }
  if (!rule(empty, '.empty.is-filtered .empty-hint,\n.empty.is-missing .empty-hint,\n.empty.is-complete .empty-hint').includes('font-size: var(--type-row-size)')) {
    throw new Error('筛选、缺失和完成状态说明必须使用紧凑 row 角色')
  }
  if (!rule(inline, '.ui-inline-status-title').includes('font-size: var(--type-data-size)')) {
    throw new Error('行内状态标题必须使用 data 角色')
  }
  if (!rule(route, '.app-route-state h1').includes('font-size: var(--type-page-title-size)')) {
    throw new Error('整页状态标题必须使用 page title 角色')
  }
  if (!rule(route, '.app-route-state p').includes('font-size: var(--type-body-size)')) {
    throw new Error('整页状态说明必须使用 body 角色')
  }
  if (!rule(review, '.review-session-loading').includes('font-size: var(--type-row-size)')) {
    throw new Error('活动复盘加载状态必须使用 row 角色')
  }
  if (!rule(detail, '.dv-note-load').includes('font-size: var(--type-row-size)')) {
    throw new Error('详情笔记加载状态必须使用 row 角色')
  }
  if (!rule(detail, '.dv-note-load.is-error span').includes('font-size: var(--type-metadata-size)')) {
    throw new Error('详情笔记错误说明必须使用 metadata 角色')
  }
}
