import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveCommand } from './release-command.mjs'

function workflowJob(workflow, name) {
  const headings = [...workflow.matchAll(/^  ([a-z0-9-]+):\s*$/gm)]
  const index = headings.findIndex((heading) => heading[1] === name)
  assert.notEqual(index, -1, `发布工作流缺少 ${name} job`)
  const start = headings[index].index
  const end = headings[index + 1]?.index ?? workflow.length
  return workflow.slice(start, end)
}

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

test('pnpm 安装版本只能由 packageManager 或 Action 配置其中一处声明', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const packageManagerDeclaresPnpm = /^pnpm@/.test(pkg.packageManager ?? '')

  for (const workflowPath of [
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
  ]) {
    const workflow = readFileSync(workflowPath, 'utf8')
    const actionDeclaresPnpm =
      /uses:\s*pnpm\/action-setup@v4[\s\S]{0,200}?with:\s*\r?\n\s+version:\s*\S+/.test(workflow)

    assert.equal(
      Number(packageManagerDeclaresPnpm) + Number(actionDeclaresPnpm),
      1,
      `${workflowPath} 不得与 package.json 重复声明 pnpm 版本`,
    )
  }
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

test('发布流水线先通过唯一质量门禁，再并行构建两个平台', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const quality = workflowJob(workflow, 'quality')
  const windows = workflowJob(workflow, 'build-windows')
  const macos = workflowJob(workflow, 'build-macos')

  assert.match(workflow, /permissions:\s*\r?\n\s+contents:\s*read/)
  assert.match(quality, /pnpm qa:full/)
  assert.match(windows, /needs:\s*quality/)
  assert.match(macos, /needs:\s*quality/)
  assert.match(macos, /pnpm qa:electron/)
  assert(macos.indexOf('pnpm build:app') < macos.indexOf('pnpm qa:electron'))
  assert.match(macos, /pnpm test:asset-lifecycle:electron/)
  assert.match(windows, /pnpm test:forced-kill:electron/)
  assert.match(macos, /pnpm test:forced-kill:electron/)
  assert.match(windows, /pnpm test:asset-lifecycle:electron/)
  assert.match(windows, /forced-kill-Windows/)
  assert.match(macos, /forced-kill-macOS/)
  assert.match(windows, /asset-lifecycle-Windows/)
  assert.match(macos, /asset-lifecycle-macOS/)
  assert.doesNotMatch(macos, /needs:\s*build-windows/)
  assert.match(windows, /electron-builder --win nsis --x64 --publish never/)
  assert.match(macos, /electron-builder --mac dmg zip --x64 --arm64 --publish never/)
})

test('预览版本创建 GitHub Prerelease，正式客户端继续忽略预发布更新', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const publish = workflowJob(workflow, 'publish')
  const updater = readFileSync('electron/updater.ts', 'utf8')

  assert.match(publish, /is_prerelease=false/)
  assert.match(publish, /channel_args=\(--prerelease --latest=false\)/)
  assert.match(publish, /isDraft,isPrerelease,assets/)
  assert.match(publish, /release-artifacts\.mjs plan/)
  assert.match(publish, /merge-base --is-ancestor/)
  assert.match(updater, /autoUpdater\.allowPrerelease = false/)
})

test('构建 job 只上传流水线工件，唯一 publish job 才拥有写权限', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const windows = workflowJob(workflow, 'build-windows')
  const macos = workflowJob(workflow, 'build-macos')
  const publish = workflowJob(workflow, 'publish')

  assert.match(windows, /actions\/upload-artifact@v4/)
  assert.match(macos, /actions\/upload-artifact@v4/)
  assert.doesNotMatch(windows, /gh release/)
  assert.doesNotMatch(macos, /gh release/)
  assert.match(publish, /needs:\s*\[build-windows, build-macos, verify-release-evidence\]/)
  assert.match(publish, /permissions:\s*\r?\n\s+contents:\s*write/)
  assert.match(publish, /actions\/download-artifact@v4/)
  assert.match(publish, /gh release create[^\n]*--draft/)
  assert.match(publish, /gh release edit[^\n]*--draft=false/)
  assert(
    publish.indexOf('Upload release checksum provenance') < publish.indexOf('gh release edit "$tag" --draft=false'),
    'checksum provenance 必须先成功保存，最后一步才允许将 draft 转公开',
  )
  assert.doesNotMatch(publish, /--clobber/)
})

test('单点发布校验七个非空资产，并以哈希保证同标签重试不可覆写', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const publish = workflowJob(workflow, 'publish')

  for (const asset of [
    'win-x64.exe',
    'win-x64.exe.blockmap',
    'latest.yml',
    'mac-arm64.dmg',
    'mac-arm64.zip',
    'mac-x64.dmg',
    'mac-x64.zip',
  ]) {
    assert.match(publish, new RegExp(asset.replaceAll('.', '\\.')))
  }
  assert.match(publish, /sha256sum/)
  assert.match(publish, /Existing release asset differs/)
  assert.match(publish, /already public with identical assets/)
  assert.match(publish, /isDraft,isPrerelease,assets/)
})

test('本地发布运行轻量门禁，CI 打包复验构建与 Electron 数据链路', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const release = readFileSync('scripts/release.mjs', 'utf8')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const qualityGate = readFileSync('scripts/qa-release.mjs', 'utf8')

  assert.match(release, /qa:release/)
  assert.match(workflow, /pnpm build:app/)
  assert.match(workflow, /pnpm qa:full/)
  assert.match(workflow, /pnpm benchmark:persistence:release/)
  assert.match(workflow, /persistence-release\.json/)
  assert.match(workflow, /verify-release-evidence:/)
  assert.match(workflow, /path: test-results\/collected-evidence/)
  assert.match(workflow, /verify-release-train-evidence\.mjs --evidence-root test-results\/collected-evidence --require-complete/)
  assert.match(workflow, /pnpm verify:release-train-drills/)
  assert.match(workflow, /test-results\/release-trains\/release-train-drills\.json/)
  assert.match(workflow, /test-results\/release-trains\/final-quality-manifest\.json/)
  assert.match(workflow, /name:\s*train-recovery-evidence/)
  assert.doesNotMatch(workflow, /name:\s*release-train-evidence/)
  assert.equal(pkg.scripts['qa:release'], 'node scripts/qa-release.mjs')
  assert.equal(pkg.scripts['qa:full'], 'node scripts/qa-release.mjs --full')
  assert.match(qualityGate, /process\.argv\.includes\('--full'\)/)
  assert.match(qualityGate, /\['qa:ci'\]/)
  assert.match(qualityGate, /\['qa:sidebar'\]/)
  assert.match(qualityGate, /\['qa:electron'\]/)
  assert.match(qualityGate, /full \? 'qa' : 'qa:core'/)
  assert.match(qualityGate, /if \(full\) run\('pnpm', \['qa:linear'\]/)
  assert.match(qualityGate, /qa-dashboard-10k\.mjs/)
  assert.match(qualityGate, /waitForVite/)
  assert.match(qualityGate, /qa-release-full\.json/)
  assert.match(qualityGate, /sourceFingerprint/)
})

test('常规 CI 运行快速门禁，完整浏览器验收移至定时与手动工作流', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
  const fullQaWorkflow = readFileSync('.github/workflows/full-qa.yml', 'utf8')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const fastGate = readFileSync('scripts/qa-ci.mjs', 'utf8')
  const qualityGate = readFileSync('scripts/qa-release.mjs', 'utf8')

  assert.match(workflow, /push:/)
  assert.match(workflow, /pull_request:/)
  assert.match(workflow, /pnpm qa:ci/)
  assert.match(workflow, /pnpm benchmark:persistence/)
  assert.match(workflow, /persistence-smoke\.json/)
  assert.doesNotMatch(workflow, /pnpm qa:release/)
  assert.doesNotMatch(workflow, /performance:/)
  assert.doesNotMatch(workflow, /qa-dashboard-10k/)
  assert.match(workflow, /actions\/cache@v4/)
  assert.match(workflow, /AppData\/Local\/ms-playwright/)
  assert.equal(pkg.scripts['qa:ci'], 'node scripts/qa-ci.mjs')
  assert.match(fastGate, /\['test'\]/)
  assert.match(fastGate, /\['qa:design'\]/)
  assert.match(fastGate, /\['typecheck'\]/)
  assert.doesNotMatch(fastGate, /\['qa:sidebar'\]/)
  assert.doesNotMatch(fastGate, /\['qa:electron'\]/)
  assert.match(fullQaWorkflow, /workflow_dispatch:/)
  assert.match(fullQaWorkflow, /schedule:/)
  assert.match(fullQaWorkflow, /pnpm qa:full/)
  assert.match(fullQaWorkflow, /pnpm benchmark:persistence:release/)
  assert.match(fullQaWorkflow, /persistence-release\.json/)
  assert.match(fullQaWorkflow, /pnpm test:forced-kill:electron/)
  assert.match(fullQaWorkflow, /forced-kill-full-qa/)
  assert.match(fullQaWorkflow, /QA_PERFORMANCE_PROFILE:\s*hosted-windows/)
  assert.match(qualityGate, /process\.argv\.includes\('--full'\)/)
  assert.match(qualityGate, /if \(full\) run\(process\.execPath/)
})

test('工作台长流程分段回收浏览器页面，避免 Windows CI 内存耗尽', () => {
  const workbenchQa = readFileSync('scripts/qa-workbench.mjs', 'utf8')
  const recycleCalls = workbenchQa.match(/await recyclePage\(/g) ?? []

  assert.match(workbenchQa, /async function recyclePage/)
  assert.ok(recycleCalls.length >= 3, '长流程至少应在三个阶段边界回收旧渲染页面')
  assert.match(workbenchQa, /await page\.close\(\)\s*\r?\n\s*for \(const viewport of baselineViewports\)/)
})

test('应用构建同时检查渲染进程与 Electron 主进程类型', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const electronTsconfig = readFileSync('tsconfig.electron.json', 'utf8')
  const viteConfig = readFileSync('vite.config.ts', 'utf8')

  assert.match(pkg.scripts.typecheck, /tsconfig\.electron\.json/)
  assert.match(pkg.scripts['build:app'], /pnpm typecheck/)
  assert.match(pkg.scripts.build, /check-bundle-budget\.mjs/)
  assert.match(pkg.scripts['build:app'], /check-bundle-budget\.mjs/)
  assert.match(electronTsconfig, /"include": \["electron"\]/)
  assert.match(viteConfig, /manifest:\s*true/)
})

test('安装包文件名不含空格，必须与 latest.yml 下载地址一致', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.equal(pkg.build?.win?.artifactName, 'Trader-Atlas-${version}-win-${arch}.${ext}')
  assert.equal(pkg.build?.mac?.artifactName, 'Trader-Atlas-${version}-mac-${arch}.${ext}')
})

test('macOS 构建产出四个工件，但不直接修改 GitHub Release', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const macos = workflowJob(workflow, 'build-macos')
  assert.match(macos, /runs-on:\s*macos-latest/)
  for (const asset of [
    'mac-arm64.dmg',
    'mac-arm64.zip',
    'mac-x64.dmg',
    'mac-x64.zip',
  ]) {
    assert.match(macos, new RegExp(asset.replace('.', '\\.')))
  }
  assert.match(macos, /actions\/upload-artifact@v4/)
  assert.doesNotMatch(macos, /gh release/)
  assert.match(macos, /CSC_IDENTITY_AUTO_DISCOVERY/)
})

test('NSIS 安装包声明高 DPI，避免安装向导发糊', () => {
  const nsh = readFileSync('build/installer.nsh', 'utf8')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  assert.match(nsh, /ManifestDPIAware\s+true/)
  assert.match(nsh, /ManifestDPIAwareness\s+PerMonitorV2/)
  assert.equal(pkg.build?.nsis?.include, 'build/installer.nsh')
})

test('NSIS 安装向导使用 Atlas 品牌图与简体中文', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const iconScript = readFileSync('scripts/generate-app-icon.mjs', 'utf8')
  const nsis = pkg.build?.nsis ?? {}

  assert.equal(nsis.language, '2052')
  assert.deepEqual(nsis.installerLanguages, ['zh_CN'])
  assert.equal(nsis.installerIcon, 'build/icon.ico')
  assert.equal(nsis.uninstallerIcon, 'build/icon.ico')
  assert.equal(nsis.installerHeader, 'build/installerHeader.bmp')
  assert.equal(nsis.installerSidebar, 'build/installerSidebar.bmp')
  assert.equal(nsis.uninstallerSidebar, 'build/installerSidebar.bmp')
  assert.match(iconScript, /installerSidebar\.bmp/)
  assert.match(iconScript, /installerHeader\.bmp/)
  assert.match(iconScript, /encodeBmp24/)
  assert.match(iconScript, /NSIS_BMP_SCALE = 3/, '安装器位图须按 3× 输出，避免高 DPI 拉伸发糊')
})
// Quality-Scenario: R-WIN-FAIL
// Quality-Scenario: R-MAC-FAIL
