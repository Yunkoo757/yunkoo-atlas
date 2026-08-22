export const LEGACY_RUNTIME_FORBIDDEN_TOKENS = [
  ['livePerformance', 'Cycles'].join(''),
  ['liveStatsStart', 'TradingDayKey'].join(''),
]

export const LEGACY_RUNTIME_FORBIDDEN_COPY = [
  ['重置实盘', '统计'].join(''),
  ['重置', '统计'].join(''),
]

/**
 * v11 字段只允许出现在两个纯解码/迁移边界；逐字段列出，禁止目录级放行。
 */
export const LEGACY_RUNTIME_COMPATIBILITY_ALLOWLIST = new Map([
  ['src/lib/stageMigration.ts', new Set(LEGACY_RUNTIME_FORBIDDEN_TOKENS)],
  ['src/storage/snapshotCodec.ts', new Set(LEGACY_RUNTIME_FORBIDDEN_TOKENS)],
])

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split('\n').length
}

export function findForbiddenLegacyRuntimeMatches(files) {
  const matches = []
  for (const { path, source } of files) {
    const allowed = LEGACY_RUNTIME_COMPATIBILITY_ALLOWLIST.get(path) ?? new Set()
    for (const token of [...LEGACY_RUNTIME_FORBIDDEN_TOKENS, ...LEGACY_RUNTIME_FORBIDDEN_COPY]) {
      let offset = source.indexOf(token)
      while (offset >= 0) {
        if (!allowed.has(token)) matches.push({ path, line: lineNumberAt(source, offset), token })
        offset = source.indexOf(token, offset + token.length)
      }
    }
  }
  return matches
}

export function isExecutableProductionSource(path) {
  if (!/^(?:src|electron|scripts)\//.test(path)) return false
  if (/\.(?:test|fixture)\./.test(path) || path.startsWith('src/test/') || path.startsWith('scripts/fixtures/')) {
    return false
  }
  return /\.(?:ts|tsx|js|mjs|css|html)$/.test(path)
}
