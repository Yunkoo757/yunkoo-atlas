import { type Editor, Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

type ImageLoadFailureMeta = {
  pos: number
  failed: boolean
}

type ImageLoadFailureState = {
  positions: Set<number>
  decorations: DecorationSet
}

const imageLoadFailureKey = new PluginKey<ImageLoadFailureState>('imageLoadFailure')

function createDecorations(
  doc: ProseMirrorNode,
  positions: Set<number>,
): DecorationSet {
  const decorations: Decoration[] = []

  for (const pos of positions) {
    const node = doc.nodeAt(pos)
    if (node?.type.name !== 'image') continue

    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: 'editor-image-load-failed',
        'data-image-load-error': 'true',
      }),
      Decoration.widget(pos + node.nodeSize, () => {
        const fallback = document.createElement('span')
        fallback.className = 'editor-image-load-fallback'
        fallback.contentEditable = 'false'
        fallback.textContent = '图片加载失败'
        return fallback
      }),
    )
  }

  return DecorationSet.create(doc, decorations)
}

function mapFailedImagePositions(
  positions: Set<number>,
  transaction: Transaction,
): Set<number> {
  const mapped = new Set<number>()

  for (const pos of positions) {
    const result = transaction.mapping.mapResult(pos, 1)
    if (!result.deleted && transaction.doc.nodeAt(result.pos)?.type.name === 'image') {
      mapped.add(result.pos)
    }
  }

  return mapped
}

export const ImageLoadFailure = Extension.create({
  name: 'imageLoadFailure',

  addProseMirrorPlugins() {
    return [
      new Plugin<ImageLoadFailureState>({
        key: imageLoadFailureKey,
        state: {
          init: (_, state) => ({
            positions: new Set(),
            decorations: DecorationSet.empty,
          }),
          apply: (transaction, value) => {
            const positions = mapFailedImagePositions(value.positions, transaction)
            const meta = transaction.getMeta(imageLoadFailureKey) as
              | ImageLoadFailureMeta
              | undefined

            if (meta) {
              if (meta.failed) positions.add(meta.pos)
              else positions.delete(meta.pos)
            }

            return {
              positions,
              decorations: createDecorations(transaction.doc, positions),
            }
          },
        },
        props: {
          decorations: (state) => imageLoadFailureKey.getState(state)?.decorations,
        },
      }),
    ]
  },
})

export function setEditorImageLoadFailed(
  editor: Pick<Editor, 'view'>,
  target: EventTarget | null,
  failed: boolean,
): boolean {
  const image = target as HTMLImageElement | null
  if (!image || image.tagName !== 'IMG' || !editor.view.dom.contains(image)) return false

  let pos: number
  try {
    pos = editor.view.posAtDOM(image, 0)
  } catch {
    return false
  }

  if (editor.view.state.doc.nodeAt(pos)?.type.name !== 'image') return false

  editor.view.dispatch(
    editor.view.state.tr.setMeta(imageLoadFailureKey, { pos, failed } satisfies ImageLoadFailureMeta),
  )
  return true
}
