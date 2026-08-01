import {
  createQuickNote,
  normalizeQuickNotes,
  UNTITLED_QUICK_NOTE,
  type QuickNote,
} from '@/data/quickNotes'

type QuickNoteWithTitleMode = QuickNote & { titleMode?: 'auto' | 'manual' }

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function note(patch: Partial<QuickNoteWithTitleMode> = {}): QuickNoteWithTitleMode {
  return {
    id: 'note-1',
    title: UNTITLED_QUICK_NOTE,
    contentHtml: '',
    pinned: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...patch,
  }
}

export function testNewQuickNoteStartsWithAutomaticTitle(): void {
  const created = createQuickNote(new Date('2026-08-01T00:00:00.000Z')) as QuickNoteWithTitleMode
  assert(created.titleMode === 'auto', '新建随记必须默认使用自动标题')
}

export function testAutomaticTitleContinuesFollowingBodyOpening(): void {
  const [normalized] = normalizeQuickNotes([note({
    title: 'a',
    titleMode: 'auto',
    contentHtml: '<p>阿松大阿松大</p><p>第二段内容</p>',
  })]) as QuickNoteWithTitleMode[]
  assert(normalized?.title === '阿松大阿松大 第二段内容', '自动标题不得停在正文的第一个按键')
  assert(normalized.titleMode === 'auto', '正文更新后必须继续保持自动标题模式')
}

export function testManualTitleIsNeverOverwrittenByBody(): void {
  const [normalized] = normalizeQuickNotes([note({
    title: '我的标题',
    titleMode: 'manual',
    contentHtml: '<p>正文开头已经变化</p>',
  })]) as QuickNoteWithTitleMode[]
  assert(normalized?.title === '我的标题', '手动标题不得被正文覆盖')
  assert(normalized.titleMode === 'manual', '手动模式必须持久保留')
}

export function testLegacyNotesPreserveCustomTitlesAndRecoverUntitledNotes(): void {
  const normalized = normalizeQuickNotes([
    note({ id: 'legacy-custom', title: '历史手写标题', contentHtml: '<p>另一段正文</p>' }),
    note({ id: 'legacy-untitled', title: UNTITLED_QUICK_NOTE, contentHtml: '<p>正文自动标题</p>' }),
    note({ id: 'legacy-stuck', title: 'a', contentHtml: '<p>阿松大阿松大</p>' }),
  ]) as QuickNoteWithTitleMode[]
  const byId = new Map(normalized.map((item) => [item.id, item]))
  assert(byId.get('legacy-custom')?.title === '历史手写标题', '旧随记的自定义标题必须原样保留')
  assert(byId.get('legacy-custom')?.titleMode === 'manual', '旧自定义标题必须迁移为手动模式')
  assert(byId.get('legacy-untitled')?.title === '正文自动标题', '旧无标题随记必须从正文恢复标题')
  assert(byId.get('legacy-untitled')?.titleMode === 'auto', '旧无标题随记必须迁移为自动模式')
  assert(byId.get('legacy-stuck')?.title === '阿松大阿松大', '旧版本停在首个按键的标题必须自动修复')
  assert(byId.get('legacy-stuck')?.titleMode === 'auto', '旧版本的单字符残留标题必须恢复自动模式')
}
