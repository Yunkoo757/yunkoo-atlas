import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_ASSET_BYTES = 32 * 1024 * 1024
const SAFE_ASSET_ID = /^[A-Za-z0-9_-]{1,128}$/
const SAFE_SHA256 = /^[a-f0-9]{64}$/
const SAFE_MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i
const REQUIRED_WORKSPACE_ENTITIES = [
  'collections',
  'display',
  'shortcuts',
  'tags',
  'profile',
  'saved-trade-views',
  'symbols',
]

function json(response, statusCode, body) {
  const payload = JSON.stringify(body)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

function authorized(header, token) {
  const actual = Buffer.from(typeof header === 'string' ? header : '')
  const expected = Buffer.from(`Bearer ${token}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('request too large'), { statusCode: 413 })
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw Object.assign(new Error('invalid json'), { statusCode: 400 })
  }
}

async function readBytes(request, maximum = MAX_ASSET_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > maximum) throw Object.assign(new Error('request too large'), { statusCode: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function text(value, field) {
  if (typeof value !== 'string' || !value || value.length > 256) {
    throw Object.assign(new Error(`invalid ${field}`), { statusCode: 400 })
  }
  return value
}

function integer(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw Object.assign(new Error(`invalid ${field}`), { statusCode: 400 })
  }
  return value
}

function timestamp(value, field) {
  const result = text(value, field)
  if (!Number.isFinite(Date.parse(result))) {
    throw Object.assign(new Error(`invalid ${field}`), { statusCode: 400 })
  }
  return result
}

function ensureLibrary(database, libraryId, epoch) {
  const row = database.prepare(
    'SELECT epoch FROM libraries WHERE library_id = ?',
  ).get(libraryId)
  if (!row) throw Object.assign(new Error('library not registered'), { statusCode: 404 })
  if (Number(row.epoch) !== epoch) {
    throw Object.assign(new Error('library epoch mismatch'), { statusCode: 409 })
  }
}

function assetId(value) {
  if (typeof value !== 'string' || !SAFE_ASSET_ID.test(value)) {
    throw Object.assign(new Error('invalid assetId'), { statusCode: 400 })
  }
  return value
}

function assetMime(value) {
  if (typeof value !== 'string' || value.length > 128 || !SAFE_MIME.test(value)) {
    throw Object.assign(new Error('invalid content-type'), { statusCode: 400 })
  }
  return value.toLowerCase()
}

function assetSha256(value) {
  if (typeof value !== 'string' || !SAFE_SHA256.test(value)) {
    throw Object.assign(new Error('invalid x-asset-sha256'), { statusCode: 400 })
  }
  return value
}

function assetFilePath(assetRoot, libraryId, epoch, id) {
  const libraryDirectory = createHash('sha256').update(libraryId).digest('hex')
  return path.join(assetRoot, libraryDirectory, String(epoch), id)
}

function removeAssetFile(assetRoot, filePath) {
  const resolvedRoot = path.resolve(assetRoot)
  const resolvedFile = path.resolve(filePath)
  const relative = path.relative(resolvedRoot, resolvedFile)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return
  }
  try {
    fs.rmSync(resolvedFile, { force: true })
  } catch (error) {
    console.warn('Failed to remove superseded asset file', error)
  }
}

function validateOperation(raw, requestDeviceId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw Object.assign(new Error('invalid operation'), { statusCode: 400 })
  }
  const operation = {
    opId: text(raw.opId, 'operation.opId'),
    deviceId: text(raw.deviceId, 'operation.deviceId'),
    deviceSeq: integer(raw.deviceSeq, 'operation.deviceSeq'),
    entityType: text(raw.entityType, 'operation.entityType'),
    entityId: text(raw.entityId, 'operation.entityId'),
    kind: text(raw.kind, 'operation.kind'),
    baseRevision: integer(raw.baseRevision, 'operation.baseRevision'),
    revision: integer(raw.revision, 'operation.revision'),
    payload: raw.payload ?? null,
    createdAt: timestamp(raw.createdAt, 'operation.createdAt'),
  }
  if (operation.deviceId !== requestDeviceId) {
    throw Object.assign(new Error('operation device mismatch'), { statusCode: 400 })
  }
  if (!['trade', 'strategy', 'workspace'].includes(operation.entityType)) {
    throw Object.assign(new Error('invalid operation.entityType'), { statusCode: 400 })
  }
  if (!['upsert', 'delete'].includes(operation.kind)) {
    throw Object.assign(new Error('invalid operation.kind'), { statusCode: 400 })
  }
  return operation
}

export function createAtlasSyncServer({ databasePath, token, assetRoot = `${databasePath}.assets` }) {
  if (typeof token !== 'string' || token.length < 20) throw new Error('ATLAS_SYNC_TOKEN is too short')
  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS libraries (
      library_id TEXT PRIMARY KEY,
      epoch INTEGER NOT NULL,
      ready INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entity_versions (
      library_id TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      PRIMARY KEY (library_id, epoch, entity_type, entity_id)
    );
    CREATE TABLE IF NOT EXISTS operations (
      cursor INTEGER PRIMARY KEY AUTOINCREMENT,
      library_id TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      operation_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_seq INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation_kind TEXT NOT NULL,
      base_revision INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (library_id, epoch, operation_id),
      UNIQUE (library_id, epoch, device_id, device_seq)
    );
    CREATE INDEX IF NOT EXISTS operations_pull
      ON operations (library_id, epoch, cursor);
    CREATE TABLE IF NOT EXISTS assets (
      library_id TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      asset_id TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      mime TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (library_id, epoch, asset_id)
    );
  `)
  const libraryColumns = database.prepare('PRAGMA table_info(libraries)').all()
  if (!libraryColumns.some((column) => column.name === 'ready')) {
    database.exec('ALTER TABLE libraries ADD COLUMN ready INTEGER NOT NULL DEFAULT 1')
  }

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === 'GET' && request.url === '/health') {
        json(response, 200, { status: 'ok' })
        return
      }
      if (!authorized(request.headers.authorization, token)) {
        json(response, 401, { error: 'unauthorized' })
        return
      }

      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      const assetMatch = requestUrl.pathname.match(/^\/v1\/assets\/([^/]+)$/)
      if (assetMatch && (request.method === 'GET' || request.method === 'PUT')) {
        const id = assetId(assetMatch[1])
        const libraryId = text(requestUrl.searchParams.get('libraryId'), 'libraryId')
        const epoch = integer(Number(requestUrl.searchParams.get('epoch')), 'epoch')
        ensureLibrary(database, libraryId, epoch)
        let existing = database.prepare(`
          SELECT sha256, mime, byte_size, file_path FROM assets
          WHERE library_id = ? AND epoch = ? AND asset_id = ?
        `).get(libraryId, epoch, id)

        if (request.method === 'GET') {
          if (!existing || !fs.existsSync(existing.file_path)) {
            throw Object.assign(new Error('asset not found'), { statusCode: 404 })
          }
          response.writeHead(200, {
            'content-type': existing.mime,
            'content-length': Number(existing.byte_size),
            etag: `\"${existing.sha256}\"`,
            'cache-control': 'private, max-age=31536000, immutable',
          })
          fs.createReadStream(existing.file_path).pipe(response)
          return
        }

        const expectedSha256 = assetSha256(request.headers['x-asset-sha256'])
        const mime = assetMime(request.headers['content-type'])
        const bytes = await readBytes(request)
        const actualSha256 = createHash('sha256').update(bytes).digest('hex')
        if (actualSha256 !== expectedSha256) {
          throw Object.assign(new Error('asset checksum mismatch'), { statusCode: 400 })
        }
        existing = database.prepare(`
          SELECT sha256, mime, byte_size, file_path FROM assets
          WHERE library_id = ? AND epoch = ? AND asset_id = ?
        `).get(libraryId, epoch, id)
        if (existing && existing.sha256 !== actualSha256) {
          throw Object.assign(new Error('asset id conflict'), { statusCode: 409 })
        }

        const filePath = assetFilePath(assetRoot, libraryId, epoch, id)
        const created = !existing
        if (!existing || !fs.existsSync(filePath)) {
          fs.mkdirSync(path.dirname(filePath), { recursive: true })
          const temporaryPath = `${filePath}.${randomUUID()}.tmp`
          try {
            fs.writeFileSync(temporaryPath, bytes, { flag: 'wx' })
            fs.renameSync(temporaryPath, filePath)
          } finally {
            fs.rmSync(temporaryPath, { force: true })
          }
        }
        if (!existing) {
          database.prepare(`
            INSERT INTO assets (
              library_id, epoch, asset_id, sha256, mime, byte_size, file_path, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            libraryId, epoch, id, actualSha256, mime, bytes.byteLength, filePath,
            new Date().toISOString(),
          )
        }
        json(response, 200, {
          created,
          id,
          sha256: existing?.sha256 ?? actualSha256,
          mime: existing?.mime ?? mime,
          byteSize: Number(existing?.byte_size ?? bytes.byteLength),
        })
        return
      }

      if (request.method !== 'POST') {
        json(response, 404, { error: 'not found' })
        return
      }
      const body = await readJson(request)
      const libraryId = text(body.libraryId, 'libraryId')
      const epoch = integer(body.epoch, 'epoch')

      if (request.url === '/v1/libraries/register') {
        const existing = database.prepare(
          'SELECT epoch FROM libraries WHERE library_id = ?',
        ).get(libraryId)
        if (existing && Number(existing.epoch) !== epoch) {
          throw Object.assign(new Error('library epoch mismatch'), { statusCode: 409 })
        }
        if (!existing) {
          database.prepare(
            'INSERT INTO libraries (library_id, epoch, ready, created_at) VALUES (?, ?, 0, ?)',
          ).run(libraryId, epoch, new Date().toISOString())
        }
        json(response, 200, { created: !existing })
        return
      }

      if (request.url === '/v1/libraries/status') {
        const existing = database.prepare(
          'SELECT epoch FROM libraries WHERE library_id = ?',
        ).get(libraryId)
        if (existing && Number(existing.epoch) !== epoch) {
          throw Object.assign(new Error('library epoch mismatch'), { statusCode: 409 })
        }
        json(response, 200, { exists: Boolean(existing) })
        return
      }

      if (request.url === '/v1/libraries/epoch') {
        const existing = database.prepare(
          'SELECT epoch, ready FROM libraries WHERE library_id = ?',
        ).get(libraryId)
        json(response, 200, {
          exists: Boolean(existing),
          epoch: existing ? Number(existing.epoch) : null,
          ready: existing ? Boolean(existing.ready) : false,
        })
        return
      }

      if (request.url === '/v1/libraries/reset') {
        if (body.confirm !== 'replace') {
          throw Object.assign(new Error('library reset confirmation missing'), { statusCode: 400 })
        }
        const nextEpoch = integer(body.nextEpoch, 'nextEpoch')
        if (nextEpoch !== epoch + 1) {
          throw Object.assign(new Error('nextEpoch must advance exactly once'), { statusCode: 400 })
        }
        const existing = database.prepare(
          'SELECT epoch FROM libraries WHERE library_id = ?',
        ).get(libraryId)
        if (!existing) throw Object.assign(new Error('library not registered'), { statusCode: 404 })
        if (Number(existing.epoch) === nextEpoch) {
          json(response, 200, { reset: false, epoch: nextEpoch })
          return
        }
        if (Number(existing.epoch) !== epoch) {
          throw Object.assign(new Error('library epoch mismatch'), { statusCode: 409 })
        }
        const oldAssetPaths = database.prepare(
          'SELECT file_path FROM assets WHERE library_id = ?',
        ).all(libraryId).map((row) => row.file_path)
        database.exec('BEGIN IMMEDIATE')
        try {
          database.prepare('DELETE FROM operations WHERE library_id = ?').run(libraryId)
          database.prepare('DELETE FROM entity_versions WHERE library_id = ?').run(libraryId)
          database.prepare('DELETE FROM assets WHERE library_id = ?').run(libraryId)
          database.prepare('UPDATE libraries SET epoch = ?, ready = 0 WHERE library_id = ?')
            .run(nextEpoch, libraryId)
          database.exec('COMMIT')
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        }
        for (const filePath of oldAssetPaths) removeAssetFile(assetRoot, filePath)
        json(response, 200, { reset: true, epoch: nextEpoch })
        return
      }

      if (request.url === '/v1/libraries/finalize') {
        ensureLibrary(database, libraryId, epoch)
        const workspaceEntities = new Set(database.prepare(`
          SELECT entity_id FROM entity_versions
          WHERE library_id = ? AND epoch = ? AND entity_type = 'workspace'
        `).all(libraryId, epoch).map((row) => row.entity_id))
        if (REQUIRED_WORKSPACE_ENTITIES.some((entityId) => !workspaceEntities.has(entityId))) {
          throw Object.assign(new Error('library bootstrap incomplete'), { statusCode: 409 })
        }
        database.prepare('UPDATE libraries SET ready = 1 WHERE library_id = ?').run(libraryId)
        json(response, 200, { ready: true, epoch })
        return
      }

      ensureLibrary(database, libraryId, epoch)
      if (request.url === '/v1/assets/status') {
        if (!Array.isArray(body.assetIds) || body.assetIds.length > 500) {
          throw Object.assign(new Error('invalid assetIds'), { statusCode: 400 })
        }
        const assetIds = body.assetIds.map(assetId)
        if (assetIds.length === 0) {
          json(response, 200, { assets: [] })
          return
        }
        const placeholders = assetIds.map(() => '?').join(', ')
        const rows = database.prepare(`
          SELECT asset_id, sha256, mime, byte_size, file_path FROM assets
          WHERE library_id = ? AND epoch = ? AND asset_id IN (${placeholders})
        `).all(libraryId, epoch, ...assetIds)
        const availableRows = []
        const unavailableRows = []
        for (const row of rows) {
          try {
            const stats = fs.statSync(row.file_path)
            if (stats.isFile() && stats.size === Number(row.byte_size)) {
              availableRows.push(row)
            } else {
              unavailableRows.push(row)
            }
          } catch {
            unavailableRows.push(row)
          }
        }
        if (unavailableRows.length > 0) {
          const removeUnavailable = database.prepare(`
            DELETE FROM assets
            WHERE library_id = ? AND epoch = ? AND asset_id = ?
          `)
          database.exec('BEGIN IMMEDIATE')
          try {
            for (const row of unavailableRows) {
              removeUnavailable.run(libraryId, epoch, row.asset_id)
            }
            database.exec('COMMIT')
          } catch (error) {
            database.exec('ROLLBACK')
            throw error
          }
        }
        const byId = new Map(availableRows.map((row) => [row.asset_id, row]))
        json(response, 200, {
          assets: assetIds.flatMap((id) => {
            const row = byId.get(id)
            return row ? [{
              id,
              sha256: row.sha256,
              mime: row.mime,
              byteSize: Number(row.byte_size),
            }] : []
          }),
        })
        return
      }
      if (request.url === '/v1/metadata/push') {
        const deviceId = text(body.deviceId, 'deviceId')
        if (!Array.isArray(body.operations) || body.operations.length > 200) {
          throw Object.assign(new Error('invalid operations'), { statusCode: 400 })
        }
        const operations = body.operations.map((item) => validateOperation(item, deviceId))
        const acknowledgedOperationIds = []
        database.exec('BEGIN IMMEDIATE')
        try {
          for (const operation of operations) {
            const replay = database.prepare(`
              SELECT 1 FROM operations
              WHERE library_id = ? AND epoch = ? AND operation_id = ?
            `).get(libraryId, epoch, operation.opId)
            if (replay) {
              acknowledgedOperationIds.push(operation.opId)
              continue
            }
            const reusedSequence = database.prepare(`
              SELECT 1 FROM operations
              WHERE library_id = ? AND epoch = ? AND device_id = ? AND device_seq = ?
            `).get(libraryId, epoch, operation.deviceId, operation.deviceSeq)
            if (reusedSequence) continue
            const version = database.prepare(`
              SELECT revision FROM entity_versions
              WHERE library_id = ? AND epoch = ? AND entity_type = ? AND entity_id = ?
            `).get(libraryId, epoch, operation.entityType, operation.entityId)
            const currentRevision = Number(version?.revision ?? 0)
            if (
              currentRevision !== operation.baseRevision
              || operation.revision !== operation.baseRevision + 1
            ) continue
            database.prepare(`
              INSERT INTO operations (
                library_id, epoch, operation_id, device_id, device_seq,
                entity_type, entity_id, operation_kind, base_revision,
                revision, payload_json, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              libraryId, epoch, operation.opId, operation.deviceId, operation.deviceSeq,
              operation.entityType, operation.entityId, operation.kind, operation.baseRevision,
              operation.revision, JSON.stringify(operation.payload), operation.createdAt,
            )
            database.prepare(`
              INSERT INTO entity_versions (
                library_id, epoch, entity_type, entity_id, revision
              ) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (library_id, epoch, entity_type, entity_id)
              DO UPDATE SET revision = excluded.revision
            `).run(libraryId, epoch, operation.entityType, operation.entityId, operation.revision)
            acknowledgedOperationIds.push(operation.opId)
          }
          database.exec('COMMIT')
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        }
        json(response, 200, { acknowledgedOperationIds })
        return
      }

      if (request.url === '/v1/metadata/pull') {
        text(body.deviceId, 'deviceId')
        const afterCursor = body.afterCursor === null
          ? 0
          : integer(Number(body.afterCursor), 'afterCursor')
        const limit = integer(body.limit, 'limit', 500)
        if (limit < 1) throw Object.assign(new Error('invalid limit'), { statusCode: 400 })
        const rows = database.prepare(`
          SELECT * FROM operations
          WHERE library_id = ? AND epoch = ? AND cursor > ?
          ORDER BY cursor ASC
          LIMIT ?
        `).all(libraryId, epoch, afterCursor, limit + 1)
        const hasMore = rows.length > limit
        const page = rows.slice(0, limit)
        const operations = page.map((row) => ({
          cursor: String(row.cursor),
          opId: row.operation_id,
          deviceId: row.device_id,
          deviceSeq: Number(row.device_seq),
          entityType: row.entity_type,
          entityId: row.entity_id,
          kind: row.operation_kind,
          baseRevision: Number(row.base_revision),
          revision: Number(row.revision),
          payload: JSON.parse(row.payload_json),
          createdAt: row.created_at,
          state: 'pending',
        }))
        json(response, 200, {
          operations,
          nextCursor: operations.at(-1)?.cursor ?? String(afterCursor),
          hasMore,
        })
        return
      }
      json(response, 404, { error: 'not found' })
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500
      json(response, statusCode, {
        error: statusCode === 500 ? 'internal server error' : error.message,
      })
    }
  })

  return {
    async listen({ host = '127.0.0.1', port = 0 } = {}) {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, resolve)
      })
      return server.address()
    },
    async close() {
      if (server.listening) {
        server.closeIdleConnections?.()
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      }
      database.close()
    },
  }
}
