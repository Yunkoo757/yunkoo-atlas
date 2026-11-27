import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom'
import { NavigationIntentBoundary } from '@/hooks/useNavigationIntent'

export function MemoryAppRouter({ children, ...props }: MemoryRouterProps) {
  return <MemoryRouter {...props}><NavigationIntentBoundary>{children}</NavigationIntentBoundary></MemoryRouter>
}
