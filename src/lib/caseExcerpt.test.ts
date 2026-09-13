import assert from 'node:assert/strict'
import { caseExcerpt, resolveCasePreview, casePreviewSummary } from './caseExcerpt'
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

export function testCasePreviewKeepsSourceSeparateAndRecognizesImages() {
  const sourceNoteHtml = '<p>来源入场分析</p><img src="journal-asset://source">'
  const own = resolveCasePreview({ note: '<p>独立沉淀</p>', sourceNoteHtml })
  assert.equal(own.source, 'note')
  assert.equal(casePreviewSummary(own), '独立沉淀')
  const source = resolveCasePreview({ note: '<p><br></p>', sourceNoteHtml })
  assert.equal(casePreviewSummary(source), '来源复盘 · 来源入场分析')
  assert.equal(source.imageCount, 1)
  assert.equal(casePreviewSummary(resolveCasePreview({ note: '', sourceNoteHtml: '<img src="journal-asset://1"><img src="journal-asset://2">' })), '来源复盘 · 2 张截图')
  assert.equal(casePreviewSummary(resolveCasePreview({ note: '<img src="journal-asset://own">', sourceNoteHtml })), '1 张截图')
  assert.equal(resolveCasePreview({ note: '', sourceNoteHtml: '' }).source, 'empty')
}
