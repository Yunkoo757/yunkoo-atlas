import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { waitFor } from './test/browserTiming'
import { switchActiveLibrary } from './lib/librarySwitch'
import { notifyStorageRecoveryRequired } from './lib/storageRecovery'
import { isStorageHydrated } from './storage/bootstrap'
import { createNewLibrarySnapshot } from './storage/emptySnapshot'
import { flushPersistNow, getPersistSuspendDepth } from './storage/persist'
import type { PersistedSnapshot } from './storage/types'
import { useStore } from './store/useStore'
import type { JournalBridge, LibrarySwitchMode } from './types/journalBridge'

declare global {
  interface Window { __appStartupLibrarySelectionTest?: Promise<void> }
}

function button(text: string) {
  return [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === text)
}

async function run() {
  const oldBridge = window.journalBridge
  const fontOverride = Object.getOwnPropertyDescriptor(document.fonts, 'ready')
  const libraries = new Map<string, PersistedSnapshot | null>([
    ['/source', { ...createNewLibrarySnapshot(), tagPresets: ['旧库'] }],
    ['/open', { ...createNewLibrarySnapshot(), tagPresets: ['目标库'] }],
    ['/create', null],
  ])
  let active = '/source'
  let writer: string | null = null
  let target: LibrarySwitchMode = 'open'
  let holdSave: (() => Promise<void>) | undefined
  let canceled = 0
  const direct = async (path: string) => {
    active = path
    return { ok: true as const, path, snapshot: libraries.get(path) ?? null }
  }
  const bridge = {
    isElectron: true, platform: 'darwin', onTrayNavigate: () => () => {},
    getLibraryStatus: async () => ({ kind: 'ready', configuredPath: active, resolvedPath: active, source: 'config' } as const),
    storageOpen: async () => { writer = active; return true },
    getLibraryPath: async () => active,
    loadSnapshot: async () => libraries.get(active) ?? null,
    saveSnapshot: async (snapshot: PersistedSnapshot) => {
      if (writer !== active) throw new Error('writer belongs to previous library')
      libraries.set(active, structuredClone(snapshot))
      await holdSave?.()
      return true
    },
    pickLibraryFolder: async () => '/' + target,
    openExistingLibrary: direct, createNewLibrary: direct,
    prepareLibrarySwitch: async (path, mode) => {
      if (mode !== target || path !== '/' + target) throw new Error('错误的候选库')
      return { ok: true, token: path } as const
    },
    activatePreparedLibrary: async (path: string) => {
      writer = path
      return direct(path)
    },
    cancelPreparedLibrary: async () => { canceled++; return true },
  } satisfies Partial<JournalBridge>
  try {
    Object.defineProperty(window, 'journalBridge', { configurable: true, value: bridge })
    for (const mode of ['open', 'create'] as const) {
      target = mode
      const source = active
      const oldTags = libraries.get(source)?.tagPresets
      const root = createRoot(document.getElementById('root')!)
      let fail = true
      Object.defineProperty(document.fonts, 'ready', { configurable: true, get() {
        if (fail) { fail = false; throw new Error('isolated post-hydration failure') }
        return Promise.resolve(document.fonts)
      } })
      try {
        root.render(<App />)
        await waitFor(() => Boolean(button('选择其他资料库')), '应允许从启动错误进入欢迎页')
        if (!isStorageHydrated()) throw new Error('用例必须先加载旧库')
        button('选择其他资料库')!.click()
        await waitFor(() => Boolean(button('点击选择目录…')), '应显示欢迎页')
        button('点击选择目录…')!.click()
        const action = mode === 'open' ? '打开已有资料库' : '在此创建新资料库'
        await waitFor(() => Boolean(button(action)), '应提供所选目录的操作')
        button(action)!.click()
        await waitFor(() => Boolean(document.querySelector('.sb-primary')), '选库成功后应进入工作区')
        const tags = useStore.getState().tagPresets
        if (active !== '/' + mode || writer !== active || (mode === 'open' ? !tags.includes('目标库') : tags.includes('目标库'))) {
          throw new Error('选库后资料与写入资格必须一致。模式=' + mode + ' 位置=' + active + ' 写入资格=' + writer + ' 标签=' + tags)
        }
        useStore.setState({ tagPresets: [...tags, '本次修改'] })
        await flushPersistNow()
        if (!libraries.get(active)?.tagPresets?.includes('本次修改') ||
          JSON.stringify(libraries.get(source)?.tagPresets) !== JSON.stringify(oldTags)) throw new Error('修改仅能写入所选库')
      } finally { root.unmount() }
    }

    const root = createRoot(document.getElementById('root')!)
    target = 'open'
    let release!: () => void
    const waiting = new Promise<void>(resolve => { release = resolve })
    let saving!: () => void
    const started = new Promise<void>(resolve => { saving = resolve })
    try {
      root.render(<App />)
      await waitFor(() => Boolean(document.querySelector('.sb-primary')), '中断用例必须先进入已载入的工作区')
      holdSave = () => { saving(); return waiting }
      const switching = switchActiveLibrary(target, '/' + target)
      await started
      notifyStorageRecoveryRequired('隔离切库写回期间进入恢复')
      await waitFor(() => Boolean(button('重新打开资料库')), '恢复应接管在途切换')
      const usableDuringSave = !button('重新打开资料库')?.closest('[inert]')
      const canceledDuringSave = canceled
      release()
      const result = await switching
      if (result.ok || active !== '/create' || !usableDuringSave || canceledDuringSave !== 1 || canceled !== 1 ||
          getPersistSuspendDepth() !== 0 || !document.body.textContent?.includes('隔离切库写回期间进入恢复')) {
        throw new Error('恢复须释放候选与交互锁，过期保存不能激活目标库。位置=' + active +
          ' 已取消=' + canceledDuringSave + '/' + canceled + ' 恢复可用=' + usableDuringSave)
      }
    } finally { release(); root.unmount() }
  } finally {
    if (fontOverride) Object.defineProperty(document.fonts, 'ready', fontOverride)
    else Reflect.deleteProperty(document.fonts, 'ready')
    Object.defineProperty(window, 'journalBridge', { configurable: true, value: oldBridge })
  }
}

window.__atlasBrowserAllowedErrors = ['Storage bootstrap failed Error: isolated post-hydration failure']
window.__appStartupLibrarySelectionTest = run()
