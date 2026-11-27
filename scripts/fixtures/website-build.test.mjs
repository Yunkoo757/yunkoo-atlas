import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { moduleReferences, websiteDependencyGraph } from '../governance-imports.mjs'
import { execFileSync, spawnSync } from 'node:child_process'

const root = process.cwd()

function sourceFixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-website-build-'))
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }))
  // Includes pending deliverable files, but never files hidden by a developer's local exclude rules.
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', 'atlas-website', 'atlas-docs-site'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  for (const file of new Set(files)) {
    const source = path.join(root, file)
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue
    const target = path.join(temporary, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(source, target)
  }
  return { temporary, files, output: path.join(temporary, 'atlas-website/dist'), run: () => spawnSync(process.execPath, [path.join(temporary, 'atlas-website/build.mjs')], { cwd: temporary, encoding: 'utf8' }) }
}

function localAsset(output, referring, reference) {
  if (!reference || /^(?:#|data:|https?:|mailto:|tel:|javascript:)/i.test(reference)) return
  const clean = reference.split(/[?#]/, 1)[0]
  const target = reference.startsWith('/') ? path.join(output, clean) : path.resolve(path.dirname(referring), clean)
  const relative = path.relative(output, target)
  assert(!relative.startsWith('..') && !path.isAbsolute(relative), `Resource escapes built website: ${reference}`)
  const file = fs.existsSync(target) && fs.statSync(target).isDirectory() ? path.join(target, 'index.html') : target
  assert(fs.existsSync(file), `Missing built resource in ${path.relative(output, referring)}: ${reference}`)
}

function inspectResources(output, directory = output) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) { inspectResources(output, file); continue }
    if (!/\.(?:html|css|js)$/.test(file)) continue
    const source = fs.readFileSync(file, 'utf8')
    if (file.endsWith('.html')) for (const match of source.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) localAsset(output, file, match[1])
    if (file.endsWith('.css')) for (const match of source.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) localAsset(output, file, match[1])
    if (file.endsWith('.js')) {
      const { eager, lazy } = moduleReferences(source, file)
      for (const reference of [...eager, ...lazy]) localAsset(output, file, reference)
    }
  }
}

test('standalone website builds from deliverable source without retired module routes', (t) => {
  const fixture = sourceFixture(t)
  const result = fixture.run()
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  inspectResources(fixture.output)
  assert(!fs.existsSync(path.join(fixture.output, 'guide/composer')), 'Retired composer must not ship')
  for (const file of ['index.html', 'app.js', 'guide/app.js', 'guide/content.js']) {
    assert(!fs.readFileSync(path.join(fixture.output, file), 'utf8').includes('/guide/composer/'), `Retired route remains in ${file}`)
  }
})

test('a missing required website source fails before deleting the previous built site', (t) => {
  const fixture = sourceFixture(t)
  fs.mkdirSync(fixture.output, { recursive: true })
  const sentinel = path.join(fixture.output, 'previous-build.txt')
  fs.writeFileSync(sentinel, 'existing complete build')
  fs.rmSync(path.join(fixture.temporary, 'atlas-docs-site/content.js'), { force: true })
  const result = fixture.run()
  assert.notEqual(result.status, 0, 'Missing required guide source must fail')
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'existing complete build', 'Input validation must precede output deletion')
})

test('官网缺少延迟加载的 Three.js 内核时保留既有构建', (t) => {
  const fixture = sourceFixture(t)
  fs.mkdirSync(fixture.output, { recursive: true })
  const marker = path.join(fixture.output, 'previous.txt')
  fs.writeFileSync(marker, 'previous')
  fs.unlinkSync(path.join(fixture.temporary, 'atlas-website/vendor/three.core.js'))
  assert.notEqual(fixture.run().status, 0)
  assert.equal(fs.readFileSync(marker, 'utf8'), 'previous')
})

test('官网模块按发布 URL 解析指南与延迟引用，拒绝仅源码可见的路径', (t) => {
  const fixture = sourceFixture(t)
  const entry = path.join(fixture.temporary, 'atlas-website/app.js')
  fs.appendFileSync(entry, "\nexport const loader = () => import('/guide/icons.js?v=x#section');")
  const graph = websiteDependencyGraph(fixture.temporary, fixture.files)
  assert.deepEqual(graph['atlas-website/app.js'].eager, ['atlas-docs-site/icons.js', 'atlas-website/fluid-loader.js'])
  assert.deepEqual(graph['atlas-website/app.js'].lazy, ['atlas-docs-site/icons.js'])
  assert.deepEqual(graph['atlas-website/fluid-loader.js'].lazy, ['atlas-website/vendor/liquid-ether.js'])
  assert.deepEqual(graph['atlas-website/vendor/three.module.js'].eager, ['atlas-website/vendor/three.core.js'])
  fs.writeFileSync(path.join(fixture.temporary, 'atlas-docs-site/source-only.js'), 'export const value = 1;')
  fs.appendFileSync(entry, "\nimport '/guide/source-only.js';")
  assert.throws(() => websiteDependencyGraph(fixture.temporary, fixture.files), /官网模块未发布.*source-only/)
})
