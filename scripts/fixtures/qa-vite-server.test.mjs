import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { startQaServer } from '../qa-vite-server.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atlas-qa-vite-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

async function serveDependency(root, name) {
  const dependency = path.join(root, 'node_modules', name)
  await mkdir(dependency, { recursive: true })
  await writeFile(path.join(dependency, 'package.json'), JSON.stringify({ name, main: 'index.cjs' }))
  await writeFile(path.join(dependency, 'index.cjs'), `module.exports = 'QA_MARKER_${name}'`)
  await writeFile(path.join(root, `${name}.js`), `import value from '${name}'; export { value }`)
  const configFile = path.join(root, `${name}.config.mjs`)
  const receipt = JSON.stringify(path.join(root, name + '.closed'))
  await writeFile(configFile, `
    import { writeFileSync } from 'node:fs'
    export default {
      optimizeDeps: { noDiscovery: true, include: ['${name}'] },
      plugins: [{
        name: 'record-listener-close',
        configureServer({ httpServer }) {
          httpServer.once('close', () => writeFileSync(${receipt}, 'closed'))
        },
      }],
    }
  `)
  return startQaServer({ root, configFile, restrictToRoot: true })
}

async function dependencyUrl(server, name) {
  const source = await fetch(new URL(name + '.js', server.baseUrl))
  assert.equal(source.status, 200)
  const match = (await source.text()).match(/from\s*["']([^"']+)["']/)
  assert.ok(match, 'Vite 应返回已解析的模块地址')
  return new URL(match[1], server.baseUrl)
}

async function verifyDependency(url, name) {
  const asset = await fetch(url)
  assert.equal(asset.status, 200, url.href)
  assert.ok((await asset.text()).includes('QA_MARKER_' + name))
}

test('同一工作树的两台验收服务分别持有端口与依赖字节，关闭一台仍可读取另一台原有的资源', async t => {
  const root = await fixture(t)
  const first = await serveDependency(root, 'qa-first')
  try {
    const original = await dependencyUrl(first, 'qa-first')
    await verifyDependency(original, 'qa-first')
    const second = await serveDependency(root, 'qa-second')
    try {
      assert.notEqual(first.baseUrl, second.baseUrl)
      assert.equal((await readdir(path.join(root, 'test-results'))).length, 2)
      await verifyDependency(await dependencyUrl(second, 'qa-second'), 'qa-second')
      await verifyDependency(original, 'qa-first')
    } finally {
      await second.close()
    }
    assert.equal(await readFile(path.join(root, 'qa-second.closed'), 'utf8'), 'closed')
    assert.equal((await readdir(path.join(root, 'test-results'))).length, 1)
    await verifyDependency(original, 'qa-first')
  } finally {
    await first.close()
  }
  assert.equal(await readFile(path.join(root, 'qa-first.closed'), 'utf8'), 'closed')
  assert.deepEqual(await readdir(path.join(root, 'test-results')), [])
})

test('一次验收只服务启动配置，配置被更新后仍能关闭自己的监听器', async t => {
  const root = await fixture(t)
  const configFile = path.join(root, 'settings.mjs')
  const closed = path.join(root, 'closed')
  const config = version => `
    import { writeFileSync } from 'node:fs'
    export default {
      plugins: [{
        name: 'qa-listener-identity',
        configureServer(server) {
          server.httpServer.once('close', () => writeFileSync(${JSON.stringify(closed)}, '${version}'))
          server.middlewares.use('/identity', (_, res) => res.end(JSON.stringify({
            version: '${version}', watching: server.config.server.watch !== null, hmr: server.config.server.hmr !== false,
          })))
        },
      }],
    }
  `
  await writeFile(configFile, config('original'))
  const server = await startQaServer({ root, configFile })
  const state = async () => (await fetch(new URL('identity', server.baseUrl))).json()
  try {
    assert.deepEqual(await state(), { version: 'original', watching: false, hmr: false })
    await writeFile(configFile, config('edited'))
    assert.equal((await state()).version, 'original')
  } finally { await server.close() }
  assert.equal(await readFile(closed, 'utf8'), 'original')
  assert.deepEqual(await readdir(path.join(root, 'test-results')), [])
})

test('配置加载失败后删除本次缓存并保留已有输出', async t => {
  const root = await fixture(t)
  const out = path.join(root, 'test-results')
  await mkdir(out)
  await writeFile(path.join(out, 'other-run'), 'keep')
  const configFile = path.join(root, 'failed.config.mjs')
  await writeFile(configFile, "throw new Error('fixture-config-error')")
  await assert.rejects(startQaServer({ root, configFile }), /fixture-config-error/)
  assert.deepEqual(await readdir(out), ['other-run'])
})
