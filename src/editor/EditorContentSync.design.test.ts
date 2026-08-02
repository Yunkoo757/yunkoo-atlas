import { readFileSync } from 'node:fs'

export function testExternalContentSyncRunsBeforeImmediateEditorInput(): void {
  const source = readFileSync('src/editor/Editor.tsx', 'utf8').replace(/\r\n?/g, '\n')
  if (!source.includes("useLayoutEffect(() => {\n    if (!editor) return\n    if (content !== editor.getHTML()) setContentWithoutHistory(editor, content)")) {
    throw new Error('external editor content must sync in a layout effect before immediate paste input')
  }
}
