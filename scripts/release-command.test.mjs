import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveCommand } from './release-command.mjs'

test('Windows 通过当前 Node 执行 pnpm CLI，避免 spawnSync pnpm.cmd EINVAL', () => {
  const invocation = resolveCommand('pnpm', ['test'], {
    platform: 'win32',
    nodePath: 'C:\\node.exe',
    pnpmCli: 'C:\\pnpm\\pnpm.cjs',
  })

  assert.deepEqual(invocation, {
    file: 'C:\\node.exe',
    args: ['C:\\pnpm\\pnpm.cjs', 'test'],
  })
})

test('非 pnpm 命令保持原始可执行文件和参数', () => {
  assert.deepEqual(
    resolveCommand('git', ['status'], {
      platform: 'win32',
      nodePath: 'C:\\node.exe',
      pnpmCli: 'C:\\pnpm\\pnpm.cjs',
    }),
    { file: 'git', args: ['status'] },
  )
})

test('当前 Windows 环境能够定位真实 pnpm CLI', () => {
  if (process.platform !== 'win32') return
  const invocation = resolveCommand('pnpm', ['--version'])

  assert.equal(invocation.file, process.execPath)
  assert.match(invocation.args[0], /pnpm[\\/]bin[\\/]pnpm\.cjs$/)
})
