import path from 'node:path'

const normalized = (value) => value.replaceAll('\\', '/')

export function importedSpecifiers(source) {
  return [...source.matchAll(/(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((match) => match[1] ?? match[2])
}

export function resolveSpecifier(importer, specifier) {
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`
  if (specifier.startsWith('.')) return normalized(path.join(path.dirname(importer), specifier))
  return specifier
}

export function importsTarget(source, importer, target) {
  const normalizedTarget = target.replace(/\.(?:ts|tsx|mjs|js)$/, '')
  const directoryTarget = normalizedTarget.endsWith('/index')
    ? normalizedTarget.slice(0, -'/index'.length)
    : null
  return importedSpecifiers(source).some((specifier) => {
    const resolved = resolveSpecifier(importer, specifier).replace(/\.(?:ts|tsx|mjs|js)$/, '')
    return resolved === normalizedTarget || resolved === `${normalizedTarget}/index` || resolved === directoryTarget
  })
}

export function importsWithinTarget(source, importer, target) {
  const normalizedTarget = target.replace(/\.(?:ts|tsx|mjs|js)$/, '')
  const isIndexTarget = normalizedTarget.endsWith('/index')
  const directoryTarget = isIndexTarget
    ? normalizedTarget.slice(0, -'/index'.length)
    : normalizedTarget
  return importedSpecifiers(source).some((specifier) => {
    const resolved = resolveSpecifier(importer, specifier).replace(/\.(?:ts|tsx|mjs|js)$/, '')
    return resolved === normalizedTarget || resolved === directoryTarget || (!isIndexTarget && resolved.startsWith(`${directoryTarget}/`))
  })
}
