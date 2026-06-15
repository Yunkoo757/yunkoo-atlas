import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

export function getDefaultLibraryPath(): string {
  return path.join(app.getPath('documents'), 'Linear Journal')
}

export function getLibraryPath(): string {
  const custom = process.env.LINEAR_JOURNAL_LIBRARY
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
