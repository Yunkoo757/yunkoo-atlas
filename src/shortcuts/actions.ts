import type { ShortcutActionMeta } from '@/shortcuts/types'

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
    label: '新建（交易/判例）',
    category: '通用',
    scope: 'global',
    defaultBinding: { key: 'c' },
  },
  {
    id: 'global.switchModule',
    label: '切换交易与判例',
    category: '通用',
    scope: 'global',
    defaultBinding: { mod: true, key: '.' },
  },
  {
    id: 'global.undo',
    label: '撤销',
    category: '通用',
    scope: 'global',
    defaultBinding: { mod: true, key: 'z' },
  },
  {
    id: 'global.redo',
    label: '重做',
    category: '通用',
    scope: 'global',
    defaultBinding: { mod: true, shift: true, key: 'z' },
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
    defaultBinding: { mod: true, key: '1' },
  },
  {
    id: 'nav.favorites',
    label: '星标交易',
    category: '导航',
    scope: 'navigation',
    defaultBinding: { mod: true, key: '2' },
  },
  {
    id: 'nav.missed',
    label: '错过的机会',
    category: '导航',
    scope: 'navigation',
    defaultBinding: { mod: true, key: '3' },
  },
  {
    id: 'nav.sim',
    label: '模拟回测',
    category: '导航',
    scope: 'navigation',
    defaultBinding: { mod: true, key: '4' },
  },
  {
    id: 'nav.list',
    label: '全部交易',
    category: '导航',
    scope: 'navigation',
    defaultBinding: { mod: true, key: '5' },
  },
  {
    id: 'nav.board',
    label: '看板',
    category: '导航',
    scope: 'navigation',
    defaultBinding: { mod: true, key: '6' },
  },
  {
    id: 'nav.dashboard',
    label: '仪表盘',
    category: '导航',
    scope: 'navigation',
    defaultBinding: { mod: true, key: '7' },
  },
  {
    id: 'nav.strategies',
    label: '管理策略',
    category: '设置',
    scope: 'navigation',
    defaultBinding: { mod: true, key: '8' },
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
    id: 'list.focusNext',
    label: '下一行',
    category: '列表',
    scope: 'navigation',
    defaultBinding: { key: 'j' },
  },
  {
    id: 'list.focusPrev',
    label: '上一行',
    category: '列表',
    scope: 'navigation',
    defaultBinding: { key: 'k' },
  },
  {
    id: 'list.openFocused',
    label: '打开选中行',
    category: '列表',
    scope: 'navigation',
    defaultBinding: { key: 'enter' },
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
