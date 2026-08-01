import { renderToStaticMarkup } from 'react-dom/server'
import { WeeklyRiskEvidence } from '@/views/WeeklyRiskEvidence'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

type ContinuityProps = {
  snapshot?: undefined
  availability: 'draft' | 'legacy'
}

function renderContinuityState(availability: ContinuityProps['availability']): string {
  const RiskEvidence = WeeklyRiskEvidence as unknown as (props: ContinuityProps) => JSX.Element
  try {
    return renderToStaticMarkup(<RiskEvidence availability={availability} />)
  } catch {
    return ''
  }
}

export function testDraftWeekKeepsRiskEvidenceInTheReviewFlow(): void {
  const html = renderContinuityState('draft')
  assert(html.includes('风控执行'), '草稿周必须保留风控执行区，避免周次之间结构跳变')
  assert(html.includes('完成复盘后冻结'), '草稿周必须解释何时生成冻结证据')
}

export function testLegacyCompletedWeekExplainsMissingFrozenEvidence(): void {
  const html = renderContinuityState('legacy')
  assert(html.includes('风控执行'), '旧版已完成周必须保留风控执行区，避免历史周突然缺块')
  assert(html.includes('历史记录未包含风控快照'), '旧版周必须明确缺失原因，不能留白或伪造数据')
}
