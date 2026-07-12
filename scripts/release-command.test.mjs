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

test('发布流水线从新版图标源重新生成全部应用图标', () => {
  const workflow = readFileSync('.github/workflows/release-windows.yml', 'utf8')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

  assert.match(workflow, /pnpm icons:app/)
  assert.equal(pkg.build?.icon, 'build/icon.ico')
  assert.equal(pkg.build?.win?.icon, 'build/icon.ico')
  assert.equal(pkg.build?.mac?.icon, 'build/icon.png')
})

test('在线更新发布只构建 NSIS，避免 Portable 覆盖同名安装包', () => {
  const workflow = readFileSync('.github/workflows/release-windows.yml', 'utf8')
  assert.doesNotMatch(
    workflow,
    /electron-builder --win nsis portable/,
    'NSIS 与 Portable 当前共用 artifactName，不能在同一发布命令并行上传',
  )
})

test('发布资产由 GitHub CLI 串行上传并校验', () => {
  const workflow = readFileSync('.github/workflows/release-windows.yml', 'utf8')
  assert.match(workflow, /electron-builder --win nsis --x64 --publish never/)
  assert.match(workflow, /gh release create/)
  assert.match(workflow, /latest\.yml/)
  assert.doesNotMatch(workflow, /--publish always/)
})

test('发布门禁包含侧栏与 Electron QA', () => {
  const workflow = readFileSync('.github/workflows/release-windows.yml', 'utf8')
  const release = readFileSync('scripts/release.mjs', 'utf8')

  assert.match(workflow, /pnpm qa:sidebar/)
  assert.match(workflow, /pnpm qa:electron/)
  assert.match(release, /qa:sidebar/)
  assert.match(release, /qa:electron/)
})

test('安装包文件名不含空格，必须与 latest.yml 下载地址一致', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.equal(pkg.build?.win?.artifactName, 'Yunkoo-Atlas-${version}-win-${arch}.${ext}')
})
