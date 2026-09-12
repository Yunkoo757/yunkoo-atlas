export interface ComposerState {
  scenario: Record<string, unknown> | null
  mode: string; date: string; symbol: string; nav: string; side: string; period: string
  stage: string; reference: boolean; retry: boolean; htfLocation: string; htfLiquidity: string
  htfReaction: string; location: string; alignment: string; trigger: string; entry: string
  sl: string; be: string; target: string; manage: string; outcome: string
  beText: string; targetText: string; extra: string
}
export interface ComposerResult {
  text: string
  warnings: string[]
  scenario: Record<string, unknown> | null
  management: { why: string; be: string; target: string; beChoices: Record<string,string>; targetChoices: Record<string,string> }
}
declare const engine: {
  defaults: ComposerState
  navs: Record<string,string>
  periods: Record<string, [string,string,string,string|null]>
  normalize(state: ComposerState): ComposerState
  management(state: ComposerState): ComposerResult['management']
  generate(state: ComposerState): ComposerResult
  random(rng?: () => number, locks?: {period?:string;includeHistorical?:boolean}): ComposerState
}
export default engine
