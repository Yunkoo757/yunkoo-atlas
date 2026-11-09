import { build } from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const root = path.resolve('test-results/case-clipboard-files/native')
await fs.mkdir(root, { recursive: true })
for (const [entry, directory, name] of [
  ['electron/caseClipboard.ts', 'module', 'clipboard.mjs'],
  ['electron/fileClipboard.ts', 'driver', 'files.mjs'],
]) {
  await build({ configFile: false, logLevel: 'error', build: {
    ssr: entry, outDir: path.join(root, directory),
    rolldownOptions: { external: ['electron'], output: { entryFileNames: name } },
  } })
}

async function nativeChecks(root) {
  const { app, BrowserWindow, ipcMain, clipboard, nativeImage } = require('electron')
  const assert = require('node:assert/strict')
  const fs = require('node:fs/promises')
  const path = require('node:path')
  const { createHash } = require('node:crypto')
  const { promisify } = require('node:util')
  const exec = promisify(require('node:child_process').execFile)
  app.setPath('userData', path.join(root, 'profile'))
  await app.whenReady()
  const { writeFileClipboard } = await import('./driver/files.mjs')
  const readPaths = async () => {
    if (process.platform !== 'darwin') return []
    const script = `ObjC.import('AppKit'); function run(){var items=$.NSPasteboard.generalPasteboard.pasteboardItems;var paths=[];for(var i=0;i<Number(items.count);i++){var value=ObjC.unwrap(items.objectAtIndex(i).stringForType($.NSPasteboardTypeFileURL));if(value)paths.push(ObjC.unwrap($.NSURL.URLWithString($(value)).path))}return JSON.stringify(paths)}`
    return JSON.parse((await exec('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script])).stdout)
  }
  const savedPaths = await readPaths()
  const saved = { text: clipboard.readText(), html: clipboard.readHTML(), rtf: clipboard.readRTF(), image: clipboard.readImage() }
  const originalHandle = ipcMain.handle
  let owner, receiver
  try {
    const { registerCaseClipboard } = await import('./module/clipboard.mjs')
    owner = new BrowserWindow({ show: false })
    let handler
    ipcMain.handle = (channel, fn) => { if (channel === 'case:copy-content') handler = fn }
    registerCaseClipboard(owner)
    ipcMain.handle = originalHandle
    const event = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame }
    clipboard.writeText('复制失败必须保留原剪贴板')
    assert.equal((await handler({ sender: null }, {})).ok, false)
    assert.equal((await handler(event, { html: 1, text: 'invalid', images: [] })).ok, false)
    assert.equal(clipboard.readText(), '复制失败必须保留原剪贴板')
    const charts = [[36, 72, 180], [180, 80, 36], [55, 160, 70]].map(([r, g, b]) => {
      return nativeImage.createFromBitmap(Buffer.alloc(1600 * 650 * 4).fill(Buffer.from([b, g, r, 255])), { width: 1600, height: 650 }).toPNG()
    })
    const text = 'ETHUSDT · 复盘案例\n\n2026-07-26 · 做空 · 4H\n\n来源复盘\n中文正文 📈\n原图保持独立。'
    const content = { html: '<h1>ETHUSDT · 复盘案例</h1><p>中文正文 📈</p>', text, images: charts.map(bytes => ({ mime: 'image/png', data: bytes.toString('base64') })) }
    const pending = handler(event, content)
    assert.equal((await handler(event, content)).ok, false, '复制期间必须拒绝并发替换')
    assert.deepEqual(await pending, { ok: true })
    const processExitItemCounts = []
    // 必须在系统辅助进程退出后由另一个进程核对，捕获最后一个附件被延迟提供而丢失的问题。
    if (process.platform === 'darwin') {
      processExitItemCounts.push((await readPaths()).length)
      for (let repeat = 0; repeat < 2; repeat++) {
        assert.deepEqual(await handler(event, content), { ok: true })
        processExitItemCounts.push((await readPaths()).length)
      }
      assert.deepEqual(processExitItemCounts, [4, 4, 4])
    }
    const files = await readPaths()
    if (process.platform === 'darwin') {
      assert.equal(files.length, 4, JSON.stringify(files))
      const textBytes = await fs.readFile(files[0])
      assert.equal(textBytes.toString('utf8'), text)
      assert.notEqual(textBytes.subarray(0, 3).toString('hex'), 'efbbbf')
      for (let i = 0; i < 3; i++) assert.deepEqual(await fs.readFile(files[i + 1]), charts[i], '每张图必须保持原始字节')
    }
    assert.equal(BrowserWindow.getAllWindows().length, 1, '复制不应创建图片合成窗口')
    receiver = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    await receiver.loadURL('data:text/html,<div contenteditable="true" id="paste">paste</div>')
    await receiver.webContents.executeJavaScript(`
      window.pasted=null;
      document.addEventListener('paste',async event=>{
        event.preventDefault();
        const types=[...event.clipboardData.types];
        const files=[...event.clipboardData.files];
        const entries=await Promise.all(files.map(async file=>{
          const bytes=[...new Uint8Array(await file.arrayBuffer())];
          const entry={name:file.name,type:file.type,size:file.size,bytes};
          if(file.type.startsWith('image/')){
            const bitmap=await createImageBitmap(file);entry.width=bitmap.width;entry.height=bitmap.height;bitmap.close();
          }else{entry.text=await file.text()}
          return entry;
        }));
        window.pasted={types,entries};
      });document.getElementById('paste').focus();
    `)
    receiver.webContents.paste()
    const pasted = await receiver.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+5000;function check(){if(window.pasted)resolve(window.pasted);else if(Date.now()>end)reject(Error('paste timeout'));else setTimeout(check,20)}check()})`)
    assert.deepEqual(pasted.types, ['Files'])
    assert.equal(pasted.entries.length, 4, '一次粘贴必须收到正文 TXT 和三张独立原图')
    assert.equal(pasted.entries[0].type, 'text/plain')
    assert.equal(pasted.entries[0].text, text)
    for (let i = 0; i < 3; i++) {
      const image = pasted.entries[i + 1]
      assert.equal(image.type, 'image/png')
      assert.deepEqual({ width: image.width, height: image.height }, { width: 1600, height: 650 })
      assert.deepEqual(Buffer.from(image.bytes), charts[i], '接收端读取的文件也必须与原图完全一致')
    }
    for (const entry of pasted.entries) { entry.sha256 = createHash('sha256').update(Buffer.from(entry.bytes)).digest('hex'); delete entry.bytes }
    assert.equal((await handler(event, { ...content, images: [{ mime: 'image/jpeg', data: charts[0].toString('base64') }] })).ok, false)
    if (process.platform === 'darwin') assert.deepEqual(await readPaths(), files, '失败不得改变当前文件剪贴板')
    assert.deepEqual(await handler(event, { html: '<p>纯文字</p>', text: '纯文字 📈', images: [] }), { ok: true })
    assert.equal(clipboard.readText(), '纯文字 📈')
    if (process.platform === 'darwin') {
      assert.deepEqual(await readPaths(), [], '纯文字不能残留上一组附件')
      for (const file of files) await fs.access(file)
    }
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify({ platform: process.platform, result: 'passed', paste: pasted, filePaths: files, processExitItemCounts, originalsUnchanged: true }, null, 2), 'utf8')
    console.log('PASS one paste receives UTF-8 TXT + 3 separate original images, byte equality, dimensions, concurrency, failure preservation and retained file lifetime')
  } finally {
    ipcMain.handle = originalHandle
    if (savedPaths.length) await writeFileClipboard(savedPaths).catch(() => clipboard.write(saved))
    else clipboard.write(saved)
    receiver?.destroy(); owner?.destroy()
  }
  app.exit(0)
}

await fs.writeFile(path.join(root, 'runner.cjs'), `(${nativeChecks.toString()})(${JSON.stringify(root)}).catch(error=>{console.error(error);require('electron').app.exit(1)})`, 'utf8')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(createRequire(import.meta.url)('electron'), [path.join(root, 'runner.cjs')], { env, stdio: 'inherit', windowsHide: true })
process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)) })
