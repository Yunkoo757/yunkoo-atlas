import { useShortcutStore } from '@/store/shortcutStore'
import {
  handleShortcutKeydown,
  registerShortcutHandlers,
  setShortcutHandlers,
} from '@/shortcuts/engine'
import { createWorkbenchListShortcutHandlers } from '@/hooks/useWorkbenchListKeyboard'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function keyboardEvent(
  key: string,
  options: { ctrlKey?: boolean; target?: EventTarget | null } = {},
): KeyboardEvent & { prevented: number } {
  const event = {
    key,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: options.target ?? null,
    prevented: 0,
    preventDefault() {
      this.prevented += 1
    },
  }
  return event as unknown as KeyboardEvent & { prevented: number }
}

export function testConfiguredListBindingRunsRegisteredHandlerExactlyOnce(): void {
  const previousBindings = useShortcutStore.getState().bindings
  useShortcutStore.setState({
    bindings: {
      'list.focusNext': { key: 'x' },
    },
  })
  setShortcutHandlers({})

  let calls = 0
  const unregister = registerShortcutHandlers({
    'list.focusNext': () => {
      calls += 1
    },
  })

  try {
    const configured = keyboardEvent('x')
    assert(handleShortcutKeydown(configured, '/list'), '自定义列表绑定应由统一引擎处理')
    assert(configured.prevented === 1, '已处理的列表快捷键应阻止浏览器默认行为')
    assert(calls === 1, '一次按键只能触发一次列表动作')

    const oldDefault = keyboardEvent('q')
    assert(!handleShortcutKeydown(oldDefault, '/list'), '改绑后旧默认键不得继续触发')
    assert(calls === 1, '旧默认键不得造成隐藏的第二次动作')

    const removedAlias = keyboardEvent('j')
    assert(!handleShortcutKeydown(removedAlias, '/list'), '未展示在设置中的 J/K 别名不得继续生效')
    assert(calls === 1, '隐藏别名不得触发列表动作')

    const input = { tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget
    const whileTyping = keyboardEvent('x', { target: input })
    assert(!handleShortcutKeydown(whileTyping, '/list'), '输入框聚焦时不得抢占列表快捷键')
    assert(calls === 1, '输入期间不得执行列表动作')
  } finally {
    unregister()
    setShortcutHandlers({})
    useShortcutStore.setState({ bindings: previousBindings })
  }
}

export function testWorkbenchListActionsCoverFocusOpenAndSelection(): void {
  const items = [{ id: 'a' }, { id: 'b' }]
  let focusIndex = -1
  let selectedIds = new Set<string>(['a'])
  let openedIndex = -1

  const handlers = createWorkbenchListShortcutHandlers({
    items,
    selectedIds,
    setSelectedIds: (next) => {
      selectedIds = next
    },
    focusIndex: 1,
    setFocusIndex: (update) => {
      focusIndex = update(focusIndex)
    },
    onOpenFocused: (index) => {
      openedIndex = index
    },
    enableNav: true,
  })

  handlers['list.focusNext']?.()
  assert(focusIndex === 0, '下一行应从未聚焦状态进入第一行')
  handlers['list.focusNext']?.()
  assert(focusIndex === 1, '下一行应按可见顺序移动焦点')
  handlers['list.focusPrev']?.()
  assert(focusIndex === 0, '上一行应向前移动焦点')

  handlers['list.openFocused']?.()
  assert(openedIndex === 1, '打开动作应打开当前聚焦行')
  handlers['list.selectAll']?.()
  assert(selectedIds.size === 2 && selectedIds.has('a') && selectedIds.has('b'), '全选应覆盖当前可见记录')
  handlers['list.clearSelection']?.()
  assert(selectedIds.size === 0, '清空选择应移除所有已选记录')

  const empty = createWorkbenchListShortcutHandlers({
    items: [],
    selectedIds: new Set(),
    setSelectedIds: () => {},
    enableNav: true,
    setFocusIndex: () => {},
  })
  assert(Object.keys(empty).length === 0, '无可操作内容时不应吞掉列表快捷键')
}
