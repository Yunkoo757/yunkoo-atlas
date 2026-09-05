import assert from 'node:assert/strict'
import { caseExcerpt } from './caseExcerpt'
import { normalizeDisplay } from './tradeFilters'

export function testCaseExcerptUsesExistingHeadingOrFirstMeaningfulParagraph() {
  assert.equal(caseExcerpt('<p>背景说明</p><h2>突破后等待回踩</h2><p>执行结论</p>'), '突破后等待回踩')
  assert.equal(caseExcerpt('<p>HTF 背景：</p><p>等待结构确认 &amp; 回踩</p>'), '等待结构确认 & 回踩')
  assert.equal(caseExcerpt('<img alt="4H" src="journal-asset://chart"><p><br></p>'), '')
  assert.equal(caseExcerpt('<script>无关脚本</script><p>中文保持完整</p>'), '中文保持完整')
  assert.equal(caseExcerpt('<p>观察📈结构确认</p>', 3), '观察📈…')
}

export function testDetailPropertiesPreferenceSurvivesNormalization() {
  assert.equal(normalizeDisplay({}).detailPropertiesVisible, true)
  assert.equal(normalizeDisplay({ detailPropertiesVisible: false }).detailPropertiesVisible, false)
  assert.equal(normalizeDisplay({ detailPropertiesVisible: true }).detailPropertiesVisible, true)
}
