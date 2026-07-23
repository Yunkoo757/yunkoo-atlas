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
 * Release 0 的唯一全量合同 fixture。16 个活跃字段都使用非默认哨兵值，
 * 并覆盖三个内容域的独立附件以及跨内容域共享附件。
 */
export function createFullPersistedSnapshotFixture(
  assetIds: FullSnapshotAssetIds = FULL_SNAPSHOT_ASSET_IDS,
): PersistedSnapshot {
  const timestamp = new Date('2026-07-18T08:00:00.000Z')
  const weeklyReview = createWeeklyReview('2026-07-13', timestamp)
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
      note: `<p>交易哨兵</p>${assetImage(assetIds.trade)}${assetImage(assetIds.shared)}`,
    }]),
    weeklyReviews: [{
      ...weeklyReview,
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
  }
}
