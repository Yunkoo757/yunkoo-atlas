import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('offline editor full contract is self-contained and preserves its synthetic source', { timeout: 90_000 }, () => {
  const env = { ...process.env }
  delete env.ATLAS_EDITOR_TEST_LIBRARY
  const result = spawnSync(process.execPath, ['tools/atlas-data-editor/test.mjs'], {
    cwd: process.cwd(), env, encoding: 'utf8', timeout: 80_000,
  })
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message)
  assert.match(result.stdout, /export roundtrip, Atlas desktop LibraryStorage.open\/loadSnapshot, attachment bytes, source unchanged/)
})
