import { toggleSourceImage, moveImage } from './images'
import type { JudgmentImage } from './model'
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
export function testCaptureOrderFollowsDocumentWhenLaterImageIsClickedFirst() {
  const initial: JudgmentImage[] = [{ assetId: 'second', sourceTradeId: 'case' }]
  const selected = toggleSourceImage(initial, 'first', 'case', ['first', 'second'])
  assert(selected.map(i => i.assetId).join() === 'first,second', '右键后图，再选前图，仍须按原文排序')
  assert(selected.every(i => i.sourceTradeId === 'case'), '来源挂靠必须保留')
  assert(initial[0].assetId === 'second' && initial.length === 1, '不能改写原选择')
  const removed = toggleSourceImage(selected, 'first', 'case', ['first', 'second'])
  assert(removed.length === 1 && removed[0].assetId === 'second', '取消选择只移除目标图')
}
export function testImageReorderPreservesReferencesAndDoesNotMutateSavedOrder() {
  const saved = [{ assetId: 'a', sourceTradeId: 'trade' }, { assetId: 'b', sourceTradeId: 'case' }]
  const draft = moveImage(saved, 1, -1)
  assert(draft[0] === saved[1] && draft[1] === saved[0], '调序不得丢失来源或图片')
  assert(saved[0].assetId === 'a', '未保存或取消不得改写原顺序')
  assert(moveImage(saved, 0, -1) === saved, '边界不能绕回末尾')
}
export function testDragCanMoveAcrossSeveralPositionsWithoutLosingImages() {
  const images = ['a', 'b', 'c', 'd']
  const moved = moveImage(images, 0, 3)
  if (moved.join() !== 'b,c,d,a' || images.join() !== 'a,b,c,d') throw Error('拖拽跨位置应保持其他图片顺序且不修改原数组')
  if (moveImage(moved, 3, -3).join() !== images.join()) throw Error('反向拖拽应还原顺序')
}
