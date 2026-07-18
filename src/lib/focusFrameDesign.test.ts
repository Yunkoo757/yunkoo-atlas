function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testInteractiveControlsAvoidAccentFocusFrames(): Promise<void> {
  const fs = await import('node:fs/promises')
  const tokens = await fs.readFile('src/styles/tokens.css', 'utf8')

  assert(
    tokens.includes('--focus-ring-color: transparent;') &&
      tokens.includes('--focus-ring-outline: none;') &&
      tokens.includes('--focus-ring-width: 0;'),
    '交互控件不得通过全局令牌重新显示彩色焦点框',
  )
}
