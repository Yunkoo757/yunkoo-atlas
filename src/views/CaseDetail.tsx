import { useState, useEffect } from 'react'
import {
  type CaseRecord,
  type DisputeType,
  deriveLifecycle,
  deriveOutcome,
  formatCaseId,
  getDisputeType,
  OUTCOME_COLORS,
} from '@/data/case'
import { useStore } from '@/store/useStore'
import { useShortcutStore } from '@/store/shortcutStore'
import { getStorage } from '@/storage'
import { fmtDateTime } from '@/lib/format'
import { X, Star, Trash2, RotateCcw, Check, Plus, Image } from 'lucide-react'
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
  const openLightbox = useShortcutStore((s) => s.openLightbox)

  const dt = getDisputeType(rec.disputeTypeId, disputeTypes)
  const lifecycle = deriveLifecycle(rec)
  const outcome = deriveOutcome(rec, dt)
  const colors = OUTCOME_COLORS[outcome]

  const [noteDraft, setNoteDraft] = useState(rec.note ?? '')
  const [tagInput, setTagInput] = useState('')
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    const urls: Record<string, string> = {}
    let cancelled = false
    Promise.all(
      rec.images.map(async (img) => {
        try {
          const url = await getStorage().getAssetObjectUrl(img.fileId)
          if (url && !cancelled) urls[img.fileId] = url
        } catch { /* ignore */ }
      }),
    ).then(() => { if (!cancelled) setImageUrls(urls) })
    return () => { cancelled = true }
  }, [rec.images])

  const finalOptions = dt
    ? [...dt.options, '仍无法裁决', '废弃']
    : ['仍无法裁决', '废弃']

  const handleSetFinalVerdict = (verdict: string) => {
    updateCase(rec.id, { finalVerdict: rec.finalVerdict === verdict ? undefined : verdict })
    toast(rec.finalVerdict === verdict ? '已撤销最终裁决' : `最终裁决：${verdict}`)
  }

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
    if (!window.confirm(`确定删除判例 ${formatCaseId(rec.id)}？此操作不可撤销。`)) return
    removeCase(rec.id)
    toast('判例已删除')
    onClose()
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

          {/* 初始裁决 */}
          <div className="cd-field">
            <span className="cd-label">初始裁决</span>
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
            <span className="cd-label">笔记</span>
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
            <span className="cd-label">截图 ({rec.images.length})</span>
            {rec.images.length === 0 ? (
              <div className="cd-images-empty">
                <Image size={16} />
                <span>暂无截图</span>
              </div>
            ) : (
              <div className="cd-images-strip">
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
