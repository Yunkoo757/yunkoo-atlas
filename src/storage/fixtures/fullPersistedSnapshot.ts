import { createQuickNote } from '@/data/quickNotes'
import { createWeeklyReview } from '@/data/weeklyReviews'
import { DEFAULT_DISPLAY } from '@/lib/tradeFilters'
import { normalizeTrades } from '@/lib/tradeKind'
import type { PersistedSnapshot } from '@/storage/types'

export interface FullSnapshotAssetIds {
  trade: string
  weeklyReview: string
  quickNote: string
  shared: string
}

export const FULL_SNAPSHOT_ASSET_IDS: FullSnapshotAssetIds = {
  trade: 'asset-trade-contract',
  weeklyReview: 'asset-weekly-contract',
  quickNote: 'asset-quick-note-contract',
  shared: 'asset-shared-contract',
}

export function canonicalContractJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return nested
    return Object.fromEntries(
      Object.entries(nested as Record<string, unknown>).sort(([left], [right]) =>
        left.localeCompare(right)),
    )
  })
}

function assetImage(id: string): string {
  return `<img src="journal-asset://${id}">`
}

/**
 * 唯一全量合同 fixture。21 个活跃字段都使用非默认哨兵值，
 * 并覆盖三个内容域的独立附件以及跨内容域共享附件。
 */
export function createFullPersistedSnapshotFixture(
  assetIds: FullSnapshotAssetIds = FULL_SNAPSHOT_ASSET_IDS,
): PersistedSnapshot {
  const timestamp = new Date('2026-07-18T08:00:00.000Z')
  const weeklyReview = createWeeklyReview('2026-07-13', 'live-stage-contract', timestamp)
  const quickNote = createQuickNote(timestamp)

  return {
    trades: normalizeTrades([{
      id: 'trade-contract',
      ref: 'TRD-CONTRACT',
      symbol: 'BTCUSDT',
      side: 'short',
      status: 'win',
      conviction: 'high',
      strategyId: 'strategy-contract',
      session: 'new-york',
      timeframe: '4H',
      narrative: 'Bearish contract sentinel',
      psychology: 'Neutral',
      tags: ['合同标签'],
      mistakeTags: ['合同错误标签'],
      reviewStatus: 'reviewed',
      reviewedAt: '2026-07-18T07:00:00.000Z',
      reviewCategory: 'focus',
      tradeKind: 'live',
      liveStageId: 'live-stage-contract',
      entry: 101,
      exit: 97,
      stopLoss: 103,
      initialStopLoss: 103,
      size: 2,
      pnl: 8,
      rMultiple: 2,
      resultSource: 'imported',
      openedAt: '2026-07-16T08:00:00.000Z',
      recordedAt: '2026-07-16T08:05:00.000Z',
      closedAt: '2026-07-17T08:00:00.000Z',
      closedTradingDayKey: '2026-07-17',
      note: `<p>交易哨兵</p>${assetImage(assetIds.trade)}${assetImage(assetIds.shared)}`,
    }]),
    weeklyRiskPreparations: [{
      id: 'weekly-risk-preparation:2026-07-13',
      liveStageId: 'live-stage-contract',
      weekStart: '2026-07-13',
      draft: {
        capitalBase: 12345.67,
        riskPercent: 0.75,
        riskAmount: 92.59,
        dailyLossLimitR: 1.5,
        weeklyLossLimitR: 4.5,
        monthlyLossLimitRDefault: 9.5,
        disciplineText: '合同纪律哨兵',
      },
      reviewedAt: '2026-07-12T08:00:00.000Z',
      confirmedPolicyVersionId: 'risk-policy-contract',
      createdAt: '2026-07-12T07:00:00.000Z',
      updatedAt: '2026-07-12T08:00:00.000Z',
    }],
    riskPolicyVersions: [{
      id: 'risk-policy-contract',
      liveStageId: 'live-stage-contract',
      sourceWeekStart: '2026-07-13',
      effectiveTradingDay: '2026-07-13',
      capitalBase: 12345.67,
      riskPercent: 0.75,
      riskAmount: 92.59,
      dailyLossLimitR: 1.5,
      weeklyLossLimitR: 4.5,
      monthlyLossLimitRDefault: 9.5,
      disciplineText: '合同纪律哨兵',
      confirmedAt: '2026-07-12T08:00:00.000Z',
    }],
    monthlyRiskLimits: [{
      id: 'monthly-risk-limit:2026-07',
      liveStageId: 'live-stage-contract',
      monthKey: '2026-07',
      limitR: 9.5,
      sourcePolicyVersionId: 'risk-policy-contract',
      lockedAt: '2026-07-12T08:00:00.000Z',
    }],
    riskOverrideEvents: [{
      id: 'risk-override-contract',
      liveStageId: 'live-stage-contract',
      tradeId: 'trade-contract',
      tradeIdentityAtDecision: {
        ref: 'TRD-CONTRACT',
        symbol: 'BTCUSDT',
        tradeKind: 'live',
      },
      linkState: 'resolved',
      decisionType: 'triggered',
      tradingDayKeyAtDecision: '2026-07-17',
      policyVersionId: 'risk-policy-contract',
      createdAt: '2026-07-17T08:00:00.000Z',
      reason: '合同覆盖原因',
      fingerprint: 'risk-fingerprint-contract',
      outcomesAtDecision: {
        day: {
          netBudgetR: -1.5,
          limitR: 1.5,
          consumedR: 1.5,
          remainingR: 0,
          progress: 1,
          coverage: 'complete',
          triggered: true,
          includedTradeCount: 1,
          excludedTradeCount: 0,
          unknownReasons: [],
        },
        week: {
          netBudgetR: -1.5,
          limitR: 4.5,
          consumedR: 1.5,
          remainingR: 3,
          progress: 1 / 3,
          coverage: 'complete',
          triggered: false,
          includedTradeCount: 1,
          excludedTradeCount: 0,
          unknownReasons: [],
        },
        month: {
        netBudgetR: -1.5,
          limitR: 9.5,
        consumedR: 1.5,
          remainingR: 8,
          progress: 1.5 / 9.5,
        coverage: 'complete',
          triggered: false,
        includedTradeCount: 1,
        excludedTradeCount: 0,
        unknownReasons: [],
        },
      },
      unknownReasons: [],
    }],
    weeklyReviews: [{
      ...weeklyReview,
      liveStageId: 'live-stage-contract',
      status: 'completed',
      executionScore: 4,
      riskScore: 3,
      emotionScore: 5,
      strengthTags: ['纪律'],
      mistakeTags: ['追价'],
      highlightTradeIds: ['trade-contract'],
      contentHtml: `<p>周复盘哨兵</p>${assetImage(assetIds.weeklyReview)}${assetImage(assetIds.shared)}`,
      commitmentText: '等待合同确认',
      commitmentCriteria: '连续三次遵守计划',
      previousCommitmentResult: 'partial',
      completedAt: '2026-07-18T09:00:00.000Z',
    }],
    quickNotes: [{
      ...quickNote,
      id: 'quick-note-contract',
      title: '随记哨兵',
      titleMode: 'manual',
      contentHtml: `<p>随记正文哨兵</p>${assetImage(assetIds.quickNote)}${assetImage(assetIds.shared)}`,
      pinned: true,
    }],
    strategies: [{
      id: 'strategy-contract',
      name: '合同策略',
      icon: 'target',
      color: '#7c3aed',
    }],
    starredIds: ['trade-contract'],
    subscribedIds: ['trade-contract'],
    pinnedStrategyIds: ['strategy-contract'],
    display: {
      ...DEFAULT_DISPLAY,
      hideClosed: true,
      showEmptyGroups: true,
      groupByStrategy: true,
      groupByDate: false,
      sortBy: 'conviction',
      privacyMode: true,
      tradingDayStartHour: 7,
      reviewContextPinned: false,
      sidebarPins: ['paper'],
      sidebarWorkspaceItems: [],
      workspaceMemory: {
        trade: { pathname: '/list', search: '?status=win' },
      },
    },
    shortcuts: {
      'nav.dashboard': { key: 'i', shift: true },
    },
    tagPresets: ['合同标签'],
    mistakeTagPresets: ['合同错误标签'],
    profile: {
      avatarId: 'avatar-contract',
      displayName: '合同用户',
      customAvatarDataUrl: null,
      legacyCashCurrencyAssumption: null,
    },
    savedTradeViews: [{
      id: 'view-contract',
      name: '合同视图',
      pathname: '/list',
      search: { status: 'win' },
      pinned: true,
      order: 3,
      createdAt: '2026-07-18T08:00:00.000Z',
      updatedAt: '2026-07-18T08:00:00.000Z',
    }],
    symbolIcons: {
      BTCUSDT: {
        presetId: 'btc',
        customDataUrl: null,
        updatedAt: '2026-07-18T08:00:00.000Z',
      },
    },
    symbolCatalog: ['BTCUSDT', 'ETHUSDT'],
    reviewTemplates: [{
      id: 'review-template-contract',
      name: '模板哨兵',
      content: 'HTF 合同哨兵',
    }],
    liveStages: [{
      id: 'live-stage-contract',
      sequence: 1,
      name: '合同实盘阶段',
      status: 'current',
      startsOn: '2026-07-13',
      endsOn: null,
      createdAt: '2026-07-13T00:00:00.000Z',
      archivedAt: null,
    }],
    currentLiveStageId: 'live-stage-contract',
    scheduledStageRollover: null,
  }
}
