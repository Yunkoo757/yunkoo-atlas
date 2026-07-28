import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SettingsLayout } from '@/views/settings/SettingsLayout'
import { RiskManagementSettingsPanel } from '@/views/settings/RiskManagementSettingsPanel'
import { useStore } from '@/store/useStore'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window { __riskManagementSettingsBrowserTest?: Promise<void> }
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 5_000
  while (performance.now() < deadline) {
    if (condition()) return
    await frame()
  }
  throw new Error(message)
}

function setText(element: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('浏览器缺少 input value setter')
  setter.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

async function run(): Promise<void> {
  const rootElement = document.getElementById('root')
  if (!rootElement) throw new Error('缺少测试挂载节点')
  const previous = useStore.getState()
  const root = createRoot(rootElement)
  try {
    useStore.setState((state) => ({
      weeklyRiskPreparations: [],
      riskPolicyVersions: [],
      monthlyRiskLimits: [],
      display: { ...state.display, privacyMode: false },
    }))
    root.render(
      <MemoryRouter initialEntries={['/settings/risk']}>
        <Routes>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route path="risk" element={<RiskManagementSettingsPanel />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(
      () => document.querySelector('.settings-nav-item.is-active')?.textContent?.trim() === '风险管理',
      '风险管理导航没有激活',
    )
    const panel = document.querySelector('[data-risk-management-settings]')
    if (!panel) throw new Error('风险管理设置页没有渲染')
    if (!panel.textContent?.includes('日止损线') || !panel.textContent?.includes('周止损线')) {
      throw new Error('风险管理设置页缺少周期限额')
    }
    if (!panel.textContent?.includes('确认本周规则')) throw new Error('设置页缺少每周确认动作')

    const capital = [...panel.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('资金基准'))
      ?.querySelector<HTMLInputElement>('input')
    if (!capital) throw new Error('设置页缺少资金基准输入')
    setText(capital, '100000')
    await frame()
    const riskAmount = panel.querySelector<HTMLInputElement>('[aria-label="1R 金额"]')
    if (!riskAmount) throw new Error('设置页缺少 1R 金额输入')
    setText(riskAmount, '1000')
    await frame()
    const daily = [...panel.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('日止损线'))
      ?.querySelector<HTMLInputElement>('input')
    if (!daily) throw new Error('设置页缺少日止损线输入')
    setText(daily, '2.5')
    await frame()
    const confirm = [...panel.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '确认本周规则')
    if (!confirm) throw new Error('设置页缺少确认按钮')
    confirm.click()
    await waitFor(() => panel.textContent?.includes('本周风险规则已复核') ?? false, '设置页确认没有完成')
    if (panel.querySelector('input')) throw new Error('确认后设置页必须回到只读摘要')

    useStore.setState((state) => ({ display: { ...state.display, privacyMode: true } }))
    const edit = [...panel.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '修改规则')
    if (!edit) throw new Error('设置页缺少修改规则按钮')
    edit.click()
    await waitFor(() => panel.querySelector<HTMLInputElement>('[aria-label="1R 金额"]')?.type === 'password', '隐私模式没有掩码 1R 金额')
    const privateCapital = [...panel.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('资金基准'))
      ?.querySelector<HTMLInputElement>('input')
    if (privateCapital?.type !== 'password') throw new Error('隐私模式没有掩码资金基准')
  } finally {
    root.unmount()
    useStore.setState(previous, true)
  }
}

window.__riskManagementSettingsBrowserTest = run()
