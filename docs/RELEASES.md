# Yunkoo Atlas 版本发布与在线更新

## 当前支持范围

- Windows NSIS 安装版：支持应用内检查、下载和重启安装。
- Windows Portable 便携版：当前不发布，避免与可在线更新的 NSIS 安装包混淆。
- macOS：保留 DMG/ZIP 构建配置；接入 Apple 签名与公证后再启用正式更新。
- 更新源：私有 GitHub 仓库 `Yunkoo757/yunkoo-atlas` 的 Releases。

## 首次配置私有更新令牌

私有 GitHub Release 不能匿名下载。每台需要更新的电脑配置一次只读令牌：

1. 打开 GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens。
2. Resource owner 选择 `Yunkoo757`。
3. Repository access 选择 **Only select repositories**，只勾选 `yunkoo-atlas`。
4. Repository permissions 仅设置 **Contents: Read-only**，不要授予写入权限。
5. 生成令牌后，打开 Yunkoo Atlas → 设置 → 更新。
6. 粘贴令牌并点击“安全保存”。令牌会通过 Electron `safeStorage` 加密保存在本机，不进入源码或交易库。

如果令牌泄露，应立即在 GitHub 撤销并重新生成。

## 版本规则

- `patch`：错误修复、视觉调整，例如 `1.0.0 → 1.0.1`。
- `minor`：向后兼容的新功能，例如 `1.0.1 → 1.1.0`。
- `major`：存在不兼容变化，例如 `1.1.0 → 2.0.0`。

`package.json` 的 `version` 是唯一版本来源。Git 标签必须与它完全一致，例如 `v1.0.1`。

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
8. 标签触发 `.github/workflows/release-windows.yml`（同样包含上述测试与 QA）。

GitHub Actions 成功后，私有 Release 中应包含：

- NSIS 安装包 `.exe`
- `latest.yml`
- NSIS blockmap

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
