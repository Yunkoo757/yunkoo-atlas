import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const trackedPaths = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((filePath) => existsSync(filePath))

const compatibilityFiles = new Set([
  'scripts/vendor-neutral-contract.test.mjs',
  'src/storage/legacyIdentity.ts',
  'src/storage/legacyIdentity.browser.test.ts',
])

const binaryExtensions = /\.(?:bmp|db|gif|ico|jpe?g|png|svg|webp|zip)$/i
const vendorText = /linear-journal|linear\.app|icons[\\/]linear|linear-icon|font-linear/i
const vendorIdentifier = /Linear[A-Z]/

test('project-owned paths are vendor neutral', () => {
  assert.deepEqual(
    trackedPaths.filter((filePath) => /linear/i.test(filePath)),
    [],
  )
})

test('active project text is vendor neutral', () => {
  const violations = []
  for (const filePath of trackedPaths) {
    if (!existsSync(filePath) || compatibilityFiles.has(filePath) || binaryExtensions.test(filePath)) continue
    const source = readFileSync(filePath, 'utf8')
    if (vendorText.test(source) || vendorIdentifier.test(source)) violations.push(filePath)
  }
  assert.deepEqual(violations, [])
})
