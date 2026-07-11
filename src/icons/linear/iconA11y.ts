import { createElement } from 'react'

export function resolveIconA11y(title?: string) {
  return title
    ? {
        svgProps: { role: 'img' as const, 'aria-label': title },
        titleNode: createElement('title', null, title),
      }
    : {
        svgProps: { 'aria-hidden': true as const, focusable: false as const },
        titleNode: null,
      }
}
