import { AssetObjectUrlScope } from './assetObjectUrls'
import { IndexedDbStorageAdapter } from './indexedDbAdapter'
import { ElectronStorageAdapter } from './electronAdapter'
import { resolveNoteForDisplayResult } from './assets'
import { useShortcutStore } from '@/store/shortcutStore'
import type { StorageAdapter } from './adapter'

function assert(value: unknown, message: string): asserts value { if (!value) throw Error(message) }
const originalImage = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY1sAAAAASUVORK5CYII='), c => c.charCodeAt(0))
async function verify(adapter: StorageAdapter, ids: string[], clear: () => void) {
  const scope = new AssetObjectUrlScope()
  const previous = useShortcutStore.getState()
  const originalRevoke = URL.revokeObjectURL
  const revoked = new Set<string>()
  URL.revokeObjectURL = url => { revoked.add(url); originalRevoke.call(URL, url) }
  try {
    const result = await resolveNoteForDisplayResult(ids.map(id => `<img src="journal-asset://${id}">`).join(''), adapter, scope)
    const doc = new DOMParser().parseFromString(result.html, 'text/html')
    const urls = [...doc.querySelectorAll('img')].map(img => img.src)
    assert(urls.length === 140 && result.editable, '大组正文必须保持全部原图可读')
    for (const url of urls) assert((await (await fetch(url)).arrayBuffer()).byteLength === originalImage.byteLength, '超过128张后，早先图片URL不得已被淘汰')
    useShortcutStore.getState().openLightbox(urls, 0)
    scope.release(); clear()
    assert((await (await fetch(urls[0])).arrayBuffer()).byteLength === originalImage.byteLength, '灯箱必须独立持有来源页已释放的原图')
    const exit = document.createElement('div')
    exit.className = 'ui-exit-clone'
    const image = document.createElement('img')
    image.src = urls[0]
    exit.append(image)
    document.body.append(exit)
    useShortcutStore.getState().closeLightbox()
    await new Promise(resolve => setTimeout(resolve, 20))
    assert(!revoked.has(urls[0]), '离场快照仍持有的图不能提前撤销')
    assert((await (await fetch(urls[0])).arrayBuffer()).byteLength === originalImage.byteLength, '离场快照期间原图地址仍须可读取')
    exit.remove()
    await new Promise(resolve => setTimeout(resolve, 20))
    assert(urls.every(url => revoked.has(url)), '快照离开且全部消费者释放后，退休地址必须逐个释放')
  } finally { scope.release(); useShortcutStore.setState(previous, true); clear(); URL.revokeObjectURL = originalRevoke }
}

async function run() {
  const name = `atlas-url-owner-isolated-${crypto.randomUUID()}`
  const idb = new IndexedDbStorageAdapter(name)
  try {
    await idb.open()
    const ids = []
    for (let i = 0; i < 140; i++) ids.push(await idb.saveAsset(new Blob([originalImage], { type: 'image/png' }), 'image/png'))
    await verify(idb, ids, () => idb.clearObjectUrlCache())
  } finally {
    idb.close()
    await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) })
  }
  const previous = window.journalBridge
  try {
    window.journalBridge = { isElectron: true, getAssetBytes: async (id: string) => ({ id, mime: 'image/png', bytes: [...originalImage] }) } as unknown as typeof window.journalBridge
    const native = new ElectronStorageAdapter()
    await verify(native, Array.from({ length: 140 }, (_, i) => `image-${i}`), () => native.clearObjectUrlCache())
  } finally { window.journalBridge = previous }
}
declare global { interface Window { __assetObjectUrlOwnershipTest?: Promise<void> } }
window.__assetObjectUrlOwnershipTest = run()
