import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { toast } from '@/lib/toast'
import { MAX_WEB_JOURNAL_ENTRY_BYTES } from '@/lib/webJournalArchiveContract'
import { AssetObjectUrlScope } from '@/storage/assetObjectUrls'
import { appendAssetToNoteDraft, type NoteDraftKey } from '@/storage/noteDrafts'
import { trackPendingStorageOperation } from '@/storage/pendingOperations'
import { getStorage } from '@/storage/provider'
import { useStore } from '@/store/useStore'

const editorImageScopes = new WeakMap<Editor, AssetObjectUrlScope>()
function imageScopeForEditor(editor: Editor): AssetObjectUrlScope {
  let scope = editorImageScopes.get(editor)
  if (!scope) {
    scope = new AssetObjectUrlScope()
    editorImageScopes.set(editor, scope)
    const owned = scope
    // 包含编辑器撤销历史中的图片；销毁记录编辑器时统一释放。
    editor.on('destroy', () => { owned.release(); editorImageScopes.delete(editor) })
  }
  return scope
}

/** 粘贴、拖入及失败重试都属于发起操作的资料库。路由离开时保存到原记录草稿。 */
export function insertEditorImage(editor: Editor, file: File, noteDraftId?: NoteDraftKey, dropPosition?: number): void {
  if (file.size > MAX_WEB_JOURNAL_ENTRY_BYTES) {
    toast('单张原图超过 32 MB，无法加入资料库；请缩小图片后重试')
    return
  }
  const session = useStore.getState().librarySession
  const sameLibrary = () => useStore.getState().librarySession === session

  function start(position?: number, savedId?: string) {
    if (!editor.isDestroyed && sameLibrary()) void trackPendingStorageOperation(persist(position, savedId))
  }

  async function persist(position?: number, savedId?: string) {
    // 落盘期间可以继续输入、移动光标或离开正文。只跟踪原插入位置。
    let from = position ?? editor.state.selection.from
    let to = position ?? editor.state.selection.to
    const replacedContent = editor.state.doc.slice(from, to)
    const mapInsertion = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.docChanged) return
      const wasEmpty = from === to
      from = transaction.mapping.map(from, -1)
      to = wasEmpty ? from : Math.max(from, transaction.mapping.map(to, -1))
    }
    editor.on('transaction', mapInsertion)
    let assetId = savedId
    try {
      const storage = getStorage()
      assetId ??= await storage.saveAsset(file, file.type || 'image/png')
      if (!sameLibrary() || editor.isDestroyed) return
      const displayUrl = await imageScopeForEditor(editor).get(storage, assetId)
      if (!sameLibrary()) return
      if (!displayUrl) throw new Error('getAssetObjectUrl returned null')
      if (editor.isDestroyed) return

      // 选中文字已被用户改写时，保留其新内容。只有光标仍停在原处才推进到图后。
      if (!editor.state.doc.slice(from, to).eq(replacedContent)) to = from
      const selection = editor.state.selection
      const advanceCaret = editor.view.hasFocus() && selection.from === from && selection.to === to
      const insertion = editor.chain().insertContentAt({ from, to }, {
        type: 'image',
        attrs: { src: displayUrl, 'data-asset-id': assetId },
      }, { updateSelection: advanceCaret })
      if (advanceCaret) insertion.createParagraphNear()
      insertion.run()
    } catch (error) {
      if (!sameLibrary()) return
      if (editor.isDestroyed) {
        console.error('Image persistence finished after editor was destroyed', error)
        return
      }
      console.error('Image persist failed', error)
      toast('截图保存失败，未插入正文', {
        tone: 'error',
        actionLabel: '重试',
        onAction: () => start(undefined, assetId),
        dedupeKey: 'editor-image-persist-failed',
      })
    } finally {
      editor.off('transaction', mapInsertion)
      if (assetId && noteDraftId && editor.isDestroyed && sameLibrary()) {
        try { await appendAssetToNoteDraft(noteDraftId, assetId) }
        catch (error) { console.error('Saved image draft recovery failed', error) }
      }
    }
  }

  start(dropPosition)
}
