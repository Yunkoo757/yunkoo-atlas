import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ensureLibraryDirs } from './paths'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testEnsureLibraryDirsRejectsLinkedManagedDirectory(): void {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-managed-link-'))
  const root = path.join(parent, 'library')
  const outside = path.join(parent, 'outside')
  try {
    fs.mkdirSync(root)
    fs.mkdirSync(outside)
    const link = path.join(root, 'attachments')
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    let rejected = false
    try { ensureLibraryDirs(root) } catch { rejected = true }
    assert(rejected, 'attachments 指向库外目录时必须拒绝开库')
    assert(fs.readdirSync(outside).length === 0, '拒绝过程中不得修改库外目录')
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
}

export function testEnsureLibraryDirsCreatesOnlyKnownDirectChildren(): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-managed-create-'))
  try {
    const paths = ensureLibraryDirs(root)
    assert(fs.statSync(paths.attachments).isDirectory(), '必须创建 attachments')
    assert(fs.statSync(paths.backups).isDirectory(), '必须创建 backups')
    assert(fs.readdirSync(root).sort().join(',') === 'attachments,backups', '不得创建未知受管目录')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
