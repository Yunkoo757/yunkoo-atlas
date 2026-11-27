import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { desktopDependencyGraph, findEagerCycles, firstForbiddenPath, importsTarget } from '../governance-imports.mjs'

test('依赖门按 TypeScript 语法识别导入，忽略注释和字符串', () => {
  const importer = 'src/lib/check.ts'
  const target = 'src/store/useStore'
  assert.equal(importsTarget("// import x from '@/store/useStore'", importer, target), false)
  assert.equal(importsTarget("const example = \"import '@/store/useStore'\"", importer, target), false)
  assert.equal(importsTarget("type S = import('../store/useStore').State", importer, target), true)
  assert.equal(importsTarget("const load = () => import( /* lazy */ `@/store/useStore` )", importer, target), true)
})

test('运行时依赖图保留真实模块边并报告闭合的同步环', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-dependencies-'))
  try {
    fs.copyFileSync('tsconfig.json', path.join(root, 'tsconfig.json'))
    const entries = {
      'src/start.ts': "import type { T } from './types'; export type X = T; export * from '@/folder';",
      'src/folder/index.ts': "export * from '../start.js'; export const later = () => import('../lazy');",
      'src/lazy.ts': "import './start';",
      'src/types.ts': "export type T = string;",
      'electron/self.ts': "import './self';",
    }
    const sources = Object.entries(entries).map(([file, source]) => ({ path: file, source }))
    for (const file of sources) {
      const absolute = path.join(root, file.path)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, file.source)
    }
    const graph = desktopDependencyGraph(sources, root)
    assert.deepEqual(graph['src/start.ts'], { eager: ['src/folder/index.ts'], lazy: [] })
    assert.deepEqual(graph['src/folder/index.ts'], { eager: ['src/start.ts'], lazy: ['src/lazy.ts'] })
    assert.deepEqual(firstForbiddenPath(graph, 'src/start.ts', ['src/lazy']), [
      'src/start.ts', 'src/folder/index.ts', 'src/lazy.ts',
    ])
    assert.equal(firstForbiddenPath(graph, 'src/start.ts', ['src/types']), null)
    assert.deepEqual(findEagerCycles(graph), [
      ['src/start.ts', 'src/folder/index.ts', 'src/start.ts'],
      ['electron/self.ts', 'electron/self.ts'],
    ])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
