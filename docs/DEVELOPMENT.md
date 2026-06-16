# Linear Journal — 开发交接文档

> 最后更新：2026-06-15  
> 当前主干提交：`7b729d3` — feat: IndexedDB 与 Electron 本地库、策略体系与 QA 流水线  
> 上一基线：`72d2772` — Initial commit: Linear-style trading journal MVP

本文档汇总项目阶段划分、已完成工作、架构要点、已知踩坑与后续待办，供恢复开发时快速对齐上下文。

---

## 1. 项目定位

**Linear Journal** 是一款 Linear 风格的交易日志（Trading Journal）前端应用：

- **Web 版**：浏览器 + IndexedDB 本地持久化，适合快速开发与演示
- **桌面版（Electron）**：本地「库」目录（SQLite + 附件文件），支持 `.journal.zip` 打包导入导出

技术栈：React 18、React Router 6、Zustand、TipTap 编辑器、Vite 5、Electron 42。

---

## 2. 阶段总览

| 阶段 | 状态 | 摘要 |
|------|------|------|
| **MVP** | ✅ 已完成 | Linear 风格 UI、交易 CRUD、列表/看板/仪表盘、TipTap 笔记、命令面板 |
| **Phase 1 — Web 存储** | ✅ 已完成 | IndexedDB 替代 `localStorage`；笔记图片外置；JSON v3 导出含 `assets[]` |
| **Phase 2 — Electron 桌面壳** | ✅ 代码完成 | sql.js 库、sharp 图片管线、journal.zip、渲染层适配器切换 |
| **Phase 2 — 手动冒烟** | ⏸ 暂停前未做 | 真实窗口下笔记/图片/导入导出需人工点一遍 |
| **设计审查 & UX** | ✅ 两轮修复 | 加载态、KPI、路由、侧栏去重等 |
| **Phase 3 — 生产化** | ❌ 未开始 | 自动备份、云同步引导、electron-builder 安装包等 |

---

## 3. 已完成工作（按模块）

### 3.1 Phase 1：IndexedDB 存储迁移

**动机**：`localStorage` 容量小、同步阻塞，且无法合理存放笔记内嵌图片。

**实现要点**：

- 抽象 `StorageAdapter`（`src/storage/adapter.ts`），运行时按环境选择实现
- **Web**：`indexedDbAdapter.ts` — 快照 + `assets` 对象存储
- 笔记保存前经 `normalizeNoteForStorage` / `externalizeNoteImages` 将 blob/data URL 转为资产 ID
- 展示时通过 `journal-asset://` 协议（Web）或 Electron 自定义协议加载图片
- 首次启动 `migrateFromLocalStorageIfNeeded` 从旧 key `linear-journal` 迁入
- Zustand 不再使用 `persist` middleware；改为 `bootstrapStorage()` + `schedulePersist()` 防抖写入
- 导出格式 **v3**（`EXPORT_VERSION = 3`），`assets[]` 为 base64 附件记录

**关键文件**：

```
src/storage/
├── adapter.ts          # 接口定义
├── indexedDbAdapter.ts # Web 实现
├── bootstrap.ts        # 启动、hydrate、订阅持久化
├── migrate.ts          # localStorage / 跨端迁移
├── persist.ts          # 防抖 flush
├── assets.ts           # 图片读写与 URL 解析
├── types.ts            # SCHEMA_VERSION=3, PersistedSnapshot
└── runtime.ts          # isElectron(), getJournalBridge()
```

**已修 Bug**：

- `DetailView` 笔记防抖竞态：仅在编辑器 `onChange` 时调用 `persistEditorNote`，避免加载笔记触发误写

### 3.2 Phase 2：Electron 桌面库

**库目录结构**（默认：`文档/Linear Journal`，可用环境变量覆盖）：

```
Linear Journal/
├── manifest.json    # schemaVersion, libraryId, 迁移标记
├── journal.db       # sql.js SQLite，meta 表存 snapshot JSON
├── attachments/     # sharp 转 WebP 的图片文件
└── backups/         # 目录已创建，逻辑未实现
```

**主进程模块**：

```
electron/
├── main.ts              # 窗口、暗色主题、preload 路径、QA 模式入口
├── preload.ts           # contextBridge → journalBridge
├── qa.ts                # LINEAR_JOURNAL_QA=1 时 headless 自检后退出
└── library/
    ├── paths.ts         # 库路径、附件路径
    ├── storage.ts       # sql.js 读写 snapshot
    ├── images.ts        # sharp 压缩/WebP
    ├── journalZip.ts    # archiver v8 ZipArchive 打包/解压
    └── ipc.ts           # IPC 注册
```

**渲染层**：`src/storage/electronAdapter.ts` 通过 preload 暴露的 bridge 与主进程通信。

**数据 IO**：`DataIOModal.tsx` + `importExport.ts` 支持：

- JSON（v3，含 assets）
- `.journal.zip`（仅 Electron：含 db + attachments + manifest）

### 3.3 策略体系与筛选

- 策略 CRUD：`StrategiesView` + `StrategyFormModal`
- 侧栏策略区：点击进入 `/strategy/:id`（**按策略筛选的交易列表**，非管理页）
- 策略管理入口：侧栏底部 **「管理策略…」** → `/strategies`（已去除与工作区重复的「策略管理」项）
- 筛选逻辑：`src/lib/tradeFilters.ts`，各视图通过 `ListFilter` 传入 `ListView` / `BoardView`
- 策略图标：`StrategyIcon`，侧栏 `variant="nav"` 视觉降权

### 3.4 其他功能增量

| 模块 | 说明 |
|------|------|
| `SaveStatusIndicator` | 保存中 / 已保存 / 失败状态 |
| `DisplayMenu` | 列表显示偏好（密度、列等） |
| `TagEditor` | 标签编辑 |
| `Toast` | 全局 toast（`lib/toast.ts`） |
| `tradeRoute.ts` | 统一详情链接 `tradeDetailPath(trade)` → `/trade/TRD-xxx` |
| `CommandPalette` | Cmd/Ctrl+K 搜索与导航 |
| 快捷键 | `C` 新建交易；`G` 然后 `L/B/D` 跳转列表/看板/仪表盘 |

### 3.5 设计审查修复（两轮）

- 列表已完成行勾选框：默认隐藏，hover 时显示（`ListView.css`）
- 应用加载页：深色背景 + spinner（`App.css`），支持 `prefers-reduced-motion`
- 仪表盘 KPI 裁切修复（`Dashboard.css`）
- 详情页 404 顶栏（`DetailView.tsx`）
- Topbar 标题挤压（`Topbar.css`）
- Electron 顶栏白条：`nativeTheme.themeSource='dark'`、`backgroundColor='#050506'`、隐藏菜单栏

### 3.6 QA 自动化

| 命令 | 范围 | 说明 |
|------|------|------|
| `pnpm qa` | Web 全量 | phase1 + 图片用例 |
| `pnpm qa:core` | Web 核心 | `scripts/qa-phase1.mjs` |
| `pnpm qa:image` | Web 图片 | `scripts/qa-phase1-image.mjs` |
| `pnpm qa:electron` | 桌面 headless | 需先 `pnpm build:app` |

- Web QA 使用 **Playwright**，默认 `QA_BASE_URL=http://localhost:5181`（需先 `pnpm dev`）
- Electron QA 使用 **主进程 headless**（`LINEAR_JOURNAL_QA=1`），因 Playwright/CDP 难以稳定驱动 Electron 42 UI
- QA 截图输出到 `qa-screenshots/`、`qa-screenshots-electron/`（已加入 `.gitignore`）

**自动化通过情况（暂停前）**：

- Web：14/14
- Electron headless：14/14

---

## 4. 架构示意

```
┌─────────────────────────────────────────────────────────┐
│                     React UI (Zustand)                   │
│  bootstrapStorage() → hydrate → subscribe → persist      │
└─────────────────────────┬───────────────────────────────┘
                          │ StorageAdapter
          ┌───────────────┴───────────────┐
          ▼                               ▼
   IndexedDB (Web)              electronAdapter
   - snapshot store              - IPC → main process
   - assets store                - sql.js + filesystem
          │                               │
          ▼                               ▼
   journal-asset://              attachments/*.webp
```

**环境检测**：`import.meta.env` + `window.journalBridge`（preload 注入），见 `src/storage/runtime.ts`。

---

## 5. 常用命令

```bash
pnpm install          # 安装依赖
pnpm dev              # Web 开发（IndexedDB）
pnpm dev:electron     # Electron 开发（ELECTRON=1）
pnpm build            # Web 生产构建
pnpm build:app        # Electron 构建 + 复制 sql.js wasm
pnpm qa               # Web QA（需 dev server）
pnpm qa:electron      # Electron headless QA（需 build:app）
```

**环境变量**：

| 变量 | 用途 |
|------|------|
| `ELECTRON=1` | Vite/Electron 联调 |
| `LINEAR_JOURNAL_LIBRARY` | 覆盖桌面库路径（QA 用临时目录） |
| `LINEAR_JOURNAL_QA=1` | 主进程 QA 模式，跑完退出 |
| `QA_BASE_URL` | Web QA 目标地址 |
| `VITE_DEV_SERVER_URL` | Electron dev 加载的 Vite URL |

---

## 6. 路由一览

| 路径 | 页面 |
|------|------|
| `/list`, `/board` | 实盘交易列表/看板 |
| `/inbox` | 收件箱 |
| `/my-trades` | 我的交易 |
| `/favorites` | 星标 |
| `/missed` | 错过 |
| `/period/:slug` | 按时间段（today/week/month/…） |
| `/paper`, `/practice` | 纸面 / 练习复盘 |
| `/strategy/:id` | 某策略下的交易列表 |
| `/strategies` | 策略管理 |
| `/dashboard` | 仪表盘 |
| `/trade/:id` | 交易详情（如 `/trade/TRD-142`） |

---

## 7. 开发踩坑记录（重要）

以下为实际开发中遇到的问题与选型，后续改动前请先读：

1. **better-sqlite3 在 Windows 编译失败** → 改用 **sql.js**（WASM），打包时 `vite.config` 需 external `sql.js`
2. **archiver v8** 无 default export → 使用 `ZipArchive`，同样 external
3. **preload 开发模式**：输出 **`preload.cjs`**（非 `.mjs`），`main.ts` 按 `preload.cjs` / `.js` / `.mjs` 顺序查找
4. **Electron 生产加载**：`app.getAppPath()/dist/index.html`，非 `__dirname` 相对路径
5. **Playwright 驱动 Electron UI 不稳定** → 桌面 QA 改为主进程 headless；UI 流靠手动清单
6. **构建后复制 wasm**：`scripts/copy-sql-wasm.mjs` 在 `build:app` 末尾执行
7. **tsconfig.tsbuildinfo** 已从版本库移除并 gitignore，勿再提交

---

## 8. 暂停前未完成：手动冒烟清单

恢复开发后建议优先人工验证（自动化未覆盖 UI 交互）：

- [ ] `pnpm dev:electron` 启动，顶栏无白条
- [ ] 打开交易详情，编辑笔记，刷新/重启后内容仍在
- [ ] 粘贴或插入图片，重启后图片正常显示
- [ ] 数据 IO → 导出 `.journal.zip`，清空库后导入，数据与图片完整
- [ ] 访问 `/trade/TRD-142`（或任意 ID）详情页正常
- [ ] 侧栏策略项 → 筛选列表；「管理策略…」→ 管理页，无重复入口困惑
- [ ] Web 版 `pnpm dev`：IndexedDB 迁移、JSON 导出导入

---

## 9. Phase 3 及后续待办（建议优先级）

### 高优先级 — 生产可用

1. **electron-builder 安装包**  
   - Windows `.exe` / macOS `.dmg`  
   - 代码签名、自动更新（可选）

2. **自动备份**  
   - 写入 `backups/`（目录已预留）  
   - 策略：定时快照、退出前备份、保留 N 份

3. **库路径引导**  
   - 首次启动选择/创建库目录  
   - iCloud / OneDrive 目录提示（避免多机冲突说明）

### 中优先级 — 体验与可靠性

4. **Electron UI 级 E2E**  
   - 评估 `@playwright/test` + 更新 Electron 版本，或 Spectron 替代方案  
   - 覆盖笔记编辑、粘贴图片、Data IO 弹窗

5. **冲突与多窗口**  
   - 同一库多实例打开时的文件锁或警告

6. **大库性能**  
   - 交易数量上千时的列表虚拟化、快照增量写入评估

7. **导入导出**  
   - 从其他日志工具格式导入（CSV 等）  
   - 导出 PDF 报告（仪表盘/单笔复盘）

### 低优先级 — 产品扩展

8. **同步**  
   - 可选云同步（需明确信任模型与冲突策略）

9. **移动端 / PWA**  
   - 只读或轻量编辑场景

10. **文档**  
    - 用户向 README、快捷键说明页

---

## 10. 关键文件索引

| 用途 | 路径 |
|------|------|
| 应用入口与路由 | `src/App.tsx` |
| 全局状态 | `src/store/useStore.ts` |
| 存储启动 | `src/storage/bootstrap.ts` |
| 导入导出 | `src/lib/importExport.ts` |
| 数据 IO UI | `src/components/DataIOModal.tsx` |
| Electron 主进程 | `electron/main.ts` |
| IPC | `electron/library/ipc.ts` |
| Vite + Electron 配置 | `vite.config.ts` |
| 交易种子数据 | `src/data/trades.ts` |
| 策略种子数据 | `src/data/strategies.ts` |
| 项目编码约定 | `Claude.md`（UTF-8、中文回复等） |

---

## 11. Git 与协作说明

- **当前分支**：`main`（功能已合入主干）
- **未纳入版本库**：`dist/`、`dist-electron/`、`node_modules/`、QA 截图、`qa-err.txt`、`tsconfig.tsbuildinfo`
- **提交风格**：单次大功能可用 `feat:` 前缀；后续建议按 logical chunk 拆分 commit
- **推送**：本地已 commit；是否 push remote 按团队流程决定

---

## 12. 恢复开发快速路径

```text
1. pnpm install
2. pnpm dev                    # 确认 Web 正常
3. 完成 §8 手动冒烟清单
4. 从 §9 Phase 3 选一项开工（建议：electron-builder 或自动备份）
5. 改动存储/schema 时同步更新 SCHEMA_VERSION、迁移逻辑与 QA 脚本
```

---

## 13. 会话记忆摘要

- 用户于 2026-06-15 要求 **暂停开发**，并将全部工作 **提交至 main**（commit `7b729d3`）
- Phase 1、Phase 2 代码与 QA 脚本均已入库；Phase 3 明确未启动
- 侧栏 UX：「策略管理」与「管理策略…」重复问题已解决，只保留后者
- 设计审查已完成两轮，无已知阻塞性 UI Bug

如有架构或阶段划分变更，请更新本文档顶部「最后更新」与相关章节。
