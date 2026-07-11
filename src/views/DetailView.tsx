import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Link2,
  MoreHorizontal,
  Star,
  Bell,
  Copy,
  Pencil,
  Trash2,
  X,
  Send,
  BookOpen,
  Tag as TagIcon,
  CalendarDays,
  Box,
  UserCircle,
} from 'lucide-react'
import { useStore } from '@/store/useStore'
import { Editor } from '@/editor/Editor'
import { Menu } from '@/components/Menu'
import { IconButton } from '@/components/IconButton'
import { Tooltip } from '@/components/ui/Tooltip'
import { TagEditor } from '@/components/TagEditor'
import { StatusIcon, ConvictionIcon, SideTag } from '@/components/StatusIcon'
import { SymbolIcon } from '@/components/SymbolIcon'
import { StrategyIcon, StrategyLabel } from '@/components/StrategyIcon'
import { UserAvatar } from '@/components/UserAvatar'
import type { Strategy } from '@/data/strategies'
import {
  STATUS_META,
  CONVICTION_META,
  TRADE_KIND_META,
  REVIEW_CATEGORY_META,
  MISS_REASON_META,
  TIMEFRAME_PRESETS,
  getTimeframeTone,
  resolveTimeframe,
  type TradeStatus,
  type Conviction,
  type TradeSide,
  type TradeKind,
  type MissReason,
  type ReviewStatus,
  type ReviewCategory,
  type ActivityEvent,
  type ActivityKind,
} from '@/data/trades'
import { REVIEW_STATUS_META } from '@/lib/reviewAnalytics'
import { fmtMoney, fmtR, fmtPrice, fmtDate, fmtDateTime } from '@/lib/format'
import { getStrategyName } from '@/lib/strategies'
import { getTradeActivities, type DisplayActivityEvent } from '@/lib/activities'
import { findTradeByRouteParam, tradeDetailPath, resolveTradeDetailReturn, type TradeDetailLocationState } from '@/lib/tradeRoute'
import { collectMistakeTagOptions, collectTagOptions } from '@/lib/tags'
import {
  SESSION_PRESETS,
  getSessionSelectValue,
  getTradeSessionMeta,
  normalizeSession,
} from '@/lib/tradeView'
import { toast } from '@/lib/toast'
import { syncStatusFromPnl } from '@/lib/tradeTransition'
import { STATUS_ORDER, isTerminal } from '@/lib/tradeStatus'
import { getStorage, normalizeNoteForStorage, resolveNoteForDisplay } from '@/storage'
import { setPreFlushCallback } from '@/storage/persist'
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator'
import { useSaveStatus } from '@/store/saveStatus'
import { HoverPreview, PreviewHeader, PreviewMeta } from '@/components/HoverPreview'
import { calculatePnL, calculateRMultiple } from '@/lib/priceCalc'
import { buildReviewCaseFromTrade, getNextReviewCaseRef } from '@/lib/reviewCases'
import { TradeDetailLayout } from '@/components/trades/TradeDetailLayout'
import { TradeMedia } from '@/components/trades/TradeMedia'
import { useShortcutStore } from '@/store/shortcutStore'
import './DetailView.css'

const FEED_VISIBLE = 8

const STATUS_OPTS: TradeStatus[] = STATUS_ORDER
const CONV_OPTS: Conviction[] = ['urgent', 'high', 'medium', 'low']
const KIND_OPTS: TradeKind[] = ['live', 'paper', 'case']
const MISS_OPTS: MissReason[] = ['hesitation', 'missed_setup', 'no_alert', 'rule_break', 'other']
const REVIEW_OPTS: ReviewStatus[] = ['unreviewed', 'reviewed', 'focus']
const REVIEW_CATEGORY_OPTS: ReviewCategory[] = ['normal', 'mistake', 'focus', 'ambiguous', 'recheck', 'mastered']

function extractEditorImages(html: string): string[] {
  if (!html || typeof DOMParser === 'undefined') return []
  const document = new DOMParser().parseFromString(html, 'text/html')
  return [...document.querySelectorAll('img')]
    .map((image) => image.getAttribute('src') ?? '')
    .filter(Boolean)
}

export function DetailView() {
  const { id: routeParam } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const listContext = useShortcutStore((s) => s.listContext)
  const trades = useStore((s) => s.trades).filter((t) => !t.deletedAt)
  const trade = useMemo(
    () => findTradeByRouteParam(trades, routeParam),
    [trades, routeParam],
  )
  const updateNote = useStore((s) => s.updateNote)
  const updateTradeData = useStore((s) => s.updateTradeData)
  const setStatus = useStore((s) => s.setStatus)
  const setConviction = useStore((s) => s.setConviction)
  const setStrategy = useStore((s) => s.setStrategy)
  const strategies = useStore((s) => s.strategies)
  const setSide = useStore((s) => s.setSide)
  const addTag = useStore((s) => s.addTag)
  const removeTag = useStore((s) => s.removeTag)
  const tagPresets = useStore((s) => s.tagPresets)
  const mistakeTagPresets = useStore((s) => s.mistakeTagPresets)
  const addTagPreset = useStore((s) => s.addTagPreset)
  const removeTagPreset = useStore((s) => s.removeTagPreset)
  const addMistakeTagPreset = useStore((s) => s.addMistakeTagPreset)
  const removeMistakeTagPreset = useStore((s) => s.removeMistakeTagPreset)
  const addComment = useStore((s) => s.addComment)
  const removeComment = useStore((s) => s.removeComment)
  const toggleStar = useStore((s) => s.toggleStar)
  const toggleSubscribe = useStore((s) => s.toggleSubscribe)
  const openComposer = useStore((s) => s.openComposer)
  const removeTrade = useStore((s) => s.removeTrade)
  const upsertTrade = useStore((s) => s.upsertTrade)
  const profile = useStore((s) => s.profile)
  const symbolIcons = useStore((s) => s.symbolIcons)
  const starredIds = useStore((s) => s.starredIds)
  const subscribedIds = useStore((s) => s.subscribedIds)
  const [comment, setComment] = useState('')
  const [editorHtml, setEditorHtml] = useState('')
  const [feedExpanded, setFeedExpanded] = useState(false)
  const [activeMediaIndex, setActiveMediaIndex] = useState(0)
  const openLightbox = useShortcutStore((s) => s.openLightbox)
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingHtmlRef = useRef<string | null>(null)
  const pendingTradeIdRef = useRef<string | null>(null)
  const noteResolvedRef = useRef(false)   // 初始内容是否已加载，防止空 onUpdate 覆盖真实笔记
  const commentRef = useRef<HTMLTextAreaElement>(null)

  const adjustCommentHeight = useCallback(() => {
    const el = commentRef.current
    if (!el) return
    const prev = el.style.height
    el.style.height = 'auto'
    const h = Math.min(el.scrollHeight, 160)
    el.style.height = prev === `${h}px` ? prev : `${h}px`
  }, [])

  useEffect(() => {
    if (!trade || !routeParam || routeParam === trade.ref) return
    navigate(tradeDetailPath(trade), {
      replace: true,
      state: location.state,
    })
  }, [trade, routeParam, navigate, location.state])

  const detailReturn = useMemo(() => {
    const from = (location.state as TradeDetailLocationState | null)?.from
    return resolveTradeDetailReturn({
      from,
      listPath: listContext?.listPath,
      listSearch: listContext?.listSearch,
      tradeKind: trade?.tradeKind,
    })
  }, [location.state, listContext?.listPath, listContext?.listSearch, trade?.tradeKind])

  const persistEditorNote = useCallback(
    (html: string, tradeId: string) => {
      pendingHtmlRef.current = html
      pendingTradeIdRef.current = tradeId
      if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current)
      noteSaveTimer.current = setTimeout(async () => {
        noteSaveTimer.current = null
        const normalized = await normalizeNoteForStorage(html, getStorage())
        const current = useStore.getState().trades.find((t) => t.id === tradeId)
        if (current && normalized !== current.note) updateNote(tradeId, normalized)
      }, 400)
    },
    [updateNote],
  )

  useEffect(() => {
    if (!trade) return
    noteResolvedRef.current = false   // 切换交易时重置，阻止旧 onUpdate 写入空内容
    let cancelled = false
    resolveNoteForDisplay(trade.note, getStorage()).then((html) => {
      if (!cancelled) {
        setEditorHtml(html)
        noteResolvedRef.current = true  // 标记初始内容已就绪，允许后续编辑触发保存
      }
    })
    return () => {
      cancelled = true
    }
  }, [trade?.id])

  useEffect(() => {
    return () => {
      if (noteSaveTimer.current) {
        clearTimeout(noteSaveTimer.current)
        // 立即执行保存
        const html = pendingHtmlRef.current
        const tradeId = pendingTradeIdRef.current
        if (html && tradeId) {
          normalizeNoteForStorage(html, getStorage()).then((normalized) => {
            const current = useStore.getState().trades.find((t) => t.id === tradeId)
            if (current && normalized !== current.note) {
              useStore.getState().updateNote(tradeId, normalized)
            }
          }).catch(() => {})
        }
      }
    }
  }, [])

  // beforeunload 前先归一化 note，确保 flushPersistNow 收到的是 journal-asset:// 而非 blob:
  useEffect(() => {
    setPreFlushCallback(async () => {
      // 清除待处理定时器（如有）
      if (noteSaveTimer.current) {
        clearTimeout(noteSaveTimer.current)
        noteSaveTimer.current = null
      }
      // 无论定时器状态如何，只要有 pending HTML 就归一化
      const html = pendingHtmlRef.current
      const tradeId = pendingTradeIdRef.current
      if (html && tradeId) {
        try {
          const normalized = await normalizeNoteForStorage(html, getStorage())
          const current = useStore.getState().trades.find((t) => t.id === tradeId)
          if (current && normalized !== current.note) {
            useStore.getState().updateNote(tradeId, normalized)
          }
        } catch { /* 尽力而为 */ }
      }
    })
    return () => { setPreFlushCallback(null) }
  }, [])

  const onEditorChange = useCallback(
    (html: string) => {
      setEditorHtml(html)
      if (!trade?.id) return
      if (!noteResolvedRef.current) return  // 初始内容尚未加载，拒绝保存空/占位内容
      useSaveStatus.getState().setDirty()
      persistEditorNote(html, trade.id)
    },
    [trade?.id, persistEditorNote],
  )

  const editorImages = useMemo(() => extractEditorImages(editorHtml), [editorHtml])

  useEffect(() => {
    if (activeMediaIndex >= editorImages.length) setActiveMediaIndex(0)
  }, [activeMediaIndex, editorImages.length])

  const starred = trade ? starredIds.includes(trade.id) : false
  const subscribed = trade ? subscribedIds.includes(trade.id) : false
  const allTags = useMemo(
    () => collectTagOptions(tagPresets, trades),
    [tagPresets, trades],
  )
  const allMistakeTags = useMemo(
    () => collectMistakeTagOptions(mistakeTagPresets, trades),
    [mistakeTagPresets, trades],
  )
  const tagPreview = (tag: string, kind: 'tag' | 'mistake' = 'tag') => {
    const usedBy = trades.filter((t) =>
      kind === 'mistake' ? t.mistakeTags.includes(tag) : t.tags.includes(tag),
    )
    return (
      <>
        <PreviewHeader
          icon={
            <span
              className="hp-head-icon-dot"
              style={{ background: kind === 'mistake' ? 'var(--neg)' : 'var(--accent)' }}
            />
          }
          title={tag}
          subtitle={kind === 'mistake' ? '错误 / 违规标签' : '交易标签'}
        />
        <div className="hp-divider" />
        <PreviewMeta>
          <span className="hp-meta-item">
            <TagIcon size={14} />
            <span className="hp-meta-strong">{usedBy.length}</span> 笔交易使用
          </span>
          <span className="hp-meta-item">
            <UserCircle size={14} />
            {profile.displayName}
          </span>
        </PreviewMeta>
      </>
    )
  }

  const strategyPreview = (strategyId: string) => {
    const strategy = strategies.find((s) => s.id === strategyId)
    const strategyTrades = trades.filter((t) => t.strategyId === strategyId)
    const closed = strategyTrades.filter((t) => isTerminal(t.status))
    const wins = closed.filter((t) => t.status === 'win').length
    const totalR = strategyTrades.reduce((sum, t) => sum + t.rMultiple, 0)
    const winRate = closed.length > 0 ? Math.round((wins / closed.length) * 100) : null
    return (
      <>
        <PreviewHeader
          icon={
            strategy ? (
              <StrategyIcon icon={strategy.icon} color={strategy.color} size={18} variant="nav" />
            ) : (
              <Box size={16} />
            )
          }
          title={strategy?.name ?? '未设置策略'}
          subtitle="策略项目"
        />
        <div className="hp-divider" />
        <PreviewMeta>
          <span className="hp-meta-item">
            <Box size={14} />
            <span className="hp-meta-strong">{strategyTrades.length}</span> 笔交易
          </span>
          <span className="hp-meta-item">
            {winRate == null ? '暂无胜率' : `${winRate}% 胜率`} · {fmtR(totalR)}
          </span>
        </PreviewMeta>
      </>
    )
  }

  const datePreview = (label: string, value: string) => (
    <>
      <PreviewHeader
        icon={<CalendarDays size={17} />}
        title={`${label} · ${fmtDate(value)}`}
        subtitle={relativeDateLabel(value)}
      />
      <div className="hp-divider" />
      <PreviewMeta>
        <span className="hp-meta-item">点击修改日期</span>
        <span className="hp-meta-item"><span className="hp-kbd">Enter</span> 保存</span>
      </PreviewMeta>
    </>
  )

  useEffect(() => {
    setFeedExpanded(false)
  }, [trade?.id])

  const feedItems = useMemo(() => {
    if (!trade) return []
    const all = getTradeActivities(trade).map((event) => ({
      event,
      node: renderActivity(event, strategies, trade.tradeKind),
    }))
    if (feedExpanded || all.length <= FEED_VISIBLE) return all
    return all.slice(-FEED_VISIBLE)
  }, [trade, strategies, feedExpanded])

  const feedHiddenCount = useMemo(() => {
    if (!trade) return 0
    const total = getTradeActivities(trade).length
    return feedExpanded || total <= FEED_VISIBLE ? 0 : total - FEED_VISIBLE
  }, [trade, feedExpanded])

  if (!trade) {
    return (
      <>
        <header className="dv-topbar">
          <div className="dv-tb-left">
            <Link to={detailReturn} className="dv-back" aria-label="返回列表">
              <ChevronLeft size={16} />
            </Link>
            <span className="dv-crumb">交易</span>
            <ChevronRight size={13} className="dv-crumb-sep" />
            <span className="dv-crumb dv-crumb-active">未找到</span>
          </div>
        </header>
        <div className="dv-empty">未找到该交易</div>
      </>
    )
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast('链接已复制')
    } catch {
      toast('复制失败')
    }
  }

  const copyRef = async () => {
    try {
      await navigator.clipboard.writeText(trade.ref)
      toast(`已复制 ${trade.ref}`)
    } catch {
      toast('复制失败')
    }
  }

  const sendComment = () => {
    if (!comment.trim()) return
    addComment(trade.id, comment)
    setComment('')
    requestAnimationFrame(() => {
      const el = commentRef.current
      if (el) el.style.height = 'auto'
    })
    toast('评论已发布')
  }

  const onDelete = () => {
    removeTrade(trade.id)
    toast('已移至回收站，30天后自动清空')
    navigate(detailReturn)
  }

  const createReviewCaseFromTrade = () => {
    if (trade.tradeKind === 'case') return
    const reviewCase = buildReviewCaseFromTrade(trade, {
      id: crypto.randomUUID(),
      ref: getNextReviewCaseRef(trades),
    })
    upsertTrade(reviewCase)
    toast('已沉淀为案例记录')
    navigate(tradeDetailPath(reviewCase), { state: location.state })
  }

  const detailCrumb = trade.tradeKind === 'case' ? '案例记录' : '交易'

  return (
    <TradeDetailLayout
      header={(
      <header className="dv-topbar">
        <div className="dv-tb-left">
          <Link to={detailReturn} className="dv-back" aria-label="返回列表">
            <ChevronLeft size={16} />
          </Link>
          <span className="dv-crumb">{detailCrumb}</span>
          <ChevronRight size={13} className="dv-crumb-sep" />
          <span className="dv-crumb dv-crumb-active">{trade.ref}</span>
        </div>
        <div className="dv-tb-right">
          <SaveStatusIndicator />
          <IconButton title="复制链接" onClick={copyLink}>
            <Link2 size={15} />
          </IconButton>
          <IconButton
            title={starred ? '取消收藏' : '收藏'}
            active={starred}
            onClick={() => {
              toggleStar(trade.id)
              toast(starred ? '已取消收藏' : '已加入收藏')
            }}
          >
            <Star size={15} fill={starred ? 'currentColor' : 'none'} />
          </IconButton>
          <IconButton
            title={subscribed ? '取消置顶关注' : '置顶关注'}
            active={subscribed}
            onClick={() => {
              toggleSubscribe(trade.id)
              toast(subscribed ? '已取消置顶关注' : '已加入关注列表')
            }}
          >
            <Bell size={15} fill={subscribed ? 'currentColor' : 'none'} />
          </IconButton>
          <Menu
            align="right"
            options={[
              { value: 'edit', label: trade.tradeKind === 'case' ? '编辑案例记录' : '编辑交易', icon: <Pencil size={16} /> },
              ...(trade.tradeKind === 'case'
                ? []
                : [{ value: 'review-case', label: '沉淀为案例记录', icon: <BookOpen size={16} /> }]),
              { value: 'copy', label: '复制编号', icon: <Copy size={16} /> },
              { value: 'delete', label: trade.tradeKind === 'case' ? '删除案例记录' : '删除交易', icon: <Trash2 size={16} /> },
            ]}
            onSelect={(v) => {
              if (v === 'edit') openComposer(trade)
              else if (v === 'review-case') createReviewCaseFromTrade()
              else if (v === 'copy') copyRef()
              else if (v === 'delete') onDelete()
            }}
            trigger={
              <IconButton title="更多">
                <MoreHorizontal size={15} />
              </IconButton>
            }
          />
        </div>
      </header>
      )}
      content={(
          <div className="dv-main-inner">
            <h1 className="dv-title">
              <SymbolIcon symbol={trade.symbol} overrides={symbolIcons} size={22} />
              {trade.symbol}
              <SideTag side={trade.side} />
            </h1>
            <TradeMedia
              tradeId={trade.id}
              images={editorImages}
              activeIndex={activeMediaIndex}
              onActiveIndexChange={setActiveMediaIndex}
              onOpenLightbox={(index) => openLightbox(editorImages, index)}
            />
            <div className={'trade-media-editor' + (editorImages.length > 0 ? ' has-media' : '')}>
              <Editor
                content={editorHtml}
                onChange={onEditorChange}
                placeholder={
                  trade.tradeKind === 'case'
                    ? '写下这条案例记录的复盘思路… 输入 “- ” 开始清单，“> ” 引用，可直接粘贴/拖入截图'
                    : undefined
                }
              />
            </div>

            <section className="dv-activity">
              {feedHiddenCount > 0 && (
                <button
                  type="button"
                  className="dv-feed-more"
                  onClick={() => setFeedExpanded(true)}
                >
                  展开更早的 {feedHiddenCount} 条
                </button>
              )}
              <ul className="dv-feed">
                {feedItems.map(({ event, node }) => (
                  <FeedItem
                    key={event.id}
                    kind={event.kind}
                    deletable={event.kind === 'comment'}
                    onDelete={
                      event.kind === 'comment' && event.commentId
                        ? () => {
                            removeComment(trade.id, event.commentId!)
                            toast('评论已删除')
                          }
                        : undefined
                    }
                  >
                    {node}
                  </FeedItem>
                ))}
              </ul>

              <div className="dv-comment">
                <UserAvatar className="dv-comment-avatar" />
                <div className="dv-comment-box">
                  <textarea
                    ref={commentRef}
                    className="dv-comment-input"
                    placeholder="留下复盘评论…"
                    value={comment}
                    onChange={(e) => {
                      setComment(e.target.value)
                      adjustCommentHeight()
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        sendComment()
                      }
                    }}
                    rows={1}
                  />
                  <div className="dv-comment-bar">
                    <Tooltip content="发送评论" label="发送评论">
                      <button
                        type="button"
                        className="dv-comment-send"
                        disabled={!comment.trim()}
                        onClick={sendComment}
                        aria-label="发送评论"
                      >
                        <Send size={14} />
                      </button>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </section>
          </div>
      )}
      properties={(
        <>
          <Section title="属性">
            <Menu
              value={trade.status}
              onSelect={(v) => setStatus(trade.id, v as TradeStatus)}
              options={STATUS_OPTS.map((s) => ({
                value: s,
                label: STATUS_META[s].label,
                icon: <StatusIcon status={s} size={16} />,
              }))}
              trigger={
                <PropTrigger label="状态">
                  <StatusIcon status={trade.status} size={15} />
                  <span>{STATUS_META[trade.status].label}</span>
                </PropTrigger>
              }
            />
            <Menu
              value={trade.conviction}
              onSelect={(v) => setConviction(trade.id, v as Conviction)}
              options={CONV_OPTS.map((c) => ({
                value: c,
                label: CONVICTION_META[c].label,
                icon: <ConvictionIcon conviction={c} size={16} />,
              }))}
              trigger={
                <PropTrigger label="信心度">
                  <ConvictionIcon conviction={trade.conviction} size={15} />
                  <span>{CONVICTION_META[trade.conviction].label}</span>
                </PropTrigger>
              }
            />
            <Menu
              value={trade.side}
              onSelect={(v) => setSide(trade.id, v as TradeSide)}
              options={[
                { value: 'long', label: '做多' },
                { value: 'short', label: '做空' },
              ]}
              trigger={
                <PropTrigger label="方向">
                  <SideTag side={trade.side} />
                  <span>{trade.side === 'long' ? '做多' : '做空'}</span>
                </PropTrigger>
              }
            />
            <Menu
              value={resolveTimeframe(trade.timeframe)}
              onSelect={(v) =>
                updateTradeData(trade.id, {
                  timeframe: resolveTimeframe(v),
                })
              }
              options={TIMEFRAME_PRESETS.map((preset) => ({
                value: preset,
                label: preset,
              }))}
              trigger={
                <PropTrigger label="波段级别">
                  <span
                    className={
                      'dv-prop-chip is-timeframe is-' +
                      getTimeframeTone(resolveTimeframe(trade.timeframe))
                    }
                  >
                    {resolveTimeframe(trade.timeframe)}
                  </span>
                </PropTrigger>
              }
            />
            <Menu
              value={getSessionSelectValue(trade)}
              onSelect={(v) =>
                updateTradeData(trade.id, {
                  session: normalizeSession(v),
                })
              }
              options={[
                { value: '', label: '未设置' },
                ...SESSION_PRESETS.map((preset) => ({
                  value: preset.value,
                  label: preset.label,
                })),
              ]}
              trigger={
                <PropTrigger label="交易时段">
                  {getSessionSelectValue(trade) ? (
                    <span
                      className={
                        'dv-prop-chip is-session is-' +
                        (getTradeSessionMeta(trade)?.kind ?? 'other')
                      }
                    >
                      {SESSION_PRESETS.find((p) => p.value === getSessionSelectValue(trade))
                        ?.label ?? getSessionSelectValue(trade)}
                    </span>
                  ) : (
                    <span className="dv-prop-empty">未设置</span>
                  )}
                </PropTrigger>
              }
            />
            <Menu
              value={trade.tradeKind}
              onSelect={(v) => updateTradeData(trade.id, { tradeKind: v as TradeKind })}
              options={KIND_OPTS.map((k) => ({
                value: k,
                label: TRADE_KIND_META[k].label,
              }))}
              trigger={
                <PropTrigger label="类型">
                  <span className="dv-prop-chip is-neutral">
                    {TRADE_KIND_META[trade.tradeKind].label}
                  </span>
                </PropTrigger>
              }
            />
            <Menu
              value={trade.reviewCategory}
              onSelect={(v) => updateTradeData(trade.id, { reviewCategory: v as ReviewCategory })}
              options={REVIEW_CATEGORY_OPTS.map((s) => ({
                value: s,
                label: REVIEW_CATEGORY_META[s].label,
              }))}
              trigger={
                <PropTrigger label="分类">
                  <span
                    className={
                      'dv-prop-chip is-category' +
                      (trade.reviewCategory === 'mistake' ? ' is-mistake' : '')
                    }
                  >
                    {REVIEW_CATEGORY_META[trade.reviewCategory].label}
                  </span>
                </PropTrigger>
              }
            />
            <Menu
              value={trade.reviewStatus}
              onSelect={(v) => updateTradeData(trade.id, { reviewStatus: v as ReviewStatus })}
              options={REVIEW_OPTS.map((s) => ({
                value: s,
                label: REVIEW_STATUS_META[s].label,
              }))}
              trigger={
                <PropTrigger label="复盘">
                  <span className="dv-prop-chip is-neutral">
                    {REVIEW_STATUS_META[trade.reviewStatus].label}
                  </span>
                </PropTrigger>
              }
            />
            {trade.status === 'missed' && (
              <Menu
                value={trade.missReason ?? 'other'}
                onSelect={(v) => updateTradeData(trade.id, { missReason: v as MissReason })}
                options={MISS_OPTS.map((r) => ({
                  value: r,
                  label: MISS_REASON_META[r].label,
                }))}
                trigger={
                  <PropTrigger label="错过原因">
                    <span className="dv-prop-chip is-neutral">
                      {MISS_REASON_META[trade.missReason ?? 'other'].label}
                    </span>
                  </PropTrigger>
                }
              />
            )}
          </Section>

          <Section title="交易数据">
            <EditableDataRow
              label="入场"
              value={trade.entry}
              format={(v) => fmtPrice(v as number)}
              inputType="number"
              onSave={(v) => {
                const entry = v as number
                const updates: Partial<import('@/data/trades').Trade> = { entry }

                // 自动计算盈亏和 R 倍数
                if (trade.exit && entry > 0 && trade.size > 0) {
                  const pnl = calculatePnL(entry, trade.exit, trade.size, trade.side)
                  updates.pnl = pnl
                  if (trade.stopLoss) {
                    const rMultiple = calculateRMultiple(pnl, trade.stopLoss, entry, trade.size, trade.side)
                    updates.rMultiple = rMultiple
                  }
                }

                updateTradeData(trade.id, updates)
              }}
            />
            <EditableDataRow
              label="出场"
              value={trade.exit}
              format={(v) => (v == null ? '—' : fmtPrice(v as number))}
              inputType="number"
              nullable
              onSave={(v) => {
                const exit = v as number | null
                const updates: Partial<import('@/data/trades').Trade> = { exit }

                // 自动计算盈亏和 R 倍数
                if (exit && trade.entry > 0 && trade.size > 0) {
                  const pnl = calculatePnL(trade.entry, exit, trade.size, trade.side)
                  updates.pnl = pnl
                  if (trade.stopLoss) {
                    const rMultiple = calculateRMultiple(pnl, trade.stopLoss, trade.entry, trade.size, trade.side)
                    updates.rMultiple = rMultiple
                  }
                }

                updateTradeData(trade.id, updates)
              }}
            />
            <EditableDataRow
              label="仓位"
              value={trade.size}
              format={String}
              inputType="number"
              onSave={(v) => updateTradeData(trade.id, { size: v as number })}
            />
            <EditableDataRow
              label="止损"
              value={trade.stopLoss ?? null}
              format={(v) => (v == null ? '—' : fmtPrice(v))}
              inputType="number"
              nullable
              onSave={(v) => {
                const stopLoss = v as number | null
                const updates: Partial<import('@/data/trades').Trade> = { stopLoss }

                // 自动计算 R 倍数
                if (stopLoss && trade.entry > 0 && trade.size > 0 && trade.pnl !== 0) {
                  const rMultiple = calculateRMultiple(trade.pnl, stopLoss, trade.entry, trade.size, trade.side)
                  updates.rMultiple = rMultiple
                }

                updateTradeData(trade.id, updates)
              }}
            />
            <EditableDataRow
              label="盈亏"
              value={trade.pnl}
              format={(v) =>
                trade.status === 'planned' || trade.status === 'open'
                  ? '—'
                  : fmtMoney(v as number)
              }
              inputType="number"
              color={
                trade.pnl > 0
                  ? 'var(--pos)'
                  : trade.pnl < 0
                    ? 'var(--neg)'
                    : undefined
              }
              onSave={(v) => {
                const pnl = v as number
                updateTradeData(trade.id, { pnl })
                syncStatusFromPnl(trade, pnl, setStatus)
              }}
            />
            <EditableDataRow
              label="R 倍数"
              value={trade.rMultiple}
              format={(v) =>
                trade.status === 'planned' || trade.status === 'open'
                  ? '—'
                  : fmtR(v as number)
              }
              inputType="number"
              step="0.1"
              onSave={(v) => updateTradeData(trade.id, { rMultiple: v as number })}
            />
          </Section>

          <Section title="时间">
            <EditableDateRow
              label="开仓"
              value={trade.openedAt}
              preview={datePreview('开仓', trade.openedAt)}
              onSave={(v) => updateTradeData(trade.id, { openedAt: v })}
            />
            {isTerminal(trade.status) ? (
              <EditableDateRow
                label="平仓"
                value={trade.closedAt ?? trade.openedAt}
                preview={datePreview('平仓', trade.closedAt ?? trade.openedAt)}
                onSave={(v) => updateTradeData(trade.id, { closedAt: v })}
              />
            ) : (
              <DataRow label="平仓" value="—" />
            )}
          </Section>

          <Section title="标签">
            <TagEditor
              tags={trade.tags}
              suggestions={allTags}
              presets={tagPresets}
              onAdd={(tag) => addTag(trade.id, tag)}
              onRemove={(tag) => removeTag(trade.id, tag)}
              onAddPreset={addTagPreset}
              onRemovePreset={removeTagPreset}
              getTagPreview={(tag) => tagPreview(tag)}
            />
          </Section>

          <Section title="错误 / 违规">
            <TagEditor
              tags={trade.mistakeTags}
              suggestions={allMistakeTags}
              presets={mistakeTagPresets}
              getTagPreview={(tag) => tagPreview(tag, 'mistake')}
              onAddPreset={addMistakeTagPreset}
              onRemovePreset={removeMistakeTagPreset}
              onAdd={(tag) =>
                updateTradeData(trade.id, {
                  mistakeTags: trade.mistakeTags.includes(tag)
                    ? trade.mistakeTags
                    : [...trade.mistakeTags, tag],
                })
              }
              onRemove={(tag) =>
                updateTradeData(trade.id, {
                  mistakeTags: trade.mistakeTags.filter((t) => t !== tag),
                })
              }
            />
          </Section>

          <Section title="项目">
            <Menu
              value={trade.strategyId}
              onSelect={(v) => setStrategy(trade.id, v)}
              options={strategies.map((s) => ({
                value: s.id,
                label: s.name,
                icon: <StrategyIcon icon={s.icon} color={s.color} size={16} />,
              }))}
              trigger={
                <HoverPreview content={strategyPreview(trade.strategyId)}>
                  <button className="dv-pitem dv-pitem-ghost">
                    <StrategyLabel strategyId={trade.strategyId} strategies={strategies} />
                  </button>
                </HoverPreview>
              }
            />
            <Link to="/settings/strategies" className="dv-strategy-manage">
              管理策略…
            </Link>
          </Section>

          <div className="dv-props-foot">
            <button className="dv-copy-id" onClick={copyRef}>
              <Copy size={13} />
              <span>复制 {trade.ref}</span>
            </button>
          </div>
        </>
      )}
    />
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="dv-section">
      <button className="dv-section-head" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <ChevronDown
          size={13}
          className={'dv-section-chev' + (open ? '' : ' is-closed')}
        />
      </button>
      {open && <div className="dv-section-body">{children}</div>}
    </div>
  )
}

function PropTrigger({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <button type="button" className="dv-prop-row">
      <span className="dv-prop-label">{label}</span>
      <span className="dv-prop-value">{children}</span>
    </button>
  )
}

function EditableDataRow({
  label,
  value,
  format,
  inputType = 'text',
  step,
  nullable,
  color,
  onSave,
}: {
  label: string
  value: number | null
  format: (v: number | null) => string
  inputType?: 'number' | 'text'
  step?: string
  nullable?: boolean
  color?: string
  onSave: (v: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const startEdit = () => {
    setDraft(value == null ? '' : String(value))
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    if (nullable && draft.trim() === '') {
      if (value !== null) onSave(null)
      return
    }
    const num = parseFloat(draft)
    if (isNaN(num)) return
    if (num !== value) onSave(num)
  }

  if (editing) {
    return (
      <div className="dv-datarow dv-datarow-edit">
        <span className="dv-datarow-label">{label}</span>
        <input
          ref={inputRef}
          className="dv-datarow-input"
          type={inputType}
          step={step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      </div>
    )
  }

  return (
    <button className="dv-datarow dv-datarow-btn" onClick={startEdit} type="button">
      <span className="dv-datarow-label">{label}</span>
      <span className="dv-datarow-value" style={color ? { color } : undefined}>
        {format(value)}
      </span>
    </button>
  )
}

function EditableDateRow({
  label,
  value,
  preview,
  onSave,
}: {
  label: string
  value: string
  preview?: React.ReactNode
  onSave: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value.slice(0, 10))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commit = () => {
    setEditing(false)
    const d = draft.slice(0, 10)
    if (d && d !== value.slice(0, 10)) onSave(d)
  }

  if (editing) {
    return (
      <div className="dv-datarow dv-datarow-edit">
        <span className="dv-datarow-label">{label}</span>
        <input
          ref={inputRef}
          className="dv-datarow-input"
          type="date"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      </div>
    )
  }

  const row = (
    <button className="dv-datarow dv-datarow-btn" onClick={() => setEditing(true)} type="button">
      <span className="dv-datarow-label">{label}</span>
      <span className="dv-datarow-value">{fmtDate(value)}</span>
    </button>
  )

  if (!preview) return row
  return <HoverPreview content={preview}>{row}</HoverPreview>
}

function DataRow({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="dv-datarow">
      <span className="dv-datarow-label">{label}</span>
      <span className="dv-datarow-value" style={color ? { color } : undefined}>
        {value}
      </span>
    </div>
  )
}

function relativeDateLabel(value: string): string {
  const target = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(target.getTime())) return '日期待确认'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (days === 0) return '今天'
  if (days === 1) return '明天'
  if (days === -1) return '昨天'
  return days > 0 ? `${days} 天后` : `${Math.abs(days)} 天前`
}

function renderActivity(
  event: DisplayActivityEvent,
  strategies: Strategy[],
  tradeKind: TradeKind,
): React.ReactNode {
  const time = fmtDateTime(event.timestamp)
  switch (event.kind) {
    case 'create':
      return (
        <>
          你 <b>创建</b>了{tradeKind === 'case' ? '这条案例记录' : '这笔交易'} · {fmtDate(event.timestamp)}
        </>
      )
    case 'status':
      return (
        <>
          你将状态改为 <b>{STATUS_META[event.status!].label}</b> · {time}
        </>
      )
    case 'strategy':
      return (
        <>
          你将策略改为 <b>{getStrategyName(strategies, event.strategyId)}</b> · {time}
        </>
      )
    case 'tag':
      return event.tagAction === 'remove' ? (
        <>
          你移除了标签 <b>{event.tag}</b> · {time}
        </>
      ) : (
        <>
          你添加了标签 <b>{event.tag}</b> · {time}
        </>
      )
    case 'comment':
      return (
        <>
          你 <b>评论</b>：{event.text} · {time}
        </>
      )
    case 'note': {
      const edits = event.noteEditCount ?? 1
      return (
        <>
          你 <b>更新了复盘笔记</b>
          {edits > 1 ? `（${edits} 次）` : ''} · {time}
        </>
      )
    }
    case 'tradeKind': {
      const fromLabel = event.fromTradeKind ? TRADE_KIND_META[event.fromTradeKind]?.label : ''
      const toLabel = event.toTradeKind ? TRADE_KIND_META[event.toTradeKind]?.label : ''
      return (
        <>
          你将类型从 <b>{fromLabel}</b> 改为 <b>{toLabel}</b> · {time}
        </>
      )
    }
    default:
      return null
  }
}

function FeedItem({
  kind,
  children,
  deletable,
  onDelete,
}: {
  kind: ActivityKind
  children: React.ReactNode
  deletable?: boolean
  onDelete?: () => void
}) {
  const handleContextMenu = (e: React.MouseEvent) => {
    if (!deletable || !onDelete) return
    e.preventDefault()
    if (window.confirm('删除这条评论？')) onDelete()
  }

  return (
    <li
      className={'dv-feed-item' + (deletable ? ' dv-feed-item-deletable' : '')}
      onContextMenu={handleContextMenu}
    >
      <span className={'dv-feed-dot dv-feed-dot-' + kind} />
      <span className="dv-feed-text">{children}</span>
      {deletable && onDelete && (
        <Tooltip content="删除评论" label="删除评论">
          <button
            type="button"
            className="dv-feed-delete"
            aria-label="删除评论"
            onClick={onDelete}
          >
            <X size={13} />
          </button>
        </Tooltip>
      )}
    </li>
  )
}
