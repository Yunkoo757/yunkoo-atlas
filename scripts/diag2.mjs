/**
 * 诊断脚本 v2：主动编辑内容，验证持久化
 */
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:3000'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

try {
  // 1. 导航到 TRD-139
  await page.goto(`${BASE}/trade/TRD-139`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  // 2. 获取当前内容并编辑
  const before = await page.evaluate(() => {
    const ed = document.querySelector('.ProseMirror')
    return ed?.textContent?.substring(0, 100) ?? '(no editor)'
  })
  console.log('编辑前:', before)

  // 3. 输入新文字
  const editor = page.locator('.ProseMirror')
  await editor.click()
  const stamp = `TEST-${Date.now()}`
  await editor.press('End')
  await editor.type(` ${stamp}`)
  console.log('已输入:', stamp)

  // 4. 等待保存 (now 100ms persist debounce + 400ms editor debounce)
  await page.waitForTimeout(2000)

  // 5. 检查 IndexedDB 是否有新内容
  const idbBeforeReload = await page.evaluate(async (stamp) => {
    return new Promise((resolve) => {
      const req = indexedDB.open('linear-journal-v3')
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('snapshot', 'readonly')
        const getReq = tx.objectStore('snapshot').get('main')
        getReq.onsuccess = () => {
          const snap = getReq.result
          const allTrades = snap?.trades ?? []
          const hasStamp = allTrades.some(t => (t.note ?? '').includes(stamp))
          resolve({ tradeCount: allTrades.length, hasStamp })
          db.close()
        }
        getReq.onerror = () => { db.close(); resolve({ error: String(getReq.error) }) }
      }
      req.onerror = () => resolve({ error: String(req.error) })
    })
  }, stamp)
  console.log(`保存后 IndexedDB 含 stamp: ${idbBeforeReload.hasStamp}`)

  // 6. 刷新
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)

  // 7. 检查刷新后内容
  const after = await page.evaluate((stamp) => {
    const ed = document.querySelector('.ProseMirror')
    return {
      text: ed?.textContent?.substring(0, 200) ?? '(no editor)',
      hasStamp: (ed?.textContent ?? '').includes(stamp),
    }
  }, stamp)
  console.log('刷新后文本:', after.text?.substring(0, 100))
  console.log(`刷新后含 stamp: ${after.hasStamp}`)

  if (after.hasStamp) {
    console.log('\n✅✅✅ 持久化成功！刷新后内容保留。')
  } else {
    console.log('\n❌❌❌ 持久化失败！刷新后内容丢失。')
  }

  // 8. 检查 IndexedDB 最终状态
  const idbAfter = await page.evaluate(async (stamp) => {
    return new Promise((resolve) => {
      const req = indexedDB.open('linear-journal-v3')
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('snapshot', 'readonly')
        const getReq = tx.objectStore('snapshot').get('main')
        getReq.onsuccess = () => {
          const snap = getReq.result
          const allTrades = snap?.trades ?? []
          const match = allTrades.find(t => (t.note ?? '').includes(stamp))
          resolve({ hasStamp: !!match, totalChars: match?.note?.length ?? 0 })
          db.close()
        }
        getReq.onerror = () => { db.close(); resolve({ error: String(getReq.error) }) }
      }
      req.onerror = () => resolve({ error: String(req.error) })
    })
  }, stamp)
  console.log(`最终 IndexedDB 含 stamp: ${idbAfter.hasStamp}, chars: ${idbAfter.totalChars}`)

} catch (e) {
  console.error('异常:', e.message)
}
await browser.close()
