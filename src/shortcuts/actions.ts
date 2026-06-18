import type { ShortcutActionMeta } from '@/shortcuts/types'

const seq = (keys: string[]) => keys.map((key) => ({ key }))

export const SHORTCUT_ACTIONS: ShortcutActionMeta[] = [
  {
    id: 'global.commandPalette',
    label: '命令面板',
    category: '通用',
    scope: 'global',
    defaultBinding: { mod: true, key: 'k' },
  },
  {
    id: 'global.newTrade',
    label: '新建交易',
    category: '通用',
    scope: 'global',
    defaultBinding: { key: 'c' },
  },
  {
    id: 'global.closeOverlay',
    label: '关闭弹层',
    category: '通用',
    scope: 'overlay',
    defaultBinding: { key: 'escape' },
    allowWhenTyping: true,
  },

  {
    id: 'nav.active',
    label: '进行中',
    category: '导航',
    scope: 'navigation',
    defaultBinding: seq(['g', 'i']),
    sequenceFixed: true,
  },
  {
    id: 'nav.favorites',
    label: '星标交易',
    category: '导航',
    scope: 'navigation',
    defaultBinding: seq(['g', 'f']),
    sequenceFixed: true,
  },
  {
    id: 'nav.missed',
    label: '错过的机会',
    category: '导航',
    scope: 'navigation',
    defaultBinding: seq(['g', 'x']),
    sequenceFixed: true,
  },
  {
    id: 'nav.sim',
    label: '模拟回测',
    category: '导航',
    scope: 'navigation',
    defaultBinding: seq(['g', 'p']),
    sequenceFixed: true,
  },
  {
    id: 'nav.list',
    label: '全部交易',
    category: '导航',
    scope: 'navigation',
    defaultBinding: seq(['g', 'l']),
    sequenceFixed: true,
  },
  {
    id: 'nav.board',
    label: '看板',
    category: '导航',
    scope: 'navigation',
    defaultBinding: seq(['g', 'b']),
    sequenceFixed: true,
  },
  {
    id: 'nav.dashboard',
    label: '仪表盘',
    category: '导航',
    scope: 'navigation',
    defaultBinding: seq(['g', 'd']),
    sequenceFixed: true,
  },
  {
    id: 'nav.strategies',
    label: '管理策略',
    category: '设置',
    scope: 'navigation',
    defaultBinding: seq(['g', 's']),
    sequenceFixed: true,
  },

  {
    id: 'view.list',
    label: '切换到列表视图',
    category: '视图',
    scope: 'navigation',
    defaultBinding: { shift: true, key: 'l' },
  },
  {
    id: 'view.board',
    label: '切换到看板视图',
    category: '视图',
    scope: 'navigation',
    defaultBinding: { shift: true, key: 'b' },
  },

  {
    id: 'trade.prev',
    label: '上一个案例',
    category: '交易',
    scope: 'detail',
    defaultBinding: { key: '[' },
  },
  {
    id: 'trade.next',
    label: '下一个案例',
    category: '交易',
    scope: 'detail',
    defaultBinding: { key: ']' },
  },
  {
    id: 'trade.backToList',
    label: '返回列表',
    category: '交易',
    scope: 'detail',
    defaultBinding: { key: 'u' },
  },

  {
    id: 'image.prev',
    label: '上一张图片',
    category: '图片',
    scope: 'lightbox',
    defaultBinding: { key: 'arrowleft' },
    allowWhenTyping: true,
  },
  {
    id: 'image.next',
    label: '下一张图片',
    category: '图片',
    scope: 'lightbox',
    defaultBinding: { key: 'arrowright' },
    allowWhenTyping: true,
  },
  {
    id: 'image.close',
    label: '关闭图片预览',
    category: '图片',
    scope: 'lightbox',
    defaultBinding: { key: 'escape' },
    allowWhenTyping: true,
  },
]

export const SHORTCUT_ACTION_MAP = new Map(
  SHORTCUT_ACTIONS.map((a) => [a.id, a]),
)

export function getActionMeta(id: string): ShortcutActionMeta | undefined {
  return SHORTCUT_ACTION_MAP.get(id)
}
