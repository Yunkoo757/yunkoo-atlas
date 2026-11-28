import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { readGitProvenance } from '../git-provenance.mjs'
import { repositoryEntries } from '../git-worktree.mjs'

function repository(t) {
  const area = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-repository-files-'))
  t.after(() => fs.rmSync(area, { recursive: true, force: true }))
  const root = path.join(area, 'repo')
  fs.mkdirSync(root)
  const git = (...args) => execFileSync('git', args, { cwd: root })
  git('init', '-q')
  const commit = () => {
    git('add', '.')
    git('-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '--allow-empty', '-qm', 'source')
  }
  return { area, root, git, commit }
}

test('源码规范覆盖中文路径，品牌检查保留仅审查已跟踪文件的边界', t => {
  const { root, git } = repository(t)
  fs.mkdirSync(path.join(root, 'src'))
  const name = process.platform === 'win32' ? 'src/旧字段.ts' : 'src/旧\\字段\n探针.ts'
  fs.writeFileSync(path.join(root, name), 'export const value = input.livePerformanceCycles')
  fs.writeFileSync(path.join(root, '品牌.md'), ['linear', 'journal'].join('-'))
  const check = (file, ...args) => {
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const command = fileURLToPath(new URL(file, import.meta.url))
    return spawnSync(process.execPath, ['--test', ...args, command], { cwd: root, env, encoding: 'utf8' })
  }
  const governance = check('./governance.test.mjs', '--test-name-pattern=全部可执行生产源码')
  assert.equal(governance.status, 1, governance.stdout + governance.stderr)
  assert.match(governance.stdout, /livePerformanceCycles/)
  assert.equal(check('../vendor-neutral-contract.test.mjs').status, 0)
  git('add', '品牌.md')
  const branding = check('../vendor-neutral-contract.test.mjs')
  assert.equal(branding.status, 1, branding.stdout + branding.stderr)
  assert.match(branding.stdout, /品牌\.md/)
})

test('源码指纹可读取文件和目录互换的工作树', async t => {
  const { root, commit } = repository(t)
  const location = path.join(root, 'source')
  fs.mkdirSync(location)
  fs.writeFileSync(path.join(location, 'old.ts'), 'old')
  commit()
  fs.rmSync(location, { recursive: true })
  fs.writeFileSync(location, 'plain file')
  const replaced = await readGitProvenance(root)
  assert.equal(replaced.workingTreeDirty, true)
  commit()
  fs.unlinkSync(location)
  fs.mkdirSync(location)
  fs.writeFileSync(path.join(location, 'new.ts'), 'new')
  const directory = await readGitProvenance(root)
  fs.appendFileSync(path.join(location, 'new.ts'), ' edit')
  assert.notEqual((await readGitProvenance(root)).sourceIdentity, directory.sourceIdentity)
})

if (process.platform !== 'win32') {
  test('文件符号链接的目标路径及普通文件的执行位属于本地源码身份', async t => {
    const { root, commit } = repository(t)
    const a = path.join(root, 'a')
    fs.writeFileSync(a, 'identical')
    fs.writeFileSync(path.join(root, 'b'), 'identical')
    commit()
    const link = path.join(root, 'alias')
    fs.symlinkSync('a', link)
    const first = await readGitProvenance(root)
    fs.unlinkSync(link)
    fs.symlinkSync('b', link)
    const second = await readGitProvenance(root)
    assert.notEqual(first.sourceIdentity, second.sourceIdentity)
    fs.chmodSync(a, 0o755)
    assert.notEqual(second.sourceIdentity, (await readGitProvenance(root)).sourceIdentity)
  })
}

test('跟踪目录被目录链接替换时只识别该链接，原目录下的文件已经移除', async t => {
  const { root, area, commit } = repository(t)
  const source = path.join(root, 'nested')
  fs.mkdirSync(source)
  fs.writeFileSync(path.join(source, 'record.ts'), 'tracked')
  commit()
  const external = path.join(area, 'separate')
  fs.mkdirSync(external)
  const target = path.join(external, 'record.ts')
  fs.writeFileSync(target, 'outside')
  fs.rmSync(source, { recursive: true })
  // Windows 的目录联接无需创建文件符号链接的权限。
  fs.symlinkSync(external, source, 'junction')
  const trackedRecord = [...repositoryEntries(root, { trackedOnly: true })]
    .find(entry => entry.name === 'nested/record.ts')
  assert.equal(trackedRecord?.isFile, false)
  const linked = await readGitProvenance(root)
  fs.appendFileSync(target, 'other changes')
  assert.deepEqual(await readGitProvenance(root), linked)
})
