import { clipboard, dialog, ipcMain, nativeImage, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'

/** Renderer owns the token-based menu; main process only handles desktop image output. */
export function registerImageContextMenu(window: BrowserWindow): void {
  ipcMain.removeHandler('image:output')
  ipcMain.handle('image:output', async (event, action: unknown, bytes: unknown) => {
    if (event.sender !== window.webContents || window.isDestroyed()) throw new Error('无效图片窗口')
    if (action !== 'copy' && action !== 'save') throw new Error('无效图片操作')
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 64 * 1024 * 1024) throw new Error('图片数据无效或过大')
    const buffer = Buffer.from(bytes)
    if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('图片格式无效')
    const image = nativeImage.createFromBuffer(buffer)
    if (image.isEmpty()) throw new Error('图片无法读取')
    if (action === 'copy') { clipboard.writeImage(image); return true }
    const result = await dialog.showSaveDialog(window, { title: '图片另存为', defaultPath: 'Atlas-截图.png', filters: [{ name: 'PNG 图片', extensions: ['png'] }] })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, buffer)
    return true
  })
}
