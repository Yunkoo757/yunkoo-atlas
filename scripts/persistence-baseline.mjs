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
  validatePersistenceMetrics(baseline.metrics, 'baseline.metrics')
  return baseline
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
