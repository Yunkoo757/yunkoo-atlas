import { app, clipboard, ipcMain, type BrowserWindow } from 'electron'
import path from 'node:path'
import { cleanupCaseClipboardFiles, prepareCaseClipboardFiles, validateCaseClipboardContent } from './caseClipboardFiles'
import { writeFileClipboard } from './fileClipboard'
import type { CaseClipboardResult } from '../src/lib/caseClipboardContract'

export function registerCaseClipboard(owner: BrowserWindow): void {
  let busy = false
  ipcMain.removeHandler('case:copy-content')
  ipcMain.handle('case:copy-content', async (event, content: unknown): Promise<CaseClipboardResult> => {
    if (owner.isDestroyed() || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) return { ok: false, error: '复制窗口已失效，请重新打开案例后重试' }
    if (busy) return { ok: false, error: '图文正在复制，请稍后重试' }
    busy = true
    try {
      validateCaseClipboardContent(content)
      if (!content.images.length) {
        clipboard.write({ text: content.text, html: content.html })
        return { ok: true }
      }
      const root = path.join(app.getPath('userData'), 'clipboard-exports')
      const prepared = await prepareCaseClipboardFiles(content, root)
      if (owner.isDestroyed()) throw new Error('复制窗口已关闭，请重新打开案例后重试')
      // 文件已完整落地后，单次提交系统文件列表。正文 TXT 与每张原图各自独立。
      await writeFileClipboard(prepared.files)
      // 不能在进程退出或返回时删除文件：接收软件会在粘贴时读取这些原始文件。
      await cleanupCaseClipboardFiles(root, prepared.directory).catch(() => {})
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      return { ok: false, error: /^(图片|复盘|案例|文件|复制窗口|当前系统|无法调用|没有可复制)/.test(message) ? message : '图文文件复制失败，请重试' }
    } finally { busy = false }
  })
}
