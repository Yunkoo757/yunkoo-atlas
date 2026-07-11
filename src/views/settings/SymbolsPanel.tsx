import { useMemo, useRef, useState } from 'react'
import { ImagePlus, RotateCcw, Shapes, Trash2 } from '@/icons/appIcons'
import { SymbolIcon } from '@/components/SymbolIcon'
import { SymbolPresetSvg } from '@/components/SymbolPresetSvg'
import {
  SYMBOL_ICON_PRESETS,
  collectSymbolOptions,
  normalizeSymbol,
  resizeSymbolIconImage,
} from '@/lib/symbolIcons'
import { toast } from '@/lib/toast'
import { useStore } from '@/store/useStore'
import './SymbolsPanel.css'

export function SymbolsPanel() {
  const trades = useStore((state) => state.trades)
  const symbolCatalog = useStore((state) => state.symbolCatalog)
  const symbolIcons = useStore((state) => state.symbolIcons)
  const addSymbolToCatalog = useStore((state) => state.addSymbolToCatalog)
  const removeSymbolFromCatalog = useStore((state) => state.removeSymbolFromCatalog)
  const setSymbolIconPreset = useStore((state) => state.setSymbolIconPreset)
  const setSymbolIconCustom = useStore((state) => state.setSymbolIconCustom)
  const clearSymbolIcon = useStore((state) => state.clearSymbolIcon)
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const symbols = useMemo(
    () => collectSymbolOptions(symbolCatalog, trades.map((trade) => trade.symbol)),
    [symbolCatalog, trades],
  )

  const active = selected && symbols.includes(selected) ? selected : symbols[0] ?? null
  const inCatalog = active ? symbolCatalog.includes(active) : false
  const usedInTrades = active
    ? trades.some((trade) => normalizeSymbol(trade.symbol) === active)
    : false

  const addSymbol = () => {
    const key = normalizeSymbol(draft)
    if (!key) return
    addSymbolToCatalog(key)
    setSelected(key)
    setDraft('')
    toast(`已添加品种 ${key}`)
  }

  const removeSymbol = () => {
    if (!active) return
    removeSymbolFromCatalog(active)
    clearSymbolIcon(active)
    setSelected(null)
    toast(
      usedInTrades
        ? `已从目录移除 ${active}（已有交易仍保留该品种）`
        : `已移除品种 ${active}`,
    )
  }

  const onUpload = async (file: File | null) => {
    if (!active || !file) return
    try {
      const dataUrl = await resizeSymbolIconImage(file)
      setSymbolIconCustom(active, dataUrl)
      toast(`已更新 ${active} 图标`)
    } catch {
      toast('图标上传失败')
    }
  }

  return (
    <div className="settings-page symbols-panel">
      <div className="settings-page-head">
        <h1 className="settings-page-title">品种</h1>
        <p className="settings-page-desc">
          这里维护的品种目录会与新建交易下拉同步，并为每个品种配置 Notion 风格小图标。
        </p>
      </div>

      <div className="symbols-layout">
        <section className="symbols-list-panel" aria-label="品种列表">
          <div className="symbols-add-row">
            <input
              className="symbols-input"
              value={draft}
              placeholder="添加品种，如 BTCUSDT"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addSymbol()
              }}
            />
            <button type="button" className="symbols-btn" onClick={addSymbol}>
              添加
            </button>
          </div>
          {symbols.length === 0 ? (
            <p className="symbols-empty">还没有品种。先记一笔交易，或手动添加。</p>
          ) : (
            <ul className="symbols-list">
              {symbols.map((symbol) => (
                <li key={symbol}>
                  <button
                    type="button"
                    className={'symbols-item' + (active === symbol ? ' is-active' : '')}
                    onClick={() => setSelected(symbol)}
                  >
                    <SymbolIcon symbol={symbol} overrides={symbolIcons} size={18} />
                    <span>{symbol}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="symbols-editor" aria-label="图标编辑">
          {active ? (
            <>
              <div className="symbols-preview">
                <SymbolIcon symbol={active} overrides={symbolIcons} size={40} />
                <div>
                  <div className="symbols-preview-name">{active}</div>
                  <div className="symbols-preview-hint">
                    {inCatalog
                      ? '已在新建交易目录中 · 选择预设或上传自定义图标'
                      : '来自历史交易 · 选择预设或上传后会加入目录'}
                  </div>
                </div>
              </div>

              <div className="symbols-section-label">
                <Shapes size={14} />
                <span>预设图标</span>
              </div>
              <div className="symbols-preset-grid">
                {SYMBOL_ICON_PRESETS.map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    className={
                      'symbols-preset' +
                      (symbolIcons[active]?.presetId === preset.id && !symbolIcons[active]?.customDataUrl
                        ? ' is-active'
                        : '')
                    }
                    onClick={() => {
                      setSymbolIconPreset(active, preset.id)
                      toast(`已应用预设「${preset.label}」`)
                    }}
                    title={preset.label}
                  >
                    <span
                      className="symbols-preset-swatch"
                      style={{ color: preset.color, background: preset.background }}
                    >
                      {preset.svgId ? (
                        <SymbolPresetSvg id={preset.svgId} size={14} />
                      ) : (
                        preset.glyph
                      )}
                    </span>
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>

              <div className="symbols-actions">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  onChange={(event) => {
                    void onUpload(event.target.files?.[0] ?? null)
                    event.target.value = ''
                  }}
                />
                <button
                  type="button"
                  className="symbols-btn symbols-btn-primary"
                  onClick={() => fileRef.current?.click()}
                >
                  <ImagePlus size={14} />
                  <span>上传图标</span>
                </button>
                <button
                  type="button"
                  className="symbols-btn"
                  onClick={() => {
                    clearSymbolIcon(active)
                    toast(`已恢复 ${active} 默认图标`)
                  }}
                >
                  <RotateCcw size={14} />
                  <span>恢复默认</span>
                </button>
                {inCatalog ? (
                  <button type="button" className="symbols-btn" onClick={removeSymbol}>
                    <Trash2 size={14} />
                    <span>从目录移除</span>
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="symbols-empty">选择左侧品种后即可配置图标。</p>
          )}
        </section>
      </div>
    </div>
  )
}
