const reducedQuery = '(prefers-reduced-motion: reduce)'

export function reducesMotion(): boolean {
  return window.matchMedia(reducedQuery).matches
}

export function motionDuration(element: Element, token: string): number {
  const value = getComputedStyle(element).getPropertyValue(token).trim()
  return (parseFloat(value) || 0) * (value.endsWith('ms') ? 1 : 1000)
}

/** Bridge CSS timing to compositor animations. An OS preference change also ends active motion. */
export function playMotion(element: Element, frames: Keyframe[], token: string, id: string) {
  const preference = window.matchMedia(reducedQuery)
  if (preference.matches) return
  const duration = motionDuration(element, token)
  if (!duration) return
  const easing = getComputedStyle(element).getPropertyValue('--ease-out').trim()
  const animation = element.animate(frames, { id, duration, easing })
  const stop = () => animation.cancel()
  preference.addEventListener('change', stop, { once: true })
  const release = () => preference.removeEventListener('change', stop)
  void animation.finished.then(release, release)
  return animation
}
