/** 单键或组合键（不含序列） */
export interface KeyChord {
  mod?: boolean
  shift?: boolean
  alt?: boolean
  key: string
}

/** 序列键（如 G → L）或单键绑定 */
export type ShortcutBinding = KeyChord | KeyChord[]

export type ShortcutScope =
  | 'global'
  | 'navigation'
  | 'detail'
  | 'lightbox'
  | 'overlay'

export interface ShortcutActionMeta {
  id: string
  label: string
  category: string
  scope: ShortcutScope
  /** 默认绑定；序列键 v1 不可在设置页修改 */
  defaultBinding: ShortcutBinding
  /** 为 true 时输入框聚焦时仍可触发（如 Escape） */
  allowWhenTyping?: boolean
  /** 序列键固定，设置页只读 */
  sequenceFixed?: boolean
}

export interface ListNavigationContext {
  filter: import('@/lib/tradeFilters').ListFilter
  listPath: string
  /** 列表页当前 search（含自定义视图筛选），用于详情返回时还原 */
  listSearch: string
  orderedIds: string[]
}
