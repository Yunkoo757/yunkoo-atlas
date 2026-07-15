import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { createAtlasSyncServer } from './app.mjs'

const TOKEN = 'test-token-with-enough-entropy'

test('docker build context excludes credentials and persisted sync data', () => {
  const dockerIgnore = fs.readFileSync(new URL('./.dockerignore', import.meta.url), 'utf8')
  assert.match(dockerIgnore, /^\*\*$/m)
  assert.match(dockerIgnore, /^!app\.mjs$/m)
  assert.match(dockerIgnore, /^!index\.mjs$/m)
  assert.doesNotMatch(dockerIgnore, /^!\.env$/m)
  assert.doesNotMatch(dockerIgnore, /^!data\/?$/m)
})

function operation(overrides = {}) {
  return {
    opId: 'op-1',
    deviceId: 'device-a',
    deviceSeq: 1,
    entityType: 'workspace',
    entityId: 'tags',
    kind: 'upsert',
    baseRevision: 0,
    revision: 1,
    payload: { tagPresets: ['A'], mistakeTagPresets: [] },
    createdAt: '2026-07-15T00:00:00.000Z',
    state: 'pending',
    ...overrides,
  }
}

function workspaceCheckpointOperations() {
  return [
    'collections',
    'display',
    'shortcuts',
    'tags',
    'profile',
    'saved-trade-views',
    'symbols',
  ].map((entityId, index) => operation({
    opId: `checkpoint-${entityId}`,
    deviceSeq: index + 1,
    entityId,
    payload: {},
  }))
}

async function startServer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sync-api-'))
  const instance = createAtlasSyncServer({
    databasePath: path.join(root, 'sync.db'),
    token: TOKEN,
  })
  const address = await instance.listen({ host: '127.0.0.1', port: 0 })
  return {
    ...instance,
    root,
    baseUrl: `http://127.0.0.1:${address.port}`,
  }
}

async function post(baseUrl, pathname, body, token = TOKEN) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  return { response, body: await response.json() }
}

test('a registered library round-trips an operation and retries idempotently', async () => {
  const server = await startServer()
  try {
    const registered = await post(server.baseUrl, '/v1/libraries/register', {
      libraryId: 'library-1',
      epoch: 1,
    })
    assert.equal(registered.response.status, 200)
    assert.deepEqual(registered.body, { created: true })

    const request = {
      libraryId: 'library-1',
      epoch: 1,
      deviceId: 'device-a',
      operations: [operation()],
    }
    const firstPush = await post(server.baseUrl, '/v1/metadata/push', request)
    const retriedPush = await post(server.baseUrl, '/v1/metadata/push', request)
    assert.deepEqual(firstPush.body, { acknowledgedOperationIds: ['op-1'] })
    assert.deepEqual(retriedPush.body, { acknowledgedOperationIds: ['op-1'] })

    const pulled = await post(server.baseUrl, '/v1/metadata/pull', {
      libraryId: 'library-1',
      epoch: 1,
      deviceId: 'device-b',
      afterCursor: null,
      limit: 500,
    })
    assert.equal(pulled.response.status, 200)
    assert.equal(pulled.body.operations.length, 1)
    assert.equal(pulled.body.operations[0].opId, 'op-1')
    assert.equal(pulled.body.operations[0].cursor, '1')
    assert.equal(pulled.body.nextCursor, '1')
    assert.equal(pulled.body.hasMore, false)
  } finally {
    await server.close()
    fs.rmSync(server.root, { recursive: true, force: true })
  }
})

test('a reused device sequence never creates a second operation', async () => {
  const server = await startServer()
  try {
    await post(server.baseUrl, '/v1/libraries/register', { libraryId: 'library-1', epoch: 1 })
    const first = await post(server.baseUrl, '/v1/metadata/push', {
      libraryId: 'library-1', epoch: 1, deviceId: 'device-a', operations: [operation()],
    })
    assert.equal(first.response.status, 200)

    const reusedSequence = await post(server.baseUrl, '/v1/metadata/push', {
      libraryId: 'library-1',
      epoch: 1,
      deviceId: 'device-a',
      operations: [operation({ opId: 'op-2', entityId: 'display' })],
    })
    assert.equal(reusedSequence.response.status, 200)
    assert.deepEqual(reusedSequence.body, { acknowledgedOperationIds: [] })

    const pulled = await post(server.baseUrl, '/v1/metadata/pull', {
      libraryId: 'library-1', epoch: 1, deviceId: 'device-b', afterCursor: null, limit: 500,
    })
    assert.deepEqual(pulled.body.operations.map((item) => item.opId), ['op-1'])
  } finally {
    await server.close()
    fs.rmSync(server.root, { recursive: true, force: true })
  }
})

test('invalid operation timestamps are rejected before they reach the log', async () => {
  const server = await startServer()
  try {
    await post(server.baseUrl, '/v1/libraries/register', { libraryId: 'library-1', epoch: 1 })
    const invalid = await post(server.baseUrl, '/v1/metadata/push', {
      libraryId: 'library-1',
      epoch: 1,
      deviceId: 'device-a',
      operations: [operation({ createdAt: 'not-a-timestamp' })],
    })
    assert.equal(invalid.response.status, 400)

    const pulled = await post(server.baseUrl, '/v1/metadata/pull', {
      libraryId: 'library-1', epoch: 1, deviceId: 'device-b', afterCursor: null, limit: 500,
    })
    assert.deepEqual(pulled.body.operations, [])
  } finally {
    await server.close()
    fs.rmSync(server.root, { recursive: true, force: true })
  }
})

test('checking a library never creates it as a side effect', async () => {
  const server = await startServer()
  try {
    const before = await post(server.baseUrl, '/v1/libraries/status', {
      libraryId: 'library-1', epoch: 1,
    })
    assert.equal(before.response.status, 200)
    assert.deepEqual(before.body, { exists: false })

    await post(server.baseUrl, '/v1/libraries/register', { libraryId: 'library-1', epoch: 1 })
    const after = await post(server.baseUrl, '/v1/libraries/status', {
      libraryId: 'library-1', epoch: 1,
    })
    assert.deepEqual(after.body, { exists: true })

    const pending = await post(server.baseUrl, '/v1/libraries/epoch', {
      libraryId: 'library-1', epoch: 0,
    })
    assert.deepEqual(pending.body, { exists: true, epoch: 1, ready: false })

    const prematureFinalize = await post(server.baseUrl, '/v1/libraries/finalize', {
      libraryId: 'library-1', epoch: 1,
    })
    assert.equal(prematureFinalize.response.status, 409)
    assert.deepEqual(prematureFinalize.body, { error: 'library bootstrap incomplete' })
  } finally {
    await server.close()
    fs.rmSync(server.root, { recursive: true, force: true })
  }
})

test('authentication and cursor pagination bound every metadata read', async () => {
  const server = await startServer()
  try {
    const unauthorized = await post(server.baseUrl, '/v1/libraries/status', {
      libraryId: 'library-1', epoch: 1,
    }, 'wrong-token-with-enough-length')
    assert.equal(unauthorized.response.status, 401)

    await post(server.baseUrl, '/v1/libraries/register', { libraryId: 'library-1', epoch: 1 })
    await post(server.baseUrl, '/v1/metadata/push', {
      libraryId: 'library-1',
      epoch: 1,
      deviceId: 'device-a',
      operations: [
        operation(),
        operation({ opId: 'op-2', deviceSeq: 2, entityId: 'display' }),
      ],
    })
    const firstPage = await post(server.baseUrl, '/v1/metadata/pull', {
      libraryId: 'library-1', epoch: 1, deviceId: 'device-b', afterCursor: null, limit: 1,
    })
    assert.equal(firstPage.body.operations.length, 1)
    assert.equal(firstPage.body.nextCursor, '1')
    assert.equal(firstPage.body.hasMore, true)

    const secondPage = await post(server.baseUrl, '/v1/metadata/pull', {
      libraryId: 'library-1', epoch: 1, deviceId: 'device-b', afterCursor: '1', limit: 1,
    })
    assert.equal(secondPage.body.operations[0].opId, 'op-2')
    assert.equal(secondPage.body.nextCursor, '2')
    assert.equal(secondPage.body.hasMore, false)
  } finally {
    await server.close()
    fs.rmSync(server.root, { recursive: true, force: true })
  }
})

test('asset upload and offline download preserve the exact original bytes', async () => {
  const server = await startServer()
  try {
    await post(server.baseUrl, '/v1/libraries/register', { libraryId: 'library-1', epoch: 1 })
    const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10, 0x20])
    const sha256 = createHash('sha256').update(original).digest('hex')

    const missing = await post(server.baseUrl, '/v1/assets/status', {
      libraryId: 'library-1', epoch: 1, assetIds: ['asset_1'],
    })
    assert.deepEqual(missing.body, { assets: [] })

    const uploaded = await fetch(
      `${server.baseUrl}/v1/assets/asset_1?libraryId=library-1&epoch=1`,
      {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'image/png',
          'x-asset-sha256': sha256,
        },
        body: original,
      },
    )
    assert.equal(uploaded.status, 200)
    assert.deepEqual(await uploaded.json(), {
      created: true,
      id: 'asset_1',
      sha256,
      mime: 'image/png',
      byteSize: original.byteLength,
    })

    const status = await post(server.baseUrl, '/v1/assets/status', {
      libraryId: 'library-1', epoch: 1, assetIds: ['asset_1'],
    })
    assert.deepEqual(status.body.assets, [{
      id: 'asset_1', sha256, mime: 'image/png', byteSize: original.byteLength,
    }])

    const downloaded = await fetch(
      `${server.baseUrl}/v1/assets/asset_1?libraryId=library-1&epoch=1`,
      { headers: { authorization: `Bearer ${TOKEN}` } },
    )
    assert.equal(downloaded.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), original)
  } finally {
    await server.close()
    fs.rmSync(server.root, { recursive: true, force: true })
  }
})

test('asset status exposes a lost server file as missing so the client can repair it', async () => {
  const server = await startServer()
  try {
    await post(server.baseUrl, '/v1/libraries/register', { libraryId: 'library-1', epoch: 1 })
    const original = Buffer.from('original-that-must-be-repairable')
    const sha256 = createHash('sha256').update(original).digest('hex')
    const endpoint = `${server.baseUrl}/v1/assets/asset_1?libraryId=library-1&epoch=1`
    const uploaded = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'image/png',
        'x-asset-sha256': sha256,
      },
      body: original,
    })
    assert.equal(uploaded.status, 200)

    fs.rmSync(path.join(server.root, 'sync.db.assets'), { recursive: true, force: true })
    const status = await post(server.baseUrl, '/v1/assets/status', {
      libraryId: 'library-1', epoch: 1, assetIds: ['asset_1'],
    })
    assert.deepEqual(status.body, { assets: [] })
  } finally {
    await server.close()
    fs.rmSync(server.root, { recursive: true, force: true })
  }
})

test('asset writes reject traversal, corruption and conflicting content', async () => {
  const server = await startServer()
  try {
    await post(server.baseUrl, '/v1/libraries/register', { libraryId: 'library-1', epoch: 1 })
    const firstBytes = Buffer.from('first-original')
    const firstSha256 = createHash('sha256').update(firstBytes).digest('hex')
    const endpoint = `${server.baseUrl}/v1/assets/asset_1?libraryId=library-1&epoch=1`
    const headers = {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'image/png',
      'x-asset-sha256': firstSha256,
    }

    const simultaneous = await Promise.all([
      fetch(endpoint, { method: 'PUT', headers, body: firstBytes }),
      fetch(endpoint, { method: 'PUT', headers, body: firstBytes }),
    ])
    assert.deepEqual(
      (await Promise.all(simultaneous.map((response) => response.json())))
        .map((body) => body.created)
        .sort(),
      [false, true],
    )

    const corrupted = await fetch(`${server.baseUrl}/v1/assets/corrupted?libraryId=library-1&epoch=1`, {
      method: 'PUT', headers, body: Buffer.from('not-the-declared-content'),
    })
    assert.equal(corrupted.status, 400)

    const conflictBytes = Buffer.from('different-original')
    const conflict = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        ...headers,
        'x-asset-sha256': createHash('sha256').update(conflictBytes).digest('hex'),
      },
      body: conflictBytes,
    })
    assert.equal(conflict.status, 409)

    const traversal = await fetch(
      `${server.baseUrl}/v1/assets/%2e%2e%2fsecret?libraryId=library-1&epoch=1`,
      { headers: { authorization: `Bearer ${TOKEN}` } },
    )
    assert.equal(traversal.status, 400)
  } finally {
    await server.close()
    fs.rmSync(server.root, { recursive: true, force: true })
  }
})

test('replacing a restored library advances its epoch and hides all previous cloud state', async () => {
  const server = await startServer()
  try {
    await post(server.baseUrl, '/v1/libraries/register', { libraryId: 'library-1', epoch: 1 })
    await post(server.baseUrl, '/v1/metadata/push', {
      libraryId: 'library-1', epoch: 1, deviceId: 'device-a', operations: workspaceCheckpointOperations(),
    })
    await post(server.baseUrl, '/v1/libraries/finalize', {
      libraryId: 'library-1', epoch: 1,
    })
    const before = await post(server.baseUrl, '/v1/libraries/epoch', {
      libraryId: 'library-1', epoch: 0,
    })
    assert.deepEqual(before.body, { exists: true, epoch: 1, ready: true })

    const reset = await post(server.baseUrl, '/v1/libraries/reset', {
      libraryId: 'library-1', epoch: 1, nextEpoch: 2, confirm: 'replace',
    })
    assert.deepEqual(reset.body, { reset: true, epoch: 2 })

    const pendingEpoch = await post(server.baseUrl, '/v1/libraries/epoch', {
      libraryId: 'library-1', epoch: 0,
    })
    assert.deepEqual(pendingEpoch.body, { exists: true, epoch: 2, ready: false })
    await post(server.baseUrl, '/v1/metadata/push', {
      libraryId: 'library-1', epoch: 2, deviceId: 'device-a', operations: workspaceCheckpointOperations(),
    })
    const finalized = await post(server.baseUrl, '/v1/libraries/finalize', {
      libraryId: 'library-1', epoch: 2,
    })
    assert.deepEqual(finalized.body, { ready: true, epoch: 2 })

    const pulled = await post(server.baseUrl, '/v1/metadata/pull', {
      libraryId: 'library-1', epoch: 2, deviceId: 'device-b', afterCursor: null, limit: 500,
    })
    assert.deepEqual(
      pulled.body.operations.map((item) => item.opId),
      workspaceCheckpointOperations().map((item) => item.opId),
    )
    const assets = await post(server.baseUrl, '/v1/assets/status', {
      libraryId: 'library-1', epoch: 2, assetIds: ['asset_1'],
    })
    assert.deepEqual(assets.body, { assets: [] })
  } finally {
    await server.close()
    fs.rmSync(server.root, { recursive: true, force: true })
  }
})
