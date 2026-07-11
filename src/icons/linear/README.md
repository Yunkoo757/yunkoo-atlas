# Linear Icon Component Library

从归档的 Linear SVG / 状态 / 动效源构建的类型安全图标组件库。

## 用法

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

## 命名

| 字段 | 规则 | 示例 |
|------|------|------|
| `linearName` | Linear 原始 PascalCase | `FaceHeartEyes` |
| 注册键 `name` | kebab-case | `face-heart-eyes` |
| 组件名 | `Linear` + PascalCase + `Icon` | `LinearFaceHeartEyesIcon` |

特例：`Clock--outline` → `clock-legacy-outline` / `LinearClockLegacyOutlineIcon`。

## 分类

官方九类：`faces-people-health`、`organic`、`sport-activities-objects`、`travel-places`、`technology`、`interface`、`companies`、`money-currencies`、`system`。

未出现在官方映射中的 25 个符号按 Linear 源码回退到 `technology`，并记录为 `official-technology-fallback`。

## 默认行为

- 静态图标默认 `16px`；Issue 状态默认 `14px`
- 颜色默认继承 `currentColor`
- 无 `title` 时 `aria-hidden`；有 `title` 时 `role="img"` + `<title>`
- 动画响应 `prefers-reduced-motion: reduce`；Grid Loader 离开视口可暂停

## 生成与维护

```powershell
pnpm icons:generate
pnpm test:icons
pnpm qa:icons
```

- 源：`assets/linear-icon-system/raw/`（不可变）
- 生成物：`src/icons/linear/static/*`、`generated.ts`、`manifest.json`、`categories/**`、`gallery-data.js`
- **不要手改生成文件**；改归档或生成器后重新 `pnpm icons:generate`

离线图鉴：打开 `assets/linear-icon-system/gallery.html`（支持 `file://`）。
