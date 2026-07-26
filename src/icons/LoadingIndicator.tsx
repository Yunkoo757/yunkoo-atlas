import type { SVGProps } from 'react'

export interface LoadingIndicatorProps extends Omit<SVGProps<SVGSVGElement>, 'title'> {
  size?: number | string
  title?: string
}

export function LoadingIndicator({
  size = 16,
  title,
  ...props
}: LoadingIndicatorProps) {
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d="M21 12a9 9 0 1 1-6.22-8.56">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  )
}
