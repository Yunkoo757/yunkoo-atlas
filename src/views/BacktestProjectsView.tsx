import { Menu } from '@/components/Menu'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { BatchActionBar } from '@/components/ui/BatchActionBar'
import { Copy, MoreHorizontal, Trash2 } from '@/icons/appIcons'
import { ICON_SM } from '@/icons/iconSize'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { SaveStatusIndicator } from '@/components/SaveStatusIndicator'
import { Toolbar } from '@/components/ui/Toolbar'
import { ModalShell } from '@/components/ui/ModalShell'
import { Select } from '@/components/ui/Select'
import { DatePicker } from '@/components/ui/DatePicker'
import { OverflowTooltip, Tooltip } from '@/components/ui/Tooltip'
import { TradeList } from '@/components/trades/TradeList'
import { TradeRow } from '@/components/trades/TradeRow'
import { getProjectTrades, isBacktestProject, projectPath, summarizeBacktest, type BacktestProject } from '@/lib/backtestProjects'
import { tradeDetailNavState, tradeDetailPath } from '@/lib/tradeRoute'
import { rememberTradeReturnAnchor, useTradeReturnAnchor } from '@/hooks/useTradeReturnAnchor'
import { useWorkbenchListKeyboard } from '@/hooks/useWorkbenchListKeyboard'
import { requestScrollToTrade } from '@/lib/tradeScrollTargets'
import { getStorage } from '@/storage'
import { flushNoteDraftsToStore } from '@/storage/noteDrafts'
import { getTradingDayKey } from '@/lib/periods'
import { toast } from '@/lib/toast'
import { resolveTradeTruth } from '@/lib/tradeTruth'
import { buildTradeCtxItems } from '@/lib/tradeMenu'
import { transitionTradeStatus } from '@/lib/tradeTransition'
import { intersectSelectedTradeIds } from '@/lib/tradeView'
import { buildSafeTradeCopies } from '@/lib/tradeCopy'
import { getBatchCopyActionLabel } from '@/lib/tradeActionContract'
import type { Trade } from '@/data/trades'
import './BacktestProjectsView.css'
import '@/components/ui/FilterBar.css'
import '@/components/trades/QuickViewBar.css'

const number = (value: number | null, suffix = '') => value == null ? '—' : `${Number(value.toFixed(2))}${suffix}`

export function BacktestProjectsView() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const projects = useStore(state => state.backtestProjects)
  const trades = useStore(state => state.trades)
  const strategies = useStore(state => state.strategies)
  const starredIds = useStore(state => state.starredIds)
  const openComposer = useStore(state => state.openComposer)
  const saveProject = useStore(state => state.saveBacktestProject)
  const [scope, setScope] = useState<'active' | 'archived'>('active')
  const [recordScope, setRecordScope] = useState<'all' | 'pending' | 'missed'>('all')
  const [editing, setEditing] = useState<BacktestProject | 'new' | null>(null)
  const [panel, setPanel] = useState<'statistics' | 'info' | null>(null)
  const [exporting, setExporting] = useState(false)
  const [focusIndex, setFocusIndex] = useState(-1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<CtxState | null>(null)
  const [copyCandidateIds, setCopyCandidateIds] = useState<string[] | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const project = projects.find(item => item.id === id)
  const scopedProjects = useMemo(() => projects.filter(item => Boolean(item.archivedAt) === (scope === 'archived')), [projects, scope])
  const records = useMemo(() => id ? getProjectTrades(trades, id) : [], [trades, id])
  const stats = useMemo(() => summarizeBacktest(records), [records])
  const visible = useMemo(() => records.filter(trade => recordScope === 'all' || (recordScope === 'missed' ? trade.status === 'missed' : trade.status !== 'missed' && !resolveTradeTruth(trade).isResultComplete)), [records, recordScope])
  const groups = useMemo(() => [{ key: id ?? 'backtest', items: visible }], [id, visible])
  const openRecord = useCallback((trade: Trade) => {
    const from = { pathname: location.pathname, search: location.search, anchorTradeId: trade.id }
    rememberTradeReturnAnchor(from)
    navigate(tradeDetailPath(trade), { state: tradeDetailNavState(from) })
  }, [navigate, location.pathname, location.search])
  useTradeReturnAnchor()
  useWorkbenchListKeyboard({ items: visible, selectedIds, setSelectedIds, focusIndex, setFocusIndex, onOpenFocused: index => { if (visible[index]) openRecord(visible[index]!) }, enableNav: Boolean(project) })
  useEffect(() => {
    if (!id) return
    useShortcutStore.getState().setListContext({ filter: { type: 'all', tradeKind: 'backtest' }, listPath: projectPath(id), listSearch: location.search, orderedIds: visible.map(trade => trade.id) })
  }, [id, visible, location.search])
  useEffect(() => { setFocusIndex(-1) }, [id, recordScope])
  useEffect(() => { setPanel(null) }, [id])
  useEffect(() => {
    setSelectedIds(current => {
      const next = intersectSelectedTradeIds(current, visible)
      return next.size === current.size ? current : next
    })
    setContextMenu(null)
  }, [visible])
  useEffect(() => { setCopyCandidateIds(null) }, [id, recordScope])
  useEffect(() => { const trade = visible[focusIndex]; if (trade) requestScrollToTrade(trade.id) }, [focusIndex, visible])
  const toggleSelection = useCallback((trade: Trade) => {
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(trade.id)) next.delete(trade.id)
      else next.add(trade.id)
      return next
    })
  }, [])
  const openContextMenu = useCallback((event: React.MouseEvent, trade: Trade) => {
    event.preventDefault()
    const state = useStore.getState()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      originElement: event.currentTarget as HTMLElement,
      items: buildTradeCtxItems(trade, {
        setStatus: state.setStatus,
        requestTradeOpen: state.requestTradeOpen,
        changeStatus: status => transitionTradeStatus(trade, status, {
          setStatus: state.setStatus,
          requestTradeOpen: state.requestTradeOpen,
          requestTradeClose: state.requestTradeClose,
          toast,
        }),
        openComposer: state.openComposer,
        removeTrade: state.removeTrade,
        canCopy: !project?.archivedAt,
        toggleStar: state.toggleStar,
        isStarred: state.isStarred,
        createReviewCase: source => {
          const result = useStore.getState().createReviewCaseFromTrade(source.id)
          if (result.status !== 'created') { toast('原记录已变化，请重新打开'); return }
          toast('已提炼为案例')
          openRecord(result.reviewCase)
        },
      }),
    })
  }, [project?.archivedAt, openRecord])
  const batchDelete = () => {
    const actionableIds = intersectSelectedTradeIds(selectedIds, visible)
    if (!actionableIds.size) return
    const state = useStore.getState()
    const previousActionId = state.undoStack.at(-1)?.actionId
    state.removeTrades([...actionableIds])
    const latestActionId = useStore.getState().undoStack.at(-1)?.actionId
    const actionId = latestActionId !== previousActionId ? latestActionId : undefined
    toast(`已将 ${actionableIds.size} 条回测记录移至回收站，30 天后自动清空`, {
      label: '撤销',
      onClick: () => {
        if (actionId && useStore.getState().undo(actionId)) toast('已恢复删除的回测记录')
        else toast('目标记录之后已变化，无法安全撤销')
      },
    })
    setSelectedIds(new Set())
  }
  const requestBatchCopy = () => {
    const ids = intersectSelectedTradeIds(selectedIds, visible)
    if (ids.size && !project?.archivedAt) setCopyCandidateIds([...ids])
  }
  const confirmBatchCopy = () => {
    if (!copyCandidateIds || !project) return
    const state = useStore.getState()
    const latestProject = state.backtestProjects.find(item => item.id === project.id)
    const sourceById = new Map(getProjectTrades(state.trades, project.id).map(trade => [trade.id, trade]))
    const sources = copyCandidateIds.map(id => sourceById.get(id)).filter((trade): trade is Trade => Boolean(trade))
    if (!latestProject || latestProject.archivedAt || sources.length !== copyCandidateIds.length) {
      toast(latestProject?.archivedAt ? '项目已归档，请重新打开后复制' : '源记录已变化，请重新选择')
      setCopyCandidateIds(null)
      return
    }
    try {
      const copies = buildSafeTradeCopies(sources, state.trades, { now: new Date(), createId: () => crypto.randomUUID() })
      if (state.upsertTrades(copies) !== 'updated') throw new Error('复制失败，请重试')
      toast(`已复制 ${copies.length} 条待确认回测记录`)
      setSelectedIds(new Set())
    } catch (error) { toast(error instanceof Error ? error.message : '复制失败，请重试') }
    setCopyCandidateIds(null)
  }
  const createRecord = () => { if (project && !project.archivedAt) openComposer(null, 'backtest', project.id) }
  const exportProject = async () => {
    if (!project || exporting) return
    setExporting(true)
    try {
      if (!await flushNoteDraftsToStore()) throw new Error('图片尚未保存完成')
      const state = useStore.getState()
      const latestProject = state.backtestProjects.find(item => item.id === project.id)!
      const { buildBacktestAnalysisPackage } = await import('@/lib/backtestExport')
      const blob = await buildBacktestAnalysisPackage(latestProject, state.trades, assetId => getStorage().getAssetForExport(assetId), state.strategies)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `atlas-backtest-${project.symbol}-${project.startedAt}.zip`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      toast('已导出分析包：项目说明、JSON、CSV 和截图')
    } catch (error) { toast(`导出失败：${error instanceof Error ? error.message : '请重试'}`) }
    finally { setExporting(false) }
  }
  const updateLifecycle = (field: 'archivedAt' | 'completedAt') => {
    if (!project) return
    saveProject({ ...project, [field]: project[field] ? null : new Date().toISOString(), updatedAt: new Date().toISOString() })
  }
  const statistics = project ? [
    ['目标进度', `${stats.evaluatedCount} / ${project.targetCount}`, `${stats.recordedCount} 条记录${stats.pendingCount ? ` · ${stats.pendingCount} 待确认` : ''}${stats.observationCount ? ` · ${stats.observationCount} 未参与` : ''}`, '只计算结果已确认的模拟参与；待确认和未参与不计目标。达标后仍可继续记录。'],
    ['胜 / 负 / 保本', `${stats.winCount} / ${stats.lossCount} / ${stats.breakevenCount}`, '', '按已确认的模拟参与结果统计，不包含待确认和未参与。'],
    ['胜率', number(stats.winRate, '%'), '', '盈利笔数 ÷ 已确认笔数，分母包含保本。'],
    ['总 R', number(stats.rCount ? stats.totalR : null, ' R'), `${stats.rCount} / ${stats.evaluatedCount} 笔有效 R`, '仅汇总已确认记录中的有效 R；缺失 R 不补零。'],
    ['平均 R', number(stats.averageR, ' R'), '', '总 R ÷ 有效 R 笔数；没有有效 R 时不显示数值。'],
  ] : []
  return <div className={`backtest-page${id ? ' is-project' : ''}`}>
    <Toolbar title={project?.name ?? '回测项目'} titleTooltip={Boolean(project)} context={project ? <span className="backtest-progress">已确认 {stats.evaluatedCount} / {project.targetCount}{project.archivedAt ? <span className="backtest-lifecycle">已归档</span> : project.completedAt ? <span className="backtest-lifecycle">已完成</span> : null}</span> : undefined}
      actions={<><SaveStatusIndicator />{!id && <Button variant="primary" onClick={() => setEditing('new')}>新建项目</Button>}{project && <><Menu align="right" maxWidth={360} trigger={<Button variant="ghost" size="sm" aria-label="切换项目">切换项目</Button>} value={`project:${project.id}`} options={[
        { value: 'all', label: '全部项目' }, { type: 'separator' },
        ...projects.map(item => ({ value: `project:${item.id}`, label: `${item.name}${item.archivedAt ? '（已归档）' : ''}` })),
      ]} onSelect={value => { setRecordScope('all'); navigate(value === 'all' ? '/backtests' : projectPath(value.slice('project:'.length))) }} />
      <Menu align="right" trigger={<IconButton label="项目操作" tooltip="项目操作"><MoreHorizontal size={ICON_SM} /></IconButton>} options={[
        { value: 'info', label: '项目信息' },
        { value: 'edit', label: '项目设置' },
        { value: 'export', label: exporting ? '正在导出…' : '导出分析包' },
        { type: 'separator' },
        { value: 'complete', label: project.completedAt ? '继续回测' : '标记完成' },
        { value: 'archive', label: project.archivedAt ? '重新打开项目' : '归档项目' },
      ]} onSelect={value => { if (value === 'info') setPanel('info'); else if (value === 'edit') setEditing(project); else if (value === 'export') void exportProject(); else if (value === 'archive') updateLifecycle('archivedAt'); else if (value === 'complete') updateLifecycle('completedAt') }} /></>}</>} />
    {id && !project ? <div className="backtest-empty">项目不存在。<Link to="/backtests">返回全部项目</Link></div> : project ? <>
      <div className="ui-filter-bar backtest-filter-bar">
        <div className="quick-view-bar" role="group" aria-label="项目记录"><div className="quick-view-primary">
          {([{ value: 'all', label: '全部记录' }, { value: 'pending', label: '待确认' }, { value: 'missed', label: '未参与' }] as const).map(item => <button key={item.value} type="button" className={`quick-view-chip${recordScope === item.value ? ' is-active' : ''}`} aria-pressed={recordScope === item.value} onClick={() => setRecordScope(item.value)}>{item.label}</button>)}
        </div><span className="backtest-visible-count" title="按历史日期顺序">{visible.length} 条</span></div>
        <div className="backtest-summary" aria-label="整个项目统计摘要">
          {statistics.filter(([label]) => label === '胜率' || label === '总 R').map(([label, value, , explanation]) => <Tooltip key={label} asChild content={explanation} label={`${label}统计口径`}><button type="button" className="backtest-summary-metric" aria-label={`${label}，查看统计口径`}><span>{label}</span><OverflowTooltip text={value}><strong>{value}</strong></OverflowTooltip></button></Tooltip>)}
          <Button variant="ghost" size="sm" aria-label="项目统计" onClick={() => setPanel('statistics')}>统计</Button>
        </div>
      </div>
      <div className="list-scroll backtest-records" ref={scrollRef}>
        {visible.length ? <TradeList groups={groups} strategies={strategies} focusedId={visible[focusIndex]?.id ?? null} selectedIds={selectedIds} starredIds={starredIds} scrollParentRef={scrollRef} onOpen={openRecord} onSelect={toggleSelection} onClearSelection={() => setSelectedIds(new Set())} onToggleStar={trade => useStore.getState().toggleStar(trade.id)} onContextMenu={openContextMenu} onCreate={createRecord} recordLabel="回测记录"
          renderRow={(trade, context) => <TradeRow trade={trade} strategies={strategies} {...context} strategyStats={null} selected={selectedIds.has(trade.id)} starred={starredIds.includes(trade.id)} onOpen={openRecord} onSelect={toggleSelection} onContextMenu={openContextMenu} onToggleStar={item => useStore.getState().toggleStar(item.id)} />} /> : <div className="backtest-empty">{recordScope === 'all' ? <>{project.archivedAt ? '项目已归档，可从项目操作重新打开。' : <>按固定规则，记录第一笔历史交易机会。<Button variant="primary" onClick={createRecord}>新建回测记录</Button></>}</> : '这个分类还没有记录。'}</div>}
      </div>
    </> : <>
      <div className="ui-filter-bar backtest-filter-bar">
        <div className="quick-view-bar" role="group" aria-label="项目范围"><div className="quick-view-primary">
          {([{ value: 'active', label: '未归档' }, { value: 'archived', label: '已归档' }] as const).map(item => <button key={item.value} type="button" className={`quick-view-chip${scope === item.value ? ' is-active' : ''}`} aria-pressed={scope === item.value} onClick={() => setScope(item.value)}>{item.label}</button>)}
        </div></div><span className="backtest-visible-count">{scopedProjects.length} 个项目</span>
      </div>
      <div className="list-scroll backtest-projects">
      {scopedProjects.map(item => {
        const summary = summarizeBacktest(getProjectTrades(trades, item.id))
        const totalR = summary.rCount ? summary.totalR : null
        const rText = number(totalR, ' R')
        return <Link className="backtest-project-row" key={item.id} to={projectPath(item.id)}>
          <div className="backtest-project-identity">
            <div className="backtest-project-heading"><OverflowTooltip text={item.name}><strong>{item.name}</strong></OverflowTooltip><span className="backtest-project-status">{item.archivedAt ? '已归档' : item.completedAt ? '已完成' : '进行中'}</span></div>
            <div className="backtest-project-meta"><OverflowTooltip text={item.symbol}><span>{item.symbol}</span></OverflowTooltip><span aria-hidden="true">·</span><time dateTime={item.startedAt}>{item.startedAt} 开始</time></div>
          </div>
          <dl className="backtest-project-metrics">
            <div className="backtest-project-metric"><dt>已确认 / 目标</dt><dd className="backtest-project-count">{summary.evaluatedCount} / {item.targetCount}</dd></div>
            <div className="backtest-project-metric"><dt>胜率</dt><dd className="backtest-project-winrate">{number(summary.winRate, '%')}</dd></div>
            <div className="backtest-project-metric"><dt>总 R</dt><OverflowTooltip text={rText}><dd className={`backtest-project-r${totalR != null && totalR !== 0 ? totalR > 0 ? ' is-positive' : ' is-negative' : ''}`}>{rText}</dd></OverflowTooltip></div>
          </dl>
        </Link>
      })}
      {!scopedProjects.length && <div className="backtest-empty">{scope === 'archived' ? '尚无归档项目' : '新建项目，开始积累同一套规则下的交易机会。'}</div>}
      </div>
    </>}
    <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    {project && <BatchActionBar count={selectedIds.size}>
      <button type="button" className="batch-bar-action-btn" disabled={Boolean(project.archivedAt)} onClick={requestBatchCopy}><Copy size={ICON_SM} /><span>{getBatchCopyActionLabel(visible.filter(trade => selectedIds.has(trade.id)))}</span></button>
      <button type="button" className="batch-bar-action-btn batch-bar-action-btn-danger" onClick={batchDelete}><Trash2 size={ICON_SM} /><span>删除</span></button>
    </BatchActionBar>}
    {copyCandidateIds && <ModalShell title="确认复制所选记录" size="compact" onClose={() => setCopyCandidateIds(null)} footer={<><Button variant="bordered" onClick={() => setCopyCandidateIds(null)}>取消</Button><Button variant="primary" onClick={confirmBatchCopy}>创建 {copyCandidateIds.length} 条待确认记录</Button></>}>
      <p className="backtest-copy-description">将在当前项目生成独立副本，保留历史日期、品种、方向与分类，清空结果和复盘正文。</p>
    </ModalShell>}
    {editing && <ProjectEditor project={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSave={next => { saveProject(next); setEditing(null); navigate(projectPath(next.id)) }} />}
    {project && panel === 'statistics' && <ModalShell title="项目统计" size="compact" onClose={() => setPanel(null)}>
      <section className="backtest-stats" aria-label="全部项目记录统计">
        {statistics.map(([label, value, hint, explanation]) => <div className="backtest-stat" key={label}><Tooltip asChild content={explanation} label={`${label}统计口径`}><button className="backtest-stat-label" type="button" aria-label={`${label}，查看统计口径`}>{label}</button></Tooltip><OverflowTooltip text={value}><strong>{value}</strong></OverflowTooltip>{hint && <small>{hint}</small>}</div>)}
      </section>
    </ModalShell>}
    {project && panel === 'info' && <ModalShell title="项目信息" size="compact" onClose={() => setPanel(null)}>
      <div className="backtest-info"><p className="backtest-info-name">{project.name}</p><dl>
        <div><dt>固定品种</dt><dd>{project.symbol}</dd></div>
        <div><dt>历史范围</dt><dd>{project.startedAt}{stats.lastDate ? ` 至 ${stats.lastDate}` : ' 开始'}</dd></div>
        <div><dt>项目状态</dt><dd>{project.archivedAt ? '已归档' : project.completedAt ? '已完成，可继续补充' : '进行中'}</dd></div>
      </dl><section><h3>固定参与规则</h3><p className="backtest-info-rules">{project.rules || '未填写参与规则。'}</p></section></div>
    </ModalShell>}
  </div>
}

function ProjectEditor({ project, onClose, onSave }: { project: BacktestProject | null; onClose: () => void; onSave: (project: BacktestProject) => void }) {
  const symbols = useStore(state => state.symbolCatalog)
  const strategies = useStore(state => state.strategies)
  const locked = useStore(state => Boolean(project && state.trades.some(trade => trade.backtestProjectId === project.id)))
  const [name, setName] = useState(project?.name ?? '')
  const [symbol, setSymbol] = useState(project?.symbol ?? symbols[0] ?? '')
  const [startedAt, setStartedAt] = useState(project?.startedAt ?? getTradingDayKey(new Date(), useStore.getState().display.tradingDayStartHour))
  const [target, setTarget] = useState(String(project?.targetCount ?? 100))
  const [strategyId, setStrategyId] = useState(project?.defaultStrategyId ?? '')
  const [rules, setRules] = useState(project?.rules ?? '')
  const [errors, setErrors] = useState<Partial<Record<'name' | 'symbol' | 'startedAt' | 'target', string>>>({})
  const clearError = (field: keyof typeof errors) => setErrors(current => ({ ...current, [field]: undefined }))
  const save = () => {
    const now = new Date().toISOString()
    const next: BacktestProject = { id: project?.id ?? crypto.randomUUID(), name: name.trim(), symbol, startedAt, targetCount: Number(target), defaultStrategyId: strategyId || null, rules: rules.trim(), archivedAt: project?.archivedAt ?? null, completedAt: project?.completedAt ?? null, createdAt: project?.createdAt ?? now, updatedAt: now }
    const nextErrors: typeof errors = {}
    if (!next.name) nextErrors.name = '请填写项目名称。'
    if (!next.symbol.trim()) nextErrors.symbol = '请选择固定品种。'
    if (!Number.isInteger(next.targetCount) || next.targetCount < 1 || next.targetCount > 100000) nextErrors.target = '目标笔数须为 1 至 100000 的整数。'
    if (!isBacktestProject({ ...next, name: next.name || '项目', symbol: next.symbol || '品种', targetCount: 100 })) nextErrors.startedAt = '请选择有效的历史开始日期。'
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      const selector = nextErrors.name ? '#backtest-project-name' : nextErrors.symbol ? '[aria-label="项目品种"]' : nextErrors.startedAt ? '[aria-label="项目历史开始日期"]' : '#backtest-target'
      document.querySelector<HTMLElement>(selector)?.focus()
      return
    }
    onSave(next)
  }
  return <ModalShell title={project ? '项目设置' : '新建回测项目'} size="compact" onClose={onClose} initialFocusSelector="#backtest-project-name" footer={<><Button variant="bordered" onClick={onClose}>取消</Button><Button variant="primary" onClick={save}>{project ? '保存' : '创建项目'}</Button></>}>
    <div className="backtest-form">
      <label htmlFor="backtest-project-name">项目名称<input id="backtest-project-name" value={name} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'backtest-name-error' : undefined} maxLength={100} placeholder="例如：XAUUSD 顺势参与 · 100笔" onChange={event => { clearError('name'); setName(event.target.value) }} />{errors.name && <span id="backtest-name-error" role="alert" className="backtest-form-error">{errors.name}</span>}</label>
      <div className="backtest-form-pair"><div className="backtest-field"><label htmlFor={locked ? 'backtest-fixed-symbol' : undefined}>固定品种</label>{locked ? <input id="backtest-fixed-symbol" aria-label="项目品种" value={symbol} readOnly /> : <Select value={symbol} onValueChange={value => { clearError('symbol'); setSymbol(value) }} ariaLabel="项目品种" options={[...new Set([symbol, ...symbols])].filter(Boolean).map(value => ({ value, label: value }))} />}{errors.symbol && <span role="alert" className="backtest-form-error">{errors.symbol}</span>}</div><div className="backtest-field"><label htmlFor={locked ? 'backtest-fixed-start' : undefined}>历史开始</label>{locked ? <input id="backtest-fixed-start" aria-label="项目历史开始日期" value={startedAt} readOnly /> : <DatePicker value={startedAt} onValueChange={value => { clearError('startedAt'); setStartedAt(value) }} ariaLabel="项目历史开始日期" />}{errors.startedAt && <span role="alert" className="backtest-form-error">{errors.startedAt}</span>}</div></div>
      <label htmlFor="backtest-target">目标笔数<input id="backtest-target" type="number" min={1} max={100000} step={1} value={target} aria-invalid={Boolean(errors.target)} aria-describedby={errors.target ? 'backtest-target-error' : 'backtest-target-help'} onChange={event => { clearError('target'); setTarget(event.target.value) }} />{errors.target ? <span id="backtest-target-error" role="alert" className="backtest-form-error">{errors.target}</span> : <span id="backtest-target-help" className="backtest-form-help">达标后仍可继续记录，不限制结束日期。</span>}</label>
      <label>默认策略分类<Select value={strategyId} onValueChange={setStrategyId} ariaLabel="项目默认策略" options={[{ value: '', label: '沿用新建默认策略' }, ...strategies.map(strategy => ({ value: strategy.id, label: strategy.name }))]} /></label>
      <details><summary>固定参与规则{locked ? '（已固定）' : '（可选）'}</summary>{locked ? <p className="backtest-fixed-rules">{rules || '未填写参与规则。'}</p> : <textarea aria-label="固定参与规则" value={rules} maxLength={20000} rows={4} onChange={event => setRules(event.target.value)} placeholder="参与条件、进场、止损及出场；策略分类变动不会改写规则。" />}</details>
      <p className="backtest-form-help">{locked ? '已有记录后，品种、历史开始和参与规则固定；测试新规则请新建项目。' : '首笔记录保存后，品种、历史开始和参与规则将固定。'}</p>
    </div>
  </ModalShell>
}
