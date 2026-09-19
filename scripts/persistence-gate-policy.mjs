export function checkPersistenceTiming(name, actual, limit, failures, warnings, correctnessOnly) {
  if (!Number.isFinite(actual)) failures.push(`${name}: invalid measurement`)
  else if (actual > limit) (correctnessOnly ? warnings : failures).push(`${name}: ${actual.toFixed(2)}ms > ${limit}ms`)
}
