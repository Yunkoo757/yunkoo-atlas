# Trader Atlas 版本发布与在线更新

## 当前支持范围

- Windows NSIS 安装版：支持应用内检查、下载和重启安装。
- Windows Portable 便携版：当前不发布，避免与可在线更新的 NSIS 安装包混淆。
- macOS：CI 产出 arm64 + x64 的 DMG / ZIP（**未签名、未公证**，供手动安装）；接入 Apple 开发者证书与公证后再启用正式应用内更新。
- 更新源：私有 GitHub 仓库 `Yunkoo757/yunkoo-atlas` 的 Releases。

## Spec v2 发布列车

| 列车 | 范围 | 发布前停止条件 | 回滚与用户恢复 |
|---|---|---|---|
| Release 0 | v8 四路径止血、QA discovery、双平台聚合发布 | 任一字段/附件合同失败、`qa:full` 失败或任一平台构建失败 | 停止 publish；回滚 reader/writer，保留合同测试；用户使用发布前完整归档 |
| Release 1 | codec/foundation、Web revision/CAS、冲突恢复 | 任一写入口 blind put、stale writer 覆盖或恢复导出不可用 | 停止 Web 发布；可关闭 Web Locks/通知层，但 CAS 必须整体保留；用户导出本标签页副本后加载最新版 |
| Release 2 | Electron 路径、退出协调、Undo、TradeKind、日期锚点 | 路径错误回落默认库、退出步骤重复/漏执行、Undo/Kind 矩阵失败 | 停止桌面发布；保留 fail-closed 路径；从已验证备份恢复 |
| Release 3 | 输入预算、Notion/Composer、当前库附件 GC | 新孤儿、共享附件误删、backup vault 变化或 dry-run revision 过期仍执行 | 打开 GC kill switch；Electron 从应用 `.trash` 恢复，Web 从用户预先归档恢复 |

各列车必须把停止、回滚和用户恢复演练写入本地 `test-results/`，并由 GitHub Actions 上传为不可变的运行工件；只有同一源码身份的对应证据和平台门全部通过才可推进下一列车。

GitHub 发布保护固定为：`main` 与 `v*` tag 使用 active repository ruleset 禁止删除和 non-fast-forward；唯一 `publish` job 绑定 `production-release` protected environment。每次最终发布审查必须通过 GitHub API 复核规则仍为 active，并保留审查时间、ruleset ID 与 environment 名称；工作流源码中的环境声明不能代替服务端配置。

2026-07-23 服务端配置证据：branch ruleset [`protect-main-integrity`](https://github.com/Yunkoo757/yunkoo-atlas/rules/19605209)（ID `19605209`）、tag ruleset [`protect-release-tags`](https://github.com/Yunkoo757/yunkoo-atlas/rules/19605211)（ID `19605211`）均为 `active`；environment `production-release`（ID `18612599348`）启用 protected-branches deployment policy。最终审查仍须读取 API，而不能只信此记录。

### Web 多标签页一致性升级提示

从 Release 1 起，Web 资料库写入使用 revision/CAS，并在支持时用 Web Locks 限制为单一编辑标签页。升级发布前请关闭或刷新所有仍运行旧版本脚本的标签页，再开始编辑；旧脚本不认识 revision，无法纳入新协议的并发保护范围。

本版本保证的是：所有已加载 Release 1 或更新版本的标签页，即使浏览器不支持 Web Locks 或 BroadcastChannel，也由 CAS 阻止 stale 快照覆盖。它不宣称能够约束发布前已打开且始终未刷新的旧版本标签页。

Release 0 不提前引入该协议：旧库缺少 revision 时只按兼容值 `0` 观察，成功/失败前后均保持 `0`；真实 revision/CAS 从 Release 1 生效。

### 强制退出保证

正常退出会先完成统一 flush、已验证备份和 storage release。操作系统强杀、断电或进程崩溃只保证**最后一次已确认落盘的数据**；仍在内存或正在写入原子临时文件的编辑可能丢失，发布说明不得作更强承诺。双平台发布门会启动生产构建的真实 Electron 主进程，在观察到原子临时文件后强杀该主进程，并由新的 Electron 主进程重新打开资料库、核对最后确认数据。

### Generation 决策

Generation 目录布局当前为 **No-Go**：隔离 Spike 不进入生产 bundle，也不允许部分上线。发布门要求同一干净源码的 Windows NTFS 与 macOS APFS 原始故障矩阵及聚合决策同时存在；当前 Node/Electron 无法提供真实目录 `fsync` durability barrier，因此即使矩阵通过也保持 No-Go。详见 `docs/architecture/decisions/ADR-0001-electron-generation-layout.md`。

### 当前库附件 GC（Release 3）

Spec v2 §9 / §14.5：当前库孤立附件清理默认只开放**预览 + 导出恢复归档**；真删是单独开闸能力，可用 kill switch 随时关回。应用内没有用户可点的「开发者开关」。

| 项 | 说明 |
|---|---|
| 当前正式包状态 | dry-run：设置 → 数据 →「预览可清理的孤立附件」；不渲染永久删除主按钮 |
| 范围 | 仅当前活动库零引用附件；不扫描、不修改 `backups/` |
| 开闸环境变量 | Electron：`ATLAS_ENABLE_ASSET_PURGE_COMMIT=true`；渲染进程：`VITE_ENABLE_ASSET_PURGE_COMMIT=true`（须在 `pnpm build:app` / `dist:*` 时同时注入） |
| 本地开闸构建 | `pnpm dist:win:purge-commit` 或 `pnpm dist:mac:purge-commit` |
| CI 开闸 | Release workflow 读取 repository variable `ATLAS_ENABLE_ASSET_PURGE_COMMIT`（须为字面量 `true`）；未设置则保持 dry-run |

**观察清单（默认至少 3 天，勾完再开闸）：**

- [ ] dry-run 候选不含仍被 Trade / WeeklyReview / QuickNote 引用的附件（`A-INVENTORY-SHARED`）
- [ ] missing / foreign / temp 分类正确，不会把 live 标成 orphan（`A-INVENTORY-MISSING`）
- [ ] 预览后 revision 变化时提交拒绝并要求重新扫描（`W-GC-STALE` / `A-DRYRUN-RACE`）
- [ ] Web GC 任一点 abort 全事务回滚（`A-WEB-DELETE-N`）；恢复归档可还原（`A-WEB-RECOVERY`）
- [ ] Electron：DB 失败搬回、崩溃后幂等清理、越界/symlink 拒绝且 backup vault 不变（`A-ELEC-*`）
- [ ] `pnpm test:asset-lifecycle:electron` 在 Windows 与 macOS 证据齐全且同源码身份
- [ ] Release 维护者确认恢复归档流程可操作；用户文案仅承诺当前库

**开闸条件：** 上表全部勾选 + Release 维护者签字记录（commit / Train / 原因）。  
**回滚（kill switch）：** 下一正式构建去掉上述环境变量（或 repository variable 改为非 `true`）并发布；inventory / 健康检查 / 预览保留。误删 live、shared 或 backup，或 stale dry-run 仍执行时，立即关闸。

**开闸发版检查表：**

1. 确认观察清单已勾完并写入本次发布说明。
2. 将 GitHub repository variable `ATLAS_ENABLE_ASSET_PURGE_COMMIT` 设为 `true`，或使用 `pnpm dist:*:purge-commit` 打可审计安装包。
3. 验证设置页出现「永久删除候选附件」完整确认流（导出归档 → 勾选 → 删除）。
4. 发布说明写明：仅当前库；备份可能仍含副本；恢复靠用户归档或 Electron `.trash`。
5. 保留关闸回滚步骤于本小节。

### macOS 提示「已损坏，无法打开」

这是 Gatekeeper 对未公证下载的常见拦截，**不是安装包坏了**。从 GitHub 下载的 `.app` 会带 `com.apple.quarantine` 隔离标记，未公证时系统常直接显示「损坏」。

在「终端」执行（路径按实际安装位置改）：

```bash
# 若从 DMG 拖到了应用程序
sudo xattr -cr "/Applications/Trader Atlas.app"

# 或对刚下载的 ZIP 解压目录 / DMG 里的 .app
xattr -cr "/path/to/Trader Atlas.app"
```

然后再次双击打开。若仍被拦：系统设置 → 隐私与安全性 → 仍会看到拦截记录，点「仍要打开」。

长期方案：配置 Apple Developer ID 签名 + 公证后，下载即可正常打开。

## 首次配置私有更新令牌

私有 GitHub Release 不能匿名下载。每台需要更新的电脑配置一次只读令牌：

1. 打开 GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens。
2. Resource owner 选择 `Yunkoo757`。
3. Repository access 选择 **Only select repositories**，只勾选 `yunkoo-atlas`。
4. Repository permissions 仅设置 **Contents: Read-only**，不要授予写入权限。
5. 生成令牌后，打开 Trader Atlas → 设置 → 更新。
6. 粘贴令牌并点击“安全保存”。令牌会通过 Electron `safeStorage` 加密保存在本机，不进入源码或交易库。

如果令牌泄露，应立即在 GitHub 撤销并重新生成。

## Windows 高 DPI

- NSIS 安装向导：`build/installer.nsh` 声明 `ManifestDPIAware` + `PerMonitorV2`，避免安装界面被系统位图拉伸发糊。
- NSIS 品牌图：`pnpm icons:app` 生成 `build/installerSidebar.bmp` / `build/installerHeader.bmp`（Atlas 暗色、3× 分辨率适配高 DPI）；向导默认简体中文。
- 应用进程：Electron 主进程在 ready 前开启 `high-dpi-support`，按显示器原生缩放渲染。

若旧安装包仍糊：先装新版本覆盖；也可在快捷方式属性 → 兼容性 →「更改高 DPI 设置」中确认未强制系统缩放。

## 版本规则

- `patch`：错误修复、视觉调整，例如 `1.0.0 → 1.0.1`。
- `minor`：向后兼容的新功能，例如 `1.0.1 → 1.1.0`。
- `major`：存在不兼容变化，例如 `1.1.0 → 2.0.0`。

`package.json` 的 `version` 是唯一版本来源。Git 标签必须与它完全一致，例如 `v1.0.1`。

带预发布后缀的版本（例如 `1.2.15-preview.7`）使用同名 `v` 标签发布。工作流会将其标记为 GitHub Prerelease，并设置为非 latest；该版本不会进入正式版客户端的自动更新通道。

## 发布命令

发布前确保位于 `main`、工作区干净且已同步远程主干，然后执行：

```powershell
pnpm release:patch
```

新增向后兼容功能时执行：

```powershell
pnpm release:minor
```

发布脚本会依次执行：

1. 检查当前分支、工作区与远程主干。
2. 运行完整回归测试（单元/契约 + Playwright 浏览器用例）。
3. 运行侧栏导航 QA（自启 Vite）。
4. 运行 Electron 生产构建。
5. 运行 Electron 库路径 QA（SQLite / 附件 / journal.zip）。
6. 更新 `package.json` 版本并创建发布提交和 Git 标签。
7. 推送 `main` 和版本标签。
8. 标签触发 `.github/workflows/release.yml`；Windows 与 macOS 分别构建并校验工件，唯一 publish job 聚合全部平台资产后才公开 Release。

GitHub Actions 成功后，私有 Release 中应包含：

- NSIS 安装包 `.exe`
- `latest.yml`
- NSIS blockmap
- macOS `Trader-Atlas-<version>-mac-<arch>.dmg` / `.zip`（arm64 + x64）

只有 NSIS 安装版消费 `latest.yml` 完成自动更新。

## 客户端更新流程

1. 正式安装版启动 10 秒后检查一次更新，之后每 6 小时检查一次。
2. 发现新版本后由用户点击“下载更新”。
3. 下载完成后点击“备份并重启更新”。
4. 应用先创建交易库备份，再退出并安装新版本。
5. 下载完成但暂不重启时，更新会在后续退出时自动安装。

## 发布故障处理

- GitHub Actions 失败：不要重复创建新版本，修复工作流后重新运行该任务。
- 标签与 `package.json` 不一致：删除错误的未发布标签，重新创建正确标签。
- 客户端提示需要令牌：检查令牌是否过期，以及是否仍有仓库 Contents 只读权限。
- 便携版提示不支持：改用 Release 中的 NSIS 安装包安装。
- 更新前备份失败：客户端会取消重启安装，先在“设置 → 数据”修复交易库问题。
