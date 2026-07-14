import { loadDetailNote, safeNoteFallback } from '@/views/detailNoteLoad'
import { syncEditorLightboxEditable } from '@/editor/Editor'

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testDetailNoteLoadResolvesEditableContent(): Promise<void> {
  const result = await loadDetailNote('<p>复盘正文</p>', async (html) => `${html}<p>已解析</p>`)

  assert(result.status === 'ready', 'successful note load should become editable')
  assert(result.status === 'ready' && result.html.includes('已解析'), 'resolved HTML should be preserved')
}

export async function testDetailNoteLoadFailureKeepsSafeReadOnlyBody(): Promise<void> {
  const source = '<p>关键判断仍应可见</p><img src="journal-asset://missing">'
  const result = await loadDetailNote(source, async () => {
    throw new Error('attachment storage unavailable')
  })

  assert(result.status === 'error', 'note resolution failure should become an explicit error state')
  assert(
    result.status === 'error' && result.fallbackHtml.includes('关键判断仍应可见'),
    'failure must retain the written body',
  )
  assert(
    result.status === 'error' && !result.fallbackHtml.includes('journal-asset://'),
    'read-only fallback must not keep unresolved asset URLs',
  )
}

export async function testFailedDraftFlushKeepsLoadedNoteReadOnly(): Promise<void> {
  let resolved = false
  const result = await loadDetailNote(
    '<p>尚未安全落盘的正文</p>',
    async (html) => {
      resolved = true
      return html
    },
    async () => false,
  )

  assert(result.status === 'error', 'a failed draft flush must block editable note bootstrap')
  assert(!resolved, 'asset resolution must not continue after draft flush reports failure')
}

export async function testMissingAttachmentResolutionKeepsPlaceholderReadOnly(): Promise<void> {
  const result = await loadDetailNote('<p>正文</p>', async () => ({
    html: '<p>正文</p><span data-missing-asset-id="missing-1">图片附件缺失</span>',
    editable: false,
  }))

  assert(result.status === 'error', 'an incomplete attachment resolution must stay read-only')
  assert(
    result.status === 'error' && result.fallbackHtml.includes('data-missing-asset-id'),
    'the read-only body should retain the diagnostic placeholder without becoming saveable',
  )
}

export async function testSuccessfulPrepareCanProvideTheLatestFlushedNote(): Promise<void> {
  let resolvedHtml = ''
  const result = await loadDetailNote(
    '<p>旧正文</p>',
    async (html) => {
      resolvedHtml = html
      return html
    },
    async () => '<p>刚刚落盘的新正文</p>',
  )

  assert(result.status === 'ready', 'a successful flush should continue loading the note')
  assert(resolvedHtml.includes('新正文'), 'resolution must use the latest note returned after flushing')
  assert(!resolvedHtml.includes('旧正文'), 'the stale render snapshot must not overwrite the flushed draft')
}

export async function testResolveFailureFallsBackToTheLatestPreparedNote(): Promise<void> {
  const result = await loadDetailNote(
    '<p>旧正文</p>',
    async () => {
      throw new Error('attachment storage unavailable')
    },
    async () => '<p>刚刚落盘的新正文</p><img src="journal-asset://missing">',
  )

  assert(result.status === 'error', 'attachment failure should keep the note read-only')
  assert(
    result.status === 'error' && result.fallbackHtml.includes('刚刚落盘的新正文'),
    'read-only fallback must preserve the latest flushed body',
  )
  assert(
    result.status === 'error' && !result.fallbackHtml.includes('旧正文'),
    'read-only fallback must not regress to the stale render snapshot',
  )
}

export function testSafeNoteFallbackReplacesImagesWithoutRemovingText(): void {
  const fallback = safeNoteFallback('<p>正文</p><img alt="截图" src="blob:missing">')

  assert(fallback.includes('正文'), 'safe fallback must preserve text')
  assert(fallback.includes('图片暂未载入'), 'safe fallback must explain omitted images')
  assert(!fallback.includes('<img'), 'safe fallback must not render unresolved images')
}

export async function testDetailViewExposesLoadingRetryAndReadOnlyRecovery(): Promise<void> {
  const fs = await import('node:fs/promises')
  const detailSource = await fs.readFile('src/views/DetailView.tsx', 'utf8')
  const editorSource = await fs.readFile('src/editor/Editor.tsx', 'utf8')

  assert(detailSource.includes('复盘笔记载入中'), 'detail view should explain note loading instead of looking empty')
  assert(detailSource.includes('重新载入'), 'detail view should expose an explicit retry action')
  assert(detailSource.includes('当前为只读模式'), 'failed note load should explain its safe read-only state')
  assert(detailSource.includes('readOnly'), 'failed note load should render the fallback as read-only')
  assert(
    detailSource.includes("key={`${trade.id}:note`}") &&
      !detailSource.includes('fallback:${noteLoadAttempt}'),
    'retrying a failed note must reuse the TipTap instance instead of remounting it mid-transition',
  )
  assert(detailSource.includes('前往回收站'), 'deleted detail should expose the recovery destination')
  assert(detailSource.includes('记录仍在安全保留期内'), 'deleted detail should not be presented as permanently lost')
  assert(
    !detailSource.includes('flushNoteDraftsToStore().finally'),
    'note bootstrap must not leak a rejected flush promise through finally',
  )
  assert(editorSource.includes('readOnly = false'), 'editor should support an explicit read-only mode')
}

export function testReadOnlyEditorCannotBecomeEditableWhenLightboxCloses(): void {
  const calls: Array<[boolean, boolean | undefined]> = []
  const editor = {
    setEditable(editable: boolean, emitUpdate?: boolean) {
      calls.push([editable, emitUpdate])
    },
  }

  syncEditorLightboxEditable(editor, false, true)

  assert(
    JSON.stringify(calls) === JSON.stringify([[false, false]]),
    'read-only recovery must stay locked when the image lightbox is closed',
  )
}
