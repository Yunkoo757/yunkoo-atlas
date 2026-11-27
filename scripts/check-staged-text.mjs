import { decodeGitPaths, decodeRepositoryText, isKnownTextPath } from './repository-text.mjs'
import { spawnSync } from 'node:child_process'

function git(args) {
  const result = spawnSync('git', args, { maxBuffer: 64 * 1024 * 1024 })
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.toString('utf8').trim()
    throw new Error(`无法读取 Git 暂存区：${detail || `git 退出码 ${result.status}`}`)
  }
  return result.stdout
}

try {
  const paths = decodeGitPaths(git([
    'diff', '--cached', '--no-ext-diff', '--name-only', '--diff-filter=ACMR', '-z', '--',
  ]))
  const failures = []
  let checked = 0
  for (const file of paths) {
    if (!isKnownTextPath(file)) continue
    const bytes = git(['cat-file', 'blob', `:${file}`])
    checked += 1
    try {
      decodeRepositoryText(bytes)
    } catch (error) {
      failures.push(`${JSON.stringify(file)}：暂存内容${error.message}`)
    }
  }
  if (failures.length > 0) {
    console.error(`暂存文本检查失败：\n${failures.join('\n')}`)
    console.error('请在编辑器中将对应文件保存为 UTF-8（无 BOM），核对中文内容后重新暂存，再提交。部分暂存时只重新暂存本次需要的修改。检查未修改文件或暂存区。')
    process.exitCode = 1
  } else {
    console.log(`暂存文本检查通过：${checked} 个文本文件（UTF-8，无 BOM）。`)
  }
} catch (error) {
  console.error(`暂存文本检查无法完成：${error.message}`)
  console.error('请在仓库根目录确认 Git 和 Node.js 可用，运行 node scripts/check-staged-text.mjs 查看结果后重试提交。')
  process.exitCode = 1
}
