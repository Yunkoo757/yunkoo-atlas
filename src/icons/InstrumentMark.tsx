import type { ReactNode } from 'react'
import type { SymbolPresetSvgId } from '@/lib/symbolIcons'

// Optical masters for the 16px mark next to a ticker. Currency strokes use round
// terminals; Bitcoin's counters and the space between Ether's facets stay open.
const marks: Record<SymbolPresetSvgId, ReactNode> = {
  'gold-au': (
    <path strokeWidth="1.5"
      d="M2 12.25 4.95 3.5l2.95 8.75 M3.15 9.35h3.6 M9.65 6.9v3.55c0 1.25.65 1.95 1.7 1.95 1.2 0 2.05-.95 2.05-2.25 M13.4 6.9v5.35" />
  ),
  euro: (
    <>
      <path d="M12.45 3.95a4.45 4.45 0 0 0-3.1-1.2C6.35 2.75 4.7 4.95 4.7 8s1.65 5.25 4.65 5.25a4.5 4.5 0 0 0 3.1-1.2" />
      <path strokeWidth="1.4" d="M2.6 6.5h7.65 M2.6 9.5h6.7" />
    </>
  ),
  sterling: (
    <path d="M12.1 4.7a3.1 3.1 0 0 0-2.95-1.9c-2.05 0-3.35 1.5-3.35 3.4 0 1.4.55 2.4.55 3.75 0 1.3-.75 2.2-2.05 2.95h8.4 M3.55 8.25h6.2" />
  ),
  bitcoin: (
    <path fill="currentColor" stroke="none" fillRule="evenodd"
      transform="translate(8 8) rotate(9) scale(.91) translate(-8 -8)"
      d="M6 1.45h1.35v1.7H8.7v-1.7h1.35v1.8c1.95.24 2.95 1.14 2.95 2.65 0 .99-.53 1.78-1.48 2.16 1.22.36 1.91 1.16 1.91 2.39 0 1.78-1.27 2.82-3.38 3.04v1.65H8.7v-1.6H7.35v1.6H6v-1.6H3.25v-1.62h1.47V4.8H3.25V3.15H6Zm.7 3.35v2.55h1.88c1.42 0 2.13-.41 2.13-1.28S9.97 4.8 8.58 4.8Zm0 4.1v2.62h2.13c1.47 0 2.23-.45 2.23-1.33 0-.86-.78-1.29-2.23-1.29Z" />
  ),
  'eth-diamond': (
    <g fill="currentColor" stroke="none">
      <path d="M8 1.35 2.95 8.4 8 11.15l5.05-2.75Z" />
      <path d="m3.15 9.8 4.85 2.65 4.85-2.65L8 14.75Z" fillOpacity=".78" />
    </g>
  ),
}

export function InstrumentMark({ id, size }: { id: SymbolPresetSvgId; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="var(--icon-stroke-width)" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      {marks[id]}
    </svg>
  )
}
