/// <reference types="vite/client" />

declare const __ATLAS_BUILD_IDENTITY__: Readonly<{
  commit: string
  dirty: boolean
}>

interface Window {
  readonly __ATLAS_BUILD_IDENTITY__: typeof __ATLAS_BUILD_IDENTITY__
}
