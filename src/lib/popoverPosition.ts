export function clampPopoverLeft(
  preferredLeft: number,
  popoverWidth: number,
  viewportWidth: number,
  edge = 8,
): number {
  const maxLeft = Math.max(edge, viewportWidth - popoverWidth - edge)
  return Math.min(Math.max(preferredLeft, edge), maxLeft)
}
