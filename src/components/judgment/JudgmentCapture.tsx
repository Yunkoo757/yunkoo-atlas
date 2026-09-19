import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/store/useStore'
import { Button } from '@/components/ui/Button'
import { ModalShell } from '@/components/ui/ModalShell'
import { Select } from '@/components/ui/Select'
import { JudgmentImage } from './JudgmentImage'
import { ImageOrder, SortableImages } from './ImageOrder'
import { toggleSourceImage } from '@/lib/judgment/images'
import type { JudgmentImage as ImageRef } from '@/lib/judgment/model'
import { collectAssetIdsFromNotes, getStorage } from '@/storage'
import { flushPersistNow } from '@/storage/persist'
import { lockStorageCutoverInteraction, isStorageCutoverInteractionLocked } from '@/storage/cutover'
import { toast } from '@/lib/toast'
import '@/views/JudgmentDeskView.css'

export default function JudgmentCapture({ initial, onClose }: { initial?: ImageRef; onClose: () => void }) {
  const data = useStore(s => s.judgmentDesk), trades = useStore(s => s.trades)
  const [themeId, setThemeId] = useState(data.currentThemeId ?? data.themes[0]?.id ?? '')
  const [newTheme, setNewTheme] = useState('')
  const [title, setTitle] = useState('')
  const [ordering, setOrdering] = useState(false)
  const recordId = initial?.sourceTradeId ?? null
  const [chosen, setChosen] = useState<ImageRef[]>(initial ? [initial] : [])
  const [files, setFiles] = useState<{ id: string; file: File }[]>([])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const committing = useRef(false), committed = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const record = trades.find(t => t.id === recordId)
  const images = record ? collectAssetIdsFromNotes([record]) : initial ? [initial.assetId] : []
  const toggle = (assetId: string) => setChosen(previous => toggleSourceImage(previous, assetId, recordId || null, images))
  const addFiles = (incoming: File[]) => {
    if (incoming.some(f => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(f.type) || f.size > 20 * 1024 * 1024)) { setError('请选择 PNG、JPEG、WebP 或 GIF，每张不超过 20 MB。'); return }
    setFiles(old => [...old, ...incoming.map(file => ({ id: crypto.randomUUID(), file }))]); setError('')
  }
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (busy || initial || committed.current) return
      const incoming = [...(event.clipboardData?.files ?? [])]
      if (incoming.length) { event.preventDefault(); addFiles(incoming) }
    }
    document.addEventListener('paste', paste)
    return () => document.removeEventListener('paste', paste)
  }, [busy, initial])
  const save = async () => {
    if (committing.current || isStorageCutoverInteractionLocked()) return
    if (!committed.current && ((!themeId && !newTheme.trim()) || (!chosen.length && !files.length))) { setError('请选择或新建一个主题，并至少选一张图片。'); input.current?.focus(); return }
    committing.current = true; setBusy(true); setError('')
    const unlock = lockStorageCutoverInteraction()
    try {
      if (!committed.current) {
        const storage = getStorage(), libraryId = (await storage.getManifest()).libraryId
        const added = [...chosen]
        for (const { file } of files) added.push({ assetId: await storage.saveAsset(file, file.type), sourceTradeId: null })
        if ((await storage.getManifest()).libraryId !== libraryId) throw new Error('资料库已切换，请重新收录')
        const sampleId = crypto.randomUUID(), target = themeId || crypto.randomUUID()
        useStore.getState().updateJudgmentDesk(d => ({ ...d,
          themes: themeId ? d.themes : [...d.themes, { id: target, title: newTheme.trim(), understanding: '' }],
          samples: [...d.samples, { id: sampleId, themeId: target, title: title.trim(), images: added, createdAt: new Date().toISOString(), opinion: null, note: '', reference: null }],
          currentThemeId: target, currentSampleId: sampleId,
        }))
        committed.current = true
      }
      await flushPersistNow()
      toast('已收录到判断台'); onClose()
    } catch (e) { setError(e instanceof Error ? e.message : '收录失败，请重试') }
    finally { unlock(); committing.current = false; setBusy(false) }
  }
  return <ModalShell title="收图" size="wide" busy={busy} onClose={onClose} footer={<><span className="jd-muted">已选 {chosen.length + files.length} 张</span><Button onClick={onClose}>取消</Button><Button variant="primary" busy={busy} onClick={() => void save()}>{committed.current ? '重试保存' : '收录'}</Button></>}>
    <div className="jd-fields">
      <div className="jd-field"><span>主题</span><Select ariaLabel="主题" value={themeId} options={[...data.themes.map(t => ({ value: t.id, label: t.title })), { value: '', label: '新建主题…' }]} onValueChange={setThemeId} disabled={committed.current} /></div>
      {!themeId && <label className="jd-field">新主题<input ref={input} value={newTheme} disabled={committed.current} onChange={e => setNewTheme(e.target.value)} placeholder="例如：4H 决策POI" /></label>}
      <input aria-label="素材名称（可选）" value={title} disabled={committed.current} onChange={e => setTitle(e.target.value)} placeholder="素材名称（可选）" />
      {record && <span className="jd-muted">{record.tradeKind === 'case' ? '案例' : '交易'} · {record.ref} · {record.symbol}</span>}
      {initial ? <>
        {ordering ? <ImageOrder disabled={busy || committed.current} images={chosen} onChange={setChosen} /> : <div className="jd-picker-images">{images.map(assetId => <JudgmentImage key={assetId} assetId={assetId} compact selected={chosen.some(i => i.assetId === assetId)} onSelect={committed.current ? undefined : () => toggle(assetId)} />)}</div>}
      </> : <>
        <label className="jd-field">上传或粘贴图片<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={committed.current} onChange={e => { addFiles([...(e.target.files ?? [])]); e.target.value = '' }} /></label>
        <SortableImages disabled={busy || committed.current} items={files} getKey={item => item.id} onChange={setFiles} render={item => <div className="jd-upload-preview"><UploadPreview file={item.file} /><Button size="sm" disabled={busy || committed.current} aria-label={`移除 ${item.file.name}`} onClick={() => setFiles(list => list.filter(f => f.id !== item.id))}>移除</Button></div>} />
      </>}
      {initial && chosen.length > 1 && <Button disabled={committed.current} onClick={() => setOrdering(v => !v)}>{ordering ? '返回选图' : '调整顺序'}</Button>}
      {error && <p role="alert" className="jd-error">{error}</p>}
    </div>
  </ModalShell>
}

function UploadPreview({ file }: { file: File }) {
  const [url, setUrl] = useState('')
  useEffect(() => { const value = URL.createObjectURL(file); setUrl(value); return () => URL.revokeObjectURL(value) }, [file])
  return <img className="jd-upload-image" src={url || undefined} draggable={false} alt={file.name} />
}
