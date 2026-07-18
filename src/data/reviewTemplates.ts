export interface ReviewTemplate {
  id: string
  name: string
  content: string
}

const DEFAULT_REVIEW_TEMPLATE: ReviewTemplate = {
  id: 'review-template-multi-timeframe',
  name: '多周期盘面',
  content: [
    'HTF 背景：',
    'MTF 触发：',
    'LTF 执行：',
    '复盘结论：',
  ].join('\n'),
}

export function createDefaultReviewTemplates(): ReviewTemplate[] {
  return [{ ...DEFAULT_REVIEW_TEMPLATE }]
}

export function createReviewTemplate(name = '未命名模板'): ReviewTemplate {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    id: `review-template-${suffix}`,
    name,
    content: '',
  }
}

export function normalizeReviewTemplates(value: unknown): ReviewTemplate[] {
  if (value === undefined) return createDefaultReviewTemplates()
  if (!Array.isArray(value)) return createDefaultReviewTemplates()

  const seenIds = new Set<string>()
  const normalized: ReviewTemplate[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<ReviewTemplate>
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const rawName = typeof candidate.name === 'string' ? candidate.name.slice(0, 40) : ''
    const name = rawName.trim() ? rawName : ''
    const content = typeof candidate.content === 'string' ? candidate.content.slice(0, 4000) : ''
    if (!id || !name || seenIds.has(id)) continue
    seenIds.add(id)
    normalized.push({ id, name, content })
    if (normalized.length >= 30) break
  }
  return normalized
}
