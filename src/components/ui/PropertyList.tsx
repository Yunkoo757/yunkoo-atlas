import type { ReactNode } from 'react'
import './PropertyList.css'

type PropertySectionProps = {
  title: string
  children: ReactNode
}

type StaticPropertyRowProps = {
  label: ReactNode
  value: ReactNode
  onClick?: never
  ariaLabel?: never
}

type InteractivePropertyRowProps = {
  label: string
  value: string | number
  onClick: () => void
  ariaLabel?: string
}

type PropertyRowProps = StaticPropertyRowProps | InteractivePropertyRowProps

export function PropertySection({ title, children }: PropertySectionProps) {
  return (
    <section className="ui-property-section">
      <h2 className="ui-property-title">{title}</h2>
      <div className="ui-property-list">{children}</div>
    </section>
  )
}

export function PropertyRow(props: PropertyRowProps) {
  const content = (
    <>
      <span className="ui-property-label">{props.label}</span>
      <span className="ui-property-value">{props.value}</span>
    </>
  )

  if (props.onClick) {
    return (
      <button
        type="button"
        className="ui-property-row ui-property-row-button"
        onClick={props.onClick}
        aria-label={props.ariaLabel}
      >
        {content}
      </button>
    )
  }

  return <div className="ui-property-row">{content}</div>
}
