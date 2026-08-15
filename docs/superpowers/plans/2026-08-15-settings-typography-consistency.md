# Settings Typography Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 Trader Atlas 全部设置入口的字体层级，使页面标题保持 20px、区块与字段主信息保持 13px、普通说明保持 12px，并消除设置页局部的错误放大。

**Architecture:** 保留全局字体令牌数值不变，在设置域内重新映射现有 `--type-*` 语义角色。先用静态设计契约锁定共享设置骨架和页面专用说明，再通过浏览器计算样式与完整桌面截图矩阵证明最终字号、折行和溢出符合预期。

**Tech Stack:** React 18、TypeScript、CSS Design Tokens、Vite 8、Electron 43、Node 回归测试、Playwright 桌面视觉矩阵。

## Global Constraints

- 始终以 UTF-8 无 BOM 读取和保存文件，完整保留中文字符。
- 仅适配 Windows 和 macOS 桌面客户端，窗口范围为 960–1920px。
- 不修改全局字号令牌数值，不新增页面私有裸字号。
- 不修改功能、文案含义、字段顺序、布局结构、状态、数据流、持久化或 Electron 桥接。
- 不改变按钮、输入框、开关、列表与弹窗的尺寸和点击区域。
- 每个任务先建立失败契约，再进行最小样式修改并独立提交。

---

## File Structure

- `src/lib/settingsTypographyConsistency.test.ts`：设置域字号语义的静态设计契约，验证选择器精确消费既有 `--type-*` 变量。
- `src/views/settings/SettingsLayout.css`：页面标题、页面说明、区块标题和区块说明的共享设置骨架。
- `src/views/settings/ProfileSettingsPanel.css`：个人资料预览名称与资料字段层级。
- `src/views/settings/DisplaySettingsPanel.css`：显示偏好区块说明层级。
- `src/views/settings/TagPresetsPanel.css`：标签管理区块说明层级。
- `src/components/DataIOContent.css`：数据与资料库普通说明层级；重要警告与数据值保持现有强调。
- `src/components/LiveCycleSettings.css`：风险周期设置说明层级。
- `src/views/TypographyRoles.browser.test.ts`：对代表性设置文字执行计算样式验证。

---

### Task 1: Lock the Shared Settings Typography Hierarchy

**Files:**
- Create: `src/lib/settingsTypographyConsistency.test.ts`
- Modify: `src/views/settings/SettingsLayout.css`
- Modify: `src/views/settings/ProfileSettingsPanel.css`

**Interfaces:**
- Consumes: `--type-page-title-size`、`--type-section-title-size`、`--type-row-size`、`--type-body-size`、`--type-metadata-size` 及对应行高。
- Produces: 设置页唯一主标题、12px 普通说明和 15px 个人资料预览名称的共享契约。

- [ ] **Step 1: Write the failing shared-role contract**

创建 `src/lib/settingsTypographyConsistency.test.ts`：

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'

function read(file: string): string {
  return readFileSync(path.resolve(file), 'utf8').replace(/\r\n?/g, '\n')
}

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))
  if (!match) throw new Error(`缺少设置字体样式：${selector}`)
  return match[1] ?? ''
}

function expectRole(css: string, selector: string, declaration: string): void {
  if (!rule(css, selector).includes(declaration)) {
    throw new Error(`${selector} 必须包含 ${declaration}`)
  }
}

export function testSharedSettingsTypographyUsesCanonicalRoles(): void {
  const layout = read('src/views/settings/SettingsLayout.css')
  const profile = read('src/views/settings/ProfileSettingsPanel.css')

  expectRole(layout, '.settings-page-title', 'font-size: var(--type-page-title-size)')
  expectRole(layout, '.settings-page-desc', 'font-size: var(--type-metadata-size)')
  expectRole(layout, '.settings-page-desc', 'line-height: var(--type-metadata-line-height)')
  expectRole(layout, '.settings-section-title', 'font-size: var(--type-section-title-size)')
  expectRole(layout, '.settings-section-desc', 'font-size: var(--type-metadata-size)')
  expectRole(layout, '.settings-section-desc', 'line-height: var(--type-metadata-line-height)')
  expectRole(profile, '.profile-preview-name', 'font-size: var(--type-body-size)')
  expectRole(profile, '.profile-preview-name', 'line-height: var(--type-body-line-height)')

  if (rule(profile, '.profile-preview-name').includes('--type-page-title-size')) {
    throw new Error('个人资料预览名称不得与页面主标题同级')
  }
}
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/settingsTypographyConsistency.test.ts`

Expected: FAIL，首个错误为 `.settings-page-desc 必须包含 font-size: var(--type-metadata-size)`。

- [ ] **Step 3: Implement the shared hierarchy**

在 `src/views/settings/SettingsLayout.css` 中保留 `.settings-page-title` 与 `.settings-section-title`，仅将说明改为 metadata 角色：

```css
.settings-page-desc {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--type-metadata-size);
  line-height: var(--type-metadata-line-height);
}

.settings-section-desc {
  margin: 0;
  color: var(--text-muted);
  font-size: var(--type-metadata-size);
  line-height: var(--type-metadata-line-height);
}
```

在 `src/views/settings/ProfileSettingsPanel.css` 中将预览名称降为突出正文，不改变字重：

```css
.profile-preview-name {
  font-size: var(--type-body-size);
  font-weight: var(--font-weight-semibold);
  line-height: var(--type-body-line-height);
  letter-spacing: 0;
  color: var(--text-primary);
}
```

- [ ] **Step 4: Run focused and design verification**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/settingsTypographyConsistency.test.ts`

Expected: PASS。

Run: `pnpm qa:design`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/settingsTypographyConsistency.test.ts src/views/settings/SettingsLayout.css src/views/settings/ProfileSettingsPanel.css
git commit -m "style: align shared settings typography"
```

### Task 2: Align Page-Specific Settings Descriptions

**Files:**
- Modify: `src/lib/settingsTypographyConsistency.test.ts`
- Modify: `src/views/settings/DisplaySettingsPanel.css`
- Modify: `src/views/settings/TagPresetsPanel.css`
- Modify: `src/components/DataIOContent.css`
- Modify: `src/components/LiveCycleSettings.css`

**Interfaces:**
- Consumes: Task 1 的 `expectRole` 静态契约助手与全局 metadata 角色。
- Produces: 显示、标签、数据和风险周期设置的统一 12px 普通说明。

- [ ] **Step 1: Extend the failing page-specific contract**

在 `src/lib/settingsTypographyConsistency.test.ts` 增加：

```ts
export function testSettingsDescriptionsUseMetadataWithoutFlatteningImportantValues(): void {
  const display = read('src/views/settings/DisplaySettingsPanel.css')
  const tags = read('src/views/settings/TagPresetsPanel.css')
  const data = read('src/components/DataIOContent.css')
  const liveCycle = read('src/components/LiveCycleSettings.css')

  expectRole(display, '.display-section-head p', 'font-size: var(--type-metadata-size)')
  expectRole(display, '.display-section-head p', 'line-height: var(--type-metadata-line-height)')
  expectRole(tags, '.tag-section-desc', 'font-size: var(--type-metadata-size)')
  expectRole(tags, '.tag-section-desc', 'line-height: var(--type-metadata-line-height)')
  expectRole(data, '.dio-desc', 'font-size: var(--type-metadata-size)')
  expectRole(data, '.dio-group-desc', 'font-size: var(--type-metadata-size)')
  expectRole(liveCycle, '.live-cycle-settings-copy p,\n.live-cycle-prompt p', 'font-size: var(--type-metadata-size)')

  expectRole(data, '.health-value', 'font-size: var(--type-body-size)')
  expectRole(data, '.dio-restore-warning', 'font-size: var(--type-body-size)')
  expectRole(data, '.data-purge-summary > strong', 'font-size: var(--type-body-size)')
}
```

- [ ] **Step 2: Run the focused test and verify the first page-specific failure**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/settingsTypographyConsistency.test.ts`

Expected: FAIL，指出 `.display-section-head p` 尚未使用 `--type-metadata-size`。

- [ ] **Step 3: Replace only ordinary-description roles**

在四个目标 CSS 文件中执行以下精确映射：

```css
.display-section-head p,
.tag-section-desc,
.dio-desc,
.dio-group-desc,
.live-cycle-settings-copy p,
.live-cycle-prompt p {
  font-size: var(--type-metadata-size);
  line-height: var(--type-metadata-line-height);
}
```

实际声明继续留在各自文件和选择器中，不创建跨文件组合规则。保留 `.health-value`、`.dio-restore-warning`、`.data-purge-confirm`、`.data-purge-summary > strong` 的 `--type-body-size`，因为它们分别承担数据强调、重要警告、明确确认和汇总值语义。

- [ ] **Step 4: Run focused, regression and type verification**

Run: `node scripts/run-regression-tests.mjs --unit-only src/lib/settingsTypographyConsistency.test.ts`

Expected: PASS。

Run: `node scripts/run-regression-tests.mjs`

Expected: PASS。

Run: `pnpm typecheck`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add -- src/lib/settingsTypographyConsistency.test.ts src/views/settings/DisplaySettingsPanel.css src/views/settings/TagPresetsPanel.css src/components/DataIOContent.css src/components/LiveCycleSettings.css
git commit -m "style: normalize settings description hierarchy"
```

### Task 3: Verify Computed Settings Font Sizes

**Files:**
- Modify: `src/views/TypographyRoles.browser.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 的共享与页面专用 CSS 角色。
- Produces: 浏览器实际计算后的 20px、15px、13px、12px 设置域字号证据。

- [ ] **Step 1: Add failing computed-style samples before importing page-specific CSS**

先不要增加页面专用 CSS 导入。在 `run()` 的样例 HTML 中添加：

```html
<p class="settings-page-desc">设置页说明</p>
<h2 class="settings-section-title">设置区块</h2>
<p class="settings-section-desc">设置区块说明</p>
<strong class="profile-preview-name">桌面视觉样本</strong>
<div class="display-section-head"><p>显示设置说明</p></div>
<p class="tag-section-desc">标签设置说明</p>
<p class="dio-group-desc">资料库设置说明</p>
```

在 `run()` 中页面标题断言之后加入：

```ts
for (const selector of [
  '.settings-page-desc',
  '.settings-section-desc',
  '.display-section-head p',
  '.tag-section-desc',
  '.dio-group-desc',
]) {
  const style = getComputedStyle(document.querySelector<HTMLElement>(selector)!)
  assert(style.fontSize === '12px', `${selector} 计算后字号必须为 12px`)
  assert(style.lineHeight === '16px', `${selector} 计算后行高必须为 16px`)
}

const settingsSectionTitle = getComputedStyle(document.querySelector<HTMLElement>('.settings-section-title')!)
assert(settingsSectionTitle.fontSize === '13px', '设置区块标题计算后字号必须为 13px')

const profileName = getComputedStyle(document.querySelector<HTMLElement>('.profile-preview-name')!)
assert(profileName.fontSize === '15px', '个人资料预览名称计算后字号必须为 15px')
assert(profileName.lineHeight === '23px', '个人资料预览名称计算后行高必须为 23px')
```

- [ ] **Step 2: Run the browser suite and verify the missing profile role fails**

Run: `node scripts/run-regression-tests.mjs`

Expected: FAIL，`.profile-preview-name` 尚未加载页面专用样式，计算字号不是 15px。

- [ ] **Step 3: Import the page-specific typography styles**

在 `src/views/TypographyRoles.browser.test.ts` 添加：

```ts
import './settings/ProfileSettingsPanel.css'
import './settings/DisplaySettingsPanel.css'
import '@/components/DataIOContent.css'
```

- [ ] **Step 4: Run the complete browser and design contracts**

Run: `node scripts/run-regression-tests.mjs`

Expected: PASS。

Run: `pnpm qa:design`

Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add -- src/views/TypographyRoles.browser.test.ts
git commit -m "test: cover settings typography roles"
```

### Task 4: Complete Desktop Visual QA and Rebuild the Installer

**Files:**
- Verify: `.gstack/qa-reports/desktop-visual-convergence/renderer/<viewport>/settings-*.png`
- Generate: `release/Trader-Atlas-1.4.1-win-x64.exe`

**Interfaces:**
- Consumes: Tasks 1–3 的最终样式与自动契约。
- Produces: 全部设置入口在五档桌面窗口下的视觉证据，以及包含本次修改的 Windows x64 安装包。

- [ ] **Step 1: Run the full verification suite**

Run: `pnpm typecheck`

Expected: PASS。

Run: `pnpm test`

Expected: PASS，无 skip/todo。

Run: `pnpm build`

Expected: PASS，包体预算通过。

Run: `pnpm qa:design`

Expected: PASS。

- [ ] **Step 2: Regenerate the complete desktop renderer matrix**

Run: `pnpm qa:desktop-visual --renderer`

Expected: 22 scenarios × 5 viewports = 110 captures；0 overflow、0 console errors、0 page errors，字体检查全部通过。

- [ ] **Step 3: Inspect representative settings screenshots**

人工检查 960×640、1440×900、1920×1080 下的 `settings-profile`、`settings-display`、`settings-risk`、`settings-data`，并抽查其余六个设置入口。确认每页仅有一个 20px 主标题、普通说明为 12px、字段主信息为 13px、资料预览名称为 15px，且没有新增折行或截断。

- [ ] **Step 4: Verify the repository and commits**

Run: `git diff --check`

Expected: 无输出。

Run: `git status --short`

Expected: 无未提交源码改动。

- [ ] **Step 5: Build the Windows installer**

Run: `pnpm dist:win`

Expected: 成功生成 `release/Trader-Atlas-1.4.1-win-x64.exe`，构建退出码为 0。

- [ ] **Step 6: Record installer integrity**

Run:

```powershell
$exe = Get-Item -LiteralPath 'release\Trader-Atlas-1.4.1-win-x64.exe'
$hash = Get-FileHash -LiteralPath $exe.FullName -Algorithm SHA256
[pscustomobject]@{ Path = $exe.FullName; SizeMB = [math]::Round($exe.Length / 1MB, 2); SHA256 = $hash.Hash } | Format-List
```

Expected: 输出安装包绝对路径、文件大小和 SHA-256；文件存在且大小大于 0。
