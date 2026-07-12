import { useEffect } from 'react'

type Item = { id: string }

type Options = {
  items: Item[]
  selectedIds: Set<string>
  setSelectedIds: (next: Set<string>) => void
  /** j/k/Enter 行导航；不传则只处理全选/清空 */
  focusIndex?: number
  setFocusIndex?: (updater: (index: number) => number) => void
  onOpenFocused?: (index: number) => void
  enableNav?: boolean
}

function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

/** 工作台列表共用：Ctrl/Cmd+A 全选、Esc 清空；可选 j/k/Enter 导航 */
export function useWorkbenchListKeyboard({
  items,
  selectedIds,
  setSelectedIds,
  focusIndex = -1,
  setFocusIndex,
  onOpenFocused,
  enableNav = false,
}: Options) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return

      if ((event.ctrlKey || event.metaKey) && event.key === 'a' && items.length > 0) {
        event.preventDefault()
        setSelectedIds(new Set(items.map((item) => item.id)))
        return
      }

      if (event.key === 'Escape' && selectedIds.size > 0) {
        event.preventDefault()
        setSelectedIds(new Set())
        return
      }

      if (!enableNav || !setFocusIndex || items.length === 0) return

      if (event.key === 'j') {
        event.preventDefault()
        setFocusIndex((index) => Math.min(Math.max(index, -1) + 1, items.length - 1))
      } else if (event.key === 'k') {
        event.preventDefault()
        setFocusIndex((index) => Math.max(index - 1, 0))
      } else if (event.key === 'Enter' && focusIndex >= 0 && items[focusIndex] && onOpenFocused) {
        event.preventDefault()
        onOpenFocused(focusIndex)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [
    items,
    selectedIds.size,
    setSelectedIds,
    focusIndex,
    setFocusIndex,
    onOpenFocused,
    enableNav,
  ])
}
