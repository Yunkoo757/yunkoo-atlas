# 前端风格一致性审查报告

**审查日期**: 2026-06-27  
**项目**: Yunkoo Atlas (Yunkoo Atlas — trading journal with IndexedDB and Electron desktop support)  
**技术栈**: React + Vite + TypeScript + CSS Modules (纯 CSS)

---

## 执行摘要

本项目采用基于 CSS 变量的设计令牌系统（tokens.css），整体风格较为统一。然而，在深入审查后发现了 **15+ 处** 明显的风格不一致问题，主要集中在：

1. **硬编码颜色值**（违反设计令牌原则）
2. **缺失的 CSS 变量定义**
3. **间距系统不统一**
4. **字体大小和行高的不一致**
5. **过渡时间的混乱**

---

## 一、严重问题（需立即修复）

### 1.1 硬编码颜色值

以下位置直接使用了硬编码的颜色值，而非使用 tokens.css 中定义的 CSS 变量：

| 文件 | 行号 | 代码 | 应改为 |
|------|------|------|--------|
| `src/data/case.ts` | 480 | `background: rgba(0,0,0,0.6); color: #fff;` | 使用语义化变量 |
| `src/components/Sidebar.css` | 46 | `color: #1a1205;` | `var(--text-quaternary)` |
| `src/views/BoardView.css` | 92 | `box-shadow: 0 8px 24px rgba(0,0,0,0.3);` | 使用 `var(--shadow-med)` |
| `src/components/CaseCompare.css` | 53 | `border-bottom: 1px solid rgba(255,255,255,0.03);` | 自定义 token 或保留 |
| `src/components/HoverPreview.css` | 19-20 | `rgba(0,0,0,0.34)` 和 `rgba(255,255,255,0.02)` | 使用 token 或内联 |
| `src/components/DataIOContent.css` | 177-178 | `rgba(255,180,0,0.06)` 和 `rgba(255,180,0,0.25)` | 业务语义色 |
| `src/components/CsvImportModal.css` | 205, 244 | `rgba(255,80,80,0.06)` 等 | 错误状态色 |
| `src/components/CommandPalette.css` | 105-106 | `rgba(0,0,0,0.25)` | 渐变辅助色 |

**建议**: 对于业务相关的特殊颜色（如错误红、警告黄），应在 tokens.css 中添加对应的 CSS 变量，避免硬编码。

---

### 1.2 缺失的 CSS 变量定义

以下变量在使用前未在 tokens.css 中定义：

| 变量名 | 使用位置 | 建议定义 |
|--------|----------|----------|
| `--shadow-md` | `TagEditor.css:168` | 补充定义为中等阴影层级 |
| `--popover-shadow-deep` | `ListView.css:382` | 补充定义为深层弹出框阴影 |

**影响**: 如果这些变量不存在，浏览器会忽略该值，导致样式回退到默认行为。

---

## 二、中等问题（建议修复）

### 2.1 间距系统不统一

项目中大量使用硬编码的 `padding: Xpx Ypx Zpx Wpx` 格式，而非使用 tokens.css 中定义的间距阶梯：

```css
/* 当前写法（不一致） */
padding: 10px 12px 18px;
padding: 8px 10px;
padding: 3px 10px;

/* 应改为 */
padding: var(--sp-3) var(--sp-2) var(--sp-4);
padding: var(--sp-2) var(--sp-2);
padding: var(--sp-1) var(--sp-2);
```

**统计**: 在 `CaseList.css`、`DetailView.css`、`Dashboard.css` 等文件中，约有 **50+ 处** 硬编码间距值。

**建议**: 建立间距使用规范文档，并在 CI 中添加检查规则。

---

### 2.2 字体大小不一致

多处使用硬编码像素值，而非使用字号别名：

| 文件 | 行号 | 当前代码 | 应改为 |
|------|------|----------|--------|
| `src/views/DetailView.css` | 77 | `font-size: 24px;` | `var(--fs-lg)` |
| `src/views/settings/ProfileSettingsPanel.css` | 21, 88 | `font-size: 24px; font-size: 28px;` | `var(--fs-lg)` / `calc(var(--fs-lg) + 1rem)` |
| `src/components/DataIOContent.css` | 30 | `font-size: 11px;` | `var(--fs-micro)` |
| `src/components/IconButton.css` | 11 | `font-size: 12px;` | `var(--fs-mini)` |
| `src/components/RowPreviews.css` | 12 | `font-size: 10px;` | `var(--fs-micro)` |
| `src/components/Sidebar.css` | 49 | `font-size: 14px;` | `var(--fs-base)` |

---

### 2.3 行高不一致

不同组件使用了不同的 `line-height` 值：

| 范围 | 组件类型 | 典型值 | 建议 |
|------|----------|--------|------|
| 正文 | 大多数区域 | 1.5 | ✅ 符合 tokens.css |
| 紧凑布局 | CaseList, BoardView | 1.4-1.5 | ⚠️ 可接受 |
| 标题 | DetailView title | 1.33 | ⚠️ 略低 |
| 代码块 | Editor | 1.3, 1.6 | ✅ 根据用途区分 |
| 按钮组 | CommandPalette | 28px | ⚠️ 异常值 |

**注意**: `CommandPalette.css:65` 使用了 `line-height: 28px`，这是一个绝对值，与其他相对值混用，可能导致显示不一致。

---

### 2.4 过渡时间混乱

项目中存在两种不同的快速过渡时间：

```css
/* 当前写法 */
transition: opacity 80ms var(--ease-out);  /* CaseList.css 多处 */
transition: background var(--dur-fast) var(--ease-out);  /* dur-fast = 0.1s */
```

**问题**: `80ms` vs `100ms` 的差异在动画中可能被感知到。

**建议**: 统一使用 `var(--dur-fast)` (0.1s)，或在 tokens.css 中增加 `--dur-quick: 80ms` 选项。

---

### 2.5 圆角半径不一致

部分组件直接使用硬编码圆角值：

```css
/* 当前写法 */
border-radius: 4px;    /* CaseList.css:138 */
border-radius: 20px;   /* WelcomeScreen.css:27 */
border-radius: 2px;    /* BoardView.css:98 */
border-radius: 9999px; /* IconButton.css:9 */

/* 应改为 */
border-radius: var(--radius-4);
border-radius: var(--radius-full);
border-radius: var(--radius-sm);
```

**建议**: 在 tokens.css 中补充更多常用圆角值（如 4px, 6px, 8px, 10px, 12px）。

---

## 三、轻微问题（可选优化）

### 3.1 命名规范

所有组件样式类名都遵循 BEM 风格的双连字符命名（如 `.cl-toolbar`, `.cd-images-strip`），这是良好的实践。

### 3.2 响应式处理

项目已正确实现响应式断点：
- `@media (max-width: 640px)` 用于移动端适配
- 部分组件考虑了横屏模式

### 3.3 无障碍支持

- ✅ `prefers-reduced-motion` 媒体查询已配置
- ✅ `:focus-visible` 焦点指示器已定义
- ✅ 键盘导航支持良好

---

## 四、正面亮点

1. **设计令牌系统完善**: tokens.css 提供了完整的 LCH 色彩空间变量，与 Linear 风格高度一致
2. **CSS 变量复用率高**: 大部分组件正确使用了 `var()` 函数引用令牌
3. **动画系统统一**: 使用 keyframes 定义通用动画（fadeIn, rowIn, cardIn）
4. **滚动条样式定制**: 全局滚动条样式符合暗色主题
5. **TypeScript 类型安全**: 数据层使用 CSS 变量字符串，便于类型推断

---

## 五、修复优先级建议

### P0（立即修复）
- [ ] 补充缺失的 CSS 变量定义（`--shadow-md`, `--popover-shadow-deep`）
- [ ] 修复硬编码颜色值（至少先标记为 TODO）

### P1（本周内）
- [ ] 建立间距使用规范，并更新 CLAUDE.md
- [ ] 统一过渡时间为 80ms 或 100ms
- [ ] 补充常用圆角值到 tokens.css

### P2（下个迭代）
- [ ] 重构硬编码间距值为 CSS 变量
- [ ] 统一字体大小使用字号别名
- [ ] 规范化行高值

---

## 六、自动化检查建议

建议添加以下 ESLint 规则或 Prettier 配置：

```json
{
  "rules": {
    "no-irregular-spacing": "error",
    "no-hardcoded-colors": "warn",
    "no-hardcoded-dimensions": "warn"
  }
}
```

或使用 Stylelint 插件进行更严格的样式规范检查。

---

## 七、总结

本项目的前端风格基础良好，设计令牌系统完善。主要问题在于**局部细节的不一致**，而非系统性缺陷。建议优先修复 P0 级别的缺失变量问题，然后逐步推进样式规范化工作。

**总体评分**: ⭐⭐⭐⭐☆ (4/5)
