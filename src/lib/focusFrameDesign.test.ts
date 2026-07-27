function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message)
}

export async function testInteractiveControlsExposeVisibleKeyboardFocus(): Promise<void> {
  const fs = await import('node:fs/promises')
  const tokens = await fs.readFile('src/styles/tokens.css', 'utf8')

  assert(
    !tokens.includes('--focus-ring-color: transparent;') &&
      !tokens.includes('--focus-ring-outline: none;') &&
      !tokens.includes('--focus-ring-width: 0;'),
    '键盘焦点令牌必须提供可见的颜色、轮廓和宽度',
  )
}
