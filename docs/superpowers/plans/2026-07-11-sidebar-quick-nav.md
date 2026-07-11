# Sidebar Quick Nav (方案 A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在侧栏「工作台」与底部工具之间恢复「快捷」区，按 `sidebarPins` 展示进行中 / 星标交易 / 错过的机会 / 模拟回测。

**Architecture:** 纯函数从 `SECONDARY_NAV` + `sidebarPins` 解析出有序导航项；`Sidebar.tsx` 渲染第二节并复用 `filterTrades` 计算角标。不改路由表、不新增动作芯片、不引入「我的视图」。

**Tech Stack:** React 18、TypeScript、React Router `NavLink`、Zustand `useStore`、现有 `filterTrades` / `sidebarNav`、Vite regression runner（`pnpm test`）。

**Spec:** `docs/superpowers/specs/2026-07-11-sidebar-quick-nav-design.md`

## Global Constraints

- Always read and write files as UTF-8 without BOM; preserve Chinese characters.
- Do not add 导入 / 命令面板 action chips.
- Do not add 「我的视图」 or nested expand under 交易日志 / 案例记录.
- Do not put period/strategy routes into the sidebar.
- Do not change App routes for `/active` `/favorites` `/missed` `/sim`.
- Prefer minimal CSS changes; reuse `.sb-section` / `.sb-item` / `.sb-section-label`.

## File Map

- `src/lib/sidebarNav.ts` — `SECONDARY_NAV` labels; `resolvePinnedSecondaryNav(pins)`.
- `src/regression.test.ts` — architecture + pin resolution + label assertions.
- `src/components/Sidebar.tsx` — render 「快捷」 section with counts and active states.
- `src/components/Sidebar.css` — only if spacing between primary/quick needs a tweak (prefer no change).

---

### Task 1: Rename 模拟 → 模拟回测 and pin resolver (TDD)

**Files:**
- Modify: `src/lib/sidebarNav.ts`
- Modify: `src/regression.test.ts`

- [x] **Step 1: Write failing regression tests**

Update the import in `src/regression.test.ts` from:

```ts
import { PRIMARY_NAV } from '@/lib/sidebarNav'
```

to:

```ts
import {
  PRIMARY_NAV,
  SECONDARY_NAV,
  DEFAULT_SIDEBAR_PINS,
  resolvePinnedSecondaryNav,
} from '@/lib/sidebarNav'
```

Add after `testPrimarySidebarNavigationMatchesApprovedArchitecture`:

```ts
export function testSecondarySidebarQuickNavMatchesApprovedArchitecture(): void {
  const routes = SECONDARY_NAV.map((item) => item.to)
  const expected = ['/active', '/favorites', '/missed', '/sim']
  assert(
    JSON.stringify(routes) === JSON.stringify(expected),
    `快捷导航路由应为 ${expected.join(', ')}，实际为 ${routes.join(', ')}`,
  )
  assert(
    routes.every((route) => !route.startsWith('/period/') && !route.startsWith('/strategy/')),
    '时间和策略路由不得出现在快捷侧栏导航',
  )
  const paper = SECONDARY_NAV.find((item) => item.id === 'paper')
  assert(paper?.label === '模拟回测', 'paper 项侧栏文案应为「模拟回测」')
  assert(
    JSON.stringify(DEFAULT_SIDEBAR_PINS) === JSON.stringify(['active', 'favorites', 'missed', 'paper']),
    '默认 sidebarPins 应包含四项快捷入口',
  )
}

export function testResolvePinnedSecondaryNavOrdersAndHidesEmpty(): void {
  const defaultItems = resolvePinnedSecondaryNav(DEFAULT_SIDEBAR_PINS)
  assert(
    defaultItems.map((item) => item.id).join(',') === 'active,favorites,missed,paper',
    '默认 pins 应按 SECONDARY_NAV 四项顺序解析',
  )
  assert(
    defaultItems.map((item) => item.to).join(',') === '/active,/favorites,/missed,/sim',
    '默认 pins 路由顺序错误',
  )

  const reordered = resolvePinnedSecondaryNav(['paper', 'active'])
  assert(
    reordered.map((item) => item.id).join(',') === 'paper,active',
    '应严格按 sidebarPins 顺序渲染',
  )

  assert(resolvePinnedSecondaryNav([]).length === 0, '空 pins 应得到空列表（侧栏隐藏整区）')
  assert(
    resolvePinnedSecondaryNav(['active', 'unknown' as never, 'missed']).map((item) => item.id).join(',') ===
      'active,missed',
    '未知 id 应被跳过',
  )
}
```

- [x] **Step 2: Run tests and verify red**

Run:

```powershell
pnpm test
```

Expected: FAIL because `resolvePinnedSecondaryNav` is not exported and/or `paper.label` is still `模拟`.

- [x] **Step 3: Implement label + resolver**

In `src/lib/sidebarNav.ts`, change the paper item label:

```ts
{ id: 'paper', to: '/sim', label: '模拟回测', icon: FlaskConical },
```

Add after `DEFAULT_SIDEBAR_PINS`:

```ts
/** 按 sidebarPins 顺序解析快捷导航；空数组 → 空列表（侧栏不渲染「快捷」区） */
export function resolvePinnedSecondaryNav(
  pins: readonly SidebarNavId[],
): SidebarNavItem[] {
  const byId = new Map(SECONDARY_NAV.map((item) => [item.id, item]))
  const out: SidebarNavItem[] = []
  for (const id of pins) {
    const item = byId.get(id)
    if (item) out.push(item)
  }
  return out
}
```

- [x] **Step 4: Run tests and verify green**

Run:

```powershell
pnpm test
```

Expected: `testSecondarySidebarQuickNavMatchesApprovedArchitecture` and `testResolvePinnedSecondaryNavOrdersAndHidesEmpty` PASS; existing `testPrimarySidebarNavigationMatchesApprovedArchitecture` still PASS.

- [x] **Step 5: Commit** (skipped — user did not ask to commit)

```bash
git add src/lib/sidebarNav.ts src/regression.test.ts
git commit -m "$(cat <<'EOF'
test: lock sidebar quick-nav IA and pin resolver

EOF
)"
```

---

### Task 2: Render 「快捷」 in Sidebar

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/Sidebar.css` (only if needed)

- [x] **Step 1: Extend imports and store selectors**

At top of `Sidebar.tsx`, change sidebarNav import to:

```ts
import {
  PRIMARY_NAV,
  isSidebarNavActive,
  resolvePinnedSecondaryNav,
  type PrimarySidebarNavId,
  type SidebarNavId,
} from '@/lib/sidebarNav'
import { filterTrades } from '@/lib/tradeFilters'
```

Inside `Sidebar`, after existing store selectors, add:

```ts
  const starredIds = useStore((state) => state.starredIds)
  const sidebarPins = useStore((state) => state.display.sidebarPins)
  const quickNav = resolvePinnedSecondaryNav(sidebarPins)
```

Keep using `activeTrades` (already `!deletedAt`) as the input set for counts.

- [x] **Step 2: Add secondary count helper**

After `primaryCount`, add:

```ts
  const secondaryCount = (id: SidebarNavId): number | undefined => {
    if (id === 'active') {
      return filterTrades(activeTrades, { type: 'active', tradeKind: 'live' }, starredIds).length
    }
    if (id === 'favorites') {
      return filterTrades(activeTrades, { type: 'starred' }, starredIds).length
    }
    if (id === 'missed') {
      return filterTrades(activeTrades, { type: 'missed' }, starredIds).length
    }
    if (id === 'paper') {
      return filterTrades(activeTrades, { type: 'all', tradeKind: 'paper' }, starredIds).length
    }
    return undefined
  }
```

- [x] **Step 3: Insert quick nav section in JSX**

Immediately after the closing `</nav>` of `sb-primary` and **before** `<div className="sb-spacer" />`, insert:

```tsx
      {quickNav.length > 0 ? (
        <nav className="sb-section sb-quick" aria-label="快捷导航">
          <div className="sb-section-label">快捷</div>
          {quickNav.map(({ id, to, label, icon: Icon }) => (
            <NavLink
              key={id}
              to={to}
              className={() =>
                'sb-item' + (isSidebarNavActive(path, to) ? ' is-active' : '')
              }
            >
              <Icon size={16} />
              <span>{label}</span>
              <Count value={secondaryCount(id)} />
            </NavLink>
          ))}
        </nav>
      ) : null}
```

Do **not** add action chips above 回收站.

- [x] **Step 4: CSS check**

Open `src/components/Sidebar.css`. If `.sb-section` already spaces labels/items correctly, make **no** CSS change. Only add a rule if visual gap between 工作台 and 快捷 is broken, for example:

```css
.sb-quick {
  margin-top: 6px;
}
```

- [x] **Step 5: Typecheck / regression**

Run:

```powershell
pnpm test
```

Expected: all previous PASS.

Optional tighter check:

```powershell
pnpm exec tsc -b --pretty false
```

Expected: no new errors in `Sidebar.tsx` / `sidebarNav.ts`.

- [x] **Step 6: Commit** (skipped — user did not ask to commit)

```bash
git add src/components/Sidebar.tsx src/components/Sidebar.css src/lib/sidebarNav.ts src/regression.test.ts
git commit -m "$(cat <<'EOF'
feat: restore sidebar quick nav with sim entry

EOF
)"
```

---

### Task 3: Manual acceptance against spec §7

**Files:** none (verification only)

- [x] **Step 1: Start app**

```powershell
pnpm dev
```

- [x] **Step 2: Checklist**

1. 侧栏工作台下出现「快捷」：进行中、星标交易、错过的机会、模拟回测。
2. 点击「模拟回测」→ URL `/sim`，该项 `is-active`。
3. 点击进行中 / 星标 / 错过 → 对应列表与筛选正确。
4. 顶栏搜索、新建；底栏回收站、设置行为不变。
5. 无导入/命令面板芯片；无 `/period/`、`/strategy/` 侧栏项。
6. （可选）在 DevTools / 临时改 store 将 `display.sidebarPins` 设为 `[]`，快捷整区消失；恢复默认四项后重现。

Verified 2026-07-11 on http://localhost:5181：快捷四项可见；点击「模拟回测」→ `/sim`（current）；点击「进行中」→ `/active`（current）；无动作芯片。

- [x] **Step 3: Mark plan checkboxes done** in this file as tasks complete.

---

## Spec coverage self-review

| Spec requirement | Task |
|---|---|
| 快捷区分区 + 四项默认 | Task 1 resolver + Task 2 render |
| 文案「模拟回测」 | Task 1 label change |
| `sidebarPins` 顺序 / 空则隐藏 | Task 1 tests + Task 2 `quickNav.length` |
| `isSidebarNavActive` | Task 2 NavLink className |
| `filterTrades` counts | Task 2 `secondaryCount` |
| 无动作芯片 / 无我的视图 | Global constraints + Task 2 omission |
| Regression：快捷路由 + 禁 period/strategy | Task 1 tests |
| PRIMARY_NAV 不变 | Existing test untouched |

## Placeholder / consistency check

- Resolver name: `resolvePinnedSecondaryNav` everywhere.
- Paper id remains `paper`; route remains `/sim`.
- Count filters match App route filters for active / starred / missed / paper.
