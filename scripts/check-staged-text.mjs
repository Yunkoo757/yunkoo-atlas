import path from 'node:path'
import { spawnSync } from 'node:child_process'

const textExtensions = new Set([
  '.md', '.markdown', '.mdx', '.txt', '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs', '.json', '.jsonc', '.yml', '.yaml', '.toml',
  '.css', '.scss', '.sass', '.less', '.html', '.htm', '.svg', '.xml', '.csv',
  '.sh', '.bash', '.zsh', '.ps1', '.ini', '.cfg', '.conf',
  '.py', '.sql', '.nsh', '.nsi', '.bat', '.cmd', '.lock',
])
const textNames = new Set([
  '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.nvmrc',
  '.prettierignore', '.eslintignore', 'pre-commit', 'pre-push', 'commit-msg',
])
const decoder = new TextDecoder('utf-8', { fatal: true })

function git(args) {
  const result = spawnSync('git', args, { maxBuffer: 64 * 1024 * 1024 })
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.toString('utf8').trim()
    throw new Error(`无法读取 Git 暂存区：${detail || `git 退出码 ${result.status}`}`)
  }
  return result.stdout
}

try {
  const paths = decoder.decode(git([
    'diff', '--cached', '--no-ext-diff', '--name-only', '--diff-filter=ACMR', '-z', '--',
  ])).split('\0').filter(Boolean)
  const failures = []
  let checked = 0
  for (const file of paths) {
    const name = path.posix.basename(file).toLowerCase()
    if (!textNames.has(name) && !textExtensions.has(path.posix.extname(name))) continue
    const bytes = git(['cat-file', 'blob', `:${file}`])
    checked += 1
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      failures.push(`${JSON.stringify(file)}：暂存内容带有 UTF-8 BOM`)
      continue
    }
    try {
      decoder.decode(bytes)
    } catch {
      failures.push(`${JSON.stringify(file)}：暂存内容不是有效 UTF-8`)
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
