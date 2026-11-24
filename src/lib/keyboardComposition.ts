/** 部分桌面输入法确认候选时只发送 229，不设置 isComposing。 */
export function isComposingKey(event: Pick<KeyboardEvent, 'isComposing' | 'keyCode'>): boolean {
  return event.isComposing || event.keyCode === 229
}
