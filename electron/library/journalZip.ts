import fs from 'node:fs'
import path from 'node:path'
import { ZipArchive } from 'archiver'
import extract from 'extract-zip'
import type { LibraryStorage } from './storage'
import { ensureLibraryDirs } from './paths'

export async function exportJournalZip(
  storage: LibraryStorage,
  destinationFile: string,
): Promise<void> {
  const paths = storage.getPaths()
  fs.mkdirSync(path.dirname(destinationFile), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(destinationFile)
    const archive = new ZipArchive({ zlib: { level: 9 } })

    output.on('close', () => resolve())
    archive.on('error', reject)
    archive.pipe(output)

    archive.file(paths.manifestFile, { name: 'manifest.json' })
    archive.file(paths.dbFile, { name: 'journal.db' })

    if (fs.existsSync(paths.attachments)) {
      archive.directory(paths.attachments, 'attachments')
    }

    void archive.finalize()
  })
}

export async function importJournalZipToPath(
  libraryRoot: string,
  zipFile: string,
): Promise<void> {
  const paths = ensureLibraryDirs(libraryRoot)
  const tempDir = path.join(libraryRoot, `.import-${Date.now()}`)
  fs.mkdirSync(tempDir, { recursive: true })

  try {
    await extract(zipFile, { dir: tempDir })

    const manifestSrc = path.join(tempDir, 'manifest.json')
    const dbSrc = path.join(tempDir, 'journal.db')
    const attachmentsSrc = path.join(tempDir, 'attachments')

    if (!fs.existsSync(manifestSrc) || !fs.existsSync(dbSrc)) {
      throw new Error('无效的 .journal.zip：缺少 manifest.json 或 journal.db')
    }

    fs.copyFileSync(manifestSrc, paths.manifestFile)
    fs.copyFileSync(dbSrc, paths.dbFile)

    if (fs.existsSync(paths.attachments)) {
      for (const name of fs.readdirSync(paths.attachments)) {
        fs.unlinkSync(path.join(paths.attachments, name))
      }
    } else {
      fs.mkdirSync(paths.attachments, { recursive: true })
    }

    if (fs.existsSync(attachmentsSrc)) {
      for (const name of fs.readdirSync(attachmentsSrc)) {
        fs.copyFileSync(path.join(attachmentsSrc, name), path.join(paths.attachments, name))
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}
