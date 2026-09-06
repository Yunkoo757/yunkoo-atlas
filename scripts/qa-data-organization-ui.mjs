import { createServer } from 'vite'
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
const server=await createServer({server:{host:'127.0.0.1',port:0,open:false},logLevel:'error'})
await server.listen()
const browser=await chromium.launch({headless:true})
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto(server.resolvedUrls.local[0]+'src/views/settings/DataOrganization.browser.test.html')
 await page.getByRole('button',{name:'整理数据',exact:true}).click()
 await page.getByRole('button',{name:'重新开始实盘记录',exact:true}).click()
 await page.getByRole('button',{name:'预览影响',exact:true}).click()
 await page.getByRole('button',{name:'备份并执行整理',exact:true}).waitFor()
 await fs.mkdir('test-results/data-organization-ui',{recursive:true})
 await page.screenshot({path:'test-results/data-organization-ui/preview.png'})
 await page.getByRole('button',{name:'备份并执行整理',exact:true}).click()
 await page.getByText('模拟备份验证失败',{exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>window.__dataOrganizationTest.commits),0)
 await page.evaluate(()=>{window.__dataOrganizationTest.failBackup=false})
 await page.getByRole('button',{name:'预览影响',exact:true}).click()
 await page.getByRole('button',{name:'备份并执行整理',exact:true}).click()
 await page.getByText(/整理完成。恢复备份/).waitFor()
 assert.equal(await page.evaluate(()=>window.__dataOrganizationTest.completed),1)
 assert.equal(await page.evaluate(()=>window.__dataOrganizationTest.commits),1)
 assert.equal(await page.locator('body > [inert]').count(),0)
 await page.getByRole('button',{name:'关闭',exact:true}).first().click()
 await page.evaluate(()=>window.__dataOrganizationTest.seedRepair())
 await page.getByRole('button',{name:'一键修复 1 项',exact:true}).click()
 await page.getByText('已修复明确归属的记录，操作前备份已保留。',{exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>window.__dataOrganizationTest.commits),2)
 assert.deepEqual(errors,[])
 console.log('PASS: preview, verified-backup gating, native bridge commit, completion, interaction unlock')
}finally{await browser.close();await server.close()}
