export async function testRemovedKeyboardFocusHasNoRuntimeOrSetting(): Promise<void> {
  const fs = await import('node:fs/promises')
  for (const path of ['src/components/ui/AppFrame.tsx', 'src/views/settings/DisplaySettingsPanel.tsx', 'src/lib/tradeFilters.ts']) {
    const source = await fs.readFile(path, 'utf8')
    if (/showKeyboardFocusRings|keyboardNavigation|keyboardFocusRings/.test(source)) throw new Error(`${path} 残留焦点高光功能`)
  }
}
