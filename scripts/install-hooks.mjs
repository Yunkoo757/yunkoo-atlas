import { accessSync, chmodSync, constants, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const standardHookNames = [
  'applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit',
  'pre-merge-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit',
  'pre-rebase', 'post-checkout', 'post-merge', 'pre-push', 'pre-receive',
  'update', 'proc-receive', 'post-receive', 'post-update', 'reference-transaction',
  'push-to-checkout', 'pre-auto-gc', 'post-rewrite', 'sendemail-validate',
  'fsmonitor-watchman', 'p4-changelist', 'p4-prepare-changelist',
  'p4-post-changelist', 'p4-pre-submit', 'post-index-change',
]

function git(args, allowMissing = false) {
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (allowMissing && !result.error && result.status === 1) return null
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr?.trim() || `git 退出码 ${result.status}`)
  }
  return result.stdout.replace(/\r?\n$/, '')
}

try {
  const root = git(['rev-parse', '--show-toplevel'])
  const hooksDirectory = path.resolve(root, '.githooks')
  const current = git(['config', '--path', '--get', 'core.hooksPath'], true)
  const normalize = (value) => process.platform === 'win32' ? value.toLowerCase() : value
  if (current !== null && normalize(path.resolve(root, current)) !== normalize(hooksDirectory)) {
    throw new Error(`已配置其他 core.hooksPath：${JSON.stringify(current)}，不会覆盖。请先检查现有 hooks，并手动决定如何合并；可运行 git config --show-origin --get core.hooksPath 查看来源。`)
  }
  if (current === null) {
    const defaultDirectory = path.resolve(git(['rev-parse', '--git-path', 'hooks']))
    const activeHooks = standardHookNames.filter((name) => {
      const candidate = path.join(defaultDirectory, name)
      if (!existsSync(candidate) || !statSync(candidate).isFile()) return false
      if (process.platform === 'win32') return true
      try {
        accessSync(candidate, constants.X_OK)
        return true
      } catch {
        return false
      }
    })
    if (activeHooks.length > 0) {
      throw new Error(`Git 默认目录 ${JSON.stringify(defaultDirectory)} 已有有效 hooks：${activeHooks.join('、')}，不会用新路径遮蔽。请先检查这些 hooks，并手动决定如何合并；现有配置和文件未修改。`)
    }
  }
  const hook = path.join(hooksDirectory, 'pre-commit')
  const checker = path.join(root, 'scripts/check-staged-text.mjs')
  if (!existsSync(hook) || !existsSync(checker)) {
    throw new Error('缺少 .githooks/pre-commit 或 scripts/check-staged-text.mjs，请在包含这两份文件的 Atlas 仓库中重试。')
  }
  if (process.platform !== 'win32') chmodSync(hook, 0o755)
  git(['config', '--local', 'core.hooksPath', '.githooks'])
  console.log('已启用本仓库 .githooks/pre-commit：提交前仅检查暂存文本的 UTF-8 与无 BOM。')
} catch (error) {
  console.error(`Hooks 安装未完成：${error.message}`)
  process.exitCode = 1
}
