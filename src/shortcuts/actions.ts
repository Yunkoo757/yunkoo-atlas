import type { ShortcutActionMeta } from '@/shortcuts/types'
import { getDefaultShortcutBinding } from '@/config/defaultProfile'

/** 动作名称与作用域在此维护；默认绑定统一来自版本化配置档案。 */
export const SHORTCUT_ACTIONS: ShortcutActionMeta[] = [
  {
    id: 'global.commandPalette',
    label: '命令面板',
    category: '通用',
    scope: 'global',
    defaultBinding: getDefaultShortcutBinding('global.commandPalette'),
  },
  {
    id: 'global.newTrade',
    label: '新建交易',
    category: '通用',
    scope: 'global',
    defaultBinding: getDefaultShortcutBinding('global.newTrade'),
  },
  {
    id: 'global.newCase',
    label: '新建案例记录',
    category: '通用',
    scope: 'global',
    defaultBinding: getDefaultShortcutBinding('global.newCase'),
  },
  {
    id: 'global.undo',
    label: '撤销',
    category: '通用',
    scope: 'global',
    defaultBinding: getDefaultShortcutBinding('global.undo'),
  },
  {
    id: 'global.redo',
    label: '重做',
    category: '通用',
    scope: 'global',
    defaultBinding: getDefaultShortcutBinding('global.redo'),
  },
  {
    id: 'global.closeOverlay',
    label: '关闭弹层',
    category: '通用',
    scope: 'overlay',
    defaultBinding: getDefaultShortcutBinding('global.closeOverlay'),
    allowWhenTyping: true,
  },

  {
    id: 'nav.today',
    label: '今日工作台',
    category: '导航',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('nav.today'),
  },
  {
    id: 'nav.active',
    label: '进行中',
    category: '导航',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('nav.active'),
  },
  {
    id: 'nav.favorites',
    label: '星标交易',
    category: '导航',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('nav.favorites'),
  },
  {
    id: 'nav.missed',
    label: '错过的机会',
    category: '导航',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('nav.missed'),
  },
  {
    id: 'nav.sim',
    label: '模拟回测',
    category: '导航',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('nav.sim'),
  },
  {
    id: 'nav.list',
    label: '交易记录',
    category: '导航',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('nav.list'),
  },
  {
    id: 'nav.reviewCases',
    label: '案例记录',
    category: '导航',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('nav.reviewCases'),
  },
  {
    id: 'nav.board',
    label: '看板',
    category: '导航',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('nav.board'),
  },
  {
    id: 'nav.dashboard',
    label: '仪表盘',
    category: '导航',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('nav.dashboard'),
  },
  {
    id: 'nav.strategies',
    label: '管理策略',
    category: '设置',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('nav.strategies'),
  },

  {
    id: 'view.list',
    label: '切换到列表视图',
    category: '视图',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('view.list'),
  },
  {
    id: 'view.board',
    label: '切换到看板视图',
    category: '视图',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('view.board'),
  },
  {
    id: 'view.table',
    label: '切换到表格视图',
    category: '视图',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('view.table'),
  },

  {
    id: 'trade.prev',
    label: '上一条记录',
    category: '交易',
    scope: 'detail',
    defaultBinding: getDefaultShortcutBinding('trade.prev'),
  },
  {
    id: 'trade.next',
    label: '下一条记录',
    category: '交易',
    scope: 'detail',
    defaultBinding: getDefaultShortcutBinding('trade.next'),
  },
  {
    id: 'trade.backToList',
    label: '返回列表',
    category: '交易',
    scope: 'detail',
    defaultBinding: getDefaultShortcutBinding('trade.backToList'),
  },

  {
    id: 'list.focusNext',
    label: '下一行',
    category: '列表',
    scope: 'navigation',
    // 单键字母，避免方向键抢走列表滚动（对齐插件：高频操作用单键）
    defaultBinding: getDefaultShortcutBinding('list.focusNext'),
  },
  {
    id: 'list.focusPrev',
    label: '上一行',
    category: '列表',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('list.focusPrev'),
  },
  {
    id: 'list.openFocused',
    label: '打开选中行',
    category: '列表',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('list.openFocused'),
  },
  {
    id: 'list.selectAll',
    label: '全选',
    category: '列表',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('list.selectAll'),
  },
  {
    id: 'list.clearSelection',
    label: '清空选择',
    category: '列表',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('list.clearSelection'),
  },
  {
    id: 'list.toggleFilters',
    label: '打开或关闭筛选器',
    category: '列表',
    scope: 'navigation',
    defaultBinding: getDefaultShortcutBinding('list.toggleFilters'),
  },

  {
    id: 'image.prev',
    label: '上一张图片',
    category: '图片',
    scope: 'lightbox',
    defaultBinding: getDefaultShortcutBinding('image.prev'),
    allowWhenTyping: true,
  },
  {
    id: 'image.next',
    label: '下一张图片',
    category: '图片',
    scope: 'lightbox',
    defaultBinding: getDefaultShortcutBinding('image.next'),
    allowWhenTyping: true,
  },
  {
    id: 'image.close',
    label: '关闭图片预览',
    category: '图片',
    scope: 'lightbox',
    defaultBinding: getDefaultShortcutBinding('image.close'),
    allowWhenTyping: true,
  },
  {
    id: 'image.reset',
    label: '重置图片大小',
    category: '图片',
    scope: 'lightbox',
    defaultBinding: getDefaultShortcutBinding('image.reset'),
    allowWhenTyping: true,
  },
]

export const SHORTCUT_ACTION_MAP = new Map(
  SHORTCUT_ACTIONS.map((a) => [a.id, a]),
)

export function getActionMeta(id: string): ShortcutActionMeta | undefined {
  return SHORTCUT_ACTION_MAP.get(id)
}
