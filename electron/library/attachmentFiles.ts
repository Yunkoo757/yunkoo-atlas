import fs from 'node:fs'
import path from 'node:path'
import { fsyncDirectorySync, fsyncFileSync } from './atomicFile'
import { sha256File } from './fileChecksum'
import { clearManagedFlatDirectory } from './managedPaths'

export interface DeclaredAttachment {
  fileName: string
  byteSize: number
}

/** 按同一个 SQLite 索引核实源文件。消费者按此摘要证明实际写出的内容。 */
export function captureDeclaredAttachment(directory: string, declared: DeclaredAttachment) {
  const { fileName, byteSize } = declared
  if (!fileName || path.basename(fileName) !== fileName) throw new Error(`附件路径不安全：${fileName}`)
  const sourceFile = path.join(directory, fileName)
  const stat = fs.lstatSync(sourceFile, { throwIfNoEntry: false })
  if (!stat?.isFile() || stat.size !== byteSize) throw new Error(`附件缺失或不完整（${fileName}）`)
  return { fileName, byteSize, sourceFile, sha256: sha256File(sourceFile) }
}

export function copyLibraryAttachments(
  source: string,
  destination: string,
  options: { durable?: boolean; checksum?: boolean } = {},
): Array<{ fileName: string; sha256: string }> {
  const files: Array<{ name: string; sourceFile: string }> = []
  if (fs.existsSync(source)) {
    const sourceStat = fs.lstatSync(source)
    if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) {
      throw new Error('Attachment source must be a regular directory')
    }
  }
  for (const name of fs.existsSync(source) ? fs.readdirSync(source) : []) {
    const sourceFile = path.join(source, name)
    const fileStat = fs.lstatSync(sourceFile)
    if (fileStat.isSymbolicLink()) {
      throw new Error(`Attachment source must not contain symbolic links (${name})`)
    }
    if (!fileStat.isFile()) {
      throw new Error(`Attachment source must contain regular files only (${name})`)
    }
    files.push({ name, sourceFile })
  }

  clearManagedFlatDirectory(path.dirname(destination), destination, path.basename(destination))
  for (const file of files) {
    const destinationFile = path.join(destination, file.name)
    fs.copyFileSync(file.sourceFile, destinationFile)
    if (options.durable) fsyncFileSync(destinationFile)
  }
  if (options.durable) fsyncDirectorySync(destination)
  return options.checksum
    ? files.map(({ name }) => ({
        fileName: name,
        sha256: sha256File(path.join(destination, name)),
      }))
    : []
}
