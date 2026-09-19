import { lazy, Suspense, useEffect, useState } from 'react'
import type { JudgmentImage } from '@/lib/judgment/model'
const Capture = lazy(() => import('./JudgmentCapture'))
export function JudgmentCaptureHost() {
  const [request, setRequest] = useState<{ image?: JudgmentImage } | null>(null)
  useEffect(() => {
    const listener = (event: Event) => setRequest({ image: (event as CustomEvent<JudgmentImage | undefined>).detail })
    window.addEventListener('atlas-judgment-capture', listener)
    return () => window.removeEventListener('atlas-judgment-capture', listener)
  }, [])
  return request ? <Suspense fallback={<span role="status">正在打开收图…</span>}><Capture initial={request.image} onClose={() => setRequest(null)} /></Suspense> : null
}
