/**
 * 诊断脚本：检查 IndexedDB 数据持久化是否正常工作
 * 用法: node scripts/diag.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE_URL ?? 'http://127.0.0.1:3000'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()

// 收集控制台日志
const logs = []
page.on('console', (msg) => {
  if (msg.type() === 'error') logs.push(`[ERROR] ${msg.text()}`)
  else logs.push(`[${msg.type()}] ${msg.text()}`)
})

try {
  // 1. 导航到列表页
  console.log('=== 步骤 1: 导航到列表 ===')
  await page.goto(`${BASE}/list`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)

  // 2. 检查 IndexedDB 数据库
  console.log('\n=== 步骤 2: 检查 IndexedDB ===')
  const dbInfo = await page.evaluate(async () => {
    const dbs = await indexedDB.databases?.()
    return dbs
  })
  console.log('数据库列表:', JSON.stringify(dbInfo, null, 2))

  // 3. 打开 linear-journal-v3 检查内容
  const idbContents = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const req = indexedDB.open('linear-journal-v3')
      req.onsuccess = () => {
        const db = req.result
        const result = {}

        // 检查 snapshot
        try {
          const tx = db.transaction('snapshot', 'readonly')
          const getReq = tx.objectStore('snapshot').get('main')
          getReq.onsuccess = () => {
            const snap = getReq.result
            if (snap) {
              result.snapshotExists = true
              result.tradeCount = snap.trades?.length ?? 0
              // 列出每个交易的 note 摘要
              result.trades = snap.trades?.map(t => ({
                id: t.id,
                noteLen: t.note?.length ?? 0,
                notePreview: (t.note ?? '').substring(0, 80),
                hasJournalAsset: (t.note ?? '').includes('journal-asset://'),
                hasBlob: (t.note ?? '').includes('blob:'),
              }))
            } else {
              result.snapshotExists = false
            }

            // 检查 assets
            try {
              const atx = db.transaction('assets', 'readonly')
              const countReq = atx.objectStore('assets').count()
              countReq.onsuccess = () => {
                result.assetCount = countReq.result
                db.close()
                resolve(result)
              }
            } catch (e) {
              result.assetError = String(e)
              db.close()
              resolve(result)
            }
          }
          getReq.onerror = () => { result.snapshotError = String(getReq.error); db.close(); resolve(result) }
        } catch (e) {
          result.snapshotError = String(e)
          db.close()
          resolve(result)
        }
      }
      req.onerror = () => resolve({ openError: String(req.error) })
    })
  })

  console.log('\nIndexedDB 内容:')
  console.log(`  快照存在: ${idbContents.snapshotExists}`)
  console.log(`  交易数量: ${idbContents.tradeCount}`)
  console.log(`  资产数量: ${idbContents.assetCount}`)
  if (idbContents.trades) {
    for (const t of idbContents.trades) {
      console.log(`  Trade ${t.id}: note=${t.noteLen}chars, journalAsset=${t.hasJournalAsset}, blob=${t.hasBlob}`)
      if (t.notePreview) console.log(`    preview: ${t.notePreview}...`)
    }
  }

  // 4. 导航到 TRD-139
  console.log('\n=== 步骤 3: 导航到 TRD-139 ===')
  await page.goto(`${BASE}/trade/TRD-139`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  // 检查编辑器内容
  const editorState = await page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror')
    return {
      exists: !!editor,
      innerHTML: editor?.innerHTML?.substring(0, 200) ?? '(empty)',
      imgCount: editor?.querySelectorAll('img')?.length ?? 0,
    }
  })
  console.log(`  编辑器存在: ${editorState.exists}`)
  console.log(`  图片数量: ${editorState.imgCount}`)
  console.log(`  内容预览: ${editorState.innerHTML}`)

  // 5. 检查 resolveNoteForDisplay 的输入输出
  console.log('\n=== 步骤 4: 模拟刷新（同页面 reload）===')
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  const afterReload = await page.evaluate(() => {
    const editor = document.querySelector('.ProseMirror')
    return {
      innerHTML: editor?.innerHTML?.substring(0, 200) ?? '(no editor)',
      imgCount: editor?.querySelectorAll('img')?.length ?? 0,
    }
  })
  console.log(`  刷新后内容: ${afterReload.innerHTML}`)
  console.log(`  刷新后图片数: ${afterReload.imgCount}`)

  // 6. 再次检查 IndexedDB
  console.log('\n=== 步骤 5: 刷新后 IndexedDB 状态 ===')
  const idbAfter = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const req = indexedDB.open('linear-journal-v3')
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('snapshot', 'readonly')
        const getReq = tx.objectStore('snapshot').get('main')
        getReq.onsuccess = () => {
          const snap = getReq.result
          if (snap) {
            const trd139 = snap.trades?.find(t => t.id === 'TRD-139')
            resolve({
              snapshotExists: true,
              trd139NoteLen: trd139?.note?.length ?? 0,
              trd139NotePreview: (trd139?.note ?? '').substring(0, 150),
              hasJournalAsset: (trd139?.note ?? '').includes('journal-asset://'),
              hasBlob: (trd139?.note ?? '').includes('blob:'),
            })
          } else {
            resolve({ snapshotExists: false })
          }
          db.close()
        }
        getReq.onerror = () => { db.close(); resolve({ error: String(getReq.error) }) }
      }
      req.onerror = () => resolve({ openError: String(req.error) })
    })
  })
  console.log(`  快照存在: ${idbAfter.snapshotExists}`)
  console.log(`  TRD-139 note 长度: ${idbAfter.trd139NoteLen}`)
  console.log(`  含 journal-asset://: ${idbAfter.hasJournalAsset}`)
  console.log(`  含 blob:: ${idbAfter.hasBlob}`)
  if (idbAfter.trd139NotePreview) console.log(`  内容: ${idbAfter.trd139NotePreview}`)

} catch (e) {
  console.error('诊断异常:', e.message)
}

// 打印控制台错误
if (logs.length > 0) {
  console.log('\n=== 浏览器控制台日志 ===')
  for (const l of logs) console.log(l)
}

await browser.close()
