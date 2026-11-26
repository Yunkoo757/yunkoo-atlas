import { DisclosureSummary } from './DisclosureSummary'
import './ErrorDetails.css'

export function ErrorDetails({ message }: { message: string }) {
  if (!message) return null
  return (
    <details className="ui-error-details">
      <DisclosureSummary>查看错误详情</DisclosureSummary>
      <div className="ui-error-reason">{message}</div>
    </details>
  )
}
