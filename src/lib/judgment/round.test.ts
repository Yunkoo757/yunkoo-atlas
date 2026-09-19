import { themeReviewQueue } from './round'
import { judgmentFixture } from './model.test'
export function testReviewQueueIsRandomizedScopedAndWithoutRepeats() {
  const base = judgmentFixture().samples[0]
  const samples = ['a', 'b', 'c', 'outside'].map(id => ({ ...base, id, themeId: id === 'outside' ? 'other' : 'theme' }))
  const queue = themeReviewQueue(samples, 'theme', () => 0)
  if (queue.join() !== 'b,c,a' || new Set(queue).size !== 3) throw Error('应只打乱指定主题，每组素材一次')
  if (samples[0].id !== 'a') throw Error('随机复盘不能改写素材顺序')
  if (themeReviewQueue(samples, 'empty').length) throw Error('空主题不应开始复盘')
  if (themeReviewQueue([samples[0]], 'theme').join() !== 'a') throw Error('单素材主题仍可复盘')
}
