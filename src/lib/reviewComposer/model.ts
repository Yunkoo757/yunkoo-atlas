import type { ComposerState } from './engine.js'

export const ENGINE_VERSION = 1
export interface RulePack {
  formatVersion: 1
  version: string
  name: string
  engineVersion: number
  allowedNavigations: string[]
  defaults: Partial<ComposerState>
  phrases: { from: string; to: string }[]
}
export const BUILTIN_RULES: RulePack = {
  formatVersion: 1, version: '2026.09.13.1', name: 'Serein 离线复盘', engineVersion: 1,
  allowedNavigations: ['1','2','3','4','5'], defaults: {}, phrases: [],
}
export interface ComposerDocument {
  state: ComposerState
  text: string
  ruleVersion: string
  engineVersion: number
  updatedAt: string
}
export interface ComposerData {
  schemaVersion: 1
  draft: ComposerDocument | null
  periodLocked: boolean
  includeHistorical: boolean
  activeRules: RulePack | null
  previousRules: RulePack | null
}
export function emptyComposerData(): ComposerData {
  return { schemaVersion: 1, draft: null, periodLocked: false, includeHistorical: false, activeRules: null, previousRules: null }
}
function record(x: unknown): x is Record<string, unknown> { return !!x && typeof x === 'object' && !Array.isArray(x) }
export function assertRulePack(x: unknown): asserts x is RulePack {
  if (!record(x) || x.formatVersion !== 1 || x.engineVersion !== ENGINE_VERSION)
    throw Error('规则包版本不兼容，请使用当前引擎的规则包或先升级 Atlas。')
  if (typeof x.version !== 'string' || !/^[\w.-]{1,60}$/.test(x.version) || typeof x.name !== 'string' || !x.name.trim() || x.name.length > 100)
    throw Error('规则包缺少有效的名称或版本。')
  if (!Array.isArray(x.allowedNavigations) || !x.allowedNavigations.length || x.allowedNavigations.some(n => !['1','2','3','4','5'].includes(n)))
    throw Error('规则包的导航范围无效。')
  if (!record(x.defaults) || Object.values(x.defaults).some(v => typeof v !== 'string' && typeof v !== 'boolean')) throw Error('默认条件格式无效。')
  if (!Array.isArray(x.phrases) || x.phrases.length > 100 || x.phrases.some(p => !record(p) || typeof p.from !== 'string' || !p.from.trim() || p.from.length > 200 || typeof p.to !== 'string' || !p.to.trim() || p.to.length > 200)) throw Error('表述替换格式无效。')
}
/** Optional snapshot field: absent legacy data upgrades to an empty v1 workspace, never rewrites prose. */
export function assertComposerData(x: unknown): asserts x is ComposerData | undefined {
  if (x === undefined) return
  if (!record(x) || x.schemaVersion !== 1) throw Error('复盘组合器数据版本不兼容，请升级 Atlas。')
  if (typeof x.periodLocked !== 'boolean' || typeof x.includeHistorical !== 'boolean') throw Error('复盘组合器设置无效。')
  for (const k of ['activeRules','previousRules']) if (x[k] !== null) assertRulePack(x[k])
  if (x.draft !== null) {
    const d=x.draft
    if (!record(d) || !record(d.state) || typeof d.text !== 'string' || d.text.length > 100000 || typeof d.ruleVersion !== 'string' || typeof d.engineVersion !== 'number' || typeof d.updatedAt !== 'string') throw Error('复盘草稿数据无效。')
    if (d.engineVersion > ENGINE_VERSION) throw Error('复盘草稿来自更新的引擎，请先升级 Atlas。')
    const stringFields = ['mode','date','symbol','nav','side','period','stage','htfLocation','htfLiquidity','htfReaction','location','alignment','trigger','entry','sl','be','target','manage','outcome','beText','targetText','extra']
    for (const key of stringFields) if (typeof d.state[key] !== 'string') throw Error('复盘草稿缺少条件字段。')
    if (typeof d.state.reference !== 'boolean' || typeof d.state.retry !== 'boolean' || (d.state.scenario !== null && !record(d.state.scenario))) throw Error('复盘草稿的场景字段无效。')
  }
  if (JSON.stringify(x).length > 500000) throw Error('复盘组合器数据过大，请缩减规则或补充文本。')
}
