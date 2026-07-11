import { renderToStaticMarkup } from 'react-dom/server'
import { LinearFaceHeartEyesIcon, LinearIcon, LinearIssueStatusIcon, LinearOpenAIIcon } from '@/icons/linear'

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
