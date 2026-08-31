export const THEME_LUMINANCE_SCHEMA_VERSION = 1

export const THEME_LUMINANCE_THRESHOLDS = Object.freeze({
  strong: 12,
  supporting: 7,
  body: 7,
  metadata: 5.5,
  context: 4.5,
})

export const THEME_LUMINANCE_PAGES = Object.freeze([
  Object.freeze({ id: 'trades-list', path: '/list', ready: '.trade-list', root: '.list-scroll', rootSurface: 'pane' }),
  Object.freeze({ id: 'trades-board', path: '/board', ready: '.board-scroll', root: '.board-scroll', rootSurface: 'pane' }),
  Object.freeze({ id: 'review-cases-list', path: '/review-cases', ready: '.trade-list', root: '.list-scroll', rootSurface: 'pane' }),
  Object.freeze({ id: 'review-cases-board', path: '/review-cases/board', ready: '.board-scroll', root: '.board-scroll', rootSurface: 'pane' }),
  Object.freeze({ id: 'settings-profile', path: '/settings/profile', ready: '.profile-settings', root: '.settings-panel', rootSurface: 'pane' }),
  Object.freeze({ id: 'settings-risk', path: '/settings/risk', ready: '.risk-management-settings', root: '.settings-panel', rootSurface: 'pane' }),
  Object.freeze({ id: 'trash', path: '/trade-trash', ready: '.trash-view', root: '.trash-view', rootSurface: 'pane' }),
])

export const THEME_SURFACE_PROBES = Object.freeze([
  Object.freeze({ id: 'trades-board-card', page: 'trades-board', selector: '.bd-card', targetSurface: 'elevated', required: true }),
  Object.freeze({ id: 'review-cases-board-card', page: 'review-cases-board', selector: '.bd-card', targetSurface: 'elevated', required: true }),
])

export const THEME_TEXT_PROBES = Object.freeze([
  Object.freeze({ id: 'sidebar-section', page: 'trades-list', selector: '.sb-primary .sb-section-label', semantic: 'Context', targetRole: 'context', required: true }),
  Object.freeze({ id: 'sidebar-rest', page: 'trades-list', selector: '.sb-primary [data-primary-id="reviewCases"] .sb-item-label', semantic: 'Scan Metadata', targetRole: 'metadata', required: true }),
  Object.freeze({ id: 'sidebar-active', page: 'trades-list', selector: '.sb-primary [data-primary-id="trades"] .sb-item-label', semantic: 'Identity', targetRole: 'strong', required: true }),
  Object.freeze({ id: 'list-header', page: 'trades-list', selector: '.trade-list-column', semantic: 'Scan Metadata', targetRole: 'metadata', required: true }),
  Object.freeze({ id: 'month-title', page: 'trades-list', selector: '.trade-list-group-header strong', semantic: 'Identity', targetRole: 'strong', required: true }),
  Object.freeze({ id: 'month-count', page: 'trades-list', selector: '.trade-list-group-count', semantic: 'Scan Metadata', targetRole: 'metadata', required: true }),
  Object.freeze({ id: 'trade-ref', page: 'trades-list', selector: '.trade-row-ref', semantic: 'Scan Metadata', targetRole: 'metadata', required: true }),
  Object.freeze({ id: 'trade-symbol', page: 'trades-list', selector: '.trade-row-symbol strong', semantic: 'Identity', targetRole: 'strong', required: true }),
  Object.freeze({ id: 'trade-timeframe', page: 'trades-list', selector: '.trade-row-timeframe', semantic: 'Scan Metadata', targetRole: 'metadata', required: true }),
  Object.freeze({ id: 'trade-date', page: 'trades-list', selector: '.trade-row-date', semantic: 'Scan Metadata', targetRole: 'metadata', required: true }),
  Object.freeze({ id: 'trade-tag', page: 'trades-list', selector: '.trade-row-tag', semantic: 'Explanatory Context', targetRole: 'context', required: true }),
  Object.freeze({ id: 'case-ref', page: 'review-cases-list', selector: '.trade-row-ref', semantic: 'Scan Metadata', targetRole: 'metadata', required: true }),
  Object.freeze({ id: 'case-symbol', page: 'review-cases-list', selector: '.trade-row-symbol strong', semantic: 'Identity', targetRole: 'strong', required: true }),
  Object.freeze({ id: 'board-column-count', page: 'review-cases-board', selector: '.bd-col-count', semantic: 'Scan Metadata', targetRole: 'metadata', required: true }),
  Object.freeze({ id: 'board-card-ref', page: 'review-cases-board', selector: '.bd-card-ref', semantic: 'Scan Metadata', targetRole: 'metadata', required: true }),
  Object.freeze({ id: 'board-card-symbol', page: 'review-cases-board', selector: '.bd-card-symbol', semantic: 'Identity', targetRole: 'strong', required: true }),
  Object.freeze({ id: 'settings-title', page: 'settings-profile', selector: '.settings-page-title', semantic: 'Identity', targetRole: 'strong', required: true }),
  Object.freeze({ id: 'settings-help', page: 'settings-profile', selector: '.profile-section-hint', semantic: 'Explanatory Context', targetRole: 'context', required: true }),
  Object.freeze({ id: 'risk-option', page: 'settings-risk', selector: '.risk-indicator-options [role="radio"]:not([aria-checked="true"])', semantic: 'Body', targetRole: 'body', required: true }),
])

export const THEME_STATE_CONTRACTS = Object.freeze([
  Object.freeze({ id: 'trade-row-hover', path: '/list', ready: '.trade-list', kind: 'hover', target: '.trade-row', pseudo: '::after', afterBackgroundToken: '--surface-row-hover', restore: 'mouse-out' }),
  Object.freeze({ id: 'board-card-hover', path: '/board', ready: '.board-scroll', kind: 'hover', target: '.bd-card', beforeBackgroundToken: '--surface-elevated', afterBackgroundToken: '--surface-card-hover', restore: 'mouse-out' }),
  Object.freeze({
    id: 'nav-active-hover',
    path: '/review-cases',
    ready: '.trade-list',
    kind: 'paired-hover',
    target: '.sb-primary .sb-sortable-row[data-primary-id="trades"]',
    reference: '.sb-primary .sb-sortable-row[data-primary-id="reviewCases"]',
    afterBackgroundToken: '--surface-nav-hover',
    referenceBeforeBackgroundToken: '--surface-nav-active',
    restore: 'mouse-out',
  }),
  Object.freeze({
    id: 'risk-control-active-hover',
    path: '/settings/risk',
    ready: '.risk-management-settings',
    kind: 'paired-hover',
    target: '.risk-indicator-options [role="radio"]:not([aria-checked="true"])',
    reference: '.risk-indicator-options [role="radio"][aria-checked="true"]',
    afterBackgroundToken: '--surface-control-hover',
    referenceBeforeBackgroundToken: '--surface-control-active',
    restore: 'mouse-out',
  }),
  Object.freeze({ id: 'profile-keyboard-focus', path: '/settings/profile', ready: '.profile-settings', kind: 'keyboard-focus', target: '.profile-name-input', afterBorderToken: '--field-border-focus', afterBoxShadowNotNone: true, restore: 'blur' }),
  Object.freeze({
    id: 'display-menu-hover',
    path: '/review-cases/board',
    ready: '.board-scroll',
    kind: 'menu-hover',
    trigger: '[aria-label="显示选项"]',
    target: '.display-item:not(.is-on)',
    reference: '.display-pop',
    afterBackgroundToken: '--surface-menu-hover',
    referenceBeforeBackgroundToken: '--surface-floating',
    restore: 'escape',
  }),
  Object.freeze({
    id: 'display-popover',
    path: '/review-cases/board',
    ready: '.board-scroll',
    kind: 'popover',
    trigger: '[aria-label="显示选项"]',
    target: '.display-pop',
    afterBackgroundToken: '--surface-floating',
    afterBorderToken: '--popover-border',
    afterOpacity: '1',
    restore: 'escape',
  }),
  Object.freeze({ id: 'risk-disabled', path: '/settings/risk', ready: '.risk-management-settings', kind: 'inject-disabled', target: '[data-theme-qa-disabled]', afterColorToken: '--text-disabled', afterBackground: 'rgba(0, 0, 0, 0)', afterBoxShadow: 'none', restore: 'remove-fixture' }),
  Object.freeze({ id: 'trade-toast', path: '/list', ready: '.trade-list', kind: 'inject-toast', target: '[data-theme-qa-toast]', afterBorderToken: '--popover-border', afterOpacity: '1', restore: 'remove-fixture' }),
])

const opticalMix = (key, reason, expiresWhen) => Object.freeze({
  key,
  reason,
  owner: 'Design System',
  expiresWhen,
})

export const THEME_COLOR_MIX_ALLOWLIST = Object.freeze([
  opticalMix('src/components/ImageLightbox.css:167', '图片内容上方的半透明控制面，必须保留底图上下文。', 'Lightbox 控制面改为不透明布局时'),
  opticalMix('src/components/ImageLightbox.css:176', '图片内容上的悬停控制面需要与底图合成。', 'Lightbox 控制面改为不透明布局时'),
  opticalMix('src/components/ShortcutTooltip.css:22', '快捷键提示的单像素内阴影用于键帽光学校准。', '快捷键提示统一迁移至 Kbd 组件时'),
  opticalMix('src/components/sidebar/SidebarWorkspace.css:248', '工作区菜单边界叠加在侧栏浮层上。', '工作区菜单迁移至共享 Menu 时'),
  opticalMix('src/components/sidebar/SidebarWorkspace.css:250', '工作区菜单控制面需要保留侧栏底色上下文。', '工作区菜单迁移至共享 Menu 时'),
  opticalMix('src/components/sidebar/SidebarWorkspace.css:548', '工作区状态标签使用文字角色生成低强度底板。', '状态标签建立独立语义 Surface 时'),
  opticalMix('src/components/sidebar/SidebarWorkspace.css:562', '工作区溢出状态使用文字角色生成低强度底板。', '状态标签建立独立语义 Surface 时'),
  opticalMix('src/components/Sidebar.css:267', '侧栏拖拽占位只提供短暂位置反馈。', '侧栏拖拽反馈重构时'),
  opticalMix('src/components/Sidebar.css:332', '侧栏微型操作按钮保持低于导航 Hover 的强度。', '微型操作按钮迁移至共享 IconButton 时'),
  opticalMix('src/components/Sidebar.css:357', '关闭品牌焦点环后仍保留低强度键盘定位反馈。', '键盘焦点关闭态获得独立 Focus Token 时'),
  opticalMix('src/components/Sidebar.css:422', '侧栏子项层级线需要在 App Surface 上进行低强度合成。', '侧栏层级线获得独立 Border Token 时'),
  opticalMix('src/components/Sidebar.css:433', '当前侧栏子项层级线需要继承强调文字强度。', '侧栏层级线获得独立 Border Token 时'),
  opticalMix('src/components/Sidebar.css:473', '风险环 SVG 填充按 currentColor 生成。', '风险环改用独立 SVG 渐变 Token 时'),
  opticalMix('src/components/Sidebar.css:479', '风险环 SVG 描边按 currentColor 生成。', '风险环改用独立 SVG 渐变 Token 时'),
  opticalMix('src/components/Sidebar.css:488', '风险环 SVG 光晕按 currentColor 生成。', '风险环改用独立 SVG 渐变 Token 时'),
  opticalMix('src/components/StrategyIcon.css:9', '策略图标底板需要低于相邻标签表面。', '策略图标建立独立语义 Surface 时'),
  opticalMix('src/components/SymbolIcon.css:21', '品种图标内阴影继承业务 currentColor。', '品种图标改为预渲染资产时'),
  opticalMix('src/components/SymbolIcon.css:25', '品种图标内阴影继承业务 currentColor。', '品种图标改为预渲染资产时'),
  opticalMix('src/components/SymbolIcon.css:35', '品种图标微边界用于小尺寸抗锯齿补偿。', '品种图标改为预渲染资产时'),
  opticalMix('src/components/TagEditor.css:28', '标签编辑器嵌入面需要低于标准 Control Hover。', '标签编辑器迁移至共享 Select 时'),
  opticalMix('src/components/TradeComposer.css:149', '交易编辑器内部输入组使用低强度嵌入面。', '交易编辑器输入组迁移至共享 Fieldset 时'),
  opticalMix('src/components/trades/QuickViewBar.css:3', '快捷视图 Rest 是 Control 家族内部插值。', 'Control Token 能直接表达该状态时'),
  opticalMix('src/components/trades/QuickViewBar.css:4', '快捷视图 Hover 是 Control 家族内部插值。', 'Control Token 能直接表达该状态时'),
  opticalMix('src/components/trades/QuickViewBar.css:5', '快捷视图边界由 Metadata 文字强度光学校准。', '快捷视图迁移至共享 FilterBar 时'),
  opticalMix('src/components/trades/QuickViewBar.css:6', '快捷视图 Hover 边界由 Metadata 文字强度光学校准。', '快捷视图迁移至共享 FilterBar 时'),
  opticalMix('src/components/trades/TradeList.css:178', '分组折叠箭头通过透明度保持低于月份标题。', '折叠箭头建立独立 Icon Token 时'),
  opticalMix('src/components/trades/TradeList.css:264', '分组新增按钮 Hover 仅做 12% 高光补偿。', '分组新增按钮迁移至共享 IconButton 时'),
  opticalMix('src/components/trades/TradeList.css:344', '列表键盘定位同时混合 Focus 与行边界。', 'SelectionBox 能承载键盘定位时'),
  opticalMix('src/components/ui/Chip.css:37', '柔和 Chip 保留低强度底板以维持形状。', 'Chip 柔和态统一重构时'),
  opticalMix('src/components/ui/FilterBar.css:2', '筛选 Chip Rest 边界按 Metadata 角色校准。', 'FilterBar 边界获得全局 Token 时'),
  opticalMix('src/components/ui/FilterBar.css:3', '筛选 Chip Hover 边界按 Metadata 角色校准。', 'FilterBar 边界获得全局 Token 时'),
  opticalMix('src/components/ui/Kbd.css:14', '键帽内阴影用于 11–12px 文本的光学立体感。', '所有键帽统一为单一共享实现时'),
  opticalMix('src/editor/Editor.css:54', '编辑器工具按钮嵌入正文白底/暗底时需保持透明合成。', '编辑器工具栏迁移至共享 Toolbar 时'),
  opticalMix('src/styles/global.css:274', '全局键盘焦点兜底使用文字色生成非品牌轮廓。', '所有交互元素均具备组件级 Focus Token 时'),
  opticalMix('src/styles/global.css:284', '原生 Placeholder 在两级文字角色之间做跨平台补偿。', 'Windows 与 macOS 原生 Placeholder 统一时'),
  opticalMix('src/views/ReviewSessionView.css:718', '空白图表区棋盘格用于表达可放置媒体区域。', '媒体占位区改为插图或纯色时'),
  opticalMix('src/views/settings/SymbolsPanel.css:164', '品种预览继承 currentColor 的小尺寸内阴影。', '品种图标改为预渲染资产时'),
  opticalMix('src/views/ShortcutsView.css:269', '快捷键录制框内阴影用于键帽光学校准。', '快捷键录制框迁移至共享 Kbd 时'),
])

export function pageById(id) {
  return THEME_LUMINANCE_PAGES.find((page) => page.id === id) ?? null
}

export function textProbesForPage(pageId) {
  return THEME_TEXT_PROBES.filter((probe) => probe.page === pageId)
}

export function surfaceProbesForPage(pageId) {
  return THEME_SURFACE_PROBES.filter((probe) => probe.page === pageId)
}
