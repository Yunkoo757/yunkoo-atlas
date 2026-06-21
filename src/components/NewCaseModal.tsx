import { createPortal } from 'react-dom'
import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Image } from 'lucide-react'
import type { CaseImage } from '@/data/case'
import { useStore } from '@/store/useStore'
import { getStorage } from '@/storage'
import { toast } from '@/lib/toast'

interface PendingImage {
  blob: Blob
  mime: string
  previewUrl: string
}

export function NewCaseModal() {
  const open = useStore((s) => s.caseModalOpen)
  const addCase = useStore((s) => s.addCase)
  const disputeTypes = useStore((s) => s.disputeTypes)
  const setCaseModalOpen = useStore((s) => s.setCaseModalOpen)
  const [disputeTypeId, setDisputeTypeId] = useState(disputeTypes[0]?.id ?? '')
  const [verdict, setVerdict] = useState('是')
  const [confidence, setConfidence] = useState<30 | 50 | 70 | 90>(70)
  const [images, setImages] = useState<PendingImage[]>([])
  const [saving, setSaving] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setDisputeTypeId(disputeTypes[0]?.id ?? '')
      setVerdict(disputeTypes[0]?.options[0] ?? '是')
      setConfidence(70)
      setImages([])
    }
  }, [open, disputeTypes])

  // Global paste handler
  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (!open) return
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile()
        if (blob) {
          const previewUrl = URL.createObjectURL(blob)
          setImages((prev) => [...prev, { blob, mime: item.type, previewUrl }])
        }
      }
    }
  }, [open])

  useEffect(() => {
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [handlePaste])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer.files
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.type.startsWith('image/')) {
        const previewUrl = URL.createObjectURL(file)
        setImages((prev) => [...prev, { blob: file, mime: file.type, previewUrl }])
      }
    }
  }, [])

  const removeImage = (idx: number) => {
    setImages((prev) => {
      URL.revokeObjectURL(prev[idx].previewUrl)
      return prev.filter((_, i) => i !== idx)
    })
  }

  if (!open) return null

  const dt = disputeTypes.find((d) => d.id === disputeTypeId)
  const options = dt?.options ?? ['是', '不是']

  const handleSave = async () => {
    setSaving(true)
    try {
      // Save images to storage
      const savedImages: CaseImage[] = []
      for (let i = 0; i < images.length; i++) {
        const { blob, mime } = images[i]
        try {
          const fileId = await getStorage().saveAsset(blob, mime)
          savedImages.push({ fileId, order: i })
        } catch (err) {
          console.error('[case] save image failed', err)
        }
      }

      // Clean up preview URLs
      images.forEach((img) => URL.revokeObjectURL(img.previewUrl))

      const now = new Date().toISOString()
      addCase({
        id: crypto.randomUUID(),
        disputeTypeId,
        initialVerdict: verdict,
        confidence,
        images: savedImages,
        createdAt: now,
        updatedAt: now,
      })
      toast(savedImages.length > 0 ? `判例已创建（${savedImages.length} 张截图）` : '判例已创建')
      setImages([])
      setCaseModalOpen(false)
    } catch {
      toast('创建失败')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="ncm-overlay" onMouseDown={() => setCaseModalOpen(false)}>
      <div className="ncm" onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span className="ncm-title">新建判例</span>
          <button onClick={() => setCaseModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>

        <div className="ncm-field">
          <span className="ncm-label">纠纷类型</span>
          <select
            className="ncm-select"
            value={disputeTypeId}
            onChange={(e) => {
              setDisputeTypeId(e.target.value)
              const selected = disputeTypes.find((d) => d.id === e.target.value)
              if (selected) setVerdict(selected.options[0])
            }}
          >
            {disputeTypes.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        <div className="ncm-field">
          <span className="ncm-label">初始裁决</span>
          <div className="ncm-btn-group">
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                className={'ncm-btn' + (verdict === opt ? ' is-on' : '')}
                onClick={() => setVerdict(opt)}
              >
                {opt}
              </button>
            ))}
            <button
              type="button"
              className={'ncm-btn' + (verdict === '暂不确定' ? ' is-on' : '')}
              onClick={() => setVerdict('暂不确定')}
            >
              暂不确定
            </button>
          </div>
        </div>

        <div className="ncm-field">
          <span className="ncm-label">信心度</span>
          <div className="ncm-btn-group">
            {([30, 50, 70, 90] as const).map((c) => (
              <button
                key={c}
                type="button"
                className={'ncm-btn' + (confidence === c ? ' is-on' : '')}
                onClick={() => setConfidence(c)}
              >
                {c}%
              </button>
            ))}
          </div>
        </div>

        {/* Image drop zone */}
        <div className="ncm-field">
          <span className="ncm-label">截图</span>
          <div
            ref={dropRef}
            className="ncm-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {images.length === 0 ? (
              <div className="ncm-drop-hint">
                <Image size={20} />
                <span>粘贴或拖入截图 (Ctrl+V)</span>
              </div>
            ) : (
              <div className="ncm-images">
                {images.map((img, i) => (
                  <div className="ncm-thumb" key={i}>
                    <img src={img.previewUrl} alt={`截图 ${i + 1}`} />
                    <button
                      className="ncm-thumb-remove"
                      onClick={() => removeImage(i)}
                      title="移除"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <div className="ncm-drop-more" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
                  <span>+</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="ncm-foot">
          <button className="ncm-cancel" onClick={() => setCaseModalOpen(false)}>取消</button>
          <button className="ncm-submit" onClick={handleSave} disabled={saving}>
            {saving ? '保存中…' : '创建判例'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
