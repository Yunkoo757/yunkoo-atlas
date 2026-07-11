import { useId } from 'react'
import { resolveIconA11y } from './iconA11y'
import type { LinearStaticIconProps } from './types'

interface StaticLinearSvgProps extends LinearStaticIconProps {
  body: string
  viewBox: string
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function rewriteSvgIds(markup: string, prefix: string): string {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '')
  return markup
    .replace(/\bid="([^"]+)"/g, (_, id) => `id="${safePrefix}-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${safePrefix}-${id})`)
    .replace(/\b(href|xlink:href)="#([^"]+)"/g, (_, attribute, id) =>
      `${attribute}="#${safePrefix}-${id}"`,
    )
}

export function StaticLinearSvg({
  body,
  viewBox,
  size = 16,
  title,
  ...props
}: StaticLinearSvgProps) {
  const id = useId()
  const a11y = resolveIconA11y(title)
  const titleMarkup = title ? `<title>${escapeSvgText(title)}</title>` : ''
  const innerMarkup = `${titleMarkup}${rewriteSvgIds(body, `linear-icon-${id}`)}`
  return (
    <svg
      {...a11y.svgProps}
      {...props}
      width={size}
      height={size}
      viewBox={viewBox}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      dangerouslySetInnerHTML={{ __html: innerMarkup }}
    />
  )
}
