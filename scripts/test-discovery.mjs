import fs from 'node:fs/promises'
import path from 'node:path'

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/')
}

async function walkFiles(root, relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory)
  let entries
  try {
    entries = await fs.readdir(absoluteDirectory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const files = []
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await walkFiles(root, relativePath))
    } else if (entry.isFile()) {
      files.push(toPosix(relativePath))
    }
  }
  return files
}

export async function discoverUnitTestEntries(root, options = {}) {
  const excluded = new Set(options.excluded ?? [])
  const files = [
    ...await walkFiles(root, 'src'),
    ...await walkFiles(root, 'electron'),
  ]
  return files
    .filter((file) => /\.test\.tsx?$/.test(file))
    .filter((file) => !/\.browser\.test\.tsx?$/.test(file))
    .filter((file) => !excluded.has(file))
    .sort()
}

function collectPromiseKeys(source, target) {
  const keyPattern = /\.(__[A-Za-z0-9_]*Test)\s*=/g
  let match
  while ((match = keyPattern.exec(source)) !== null) target.add(match[1])
}

function moduleSourcesFromHtml(html) {
  const sources = []
  const sourcePattern = /<script\b[^>]*\bsrc=["']([^"']+\.browser\.test\.(?:ts|tsx))["'][^>]*>/gi
  let match
  while ((match = sourcePattern.exec(html)) !== null) sources.push(match[1])
  return sources
}

function resolveModuleSource(root, htmlPath, source) {
  if (source.startsWith('/')) return path.join(root, source.slice(1))
  return path.resolve(path.dirname(path.join(root, htmlPath)), source)
}

export async function discoverBrowserTests(root) {
  const htmlFiles = (await walkFiles(root, 'src'))
    .filter((file) => file.endsWith('.browser.test.html'))
    .sort()

  const tests = []
  const keyOwners = new Map()
  for (const htmlPath of htmlFiles) {
    const html = await fs.readFile(path.join(root, htmlPath), 'utf8')
    const promiseKeys = new Set()
    collectPromiseKeys(html, promiseKeys)
    for (const source of moduleSourcesFromHtml(html)) {
      const moduleText = await fs.readFile(resolveModuleSource(root, htmlPath, source), 'utf8')
      collectPromiseKeys(moduleText, promiseKeys)
    }
    if (promiseKeys.size !== 1) {
      throw new Error(
        `${htmlPath} must expose exactly one browser test promise key; found ${promiseKeys.size}`,
      )
    }
    const promiseKey = [...promiseKeys][0]
    const previousOwner = keyOwners.get(promiseKey)
    if (previousOwner) {
      throw new Error(
        `duplicate browser test ID ${promiseKey}: ${previousOwner} and ${htmlPath}`,
      )
    }
    keyOwners.set(promiseKey, htmlPath)
    tests.push({
      url: `/${htmlPath}`,
      promiseKey,
      label: htmlPath,
    })
  }
  return tests
}

export function unexpectedBrowserDiagnostics(diagnostics, allowedMessages = []) {
  return diagnostics.filter(
    (diagnostic) => {
      const message = diagnostic.replace(/^(?:console|pageerror):\s*/, '')
      return !allowedMessages.some(
        (allowed) => message.startsWith(allowed),
      )
    },
  )
}

export const BROWSER_DIAGNOSTIC_SETTLE_MS = 100

export async function settleBrowserDiagnostics(page) {
  await page.waitForTimeout(BROWSER_DIAGNOSTIC_SETTLE_MS)
}
