import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Topbar } from '@/components/Topbar'
import { Editor } from '@/editor/Editor'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Target,
  TrendingUp,
} from '@/icons/appIcons'
import {
  buildWeeklyReviewMetrics,
  buildWeeklyReviewTrend,
  createWeeklyReview,
  missedTradesInWeek,
  summarizeWeeklyMistakeDimensions,
  tradesClosedInWeek,
  WEEKLY_MISTAKE_DIMENSIONS,
  weeklyReviewScoreAverage,
  weekEndFor,
  weekStartFor,
  type WeeklyReview,
  type WeeklyCommitmentResult,
} from '@/data/weeklyReviews'
import { MISS_REASON_META, type MissReason, type Trade } from '@/data/trades'
import { fmtMoney, fmtR } from '@/lib/format'
import { parseLocalDate, formatYmd } from '@/lib/periods'
import { toast } from '@/lib/toast'
import { tradeDetailPath } from '@/lib/tradeRoute'
import { resolveNoteForDisplayResult } from '@/storage/assets'
import { getStorage } from '@/storage/bootstrap'
import {
  flushNoteDraftToStore,
  setNoteDraft,
  WEEKLY_REVIEW_DRAFT_PREFIX,
} from '@/storage/noteDrafts'
import { useStore } from '@/store/useStore'
import './WeeklyReviewView.css'

const STRENGTH_TAGS = ['耐心等待', '计划内交易', '执行果断', '仓位克制', '及时止损', '复盘充分']
const SCORE_FIELDS = [
  { key: 'executionScore', label: '执行纪律' },
  { key: 'riskScore', label: '风险管理' },
  { key: 'emotionScore', label: '情绪稳定' },
] as const
const COMMITMENT_RESULTS: { value: WeeklyCommitmentResult; label: string }[] = [
  { value: 'done', label: '做到' },
  { value: 'partial', label: '部分做到' },
  { value: 'missed', label: '未做到' },
  { value: 'not-applicable', label: '本周不适用' },
]

type ReviewPatch = Partial<Omit<WeeklyReview, 'id' | 'weekStart' | 'createdAt'>>

function addDays(ymd: string, days: number): string {
  const next = parseLocalDate(ymd)
  next.setDate(next.getDate() + days)
  return formatYmd(next)
}

function formatWeekRange(start: string): string {
  const end = weekEndFor(start)
  const left = parseLocalDate(start)
  const right = parseLocalDate(end)
  return left.getMonth() === right.getMonth()
    ? `${left.getMonth() + 1}月${left.getDate()}日 – ${right.getDate()}日`
    : `${left.getMonth() + 1}月${left.getDate()}日 – ${right.getMonth() + 1}月${right.getDate()}日`
}

function weekLabel(start: string, currentWeek: string): string {
  if (start === currentWeek) return '本周'
  if (start === addDays(currentWeek, -7)) return '上周'
  return `${parseLocalDate(start).getMonth() + 1}月${parseLocalDate(start).getDate()}日`
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function TradeEvidence({
  trade,
  review,
  onPatch,
}: {
  trade: Trade
  review: WeeklyReview
  onPatch: (patch: ReviewPatch) => void
}) {
  const isMissedTrade = trade.status === 'missed'
  const result = isMissedTrade
    ? `错过 · ${MISS_REASON_META[trade.missReason ?? 'other'].label}`
    : typeof trade.pnl === 'number' ? fmtMoney(trade.pnl) : fmtR(trade.rMultiple)
  const roleButtons = [
    { key: 'highlightTradeIds' as const, label: '做得好' },
    { key: 'mistakeTradeIds' as const, label: '犯错' },
    { key: 'followUpTradeIds' as const, label: '待研究' },
  ]
  return (
    <article className="wr-trade-row">
      <Link to={tradeDetailPath(trade)} className="wr-trade-main">
        <span className="wr-symbol">{trade.symbol}</span>
        <span>{trade.ref}</span>
        <span className={`wr-result ${isMissedTrade ? 'is-missed' : trade.status === 'loss' ? 'is-negative' : trade.status === 'win' ? 'is-positive' : ''}`}>
          {result}
        </span>
      </Link>
      {!isMissedTrade ? (
        <div className="wr-trade-roles" aria-label={`${trade.symbol} 复盘角色`}>
          {roleButtons.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={review[key].includes(trade.id)}
              onClick={() => onPatch({ [key]: toggleValue(review[key], trade.id) })}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  )
}

export function WeeklyReviewView() {
  const trades = useStore((state) => state.trades)
  const reviews = useStore((state) => state.weeklyReviews)
  const upsertReview = useStore((state) => state.upsertWeeklyReview)
  const updateReview = useStore((state) => state.updateWeeklyReview)
  const currentWeek = weekStartFor()
  const [selectedWeek, setSelectedWeek] = useState(currentWeek)
  const [tab, setTab] = useState<'review' | 'year'>('review')
  const [editorHtml, setEditorHtml] = useState('')
  const editorReadyRef = useRef(false)
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const storedReview = reviews.find((item) => item.weekStart === selectedWeek)
  const review = storedReview ?? createWeeklyReview(selectedWeek)
  const weekTrades = useMemo(
    () => tradesClosedInWeek(trades, selectedWeek),
    [trades, selectedWeek],
  )
  const weekMissedTrades = useMemo(
    () => missedTradesInWeek(trades, selectedWeek),
    [trades, selectedWeek],
  )
  const liveMetrics = useMemo(
    () => buildWeeklyReviewMetrics(weekTrades, weekMissedTrades),
    [weekTrades, weekMissedTrades],
  )
  const metrics = review.status === 'completed' && review.metricsSnapshot
    ? review.metricsSnapshot
    : liveMetrics
  const customMistakeEvidence = Object.entries(metrics.mistakeTagCounts)
    .filter(([tag]) => !WEEKLY_MISTAKE_DIMENSIONS.includes(tag as typeof WEEKLY_MISTAKE_DIMENSIONS[number]))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
  const locked = review.status === 'completed'
  const previousReview = reviews
    .filter((item) => item.weekStart < selectedWeek && item.commitmentText.trim())
    .sort((left, right) => right.weekStart.localeCompare(left.weekStart))[0]

  const availableWeeks = useMemo(() => {
    const weeks = new Set([currentWeek, ...reviews.map((item) => item.weekStart)])
    return [...weeks].sort((left, right) => right.localeCompare(left))
  }, [reviews, currentWeek])
  const selectedWeekIndex = availableWeeks.indexOf(selectedWeek)
  const olderWeek = selectedWeekIndex >= 0 ? availableWeeks[selectedWeekIndex + 1] : undefined
  const newerWeek = selectedWeekIndex > 0 ? availableWeeks[selectedWeekIndex - 1] : undefined
  const hasReviewHistory = availableWeeks.length > 1

  const commitPatch = useCallback((patch: ReviewPatch) => {
    const existing = useStore.getState().weeklyReviews.find((item) => item.weekStart === selectedWeek)
    if (existing?.status === 'completed') return
    if (existing) updateReview(existing.id, patch)
    else upsertReview({ ...createWeeklyReview(selectedWeek), ...patch, updatedAt: new Date().toISOString() })
  }, [selectedWeek, updateReview, upsertReview])

  const draftId = `${WEEKLY_REVIEW_DRAFT_PREFIX}${review.id}`
  useEffect(() => {
    editorReadyRef.current = false
    setEditorHtml('')
    let cancelled = false
    void resolveNoteForDisplayResult(review.contentHtml, getStorage()).then((result) => {
      if (cancelled) return
      setEditorHtml(result.html)
      editorReadyRef.current = result.editable
      if (!result.editable) toast('周复盘中有图片附件缺失，正文已切换为只读')
    })
    return () => {
      cancelled = true
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
      noteTimerRef.current = null
      void flushNoteDraftToStore(draftId)
    }
  }, [review.id])

  const onEditorChange = useCallback((html: string) => {
    setEditorHtml(html)
    if (useStore.getState().weeklyReviews.find((item) => item.weekStart === selectedWeek)?.status === 'completed') return
    if (!editorReadyRef.current) return
    const existing = useStore.getState().weeklyReviews.find((item) => item.weekStart === selectedWeek)
    if (!existing) upsertReview(createWeeklyReview(selectedWeek))
    setNoteDraft(`${WEEKLY_REVIEW_DRAFT_PREFIX}${review.id}`, html)
    if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
    noteTimerRef.current = setTimeout(() => {
      noteTimerRef.current = null
      void flushNoteDraftToStore(`${WEEKLY_REVIEW_DRAFT_PREFIX}${review.id}`)
    }, 500)
  }, [review.id, selectedWeek, upsertReview])

  const changeWeek = (week: string) => {
    if (week === selectedWeek) return
    void flushNoteDraftToStore(draftId)
    setSelectedWeek(week)
  }

  const completeReview = async () => {
    await flushNoteDraftToStore(draftId)
    const latest = useStore.getState().weeklyReviews.find((item) => item.weekStart === selectedWeek) ?? review
    if ([latest.executionScore, latest.riskScore, latest.emotionScore].some((score) => score === null)) {
      toast('请先完成执行、风控和情绪三项评分')
      return
    }
    if (!latest.commitmentText.trim() || !latest.commitmentCriteria.trim()) {
      toast('请写清下周只做的一件事和验收标准')
      return
    }
    const completedAt = new Date().toISOString()
    commitPatch({ status: 'completed', completedAt, metricsSnapshot: liveMetrics })
    toast('本周复盘已完成，指标已冻结')
  }

  const reopenReview = () => {
    updateReview(review.id, { status: 'draft', completedAt: null, metricsSnapshot: null })
    toast('已重新打开，本周指标恢复实时更新')
  }

  const year = parseLocalDate(selectedWeek).getFullYear()
  const yearReviews = reviews
    .filter((item) => item.weekStart.startsWith(`${year}-`))
    .sort((left, right) => left.weekStart.localeCompare(right.weekStart))
  const trendData = buildWeeklyReviewTrend(yearReviews)

  return (
    <>
      <Topbar title="周复盘" subtitle="把一周的证据沉淀成下一周可验证的行动" showDisplay={false} />
      <div className={`wr-shell${hasReviewHistory ? '' : ' is-first-review'}`}>
        {hasReviewHistory ? (
          <aside className="wr-history" aria-label="周复盘历史">
            <div className="wr-history-title">复盘记录</div>
            {availableWeeks.map((week) => {
              const item = reviews.find((candidate) => candidate.weekStart === week)
              return (
                <button
                  key={week}
                  type="button"
                  className={week === selectedWeek ? 'is-active' : ''}
                  onClick={() => changeWeek(week)}
                >
                  <span>{weekLabel(week, currentWeek)}</span>
                  <small>{week.slice(5).replace('-', '.')}</small>
                  <i className={item?.status === 'completed' ? 'is-complete' : item ? 'is-draft' : ''} />
                </button>
              )
            })}
          </aside>
        ) : null}

        <main className="wr-main">
          <header className="wr-page-head">
            <div>
              <div className="wr-kicker">{hasReviewHistory ? '' : '首次周复盘 · '}{selectedWeek.slice(0, 4)} · 第 {getIsoWeek(selectedWeek)} 周</div>
              <h1>{formatWeekRange(selectedWeek)}</h1>
              <p>{selectedWeek === currentWeek ? '本周进行中 · ' : ''}实盘结果按平仓日 · 错过机会按标记日单列</p>
            </div>
            <div className="wr-head-actions">
              <div className="wr-tab-switch" role="tablist" aria-label="周复盘视图">
                <button type="button" role="tab" aria-selected={tab === 'review'} onClick={() => setTab('review')}>本周复盘</button>
                <button type="button" role="tab" aria-selected={tab === 'year'} onClick={() => setTab('year')}>年度趋势</button>
              </div>
              {hasReviewHistory ? (
                <>
                  <button type="button" className="wr-week-nav" aria-label="上一条复盘" disabled={!olderWeek} onClick={() => olderWeek && changeWeek(olderWeek)}><ChevronLeft size={16} /></button>
                  <button type="button" className="wr-week-nav" aria-label="下一条复盘" disabled={!newerWeek} onClick={() => newerWeek && changeWeek(newerWeek)}><ChevronRight size={16} /></button>
                </>
              ) : null}
            </div>
          </header>

          {tab === 'year' ? (
            <YearTrend year={year} reviews={yearReviews} data={trendData} />
          ) : (
            <div className={`wr-content${locked ? ' is-locked' : ''}`}>
              {review.status === 'completed' ? (
                <div className="wr-complete-banner"><Check size={16} /> 已完成于 {new Date(review.completedAt ?? '').toLocaleDateString('zh-CN')}，数据已冻结</div>
              ) : null}

              <section className="wr-section wr-metrics">
                <div className="wr-section-head"><div><span>01</span><h2>本周事实</h2></div><small>{review.status === 'completed' ? '完成时快照' : '随交易记录实时更新'}</small></div>
                <div className="wr-metric-grid">
                  <Metric label="平仓交易" value={`${metrics.tradeCount}`} hint={`${metrics.reviewedCount} 笔已复盘`} />
                  <Metric label="胜率" value={metrics.winRate === null ? '—' : `${metrics.winRate.toFixed(0)}%`} hint={`${metrics.winCount} 赢 · ${metrics.lossCount} 亏 · ${metrics.breakevenCount} 平`} />
                  <Metric label="总盈亏" value={metrics.pnlCount ? fmtMoney(metrics.totalPnl) : '—'} tone={metrics.totalPnl > 0 ? 'positive' : metrics.totalPnl < 0 ? 'negative' : undefined} hint={`${metrics.pnlCount}/${metrics.tradeCount} 笔有 P&L`} />
                  <Metric label="平均 R" value={fmtR(metrics.averageR)} tone={(metrics.averageR ?? 0) > 0 ? 'positive' : (metrics.averageR ?? 0) < 0 ? 'negative' : undefined} hint={`${metrics.rCount}/${metrics.tradeCount} 笔有 R`} />
                </div>
                {metrics.missedCount > 0 ? (
                  <div className="wr-missed-summary">
                    <div>
                      <span>执行缺口</span>
                      <strong>错过机会 {metrics.missedCount}</strong>
                      <small>单独复盘，不计入平仓、胜率、盈亏与平均 R</small>
                    </div>
                    <p>
                      {Object.entries(metrics.missedReasonCounts)
                        .sort((left, right) => right[1] - left[1])
                        .map(([reason, count]) => (
                          <span key={reason}>{MISS_REASON_META[reason as MissReason]?.label ?? '其他'}<b>×{count}</b></span>
                        ))}
                    </p>
                  </div>
                ) : null}
                {metrics.conflictCount > 0 ? <p className="wr-data-warning">有 {metrics.conflictCount} 笔结果口径冲突，未进入绩效计算。</p> : null}
              </section>

              {previousReview ? (
                <section className="wr-section wr-previous">
                  <div className="wr-section-head"><div><span>02</span><h2>上次承诺验证</h2></div><small>{formatWeekRange(previousReview.weekStart)}</small></div>
                  <div className="wr-previous-body">
                    <Target size={19} />
                    <div><strong>{previousReview.commitmentText}</strong><p>{previousReview.commitmentCriteria}</p></div>
                    <div className="wr-result-choice">
                      {COMMITMENT_RESULTS.map((option) => (
                        <button key={option.value} type="button" aria-pressed={review.previousCommitmentResult === option.value} onClick={() => commitPatch({ previousCommitmentResult: option.value })}>{option.label}</button>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              <section className="wr-section">
                <div className="wr-section-head"><div><span>{previousReview ? '03' : '02'}</span><h2>给做法打分</h2></div><small>评价执行，不评价盈亏</small></div>
                <div className="wr-score-grid">
                  {SCORE_FIELDS.map(({ key, label }) => (
                    <div className="wr-score-row" key={key}>
                      <label>{label}</label>
                      <div role="radiogroup" aria-label={label}>
                        {[1, 2, 3, 4, 5].map((score) => (
                          <button key={score} type="button" role="radio" aria-checked={review[key] === score} onClick={() => commitPatch({ [key]: score })}>{score}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="wr-section">
                <div className="wr-section-head"><div><span>{previousReview ? '04' : '03'}</span><h2>模式识别</h2></div><small>用于跨周统计，而不是替代你的判断</small></div>
                <TagGroup title="做得好的" options={STRENGTH_TAGS} selected={review.strengthTags} onChange={(strengthTags) => commitPatch({ strengthTags })} />
                <TagGroup
                  title="需要纠正的"
                  options={[...WEEKLY_MISTAKE_DIMENSIONS]}
                  selected={review.mistakeTags}
                  onChange={(mistakeTags) => commitPatch({
                    mistakeTags: mistakeTags.filter((tag) => WEEKLY_MISTAKE_DIMENSIONS.includes(tag as typeof WEEKLY_MISTAKE_DIMENSIONS[number])),
                  })}
                  counts={metrics.mistakeTagCounts}
                />
                {customMistakeEvidence.length ? (
                  <div className="wr-evidence-tags">
                    <div><label>本周交易标签</label><small>仅作证据提示，不计入年度统计</small></div>
                    <p>{customMistakeEvidence.map(([tag, count]) => <span key={tag}>{tag}<b>×{count}</b></span>)}</p>
                  </div>
                ) : null}
              </section>

              <section className="wr-section">
                <div className="wr-section-head"><div><span>{previousReview ? '05' : '04'}</span><h2>关键交易证据</h2></div><small>标记角色后，可在年度复盘中回看</small></div>
                {weekTrades.length || weekMissedTrades.length ? (
                  <div className="wr-evidence-groups">
                    {weekTrades.length ? (
                      <div className="wr-evidence-group">
                        {weekMissedTrades.length ? <div className="wr-evidence-group-title">已执行并平仓</div> : null}
                        <div className="wr-trade-list">
                          {weekTrades.map((trade) => <TradeEvidence key={trade.id} trade={trade} review={review} onPatch={commitPatch} />)}
                        </div>
                      </div>
                    ) : null}
                    {weekMissedTrades.length ? (
                      <div className="wr-evidence-group">
                        <div className="wr-evidence-group-title">错过机会 <small>仅作执行证据，不计入绩效</small></div>
                        <div className="wr-trade-list">
                          {weekMissedTrades.map((trade) => <TradeEvidence key={trade.id} trade={trade} review={review} onPatch={commitPatch} />)}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : <div className="wr-empty">本周没有实盘已平仓交易或错过机会。仍可记录无交易决策、观察与下周行动。</div>}
              </section>

              <section className="wr-section">
                <div className="wr-section-head"><div><span>{previousReview ? '06' : '05'}</span><h2>判断与截图</h2></div><small>支持清单、引用和直接粘贴截图</small></div>
                <div className="wr-editor-wrap">
                  <Editor
                    content={editorHtml}
                    onChange={onEditorChange}
                    noteDraftId={storedReview ? draftId : undefined}
                    readOnly={locked || (!editorReadyRef.current && Boolean(review.contentHtml))}
                    ariaLabel="周复盘正文"
                    placeholder="哪些做法值得保留？错误在什么条件下重复出现？直接粘贴截图作为证据…"
                  />
                </div>
              </section>

              <section className="wr-section wr-commitment">
                <div className="wr-section-head"><div><span>{previousReview ? '07' : '06'}</span><h2>下周只改变一件事</h2></div><small>必须可以被下一次复盘验证</small></div>
                <label>行动承诺<input readOnly={locked} value={review.commitmentText} onChange={(event) => commitPatch({ commitmentText: event.target.value })} placeholder="例如：没有触发确认前不提前入场" /></label>
                <label>验收标准<input readOnly={locked} value={review.commitmentCriteria} onChange={(event) => commitPatch({ commitmentCriteria: event.target.value })} placeholder="例如：所有入场截图中都能看到确认信号" /></label>
              </section>

              <div className="wr-footer-action">
                <div><strong>{review.status === 'completed' ? '这周已经形成闭环' : '完成后会冻结本周事实，并带入下周验证'}</strong><span>复盘不是总结，而是下一周行为的输入。</span></div>
                {review.status === 'completed'
                  ? <button type="button" className="is-secondary" onClick={reopenReview}><RotateCcw size={16} /> 重新打开</button>
                  : <button type="button" onClick={() => void completeReview()}><Check size={16} /> 完成本周复盘</button>}
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  )
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'positive' | 'negative' }) {
  return <div className="wr-metric"><span>{label}</span><strong className={tone ? `is-${tone}` : ''}>{value}</strong><small>{hint}</small></div>
}

function TagGroup({ title, options, selected, onChange, counts }: { title: string; options: string[]; selected: string[]; onChange: (values: string[]) => void; counts?: Record<string, number> }) {
  return (
    <div className="wr-tag-group"><label>{title}</label><div>{options.map((option) => <button key={option} type="button" aria-pressed={selected.includes(option)} onClick={() => onChange(toggleValue(selected, option))}>{option}{counts?.[option] ? ` · ${counts[option]}` : ''}</button>)}</div></div>
  )
}

function YearTrend({ year, reviews, data }: { year: number; reviews: WeeklyReview[]; data: ReturnType<typeof buildWeeklyReviewTrend> }) {
  const completed = reviews.filter((review) => review.status === 'completed')
  const averages = completed.map(weeklyReviewScoreAverage).filter((score): score is number => score !== null)
  const average = averages.length ? averages.reduce((sum, score) => sum + score, 0) / averages.length : null
  const mistakes = Object.entries(summarizeWeeklyMistakeDimensions(reviews))
  return (
    <div className="wr-year">
      <section className="wr-section wr-year-summary">
        <div><span>已完成</span><strong>{completed.length}</strong><small>周</small></div>
        <div><span>平均做法评分</span><strong>{average?.toFixed(1) ?? '—'}</strong><small>/ 5</small></div>
        <div><span>最常见错误</span><strong>{mistakes.sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'}</strong><small>固定分类</small></div>
      </section>
      <section className="wr-section">
        <div className="wr-section-head"><div><TrendingUp size={17} /><h2>{year} 做法评分趋势</h2></div><small>完成周才进入年度统计</small></div>
        {data.length >= 2 ? <div className="wr-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><XAxis dataKey="week" stroke="var(--text-quaternary)" fontSize={11} /><YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} stroke="var(--text-quaternary)" fontSize={11} width={24} /><Tooltip contentStyle={{ background: 'var(--popover-bg)', border: '1px solid var(--border-default)', borderRadius: 8 }} /><Line type="monotone" dataKey="score" name="平均评分" stroke="var(--accent)" strokeWidth={2} connectNulls dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div> : data.length === 1 ? <div className="wr-trend-start"><div><span>趋势起点</span><strong>{data[0].score.toFixed(1)}</strong><small>/ 5</small></div><p>再完成 1 次周复盘后，这里会显示评分变化。</p></div> : <div className="wr-empty">完成第一篇周复盘后，这里会出现年度趋势。</div>}
      </section>
      <section className="wr-section">
        <div className="wr-section-head"><div><span>52</span><h2>全年复盘节奏</h2></div><small>颜色越亮，做法评分越高</small></div>
        <div className="wr-heatmap">{Array.from({ length: 53 }, (_, index) => { const start = weekStartFor(new Date(year, 0, 1)); const week = addDays(start, index * 7); const review = reviews.find((item) => item.weekStart === week); const score = review ? weeklyReviewScoreAverage(review) : null; return <i key={week} title={`${formatWeekRange(week)}${score ? ` · ${score.toFixed(1)} 分` : ''}`} style={{ '--level': score ? score / 5 : 0 } as React.CSSProperties} className={review?.status === 'completed' ? 'is-filled' : ''} /> })}</div>
      </section>
    </div>
  )
}

function getIsoWeek(ymd: string): number {
  const date = parseLocalDate(ymd)
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = utc.getUTCDay() || 7
  utc.setUTCDate(utc.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  return Math.ceil((((+utc - +yearStart) / 86400000) + 1) / 7)
}
