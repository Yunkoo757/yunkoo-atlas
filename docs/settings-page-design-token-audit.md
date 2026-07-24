# 设置页 · 设计 Token 审计与真实性复核

> 日期：2026-07-24  
> 范围：`src/views/settings/**` + `DataIOContent.css` / `ShortcutsView.css` / `StrategiesView.css`  
> 对照：`src/styles/tokens.css`、`scripts/qa-design-contract.mjs`  
> 状态：只读评估；经两轮独立源码复核校准

---

## 1. 总判（评估用）

| 维度 | 结论 |
|------|------|
| 事实可信度 | **约 85–90%**（两轮均未发现明确 FALSE 事实主张） |
| 原优先级表 | **需改一刀**：唯一 P0（Data inline）应降为 P1/P2 |
| 颜色 / 页面标题 | 大体合规 |
| 主要拖累 | 分区标题多套配方、扁平/卡片混用、间距不走 `--sp-*`、Data 页 inline + dio 双轨 |

**一句话：** 问题地图可采信；严重度标签里「P0」夸张，其余主结论站得住。

---

## 2. 双轮真实性复核摘要

| 轮次 | 方法 | 结果 |
|------|------|------|
| Round 1 | 24 条 claim 逐条核验 | 22 TRUE / 2 PARTIAL / **0 FALSE**（~92%） |
| Round 2 | A–I 轴核验 + 主动证伪 | 事实高可信；P0 /「三套」PARTIAL（综合 ~78–82%） |

### 2.1 共识表

| 主张 | R1 | R2 | 共识 |
|------|----|----|------|
| Data 页多处 inline spacing | TRUE | PARTIAL | 事实成立（8 处）；**P0→P1/P2** |
| 分区标题多套配方 | TRUE | PARTIAL | 多套并存；「恰好三套」简化，实为 **3–4 套** |
| 扁平 vs 卡片分裂 | TRUE | TRUE | Symbols / Strategies / Review 卡片；Display 等扁平 |
| 间距离 `--sp-*` | TRUE | TRUE | settings+dio **零** `var(--sp-*)`；裸 28/14/18/40/56 约 **23 处** |
| 控件高度 26/28/30/32 | TRUE | TRUE | 成立；nav 32 = `--field-height-md`（非乱写） |
| 输入字号分裂 | PARTIAL | TRUE | 成立；Tag 含 mini + sm 两档 |
| Symbols 10px / Tag 50% / Shortcuts 死 CSS | TRUE | TRUE | 成立；50% **仅**删除钮 |
| qa-contract 几乎不覆盖 settings | TRUE | TRUE | 仅 1 条 Tag 空态色断言 |
| Display 优于 Data（方向） | TRUE | TRUE | 方向合理；字母分非精确度量 |

### 2.2 需下调 / 纠偏

1. Data inline：**8 处**属实，不宜标 P0（值对齐 sp 阶梯，非阻断）。
2. 「三套配方」→ **3–4 套**（canonical / dio semibold / medium / Shortcuts mini-label）。
3. Tag「50%」仅 `.settings-tag-chip-remove`，chip 本体为 `--radius-6`。
4. Nav `32px` = `--field-height-md`，与 `--control-height: 28` 是设计分歧。
5. Profile / Tag / Display 的 section 标题**本身合规**（用了 `--type-section-title-*`）。

### 2.3 Round 1 遗漏补强（双方提及）

- Data 路由内 `settings-section-title` 与 `dio-section-title` **双轨**。
- `DataIOContent.css` 裸 `font-weight: 500`。
- ShortcutsView.css 除 `.shortcuts-inner` 外还有整块遗留选择器。

---

## 3. 审计基准

| 维度 | Token / 契约 |
|------|----------------|
| 间距 | `--sp-1…8` = 4 / 8 / 12 / 16 / 20 / 24 / 32（**无 28 / 14 / 18 / 40 / 56**） |
| 字号角色 | `--type-page-title-*`、`--type-section-title-*`（sm + **semibold**）、`--type-body-*`、`--type-metadata-*` |
| 控件高 | `--control-height: 28`、`--field-height-md: 32`、`--modal-cta-height: 36` |
| 圆角 | `--radius-4/6/8/10` 及别名；应用 `--radius-full` 而非裸 `50%` |
| 按钮 | `Button.css`：`.ui-btn` / `.dio-btn` 高 28、字 `--fs-mini` + medium |
| QA | `qa-design-contract.mjs` 对 settings **几乎不覆盖** |

**共享样式位置**

- 布局：`src/views/settings/SettingsLayout.css`
- 数据 IO：`src/components/DataIOContent.css`
- 策略列表：`src/views/StrategiesView.css`
- 快捷键：`src/views/ShortcutsView.css`
- 开关：`src/components/DisplayMenu.css`
- 按钮：`src/components/ui/Button.css`

---

## 4. 模块评分（方向性，非精确度量）

| 评分 | 模块 | 要点 |
|------|------|------|
| A- | 显示 Display | 标杆：扁平 + type-section；几乎无 inline |
| B | 布局壳 / 标签 Tags | 标题 API 合规；间距 28 / 细节债 |
| B- | 资料 / 更新 / 快捷键 | 部分合规；字号或标题 weight 偏离 |
| C+ | 品种 / 策略 / 复盘起稿 | 卡片化 + 魔法间距 / 控件高 |
| C | 数据 Data | dio 双轨 + inline + 离 scale gap（最弱） |

---

## 5. 修正后问题清单

### P1（应修）

| 类别 | 模块 | 问题 | 证据要点 | 期望 |
|------|------|------|----------|------|
| 排版 | 跨模块 | 分区标题 3–4 套配方 | Layout/Profile/Tag/Display = type-section；Updates/Review = sm+medium；dio = sm+semibold；Shortcuts = mini+tertiary | 统一 `.settings-section-title`；分组标签另名 |
| 排版 | 数据 | 同页 `settings-section-title` + `dio-section-title` 双轨 | `DataSettingsPanel` + `DataIOContent.css` | 统一走 type-section |
| 布局 | 跨模块 | 扁平 vs 描边卡片 | Symbols / Strategies / Review 卡片；Display 等扁平 | 拍板一种语言并文档化 |
| 间距 | 跨模块 | 几乎不用 `--sp-*` | ~23 处裸 28/14/18/40/56；page padding `32 40 56` | 消费 `--sp-*` 或新增正式阶 |
| 排版 | 跨模块 | 输入字号 12/13/15 | Profile `--fs-base`；Tag/Updates mini；Symbols/Tag-batch sm | 统一 `--fs-sm` 或 `--fs-mini` |

### P2（债项）

| 类别 | 模块 | 问题 | 期望 |
|------|------|------|------|
| 布局 | 数据 | 8 处 inline spacing（原 P0 下调） | 抽 CSS + `--sp-*` |
| 控件 | 跨模块 | 高度 26 / 28 / 30 / 32 | 图标钮 28；字段 32；nav 文档化为 field-md |
| 排版 | 品种 | `font-size: 10px` | `--fs-micro` |
| 颜色 | 标签 | 删除钮 `border-radius: 50%` | `--radius-full` |
| 逻辑 | 跨模块 | 保存模式 / 空态 / `dio-btn` vs `ui-btn` | 统一说明与命名 |

### P3

| 问题 | 说明 |
|------|------|
| ShortcutsView.css 死代码 | `.shortcuts-inner` 等零引用 |
| qa-design-contract | 扩展覆盖 settings 标题 / 禁 inline margin / nav 高度 |

### 已相对合规（不必先动）

- 多数 `.settings-page-title` → `--type-page-title-*`
- 设置 CSS 几乎无硬编码 hex
- Field 焦点套件（Profile / Tag / Symbols / Review / Updates）
- 主按钮经 `Button.css` 对齐 `--control-height`
- Tag 空态色满足现有 qa 契约

---

## 6. 建议修复顺序

1. **统一 section 标题 API**（含 Updates / Review / dio）；Shortcuts 分组保留 mini 但改类名。  
2. **拍板扁平 vs 卡片**；收敛 Symbols / Strategies / Review。  
3. **间距扫尾**：28→`--sp-6` 或新增 `--sp-7: 28`；page padding 改 sp 组合。  
4. **控件高度 + 输入字号**收敛。  
5. **Data 8 处 inline → CSS**；Symbols 10px；Tag `radius-full`。  
6. **扩展 `qa-design-contract.mjs`**；清理 Shortcuts 死 CSS。

---

## 7. 附录：关键 token 摘录

```text
--sp-1…8: 4 / 8 / 12 / 16 / 20 / 24 / 32
--control-height: 28px
--field-height-md: 32px
--modal-cta-height: 36px
--type-section-title-size: var(--font-size-small)   /* 13px */
--type-section-title-weight: var(--font-weight-semibold)  /* 600 */
--fs-micro: 11px   /* 无 10px 阶 */
```

---

## 8. 相关画布（可选）

- 原问题地图：`canvases/settings-page-design-token-audit.canvas.tsx`
- 真实性复核：`canvases/settings-audit-authenticity.canvas.tsx`
