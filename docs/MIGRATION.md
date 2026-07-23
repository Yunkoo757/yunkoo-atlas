# Trader Atlas — 环境迁移与依赖说明

> 用于在新电脑上克隆、安装依赖并正常运行本项目。  
> 最后更新：2026-07-23

---

## 1. 项目简介

| 项 | 说明 |
|---|---|
| 包名 | `yunkoo-atlas` |
| 类型 | React 单页应用 + 可选 Electron 桌面壳 |
| 包管理器 | **pnpm**（仓库含 `pnpm-lock.yaml`，请勿改用 npm/yarn） |
| Web 开发端口 | `http://localhost:5180` |
| 数据存储 | 浏览器 **IndexedDB**（Web）/ 本地库目录（Electron） |

---

## 2. 系统环境要求

### 2.1 必需

| 软件 | 推荐版本 | 说明 |
|------|----------|------|
| **Node.js** | 20 LTS 或 22 LTS | 当前开发机：v22.22.0；Vite 8 要求 `^20.19.0` 或 `≥22.12.0` |
| **pnpm** | 10.x | 发布验证：10.34.5；安装：`npm install -g pnpm@10` |
| **Git** | 任意较新版本 | 用于克隆仓库 |

### 2.2 可选（按使用场景）

| 软件 | 何时需要 |
|------|----------|
| **Visual Studio Build Tools**（Windows） | 仅当 `sharp` 等原生模块安装失败时；一般 pnpm 会拉预编译包 |
| **Playwright 浏览器** | 跑 `pnpm qa` 时；首次可执行 `pnpm exec playwright install chromium` |

### 2.3 操作系统

- **Windows 10/11**：主要开发与测试环境
- **macOS**：CI 构建桌面产物；涉及文件系统语义的 Electron safety、强杀和 Spike 必须以 macOS runner 的原始报告为准
- **Linux**：Web 版通常可跑；不在本轮 Electron 桌面发布承诺内

---

## 3. 新电脑快速上手（5 步）

```powershell
# 1. 克隆（或拷贝整个项目目录，见第 8 节）
git clone <你的仓库地址> Linear
cd Linear

# 2. 安装依赖（必须用 pnpm）
pnpm install

# 3. 类型检查（Web + Electron）
pnpm typecheck

# 4. 启动 Web 开发服
pnpm dev
# 浏览器打开 http://localhost:5180

# 5. （可选）Electron 桌面开发
pnpm dev:electron
```

**不要拷贝 `node_modules/`**，在新机器上执行 `pnpm install` 重新安装。

---

## 4. npm 脚本一览

| 命令 | 作用 |
|------|------|
| `pnpm dev` | Web 开发（Vite + IndexedDB） |
| `pnpm dev:electron` | Electron 联调（`ELECTRON=1`） |
| `pnpm test` | 领域逻辑与导入、图片回归测试 |
| `pnpm build` | Web 生产构建（`pnpm typecheck` + `vite build`） |
| `pnpm build:app` | Electron 构建 + 复制 `sql-wasm.wasm` |
| `pnpm preview` | 预览 Web 构建结果 |
| `pnpm qa` | Web 自动化 QA；默认连接 5181，若复用 `pnpm dev`，先设置 `$env:QA_BASE_URL='http://localhost:5180'` |
| `pnpm qa:release` | 自启服务并执行测试、构建、设计、Electron 与 10k 性能的完整发布门禁 |
| `pnpm qa:core` | Web QA 核心用例 |
| `pnpm qa:image` | Web QA 图片用例 |
| `pnpm qa:workbench` | 核心工作区流程 QA |
| `pnpm qa:design` | 设计令牌与布局契约检查 |
| `pnpm qa:linear` | Linear 重构页面与响应式检查 |
| `pnpm qa:electron` | Electron headless QA（需先 `build:app`） |
| `pnpm qa:full` | Release 0 要求的完整 Web/Electron 发布 QA |
| `pnpm benchmark:persistence:release` | 正式 10K/20K 持久化、退出与 Web ZIP heap 门；缺少批准基线时保持阻断 |
| `pnpm test:forced-kill:electron` | 强杀真实 Electron 主进程并验证只恢复最后确认数据（需先 `build:app`） |
| `pnpm spike:generation` | 仅运行隔离 Generation 决策 Spike；不会进入生产 bundle |

---

## 5. 生产依赖（dependencies）

安装后位于 `node_modules/`，**无需手动安装**。

| 包名 | 版本约束 | 用途 |
|------|----------|------|
| `react` | 18.3.1 | UI 框架 |
| `react-dom` | 18.3.1 | React DOM |
| `react-router-dom` | 6.26.2 | 路由 |
| `zustand` | 4.5.5 | 全局状态 |
| `@tiptap/react` | 2.8.0 | 富文本编辑器 |
| `@tiptap/starter-kit` | 2.8.0 | 编辑器基础扩展 |
| `@tiptap/extension-bubble-menu` | 2.8.0 | 浮动格式菜单 |
| `@tiptap/extension-image` | 2.8.0 | 图片 |
| `@tiptap/extension-placeholder` | 2.8.0 | 占位符 |
| `@tiptap/extension-task-list` | 2.8.0 | 任务列表 |
| `@tiptap/extension-task-item` | 2.8.0 | 任务项 |
| `lucide-react` | 0.451.0 | 图标 |
| `recharts` | 2.12.7 | 仪表盘图表 |
| `clsx` | ^2.1.1 | className 工具 |
| `@fontsource-variable/inter` | 5.2.8 | 界面字体 |
| `@fontsource/geist-sans` | ^5.2.5 | 界面字体 |
| `@fontsource/jetbrains-mono` | ^5.2.8 | 等宽字体 |
| `@tanstack/react-virtual` | ^3.14.5 | 大数据列表虚拟化 |
| `sql.js` | 1.14.1 | Electron 端 SQLite（WASM） |
| `sharp` | ^0.35.1 | 应用图标生成 |
| `archiver` | ^8.0.0 | `.journal.zip` 打包 |
| `yauzl` | ^2.10.0 | Electron 端有界流式 zip 解压 |
| `jszip` | ^3.10.1 | Web 端 `.journal.zip` 导出与恢复 |
| `electron-updater` | ^6.8.9 | Electron 在线更新 |

---

## 6. 开发依赖（devDependencies）

| 包名 | 版本约束 | 用途 |
|------|----------|------|
| `vite` | ^8.1.4 | 构建与开发服务器 |
| `@vitejs/plugin-react` | ^6.0.3 | React 支持 |
| `typescript` | ^5.6.2 | 类型检查 |
| `@types/react` | ^18.3.11 | React 类型 |
| `@types/react-dom` | ^18.3.0 | React DOM 类型 |
| `electron` | ^43.1.0 | 桌面壳（体积大，首次 install 较慢） |
| `vite-plugin-electron` | ^1.1.0 | Electron 集成 |
| `vite-plugin-electron-renderer` | ^1.0.0 | 渲染进程配置 |
| `cross-env` | ^10.1.0 | 跨平台环境变量 |
| `playwright` | ^1.60.0 | Web QA |
| `puppeteer-core` | ^25.1.0 | 部分脚本/检查 |
| `chrome-remote-interface` | ^0.34.0 | CDP 调试 |
| `@types/archiver` | ^8.0.0 | archiver 类型 |
| `@types/yauzl` | ^2.10.3 | yauzl 类型 |

---

## 7. 构建与运行时配置

### 7.1 Vite（`vite.config.ts`）

- 路径别名：`@` → `src/`
- 开发端口：**5180**
- Electron 模式：`ELECTRON=1` 时启用 `vite-plugin-electron`，`base: './'`

### 7.2 TypeScript（`tsconfig.json`）

- 目标：ES2020
- 严格模式：`strict: true`
- 仅检查 `src/`（Electron 由 Vite 单独编译）

### 7.3 环境变量

| 变量 | 用途 |
|------|------|
| `ELECTRON=1` | 以 Electron 模式启动 Vite |
| `LINEAR_JOURNAL_LIBRARY` | 覆盖桌面版数据库目录 |
| `LINEAR_JOURNAL_QA=1` | Electron QA 模式（跑完退出） |
| `QA_BASE_URL` | Web QA 目标地址（默认常为 `http://localhost:5181`，注意与 dev 端口 5180 区分） |
| `VITE_DEV_SERVER_URL` | Electron dev 加载的 Vite 地址 |

### 7.4 Electron 数据目录（桌面版）

默认路径：

```
%USERPROFILE%\Documents\Yunkoo Atlas\
├── manifest.json
├── journal.db
├── attachments\
└── backups\
```

可通过环境变量 `LINEAR_JOURNAL_LIBRARY` 指向其他目录。

---

## 8. 迁移时要带什么、不要带什么

### 8.1 代码仓库

```text
✅ 必须带：整个 Git 仓库（或至少以下文件）
   - package.json
   - pnpm-lock.yaml
   - pnpm-workspace.yaml
   - src/
   - electron/
   - index.html
   - vite.config.ts
   - tsconfig.json
   - scripts/

❌ 不要依赖拷贝：
   - node_modules/      （在新机器 pnpm install）
   - dist/              （构建产物）
   - dist-electron/     （Electron 构建产物）
   - .vite/
   - tsconfig.tsbuildinfo
```

### 8.2 用户数据（交易记录）

**Web 版（IndexedDB）** — 数据在浏览器里，换电脑不会自动跟过来：

1. 旧电脑：打开应用 → **设置 → 数据** → 导出完整 `.journal.zip` 归档。
2. 新电脑：安装并启动后 → **设置 → 数据** → **恢复完整交易库**。
3. 选择归档后先核对记录、策略、附件、快捷键、保存视图和个人资料预览，再确认整库替换。

完整恢复是原子替换，不是与当前资料合并。建议先下载当前库作为安全副本；格式、版本、快照或附件校验失败时不会改写当前 IndexedDB。JSON 导入仍用于选择性合并，不等同于完整迁移。

**Electron 桌面版** — 数据在本地文件夹：

1. 复制整个 `Documents\Yunkoo Atlas` 目录到新电脑相同位置，或
2. 使用应用内导出 `.journal.zip` / JSON，在新电脑导入

浏览器归档与 Electron 本地库归档不是同一种格式。当前支持将 Web 端导出的 `data.json + assets` 完整归档导入 Electron；Electron 的 `manifest.json + journal.db` 完整归档仍不能在 Web 端恢复。浏览器遇到桌面格式时会明确拒绝，不会尝试写入。

**旧版 localStorage**：若曾用极早版本，首次启动会自动从 key `linear-journal` 迁入 IndexedDB。

### 8.3 数据格式兼容边界

- 当前持久化 schema 与 Web 归档版本均为 **v8**；本轮修复 v8 writer/reader 合同，不创建 v9。
- 16 个活跃字段由中央注册表与 codec 统一规范化；`cases`、`disputeTypes` 仅兼容读取，不会再次写出。
- Release 0 对旧 IndexedDB 中尚不存在的 revision 只观察为兼容值 `0`；成功或失败前后都保持 `0`，不在止血阶段创建 revision 或承诺 CAS。
- Release 1 起，第一次成功 v2 提交在同一 IndexedDB 事务中推进 `0 → 1`，之后所有 snapshot/asset 写入口使用 revision/CAS。升级时必须关闭或刷新仍运行旧脚本的标签页。
- 新版本继续规范化读取 v1–v8 历史快照；未来版本归档会在写盘前被拒绝并说明版本不兼容。
- `subscribedIds` 等历史字段继续保留读取兼容，但不代表当前界面已经提供对应功能。
- 随机复盘会话只写入当前标签页的 `sessionStorage`，不进入资料库快照或备份。

### 8.4 强制退出与恢复边界

- 正常退出会统一执行 renderer flush、已验证备份和 storage release；任一步失败都会取消退出。
- 操作系统强杀、断电或进程崩溃只保证重启后恢复**最后一次已确认落盘的数据**，不承诺保存仍在内存或尚未完成原子替换的编辑。
- 遇到强制退出后，先重新打开资料库并核对最近交易；若最后确认数据本身异常，再从“设置 → 数据与备份”选择已验证恢复点。
- 不要手工删除 `.trash`、临时文件或备份目录；先保留现场并导出当前可读归档。

---

## 9. 常见问题排查

### 9.1 浏览器打不开 / `ERR_CONNECTION_REFUSED`

- 原因：开发服务器未启动
- 处理：在项目根目录执行 `pnpm dev`，确认终端出现 `http://localhost:5180/`

### 9.2 页面黑屏

常见原因与处理：

| 原因 | 处理 |
|------|------|
| dev 未启动 | 见 9.1 |
| 旧数据字段缺失导致 JS 报错 | 硬刷新 `Ctrl+Shift+R`；或设置里导出后重新导入 |
| 控制台有红色报错 | F12 → Console，根据报错修复或反馈 |

### 9.3 `pnpm install` 失败

| 现象 | 建议 |
|------|------|
| `sharp` 安装失败 | 确认 Node 满足 `^20.19.0` 或 `≥22.12.0`；Windows 可装 [VS Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 后重试 |
| `electron` 下载慢/失败 | 配置镜像或代理；多试几次 `pnpm install` |
| 用了 npm/yarn | 删除 `node_modules`，改用 **pnpm install** |

### 9.4 端口 5180 被占用

修改 `vite.config.ts` 中 `server.port`，或关闭占用该端口的进程。

### 9.5 文件编码

- 所有源码为 **UTF-8（无 BOM）**
- 含中文的文件不要用 GBK/ANSI 保存，否则可能乱码或构建异常

---

## 10. 技术栈速查

```
React 18 + TypeScript 5
Vite 8
Zustand（状态，IndexedDB/Electron 持久化）
React Router 6
TipTap 2（复盘笔记）
Recharts（仪表盘）
Lucide React（图标）

Web 存储：IndexedDB（src/storage/indexedDbAdapter.ts）
Electron：sql.js + 本地文件（electron/library/）
```

---

## 11. 相关文档

- 编码与协作规范：`AGENTS.md`
- 当前视觉依据：`docs/linear-frontend-design-system-analysis.md`
- 当前前端规格：`docs/superpowers/specs/2026-07-10-linear-frontend-rebuild-design.md`
- 后续功能规格：`docs/superpowers/specs/2026-07-11-review-notebooks-record-clipboard-design.md`

---

## 12. 迁移检查清单

在新电脑上按顺序打勾：

- [ ] 已安装 Node.js（`^20.19.0` 或 `≥22.12.0`）
- [ ] 已安装 pnpm（`pnpm -v` 有输出）
- [ ] 已克隆/拷贝项目且包含 `pnpm-lock.yaml`
- [ ] 已执行 `pnpm install` 无报错
- [ ] 已执行 `pnpm typecheck` 无报错
- [ ] `pnpm dev` 后 `http://localhost:5180` 可打开
- [ ] （如需旧数据）Web 已通过完整 `.journal.zip` 恢复，或已复制 Electron 库目录
- [ ] （可选）`pnpm dev:electron` 桌面版可启动
- [ ] 已理解强杀只保证最后确认数据，重要迁移前已保存恢复归档
