import { useCallback, useEffect, useRef } from 'react'

type ExitSnapshot = {
  generation: number
  scroll: Array<{ top: number; left: number }>
  opacity: string
  transform: string
  scale: string
  dialog?: { index: number; opacity: string; transform: string; scale: string }
}

let mountGeneration = 0
const sourceGenerations = new WeakMap<HTMLElement, number>()

// 在 ref 分离前读取；脱离文档后滚动位置与进行中的动画样式会丢失。
function captureExitSnapshot(source: HTMLElement): ExitSnapshot {
  const style = getComputedStyle(source)
  const dialog = source.querySelector<HTMLElement>('[role="dialog"]')
  const dialogStyle = dialog ? getComputedStyle(dialog) : null
  const nodes = [source, ...source.querySelectorAll<HTMLElement>('*')]
  return {
    generation: mountGeneration,
    scroll: nodes.map((node) => ({
      top: node.scrollTop, left: node.scrollLeft,
    })),
    opacity: style.opacity,
    transform: style.transform,
    scale: style.scale,
    dialog: dialog && dialogStyle ? {
      index: nodes.indexOf(dialog),
      opacity: dialogStyle.opacity,
      transform: dialogStyle.transform,
      scale: dialogStyle.scale,
    } : undefined,
  }
}

function appendExitClone(source: HTMLElement | null, snapshot: ExitSnapshot | null) {
  if (!source || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const sourceClasses = Array.from(source.classList)
  const selector = sourceClasses.length > 0
    ? `.${sourceClasses.map((className) => CSS.escape(className)).join('.')}`
    : ''
  // 只取消关闭后立即重新挂载的同类弹层；已存在的父弹层不应吞掉子层离场。
  const reopened = snapshot && selector !== '' && Array.from(document.body.querySelectorAll<HTMLElement>(selector)).some(
    (element) => element !== source
      && !element.classList.contains('ui-exit-clone')
      && (sourceGenerations.get(element) ?? 0) > snapshot.generation,
  )
  if (reopened) return
  const clone = source.cloneNode(true) as HTMLElement
  clone.classList.add('ui-exit-clone')
  clone.setAttribute('aria-hidden', 'true')
  clone.setAttribute('inert', '')
  // 快照不再参与弹层栈、焦点、ARIA 引用或 DOM 身份查询。
  const nodes = [clone, ...clone.querySelectorAll<HTMLElement>('*')]
  for (const element of nodes) {
    // alert / status 也是现有反馈样式的选择器；保留外观，整个快照仍由 aria-hidden + inert 隔离。
    const role = element.getAttribute('role')
    if (role !== 'alert' && role !== 'status') element.removeAttribute('role')
    for (const attribute of ['id', 'aria-modal', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-activedescendant', 'aria-owns', 'data-modal-shell-id']) {
      element.removeAttribute(attribute)
    }
  }
  if (snapshot?.dialog) {
    const dialog = nodes[snapshot.dialog.index]
    dialog.classList.add('ui-exit-dialog')
    dialog.style.opacity = snapshot.dialog.opacity
    dialog.style.transform = snapshot.dialog.transform
    dialog.style.scale = snapshot.dialog.scale
  }
  if (snapshot) {
    clone.style.opacity = snapshot.opacity
    clone.style.transform = snapshot.transform
    clone.style.scale = snapshot.scale
  }
  document.body.append(clone)
  snapshot?.scroll.forEach(({ top, left }, index) => {
    nodes[index].scrollTop = top
    nodes[index].scrollLeft = left
  })
  // 从实际 CSS 时长清理，避免 token 变化后快照被提前截断。
  const duration = getComputedStyle(clone).animationDuration
  const milliseconds = Number.parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000)
  const timer = window.setTimeout(() => clone.remove(), Number.isFinite(milliseconds) ? milliseconds + 50 : 0)
  clone.addEventListener('animationend', (event) => {
    if (event.target !== clone) return
    window.clearTimeout(timer)
    clone.remove()
  })
}

/**
 * React 条件卸载没有离场阶段；保留一份无交互快照完成短促淡出。
 * callback ref 会在卸载前保存最后一个节点，因此父级直接关闭也能衔接动画。
 */
export function useExitClone<T extends HTMLElement>(visible = true) {
  const nodeRef = useRef<T | null>(null)
  const visibleRef = useRef(visible)
  const clonedRef = useRef(false)
  const snapshotRef = useRef<ExitSnapshot | null>(null)

  const ref = useCallback((node: T | null) => {
    if (!node) {
      if (nodeRef.current?.isConnected && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        snapshotRef.current = captureExitSnapshot(nodeRef.current)
      }
      return
    }
    sourceGenerations.set(node, ++mountGeneration)
    nodeRef.current = node
    snapshotRef.current = null
    const sourceClasses = Array.from(node.classList)
    document.querySelectorAll<HTMLElement>('.ui-exit-clone').forEach((clone) => {
      if (sourceClasses.some((className) => clone.classList.contains(className))) clone.remove()
    })
  }, [])

  useEffect(() => {
    if (visible) clonedRef.current = false
    if (visibleRef.current && !visible && !clonedRef.current) {
      clonedRef.current = true
      appendExitClone(nodeRef.current, snapshotRef.current)
    }
    visibleRef.current = visible
  }, [visible])

  useEffect(() => () => {
    const source = nodeRef.current
    const snapshot = snapshotRef.current
    const generation = source ? sourceGenerations.get(source) : undefined
    queueMicrotask(() => {
      // StrictMode 会模拟 ref / effect 清理；即使本轮随后真卸载，也不能复用早期清理任务。
      if (source && snapshot && !source.isConnected && sourceGenerations.get(source) === generation && visibleRef.current && !clonedRef.current) {
        clonedRef.current = true
        appendExitClone(source, snapshot)
      }
    })
  }, [])

  return ref
}
