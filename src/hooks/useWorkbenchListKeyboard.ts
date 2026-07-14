import { useEffect } from 'react'
import {
  registerShortcutHandlers,
  type ShortcutHandlerMap,
} from '@/shortcuts/engine'

type Item = { id: string }

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
    handlers['list.focusNext'] = () => {
      setFocusIndex((index) => Math.min(Math.max(index, -1) + 1, items.length - 1))
    }
    handlers['list.focusPrev'] = () => {
      setFocusIndex((index) => Math.max(index - 1, 0))
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

  useEffect(() => {
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
