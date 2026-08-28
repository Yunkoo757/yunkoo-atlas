import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'

const ROOT = resolve('src')
const TOKENS = resolve('src/styles/tokens.css')
const TEXT_EXTENSIONS = new Set(['.css', '.ts', '.tsx'])
const decoder = new TextDecoder('utf-8', { fatal: true })

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(target) : [target]
  })
}

function readUtf8(file) {
  const bytes = readFileSync(file)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`${relative(process.cwd(), file)}:1 UTF-8 BOM`)
  }
  return decoder.decode(bytes)
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length
}

function addMatches(findings, file, source, label, pattern, predicate = () => true) {
  pattern.lastIndex = 0
  for (const match of source.matchAll(pattern)) {
    if (!predicate(match)) continue
    findings.push({
      file: relative(process.cwd(), file).replaceAll('\\', '/'),
      line: lineNumber(source, match.index ?? 0),
      label,
      value: match[0].replace(/\s+/g, ' ').trim().slice(0, 120),
    })
  }
}

const allFiles = filesUnder(ROOT).filter((file) => TEXT_EXTENSIONS.has(extname(file)))
const productionFiles = allFiles.filter((file) => !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file))
const globalProperties = new Set()
const PERSISTENT_SURFACE_FILES = new Set([
  'src/components/trades/TradeList.css',
  'src/views/ImportDataHealthView.css',
  'src/views/WeeklyReviewView.css',
])
for (const file of productionFiles) {
  const source = readUtf8(file)
  if (extname(file) === '.css') {
    for (const match of source.matchAll(/(--[a-z0-9-]+)\s*:/gi)) globalProperties.add(match[1])
  }
  if (extname(file) === '.tsx') {
    for (const match of source.matchAll(/["'](--[a-z0-9-]+)["']\s*:/gi)) globalProperties.add(match[1])
  }
}
const findings = []

for (const file of productionFiles) {
  const source = readUtf8(file)
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
  const normalizedFile = relative(process.cwd(), file).replaceAll('\\', '/')

  addMatches(findings, file, source, 'mobile product chrome', /\bMobileNavigation\b/g)
  addMatches(findings, file, source, 'coarse pointer product rule', /pointer\s*:\s*coarse/g)
  addMatches(findings, file, source, 'hoverless product rule', /hover\s*:\s*none/g)
  addMatches(findings, file, source, 'phone-only media rule', /@media[^\{]*(?:max-width\s*:\s*(?:[1-8]\d\d|899)px)[^\{]*\{/g)
  addMatches(findings, file, source, 'safe area product rule', /safe-area-inset/g)
  addMatches(findings, file, withoutComments, 'raw z-index', /z-index\s*:\s*-?\d+/g)
  addMatches(findings, file, withoutComments, 'transition all', /transition\s*:\s*all\b/g)
  addMatches(findings, file, source, 'character icon', /(?:···|＋)/g)

  if (extname(file) === '.css') {
    if (PERSISTENT_SURFACE_FILES.has(normalizedFile)) {
      addMatches(findings, file, withoutComments, 'persistent surface blur', /(?:-webkit-)?backdrop-filter\s*:\s*blur\([^;\n}]+\)/gi)
    }
    addMatches(
      findings,
      file,
      withoutComments,
      'undefined custom property',
      /var\(\s*(--[a-z0-9-]+)([^)]*)\)/gi,
      (match) => !globalProperties.has(match[1]) && !match[2].includes(','),
    )
    addMatches(
      findings,
      file,
      withoutComments,
      'raw component color',
      /(?:#[0-9a-f]{3,8}|\b(?:rgb|hsl|lch|oklch)a?\([^;\n}]+\))/gi,
      (match) => file !== TOKENS && !/mask-image[^\n]*(?:#000|rgb\(0)/i.test(withoutComments.slice(Math.max(0, (match.index ?? 0) - 100), (match.index ?? 0) + 160)),
    )
  }

  if (extname(file) === '.tsx') {
    addMatches(
      findings,
      file,
      source,
      'numeric JSX icon size',
      /<[A-Z][A-Za-z0-9.]*\b[^>]*\bsize=\{\d+\}[^>]*>/g,
    )
  }
}

findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.label.localeCompare(b.label))
for (const finding of findings) {
  console.error(`${finding.file}:${finding.line} [${finding.label}] ${finding.value}`)
}

if (findings.length > 0) {
  console.error(`desktop visual governance: FAIL (${findings.length} findings)`)
  process.exitCode = 1
} else {
  console.log('desktop visual governance: PASS (0 findings)')
}
