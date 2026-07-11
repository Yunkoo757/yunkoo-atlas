# Linear Icon Component Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已归档的 Linear 静态、状态、实时与动效图标构建成当前 React 项目可直接调用、命名规范、类型安全并可离线预览的组件库。

**Architecture:** `assets/linear-icon-system/raw/` 是不可变来源，Node 生成器负责解析 SVG 精灵库和 Linear 官方分类映射，生成静态 TSX 组件、类型化注册表、清单与离线图鉴。参数化状态和动画图标使用独立手写组件保存原始公式、路径与时间参数；公共 `LinearIcon` 仅负责静态注册键分发，动态组件通过具名 API 暴露。

**Tech Stack:** React 18、TypeScript 5.6、Vite 5、Node.js ESM、React DOM Server、Playwright、原生 CSS。

## Global Constraints

- 所有新增文本文件保存为 UTF-8 无 BOM，保留全部中文和非 ASCII 字符。
- 静态组件必须覆盖已归档的 301 个唯一 SVG；不进行路径简化、坐标舍入或 SVGO 重写。
- 公共组件使用 `Linear` 前缀和 `Icon` 后缀；注册键使用 kebab-case；`linearName` 保留 Linear 原始 PascalCase。
- 静态图标默认 16px；Issue 状态图标默认 14px；颜色默认继承 `currentColor`。
- 分类只使用 Linear 官方九类映射；缺失映射、名称冲突、组件名冲突或文件名冲突必须使生成失败。
- 动画必须响应 `prefers-reduced-motion: reduce`，Grid Loader 离开视口后允许暂停。
- 不替换现有业务图标，不重构无关组件，不增加新的运行时依赖。

---

## File Structure

### Source and generated files

- Create: `scripts/linear-icons/core.mjs` — 纯函数：解析 symbol、分类、命名、哈希与 TSX 模板。
- Create: `scripts/linear-icons/generate.mjs` — 从归档生成组件、注册表、清单、分类副本与图鉴数据。
- Create: `scripts/linear-icons/core.test.mjs` — Node 内置测试，验证解析、命名、冲突和分类失败。
- Modify: `package.json` — 增加 `icons:generate`、`test:icons`，并让总测试包含图标生成器测试。
- Generate: `assets/linear-icon-system/manifest.json` — 301 条来源、分类、名称、尺寸和 SHA-256 元数据。
- Generate: `assets/linear-icon-system/categories/<category>/*.svg` — 按官方九类整理的源 SVG 副本。
- Generate: `src/icons/linear/static/*.tsx` — 301 个具名静态组件。
- Generate: `src/icons/linear/static/index.ts` — 静态组件导出。
- Generate: `src/icons/linear/generated.ts` — 类型化名称、分类、加载器与元数据。

### Hand-authored runtime files

- Create: `src/icons/linear/types.ts` — 公共 SVG、状态与动画属性。
- Create: `src/icons/linear/iconA11y.ts` — `title` 与 ARIA 属性的一致处理。
- Create: `src/icons/linear/StaticLinearSvg.tsx` — 可信归档 SVG 的无损渲染与实例级 ID 隔离。
- Create: `src/icons/linear/LinearIcon.tsx` — 配置驱动的静态图标入口。
- Create: `src/icons/linear/status/LinearIssueStatusIcon.tsx` — Issue 状态与进度扇形。
- Create: `src/icons/linear/status/LinearProjectStatusIcon.tsx` — Project 六边形、遮罩、进度和状态过渡。
- Create: `src/icons/linear/status/LinearCycleProgressIcon.tsx` — Cycle 圆环、阶段与进度。
- Create: `src/icons/linear/animated/LinearGridLoaderIcon.tsx` — 5×5 位掩码帧动画。
- Create: `src/icons/linear/animated/LinearGridProgressIcon.tsx` — 25 点进度脉冲。
- Create: `src/icons/linear/animated/linearGridIcons.css` — 原始步进动画与 reduced-motion。
- Create: `src/icons/linear/index.ts` — 组件库公共导出。
- Create: `src/icons/linear/README.md` — API、命名、生成与维护说明。
- Create: `src/icons/linear/linear-icons.test.tsx` — SSR 结构、状态边界、动画与无障碍测试。
- Modify: `scripts/run-regression-tests.mjs` — 纳入组件库测试入口。

### Gallery files

- Create: `assets/linear-icon-system/gallery.html` — 离线图鉴外壳、搜索、主题、尺寸和进度控件。
- Create: `assets/linear-icon-system/gallery.css` — 图鉴样式。
- Create: `assets/linear-icon-system/gallery.js` — 清单加载、静态 SVG 展示和动态示例。
- Generate: `assets/linear-icon-system/gallery-data.js` — 可由 `file://` 直接读取的内嵌清单。
- Create: `scripts/qa-linear-icons.mjs` — Playwright 验证数量、分类、搜索、状态和 reduced-motion。
- Modify: `package.json` — 增加 `qa:icons`。

---

### Task 1: Build the deterministic archive parser and naming layer

**Files:**
- Create: `scripts/linear-icons/core.mjs`
- Create: `scripts/linear-icons/core.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: 原始 SVG 字符串、`EmojiContainer.CeAZEvLX.js` 分类模块字符串。
- Produces: `parseSymbols(markup, source): SymbolRecord[]`、`parseOfficialCategories(source): Map<string, string>`、`toRegistryName(linearName): string`、`toComponentName(linearName): string`、`renderStaticComponent(record): string`。

- [ ] **Step 1: Write the failing parser and naming tests**

```js
// scripts/linear-icons/core.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertUnique,
  parseOfficialCategories,
  parseSymbols,
  toComponentName,
  toRegistryName,
} from './core.mjs'

test('parses symbol geometry without rewriting paths', () => {
  const [icon] = parseSymbols(
    '<svg><symbol id="FaceHeartEyes" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1 2Z"/></symbol></svg>',
    'fixture.svg',
  )
  assert.deepEqual(icon, {
    linearName: 'FaceHeartEyes',
    viewBox: '0 0 16 16',
    body: '<path fill-rule="evenodd" d="M1 2Z"/>',
    source: 'fixture.svg',
  })
})

test('creates stable public names', () => {
  assert.equal(toRegistryName('FaceHeartEyes'), 'face-heart-eyes')
  assert.equal(toRegistryName('GitHub'), 'git-hub')
  assert.equal(toRegistryName('LinearAi'), 'linear-ai')
  assert.equal(toRegistryName('Clock--outline'), 'clock-legacy-outline')
  assert.equal(toComponentName('GitHub'), 'LinearGitHubIcon')
  assert.equal(toComponentName('Clock--outline'), 'LinearClockLegacyOutlineIcon')
})

test('parses Linear official category assignments', () => {
  const source = 'S={[y.Face]:b.FACES_PEOPLE_HEALTH,[y.GitHub]:b.COMPANIES}'
  assert.deepEqual([...parseOfficialCategories(source)], [
    ['Face', 'faces-people-health'],
    ['GitHub', 'companies'],
  ])
})

test('rejects duplicate generated names', () => {
  assert.throws(
    () => assertUnique([{ name: 'face' }, { name: 'face' }], 'name'),
    /Duplicate name: face/,
  )
})
```

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run: `node --test scripts/linear-icons/core.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/linear-icons/core.mjs`.

- [ ] **Step 3: Implement the parser, naming, validation, hashing and TSX template**

```js
// scripts/linear-icons/core.mjs
import { createHash } from 'node:crypto'

const CATEGORY_KEYS = {
  FACES_PEOPLE_HEALTH: 'faces-people-health',
  ORGANIC: 'organic',
  SPORT_ACTIVITIES_OBJECTS: 'sport-activities-objects',
  TRAVEL_PLACES: 'travel-places',
  TECHNOLOGY: 'technology',
  INTERFACE: 'interface',
  COMPANIES: 'companies',
  MONEY_CURRENCIES: 'money-currencies',
  SYSTEM: 'system',
}

const NAME_OVERRIDES = {
  'Clock--outline': {
    name: 'clock-legacy-outline',
    componentName: 'LinearClockLegacyOutlineIcon',
  },
}

export function parseSymbols(markup, source) {
  return [...markup.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g)].map((match) => {
    const linearName = match[1].match(/\bid="([^"]+)"/)?.[1]
    const viewBox = match[1].match(/\bviewBox="([^"]+)"/)?.[1]
    if (!linearName || !viewBox) throw new Error(`Invalid symbol in ${source}`)
    return { linearName, viewBox, body: match[2], source }
  })
}

export function parseOfficialCategories(source) {
  const result = new Map()
  const matcher = /\[y\.([A-Za-z0-9_-]+)\]:b\.([A-Z_]+)/g
  for (const [, linearName, rawCategory] of source.matchAll(matcher)) {
    const category = CATEGORY_KEYS[rawCategory]
    if (!category) throw new Error(`Unknown category: ${rawCategory}`)
    result.set(linearName, category)
  }
  return result
}

export function toRegistryName(linearName) {
  if (NAME_OVERRIDES[linearName]) return NAME_OVERRIDES[linearName].name
  return linearName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

export const toComponentName = (linearName) =>
  NAME_OVERRIDES[linearName]?.componentName ?? `Linear${linearName}Icon`
export const sha256 = (text) => createHash('sha256').update(text).digest('hex')

export function assertUnique(records, key) {
  const seen = new Set()
  for (const record of records) {
    if (seen.has(record[key])) throw new Error(`Duplicate ${key}: ${record[key]}`)
    seen.add(record[key])
  }
}

export function renderStaticComponent(record) {
  return `// Generated from ${record.source}; do not edit.\nimport { StaticLinearSvg } from '../StaticLinearSvg'\nimport type { LinearStaticIconProps } from '../types'\n\nconst body = ${JSON.stringify(record.body)}\n\nexport function ${record.componentName}(props: LinearStaticIconProps) {\n  return <StaticLinearSvg {...props} body={body} viewBox="${record.viewBox}" />\n}\n`
}
```

- [ ] **Step 4: Add the generator test command**

Add to `package.json` scripts:

```json
"test:icons": "node --test scripts/linear-icons/core.test.mjs"
```

- [ ] **Step 5: Run the focused test and commit**

Run: `pnpm test:icons`

Expected: 4 tests PASS.

```powershell
git add package.json scripts/linear-icons/core.mjs scripts/linear-icons/core.test.mjs
git commit -m "test: define Linear icon archive contracts"
```

---

### Task 2: Generate the 301 static components, official categories and manifest

**Files:**
- Create: `scripts/linear-icons/generate.mjs`
- Create: `src/icons/linear/types.ts`
- Create: `src/icons/linear/iconA11y.ts`
- Create: `src/icons/linear/StaticLinearSvg.tsx`
- Generate: `src/icons/linear/static/*.tsx`
- Generate: `src/icons/linear/static/index.ts`
- Generate: `src/icons/linear/generated.ts`
- Generate: `assets/linear-icon-system/manifest.json`
- Generate: `assets/linear-icon-system/categories/**/*.svg`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 pure functions and `assets/linear-icon-system/raw/svg-1.svg` through `svg-3.svg`.
- Produces: `LinearIconName`、`LinearIconCategory`、`linearIconMetadata`、`linearStaticIcons` and 301 named React components.

- [ ] **Step 1: Extend generator tests with the real archive invariant**

Append to `scripts/linear-icons/core.test.mjs`:

```js
import fs from 'node:fs/promises'
import path from 'node:path'

test('real archive resolves to 301 unique officially categorized icons', async () => {
  const root = path.resolve('assets/linear-icon-system/raw')
  const files = ['svg-1.svg', 'svg-2.svg', 'svg-3.svg']
  const symbols = (await Promise.all(files.map(async (file) =>
    parseSymbols(await fs.readFile(path.join(root, file), 'utf8'), file),
  ))).flat()
  const unique = new Map(symbols.map((symbol) => [symbol.linearName, symbol]))
  const moduleSource = await fs.readFile(
    path.join(root, 'modules/EmojiContainer.CeAZEvLX.js'),
    'utf8',
  )
  const categories = parseOfficialCategories(moduleSource)
  assert.equal(unique.size, 301)
  assert.deepEqual(
    [...unique.keys()].filter((name) => !categories.has(name)).sort(),
    [
      'AiWriting', 'Alarm', 'AlarmDelete', 'Anonymous', 'BarGraph', 'Biscuit',
      'ChatLine', 'Circle', 'Clock', 'Clock--outline', 'EmptyCircle',
      'ExclamationMark', 'Flag', 'GooglePlay', 'LinearAi', 'QuestionMark',
      'Ramp', 'Report', 'Resolved', 'ResolvedChat', 'ScatterPlot', 'SmallLock',
      'SoundMuted', 'Starred', 'Stopwatch',
    ].sort(),
  )
})

test('generated manifest contains all 301 records', async () => {
  const manifest = JSON.parse(
    await fs.readFile('assets/linear-icon-system/manifest.json', 'utf8'),
  )
  assert.equal(manifest.count, 301)
})
```

- [ ] **Step 2: Run the invariant test and verify the generated artifact is still missing**

Run: `pnpm test:icons`

Expected: the archive/category invariant PASS, then FAIL with `ENOENT` for `manifest.json`.

- [ ] **Step 3: Implement common props and accessible title handling**

```tsx
// src/icons/linear/types.ts
import type { SVGAttributes } from 'react'

export interface LinearStaticIconProps extends SVGAttributes<SVGSVGElement> {
  size?: number | string
  title?: string
}

export type LinearIssueState =
  | 'triage' | 'backlog' | 'todo' | 'started'
  | 'completed' | 'duplicate' | 'canceled'

export interface LinearProgressIconProps extends LinearStaticIconProps {
  progress?: number
}
```

```tsx
// src/icons/linear/iconA11y.ts
import { createElement } from 'react'

export function resolveIconA11y(title?: string) {
  return title
    ? {
        svgProps: { role: 'img' as const, 'aria-label': title },
        titleNode: createElement('title', null, title),
      }
    : {
        svgProps: { 'aria-hidden': true as const, focusable: false as const },
        titleNode: null,
      }
}
```

```tsx
// src/icons/linear/StaticLinearSvg.tsx
import { useId } from 'react'
import { resolveIconA11y } from './iconA11y'
import type { LinearStaticIconProps } from './types'

interface StaticLinearSvgProps extends LinearStaticIconProps {
  body: string
  viewBox: string
}

function escapeSvgText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function rewriteSvgIds(markup: string, prefix: string): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '')
  return markup
    .replace(/\bid="([^"]+)"/g, (_, id) => `id="${safePrefix}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${safePrefix}-${id})`)
    .replace(/\b(href|xlink:href)="#([^"]+)"/g, (_, attribute, id) =>
      `${attribute}="#${safePrefix}-${id}"`,
    )
}

export function StaticLinearSvg({ body, viewBox, size = 16, title, ...props }: StaticLinearSvgProps) {
  const id = useId()
  const a11y = resolveIconA11y(title)
  const titleMarkup = title ? `<title>${escapeSvgText(title)}</title>` : ''
  const innerMarkup = `${titleMarkup}${rewriteSvgIds(body, `linear-icon-${id}`)}`
  return (
    <svg
      {...a11y.svgProps}
      {...props}
      width={size}
      height={size}
      viewBox={viewBox}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      dangerouslySetInnerHTML={{ __html: innerMarkup }}
    />
  )
}
```

The archived SVG strings are trusted local build inputs. Rendering them as inner SVG markup avoids lossy XML-to-JSX rewriting and preserves filters, gradients, masks and uncommon SVG attributes. `rewriteSvgIds` prevents two instances of the same icon from sharing filter or mask IDs.

- [ ] **Step 4: Implement the deterministic generator**

`scripts/linear-icons/generate.mjs` must:

```js
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  assertUnique,
  parseOfficialCategories,
  parseSymbols,
  renderStaticComponent,
  sha256,
  toComponentName,
  toRegistryName,
} from './core.mjs'

const root = path.resolve('assets/linear-icon-system')
const sourceDir = path.join(root, 'raw')
const outputDir = path.resolve('src/icons/linear/static')
const spriteFiles = ['svg-1.svg', 'svg-2.svg', 'svg-3.svg']
const symbols = (await Promise.all(spriteFiles.map(async (file) =>
  parseSymbols(await fs.readFile(path.join(sourceDir, file), 'utf8'), file),
))).flat()
const unique = new Map()
const duplicates = []
for (const symbol of symbols) {
  if (unique.has(symbol.linearName)) duplicates.push(symbol.linearName)
  else unique.set(symbol.linearName, symbol)
}
const categorySource = await fs.readFile(
  path.join(sourceDir, 'modules/EmojiContainer.CeAZEvLX.js'),
  'utf8',
)
const categories = parseOfficialCategories(categorySource)
const officialTechnologyFallbacks = new Set([
  'AiWriting', 'Alarm', 'AlarmDelete', 'Anonymous', 'BarGraph', 'Biscuit',
  'ChatLine', 'Circle', 'Clock', 'Clock--outline', 'EmptyCircle',
  'ExclamationMark', 'Flag', 'GooglePlay', 'LinearAi', 'QuestionMark',
  'Ramp', 'Report', 'Resolved', 'ResolvedChat', 'ScatterPlot', 'SmallLock',
  'SoundMuted', 'Starred', 'Stopwatch',
])
const records = [...unique.values()].map((symbol) => {
  const mappedCategory = categories.get(symbol.linearName)
  const usesOfficialFallback = officialTechnologyFallbacks.has(symbol.linearName)
  const category = mappedCategory ?? (usesOfficialFallback ? 'technology' : undefined)
  if (!category) throw new Error(`Unreviewed category fallback: ${symbol.linearName}`)
  const name = toRegistryName(symbol.linearName)
  const componentName = toComponentName(symbol.linearName)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${symbol.viewBox}">${symbol.body}</svg>\n`
  return {
    ...symbol,
    name,
    componentName,
    category,
    categorySource: mappedCategory ? 'official-map' : 'official-technology-fallback',
    rendering: 'static',
    defaultSize: 16,
    sha256: sha256(svg),
    svg,
  }
})
assertUnique(records, 'name')
assertUnique(records, 'componentName')
if (records.length !== 301) throw new Error(`Expected 301 icons, received ${records.length}`)

await fs.rm(outputDir, { recursive: true, force: true })
await fs.mkdir(outputDir, { recursive: true })
await fs.rm(path.join(root, 'categories'), { recursive: true, force: true })
for (const record of records) {
  await fs.writeFile(path.join(outputDir, `${record.componentName}.tsx`), renderStaticComponent(record), 'utf8')
  const categoryDir = path.join(root, 'categories', record.category)
  await fs.mkdir(categoryDir, { recursive: true })
  await fs.writeFile(path.join(categoryDir, `${record.linearName}.svg`), record.svg, 'utf8')
}
await fs.writeFile(
  path.join(root, 'manifest.json'),
  `${JSON.stringify({ count: records.length, duplicates, icons: records.map(({ body, svg, ...record }) => record) }, null, 2)}\n`,
  'utf8',
)
```

The same file must generate `static/index.ts` exports and `generated.ts` with literal `as const` metadata and component references; sort every output by `name` before writing so repeated runs are byte-identical. The 25-item fallback set is copied from Linear's `getIconCategory(e) { return S[e] ?? TECHNOLOGY }` behavior and is intentionally recorded as `official-technology-fallback`; any future unmapped icon outside that reviewed set fails generation.

- [ ] **Step 5: Add and run generation**

Add to `package.json`:

```json
"icons:generate": "node scripts/linear-icons/generate.mjs"
```

Run: `pnpm icons:generate && pnpm icons:generate && git diff --exit-code -- src/icons/linear assets/linear-icon-system/manifest.json assets/linear-icon-system/categories`

Expected: second generation produces no diff; manifest count is 301.

- [ ] **Step 6: Run type checking and commit**

Run: `pnpm build`

Expected: TypeScript and Vite build PASS.

```powershell
git add package.json scripts/linear-icons src/icons/linear assets/linear-icon-system
git commit -m "feat: generate Linear static icon library"
```

---

### Task 3: Add the typed `LinearIcon` public API

**Files:**
- Create: `src/icons/linear/LinearIcon.tsx`
- Create: `src/icons/linear/index.ts`
- Create: `src/icons/linear/linear-icons.test.tsx`
- Modify: `scripts/run-regression-tests.mjs`

**Interfaces:**
- Consumes: `LinearIconName` and `linearStaticIcons` from `generated.ts`.
- Produces: `LinearIcon(props: LinearIconProps)` and the package-level public exports.

- [ ] **Step 1: Write failing SSR and accessibility tests**

```tsx
// src/icons/linear/linear-icons.test.tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { LinearFaceHeartEyesIcon, LinearIcon, LinearOpenAIIcon } from '@/icons/linear'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testNamedStaticIconPreservesGeometryAndDefaults(): void {
  const html = renderToStaticMarkup(<LinearFaceHeartEyesIcon />)
  assert(html.includes('viewBox="0 0 16 16"'), 'preserves Linear viewBox')
  assert(html.includes('width="16"'), 'defaults to 16px')
  assert(html.includes('aria-hidden="true"'), 'decorative by default')
}

export function testStaticIconIdsAreIsolatedPerInstance(): void {
  const html = renderToStaticMarkup(<><LinearOpenAIIcon /><LinearOpenAIIcon /></>)
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1])
  assert(new Set(ids).size === ids.length, 'each rendered instance owns its SVG definition IDs')
}

export function testLinearIconResolvesTypedRegistryName(): void {
  const html = renderToStaticMarkup(<LinearIcon name="face-heart-eyes" size={24} title="喜欢" />)
  assert(html.includes('width="24"'), 'forwards size')
  assert(html.includes('role="img"'), 'title enables image role')
  assert(html.includes('<title>喜欢</title>'), 'renders accessible title')
}
```

- [ ] **Step 2: Add the test entry and verify failure**

Add `'src/icons/linear/linear-icons.test.tsx'` to `entries` in `scripts/run-regression-tests.mjs`.

Run: `pnpm test`

Expected: FAIL because `LinearIcon.tsx` and the root export do not exist.

- [ ] **Step 3: Implement the typed dispatcher and root exports**

```tsx
// src/icons/linear/LinearIcon.tsx
import { linearStaticIcons, type LinearIconName } from './generated'
import type { LinearStaticIconProps } from './types'

export interface LinearIconProps extends LinearStaticIconProps {
  name: LinearIconName
}

export function LinearIcon({ name, ...props }: LinearIconProps) {
  const Component = linearStaticIcons[name]
  if (!Component) {
    if (import.meta.env.DEV) console.error(`Unknown Linear icon: ${name}`)
    return null
  }
  return <Component {...props} />
}
```

```ts
// src/icons/linear/index.ts
export * from './types'
export * from './generated'
export * from './static'
export * from './LinearIcon'
```

- [ ] **Step 4: Run tests, build and commit**

Run: `pnpm test && pnpm build`

Expected: all regression tests and build PASS.

```powershell
git add src/icons/linear scripts/run-regression-tests.mjs
git commit -m "feat: expose typed Linear icon API"
```

---

### Task 4: Reproduce the parameterized Issue status icon family

**Files:**
- Create: `src/icons/linear/status/LinearIssueStatusIcon.tsx`
- Modify: `src/icons/linear/index.ts`
- Modify: `src/icons/linear/linear-icons.test.tsx`

**Interfaces:**
- Consumes: `LinearIssueState`, `LinearProgressIconProps`, `resolveIconA11y`.
- Produces: `LinearIssueStatusIcon({ state, progress, size, color, title })`.

- [ ] **Step 1: Write failing status geometry tests**

Append to `linear-icons.test.tsx`:

```tsx
import { LinearIssueStatusIcon } from '@/icons/linear'

export function testIssueStatusUsesExactLinearBranches(): void {
  const backlog = renderToStaticMarkup(<LinearIssueStatusIcon state="backlog" />)
  const started = renderToStaticMarkup(<LinearIssueStatusIcon state="started" progress={0.5} />)
  const completed = renderToStaticMarkup(<LinearIssueStatusIcon state="completed" />)
  assert(backlog.includes('13.9408 7.91426'), 'uses original backlog path')
  assert(started.includes('<path'), 'started renders a parameterized sector')
  assert(completed.includes('11.101 5.10104'), 'uses original completed path')
}

export function testIssueProgressClampsInvalidValues(): void {
  const below = renderToStaticMarkup(<LinearIssueStatusIcon state="started" progress={-2} />)
  const nan = renderToStaticMarkup(<LinearIssueStatusIcon state="started" progress={Number.NaN} />)
  assert(below === nan, 'negative and NaN progress both clamp to zero')
}
```

- [ ] **Step 2: Run the focused suite and verify missing export failure**

Run: `pnpm test`

Expected: FAIL because `LinearIssueStatusIcon` is not exported.

- [ ] **Step 3: Implement the exact 14px status branches**

The component must use the archived paths for backlog, completed, duplicate, canceled and triage. Todo and started share this exact sector calculation:

```tsx
function clampProgress(progress: number | undefined): number {
  if (progress === undefined || Number.isNaN(progress)) return 0
  return Math.min(1, Math.max(0, progress))
}

function ProgressSector({ progress, color }: { progress: number; color: string }) {
  const radius = 3.5
  const degrees = 360 * progress
  const shortDegrees = degrees > 180 ? 360 - degrees : degrees
  const radians = shortDegrees * Math.PI / 180
  const chord = Math.sqrt(2 * radius ** 2 - 2 * radius ** 2 * Math.cos(radians))
  const vertical = shortDegrees <= 90
    ? radius * Math.sin(radians)
    : radius * Math.sin((180 - shortDegrees) * Math.PI / 180)
  const horizontal = Math.sqrt(chord ** 2 - vertical ** 2)
  const endX = degrees <= 180 ? radius + vertical : radius - vertical
  const largeArc = degrees <= 180 ? 0 : 1
  return (
    <>
      <rect x="1" y="1" width="12" height="12" rx="6" stroke={color} strokeWidth="1.5" fill="none" />
      <path fill={color} stroke="none" d={`M ${radius},${radius} L${radius},0 A${radius},${radius} 0 ${largeArc},1 ${endX}, ${horizontal} z`} transform={`translate(${radius},${radius})`} />
    </>
  )
}
```

Use `currentColor` when `color` is absent, default `size={14}`, spread caller props on the root SVG, and call `resolveIconA11y(title)`.

- [ ] **Step 4: Export, test and commit**

Run: `pnpm test && pnpm build`

Expected: status tests and build PASS.

```powershell
git add src/icons/linear
git commit -m "feat: add Linear issue status icons"
```

---

### Task 5: Add realtime Project and Cycle progress icons

**Files:**
- Create: `src/icons/linear/status/LinearProjectStatusIcon.tsx`
- Create: `src/icons/linear/status/LinearCycleProgressIcon.tsx`
- Create: `src/icons/linear/status/linearStatusIcons.css`
- Modify: `src/icons/linear/index.ts`
- Modify: `src/icons/linear/linear-icons.test.tsx`

**Interfaces:**
- Produces: `LinearProjectStatusIcon` with `state`, `progress`, `animate`; `LinearCycleProgressIcon` with `progress`, `active`, `planned`, `completed`, `next`.

- [ ] **Step 1: Write failing realtime icon tests**

```tsx
import { LinearCycleProgressIcon, LinearProjectStatusIcon } from '@/icons/linear'

export function testProjectStatusKeepsHexagonMaskAndProgress(): void {
  const html = renderToStaticMarkup(<LinearProjectStatusIcon state="started" progress={0.42} />)
  assert(html.includes('M2.95778 3.02069'), 'keeps original hexagon')
  assert(html.includes('stroke-dasharray="calc(10.5504) 25.12"'), 'uses progress circumference')
  assert(html.includes('<mask'), 'uses the original hole mask')
}

export function testCycleProgressKeepsOriginalTransitionGeometry(): void {
  const html = renderToStaticMarkup(<LinearCycleProgressIcon active progress={0.6} />)
  assert(html.includes('stroke-dasharray'), 'renders circumference')
  assert(html.includes('stroke-linecap="round"'), 'keeps rounded active arc')
}
```

- [ ] **Step 2: Run tests and verify missing components**

Run: `pnpm test`

Expected: FAIL on missing Project and Cycle exports.

- [ ] **Step 3: Implement Project status from the archived source**

Use `viewBox="-1 -1 16 16"`, the archived hexagon path `M2.95778 3.02069...`, circumference `25.12`, and a `useId()`-derived mask ID. Clamp progress, set completed/canceled progress to `1`, and apply `.linear-project-status--transition` only when `animate` is true. The CSS must contain:

```css
.linear-project-status--transition circle,
.linear-project-status--transition path {
  transition: all 240ms;
}
.linear-project-status__completion {
  transform-origin: center;
  animation: linear-project-status-scale 240ms cubic-bezier(.5, 1.4, .4, 1) 60ms both;
}
@keyframes linear-project-status-scale {
  from { transform: scale(.5); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
```

- [ ] **Step 4: Implement Cycle progress from the archived formulas**

Use radius `6.25`, stroke width `1.5`, perimeter `2 * Math.PI * radius`, gap `3`, planned dash length `perimeter / 24`, progress normalization `0.065 + progress * (0.935 + gap / perimeter)`, and original 0.6s transform/stroke-dashoffset transitions. Render next, planned, active and completed branches independently and allow combinations only where the archived behavior supports them.

- [ ] **Step 5: Add reduced-motion CSS, export, test and commit**

```css
@media (prefers-reduced-motion: reduce) {
  .linear-project-status--transition circle,
  .linear-project-status--transition path,
  .linear-project-status__completion,
  .linear-cycle-progress circle {
    animation: none !important;
    transition: none !important;
  }
}
```

Run: `pnpm test && pnpm build`

Expected: realtime icon tests and build PASS.

```powershell
git add src/icons/linear
git commit -m "feat: add Linear realtime status icons"
```

---

### Task 6: Reproduce Grid Loader and Grid Progress animations

**Files:**
- Create: `src/icons/linear/animated/LinearGridLoaderIcon.tsx`
- Create: `src/icons/linear/animated/LinearGridProgressIcon.tsx`
- Create: `src/icons/linear/animated/linearGridIcons.css`
- Modify: `src/icons/linear/index.ts`
- Modify: `src/icons/linear/linear-icons.test.tsx`

**Interfaces:**
- Produces: `LinearGridLoaderIcon({ variant, interval, dimColor, initialFrame })` and `LinearGridProgressIcon({ progress })`.

- [ ] **Step 1: Write failing variant and progress tests**

```tsx
import { LinearGridLoaderIcon, LinearGridProgressIcon } from '@/icons/linear'

export function testGridLoaderExposesEveryVerifiedVariant(): void {
  const variants = ['scope','upDown','pong','blowOut','ufo','down','zap','hourglass','stats','cat','agent','read','unread','outlines'] as const
  for (const variant of variants) {
    const html = renderToStaticMarkup(<LinearGridLoaderIcon variant={variant} />)
    assert(html.includes(`data-variant="${variant}"`), `renders ${variant}`)
  }
}

export function testGridProgressRendersTwentyFiveDots(): void {
  const html = renderToStaticMarkup(<LinearGridProgressIcon progress={0.52} />)
  assert((html.match(/<circle/g) ?? []).length === 25, 'renders a 5x5 grid')
  assert(html.includes('600ms linear infinite'), 'pulses the frontier dot')
}
```

- [ ] **Step 2: Run tests and verify missing component failures**

Run: `pnpm test`

Expected: FAIL because Grid components are not exported.

- [ ] **Step 3: Implement Grid Loader with the archived frame data**

Copy the exact `scope: 12` through `outlines: 8` frame counts and all archived integer bitmask arrays from `raw/modules/GridLoaderIcon.Co0y5dEn.js` into a typed constant. Generate the 5×5 sprite with a canvas at device-independent scale, cache data URLs by `variant + color + dimColor + scale`, and animate the `<image>` using the archived `steps(frameCount, end)` timing. Use an `IntersectionObserver` to toggle `.linear-grid-loader--paused`.

The stylesheet must retain the archived repeated `translate(0)` / `translate(-100%)` keyframe structure and set duration to `frameCount * 20 * interval` milliseconds. Under reduced motion, disable animation and display the first meaningful frame.

- [ ] **Step 4: Implement Grid Progress with exact pulse behavior**

Render 25 circles at `cx=1 + column * 3.5`, `cy=1 + row * 3.5`, `r=1`. Clamp progress, calculate `filledCount = floor(progress * 25)`, set filled opacity to `1`, empty opacity to `0.3`, and apply a per-instance `useId()` keyframe name only to `filledCount - 1` when `0 < filledCount < 25`.

- [ ] **Step 5: Export, test and commit**

Run: `pnpm test && pnpm build`

Expected: all 14 Grid Loader variants, 25-dot progress and build PASS.

```powershell
git add src/icons/linear
git commit -m "feat: add Linear grid icon animations"
```

---

### Task 7: Generate the offline searchable icon gallery

**Files:**
- Create: `assets/linear-icon-system/gallery.html`
- Create: `assets/linear-icon-system/gallery.css`
- Create: `assets/linear-icon-system/gallery.js`
- Generate: `assets/linear-icon-system/gallery-data.js`
- Modify: `scripts/linear-icons/generate.mjs`

**Interfaces:**
- Consumes: `manifest.json`, categorized SVG files and the verified dynamic formulas.
- Produces: an offline gallery with category counts, search, theme, size and progress controls.

- [ ] **Step 1: Add a failing gallery artifact assertion**

Append to `core.test.mjs`:

```js
test('gallery shell exposes required controls', async () => {
  const html = await fs.readFile('assets/linear-icon-system/gallery.html', 'utf8')
  for (const id of ['icon-search', 'theme-toggle', 'icon-size', 'progress-control', 'static-grid', 'motion-grid']) {
    assert.match(html, new RegExp(`id="${id}"`))
  }
})
```

- [ ] **Step 2: Run the test and verify missing gallery failure**

Run: `pnpm test:icons`

Expected: FAIL with `ENOENT gallery.html`.

- [ ] **Step 3: Implement the gallery shell and rendering**

`gallery.html` must use semantic controls with the exact IDs in Step 1, link local `gallery.css`, then load `gallery-data.js` and `gallery.js` as ordinary deferred scripts so the page also works when opened directly through `file://`. The generator writes `gallery-data.js` as `window.LINEAR_ICON_MANIFEST = <serialized manifest>;`. `gallery.js` must:

```js
const manifest = window.LINEAR_ICON_MANIFEST
if (!manifest || manifest.count !== 301) {
  throw new Error('Linear icon gallery data is missing or incomplete')
}
const state = { query: '', size: 16, theme: 'dark', progress: 0.5 }

function matches(icon) {
  const query = state.query.trim().toLowerCase()
  return !query || [icon.name, icon.linearName, icon.componentName]
    .some((value) => value.toLowerCase().includes(query))
}

function renderStaticIcons() {
  const visible = manifest.icons.filter(matches)
  document.querySelector('#static-grid').innerHTML = visible.map((icon) => `
    <article class="icon-card" data-category="${icon.category}">
      <img width="${state.size}" height="${state.size}" src="./categories/${icon.category}/${icon.linearName}.svg" alt="" />
      <strong>${icon.name}</strong>
      <span>${icon.linearName}</span>
      <code>${icon.componentName}</code>
    </article>
  `).join('')
  document.querySelector('#visible-count').textContent = String(visible.length)
}
```

Wire controls with `input`/`change` events, show all nine official categories and counts, and implement the dynamic examples locally without external requests.

- [ ] **Step 4: Regenerate, inspect and commit**

Run: `pnpm icons:generate && pnpm test:icons`

Expected: gallery artifact test PASS and `visible-count` starts at 301.

```powershell
git add assets/linear-icon-system scripts/linear-icons
git commit -m "docs: add Linear icon gallery"
```

---

### Task 8: Add browser QA, maintenance documentation and final verification

**Files:**
- Create: `scripts/qa-linear-icons.mjs`
- Create: `src/icons/linear/README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: completed component library and gallery.
- Produces: `pnpm qa:icons`, maintenance guidance and final evidence.

- [ ] **Step 1: Write the Playwright gallery QA script**

```js
// scripts/qa-linear-icons.mjs
import { chromium } from 'playwright'
import { createServer } from 'vite'

const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } })
let browser
try {
  await server.listen()
  const baseUrl = server.resolvedUrls?.local[0]
  if (!baseUrl) throw new Error('Vite did not expose a local URL')
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  await page.goto(new URL('/assets/linear-icon-system/gallery.html', baseUrl).href)
  await page.waitForSelector('.icon-card')
  const count = await page.locator('.icon-card').count()
  if (count !== 301) throw new Error(`Expected 301 icon cards, received ${count}`)
  await page.locator('#icon-search').fill('face-heart-eyes')
  if (await page.locator('.icon-card').count() !== 1) throw new Error('Search did not narrow to one icon')
  await page.locator('#progress-control').fill('0.75')
  const runningAnimations = await page.evaluate(() =>
    document.getAnimations().filter((animation) => animation.playState === 'running').length,
  )
  if (runningAnimations !== 0) throw new Error('Reduced motion still has running animations')
  console.log('PASS Linear icon gallery: 301 icons, search, progress, reduced motion')
} finally {
  await browser?.close()
  await server.close()
}
```

- [ ] **Step 2: Add scripts and make icon tests part of the default test command**

Update `package.json`:

```json
"test": "pnpm test:icons && node scripts/run-regression-tests.mjs",
"qa:icons": "node scripts/qa-linear-icons.mjs"
```

- [ ] **Step 3: Document usage and maintenance**

`src/icons/linear/README.md` must contain these verified examples and rules:

```tsx
import {
  LinearFaceIcon,
  LinearGridLoaderIcon,
  LinearIcon,
  LinearIssueStatusIcon,
} from '@/icons/linear'

<LinearFaceIcon size={20} title="团队表情" />
<LinearIcon name="face-heart-eyes" />
<LinearIssueStatusIcon state="started" progress={0.5} color="#f2c94c" />
<LinearGridLoaderIcon variant="scope" />
```

Document `linearName` / kebab-case / component name mapping, official nine categories, `pnpm icons:generate`, generated-file prohibition, `currentColor`, default sizes, accessibility title behavior and reduced-motion behavior.

- [ ] **Step 4: Run the full verification suite**

Run:

```powershell
pnpm icons:generate
pnpm test
pnpm build
pnpm qa:icons
git diff --check
```

Expected:

- generator is deterministic;
- Node generator tests PASS;
- regression and component tests PASS;
- TypeScript/Vite build PASS;
- gallery reports 301 icons and zero running animations under reduced motion;
- `git diff --check` emits no errors.

- [ ] **Step 5: Verify UTF-8 without BOM and commit**

Run:

```powershell
$files = git diff --name-only --diff-filter=ACM HEAD
foreach ($file in $files) {
  $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $file))
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    throw "UTF-8 BOM detected: $file"
  }
}
git add package.json scripts/qa-linear-icons.mjs src/icons/linear/README.md
git commit -m "test: verify Linear icon component library"
```

Expected: no BOM detected; final verification commit succeeds.

---

## Final Review Checklist

- [ ] `assets/linear-icon-system/manifest.json` reports exactly 301 icons.
- [ ] Every manifest record has one of the nine official categories.
- [ ] All generated names, component names and file names are unique.
- [ ] Every static icon is reachable by a named export and `LinearIconName`.
- [ ] Issue, Project, Cycle, Grid Loader and Grid Progress are live implementations rather than screenshots.
- [ ] `prefers-reduced-motion` disables continuous animation.
- [ ] Gallery search, category count, theme, size and progress controls work offline.
- [ ] No unrelated workspace files are staged or committed.
- [ ] All new text files are UTF-8 without BOM.
- [ ] `pnpm test`, `pnpm build` and `pnpm qa:icons` pass.
