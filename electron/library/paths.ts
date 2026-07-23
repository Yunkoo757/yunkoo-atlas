import electronRuntime from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { writeFileAtomicallySync } from './atomicFile'

const CONFIG_FILE = 'library-config.json'
const electronApp =
  typeof electronRuntime === 'object' && electronRuntime !== null && 'app' in electronRuntime
    ? (electronRuntime as { app?: { getPath(name: 'userData' | 'documents'): string } }).app
    : undefined

function requireAppPath(name: 'userData' | 'documents'): string {
  if (!electronApp) throw new Error('Electron app paths are unavailable')
  return electronApp.getPath(name)
}

export function getConfigPath(): string {
  return path.join(requireAppPath('userData'), CONFIG_FILE)
}

export interface LibraryConfig {
  libraryPath: string
  libraryId?: string
}

export function readLibraryConfig(): LibraryConfig | null {
  const configPath = getConfigPath()
  if (!fs.existsSync(configPath)) return null
  const cfg: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (typeof cfg !== 'object' || cfg === null || typeof (cfg as LibraryConfig).libraryPath !== 'string') {
    throw new Error('资料库配置格式无效')
  }
  return cfg as LibraryConfig
}

export function saveLibraryConfig(cfg: LibraryConfig): void {
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true })
  writeFileAtomicallySync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf8')
}

export function getDefaultLibraryPath(): string {
  return path.join(requireAppPath('documents'), 'Yunkoo Atlas')
}

export function getLibraryPath(): string {
  const custom = process.env.LINEAR_JOURNAL_LIBRARY
  const saved = readLibraryConfig()
  if (saved) return saved.libraryPath
  return custom ? path.resolve(custom) : getDefaultLibraryPath()
}

export function getLibraryPaths(libraryPath: string): {
  root: string
  attachments: string
  backups: string
  dbFile: string
  manifestFile: string
} {
  const root = path.resolve(libraryPath)
  return {
    root,
    attachments: path.join(root, 'attachments'),
    backups: path.join(root, 'backups'),
    dbFile: path.join(root, 'journal.db'),
    manifestFile: path.join(root, 'manifest.json'),
  }
}

export function ensureLibraryDirs(libraryPath: string): {
  root: string
  attachments: string
  backups: string
  dbFile: string
  manifestFile: string
} {
  const paths = getLibraryPaths(libraryPath)
  const { attachments, backups } = paths
  fs.mkdirSync(attachments, { recursive: true })
  fs.mkdirSync(backups, { recursive: true })
  return paths
}

export function attachmentPath(attachmentsDir: string, id: string, ext: string): string {
  return path.join(attachmentsDir, `${id}.${ext}`)
}

export function findAttachmentFile(attachmentsDir: string, id: string): string | null {
  if (!fs.existsSync(attachmentsDir)) return null
  for (const name of fs.readdirSync(attachmentsDir)) {
    if (name.startsWith(`${id}.`)) return path.join(attachmentsDir, name)
  }
  return null
}
