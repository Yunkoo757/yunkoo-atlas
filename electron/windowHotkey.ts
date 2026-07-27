import { open, readFile, rename, unlink } from 'node:fs/promises'

import {
  DEFAULT_WINDOW_HOTKEY,
  normalizeWindowHotkeyBinding,
  toElectronAccelerator,
  type WindowHotkeyState,
  type WindowHotkeyUpdateResult,
} from '@/lib/windowHotkeyBinding'
import type { KeyChord } from '@/shortcuts/types'

type WindowHotkeyConfig = { version: 1; binding: KeyChord }

type WindowHotkeyFileSystem = {
  rename(source: string, destination: string): Promise<void>
}

const DEFAULT_FILE_SYSTEM: WindowHotkeyFileSystem = { rename }

export interface WindowHotkeyRegistrar {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export interface WindowHotkeyStorage {
  load(): Promise<
    { kind: 'missing' } | { kind: 'invalid' } | { kind: 'valid'; binding: KeyChord }
  >
  save(binding: KeyChord): Promise<void>
}

function parseConfig(value: unknown): WindowHotkeyConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).some((field) => field !== 'version' && field !== 'binding')) return null
  if (record.version !== 1) return null
  const binding = normalizeWindowHotkeyBinding(record.binding)
  return binding ? { version: 1, binding } : null
}

function isFileSystemError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  )
}

export class FileWindowHotkeyStorage implements WindowHotkeyStorage {
  constructor(
    private readonly configPath: string,
    private readonly fileSystem: WindowHotkeyFileSystem = DEFAULT_FILE_SYSTEM,
  ) {}

  async load(): ReturnType<WindowHotkeyStorage['load']> {
    let contents: string
    try {
      contents = await readFile(this.configPath, 'utf8')
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT')) return { kind: 'missing' }
      throw error
    }

    try {
      const config = parseConfig(JSON.parse(contents) as unknown)
      return config ? { kind: 'valid', binding: config.binding } : { kind: 'invalid' }
    } catch {
      return { kind: 'invalid' }
    }
  }

  async save(binding: KeyChord): Promise<void> {
    const temporaryPath = `${this.configPath}.tmp-${process.pid}`
    let file: Awaited<ReturnType<typeof open>> | null = null
    try {
      file = await open(temporaryPath, 'w')
      await file.writeFile(JSON.stringify({ version: 1, binding }), 'utf8')
      await file.sync()
      await file.close()
      file = null
      await this.fileSystem.rename(temporaryPath, this.configPath)
    } finally {
      try {
        if (file) await file.close()
      } finally {
        try {
          await unlink(temporaryPath)
        } catch (error) {
          if (!isFileSystemError(error, 'ENOENT')) throw error
        }
      }
    }
  }
}

export class WindowHotkeyService {
  private binding: KeyChord = { ...DEFAULT_WINDOW_HOTKEY }
  private currentAccelerator: string | null = null
  private disposed = false
  private disposal: Promise<void> | null = null
  private operationQueue: Promise<void> = Promise.resolve()
  private registered = false
  private startupError: WindowHotkeyState['errorCode']

  constructor(
    private readonly dependencies: {
      registrar: WindowHotkeyRegistrar
      storage: WindowHotkeyStorage
      onToggle: () => void
    },
  ) {}

  private get registrar(): WindowHotkeyRegistrar {
    return this.dependencies.registrar
  }

  private get storage(): WindowHotkeyStorage {
    return this.dependencies.storage
  }

  private get onToggle(): () => void {
    return this.dependencies.onToggle
  }

  initialize(): Promise<WindowHotkeyState> {
    if (this.disposed) return Promise.resolve(this.getState())
    return this.serialize(() => this.initializeTransaction())
  }

  private async initializeTransaction(): Promise<WindowHotkeyState> {
    if (this.disposed) return this.getState()
    const loaded = await this.storage.load()
    if (this.disposed) return this.getState()
    this.binding = loaded.kind === 'valid' ? loaded.binding : { ...DEFAULT_WINDOW_HOTKEY }
    const accelerator = toElectronAccelerator(this.binding)
    if (!this.registrar.register(accelerator, this.onToggle)) {
      this.currentAccelerator = null
      this.registered = false
      this.startupError = 'registration-unavailable'
      return this.getState()
    }

    this.currentAccelerator = accelerator
    this.registered = true
    this.startupError = loaded.kind === 'invalid' ? 'invalid-config' : undefined
    return this.getState()
  }

  getState(): WindowHotkeyState {
    return {
      binding: { ...this.binding },
      registered: this.registered && !this.disposed,
      errorCode: this.startupError,
    }
  }

  update(input: unknown): Promise<WindowHotkeyUpdateResult> {
    if (this.disposed) return Promise.resolve(this.disposedFailure())
    return this.serialize(() => this.updateTransaction(input))
  }

  private async updateTransaction(input: unknown): Promise<WindowHotkeyUpdateResult> {
    if (this.disposed) return this.disposedFailure()
    const candidate = normalizeWindowHotkeyBinding(input)
    if (!candidate) return this.failure('invalid-binding', '不支持这个系统级快捷键')
    const nextAccelerator = toElectronAccelerator(candidate)
    if (nextAccelerator === this.currentAccelerator) {
      return { ok: true, state: this.getState() }
    }
    if (!this.registrar.register(nextAccelerator, this.onToggle)) {
      return this.failure('registration-unavailable', '快捷键已被系统或其他程序占用')
    }
    try {
      await this.storage.save(candidate)
    } catch {
      this.registrar.unregister(nextAccelerator)
      if (this.disposed) return this.disposedFailure()
      return this.failure('persistence-failed', '快捷键配置保存失败')
    }
    if (this.disposed) {
      this.registrar.unregister(nextAccelerator)
      return this.disposedFailure()
    }
    const previous = this.currentAccelerator
    this.binding = candidate
    this.currentAccelerator = nextAccelerator
    this.registered = true
    this.startupError = undefined
    if (previous) this.registrar.unregister(previous)
    return { ok: true, state: this.getState() }
  }

  reset(): Promise<WindowHotkeyUpdateResult> {
    return this.update(DEFAULT_WINDOW_HOTKEY)
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.disposed = true
    this.disposal = this.serialize(async () => {
      if (this.currentAccelerator) this.registrar.unregister(this.currentAccelerator)
      this.currentAccelerator = null
      this.registered = false
    })
    return this.disposal
  }

  private failure(
    errorCode: 'invalid-binding' | 'registration-unavailable' | 'persistence-failed',
    message: string,
  ): WindowHotkeyUpdateResult {
    return { ok: false, errorCode, message, state: this.getState() }
  }

  private disposedFailure(): WindowHotkeyUpdateResult {
    return this.failure('registration-unavailable', '快捷键服务已释放')
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
