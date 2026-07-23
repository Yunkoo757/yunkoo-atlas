import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { SCHEMA_VERSION } from '@/storage/types'
import {
  createBusinessDateAnchor,
  getPeriodBounds,
  msUntilNextTradingDayBoundary,
} from '@/lib/periods'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export function testBusinessDateAnchorKeepsOneStableNowHourAndDateKey(): void {
  const now = new Date(2026, 2, 29, 3, 59, 59, 999)
  const anchor = createBusinessDateAnchor(now, 4)
  now.setFullYear(2030)
  assert(anchor.now.getFullYear() === 2026, '锚点必须复制 now，避免外部 Date mutation 改写范围')
  assert(anchor.tradingDayStartHour === 4, '锚点必须冻结规范化后的交易日起始小时')
  assert(anchor.currentTradingDayKey === '2026-03-28', '边界前必须属于上一交易日')
}

export function testCalendarRangesAndBoundaryDelayUseLocalCalendarArithmetic(): void {
  const now = new Date(2026, 9, 26, 3, 59, 59, 999)
  const anchor = createBusinessDateAnchor(now, 4)
  const week = getPeriodBounds('this-week', anchor)
  assert(week.start <= anchor.currentTradingDayKey && week.end >= anchor.currentTradingDayKey, '周范围必须包含锚点交易日')
  const delay = msUntilNextTradingDayBoundary(now, 4)
  assert(delay >= 1_000 && delay < 1_100, '边界前 1ms 应按最小 1 秒安全延迟排程，不依赖固定 24 小时')
}

export function testDateUnificationDoesNotChangePersistenceSchema(): void {
  assert(SCHEMA_VERSION === 8, 'DATE 包不得修改持久化 schema')
}

export function testBusinessDateBoundaryDelayAcrossNewYorkDstTransitions(): void {
  const periodsUrl = pathToFileURL(`${process.cwd()}/src/lib/periods.ts`).href
  const analysisScopeUrl = pathToFileURL(`${process.cwd()}/src/lib/analysisScope.ts`).href
  const aliasHook = `
    import { registerHooks } from 'node:module';
    import { pathToFileURL } from 'node:url';
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier.startsWith('@/')) {
          return {
            shortCircuit: true,
            url: pathToFileURL(process.cwd() + '/src/' + specifier.slice(2) + '.ts').href,
          };
        }
        return nextResolve(specifier, context);
      },
    });
  `
  const script = `
    import { createBusinessDateAnchor, getPeriodBounds, msUntilNextTradingDayBoundary } from ${JSON.stringify(periodsUrl)};
    import { filterTradesByAnalysisScope } from ${JSON.stringify(analysisScopeUrl)};
    const spring = msUntilNextTradingDayBoundary(new Date(2026, 2, 8, 1, 30), 4);
    const fall = msUntilNextTradingDayBoundary(new Date(2026, 10, 1, 0, 30), 4);
    const springAnchor = createBusinessDateAnchor(new Date(2026, 2, 8, 1, 30), 4);
    const fallAnchor = createBusinessDateAnchor(new Date(2026, 10, 1, 0, 30), 4);
    const baseTrade = {
      side: 'long', status: 'win', conviction: 'medium', strategyId: 'dst', tradeKind: 'live',
      tags: [], mistakeTags: [], reviewStatus: 'reviewed', entry: 1, exit: 2, size: 1,
      pnl: 1, rMultiple: 1, openedAt: '2026-10-31', note: '',
    };
    const filtered = filterTradesByAnalysisScope([
      { ...baseTrade, id: 'oct', ref: 'DST-OCT', closedAt: '2026-10-31' },
      { ...baseTrade, id: 'nov', ref: 'DST-NOV', openedAt: '2026-11-01', closedAt: '2026-11-01' },
    ], { kind: 'live', range: 'this-month' }, fallAnchor).map((trade) => trade.id);
    process.stdout.write(JSON.stringify({
      spring, fall,
      springKey: springAnchor.currentTradingDayKey,
      springWeek: getPeriodBounds('this-week', springAnchor),
      fallKey: fallAnchor.currentTradingDayKey,
      fallMonth: getPeriodBounds('this-month', fallAnchor),
      filtered,
    }));
  `
  const raw = execFileSync(process.execPath, [
    '--import',
    `data:text/javascript,${encodeURIComponent(aliasHook)}`,
    '--experimental-strip-types',
    '--input-type=module',
    '--eval',
    script,
  ], {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'America/New_York' },
  })
  const result = JSON.parse(raw) as {
    spring: number
    fall: number
    springKey: string
    springWeek: { start: string; end: string }
    fallKey: string
    fallMonth: { start: string; end: string }
    filtered: string[]
  }
  assert(result.spring === 5_400_025, '春季 DST 跳时后应按本地 04:00 排程，仅等待 1.5 小时')
  assert(result.fall === 16_200_025, '秋季 DST 重复小时后应按本地 04:00 排程，共等待 4.5 小时')
  assert(result.springKey === '2026-03-07', '春季 DST 边界前仍应归属上一业务日')
  assert(
    result.springWeek.start === '2026-03-02' && result.springWeek.end === '2026-03-08',
    '春季 DST 的本周范围必须按本地业务日保持一致',
  )
  assert(result.fallKey === '2026-10-31', '秋季 DST 边界前仍应归属上一业务日')
  assert(
    result.fallMonth.start === '2026-10-01' && result.fallMonth.end === '2026-10-31',
    '秋季 DST 的本月范围必须与业务日 key 一致',
  )
  assert(result.filtered.join(',') === 'oct', 'DST 当天的分析过滤必须复用同一业务日范围')
}
// Quality-Scenario: B-BOUNDARY
