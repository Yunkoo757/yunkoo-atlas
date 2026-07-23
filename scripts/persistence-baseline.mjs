import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const RELATIVE_REGRESSION_RATIO = 1.2

export const PERSISTENCE_BASELINE_METRICS = Object.freeze([
  'web10kSaveP95Ms',
  'web20kSaveP95Ms',
  'web10kDirtyConfirmedP95Ms',
  'web20kDirtyConfirmedP95Ms',
  'web10kStaleConflictP95Ms',
  'web20kStaleConflictP95Ms',
  'electron10kSaveP95Ms',
  'electron20kSaveP95Ms',
  'quitCoordinatorP95Ms',
  'web10kMaxLongTaskMs',
  'web20kMaxLongTaskMs',
  'webZipPeakJsHeapBytes',
])

export function collectPersistenceMetrics(persistence, webZip) {
  return {
    web10kSaveP95Ms: persistence.summaries.web10kSaveP95Ms,
    web20kSaveP95Ms: persistence.summaries.web20kSaveP95Ms,
    web10kDirtyConfirmedP95Ms: persistence.summaries.web10kDirtyConfirmedP95Ms,
    web20kDirtyConfirmedP95Ms: persistence.summaries.web20kDirtyConfirmedP95Ms,
    web10kStaleConflictP95Ms: persistence.summaries.web10kStaleConflictP95Ms,
    web20kStaleConflictP95Ms: persistence.summaries.web20kStaleConflictP95Ms,
    electron10kSaveP95Ms: persistence.summaries.electron10kSaveP95Ms,
    electron20kSaveP95Ms: persistence.summaries.electron20kSaveP95Ms,
    quitCoordinatorP95Ms: persistence.summaries.quitCoordinatorP95Ms,
    web10kMaxLongTaskMs: persistence.summaries.web10kMaxLongTaskMs,
    web20kMaxLongTaskMs: persistence.summaries.web20kMaxLongTaskMs,
    webZipPeakJsHeapBytes: webZip.peakJsHeapBytes,
  }
}

export function validatePersistenceMetrics(metrics, label = 'metrics') {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
    throw new Error(`${label} 必须是指标对象`)
  }
  const actual = Object.keys(metrics).sort()
  const expected = [...PERSISTENCE_BASELINE_METRICS].sort()
  if (actual.join('\n') !== expected.join('\n')) {
    const missing = expected.filter((metric) => !actual.includes(metric))
    const extra = actual.filter((metric) => !expected.includes(metric))
    throw new Error(`${label} 指标集合不匹配：missing=${missing.join(',') || '-'} extra=${extra.join(',') || '-'}`)
  }
  for (const metric of PERSISTENCE_BASELINE_METRICS) {
    if (!Number.isFinite(metrics[metric]) || metrics[metric] < 0) {
      throw new Error(`${label}.${metric} 必须是有限非负数`)
    }
  }
  return metrics
}

export function validateApprovedPersistenceBaseline(baseline) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    throw new Error('持久化性能基线必须是对象')
  }
  if (baseline.version !== 1) throw new Error('持久化性能基线版本必须严格为 1')
  if (typeof baseline.approvedBy !== 'string' || baseline.approvedBy.trim() === '') {
    throw new Error('持久化性能基线缺少批准人')
  }
  if (typeof baseline.approvedAt !== 'string' || !Number.isFinite(Date.parse(baseline.approvedAt))) {
    throw new Error('持久化性能基线缺少有效批准时间')
  }
  for (const field of ['gitCommit', 'gitTree']) {
    if (!/^[a-f0-9]{40}$/.test(baseline[field])) throw new Error(`持久化性能基线 ${field} 无效`)
  }
  if (baseline.workingTreeDirty !== false) throw new Error('持久化性能基线必须来自干净工作树')
  if (!/^[a-f0-9]{64}$/.test(baseline.sourceFingerprint)) throw new Error('持久化性能基线 sourceFingerprint 无效')
  if (baseline.sourceIdentity !== `git-tree:${baseline.gitTree}`) throw new Error('持久化性能基线 sourceIdentity 无效')
  if (typeof baseline.basis !== 'string' || baseline.basis.trim() === '') throw new Error('持久化性能基线缺少批准依据')
  if (!Array.isArray(baseline.evidence) || baseline.evidence.length !== 2) {
    throw new Error('持久化性能基线必须绑定两次原始运行')
  }
  for (const [index, evidence] of baseline.evidence.entries()) {
    if (evidence?.attempt !== index + 1) throw new Error('持久化性能基线 attempt 编号无效')
    for (const name of ['persistence', 'webZip']) {
      const item = evidence[name]
      if (typeof item?.path !== 'string' || !item.path.startsWith('scripts/persistence-baseline-evidence/')) {
        throw new Error(`持久化性能基线 ${name} 路径无效`)
      }
      if (!/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error(`持久化性能基线 ${name} SHA-256 无效`)
    }
  }
  validatePersistenceMetrics(baseline.metrics, 'baseline.metrics')
  return baseline
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function p95(samples) {
  if (!Array.isArray(samples) || samples.length !== 30 || samples.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('正式性能原始样本必须恰好包含 30 个有限非负数')
  }
  const sorted = [...samples].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * 0.95) - 1]
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} 无法从原始样本复算`)
}

export function validateRawPersistenceAttempt(raw, expected = null) {
  const parse = (entry, label) => {
    if (typeof entry?.json !== 'string' || sha256(entry.json) !== entry.sha256) {
      throw new Error(`${label} 原始报告 SHA-256 不匹配`)
    }
    return JSON.parse(entry.json)
  }
  const persistence = parse(raw?.persistence, 'persistence')
  const webZip = parse(raw?.webZip, 'webZip')
  if (persistence.version !== 1 || persistence.mode !== 'release' || persistence.status !== 'pass' ||
      persistence.sampleConfig?.warmups !== 5 || persistence.sampleConfig?.samples !== 30) {
    throw new Error('persistence 原始报告不是通过的 5+30 正式运行')
  }
  if (webZip.version !== 1 || webZip.mode !== 'release' || webZip.status !== 'pass') {
    throw new Error('webZip 原始报告不是通过的正式运行')
  }
  for (const field of ['gitCommit', 'gitTree', 'sourceFingerprint', 'sourceIdentity']) {
    if (persistence[field] !== webZip[field]) throw new Error(`原始报告 ${field} 不一致`)
    if (expected && persistence[field] !== expected[field]) throw new Error(`原始报告 ${field} 与批准来源不一致`)
  }
  if (persistence.workingTreeDirty !== false || webZip.workingTreeDirty !== false) {
    throw new Error('原始报告必须来自干净工作树')
  }
  if (!persistence.environment?.os || !persistence.environment?.cpu || !persistence.environment?.chromium ||
      !persistence.environment?.electron || !persistence.environment?.sqlJs) {
    throw new Error('persistence 原始报告缺少环境信息')
  }
  if (!Array.isArray(persistence.generator?.datasets) || persistence.generator.datasets.length !== 2 ||
      persistence.generator.datasets.some((dataset) => !/^[a-f0-9]{64}$/.test(dataset.sha256))) {
    throw new Error('persistence 原始报告缺少 fixture SHA-256')
  }
  const web10k = persistence.web?.find((item) => item.label === '10k')
  const web20k = persistence.web?.find((item) => item.label === '20k')
  const electron10k = persistence.electron?.find((item) => item.label === '10k')
  const electron20k = persistence.electron?.find((item) => item.label === '20k')
  if (!web10k || !web20k || !electron10k || !electron20k) throw new Error('原始报告缺少 10K/20K Web/Electron 样本')
  for (const item of [web10k, web20k]) {
    if (item.longTaskObserverSupported !== true || item.longTaskCalibrationObserved !== true) {
      throw new Error(`${item.label} Long Task observer 未通过自校准`)
    }
  }
  const computed = {
    web10kSaveP95Ms: p95(web10k.saveSamplesMs),
    web20kSaveP95Ms: p95(web20k.saveSamplesMs),
    web10kDirtyConfirmedP95Ms: p95(web10k.dirtyConfirmedSamplesMs),
    web20kDirtyConfirmedP95Ms: p95(web20k.dirtyConfirmedSamplesMs),
    web10kStaleConflictP95Ms: p95(web10k.staleConflictSamplesMs),
    web20kStaleConflictP95Ms: p95(web20k.staleConflictSamplesMs),
    electron10kSaveP95Ms: p95(electron10k.saveSamplesMs),
    electron20kSaveP95Ms: p95(electron20k.saveSamplesMs),
    quitCoordinatorP95Ms: p95(electron10k.quitSamplesMs),
    web10kMaxLongTaskMs: Math.max(0, ...web10k.longTaskSamplesMs),
    web20kMaxLongTaskMs: Math.max(0, ...web20k.longTaskSamplesMs),
    webZipPeakJsHeapBytes: webZip.peakJsHeapBytes,
  }
  const reported = validatePersistenceMetrics(collectPersistenceMetrics(persistence, webZip), 'raw summaries')
  for (const metric of PERSISTENCE_BASELINE_METRICS) assertEqual(reported[metric], computed[metric], metric)
  return { persistence, webZip, metrics: computed }
}

export async function verifyApprovedPersistenceBaseline(baseline, root = process.cwd()) {
  validateApprovedPersistenceBaseline(baseline)
  const attempts = []
  for (const evidence of baseline.evidence) {
    const raw = {}
    for (const [name, item] of Object.entries({ persistence: evidence.persistence, webZip: evidence.webZip })) {
      const absolute = path.resolve(root, item.path)
      const relative = path.relative(root, absolute)
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('基线证据路径越界')
      const json = await fs.readFile(absolute, 'utf8')
      raw[name] = { json, sha256: item.sha256 }
    }
    attempts.push(validateRawPersistenceAttempt(raw, baseline))
  }
  const approvedAt = Date.parse(baseline.approvedAt)
  const latestEvidenceAt = Math.max(...attempts.flatMap((attempt) => [
    Date.parse(attempt.persistence.generatedAt),
    Date.parse(attempt.webZip.generatedAt),
  ]))
  if (!Number.isFinite(latestEvidenceAt) || approvedAt < latestEvidenceAt) {
    throw new Error('基线批准时间必须晚于两次原始运行')
  }
  for (const metric of PERSISTENCE_BASELINE_METRICS) {
    assertEqual(baseline.metrics[metric], Math.max(...attempts.map((attempt) => attempt.metrics[metric])), `baseline.${metric}`)
  }
  return attempts
}

export function findRelativeRegressions(baselineMetrics, currentMetrics) {
  validatePersistenceMetrics(baselineMetrics, 'baseline.metrics')
  validatePersistenceMetrics(currentMetrics, 'current.metrics')
  const regressions = []
  for (const metric of PERSISTENCE_BASELINE_METRICS) {
    const baseline = baselineMetrics[metric]
    const current = currentMetrics[metric]
    if (baseline === 0) {
      if (current > 0) regressions.push({ metric, baseline, current, limit: 0, reason: 'zero-baseline' })
      continue
    }
    const limit = baseline * RELATIVE_REGRESSION_RATIO
    if (current > limit) regressions.push({ metric, baseline, current, limit })
  }
  return regressions
}
