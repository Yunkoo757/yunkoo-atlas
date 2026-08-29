import { getActionMeta } from '@/shortcuts/actions'
import { bindingKey } from '@/shortcuts/chords'
import {
  handleShortcutKeydown,
  registerShortcutHandlers,
  setShortcutHandlers,
} from '@/shortcuts/engine'
import { useShortcutStore } from '@/store/shortcutStore'
import * as reviewSessionView from '@/views/ReviewSessionView'
import type { ReviewSessionAssessment } from '@/lib/reviewSession'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

function keyboardEvent(
  key: string,
  overrides: Partial<KeyboardEvent> = {},
): KeyboardEvent & { prevented: number } {
  const event = {
    key,
    keyCode: 0,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: null,
    prevented: 0,
    preventDefault() {
      this.prevented += 1
    },
    ...overrides,
  }
  return event as unknown as KeyboardEvent & { prevented: number }
}

export function testReviewSessionRejectsHandledRepeatAndCompositionEvents(): void {
  const previousBindings = useShortcutStore.getState().bindings
  useShortcutStore.setState({ bindings: {} })
  setShortcutHandlers({})
  let calls = 0
  const unregister = registerShortcutHandlers({
    'reviewSession.skip': () => { calls += 1 },
  })

  try {
    const rejected = [
      keyboardEvent('n', { defaultPrevented: true }),
      keyboardEvent('n', { repeat: true }),
      keyboardEvent('n', { isComposing: true }),
      keyboardEvent('n', { keyCode: 229 }),
    ]
    for (const event of rejected) {
      assert(
        !handleShortcutKeydown(event, '/review-session'),
        '已处理、重复或输入法组合事件不得执行随机复盘动作',
      )
      assert(event.prevented === 0, '被拒绝的事件不得再次调用 preventDefault')
    }
    assert(calls === 0, '被拒绝的事件不得推进随机复盘会话')
  } finally {
    unregister()
    setShortcutHandlers({})
    useShortcutStore.setState({ bindings: previousBindings })
  }
}

export function testReviewSessionActionsExposeStableDefaultsAndScope(): void {
  const expected = new Map([
    ['reviewSession.unfamiliar', '1'],
    ['reviewSession.recheck', '2'],
    ['reviewSession.mastered', '3'],
    ['reviewSession.skip', 'n'],
    ['reviewSession.back', 'p'],
    ['reviewSession.exit', 'escape'],
  ])

  for (const [id, defaultBinding] of expected) {
    const action = getActionMeta(id)
    assert(Boolean(action), `${id} 应注册为可配置动作`)
    assert(action!.scope === 'reviewSession', `${id} 应隔离在随机复盘作用域`)
    assert(
      bindingKey(action!.defaultBinding) === defaultBinding,
      `${id} 应保持默认快捷键 ${defaultBinding.toUpperCase()}`,
    )
  }
}

export function testReviewSessionScopeOnlyRunsOnReviewSessionRoute(): void {
  const previousBindings = useShortcutStore.getState().bindings
  useShortcutStore.setState({ bindings: {} })
  setShortcutHandlers({})
  let calls = 0
  const unregister = registerShortcutHandlers({
    'reviewSession.skip': () => { calls += 1 },
  })

  try {
    const elsewhere = keyboardEvent('n')
    assert(!handleShortcutKeydown(elsewhere, '/list'), '随机复盘动作不得在其他页面激活')
    assert(calls === 0, '其他页面不得执行随机复盘动作')

    const reviewSession = keyboardEvent('n')
    assert(handleShortcutKeydown(reviewSession, '/review-session'), '随机复盘页面应激活动作')
    assert(reviewSession.prevented === 1, '已处理的随机复盘动作应阻止默认行为')
    assert(calls === 1, '随机复盘动作应执行一次')
  } finally {
    unregister()
    setShortcutHandlers({})
    useShortcutStore.setState({ bindings: previousBindings })
  }
}

export function testReviewSessionCustomBindingOverridesDefaultWithoutMigration(): void {
  const previousBindings = useShortcutStore.getState().bindings
  useShortcutStore.setState({
    bindings: { 'reviewSession.skip': { key: 'x' } },
  })
  setShortcutHandlers({})
  let calls = 0
  const unregister = registerShortcutHandlers({
    'reviewSession.skip': () => { calls += 1 },
  })

  try {
    assert(
      handleShortcutKeydown(keyboardEvent('x'), '/review-session'),
      '随机复盘应执行用户自定义绑定',
    )
    assert(
      !handleShortcutKeydown(keyboardEvent('n'), '/review-session'),
      '用户改绑后不得继续执行默认键',
    )
    assert(calls === 1, '自定义绑定只能触发一次动作')
  } finally {
    unregister()
    setShortcutHandlers({})
    useShortcutStore.setState({ bindings: previousBindings })
  }
}

export function testAccountTradeMasteryHandlersNoOpWhileSkipAndBackRemainAvailable(): void {
  const createHandlers = (reviewSessionView as unknown as {
    createReviewSessionShortcutHandlers?: (input: {
      current: { tradeKind: 'live' | 'paper' | 'missed' | 'case' }
      onAssess: (assessment: ReviewSessionAssessment) => void
      onSkip: () => void
      onBack: () => void
    }) => Record<string, (() => void) | undefined>
  }).createReviewSessionShortcutHandlers
  assert(typeof createHandlers === 'function', '随机复盘视图应通过统一引擎创建局部 handlers')

  const assessments: ReviewSessionAssessment[] = []
  let skips = 0
  let backs = 0
  const handlers = createHandlers!({
    current: { tradeKind: 'live' },
    onAssess: (assessment) => { assessments.push(assessment) },
    onSkip: () => { skips += 1 },
    onBack: () => { backs += 1 },
  })

  handlers['reviewSession.unfamiliar']?.()
  handlers['reviewSession.recheck']?.()
  handlers['reviewSession.mastered']?.()
  handlers['reviewSession.skip']?.()
  handlers['reviewSession.back']?.()

  assert(assessments.length === 0, '账户交易的三档掌握度快捷键必须 no-op')
  assert(skips === 1, '账户交易仍应支持跳到下一条')
  assert(backs === 1, '账户交易仍应支持返回上一条')
}

export function testLightboxExclusivelyOwnsShortcutScopeOverReviewSession(): void {
  const previousLightbox = useShortcutStore.getState().lightbox
  const previousBindings = useShortcutStore.getState().bindings
  let imageMoves = 0
  let assessments = 0
  let skips = 0
  let backs = 0
  useShortcutStore.setState({
    bindings: {},
    lightbox: { images: ['first', 'second'], index: 0 },
  })
  setShortcutHandlers({ 'image.next': () => { imageMoves += 1 } })
  const unregister = registerShortcutHandlers(reviewSessionView.createReviewSessionShortcutHandlers({
    current: { tradeKind: 'case' },
    onAssess: () => { assessments += 1 },
    onSkip: () => { skips += 1 },
    onBack: () => { backs += 1 },
  }))

  try {
    for (const key of ['1', '2', '3', 'n', 'p']) {
      const event = keyboardEvent(key)
      assert(!handleShortcutKeydown(event, '/review-session'), `灯箱打开时 ${key} 不得落入背景随机复盘 scope`)
      assert(event.prevented === 0, `灯箱未绑定的 ${key} 不得被背景动作消费`)
    }
    assert(assessments === 0 && skips === 0 && backs === 0, '灯箱期间不得写评估或移动复盘游标')
    assert(handleShortcutKeydown(keyboardEvent('s'), '/review-session'), '灯箱自身下一张快捷键必须继续工作')
    assert(imageMoves === 1, '灯箱自身 handler 必须执行一次')
  } finally {
    unregister()
    setShortcutHandlers({})
    useShortcutStore.setState({ lightbox: previousLightbox, bindings: previousBindings })
  }
}
