import { createHash } from 'node:crypto'

const CATEGORY_KEYS = {
  FACES_PEOPLE_HEALTH: 'faces-people-health',
  ORGANIC: 'organic',
  SPORT_ACTIVITIES_OBJECTS: 'sport-activities-objects',
  TRAVEL_PLACES: 'travel-places',
  TECHNOLOGY: 'technology',
  INTERFACE: 'interface',
  COMPANIES: 'companies',
  MONEY_CURRENCIES: 'money-currencies',
  SYSTEM: 'system',
}

const NAME_OVERRIDES = {
  'Clock--outline': {
    name: 'clock-legacy-outline',
    componentName: 'LinearClockLegacyOutlineIcon',
  },
}

export function parseSymbols(markup, source) {
  return [...markup.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol>/g)].map((match) => {
    const linearName = match[1].match(/\bid="([^"]+)"/)?.[1]
    const viewBox = match[1].match(/\bviewBox="([^"]+)"/)?.[1]
    if (!linearName || !viewBox) throw new Error(`Invalid symbol in ${source}`)
    return { linearName, viewBox, body: match[2], source }
  })
}

export function parseOfficialCategories(source) {
  const result = new Map()
  const matcher = /\[y\.([A-Za-z0-9_-]+)\]:b\.([A-Z_]+)/g
  for (const [, linearName, rawCategory] of source.matchAll(matcher)) {
    const category = CATEGORY_KEYS[rawCategory]
    if (!category) throw new Error(`Unknown category: ${rawCategory}`)
    result.set(linearName, category)
  }
  return result
}

export function toRegistryName(linearName) {
  if (NAME_OVERRIDES[linearName]) return NAME_OVERRIDES[linearName].name
  return linearName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}

export const toComponentName = (linearName) =>
  NAME_OVERRIDES[linearName]?.componentName ?? `Linear${linearName}Icon`
export const sha256 = (text) => createHash('sha256').update(text).digest('hex')

export function assertUnique(records, key) {
  const seen = new Set()
  for (const record of records) {
    if (seen.has(record[key])) throw new Error(`Duplicate ${key}: ${record[key]}`)
    seen.add(record[key])
  }
}

export function renderStaticComponent(record) {
  return `// Generated from ${record.source}; do not edit.\nimport { StaticLinearSvg } from '../StaticLinearSvg'\nimport type { LinearStaticIconProps } from '../types'\n\nconst body = ${JSON.stringify(record.body)}\n\nexport function ${record.componentName}(props: LinearStaticIconProps) {\n  return <StaticLinearSvg {...props} body={body} viewBox="${record.viewBox}" />\n}\n`
}
