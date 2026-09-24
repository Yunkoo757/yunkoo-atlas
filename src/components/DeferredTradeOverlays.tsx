import { lazy, Suspense, useRef, type ReactNode } from 'react'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'

const TradeComposer = lazy(() => import('./TradeComposer').then(module => ({ default: module.TradeComposer })))
const TradeCloseDialog = lazy(() => import('./TradeCloseDialog').then(module => ({ default: module.TradeCloseDialog })))
const TradeOpenRiskDialog = lazy(() => import('./TradeOpenRiskDialog').then(module => ({ default: module.TradeOpenRiskDialog })))
const ImageLightbox = lazy(() => import('./ImageLightbox').then(module => ({ default: module.ImageLightbox })))

/** Keep the original close/reset/focus lifecycle after the first request. */
function MountOnRequest({ requested, children }: { requested: boolean; children: ReactNode }) {
  const mounted = useRef(false)
  if (requested) mounted.current = true
  return mounted.current ? <Suspense fallback={null}>{children}</Suspense> : null
}

function ComposerHost() {
  const requested = useStore(state => state.composerOpen)
  return <MountOnRequest requested={requested}><TradeComposer /></MountOnRequest>
}

function CloseHost() {
  const requested = useStore(state => state.closeTradeRequest !== null)
  return <MountOnRequest requested={requested}><TradeCloseDialog /></MountOnRequest>
}

function RiskHost() {
  const requested = useStore(state => state.pendingTradeOpenRequest !== null || state.riskSetupTradeOpenRequest !== null)
  return <MountOnRequest requested={requested}><TradeOpenRiskDialog /></MountOnRequest>
}

function LightboxHost() {
  const requested = useShortcutStore(state => state.lightbox !== null)
  return <MountOnRequest requested={requested}><ImageLightbox /></MountOnRequest>
}

export function DeferredTradeOverlays() {
  return <><ComposerHost /><CloseHost /><RiskHost /><LightboxHost /></>
}
