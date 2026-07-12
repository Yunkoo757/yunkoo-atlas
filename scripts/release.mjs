import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolveCommand } from './release-command.mjs'

const level = process.argv[2]
const allowedLevels = new Set(['patch', 'minor', 'major'])

if (level === '--help' || level === '-h') {
  console.log('用法: node scripts/release.mjs <patch|minor|major>')
  process.exit(0)
}

if (!allowedLevels.has(level)) {
  console.error('版本类型必须是 patch、minor 或 major。')
  process.exit(1)
}

function run(name, args, options = {}) {
  let invocation
  try {
    invocation = resolveCommand(name, args)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  const result = spawnSync(invocation.file, invocation.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.status !== 0 || result.error) {
    console.error(`命令执行失败：${name} ${args.join(' ')}`)
    if (options.capture && result.stdout?.trim()) console.error(result.stdout.trim())
    if (options.capture && result.stderr?.trim()) console.error(result.stderr.trim())
    if (result.error) console.error(result.error.message)
    process.exit(result.status ?? 1)
  }
  return options.capture ? result.stdout.trim() : ''
}

const branch = run('git', ['branch', '--show-current'], { capture: true })
if (branch !== 'main') {
  console.error(`发布必须从 main 执行，当前分支为 ${branch || '未知'}。`)
  process.exit(1)
}

const status = run('git', ['status', '--porcelain'], { capture: true })
if (status) {
  console.error('工作区存在未提交修改，请先提交后再发布。')
  process.exit(1)
}

run('git', ['fetch', 'origin', 'main'])
const local = run('git', ['rev-parse', 'HEAD'], { capture: true })
const remote = run('git', ['rev-parse', 'origin/main'], { capture: true })
if (local !== remote) {
  console.error('本地主干与 origin/main 不一致，请先同步后再发布。')
  process.exit(1)
}

run('pnpm', ['test'])
run('pnpm', ['qa:sidebar'])
run('pnpm', ['build:app'])
run('pnpm', ['qa:electron'])
run('pnpm', ['version', level, '--message', 'chore: release v%s'])

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const tag = `v${pkg.version}`
run('git', ['push', 'origin', 'main'])
run('git', ['push', 'origin', tag])

console.log(`已发布 ${tag}。GitHub Actions 将自动构建私有 Release。`)
