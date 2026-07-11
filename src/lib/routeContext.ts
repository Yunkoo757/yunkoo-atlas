/** 从 pathname 推导列表根路径（不含 /board） */
export function listPathFromPathname(pathname: string): string | null {
  if (pathname.startsWith('/trade/')) return null
  if (pathname.startsWith('/settings')) return null
  if (pathname === '/dashboard') return null
  if (pathname.endsWith('/board') || pathname.endsWith('/table')) {
    const suffix = pathname.endsWith('/board') ? '/board' : '/table'
    const base = pathname.slice(0, -suffix.length)
    if (base === '' || base === '/board' || base === '/table') return '/list'
    return base
  }
  return pathname
}

export type WorkbenchMode = 'list' | 'board' | 'table'

export function boardPathFromListPath(listPath: string): string {
  return listPath === '/list' ? '/board' : `${listPath}/board`
}

export function tablePathFromListPath(listPath: string): string {
  return listPath === '/list' ? '/table' : `${listPath}/table`
}

export function workbenchModeFromPathname(pathname: string): WorkbenchMode {
  if (isBoardPath(pathname)) return 'board'
  if (isTablePath(pathname)) return 'table'
  return 'list'
}

/** 在列表根路径上套用当前工作台形态（列表 / 看板 / 表格） */
export function pathWithWorkbenchMode(listPath: string, mode: WorkbenchMode): string {
  if (mode === 'board') return boardPathFromListPath(listPath)
  if (mode === 'table') return tablePathFromListPath(listPath)
  return listPath
}

export function isDetailPath(pathname: string): boolean {
  return pathname.startsWith('/trade/')
}

export function isBoardPath(pathname: string): boolean {
  return pathname === '/board' || pathname.endsWith('/board')
}

export function isTablePath(pathname: string): boolean {
  return pathname === '/table' || pathname.endsWith('/table')
}
