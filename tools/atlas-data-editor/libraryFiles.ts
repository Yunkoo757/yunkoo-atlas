import type { Database, SqlJsStatic } from 'sql.js'
import { CREATE_LIBRARY_TABLES_SQL, isPortableAssetFileName, resolveSnapshotVersion, validateLibraryAssetIndex } from '../../src/storage/libraryDatabase'
import type { LibraryManifest } from '../../src/storage/types'
import { decode, SCHEMA_VERSION, validate, type EditorSnapshot } from './core'

interface EditorAsset {
  id: string
  mime: string
  file_name: string
  byte_size: number
  created_at: string
}

export interface EditorSource {
  directory: FileSystemDirectoryHandle
  assets: EditorAsset[]
}

const recoveryFile = 'editor-export-state.json'
const recoveryFormat = 'atlas-editor-export-v1'

async function readBytes(directory: FileSystemDirectoryHandle, name: string) {
  const handle = await directory.getFileHandle(name)
  return new Uint8Array(await (await handle.getFile()).arrayBuffer())
}

async function readManifestVersion(directory: FileSystemDirectoryHandle): Promise<number> {
  let bytes
  try {
    bytes = await readBytes(directory, 'manifest.json')
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
    const recovery = JSON.parse(new TextDecoder().decode(await readBytes(directory, recoveryFile)))
    if (recovery.format !== recoveryFormat) throw new Error('未找到有效的导出恢复记录')
    return Number(recovery.manifest.schemaVersion)
  }
  return Number(JSON.parse(new TextDecoder().decode(bytes)).schemaVersion)
}

function readSnapshot(db: Database, manifestVersion: number): EditorSnapshot {
  const rows = db.exec("SELECT key, value FROM meta WHERE key IN ('snapshot', 'schemaVersion')")[0]?.values ?? []
  const meta = Object.fromEntries(rows)
  const raw = JSON.parse(String(meta.snapshot))
  const databaseVersion = meta.schemaVersion == null ? null : Number(meta.schemaVersion)
  const snapshot = decode(raw, resolveSnapshotVersion(raw, databaseVersion, manifestVersion))
  validate(snapshot)
  return snapshot
}

export async function openEditorLibrary(sql: SqlJsStatic, directory: FileSystemDirectoryHandle) {
  const db = new sql.Database(await readBytes(directory, 'journal.db'))
  try {
    const snapshot = readSnapshot(db, await readManifestVersion(directory))
    const assets: EditorAsset[] = []
    const statement = db.prepare('SELECT * FROM assets')
    while (statement.step()) {
      const row = statement.getAsObject()
      const { id, mime, file_name, byte_size, created_at } = row
      if (typeof id !== 'string' || typeof mime !== 'string' || typeof file_name !== 'string' ||
          typeof byte_size !== 'number' || typeof created_at !== 'string') {
        throw new Error('资料库附件索引字段类型不符')
      }
      assets.push({ ...row, id, mime, file_name, byte_size, created_at })
    }
    return { source: { directory, assets }, snapshot }
  } finally {
    db.close()
  }
}

export async function readEditorAsset(source: EditorSource, asset: EditorAsset): Promise<File> {
  if (!isPortableAssetFileName(asset.id, asset.file_name)) throw new Error('附件文件名不兼容桌面资料库')
  const directory = await source.directory.getDirectoryHandle('attachments')
  const file = await (await directory.getFileHandle(asset.file_name)).getFile()
  if (file.size !== asset.byte_size) throw new Error(`附件尺寸不符：${asset.file_name}`)
  return file
}

export async function checkEditorLibrary(source: EditorSource, snapshot: EditorSnapshot) {
  validate(snapshot)
  const ids = validateLibraryAssetIndex(source.assets.map(asset => ({ id: asset.id, fileName: asset.file_name })))
  // The offline editor also retains extension fields outside the known rich-text records.
  for (const match of JSON.stringify(snapshot).matchAll(/journal-asset:\/\/([^"'\s<>\\]+)/g)) {
    if (!ids.has(match[1])) throw new Error(`缺失附件登记：${match[1]}`)
  }
  for (const asset of source.assets) await readEditorAsset(source, asset)
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
}

async function writeFile(handle: FileSystemFileHandle, data: FileSystemWriteChunkType) {
  const writer = await handle.createWritable()
  try {
    await writer.write(data)
    await writer.close()
  } catch (error) {
    await writer.abort().catch(() => {})
    throw error
  }
}

async function writeNewFile(directory: FileSystemDirectoryHandle, name: string, data: FileSystemWriteChunkType) {
  try {
    await directory.getFileHandle(name)
    throw new Error(`导出目标已存在：${name}`)
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
  }
  const handle = await directory.getFileHandle(name, { create: true })
  await writeFile(handle, data)
  return handle
}

function encodeDatabase(sql: SqlJsStatic, snapshot: EditorSnapshot, assets: EditorAsset[]) {
  const db = new sql.Database()
  try {
    db.run(CREATE_LIBRARY_TABLES_SQL)
    for (const [key, value] of Object.entries({
      schemaVersion: String(SCHEMA_VERSION), snapshot: JSON.stringify(snapshot), snapshotRevision: '1',
    })) db.run('INSERT INTO meta (key, value) VALUES (?, ?)', [key, value])
    for (const asset of assets) {
      db.run('INSERT INTO assets (id, mime, file_name, byte_size, created_at) VALUES (?,?,?,?,?)',
        [asset.id, asset.mime, asset.file_name, asset.byte_size, asset.created_at])
    }
    return db.export()
  } finally {
    db.close()
  }
}

export async function exportEditorLibrary(
  sql: SqlJsStatic, source: EditorSource, snapshot: EditorSnapshot,
  destination: FileSystemDirectoryHandle, report: (message: string) => void,
) {
  if (await destination.isSameEntry(source.directory) || await source.directory.resolve(destination) !== null ||
      await destination.resolve(source.directory) !== null) {
    throw new Error('请选择源资料库之外的独立空目录。')
  }
  async function requireEmptyDestination() {
    for await (const _ of destination.values()) throw new Error('导出目录必须为空，请选择新的空目录。')
  }
  await requireEmptyDestination()
  await checkEditorLibrary(source, snapshot)
  const manifest: LibraryManifest = {
    schemaVersion: SCHEMA_VERSION, libraryId: crypto.randomUUID(), createdAt: new Date().toISOString(), platform: 'electron',
  }
  let phase = '保存编辑副本'
  let copied = 0
  let recoveryHandle: FileSystemFileHandle | undefined
  const state = () => JSON.stringify({
    format: recoveryFormat, status: 'incomplete', phase, copiedAssets: copied, totalAssets: source.assets.length, manifest,
  }, null, 2)
  try {
    const bytes = encodeDatabase(sql, snapshot, source.assets)
    await requireEmptyDestination()
    recoveryHandle = await writeNewFile(destination, recoveryFile, state())
    // sql.js exports a standalone Uint8Array from its in-memory filesystem.
    await writeNewFile(destination, 'journal.db', bytes as Uint8Array<ArrayBuffer>)
    const attachments = await destination.getDirectoryHandle('attachments', { create: true })
    phase = '复制附件'
    for (const asset of source.assets) {
      report(`正在导出到 ${destination.name} · 复制附件 ${copied + 1} / ${source.assets.length}`)
      const file = await readEditorAsset(source, asset)
      await writeNewFile(attachments, asset.file_name, file)
      if (!equalBytes(await readBytes(attachments, asset.file_name), new Uint8Array(await file.arrayBuffer()))) {
        throw new Error(`附件复制校验失败：${asset.file_name}`)
      }
      copied++
    }
    phase = '核验数据库'
    report(`正在导出到 ${destination.name} · 核验数据库`)
    const saved = await readBytes(destination, 'journal.db')
    if (!equalBytes(saved, bytes)) throw new Error('数据库回读与本次导出不一致')
    const reopened = new sql.Database(saved)
    try {
      if (reopened.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] !== 'ok') throw new Error('导出数据库完整性检查失败')
      readSnapshot(reopened, SCHEMA_VERSION)
    } finally {
      reopened.close()
    }
    phase = '写入清单'
    const manifestText = JSON.stringify(manifest, null, 2)
    await writeNewFile(destination, 'manifest.json', manifestText)
    if (new TextDecoder().decode(await readBytes(destination, 'manifest.json')) !== manifestText) throw new Error('清单回读校验失败')
    return copied
  } catch (error) {
    if (recoveryHandle) await writeFile(recoveryHandle, state()).catch(() => {})
    throw new Error(`导出未完成（${destination.name} / ${phase}，附件 ${copied}/${source.assets.length}）：${error instanceof Error ? error.message : String(error)}。请保留本页修改；该目录尚不可在 Atlas 打开。`)
  }
}
