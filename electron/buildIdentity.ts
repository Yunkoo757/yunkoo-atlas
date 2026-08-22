declare const __ATLAS_BUILD_IDENTITY__: Readonly<{
  commit: string
  dirty: boolean
}>

export const ELECTRON_BUILD_IDENTITY = Object.freeze({ ...__ATLAS_BUILD_IDENTITY__ })
