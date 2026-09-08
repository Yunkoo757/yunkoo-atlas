import assert from 'node:assert/strict';
import { lessons } from './content.js';
import { searchIndex } from './data.js';

assert.equal(lessons.length, 11, '教学站应包含 11 个章节');

const ids = new Set(lessons.map((lesson) => lesson.id));
assert.equal(ids.size, lessons.length, '章节 ID 必须唯一');

for (const lesson of lessons) {
  assert.equal(lesson.steps.length, 4, `${lesson.id} 必须包含观察、操作、理解、确认四步`);
  assert.ok(lesson.title && lesson.objective, `${lesson.id} 缺少标题或教学目标`);
  assert.ok((lesson.steps[0].body ?? []).length > 0, `${lesson.id} 缺少观察说明`);
  assert.ok((lesson.steps[1].action ?? '').length > 0, `${lesson.id} 缺少互动动作`);
  const quizzes = lesson.steps.filter((step) => step.type === 'quiz');
  assert.equal(quizzes.length, 1, `${lesson.id} 应该有一个确认步骤`);
  assert.equal(quizzes[0].options.filter((option) => option.correct).length, 1, `${lesson.id} 应该有一个正确答案`);
  for (const prerequisite of lesson.prerequisite ?? []) {
    assert.ok(ids.has(prerequisite), `${lesson.id} 的前置章节不存在：${prerequisite}`);
  }
}

assert.deepEqual(
  new Set(searchIndex.map((item) => item.id)),
  ids,
  '搜索索引必须覆盖所有章节',
);

console.log(`Atlas teaching content verified: ${lessons.length} lessons, ${lessons.length * 4} steps.`);
