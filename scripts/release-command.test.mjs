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
    '.github/workflows/release-candidate.yml',
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

test('发布候选先认证精确 SHA，tag 流水线只做双平台安全构建', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const candidate = readFileSync('.github/workflows/release-candidate.yml', 'utf8')
  const certification = workflowJob(workflow, 'certification')
  const windows = workflowJob(workflow, 'build-windows')
  const macos = workflowJob(workflow, 'build-macos')
  const platformEvidence = readFileSync('.github/workflows/forced-kill-evidence.yml', 'utf8')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

  assert.match(workflow, /permissions:\s*\r?\n\s+contents:\s*read/)
  assert.match(candidate, /workflow_dispatch:/)
  assert.match(candidate, /commit:/)
  assert.match(candidate, /ref:\s*\$\{\{ inputs\.commit \}\}/)
  assert.match(candidate, /\$\{\{ inputs\.commit \}\}.*-ne.*\$\{\{ github\.sha \}\}/)
  assert.match(candidate, /pnpm qa:full/)
  assert.match(candidate, /pnpm benchmark:persistence\s*$/m)
  assert.doesNotMatch(candidate, /benchmark:persistence:release/)
  assert.match(candidate, /pnpm verify:release-train-drills/)
  assert.match(candidate, /pnpm measure:json-compatibility/)
  assert.match(certification, /actions:\s*read/)
  assert.match(certification, /release-candidate\.yml/)
  assert.match(certification, /github\.sha/)
  assert.match(windows, /needs:\s*certification/)
  assert.match(macos, /needs:\s*certification/)
  assert.match(macos, /pnpm qa:electron/)
  assert(macos.indexOf('pnpm build:app') < macos.indexOf('pnpm qa:electron'))
  assert.match(macos, /pnpm test:asset-lifecycle:electron/)
  assert.match(windows, /pnpm test:live-stage:desktop/)
  assert.match(macos, /pnpm test:live-stage:desktop/)
  assert.match(platformEvidence, /pnpm test:live-stage:desktop/)
  assert.equal(
    pkg.scripts['test:live-stage:desktop'],
    'node scripts/run-regression-tests.mjs --unit-only electron/library/schemaMigration.test.ts electron/library/stageRolloverCommit.test.ts src/lib/librarySwitchRace.test.ts',
  )
  assert.match(windows, /pnpm test:forced-kill:electron/)
  assert.match(macos, /pnpm test:forced-kill:electron/)
  assert.match(windows, /pnpm test:asset-lifecycle:electron/)
  assert.match(windows, /forced-kill-Windows/)
  assert.match(macos, /forced-kill-macOS/)
  assert.match(windows, /asset-lifecycle-Windows/)
  assert.match(macos, /asset-lifecycle-macOS/)
  assert.doesNotMatch(macos, /needs:\s*build-windows/)
  assert.match(windows, /electron-builder --win nsis --x64 --publish never/)
  assert.match(macos, /electron-builder --mac dmg zip --\$\{\{ matrix\.arch \}\} --publish never/)
  assert.doesNotMatch(workflow, /^  quality:\s*$/m)
  assert.doesNotMatch(workflow, /benchmark:persistence:release/)
  assert.doesNotMatch(workflow, /pnpm spike:generation/)
  assert.doesNotMatch(workflow, /verify-release-evidence:/)
})

test('候选认证旁路必须显式开启且留下审计记录，默认保持关闭', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const certification = workflowJob(workflow, 'certification')

  assert.match(
    certification,
    /if:\s*vars\.RELEASE_CANDIDATE_GATE_BYPASS != 'true'/,
    '未显式开启仓库变量时必须执行候选认证',
  )
  assert.match(
    certification,
    /if:\s*vars\.RELEASE_CANDIDATE_GATE_BYPASS == 'true'/,
    '显式旁路必须有独立审计步骤',
  )
  assert.match(certification, /::warning::.*candidate certification bypassed/i)
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
  assert.match(publish, /needs:\s*\[certification, build-windows, build-macos\]/)
  assert.match(publish, /environment:\s*production-release/)
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

test('本地发布在远端候选认证通过后才推送 tag，失败可沿用版本重试', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const release = readFileSync('scripts/release.mjs', 'utf8')
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const qualityGate = readFileSync('scripts/qa-release.mjs', 'utf8')

  assert.match(release, /qa:release/)
  assert.match(release, /--no-git-tag-version/)
  assert.match(release, /release-candidate\.yml/)
  assert.match(release, /gh[^\n]*workflow[^\n]*run/)
  assert.match(release, /gh[^\n]*run[^\n]*watch/)
  assert.match(release, /knownRunIds/)
  assert.match(release, /!knownRunIds\.has\(candidate\.databaseId\)/)
  assert.match(release, /继续候选/)
  assert(
    release.indexOf("['push', 'origin', 'main']") < release.indexOf("['push', 'origin', tag]"),
    '必须先推版本提交并通过候选认证，最后才允许推 tag',
  )
  assert.match(workflow, /pnpm build:app/)
  assert.match(workflow, /pattern:\s*release-\*-attempt-\$\{\{ github\.run_attempt \}\}/)
  assert.doesNotMatch(workflow, /final-quality-manifest/)
  assert.equal(pkg.scripts['qa:release'], 'node scripts/qa-release.mjs')
  assert.equal(pkg.scripts['qa:full'], 'node scripts/qa-release.mjs --full')
  assert.match(qualityGate, /process\.argv\.includes\('--full'\)/)
  assert.match(qualityGate, /\['qa:ci'\]/)
  assert.doesNotMatch(qualityGate, /\['qa:sidebar'\]/)
  assert.match(qualityGate, /\['qa:electron'\]/)
  assert.match(qualityGate, /full \? 'qa' : 'qa:core'/)
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
  assert.match(
    workbenchQa,
    /locator\('\.list-scroll'\)\s*\.getByRole\('button', \{ name: '新建案例', exact: true \}\)\s*\.click\(\)/,
    '工作台首步必须通过当前可访问名称创建案例，不能依赖已经退出产品 DOM 的旧类名',
  )
  assert.match(workbenchQa, /getByRole\('button', \{ name: '更多信息', exact: true \}\)\.click\(\)/)
  assert.match(workbenchQa, /getByRole\('dialog', \{ name: '新建案例', exact: true \}\)/)
  assert.match(workbenchQa, /activityText\.includes\('创建了这个案例'\)/)
  assert.doesNotMatch(workbenchQa, /caseType=missed/)
  assert.doesNotMatch(workbenchQa, /创建了这条案例记录/)
  assert.match(workbenchQa, /\['全部', '本周', '本月', '亏损', '星标交易', '错过机会'\]/)
  assert.doesNotMatch(
    workbenchQa,
    /locator\('\.empty-btn'\)/,
    '发布工作台 QA 不得等待已经移除的 .empty-btn',
  )
  assert.match(
    workbenchQa,
    /getByRole\('dialog', \{ name: '确认复制所选记录' \}\)/,
    '安全复制预览必须等待当前 ModalShell 可访问标题',
  )
  assert.doesNotMatch(
    workbenchQa,
    /确认安全复制/,
    '工作台 QA 不得等待已经改名的旧复制对话框',
  )
  assert.doesNotMatch(
    workbenchQa,
    /locator\('body'\)\.press\('n'\)/,
    '发布工作台 QA 必须点击真实桌面创建入口，不能依赖页面焦点接收全局快捷键',
  )
  assert.doesNotMatch(
    workbenchQa,
    /const strategyOptions = page\.locator\('\.ui-select-option'\)/,
    '交易创建回归应校验默认策略持久化，不能依赖全局退出动画选项定位',
  )
  assert.doesNotMatch(
    workbenchQa,
    /\.dv-review-chip/,
    '工作台回归必须使用当前可访问名称，不能依赖已移除的旧版复盘胶囊类名',
  )
  assert.doesNotMatch(
    workbenchQa,
    /width:\s*375|mobileNavigationVisible/,
    '桌面发布 QA 不得继续执行已退出支持范围的手机壳层断言',
  )
  assert.match(
    workbenchQa,
    /closest\('\.sb-sortable-row'\)\?\.classList\.contains\('is-active'\)/,
    '一级导航回归必须按当前行容器选中态与链接 aria-current 的分工验收',
  )
  const recycleCalls = workbenchQa.match(/await recyclePage\(/g) ?? []

  assert.match(workbenchQa, /async function recyclePage/)
  assert.ok(recycleCalls.length >= 3, '长流程至少应在三个阶段边界回收旧渲染页面')
  assert.match(workbenchQa, /await page\.close\(\)\s*\r?\n\s*for \(const viewport of baselineViewports\)/)
})

test('回归构建恢复调用方 NODE_ENV 后才启动浏览器开发服务器', () => {
  const regressionRunner = readFileSync('scripts/run-regression-tests.mjs', 'utf8')
  const capture = regressionRunner.indexOf('const originalNodeEnv = process.env.NODE_ENV')
  const build = regressionRunner.indexOf('await build({')
  const restoreCalls = [...regressionRunner.matchAll(/\brestoreNodeEnv\(\)/g)]
    .map((match) => match.index)
  const browser = regressionRunner.indexOf('runBrowserRegressionTests(root')

  assert.ok(capture >= 0, 'runner 必须捕获进入时的 NODE_ENV')
  assert.match(regressionRunner, /delete process\.env\.NODE_ENV/)
  assert.match(regressionRunner, /else process\.env\.NODE_ENV = originalNodeEnv/)
  assert.ok(restoreCalls.length >= 3, '正常路径与异常 finally 都必须恢复 NODE_ENV')
  assert.ok(
    restoreCalls.some((index) => index > build && index < browser),
    'vite.build 的 production 环境必须在开发服务器前恢复',
  )
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

test('macOS 在两个原生架构 runner 各自产出并验证 DMG 与 ZIP，但不直接修改 GitHub Release', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const macos = workflowJob(workflow, 'build-macos')
  assert.match(macos, /runner:\s*macos-26[\s\S]*arch:\s*arm64/)
  assert.match(macos, /runner:\s*macos-26-intel[\s\S]*arch:\s*x64/)
  assert.match(macos, /runs-on:\s*\$\{\{ matrix\.runner \}\}/)
  assert.match(macos, /mac-\$\{\{ matrix\.arch \}\}\.dmg/)
  assert.match(macos, /mac-\$\{\{ matrix\.arch \}\}\.zip/)
  assert.match(macos, /macos-\$\{\{ matrix\.arch \}\}-dmg\.json/)
  assert.match(macos, /macos-\$\{\{ matrix\.arch \}\}-zip\.json/)
  for (const evidenceName of ['forced-kill', 'asset-lifecycle', 'electron-safety']) {
    assert.match(
      macos,
      new RegExp(`name: ${evidenceName}-macOS-\\$\\{\\{ matrix\\.arch \\}\\}-attempt-\\$\\{\\{ github\\.run_attempt \\}\\}`),
      `${evidenceName} 证据 artifact 必须按 matrix arch 唯一命名，避免 upload-artifact v4 的 409 竞态`,
    )
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
  assert.match(iconScript, /NSIS_BMP_SCALE = 2/, '安装器位图须按 2× 输出，兼顾高 DPI 清晰度与缩放质量')
})
// Quality-Scenario: R-WIN-FAIL
// Quality-Scenario: R-MAC-FAIL
