import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from '@/icons/appIcons'
import { ICON_MD, ICON_SM } from '@/icons/iconSize'
import type { Strategy } from '@/data/strategies'
import type { CaseType, TradeSide } from '@/data/trades'
import { Button } from '@/components/ui/Button'
import { ModalShell } from '@/components/ui/ModalShell'
import { Select } from '@/components/ui/Select'
import {
  normalizeReviewPoolLayout,
  type ReviewPoolFilters,
  type ReviewPoolLayout,
  type ReviewPoolPreset,
  type ReviewPoolRef,
  type ReviewPoolResult,
  type ReviewPoolSource,
  type SystemReviewPoolId,
} from '@/lib/reviewPools'

const SYSTEM_POOLS: ReadonlyArray<{ id: SystemReviewPoolId; label: string }> = [
  { id: 'all', label: '全部内容' },
  { id: 'cases', label: '只看案例' },
  { id: 'losses', label: '亏损日志' },
  { id: 'wins', label: '盈利日志' },
  { id: 'missed', label: '错过机会' },
  { id: 'boosted', label: '近期多看' },
]

const EMPTY_FILTERS: ReviewPoolFilters = {
  sources: [],
  results: [],
  caseTypes: [],
  strategyIds: [],
  symbols: [],
  sides: [],
  tags: [],
  mistakeTags: [],
  requireContent: false,
  stageSource: 'current-and-history',
}

const SOURCE_OPTIONS: Array<{ value: ReviewPoolSource; label: string }> = [
  { value: 'case', label: '案例' },
  { value: 'live', label: '实盘' },
  { value: 'paper', label: '模拟盘' },
]
const RESULT_OPTIONS: Array<{ value: ReviewPoolResult; label: string }> = [
  { value: 'win', label: '盈利' },
  { value: 'loss', label: '亏损' },
  { value: 'breakeven', label: '持平' },
  { value: 'missed', label: '错过' },
]
const CASE_TYPE_OPTIONS: Array<{ value: CaseType; label: string }> = [
  { value: 'exemplar', label: '优秀范例' },
  { value: 'mistake', label: '错误案例' },
  { value: 'ambiguous', label: '待定案例' },
  { value: 'missed', label: '错过案例' },
]
const SIDE_OPTIONS: Array<{ value: TradeSide; label: string }> = [
  { value: 'long', label: '做多' },
  { value: 'short', label: '做空' },
]

function refKey(ref: ReviewPoolRef): string {
  return `${ref.kind}:${ref.id}`
}

function splitList(value: string): string[] {
  return [...new Set(value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))]
}

function toggleValue<T extends string>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function ChoiceGroup<T extends string>({
  legend,
  values,
  options,
  onChange,
}: {
  legend: string
  values: readonly T[]
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (values: T[]) => void
}) {
  return (
    <fieldset className="review-pool-choice-group">
      <legend>{legend}</legend>
      <div>
        {options.map((option) => (
          <label key={option.value}>
            <input
              type="checkbox"
              checked={values.includes(option.value)}
              onChange={() => onChange(toggleValue(values, option.value))}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function ReviewPoolManagerModal({
  presets,
  layout,
  strategies,
  onSavePreset,
  onRemovePreset,
  onChangeLayout,
  onClose,
}: {
  presets: readonly ReviewPoolPreset[]
  layout: ReviewPoolLayout
  strategies: readonly Strategy[]
  onSavePreset: (preset: ReviewPoolPreset) => void
  onRemovePreset: (id: string) => void
  onChangeLayout: (layout: ReviewPoolLayout) => void
  onClose: () => void
}) {
  const normalizedLayout = useMemo(
    () => normalizeReviewPoolLayout(layout, presets.map((preset) => preset.id)),
    [layout, presets],
  )
  const [editing, setEditing] = useState<ReviewPoolPreset | 'new' | null>(null)

  const updateHomeOrder = (homeOrder: ReviewPoolRef[]) => onChangeLayout({
    ...normalizedLayout,
    homeOrder,
  })
  const isOnHome = (ref: ReviewPoolRef) => normalizedLayout.homeOrder.some(
    (item) => refKey(item) === refKey(ref),
  )
  const toggleHome = (ref: ReviewPoolRef) => {
    if (ref.kind === 'system' && ref.id === 'all') return
    if (isOnHome(ref)) {
      updateHomeOrder(normalizedLayout.homeOrder.filter((item) => refKey(item) !== refKey(ref)))
      return
    }
    if (normalizedLayout.homeOrder.length >= 6) return
    updateHomeOrder([...normalizedLayout.homeOrder, ref])
  }
  const moveHome = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (index === 0 || target < 1 || target >= normalizedLayout.homeOrder.length) return
    const next = [...normalizedLayout.homeOrder]
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    updateHomeOrder(next)
  }
  const toggleSystemVisibility = (id: Exclude<SystemReviewPoolId, 'all'>) => {
    const hidden = normalizedLayout.hiddenSystemIds.includes(id)
    onChangeLayout({
      homeOrder: hidden
        ? normalizedLayout.homeOrder
        : normalizedLayout.homeOrder.filter((item) => item.kind !== 'system' || item.id !== id),
      hiddenSystemIds: hidden
        ? normalizedLayout.hiddenSystemIds.filter((item) => item !== id)
        : [...normalizedLayout.hiddenSystemIds, id],
    })
  }

  if (editing) {
    return (
      <ReviewPoolEditor
        preset={editing === 'new' ? null : editing}
        strategies={strategies}
        onCancel={() => setEditing(null)}
        onSave={(preset) => {
          const wasNew = editing === 'new'
          onSavePreset(preset)
          if (wasNew && normalizedLayout.homeOrder.length < 6) {
            onChangeLayout({
              ...normalizedLayout,
              homeOrder: [...normalizedLayout.homeOrder, { kind: 'custom', id: preset.id }],
            })
          }
          setEditing(null)
        }}
      />
    )
  }

  const poolLabel = (ref: ReviewPoolRef) => ref.kind === 'system'
    ? SYSTEM_POOLS.find((item) => item.id === ref.id)?.label ?? ref.id
    : presets.find((item) => item.id === ref.id)?.name ?? '已删除的复盘池'

  return (
    <ModalShell
      title="管理复盘池"
      description="首页最多展示 6 个复盘池；全部内容固定在首位。"
      size="wide"
      onClose={onClose}
      footer={<Button type="button" variant="primary" onClick={onClose}>完成</Button>}
    >
      <section className="review-pool-manager-section">
        <div className="review-pool-manager-heading">
          <div><strong>首页顺序</strong><span>{normalizedLayout.homeOrder.length} / 6</span></div>
        </div>
        <ol className="review-pool-home-order">
          {normalizedLayout.homeOrder.map((ref, index) => (
            <li key={refKey(ref)}>
              <span>{poolLabel(ref)}</span>
              <div>
                <Button type="button" variant="ghost" size="sm" disabled={index <= 1} aria-label="上移" onClick={() => moveHome(index, -1)}><ChevronUp size={ICON_SM} /></Button>
                <Button type="button" variant="ghost" size="sm" disabled={index === 0 || index === normalizedLayout.homeOrder.length - 1} aria-label="下移" onClick={() => moveHome(index, 1)}><ChevronDown size={ICON_SM} /></Button>
                {index > 0 ? <Button type="button" variant="ghost" size="sm" onClick={() => toggleHome(ref)}>移出首页</Button> : <span className="review-pool-fixed">固定</span>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="review-pool-manager-section">
        <div className="review-pool-manager-heading"><strong>系统复盘池</strong></div>
        <div className="review-pool-manager-list">
          {SYSTEM_POOLS.map((pool) => {
            const ref: ReviewPoolRef = { kind: 'system', id: pool.id }
            const hidden = pool.id !== 'all' && normalizedLayout.hiddenSystemIds.includes(pool.id)
            return (
              <div key={pool.id} className="review-pool-manager-row">
                <div><strong>{pool.label}</strong><span>{hidden ? '已隐藏' : isOnHome(ref) ? '首页展示' : '可用'}</span></div>
                <div>
                  {pool.id !== 'all' ? <Button type="button" variant="ghost" size="sm" onClick={() => toggleSystemVisibility(pool.id as Exclude<SystemReviewPoolId, 'all'>)}>{hidden ? '取消隐藏' : '隐藏'}</Button> : null}
                  {!hidden && pool.id !== 'all' ? <Button type="button" variant="bordered" size="sm" disabled={!isOnHome(ref) && normalizedLayout.homeOrder.length >= 6} onClick={() => toggleHome(ref)}>{isOnHome(ref) ? '移出首页' : '放到首页'}</Button> : null}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="review-pool-manager-section">
        <div className="review-pool-manager-heading">
          <strong>自定义复盘池</strong>
          <Button type="button" variant="bordered" size="sm" onClick={() => setEditing('new')}><Plus size={ICON_SM} />新建</Button>
        </div>
        {presets.length === 0 ? <p className="review-pool-empty">还没有自定义复盘池。</p> : (
          <div className="review-pool-manager-list">
            {presets.map((preset) => {
              const ref: ReviewPoolRef = { kind: 'custom', id: preset.id }
              return (
                <div key={preset.id} className="review-pool-manager-row">
                  <div><strong>{preset.name}</strong><span>{isOnHome(ref) ? '首页展示' : '未放到首页'}</span></div>
                  <div>
                    <Button type="button" variant="ghost" size="sm" aria-label={`编辑 ${preset.name}`} onClick={() => setEditing(preset)}><Pencil size={ICON_SM} /></Button>
                    <Button type="button" variant="ghost" size="sm" aria-label={`删除 ${preset.name}`} onClick={() => {
                      if (window.confirm(`确定删除“${preset.name}”吗？`)) onRemovePreset(preset.id)
                    }}><Trash2 size={ICON_SM} /></Button>
                    <Button type="button" variant="bordered" size="sm" disabled={!isOnHome(ref) && normalizedLayout.homeOrder.length >= 6} onClick={() => toggleHome(ref)}>{isOnHome(ref) ? '移出首页' : '放到首页'}</Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </ModalShell>
  )
}

function ReviewPoolEditor({
  preset,
  strategies,
  onSave,
  onCancel,
}: {
  preset: ReviewPoolPreset | null
  strategies: readonly Strategy[]
  onSave: (preset: ReviewPoolPreset) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(preset?.name ?? '')
  const [filters, setFilters] = useState<ReviewPoolFilters>(() => preset
    ? { ...preset.filters, stageSource: preset.filters.stageSource ?? 'current-and-history' }
    : { ...EMPTY_FILTERS })
  const patch = (value: Partial<ReviewPoolFilters>) => setFilters((current) => ({ ...current, ...value }))
  const now = new Date().toISOString()

  return (
    <ModalShell
      title={preset ? '编辑复盘池' : '新建复盘池'}
      description="同一组内任一条件匹配即可，不同组之间需同时匹配；留空表示不限。"
      size="wide"
      onClose={onCancel}
      footer={<>
        <Button type="button" variant="ghost" onClick={onCancel}>取消</Button>
        <Button type="button" variant="primary" disabled={!name.trim()} onClick={() => onSave({
          id: preset?.id ?? crypto.randomUUID(),
          name: name.trim(),
          filters,
          createdAt: preset?.createdAt ?? now,
          updatedAt: now,
        })}>保存复盘池</Button>
      </>}
    >
      <div className="review-pool-editor">
        <label className="review-pool-field review-pool-field-wide">
          <span>名称</span>
          <input data-autofocus value={name} maxLength={40} placeholder="例如：突破失败复盘" onChange={(event) => setName(event.target.value)} />
        </label>
        <ChoiceGroup legend="内容来源" values={filters.sources} options={SOURCE_OPTIONS} onChange={(sources) => patch({ sources })} />
        <ChoiceGroup legend="结果" values={filters.results} options={RESULT_OPTIONS} onChange={(results) => patch({ results })} />
        <ChoiceGroup legend="案例类型" values={filters.caseTypes} options={CASE_TYPE_OPTIONS} onChange={(caseTypes) => patch({ caseTypes })} />
        <ChoiceGroup legend="方向" values={filters.sides} options={SIDE_OPTIONS} onChange={(sides) => patch({ sides })} />
        <fieldset className="review-pool-choice-group review-pool-strategy-group">
          <legend>策略</legend>
          <div>
            {strategies.map((strategy) => (
              <label key={strategy.id}>
                <input type="checkbox" checked={filters.strategyIds.includes(strategy.id)} onChange={() => patch({ strategyIds: toggleValue(filters.strategyIds, strategy.id) })} />
                <span>{strategy.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="review-pool-field"><span>品种</span><input defaultValue={filters.symbols.join('，')} placeholder="BTC，AAPL" onBlur={(event) => patch({ symbols: splitList(event.target.value) })} /></label>
        <label className="review-pool-field"><span>标签</span><input defaultValue={filters.tags.join('，')} placeholder="趋势，A+" onBlur={(event) => patch({ tags: splitList(event.target.value) })} /></label>
        <label className="review-pool-field"><span>错误标签</span><input defaultValue={filters.mistakeTags.join('，')} placeholder="追高，过早止损" onBlur={(event) => patch({ mistakeTags: splitList(event.target.value) })} /></label>
        <label className="review-pool-field">
          <span>实盘阶段</span>
          <Select
            value={typeof filters.stageSource === 'string' ? filters.stageSource : 'current-and-history'}
            ariaLabel="实盘阶段"
            options={[
              { value: 'current-and-history', label: '当前阶段 + 全部历史' },
              { value: 'current', label: '仅当前阶段' },
              { value: 'all-history', label: '全部历史阶段' },
            ]}
            onValueChange={(value) => patch({ stageSource: value as ReviewPoolFilters['stageSource'] })}
          />
        </label>
        <label className="review-pool-content-toggle">
          <input type="checkbox" checked={filters.requireContent} onChange={(event) => patch({ requireContent: event.target.checked })} />
          <span><strong>只保留有复盘内容的记录</strong><small>至少包含复盘笔记或截图</small></span>
        </label>
      </div>
    </ModalShell>
  )
}
