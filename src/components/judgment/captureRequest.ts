import type { JudgmentImage } from '@/lib/judgment/model'
export function requestJudgmentCapture(image?: JudgmentImage) {
  window.dispatchEvent(new CustomEvent('atlas-judgment-capture', { detail: image }))
}
