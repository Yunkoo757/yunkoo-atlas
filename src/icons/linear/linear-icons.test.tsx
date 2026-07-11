import { renderToStaticMarkup } from 'react-dom/server'
import {
  LinearCycleProgressIcon,
  LinearFaceHeartEyesIcon,
  LinearGridLoaderIcon,
  LinearGridProgressIcon,
  LinearIcon,
  LinearIssueStatusIcon,
  LinearOpenAIIcon,
  LinearProjectStatusIcon,
} from '@/icons/linear'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function testNamedStaticIconPreservesGeometryAndDefaults(): void {
  const html = renderToStaticMarkup(<LinearFaceHeartEyesIcon />)
  assert(html.includes('viewBox="0 0 16 16"'), 'preserves Linear viewBox')
  assert(html.includes('width="16"'), 'defaults to 16px')
  assert(html.includes('aria-hidden="true"'), 'decorative by default')
}

export function testStaticIconIdsAreIsolatedPerInstance(): void {
  const html = renderToStaticMarkup(
    <>
      <LinearOpenAIIcon />
      <LinearOpenAIIcon />
    </>,
  )
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1])
  assert(new Set(ids).size === ids.length, 'each rendered instance owns its SVG definition IDs')
}

export function testLinearIconResolvesTypedRegistryName(): void {
  const html = renderToStaticMarkup(<LinearIcon name="face-heart-eyes" size={24} title="喜欢" />)
  assert(html.includes('width="24"'), 'forwards size')
  assert(html.includes('role="img"'), 'title enables image role')
  assert(html.includes('<title>喜欢</title>'), 'renders accessible title')
}

export function testIssueStatusUsesExactLinearBranches(): void {
  const backlog = renderToStaticMarkup(<LinearIssueStatusIcon state="backlog" />)
  const started = renderToStaticMarkup(<LinearIssueStatusIcon state="started" progress={0.5} />)
  const completed = renderToStaticMarkup(<LinearIssueStatusIcon state="completed" />)
  assert(backlog.includes('13.9408 7.91426'), 'uses original backlog path')
  assert(started.includes('<path'), 'started renders a parameterized sector')
  assert(completed.includes('11.101 5.10104'), 'uses original completed path')
}

export function testIssueProgressClampsInvalidValues(): void {
  const below = renderToStaticMarkup(<LinearIssueStatusIcon state="started" progress={-2} />)
  const nan = renderToStaticMarkup(<LinearIssueStatusIcon state="started" progress={Number.NaN} />)
  assert(below === nan, 'negative and NaN progress both clamp to zero')
}

export function testProjectStatusKeepsHexagonMaskAndProgress(): void {
  const html = renderToStaticMarkup(<LinearProjectStatusIcon state="started" progress={0.42} />)
  assert(html.includes('M2.95778 3.02069'), 'keeps original hexagon')
  assert(html.includes('stroke-dasharray="calc(10.5504) 25.12"'), 'uses progress circumference')
  assert(html.includes('<mask'), 'uses the original hole mask')
}

export function testCycleProgressKeepsOriginalTransitionGeometry(): void {
  const html = renderToStaticMarkup(<LinearCycleProgressIcon active progress={0.6} />)
  assert(html.includes('stroke-dasharray'), 'renders circumference')
  assert(html.includes('stroke-linecap="round"'), 'keeps rounded active arc')
}

export function testGridLoaderExposesEveryVerifiedVariant(): void {
  const variants = [
    'scope',
    'upDown',
    'pong',
    'blowOut',
    'ufo',
    'down',
    'zap',
    'hourglass',
    'stats',
    'cat',
    'agent',
    'read',
    'unread',
    'outlines',
  ] as const
  for (const variant of variants) {
    const html = renderToStaticMarkup(<LinearGridLoaderIcon variant={variant} />)
    assert(html.includes(`data-variant="${variant}"`), `renders ${variant}`)
  }
}

export function testGridProgressRendersTwentyFiveDots(): void {
  const html = renderToStaticMarkup(<LinearGridProgressIcon progress={0.52} />)
  assert((html.match(/<circle/g) ?? []).length === 25, 'renders a 5x5 grid')
  assert(html.includes('600ms linear infinite'), 'pulses the frontier dot')
}
