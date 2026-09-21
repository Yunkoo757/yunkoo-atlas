type Bounds = { x: number; y: number; width: number; height: number }
type NativeWindow = {
  setBounds(bounds: Bounds): void
  getBounds(): Bounds
}

/** Windows fractional DPI can round the native frame outwards when applying DIP bounds. */
export function applyNativeWindowBounds(win: NativeWindow, target: Bounds, platform: string): void {
  let requested = { ...target }
  win.setBounds(requested)
  if (platform !== 'win32') return
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = win.getBounds()
    const widthError = target.width - actual.width
    const heightError = target.height - actual.height
    if (!widthError && !heightError) return
    // Do not fight minimum sizes, work-area constraints or a concurrent native resize.
    if (Math.abs(widthError) > 4 || Math.abs(heightError) > 4) return
    requested = {
      ...requested,
      width: Math.max(1, requested.width + widthError),
      height: Math.max(1, requested.height + heightError),
    }
    win.setBounds(requested)
  }
}
