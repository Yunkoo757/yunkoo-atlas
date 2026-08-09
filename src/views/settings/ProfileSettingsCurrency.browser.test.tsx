import { createRoot } from 'react-dom/client'
import type { Trade } from '@/data/trades'
import { useStore } from '@/store/useStore'
import { ProfileSettingsPanel } from '@/views/settings/ProfileSettingsPanel'

declare global {
  interface Window {
    __profileSettingsCurrencyTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function trade(id: string, cashCurrency: string | null | undefined, ownsCurrency = true): Trade {
  const value: Trade = {
    id,
    ref: `TRD-${id}`,
    symbol: 'BTCUSDT',
    side: 'long',
    status: 'win',
    conviction: 'medium',
    strategyId: 'strategy',
    tags: [],
    mistakeTags: [],
    reviewStatus: 'unreviewed',
    reviewCategory: 'normal',
    tradeKind: 'live',
    entry: 100,
    exit: 110,
    size: 1,
    pnl: 100,
    cashCurrency,
    rMultiple: 1,
    resultSource: 'imported',
    openedAt: '2026-08-09',
    closedAt: '2026-08-09',
    note: '',
  }
  if (!ownsCurrency) delete value.cashCurrency
  return value
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
  }
  throw new Error(message)
}

async function run(): Promise<void> {
  const element = document.getElementById('root')
  assert(element, '缺少测试挂载节点')
  const previous = useStore.getState()
  const calls: boolean[] = []
  const root = createRoot(element)
  try {
    useStore.setState({
      trades: [trade('legacy', undefined, false), trade('unknown', null), trade('cny', 'CNY')],
      profile: {
        avatarId: null,
        displayName: 'Yunkoo',
        customAvatarDataUrl: null,
        legacyCashCurrencyAssumption: null,
      },
      setLegacyCashCurrencyAssumption: async (confirmed: boolean) => {
        calls.push(confirmed)
        useStore.setState((state) => ({
          profile: {
            ...state.profile,
            legacyCashCurrencyAssumption: confirmed
              ? { currency: 'USD', confirmedAt: '2026-08-09T04:00:00.000Z' }
              : null,
          },
        }))
      },
    })
    root.render(<ProfileSettingsPanel />)
    await waitFor(
      () => document.body.textContent?.includes('当前有 2 笔现金结果因币种未知不进入 USD 总计') ?? false,
      '设置页必须展示旧缺字段与显式 unknown 的真实影响',
    )
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('确认旧记录为 USD'))
    assert(checkbox && confirm, '必须提供明确确认框与确认按钮')
    assert(confirm.disabled, '未勾选完整确认文案前不得提交资料库级假设')
    checkbox.click()
    await waitFor(() => !confirm.disabled, '勾选确认文案后按钮应可用')
    confirm.click()
    await waitFor(() => calls.join(',') === 'true', '设置页必须调用持久化确认动作')
    await waitFor(() => document.body.textContent?.includes('显式 CNY 或币种未知记录不会被覆盖') ?? false, '确认后必须解释不会覆盖显式事实')
    const revoke = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('撤销历史 USD 假设'))
    assert(revoke, '确认后必须提供可逆撤销入口')
    await waitFor(() => !revoke.disabled, '确认持久化完成后撤销入口应恢复可用')
    revoke.click()
    await waitFor(() => calls.join(',') === 'true,false', '撤销入口必须调用同一持久化动作')
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__profileSettingsCurrencyTest = run()
