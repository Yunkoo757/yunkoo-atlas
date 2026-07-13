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
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  assert.match(
    workflow,
    /pnpm exec install-electron/,
    'Electron 42 不再自动 postinstall，发布前必须执行 install-electron',
  )
})

test('发布流水线从新版图标源重新生成全部应用图标', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

  assert.match(workflow, /pnpm icons:app/)
  assert.equal(pkg.build?.icon, 'build/icon.ico')
  assert.equal(pkg.build?.win?.icon, 'build/icon.ico')
  assert.equal(pkg.build?.mac?.icon, 'build/icon.png')
})

test('在线更新发布只构建 NSIS，避免 Portable 覆盖同名安装包', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  assert.doesNotMatch(
    workflow,
    /electron-builder --win nsis portable/,
    'NSIS 与 Portable 当前共用 artifactName，不能在同一发布命令并行上传',
  )
})

test('发布资产由 GitHub CLI 串行上传并校验', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  assert.match(workflow, /electron-builder --win nsis --x64 --publish never/)
  assert.match(workflow, /\$releaseArgs = @\('release', 'create'/)
  assert.match(workflow, /& gh @releaseArgs/)
  assert.match(workflow, /latest\.yml/)
  assert.doesNotMatch(workflow, /--publish always/)
})

test('预览版本创建 GitHub Prerelease，正式客户端继续忽略预发布更新', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const updater = readFileSync('electron/updater.ts', 'utf8')

  assert.match(workflow, /\$isPrerelease = \$version\.Contains\('-'\)/)
  assert.match(workflow, /if \(\$isPrerelease\) \{ \$releaseArgs \+= @\('--prerelease', '--latest=false'\) \}/)
  assert.match(workflow, /isPrerelease,assets/)
  assert.match(updater, /autoUpdater\.allowPrerelease = false/)
})

test('重复执行发布工作流时更新并覆盖既有 Release 资产', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')

  assert.match(workflow, /\$releaseExists = \$LASTEXITCODE -eq 0/)
  assert.match(workflow, /'release', 'edit'/)
  assert.match(workflow, /release upload \$tag @assetPaths --clobber/)
})

test('本地发布运行完整门禁，云端打包复验构建与 Electron 数据链路', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const release = readFileSync('scripts/release.mjs', 'utf8')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const qualityGate = readFileSync('scripts/qa-release.mjs', 'utf8')

  assert.match(release, /qa:release/)
  assert.match(workflow, /pnpm build:app/)
  assert.match(workflow, /pnpm qa:electron/)
  assert.equal(pkg.scripts['qa:release'], 'node scripts/qa-release.mjs')
  assert.match(qualityGate, /\['qa:sidebar'\]/)
  assert.match(qualityGate, /\['qa:electron'\]/)
  assert.match(qualityGate, /\['qa:design'\]/)
  assert.match(qualityGate, /\['qa:linear'\]/)
  assert.match(qualityGate, /waitForVite/)
})

test('常规 CI 在主干与拉取请求上运行同一质量门禁', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')

  assert.match(workflow, /push:/)
  assert.match(workflow, /pull_request:/)
  assert.match(workflow, /pnpm qa:release/)
})

test('应用构建同时检查渲染进程与 Electron 主进程类型', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const electronTsconfig = readFileSync('tsconfig.electron.json', 'utf8')

  assert.match(pkg.scripts.typecheck, /tsconfig\.electron\.json/)
  assert.match(pkg.scripts['build:app'], /pnpm typecheck/)
  assert.match(electronTsconfig, /"include": \["electron"\]/)
})

test('安装包文件名不含空格，必须与 latest.yml 下载地址一致', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.equal(pkg.build?.win?.artifactName, 'Yunkoo-Atlas-${version}-win-${arch}.${ext}')
  assert.equal(pkg.build?.mac?.artifactName, 'Yunkoo-Atlas-${version}-mac-${arch}.${ext}')
})

test('发布流水线在 Windows 之后构建并上传 macOS 产物', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  assert.match(workflow, /build-macos:/)
  assert.match(workflow, /needs:\s*build-windows/)
  assert.match(workflow, /runs-on:\s*macos-latest/)
  assert.match(workflow, /electron-builder --mac dmg zip --publish never/)
  assert.match(workflow, /gh release upload/)
  assert.match(workflow, /CSC_IDENTITY_AUTO_DISCOVERY/)
})

test('NSIS 安装包声明高 DPI，避免安装向导发糊', () => {
  const nsh = readFileSync('build/installer.nsh', 'utf8')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.match(nsh, /ManifestDPIAware\s+true/)
  assert.match(nsh, /ManifestDPIAwareness\s+PerMonitorV2/)
  assert.equal(pkg.build?.nsis?.include, 'build/installer.nsh')
})
