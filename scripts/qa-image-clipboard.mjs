import { build } from 'vite'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const root = path.resolve('test-results/image-clipboard')
await fs.mkdir(root, { recursive: true })
await build({ configFile: false, logLevel: 'error', build: { ssr: 'electron/imageContextMenu.ts', outDir: path.join(root, 'module'), rollupOptions: { external: ['electron'], output: { entryFileNames: 'menu.mjs' } } } })
const runner = `const {app,BrowserWindow,ipcMain,dialog,clipboard,nativeImage}=require('electron');
const assert=require('node:assert/strict');const fs=require('node:fs');
app.setPath('userData',${JSON.stringify(path.join(root,'profile'))});
app.whenReady().then(async()=>{
 const saved=clipboard.availableFormats().map(format=>[format,clipboard.readBuffer(format)]);
 const originalHandle=ipcMain.handle,originalDialog=dialog.showSaveDialog;
 let win;
 try {
  const {registerImageContextMenu}=await import('./module/menu.mjs');
  win=new BrowserWindow({show:false});
  let handler;
  ipcMain.handle=(channel,fn)=>{handler=fn};
  registerImageContextMenu(win);
  const bytes=nativeImage.createFromBitmap(Buffer.alloc(32*24*4,255),{width:32,height:24}).toPNG();
  await handler({sender:win.webContents},'copy',new Uint8Array(bytes));
  assert.deepEqual(clipboard.readImage().getSize(),{width:32,height:24});
  const output=${JSON.stringify(path.join(root,'saved.png'))};
  dialog.showSaveDialog=async()=>({canceled:false,filePath:output});
  assert.equal(await handler({sender:win.webContents},'save',new Uint8Array(bytes)),true);
  assert.deepEqual(fs.readFileSync(output),bytes);
  dialog.showSaveDialog=async()=>({canceled:true});
  assert.equal(await handler({sender:win.webContents},'save',new Uint8Array(bytes)),false);
  await assert.rejects(()=>handler({sender:null},'copy',new Uint8Array(bytes)));
  await assert.rejects(()=>handler({sender:win.webContents},'copy',new Uint8Array([1])));
  console.log('PASS native clipboard, PNG save, cancellation, invalid sender and malformed input');
 } finally {
  ipcMain.handle=originalHandle;dialog.showSaveDialog=originalDialog;
  clipboard.clear();for(const [format,buffer] of saved)clipboard.writeBuffer(format,buffer);
  win?.destroy();
 }
}).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1)});`
await fs.writeFile(path.join(root, 'runner.cjs'), runner, 'utf8')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(createRequire(import.meta.url)('electron'), [path.join(root, 'runner.cjs')], {env,stdio:'inherit',windowsHide:true})
process.exitCode = await new Promise((resolve, reject) => {child.on('error',reject);child.on('exit',code=>resolve(code??1))})
