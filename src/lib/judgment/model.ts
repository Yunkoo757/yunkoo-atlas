import { isSafeAssetId } from '../../storage/assetId'

export type Judgment = 'yes' | 'no' | 'uncertain'
export interface JudgmentTheme { id: string; title: string; understanding: string }
export interface JudgmentImage { assetId: string; sourceTradeId: string | null }
export interface JudgmentReference { answer: Exclude<Judgment, 'uncertain'>; reason: string; confirmedAt: string; needsReview: boolean }
export interface JudgmentSample {
  id: string; themeId: string; title: string; images: JudgmentImage[]; createdAt: string
  opinion: Judgment | null; note: string; reference: JudgmentReference | null
}
export interface JudgmentAttempt {
  id: string; sampleId: string; at: string; answer: Judgment; previous: Judgment | null
  reference: JudgmentReference | null; understanding: string
}
export interface JudgmentDeskData {
  themes: JudgmentTheme[]; samples: JudgmentSample[]; attempts: JudgmentAttempt[]
  currentThemeId: string | null; currentSampleId: string | null
}
export function emptyJudgmentDesk(): JudgmentDeskData {
  return { themes: [], samples: [], attempts: [], currentThemeId: null, currentSampleId: null }
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string'
const id = (v: unknown): v is string => text(v) && v.length > 0
const answer = (v: unknown): v is Judgment => v === 'yes' || v === 'no' || v === 'uncertain'
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v))
const reference = (v: unknown) => v === null || (record(v) && (v.answer === 'yes' || v.answer === 'no') && text(v.reason) && date(v.confirmedAt) && typeof v.needsReview === 'boolean')
/** Reject malformed evidence instead of silently dropping it during a load or import. */
export function assertJudgmentDesk(value: unknown): asserts value is JudgmentDeskData | undefined {
  if (value === undefined) return
  const fail = (): never => { throw new Error('判断台数据或图片引用无效') }
  if (!record(value) || !Array.isArray(value.themes) || !Array.isArray(value.samples) || !Array.isArray(value.attempts)) return fail()
  const themeIds = new Set<string>(), sampleIds = new Set<string>(), attemptIds = new Set<string>()
  for (const theme of value.themes) {
    if (!record(theme) || !id(theme.id) || themeIds.has(theme.id) || !text(theme.title) || !theme.title.trim() || !text(theme.understanding)) return fail()
    themeIds.add(theme.id)
  }
  for (const sample of value.samples) {
    if (!record(sample) || !id(sample.id) || sampleIds.has(sample.id) || !id(sample.themeId) || !themeIds.has(sample.themeId) || !text(sample.title) || !text(sample.note) || !date(sample.createdAt) || !(sample.opinion === null || answer(sample.opinion)) || !reference(sample.reference) || !Array.isArray(sample.images) || !sample.images.length) return fail()
    const assets = new Set<string>()
    for (const image of sample.images) {
      if (!record(image) || !text(image.assetId) || !isSafeAssetId(image.assetId) || assets.has(image.assetId) || !(image.sourceTradeId === null || id(image.sourceTradeId))) return fail()
      assets.add(image.assetId)
    }
    sampleIds.add(sample.id)
  }
  for (const attempt of value.attempts) {
    if (!record(attempt) || !id(attempt.id) || attemptIds.has(attempt.id) || !id(attempt.sampleId) || !sampleIds.has(attempt.sampleId) || !date(attempt.at) || !answer(attempt.answer) || !(attempt.previous === null || answer(attempt.previous)) || !reference(attempt.reference) || !text(attempt.understanding)) return fail()
    attemptIds.add(attempt.id)
  }
  if (!(value.currentThemeId === null || (text(value.currentThemeId) && themeIds.has(value.currentThemeId)))) return fail()
  if (!(value.currentSampleId === null || (text(value.currentSampleId) && value.samples.some(s => s.id === value.currentSampleId && s.themeId === value.currentThemeId)))) return fail()
}
export function judgmentAssetIds(data?: JudgmentDeskData): string[] {
  return [...new Set((data?.samples ?? []).flatMap(s => s.images.map(i => i.assetId)))]
}
/** Adapter for the existing HTML-based archive integrity scanner; no image data is copied. */
export function judgmentAssetEntries(data?: JudgmentDeskData): string[] {
  return judgmentAssetIds(data).map(id => `<img src="journal-asset://${id}">`)
}
