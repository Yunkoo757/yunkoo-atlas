/**
 * Quick test script for Notion CSV import
 * Run: npx tsx scripts/test-notion-import.ts
 */
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseNotionCsv, profileNotionCsv } from '../src/lib/notionImport.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const csvPath = join(__dirname, '..', 'Notion', '2026 06 38c1acd35ffa8031b023c4ccd6e47a29.csv')
const csvAllPath = join(__dirname, '..', 'Notion', '2026 06 38c1acd35ffa8031b023c4ccd6e47a29_all.csv')

console.log('='.repeat(70))
console.log('Notion CSV → Atlas Trade 导入测试')
console.log('='.repeat(70))

// ---- Test simplified CSV ----
console.log('\n📄 精简版 CSV (16 columns)')
console.log('-'.repeat(70))
const text = readFileSync(csvPath, 'utf-8')
const profile = profileNotionCsv(text)
console.log('\n列分析:')
profile.forEach((col) => {
  console.log(`  [${col.detectedField ?? '—'}] ${col.cleanName}`)
  console.log(`    唯一值 (${col.uniqueCount}): ${col.uniqueValues.join(' | ')}`)
})

const result = parseNotionCsv(text, [])
console.log(`\n解析结果: ${result.totalRows} 行, ✅ ${result.validRows} 有效, ❌ ${result.errorRows} 有误`)
console.log(`需创建策略: ${result.newStrategies.join(', ') || '(无)'}`)

result.previews.forEach((p, i) => {
  console.log(`\n--- Row ${i + 1} ---`)
  console.log(`  Symbol:      ${p.trade.symbol}`)
  console.log(`  Side:        ${p.trade.side}`)
  console.log(`  Status:      ${p.trade.status}`)
  console.log(`  Conviction:  ${p.trade.conviction}`)
  console.log(`  Strategy:    ${p.trade.strategyId}${p.newStrategyName ? ' 🆕 ' + p.newStrategyName : ''}`)
  console.log(`  PnL:         ${p.trade.pnl}  |  R: ${p.trade.rMultiple}  |  SL: ${p.trade.stopLoss}`)
  console.log(`  Date:        ${p.trade.openedAt}`)
  console.log(`  Tags:        [${(p.trade.tags ?? []).join(', ')}]`)
  console.log(`  Mistakes:    [${p.mistakeTags.join(', ')}]`)
  console.log(`  Note HTML:   ${p.noteHtml.slice(0, 120)}${p.noteHtml.length > 120 ? '...' : ''}`)
  if (p.errors.length) console.log(`  ❌ Errors:   ${p.errors.join('; ')}`)
  if (p.warnings.length) console.log(`  ⚠️ Warnings: ${p.warnings.join('; ')}`)
})

// ---- Test full CSV ----
console.log('\n\n📄 完整版 CSV (31 columns)')
console.log('-'.repeat(70))
const textAll = readFileSync(csvAllPath, 'utf-8')
const profileAll = profileNotionCsv(textAll)
console.log('\n新增字段（精简版没有的）:')
const simpleFields = new Set(profile.map((c) => c.cleanName))
profileAll.forEach((col) => {
  if (!simpleFields.has(col.cleanName) && col.detectedField) {
    console.log(`  [${col.detectedField}] ${col.cleanName}: ${col.uniqueValues.slice(0, 5).join(' | ')}`)
  }
})

const resultAll = parseNotionCsv(textAll, [])
console.log(`\n解析结果: ${resultAll.totalRows} 行, ✅ ${resultAll.validRows} 有效, ❌ ${resultAll.errorRows} 有误`)
console.log(`需创建策略: ${resultAll.newStrategies.join(', ')}`)

resultAll.previews.forEach((p, i) => {
  console.log(`\n--- Row ${i + 1} (完整版) ---`)
  console.log(`  Symbol:      ${p.trade.symbol}`)
  console.log(`  Side:        ${p.trade.side}`)
  console.log(`  Status:      ${p.trade.status}`)
  console.log(`  Conviction:  ${p.trade.conviction}`)
  console.log(`  Strategy:    ${p.trade.strategyId}${p.newStrategyName ? ' 🆕 ' + p.newStrategyName : ''}`)
  console.log(`  PnL:         ${p.trade.pnl}  |  R: ${p.trade.rMultiple}  |  SL: ${p.trade.stopLoss}`)
  console.log(`  Date:        ${p.trade.openedAt}`)
  console.log(`  Tags:        [${(p.trade.tags ?? []).join(', ')}]`)
  console.log(`  Mistakes:    [${p.mistakeTags.join(', ')}]`)
  console.log(`  Note HTML:   ${p.noteHtml.slice(0, 200)}${p.noteHtml.length > 200 ? '...' : ''}`)
  if (p.errors.length) console.log(`  ❌ Errors:   ${p.errors.join('; ')}`)
  if (p.warnings.length) console.log(`  ⚠️ Warnings: ${p.warnings.join('; ')}`)
})

console.log('\n' + '='.repeat(70))
console.log('测试完成！')
