export function collectImageSrcsFromHtml(html: string): string[] {
  if (!html.trim()) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const seen = new Set<string>()
  const out: string[] = []
  for (const img of doc.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src')
    if (!src || seen.has(src)) continue
    seen.add(src)
    out.push(src)
  }
  return out
}

export function indexOfImageSrc(images: string[], src: string): number {
  const idx = images.indexOf(src)
  return idx >= 0 ? idx : 0
}
