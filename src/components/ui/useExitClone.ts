import { useCallback, useEffect, useRef } from 'react'

const EXIT_DURATION_MS = 120

function appendExitClone(source: HTMLElement | null) {
  if (!source || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const sourceClasses = Array.from(source.classList)
  const selector = sourceClasses.length > 0
    ? `.${sourceClasses.map((className) => CSS.escape(className)).join('.')}`
    : ''
  const liveMatch = selector !== '' && Array.from(document.body.querySelectorAll<HTMLElement>(selector)).some(
    (element) => element !== source
      && !element.classList.contains('ui-exit-clone')
      && sourceClasses.length > 0
      && sourceClasses.every((className) => element.classList.contains(className)),
  )
  if (liveMatch) return
  const clone = source.cloneNode(true) as HTMLElement
  clone.classList.add('ui-exit-clone')
  clone.setAttribute('aria-hidden', 'true')
  clone.setAttribute('inert', '')
  clone.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'))
  const dialog = clone.matches('[role="dialog"]')
    ? clone
    : clone.querySelector<HTMLElement>('[role="dialog"]')
  dialog?.removeAttribute('role')
  if (dialog && dialog !== clone) dialog.classList.add('ui-exit-dialog')
  document.body.append(clone)
  window.setTimeout(() => clone.remove(), EXIT_DURATION_MS)
}

/**
 * React 条件卸载没有离场阶段；保留一份无交互快照完成短促淡出。
 * callback ref 会在卸载前保存最后一个节点，因此父级直接关闭也能衔接动画。
 */
export function useExitClone<T extends HTMLElement>(visible = true) {
  const nodeRef = useRef<T | null>(null)
  const visibleRef = useRef(visible)
  const clonedRef = useRef(false)

  const ref = useCallback((node: T | null) => {
    if (!node) return
    nodeRef.current = node
    const sourceClasses = Array.from(node.classList)
    document.querySelectorAll<HTMLElement>('.ui-exit-clone').forEach((clone) => {
      if (sourceClasses.some((className) => clone.classList.contains(className))) clone.remove()
    })
  }, [])

  useEffect(() => {
    if (visible) clonedRef.current = false
    if (visibleRef.current && !visible && !clonedRef.current) {
      clonedRef.current = true
      appendExitClone(nodeRef.current)
    }
    visibleRef.current = visible
  }, [visible])

  useEffect(() => () => {
    const source = nodeRef.current
    queueMicrotask(() => {
      // StrictMode 会在节点仍连接时模拟一次 effect 清理；这不是真正的离场。
      if (!source?.isConnected && visibleRef.current && !clonedRef.current) {
        appendExitClone(source)
      }
    })
  }, [])

  return ref
}
