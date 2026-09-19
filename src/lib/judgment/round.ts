import type { JudgmentSample } from './model'

export function themeReviewQueue(samples: JudgmentSample[], themeId: string, random = Math.random): string[] {
  const ids = samples.filter(sample => sample.themeId === themeId).map(sample => sample.id)
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  return ids
}
