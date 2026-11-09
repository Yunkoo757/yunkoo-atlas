import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import JudgmentCapture from './JudgmentCapture'
import { useStore } from '@/store/useStore'
import { getStorage } from '@/storage/provider'
import { disablePersistWrites } from '@/storage/persist'
import { emptyJudgmentDesk } from '@/lib/judgment/model'
import '@/styles/tokens.css'
import '@/styles/global.css'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function until(check: () => boolean) {
  for (let i = 0; i < 150; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 0)) }
  throw new Error('隔离收图状态未就绪')
}

async function run() {
  disablePersistWrites()
  const storage = getStorage(), originalSave = storage.saveAsset, originalManifest = storage.getManifest
  const original = useStore.getState().judgmentDesk
  const saves: string[] = []
  let failed = false, closed = false
  storage.getManifest = async () => ({ libraryId: 'isolated-capture', schemaVersion: 1, createdAt: '2026-11-10' })
  storage.saveAsset = async file => {
    const name = (file as File).name
    saves.push(name)
    if (name === 'second.png' && !failed) { failed = true; throw new Error('隔离测试：第二张保存失败') }
    return name === 'first.png' ? 'isolated-first' : 'isolated-second'
  }
  useStore.setState({ judgmentDesk: { ...emptyJudgmentDesk(), themes: [{ id: 'isolated-theme', title: '隔离测试主题', understanding: '' }], currentThemeId: 'isolated-theme' } })
  const root = createRoot(document.getElementById('root')!)
  try {
    flushSync(() => root.render(<JudgmentCapture onClose={() => { closed = true }} />))
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMZkAAAAASUVORK5CYII='), value => value.charCodeAt(0))
    const transfer = new DataTransfer()
    for (const name of ['first.png', 'second.png']) transfer.items.add(new File([bytes], name, { type: 'image/png' }))
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files })
    flushSync(() => input.dispatchEvent(new Event('change', { bubbles: true })))
    await until(() => {
      const previews = [...document.querySelectorAll<HTMLImageElement>('.jd-upload-image')]
      return previews.length === 2 && previews.every(image => image.complete && image.naturalWidth > 0)
    })
    const submit = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '收录')!
    submit().click()
    await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('第二张保存失败') === true)
    assert(!closed, '失败后保留原收图表单')
    submit().click()
    await until(() => closed)
    assert(saves.join(',') === 'first.png,second.png,second.png', '重试应复用第一张已保存原图，只重试失败的第二张')
    const samples = useStore.getState().judgmentDesk.samples
    assert(samples.length === 1, '重试只能发布一个素材')
    assert(samples[0]!.images.map(image => image.assetId).join(',') === 'isolated-first,isolated-second', '图片顺序与原件引用必须保持')
  } finally {
    root.unmount()
    storage.saveAsset = originalSave
    storage.getManifest = originalManifest
    useStore.setState({ judgmentDesk: original })
  }
}

declare global { interface Window { __judgmentCaptureRetryTest?: Promise<void> } }
window.__judgmentCaptureRetryTest = run()
