const manifest = window.LINEAR_ICON_MANIFEST
if (!manifest || manifest.count !== 301) {
  throw new Error('Linear icon gallery data is missing or incomplete')
}

const state = { query: '', size: 16, theme: 'dark', progress: 0.5 }

const CATEGORY_LABELS = {
  'faces-people-health': 'Faces',
  organic: 'Organic',
  'sport-activities-objects': 'Sport',
  'travel-places': 'Travel',
  technology: 'Technology',
  interface: 'Interface',
  companies: 'Companies',
  'money-currencies': 'Money',
  system: 'System',
}

function matches(icon) {
  const query = state.query.trim().toLowerCase()
  return (
    !query ||
    [icon.name, icon.linearName, icon.componentName].some((value) =>
      value.toLowerCase().includes(query),
    )
  )
}

function renderCategoryCounts() {
  const counts = new Map()
  for (const icon of manifest.icons) {
    counts.set(icon.category, (counts.get(icon.category) || 0) + 1)
  }
  const root = document.querySelector('#category-counts')
  root.innerHTML = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(
      ([category, count]) =>
        `<span class="category-pill">${CATEGORY_LABELS[category] || category} · ${count}</span>`,
    )
    .join('')
}

function renderStaticIcons() {
  const visible = manifest.icons.filter(matches)
  document.querySelector('#static-grid').innerHTML = visible
    .map(
      (icon) => `
    <article class="icon-card" data-category="${icon.category}">
      <img width="${state.size}" height="${state.size}" src="./categories/${icon.category}/${icon.linearName}.svg" alt="" />
      <strong>${icon.name}</strong>
      <span>${icon.linearName}</span>
      <code>${icon.componentName}</code>
    </article>
  `,
    )
    .join('')
  document.querySelector('#visible-count').textContent = String(visible.length)
  document.querySelector('#total-count').textContent = String(manifest.count)
}

function clampProgress(progress) {
  if (Number.isNaN(progress)) return 0
  return Math.min(1, Math.max(0, progress))
}

function renderIssuePreview(progress) {
  const radius = 3.5
  const degrees = 360 * progress
  const shortDegrees = degrees > 180 ? 360 - degrees : degrees
  const radians = (shortDegrees * Math.PI) / 180
  const chord = Math.sqrt(2 * radius ** 2 - 2 * radius ** 2 * Math.cos(radians))
  const vertical =
    shortDegrees <= 90
      ? radius * Math.sin(radians)
      : radius * Math.sin(((180 - shortDegrees) * Math.PI) / 180)
  const horizontal = Math.sqrt(Math.max(0, chord ** 2 - vertical ** 2))
  const endX = degrees <= 180 ? radius + vertical : radius - vertical
  const largeArc = degrees <= 180 ? 0 : 1
  return `
    <svg width="${state.size}" height="${state.size}" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="1" y="1" width="12" height="12" rx="6" stroke="currentColor" stroke-width="1.5" fill="none"></rect>
      <path fill="currentColor" stroke="none" d="M ${radius},${radius} L${radius},0 A${radius},${radius} 0 ${largeArc},1 ${endX}, ${horizontal} z" transform="translate(${radius},${radius})"></path>
    </svg>
  `
}

function renderGridProgress(progress) {
  const filledCount = Math.floor(clampProgress(progress) * 25)
  const dots = Array.from({ length: 25 }, (_, index) => {
    const column = index % 5
    const row = Math.floor(index / 5)
    const opacity = index < filledCount ? 1 : 0.3
    return `<circle cx="${1 + column * 3.5}" cy="${1 + row * 3.5}" r="1" fill="currentColor" opacity="${opacity}"></circle>`
  }).join('')
  return `<svg width="${state.size}" height="${state.size}" viewBox="0 0 16 16" aria-hidden="true">${dots}</svg>`
}

function renderMotionExamples() {
  const progress = clampProgress(state.progress)
  document.querySelector('#motion-grid').innerHTML = `
    <article class="motion-card">
      <strong>Issue started</strong>
      <div class="motion-preview">${renderIssuePreview(progress)}</div>
      <span>progress ${progress.toFixed(2)}</span>
    </article>
    <article class="motion-card">
      <strong>Grid progress</strong>
      <div class="motion-preview">${renderGridProgress(progress)}</div>
      <span>5×5 dots</span>
    </article>
  `
}

function renderAll() {
  renderCategoryCounts()
  renderStaticIcons()
  renderMotionExamples()
}

document.querySelector('#icon-search').addEventListener('input', (event) => {
  state.query = event.target.value
  renderStaticIcons()
})

document.querySelector('#icon-size').addEventListener('input', (event) => {
  state.size = Number(event.target.value)
  renderAll()
})

document.querySelector('#progress-control').addEventListener('input', (event) => {
  state.progress = Number(event.target.value)
  renderMotionExamples()
})

document.querySelector('#theme-toggle').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark'
  document.body.dataset.theme = state.theme
})

renderAll()
