const LEGACY_TABLE_SUFFIX = '/table'

/** 旧版表格视图链接单向迁移到对应列表；不再把 table 视为工作台模式。 */
export function listPathFromLegacyTablePath(pathname: string): string | null {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (clean === LEGACY_TABLE_SUFFIX) return '/list'
  if (!clean.endsWith(LEGACY_TABLE_SUFFIX)) return null
  return clean.slice(0, -LEGACY_TABLE_SUFFIX.length) || '/list'
}

/** 从 pathname 推导列表根路径（不含 /board） */
export function listPathFromPathname(pathname: string): string | null {
  if (pathname.startsWith('/trade/')) return null
  if (pathname.startsWith('/settings')) return null
  if (pathname === '/dashboard') return null
  const legacyListPath = listPathFromLegacyTablePath(pathname)
  if (legacyListPath) return legacyListPath
  if (pathname.endsWith('/board')) {
    const base = pathname.slice(0, -'/board'.length)
    if (base === '' || base === '/board') return '/list'
    return base
  }
  return pathname
}

export type WorkbenchMode = 'list' | 'board'

export function boardPathFromListPath(listPath: string): string {
  return listPath === '/list' ? '/board' : `${listPath}/board`
}

export function workbenchModeFromPathname(pathname: string): WorkbenchMode {
  if (isBoardPath(pathname)) return 'board'
  return 'list'
}

/** 在列表根路径上套用当前工作台形态（列表 / 看板） */
export function pathWithWorkbenchMode(listPath: string, mode: WorkbenchMode): string {
  if (mode === 'board') return boardPathFromListPath(listPath)
  return listPath
}

export function isDetailPath(pathname: string): boolean {
  return pathname.startsWith('/trade/')
}

export function isBoardPath(pathname: string): boolean {
  return pathname === '/board' || pathname.endsWith('/board')
}
