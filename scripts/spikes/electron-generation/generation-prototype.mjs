import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const MiB = 1024 * 1024

export const CUTOVER_FAULT_POINTS = [
  'precheck:initial',
  'mkdir:generation',
  'write:manifest',
  'fsync:manifest',
  'mkdir:attachments',
  'write:database',
  'fsync:database',
  'write:attachment',
  'fsync:attachment',
  'write:complete-marker',
  'fsync:complete-marker',
  'dir-fsync:generation',
  'precheck:switch',
  'write:pointer-temp',
  'fsync:pointer-temp',
  'rename:pointer',
  'dir-fsync:root',
]

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function fileBytes(filePath) {
  return fs.readFileSync(filePath)
}

function syncFile(filePath) {
  const descriptor = fs.openSync(filePath, 'r+')
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

export function syncDirectory(directory) {
  if (process.platform === 'win32') return false
  const descriptor = fs.openSync(directory, 'r')
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
  return true
}

function writeFile(filePath, bytes) {
  const descriptor = fs.openSync(filePath, 'wx')
  try {
    fs.writeFileSync(descriptor, bytes)
  } finally {
    fs.closeSync(descriptor)
  }
}

function listTreeBytes(directory) {
  let total = 0
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) total += listTreeBytes(entryPath)
    else if (entry.isFile()) total += fs.statSync(entryPath).size
  }
  return total
}

function freeBytes(directory) {
  const stats = fs.statfsSync(directory, { bigint: true })
  return Number(stats.bavail * stats.bsize)
}

export function diskBudget({ expandedTemp, rollbackCopy, operationBytes }) {
  const safetyReserve = Math.max(512 * MiB, Math.ceil(operationBytes * 0.1))
  return {
    expandedTemp,
    rollbackCopy,
    operationBytes,
    safetyReserve,
    requiredFree: expandedTemp + rollbackCopy + safetyReserve,
  }
}

export function generationPayload(id, label, databaseBytes = MiB, attachmentBytes = MiB) {
  const manifest = jsonBytes({ id, label, attachment: 'asset.bin' })
  const database = Buffer.alloc(databaseBytes, label.charCodeAt(0))
  const attachment = Buffer.alloc(attachmentBytes, label.charCodeAt(label.length - 1))
  return { id, label, manifest, database, attachment }
}

function generationEntries(payload) {
  return [
    ['manifest.json', payload.manifest],
    ['journal.db', payload.database],
    ['attachments/asset.bin', payload.attachment],
  ]
}

function completeMarker(payload, ordinal) {
  return {
    version: 1,
    generation: payload.id,
    ordinal,
    files: Object.fromEntries(generationEntries(payload).map(([name, bytes]) => [
      name,
      { bytes: bytes.length, sha256: sha256(bytes) },
    ])),
  }
}

function isCompleteGeneration(root, generation) {
  const generationRoot = path.join(root, 'generations', generation)
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(generationRoot, 'COMPLETE.json'), 'utf8'))
    if (marker.version !== 1 || marker.generation !== generation || !marker.files) return null
    for (const [name, expected] of Object.entries(marker.files)) {
      const bytes = fileBytes(path.join(generationRoot, name))
      if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) return null
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(generationRoot, 'manifest.json'), 'utf8'))
    if (manifest.id !== generation) return null
    return { generation, label: manifest.label, ordinal: marker.ordinal }
  } catch {
    return null
  }
}

export function recoverGeneration(root) {
  try {
    const pointer = JSON.parse(fs.readFileSync(path.join(root, 'CURRENT'), 'utf8'))
    const selected = isCompleteGeneration(root, pointer.generation)
    if (selected) return { ...selected, source: 'current-marker' }
  } catch {
    // 缺失或损坏的 pointer 只能回退到已验证的完整 generation。
  }

  const candidates = fs.readdirSync(path.join(root, 'generations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => isCompleteGeneration(root, entry.name))
    .filter(Boolean)
    .sort((left, right) => left.ordinal - right.ordinal)
  if (candidates.length === 0) throw new Error('没有可恢复的完整 generation')
  return { ...candidates[0], source: 'validated-fallback' }
}

function seedGeneration(root, payload, ordinal) {
  const generationRoot = path.join(root, 'generations', payload.id)
  fs.mkdirSync(path.join(generationRoot, 'attachments'), { recursive: true })
  for (const [name, bytes] of generationEntries(payload)) {
    const filePath = path.join(generationRoot, name)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, bytes)
    syncFile(filePath)
  }
  fs.writeFileSync(path.join(generationRoot, 'COMPLETE.json'), jsonBytes(completeMarker(payload, ordinal)))
  syncFile(path.join(generationRoot, 'COMPLETE.json'))
}

export function initializePrototype(root, payload) {
  fs.mkdirSync(path.join(root, 'generations'), { recursive: true })
  seedGeneration(root, payload, 0)
  fs.writeFileSync(path.join(root, 'CURRENT'), jsonBytes({ version: 1, generation: payload.id }))
  syncFile(path.join(root, 'CURRENT'))
  return recoverGeneration(root)
}

function assertFreeSpace(root, budget, override) {
  const available = override ?? freeBytes(root)
  if (available < budget.requiredFree) {
    const error = new Error(`磁盘空间不足：${available} < ${budget.requiredFree}`)
    error.code = 'GENERATION_DISK_FULL'
    throw error
  }
  return available
}

export function commitGeneration(root, payload, options = {}) {
  const generationRoot = path.join(root, 'generations', payload.id)
  const pointerTemp = path.join(root, 'CURRENT.next')
  const expandedTemp = generationEntries(payload).reduce((sum, [, bytes]) => sum + bytes.length, 0)
  const budget = diskBudget({ expandedTemp, rollbackCopy: 0, operationBytes: expandedTemp })
  const steps = []
  let peakTreeBytes = listTreeBytes(root)
  let minimumFreeBytes = freeBytes(root)
  let directoryFsyncSupported = true

  const measure = () => {
    peakTreeBytes = Math.max(peakTreeBytes, listTreeBytes(root))
    minimumFreeBytes = Math.min(minimumFreeBytes, freeBytes(root))
  }
  const hit = (point) => {
    steps.push(point)
    if (options.injectAt === point) {
      const error = new Error(`injected failure at ${point}`)
      error.code = 'GENERATION_INJECTED'
      throw error
    }
  }
  const durableWrite = (name, bytes, writePoint, fsyncPoint) => {
    hit(writePoint)
    writeFile(path.join(generationRoot, name), bytes)
    measure()
    hit(fsyncPoint)
    syncFile(path.join(generationRoot, name))
  }

  const initialFreeBytes = freeBytes(root)
  try {
    hit('precheck:initial')
    assertFreeSpace(root, budget, options.initialFreeBytes)
    hit('mkdir:generation')
    fs.mkdirSync(generationRoot)
    measure()
    durableWrite('manifest.json', payload.manifest, 'write:manifest', 'fsync:manifest')
    hit('mkdir:attachments')
    fs.mkdirSync(path.join(generationRoot, 'attachments'))
    measure()
    durableWrite('journal.db', payload.database, 'write:database', 'fsync:database')
    durableWrite('attachments/asset.bin', payload.attachment, 'write:attachment', 'fsync:attachment')
    durableWrite('COMPLETE.json', jsonBytes(completeMarker(payload, 1)), 'write:complete-marker', 'fsync:complete-marker')
    hit('dir-fsync:generation')
    directoryFsyncSupported = syncDirectory(generationRoot) && syncDirectory(path.join(generationRoot, 'attachments'))
    hit('precheck:switch')
    assertFreeSpace(root, budget, options.switchFreeBytes)
    if (options.occupyPointerTemp) fs.mkdirSync(pointerTemp)
    hit('write:pointer-temp')
    writeFile(pointerTemp, jsonBytes({ version: 1, generation: payload.id }))
    measure()
    hit('fsync:pointer-temp')
    syncFile(pointerTemp)
    hit('rename:pointer')
    if (options.forceExdev) {
      const error = new Error('cross-device rename refused')
      error.code = 'EXDEV'
      throw error
    }
    fs.renameSync(pointerTemp, path.join(root, 'CURRENT'))
    measure()
    hit('dir-fsync:root')
    directoryFsyncSupported = syncDirectory(root) && directoryFsyncSupported
    return {
      ok: true,
      steps,
      budget,
      initialFreeBytes,
      minimumFreeBytes,
      peakTreeBytes,
      directoryFsyncSupported,
      recovered: recoverGeneration(root),
    }
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? 'GENERATION_ERROR',
      message: error instanceof Error ? error.message : String(error),
      steps,
      budget,
      initialFreeBytes,
      minimumFreeBytes,
      peakTreeBytes,
      directoryFsyncSupported,
      recovered: recoverGeneration(root),
    }
  } finally {
    try {
      if (fs.statSync(pointerTemp).isFile()) fs.rmSync(pointerTemp, { force: true })
    } catch {
      // 故障证据保留到场景目录删除前即可。
    }
  }
}

export function createScenarioRoot(baseDirectory, name) {
  const root = path.join(baseDirectory, `${name}-${randomUUID()}`)
  fs.mkdirSync(root, { recursive: true })
  return root
}
