import { renderToStaticMarkup } from 'react-dom/server'
import { LinearFaceHeartEyesIcon, LinearIcon, LinearOpenAIIcon } from '@/icons/linear'

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
