import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const trackedPaths = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)

const compatibilityFiles = new Set([
  'scripts/vendor-neutral-contract.test.mjs',
  'src/storage/legacyIdentity.ts',
  'src/storage/legacyIdentity.browser.test.ts',
])

const binaryExtensions = /\.(?:bmp|db|gif|ico|jpe?g|png|svg|webp|zip)$/i
const vendorText = /linear-journal|linear\.app|Linear[A-Z]|icons[\\/]linear|linear-icon|font-linear/i

test('project-owned paths are vendor neutral', () => {
  assert.deepEqual(
    trackedPaths.filter((filePath) => /linear/i.test(filePath)),
    [],
  )
})

test('active project text is vendor neutral', () => {
  const violations = []
  for (const filePath of trackedPaths) {
    if (compatibilityFiles.has(filePath) || binaryExtensions.test(filePath)) continue
    if (vendorText.test(readFileSync(filePath, 'utf8'))) violations.push(filePath)
  }
  assert.deepEqual(violations, [])
})
