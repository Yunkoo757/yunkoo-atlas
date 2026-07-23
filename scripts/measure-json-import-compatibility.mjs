import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'
import { readGitProvenance } from './git-provenance.mjs'
import { createAnalyticsSnapshot, ANALYTICS_FIXTURE_SEED } from './fixtures/analytics-trades.mjs'
import {
  MAX_JSON_FILE_BYTES,
  MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES,
  MAX_JSON_TOTAL_ATTACHMENT_DECODED_BYTES,
  MAX_JSON_TOTAL_ENTITIES,
} from '../src/lib/importLimits.ts'

const limits = {
  fileBytes: MAX_JSON_FILE_BYTES,
  singleAttachmentDecodedBytes: MAX_JSON_SINGLE_ATTACHMENT_DECODED_BYTES,
  totalAttachmentDecodedBytes: MAX_JSON_TOTAL_ATTACHMENT_DECODED_BYTES,
  entities: MAX_JSON_TOTAL_ENTITIES,
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function entityCount(payload) {
  return Object.entries(payload).reduce((total, [key, value]) => {
    if (Array.isArray(value)) return total + value.length
    if ((key === 'shortcuts' || key === 'symbolIcons') && value && typeof value === 'object') {
      return total + Object.keys(value).length
    }
    return total
  }, 0)
}

function record(name, payload, exerciseProductionPath, attachmentDecodedBytes = []) {
  let json = ''
  let importOk = false
  let importCode = null
  try {
    const result = exerciseProductionPath(payload)
    json = result.json
    importOk = result.importOk
    importCode = result.importCode
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'writer-threw'
    const cause = error && typeof error === 'object' && 'cause' in error && error.cause instanceof Error
      ? `:${error.cause.message}`
      : ''
    importCode = `${code}${cause}`
  }
  const bytes = Buffer.byteLength(json)
  const entities = entityCount(payload)
  return {
    name,
    bytes,
    sha256: sha256(json),
    entities,
    attachmentDecodedBytes,
    importOk,
    importCode,
    compatible:
      importOk &&
      bytes <= limits.fileBytes &&
      entities <= limits.entities &&
      attachmentDecodedBytes.every((size) => size <= limits.singleAttachmentDecodedBytes) &&
      attachmentDecodedBytes.reduce((sum, size) => sum + size, 0) <= limits.totalAttachmentDecodedBytes,
  }
}

function attachReferencedFixtureAssets(payload, extraAssets = []) {
  const ids = new Set()
  const htmlEntries = [
    ...(payload.trades ?? []).map((trade) => trade.note ?? ''),
    ...(payload.weeklyReviews ?? []).map((review) => review.contentHtml ?? ''),
    ...(payload.quickNotes ?? []).map((note) => note.contentHtml ?? ''),
  ]
  for (const html of htmlEntries) {
    for (const match of html.matchAll(/journal-asset:\/\/([a-zA-Z0-9._-]+)/g)) ids.add(match[1])
  }
  const byId = new Map(extraAssets.map((asset) => [asset.id, asset]))
  for (const id of ids) {
    if (!byId.has(id)) byId.set(id, { id, mime: 'image/png', data: 'aW1hZ2U=' })
  }
  return { ...payload, assets: [...byId.values()] }
}

function analyticsPayload(count) {
  return attachReferencedFixtureAssets({
    version: 8,
    ...createAnalyticsSnapshot({ count, seed: ANALYTICS_FIXTURE_SEED, noteProfile: '2kb' }),
  })
}

const sharedData = Buffer.from('shared-attachment-corpus').toString('base64')
const sharedAssetId = 'compat-shared-asset'
const sharedHtml = `<img src="journal-asset://${sharedAssetId}">`
const selfReferenceSource = {
  version: 8,
  ...createAnalyticsSnapshot({ count: 1_000, seed: ANALYTICS_FIXTURE_SEED, noteProfile: 'short' }),
  weeklyReviews: [{
    id: 'weekly-review:2026-07-20', weekStart: '2026-07-20', weekEnd: '2026-07-26',
    status: 'draft', executionScore: null, riskScore: null, emotionScore: null,
    strengthTags: [], mistakeTags: [], highlightTradeIds: [], mistakeTradeIds: [], followUpTradeIds: [],
    contentHtml: sharedHtml, commitmentText: '', commitmentCriteria: '', previousCommitmentResult: null,
    metricsSnapshot: null, createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
    completedAt: null,
  }],
  quickNotes: [{
    id: 'compat-note', title: 'shared', contentHtml: sharedHtml, pinned: false,
    createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
  }],
}
selfReferenceSource.trades[0].note = sharedHtml
const selfReferencePayload = attachReferencedFixtureAssets(
  selfReferenceSource,
  [{ id: sharedAssetId, mime: 'image/png', data: sharedData }],
)

const maxAttachment = Buffer.alloc(limits.singleAttachmentDecodedBytes).toString('base64')
const maxAttachmentSource = {
  version: 8,
  ...createAnalyticsSnapshot({ count: 1_000, seed: ANALYTICS_FIXTURE_SEED, noteProfile: 'short' }),
}
maxAttachmentSource.trades[0].note = '<img src="journal-asset://compat-max-asset">'
const maxAttachmentPayload = attachReferencedFixtureAssets(
  maxAttachmentSource,
  [{ id: 'compat-max-asset', mime: 'image/png', data: maxAttachment }],
)

let generatorCommit = 'unknown'
try {
  generatorCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  // 未提交工作区仍保留 fixture hash，commit 仅作补充来源标识。
}

const workspaceRoot = path.resolve(process.cwd())
const harnessDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-json-compat-'))
try {
  await build({
    configFile: path.resolve('vite.config.ts'),
    logLevel: 'silent',
    ssr: { noExternal: true },
    build: {
      ssr: path.resolve('scripts/jsonCompatibilityHarness.ts'),
      outDir: harnessDir,
      emptyOutDir: true,
      rolldownOptions: { output: { entryFileNames: 'harness.mjs' } },
    },
  })
  const harness = await import(`${pathToFileURL(path.join(harnessDir, 'harness.mjs')).href}?t=${Date.now()}`)
  const exercise = harness.exerciseJsonProductionPath
  if (typeof exercise !== 'function') throw new Error('production JSON compatibility harness is missing')

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    generatorCommit,
    ...await readGitProvenance(workspaceRoot),
    generatorScriptSha256: sha256(await fs.readFile(new URL(import.meta.url))),
    approval: {
      status: 'approved',
      approvedBy: 'Yunkoo',
      approvedAt: '2026-07-22',
      basis: 'Spec v2 推荐方案及后续推荐项已由项目负责人统一批准',
    },
    seed: ANALYTICS_FIXTURE_SEED,
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    limits,
    corpus: [
      record('dense-1k', analyticsPayload(1_000), exercise),
      record('dense-10k', analyticsPayload(10_000), exercise),
      record('dense-20k', analyticsPayload(20_000), exercise),
      record('shared-self-reference', selfReferencePayload, exercise, [Buffer.byteLength(Buffer.from(sharedData, 'base64'))]),
      record('max-declared-attachment', maxAttachmentPayload, exercise, [limits.singleAttachmentDecodedBytes]),
    ],
  }
  report.hardLimitsEnabled = report.corpus.every((item) => item.compatible)
  const outputIndex = process.argv.indexOf('--output')
  const outputPath = path.resolve(outputIndex >= 0
    ? process.argv[outputIndex + 1]
    : path.join('test-results', 'json-compatibility', 'json-compatibility.json'))
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ outputPath, ...report }, null, 2)}\n`)
  if (!report.hardLimitsEnabled) process.exitCode = 1
} finally {
  await fs.rm(harnessDir, { recursive: true, force: true })
}
