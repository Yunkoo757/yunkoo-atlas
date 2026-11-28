import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import {
  registerShortcutHandlers,
  type ShortcutHandlerMap,
} from '@/shortcuts/engine'

type Item = { id: string }

/** 分组、排序或筛选变化时只跟踪原记录，避免焦点滑到恰好占用原位置的另一条。 */
export function useWorkbenchRowFocus(items: Item[]) {
  const [id, setId] = useState<string | null>(null)
  const focusIndex = useMemo(() => id === null ? -1 : items.findIndex(item => item.id === id), [items, id])
  useEffect(() => {
    if (id !== null && focusIndex < 0) setId(null)
  }, [focusIndex, id])
  const setFocusIndex = useCallback((move: (index: number) => number) => {
    setId(current => {
      const index = current === null ? -1 : items.findIndex(item => item.id === current)
      return items[move(index)]?.id ?? null
    })
  }, [items])
  return { focusedId: focusIndex < 0 ? null : id, focusIndex, setFocusIndex }
}

type Options = {
  items: Item[]
  selectedIds: Set<string>
  setSelectedIds: (next: Set<string>) => void
  /** 启用上下行与打开动作；不传则只处理全选/清空 */
  focusIndex?: number
  setFocusIndex?: (updater: (index: number) => number) => void
  onOpenFocused?: (index: number) => void
  enableNav?: boolean
}

/** 生成当前列表真正可执行的动作；空列表或无选择时不抢占相应按键。 */
export function createWorkbenchListShortcutHandlers({
  items,
  selectedIds,
  setSelectedIds,
  focusIndex = -1,
  setFocusIndex,
  onOpenFocused,
  enableNav = false,
}: Options): ShortcutHandlerMap {
  const handlers: ShortcutHandlerMap = {}

  if (items.length > 0) {
    handlers['list.selectAll'] = () => {
      setSelectedIds(new Set(items.map((item) => item.id)))
    }
  }

  if (selectedIds.size > 0) {
    handlers['list.clearSelection'] = () => {
      setSelectedIds(new Set())
    }
  }

  if (enableNav && setFocusIndex && items.length > 0) {
    const moveFocus = (direction: 1 | -1) => {
      const activeId = typeof document === 'undefined' ? undefined
        : document.activeElement?.closest<HTMLElement>('[data-trade-id]')?.dataset.tradeId
      const activeIndex = activeId ? items.findIndex(item => item.id === activeId) : -1
      setFocusIndex(index => Math.min(Math.max((activeIndex >= 0 ? activeIndex : index) + direction, 0), items.length - 1))
    }
    handlers['list.focusNext'] = () => {
      moveFocus(1)
    }
    handlers['list.focusPrev'] = () => {
      moveFocus(-1)
    }
  }

  if (
    enableNav &&
    focusIndex >= 0 &&
    items[focusIndex] &&
    onOpenFocused
  ) {
    handlers['list.openFocused'] = () => onOpenFocused(focusIndex)
  }

  return handlers
}

/** 工作台列表动作统一接入可配置快捷键引擎。 */
export function useWorkbenchListKeyboard(options: Options) {
  const {
    items,
    selectedIds,
    setSelectedIds,
    focusIndex = -1,
    setFocusIndex,
    onOpenFocused,
    enableNav = false,
  } = options

  // 让批量工具条出现时，当前选择对应的快捷键已注册。
  useLayoutEffect(() => {
    return registerShortcutHandlers(createWorkbenchListShortcutHandlers({
      items,
      selectedIds,
      setSelectedIds,
      focusIndex,
      setFocusIndex,
      onOpenFocused,
      enableNav,
    }))
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
