import { requestJudgmentCapture } from '@/components/judgment/captureRequest'
import { isSafeAssetId } from '@/storage/assetId'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Download, Maximize2 } from '@/icons/appIcons'
import { ContextMenu, type CtxState } from '@/components/ContextMenu'
import { useShortcutStore } from '@/store/shortcutStore'
import { requestLightboxReset } from '@/lib/lightboxView'
import { toast } from '@/lib/toast'
import { ICON_SM } from '@/icons/iconSize'

export function imageForContext(target: Element): HTMLImageElement | null {
  if (target instanceof HTMLImageElement) return target
  // The full-screen image ignores pointer events to support panning.
  return target.closest('.img-lightbox-viewport')?.querySelector<HTMLImageElement>('img') ?? null
}
export async function imagePng(image: HTMLImageElement): Promise<Uint8Array> {
  if (!image.complete || !image.naturalWidth) throw new Error('图片尚未载入，请稍后重试')
  if (image.naturalWidth * image.naturalHeight > 64 * 1024 * 1024) throw new Error('图片过大，无法处理')
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法读取图片')
  context.drawImage(image, 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片转换失败')), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}
export function ImageActions() {
  const [menu, setMenu] = useState<CtxState | null>(null)
  const busy = useRef(false)
  const lightbox = useShortcutStore(s => s.lightbox)
  useEffect(() => setMenu(null), [lightbox])
  const close = useCallback(() => setMenu(null), [])
  useEffect(() => {
    const open = (image: HTMLImageElement, x: number, y: number) => {
      const ready = image.complete && image.naturalWidth > 0
      const full = !!image.closest('.img-lightbox-overlay')
      const original = image.dataset.assetId ? image : [...document.querySelectorAll<HTMLImageElement>('img[data-asset-id]')].find(i => i.src === image.src)
      const assetId = original?.dataset.assetId
      const sourceTradeId = original?.closest<HTMLElement>('[data-source-trade-id]')?.dataset.sourceTradeId ?? null
      const output = async (action: 'copy' | 'save') => {
        if (busy.current) return
        busy.current = true
        try {
          const handler = window.journalBridge?.outputImage
          if (!handler) throw new Error('请重启最新客户端后重试')
          const bytes = await imagePng(image)
          if (await handler(action, bytes)) toast(action === 'copy' ? '图片已复制' : '图片已保存')
        } catch (error) { toast(error instanceof Error ? error.message : '图片操作失败', { tone: 'error' }) }
        finally { busy.current = false }
      }
      setMenu({x, y, items: [
        ...(assetId && isSafeAssetId(assetId) ? [{type:'item' as const,label:'加入判断台…',onClick:()=>requestJudgmentCapture({assetId,sourceTradeId})}] : []),
        {type:'item',label:'复制图片',icon:<Copy size={ICON_SM}/>,disabled:!ready,onClick:()=>void output('copy')},
        {type:'item',label:'另存为 PNG…',icon:<Download size={ICON_SM}/>,disabled:!ready,onClick:()=>void output('save')},
        {type:'divider'},
        ...(full ? [{type:'item' as const,label:'原始大小 · 1:1',disabled:!ready,onClick:()=>window.dispatchEvent(new Event('atlas-image-actual-size'))}] : []),
        {type:'item',label:full ? '适合窗口' : '查看大图',icon:<Maximize2 size={ICON_SM}/>,disabled:!ready,onClick:()=>{if(full)requestLightboxReset();else useShortcutStore.getState().openLightbox([image.currentSrc || image.src],0)}},
      ]})
    }
    const context = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const image = imageForContext(event.target)
      if (!image) return
      event.preventDefault(); event.stopPropagation()
      open(image,event.clientX,event.clientY)
    }
    const toolbar = (event: Event) => {
      const {image,x,y} = (event as CustomEvent<{image:HTMLImageElement;x:number;y:number}>).detail
      open(image,x,y)
    }
    document.addEventListener('contextmenu',context,true)
    window.addEventListener('atlas-image-actions',toolbar)
    return ()=>{document.removeEventListener('contextmenu',context,true);window.removeEventListener('atlas-image-actions',toolbar)}
  }, [])
  return <ContextMenu state={menu} onClose={close} className={lightbox ? 'image-actions-lightbox-menu' : undefined}/>
}
