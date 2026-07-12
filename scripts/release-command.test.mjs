import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

test('发布流水线显式安装 Electron 运行时', () => {
  const workflow = readFileSync('.github/workflows/release-windows.yml', 'utf8')
  assert.match(
    workflow,
    /pnpm exec install-electron/,
    'Electron 42 不再自动 postinstall，发布前必须执行 install-electron',
  )
})

test('在线更新发布只构建 NSIS，避免 Portable 覆盖同名安装包', () => {
  const workflow = readFileSync('.github/workflows/release-windows.yml', 'utf8')
  assert.doesNotMatch(
    workflow,
    /electron-builder --win nsis portable/,
    'NSIS 与 Portable 当前共用 artifactName，不能在同一发布命令并行上传',
  )
})
