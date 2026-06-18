/** 从 pathname 推导列表根路径（不含 /board） */
export function listPathFromPathname(pathname: string): string | null {
  if (pathname.startsWith('/trade/')) return null
  if (pathname.startsWith('/settings')) return null
  if (pathname === '/dashboard') return null
  if (pathname.endsWith('/board')) {
    const base = pathname.slice(0, -'/board'.length)
    if (base === '' || base === '/board') return '/list'
    return base
  }
  return pathname
}

export function boardPathFromListPath(listPath: string): string {
  return listPath === '/list' ? '/board' : `${listPath}/board`
}

export function isDetailPath(pathname: string): boolean {
  return pathname.startsWith('/trade/')
}

export function isBoardPath(pathname: string): boolean {
  return pathname === '/board' || pathname.endsWith('/board')
}
