import { StrictMode, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ModalShell } from '@/components/ui/ModalShell'
import { useExitClone } from '@/components/ui/useExitClone'
import '@/styles/tokens.css'
import '@/styles/global.css'

declare global {
  interface Window {
    __exitMotionTest?: Promise<void>
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = performance.now() + 3_000
  while (!condition()) {
    if (performance.now() >= deadline) throw new Error(message)
    await frame()
  }
}

function pauseAt(node: HTMLElement, milliseconds: number): void {
  for (const animation of node.getAnimations()) {
    animation.pause()
    animation.currentTime = milliseconds
  }
}

let controls: {
  menu: (open: boolean) => void
  modal: (open: boolean) => void
  nested: (open: boolean) => void
  transient: (key: number | null) => void
} | undefined

function Menu({ open = true }: { open?: boolean }) {
  const ref = useExitClone<HTMLDivElement>(open)
  return open ? (
    <div ref={ref} id="exit-menu" className="exit-fixture-menu" role="listbox" aria-labelledby="exit-title">
      <strong id="exit-title">长菜单滚动快照</strong>
      {Array.from({ length: 20 }, (_, index) => <div key={index} role="option" style={{ height: 24 }}>选项 {index + 1}</div>)}
      <div className="exit-scroll-child" style={{ width: 120, height: 50, overflow: 'auto' }}>
        <div id="exit-inner-content" style={{ width: 400, height: 180 }}>保留内层横向及纵向滚动</div>
      </div>
      <span className="exit-animated-child">状态</span>
    </div>
  ) : null
}

function Harness() {
  const [menu, setMenu] = useState(false)
  const [modal, setModal] = useState(false)
  const [nested, setNested] = useState(false)
  const [transient, setTransient] = useState<number | null>(null)
  useEffect(() => {
    controls = { menu: setMenu, modal: setModal, nested: setNested, transient: setTransient }
  }, [])
  return (
    <>
      <Menu open={menu} />
      {transient !== null ? <Menu key={transient} /> : null}
      {modal ? (
        <ModalShell title="父弹窗" onClose={() => setModal(false)}>
          <button type="button">父弹窗操作</button>
          {nested ? (
            <ModalShell title="子弹窗" onClose={() => setNested(false)}>
              <button type="button">子弹窗操作</button>
            </ModalShell>
          ) : null}
        </ModalShell>
      ) : null}
    </>
  )
}

function escape(): void {
  flushSync(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
}

async function run(): Promise<void> {
  const host = document.getElementById('root')
  assert(host, '缺少测试挂载点')
  const root = createRoot(host)
  const originalMatchMedia = window.matchMedia
  const style = document.createElement('style')
  style.textContent = `
    .exit-fixture-menu { position: fixed; top: 20px; left: 20px; width: 220px; height: 150px; overflow: auto; animation: exitFixtureIn 1s linear both; }
    .exit-animated-child { display: block; animation: exitFixtureIn 1s linear both; }
    @keyframes exitFixtureIn { from { opacity: 0; transform: translateY(-4px); scale: .98; } to { opacity: 1; transform: translateY(0); scale: 1; } }
  `
  document.head.append(style)
  document.documentElement.style.setProperty('--motion-menu', '260ms')
  document.documentElement.style.setProperty('--motion-dialog-out', '320ms')
  root.render(<StrictMode><Harness /></StrictMode>)

  try {
    await waitFor(() => Boolean(controls), '测试控制器未挂载')
    assert(controls, '测试控制器缺失')
    flushSync(() => controls?.menu(true))
    await frame()
    assert(!document.querySelector('.ui-exit-clone'), 'StrictMode 模拟清理不应生成假离场')
    const menu = document.getElementById('exit-menu')
    assert(menu, '菜单未打开')
    pauseAt(menu, 400)
    const childScroll = menu.querySelector<HTMLElement>('.exit-scroll-child')
    assert(childScroll, '滚动子节点缺失')
    menu.scrollTop = 170
    childScroll.scrollTop = 70
    childScroll.scrollLeft = 90
    const before = getComputedStyle(menu)
    const initialOpacity = before.opacity
    const initialTransform = before.transform
    const initialScale = before.scale
    flushSync(() => controls?.menu(false))
    const clone = document.querySelector<HTMLElement>('.ui-exit-clone')
    assert(clone, '关闭菜单未生成离场快照')
    assert(clone.inert && clone.getAttribute('aria-hidden') === 'true', '快照必须退出交互和可访问树')
    assert(!clone.id && !clone.hasAttribute('role'), '快照根节点不得保留 ID 或角色')
    assert(!clone.querySelector('[id], [role], [aria-labelledby]'), '快照子节点不得保留 ID、角色或 ARIA 引用')
    assert(clone.scrollTop === 170, '长菜单离场时滚动位置回到了顶部')
    const clonedScroll = clone.querySelector<HTMLElement>('.exit-scroll-child')
    assert(clonedScroll?.scrollTop === 70 && clonedScroll.scrollLeft === 90, '内层滚动位置未保留')
    assert(clone.style.opacity === initialOpacity, '入场中关闭不应恢复到完整不透明度')
    assert(clone.style.transform === initialTransform && clone.style.scale === initialScale, '快照必须保留关闭瞬间的位移和缩放')
    const animatedChild = clone.querySelector<HTMLElement>('.exit-animated-child')
    assert(animatedChild && getComputedStyle(animatedChild).animationName === 'none', '克隆子节点不得重播入场')
    assert(getComputedStyle(clone).animationDuration === '0.26s', '菜单离场未消费实际 motion-menu token')
    await new Promise((resolve) => setTimeout(resolve, 170))
    assert(clone.isConnected, '离场仍在运行时不应按硬编码 120ms 提前删除')
    await waitFor(() => !clone.isConnected, '菜单离场结束后未清理快照')

    // 同一 hook 快速关闭和重开应即时移除旧快照。
    for (let index = 0; index < 3; index += 1) {
      flushSync(() => controls?.menu(true))
      flushSync(() => controls?.menu(false))
      assert(document.querySelector('.ui-exit-clone'), '快速关闭仍应创建离场快照')
      flushSync(() => controls?.menu(true))
      await Promise.resolve()
      assert(!document.querySelector('.ui-exit-clone'), '快速重开不应残留旧快照')
    }
    flushSync(() => controls?.menu(false))
    document.querySelectorAll('.ui-exit-clone').forEach((node) => node.remove())

    // 整个组件在一次提交中被同类新实例取代，旧 effect 的 microtask 不得补造残影。
    flushSync(() => controls?.transient(1))
    flushSync(() => controls?.transient(2))
    await Promise.resolve()
    assert(!document.querySelector('.ui-exit-clone'), '重新挂载组件后旧卸载任务制造了残影')
    flushSync(() => controls?.transient(null))
    await Promise.resolve()
    assert(document.querySelector('.ui-exit-clone'), '父组件条件卸载必须保留离场')
    document.querySelectorAll('.ui-exit-clone').forEach((node) => node.remove())

    flushSync(() => controls?.modal(true))
    flushSync(() => controls?.nested(true))
    assert(document.querySelectorAll('[role="dialog"]').length === 2, '嵌套弹窗未打开')
    const overlays = document.querySelectorAll<HTMLElement>('.modal-shell-overlay')
    const childOverlay = overlays[overlays.length - 1]
    const childPanel = childOverlay.querySelector<HTMLElement>('[role="dialog"]')
    assert(childPanel, '子弹窗面板缺失')
    pauseAt(childOverlay, 60)
    pauseAt(childPanel, 60)
    const childOpacity = getComputedStyle(childPanel).opacity
    escape()
    await Promise.resolve()
    const modalClone = document.querySelector<HTMLElement>('.ui-exit-clone.modal-shell-overlay')
    assert(modalClone, '已存在父弹窗不应吞掉子弹窗离场')
    assert(!modalClone.hasAttribute('data-modal-shell-id') && !modalClone.querySelector('[data-modal-shell-id], [role], [id]'), '快照不得参与 Modal 栈或保留 DOM 身份')
    const clonePanel = modalClone.querySelector<HTMLElement>('.ui-exit-dialog')
    assert(clonePanel?.style.opacity === childOpacity, '入场中关闭的子弹窗出现不透明度跳变')
    assert(getComputedStyle(modalClone).animationDuration === '0.32s', '弹窗离场未消费实际 motion-dialog-out token')
    assert(document.querySelectorAll('[role="dialog"]').length === 1, '关闭子层时父层不应消失')
    escape()
    await Promise.resolve()
    assert(!document.querySelector('[role="dialog"]'), '子层离场期间父弹窗必须立即响应 Escape')
    await waitFor(() => !document.querySelector('.ui-exit-clone'), '弹窗离场后快照未清理')

    // 独立验证 hook 对媒体偏好的分支；真实 CSS 媒体表现由桌面动效验收覆盖。
    window.matchMedia = (query) => {
      const result = originalMatchMedia.call(window, query)
      return query === '(prefers-reduced-motion: reduce)'
        ? new Proxy(result, { get: (target, key) => key === 'matches' ? true : Reflect.get(target, key, target) })
        : result
    }
    flushSync(() => controls?.menu(true))
    flushSync(() => controls?.menu(false))
    flushSync(() => controls?.modal(true))
    flushSync(() => controls?.modal(false))
    await Promise.resolve()
    assert(!document.querySelector('.ui-exit-clone'), '减少动效时不得创建离场快照')
  } finally {
    window.matchMedia = originalMatchMedia
    root.unmount()
    await Promise.resolve()
    document.querySelectorAll('.ui-exit-clone').forEach((node) => node.remove())
    document.documentElement.style.removeProperty('--motion-menu')
    document.documentElement.style.removeProperty('--motion-dialog-out')
    style.remove()
    controls = undefined
  }
}

window.__exitMotionTest = run()
