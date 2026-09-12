import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import evidence from './evidence.json'
import { BUILTIN_RULES } from './model'
import { completeRulesMarkdown, completeRulesArchive } from './exportRules'

export async function testCompleteRulesExportPreservesAllModulesAndExecutableSources() {
  const rules={...BUILTIN_RULES,phrases:[{from:'案例分析',to:'案例复盘'}]}
  const markdown=completeRulesMarkdown(rules)
  for(const module of evidence.modules) {
    if(!markdown.includes(module.text))throw Error('规则模块缺失或被截断：'+module.id)
  }
  if(!markdown.includes(JSON.stringify(rules,null,2)))throw Error('未导出当前生效参数')
  const zip=await JSZip.loadAsync(await (await completeRulesArchive(rules)).arrayBuffer())
  for(const name of ['engine.js','scenario.js','service.ts','model.ts']) {
    const original=fs.readFileSync(path.join('src/lib/reviewComposer',name),'utf8')
    if(await zip.file(name)?.async('string')!==original)throw Error('执行规则不完整：'+name)
    if(!markdown.includes(original.trim()))throw Error('Markdown 缺少执行规则：'+name)
  }
  if(await zip.file('完整复盘规则.md')?.async('string')!==markdown)throw Error('档案与 Markdown 内容不一致')
  if(process.env.REVIEW_RULES_EXPORT_DIR) {
    const dir=path.resolve(process.env.REVIEW_RULES_EXPORT_DIR)
    fs.mkdirSync(dir,{recursive:true})
    fs.writeFileSync(path.join(dir,'完整复盘规则-'+BUILTIN_RULES.version+'.md'),completeRulesMarkdown(BUILTIN_RULES),'utf8')
    fs.writeFileSync(path.join(dir,'完整复盘规则-'+BUILTIN_RULES.version+'.zip'),Buffer.from(await (await completeRulesArchive(BUILTIN_RULES)).arrayBuffer()))
  }
}
