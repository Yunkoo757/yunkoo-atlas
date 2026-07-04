import { useCallback, useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  type CaseImage,
  type CaseRecord,
  type DisputeType,
  deriveLifecycle,
  deriveOutcome,
  formatCaseId,
  getCaseNextAction,
  getDisputeType,
  OUTCOME_COLORS,
} from '@/data/case'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { getStorage } from '@/storage'
import { fmtDateTime } from '@/lib/format'
import { tradeDetailPath } from '@/lib/tradeRoute'
import type { Trade } from '@/data/trades'
import { X, Star, Trash2, RotateCcw, Check, Plus, Image, Link2, ArrowUpRight } from 'lucide-react'
import { toast } from '@/lib/toast'
import './CaseDetail.css'

export function CaseDetail({
  rec,
  disputeTypes,
  onClose,
}: {
  rec: CaseRecord
  disputeTypes: DisputeType[]
  onClose: () => void
}) {
  const updateCase = useStore((s) => s.updateCase)
  const removeCase = useStore((s) => s.removeCase)
  const trades = useStore((s) => s.trades)
  const strategies = useStore((s) => s.strategies)
  const openLightbox = useShortcutStore((s) => s.openLightbox)

  const dt = getDisputeType(rec.disputeTypeId, disputeTypes)
  const lifecycle = deriveLifecycle(rec)
  const outcome = deriveOutcome(rec, dt)
  const colors = OUTCOME_COLORS[outcome]
  const nextAction = getCaseNextAction(rec)
  const linkedTrades = (rec.linkedTradeIds ?? [])
    .map((id) => trades.find((t) => t.id === id))
    .filter((trade): trade is Trade => Boolean(trade))

  const [noteDraft, setNoteDraft] = useState(rec.note ?? '')
  const [tagInput, setTagInput] = useState('')
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [savingImages, setSavingImages] = useState(false)

  useEffect(() => {
    const urls: Record<string, string> = {}
    let cancelled = false
    Promise.all(
      rec.images.map(async (img) => {
        try {
          const url = await getStorage().getAssetObjectUrl(img.fileId)
          if (!url) return
          if (cancelled) {
            URL.revokeObjectURL(url)
            return
          }
          urls[img.fileId] = url
        } catch { /* ignore */ }
      }),
    ).then(() => { if (!cancelled) setImageUrls(urls) })
    return () => {
      cancelled = true
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [rec.images])

  useEffect(() => {
    setNoteDraft(rec.note ?? '')
  }, [rec.id, rec.note])

  const finalOptions = dt
    ? [...dt.options, '仍无法裁决', '废弃']
    : ['仍无法裁决', '废弃']

  const handleSetFinalVerdict = (verdict: string) => {
    const clearing = rec.finalVerdict === verdict
    updateCase(rec.id, {
      finalVerdict: clearing ? undefined : verdict,
      recheck: !clearing && verdict === '仍无法裁决' ? true : rec.recheck,
    })
    toast(rec.finalVerdict === verdict ? '已撤销最终裁决' : `最终裁决：${verdict}`)
  }

  const appendImageBlobs = useCallback(
    async (files: File[]) => {
      const imageFiles = files.filter((file) => file.type.startsWith('image/'))
      if (imageFiles.length === 0) return
      setSavingImages(true)
      try {
        const startOrder = rec.images.length
        const saved: CaseImage[] = []
        for (let i = 0; i < imageFiles.length; i++) {
          const file = imageFiles[i]
          const fileId = await getStorage().saveAsset(file, file.type)
          saved.push({ fileId, order: startOrder + i })
        }
        updateCase(rec.id, { images: [...rec.images, ...saved] })
        toast(`已补充 ${saved.length} 张截图`)
      } catch (err) {
        console.error('[case] append image failed', err)
        toast('截图保存失败')
      } finally {
        setSavingImages(false)
      }
    },
    [rec.id, rec.images, updateCase],
  )

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length > 0) void appendImageBlobs(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [appendImageBlobs])

  const handleSaveNote = () => {
    const trimmed = noteDraft.trim()
    updateCase(rec.id, { note: trimmed || undefined })
    toast('笔记已保存')
    if (!trimmed) setNoteDraft('')
  }

  const addTag = (tag: string) => {
    const t = tag.trim()
    if (!t) return
    const tags = rec.tags ?? []
    if (tags.includes(t)) return
    updateCase(rec.id, { tags: [...tags, t] })
    setTagInput('')
    toast(`已添加标签「${t}」`)
  }

  const removeTag = (tag: string) => {
    updateCase(rec.id, { tags: (rec.tags ?? []).filter((x) => x !== tag) })
  }

  const toggleStar = () => updateCase(rec.id, { star: !rec.star })
  const toggleRecheck = () => updateCase(rec.id, { recheck: !rec.recheck })

  const handleDelete = () => {
    removeCase(rec.id)
    toast('已移至回收站，30天后自动清空')
    onClose()
    // 跳转到回收站页面
    setTimeout(() => {
      window.location.href = '/trash'
    }, 1500)
  }

  return (
    <div className="cd-overlay" onMouseDown={onClose}>
      <div className="cd-panel" onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="cd-header">
          <div>
            <span className="cd-id">{formatCaseId(rec.id)}</span>
            <span className="cd-type">{dt?.name ?? '未知类型'}</span>
          </div>
          <button className="cd-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="cd-body">
          {/* 状态概览 */}
          <div className="cd-status-row">
            <span className="cd-status-chip" style={{ background: colors.bg, color: colors.dot }}>
              <span className="cd-dot" style={{ background: colors.dot }} />
              {colors.label}
            </span>
            <span className="cd-lifecycle">{lifecycle}</span>
            <span className="cd-confidence">信心度 {rec.confidence}%</span>
          </div>

          <div className={'cd-next-action cd-next-action-' + nextAction.tone}>
            <span className="cd-next-label">下一步</span>
            <span className="cd-next-value">{nextAction.label}</span>
          </div>

          <div className="cd-field">
            <span className="cd-label">来源交易</span>
            {linkedTrades.length === 0 ? (
              <div className="cd-source-empty">
                <Link2 size={14} />
                <span>这条判例还没有来源交易。建议从交易详情的“沉淀为判例”入口创建。</span>
              </div>
            ) : (
              <div className="cd-source-list">
                {linkedTrades.map((trade) => {
                  const strategy = strategies.find((s) => s.id === trade.strategyId)
                  return (
                    <Link
                      key={trade.id}
                      className="cd-source-card"
                      to={tradeDetailPath(trade)}
                    >
                      <span className="cd-source-ref">{trade.ref}</span>
                      <span className="cd-source-symbol">{trade.symbol}</span>
                      <span className="cd-source-strategy">{strategy?.name ?? '未设置策略'}</span>
                      <ArrowUpRight size={13} />
                    </Link>
                  )
                })}
              </div>
            )}
          </div>

          {/* 初始裁决 */}
          <div className="cd-field">
            <span className="cd-label">判断</span>
            <span className="cd-value">{rec.initialVerdict}</span>
          </div>

          {/* 最终裁决 */}
          <div className="cd-field">
            <span className="cd-label">最终裁决</span>
            <div className="cd-btn-group">
              {finalOptions.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={'cd-btn' + (rec.finalVerdict === opt ? ' is-on' : '')}
                  onClick={() => handleSetFinalVerdict(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
            {!rec.finalVerdict && (
              <span className="cd-hint">未设置最终裁决，当前状态为「待验证」</span>
            )}
          </div>

          {/* 标签 */}
          <div className="cd-field">
            <span className="cd-label">标签</span>
            <div className="cd-tags">
              {(rec.tags ?? []).map((t) => (
                <span className="cd-tag" key={t}>
                  {t}
                  <button
                    className="cd-tag-remove"
                    onClick={() => removeTag(t)}
                    title={`移除「${t}」`}
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            <div className="cd-tag-input-row">
              <input
                className="cd-input"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput) }
                }}
                placeholder="输入标签…"
                maxLength={20}
              />
              <button
                className="cd-btn-sm"
                onClick={() => addTag(tagInput)}
                disabled={!tagInput.trim()}
              >
                <Plus size={12} />
              </button>
            </div>
          </div>

          {/* 笔记 */}
          <div className="cd-field">
            <span className="cd-label">复盘笔记</span>
            <textarea
              className="cd-textarea"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="复盘笔记…"
              rows={4}
            />
            <button
              className="cd-btn-sm cd-btn-save"
              onClick={handleSaveNote}
            >
              <Check size={12} />
              <span>保存笔记</span>
            </button>
          </div>

          {/* 截图区 */}
          <div className="cd-field">
            <span className="cd-label">证据截图 ({rec.images.length})</span>
            {rec.images.length === 0 ? (
              <div
                className="cd-images-empty"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  void appendImageBlobs(Array.from(e.dataTransfer.files))
                }}
              >
                <Image size={16} />
                <span>{savingImages ? '保存截图中…' : '粘贴或拖入截图补证据'}</span>
              </div>
            ) : (
              <div
                className="cd-images-strip"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  void appendImageBlobs(Array.from(e.dataTransfer.files))
                }}
              >
                {rec.images.map((img, idx) => {
                  const src = imageUrls[img.fileId]
                  const urls = rec.images
                    .map((i) => imageUrls[i.fileId])
                    .filter(Boolean) as string[]
                  return (
                    <div
                      className="cd-image-thumb"
                      key={img.fileId}
                      title={img.label ?? '点击放大查看'}
                      onClick={() => {
                        if (urls.length > 0) openLightbox(urls, idx)
                      }}
                    >
                      {src ? (
                        <img src={src} alt={img.label ?? '截图'} className="cd-image-img" />
                      ) : (
                        <span className="cd-image-placeholder">📷</span>
                      )}
                      {img.label && <span className="cd-image-label">{img.label}</span>}
                    </div>
                  )
                })}
                <button
                  type="button"
                  className="cd-image-add"
                  disabled={savingImages}
                  onClick={() => toast('可直接 Ctrl+V 粘贴截图，或拖入图片文件')}
                >
                  <Plus size={14} />
                  <span>{savingImages ? '保存中' : '补截图'}</span>
                </button>
              </div>
            )}
          </div>

          {/* 标志 */}
          <div className="cd-field">
            <span className="cd-label">标志</span>
            <div className="cd-btn-group">
              <button
                type="button"
                className={'cd-btn' + (rec.star ? ' is-star' : '')}
                onClick={toggleStar}
              >
                <Star size={13} fill={rec.star ? 'currentColor' : 'none'} />
                <span>{rec.star ? '典型案例' : '设为典型'}</span>
              </button>
              <button
                type="button"
                className={'cd-btn' + (rec.recheck ? ' is-recheck' : '')}
                onClick={toggleRecheck}
              >
                <RotateCcw size={13} />
                <span>{rec.recheck ? '需复看' : '设为需复看'}</span>
              </button>
            </div>
          </div>

          {/* 时间信息 */}
          <div className="cd-field">
            <span className="cd-label">时间</span>
            <div className="cd-time-row">
              <span>创建：{fmtDateTime(rec.createdAt)}</span>
              <span>更新：{fmtDateTime(rec.updatedAt)}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="cd-footer">
          <button
            className="cd-btn cd-btn-danger"
            onClick={handleDelete}
          >
            <Trash2 size={13} />
            <span>删除判例</span>
          </button>
        </div>
      </div>
    </div>
  )
}
