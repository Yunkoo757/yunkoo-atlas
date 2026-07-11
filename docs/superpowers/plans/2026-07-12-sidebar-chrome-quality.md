# Sidebar Chrome Quality (Option C) Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 侧栏导航改为统一 1.5 描边 chrome + 更静层级，对齐方案 C。

**Architecture:** 新增 `src/icons/sidebarChrome.tsx` 专用 stroke 图标；`sidebarNav` / `Sidebar` 只引用该模块；`Sidebar.css` 调整行高与分区标题。不改路由与业务逻辑。

**Tech Stack:** React、TypeScript、现有 CSS tokens。

---

### Task 1: Stroke icon module

- [ ] Create `src/icons/sidebarChrome.tsx` with shared stroke SVG wrapper and icons for: calendar, issues grid, book, dashboard, active, star, missed, flask, bookmark, target, trash, settings, search, write.
- [ ] Export type compatible with `AppIcon` / `LinearStaticIconProps` (`size`, `className`, `title`).

### Task 2: Wire navigation

- [ ] Update `src/lib/sidebarNav.ts` to import stroke icons.
- [ ] Update `src/components/Sidebar.tsx` `WORKSPACE_ICONS` and header Search/PenSquare to stroke set.

### Task 3: CSS quiet hierarchy

- [ ] Update `Sidebar.css`: section label quieter; item height ~32–33px; icon colors; hbtn quieter default.

### Task 4: Verify

- [ ] `pnpm build`
- [ ] Commit
