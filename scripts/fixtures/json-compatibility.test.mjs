import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('JSON 兼容 harness 可从仓库外临时目录解析全部生产依赖', () => {
  const runner = fs.readFileSync('scripts/measure-json-import-compatibility.mjs', 'utf8')
  assert.match(runner, /ssr:\s*\{\s*noExternal:\s*true\s*\}/)
  assert.match(runner, /mkdtemp\(path\.join\(os\.tmpdir\(\), 'atlas-json-compat-'\)\)/)
})
