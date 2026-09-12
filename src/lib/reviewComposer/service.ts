import engine, { type ComposerState, type ComposerResult } from './engine.js'
import options from './options.json'
import { assertRulePack, ENGINE_VERSION, type RulePack, type ComposerDocument } from './model'

export { engine }
export function readState(input: unknown): ComposerState {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('复盘选项格式无效，请重新导入。')
  const raw = input as Record<string, unknown>
  const next = { ...engine.defaults }
  for (const k of Object.keys(engine.defaults) as (keyof ComposerState)[]) {
    if (!(k in raw)) continue
    const value=raw[k]
    if (k === 'scenario') {
      if (value !== null && (!value || typeof value !== 'object' || Array.isArray(value))) throw Error('场景数据格式无效。')
    } else if (typeof value !== typeof engine.defaults[k] || (typeof value === 'string' && value.length > (k === 'extra' ? 20000 : 200))) throw Error(`选项 ${k} 的格式无效。`)
    const choices=options[k as keyof typeof options]
    if (choices?.length && !choices.some(o => o.value === value)) throw Error(`选项 ${k} 不受当前版本支持。`)
    Object.assign(next, { [k]: value })
  }
  return normalizeState(next)
}
export function normalizeState(s: ComposerState): ComposerState {
  const next=engine.normalize({ ...s })
  const m=engine.management(next)
  if (!m.beChoices[next.be]) next.be='auto'
  if (!m.targetChoices[next.target]) next.target='auto'
  return next
}
export function defaultState(pack: RulePack): ComposerState {
  return readState({ ...engine.defaults, ...pack.defaults, nav: pack.defaults.nav ?? pack.allowedNavigations[0] })
}
export function generate(state: ComposerState, pack: RulePack): ComposerResult {
  const result=engine.generate(state)
  if (!pack.allowedNavigations.includes(state.nav)) return { ...result, text:'', warnings:['当前规则未启用这个导航，请切换参与背景，或在规则设置中恢复上一版本。'] }
  let text=result.text
  for (const p of pack.phrases) text=text.split(p.from).join(p.to)
  return { ...result, text }
}
export function randomState(pack: RulePack, locks: { period?:string;includeHistorical?:boolean }, rng=Math.random): ComposerState {
  for(let i=0;i<100;i++) {
    const state=engine.random(rng,locks)
    if(pack.allowedNavigations.includes(state.nav)) return state
  }
  throw Error('当前周期与规则范围无法生成模拟，请取消周期锁定或调整规则范围。')
}
export function documentFor(state: ComposerState, pack: RulePack): ComposerDocument {
  return { state, text: generate(state,pack).text, ruleVersion:pack.version, engineVersion:ENGINE_VERSION, updatedAt:new Date().toISOString() }
}
export function checkRulePack(input: unknown): RulePack {
  assertRulePack(input)
  for (const k of Object.keys(input.defaults)) if (!Object.prototype.hasOwnProperty.call(engine.defaults,k) || ['scenario','extra','symbol','date'].includes(k)) throw Error(`规则默认值不支持字段 ${k}。`)
  const d=defaultState(input)
  if (generate(d,input).warnings.length) throw Error('规则默认组合未通过检查，请修正后重新导入。')
  let seed=173
  const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
  for(let i=0;i<60;i++) {
    const result=generate(randomState(input,{},rng),input)
    if(result.warnings.length || !result.text.trim() || !['HTF','MTF','LTF','TP管理'].every(k=>result.text.includes(k))) throw Error('规则未通过生成检查，请检查表述替换及导航范围。')
  }
  return JSON.parse(JSON.stringify(input))
}
export function downloadFile(name: string, value: string, type='text/plain;charset=utf-8') {
  const url=URL.createObjectURL(new Blob([value],{type}))
  const a=document.createElement('a');a.href=url;a.download=name;a.click()
  setTimeout(()=>URL.revokeObjectURL(url),1000)
}
