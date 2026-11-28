import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { runtimeDependencyGraph, reachableModuleGraph, findRuntimeCycles, firstForbiddenPath, importsTarget } from '../governance-imports.mjs'

test('依赖门按 TypeScript 语法识别导入，忽略注释和字符串', () => {
  const importer = 'src/lib/check.ts'
  const target = 'src/store/useStore'
  assert.equal(importsTarget("// import x from '@/store/useStore'", importer, target), false)
  assert.equal(importsTarget("const example = \"import '@/store/useStore'\"", importer, target), false)
  assert.equal(importsTarget("type S = import('../store/useStore').State", importer, target), true)
  assert.equal(importsTarget("const load = () => import( /* lazy */ `@/store/useStore` )", importer, target), true)
})

test('运行时依赖图保留真实模块边并报告同步与延迟引用形成的环', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-dependencies-'))
  try {
    fs.copyFileSync('tsconfig.json', path.join(root, 'tsconfig.json'))
    const entries = {
      'src/start.ts': "import type { T } from './types'; export type X = T; export * from '@/folder';",
      'src/folder/index.ts': "export * from '../start.js'; export const later = () => import('../lazy');",
      'src/lazy.ts': "import './start';",
      'src/types.ts': "export type T = string;",
      'electron/self.ts': "import './self';",
      'tools/editor.ts': "export const later = () => import('../shared/middle');",
      'shared/middle.ts': "export { state } from '@/store/session';",
      'src/store/session.ts': "export const state = 1;",
      'trainer/main.cjs': "const model = require('./model.cjs');",
      'trainer/model.cjs': "module.exports = {};",
      'trainer/unreferenced.js': "require('./model.cjs');",
    }
    const sources = Object.entries(entries).map(([file, source]) => ({ path: file, source }))
    for (const file of sources) {
      const absolute = path.join(root, file.path)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, file.source)
    }
    const graph = runtimeDependencyGraph(Object.keys(entries), root, ['src/start.ts', 'electron/self.ts', 'tools/editor.ts', 'trainer/main.cjs'])
    assert.deepEqual(graph['trainer/main.cjs'].eager, ['trainer/model.cjs'])
    assert.equal(graph['trainer/unreferenced.js'], undefined)
    const editor = reachableModuleGraph(graph, ['tools/editor.ts'])
    assert.deepEqual(Object.keys(editor).sort(), ['shared/middle.ts', 'src/store/session.ts', 'tools/editor.ts'])
    assert.deepEqual(findRuntimeCycles(editor), [])
    const desktop = reachableModuleGraph(graph, ['src/start.ts', 'electron/self.ts'])
    assert.deepEqual(Object.keys(desktop).sort(), ['electron/self.ts', 'src/folder/index.ts', 'src/lazy.ts', 'src/start.ts'])
    assert.deepEqual(findRuntimeCycles(desktop), findRuntimeCycles(graph))
    assert.throws(() => reachableModuleGraph({ 'tools/editor.ts': graph['tools/editor.ts'] }, ['tools/editor.ts']), /shared\/middle\.ts/)
    assert.deepEqual(firstForbiddenPath(graph, 'tools/editor.ts', ['src/store']), [
      'tools/editor.ts', 'shared/middle.ts', 'src/store/session.ts',
    ])
    assert.deepEqual(graph['src/start.ts'], { eager: ['src/folder/index.ts'], lazy: [] })
    assert.deepEqual(graph['src/folder/index.ts'], { eager: ['src/start.ts'], lazy: ['src/lazy.ts'] })
    assert.deepEqual(firstForbiddenPath(graph, 'src/start.ts', ['src/lazy']), [
      'src/start.ts', 'src/folder/index.ts', 'src/lazy.ts',
    ])
    assert.equal(firstForbiddenPath(graph, 'src/start.ts', ['src/types']), null)
    assert.deepEqual(findRuntimeCycles(graph), [
      ['src/start.ts', 'src/folder/index.ts', 'src/start.ts'],
      ['src/start.ts', 'src/folder/index.ts', 'src/lazy.ts', 'src/start.ts'],
      ['electron/self.ts', 'electron/self.ts'],
    ])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('运行时解析区分可执行源码、类型声明与资源，并报告未解析的本地代码', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-module-resolution-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.copyFileSync('tsconfig.json', path.join(root, 'tsconfig.json'))
  const files = {
    'main.cjs': "require('./paired.js'); require('node:fs')",
    'paired.js': 'exports.value = 1',
    'paired.ts': 'export const value = 2',
    'view.ts': "import './style.css'; export * from './dep.js'; export const later = () => import('./later.mjs')",
    'dep.js': 'export const value = 1',
    'dep.d.ts': 'export declare const value: number',
    'later.d.mts': 'export {}',
    'later.mjs': 'export {}',
    'broken.cjs': "require('./absent.cjs')",
    'broken.ts': "export const later = () => import('@/absent')",
    'declared.ts': "import './typesOnly.js'",
    'typesOnly.d.ts': 'export {}',
    'style.css': 'body {}',
  }
  for (const [file, source] of Object.entries(files)) fs.writeFileSync(path.join(root, file), source)
  const from = entry => runtimeDependencyGraph(Object.keys(files), root, [entry])
  assert.deepEqual(from('main.cjs')['main.cjs'], { eager: ['paired.js'], lazy: [] })
  assert.deepEqual(from('view.ts')['view.ts'], { eager: ['dep.js'], lazy: ['later.mjs'] })
  assert.throws(() => from('broken.cjs'), /broken\.cjs.*\.\/absent\.cjs/)
  assert.throws(() => from('broken.ts'), /broken\.ts.*@\/absent/)
  assert.throws(() => from('declared.ts'), /declared\.ts.*typesOnly\.js/)
})
