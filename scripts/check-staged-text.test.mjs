import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const sourceRoot = fileURLToPath(new URL('../', import.meta.url))
const checker = path.join(sourceRoot, 'scripts/check-staged-text.mjs')
const installer = path.join(sourceRoot, 'scripts/install-hooks.mjs')
const invalidUtf8 = Buffer.from([0xc3, 0x28])
const bomText = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('中文\n')])

function repository(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'atlas-staged-text-'))
  const globalConfig = path.join(root, '.empty-global-config')
  writeFileSync(globalConfig, '')
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_AUTHOR_NAME: 'Atlas Hook Test',
    GIT_AUTHOR_EMAIL: 'hook-test@example.invalid',
    GIT_COMMITTER_NAME: 'Atlas Hook Test',
    GIT_COMMITTER_EMAIL: 'hook-test@example.invalid',
  }
  t.after(() => {
    assert(path.resolve(root).startsWith(`${path.resolve(tmpdir())}${path.sep}`))
    rmSync(root, { recursive: true, force: true })
  })
  function run(command, args) {
    return spawnSync(command, args, { cwd: root, env, encoding: 'utf8' })
  }
  function git(...args) {
    const result = run('git', args)
    assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr}`)
    return result.stdout
  }
  function write(file, contents) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), contents)
  }
  git('init', '--quiet')
  return { root, run, git, write, check: () => run(process.execPath, [checker]) }
}

function copyHook(repo) {
  mkdirSync(path.join(repo.root, '.githooks'), { recursive: true })
  mkdirSync(path.join(repo.root, 'scripts'), { recursive: true })
  const hook = path.join(repo.root, '.githooks/pre-commit')
  copyFileSync(path.join(sourceRoot, '.githooks/pre-commit'), hook)
  copyFileSync(checker, path.join(repo.root, 'scripts/check-staged-text.mjs'))
  return hook
}

test('empty index and Chinese paths pass without changing staged or working content', (t) => {
  const repo = repository(t)
  assert.equal(repo.check().status, 0)
  repo.write('目录/中文 空格.md', 'Yunkoo老师好，保留中文。\n')
  repo.write('--中文.md', 'UTF-8 无 BOM\n')
  repo.git('add', '--', '目录/中文 空格.md', '--中文.md')
  const stagedBefore = repo.git('ls-files', '--stage', '-z')
  const contentsBefore = readFileSync(path.join(repo.root, '目录/中文 空格.md'))
  const result = repo.check()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /2 个文本文件/)
  assert.equal(repo.git('ls-files', '--stage', '-z'), stagedBefore)
  assert.deepEqual(readFileSync(path.join(repo.root, '目录/中文 空格.md')), contentsBefore)
})

test('partial staging checks index bytes rather than newer working-tree bytes', (t) => {
  const repo = repository(t)
  repo.write('部分 暂存.md', '有效中文\n')
  repo.git('add', '--', '部分 暂存.md')
  repo.write('部分 暂存.md', invalidUtf8)
  assert.equal(repo.check().status, 0)
  assert.deepEqual(readFileSync(path.join(repo.root, '部分 暂存.md')), invalidUtf8)

  repo.git('add', '--', '部分 暂存.md')
  repo.write('部分 暂存.md', '工作区已经修正，暂存区仍无效。\n')
  const stagedBefore = repo.git('ls-files', '--stage', '-z')
  const result = repo.check()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /部分 暂存\.md.*不是有效 UTF-8/)
  assert.match(result.stderr, /重新暂存/)
  assert.equal(repo.git('ls-files', '--stage', '-z'), stagedBefore)
  assert.equal(readFileSync(path.join(repo.root, '部分 暂存.md'), 'utf8'), '工作区已经修正，暂存区仍无效。\n')
})

test('invalid UTF-8 and BOM are rejected in supported text and configuration files', (t) => {
  const repo = repository(t)
  const files = [
    '说明.md', 'icon.svg', 'config.toml', '.editorconfig', '.githooks/pre-commit',
    'script.py', 'schema.sql', 'installer.nsh', 'installer.nsi', 'run.bat', 'run.cmd', 'deps.lock',
  ]
  for (const file of files) repo.write(file, bomText)
  repo.write('invalid.ts', invalidUtf8)
  repo.git('add', '--', ...files, 'invalid.ts')
  const result = repo.check()
  assert.equal(result.status, 1)
  for (const file of files) assert(result.stderr.includes(`${JSON.stringify(file)}：暂存内容带有 UTF-8 BOM`))
  assert.match(result.stderr, /invalid\.ts.*不是有效 UTF-8/)
})

test('binary additions and staged text deletions are skipped', (t) => {
  const repo = repository(t)
  repo.write('旧说明.md', invalidUtf8)
  repo.git('add', '--', '旧说明.md')
  repo.git('commit', '--quiet', '--no-verify', '-m', 'fixture baseline')
  repo.git('rm', '--', '旧说明.md')
  repo.write('图片.png', invalidUtf8)
  repo.git('add', '--', '图片.png')
  const result = repo.check()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /0 个文本文件/)
})

test('renamed paths are checked using the new index path and text extension', (t) => {
  const repo = repository(t)
  repo.write('old.png', invalidUtf8)
  repo.write('valid.md', '有效中文\n')
  repo.git('add', '--', 'old.png', 'valid.md')
  repo.git('commit', '--quiet', '--no-verify', '-m', 'fixture baseline')
  repo.git('mv', '--', 'old.png', '改名 后.md')
  repo.git('mv', '--', 'valid.md', '中文 说明.md')
  const result = repo.check()
  assert.equal(result.status, 1)
  assert.match(result.stderr, /改名 后\.md.*不是有效 UTF-8/)
  assert.doesNotMatch(result.stderr, /中文 说明\.md/)
})

test('real portable pre-commit hook blocks invalid staged bytes and permits the corrected commit', (t) => {
  const repo = repository(t)
  const hook = copyHook(repo)
  chmodSync(hook, 0o755)
  assert(!readFileSync(hook).includes(13), 'portable shell hook must use LF line endings')
  repo.write('待提交.md', bomText)
  repo.git('add', '--', '待提交.md')
  const blocked = repo.run('git', ['-c', 'core.hooksPath=.githooks', 'commit', '--quiet', '-m', 'must fail'])
  assert.notEqual(blocked.status, 0)
  assert.match(blocked.stderr, /待提交\.md.*UTF-8 BOM/)
  assert.notEqual(repo.run('git', ['rev-parse', '--verify', 'HEAD']).status, 0)

  repo.write('待提交.md', '修正后的中文\n')
  repo.git('add', '--', '待提交.md')
  const passed = repo.run('git', ['-c', 'core.hooksPath=.githooks', 'commit', '--quiet', '-m', 'valid text'])
  assert.equal(passed.status, 0, passed.stderr)
  assert.equal(repo.git('log', '-1', '--format=%s').trim(), 'valid text')
})

test('installer is local, repeatable, and enables the real hook', (t) => {
  const repo = repository(t)
  copyHook(repo)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = repo.run(process.execPath, [installer])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(repo.git('config', '--local', '--get', 'core.hooksPath').trim(), '.githooks')
  }
  repo.write('安装验证.md', bomText)
  repo.git('add', '--', '安装验证.md')
  const result = repo.run('git', ['commit', '--quiet', '-m', 'must fail after installation'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /安装验证\.md.*UTF-8 BOM/)
})

test('installer preserves conflicting effective hook configuration and existing hooks', (t) => {
  const repo = repository(t)
  copyHook(repo)
  repo.write('existing-hooks/pre-commit', '#!/bin/sh\nexit 0\n')
  repo.git('config', '--global', 'core.hooksPath', 'existing-hooks')
  const before = readFileSync(path.join(repo.root, 'existing-hooks/pre-commit'))
  const result = repo.run(process.execPath, [installer])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /existing-hooks/)
  assert.match(result.stderr, /不会覆盖/)
  assert.equal(repo.git('config', '--get', 'core.hooksPath').trim(), 'existing-hooks')
  assert.equal(repo.run('git', ['config', '--local', '--get', 'core.hooksPath']).status, 1)
  assert.deepEqual(readFileSync(path.join(repo.root, 'existing-hooks/pre-commit')), before)
})

test('installer does not hide active default hooks when core.hooksPath is unset', (t) => {
  const repo = repository(t)
  copyHook(repo)
  const defaultDirectory = path.resolve(repo.root, repo.git('rev-parse', '--git-path', 'hooks').trim())
  const content = '#!/bin/sh\nexit 0\n'
  for (const name of ['pre-commit', 'pre-push']) {
    const file = path.join(defaultDirectory, name)
    writeFileSync(file, content)
    chmodSync(file, 0o755)
  }
  const result = repo.run(process.execPath, [installer])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /pre-commit/)
  assert.match(result.stderr, /pre-push/)
  assert.match(result.stderr, /不会用新路径遮蔽/)
  assert.equal(repo.run('git', ['config', '--local', '--get', 'core.hooksPath']).status, 1)
  for (const name of ['pre-commit', 'pre-push']) {
    assert.equal(readFileSync(path.join(defaultDirectory, name), 'utf8'), content)
  }
})
