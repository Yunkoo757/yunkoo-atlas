import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'vite'
import initSqlJs from 'sql.js'
import { chromium } from 'playwright'

const project = process.cwd()

test('offline editor ignores late previews and revokes object URLs when selection changes', { timeout: 60_000 }, async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'atlas-editor-preview-test-'))
  let browser
  try {
    const seedEntry = path.join(output, 'seed.ts')
    await writeFile(seedEntry, `export { createElectronQaSeedSnapshot } from ${JSON.stringify(path.join(project, 'electron/qaSeed.ts'))};\nexport { SCHEMA_VERSION } from ${JSON.stringify(path.join(project, 'src/storage/types.ts'))};\n`, 'utf8')
    const seedOutput = path.join(output, 'seed')
    await build({ configFile: false, logLevel: 'error', resolve: { alias: { '@': path.join(project, 'src') } }, build: { ssr: seedEntry, outDir: seedOutput, rolldownOptions: { output: { entryFileNames: 'seed.mjs' } } } })
    const { createElectronQaSeedSnapshot, SCHEMA_VERSION } = await import(pathToFileURL(path.join(seedOutput, 'seed.mjs')).href)
    const snapshot = createElectronQaSeedSnapshot()
    snapshot.trades = ['A', 'B'].map(label => ({ ...snapshot.trades[0], id: `preview-${label}`, ref: `TRD-${label}`, note: `<p>Preview ${label}</p><img src="journal-asset://asset-${label.toLowerCase()}">` }))
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64')
    let files
    try {
      db.run('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE assets(id TEXT PRIMARY KEY,mime TEXT,file_name TEXT,byte_size INTEGER,created_at TEXT);')
      db.run('INSERT INTO meta VALUES (?,?)', ['snapshot', JSON.stringify(snapshot)])
      db.run('INSERT INTO meta VALUES (?,?)', ['schemaVersion', String(SCHEMA_VERSION)])
      for (const id of ['asset-a', 'asset-b']) db.run('INSERT INTO assets VALUES (?,?,?,?,?)', [id, 'image/png', `${id}.png`, png.length, '2026-01-01T00:00:00.000Z'])
      files = { 'journal.db': [...db.export()], 'manifest.json': [...Buffer.from(JSON.stringify({ schemaVersion: SCHEMA_VERSION }))], 'attachments/asset-a.png': [...png], 'attachments/asset-b.png': [...png] }
    } finally { db.close() }
    const editorOutput = path.join(output, 'editor')
    await mkdir(editorOutput)
    await build({ configFile: false, logLevel: 'error', resolve: { alias: { '@': path.join(project, 'src') } }, define: { 'process.env.NODE_ENV': '"production"' }, build: { outDir: editorOutput, lib: { entry: path.join(project, 'tools/atlas-data-editor/app.ts'), name: 'AtlasDataEditor', formats: ['iife'], fileName: () => 'editor.js' } } })
    for (const name of ['index.html', 'editor.css']) await copyFile(path.join(project, 'tools/atlas-data-editor', name), path.join(editorOutput, name))
    await copyFile(path.join(project, 'src/styles/tokens.css'), path.join(editorOutput, 'tokens.css'))
    await copyFile(path.join(project, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'), path.join(editorOutput, 'inter.woff2'))
    await copyFile(path.join(project, 'node_modules/sql.js/dist/sql-wasm.js'), path.join(editorOutput, 'sqlite.js'))
    const wasm = await readFile(path.join(project, 'node_modules/sql.js/dist/sql-wasm.wasm'))
    await writeFile(path.join(editorOutput, 'sqlite-bytes.js'), `window.ATLAS_SQLITE_BYTES=${JSON.stringify(wasm.toString('base64'))};`, 'utf8')
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(({ files }) => {
      const bytes = new Map(Object.entries(files).map(([key, value]) => [key, new Uint8Array(value)]))
      window.previewProbe = { delayed: '', pending: 0, waiters: new Map(), created: [], revoked: [] }
      const originalCreate = URL.createObjectURL.bind(URL), originalRevoke = URL.revokeObjectURL.bind(URL)
      URL.createObjectURL = file => { const url = originalCreate(file); window.previewProbe.created.push({ url, name: file.name }); return url }
      URL.revokeObjectURL = url => { window.previewProbe.revoked.push(url); originalRevoke(url) }
      const directory = (prefix = '') => ({ name: '隔离测试资料库', async getDirectoryHandle(name) { return directory(`${prefix}${name}/`) }, async getFileHandle(name, options = {}) {
        if (options.create) throw new Error('Source writes are forbidden')
        const key = `${prefix}${name}`
        if (!bytes.has(key)) throw new Error(`Missing ${key}`)
        return { async getFile() {
          if (window.previewProbe.delayed === name) {
            window.previewProbe.pending++
            await new Promise(resolve => window.previewProbe.waiters.set(name, resolve))
            window.previewProbe.pending--
          }
          return new File([bytes.get(key)], name)
        } }
      } })
      window.showDirectoryPicker = async () => directory()
    }, { files })
    await page.goto(pathToFileURL(path.join(editorOutput, 'index.html')).href)
    await page.locator('#open').click()
    await page.waitForFunction(() => document.querySelector('#source').textContent.includes('隔离测试资料库'))
    const a = page.locator('tbody tr').filter({ hasText: 'TRD-A' })
    const b = page.locator('tbody tr').filter({ hasText: 'TRD-B' })

    // A resolves after B has already become the active inspector.
    await page.evaluate(() => { window.previewProbe.delayed = 'asset-a.png' })
    await a.click()
    await page.waitForFunction(() => window.previewProbe.waiters.has('asset-a.png'))
    await b.click()
    await page.waitForFunction(() => document.querySelectorAll('.inspector .preview img').length === 1)
    await page.evaluate(() => { window.previewProbe.delayed = ''; window.previewProbe.waiters.get('asset-a.png')(); window.previewProbe.waiters.clear() })
    await page.waitForFunction(() => window.previewProbe.pending === 0)
    await page.waitForTimeout(50)
    assert.equal(await page.locator('.inspector h2').innerText(), 'TRD-B · BTC')
    assert.equal(await page.locator('.inspector details').count(), 1, 'late A preview must not be attached under B')
    assert.equal(await page.locator('.inspector .preview').textContent(), 'Preview B')
    assert.deepEqual(await page.evaluate(() => window.previewProbe.created.map(item => item.name)), ['asset-b.png'], 'superseded work must not create an orphan object URL')

    // Completing another inspector replaces and releases the previous preview.
    const bUrl = await page.evaluate(() => window.previewProbe.created.at(-1).url)
    await a.click()
    await page.waitForFunction(() => document.querySelector('.inspector .preview')?.textContent === 'Preview A')
    assert.ok(await page.evaluate(url => window.previewProbe.revoked.includes(url), bUrl), 'selection change must revoke the previous URL')
    const aUrl = await page.evaluate(() => window.previewProbe.created.at(-1).url)

    // Category navigation invalidates a pending asset-row preview too.
    await page.locator('#nav button').filter({ hasText: /^附件/ }).click()
    assert.ok(await page.evaluate(url => window.previewProbe.revoked.includes(url), aUrl))
    await page.evaluate(() => { window.previewProbe.delayed = 'asset-a.png' })
    await page.locator('tbody tr').filter({ hasText: 'asset-a' }).click()
    await page.waitForFunction(() => window.previewProbe.waiters.has('asset-a.png'))
    const createdBefore = await page.evaluate(() => window.previewProbe.created.length)
    await page.locator('#nav button').filter({ hasText: /^策略/ }).click()
    await page.evaluate(() => { window.previewProbe.delayed = ''; window.previewProbe.waiters.get('asset-a.png')(); window.previewProbe.waiters.clear() })
    await page.waitForFunction(() => window.previewProbe.pending === 0)
    await page.waitForTimeout(50)
    assert.equal(await page.locator('.inspector img').count(), 0)
    assert.equal(await page.evaluate(() => window.previewProbe.created.length), createdBefore)
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await rm(output, { recursive: true, force: true })
  }
})
