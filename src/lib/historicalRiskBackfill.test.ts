import { createFullPersistedSnapshotFixture } from '@/storage/fixtures/fullPersistedSnapshot'
import { previewHistoricalRiskBackfill, historicalRiskFingerprint, type HistoricalRiskInput } from './historicalRiskBackfill'
import { activeRiskPolicy } from './activeRiskPolicy'
import { assertValidPersistedSnapshot } from '@/storage/snapshotValidation'
import { decodeCanonicalSnapshot } from '@/storage/snapshotCodec'
import { SCHEMA_VERSION } from '@/storage/types'
import { useStore } from '@/store/useStore'

function fixture() {
  const state = createFullPersistedSnapshotFixture()
  state.weeklyReviews = []; state.quickNotes = []; state.riskOverrideEvents = []
  state.starredIds = []; state.subscribedIds = []
  state.liveStages = state.liveStages.map((stage) => ({ ...stage, startsOn: '2026-07-01' }))
  state.trades = [{ ...state.trades[0]!, openedAt: '2026-07-11T01:00:00.000Z',
    closedAt: '2026-07-12T01:00:00.000Z', closedTradingDayKey: '2026-07-12', note: '' }]
  const source = state.riskPolicyVersions[0]!
  const input: HistoricalRiskInput = { startsOn: '2026-07-12', today: '2026-07-18',
    draft: { ...source }, sourcePolicyVersionId: source.id, note: '用户核对当周交易计划',
    policyVersionId: 'historical-test', confirmedAt: '2026-07-18T08:00:00.000Z' }
  return { state, source, input }
}

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message) }
function rejects(action: () => unknown) { let rejected = false; try { action() } catch { rejected = true }; assert(rejected, '无效补录必须被拒绝') }

export function testHistoricalBackfillRepairsOnlyPrefixAndPreservesCurrentLocks() {
  const { state, source, input } = fixture()
  const before = JSON.stringify(state)
  const preview = previewHistoricalRiskBackfill(state, input)
  assert(preview.resolved.length === 1 && preview.remainingCount === 0, '应消除该笔历史缺口')
  assert(preview.policy.historicalBackfill?.throughTradingDay === '2026-07-12', '必须在已有规则前终止')
  assert(preview.newMonthlyLimits.length === 0, '不能改写现有月份锁定')
  assert(JSON.stringify(state) === before, '预览不得修改数据')
  const policies = [...state.riskPolicyVersions, preview.policy]
  assert(activeRiskPolicy(policies, '2026-07-12', state.currentLiveStageId)?.id === preview.policy.id, '历史日应采用补录规则')
  assert(activeRiskPolicy(policies, '2026-07-18', state.currentLiveStageId)?.id === source.id, '当前规则不能被覆盖')
  assert(activeRiskPolicy(policies, '2026-07-11', state.currentLiveStageId) === null, '不可影响区间之前的日期')
  const saved = { ...state, riskPolicyVersions: policies }
  assertValidPersistedSnapshot(saved)
  const decoded = decodeCanonicalSnapshot(JSON.parse(JSON.stringify(saved)), { version: SCHEMA_VERSION })
  assert(decoded.riskPolicyVersions.at(-1)?.historicalBackfill?.note === input.note, '存储往返必须保留补录依据')
  assert(decoded.riskPolicyVersions.at(-1)?.confirmedAt === input.confirmedAt, '补录时间不得伪装为过去确认时间')
}

export function testHistoricalBackfillRejectsOverlapBadValuesAndWrongSource() {
  const { state, input } = fixture()
  for (const patch of [
    { startsOn: '2026-07-13' }, { startsOn: '2026-06-30' }, { startsOn: '2026-02-30' },
    { sourcePolicyVersionId: 'missing' }, { today: '2026-07-11' },
    { draft: { ...input.draft, capitalBase: 0 } }, { draft: { ...input.draft, riskPercent: NaN } },
  ]) rejects(() => previewHistoricalRiskBackfill(state, { ...input, ...patch }))
  rejects(() => previewHistoricalRiskBackfill({ ...state, trades: [] }, input))
  rejects(() => previewHistoricalRiskBackfill({ ...state, riskPolicyVersions: state.riskPolicyVersions.map((p) => ({ ...p, liveStageId: 'other' })) }, input))
}

export function testHistoricalBackfillAddsOnlyMissingMonthlyLockAndChecksStaleSubmission() {
  const { state, input } = fixture()
  state.monthlyRiskLimits = []
  const preview = previewHistoricalRiskBackfill(state, input)
  assert(preview.newMonthlyLimits.length === 1, '缺失月份应明确补齐')
  assert(preview.newMonthlyLimits[0]?.lockedAt === input.confirmedAt, '月上限补录必须保留本次确认时间')
  const old = useStore.getState()
  try {
    useStore.setState(state)
    useStore.setState({ trades: state.trades.map((t) => ({ ...t, note: '预览后发生修改' })) })
    rejects(() => useStore.getState().saveHistoricalRiskBackfill(input, preview.fingerprint))
    assert(useStore.getState().riskPolicyVersions.length === state.riskPolicyVersions.length, '过期提交不得追加规则')
    const current = useStore.getState()
    const withoutNote = { ...input, note: '' }
    assert(previewHistoricalRiskBackfill(current, withoutNote).resolved.length === 1, '无依据也可安全预览')
    rejects(() => current.saveHistoricalRiskBackfill(withoutNote, historicalRiskFingerprint(current)))
    current.saveHistoricalRiskBackfill(input, historicalRiskFingerprint(current))
    assert(useStore.getState().riskPolicyVersions.length === state.riskPolicyVersions.length + 1, '有效提交应追加一次')
    rejects(() => useStore.getState().saveHistoricalRiskBackfill(input, historicalRiskFingerprint(useStore.getState())))
  } finally { useStore.setState(old, true) }
}
