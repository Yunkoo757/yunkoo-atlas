import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
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
  if ((result.status !== 0 || result.error) && !options.allowFailure) {
    console.error(`命令执行失败：${name} ${args.join(' ')}`)
    if (options.capture && result.stdout?.trim()) console.error(result.stdout.trim())
    if (options.capture && result.stderr?.trim()) console.error(result.stderr.trim())
    if (result.error) console.error(result.error.message)
    process.exit(result.status ?? 1)
  }
  return options.capture ? (result.stdout ?? '').trim() : ''
}

function parseJson(value, label) {
  try {
    return JSON.parse(value)
  } catch {
    console.error(`${label} 返回了无效 JSON。`)
    process.exit(1)
  }
}

function remoteTagExists(tag) {
  return run('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], { capture: true }) !== ''
}

function localTagCommit(tag) {
  return run('git', ['rev-list', '-n', '1', tag], { capture: true, allowFailure: true })
}

function listCandidateRuns(commit, status) {
  const args = [
    'run', 'list', '--workflow', 'release-candidate.yml', '--event', 'workflow_dispatch',
    '--commit', commit, '--limit', '20', '--json', 'databaseId,headSha,status,conclusion,createdAt',
  ]
  if (status) args.push('--status', status)
  const output = run('gh', args, { capture: true })
  const runs = parseJson(output || '[]', '候选认证查询')
  return runs.filter((candidate) => candidate.headSha === commit)
}

async function certify(commit) {
  const existing = listCandidateRuns(commit, 'success')[0]
  if (existing) {
    console.log(`复用已通过的候选认证：${existing.databaseId}`)
    return
  }

  const knownRunIds = new Set(listCandidateRuns(commit).map((candidate) => candidate.databaseId))
  run('gh', ['workflow', 'run', 'release-candidate.yml', '--ref', 'main', '-f', `commit=${commit}`])
  let candidate = null
  for (let attempt = 0; attempt < 30 && !candidate; attempt += 1) {
    await delay(2_000)
    candidate = listCandidateRuns(commit)
      .find((candidate) => !knownRunIds.has(candidate.databaseId)) ?? null
  }
  if (!candidate) {
    console.error('候选认证已触发，但 60 秒内未找到对应 GitHub Actions 运行。')
    process.exit(1)
  }
  run('gh', ['run', 'watch', String(candidate.databaseId), '--exit-status'])
  const verified = listCandidateRuns(commit, 'success')
    .find((item) => item.databaseId === candidate.databaseId)
  if (!verified) {
    console.error('候选认证没有以 success 状态完成，已阻止推送 tag。')
    process.exit(1)
  }
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

run('pnpm', ['qa:release'])

let pkg = JSON.parse(readFileSync('package.json', 'utf8'))
let tag = `v${pkg.version}`
const versionCommitSubject = run('git', ['log', '-1', '--format=%s', '--', 'package.json'], { capture: true })
const pendingRelease = !remoteTagExists(tag) && versionCommitSubject === `chore: release ${tag}`

if (pendingRelease) {
  console.log(`继续候选 ${tag}，不会再次递增版本号。`)
} else {
  run('pnpm', ['version', level, '--no-git-tag-version'])
  pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  tag = `v${pkg.version}`
  if (remoteTagExists(tag)) {
    console.error(`远端标签 ${tag} 已存在，已停止发布。`)
    process.exit(1)
  }
  run('git', ['add', '--', 'package.json'])
  run('git', ['commit', '-m', `chore: release ${tag}`])
  run('git', ['push', 'origin', 'main'])
}

const candidateCommit = run('git', ['rev-parse', 'HEAD'], { capture: true })
await certify(candidateCommit)

const taggedCommit = localTagCommit(tag)
if (taggedCommit && taggedCommit !== candidateCommit) {
  console.error(`本地标签 ${tag} 指向其他提交，已停止发布。`)
  process.exit(1)
}
if (!taggedCommit) run('git', ['tag', tag])
run('git', ['push', 'origin', tag])

console.log(`已发布 ${tag}。GitHub Actions 将自动构建私有 Release。`)
