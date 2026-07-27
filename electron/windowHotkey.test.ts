import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { toElectronAccelerator } from '@/lib/windowHotkeyBinding'
import type { KeyChord } from '@/shortcuts/types'

import {
  FileWindowHotkeyStorage,
  WindowHotkeyService,
  type WindowHotkeyRegistrar,
  type WindowHotkeyStorage,
} from './windowHotkey'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function createServiceFixture(options: {
  calls: string[]
  rejectedAccelerator?: string
  failSave?: boolean
  loadResult?: Awaited<ReturnType<WindowHotkeyStorage['load']>>
}) {
  const registrar: WindowHotkeyRegistrar = {
    register(accelerator) {
      options.calls.push(`register:${accelerator}`)
      return accelerator !== options.rejectedAccelerator
    },
    unregister(accelerator) {
      options.calls.push(`unregister:${accelerator}`)
    },
  }
  const storage: WindowHotkeyStorage = {
    async load() {
      return options.loadResult ?? { kind: 'valid', binding: { key: 'f2' } }
    },
    async save(binding) {
      options.calls.push(`save:${toElectronAccelerator(binding)}`)
      if (options.failSave) throw new Error('save failed')
    },
  }
  return new WindowHotkeyService({
    registrar,
    storage,
    onToggle() {},
  })
}

async function withTemporaryConfig(
  run: (configPath: string, directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'trader-atlas-window-hotkey-'))
  try {
    await run(join(directory, 'window-hotkey.json'), directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function testWindowHotkeyRegistrationFailureKeepsOldBinding(): Promise<void> {
  const calls: string[] = []
  const service = createServiceFixture({ calls, rejectedAccelerator: 'Alt+X' })
  await service.initialize()
  const result = await service.update({ alt: true, key: 'x' })
  assert(!result.ok, '被占用热键必须失败')
  assert(calls.join('|') === 'register:F2|register:Alt+X', '失败前不得注销旧键或保存配置')
  assert(service.getState().binding.key === 'f2', '旧绑定必须保留')
}

export async function testWindowHotkeyPersistenceFailureRollsBackCandidate(): Promise<void> {
  const calls: string[] = []
  const service = createServiceFixture({ calls, failSave: true })
  await service.initialize()
  const result = await service.update({ mod: true, key: 'k' })
  assert(!result.ok, '保存失败必须失败')
  assert(
    calls.join('|') ===
      'register:F2|register:CommandOrControl+K|save:CommandOrControl+K|unregister:CommandOrControl+K',
    '保存失败只能注销候选键',
  )
}

export async function testFileWindowHotkeyStorageDistinguishesMissingInvalidAndValid(): Promise<void> {
  await withTemporaryConfig(async (configPath) => {
    const storage = new FileWindowHotkeyStorage(configPath)
    assert((await storage.load()).kind === 'missing', '不存在的配置必须返回 missing')

    await writeFile(configPath, '{"version":1,"binding":{"key":"f2"},"extra":true}', 'utf8')
    assert((await storage.load()).kind === 'invalid', '含额外字段的配置必须返回 invalid')

    await writeFile(configPath, '{"version":1,"binding":{"alt":true,"key":"X"}}', 'utf8')
    const loaded = await storage.load()
    assert(loaded.kind === 'valid', '合法的版本化配置必须返回 valid')
    assert(loaded.binding.alt === true && loaded.binding.key === 'x', '读取时必须规范化绑定')
  })
}

export async function testFileWindowHotkeyStorageSavesVersionedConfigAtomically(): Promise<void> {
  await withTemporaryConfig(async (configPath, directory) => {
    const storage = new FileWindowHotkeyStorage(configPath)
    await storage.save({ mod: true, key: 'k' })

    const saved = JSON.parse(await readFile(configPath, 'utf8')) as {
      version: number
      binding: KeyChord
    }
    assert(saved.version === 1, '保存配置必须包含版本号 1')
    assert(saved.binding.mod === true && saved.binding.key === 'k', '保存配置必须包含绑定')
    assert(
      !(await readdir(directory)).some((name) => name.includes('.tmp-')),
      '原子替换后不得遗留临时文件',
    )
  })
}

export async function testFileWindowHotkeyStorageKeepsOldConfigWhenRenameFails(): Promise<void> {
  await withTemporaryConfig(async (configPath, directory) => {
    const original = '{"version":1,"binding":{"key":"f2"}}'
    await writeFile(configPath, original, 'utf8')
    const storage = new FileWindowHotkeyStorage(configPath, {
      async rename() {
        throw new Error('rename failed')
      },
    })

    let failed = false
    try {
      await storage.save({ mod: true, key: 'k' })
    } catch {
      failed = true
    }

    assert(failed, 'rename 失败必须向调用方报告保存失败')
    assert((await readFile(configPath, 'utf8')) === original, 'rename 前失败不得破坏旧配置')
    assert(
      !(await readdir(directory)).some((name) => name.includes('.tmp-')),
      'rename 前失败后必须清理临时文件',
    )
  })
}

export async function testWindowHotkeyInitializeDistinguishesConfigurationStates(): Promise<void> {
  const missingCalls: string[] = []
  const missingService = createServiceFixture({
    calls: missingCalls,
    loadResult: { kind: 'missing' },
  })
  const missingState = await missingService.initialize()
  assert(missingState.registered, '缺失配置时必须注册默认热键')
  assert(missingState.errorCode === undefined, '缺失配置不是错误')
  assert(missingCalls.join('|') === 'register:F2', '缺失配置只能尝试默认热键一次')

  const invalidCalls: string[] = []
  const invalidService = createServiceFixture({
    calls: invalidCalls,
    loadResult: { kind: 'invalid' },
  })
  const invalidState = await invalidService.initialize()
  assert(invalidState.registered, '无效配置时必须回退并注册默认热键')
  assert(invalidState.errorCode === 'invalid-config', '无效配置必须保留启动错误')
  assert(invalidCalls.join('|') === 'register:F2', '无效配置不得被保存或重复尝试')
}

export async function testWindowHotkeyInitializeHandlesUnavailableRegistration(): Promise<void> {
  const calls: string[] = []
  const service = createServiceFixture({
    calls,
    rejectedAccelerator: 'Alt+X',
    loadResult: { kind: 'valid', binding: { alt: true, key: 'x' } },
  })
  const state = await service.initialize()
  assert(!state.registered, '启动注册失败必须返回未注册状态')
  assert(state.errorCode === 'registration-unavailable', '启动注册失败必须提供错误码')
  assert(calls.join('|') === 'register:Alt+X', '启动时只能尝试选定绑定一次')
}

export async function testWindowHotkeyUpdateCommitsBeforeUnregisteringOldBinding(): Promise<void> {
  const calls: string[] = []
  const service = createServiceFixture({ calls })
  await service.initialize()
  const result = await service.update({ shift: true, key: 'g' })
  assert(result.ok, '可用热键必须更新成功')
  assert(
    calls.join('|') === 'register:F2|register:Shift+G|save:Shift+G|unregister:F2',
    '必须先注册和保存候选键，再注销旧键',
  )
  assert(service.getState().binding.key === 'g', '成功更新后必须公开新绑定')
}

export async function testWindowHotkeyConcurrentUpdatesAreSerialized(): Promise<void> {
  await withTemporaryConfig(async (configPath) => {
    await writeFile(configPath, '{"version":1,"binding":{"key":"f2"}}', 'utf8')
    let releaseFirstRename!: () => void
    const firstRenameGate = new Promise<void>((resolve) => {
      releaseFirstRename = resolve
    })
    let markFirstRenameStarted!: () => void
    const firstRenameStarted = new Promise<void>((resolve) => {
      markFirstRenameStarted = resolve
    })
    let renameCount = 0
    const storage = new FileWindowHotkeyStorage(configPath, {
      async rename(source, destination) {
        renameCount += 1
        if (renameCount === 1) {
          markFirstRenameStarted()
          await firstRenameGate
        }
        await rename(source, destination)
      },
    })
    const calls: string[] = []
    const registered = new Set<string>()
    const service = new WindowHotkeyService({
      registrar: {
        register(accelerator) {
          calls.push(`register:${accelerator}`)
          registered.add(accelerator)
          return true
        },
        unregister(accelerator) {
          calls.push(`unregister:${accelerator}`)
          registered.delete(accelerator)
        },
      },
      storage,
      onToggle() {},
    })
    await service.initialize()

    const firstUpdate = service.update({ alt: true, key: 'x' })
    await firstRenameStarted
    const secondUpdate = service.update({ shift: true, key: 'g' })
    await Promise.resolve()
    const secondStartedBeforeFirstCompleted = calls.includes('register:Shift+G')
    releaseFirstRename()
    const [firstResult, secondResult] = await Promise.all([firstUpdate, secondUpdate])

    assert(!secondStartedBeforeFirstCompleted, '第二次更新必须等待第一次事务完成后再注册')
    assert(firstResult.ok && secondResult.ok, '串行更新必须各自完成')
    assert(service.getState().binding.key === 'g', '最终内存绑定必须是第二次更新')
    assert(
      registered.size === 1 && registered.has('Shift+G'),
      '最终只能保留第二次更新的注册',
    )
    const persisted = await storage.load()
    assert(
      persisted.kind === 'valid' && persisted.binding.key === 'g',
      '最终文件绑定必须与内存和注册一致',
    )
    assert(
      calls.join('|') ===
        'register:F2|register:Alt+X|unregister:F2|register:Shift+G|unregister:Alt+X',
      '第二次更新只能在第一次完成提交后开始',
    )
  })
}

export async function testWindowHotkeyResetAndDisposeUseCurrentRegistration(): Promise<void> {
  const calls: string[] = []
  const service = createServiceFixture({
    calls,
    loadResult: { kind: 'valid', binding: { alt: true, key: 'x' } },
  })
  await service.initialize()
  const resetResult = await service.reset()
  assert(resetResult.ok, '重置必须恢复默认热键')
  service.dispose()
  assert(
    calls.join('|') ===
      'register:Alt+X|register:F2|save:F2|unregister:Alt+X|unregister:F2',
    '重置后释放必须只注销当前热键',
  )
  assert(!service.getState().registered, '释放后必须公开未注册状态')
}
