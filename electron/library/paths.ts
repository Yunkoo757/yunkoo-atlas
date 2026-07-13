import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { writeFileAtomicallySync } from './atomicFile'

const CONFIG_FILE = 'library-config.json'

function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

export interface LibraryConfig {
  libraryPath: string
}

export function readLibraryConfig(): LibraryConfig | null {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8')
    const cfg = JSON.parse(raw) as LibraryConfig
    if (cfg.libraryPath && fs.existsSync(cfg.libraryPath)) return cfg
    return null
  } catch {
    return null
  }
}

export function saveLibraryConfig(cfg: LibraryConfig): void {
  fs.mkdirSync(path.dirname(getConfigPath()), { recursive: true })
  writeFileAtomicallySync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf8')
}

export function getDefaultLibraryPath(): string {
  return path.join(app.getPath('documents'), 'Yunkoo Atlas')
}

export function getLibraryPath(): string {
  const custom = process.env.LINEAR_JOURNAL_LIBRARY
  if (process.env.LINEAR_JOURNAL_QA === '1' && custom) return path.resolve(custom)
  const saved = readLibraryConfig()
  if (saved) return saved.libraryPath
  return custom ? path.resolve(custom) : getDefaultLibraryPath()
}

export function ensureLibraryDirs(libraryPath: string): {
  root: string
  attachments: string
  backups: string
  dbFile: string
  manifestFile: string
} {
  const attachments = path.join(libraryPath, 'attachments')
  const backups = path.join(libraryPath, 'backups')
  fs.mkdirSync(attachments, { recursive: true })
  fs.mkdirSync(backups, { recursive: true })
  return {
    root: libraryPath,
    attachments,
    backups,
    dbFile: path.join(libraryPath, 'journal.db'),
    manifestFile: path.join(libraryPath, 'manifest.json'),
  }
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
